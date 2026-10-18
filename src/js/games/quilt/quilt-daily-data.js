import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getTodayDateString, formatDuration } from '../../utils/helpers.js';
import { dailyPoints } from './quilt-scoring.js';

const PUZZLES_COLLECTION = 'quiltDailyPuzzles';

function dailyDocId(uid, dateString) {
    return `${uid}_quilt_${dateString}`;
}

/**
 * Resolves the Daily Quilt for `dateString` by a direct date lookup -- each quiltDailyPuzzles doc
 * is keyed by the exact "YYYY-MM-DD" it plays on, with a `_meta` doc ({ totalCount, firstDate,
 * lastDate }), the same scheme as sudoku-daily-data.js#getTodayChallenge() (see its doc comment):
 * before `_meta.firstDate` it previews puzzle #1; once launched, a pool that has run dry returns
 * null ("not ready yet") rather than repeating.
 *
 * Returns `{ challengeId, puzzle }` where `puzzle` is the engine's shape (see quilt-engine.js), or
 * null.
 */
export async function getTodayChallenge(dateString = getTodayDateString()) {
    const metaSnap = await getDoc(doc(db, PUZZLES_COLLECTION, '_meta'));
    if (!metaSnap.exists() || !metaSnap.data().totalCount) return null;

    const { firstDate } = metaSnap.data();
    const lookupDate = dateString < firstDate ? firstDate : dateString;

    const puzzleSnap = await getDoc(doc(db, PUZZLES_COLLECTION, lookupDate));
    if (!puzzleSnap.exists()) return null;

    const { challengeNumber, title, difficulty, width, height, palette, pixels, rects, clues, blockers = [] } = puzzleSnap.data();
    return {
        challengeId: challengeNumber,
        puzzle: { title, difficulty, width, height, palette, pixels, rects, clues, blockers },
    };
}

/**
 * Writes today's Daily Quilt result (quilt-scoring.js#dailyPoints: 10 + speed bonus + 5 for a
 * Perfect Stitch). Share bonuses are added later by utils/points.js#markSharedToFacebook /
 * #markSharedWithFriends. Same race-safe create-only pattern as sudoku-daily-data.js -- returns
 * the written fields, or null if today's result already exists (quilt-page.js gates play on
 * checkPlayedToday first, so that shouldn't normally happen). Daily has no loss condition (no
 * timer limit, unlimited undo), so a recorded result is always `won: true`.
 */
export async function recordDailyResult(uid, profile, { challengeId, title, timeTakenSeconds, perfect, undos, removals }) {
    const today = getTodayDateString();
    const ref = doc(db, 'gameScores', dailyDocId(uid, today));

    const existing = await getDoc(ref);
    if (existing.exists()) return null;

    const points = dailyPoints({ timeTakenSeconds, perfect });
    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'quilt',
        score: points.score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: today,
        scoreDate: today,
        challengeId,
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
    } catch {
        return null; // lost a race with another write to the same doc id -- already recorded
    }
}
