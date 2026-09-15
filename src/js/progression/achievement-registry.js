import { GAMES } from './game-registry.js';

/**
 * Generic achievement definitions (Section 17 of the progression spec: Game/Event -> Achievement
 * Rules -> Generic Achievement Engine -> Player Achievement -- explicitly NOT a per-game
 * WordleAchievementService/SudokuAchievementService/etc). Every `evaluate(context)` is a pure
 * function over already-computed progression data (no Firestore access here), so this file has no
 * game-specific logic of its own -- it's entirely driven by the Game Registry and the thresholds
 * below.
 *
 * This is the user's own full replacement list (67 achievements total), superseding the earlier,
 * smaller registry entirely -- old ids not in this list (wordle-master at the old Level 10
 * threshold, explorer-5/10/20, puzzle-collector, and the old single non-tiered championship ids)
 * just stop being evaluated; any already-earned `playerAchievements` docs under those ids are
 * harmless orphans, no migration needed, same as every earlier id rename in this app.
 *
 * `context` shape (assembled by profile.js):
 *   {
 *     gameProgress: { [gameId]: { level, lifetimePoints, ... } }, // progression-service.js#getGameProgressByGame()
 *     totalPoints: number,           // combined lifetime Points across every game (+ loginPoints for registered players)
 *     totalGamesPlayed: number,      // sum of gameScores doc counts across every gameType, all 3 games
 *     currentStreak: number,         // registeredUsers.currentStreak
 *     hasPerfectDay: boolean,        // true once registeredUsers.lastPerfectDayDate has ever been set (completed all 3, any outcome)
 *     hasFlawlessDay: boolean,       // true once registeredUsers.lastFlawlessDayDate has ever been set (completed AND won all 3)
 *     perfectDayCount: number,       // registeredUsers.perfectDayCount -- lifetime count of distinct perfect (all-3-completed) days
 *     championshipTallies: { [gameId]: { day, week, month } }, // championship-service.js#getChampionshipTallies()
 *   }
 *
 * Categories: 'game', 'streak', 'global', and 'championship'.
 *
 * Every 'championship' entry has **no `evaluate()`** -- unlike every other category, "did I win a
 * period" isn't something profile.js can locally evaluate from progression data alone; it depends
 * on global periodResults data and is awarded through a completely different code path
 * (progression/championship-service.js#claimChampionshipAchievements()). Each win-count milestone
 * (1/7/30/50/100 Daily wins, etc.) is its own separate one-time achievement id -- not one
 * achievement whose `count` accumulates -- see championship-service.js's own doc comment for why.
 * These entries DO have a `progress()`, sourced from `context.championshipTallies` (the running
 * win count), so an unearned tier can still show "12 / 30" in the UI.
 *
 * Most other entries also carry an optional `progress(context)` + `target` pair -- used by
 * profile.js to sort an unearned achievement into "In Progress" (progress > 0) vs. "Not Started"
 * (progress === 0), and to render a "current / target" line + bar for the former. `progress()`
 * always returns the same unit as `target` (already clamped to it), not a percentage. A few
 * entries deliberately have **no** `progress()` -- `daily-mind-champion` and `perfect-day` --
 * because "did I have one" isn't a cumulative fraction; those stay binary (Completed once true,
 * Not Started until then, never "In Progress").
 *
 * IMPORTANT: every `id` here must also be listed in firestore.rules' playerAchievements
 * `allow create` allow-list (rules can't import this file) -- adding an achievement means updating
 * both places, same maintenance coupling as maxCreateScore()'s gameType list.
 */

// Per-game level tiers -- raw 0-indexed thresholds (progression-service.js's Game Level is
// 0-indexed; profile.js's "Your Games" cards display level+1, so "Level 25" as stated by the user
// means raw threshold 24 -- same +1 display convention used throughout this file).
const LEVEL_TIERS = [
    { suffix: 'expert', label: 'Expert', rawLevel: 24 },
    { suffix: 'master', label: 'Master', rawLevel: 49 },
    { suffix: 'grandmaster', label: 'Grand Master', rawLevel: 99 },
];

// Championship win-count tiers per period type -- must exactly match
// championship-service.js#CHAMPIONSHIP_TIERS. Kept as a separate literal here (this file stays
// Firestore-free and can't import that one), same precedent as streak-service.js's own milestones
// vs. this file's STREAK_MILESTONES below.
const CHAMPIONSHIP_TIERS = { day: [1, 7, 30, 50, 100], week: [1, 5, 10, 25, 50], month: [1, 3, 6, 9, 12] };
const PERIOD_LABEL = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
const PERIOD_ID = { day: 'daily', week: 'weekly', month: 'monthly' };

const STREAK_MILESTONES = [7, 30, 100, 200, 365];

