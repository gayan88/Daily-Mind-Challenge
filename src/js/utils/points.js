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
import { getTodayDateString } from './helpers.js';
import { getConfig } from './config.js';
import { XP_AMOUNTS, awardShareXp } from '../progression/xp-service.js';

function gameScoreDocId(uid, gameType, date) {
    return `${uid}_${gameType}_${date}`;
}

/**
 * Awards the one-time daily login bonus (amount from config/dailyLoginReward, default 10) for
 * registered users only, plus a flat XP_AMOUNTS.DAILY_LOGIN bump (Phase 3 of the progression
 * spec) in the same write -- both land in one Firestore update rather than two. Returns
 * { applied, amount }.
 *
 * Does NOT touch `currentStreak` -- as of Phase 4, the Streak is gameplay-based (completing a
 * Daily Challenge), not login-based; see progression/streak-service.js#advanceStreakForDailyCompletion().
 * `lastLoginDate` here only gates this login bonus, nothing else.
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

        tx.update(userRef, {
            loginPoints: (user.loginPoints || 0) + bonusAmount,
            lastLoginDate: today,
            xp: (user.xp || 0) + XP_AMOUNTS.DAILY_LOGIN,
        });
        return { applied: true, amount: bonusAmount };
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

/** Same underlying query as getUserLifetimeStats(), plus a per-gameType breakdown (score total
 * *and* doc count) -- used by profile.js to feed the progression layer's per-game Points and
 * "modes played" aggregation (progression/progression-service.js#getGameProgressByGame) without
 * a second Firestore read for what would otherwise be the same "all of this user's gameScores
 * docs" query. */
export async function getUserScoreByGameType(uid) {
    const q = query(collection(db, 'gameScores'), where('userId', '==', uid));
    const snap = await getDocs(q);
    const byGameType = {};
    let totalScore = 0;
    snap.docs.forEach((d) => {
        const { gameType, score } = d.data();
        if (!byGameType[gameType]) byGameType[gameType] = { score: 0, count: 0 };
        byGameType[gameType].score += score;
        byGameType[gameType].count += 1;
        totalScore += score;
    });
    return { byGameType, totalScore, gamesPlayedCount: snap.size };
}

/**
 * Guarded, one-time +20 for "Copy Result & Share with Community" -- generic across any gameType
 * covered by firestore.rules' isCommunityShareUpdate() (currently wordle/sudoku/sudoku-classic/
 * wordsearch/wordsearch-classic, plus wordle-tournament/wordle-challenge via their own per-mode
 * copies of this pattern in wordle-tournament-data.js/wordle-challenge-data.js). A
 * client-verifiable-only signal (no proof a share actually happened), same "v1-pragmatic, not
 * fully cheat-proof" philosophy as the rest of this app's points. `gameDate` must match whatever
 * value the target gameScores doc's ID was built from (a calendar date for daily-style docs, or
 * a repurposed unique key for non-daily ones like sudoku-classic). Returns { applied, newScore }.
 * Independent from markSharedWithFriends() below -- see wordle-daily-data.js's equivalent pair for
 * the full rationale (two separate, stackable bonuses, not alternatives). Also awards a small flat
 * XP bump (progression/xp-service.js#awardShareXp(), Phase 3 of the progression spec) when newly
 * applied -- silently a no-op for guests, since XP is registered-only.
 */
export async function markSharedToFacebook(uid, gameType, gameDate) {
    const ref = doc(db, 'gameScores', gameScoreDocId(uid, gameType, gameDate));
    const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data().sharedToFacebook) {
            return { applied: false, newScore: snap.exists() ? snap.data().score : 0 };
        }
        const newScore = snap.data().score + 20;
        tx.update(ref, { score: newScore, sharedToFacebook: true, updatedAt: serverTimestamp() });
        return { applied: true, newScore };
    });
    if (result.applied) await awardShareXp(uid);
    return result;
}

/** Guarded, one-time +10 for "Share with Friends" -- independent from markSharedToFacebook()
 * above, generic across any gameType covered by firestore.rules' isFriendsShareUpdate(). */
export async function markSharedWithFriends(uid, gameType, gameDate) {
    const ref = doc(db, 'gameScores', gameScoreDocId(uid, gameType, gameDate));
    const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data().sharedWithFriends) {
            return { applied: false, newScore: snap.exists() ? snap.data().score : 0 };
        }
        const newScore = snap.data().score + 10;
        tx.update(ref, { score: newScore, sharedWithFriends: true, updatedAt: serverTimestamp() });
        return { applied: true, newScore };
    });
    if (result.applied) await awardShareXp(uid);
    return result;
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
