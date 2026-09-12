/**
 * Overall Rank (Section 14 of the progression spec) -- a coarse, prestige-style title layered on
 * top of Overall Level (xp-service.js#calculateOverallLevel()), not a replacement for it. Level
 * still increments every 500 XP as the frequent progress signal; Rank only changes every 10,000
 * XP (20 Levels per Rank tier), per the 10-tier scheme decided with the user.
 *
 * Sub-ranks: each 10,000-XP main rank band is further split into 10 sub-ranks (Roman numerals
 * I-X), 1,000 XP each -- matching the spec's own "Grandmaster III" mockup in Section 15, and
 * decided explicitly with the user (an earlier "9 sub-ranks" reading, based on ambiguous example
 * numbers, was corrected to 10 clean 1,000-XP bands).
 *
 * Caps at Legend (tier 10) for any XP at or above 90,000 -- there's no 11th tier defined, so this
 * is the permanent endgame title rather than growing indefinitely. (This was an assumption, not
 * an explicit decision -- flagged when this was built.) Once in Legend, sub-rank display also
 * caps at X (see calculateRankProgress() below) -- there's nothing past "Legend X" to progress
 * toward, so the progress bar just shows full/complete rather than tracking a nonexistent "next."
 */
const RANK_BAND_XP = 10000;
const SUB_RANK_XP = 1000;
const SUB_RANKS_PER_TIER = 10;
const SUB_RANK_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

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

export function calculateMainRank(xp) {
    const index = Math.min(Math.floor((xp || 0) / RANK_BAND_XP), MAIN_RANKS.length - 1);
    return MAIN_RANKS[index];
}

/**
 * Full sub-rank breakdown for the profile page's rank-progress card: current "{Rank} {Numeral}"
 * label, progress within the current 1,000-XP sub-rank band, and what's next (the following
 * sub-rank, or the next main rank's "I" if the current sub-rank is already X). Returns
 * `isMaxRank: true` once at Legend X, since there's nothing further to progress toward.
 */
export function calculateRankProgress(xp) {
    const totalXp = Math.max(xp || 0, 0);
    const mainRank = calculateMainRank(totalXp);
    const atMaxMainRank = mainRank.tier === MAIN_RANKS.length;

    const mainRankFloorXp = (mainRank.tier - 1) * RANK_BAND_XP;
    // Clamp so a Legend player with e.g. 500,000 XP still resolves to a valid 0-9999 position
    // within the band, rather than a subRankIndex far past the array's end.
    const xpIntoMainRank = Math.min(totalXp - mainRankFloorXp, RANK_BAND_XP - 1);

    const subRankIndex = Math.min(Math.floor(xpIntoMainRank / SUB_RANK_XP), SUB_RANKS_PER_TIER - 1);
    const isMaxRank = atMaxMainRank && subRankIndex === SUB_RANKS_PER_TIER - 1;

    const xpIntoSubRank = isMaxRank ? SUB_RANK_XP : xpIntoMainRank - subRankIndex * SUB_RANK_XP;
    const xpToNextSubRank = isMaxRank ? 0 : SUB_RANK_XP - xpIntoSubRank;
    const progressPercent = isMaxRank ? 100 : Math.round((xpIntoSubRank / SUB_RANK_XP) * 100);

    const subRankRollsOver = subRankIndex === SUB_RANKS_PER_TIER - 1; // e.g. Novice X -> Apprentice I
    const nextLabel = isMaxRank
        ? null
        : subRankRollsOver
            ? `${MAIN_RANKS[mainRank.tier].name} I`
            : `${mainRank.name} ${SUB_RANK_NUMERALS[subRankIndex + 1]}`;
    const nextThresholdXp = isMaxRank ? null : mainRankFloorXp + (subRankIndex + 1) * SUB_RANK_XP;
    // Which main-rank badge image the *next sub-rank* belongs to -- usually the same as the
    // current main rank, except right at a rollover (X -> next tier's I). Exposed explicitly
    // rather than making callers re-derive it by string-matching `nextLabel` against MAIN_RANKS.
    const nextSubRankMainRank = isMaxRank ? mainRank : subRankRollsOver ? MAIN_RANKS[mainRank.tier] : mainRank;
    // The next sub-rank's own badge art (1-indexed sub-rank number within nextSubRankMainRank) --
    // at max rank there's no "next", so this just repeats the current badge, same fallback the
    // label/mainRank fields above already use.
    const nextSubRankNumber = isMaxRank ? subRankIndex + 1 : subRankRollsOver ? 1 : subRankIndex + 2;
    const nextSubRankImage = subRankImagePath(nextSubRankMainRank, nextSubRankNumber);

    // Main-rank-level (coarser, 10,000-XP-wide) progress -- separate from the sub-rank fields
    // above. Used by the profile hero's own progress bar: the side panel already shows sub-rank
    // progress in its "Current Rank" box, so the hero bar shows the complementary, coarser metric
    // instead of duplicating the same one twice on the same page.
    const xpIntoMainRankRaw = totalXp - mainRankFloorXp;
    const nextMainRank = atMaxMainRank ? null : MAIN_RANKS[mainRank.tier];
    const xpToNextMainRank = atMaxMainRank ? 0 : RANK_BAND_XP - xpIntoMainRankRaw;
    const mainRankProgressPercent = atMaxMainRank ? 100 : Math.round((xpIntoMainRankRaw / RANK_BAND_XP) * 100);

    return {
        xp: totalXp,
        mainRank,
        subRankNumeral: SUB_RANK_NUMERALS[subRankIndex],
        label: `${mainRank.name} ${SUB_RANK_NUMERALS[subRankIndex]}`,
        subRankImage: subRankImagePath(mainRank, subRankIndex + 1),
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
