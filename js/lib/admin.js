import {
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../firebase/firebase-init.js';

/** Looks up a registered user by username (via the usernames/{username} mapping). */
export async function lookupUserByUsername(username) {
    const usernameLower = username.trim().toLowerCase();
    const mapSnap = await getDoc(doc(db, 'usernames', usernameLower));
    if (!mapSnap.exists()) return null;

    const { uid } = mapSnap.data();
    const userSnap = await getDoc(doc(db, 'registeredUsers', uid));
    if (!userSnap.exists()) return null;

    return { uid, ...userSnap.data() };
}

export async function setUserBanned(uid, isBanned, reason = '') {
    await updateDoc(doc(db, 'registeredUsers', uid), {
        isBanned,
        bannedReason: isBanned ? reason : '',
        bannedDate: isBanned ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
    });
}

export async function setUserAdmin(uid, isAdmin) {
    await updateDoc(doc(db, 'registeredUsers', uid), { isAdmin, updatedAt: serverTimestamp() });
}

export async function deleteChallenge(challengeId) {
    await deleteDoc(doc(db, 'challenges', challengeId));
}
