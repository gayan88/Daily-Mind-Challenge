import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    runTransaction,
    serverTimestamp,
    collection,
    query,
    where,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';

function attemptDocId(tournamentId, uid) {
    return `${tournamentId}_${uid}`;
}

function tournamentScoreDocId(uid, tournamentId) {
    return `${uid}_wordle-tournament_${tournamentId}`;
}

export async function listActiveTournaments() {
    const q = query(collection(db, 'wordleTournaments'), where('active', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Returns the player's progress doc for a tournament, or null if they haven't started it yet. */
export async function getAttempt(tournamentId, uid) {
    const snap = await getDoc(doc(db, 'wordleTournamentAttempts', attemptDocId(tournamentId, uid)));
    return snap.exists() ? snap.data() : null;
}

/** Fetches the player's progress doc for a tournament, creating it at word 1 on first play. */
export async function getOrStartAttempt(tournamentId, uid, profile) {
    const ref = doc(db, 'wordleTournamentAttempts', attemptDocId(tournamentId, uid));
    const existing = await getDoc(ref);
    if (existing.exists()) return existing.data();

    const data = {
        uid,
        displayName: profile.displayName,
        tournamentId,
        currentWordIndex: 0,
        wordsWon: 0,
        startedAt: serverTimestamp(),
        completed: false,
        completedAt: null,
        pointsAwarded: false,
    };
    await setDoc(ref, data);
    return data;
}

/**
 * Advances progress on a win (to the next word), or resets to word 1 on a loss -- per the
 * "keep retrying until you succeed once" design, failing anywhere mid-run costs that run's
 * progress but never blocks trying again. Never touches points; see finalizeTournament() for that.
 * Returns the attempt's fields after the update.
 */
export async function recordWordResult(tournamentId, uid, won) {
    const ref = doc(db, 'wordleTournamentAttempts', attemptDocId(tournamentId, uid));
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        if (data.completed) return data;

        const patch = won
            ? { currentWordIndex: data.currentWordIndex + 1, wordsWon: data.wordsWon + 1 }
            : { currentWordIndex: 0, wordsWon: 0 };
        tx.update(ref, patch);
        return { ...data, ...patch };
    });
}

/**
 * One-shot completion award: 30 (starting) + 15 x numWords (per-word wins) + the tournament's
 * bonusPoints, written to gameScores with a deterministic {uid}_wordle-tournament_{tournamentId}
 * id -- the same create-only guarantee every other game score relies on means a repeat call (or a
 * tampered client re-finalizing) can never award twice, regardless of what the attempts doc says.
 * Marks the attempt permanently `completed` so the UI stops offering replay. Assumes the caller
 * has already advanced `currentWordIndex` to `tournament.words.length` via recordWordResult.
 */
export async function finalizeTournament(uid, profile, tournament) {
    const attemptRef = doc(db, 'wordleTournamentAttempts', attemptDocId(tournament.id, uid));
    const scoreRef = doc(db, 'gameScores', tournamentScoreDocId(uid, tournament.id));

    const existingScore = await getDoc(scoreRef);
    if (existingScore.exists()) {
        await updateDoc(attemptRef, { completed: true, completedAt: serverTimestamp(), pointsAwarded: true });
        return existingScore.data();
    }

    const numWords = tournament.words.length;
    const score = 30 + 15 * numWords + (tournament.bonusPoints || 0);

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'wordle-tournament',
        score,
        gameDate: tournament.id, // repurposed as the deterministic key, not a calendar date -- see gameScores create rule
        tournamentName: tournament.name,
        createdAt: serverTimestamp(),
    };

    try {
        await setDoc(scoreRef, data);
    } catch (err) {
        console.error('finalizeTournament: gameScores write failed', err);
        return null; // lost a race, or the write was rejected -- caller must not assume points landed
    }

    await updateDoc(attemptRef, { completed: true, completedAt: serverTimestamp(), pointsAwarded: true });
    return data;
}
