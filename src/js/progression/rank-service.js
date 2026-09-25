/**
 * Overall Rank (Section 14 of the progression spec) -- a coarse, prestige-style title layered on
 * top of Overall Level (xp-service.js#calculateOverallLevel()), not a replacement for it. Level
 * still increments every 1,000 XP as the frequent progress signal; Rank changes far less often.
 *
 * 10 main ranks (Novice through Legend), each split into 10 sub-ranks (Roman numerals I-X) --
 * matching the spec's own "Grandmaster III" mockup in Section 15. Unlike the original flat design
 * (every sub-rank a uniform 1,000 XP), each MAIN rank now has its own flat per-sub-rank width that
 * grows by the same amount every tier -- Novice costs 500 XP per sub-rank, Apprentice 1,000,
 * Adept 1,500, ... up to Legend at 5,000 -- so early ranks come quickly and the climb gets
 * meaningfully longer per tier, without needing 100 hand-typed thresholds. This retune (and its
 * exact per-tier widths) was decided directly with the user, replacing the original uniform
 * 10,000-XP-per-tier / 1,000-XP-per-sub-rank scheme. Total XP for the full climb (Legend X) is
 * 275,000 -- roughly a 3-year climb at a enthusiastic 250 XP/day, or ~7.5 years at a more casual
 * 100 XP/day, which was the explicit target this curve was tuned against.
 *
 * Caps permanently at Legend X once TIER_STEP_XP's total (275,000 XP) is reached -- there's no
 * 11th tier, so this is the endgame title rather than growing indefinitely. Once there, sub-rank
 * display also caps at X (see calculateRankProgress() below) -- there's nothing past "Legend X" to
 * progress toward, so the progress bar just shows full/complete rather than tracking a nonexistent
 * "next."
 */
const SUB_RANKS_PER_TIER = 10;
const SUB_RANK_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// XP required per sub-rank within each main rank, one entry per tier (index 0 = Novice ... index
// 9 = Legend) -- flat within a tier, growing by +500 every tier. The entire 100-rank curve below
// (RANK_END_XP) is generated from just these 10 numbers, so retuning the pace later means editing
// this one array, not 100 individually hand-typed thresholds.
const TIER_STEP_XP = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];

/**
 * `color` is each tier's brand/accent color, sampled directly from the user-supplied
 * `sub-ranks.png` reference sheet's own row background (not invented) -- tracked here for later
 * use (e.g. tinting rank-related UI elements) even though nothing reads it yet.
 */
export const MAIN_RANKS = [
    { tier: 1, name: 'Novice', image: '/assets/images/rank-novice.png', color: '#24752A' },
    { tier: 2, name: 'Apprentice', image: '/assets/images/rank-apprentice.png', color: '#924419' },
    { tier: 3, name: 'Adept', image: '/assets/images/rank-adept.png', color: '#185CB8' },
    { tier: 4, name: 'Skilled', image: '/assets/images/rank-skilled.png', color: '#7420B8' },
    { tier: 5, name: 'Expert', image: '/assets/images/rank-expert.png', color: '#C06E08' },
    { tier: 6, name: 'Master', image: '/assets/images/rank-master.png', color: '#BA181F' },
    { tier: 7, name: 'Grandmaster', image: '/assets/images/rank-grandmaster.png', color: '#027B8C' },
    { tier: 8, name: 'Elite', image: '/assets/images/rank-elite.png', color: '#C01E6F' },
    { tier: 9, name: 'Champion', image: '/assets/images/rank-champion.png', color: '#154FA7' },
    { tier: 10, name: 'Legend', image: '/assets/images/rank-legend.png', color: '#57145E' },
];

/**
 * Cumulative XP at the end of each of the 100 ranks, rank 1 (Novice I) through rank 100
 * (Legend X), generated from TIER_STEP_XP rather than hand-listed. `RANK_END_XP[i]` doubles as
 * the XP floor at which rank `i + 2` begins (see `rankIndexForXp()` below) -- e.g.
 * `RANK_END_XP[0]` (500) is both Novice I's own width and the XP at which Novice II begins.
 * `RANK_END_XP[RANK_END_XP.length - 1]` (275,000) is the total XP for the entire climb, though
 * it's never used as a "floor" itself since there's no rank 101.
 */
const RANK_END_XP = [];
{
    let cumulative = 0;
    for (let tier = 0; tier < TIER_STEP_XP.length; tier++) {
        for (let sub = 0; sub < SUB_RANKS_PER_TIER; sub++) {
            cumulative += TIER_STEP_XP[tier];
            RANK_END_XP.push(cumulative);
        }
    }
}

// The cumulative XP needed to fully complete each main rank tier (its own 10th sub-rank's end) --
// attached directly onto each MAIN_RANKS entry so callers (e.g. profile.js's "All Ranks" tooltip)
// don't need to recompute it themselves from TIER_STEP_XP.
MAIN_RANKS.forEach((rank, tierIndex) => {
    rank.totalXpToComplete = RANK_END_XP[(tierIndex + 1) * SUB_RANKS_PER_TIER - 1];
});

/**
 * Per-sub-rank badge art (100 images, cropped from the user's own `sub-ranks.png` reference
 * sheet -- see `src/assets/images/sub-ranks/`), used as the profile avatar so a registered
 * player's picture reflects their exact "{Rank} {Numeral}" (e.g. "Novice VII"), not just their
 * coarser main rank. `MAIN_RANKS[].image` (the original single-badge-per-tier art) is left
 * untouched and still used everywhere a *generic* tier icon is shown (the hero progress bar's
 * flanking icons, the "All Ranks" strip) -- only the avatar itself switched to this finer art.
 */
