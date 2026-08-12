import {
    doc,
    runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../firebase/firebase-init.js';
import { getTodayDateString, isConsecutiveDay } from './utils.js';

const DAILY_LOGIN_BONUS = 10;

function leaderboardDocId(date, uid) {
    return `${date}_${uid}`;
}

/** Applies a leaderboard point delta using an already-read snapshot. Firestore transactions
 * require every tx.get() to happen before any tx.set()/tx.update(), so the read must be done
 * by the caller up front -- this only performs the write half. */
function writeLeaderboardDelta(tx, lbRef, lbSnap, uid, displayName, date, delta) {
    if (lbSnap.exists()) {
        tx.update(lbRef, { points: lbSnap.data().points + delta });
    } else {
        tx.set(lbRef, { uid, date, displayName, points: delta });
    }
}

/**
 * Awards the one-time +10 daily login bonus if the guest hasn't already claimed it today.
 * Returns true if the bonus was just applied, false if already claimed today.
 */
export async function applyDailyLoginBonus(uid) {
    const today = getTodayDateString();
    const userRef = doc(db, 'users', uid);

    return runTransaction(db, async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists()) return false;
        const user = userSnap.data();

        if (user.lastLoginDate === today) return false;

        const lbRef = doc(db, 'dailyLeaderboard', leaderboardDocId(today, uid));
        const lbSnap = await tx.get(lbRef); // all reads before any writes

        const newStreak = isConsecutiveDay(user.lastLoginDate, today) ? (user.currentStreak || 0) + 1 : 1;

        tx.update(userRef, {
            totalPoints: (user.totalPoints || 0) + DAILY_LOGIN_BONUS,
            lastLoginDate: today,
            currentStreak: newStreak,
        });
        writeLeaderboardDelta(tx, lbRef, lbSnap, uid, user.displayName, today, DAILY_LOGIN_BONUS);
        return true;
    });
}

/**
 * Awards points for completing a game, guarded so the same game can't be replayed for points
 * on the same calendar day. `meta` is merged into gamesCompleted[game] (e.g. { won, attempts }).
 * Returns true if points were awarded, false if today's round was already recorded.
 */
export async function awardGamePoints(uid, game, points, meta = {}) {
    const today = getTodayDateString();
    const userRef = doc(db, 'users', uid);

    return runTransaction(db, async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists()) return false;
        const user = userSnap.data();

        const existing = (user.gamesCompleted || {})[game];
        if (existing && existing.date === today) return false;

        const lbRef = doc(db, 'dailyLeaderboard', leaderboardDocId(today, uid));
        const lbSnap = await tx.get(lbRef); // all reads before any writes

        const gamesCompleted = { ...(user.gamesCompleted || {}) };
        gamesCompleted[game] = { date: today, ...meta };

        tx.update(userRef, {
            totalPoints: (user.totalPoints || 0) + points,
            gamesCompleted,
        });
        writeLeaderboardDelta(tx, lbRef, lbSnap, uid, user.displayName, today, points);
        return true;
    });
}

export function hasPlayedToday(userDoc, game) {
    const entry = (userDoc?.gamesCompleted || {})[game];
    return entry?.date === getTodayDateString();
}
