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
import { getConfig } from './config.js';

function startOfTodayTimestamp() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Timestamp.fromDate(now);
}

/**
 * v1 "challenges" are shareable links, not a real friends graph. Anyone with the link can attempt
 * the challenge once. Only registered users can create challenges (guests can't, per the
 * feature table); banned users never reach this point since they're signed out at login.
 */
export async function createChallenge(profile, word, game = 'wordle') {
    if (profile.kind !== 'registered') {
        throw new Error('Only registered accounts can create challenges. Sign up to create one!');
    }

    const [{ days: expiryDays }, { limit: dailyLimit }] = await Promise.all([
        getConfig('challengeExpiration'),
        getConfig('maxChallengeCreationsPerDay'),
    ]);

    if (dailyLimit !== null && dailyLimit !== undefined) {
        const countQuery = query(
            collection(db, 'challenges'),
            where('creatorUid', '==', profile.uid),
            where('createdAt', '>=', startOfTodayTimestamp())
        );
        const countSnap = await getDocs(countQuery);
        if (countSnap.size >= dailyLimit) {
            throw new Error(`You've reached today's limit of ${dailyLimit} challenge(s). Try again tomorrow.`);
        }
    }

    const expiresAt = Timestamp.fromMillis(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    const ref = await addDoc(collection(db, 'challenges'), {
        creatorUid: profile.uid,
        creatorDisplayName: profile.displayName,
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
