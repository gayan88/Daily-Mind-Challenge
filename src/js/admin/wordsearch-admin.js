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
import { DAILY_MODE, CLASSIC_MODES, TOURNAMENT_MODE, WORD_MIN_LENGTH, WORD_MAX_LENGTH } from '../games/wordsearch/wordsearch-modes.js';

const DAILY_COLLECTION = 'wordsearchDailyPuzzles';
const CLASSIC_COLLECTION = 'wordsearchClassicPuzzles';
const TOURNAMENTS_COLLECTION = 'wordsearchTournaments';
const DIFFICULTIES = ['easy', 'medium', 'hard'];

/**
 * Returns an error message string if the word list is invalid, or null if it's good to save.
 * Checks (in order): word count matches the mode's requirement, every word is alphabetic and
 * 4-9 letters, and no word is a substring of another word in the same list (case-insensitive,
 * either direction) -- a genuine correctness requirement, not a nicety: the engine's selection
 * matching checks both the forward and reversed letter string against every remaining word, so a
 * substring pair (e.g. "CAT"/"CATFISH") would make a single drag ambiguously satisfy two words.
 */
export function validateWordList(words, { minCount, maxCount } = {}) {
    if (!Array.isArray(words) || words.length === 0) return 'Enter at least one word.';
    if (minCount != null && maxCount != null && minCount === maxCount && words.length !== minCount) {
        return `Enter exactly ${minCount} words (got ${words.length}).`;
    }
    if (minCount != null && words.length < minCount) return `Enter at least ${minCount} words (got ${words.length}).`;
    if (maxCount != null && words.length > maxCount) return `Enter at most ${maxCount} words (got ${words.length}).`;

    const upper = words.map((w) => w.trim().toUpperCase());
    for (const word of upper) {
        if (!/^[A-Z]+$/.test(word)) return `"${word}" must contain letters only.`;
        if (word.length < WORD_MIN_LENGTH || word.length > WORD_MAX_LENGTH) {
            return `"${word}" must be ${WORD_MIN_LENGTH}-${WORD_MAX_LENGTH} letters long.`;
        }
    }

    for (let i = 0; i < upper.length; i++) {
        for (let j = 0; j < upper.length; j++) {
            if (i === j) continue;
            if (upper[i].includes(upper[j])) {
                return `"${upper[j]}" can't be a substring of "${upper[i]}" -- the game can't tell them apart.`;
            }
        }
    }

    return null;
}

function isValidDifficulty(difficulty) {
    return DIFFICULTIES.includes(difficulty);
}

/** Lists every seeded Daily Challenge puzzle, ordered by its numeric id (1, 2, 3, ...). */
export async function listDailyWordsearchPuzzles() {
    const snap = await getDocs(collection(db, DAILY_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ id: Number(d.id), ...d.data() }))
        .sort((a, b) => a.id - b.id);
}

/**
 * Appends a new puzzle to the end of the pool (next numeric id) and bumps `_meta.totalCount`,
 * which `wordsearch-daily-data.js#getTodayChallenge()` reads to resolve today's puzzle with a
 * single getDoc. Append-only by design -- reordering/removing earlier entries would shift which
 * puzzle lands on which past/future date for players already mid-streak.
 */
export async function addDailyWordsearchPuzzle({ theme, words }) {
    const error = validateWordList(words, { minCount: DAILY_MODE.wordCount, maxCount: DAILY_MODE.wordCount });
    if (error) throw new Error(error);

    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    const nextId = totalCount + 1;

    await setDoc(doc(db, DAILY_COLLECTION, String(nextId)), {
        theme: theme ? theme.trim() : '',
        words: words.map((w) => w.trim().toUpperCase()),
        createdAt: serverTimestamp(),
    });
    await setDoc(metaRef, { totalCount: nextId, updatedAt: serverTimestamp() });
    return nextId;
}

/** Corrects an already-seeded puzzle's content without changing its position/id. */
export async function updateDailyWordsearchPuzzle(id, { theme, words }) {
    const error = validateWordList(words, { minCount: DAILY_MODE.wordCount, maxCount: DAILY_MODE.wordCount });
    if (error) throw new Error(error);

    await setDoc(
        doc(db, DAILY_COLLECTION, String(id)),
        { theme: theme ? theme.trim() : '', words: words.map((w) => w.trim().toUpperCase()), updatedAt: serverTimestamp() },
        { merge: true }
    );
}

