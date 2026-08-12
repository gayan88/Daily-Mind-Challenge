import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../firebase/firebase-init.js';
import { getTodayDateString } from './utils.js';

/** Returns today's leaderboard rows, highest points first: [{ uid, displayName, points, rank }]. */
export async function getTodayLeaderboard(limitCount = 20) {
    const today = getTodayDateString();
    const q = query(
        collection(db, 'dailyLeaderboard'),
        where('date', '==', today),
        orderBy('points', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d, i) => ({ ...d.data(), rank: i + 1 }));
}

/** Returns the all-time leaderboard by lifetime totalPoints: [{ uid, displayName, totalPoints, rank }]. */
export async function getAllTimeLeaderboard(limitCount = 20) {
    const q = query(
        collection(db, 'users'),
        orderBy('totalPoints', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d, i) => ({ uid: d.id, ...d.data(), rank: i + 1 }));
}

/** Finds the current user's rank/points within today's leaderboard, or null if they haven't scored today. */
export function findUserInLeaderboard(rows, uid) {
    return rows.find((row) => row.uid === uid) || null;
}
