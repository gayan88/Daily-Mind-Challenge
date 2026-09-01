import {
    collection,
    query,
    where,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { getTodayDateString, getDateDaysAgo } from '../utils/helpers.js';

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
const GAME_TYPES = {
    wordle: ['wordle', 'wordle-tournament', 'wordle-challenge', 'wordle-challenge-creator'],
    sudoku: ['sudoku', 'sudoku-classic', 'sudoku-tournament', 'sudoku-tournament-bonus'],
    wordsearch: ['wordsearch', 'wordsearch-classic', 'wordsearch-tournament', 'wordsearch-tournament-bonus'],
};

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

/** Overall leaderboard for a period: sum of that period's gameScores per user, across all game types. */
export async function getOverallLeaderboard(period = 'today', limitCount = 50) {
    const q = query(collection(db, 'gameScores'), ...constraintsFor(period));
    const [snap, bannedUids] = await Promise.all([getDocs(q), getBannedUids()]);

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

    const rows = Array.from(totals.values()).sort((a, b) => b.points - a.points).slice(0, limitCount);
    return rank(rows);
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

    const rows = Array.from(totals.values()).sort((a, b) => b.points - a.points).slice(0, limitCount);
    return rank(rows);
}

export function findUserInLeaderboard(rows, uid) {
    return rows.find((row) => row.uid === uid) || null;
}
