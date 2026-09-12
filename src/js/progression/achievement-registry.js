import { GAMES } from './game-registry.js';

/**
 * Generic achievement definitions (Section 17 of the progression spec: Game/Event -> Achievement
 * Rules -> Generic Achievement Engine -> Player Achievement -- explicitly NOT a per-game
 * WordleAchievementService/SudokuAchievementService/etc). Every `evaluate(context)` is a pure
 * function over already-computed progression data (no Firestore access here), so this file has no
 * game-specific logic of its own -- it's entirely driven by the Game Registry and the thresholds
 * below.
 *
 * `context` shape (assembled by callers, currently only profile.js):
 *   {
 *     gameProgress: { [gameId]: { level, lifetimePoints, ... } }, // progression-service.js#getGameProgressByGame()
 *     totalPoints: number,   // combined lifetime Points across every game (+ loginPoints for
 *                            // registered players) -- the same number shown as "Total points"
 *     currentStreak: number, // registeredUsers.currentStreak (Phase 4)
 *     hasPerfectDay: boolean, // true once registeredUsers.lastPerfectDayDate has ever been set (Phase 3)
 *   }
 *
 * Categories: 'game', 'streak', 'exploration', 'global', and 'championship' (Phase 6). Every
 * 'championship' entry below has **no `evaluate()`** -- unlike every other category, "did I win a
 * weekly/monthly championship" isn't something profile.js can locally evaluate from progression
 * data; it depends on global periodResults data and is awarded through a completely different code
 * path (progression/championship-service.js#claimChampionshipAchievements(), an accumulating
 * `count` per win, not a one-time badge). These entries exist here purely so profile.js's
 * Achievements section has a label/description/icon to render once one is earned -- callers that
 * iterate this array to *evaluate* achievements (achievement-engine.js) must skip entries with no
 * `evaluate` function.
 *
 * IMPORTANT: every `id` here must also be listed in firestore.rules' playerAchievements
 * `allow create`/`allow update` allow-lists (rules can't import this file) -- adding an achievement
 * means updating both places, same maintenance coupling as maxCreateScore()'s gameType list.
 */

// Level 10 = 50,000 lifetime points in one game (progression-service.js's 5,000-points-per-level
// formula) -- a deliberately high bar for genuine mastery, not just having played a lot.
const GAME_MASTER_LEVEL = 10;

// Mirrors streak-service.js's own MILESTONES -- kept as a separate literal (not imported) so this
// file has zero dependency on Firestore-touching modules; if the two ever need to diverge, that's
// a deliberate future decision, not an accidental drift.
const STREAK_MILESTONES = [7, 30, 100, 365];

const EXPLORATION_TIERS = [
    { count: 5, id: 'explorer-5', label: 'Puzzle Explorer' },
    { count: 10, id: 'explorer-10', label: 'Mind Adventurer' },
    { count: 20, id: 'explorer-20', label: 'Mind Explorer' },
];

const ALL_ROUNDER_LEVEL = 1; // 5,000+ lifetime points in every registered game
const PUZZLE_COLLECTOR_POINTS = 100000;

export const ACHIEVEMENTS = [
    // Description text uses GAME_MASTER_LEVEL + 1 -- profile.js's "Your Games" cards display
    // Level as 1-indexed (Level 1 at 0 points) while this threshold is checked against the raw
    // 0-indexed value below, so the +1 keeps the wording matching what a player actually sees.
    ...Object.entries(GAMES).map(([gameId, game]) => ({
        id: `${gameId}-master`,
        category: 'game',
        label: `${game.label} Master`,
        description: `Reach Level ${GAME_MASTER_LEVEL + 1} in ${game.label}.`,
        evaluate: (ctx) => (ctx.gameProgress[gameId]?.level || 0) >= GAME_MASTER_LEVEL,
    })),

    ...STREAK_MILESTONES.map((days) => ({
        id: `streak-${days}`,
        category: 'streak',
        label: `${days} Day Streak`,
        description: `Reach a ${days}-day streak.`,
        evaluate: (ctx) => ctx.currentStreak >= days,
    })),

    ...EXPLORATION_TIERS.map(({ count, id, label }) => ({
        id,
        category: 'exploration',
        label,
        description: `Play ${count} different games.`,
        evaluate: (ctx) => Object.values(ctx.gameProgress).filter((g) => g.lifetimePoints > 0).length >= count,
    })),

    {
        id: 'daily-mind-champion',
        category: 'global',
        label: 'Daily Mind Champion',
        description: "Complete every game's Daily Challenge in a single day.",
        evaluate: (ctx) => ctx.hasPerfectDay,
    },
    {
        id: 'all-rounder',
        category: 'global',
        label: 'All-Rounder',
        // See the game-master comment above re: the +1 -- same 0-indexed-vs-displayed mismatch.
        description: `Reach Level ${ALL_ROUNDER_LEVEL + 1} in every game.`,
        evaluate: (ctx) => Object.keys(GAMES).every((gameId) => (ctx.gameProgress[gameId]?.level || 0) >= ALL_ROUNDER_LEVEL),
    },
    {
        id: 'puzzle-collector',
        category: 'global',
        label: 'Puzzle Collector',
        description: `Earn ${PUZZLE_COLLECTOR_POINTS.toLocaleString()} total lifetime Points.`,
        evaluate: (ctx) => ctx.totalPoints >= PUZZLE_COLLECTOR_POINTS,
    },

    // Championship achievements (Phase 6) -- awarded by championship-service.js, not evaluate().
    // id format `${gameId}-${periodType}ly-champion` must match that file's own construction of it.
    ...Object.entries(GAMES).flatMap(([gameId, game]) => [
        {
            id: `${gameId}-weekly-champion`,
            category: 'championship',
            label: `Weekly ${game.label} Champion`,
            description: `Top that week's ${game.label} leaderboard.`,
        },
        {
            id: `${gameId}-monthly-champion`,
            category: 'championship',
            label: `Monthly ${game.label} Champion`,
            description: `Top that month's ${game.label} leaderboard.`,
        },
    ]),
];
