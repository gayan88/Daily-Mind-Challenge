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
import { DAILY_MODE, CLASSIC_MODES, TOURNAMENT_MODE, WORD_MIN_LENGTH, WORD_MAX_LENGTH } from '../games/wordsearch/wordsearch-modes.js';

const DAILY_COLLECTION = 'wordsearchDailyPuzzles';
const CLASSIC_COLLECTION = 'wordsearchClassicPuzzles';
const TOURNAMENTS_COLLECTION = 'wordsearchTournaments';
const DIFFICULTIES = ['easy', 'medium', 'hard'];
// Firestore caps a single batch at 500 writes -- leave one slot per batch for the trailing _meta
// update, so a batch of puzzles never has to be split awkwardly around it.
const BATCH_LIMIT = 500;

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

/** A puzzle's "identity" for duplicate-checking purposes is its set of words, not their order or
 * its theme -- two puzzles with the same 10 words (just listed in a different order, or with a
 * different theme label) are the same puzzle as far as a player's concerned. */
function wordSetSignature(words) {
    return words.map((w) => w.trim().toUpperCase()).sort().join('|');
}

/** Lists every seeded Daily Challenge puzzle, ordered by date (which also matches
 * challengeNumber order, since dates are only ever assigned going forward -- see
 * addDailyWordsearchPuzzle()). */
