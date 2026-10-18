import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    collection,
    serverTimestamp,
    writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { addDaysToDateString } from '../utils/helpers.js';
import { generatePuzzle, validatePuzzle, puzzleWarnings, buildPatchwork, DIFFICULTIES } from '../games/quilt/quilt-generator.js';
import { parsePictureBlocks, pictureFromImageData } from '../games/quilt/quilt-picture.js';

const DAILY_COLLECTION = 'quiltDailyPuzzles';
const CLASSIC_COLLECTION = 'quiltClassicPuzzles';
const TOURNAMENTS_COLLECTION = 'quiltTournaments';
export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);
// Firestore caps a batch at 500 writes -- one slot per batch is left for the trailing _meta update.
const BATCH_LIMIT = 500;

/**
 * Quilt admin Firestore layer (same shape as connections-admin.js). Admins only ever supply
 * *pictures* -- `{ title, difficulty, palette, pixels }` from the text format or a PNG -- and every
 * add/edit runs them through quilt-generator.js, so what's stored is always a full puzzle whose
 * single solution the solver has proved. Puzzle docs are `{ title, difficulty, width, height,
 * palette, pixels, rects, clues, blockers }` (+ `challengeNumber` for Daily).
 */

/* ------------------------------- Pictures -> puzzles ------------------------------- */

/** Reads a PNG/GIF/WebP File (1 pixel = 1 cell) into `{ title, palette, pixels }`; title from the file name. */
export async function pictureFromFile(file) {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width > 60 || bitmap.height > 60) {
        throw new Error(`${file.name} is ${bitmap.width}×${bitmap.height} pixels -- draw pictures at 1 pixel per cell (at most 20×20, or 60×60 for a Patchwork Run).`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
    const picture = pictureFromImageData(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    return { title: title.charAt(0).toUpperCase() + title.slice(1), ...picture };
}

/** Text format (see quilt-picture.js#parsePictureBlocks) -> pictures; `difficulty` fills in blocks that don't set one. */
export function picturesFromText(text, difficulty) {
    return parsePictureBlocks(text).map((b) => ({ title: b.title, difficulty: b.difficulty || difficulty, palette: b.palette, pixels: b.pixels }));
}

/** Inverse of picturesFromText() for one puzzle -- used by Download and the inline editor. */
export function puzzleToText(p) {
    return [`title: ${p.title || ''}`, `difficulty: ${p.difficulty}`, `palette: ${p.palette.join(' ')}`, ...p.pixels].join('\n');
}

/**
 * Generates a puzzle for each picture (seeded by title, so re-importing the same picture gives the
 * same puzzle). Never throws: returns one `{ picture, puzzle, error, warnings }` per input for the
 * admin preview, so every problem in a file is visible at once.
 */
export function preparePuzzles(pictures) {
    return pictures.map((picture, i) => {
        const label = picture.title || `Picture ${i + 1}`;
        try {
            if (!DIFFICULTIES[picture.difficulty]) throw new Error(`difficulty must be easy, medium or hard (got "${picture.difficulty}")`);
            const puzzle = generatePuzzle({ ...picture, title: picture.title || '', seed: picture.title || `picture-${i}` });
            return { picture, puzzle, error: null, warnings: puzzleWarnings(puzzle), label };
        } catch (err) {
            return { picture, puzzle: null, error: err.message, warnings: [], label };
        }
    });
}

function readyPuzzles(prepared) {
    const bad = prepared.find((p) => p.error);
    if (bad) throw new Error(`${bad.label}: ${bad.error}`);
    return prepared.map((p) => p.puzzle);
}

/** Same picture (pixels + palette) = duplicate, whatever its title. */
function signature(p) {
    return `${p.palette.join(',')}|${p.pixels.join('/')}`;
}

function puzzleFields(p) {
    const { title, difficulty, width, height, palette, pixels, rects, clues, blockers } = p;
    const errors = validatePuzzle(p, { checkUnique: false });
    if (errors.length) throw new Error(`${title || 'Puzzle'}: ${errors[0]}`);
    return { title: title || '', difficulty, width, height, palette, pixels, rects, clues, blockers: blockers || [] };
}

/* ----------------------------------- Daily ----------------------------------- */

/** Every seeded Daily puzzle, ordered by date (which also matches challengeNumber order). */
export async function listDailyQuiltPuzzles() {
    const snap = await getDocs(collection(db, DAILY_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ date: d.id, ...d.data() }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Appends prepared puzzles to the end of the calendar and bumps `_meta` (read by
 * quilt-daily-data.js#getTodayChallenge) -- same date-keyed, add-only scheme as
 * connections-admin.js#addDailyConnectionsPuzzles(): the very first puzzle needs `startDate`
 * (Challenge #1), every later one is dated the day after the previous one. All-or-nothing: any
 * generation error or duplicate picture rejects the whole batch before a single write.
 */
export async function addDailyQuiltPuzzles(prepared, startDate) {
    const puzzles = readyPuzzles(prepared);
    if (puzzles.length === 0) throw new Error('No puzzles to add');

    const seen = new Set();
    puzzles.forEach((p) => {
        const sig = signature(p);
        if (seen.has(sig)) throw new Error(`${p.title || 'A picture'} appears more than once in the input.`);
        seen.add(sig);
    });
    const existing = new Set((await listDailyQuiltPuzzles()).map(signature));
    const dup = puzzles.find((p) => existing.has(signature(p)));
    if (dup) throw new Error(`${dup.title || 'A picture'} is already in the Daily pool.`);

    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    if (existingTotal === 0 && !startDate) throw new Error('Pick a start date for the very first puzzle (Challenge #1)');

    let cursorDate = existingTotal === 0 ? startDate : metaSnap.data().lastDate;
    const assignments = puzzles.map((p, i) => {
        const dateString = existingTotal === 0 && i === 0 ? cursorDate : addDaysToDateString(cursorDate, 1);
        cursorDate = dateString;
        return { dateString, fields: puzzleFields(p), challengeNumber: existingTotal + i + 1 };
    });
    const firstDate = existingTotal === 0 ? assignments[0].dateString : metaSnap.data().firstDate;
    const lastDate = assignments[assignments.length - 1].dateString;

    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ dateString, fields, challengeNumber }) => {
            batch.set(doc(db, DAILY_COLLECTION, dateString), { challengeNumber, ...fields, createdAt: serverTimestamp() });
        });
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount: existingTotal + assignments.length, firstDate, lastDate, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }
    return { count: assignments.length, firstDate: assignments[0].dateString, lastDate };
}

/** Replaces an already-seeded Daily puzzle's picture (regenerated); its date and number never change. */
export async function updateDailyQuiltPuzzle(date, prepared) {
    const [puzzle] = readyPuzzles([prepared]);
    await setDoc(doc(db, DAILY_COLLECTION, date), { ...puzzleFields(puzzle), updatedAt: serverTimestamp() }, { merge: true });
}

/* ----------------------------------- Classic ----------------------------------- */

/** Every Classic puzzle across all difficulties, by numeric id. */
export async function listClassicQuiltPuzzles() {
    const snap = await getDocs(collection(db, CLASSIC_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ id: Number(d.id), ...d.data() }))
        .sort((a, b) => a.id - b.id);
}

/** Appends prepared Classic puzzles under one shared numeric id counter; duplicates checked per difficulty. */
export async function addClassicQuiltPuzzles(prepared) {
    const puzzles = readyPuzzles(prepared);
    if (puzzles.length === 0) throw new Error('No puzzles to add');

    const key = (p) => `${p.difficulty}:${signature(p)}`;
    const seen = new Set();
    puzzles.forEach((p) => {
        if (seen.has(key(p))) throw new Error(`${p.title || 'A picture'} appears more than once in the input for ${p.difficulty}.`);
        seen.add(key(p));
    });
    const existing = new Set((await listClassicQuiltPuzzles()).map(key));
    const dup = puzzles.find((p) => existing.has(key(p)));
    if (dup) throw new Error(`${dup.title || 'A picture'} is already in the ${dup.difficulty} pool.`);

    const metaRef = doc(db, CLASSIC_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;

    const assignments = puzzles.map((p, i) => ({ id: existingTotal + i + 1, fields: puzzleFields(p) }));
    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ id, fields }) => batch.set(doc(db, CLASSIC_COLLECTION, String(id)), { ...fields, createdAt: serverTimestamp() }));
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount: existingTotal + assignments.length, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }
    return { count: assignments.length };
}

