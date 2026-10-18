/**
 * Quilt points rules, shared by every mode (decisions D4-D6 in docs/quilt-development-plan.md).
 * Pure functions -- the mode data files call these and own the Firestore writes. Keep the caps in
 * firestore.rules' maxCreateScore() in step with the maxima noted here.
 */

export const COMPLETION_POINTS = 10;
export const PERFECT_STITCH_BONUS = 5;

/** Speed bonus by solve time: ≤3 min 10, ≤5 min 8, ≤10 min 6, otherwise 5. */
export function timeBonus(timeTakenSeconds) {
    if (timeTakenSeconds <= 180) return 10;
    if (timeTakenSeconds <= 300) return 8;
    if (timeTakenSeconds <= 600) return 6;
    return 5;
}

/**
 * Daily Challenge: 10 for completing + speed bonus + 5 for a Perfect Stitch (no undo, no removed
 * rectangle). Max 25 (rules cap: 30).
 */
export function dailyPoints({ timeTakenSeconds, perfect }) {
    const completionPoints = COMPLETION_POINTS;
    const timeBonusPoints = timeBonus(timeTakenSeconds);
    const perfectBonusPoints = perfect ? PERFECT_STITCH_BONUS : 0;
    return { completionPoints, timeBonusPoints, perfectBonusPoints, score: completionPoints + timeBonusPoints + perfectBonusPoints };
}

export const CLASSIC_MULTIPLIER = { easy: 0.8, medium: 1, hard: 1.3 };

/**
 * Classic: the Daily formula, each part scaled by difficulty (Easy ×0.8, Medium ×1, Hard ×1.3) and
 * rounded, so the breakdown lines always add up to the total. Max 33 on Hard (rules cap: 40).
 */
export function classicPoints({ timeTakenSeconds, perfect, difficulty }) {
    const m = CLASSIC_MULTIPLIER[difficulty] ?? 1;
    const base = dailyPoints({ timeTakenSeconds, perfect });
    const completionPoints = Math.round(base.completionPoints * m);
    const timeBonusPoints = Math.round(base.timeBonusPoints * m);
    const perfectBonusPoints = Math.round(base.perfectBonusPoints * m);
    return { completionPoints, timeBonusPoints, perfectBonusPoints, score: completionPoints + timeBonusPoints + perfectBonusPoints };
}

/** Patchwork Run: per tile, pass 30 / fail 10 (rules cap: 30). */
export const TOURNAMENT_TILE_PASS_POINTS = 30;
export const TOURNAMENT_TILE_FAIL_POINTS = 10;
/** +25 on top of the admin-set completion bonus when every tile passed. */
export const PERFECT_PATCHWORK_BONUS = 25;
