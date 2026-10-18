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
import { classicPoints } from './quilt-scoring.js';

const PUZZLES_COLLECTION = 'quiltClassicPuzzles';

/**
 * Picks a Classic puzzle for `difficulty` from the admin-managed pool, preferring pictures this
 * player has never solved -- a repeated picture is already spoiled, unlike a repeated Sudoku. Once
 * every puzzle in the pool has been solved, falls back to a random one other than `excludeId` (the
 * one just played). Returns `{ puzzleId, puzzle, unplayedLeft }` or null if none are seeded yet.
 *
 * "Solved before" comes from the player's own quilt-classic gameScores docs (two equality filters,
 * so no composite index needed).
 */
export async function getClassicPuzzle(uid, difficulty, excludeId = null) {
    const [poolSnap, playedSnap] = await Promise.all([
        getDocs(query(collection(db, PUZZLES_COLLECTION), where('difficulty', '==', difficulty))),
        getDocs(query(collection(db, 'gameScores'), where('userId', '==', uid), where('gameType', '==', 'quilt-classic'))),
    ]);
    if (poolSnap.empty) return null;

    const played = new Set(playedSnap.docs.map((d) => d.data().puzzleId));
    const unplayed = poolSnap.docs.filter((d) => !played.has(d.id) && d.id !== excludeId);
    const others = poolSnap.docs.length > 1 ? poolSnap.docs.filter((d) => d.id !== excludeId) : poolSnap.docs;
    const pool = unplayed.length ? unplayed : others;
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    const { title, width, height, palette, pixels, rects, clues, blockers = [] } = chosen.data();
    return {
        puzzleId: chosen.id,
        puzzle: { title, difficulty, width, height, palette, pixels, rects, clues, blockers },
        unplayedLeft: Math.max(0, unplayed.length - 1),
    };
}

/**
 * Writes one Classic round (quilt-scoring.js#classicPoints). Classic has no loss condition, and
 * allows unlimited scored replays, so each round gets its own client-generated unique `gameDate`
 * token with the real calendar date in `scoreDate` (same pattern as connections-classic-data.js).
 */
export async function recordClassicResult(uid, profile, { puzzleId, difficulty, title, timeTakenSeconds, perfect, undos, removals }) {
    const token = doc(collection(db, 'gameScores')).id;
    const ref = doc(db, 'gameScores', `${uid}_quilt-classic_${token}`);
    const points = classicPoints({ timeTakenSeconds, perfect, difficulty });

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'quilt-classic',
        score: points.score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: token,
        scoreDate: getTodayDateString(),
        puzzleId,
        difficulty,
        title: title || '',
        won: true,
        perfect,
        undos,
        removals,
        completionPoints: points.completionPoints,
        timeBonusPoints: points.timeBonusPoints,
        perfectBonusPoints: points.perfectBonusPoints,
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
