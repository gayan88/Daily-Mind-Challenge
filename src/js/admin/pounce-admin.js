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
import { generatePuzzle, buildRun, validatePuzzle, puzzleWarnings, DIFFICULTIES, RUN_BOARDS } from '../games/pounce/pounce-generator.js';

const DAILY_COLLECTION = 'pounceDailyPuzzles';
const CLASSIC_COLLECTION = 'pounceClassicPuzzles';
const TOURNAMENTS_COLLECTION = 'pounceTournaments';
export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);
/** The Daily is always a Medium board (decision D2). */
export const DAILY_DIFFICULTY = 'medium';
// Firestore caps a batch at 500 writes -- one slot per batch is left for the trailing _meta update.
const BATCH_LIMIT = 500;

/**
 * Pounce admin Firestore layer (same shape as quilt-admin.js). Unlike Quilt, admins supply no
 * content: boards are generated in the browser by pounce-generator.js (each proven to have one
 * solution and solvable by logic, graded into its difficulty band). Hand-made boards can be
 * imported as JSON and go through the full validator. Stored docs are `{ difficulty, size,
 * regions, solution, dogs, pawprints, grade }` (+ `challengeNumber` for Daily).
 */

/* ------------------------------- Generating boards ------------------------------- */

/** Same regions + dogs + pawprints = the same board. */
export function signature(p) {
    const cells = (list) => (list || []).map((c) => `${c.x},${c.y}${c.n !== undefined ? `=${c.n}` : ''}`).sort().join(';');
    return `${p.size}|${p.regions.join('/')}|${cells(p.dogs)}|${cells(p.pawprints)}`;
}

function boardFields(p) {
    const errors = validatePuzzle(p, { checkUnique: false });
    if (errors.length) throw new Error(errors[0]);
    const { difficulty, size, regions, solution, dogs = [], pawprints = [], grade = null } = p;
    return { difficulty, size, regions: [...regions], solution: [...solution], dogs, pawprints, grade };
}

/**
 * Generates `count` distinct boards for `difficulty`, yielding to the browser every few boards
 * (`onProgress(done)`) so a year of Dailies doesn't freeze the tab. `avoid` is a Set of signatures
 * already in the pool. Never throws for one bad seed -- it moves on to the next seed.
 */
export async function generateBoards(difficulty, count, { avoid = new Set(), onProgress, seedPrefix = `${Date.now()}` } = {}) {
    const boards = [];
    const seen = new Set(avoid);
    let failures = 0;
    for (let i = 0; boards.length < count && failures < count + 50; i++) {
        try {
            const puzzle = generatePuzzle({ difficulty, seed: `${seedPrefix}-${difficulty}-${i}` });
            const sig = signature(puzzle);
            if (seen.has(sig)) { failures++; continue; }
            seen.add(sig);
            boards.push(puzzle);
        } catch {
            failures++;
        }
        if (boards.length % 10 === 0) {
            onProgress?.(boards.length);
            await new Promise((r) => setTimeout(r, 0));
        }
    }
    if (boards.length < count) throw new Error(`Only ${boards.length} of ${count} boards could be generated -- try again.`);
    return boards;
}

/** Grade spread + warnings for a preview: `{ techniques: { name: count }, warnings: [...] }`. */
export function summarise(boards) {
    const techniques = {};
    const warnings = [];
    boards.forEach((b, i) => {
        techniques[b.grade?.technique || 'ungraded'] = (techniques[b.grade?.technique || 'ungraded'] || 0) + 1;
        puzzleWarnings(b).forEach((w) => warnings.push(`Board ${i + 1}: ${w}`));
    });
    return { techniques, warnings };
}

/**
 * Hand-made boards: a JSON array (or one object) of `{ difficulty, size, regions, solution, dogs?,
 * pawprints? }`, each fully validated (unique + solvable by logic). Returns one `{ puzzle, error,
 * label }` per entry so every problem is visible at once.
 */
