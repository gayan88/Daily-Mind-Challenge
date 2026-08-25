import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getTodayDateString, formatDuration } from '../../utils/helpers.js';

const PUZZLES_COLLECTION = 'wordsearchDailyPuzzles';

function dailyDocId(uid, dateString) {
    return `${uid}_wordsearch_${dateString}`;
}

/**
 * Resolves today's Daily Challenge puzzle by a direct date lookup -- each wordsearchDailyPuzzles
 * doc is keyed by the exact "YYYY-MM-DD" date it plays on (see
 * src/js/admin/wordsearch-admin.js#addDailyWordsearchPuzzle, which computes and stores that date
 * at add time), rather than derived from a formula -- same scheme as wordle-daily-data.js#
 * getTodayChallenge(), see its own doc comment for the full rationale (adding more puzzles later
 * never shifts an existing date).
 *
 * Before `_meta.firstDate` (i.e. before launch), always resolves to the first puzzle (Challenge
 * #1), so the Daily Challenge can be previewed ahead of the real launch date. This does NOT apply
 * once launch has passed -- a seeded pool running dry still correctly returns null ("not ready
 * yet") instead of silently repeating #1 forever.
 */
export async function getTodayChallenge(dateString = getTodayDateString()) {
    const metaSnap = await getDoc(doc(db, PUZZLES_COLLECTION, '_meta'));
    if (!metaSnap.exists() || !metaSnap.data().totalCount) return null;

    const { firstDate } = metaSnap.data();
    const lookupDate = dateString < firstDate ? firstDate : dateString;

    const puzzleSnap = await getDoc(doc(db, PUZZLES_COLLECTION, lookupDate));
    if (!puzzleSnap.exists()) return null;

    const { challengeNumber, theme, words } = puzzleSnap.data();
    return { challengeId: challengeNumber, theme: theme || '', words };
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
