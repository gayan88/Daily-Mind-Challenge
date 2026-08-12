import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    onSnapshot,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../firebase/firebase-init.js';

function defaultDisplayName(uid) {
    return `Guest${uid.slice(0, 4).toUpperCase()}`;
}

/** Reads users/{uid}, creating it with defaults on first visit. Returns the profile data. */
export async function ensureUserDoc(uid) {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
        return snap.data();
    }

    const defaults = {
        displayName: defaultDisplayName(uid),
        createdAt: serverTimestamp(),
        lastLoginDate: '',
        totalPoints: 0,
        currentStreak: 0,
        gamesCompleted: {},
    };
    await setDoc(ref, defaults);
    return defaults;
}

export function subscribeToUserDoc(uid, callback) {
    const ref = doc(db, 'users', uid);
    return onSnapshot(ref, (snap) => {
        if (snap.exists()) callback(snap.data());
    });
}

export async function updateDisplayName(uid, displayName) {
    const ref = doc(db, 'users', uid);
    await updateDoc(ref, { displayName });
}
