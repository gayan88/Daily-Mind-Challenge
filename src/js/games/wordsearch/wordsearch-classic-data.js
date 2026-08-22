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
import { timeBonus } from './wordsearch-daily-data.js';

const PUZZLES_COLLECTION = 'wordsearchClassicPuzzles';

const COMPLETION_POINTS = { easy: 10, medium: 15, hard: 25 };

/**
 * Serves a random puzzle for the given difficulty from the admin-managed pool (see
 * src/js/admin/wordsearch-admin.js) -- unlike Daily Challenge's deterministic-by-date pick,
 * Classic has no "today's puzzle" concept, so every difficulty's puzzles are fetched and one is
 * chosen client-side. Returns null if none are seeded yet for that difficulty.
 */
export async function getRandomClassicPuzzle(difficulty) {
    const q = query(collection(db, PUZZLES_COLLECTION), where('difficulty', '==', difficulty));
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const chosen = snap.docs[Math.floor(Math.random() * snap.docs.length)];
    const { theme, words } = chosen.data();
    return { puzzleId: chosen.id, theme: theme || '', words, difficulty };
}

/**
 * Writes one Classic Word Search round's result: a completion score by difficulty (10/15/25) plus
 * the same time bonus as Daily Challenge (reused from wordsearch-daily-data.js). Classic allows
 * unlimited scored replays per day, so each round gets its own client-generated unique gameDate
 * token (`doc(collection(db,'gameScores')).id`), repurposing the gameDate field as an arbitrary
 * unique key rather than a calendar date -- same pattern as sudoku-classic-data.js.
 */
export async function recordClassicResult(uid, profile, { puzzleId, difficulty, timeTakenSeconds, wordsFound, totalWords }) {
    const token = doc(collection(db, 'gameScores')).id;
    const ref = doc(db, 'gameScores', `${uid}_wordsearch-classic_${token}`);

    const completionPoints = COMPLETION_POINTS[difficulty];
    const earnedTimeBonus = timeBonus(timeTakenSeconds);
    const score = completionPoints + earnedTimeBonus;

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'wordsearch-classic',
        score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: token,
        puzzleId,
        difficulty,
        wordsFound,
        totalWords,
        completionPoints,
        timeBonusPoints: earnedTimeBonus,
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
