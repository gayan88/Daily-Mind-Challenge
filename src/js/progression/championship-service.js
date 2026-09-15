import {
    doc,
    getDoc,
    collection,
    query,
    where,
    documentId,
    getDocs,
    setDoc,
    runTransaction,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { getTodayDateString, addDaysToDateString, getISOWeekInfo, getISOWeekMonday } from '../utils/helpers.js';
import { GAMES } from './game-registry.js';
import { getGameScoresForDateRange } from '../leaderboard/leaderboard-data.js';
import { awardAchievementXp } from './xp-service.js';

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** The most recently CLOSED calendar day relative to `today` -- "yesterday." */
export function getPreviousDayPeriod(today = getTodayDateString()) {
    const date = addDaysToDateString(today, -1);
    return { periodKey: date, startDate: date, endDate: date };
}

/** The most recently CLOSED ISO week relative to `today` -- last week, never the still-in-progress
 * current one. `periodKey` matches Section 20 of the progression spec's exact format
 * ("2026-W36"). */
export function getPreviousWeekPeriod(today = getTodayDateString()) {
    const thisWeekMonday = getISOWeekMonday(today);
    const startDate = addDaysToDateString(thisWeekMonday, -7);
    const endDate = addDaysToDateString(startDate, 6);
    const { isoYear, week } = getISOWeekInfo(startDate);
    return { periodKey: `${isoYear}-W${pad2(week)}`, startDate, endDate };
}

/** The most recently CLOSED calendar month relative to `today`. */
export function getPreviousMonthPeriod(today = getTodayDateString()) {
    const [year, month] = today.split('-').map(Number);
    const py = month === 1 ? year - 1 : year;
    const pm = month === 1 ? 12 : month - 1;
    const startDate = `${py}-${pad2(pm)}-01`;
    const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate(); // day 0 of next month = last day of pm
    const endDate = `${py}-${pad2(pm)}-${pad2(lastDay)}`;
    return { periodKey: `${py}-${pad2(pm)}`, startDate, endDate };
}

const PREVIOUS_PERIOD_FN = { day: getPreviousDayPeriod, week: getPreviousWeekPeriod, month: getPreviousMonthPeriod };

/**
 * Same period shape as PREVIOUS_PERIOD_FN's single-step functions above, but `n` steps back
 * instead of always exactly 1 -- used only by the admin backfill scan (getMissingPeriods()) to
 * walk further into the past looking for gaps. Kept separate from getPreviousWeekPeriod()/
 * getPreviousMonthPeriod() (rather than rewriting them in terms of this) so those two -- already
 * relied on elsewhere -- stay untouched.
 */
function getPeriodNStepsBack(periodType, n, today = getTodayDateString()) {
    if (periodType === 'day') {
        const date = addDaysToDateString(today, -n);
        return { periodKey: date, startDate: date, endDate: date };
    }
    if (periodType === 'week') {
        const thisWeekMonday = getISOWeekMonday(today);
        const startDate = addDaysToDateString(thisWeekMonday, -7 * n);
        const endDate = addDaysToDateString(startDate, 6);
        const { isoYear, week } = getISOWeekInfo(startDate);
        return { periodKey: `${isoYear}-W${pad2(week)}`, startDate, endDate };
    }
    // month
    const [year, month] = today.split('-').map(Number);
    const totalMonthIndex = year * 12 + (month - 1) - n; // 0-indexed months since year 0
    const py = Math.floor(totalMonthIndex / 12);
    const pm = totalMonthIndex % 12; // 0-indexed month within py
    const startDate = `${py}-${pad2(pm + 1)}-01`;
    const lastDay = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
    const endDate = `${py}-${pad2(pm + 1)}-${pad2(lastDay)}`;
    return { periodKey: `${py}-${pad2(pm + 1)}`, startDate, endDate };
}

// How many periods back the admin backfill scan is willing to look for gaps -- bounded so a
// brand-new game/period combination (or one that's never been finalized) doesn't trigger an
// unbounded historical scan. Well beyond any realistic "forgot to click" gap.
const MAX_BACKFILL_LOOKBACK = { day: 30, week: 12, month: 12 };

/**
 * The instant (as a `Date.now()`-comparable ms timestamp) at which a period is safe to finalize --
 * 12 hours after the period's own end-date rolls over in UTC, so that even the furthest-behind
 * timezone on Earth (UTC-12) has already crossed into the next period locally. Timezone-agnostic
 * by construction: it's a single absolute instant, not tied to the admin's own timezone -- the
 * admin UI just renders it in whatever local time the viewing browser happens to be in.
 */
export function periodSafeInstant(period) {
    const nextDay = addDaysToDateString(period.endDate, 1);
    const [y, m, d] = nextDay.split('-').map(Number);
    const periodCloseUTC = Date.UTC(y, m - 1, d); // UTC midnight of the day after the period ends
    return periodCloseUTC + 12 * 60 * 60 * 1000;
}

export function isPeriodSafeToFinalize(period) {
    return Date.now() >= periodSafeInstant(period);
}

function periodResultDocId(gameId, periodType, periodKey) {
    return `${gameId}_${periodType}_${periodKey}`;
}

/** Top-scoring *registered* player for a game over an explicit date range -- shared by both
 * finalizePeriod() (first-time) and refinalizePeriod() (admin override) below, so the "who won"
 * logic only lives in one place. A guest can top the raw scores but can't hold an accumulating
 * achievement (Achievements are registered-only, Section 4 of the spec), so the next-highest
 * registered player is the one actually crowned. */
async function computeWinner(gameId, startDate, endDate) {
    const scores = await getGameScoresForDateRange(gameId, startDate, endDate);
    return scores.find((row) => !row.isGuest) || null;
}

async function finalizePeriod(gameId, periodType, { periodKey, startDate, endDate }) {
    const winner = await computeWinner(gameId, startDate, endDate);
    await setDoc(doc(db, 'periodResults', periodResultDocId(gameId, periodType, periodKey)), {
        gameId,
        periodType,
        periodKey,
        startDate,
        endDate,
        winnerUid: winner ? winner.uid : null,
        winnerDisplayName: winner ? winner.displayName : null,
        winnerPoints: winner ? winner.points : 0,
        claimed: winner === null,
        finalizedAt: serverTimestamp(),
    });
}

/**
 * Admin-only override: recomputes and overwrites an ALREADY-finalized period -- e.g. after banning
 * a player whose score should no longer count, to credit the rightful winner instead. Unlike
 * finalizePeriod() above (used for first-time backfill), this preserves the existing `claimed`
 * flag when the recomputed winner is unchanged, so a player who already claimed this win can't be
 * silently reset to unclaimed and double-increment their own achievement count on their next
 * profile visit. Only resets `claimed` to false when the winner has genuinely changed.
 */
export async function refinalizePeriod(gameId, periodType, periodKey) {
    const ref = doc(db, 'periodResults', periodResultDocId(gameId, periodType, periodKey));
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) throw new Error('Period not found -- nothing to re-finalize.');
    const { startDate, endDate, winnerUid: oldWinnerUid, claimed: oldClaimed } = existingSnap.data();

    const winner = await computeWinner(gameId, startDate, endDate);
    const newWinnerUid = winner ? winner.uid : null;
    const sameWinner = newWinnerUid === oldWinnerUid;

    await setDoc(ref, {
        gameId,
        periodType,
        periodKey,
        startDate,
        endDate,
        winnerUid: newWinnerUid,
        winnerDisplayName: winner ? winner.displayName : null,
        winnerPoints: winner ? winner.points : 0,
        claimed: sameWinner ? oldClaimed : newWinnerUid === null,
        finalizedAt: serverTimestamp(),
    });
}