// Custom illustrated badge art for specific achievements, keyed by id -- everything else just
// uses its category's emoji (profile.js's own ACHIEVEMENT_CATEGORY_ICON). User-supplied artwork,
// cropped/resized from originals in src/assets/images/New/. Applied as a final pass over the
// ACHIEVEMENTS array below rather than inlined into each entry, so dropping in more art later
// never means hand-editing the achievement definitions themselves.
const CUSTOM_IMAGES = {
    'wordle-expert': '/assets/images/achievements/wordle-expert.png',
    'wordle-master': '/assets/images/achievements/wordle-master.png',
    'wordle-grandmaster': '/assets/images/achievements/wordle-grandmaster.png',

    'wordle-daily-champion': '/assets/images/achievements/wordle-daily-champion.png',
    'wordle-daily-champion-7': '/assets/images/achievements/wordle-daily-champion-7.png',
    'wordle-daily-champion-30': '/assets/images/achievements/wordle-daily-champion-30.png',
    'wordle-daily-champion-50': '/assets/images/achievements/wordle-daily-champion-50.png',
    'wordle-daily-champion-100': '/assets/images/achievements/wordle-daily-champion-100.png',

    'wordle-weekly-champion': '/assets/images/achievements/wordle-weekly-champion.png',
    'wordle-weekly-champion-5': '/assets/images/achievements/wordle-weekly-champion-5.png',
    'wordle-weekly-champion-10': '/assets/images/achievements/wordle-weekly-champion-10.png',
    'wordle-weekly-champion-25': '/assets/images/achievements/wordle-weekly-champion-25.png',
    'wordle-weekly-champion-50': '/assets/images/achievements/wordle-weekly-champion-50.png',

    'wordle-monthly-champion': '/assets/images/achievements/wordle-monthly-champion.png',
    'wordle-monthly-champion-3': '/assets/images/achievements/wordle-monthly-champion-3.png',
    'wordle-monthly-champion-6': '/assets/images/achievements/wordle-monthly-champion-6.png',
    'wordle-monthly-champion-9': '/assets/images/achievements/wordle-monthly-champion-9.png',
    'wordle-monthly-champion-12': '/assets/images/achievements/wordle-monthly-champion-12.png',

    'sudoku-expert': '/assets/images/achievements/sudoku-expert.png',
    'sudoku-master': '/assets/images/achievements/sudoku-master.png',
    'sudoku-grandmaster': '/assets/images/achievements/sudoku-grandmaster.png',

    'sudoku-daily-champion': '/assets/images/achievements/sudoku-daily-champion.png',
    'sudoku-daily-champion-7': '/assets/images/achievements/sudoku-daily-champion-7.png',
    'sudoku-daily-champion-30': '/assets/images/achievements/sudoku-daily-champion-30.png',
    'sudoku-daily-champion-50': '/assets/images/achievements/sudoku-daily-champion-50.png',
    'sudoku-daily-champion-100': '/assets/images/achievements/sudoku-daily-champion-100.png',

    'sudoku-weekly-champion': '/assets/images/achievements/sudoku-weekly-champion.png',
    'sudoku-weekly-champion-5': '/assets/images/achievements/sudoku-weekly-champion-5.png',
    'sudoku-weekly-champion-10': '/assets/images/achievements/sudoku-weekly-champion-10.png',
    'sudoku-weekly-champion-25': '/assets/images/achievements/sudoku-weekly-champion-25.png',
    'sudoku-weekly-champion-50': '/assets/images/achievements/sudoku-weekly-champion-50.png',

    'sudoku-monthly-champion': '/assets/images/achievements/sudoku-monthly-champion.png',
    'sudoku-monthly-champion-3': '/assets/images/achievements/sudoku-monthly-champion-3.png',
    'sudoku-monthly-champion-6': '/assets/images/achievements/sudoku-monthly-champion-6.png',
    'sudoku-monthly-champion-9': '/assets/images/achievements/sudoku-monthly-champion-9.png',
    'sudoku-monthly-champion-12': '/assets/images/achievements/sudoku-monthly-champion-12.png',

    'wordsearch-expert': '/assets/images/achievements/wordsearch-expert.png',
    'wordsearch-master': '/assets/images/achievements/wordsearch-master.png',
    'wordsearch-grandmaster': '/assets/images/achievements/wordsearch-grandmaster.png',

    'wordsearch-daily-champion': '/assets/images/achievements/wordsearch-daily-champion.png',
    'wordsearch-daily-champion-7': '/assets/images/achievements/wordsearch-daily-champion-7.png',
    'wordsearch-daily-champion-30': '/assets/images/achievements/wordsearch-daily-champion-30.png',
    'wordsearch-daily-champion-50': '/assets/images/achievements/wordsearch-daily-champion-50.png',
    'wordsearch-daily-champion-100': '/assets/images/achievements/wordsearch-daily-champion-100.png',

    'wordsearch-weekly-champion': '/assets/images/achievements/wordsearch-weekly-champion.png',
    'wordsearch-weekly-champion-5': '/assets/images/achievements/wordsearch-weekly-champion-5.png',
    'wordsearch-weekly-champion-10': '/assets/images/achievements/wordsearch-weekly-champion-10.png',
    'wordsearch-weekly-champion-25': '/assets/images/achievements/wordsearch-weekly-champion-25.png',
    'wordsearch-weekly-champion-50': '/assets/images/achievements/wordsearch-weekly-champion-50.png',

    'wordsearch-monthly-champion': '/assets/images/achievements/wordsearch-monthly-champion.png',
    'wordsearch-monthly-champion-3': '/assets/images/achievements/wordsearch-monthly-champion-3.png',
    'wordsearch-monthly-champion-6': '/assets/images/achievements/wordsearch-monthly-champion-6.png',
    'wordsearch-monthly-champion-9': '/assets/images/achievements/wordsearch-monthly-champion-9.png',
    'wordsearch-monthly-champion-12': '/assets/images/achievements/wordsearch-monthly-champion-12.png',

    'streak-7': '/assets/images/achievements/streak-7.png',
    'streak-30': '/assets/images/achievements/streak-30.png',
    'streak-100': '/assets/images/achievements/streak-100.png',
    'streak-200': '/assets/images/achievements/streak-200.png',
    'streak-365': '/assets/images/achievements/streak-365.png',

    'daily-mind-champion': '/assets/images/achievements/daily-mind-champion.png',
    'perfect-day': '/assets/images/achievements/perfect-day.png',
    'triple-threat': '/assets/images/achievements/triple-threat.png',
    'all-rounder': '/assets/images/achievements/all-rounder.png',
    'puzzle-enthusiast': '/assets/images/achievements/puzzle-enthusiast.png',
    'mind-master': '/assets/images/achievements/mind-master.png',
    'puzzle-addict': '/assets/images/achievements/puzzle-addict.png',
    'mind-athlete': '/assets/images/achievements/mind-athlete.png',
};

