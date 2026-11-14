import {
    onAuthStateChanged,
    signInAnonymously,
    signOut,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    updatePassword,
    linkWithCredential,
    EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { auth, db } from '../api/firebase-init.js';

let sessionPromise = null;

function resetSessionCache() {
    sessionPromise = null;
}

/** synthetic login email for a username that didn't supply a real one at signup. */
export function syntheticEmailFor(usernameLower) {
    return `${usernameLower}@dmc.local`;
}

/**
 * Resolves to the existing Firebase Auth user if one exists (guest or registered), or `null` if
 * not. Deliberately does NOT auto-create an anonymous guest on page load (that would make an
 * account for every crawler and one-glance visitor) -- a guest is created only when a visitor taps
 * "Play now" on a game page or "Play as Guest" in the sign-in box (utils/guest-start.js).
 */
export function getSessionUser() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user || null);
        });
    });
    return sessionPromise;
}

export async function signInAsGuest() {
    const credential = await signInAnonymously(auth);
    resetSessionCache();
    return credential.user;
}

/**
 * Turns the signed-in *guest* (anonymous) account into a member account in place: attaches an
 * email/password login to the same Firebase Auth user, so the uid -- and therefore every score,
 * achievement, mission and attempt already saved under it -- stays the same. The token is
 * refreshed straight away so Firestore rules see the new login (email) on the very next write.
 */
export async function linkGuestToPassword(username, password, email) {
    const user = auth.currentUser;
    if (!user || !user.isAnonymous) throw new Error('Only a guest session can be saved as a member account.');
    const usernameLower = username.trim().toLowerCase();
    const authEmail = email ? email.trim() : syntheticEmailFor(usernameLower);
    const credential = await linkWithCredential(user, EmailAuthProvider.credential(authEmail, password));
    await credential.user.getIdToken(true);
    resetSessionCache();
    return { user: credential.user, usernameLower, authEmail };
}

export async function signUpWithUsername(username, password, email) {
    const usernameLower = username.trim().toLowerCase();
    const authEmail = email ? email.trim() : syntheticEmailFor(usernameLower);
    const credential = await createUserWithEmailAndPassword(auth, authEmail, password);
    resetSessionCache();
    return { user: credential.user, usernameLower, authEmail };
}

export async function loginWithUsername(username, password) {
    const usernameLower = username.trim().toLowerCase();
    const mapSnap = await getDoc(doc(db, 'usernames', usernameLower));
    if (!mapSnap.exists()) {
        throw new Error('No account found with that username.');
    }
    const { authEmail } = mapSnap.data();
    const credential = await signInWithEmailAndPassword(auth, authEmail, password);
    resetSessionCache();
    return credential.user;
}

/** Only works for accounts that supplied a real email at signup (Firebase Auth account email
 * is the synthetic one otherwise, so the reset email would go nowhere). */
export async function requestPasswordReset(username) {
    const usernameLower = username.trim().toLowerCase();
    const mapSnap = await getDoc(doc(db, 'usernames', usernameLower));
    if (!mapSnap.exists()) {
        throw new Error('No account found with that username.');
    }
    const { authEmail } = mapSnap.data();
    if (authEmail.endsWith('@dmc.local')) {
        throw new Error('No recovery email on file for this account. Contact support for a manual reset.');
    }
    await sendPasswordResetEmail(auth, authEmail);
}

export async function changePassword(newPassword) {
    if (!auth.currentUser) throw new Error('Not signed in.');
    await updatePassword(auth.currentUser, newPassword);
}

export async function signOutSession() {
    await signOut(auth);
    resetSessionCache();
}

const AUTH_ERROR_MESSAGES = {
    // Firebase returns this same generic code for both "no such account" and "wrong password"
    // (so a login attempt can't be used to probe which usernames exist).
    'auth/invalid-credential': 'Incorrect username or password.',
    'auth/wrong-password': 'Incorrect username or password.',
    'auth/user-not-found': 'Incorrect username or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error -- check your connection and try again.',
    'auth/email-already-in-use': 'That username is already taken.',
    'auth/weak-password': 'Password is too weak. Use at least 8 characters, 1 uppercase letter, and 1 number.',
    'auth/credential-already-in-use': 'That username is already taken.',
    'auth/provider-already-linked': 'This guest has already been saved as a member account.',
    'auth/requires-recent-login': 'For security, please log out and back in before doing that.',
};

/** Maps a raw Firebase Auth error to user-facing copy instead of surfacing "Firebase: Error (auth/...)" text. */
export function friendlyAuthErrorMessage(err) {
    return AUTH_ERROR_MESSAGES[err?.code] || err?.message || 'Something went wrong. Please try again.';
}
