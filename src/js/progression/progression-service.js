import { GAMES } from './game-registry.js';

// Spec: "Every 5,000 lifetime Points = +1 Game Level." Points never reset at level-up -- Level is
// always derived from lifetime Points, never stored, so the two can never drift out of sync.
const POINTS_PER_LEVEL = 5000;

export function calculateGameLevel(lifetimePoints) {
    return Math.floor((lifetimePoints || 0) / POINTS_PER_LEVEL);
}

/** Everything the UI needs to show progress toward the next level, derived from lifetime Points alone. */
export function calculateGameProgress(lifetimePoints) {
    const points = lifetimePoints || 0;
    const level = calculateGameLevel(points);
    const nextLevel = level + 1;
    const nextLevelThreshold = nextLevel * POINTS_PER_LEVEL;
    const pointsToNextLevel = nextLevelThreshold - points;
    const progressPercent = Math.round(((points - level * POINTS_PER_LEVEL) / POINTS_PER_LEVEL) * 100);

    return { lifetimePoints: points, level, nextLevel, nextLevelThreshold, pointsToNextLevel, progressPercent };
}

/**
 * Buckets a { [gameType]: { score, count } } map (from points.js#getUserScoreByGameType) into
 * per-game lifetime Points + Level/progress + "modes played" counts, using the Game Registry --
 * the one place that knows which gameTypes belong to which game. This is the generic engine
 * described by the progression spec: it has no Wordle/Sudoku/Word Search-specific logic of its
 * own, only what GAMES tells it. A gameType present in `byGameType` but not claimed by any
 * registered game (stale data, or a game removed from the registry) is silently excluded from
 * every game's total rather than thrown on, so this never breaks profile rendering.
 */
export function getGameProgressByGame(byGameType) {
    const progress = {};
    for (const [gameId, game] of Object.entries(GAMES)) {
        const lifetimePoints = game.scoreTypes.reduce((sum, type) => sum + (byGameType[type]?.score || 0), 0);

        const modes = {};
        for (const [modeKey, types] of Object.entries(game.modes || {})) {
            modes[modeKey] = types.reduce((sum, type) => sum + (byGameType[type]?.count || 0), 0);
        }

        progress[gameId] = {
            gameId,
            label: game.label,
            logo: game.logo,
            modes,
            ...calculateGameProgress(lifetimePoints),
        };
    }
    return progress;
}
