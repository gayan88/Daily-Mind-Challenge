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

const DAILY_COLLECTION = 'sudokuDailyPuzzles';
const CLASSIC_COLLECTION = 'sudokuClassicPuzzles';
const TOURNAMENTS_COLLECTION = 'sudokuTournaments';
const DIFFICULTIES = ['easy', 'medium', 'hard'];
// Firestore caps a single batch at 500 writes -- leave one slot per batch for the trailing _meta
// update, so a batch of puzzles never has to be split awkwardly around it.
const BATCH_LIMIT = 500;

function isValidPuzzleString(s) {
    return typeof s === 'string' && /^[0-9]{81}$/.test(s);
}

/** A completed grid must be 81 digits 1-9 with every row/column/3x3 box containing each digit
 * exactly once -- a cheap, valuable sanity check even though it can't catch every malformed
 * puzzle (e.g. a puzzle with more than one valid solution isn't detectable this way). */
function isValidCompletedGrid(s) {
    if (typeof s !== 'string' || !/^[1-9]{81}$/.test(s)) return false;
    const hasAllNine = (values) => new Set(values).size === 9;

    for (let r = 0; r < 9; r++) {
        if (!hasAllNine(s.slice(r * 9, r * 9 + 9).split(''))) return false;
    }
    for (let c = 0; c < 9; c++) {
        const col = [];
        for (let r = 0; r < 9; r++) col.push(s[r * 9 + c]);
        if (!hasAllNine(col)) return false;
    }
    for (let boxRow = 0; boxRow < 3; boxRow++) {
        for (let boxCol = 0; boxCol < 3; boxCol++) {
            const box = [];
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 3; c++) {
                    box.push(s[(boxRow * 3 + r) * 9 + (boxCol * 3 + c)]);
                }
            }
            if (!hasAllNine(box)) return false;
        }
    }
    return true;
}

function puzzleMatchesSolution(puzzle, solution) {
    for (let i = 0; i < 81; i++) {
        if (puzzle[i] !== '0' && puzzle[i] !== solution[i]) return false;
    }
    return true;
}

/** Returns an error message string if the pair is invalid, or null if it's good to save --
 * there's no way to hand-verify an 81-character string visually, so every write goes through
 * this first. */
export function validateSudokuPuzzlePair(puzzle, solution) {
    if (!isValidPuzzleString(puzzle)) return 'Puzzle must be exactly 81 digits (0 = blank).';
    if (!isValidCompletedGrid(solution)) return 'Solution must be exactly 81 digits (1-9) forming a valid completed Sudoku grid.';
    if (!puzzleMatchesSolution(puzzle, solution)) return "The puzzle's given cells don't match the solution.";
    return null;
}

/** Lists every seeded Daily Challenge puzzle, ordered by date (which also matches
 * challengeNumber order, since dates are only ever assigned going forward -- see
 * addDailySudokuPuzzle()). */
