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
import { db } from '../firebase/firebase-init.js';

const DEFAULT_EXPIRY_HOURS = 48;

/**
 * v1 "challenges" are shareable links, not a real friends graph (guest-only auth has no
 * friend list to notify). Anyone with the link can attempt the challenge once.
 */
export async function createChallenge(creatorUid, creatorDisplayName, word, game = 'wordle') {
    const expiresAt = Timestamp.fromMillis(Date.now() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);
    const ref = await addDoc(collection(db, 'challenges'), {
        creatorUid,
        creatorDisplayName,
        word: word.toUpperCase(),
        game,
        createdAt: serverTimestamp(),
        expiresAt,
    });
    return ref.id;
}

export async function getChallenge(challengeId) {
    const snap = await getDoc(doc(db, 'challenges', challengeId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

export function isChallengeExpired(challenge) {
    if (!challenge?.expiresAt) return false;
    return challenge.expiresAt.toMillis() < Date.now();
}

/** Lists the most recent non-expired challenges (open to anyone with the link). */
export async function listOpenChallenges(limitCount = 20) {
    const q = query(collection(db, 'challenges'), orderBy('createdAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return all.filter((c) => !isChallengeExpired(c));
}

export async function getChallengeCompletion(challengeId, uid) {
    const snap = await getDoc(doc(db, 'challenges', challengeId, 'completions', uid));
    return snap.exists() ? snap.data() : null;
}

export async function recordChallengeCompletion(challengeId, uid, displayName, won, attempts) {
    await setDoc(doc(db, 'challenges', challengeId, 'completions', uid), {
        uid,
        displayName,
        won,
        attempts,
        completedAt: serverTimestamp(),
    });
}
