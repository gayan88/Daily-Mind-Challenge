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
import { TOURNAMENT_TILE_PASS_POINTS, TOURNAMENT_TILE_FAIL_POINTS, PERFECT_PATCHWORK_BONUS } from './quilt-scoring.js';

/**
 * Patchwork Run (Quilt's Tournament) data layer -- same shape and guarantees as
 * sudoku-tournament-data.js (see its doc comments): one attempt doc per player per run that only
 * ever advances, each tile's points banked in the same transaction that advances it, a failed tile
 * banks fewer points and the run moves on, and a retry-safe one-shot completion bonus.
 *
 * A run (`quiltTournaments/{id}`, admin-built from one big picture via
 * quilt-generator.js#buildPatchwork) is `{ name, active, completionBonus, title, palette, pixels,
 * width, height, cols, rows, tiles: [puzzle + tileX/tileY] }`. The per-tile time limit is global
 * (config/quiltTournamentSettings).
 */

const ATTEMPTS_COLLECTION = 'quiltTournamentAttempts';

function attemptDocId(tournamentId, uid) {
    return `${tournamentId}_${uid}`;
}

function tileScoreDocId(uid, tournamentId, tileIndex) {
    return `${uid}_quilt-tournament_${tournamentId}_${tileIndex}`;
}

function bonusScoreDocId(uid, tournamentId) {
    return `${uid}_quilt-tournament-bonus_${tournamentId}`;
}

export async function listActiveQuiltTournaments() {
    const q = query(collection(db, 'quiltTournaments'), where('active', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** The player's progress doc for a run, or null if they haven't started it. */
export async function getAttempt(tournamentId, uid) {
    const snap = await getDoc(doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournamentId, uid)));
    return snap.exists() ? snap.data() : null;
}

/** Fetches the progress doc, creating it at tile 1 on first play (doubles as "resume"). */
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
        puzzleResults: [],
        startedAt: serverTimestamp(),
        completed: false,
        completedAt: null,
        bonusAwarded: false,
    };
    await setDoc(ref, data);
    return data;
}

/**
 * Records one tile: banks 30 (solved) or 10 (time ran out) via a gameScores create and advances
 * the attempt, in one transaction. `puzzleResults` keeps `{ passed, timeTakenSeconds, perfect }`
 * per tile for the mosaic, summary and share text. Idempotent against a client-level retry (a
 * tile already past `tileIndex` is returned as-is, never scored twice). Field names
 * (`currentPuzzleIndex`, `puzzlesPassed`...) match Sudoku's so the rules stay the same shape.
 */
export async function recordTileResult(tournament, uid, profile, { tileIndex, passed, timeTakenSeconds, perfect }) {
    const attemptRef = doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournament.id, uid));
    const scoreRef = doc(db, 'gameScores', tileScoreDocId(uid, tournament.id, tileIndex));

    return runTransaction(db, async (tx) => {
        const attemptSnap = await tx.get(attemptRef);
        if (!attemptSnap.exists()) return null;
        const attemptData = attemptSnap.data();
        if (attemptData.currentPuzzleIndex !== tileIndex) return attemptData;

        const scoreSnap = await tx.get(scoreRef);
        if (!scoreSnap.exists()) {
            tx.set(scoreRef, {
                userId: uid,
                displayName: profile.displayName,
                isGuest: profile.kind === 'guest',
                gameType: 'quilt-tournament',
                score: passed ? TOURNAMENT_TILE_PASS_POINTS : TOURNAMENT_TILE_FAIL_POINTS,
                gameDate: `${tournament.id}_${tileIndex}`, // deterministic key, not a calendar date
                scoreDate: getTodayDateString(),
                tournamentId: tournament.id,
                tournamentName: tournament.name,
                puzzleIndex: tileIndex,
                passed,
                perfect: !!perfect,
                timeTakenSeconds,
                createdAt: serverTimestamp(),
            });
        }

        const patch = {
            currentPuzzleIndex: attemptData.currentPuzzleIndex + 1,
            puzzlesPassed: attemptData.puzzlesPassed + (passed ? 1 : 0),
            puzzlesFailed: attemptData.puzzlesFailed + (passed ? 0 : 1),
            puzzleResults: [...(attemptData.puzzleResults || []), { passed, timeTakenSeconds, perfect: !!perfect }],
        };
        tx.update(attemptRef, patch);
        return { ...attemptData, ...patch };
    });
}

/** Completion bonus for a finished attempt: the run's own bonus + Perfect Patchwork if every tile passed. */
export function completionBonusFor(tournament, attempt) {
    const perfectPatchwork = attempt.puzzlesFailed === 0 && attempt.puzzlesPassed === tournament.tiles.length;
    return { bonus: tournament.completionBonus, perfectPatchwork, perfectPatchworkBonus: perfectPatchwork ? PERFECT_PATCHWORK_BONUS : 0 };
}

/**
 * One-shot completion bonus once every tile has been attempted (same retry-safe single
 * transaction as sudoku-tournament-data.js#completeTournamentIfNeeded). The bonus doc carries the
 * run's completion bonus plus Perfect Patchwork, and is where the share bonuses land.
 */
export async function completeTournamentIfNeeded(uid, profile, tournament) {
    const attemptRef = doc(db, ATTEMPTS_COLLECTION, attemptDocId(tournament.id, uid));
    const bonusRef = doc(db, 'gameScores', bonusScoreDocId(uid, tournament.id));

    return runTransaction(db, async (tx) => {
        const attemptSnap = await tx.get(attemptRef);
        if (!attemptSnap.exists()) return null;
        const attemptData = attemptSnap.data();
        if (attemptData.currentPuzzleIndex < tournament.tiles.length) return attemptData;
        if (attemptData.bonusAwarded) return attemptData;

        const { bonus, perfectPatchwork, perfectPatchworkBonus } = completionBonusFor(tournament, attemptData);
        const bonusSnap = await tx.get(bonusRef);
        if (!bonusSnap.exists()) {
            tx.set(bonusRef, {
                userId: uid,
                displayName: profile.displayName,
                isGuest: profile.kind === 'guest',
                gameType: 'quilt-tournament-bonus',
                score: bonus + perfectPatchworkBonus,
                gameDate: tournament.id, // deterministic key, not a calendar date
                scoreDate: getTodayDateString(),
                tournamentId: tournament.id,
                tournamentName: tournament.name,
                completionBonus: bonus,
                perfectPatchwork,
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
 * spread over per-tile docs, so callers track the running total themselves). */
export function markSharedToFacebook(uid, tournamentId) {
    return applyShareBonus(uid, tournamentId, 'sharedToFacebook', 20);
}

export function markSharedWithFriends(uid, tournamentId) {
    return applyShareBonus(uid, tournamentId, 'sharedWithFriends', 10);
}
