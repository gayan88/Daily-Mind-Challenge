import {
    doc,
    runTransaction,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { getTodayDateString } from '../utils/helpers.js';

/**
 * XP is global and registered-player-only (Sections 3.2/4 of the progression spec) -- a separate
 * currency from game-specific Points, never merged with it (Section 32). Amounts here are simple
 * constants for Phase 3, same spirit as the hardcoded 5,000-points Game Level threshold in
 * progression-service.js -- easy to retune later without touching every call site.
 */
export const XP_AMOUNTS = {
    DAILY_LOGIN: 5,           // awarded inside utils/points.js#applyDailyLoginBonus()'s own transaction
    DAILY_GAME_COMPLETION: 10, // per Daily Challenge finished (any game), see awardDailyCompletionXp()
    PERFECT_DAY_BONUS: 20,     // once per day, when every registered game's Daily Challenge is done
    SHARE: 5,                  // per "Share to Facebook"/"Share with Friends" action, see awardShareXp()
};

// Overall Level, same fixed-threshold style as Game Level (progression-service.js) -- always
// derived from XP at call time, never stored, so the two can never drift apart.
//
// Stays 0-indexed internally (0-499 XP = level 0, 500-999 XP = level 1, ...), same as Game Level's
// own raw `level` field -- callers display `level + 1` so a brand-new player with 0 XP sees "Level
// 1" instead of "Level 0", exactly mirroring profile.js's `g.level + 1` display shift for Game
// Level cards (see progression/CLAUDE.md). Kept 0-indexed here rather than shifting the math
// itself since `nextLevel`/`nextLevelThreshold`/`xpToNextLevel`/`progressPercent` below are all
// clean band-boundary arithmetic in the raw numbering; the current call sites (home.js's status
// card, leaderboard/player-profile-modal.js) apply the +1 themselves at render time only.
const XP_PER_LEVEL = 500;

export function calculateOverallLevel(xp) {
    return Math.floor((xp || 0) / XP_PER_LEVEL);
}

export function calculateOverallProgress(xp) {
    const total = xp || 0;
    const level = calculateOverallLevel(total);
    const nextLevel = level + 1;
    const nextLevelThreshold = nextLevel * XP_PER_LEVEL;
    const xpToNextLevel = nextLevelThreshold - total;
    const progressPercent = Math.round(((total - level * XP_PER_LEVEL) / XP_PER_LEVEL) * 100);
    return { xp: total, level, nextLevel, nextLevelThreshold, xpToNextLevel, progressPercent };
}

/**
 * Awards XP for completing a Daily Challenge, plus the one-time "perfect day" bonus when
 * `allDailyGamesCompletedToday` is true (this completion was the last of today's Daily Challenges
 * still outstanding, per utils/points.js#checkPlayedTodayAll() taken *after* the score was
 * recorded). Registered-only: silently no-ops for a uid with no `registeredUsers` doc (guests),
 * so call sites don't need their own profile.kind check. `lastPerfectDayDate` guards the bonus to
 * once per calendar day even if this somehow gets called more than once after the last game
 * completes.
 *
 * `allDailyGamesWonToday` is a separate signal from completion -- Wordle can record a score on a
 * *loss* (6 failed guesses still writes a doc, just with fewer bonus points), so "completed all 3"
 * and "won all 3" aren't the same fact. Sudoku/Word Search Daily have no loss condition at all
 * (see their own `won: true` doc comments), so in practice only Wordle can make this false. When
 * true, on top of the perfect-day bonus above: records `lastFlawlessDayDate` (achievement-registry.js's
 * "Perfect Day", a *different*, stricter achievement than "Daily Mind Champion" -- completed vs.
 * completed-and-won) and increments `perfectDayCount` (a running lifetime tally, for "Triple
 * Threat" -- N *different* days with a perfect day, not a streak of consecutive ones).
 */
export async function awardDailyCompletionXp(uid, allDailyGamesCompletedToday, allDailyGamesWonToday) {
    const today = getTodayDateString();
    const ref = doc(db, 'registeredUsers', uid);

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const user = snap.data();

        const update = { xp: (user.xp || 0) + XP_AMOUNTS.DAILY_GAME_COMPLETION, updatedAt: serverTimestamp() };

        if (allDailyGamesCompletedToday && user.lastPerfectDayDate !== today) {
            update.xp += XP_AMOUNTS.PERFECT_DAY_BONUS;
            update.lastPerfectDayDate = today;

            if (allDailyGamesWonToday && user.lastFlawlessDayDate !== today) {
                update.lastFlawlessDayDate = today;
                update.perfectDayCount = (user.perfectDayCount || 0) + 1;
            }
        }

        tx.update(ref, update);
    });
}

/**
 * Small, generic XP bump for any of the app's "Share to Facebook"/"Share with Friends" actions --
 * game/mode-agnostic, since every share bonus ultimately targets the same registeredUsers/{uid}
 * doc regardless of which gameScores doc the Points side of the bonus landed on. Silently no-ops
 * for guests (no registeredUsers doc to update). Call only when the Points-side share bonus was
 * actually newly applied this call (not a repeat click after it's already been claimed) -- every
 * markSharedToFacebook()/markSharedWithFriends() across the app already returns `{ applied }` for
 * exactly this check.
 */
export async function awardShareXp(uid) {
    const ref = doc(db, 'registeredUsers', uid);
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const user = snap.data();
        tx.update(ref, { xp: (user.xp || 0) + XP_AMOUNTS.SHARE, updatedAt: serverTimestamp() });
    });
}