/** Batched existence check against `periodResults` -- Firestore caps `in` queries at 10 values, so
 * this chunks a longer id list into groups of 10 rather than assuming callers never exceed it. */
async function fetchExistingPeriodIds(ids) {
    const existing = new Set();
    for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const snap = await getDocs(query(collection(db, 'periodResults'), where(documentId(), 'in', chunk)));
        snap.docs.forEach((d) => existing.add(d.id));
    }
    return existing;
}

/**
 * Admin backfill scan (Section 22 of the progression spec, extended per the admin's own manual-
 * trigger design): unlike the old lazy-on-visit version, this looks back up to
 * MAX_BACKFILL_LOOKBACK periods, not just the single most-recently-closed one, and returns every
 * one that's both past its safety window AND not yet finalized -- in chronological order (oldest
 * first), so finalizeAllPending() below finalizes them in the order they actually happened.
 */
export async function getMissingPeriods(gameId, periodType) {
    const maxN = MAX_BACKFILL_LOOKBACK[periodType];
    const candidates = [];
    for (let n = maxN; n >= 1; n--) {
        candidates.push(getPeriodNStepsBack(periodType, n));
    }

    const safeCandidates = candidates.filter(isPeriodSafeToFinalize);
    if (safeCandidates.length === 0) return [];

    const ids = safeCandidates.map((p) => periodResultDocId(gameId, periodType, p.periodKey));
    const existingIds = await fetchExistingPeriodIds(ids);

    return safeCandidates.filter((p) => !existingIds.has(periodResultDocId(gameId, periodType, p.periodKey)));
}