export async function listDailyWordsearchPuzzles() {
    const snap = await getDocs(collection(db, DAILY_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ date: d.id, ...d.data() }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Appends a new puzzle to the end of the calendar and bumps `_meta`, which
 * `wordsearch-daily-data.js#getTodayChallenge()` reads to resolve today's puzzle with a single
 * getDoc keyed directly by date -- same date-keyed scheme as wordle-admin.js#addDailyWord(), see
 * its own doc comment for the full rationale. The very first puzzle (empty pool) requires
 * `startDate` (the admin's chosen launch date, becoming Challenge #1); every puzzle after that
 * ignores `startDate` and is automatically dated one day after the previous puzzle's date.
 * Rejects a puzzle whose word set (see wordSetSignature()) already matches one in the pool.
 */
export async function addDailyWordsearchPuzzle({ theme, words }, startDate) {
    const error = validateWordList(words, { minCount: DAILY_MODE.wordCount, maxCount: DAILY_MODE.wordCount });
    if (error) throw new Error(error);

    const signature = wordSetSignature(words);
    const existing = await listDailyWordsearchPuzzles();
    if (existing.some((p) => wordSetSignature(p.words) === signature)) {
        throw new Error('A puzzle with this exact set of words is already in the Daily Puzzles pool.');
    }

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
        theme: theme ? theme.trim() : '',
        words: words.map((w) => w.trim().toUpperCase()),
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
 * Bulk version of addDailyWordsearchPuzzle() for CSV import -- takes a plain list of `{theme,
 * words}` entries (no dates; dates are assigned the exact same way addDailyWordsearchPuzzle()
 * would) and writes them all in as few Firestore batches as possible -- see
 * wordle-admin.js#bulkAddDailyWords() for the full rationale on chunking/atomicity. Rejects the
 * whole import up front (before any write) if the same word set (see wordSetSignature()) repeats
 * within the file, or if any puzzle's word set is already somewhere in the existing pool.
 */
export async function bulkAddDailyWordsearchPuzzles(rawEntries, startDate) {
    const metaRef = doc(db, DAILY_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    const existingFirstDate = metaSnap.exists() ? metaSnap.data().firstDate : null;
    const existingLastDate = metaSnap.exists() ? metaSnap.data().lastDate : null;

    if (rawEntries.length === 0) throw new Error('No puzzles to import');
    rawEntries.forEach(({ words }, i) => {
        const error = validateWordList(words, { minCount: DAILY_MODE.wordCount, maxCount: DAILY_MODE.wordCount });
        if (error) throw new Error(`Row ${i + 1}: ${error}`);
    });

    const seenInFile = new Set();
    let dupInFileIndex = -1;
    rawEntries.forEach(({ words }, i) => {
        if (dupInFileIndex !== -1) return;
        const signature = wordSetSignature(words);
        if (seenInFile.has(signature)) { dupInFileIndex = i; return; }
        seenInFile.add(signature);
    });
    if (dupInFileIndex !== -1) throw new Error(`Row ${dupInFileIndex + 1}: this exact set of words appears more than once in the file.`);

    const existingSignatures = new Set((await listDailyWordsearchPuzzles()).map((p) => wordSetSignature(p.words)));
    const dupInPool = rawEntries.findIndex(({ words }) => existingSignatures.has(wordSetSignature(words)));
    if (dupInPool !== -1) throw new Error(`Row ${dupInPool + 1}: this exact set of words is already in the Daily Puzzles pool.`);

    if (existingTotal === 0 && !startDate) {
        throw new Error('Pick a start date for the very first puzzle (Challenge #1)');
    }

    const assignments = [];
    let cursorDate = existingTotal === 0 ? startDate : existingLastDate;
    rawEntries.forEach(({ theme, words }, i) => {
        const dateString = existingTotal === 0 && i === 0 ? cursorDate : addDaysToDateString(cursorDate, 1);
        cursorDate = dateString;
        assignments.push({
            dateString,
            theme: theme ? theme.trim() : '',
            words: words.map((w) => w.trim().toUpperCase()),
            challengeNumber: existingTotal + i + 1,
        });
    });

    const firstDate = existingTotal === 0 ? assignments[0].dateString : existingFirstDate;
    const lastDate = assignments[assignments.length - 1].dateString;
    const totalCount = existingTotal + assignments.length;

    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ dateString, theme, words, challengeNumber }) => {
            batch.set(doc(db, DAILY_COLLECTION, dateString), { challengeNumber, theme, words, createdAt: serverTimestamp() });
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
async function renumberDailyWordsearchPuzzles() {
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
export async function updateDailyWordsearchPuzzle(currentDate, { theme, words, date }) {
    const error = validateWordList(words, { minCount: DAILY_MODE.wordCount, maxCount: DAILY_MODE.wordCount });
    if (error) throw new Error(error);

    const cleanTheme = theme ? theme.trim() : '';
    const cleanWords = words.map((w) => w.trim().toUpperCase());

    if (date && date !== currentDate) {
        const targetSnap = await getDoc(doc(db, DAILY_COLLECTION, date));
        if (targetSnap.exists()) throw new Error(`Another puzzle is already dated ${date}`);
        await deleteDoc(doc(db, DAILY_COLLECTION, currentDate));
        await setDoc(doc(db, DAILY_COLLECTION, date), { theme: cleanTheme, words: cleanWords, createdAt: serverTimestamp() });
    } else {
        await setDoc(
            doc(db, DAILY_COLLECTION, currentDate),
            { theme: cleanTheme, words: cleanWords, updatedAt: serverTimestamp() },
            { merge: true }
        );
    }
    await renumberDailyWordsearchPuzzles();
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
 * `difficulty` is just a field on the doc, not a separate sequence). Rejects a puzzle whose word
 * set already matches one in that same difficulty's pool -- see wordSetSignature(); a duplicate
 * across two *different* difficulties is fine, since each difficulty's pool is picked from
 * independently. */
export async function addClassicWordsearchPuzzle({ theme, words, difficulty }) {
    if (!isValidDifficulty(difficulty)) throw new Error('Difficulty must be easy, medium, or hard.');
    const wordCount = CLASSIC_MODES[difficulty].wordCount;
    const error = validateWordList(words, { minCount: wordCount, maxCount: wordCount });
    if (error) throw new Error(error);

    const signature = wordSetSignature(words);
    const existing = await listClassicWordsearchPuzzles();
    if (existing.some((p) => p.difficulty === difficulty && wordSetSignature(p.words) === signature)) {
        throw new Error(`A puzzle with this exact set of words is already in the ${difficulty} pool.`);
    }

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

/**
 * Bulk version of addClassicWordsearchPuzzle() for CSV import -- takes a plain list of
 * `{theme, words, difficulty}` entries and appends them all under the same shared numeric id
 * counter, written via chunked writeBatch() -- see wordle-admin.js#bulkAddDailyWords() for the
 * full rationale on chunking/atomicity. Rejects the whole import, before any write, if the same
 * word set (see wordSetSignature()) repeats within the file or already exists in the pool, both
 * scoped per difficulty (same reasoning as addClassicWordsearchPuzzle()'s own duplicate check).
 */
export async function bulkAddClassicWordsearchPuzzles(rawEntries) {
    if (rawEntries.length === 0) throw new Error('No puzzles to import');
    rawEntries.forEach(({ words, difficulty }, i) => {
        if (!isValidDifficulty(difficulty)) throw new Error(`Row ${i + 1}: difficulty must be easy, medium, or hard.`);
        const wordCount = CLASSIC_MODES[difficulty].wordCount;
        const error = validateWordList(words, { minCount: wordCount, maxCount: wordCount });
        if (error) throw new Error(`Row ${i + 1}: ${error}`);
    });

    const seenInFile = new Map(); // difficulty -> Set(signature)
    let dupInFileIndex = -1;
    rawEntries.forEach(({ words, difficulty }, i) => {
        if (dupInFileIndex !== -1) return;
        const signature = wordSetSignature(words);
        if (!seenInFile.has(difficulty)) seenInFile.set(difficulty, new Set());
        const seen = seenInFile.get(difficulty);
        if (seen.has(signature)) { dupInFileIndex = i; return; }
        seen.add(signature);
    });
    if (dupInFileIndex !== -1) throw new Error(`Row ${dupInFileIndex + 1}: this exact set of words appears more than once in the file for that difficulty.`);

    const existing = await listClassicWordsearchPuzzles();
    const existingByDifficulty = new Map();
    existing.forEach((p) => {
        const signature = wordSetSignature(p.words);
        if (!existingByDifficulty.has(p.difficulty)) existingByDifficulty.set(p.difficulty, new Set());
        existingByDifficulty.get(p.difficulty).add(signature);
    });
    const dupInPool = rawEntries.findIndex(({ words, difficulty }) => existingByDifficulty.get(difficulty)?.has(wordSetSignature(words)));
    if (dupInPool !== -1) throw new Error(`Row ${dupInPool + 1}: this exact set of words is already in the ${rawEntries[dupInPool].difficulty} pool.`);

    const metaRef = doc(db, CLASSIC_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;

    const assignments = rawEntries.map(({ theme, words, difficulty }, i) => ({
        id: existingTotal + i + 1,
        theme: theme ? theme.trim() : '',
        words: words.map((w) => w.trim().toUpperCase()),
        difficulty,
    }));

    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ id, theme, words, difficulty }) => {
            batch.set(doc(db, CLASSIC_COLLECTION, String(id)), { theme, words, difficulty, createdAt: serverTimestamp() });
        });
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount: existingTotal + assignments.length, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }

    return { count: assignments.length };
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
