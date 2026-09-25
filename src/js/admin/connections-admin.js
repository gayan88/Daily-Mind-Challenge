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

const DAILY_COLLECTION = 'connectionsDailyPuzzles';
const CLASSIC_COLLECTION = 'connectionsClassicPuzzles';
const TOURNAMENTS_COLLECTION = 'connectionsTournaments';
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
// Firestore caps a batch at 500 writes -- one slot per batch is left for the trailing _meta update.
const BATCH_LIMIT = 500;
const GROUP_COUNT = 4;
const WORDS_PER_GROUP = 4;
const MAX_WORD_LENGTH = 14;

/**
 * Parses puzzle text: blocks separated by a blank line, each block = 4 lines of
 * `Group name: word, word, word, word`, ordered easiest (yellow) to hardest (purple). A block may
 * start with an optional `difficulty: easy|medium|hard` line (used by Classic import). Returns
 * `[{ groups: [{ name, words }], difficulty? }]`; throws `Puzzle N: ...` on the first malformed block.
 */
export function parsePuzzleText(text) {
    const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return blocks.map((block, i) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        let difficulty;
        if (/^difficulty\s*:/i.test(lines[0])) {
            difficulty = lines.shift().split(':')[1].trim().toLowerCase();
        }
        if (lines.length !== GROUP_COUNT) {
            throw new Error(`Puzzle ${i + 1}: expected ${GROUP_COUNT} group lines, found ${lines.length}.`);
        }
        const groups = lines.map((line, gi) => {
            const colon = line.indexOf(':');
            if (colon === -1) throw new Error(`Puzzle ${i + 1}, line ${gi + 1}: use the format "Group name: word, word, word, word".`);
            return {
                name: line.slice(0, colon).trim(),
                words: line.slice(colon + 1).split(',').map((w) => w.trim()).filter(Boolean),
            };
        });
        const puzzle = { groups };
        if (difficulty !== undefined) puzzle.difficulty = difficulty;
        return puzzle;
    });
}

/** Inverse of parsePuzzleText() for a single puzzle (used by the CSV/text export and the tables). */
export function puzzleToText(puzzle) {
    return puzzle.groups.map((g) => `${g.name}: ${g.words.join(', ')}`).join('\n');
}

/** Returns an error string if the puzzle can't be saved, or null if it's good. */
export function validatePuzzle(puzzle) {
    const { groups } = puzzle;
    if (!Array.isArray(groups) || groups.length !== GROUP_COUNT) return `A puzzle needs exactly ${GROUP_COUNT} groups.`;
    const seen = new Set();
    for (let gi = 0; gi < groups.length; gi++) {
        const { name, words } = groups[gi];
        if (!name) return `Group ${gi + 1} needs a name.`;
        if (!Array.isArray(words) || words.length !== WORDS_PER_GROUP) return `Group "${name}" needs exactly ${WORDS_PER_GROUP} words.`;
        for (const word of words) {
            if (word.length > MAX_WORD_LENGTH) return `"${word}" is longer than ${MAX_WORD_LENGTH} characters.`;
            const key = word.toUpperCase();
            if (seen.has(key)) return `The word "${word}" appears more than once -- all 16 words must be unique.`;
            seen.add(key);
        }
    }
    return null;
}

function validateAll(puzzles) {
    puzzles.forEach((p, i) => {
        const error = validatePuzzle(p);
        if (error) throw new Error(`Puzzle ${i + 1}: ${error}`);
    });
}

/** Order-independent fingerprint, so the same 16 words in a different arrangement still counts as a duplicate. */
function signature(puzzle) {
    return puzzle.groups.flatMap((g) => g.words.map((w) => w.toUpperCase())).sort().join('|');
}

function isValidDifficulty(difficulty) {
    return DIFFICULTIES.includes(difficulty);
}

/* ----------------------------------- Daily ----------------------------------- */

/** Every seeded Daily puzzle, ordered by date (which also matches challengeNumber order). */
export async function listDailyConnectionsPuzzles() {
    const snap = await getDocs(collection(db, DAILY_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ date: d.id, ...d.data() }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Appends puzzles to the end of the calendar and bumps `_meta`, which
 * `connections-daily-data.js#getTodayChallenge()` reads -- same date-keyed scheme as
 * sudoku-admin.js#addDailySudokuPuzzle()/bulkAddDailySudokuPuzzles(). The very first puzzle
 * requires `startDate` (Challenge #1); every later one is dated the day after the previous one.
 * Validates and de-duplicates everything up front, before any write. Add-only, no delete --
 * removing one from the middle would leave a permanent gap on that date.
 */
export async function addDailyConnectionsPuzzles(puzzles, startDate) {
    if (puzzles.length === 0) throw new Error('No puzzles to add');
    validateAll(puzzles);

    const seenInInput = new Set();
    puzzles.forEach((p, i) => {
        const sig = signature(p);
        if (seenInInput.has(sig)) throw new Error(`Puzzle ${i + 1}: this puzzle appears more than once in the input.`);
        seenInInput.add(sig);
    });
    const existingSigs = new Set((await listDailyConnectionsPuzzles()).map(signature));
    const dupInPool = puzzles.findIndex((p) => existingSigs.has(signature(p)));
    if (dupInPool !== -1) throw new Error(`Puzzle ${dupInPool + 1}: this puzzle is already in the Daily pool.`);

    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    if (existingTotal === 0 && !startDate) throw new Error('Pick a start date for the very first puzzle (Challenge #1)');

    let cursorDate = existingTotal === 0 ? startDate : metaSnap.data().lastDate;
    const assignments = puzzles.map((p, i) => {
        const dateString = existingTotal === 0 && i === 0 ? cursorDate : addDaysToDateString(cursorDate, 1);
        cursorDate = dateString;
        return { dateString, groups: p.groups, challengeNumber: existingTotal + i + 1 };
    });

    const firstDate = existingTotal === 0 ? assignments[0].dateString : metaSnap.data().firstDate;
    const lastDate = assignments[assignments.length - 1].dateString;

    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ dateString, groups, challengeNumber }) => {
            batch.set(doc(db, DAILY_COLLECTION, dateString), { challengeNumber, groups, createdAt: serverTimestamp() });
        });
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount: existingTotal + assignments.length, firstDate, lastDate, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }
    return { count: assignments.length, firstDate: assignments[0].dateString, lastDate };
}

