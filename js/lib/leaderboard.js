import {
    collection,
    query,
    where,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../firebase/firebase-init.js';
import { getTodayDateString } from './utils.js';

async function getBannedUids() {
    const q = query(collection(db, 'registeredUsers'), where('isBanned', '==', true));
    const snap = await getDocs(q);
    return new Set(snap.docs.map((d) => d.id));
}

function rank(rows) {
    rows.forEach((row, i) => { row.rank = i + 1; });
    return rows;
}

/** Today's overall leaderboard: sum of today's gameScores per user, across all game types. */
export async function getTodayOverallLeaderboard(limitCount = 50) {
    const today = getTodayDateString();
    const q = query(collection(db, 'gameScores'), where('gameDate', '==', today));
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

/** Today's leaderboard for a single game type (wordle | sudoku | wordsearch). */
export async function getTodayGameLeaderboard(gameType, limitCount = 50) {
    const today = getTodayDateString();
    const q = query(
        collection(db, 'gameScores'),
        where('gameType', '==', gameType),
        where('gameDate', '==', today)
    );
    const [snap, bannedUids] = await Promise.all([getDocs(q), getBannedUids()]);

    const rows = snap.docs
        .map((d) => d.data())
        .filter((row) => !bannedUids.has(row.userId))
        .map((row) => ({ uid: row.userId, displayName: row.displayName, isGuest: row.isGuest, points: row.score }))
        .sort((a, b) => b.points - a.points)
        .slice(0, limitCount);

    return rank(rows);
}

export function findUserInLeaderboard(rows, uid) {
    return rows.find((row) => row.uid === uid) || null;
}
