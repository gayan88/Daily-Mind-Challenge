/**
 * Pounce points rules, shared by every mode (decisions D4–D6 in docs/pounce-development-plan.md).
 * Pure functions -- the mode data files call these and own the Firestore writes. Keep the caps in
 * firestore.rules' maxCreateScore() in step with the maxima noted here.
 */

export const COMPLETION_POINTS = 10;
export const PURRFECT_BONUS = 5;
export const MISTAKE_COST = 2;
export const TIP_COST = 3;
/** A solve never scores less than this before the Purrfect bonus (which needs no mistakes/tips anyway). */
export const MIN_SOLVE_POINTS = 5;

/** Speed bonus by solve time: ≤2 min 10, ≤4 min 8, ≤8 min 6, otherwise 5. */
export function timeBonus(timeTakenSeconds) {
    if (timeTakenSeconds <= 120) return 10;
    if (timeTakenSeconds <= 240) return 8;
    if (timeTakenSeconds <= 480) return 6;
    return 5;
}

/**
 * Daily Challenge: 10 for solving + speed bonus − 2 per hiss (wrong cat) − 3 per Whisker Tip, never
 * below 5, + 5 for a Purrfect solve (no hisses, no tips). Max 25 (rules cap: 30).
 * `penaltyPoints` is the (≤ 0) deduction actually applied, so the breakdown always adds up.
 */
export function dailyPoints({ timeTakenSeconds, mistakes = 0, tips = 0, perfect }) {
    const completionPoints = COMPLETION_POINTS;
    const timeBonusPoints = timeBonus(timeTakenSeconds);
    const before = completionPoints + timeBonusPoints;
    const afterPenalty = Math.max(MIN_SOLVE_POINTS, before - MISTAKE_COST * mistakes - TIP_COST * tips);
    const penaltyPoints = afterPenalty - before;
    const perfectBonusPoints = perfect ? PURRFECT_BONUS : 0;
    return { completionPoints, timeBonusPoints, penaltyPoints, perfectBonusPoints, score: afterPenalty + perfectBonusPoints };
}

export const CLASSIC_MULTIPLIER = { easy: 0.8, medium: 1, hard: 1.3 };

/**
 * Classic: the Daily formula, each part scaled by difficulty (Easy ×0.8, Medium ×1, Hard ×1.3) and
 * rounded, so the breakdown lines always add up to the total. Max 33 on Hard (rules cap: 40).
 */
export function classicPoints({ timeTakenSeconds, mistakes, tips, perfect, difficulty }) {
    const m = CLASSIC_MULTIPLIER[difficulty] ?? 1;
    const base = dailyPoints({ timeTakenSeconds, mistakes, tips, perfect });
    const completionPoints = Math.round(base.completionPoints * m);
    const timeBonusPoints = Math.round(base.timeBonusPoints * m);
    const penaltyPoints = Math.round(base.penaltyPoints * m);
    const perfectBonusPoints = Math.round(base.perfectBonusPoints * m);
    return {
        completionPoints, timeBonusPoints, penaltyPoints, perfectBonusPoints,
        score: completionPoints + timeBonusPoints + penaltyPoints + perfectBonusPoints,
    };
}
