import {
    collection,
    doc,
    query,
    where,
    documentId,
    getDoc,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { getTodayDateString, getDateDaysAgo } from '../utils/helpers.js';
import { GAMES } from '../progression/game-registry.js';

// Rolling windows (last N days including today), not calendar-aligned weeks/months/years --
// simpler than computing calendar boundaries and avoids timezone edge cases.
const PERIOD_WINDOW_DAYS = { week: 6, month: 29, year: 364 };

/** Firestore `where` constraints for a given period ('today' | 'week' | 'month' | 'year' | 'all').
 * Filters on `scoreDate`, not `gameDate` -- `gameDate` doubles as a deterministic doc-ID key for
 * many modes (Tournament, Classic, Challenge a Friend) and isn't always a real calendar date, so
 * it can't be used to filter by when a score was actually earned. `scoreDate` is always the real
 * date, set on every gameScores doc regardless of gameType (see each game's data.js). */
function periodConstraints() {
    return {
        today: () => [where('scoreDate', '==', getTodayDateString())],
        week: () => [where('scoreDate', '>=', getDateDaysAgo(PERIOD_WINDOW_DAYS.week))],
        month: () => [where('scoreDate', '>=', getDateDaysAgo(PERIOD_WINDOW_DAYS.month))],
        year: () => [where('scoreDate', '>=', getDateDaysAgo(PERIOD_WINDOW_DAYS.year))],
        all: () => [],
    };
}

function constraintsFor(period) {
    const builder = periodConstraints()[period];
    return builder ? builder() : periodConstraints().today();
}

/** Every gameType a given game can score under -- each game writes multiple gameTypes depending
 * on mode (Daily/Classic/Tournament, plus Wordle's Challenge a Friend), not just one matching its
 * own name. getGameLeaderboard() needs the full list, not just e.g. 'wordsearch', or Classic/
 * Tournament scores silently vanish from that game's own leaderboard tab even though they still
 * count correctly on "Overall" (which has no gameType filter at all). `wordle-challenge-creator`
 * (the reward a Challenge creator earns per solver) is included here for the same reason --
 * leaving it out would make a player's Wordle-tab total not match the Wordle portion of their
 * Overall-tab total, which would look like a second bug. */
const GAME_TYPES = Object.fromEntries(
    Object.entries(GAMES).map(([gameId, game]) => [gameId, game.scoreTypes])
);

// Cached for the page's lifetime -- banned status rarely changes mid-session, and without this,
// switching leaderboard tabs (or the home page + a later leaderboard.html visit) re-fetches the
// same list from scratch every time.
let bannedUidsCache = null;

async function getBannedUids() {
    if (bannedUidsCache) return bannedUidsCache;
    const q = query(collection(db, 'registeredUsers'), where('isBanned', '==', true));
    const snap = await getDocs(q);
    bannedUidsCache = new Set(snap.docs.map((d) => d.id));
    return bannedUidsCache;
}

function rank(rows) {
    rows.forEach((row, i) => { row.rank = i + 1; });
    return rows;
}

/** Shared aggregation: sums a gameScores query's docs per user (excluding banned users), sorted
 * highest-first. Used by every function below -- the two named-period leaderboards and Phase 6's
 * explicit-date-range version (progression/championship-service.js). */
function aggregateScores(snap, bannedUids) {
    const totals = new Map();
    snap.docs.forEach((d) => {
        const data = d.data();
        if (bannedUids.has(data.userId)) return;
        const entry = totals.get(data.userId) || {
            uid: data.userId,
            displayName: data.displayName,
            isGuest: data.isGuest,
            points: 0,
        };
        entry.points += data.score;
        totals.set(data.userId, entry);
    });
    return Array.from(totals.values()).sort((a, b) => b.points - a.points);
}

/** Overall leaderboard for a period: sum of that period's gameScores per user, across all game types. */
export async function getOverallLeaderboard(period = 'today', limitCount = 50) {
    const q = query(collection(db, 'gameScores'), ...constraintsFor(period));
    const [snap, bannedUids] = await Promise.all([getDocs(q), getBannedUids()]);
    return rank(aggregateScores(snap, bannedUids).slice(0, limitCount));
}

/** Leaderboard for a single game (wordle | sudoku | wordsearch) over a period -- sums across every
 * mode's gameType for that game (see GAME_TYPES), not just its Daily Challenge one. Unlike the
 * overall leaderboard, a player can have multiple scores in non-"today" periods (one per day
 * played, or one per Tournament/Classic run), so rows are summed per user here too, not one row
 * per gameScores doc. */
export async function getGameLeaderboard(game, period = 'today', limitCount = 50) {
    const gameTypes = GAME_TYPES[game] || [game];
    const q = query(collection(db, 'gameScores'), where('gameType', 'in', gameTypes), ...constraintsFor(period));
    const [snap, bannedUids] = await Promise.all([getDocs(q), getBannedUids()]);
    return rank(aggregateScores(snap, bannedUids).slice(0, limitCount));
}

/** Same aggregation as getGameLeaderboard(), but for an explicit [startDate, endDate] range
 * (inclusive `scoreDate` bounds) instead of a named rolling period -- used by
 * progression/championship-service.js (Phase 6) to determine a closed calendar week/month's
 * winner. Not ranked/limited (no `rank` field, no slice) -- a caller that just wants the winner
 * takes the first entry. Same `(gameType, scoreDate)` composite index as the named-period queries
 * above already covers this query shape, so no new index was needed. */
export async function getGameScoresForDateRange(game, startDate, endDate) {
    const gameTypes = GAME_TYPES[game] || [game];
    const q = query(
        collection(db, 'gameScores'),
        where('gameType', 'in', gameTypes),
        where('scoreDate', '>=', startDate),
        where('scoreDate', '<=', endDate)
    );
    const [snap, bannedUids] = await Promise.all([getDocs(q), getBannedUids()]);
    return aggregateScores(snap, bannedUids);
}

/** Same aggregation as getGameScoresForDateRange(), but across every game (no `gameType` filter at
 * all) -- the "Overall" equivalent, for the admin panel's marketing Top 10 viewer (Daily/Weekly/
 * Monthly x Game-or-Overall x a specific past period). Unranked/unlimited, same as its per-game
 * counterpart -- callers slice/rank as needed. */
export async function getOverallScoresForDateRange(startDate, endDate) {
    const q = query(
        collection(db, 'gameScores'),
        where('scoreDate', '>=', startDate),
        where('scoreDate', '<=', endDate)
    );
    const [snap, bannedUids] = await Promise.all([getDocs(q), getBannedUids()]);
    return aggregateScores(snap, bannedUids);
}

export function findUserInLeaderboard(rows, uid) {
    return rows.find((row) => row.uid === uid) || null;
}

/** Batched `registeredUsers.xp` lookup for a set of uids -- used to show each leaderboard row's
 * real sub-rank avatar (progression/rank-service.js#calculateRankProgress()) without reading a
 * doc per row on every page load; callers should only pass uids for rows actually rendered (a
 * page of `leaderboard-page.js`'s pagination, or `home.js`'s top-5 preview), not every aggregated
 * row up to FETCH_CAP. Firestore caps `in` queries at 10 values, same chunking as
 * championship-service.js#fetchExistingPeriodIds(). Guests have no `registeredUsers` doc and
 * aren't queried at all -- callers filter those out first, since they always show the fixed
 * GUEST_RANK_IMAGE instead. A uid with no doc (or found but with no `xp` field yet) is simply
 * absent from the returned Map -- callers treat that as 0 XP. */
/** Single player's `registeredUsers` summary (xp, currentStreak, loginPoints) -- used by
 * player-profile-modal.js, which only ever needs one specific clicked player's data at a time, so
 * a plain getDoc() is simpler than getXpForUids()'s batched `in` query (that one exists because
 * leaderboard row avatars need many uids at once). A uid with no doc (a guest, or one of this
 * project's own seeded test users with gameScores but no registeredUsers doc) resolves to all
 * zeros rather than throwing -- same "missing doc is just 0" treatment as getXpForUids(). */
export async function getRegisteredUserSummary(uid) {
    const snap = await getDoc(doc(db, 'registeredUsers', uid));
    if (!snap.exists()) return { xp: 0, currentStreak: 0, loginPoints: 0 };
    const data = snap.data();
    return { xp: data.xp || 0, currentStreak: data.currentStreak || 0, loginPoints: data.loginPoints || 0 };
}

export async function getXpForUids(uids) {
    const xpByUid = new Map();
    for (let i = 0; i < uids.length; i += 10) {
        const chunk = uids.slice(i, i + 10);
        if (chunk.length === 0) continue;
        const snap = await getDocs(query(collection(db, 'registeredUsers'), where(documentId(), 'in', chunk)));
        snap.docs.forEach((d) => xpByUid.set(d.id, d.data().xp || 0));
    }
    return xpByUid;
}
