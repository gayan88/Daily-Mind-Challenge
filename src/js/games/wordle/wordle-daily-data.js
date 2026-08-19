import {
    doc,
    getDoc,
    setDoc,
    runTransaction,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getTodayDateString, daysSinceEpoch, formatDuration } from '../../utils/helpers.js';

const WORDS_COLLECTION = 'wordleDailyWords';

function dailyDocId(uid, dateString) {
    return `${uid}_wordle_${dateString}`;
}

/**
 * Resolves today's numbered Daily Challenge word: (daysSinceEpoch(date) % totalCount) + 1 indexes
 * into the admin-managed wordleDailyWords pool (see src/js/admin/wordle-admin.js) -- the same
 * deterministic-by-date approach `words-wordle.js` used with a static list, just Firestore-backed
 * now, with the position number doubling as the shareable "Challenge ID". One extra getDoc for the
 * `_meta` count vs. the static list's zero reads. Returns null if no words have been seeded yet.
 */
export async function getTodayChallenge(dateString = getTodayDateString()) {
    const metaSnap = await getDoc(doc(db, WORDS_COLLECTION, '_meta'));
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    if (!totalCount) return null;

    const challengeId = (daysSinceEpoch(dateString) % totalCount) + 1;
    const wordSnap = await getDoc(doc(db, WORDS_COLLECTION, String(challengeId)));
    if (!wordSnap.exists()) return null;

    return { challengeId, word: wordSnap.data().word.toUpperCase() };
}

function attemptsBonus(attempts) {
    return [10, 9, 8, 7, 6, 5][attempts - 1] ?? 5;
}

function timeBonus(timeTakenSeconds) {
    if (timeTakenSeconds <= 180) return 10;
    if (timeTakenSeconds <= 300) return 8;
    if (timeTakenSeconds <= 600) return 6;
    return 5;
}

/**
 * Writes today's Daily Challenge result: 10 points for playing (always) + an attempts bonus
 * (10 down to 5, win only) + a time bonus (10/8/6/5 by elapsed seconds, win only). Facebook's +20
 * is awarded separately by markSharedToFacebook() below, since sharing is optional and happens
 * after the player has already seen this result in the summary modal. Same race-safe create-only
 * pattern as recordGameScore() in utils/points.js -- returns the written fields (for the summary
 * modal's points breakdown), or null if today's result was somehow already recorded (shouldn't
 * normally happen, since wordle-page.js gates play on checkPlayedToday first).
 */
export async function recordDailyResult(uid, profile, { challengeId, won, attempts, timeTakenSeconds }) {
    const today = getTodayDateString();
    const ref = doc(db, 'gameScores', dailyDocId(uid, today));

    const existing = await getDoc(ref);
    if (existing.exists()) return null;

    const earnedAttemptsBonus = won ? attemptsBonus(attempts) : 0;
    const earnedTimeBonus = won ? timeBonus(timeTakenSeconds) : 0;
    const score = 10 + earnedAttemptsBonus + earnedTimeBonus;

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'wordle',
        score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: today,
        challengeId,
        won,
        attempts,
        playPoints: 10,
        attemptsPoints: earnedAttemptsBonus,
        timePoints: earnedTimeBonus,
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

/**
 * Guarded, one-time +20 for sharing today's result to Facebook. Like the rest of this app's
 * points system, this is a client-verifiable-only signal (no server-side proof a share actually
 * happened) -- consistent with the existing "v1-pragmatic, not fully cheat-proof" philosophy.
 * Returns { applied, newScore }.
 */
export async function markSharedToFacebook(uid, dateString = getTodayDateString()) {
    const ref = doc(db, 'gameScores', dailyDocId(uid, dateString));
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data().sharedToFacebook) {
            return { applied: false, newScore: snap.exists() ? snap.data().score : 0 };
        }
        const newScore = snap.data().score + 20;
        tx.update(ref, { score: newScore, sharedToFacebook: true, updatedAt: serverTimestamp() });
        return { applied: true, newScore };
    });
}