export function boardsFromJson(text, fallbackDifficulty) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error(`That isn't valid JSON (${err.message}).`);
    }
    const list = Array.isArray(data) ? data : [data];
    return list.map((raw, i) => {
        const label = `Board ${i + 1}`;
        const puzzle = { dogs: [], pawprints: [], ...raw, difficulty: raw?.difficulty || fallbackDifficulty };
        const errors = validatePuzzle(puzzle);
        return { puzzle: errors.length ? null : puzzle, error: errors[0] || null, label };
    });
}

/** Stored boards -> the JSON import format (Download). */
export function boardsToJson(boards) {
    return JSON.stringify(boards.map(({ difficulty, size, regions, solution, dogs, pawprints }) => ({ difficulty, size, regions, solution, dogs, pawprints })), null, 2);
}

function checkNoDuplicates(boards, existing, poolName) {
    const seen = new Set();
    boards.forEach((b, i) => {
        const sig = signature(b);
        if (seen.has(sig)) throw new Error(`Board ${i + 1} appears more than once in the batch.`);
        if (existing.has(sig)) throw new Error(`Board ${i + 1} is already in the ${poolName} pool.`);
        seen.add(sig);
    });
}

/* ----------------------------------- Daily ----------------------------------- */

/** Every seeded Daily board, ordered by date (which also matches challengeNumber order). */
export async function listDailyPounceBoards() {
    const snap = await getDocs(collection(db, DAILY_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ date: d.id, ...d.data() }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Appends boards to the end of the calendar and bumps `_meta` (read by
 * pounce-daily-data.js#getTodayChallenge) -- quilt-admin.js#addDailyQuiltPuzzles()'s date-keyed,
 * add-only scheme: the very first board needs `startDate` (Challenge #1), every later one is dated
 * the day after the previous one. All-or-nothing: an invalid or duplicate board rejects the whole
 * batch before a single write.
 */
export async function addDailyPounceBoards(boards, startDate) {
    if (boards.length === 0) throw new Error('No boards to add');
    const fields = boards.map((b, i) => {
        try { return boardFields(b); } catch (err) { throw new Error(`Board ${i + 1}: ${err.message}`); }
    });
    checkNoDuplicates(fields, new Set((await listDailyPounceBoards()).map(signature)), 'Daily');

    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    if (existingTotal === 0 && !startDate) throw new Error('Pick a start date for the very first board (Challenge #1)');

    let cursorDate = existingTotal === 0 ? startDate : metaSnap.data().lastDate;
    const assignments = fields.map((f, i) => {
        const dateString = existingTotal === 0 && i === 0 ? cursorDate : addDaysToDateString(cursorDate, 1);
        cursorDate = dateString;
        return { dateString, fields: f, challengeNumber: existingTotal + i + 1 };
    });
    const firstDate = existingTotal === 0 ? assignments[0].dateString : metaSnap.data().firstDate;
    const lastDate = assignments[assignments.length - 1].dateString;

    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ dateString, fields: f, challengeNumber }) => {
            batch.set(doc(db, DAILY_COLLECTION, dateString), { challengeNumber, ...f, createdAt: serverTimestamp() });
        });
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount: existingTotal + assignments.length, firstDate, lastDate, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }
    return { count: assignments.length, firstDate: assignments[0].dateString, lastDate };
}

/** Swaps a Daily board for a freshly generated one; its date and number never change. */
export async function regenerateDailyPounceBoard(date) {
    const existing = new Set((await listDailyPounceBoards()).map(signature));
    const [board] = await generateBoards(DAILY_DIFFICULTY, 1, { avoid: existing, seedPrefix: `regen-${date}-${Date.now()}` });
    await setDoc(doc(db, DAILY_COLLECTION, date), { ...boardFields(board), updatedAt: serverTimestamp() }, { merge: true });
}

/* ----------------------------------- Classic ----------------------------------- */

