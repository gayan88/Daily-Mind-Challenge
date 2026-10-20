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
import { awardShareXp } from '../../progression/xp-service.js';
import { getTodayDateString } from '../../utils/helpers.js';
import { RUN_BOARD_PASS_POINTS, RUN_BOARD_FAIL_POINTS, runBonusFor } from './pounce-scoring.js';

/**
 * Nine Lives Run (Pounce's Tournament) data layer -- quilt-tournament-data.js's shape and guarantees
 * (one attempt doc per player per run that only ever advances, each board's points banked in the
 * same transaction that advances it, a retry-safe one-shot bonus), plus lives:
 *
 *   - `livesLeft` starts at config/pounceTournamentSettings.lives (default 9) and only goes down
 *     (firestore.rules enforces it). A wrong cat costs one -- written straight away by spendLife(),
 *     so leaving mid-board can't refund lives -- and a board that runs out of time costs one more.
 *   - At 0 lives the run is over: the board in play banks the fail points and the run is finished
 *     without the completion bonus.
 *
 * A run (`pounceTournaments/{id}`, admin-built via pounce-generator.js#buildRun) is `{ name, active,
 * completionBonus, boards: [puzzle × 5] }`. Time per board and lives are global
 * (config/pounceTournamentSettings).
 */

const ATTEMPTS_COLLECTION = 'pounceTournamentAttempts';

function attemptDocId(tournamentId, uid) {
    return `${tournamentId}_${uid}`;
}

function boardScoreDocId(uid, tournamentId, boardIndex) {
    return `${uid}_pounce-tournament_${tournamentId}_${boardIndex}`;
}

function bonusScoreDocId(uid, tournamentId) {
    return `${uid}_pounce-tournament-bonus_${tournamentId}`;
}

/** True when the run has nothing left to play: every board played, or no lives left. */
export function runIsOver(tournament, attempt) {
    return attempt.currentPuzzleIndex >= tournament.boards.length || attempt.livesLeft <= 0;
}

export async function listActivePounceTournaments() {
    const q = query(collection(db, 'pounceTournaments'), where('active', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** The player's progress doc for a run, or null if they haven't started it. */
export async function getAttempt(tournamentId, uid) {
    const snap = await getDoc(doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournamentId, uid)));
    return snap.exists() ? snap.data() : null;
}

/** Fetches the progress doc, creating it at board 1 with `lives` lives on first play (doubles as "resume"). */
export async function getOrStartAttempt(tournamentId, uid, profile, lives) {
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
        livesLeft: Math.max(1, Math.min(9, Math.round(lives) || 9)),
        puzzleResults: [],
        startedAt: serverTimestamp(),
        completed: false,
        completedAt: null,
        bonusAwarded: false,
    };
    await setDoc(ref, data);
    return data;
}

/** Saves a lost life straight away (a wrong cat mid-board). Never raises the count. */
export async function spendLife(tournamentId, uid, livesLeft) {
    const ref = doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournamentId, uid));
    try {
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists() || snap.data().livesLeft <= livesLeft) return;
            tx.update(ref, { livesLeft: Math.max(0, livesLeft) });
        });
    } catch (err) {
        // The board's result write re-sends the count, so a missed write here only matters if the
        // player also leaves before the board ends.
        console.error('spendLife: attempt update failed', err);
    }
}

/**
 * Records one board: banks 30 (solved) or 10 (time or lives ran out) via a gameScores create and
 * advances the attempt, in one transaction, also setting `livesLeft` (the engine's count, −1 more
 * for running out of time; `livesAtStart` is the count when the board began, for `livesLost`). `puzzleResults` keeps `{ passed, timedOut, outOfLives,
 * timeTakenSeconds, perfect, livesLost }` per board for the progress strip, summary and share
 * text. Idempotent against a client-level retry (a board already past `boardIndex` is returned
 * as-is, never scored twice).
 */