function subRankImagePath(mainRank, subRankNumber) {
    return `/assets/images/sub-ranks/${mainRank.name.toLowerCase()}-${subRankNumber}.png`;
}

// Guests don't earn XP/Rank (Section 4 of the spec) -- a separate, visually distinct badge marks
// that plainly rather than defaulting a guest into "Novice", which would misrepresent it as a
// real (if low) rank.
export const GUEST_RANK_IMAGE = '/assets/images/rank-guest.png';

/**
 * 0-indexed rank currently held (0 = Novice I ... 99 = Legend X) for a given total XP. A player is
 * always somewhere -- Novice I is free at 0 XP, same "never a gap" convention the original flat
 * version used -- and `RANK_END_XP[i]` is the XP floor for rank `i + 2`, so this just finds the
 * highest floor that's been reached. Caps at 99 (Legend X) regardless of how far past 275,000 XP
 * the player is, since there's no rank 101 to advance into.
 */
function rankIndexForXp(xp) {
    const totalXp = Math.max(xp || 0, 0);
    let index = 0;
    for (let i = 0; i < RANK_END_XP.length - 1; i++) {
        if (totalXp < RANK_END_XP[i]) break;
        index = i + 1;
    }
    return index;
}

export function calculateMainRank(xp) {
    const index = rankIndexForXp(xp);
    return MAIN_RANKS[Math.floor(index / SUB_RANKS_PER_TIER)];
}

/**
 * Full sub-rank breakdown for the profile page's rank-progress card: current "{Rank} {Numeral}"
 * label, progress within the current sub-rank band (its width varies by main rank -- see
 * `subRankWidth` below), and what's next (the following sub-rank, or the next main rank's "I" if
 * the current sub-rank is already X). Returns `isMaxRank: true` once at Legend X, since there's
 * nothing further to progress toward.
 */
export function calculateRankProgress(xp) {
    const totalXp = Math.max(xp || 0, 0);
    const index = rankIndexForXp(totalXp);
    const mainRankTierIndex = Math.floor(index / SUB_RANKS_PER_TIER);
    const subRankIndex = index % SUB_RANKS_PER_TIER;
    const mainRank = MAIN_RANKS[mainRankTierIndex];
    const isMaxRank = index === RANK_END_XP.length - 1;

    // Floor XP for the currently-held rank -- 0 for rank 1 (Novice I), else the previous rank's
    // own end.
    const currentFloorXp = index === 0 ? 0 : RANK_END_XP[index - 1];
    const subRankWidth = TIER_STEP_XP[mainRankTierIndex];
    const xpIntoSubRank = isMaxRank ? subRankWidth : totalXp - currentFloorXp;
    const xpToNextSubRank = isMaxRank ? 0 : subRankWidth - xpIntoSubRank;
    const progressPercent = isMaxRank ? 100 : Math.round((xpIntoSubRank / subRankWidth) * 100);

    // Next rank, as a flat 0-99 index -- rollover (e.g. Novice X -> Apprentice I) falls out of
    // this automatically, no separate branch needed.
    const nextIndex = Math.min(index + 1, RANK_END_XP.length - 1);
    const nextTierIndex = Math.floor(nextIndex / SUB_RANKS_PER_TIER);
    const nextSubIndex = nextIndex % SUB_RANKS_PER_TIER;
    const nextSubRankMainRank = MAIN_RANKS[nextTierIndex];
    const nextLabel = isMaxRank ? null : `${nextSubRankMainRank.name} ${SUB_RANK_NUMERALS[nextSubIndex]}`;
    const nextThresholdXp = isMaxRank ? null : RANK_END_XP[index];
    // The next sub-rank's own badge art (1-indexed sub-rank number) -- at max rank there's no
    // "next", so this just repeats the current badge, same fallback the label/mainRank fields
    // above already use.
    const nextSubRankImage = isMaxRank
        ? subRankImagePath(mainRank, subRankIndex + 1)
        : subRankImagePath(nextSubRankMainRank, nextSubIndex + 1);

    // Main-rank-level (coarser, whole-tier) progress -- separate from the sub-rank fields above.
    // Used by the profile hero's own progress bar: the side panel already shows sub-rank progress
    // in its "Current Rank" box, so the hero bar shows the complementary, coarser metric instead
    // of duplicating the same one twice on the same page.
    const atMaxMainRank = mainRankTierIndex === MAIN_RANKS.length - 1;
    const mainRankFloorXp = mainRankTierIndex === 0 ? 0 : RANK_END_XP[mainRankTierIndex * SUB_RANKS_PER_TIER - 1];
    const mainRankWidth = subRankWidth * SUB_RANKS_PER_TIER;
    const xpIntoMainRankRaw = totalXp - mainRankFloorXp;
    const nextMainRank = atMaxMainRank ? null : MAIN_RANKS[mainRankTierIndex + 1];
    const xpToNextMainRank = atMaxMainRank ? 0 : mainRankWidth - xpIntoMainRankRaw;
    const mainRankProgressPercent = atMaxMainRank ? 100 : Math.round((xpIntoMainRankRaw / mainRankWidth) * 100);

    return {
        xp: totalXp,
        mainRank,
        subRankNumeral: SUB_RANK_NUMERALS[subRankIndex],
        label: `${mainRank.name} ${SUB_RANK_NUMERALS[subRankIndex]}`,
        subRankImage: subRankImagePath(mainRank, subRankIndex + 1),
        subRankWidth,
        xpIntoSubRank,
        xpToNextSubRank,
        progressPercent,
        nextLabel,
        nextThresholdXp,
        nextSubRankMainRank,
        nextSubRankImage,
        isMaxRank,
        xpIntoMainRank: xpIntoMainRankRaw,
        xpToNextMainRank,
        mainRankProgressPercent,
        nextMainRank,
    };
}
