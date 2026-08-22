import {
    doc,
    getDoc,
    setDoc,
    runTransaction,
    serverTimestamp,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { getTodayDateString, isConsecutiveDay } from './helpers.js';
import { getConfig } from './config.js';

function gameScoreDocId(uid, gameType, date) {
    return `${uid}_${gameType}_${date}`;
}

/**
 * Awards the one-time daily login bonus (amount from config/dailyLoginReward, default 10) for
 * registered users only. Returns { applied, amount, newStreak }.
 */
export async function applyDailyLoginBonus(uid) {
    const today = getTodayDateString();
    const { points: bonusAmount } = await getConfig('dailyLoginReward');
    const userRef = doc(db, 'registeredUsers', uid);

    return runTransaction(db, async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists()) return { applied: false, amount: 0 };
        const user = userSnap.data();

        if (user.lastLoginDate === today) return { applied: false, amount: 0 };

        const newStreak = isConsecutiveDay(user.lastLoginDate, today) ? (user.currentStreak || 0) + 1 : 1;

        tx.update(userRef, {
            loginPoints: (user.loginPoints || 0) + bonusAmount,
            lastLoginDate: today,
            currentStreak: newStreak,
        });
        return { applied: true, amount: bonusAmount, newStreak };
    });
}

/**
 * Writes a gameScores doc with a deterministic ID (uid_gameType_date). The real "one attempt per
 * game per day" guarantee is enforced server-side by firestore.rules (only `create`, never
 * `update`, is allowed on this path for regular users, so a second write is rejected even in a
 * race) -- the getDoc here is just a cheap client-side check to avoid attempting a doomed write.
 * Returns true if this was the first attempt recorded today.
 */
export async function recordGameScore(uid, profile, gameType, score, timeTaken) {
    const today = getTodayDateString();
    const ref = doc(db, 'gameScores', gameScoreDocId(uid, gameType, today));

    const existing = await getDoc(ref);
    if (existing.exists()) return false;

    try {
        await setDoc(ref, {
            userId: uid,
            displayName: profile.displayName,
            isGuest: profile.kind === 'guest',
            gameType,
            score,
            timeTaken,
            gameDate: today,
            createdAt: serverTimestamp(),
        });
        return true;
    } catch {
        return false; // lost a race with another write to the same doc id -- already recorded
    }
}

export async function checkPlayedToday(uid, gameType) {
    const today = getTodayDateString();
    const snap = await getDoc(doc(db, 'gameScores', gameScoreDocId(uid, gameType, today)));
    return snap.exists() ? snap.data() : null;
}

/** Same as checkPlayedToday but for all three games in a single round-trip (used by the home
 * page, which needs all three) instead of three separate getDoc calls. */
export async function checkPlayedTodayAll(uid) {
    const today = getTodayDateString();
    const q = query(
        collection(db, 'gameScores'),
        where('userId', '==', uid),
        where('gameDate', '==', today)
    );
    const snap = await getDocs(q);
    const result = { wordle: null, sudoku: null, wordsearch: null };
    snap.docs.forEach((d) => {
        const data = d.data();
        result[data.gameType] = data;
    });
    return result;
}

/** Lifetime game-score total and count, for the "Total Points" formula on profile.html
 * (registered users add loginPoints to totalScore themselves; guests just use totalScore). */
export async function getUserLifetimeStats(uid) {
    const q = query(collection(db, 'gameScores'), where('userId', '==', uid));
    const snap = await getDocs(q);
    let totalScore = 0;
    snap.docs.forEach((d) => { totalScore += d.data().score; });
    return { totalScore, gamesPlayedCount: snap.size };
}

/**
 * Guarded, one-time +20 for sharing a game result to Facebook -- generic across any gameType
 * covered by firestore.rules' isFacebookShareUpdate() (currently wordle/sudoku/sudoku-classic).
 * A client-verifiable-only signal (no proof a share actually happened), same "v1-pragmatic, not
 * fully cheat-proof" philosophy as the rest of this app's points. `gameDate` must match whatever
 * value the target gameScores doc's ID was built from (a calendar date for daily-style docs, or
 * a repurposed unique key for non-daily ones like sudoku-classic). Returns { applied, newScore }.
 */
export async function markSharedToFacebook(uid, gameType, gameDate) {
    const ref = doc(db, 'gameScores', gameScoreDocId(uid, gameType, gameDate));
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

export async function getUserGameHistory(uid, limitCount = 20) {
    const q = query(
        collection(db, 'gameScores'),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
}
