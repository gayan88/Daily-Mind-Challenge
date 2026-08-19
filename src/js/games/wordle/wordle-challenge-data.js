import {
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    setDoc,
    query,
    orderBy,
    limit,
    where,
    serverTimestamp,
    Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../api/firebase-init.js';
import { getConfig } from '../../utils/config.js';

const COLLECTION = 'wordleChallenges';

function challengeScoreDocId(uid, challengeId) {
    return `${uid}_wordle-challenge_${challengeId}`;
}

function creatorScoreDocId(creatorUid, challengeId, completerUid) {
    return `${creatorUid}_wordle-challenge-creator_${challengeId}_${completerUid}`;
}

/**
 * "Challenge a Friend" -- a Wordle-specific parallel to the generic challenges.html feature
 * (kept separate per the revamp plan, rather than reusing that page). Only registered,
 * non-banned users can create one (banned users never reach this point, they're signed out at
 * login); guests can still solve/browse. Expiry reuses config/challengeExpiration, same as the
 * generic challenges feature.
 */
export async function createWordleChallenge(profile, word, visibility = 'public') {
    if (profile.kind !== 'registered') {
        throw new Error('Only registered accounts can create challenges. Sign up to create one!');
    }

    const { days: expiryDays } = await getConfig('challengeExpiration');
    const expiresAt = Timestamp.fromMillis(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    const ref = await addDoc(collection(db, COLLECTION), {
        creatorUid: profile.uid,
        creatorDisplayName: profile.displayName,
        word: word.trim().toUpperCase(),
        visibility,
        createdAt: serverTimestamp(),
        expiresAt,
    });
    return ref.id;
}

export async function getWordleChallenge(challengeId) {
    const snap = await getDoc(doc(db, COLLECTION, challengeId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

export function isWordleChallengeExpired(challenge) {
    if (!challenge?.expiresAt) return false;
    return challenge.expiresAt.toMillis() < Date.now();
}

/** Most recent non-expired PUBLIC challenges, for the Browse tab. */
export async function listPublicWordleChallenges(limitCount = 20) {
    const q = query(
        collection(db, COLLECTION),
        where('visibility', '==', 'public'),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => !isWordleChallengeExpired(c));
}

/** All challenges (public and private) a user has created, for "My Challenges". */
export async function listMyWordleChallenges(uid) {
    const q = query(collection(db, COLLECTION), where('creatorUid', '==', uid), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getWordleChallengeCompletion(challengeId, uid) {
    const snap = await getDoc(doc(db, COLLECTION, challengeId, 'completions', uid));
    return snap.exists() ? snap.data() : null;
}

export async function listWordleChallengeCompletions(challengeId) {
    const snap = await getDocs(collection(db, COLLECTION, challengeId, 'completions'));
    return snap.docs.map((d) => d.data());
}

/**
 * Records a player's attempt at someone else's challenge and awards their own points: 10 for
 * playing (always) + 20 for winning. The creator's matching +10 is deliberately NOT awarded here
 * -- Firestore rules require a gameScores doc's `userId` to match the writer's own auth uid, so a
 * completer's session can never credit the creator directly (that would let anyone inflate
 * anyone else's score on demand). See syncCreatorRewards() below for how the creator's side gets
 * paid instead. Returns the written score fields, or null if this player already completed it.
 */
export async function recordWordleChallengeCompletion(challengeId, uid, profile, { won, attempts, timeTakenSeconds }) {
    const completionRef = doc(db, COLLECTION, challengeId, 'completions', uid);
    const existing = await getDoc(completionRef);
    if (existing.exists()) return null;

    await setDoc(completionRef, {
        uid,
        displayName: profile.displayName,
        won,
        attempts,
        timeTakenSeconds,
        completedAt: serverTimestamp(),
    });

    const score = 10 + (won ? 20 : 0);
    const data = {
        userId: uid,
        displayName: profile.displayName,
        isGuest: profile.kind === 'guest',
        gameType: 'wordle-challenge',
        score,
        gameDate: challengeId, // repurposed as the deterministic key, not a calendar date
        createdAt: serverTimestamp(),
    };

    try {
        await setDoc(doc(db, 'gameScores', challengeScoreDocId(uid, challengeId)), data);
    } catch (err) {
        console.error('recordWordleChallengeCompletion: gameScores write failed', err);
        return null; // lost a race, or the write was rejected -- caller must not assume points landed
    }
    return data;
}

/**
 * Retroactively grants the creator's +10-per-distinct-solver reward for one challenge. Must run
 * from the CREATOR's own signed-in session (Firestore rules require the gameScores doc's userId
 * to equal request.auth.uid), which is exactly when this is called -- from "My Challenges", the
 * creator's own view. Guarded by the same create-once gameScores pattern as everywhere else in
 * this app, so it's safe to call every time that view opens. Returns points newly awarded.
 */
async function awardCreatorPointsForChallenge(creatorUid, creatorProfile, challenge) {
    const completionsSnap = await getDocs(collection(db, COLLECTION, challenge.id, 'completions'));
    let newlyAwarded = 0;

    for (const completionDoc of completionsSnap.docs) {
        const completerUid = completionDoc.id;
        const scoreRef = doc(db, 'gameScores', creatorScoreDocId(creatorUid, challenge.id, completerUid));
        const existing = await getDoc(scoreRef);
        if (existing.exists()) continue;

        try {
            await setDoc(scoreRef, {
                userId: creatorUid,
                displayName: creatorProfile.displayName,
                isGuest: creatorProfile.kind === 'guest',
                gameType: 'wordle-challenge-creator',
                score: 10,
                gameDate: `${challenge.id}_${completerUid}`,
                challengeId: challenge.id,
                completerUid,
                createdAt: serverTimestamp(),
            });
            newlyAwarded += 10;
        } catch (err) {
            console.error('awardCreatorPointsForChallenge: gameScores write failed', err);
        }
    }
    return newlyAwarded;
}

/** Runs awardCreatorPointsForChallenge() across every challenge the creator owns. Returns total
 * points newly awarded, so the caller can toast it. */
export async function syncCreatorRewards(uid, profile, myChallenges) {
    let total = 0;
    for (const challenge of myChallenges) {
        total += await awardCreatorPointsForChallenge(uid, profile, challenge);
    }
    return total;
}
