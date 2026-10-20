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
import { classicPoints } from './pounce-scoring.js';

const PUZZLES_COLLECTION = 'pounceClassicPuzzles';

/**
 * Picks a board for `difficulty` from the admin-managed Classic pool. Classic (`preferUnplayed`)
 * serves boards this player has never solved first, from their own pounce-classic gameScores
 * `puzzleId`s (two equality filters, so no composite index); once every board has been solved it
 * falls back to a random one other than `excludeId` (the one just played). Zen plays the same pool
 * without that lookup. Returns `{ puzzleId, puzzle }` or null if none are seeded yet.
 */
export async function getClassicPuzzle(uid, difficulty, excludeId = null, { preferUnplayed = true } = {}) {
    const [poolSnap, playedSnap] = await Promise.all([
        getDocs(query(collection(db, PUZZLES_COLLECTION), where('difficulty', '==', difficulty))),
        preferUnplayed
            ? getDocs(query(collection(db, 'gameScores'), where('userId', '==', uid), where('gameType', '==', 'pounce-classic')))
            : Promise.resolve(null),
    ]);
    if (poolSnap.empty) return null;

    const played = new Set(playedSnap ? playedSnap.docs.map((d) => d.data().puzzleId) : []);
    const unplayed = preferUnplayed ? poolSnap.docs.filter((d) => !played.has(d.id) && d.id !== excludeId) : [];
    const others = poolSnap.docs.length > 1 ? poolSnap.docs.filter((d) => d.id !== excludeId) : poolSnap.docs;
    const pool = unplayed.length ? unplayed : others;
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    const { size, regions, solution, dogs = [], pawprints = [] } = chosen.data();
    return { puzzleId: chosen.id, puzzle: { difficulty, size, regions, solution, dogs, pawprints } };
}

/**
 * Writes one Classic round (pounce-scoring.js#classicPoints). Classic has no loss condition and
 * allows unlimited scored replays, so each round gets its own client-generated unique `gameDate`
 * token with the real calendar date in `scoreDate` (same pattern as quilt-classic-data.js).
 */
export async function recordClassicResult(uid, profile, { puzzleId, difficulty, timeTakenSeconds, mistakes, tips, perfect }) {
    const token = doc(collection(db, 'gameScores')).id;
    const ref = doc(db, 'gameScores', `${uid}_pounce-classic_${token}`);
    const points = classicPoints({ timeTakenSeconds, mistakes, tips, perfect, difficulty });

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'pounce-classic',
        score: points.score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: token,
        scoreDate: getTodayDateString(),
        puzzleId,
        difficulty,
        won: true,
        perfect,
        mistakes,
        tips,
        completionPoints: points.completionPoints,
        timeBonusPoints: points.timeBonusPoints,
        penaltyPoints: points.penaltyPoints,
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
