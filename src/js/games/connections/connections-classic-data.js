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
import { formatDuration, getTodayDateString } from '../../utils/helpers.js';
import { CLASSIC_COMPLETION_POINTS, mistakesBonus, timeBonus, scoreDocRef } from './connections-scoring.js';

const PUZZLES_COLLECTION = 'connectionsClassicPuzzles';

/**
 * Serves a random puzzle for the given difficulty from the admin-managed pool (see
 * src/js/admin/connections-admin.js). `excludeId` (the puzzle just played) is skipped when there's
 * any alternative, so back-to-back rounds don't repeat. Returns null if none are seeded yet.
 */
export async function getRandomClassicPuzzle(difficulty, excludeId = null) {
    const q = query(collection(db, PUZZLES_COLLECTION), where('difficulty', '==', difficulty));
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const pool = snap.docs.length > 1 ? snap.docs.filter((d) => d.id !== excludeId) : snap.docs;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    return { puzzleId: chosen.id, groups: chosen.data().groups, difficulty };
}

/**
 * Writes one Classic round's result -- wins only (a loss writes nothing, so replays can't be farmed
 * for base points): completion points by difficulty (10/15/25) + the same mistakes and time
 * bonuses as Daily. Classic allows unlimited scored replays, so each round gets its own
 * client-generated unique `gameDate` token (same pattern as sudoku-classic-data.js), with the
 * real calendar date in `scoreDate`.
 */
export async function recordClassicResult(uid, profile, { puzzleId, difficulty, mistakes, timeTakenSeconds }) {
    const token = doc(collection(db, 'gameScores')).id;
    const ref = scoreDocRef(uid, 'connections-classic', token);

    const completionPoints = CLASSIC_COMPLETION_POINTS[difficulty];
    const earnedMistakesBonus = mistakesBonus(mistakes);
    const earnedTimeBonus = timeBonus(timeTakenSeconds);
    const score = completionPoints + earnedMistakesBonus + earnedTimeBonus;

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'connections-classic',
        score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: token,
        scoreDate: getTodayDateString(),
        puzzleId,
        difficulty,
        mistakes,
        completionPoints,
        mistakesPoints: earnedMistakesBonus,
        timePoints: earnedTimeBonus,
        sharedToFacebook: false,
        sharedWithFriends: false,
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
