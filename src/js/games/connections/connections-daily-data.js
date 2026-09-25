import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getTodayDateString, formatDuration } from '../../utils/helpers.js';
import { mistakesBonus, timeBonus, scoreDocRef } from './connections-scoring.js';

const PUZZLES_COLLECTION = 'connectionsDailyPuzzles';
const ATTEMPTS_COLLECTION = 'connectionsDailyAttempts';

/**
 * Resolves today's Daily puzzle by direct date lookup -- each connectionsDailyPuzzles doc is keyed
 * by the exact "YYYY-MM-DD" date it plays on (set once by the admin panel), so adding puzzles later
 * never shifts an existing date. Before `_meta.firstDate` (pre-launch) it always resolves to
 * Puzzle #1 so the mode can be previewed without faking the clock; once launched, a missing date
 * returns null ("not ready yet") rather than repeating #1. Same scheme as wordle-daily-data.js.
 * Returns `{ challengeId, groups }` or null.
 */
export async function getTodayChallenge(dateString = getTodayDateString()) {
    const metaSnap = await getDoc(doc(db, PUZZLES_COLLECTION, '_meta'));
    if (!metaSnap.exists() || !metaSnap.data().totalCount) return null;

    const { firstDate } = metaSnap.data();
    const lookupDate = dateString < firstDate ? firstDate : dateString;

    const puzzleSnap = await getDoc(doc(db, PUZZLES_COLLECTION, lookupDate));
    if (!puzzleSnap.exists()) return null;

    return { challengeId: puzzleSnap.data().challengeNumber, groups: puzzleSnap.data().groups };
}

function attemptDocId(uid, dateString) {
    return `${uid}_${dateString}`;
}

/**
 * Today's attempt tracking (count, outcome, last attempt time), separate from `gameScores`, which
 * only gets a doc once the puzzle is actually solved -- see wordle-daily-data.js's "retry redesign"
 * notes; Connections Daily uses the identical hourly-retry model.
 */
export async function getDailyAttemptState(uid, dateString = getTodayDateString()) {
    const snap = await getDoc(doc(db, ATTEMPTS_COLLECTION, attemptDocId(uid, dateString)));
    return snap.exists() ? snap.data() : null;
}

/** Records one Daily attempt (win or loss). `lastAttemptAt` is always a real serverTimestamp(). */
export async function recordDailyAttempt(uid, won, dateString = getTodayDateString()) {
    const ref = doc(db, ATTEMPTS_COLLECTION, attemptDocId(uid, dateString));
    const existing = await getDoc(ref);
    const attemptsCount = (existing.exists() ? existing.data().attemptsCount : 0) + 1;

    if (existing.exists()) {
        await setDoc(ref, { attemptsCount, won, lastAttemptAt: serverTimestamp() }, { merge: true });
    } else {
        await setDoc(ref, {
            uid,
            date: dateString,
            attemptsCount,
            won,
            lastAttemptAt: serverTimestamp(),
        });
    }
}

/**
 * Writes today's Daily result -- only ever called on a win: 10 (playing) + a mistakes bonus
 * (10/8/6/5) + a time bonus (10/8/6/5). Deterministic `{uid}_connections_{date}` id, create-only
 * under firestore.rules, so a repeat is rejected. Returns the written fields, or null if today's
 * result already existed. Both `gameDate` and `scoreDate` are written (see docs/adding-a-new-game.md).
 */
export async function recordDailyResult(uid, profile, { challengeId, mistakes, timeTakenSeconds }) {
    const today = getTodayDateString();
    const ref = scoreDocRef(uid, 'connections', today);

    const existing = await getDoc(ref);
    if (existing.exists()) return null;

    const earnedMistakesBonus = mistakesBonus(mistakes);
    const earnedTimeBonus = timeBonus(timeTakenSeconds);
    const score = 10 + earnedMistakesBonus + earnedTimeBonus;

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'connections',
        score,
        timeTaken: formatDuration(timeTakenSeconds * 1000),
        gameDate: today,
        scoreDate: today,
        challengeId,
        won: true,
        mistakes,
        playPoints: 10,
        mistakesPoints: earnedMistakesBonus,
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