export async function listDailySudokuPuzzles() {
    const snap = await getDocs(collection(db, DAILY_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ date: d.id, ...d.data() }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Appends a new puzzle to the end of the calendar and bumps `_meta`, which
 * `sudoku-daily-data.js#getTodayChallenge()` reads to resolve today's puzzle with a single getDoc
 * keyed directly by date -- same date-keyed scheme as wordle-admin.js#addDailyWord(), see its own
 * doc comment for the full rationale. The very first puzzle (empty pool) requires `startDate`
 * (the admin's chosen launch date, becoming Challenge #1); every puzzle after that ignores
 * `startDate` and is automatically dated one day after the previous puzzle's date.
 */
export async function addDailySudokuPuzzle(puzzle, solution, startDate) {
    const error = validateSudokuPuzzlePair(puzzle, solution);
    if (error) throw new Error(error);

    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;

    let dateString;
    if (totalCount === 0) {
        if (!startDate) throw new Error('Pick a start date for the very first puzzle (Challenge #1)');
        dateString = startDate;
    } else {
        dateString = addDaysToDateString(metaSnap.data().lastDate, 1);
    }

    const challengeNumber = totalCount + 1;
    await setDoc(doc(db, DAILY_COLLECTION, dateString), {
        challengeNumber,
        puzzle,
        solution,
        createdAt: serverTimestamp(),
    });
    await setDoc(metaRef, {
        totalCount: challengeNumber,
        firstDate: totalCount === 0 ? dateString : metaSnap.data().firstDate,
        lastDate: dateString,
        updatedAt: serverTimestamp(),
    });
    return { date: dateString, challengeNumber };
}

/**
 * Bulk version of addDailySudokuPuzzle() for CSV import -- takes a plain list of `{puzzle,
 * solution}` pairs (no dates; dates are assigned the exact same way addDailySudokuPuzzle() would)
 * and writes them all in as few Firestore batches as possible -- see
 * wordle-admin.js#bulkAddDailyWords() for the full rationale on chunking/atomicity.
 */
export async function bulkAddDailySudokuPuzzles(rawPairs, startDate) {
    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    const existingFirstDate = metaSnap.exists() ? metaSnap.data().firstDate : null;
    const existingLastDate = metaSnap.exists() ? metaSnap.data().lastDate : null;

    if (rawPairs.length === 0) throw new Error('No puzzles to import');
    rawPairs.forEach(({ puzzle, solution }, i) => {
        const error = validateSudokuPuzzlePair(puzzle, solution);
        if (error) throw new Error(`Row ${i + 1}: ${error}`);
    });
    if (existingTotal === 0 && !startDate) {
        throw new Error('Pick a start date for the very first puzzle (Challenge #1)');
    }

    const assignments = [];
    let cursorDate = existingTotal === 0 ? startDate : existingLastDate;
    rawPairs.forEach(({ puzzle, solution }, i) => {
        const dateString = existingTotal === 0 && i === 0 ? cursorDate : addDaysToDateString(cursorDate, 1);
        cursorDate = dateString;
        assignments.push({ dateString, puzzle, solution, challengeNumber: existingTotal + i + 1 });
    });

    const firstDate = existingTotal === 0 ? assignments[0].dateString : existingFirstDate;
    const lastDate = assignments[assignments.length - 1].dateString;
    const totalCount = existingTotal + assignments.length;

    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ dateString, puzzle, solution, challengeNumber }) => {
            batch.set(doc(db, DAILY_COLLECTION, dateString), { challengeNumber, puzzle, solution, createdAt: serverTimestamp() });
        });
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount, firstDate, lastDate, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }

    return { count: assignments.length, firstDate: assignments[0].dateString, lastDate };
}

/**
 * Recomputes every puzzle's challengeNumber (sorted by date) and _meta's totalCount/firstDate/
 * lastDate from scratch. Called after editing a puzzle's date -- see
 * wordle-admin.js#renumberDailyWords() for the full rationale. Deliberately no delete for
 * individual daily puzzles, same reasoning as Wordle's Daily Words: removing one from the middle
 * would leave a permanent gap on that date, since new puzzles only ever get appended after
 * `_meta.lastDate`, never backfilled.
 */
