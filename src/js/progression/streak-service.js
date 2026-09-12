import {
    doc,
    runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { getTodayDateString, isConsecutiveDay } from '../utils/helpers.js';

// Streak "badges" at these counts aren't real yet (the Achievement Engine is Phase 5) -- for
// Phase 4 this only drives a visual highlight (see getStreakMilestoneTier()), by explicit product
// decision, so there's nothing here to migrate once Phase 5 adds real badges for the same numbers.
const MILESTONES = [7, 30, 100, 365];

/** Highest milestone `streak` has reached, or null below the first one -- profile.js uses this to
 * pick an escalating visual style for the streak line, not to gate anything functional. */
export function getStreakMilestoneTier(streak) {
    let tier = null;
    for (const milestone of MILESTONES) {
        if (streak >= milestone) tier = milestone;
    }
    return tier;
}

/**
 * Advances the player's streak on their first completed Daily Challenge of the day. Phase 4 of
 * the progression spec redefines "streak day" from simply logging in (the previous behavior,
 * still visible in git history in utils/points.js#applyDailyLoginBonus()) to actually playing,
 * while continuing to reuse the same `currentStreak` counter -- by explicit product decision, so
 * an existing player's streak number carries over as a starting point instead of resetting to 0.
 *
 * `lastStreakDate` is a new field, deliberately separate from `lastLoginDate`: `lastLoginDate`
 * must keep meaning "last day the login Points bonus was claimed" untouched by this, or playing a
 * game before that bonus runs (on page load, via applyDailyLoginBonus()) would silently make it
 * look already-claimed for the day and skip it.
 *
 * The one-time transition case -- a player with a real `currentStreak` from the old login-based
 * era but no `lastStreakDate` yet (this function has never run for them before) -- is treated as
 * "yesterday was fine," continuing their existing count by +1 rather than restarting at 1; see the
 * product decision recorded in docs/progression-gamification-roadmap.md's Phase 4 section.
 *
 * Registered-only: silently no-ops for a uid with no `registeredUsers` doc (guests). Idempotent
 * per day -- completing a second, different game's Daily Challenge the same day doesn't advance
 * the streak again.
 */
export async function advanceStreakForDailyCompletion(uid) {
    const today = getTodayDateString();
    const ref = doc(db, 'registeredUsers', uid);

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const user = snap.data();

        if (user.lastStreakDate === today) return;

        let newStreak;
        if (!user.lastStreakDate && user.currentStreak > 0) {
            newStreak = user.currentStreak + 1;
        } else {
            newStreak = isConsecutiveDay(user.lastStreakDate, today) ? (user.currentStreak || 0) + 1 : 1;
        }

        tx.update(ref, { currentStreak: newStreak, lastStreakDate: today });
    });
}
