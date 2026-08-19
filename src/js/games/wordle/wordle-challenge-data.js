import {
    collection,
    doc,
    getDoc,
    getDocs,
    getCountFromServer,
    setDoc,
    query,
    orderBy,
    limit,
    startAfter,
    where,
    runTransaction,
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
 * "Challenge a Friend" -- built directly into wordle.html (the app's older generic Challenges
 * page/collection has since been retired in favor of this). Only registered, non-banned users can
 * create one (banned users never reach this point, they're signed out at login); guests can still
 * solve/browse. Expiry reuses config/challengeExpiration.
 *
 * `challengeNumber` is a global, continuously-incrementing counter (not per-creator) so cards can
 * show "Oshini's Challenge #7" instead of two indistinguishable "Oshini's Challenge" cards --
 * same `_meta.totalCount` pattern as the Daily Challenge word pool (`wordle-admin.js`), just
 * incremented inside a transaction here since any registered user can trigger it, not just admins.
 * The doc's own Firestore ID (used in the `?challenge=` share link) is unrelated and unchanged.
 */
export async function createWordleChallenge(profile, word, visibility = 'public') {
    if (profile.kind !== 'registered') {
        throw new Error('Only registered accounts can create challenges. Sign up to create one!');
    }

    const { days: expiryDays } = await getConfig('challengeExpiration');
    const expiresAt = Timestamp.fromMillis(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    const challengeRef = doc(collection(db, COLLECTION));
    const metaRef = doc(db, COLLECTION, '_meta');

    await runTransaction(db, async (tx) => {
        const metaSnap = await tx.get(metaRef);
        const nextNumber = (metaSnap.exists() ? metaSnap.data().totalCount : 0) + 1;

        tx.set(challengeRef, {
            creatorUid: profile.uid,
            creatorDisplayName: profile.displayName,
            word: word.trim().toUpperCase(),
            visibility,
            challengeNumber: nextNumber,
            createdAt: serverTimestamp(),
            expiresAt,
        });
        tx.set(metaRef, { totalCount: nextNumber }, { merge: true });
    });

    return challengeRef.id;
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

/**
 * One page of the most recent PUBLIC challenges, for the Browse tab. Pass the previous call's
 * `lastDoc` as `cursor` to fetch the next page. Note `hasMore` is based on the raw page fetched
 * from Firestore -- since expired challenges are filtered out client-side afterward (and the
 * caller separately excludes the viewer's own challenges), a rendered page can come back with
 * fewer than `pageSize` visible cards even when `hasMore` is true; the next "Load More" click
 * will still make forward progress since it's cursored off the raw docs, not the filtered count.
 */
export async function listPublicWordleChallengesPage(pageSize, cursor = null) {
    const constraints = [collection(db, COLLECTION), where('visibility', '==', 'public'), orderBy('createdAt', 'desc')];
    const q = cursor
        ? query(...constraints, startAfter(cursor), limit(pageSize))
        : query(...constraints, limit(pageSize));
    const snap = await getDocs(q);
    const challenges = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => !isWordleChallengeExpired(c));
    return {
        challenges,
        lastDoc: snap.docs[snap.docs.length - 1] || null,
        hasMore: snap.docs.length === pageSize,
    };
}

/** All challenges (public and private) a user has created, unpaginated -- used for
 * syncCreatorRewards(), which must scan every challenge the creator owns regardless of how many
 * of them are currently rendered on screen (see listMyWordleChallengesPage() for the paginated,
 * render-only version). */
export async function listMyWordleChallenges(uid) {
    const q = query(collection(db, COLLECTION), where('creatorUid', '==', uid), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * One page of a user's challenges, newest first, for rendering "My Challenges" without loading
 * everything at once. Pass the previous call's `lastDoc` as `cursor` to fetch the next page.
 * Returns `hasMore: false` once a page comes back short of `pageSize`.
 */
export async function listMyWordleChallengesPage(uid, pageSize, cursor = null) {
    const constraints = [collection(db, COLLECTION), where('creatorUid', '==', uid), orderBy('createdAt', 'desc')];
    const q = cursor
        ? query(...constraints, startAfter(cursor), limit(pageSize))
        : query(...constraints, limit(pageSize));
    const snap = await getDocs(q);
    return {
        challenges: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        lastDoc: snap.docs[snap.docs.length - 1] || null,
        hasMore: snap.docs.length === pageSize,
    };
}

export async function getWordleChallengeCompletion(challengeId, uid) {
    const snap = await getDoc(doc(db, COLLECTION, challengeId, 'completions', uid));
    return snap.exists() ? snap.data() : null;
}

export async function listWordleChallengeCompletions(challengeId) {
    const snap = await getDocs(collection(db, COLLECTION, challengeId, 'completions'));
    return snap.docs.map((d) => d.data());
}

/** Count of distinct players who *solved* (not just attempted) a challenge, for Browse cards.
 * Uses a server-side aggregation query rather than fetching every completion doc -- cheap even
 * for a popular challenge. */
export async function getWordleChallengeSolveCount(challengeId) {
    const q = query(collection(db, COLLECTION, challengeId, 'completions'), where('won', '==', true));
    const snap = await getCountFromServer(q);
    return snap.data().count;
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