/** Lists every seeded Classic puzzle across all three difficulties, ordered by its numeric id --
 * the id order carries no meaning (a random puzzle per difficulty is served), it's just a stable
 * admin-table sort. */
export async function listClassicWordsearchPuzzles() {
    const snap = await getDocs(collection(db, CLASSIC_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ id: Number(d.id), ...d.data() }))
        .sort((a, b) => a.id - b.id);
}

/** Appends a new puzzle (next numeric id, one counter shared across all three difficulties --
 * `difficulty` is just a field on the doc, not a separate sequence). */
export async function addClassicWordsearchPuzzle({ theme, words, difficulty }) {
    if (!isValidDifficulty(difficulty)) throw new Error('Difficulty must be easy, medium, or hard.');
    const wordCount = CLASSIC_MODES[difficulty].wordCount;
    const error = validateWordList(words, { minCount: wordCount, maxCount: wordCount });
    if (error) throw new Error(error);

    const metaRef = doc(db, CLASSIC_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    const nextId = totalCount + 1;

    await setDoc(doc(db, CLASSIC_COLLECTION, String(nextId)), {
        theme: theme ? theme.trim() : '',
        words: words.map((w) => w.trim().toUpperCase()),
        difficulty,
        createdAt: serverTimestamp(),
    });
    await setDoc(metaRef, { totalCount: nextId, updatedAt: serverTimestamp() });
    return nextId;
}

/** Corrects an already-seeded puzzle's content or difficulty without changing its position/id. */
export async function updateClassicWordsearchPuzzle(id, { theme, words, difficulty }) {
    if (!isValidDifficulty(difficulty)) throw new Error('Difficulty must be easy, medium, or hard.');
    const wordCount = CLASSIC_MODES[difficulty].wordCount;
    const error = validateWordList(words, { minCount: wordCount, maxCount: wordCount });
    if (error) throw new Error(error);

    await setDoc(
        doc(db, CLASSIC_COLLECTION, String(id)),
        { theme: theme ? theme.trim() : '', words: words.map((w) => w.trim().toUpperCase()), difficulty, updatedAt: serverTimestamp() },
        { merge: true }
    );
}

/** Lists all Word Search tournaments (active and inactive), newest first. */
export async function listWordsearchTournaments() {
    const snap = await getDocs(collection(db, TOURNAMENTS_COLLECTION));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

/**
 * Creates a new tournament, active by default. `puzzles` is an array of `{ words: string[] }`
 * entries, each validated the same way as Daily/Classic puzzles. `completionBonus` is set per
 * tournament (like Wordle/Sudoku Tournament's bonus); puzzle count, time limit, and
 * completed/failed points stay global -- see config/wordsearchTournamentSettings.
 */
export async function createWordsearchTournament({ name, puzzles, completionBonus }) {
    if (puzzles.length === 0) throw new Error('Add at least one puzzle.');
    puzzles.forEach(({ words }, i) => {
        const error = validateWordList(words, { minCount: TOURNAMENT_MODE.wordCount, maxCount: TOURNAMENT_MODE.wordCount });
        if (error) throw new Error(`Puzzle ${i + 1}: ${error}`);
    });

    const ref = doc(collection(db, TOURNAMENTS_COLLECTION));
    await setDoc(ref, {
        name: name.trim(),
        puzzles: puzzles.map(({ words }) => ({ words: words.map((w) => w.trim().toUpperCase()) })),
        completionBonus,
        active: true,
        createdAt: serverTimestamp(),
    });
    return ref.id;
}

/** Toggles a tournament's visibility to players without deleting its data/history. */
export async function setWordsearchTournamentActive(id, active) {
    await updateDoc(doc(db, TOURNAMENTS_COLLECTION, id), { active });
}

export async function deleteWordsearchTournament(id) {
    await deleteDoc(doc(db, TOURNAMENTS_COLLECTION, id));
}
