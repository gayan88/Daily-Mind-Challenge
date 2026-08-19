import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    collection,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';

const WORDS_COLLECTION = 'wordleDailyWords';
const TOURNAMENTS_COLLECTION = 'wordleTournaments';

/** Lists every seeded Daily Challenge word, ordered by its numeric id (1, 2, 3, ...). */
export async function listDailyWords() {
    const snap = await getDocs(collection(db, WORDS_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ id: Number(d.id), word: d.data().word }))
        .sort((a, b) => a.id - b.id);
}

/**
 * Appends a new word to the end of the pool (next numeric id) and bumps `_meta.totalCount`, which
 * `wordle-daily-data.js#getTodayChallenge()` reads to resolve today's word with a single getDoc.
 * Append-only by design -- reordering/removing earlier entries would shift which word lands on
 * which past/future date for players already mid-streak (see CLAUDE.md).
 */
export async function addDailyWord(word) {
    const metaRef = doc(db, WORDS_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    const nextId = totalCount + 1;

    await setDoc(doc(db, WORDS_COLLECTION, String(nextId)), {
        word: word.trim().toUpperCase(),
        createdAt: serverTimestamp(),
    });
    await setDoc(metaRef, { totalCount: nextId, updatedAt: serverTimestamp() });
    return nextId;
}

/** Corrects an already-seeded word's text without changing its position/id. */
export async function updateDailyWord(id, word) {
    await setDoc(
        doc(db, WORDS_COLLECTION, String(id)),
        { word: word.trim().toUpperCase(), updatedAt: serverTimestamp() },
        { merge: true }
    );
}

/** Lists all tournaments (active and inactive), newest first. */
export async function listTournaments() {
    const snap = await getDocs(collection(db, TOURNAMENTS_COLLECTION));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

/** Creates a new tournament, active by default. `words` is a pre-split array of 5-letter words. */
export async function createTournament({ name, words, timePerWordSeconds, bonusPoints }) {
    const ref = doc(collection(db, TOURNAMENTS_COLLECTION));
    await setDoc(ref, {
        name: name.trim(),
        words: words.map((w) => w.trim().toUpperCase()),
        timePerWordSeconds,
        bonusPoints,
        active: true,
        createdAt: serverTimestamp(),
    });
    return ref.id;
}

/** Toggles a tournament's visibility to players without deleting its data/history. */
export async function setTournamentActive(id, active) {
    await updateDoc(doc(db, TOURNAMENTS_COLLECTION, id), { active });
}

export async function deleteTournament(id) {
    await deleteDoc(doc(db, TOURNAMENTS_COLLECTION, id));
}