/**
 * Full status for one game/periodType combination, for the admin panel's status table: the most
 * recently closed period, whether it's safe to finalize yet (with the exact safe instant, for a
 * live countdown), whether it's already finalized (with winner details), and any older missing
 * periods bundled in too (a gap from a missed admin visit).
 */
export async function getGamePeriodStatus(gameId, periodType) {
    const period = PREVIOUS_PERIOD_FN[periodType]();
    const safeInstant = periodSafeInstant(period);
    const isSafe = Date.now() >= safeInstant;

    const missing = await getMissingPeriods(gameId, periodType);
    const mostRecentIsMissing = missing.some((p) => p.periodKey === period.periodKey);

    let finalized = null;
    if (isSafe && !mostRecentIsMissing) {
        const snap = await getDoc(doc(db, 'periodResults', periodResultDocId(gameId, periodType, period.periodKey)));
        if (snap.exists()) finalized = snap.data();
    }

    return { gameId, periodType, period, safeInstant, isSafe, finalized, missing };
}

/** Every game x period-type combination's status, for the admin panel to render as one table. */
export async function getAllPeriodStatuses() {
    const periodTypes = ['day', 'week', 'month'];
    const combos = Object.keys(GAMES).flatMap((gameId) => periodTypes.map((periodType) => ({ gameId, periodType })));
    return Promise.all(combos.map(({ gameId, periodType }) => getGamePeriodStatus(gameId, periodType)));
}

/** Finalizes every safe-and-missing period across every game/period-type in one call -- the "Run
 * All Eligible" admin button. Returns how many periods were actually finalized. */
export async function finalizeAllPending() {
    const statuses = await getAllPeriodStatuses();
    const jobs = statuses.flatMap(({ gameId, periodType, missing }) =>
        missing.map((period) => finalizePeriod(gameId, periodType, period))
    );
    await Promise.all(jobs);
    return jobs.length;
}

/** Same as finalizeAllPending(), scoped to one game/periodType -- the per-row "Finalize" button.
 * Returns how many periods were actually finalized. */
export async function finalizePendingFor(gameId, periodType) {
    const missing = await getMissingPeriods(gameId, periodType);
    await Promise.all(missing.map((period) => finalizePeriod(gameId, periodType, period)));
    return missing.length;
}

/** The finalized result for one exact period, or null if it hasn't been finalized yet -- for the
 * admin panel's Marketing Top 10 viewer, which shows this alongside the live Top 10 for whatever
 * period is currently selected (so the admin can spot a mismatch and Re-finalize right there). */
export async function getPeriodResult(gameId, periodType, periodKey) {
    const snap = await getDoc(doc(db, 'periodResults', periodResultDocId(gameId, periodType, periodKey)));
    return snap.exists() ? snap.data() : null;
}

const PERIOD_LABEL = { day: 'daily', week: 'weekly', month: 'monthly' };

/**
 * Win-count milestones per period type -- each becomes its own one-time achievement (the tier-1
 * "win once" entry reuses the exact id the old single accumulating achievement used to have, so
 * anyone who already won once keeps that badge under the same id). Must match
 * achievement-registry.js's own copy of these numbers exactly (that file stays Firestore-free, so
 * it can't import this one -- same "kept as a separate literal" precedent as streak-service.js's
 * milestones vs. achievement-registry.js's own STREAK_MILESTONES).
 */
export const CHAMPIONSHIP_TIERS = {
    day: [1, 7, 30, 50, 100],
    week: [1, 5, 10, 25, 50],
    month: [1, 3, 6, 9, 12],
};

function tallyDocId(uid, gameId, periodType) {
    return `${uid}_${gameId}_${periodType}`;
}

function tierAchievementId(gameId, periodType, tierCount) {
    return tierCount === 1
        ? `${gameId}-${PERIOD_LABEL[periodType]}-champion`
        : `${gameId}-${PERIOD_LABEL[periodType]}-champion-${tierCount}`;
}

