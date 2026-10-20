import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getTodayDateString, formatDuration } from '../../utils/helpers.js';
import { dailyPoints } from './pounce-scoring.js';

const PUZZLES_COLLECTION = 'pounceDailyPuzzles';

function dailyDocId(uid, dateString) {
    return `${uid}_pounce_${dateString}`;
}

/**
 * Resolves the Daily Pounce for `dateString` by a direct date lookup -- each pounceDailyPuzzles
 * doc is keyed by the exact "YYYY-MM-DD" it plays on, with a `_meta` doc ({ totalCount,
 * firstDate, lastDate }), the same scheme as quilt-daily-data.js#getTodayChallenge(): before
 * `_meta.firstDate` it previews puzzle #1; once launched, a pool that has run dry returns null
 * ("not ready yet") rather than repeating.
 *
 * Returns `{ challengeId, puzzle }` where `puzzle` is the engine's shape (see pounce-engine.js), or
 * null.
 */
export async function getTodayChallenge(dateString = getTodayDateString()) {
    const metaSnap = await getDoc(doc(db, PUZZLES_COLLECTION, '_meta'));
    if (!metaSnap.exists() || !metaSnap.data().totalCount) return null;

    const { firstDate } = metaSnap.data();
    const lookupDate = dateString < firstDate ? firstDate : dateString;

    const puzzleSnap = await getDoc(doc(db, PUZZLES_COLLECTION, lookupDate));
    if (!puzzleSnap.exists()) return null;

    const { challengeNumber, difficulty, size, regions, solution, dogs = [], pawprints = [] } = puzzleSnap.data();
    return {
        challengeId: challengeNumber,
        puzzle: { difficulty, size, regions, solution, dogs, pawprints },
    };
}

/**
 * Writes today's Daily Pounce result (pounce-scoring.js#dailyPoints: 10 + speed bonus − hisses −
 * tips, min 5, + 5 for Purrfect). Share bonuses are added later by
 * utils/points.js#markSharedToFacebook / #markSharedWithFriends. Same race-safe create-only pattern
 * as quilt-daily-data.js -- returns the written fields, or null if today's result already exists
 * (pounce-page.js gates play on checkPlayedToday first). Daily has no loss condition, so a
 * recorded result is always `won: true`. `cafeCat` is the name of the Cat Café cat this date
 * adopts (derivable from the date, stored so the profile and admin needn't re-derive it).
 */
export async function recordDailyResult(uid, profile, { challengeId, timeTakenSeconds, mistakes, tips, perfect, cafeCat }) {
    const today = getTodayDateString();
    const ref = doc(db, 'gameScores', dailyDocId(uid, today));

    const existing = await getDoc(ref);
    if (existing.exists()) return null;

    const points = dailyPoints({ timeTakenSeconds, mistakes, tips, perfect });
    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'pounce',
        score: points.score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: today,
        scoreDate: today,
        challengeId,
        won: true,
        perfect,
        mistakes,
        tips,
        cafeCat: cafeCat || '',
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
    } catch {
        return null; // lost a race with another write to the same doc id -- already recorded
    }
}
