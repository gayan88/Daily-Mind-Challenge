import {
    doc,
    getDoc,
    setDoc,
    runTransaction,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getTodayDateString, formatDuration } from '../../utils/helpers.js';

const WORDS_COLLECTION = 'wordleDailyWords';

function dailyDocId(uid, dateString) {
    return `${uid}_wordle_${dateString}`;
}

/**
 * Resolves today's Daily Challenge word by a direct date lookup -- each wordleDailyWords doc is
 * keyed by the exact "YYYY-MM-DD" date it plays on (see src/js/admin/wordle-admin.js#addDailyWord,
 * which computes and stores that date at add time), rather than derived from a formula. This
 * means adding more words later never changes which date any existing word lands on.
 *
 * Before `_meta.firstDate` (i.e. before launch), always resolves to the first word (Challenge #1)
 * -- lets the Daily Challenge be previewed/tested ahead of the real launch date without needing to
 * fake the system clock. This deliberately does NOT apply once launch has passed: if the seeded
 * calendar runs out (today is past the last word's date), this returns null like normal, so the
 * "not ready yet" state stays visible rather than silently repeating word #1 forever.
 *
 * Returns null if no words have been seeded yet, or if today is between the seeded dates' first
 * and last but has no word of its own (a gap, or the calendar's simply run dry).
 */
export async function getTodayChallenge(dateString = getTodayDateString()) {
    const metaSnap = await getDoc(doc(db, WORDS_COLLECTION, '_meta'));
    if (!metaSnap.exists() || !metaSnap.data().totalCount) return null;

    const { firstDate } = metaSnap.data();
    const lookupDate = dateString < firstDate ? firstDate : dateString;

    const wordSnap = await getDoc(doc(db, WORDS_COLLECTION, lookupDate));
    if (!wordSnap.exists()) return null;

    return { challengeId: wordSnap.data().challengeNumber, word: wordSnap.data().word.toUpperCase() };
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

/**
 * Guarded, one-time +20 for "Copy Result & Share with Community" (see wordle-summary-modal.js).
 * Independent from markSharedWithFriends() below -- the two are separate, stackable bonuses, each
 * claimable once, not alternatives for a single shared bonus. Like the rest of this app's points
 * system, this is a client-verifiable-only signal (no server-side proof a share actually
 * happened) -- consistent with the existing "v1-pragmatic, not fully cheat-proof" philosophy;
 * firestore.rules' isFacebookShareUpdate() independently bounds this update to +20 on the
 * `sharedToFacebook` field only. Returns { applied, newScore }.
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

/**
 * Guarded, one-time +10 for "Share with Friends" (native Web Share API / sharer.php fallback, see
 * wordle-summary-modal.js). Independent from markSharedToFacebook() above -- a player can claim
 * both, one time each. Returns { applied, newScore }.
 */
export async function markSharedWithFriends(uid, dateString = getTodayDateString()) {
    const ref = doc(db, 'gameScores', dailyDocId(uid, dateString));
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data().sharedWithFriends) {
            return { applied: false, newScore: snap.exists() ? snap.data().score : 0 };
        }
        const newScore = snap.data().score + 10;
        tx.update(ref, { score: newScore, sharedWithFriends: true, updatedAt: serverTimestamp() });
        return { applied: true, newScore };
    });
}
