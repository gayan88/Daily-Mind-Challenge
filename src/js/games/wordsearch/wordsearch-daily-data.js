import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getTodayDateString, daysSinceEpoch, formatDuration } from '../../utils/helpers.js';

const PUZZLES_COLLECTION = 'wordsearchDailyPuzzles';

function dailyDocId(uid, dateString) {
    return `${uid}_wordsearch_${dateString}`;
}

/**
 * Resolves today's numbered Daily Challenge puzzle: (daysSinceEpoch(date) % totalCount) + 1
 * indexes into the admin-managed wordsearchDailyPuzzles pool (see
 * src/js/admin/wordsearch-admin.js) -- same deterministic-by-date approach as every other Daily
 * Challenge in this app. Returns null if no puzzles have been seeded yet.
 */
export async function getTodayChallenge(dateString = getTodayDateString()) {
    const metaSnap = await getDoc(doc(db, PUZZLES_COLLECTION, '_meta'));
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    if (!totalCount) return null;

    const challengeId = (daysSinceEpoch(dateString) % totalCount) + 1;
    const puzzleSnap = await getDoc(doc(db, PUZZLES_COLLECTION, String(challengeId)));
    if (!puzzleSnap.exists()) return null;

    const { theme, words } = puzzleSnap.data();
    return { challengeId, theme: theme || '', words };
}

/** Word Search's own time-bonus tiers -- 5min/10min thresholds, distinct from Sudoku's 10min/20min. */
export function timeBonus(timeTakenSeconds) {
    if (timeTakenSeconds < 300) return 25;
    if (timeTakenSeconds < 600) return 15;
    return 10;
}

/**
 * Writes today's Daily Challenge result: 25 points for completing + a time bonus (25/15/10 by
 * elapsed seconds). No error/accuracy component -- Word Search has no "wrong answer" concept.
 * Facebook's +20 is awarded separately by utils/points.js#markSharedToFacebook(). Same race-safe
 * create-only pattern as every other Daily Challenge -- returns the written fields, or null if
 * today's result was somehow already recorded. gameType/doc ID are unchanged from the app's
 * original single-mode Word Search, so checkPlayedTodayAll()'s hardcoded {wordle, sudoku,
 * wordsearch} shape and the home page's "completed today" tile badge need no changes.
 */
export async function recordDailyResult(uid, profile, { challengeId, theme, timeTakenSeconds, wordsFound, totalWords }) {
    const today = getTodayDateString();
    const ref = doc(db, 'gameScores', dailyDocId(uid, today));

    const existing = await getDoc(ref);
    if (existing.exists()) return null;

    const completionPoints = 25;
    const earnedTimeBonus = timeBonus(timeTakenSeconds);
    const score = completionPoints + earnedTimeBonus;

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'wordsearch',
        score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: today,
        challengeId,
        theme: theme || '',
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
    } catch {
        return null; // lost a race with another write to the same doc id -- already recorded
    }
}