/** Every game's win tally (across all period types) for one player -- the raw "how many times have
 * I won" numbers behind the tiered championship achievements, exposed so profile.js can show
 * "12 / 30" progress toward a not-yet-earned tier (achievement-registry.js's championship entries
 * have no `evaluate()` of their own, same as before, but the tier ones DO have a `progress()` that
 * needs this). Shape: `{ [gameId]: { day, week, month } }`, any combination absent if the player
 * has never won that game/period at all. */
export async function getChampionshipTallies(uid) {
    const q = query(collection(db, 'championshipWinTallies'), where('uid', '==', uid));
    const snap = await getDocs(q);
    const tallies = {};
    snap.docs.forEach((d) => {
        const { gameId, periodType, count } = d.data();
        if (!tallies[gameId]) tallies[gameId] = {};
        tallies[gameId][periodType] = count;
    });
    return tallies;
}

/**
 * Checks for any periodResults the caller has won but not yet converted into a win-tally
 * increment, and claims them -- one Firestore transaction per unclaimed win, bumping a running
 * `championshipWinTallies/{uid}_{gameId}_{periodType}` counter (a plain number, not itself an
 * achievement) by exactly 1. Whenever that counter's new value exactly matches one of
 * CHAMPIONSHIP_TIERS' thresholds, the corresponding tier achievement gets its own one-time,
 * create-only `playerAchievements` doc -- e.g. crossing 7 total Daily wins creates
 * `{gameId}-daily-champion-7` alongside (not instead of) the tally just being 7. The tally keeps
 * accumulating past the highest tier forever; nothing caps it.
 *
 * Called from profile.js on every registered-player visit, right alongside Phase 5's
 * `syncPlayerAchievements()` (this claiming intentionally happens first, so a freshly-claimed win
 * is reflected in the same page render).
 *
 * Deliberately separate from finalization above: the visitor who triggers a period's finalization
 * (the admin, via the panel above) is usually a *different* person from whoever actually won it,
 * and Firestore's security rules only ever allow a client to write to its own uid's data -- so the
 * winner has to be the one to claim their own win, nobody can do it on their behalf.
 */
export async function claimChampionshipAchievements(uid) {
    const q = query(
        collection(db, 'periodResults'),
        where('winnerUid', '==', uid),
        where('claimed', '==', false)
    );
    const snap = await getDocs(q);

    // Sequential, not Promise.all -- each win's tally increment must be committed before the next
    // one reads it, or two wins claimed in the same visit could both read the same starting count
    // and each think they're "the" one crossing a given tier (Firestore transactions serialize
    // writes to the *same* tally doc under concurrency, but two DIFFERENT periodResults docs for
    // the same game/period type claimed in parallel don't share a transaction to serialize against
    // each other's tier-crossing check).
    for (const periodDoc of snap.docs) {
        const { gameId, periodType } = periodDoc.data();
        const tallyRef = doc(db, 'championshipWinTallies', tallyDocId(uid, gameId, periodType));

        let newCount = null;
        try {
            newCount = await runTransaction(db, async (tx) => {
                const periodSnap = await tx.get(periodDoc.ref);
                if (periodSnap.data().claimed) return null; // already claimed by a concurrent call
                const tallySnap = await tx.get(tallyRef);
                const count = (tallySnap.exists() ? tallySnap.data().count : 0) + 1;

                tx.update(periodDoc.ref, { claimed: true });
                if (tallySnap.exists()) {
                    tx.update(tallyRef, { count });
                } else {
                    tx.set(tallyRef, { uid, gameId, periodType, count });
                }
                return count;
            });
        } catch {
            // Lost a race (e.g. two tabs open) -- already claimed, harmless no-op.
        }

        if (newCount === null) continue;

        const crossedTier = CHAMPIONSHIP_TIERS[periodType].find((t) => t === newCount);
        if (crossedTier === undefined) continue;

        const achievementId = tierAchievementId(gameId, periodType, crossedTier);
        try {
            await setDoc(doc(db, 'playerAchievements', `${uid}_${achievementId}`), {
                uid,
                achievementId,
                category: 'championship',
                count: 1,
                earnedAt: serverTimestamp(),
            });
            await awardAchievementXp(uid);
        } catch {
            // Already exists -- shouldn't normally happen given the exact-match check above, but
            // harmless if it does (e.g. a retried request after a dropped connection).
        }
    }
}