// "All 3 games at once" level tiers -- a lower per-game bar than LEVEL_TIERS above, since it
// requires every game simultaneously. Same raw-0-indexed / +1-display convention.
const ALL_GAMES_TIERS = [
    { id: 'all-rounder', label: 'All-Rounder', rawLevel: 1 },
    { id: 'puzzle-enthusiast', label: 'Puzzle Enthusiast', rawLevel: 4 },
    { id: 'mind-master', label: 'Mind Master', rawLevel: 9 },
];

const PUZZLE_ADDICT_GAMES_PLAYED = 100;
const MIND_ATHLETE_POINTS = 10000;
const TRIPLE_THREAT_DAYS = 7;

export const ACHIEVEMENTS = [
    // Per-game level tiers (Expert / Master / Grand Master). `family` groups tiers that share the
    // same underlying progress number (here, one game's Level) -- see profile.js's
    // renderAchievements() for why: without it, every not-yet-reached tier in a family would show
    // the exact same "in progress" number simultaneously (e.g. Level 16 showing as "in progress"
    // toward Expert *and* Master *and* Grand Master at once), instead of just the next one up.
    ...Object.entries(GAMES).flatMap(([gameId, game]) =>
        LEVEL_TIERS.map(({ suffix, label, rawLevel }) => ({
            id: `${gameId}-${suffix}`,
            category: 'game',
            label: `${game.label} ${label}`,
            description: `Reach Level ${rawLevel + 1} in ${game.label}.`,
            evaluate: (ctx) => (ctx.gameProgress[gameId]?.level || 0) >= rawLevel,
            progress: (ctx) => Math.min((ctx.gameProgress[gameId]?.level || 0) + 1, rawLevel + 1),
            target: rawLevel + 1,
            family: `${gameId}-level`,
        }))
    ),

    // Per-game Championship win tiers (Daily/Weekly/Monthly x each game). No evaluate() -- awarded
    // externally by championship-service.js#claimChampionshipAchievements(); progress() reads the
    // running win tally from context.championshipTallies.
    ...Object.entries(GAMES).flatMap(([gameId, game]) =>
        Object.keys(CHAMPIONSHIP_TIERS).flatMap((periodType) =>
            CHAMPIONSHIP_TIERS[periodType].map((tierCount) => {
                const periodLabel = PERIOD_LABEL[periodType];
                const isFirstTier = tierCount === 1;
                return {
                    id: isFirstTier
                        ? `${gameId}-${PERIOD_ID[periodType]}-champion`
                        : `${gameId}-${PERIOD_ID[periodType]}-champion-${tierCount}`,
                    category: 'championship',
                    label: isFirstTier
                        ? `${game.label} ${periodLabel} Champion`
                        : `${game.label} ${periodLabel} Champion - ${tierCount} Times`,
                    description: isFirstTier
                        ? `Become ${game.label} ${periodLabel} Champion once.`
                        : `Become ${game.label} ${periodLabel} Champion ${tierCount} times.`,
                    progress: (ctx) => Math.min(ctx.championshipTallies?.[gameId]?.[periodType] || 0, tierCount),
                    target: tierCount,
                    family: `${gameId}-${periodType}-champion`,
                };
            })
        )
    ),

    // Global: streaks. One family -- there's only one currentStreak number, so without grouping,
    // every not-yet-reached milestone would show it as "in progress" simultaneously.
    ...STREAK_MILESTONES.map((days) => ({
        id: `streak-${days}`,
        category: 'streak',
        label: `${days} Day Streak`,
        family: 'streak',
        description: `Play for ${days} consecutive days.`,
        evaluate: (ctx) => ctx.currentStreak >= days,
        progress: (ctx) => Math.min(ctx.currentStreak, days),
        target: days,
    })),

    {
        id: 'daily-mind-champion',
        category: 'global',
        label: 'Daily Mind Champion',
        description: 'Complete all 3 Daily Challenges in a single day.',
        evaluate: (ctx) => ctx.hasPerfectDay,
        // No progress() -- "did I ever have one" isn't a cumulative fraction.
    },
    {
        id: 'perfect-day',
        category: 'global',
        label: 'Perfect Day',
        description: 'Complete all 3 Daily Challenges without making an error.',
        // Stricter than Daily Mind Champion above: also requires having *won* all 3, not just
        // completed them (Wordle can record a score on a loss; Sudoku/Word Search Daily have no
        // loss condition at all, so this only ever meaningfully gates on Wordle -- see
        // xp-service.js#awardDailyCompletionXp()'s own doc comment for the full reasoning).
        evaluate: (ctx) => ctx.hasFlawlessDay,
    },
    {
        id: 'triple-threat',
        category: 'global',
        label: 'Triple Threat',
        description: `Complete all 3 Daily Challenges on ${TRIPLE_THREAT_DAYS} different days.`,
        evaluate: (ctx) => (ctx.perfectDayCount || 0) >= TRIPLE_THREAT_DAYS,
        progress: (ctx) => Math.min(ctx.perfectDayCount || 0, TRIPLE_THREAT_DAYS),
        target: TRIPLE_THREAT_DAYS,
    },

    // family: 'all-games-level' -- these three all share `target` (3, always -- "how many of the
    // 3 games meet the threshold"), so `familyOrder` (the actual rawLevel each tier needs) is what
    // determines which one is "next" within the family, not `target` itself.
    ...ALL_GAMES_TIERS.map(({ id, label, rawLevel }) => ({
        id,
        category: 'global',
        label,
        description: `Reach Level ${rawLevel + 1} in all 3 games.`,
        evaluate: (ctx) => Object.keys(GAMES).every((gameId) => (ctx.gameProgress[gameId]?.level || 0) >= rawLevel),
        progress: (ctx) => Object.keys(GAMES).filter((gameId) => (ctx.gameProgress[gameId]?.level || 0) >= rawLevel).length,
        target: Object.keys(GAMES).length,
        family: 'all-games-level',
        familyOrder: rawLevel,
    })),

    {
        id: 'puzzle-addict',
        category: 'global',
        label: 'Puzzle Addict',
        description: `Play ${PUZZLE_ADDICT_GAMES_PLAYED} games.`,
        evaluate: (ctx) => (ctx.totalGamesPlayed || 0) >= PUZZLE_ADDICT_GAMES_PLAYED,
        progress: (ctx) => Math.min(ctx.totalGamesPlayed || 0, PUZZLE_ADDICT_GAMES_PLAYED),
        target: PUZZLE_ADDICT_GAMES_PLAYED,
    },
    {
        id: 'mind-athlete',
        category: 'global',
        label: 'Mind Athlete',
        description: `Earn ${MIND_ATHLETE_POINTS.toLocaleString()} total points.`,
        evaluate: (ctx) => ctx.totalPoints >= MIND_ATHLETE_POINTS,
        progress: (ctx) => Math.min(ctx.totalPoints, MIND_ATHLETE_POINTS),
        target: MIND_ATHLETE_POINTS,
    },
].map((a) => (CUSTOM_IMAGES[a.id] ? { ...a, image: CUSTOM_IMAGES[a.id] } : a));