/** Replaces a Classic puzzle's picture and/or difficulty (regenerated) without changing its id. */
export async function updateClassicQuiltPuzzle(id, prepared) {
    const [puzzle] = readyPuzzles([prepared]);
    await setDoc(doc(db, CLASSIC_COLLECTION, String(id)), { ...puzzleFields(puzzle), updatedAt: serverTimestamp() }, { merge: true });
}

/* --------------------------------- Patchwork Runs --------------------------------- */

/** All Patchwork Runs (active and inactive), newest first. */
export async function listQuiltTournaments() {
    const snap = await getDocs(collection(db, TOURNAMENTS_COLLECTION));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

/** Cuts a picture into tiles (quilt-generator.js#buildPatchwork) for preview; throws an admin-readable Error. */
export function preparePatchwork({ name, picture, cols, rows }) {
    return buildPatchwork({ title: name || picture.title || 'Patchwork', palette: picture.palette, pixels: picture.pixels, cols, rows, seed: name || picture.title || '' });
}

/** Creates a run from a prepared patchwork, active by default. */
export async function createQuiltTournament({ name, patchwork, completionBonus }) {
    if (!name.trim()) throw new Error('Give the run a name.');
    if (!patchwork) throw new Error('Preview the picture first.');
    if (!(completionBonus >= 0)) throw new Error('Completion bonus must be 0 or more.');
    const tiles = patchwork.tiles.map((t) => ({ ...puzzleFields(t), tileX: t.tileX, tileY: t.tileY }));
    const ref = doc(collection(db, TOURNAMENTS_COLLECTION));
    await setDoc(ref, {
        name: name.trim(),
        title: patchwork.title,
        palette: patchwork.palette,
        pixels: patchwork.pixels,
        width: patchwork.width,
        height: patchwork.height,
        cols: patchwork.cols,
        rows: patchwork.rows,
        tiles,
        completionBonus,
        active: true,
        createdAt: serverTimestamp(),
    });
    return ref.id;
}

export async function setQuiltTournamentActive(id, active) {
    await updateDoc(doc(db, TOURNAMENTS_COLLECTION, id), { active });
}

export async function deleteQuiltTournament(id) {
    await deleteDoc(doc(db, TOURNAMENTS_COLLECTION, id));
}
