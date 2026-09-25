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
import { getTodayDateString } from '../../utils/helpers.js';
import { scoreDocRef } from './connections-scoring.js';

const TOURNAMENTS_COLLECTION = 'connectionsTournaments';
const ATTEMPTS_COLLECTION = 'connectionsTournamentAttempts';

function attemptRef(tournamentId, uid) {
    return doc(db, ATTEMPTS_COLLECTION, `${tournamentId}_${uid}`);
}

/** Tournament shape: `{ name, active, timePerPuzzleSeconds, bonusPoints, puzzles: [{ groups }] }`. */
export async function listActiveTournaments() {
    const q = query(collection(db, TOURNAMENTS_COLLECTION), where('active', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** The player's progress doc for a tournament, or null if they haven't started it. */
export async function getAttempt(tournamentId, uid) {
    const snap = await getDoc(attemptRef(tournamentId, uid));
    return snap.exists() ? snap.data() : null;
}

/** Fetches the player's progress doc, creating it at puzzle 1 on first play. */
export async function getOrStartAttempt(tournamentId, uid, profile) {
    const ref = attemptRef(tournamentId, uid);
    const existing = await getDoc(ref);
    if (existing.exists()) return existing.data();

    const data = {
        uid,
        displayName: profile.displayName,
        tournamentId,
        currentPuzzleIndex: 0,
        puzzlesWon: 0,
        puzzleMistakes: [],
        startedAt: serverTimestamp(),
        completed: false,
        completedAt: null,
        pointsAwarded: false,
    };
    await setDoc(ref, data);
    return data;
}

/**
 * Advances progress on a win, or resets to puzzle 1 on a loss -- a failed run banks nothing but can
 * be retried indefinitely. Never touches points; see finalizeTournament().
 */
export async function recordPuzzleResult(tournamentId, uid, won, mistakes) {
    const ref = attemptRef(tournamentId, uid);
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        if (data.completed) return data;

        const patch = won
            ? {
                currentPuzzleIndex: data.currentPuzzleIndex + 1,
                puzzlesWon: data.puzzlesWon + 1,
                puzzleMistakes: [...(data.puzzleMistakes || []), mistakes],
            }
            : { currentPuzzleIndex: 0, puzzlesWon: 0, puzzleMistakes: [] };
        tx.update(ref, patch);
        return { ...data, ...patch };
    });
}

/**
 * One-shot completion award: 30 + 15 x numPuzzles + the tournament's bonusPoints, written to
 * gameScores under a deterministic `{uid}_connections-tournament_{tournamentId}` id (create-only,
 * so it can never double-pay). Marks the attempt permanently `completed`.
 */
export async function finalizeTournament(uid, profile, tournament) {
    const attempt = attemptRef(tournament.id, uid);
    const scoreRef = scoreDocRef(uid, 'connections-tournament', tournament.id);

    const existingScore = await getDoc(scoreRef);
    if (existingScore.exists()) {
        await updateDoc(attempt, { completed: true, completedAt: serverTimestamp(), pointsAwarded: true });
        return existingScore.data();
    }

    const attemptSnap = await getDoc(attempt);
    const puzzleMistakes = attemptSnap.exists() ? (attemptSnap.data().puzzleMistakes || []) : [];

    const numPuzzles = tournament.puzzles.length;
    const score = 30 + 15 * numPuzzles + (tournament.bonusPoints || 0);

    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'connections-tournament',
        score,
        gameDate: tournament.id, // deterministic key, not a calendar date -- see gameScores create rule
        scoreDate: getTodayDateString(),
        tournamentName: tournament.name,
        puzzleMistakes,
        sharedToFacebook: false,
        sharedWithFriends: false,
        createdAt: serverTimestamp(),
    };

    try {
        await setDoc(scoreRef, data);
    } catch (err) {
        console.error('finalizeTournament: gameScores write failed', err);
        return null; // lost a race, or the write was rejected -- caller must not assume points landed
    }

    await updateDoc(attempt, { completed: true, completedAt: serverTimestamp(), pointsAwarded: true });
    return data;
}
