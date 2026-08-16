import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    writeBatch,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { signOutSession } from './auth.js';

export class BannedError extends Error {
    constructor(reason) {
        super(reason || 'This account has been banned.');
        this.name = 'BannedError';
    }
}

export class ProfileNotFoundError extends Error {
    constructor() {
        super('Account profile not found. Please sign in again.');
        this.name = 'ProfileNotFoundError';
    }
}

/** Called once by js/pages/home.js right after signInAsGuest(). Guests cannot rename themselves later. */
export async function createGuestProfile(uid, displayName) {
    const ref = doc(db, 'guests', uid);
    const data = { displayName, createdAt: serverTimestamp(), lastLoginAt: serverTimestamp() };
    await setDoc(ref, data);
    return data;
}

/** Called once by js/pages/home.js right after signUpWithUsername(). Creates the profile doc and the
 * public username->authEmail lookup doc together so a signup can't leave one without the other. */
export async function createRegisteredProfile(uid, { usernameLower, displayName, email, authEmail }) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'registeredUsers', uid), {
        username: usernameLower,
        displayName,
        email: email || null,
        isAdmin: false,
        isBanned: false,
        bannedReason: '',
        bannedDate: null,
        loginPoints: 0,
        lastLoginDate: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'usernames', usernameLower), { uid, authEmail });
    await batch.commit();
}

function normalizeGuest(uid, data) {
    return {
        uid,
        kind: 'guest',
        displayName: data.displayName,
        isAdmin: false,
        isBanned: false,
        loginPoints: 0,
        lastLoginDate: null,
        raw: data,
    };
}

function normalizeRegistered(uid, data) {
    return {
        uid,
        kind: 'registered',
        displayName: data.displayName,
        username: data.username,
        email: data.email || null,
        isAdmin: !!data.isAdmin,
        isBanned: !!data.isBanned,
        loginPoints: data.loginPoints || 0,
        lastLoginDate: data.lastLoginDate || '',
        raw: data,
    };
}

/**
 * Loads the profile for an existing Firebase Auth session (guest or registered), using
 * user.isAnonymous to pick the collection -- no extra read needed to know which kind it is.
 * Signs the user out and throws if the account is banned or its profile doc is missing.
 */
export async function loadSessionProfile(user) {
    if (user.isAnonymous) {
        const ref = doc(db, 'guests', user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            await signOutSession();
            throw new ProfileNotFoundError();
        }
        await updateDoc(ref, { lastLoginAt: serverTimestamp() });
        return normalizeGuest(user.uid, snap.data());
    }

    const ref = doc(db, 'registeredUsers', user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
        await signOutSession();
        throw new ProfileNotFoundError();
    }
    const data = snap.data();
    if (data.isBanned) {
        await signOutSession();
        throw new BannedError(data.bannedReason);
    }
    return normalizeRegistered(user.uid, data);
}

export async function isUsernameTaken(usernameLower) {
    const snap = await getDoc(doc(db, 'usernames', usernameLower));
    return snap.exists();
}

export async function updateRegisteredProfile(uid, fields) {
    await updateDoc(doc(db, 'registeredUsers', uid), { ...fields, updatedAt: serverTimestamp() });
}
