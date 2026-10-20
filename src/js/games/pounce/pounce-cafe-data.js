import {
    collection,
    getDocs,
    query,
    where,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { cafeCat } from './pounce-cats.js';

/**
 * The Cat Café (decision D9, "lite"): every Daily Pounce a player solved adopted that date's cat,
 * so the collection is derived from their own `pounce` gameScores docs -- no extra collection, no
 * extra rules. Two equality filters, so no composite index. Returns `[{ date, cat }]`, newest
 * first, where `cat` is pounce-cats.js#cafeCat(date) (draw it with catSvg()).
 */
export async function getAdoptedCats(uid) {
    const snap = await getDocs(query(collection(db, 'gameScores'), where('userId', '==', uid), where('gameType', '==', 'pounce')));
    return snap.docs
        .map((d) => d.data().gameDate)
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date || ''))
        .sort((a, b) => b.localeCompare(a))
        .map((date) => ({ date, cat: cafeCat(date) }));
}
