import {
    doc,
    getDoc,
    setDoc,
    runTransaction,
    serverTimestamp,
    collection,
    query,
    where,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';

const ATTEMPTS_COLLECTION = 'wordsearchTournamentAttempts';

function attemptDocId(tournamentId, uid) {
    return `${tournamentId}_${uid}`;
}

function puzzleScoreDocId(uid, tournamentId, puzzleIndex) {
    return `${uid}_wordsearch-tournament_${tournamentId}_${puzzleIndex}`;
}

function bonusScoreDocId(uid, tournamentId) {
    return `${uid}_wordsearch-tournament-bonus_${tournamentId}`;
}

export async function listActiveWordsearchTournaments() {
    const q = query(collection(db, 'wordsearchTournaments'), where('active', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Returns the player's progress doc for a tournament, or null if they haven't started it yet. */
export async function getAttempt(tournamentId, uid) {
    const snap = await getDoc(doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournamentId, uid)));
    return snap.exists() ? snap.data() : null;
}

/** Fetches the player's progress doc for a tournament, creating it at puzzle 1 on first play --
 * this doubles as "resume" for an unfinished attempt, since it just returns the existing doc. */
export async function getOrStartAttempt(tournamentId, uid, profile) {
    const ref = doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournamentId, uid));
    const existing = await getDoc(ref);
    if (existing.exists()) return existing.data();

    const data = {
        uid,
        displayName: profile.displayName,
        tournamentId,
        currentPuzzleIndex: 0,
        puzzlesPassed: 0,
        puzzlesFailed: 0,
        startedAt: serverTimestamp(),
        completed: false,
        completedAt: null,
        bonusAwarded: false,
    };
    await setDoc(ref, data);
    return data;
}

/**
 * Records one puzzle's outcome: banks `completedPoints` or `failedPoints` immediately via a
 * gameScores create, and advances the attempt's progress -- both in a single transaction, so a
 * browser closing mid-write can never lose this puzzle's points or leave the attempt doc out of
 * sync with what was actually scored. Failing a puzzle never resets progress -- the run only ends
 * once every puzzle has been attempted, pass or fail.
 *
 * Unlike sudoku-tournament-data.js, `completedPoints`/`failedPoints` are parameters (sourced from
 * config/wordsearchTournamentSettings) rather than hardcoded, since Word Search Tournament makes
 * them admin-configurable.
 *
 * Idempotent against a client-level retry: if `attemptData.currentPuzzleIndex` has already moved
 * past `puzzleIndex` -- meaning the transaction actually committed on an earlier call even though
 * that call appeared to fail -- this returns the current state without writing again.
 */
export async function recordPuzzleResult(tournament, uid, profile, { puzzleIndex, passed, completedPoints, failedPoints }) {
    const attemptRef = doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournament.id, uid));
    const scoreRef = doc(db, 'gameScores', puzzleScoreDocId(uid, tournament.id, puzzleIndex));

    return runTransaction(db, async (tx) => {
        const attemptSnap = await tx.get(attemptRef);
        if (!attemptSnap.exists()) return null;
        const attemptData = attemptSnap.data();

        if (attemptData.currentPuzzleIndex !== puzzleIndex) return attemptData;

        const scoreSnap = await tx.get(scoreRef);
        const score = passed ? completedPoints : failedPoints;

        if (!scoreSnap.exists()) {
            tx.set(scoreRef, {
                userId: uid,
                displayName: profile.displayName,
                isGuest: profile.kind === 'guest',
                gameType: 'wordsearch-tournament',
                score,
                gameDate: `${tournament.id}_${puzzleIndex}`, // repurposed as the deterministic key, not a calendar date
                tournamentId: tournament.id,
                tournamentName: tournament.name,
                puzzleIndex,
                passed,
                createdAt: serverTimestamp(),
            });
        }

        const patch = {
            currentPuzzleIndex: attemptData.currentPuzzleIndex + 1,
            puzzlesPassed: attemptData.puzzlesPassed + (passed ? 1 : 0),
            puzzlesFailed: attemptData.puzzlesFailed + (passed ? 0 : 1),
        };
        tx.update(attemptRef, patch);
        return { ...attemptData, ...patch };
    });
}

/**
 * One-shot completion bonus (tournament.completionBonus, set per tournament at creation time),
 * awarded once every puzzle in the tournament has been attempted. The bonus write and marking the
 * attempt completed/bonusAwarded happen in the same transaction, so this is safely retryable:
 * calling it again on an attempt that's already been paid out is a no-op. Meant to be called both
 * right after the last puzzle's recordPuzzleResult(), and defensively whenever a player revisits
 * a tournament where every puzzle is attempted but bonusAwarded is still false.
 */
export async function completeTournamentIfNeeded(uid, profile, tournament) {
    const attemptRef = doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournament.id, uid));
    const bonusRef = doc(db, 'gameScores', bonusScoreDocId(uid, tournament.id));

    return runTransaction(db, async (tx) => {
        const attemptSnap = await tx.get(attemptRef);
        if (!attemptSnap.exists()) return null;
        const attemptData = attemptSnap.data();

        if (attemptData.currentPuzzleIndex < tournament.puzzles.length) return attemptData;
        if (attemptData.bonusAwarded) return attemptData;

        const bonusSnap = await tx.get(bonusRef);
        if (!bonusSnap.exists()) {
            tx.set(bonusRef, {
                userId: uid,
                displayName: profile.displayName,
                isGuest: profile.kind === 'guest',
                gameType: 'wordsearch-tournament-bonus',
                score: tournament.completionBonus,
                gameDate: tournament.id, // repurposed as the deterministic key, not a calendar date
                tournamentId: tournament.id,
                tournamentName: tournament.name,
                createdAt: serverTimestamp(),
            });
        }

        const patch = { bonusAwarded: true, completed: true, completedAt: serverTimestamp() };
        tx.update(attemptRef, patch);
        return { ...attemptData, ...patch };
    });
}