export async function recordBoardResult(tournament, uid, profile, { boardIndex, passed, timedOut, outOfLives, timeTakenSeconds, perfect, livesLeft, livesAtStart }) {
    const attemptRef = doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournament.id, uid));
    const scoreRef = doc(db, 'gameScores', boardScoreDocId(uid, tournament.id, boardIndex));

    return runTransaction(db, async (tx) => {
        const attemptSnap = await tx.get(attemptRef);
        if (!attemptSnap.exists()) return null;
        const attemptData = attemptSnap.data();
        if (attemptData.currentPuzzleIndex !== boardIndex) return attemptData;

        const scoreSnap = await tx.get(scoreRef);
        if (!scoreSnap.exists()) {
            tx.set(scoreRef, {
                userId: uid,
                displayName: profile.displayName,
                isGuest: profile.kind === 'guest',
                gameType: 'pounce-tournament',
                score: passed ? RUN_BOARD_PASS_POINTS : RUN_BOARD_FAIL_POINTS,
                gameDate: `${tournament.id}_${boardIndex}`, // deterministic key, not a calendar date
                scoreDate: getTodayDateString(),
                tournamentId: tournament.id,
                tournamentName: tournament.name,
                puzzleIndex: boardIndex,
                passed,
                perfect: !!perfect,
                timeTakenSeconds,
                createdAt: serverTimestamp(),
            });
        }

        const startLives = attemptData.livesLeft;
        const after = Math.max(0, Math.min(startLives, livesLeft - (timedOut ? 1 : 0)));
        const patch = {
            currentPuzzleIndex: attemptData.currentPuzzleIndex + 1,
            puzzlesPassed: attemptData.puzzlesPassed + (passed ? 1 : 0),
            puzzlesFailed: attemptData.puzzlesFailed + (passed ? 0 : 1),
            livesLeft: after,
            puzzleResults: [...(attemptData.puzzleResults || []), {
                passed, timedOut: !!timedOut, outOfLives: !!outOfLives || after === 0, timeTakenSeconds, perfect: !!perfect,
                livesLost: Math.max(0, (livesAtStart ?? startLives) - after),
            }],
        };
        tx.update(attemptRef, patch);
        return { ...attemptData, ...patch };
    });
}

/**
 * One-shot finish once the run is over (every board played, or out of lives) -- same retry-safe
 * single transaction as quilt-tournament-data.js#completeTournamentIfNeeded. The bonus doc carries
 * the completion bonus + 5 per life left (0 for a run that ran out of lives) and is where the share
 * bonuses land.
 */
export async function completeTournamentIfNeeded(uid, profile, tournament) {
    const attemptRef = doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournament.id, uid));
    const bonusRef = doc(db, 'gameScores', bonusScoreDocId(uid, tournament.id));

    return runTransaction(db, async (tx) => {
        const attemptSnap = await tx.get(attemptRef);
        if (!attemptSnap.exists()) return null;
        const attemptData = attemptSnap.data();
        if (!runIsOver(tournament, attemptData)) return attemptData;
        if (attemptData.bonusAwarded) return attemptData;

        const bonus = runBonusFor(tournament, attemptData);
        const bonusSnap = await tx.get(bonusRef);
        if (!bonusSnap.exists()) {
            tx.set(bonusRef, {
                userId: uid,
                displayName: profile.displayName,
                isGuest: profile.kind === 'guest',
                gameType: 'pounce-tournament-bonus',
                score: bonus.score,
                gameDate: tournament.id, // deterministic key, not a calendar date
                scoreDate: getTodayDateString(),
                tournamentId: tournament.id,
                tournamentName: tournament.name,
                completionBonus: bonus.completionBonus,
                livesBonus: bonus.livesBonus,
                livesLeft: attemptData.livesLeft,
                finished: bonus.finished,
                sharedToFacebook: false,
                sharedWithFriends: false,
                createdAt: serverTimestamp(),
            });
        }

        const patch = { bonusAwarded: true, completed: true, completedAt: serverTimestamp() };
        tx.update(attemptRef, patch);
        return { ...attemptData, ...patch };
    });
}

async function applyShareBonus(uid, tournamentId, flag, amount) {
    const ref = doc(db, 'gameScores', bonusScoreDocId(uid, tournamentId));
    const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data()[flag]) {
            return { applied: false, newScore: snap.exists() ? snap.data().score : 0 };
        }
        const newScore = snap.data().score + amount;
        tx.update(ref, { score: newScore, [flag]: true, updatedAt: serverTimestamp() });
        return { applied: true, newScore };
    });
    if (result.applied) await awardShareXp(uid);
    return result;
}

/** Guarded one-time +20 / +10 share bonuses, applied to the run's bonus doc (a run's total is
 * spread over per-board docs, so callers track the running total themselves). */
export function markSharedToFacebook(uid, tournamentId) {
    return applyShareBonus(uid, tournamentId, 'sharedToFacebook', 20);
}

export function markSharedWithFriends(uid, tournamentId) {
    return applyShareBonus(uid, tournamentId, 'sharedWithFriends', 10);
}
