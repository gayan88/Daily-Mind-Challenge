import {
    doc,
    collection,
    query,
    where,
    getDocs,
    runTransaction,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { getTodayDateString } from '../utils/helpers.js';
import { GAMES } from './game-registry.js';
import { checkPlayedTodayAll } from '../utils/points.js';
import { listWordleChallengesCreatedToday, getWordleChallengeAttemptCount } from '../games/wordle/wordle-challenge-data.js';

/**
 * XP reward per mission. Originally a single flat `DAILY` amount for every mission (Section 23 of
 * the progression spec); replaced with a per-mission `xp` value on each `DAILY_MISSIONS` entry
 * below once the user's own 5-mission redesign gave each one a different reward. `WEEKLY` is
 * decided but not yet used -- weekly missions are a ready-to-build follow-up, not a gap.
 */
export const MISSION_XP = {
    WEEKLY: 300, // reserved for when weekly missions are implemented
};

/**
 * Daily mission definitions -- user-specified redesign (5 missions, replacing the original 3).
 * Unlike the original set, mission #4 is deliberately Wordle-specific (the user's own spec names
 * it) -- a one-off exception to Section 23's "no hardcoded specific game" rule, since Wordle is
 * the only game with a "Challenge a Friend" feature to hang this mission on at all. Each
 * `evaluate(context)`/`progress(context)` is a pure function over `getTodayMissionContext()`'s
 * output below.
 */
export const DAILY_MISSIONS = [
    {
        id: 'daily-complete-3-challenges',
        label: 'Complete 3 Daily Challenges',
        description: 'Finish any 3 of the Daily Challenges today.',
        xp: 75,
        target: 3,
        progress: (ctx) => Math.min(ctx.dailyChallengesCompletedToday, 3),
        evaluate: (ctx) => ctx.dailyChallengesCompletedToday >= 3,
    },
    {
        id: 'daily-play-3-games',
        label: 'Play 3 Different Games',
        description: 'Play 3 different games today.',
        xp: 30,
        target: 3,
        progress: (ctx) => Math.min(ctx.distinctGamesPlayedToday, 3),
        evaluate: (ctx) => ctx.distinctGamesPlayedToday >= 3,
    },
    {
        id: 'daily-earn-1000-points',
        label: 'Earn 1,000 Points',
        description: 'Earn 1,000 Points today, across any games.',
        xp: 50,
        target: 1000,
        progress: (ctx) => Math.min(ctx.pointsEarnedToday, 1000),
        evaluate: (ctx) => ctx.pointsEarnedToday >= 1000,
    },
    {
        // Strict same-day mission, per explicit user decision: must create a NEW Wordle challenge
        // today AND have it reach 3 plays that same day -- rare, matching its outsized 300 XP
        // reward, rather than a one-time unlock whose progress carries across days.
        id: 'daily-wordle-challenge-3-plays',
        label: 'Create a Wordle Challenge & Get 3 Plays',
        description: 'Create a new Wordle challenge today and have 3 people play it today.',
        xp: 300,
        target: 3,
        progress: (ctx) => Math.min(ctx.wordleChallengeAttemptsToday, 3),
        evaluate: (ctx) => ctx.wordleChallengeAttemptsToday >= 3,
    },
    {
        // Derived entirely from today's already-fetched gameScores docs (see
        // getTodayMissionContext() below) -- no new write path needed. "Copy Result & Share with
        // Community" on any game already opens this exact Facebook group (FACEBOOK_GROUP_URL,
        // github.com/.../groups/playdailymindchallenge) and sets `sharedToFacebook`, so this
        // mission just wraps that existing signal with its own separate XP reward on top.
        id: 'daily-share-facebook-group',
        label: 'Share a Daily Mind Challenge Post to a Facebook Group',
        description: 'Use "Copy Result & Share with Community" on any game today.',
        xp: 30,
        target: 1,
        progress: (ctx) => (ctx.sharedToFacebookToday ? 1 : 0),
        evaluate: (ctx) => ctx.sharedToFacebookToday === true,
    },
];

// gameType -> gameId, built once from the registry -- lets getTodayMissionContext() figure out
// which *game* each of today's gameScores docs belongs to without hardcoding any of them.
const GAME_TYPE_TO_GAME_ID = new Map();
Object.entries(GAMES).forEach(([gameId, game]) => {
    game.scoreTypes.forEach((type) => GAME_TYPE_TO_GAME_ID.set(type, gameId));
});

/** Highest attempt count across any Wordle challenge this user created since local midnight --
 * 0 if they haven't created one today. Two-step read (list today's challenges, then count each
 * one's attempts), so it's kept separate from the single-query fields below rather than forced
 * into the same Promise.all entry. */
async function getTodaysWordleChallengeMaxAttempts(uid) {
    const todaysChallenges = await listWordleChallengesCreatedToday(uid);
    if (todaysChallenges.length === 0) return 0;
    const counts = await Promise.all(todaysChallenges.map((c) => getWordleChallengeAttemptCount(c.id)));
    return Math.max(...counts);
}

/**
 * Assembles today's mission-evaluation context. Entirely derived from existing `gameScores` data
 * for `scoreDate == today` (any mode -- Daily/Classic/Tournament/Challenge all count toward
 * "played a game" and "earned points"), plus `utils/points.js#checkPlayedTodayAll()` specifically
 * for "completed a Daily Challenge" (that function's `gameDate` filter is only reliable for the
 * base Daily Challenge gameTypes (one per game), which is exactly what this one mission needs -- see its
 * own doc comment), plus `getTodaysWordleChallengeMaxAttempts()` for the Wordle-specific mission.
 * `sharedToFacebookToday` costs no extra read -- it's just checked off the same `gameScores` docs
 * already fetched for `pointsEarnedToday`/`distinctGamesPlayedToday`. No mission progress is
 * stored anywhere; it's recomputed on every call, same "prefer deriving over storing" principle
 * as Game Level.
 */
async function getTodayMissionContext(uid) {
    const today = getTodayDateString();

    const [dailyChallenges, todaySnap, wordleChallengeAttemptsToday] = await Promise.all([
        checkPlayedTodayAll(uid),
        getDocs(query(collection(db, 'gameScores'), where('userId', '==', uid), where('scoreDate', '==', today))),
        getTodaysWordleChallengeMaxAttempts(uid),
    ]);

    const dailyChallengesCompletedToday = Object.values(dailyChallenges).filter(Boolean).length;

    const gameIdsToday = new Set();
    let pointsEarnedToday = 0;
    let sharedToFacebookToday = false;
    todaySnap.docs.forEach((d) => {
        const data = d.data();
        pointsEarnedToday += data.score;
        if (data.sharedToFacebook) sharedToFacebookToday = true;
        const gameId = GAME_TYPE_TO_GAME_ID.get(data.gameType);
        if (gameId) gameIdsToday.add(gameId);
    });

    return {
        dailyChallengesCompletedToday,
        distinctGamesPlayedToday: gameIdsToday.size,
        pointsEarnedToday,
        sharedToFacebookToday,
        wordleChallengeAttemptsToday,
    };
}

function missionDocId(uid, missionId, periodKey) {
    return `${uid}_${missionId}_${periodKey}`;
}

/**
 * Evaluates today's Daily missions and awards XP for any newly-completed one the player hasn't
 * already claimed today, via one `playerMissions/{uid}_{missionId}_{today}` doc per mission per
 * day (create-only, so a reward can never be double-awarded even across multiple visits/tabs the
 * same day) plus an `xp` increment on the same transaction. Registered-only: callers must already
 * be scoped to registered players (this function does no `profile.kind` check itself, mirroring
 * achievement-engine.js's contract). Called from profile.js on every visit -- "silent" surfacing,
 * same decision as Phase 5's achievements.
 *
 * Returns `{ context, completedMissionIds, xpAwarded }` so the caller can render today's mission
 * progress without a second, duplicate context fetch, and keep any in-memory profile object's
 * `xp` in sync with what was actually just written (same reasoning as app.js's login-bonus XP
 * sync -- otherwise a page rendering Overall Level/XP from a profile object loaded *before* this
 * call would show a stale, pre-mission-reward value).
 */
export async function syncDailyMissions(uid) {
    const today = getTodayDateString();
    const context = await getTodayMissionContext(uid);

    const q = query(collection(db, 'playerMissions'), where('uid', '==', uid), where('periodKey', '==', today));
    const existingSnap = await getDocs(q);
    const claimedIds = new Set(existingSnap.docs.map((d) => d.data().missionId));

    const newlyCompleted = DAILY_MISSIONS.filter((m) => !claimedIds.has(m.id) && m.evaluate(context));

    const results = await Promise.all(newlyCompleted.map(async (mission) => {
        const missionRef = doc(db, 'playerMissions', missionDocId(uid, mission.id, today));
        const userRef = doc(db, 'registeredUsers', uid);
        try {
            await runTransaction(db, async (tx) => {
                const userSnap = await tx.get(userRef);
                if (!userSnap.exists()) return;

                tx.set(missionRef, {
                    uid,
                    missionId: mission.id,
                    periodType: 'daily',
                    periodKey: today,
                    xpAwarded: mission.xp,
                    completedAt: serverTimestamp(),
                });
                tx.update(userRef, { xp: (userSnap.data().xp || 0) + mission.xp });
            });
            return mission.xp;
        } catch {
            // Lost a race (e.g. two tabs open) -- already awarded, harmless no-op.
            return 0;
        }
    }));

    return {
        context,
        completedMissionIds: new Set([...claimedIds, ...newlyCompleted.map((m) => m.id)]),
        xpAwarded: results.reduce((sum, xp) => sum + xp, 0),
    };
}
