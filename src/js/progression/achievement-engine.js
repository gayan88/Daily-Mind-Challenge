import {
    doc,
    collection,
    query,
    where,
    getDocs,
    setDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { ACHIEVEMENTS } from './achievement-registry.js';
import { awardAchievementXp } from './xp-service.js';

function achievementDocId(uid, achievementId) {
    return `${uid}_${achievementId}`;
}

/** Every achievement doc this player has earned so far -- { achievementId, category, count, ... } per doc. */
export async function getPlayerAchievements(uid) {
    const q = query(collection(db, 'playerAchievements'), where('uid', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
}

/**
 * Evaluates every definition in achievement-registry.js#ACHIEVEMENTS against `context` and
 * creates a playerAchievements doc for any newly-satisfied one the player doesn't already have.
 * Called from profile.js only (Phase 5's "silent, shows up on next profile visit" surfacing
 * decision -- see docs/progression-gamification-roadmap.md) rather than from every game
 * completion, so this is the one place that assembles `context` and the one place that needs to
 * check profile.kind === 'registered' before calling (this function itself does no such check,
 * since `context` is passed in already computed -- it has no registeredUsers read of its own).
 *
 * Idempotent and safe to call on every profile visit: `setDoc` on an ID that already exists is a
 * plain Firestore `update`, which firestore.rules' playerAchievements rule doesn't allow (create
 * only, same pattern as gameScores) -- the pre-filter against `existing` below means that path is
 * only ever hit by a genuine race (e.g. two tabs open at once), not a normal repeat call.
 *
 * Returns the full, up-to-date list of earned achievement records (existing + newly created).
 */
export async function syncPlayerAchievements(uid, context) {
    const existing = await getPlayerAchievements(uid);
    const earnedIds = new Set(existing.map((a) => a.achievementId));

    // Championship-category entries have no evaluate() (see achievement-registry.js) -- they're
    // awarded by progression/championship-service.js#claimChampionshipAchievements() instead, so
    // they're skipped here rather than crashing on a missing function.
    const newlyEarned = ACHIEVEMENTS.filter((a) => a.evaluate && !earnedIds.has(a.id) && a.evaluate(context));

    await Promise.all(newlyEarned.map(async (achievement) => {
        try {
            await setDoc(doc(db, 'playerAchievements', achievementDocId(uid, achievement.id)), {
                uid,
                achievementId: achievement.id,
                category: achievement.category,
                count: 1,
                earnedAt: serverTimestamp(),
            });
            // Only after the doc create above actually succeeds -- a lost race (caught below)
            // means this achievement wasn't newly earned by *this* call, so no XP for it here.
            await awardAchievementXp(uid);
        } catch {
            // Lost a race with another write creating the same doc -- already earned, harmless no-op.
        }
    }));

    return [
        ...existing,
        ...newlyEarned.map((a) => ({ uid, achievementId: a.id, category: a.category, count: 1 })),
    ];
}
