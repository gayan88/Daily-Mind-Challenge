import { doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { awardShareXp } from '../../progression/xp-service.js';

export const MAX_MISTAKES = 4;

/** 10 / 8 / 6 / 5 for 0 / 1 / 2 / 3 mistakes (a win with 4 mistakes can't happen). */
export function mistakesBonus(mistakes) {
    return [10, 8, 6, 5][mistakes] ?? 5;
}

export function timeBonus(timeTakenSeconds) {
    if (timeTakenSeconds <= 180) return 10;
    if (timeTakenSeconds <= 300) return 8;
    if (timeTakenSeconds <= 600) return 6;
    return 5;
}

export const CLASSIC_COMPLETION_POINTS = { easy: 10, medium: 15, hard: 25 };

/** Keeps the `gameScores` doc id scheme in one place: `{uid}_{gameType}_{gameDate}`. */
export function scoreDocRef(uid, gameType, gameDate) {
    return doc(db, 'gameScores', `${uid}_${gameType}_${gameDate}`);
}

async function markShared(uid, gameType, gameDate, field, amount) {
    const ref = scoreDocRef(uid, gameType, gameDate);
    const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data()[field]) {
            return { applied: false, newScore: snap.exists() ? snap.data().score : 0 };
        }
        const newScore = snap.data().score + amount;
        tx.update(ref, { score: newScore, [field]: true, updatedAt: serverTimestamp() });
        return { applied: true, newScore };
    });
    if (result.applied) await awardShareXp(uid);
    return result;
}

/** One-time +20 for "Copy Result & Share with Community" -- see firestore.rules' isCommunityShareUpdate(). */
export function markSharedToFacebook(uid, gameType, gameDate) {
    return markShared(uid, gameType, gameDate, 'sharedToFacebook', 20);
}

/** One-time +10 for "Share with Friends" -- independent from the +20 above, see isFriendsShareUpdate(). */
export function markSharedWithFriends(uid, gameType, gameDate) {
    return markShared(uid, gameType, gameDate, 'sharedWithFriends', 10);
}
