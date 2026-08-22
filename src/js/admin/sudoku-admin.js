import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    collection,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';

const DAILY_COLLECTION = 'sudokuDailyPuzzles';
const CLASSIC_COLLECTION = 'sudokuClassicPuzzles';
const TOURNAMENTS_COLLECTION = 'sudokuTournaments';
const DIFFICULTIES = ['easy', 'medium', 'hard'];

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

/** Lists every seeded Daily Challenge puzzle, ordered by its numeric id (1, 2, 3, ...). */
export async function listDailySudokuPuzzles() {
    const snap = await getDocs(collection(db, DAILY_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ id: Number(d.id), ...d.data() }))
        .sort((a, b) => a.id - b.id);
}

/**
 * Appends a new puzzle to the end of the pool (next numeric id) and bumps `_meta.totalCount`,
 * which `sudoku-daily-data.js#getTodayChallenge()` reads to resolve today's puzzle with a
 * single getDoc. Append-only by design -- reordering/removing earlier entries would shift which
 * puzzle lands on which past/future date for players already mid-streak.
 */
export async function addDailySudokuPuzzle(puzzle, solution) {
    const error = validateSudokuPuzzlePair(puzzle, solution);
    if (error) throw new Error(error);

    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    const nextId = totalCount + 1;

    await setDoc(doc(db, DAILY_COLLECTION, String(nextId)), {
        puzzle,
        solution,
        createdAt: serverTimestamp(),
    });
    await setDoc(metaRef, { totalCount: nextId, updatedAt: serverTimestamp() });
    return nextId;
}

/** Corrects an already-seeded puzzle's content without changing its position/id. */
export async function updateDailySudokuPuzzle(id, puzzle, solution) {
    const error = validateSudokuPuzzlePair(puzzle, solution);
    if (error) throw new Error(error);

    await setDoc(
        doc(db, DAILY_COLLECTION, String(id)),
        { puzzle, solution, updatedAt: serverTimestamp() },
        { merge: true }
    );
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
