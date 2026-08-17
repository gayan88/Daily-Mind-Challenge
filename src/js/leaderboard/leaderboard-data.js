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

/** Firestore `where` constraints for a given period ('today' | 'week' | 'month' | 'year' | 'all'). */
function periodConstraints() {
    return {
        today: () => [where('gameDate', '==', getTodayDateString())],
        week: () => [where('gameDate', '>=', getDateDaysAgo(PERIOD_WINDOW_DAYS.week))],
        month: () => [where('gameDate', '>=', getDateDaysAgo(PERIOD_WINDOW_DAYS.month))],
        year: () => [where('gameDate', '>=', getDateDaysAgo(PERIOD_WINDOW_DAYS.year))],
        all: () => [],
    };
}

function constraintsFor(period) {
    const builder = periodConstraints()[period];
    return builder ? builder() : periodConstraints().today();
}

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

/** Leaderboard for a single game type (wordle | sudoku | wordsearch) over a period. Unlike the
 * overall leaderboard, a player can have multiple scores in non-"today" periods (one per day
 * played), so rows are summed per user here too, not one row per gameScores doc. */
export async function getGameLeaderboard(gameType, period = 'today', limitCount = 50) {
    const q = query(collection(db, 'gameScores'), where('gameType', '==', gameType), ...constraintsFor(period));
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