/** Corrects an already-seeded puzzle's content in place (its date and number never change). */
export async function updateDailyConnectionsPuzzle(date, puzzle) {
    const error = validatePuzzle(puzzle);
    if (error) throw new Error(error);
    await setDoc(doc(db, DAILY_COLLECTION, date), { groups: puzzle.groups, updatedAt: serverTimestamp() }, { merge: true });
}

/* ----------------------------------- Classic ----------------------------------- */

/** Every Classic puzzle across all difficulties, by numeric id (a stable admin-table sort only). */
export async function listClassicConnectionsPuzzles() {
    const snap = await getDocs(collection(db, CLASSIC_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ id: Number(d.id), ...d.data() }))
        .sort((a, b) => a.id - b.id);
}

/** Appends Classic puzzles (`{ groups, difficulty }`) under one shared numeric id counter. Duplicates are checked per difficulty. */
export async function addClassicConnectionsPuzzles(puzzles) {
    if (puzzles.length === 0) throw new Error('No puzzles to add');
    validateAll(puzzles);
    puzzles.forEach((p, i) => {
        if (!isValidDifficulty(p.difficulty)) throw new Error(`Puzzle ${i + 1}: difficulty must be easy, medium, or hard.`);
    });

    const seen = new Set();
    puzzles.forEach((p, i) => {
        const key = `${p.difficulty}:${signature(p)}`;
        if (seen.has(key)) throw new Error(`Puzzle ${i + 1}: this puzzle appears more than once in the input for that difficulty.`);
        seen.add(key);
    });
    const existing = new Set((await listClassicConnectionsPuzzles()).map((p) => `${p.difficulty}:${signature(p)}`));
    const dup = puzzles.findIndex((p) => existing.has(`${p.difficulty}:${signature(p)}`));
    if (dup !== -1) throw new Error(`Puzzle ${dup + 1}: this puzzle is already in the ${puzzles[dup].difficulty} pool.`);

    const metaRef = doc(db, CLASSIC_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;

    const assignments = puzzles.map((p, i) => ({ id: existingTotal + i + 1, groups: p.groups, difficulty: p.difficulty }));
    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ id, groups, difficulty }) => {
            batch.set(doc(db, CLASSIC_COLLECTION, String(id)), { groups, difficulty, createdAt: serverTimestamp() });
        });
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount: existingTotal + assignments.length, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }
    return { count: assignments.length };
}

/** Corrects an already-seeded Classic puzzle's content or difficulty without changing its id. */
export async function updateClassicConnectionsPuzzle(id, puzzle) {
    const error = validatePuzzle(puzzle);
    if (error) throw new Error(error);
    if (!isValidDifficulty(puzzle.difficulty)) throw new Error('Difficulty must be easy, medium, or hard.');
    await setDoc(
        doc(db, CLASSIC_COLLECTION, String(id)),
        { groups: puzzle.groups, difficulty: puzzle.difficulty, updatedAt: serverTimestamp() },
        { merge: true }
    );
}

/* --------------------------------- Tournaments --------------------------------- */

/** All Connections tournaments (active and inactive), newest first. */
export async function listConnectionsTournaments() {
    const snap = await getDocs(collection(db, TOURNAMENTS_COLLECTION));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

/** Creates a tournament, active by default. `puzzles` is `[{ groups }]`, each validated like Daily/Classic. */
export async function createConnectionsTournament({ name, puzzles, timePerPuzzleSeconds, bonusPoints }) {
    if (!name.trim()) throw new Error('Give the tournament a name.');
    if (puzzles.length === 0) throw new Error('Add at least one puzzle.');
    validateAll(puzzles);
    if (!(timePerPuzzleSeconds >= 30)) throw new Error('Allow at least 30 seconds per puzzle.');

    const ref = doc(collection(db, TOURNAMENTS_COLLECTION));
    await setDoc(ref, {
        name: name.trim(),
        puzzles: puzzles.map((p) => ({ groups: p.groups })),
        timePerPuzzleSeconds,
        bonusPoints,
        active: true,
        createdAt: serverTimestamp(),
    });
    return ref.id;
}

export async function setConnectionsTournamentActive(id, active) {
    await updateDoc(doc(db, TOURNAMENTS_COLLECTION, id), { active });
}

export async function deleteConnectionsTournament(id) {
    await deleteDoc(doc(db, TOURNAMENTS_COLLECTION, id));
}
