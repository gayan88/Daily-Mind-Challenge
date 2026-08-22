import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getTodayDateString, daysSinceEpoch, formatDuration } from '../../utils/helpers.js';

const PUZZLES_COLLECTION = 'sudokuDailyPuzzles';

function dailyDocId(uid, dateString) {
    return `${uid}_sudoku_${dateString}`;
}

/**
 * Resolves today's numbered Daily Challenge puzzle: (daysSinceEpoch(date) % totalCount) + 1
 * indexes into the admin-managed sudokuDailyPuzzles pool (see src/js/admin/sudoku-admin.js) --
 * same deterministic-by-date approach as Wordle's Daily Challenge, with the position number
 * doubling as the shareable numeric ID. Returns null if no puzzles have been seeded yet.
 */
export async function getTodayChallenge(dateString = getTodayDateString()) {
    const metaSnap = await getDoc(doc(db, PUZZLES_COLLECTION, '_meta'));
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    if (!totalCount) return null;

    const challengeId = (daysSinceEpoch(dateString) % totalCount) + 1;
    const puzzleSnap = await getDoc(doc(db, PUZZLES_COLLECTION, String(challengeId)));
    if (!puzzleSnap.exists()) return null;

    const { puzzle, solution } = puzzleSnap.data();
    return { challengeId, puzzle, solution };
}

export function timeBonus(timeTakenSeconds) {
    if (timeTakenSeconds < 600) return 25;
    if (timeTakenSeconds < 1200) return 15;
    return 10;
}

export function errorBonus(errors) {
    if (errors <= 3) return 50;
    if (errors <= 6) return 40;
    if (errors <= 9) return 30;
    if (errors <= 12) return 20;
    return 10;
}

/**
 * Writes today's Daily Challenge result: 25 points for completing + a time bonus (25/15/10 by
 * elapsed seconds) + an error bonus (50 down to 10 by mistake count). Facebook's +20 is awarded
 * separately by utils/points.js#markSharedToFacebook(), since sharing is optional and happens
 * after the player has already seen this result. Same race-safe create-only pattern as
 * recordGameScore() -- returns the written fields, or null if today's result was somehow already
 * recorded (shouldn't normally happen, since sudoku-page.js gates play on checkPlayedToday first).
 * `gameType`/doc ID are unchanged from the app's original single-mode Sudoku -- this keeps
 * checkPlayedTodayAll()'s hardcoded {wordle, sudoku, wordsearch} shape and the home page's
 * "completed today" tile badge working with no changes needed there.
 */
export async function recordDailyResult(uid, profile, { challengeId, errors, timeTakenSeconds }) {
    const today = getTodayDateString();
    const ref = doc(db, 'gameScores', dailyDocId(uid, today));

    const existing = await getDoc(ref);
    if (existing.exists()) return null;

    const completionPoints = 25;
    const earnedTimeBonus = timeBonus(timeTakenSeconds);
    const earnedErrorBonus = errorBonus(errors);
    const score = completionPoints + earnedTimeBonus + earnedErrorBonus;

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'sudoku',
        score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: today,
        challengeId,
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
    } catch {
        return null; // lost a race with another write to the same doc id -- already recorded
    }
}