/** Every Classic board across all difficulties, by numeric id. */
export async function listClassicPounceBoards() {
    const snap = await getDocs(collection(db, CLASSIC_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (Number(a.id) - Number(b.id)) || a.id.localeCompare(b.id));
}

/** Appends Classic boards under one shared numeric id counter (`_meta.totalCount`), all-or-nothing. */
export async function addClassicPounceBoards(boards) {
    if (boards.length === 0) throw new Error('No boards to add');
    const fields = boards.map((b, i) => {
        try { return boardFields(b); } catch (err) { throw new Error(`Board ${i + 1}: ${err.message}`); }
    });
    checkNoDuplicates(fields, new Set((await listClassicPounceBoards()).map(signature)), 'Classic');

    const metaRef = doc(db, CLASSIC_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;

    const assignments = fields.map((f, i) => ({ id: existingTotal + i + 1, fields: f }));
    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ id, fields: f }) => batch.set(doc(db, CLASSIC_COLLECTION, String(id)), { ...f, createdAt: serverTimestamp() }));
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount: existingTotal + assignments.length, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }
    return { count: assignments.length };
}

/** Swaps a Classic board for a freshly generated one of the same difficulty, keeping its id. */
export async function regenerateClassicPounceBoard(id, difficulty) {
    const existing = new Set((await listClassicPounceBoards()).map(signature));
    const [board] = await generateBoards(difficulty, 1, { avoid: existing, seedPrefix: `regen-${id}-${Date.now()}` });
    await setDoc(doc(db, CLASSIC_COLLECTION, String(id)), { ...boardFields(board), updatedAt: serverTimestamp() }, { merge: true });
}

/** Removes a Classic board (players who solved it keep their points; it just stops being served). */
export async function deleteClassicPounceBoard(id) {
    await deleteDoc(doc(db, CLASSIC_COLLECTION, String(id)));
}

/* --------------------------------- Nine Lives Runs --------------------------------- */

/** All Nine Lives Runs (active and inactive), newest first (bulk-created runs keep their order). */
export async function listPounceTournaments() {
    const snap = await getDocs(collection(db, TOURNAMENTS_COLLECTION));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => ((b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)) || ((a.importOrder ?? 0) - (b.importOrder ?? 0)));
}

/** Builds a run's 5 boards (pounce-generator.js#buildRun, sizes 5→9) for preview. */
export function prepareRun(seed = `${Date.now()}`) {
    return buildRun({ seed });
}

/**
 * Creates runs: `runs` is `[{ name, boards }]` (each from prepareRun()), all sharing
 * `completionBonus` and starting `active` or not. All-or-nothing; written in batches.
 */
export async function createPounceTournaments(runs, { completionBonus, active }) {
    if (runs.length === 0) throw new Error('No runs to create');
    if (!(completionBonus >= 0)) throw new Error('Completion bonus must be 0 or more.');
    runs.forEach(({ name, boards }) => {
        if (!name.trim()) throw new Error('Every run needs a name.');
        if (boards.length !== RUN_BOARDS.length) throw new Error(`${name}: a run needs ${RUN_BOARDS.length} boards.`);
    });
    for (let i = 0; i < runs.length; i += BATCH_LIMIT - 1) {
        const batch = writeBatch(db);
        runs.slice(i, i + BATCH_LIMIT - 1).forEach(({ name, boards }, j) => {
            batch.set(doc(collection(db, TOURNAMENTS_COLLECTION)), {
                name: name.trim(),
                boards: boards.map((b, k) => {
                    try { return boardFields(b); } catch (err) { throw new Error(`${name} board ${k + 1}: ${err.message}`); }
                }),
                completionBonus,
                active,
                importOrder: i + j, // same createdAt for a whole batch, so keep the order explicitly
                createdAt: serverTimestamp(),
            });
        });
        await batch.commit();
    }
    return { count: runs.length };
}

export async function setPounceTournamentActive(id, active) {
    await updateDoc(doc(db, TOURNAMENTS_COLLECTION, id), { active });
}

export async function deletePounceTournament(id) {
    await deleteDoc(doc(db, TOURNAMENTS_COLLECTION, id));
}
