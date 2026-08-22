import {
    collection,
    doc,
    getDocs,
    setDoc,
    query,
    where,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { formatDuration } from '../../utils/helpers.js';
import { timeBonus, errorBonus } from './sudoku-daily-data.js';

const PUZZLES_COLLECTION = 'sudokuClassicPuzzles';

const COMPLETION_POINTS = { easy: 10, medium: 15, hard: 25 };

/**
 * Serves a random puzzle for the given difficulty from the admin-managed pool (see
 * src/js/admin/sudoku-admin.js) -- unlike Daily Challenge's deterministic-by-date pick, Classic
 * has no "today's puzzle" concept, so every difficulty's puzzles are fetched and one is chosen
 * client-side. Returns null if none are seeded yet for that difficulty.
 */
export async function getRandomClassicPuzzle(difficulty) {
    const q = query(collection(db, PUZZLES_COLLECTION), where('difficulty', '==', difficulty));
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const chosen = snap.docs[Math.floor(Math.random() * snap.docs.length)];
    const { puzzle, solution } = chosen.data();
    return { puzzleId: chosen.id, puzzle, solution, difficulty };
}

/**
 * Writes one Classic Sudoku round's result: a completion score by difficulty (10/15/25) plus the
 * same time/error bonuses as Daily Challenge (reused from sudoku-daily-data.js, since the spec
 * defines them identically for both modes). Unlike Daily Challenge -- one scored play per day,
 * deterministic doc ID -- Classic allows unlimited scored replays per day, so each round gets its
 * own client-generated unique gameDate token (`doc(collection(db,'gameScores')).id`), repurposing
 * the gameDate field as an arbitrary unique key rather than a calendar date -- same pattern as
 * wordle-challenge/wordle-tournament.
 */
export async function recordClassicResult(uid, profile, { puzzleId, difficulty, errors, timeTakenSeconds }) {
    const token = doc(collection(db, 'gameScores')).id;
    const ref = doc(db, 'gameScores', `${uid}_sudoku-classic_${token}`);

    const completionPoints = COMPLETION_POINTS[difficulty];
    const earnedTimeBonus = timeBonus(timeTakenSeconds);
    const earnedErrorBonus = errorBonus(errors);
    const score = completionPoints + earnedTimeBonus + earnedErrorBonus;

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'sudoku-classic',
        score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: token,
        puzzleId,
        difficulty,
        errors,
        completionPoints,
        timeBonusPoints: earnedTimeBonus,
        errorBonusPoints: earnedErrorBonus,
        sharedToFacebook: false,
        createdAt: serverTimestamp(),
    };

    try {
        await setDoc(ref, data);
        return data;
    } catch (err) {
        console.error('recordClassicResult: gameScores write failed', err);
        return null;
    }
}