async function renumberDailySudokuPuzzles() {
    const snap = await getDocs(collection(db, DAILY_COLLECTION));
    const puzzles = snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ date: d.id, challengeNumber: d.data().challengeNumber }))
        .sort((a, b) => a.date.localeCompare(b.date));

    await Promise.all(puzzles.map((p, i) => {
        const correctNumber = i + 1;
        if (p.challengeNumber === correctNumber) return null;
        return setDoc(doc(db, DAILY_COLLECTION, p.date), { challengeNumber: correctNumber }, { merge: true });
    }));

    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    await setDoc(metaRef, {
        totalCount: puzzles.length,
        firstDate: puzzles.length ? puzzles[0].date : null,
        lastDate: puzzles.length ? puzzles[puzzles.length - 1].date : null,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Corrects an already-seeded puzzle's content and/or date. Changing the date moves it to a new
 * doc (Firestore doc ids can't be renamed in place) -- deletes the old doc, writes a new one
 * under the new date, then renumbers everything -- see wordle-admin.js#updateDailyWord() for the
 * full rationale, including how this doubles as the repair path for malformed/legacy entries.
 */
export async function updateDailySudokuPuzzle(currentDate, { puzzle, solution, date }) {
    const error = validateSudokuPuzzlePair(puzzle, solution);
    if (error) throw new Error(error);

    if (date && date !== currentDate) {
        const targetSnap = await getDoc(doc(db, DAILY_COLLECTION, date));
        if (targetSnap.exists()) throw new Error(`Another puzzle is already dated ${date}`);
        await deleteDoc(doc(db, DAILY_COLLECTION, currentDate));
        await setDoc(doc(db, DAILY_COLLECTION, date), { puzzle, solution, createdAt: serverTimestamp() });
    } else {
        await setDoc(
            doc(db, DAILY_COLLECTION, currentDate),
            { puzzle, solution, updatedAt: serverTimestamp() },
            { merge: true }
        );
    }
    await renumberDailySudokuPuzzles();
}

function isValidDifficulty(difficulty) {
    return DIFFICULTIES.includes(difficulty);
}

/** Lists every seeded Classic puzzle across all three difficulties, ordered by its numeric id --
 * unlike Daily, the id order carries no meaning (a random puzzle per difficulty is served, not a
 * by-date pick), it's just a stable admin-table sort. */
export async function listClassicSudokuPuzzles() {
    const snap = await getDocs(collection(db, CLASSIC_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ id: Number(d.id), ...d.data() }))
        .sort((a, b) => a.id - b.id);
}

/** Appends a new puzzle (next numeric id, one counter shared across all three difficulties --
 * `difficulty` is just a field on the doc, not a separate sequence). */
export async function addClassicSudokuPuzzle(puzzle, solution, difficulty) {
    const error = validateSudokuPuzzlePair(puzzle, solution);
    if (error) throw new Error(error);
    if (!isValidDifficulty(difficulty)) throw new Error('Difficulty must be easy, medium, or hard.');

    const metaRef = doc(db, CLASSIC_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    const nextId = totalCount + 1;

    await setDoc(doc(db, CLASSIC_COLLECTION, String(nextId)), {
        puzzle,
        solution,
        difficulty,
        createdAt: serverTimestamp(),
    });
    await setDoc(metaRef, { totalCount: nextId, updatedAt: serverTimestamp() });
    return nextId;
}

/** Corrects an already-seeded puzzle's content or difficulty without changing its position/id. */
export async function updateClassicSudokuPuzzle(id, puzzle, solution, difficulty) {
    const error = validateSudokuPuzzlePair(puzzle, solution);
    if (error) throw new Error(error);
    if (!isValidDifficulty(difficulty)) throw new Error('Difficulty must be easy, medium, or hard.');

    await setDoc(
        doc(db, CLASSIC_COLLECTION, String(id)),
        { puzzle, solution, difficulty, updatedAt: serverTimestamp() },
        { merge: true }
    );
}

/** Lists all Sudoku tournaments (active and inactive), newest first. */
export async function listSudokuTournaments() {
    const snap = await getDocs(collection(db, TOURNAMENTS_COLLECTION));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

/**
 * Creates a new tournament, active by default. `puzzles` is an array of { puzzle, solution }
 * pairs, each validated the same way as Daily/Classic puzzles. `completionBonus` is set per
 * tournament (like Wordle Tournament's `bonusPoints`); time limit and max errors per puzzle stay
 * global -- see config/sudokuTournamentSettings, applied to every tournament (edited via the
 * generic config form, not this admin section).
 */
export async function createSudokuTournament({ name, puzzles, completionBonus }) {
    if (puzzles.length === 0) throw new Error('Add at least one puzzle.');
    puzzles.forEach(({ puzzle, solution }, i) => {
        const error = validateSudokuPuzzlePair(puzzle, solution);
        if (error) throw new Error(`Puzzle ${i + 1}: ${error}`);
    });

    const ref = doc(collection(db, TOURNAMENTS_COLLECTION));
    await setDoc(ref, {
        name: name.trim(),
        puzzles,
        completionBonus,
        active: true,
        createdAt: serverTimestamp(),
    });
    return ref.id;
}

/** Toggles a tournament's visibility to players without deleting its data/history. */
export async function setSudokuTournamentActive(id, active) {
    await updateDoc(doc(db, TOURNAMENTS_COLLECTION, id), { active });
}

export async function deleteSudokuTournament(id) {
    await deleteDoc(doc(db, TOURNAMENTS_COLLECTION, id));
}
