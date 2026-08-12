import {
    onAuthStateChanged,
    signInAnonymously,
    signOut,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { auth } from './firebase-init.js';

let currentUserPromise = null;

/**
 * Resolves once a Firebase user (existing or newly-created anonymous guest) is available.
 * Safe to call from every page; Firebase Auth persists the anonymous uid across reloads.
 */
export function getCurrentUser() {
    if (currentUserPromise) return currentUserPromise;

    currentUserPromise = new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
            auth,
            async (user) => {
                unsubscribe();
                if (user) {
                    resolve(user);
                    return;
                }
                try {
                    const credential = await signInAnonymously(auth);
                    resolve(credential.user);
                } catch (err) {
                    reject(err);
                }
            },
            reject
        );
    });

    return currentUserPromise;
}

/** Signs the current guest out. Their Firestore data is NOT deleted, but becomes unreachable without the old uid. */
export async function signOutGuest() {
    await signOut(auth);
    currentUserPromise = null;
}
