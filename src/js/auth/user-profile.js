import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    updateDoc,
    writeBatch,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { signOutSession } from './auth.js';
import { rememberProfileKind, markBrowserAsMember } from './profile-ref.js';
import { randomGuestName, guestNameKey } from '../utils/guest-names.js';

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

// Progression fields a guest earns exactly like a member (since 2026-11-14). They live on the
// guest doc and are copied onto the member doc on conversion (convertGuestToMember below).
const PROGRESSION_DEFAULTS = {
    xp: 0,
    currentStreak: 0,
    lastStreakDate: '',
    lastPerfectDayDate: '',
};

const NAME_ATTEMPTS = 5;

/**
 * Creates the guest profile right after signInAsGuest(), with an automatic, unique name
 * ("Clever Fox 482", see utils/guest-names.js). The name is reserved by creating
 * `guestNames/{nameKey}` in the same batch as the guest doc: firestore.rules only lets that doc be
 * *created* (never overwritten), so if two guests ever draw the same name at the same instant one
 * batch fails and that guest simply draws again. After NAME_ATTEMPTS clashes a 4-digit number is
 * used, so creating a guest never fails because of a name. Returns the profile data written.
 */
export async function createGuestProfile(uid) {
    let lastError = null;
    for (let attempt = 0; attempt <= NAME_ATTEMPTS; attempt++) {
        const displayName = randomGuestName(attempt === NAME_ATTEMPTS);
        const nameKey = guestNameKey(displayName);
        const data = {
            displayName,
            nameKey,
            ...PROGRESSION_DEFAULTS,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
        };
        const batch = writeBatch(db);
        batch.set(doc(db, 'guestNames', nameKey), { uid, createdAt: serverTimestamp() });
        batch.set(doc(db, 'guests', uid), data);
        try {
            await batch.commit();
            return data;
        } catch (err) {
            lastError = err; // most likely the name was taken -- draw another
        }
    }
    throw lastError;
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
        currentStreak: 0,
        lastStreakDate: '',
        xp: 0,
        lastPerfectDayDate: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'usernames', usernameLower), { uid, authEmail });
    await batch.commit();
    markBrowserAsMember();
}

// Remembered between the Auth link and the Firestore half of a conversion, so a conversion
// interrupted in between (closed tab, lost connection) is finished on the next page load instead
// of leaving a linked login with no member profile.
const PENDING_CONVERSION_KEY = 'dmc_pending_conversion';

function savePendingConversion(value) {
    try { localStorage.setItem(PENDING_CONVERSION_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function readPendingConversion() {
    try { return JSON.parse(localStorage.getItem(PENDING_CONVERSION_KEY) || 'null'); } catch { return null; }
}

function clearPendingConversion() {
    try { localStorage.removeItem(PENDING_CONVERSION_KEY); } catch { /* storage unavailable */ }
}

/** Step 1 of a conversion, called by home.js just before auth.js#linkGuestToPassword(). */
export function rememberPendingConversion({ usernameLower, displayName, email, authEmail }) {
    savePendingConversion({ usernameLower, displayName, email: email || null, authEmail });
}

/**
 * Step 2 of turning a guest into a member (after auth.js#linkGuestToPassword() has attached the
 * login to the same uid): one batch creates `registeredUsers/{uid}` carrying the guest's XP,
 * streak and perfect-day fields over, reserves the username, and removes the guest doc + its name
 * reservation. firestore.rules check the carried-over numbers against the guest doc, so they
 * can't be inflated on the way. Achievements, missions, attempts and scores are all keyed by uid,
 * so they need no copying; the guest's past scores are then relabelled with the new display name
 * (and `isGuest: false`) so leaderboards show the member, not the old guest name.
 */
export async function convertGuestToMember(uid, { usernameLower, displayName, email, authEmail }) {
    const guestSnap = await getDoc(doc(db, 'guests', uid));
    const guest = guestSnap.exists() ? guestSnap.data() : {};

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
        currentStreak: guest.currentStreak || 0,
        lastStreakDate: guest.lastStreakDate || '',
        xp: guest.xp || 0,
        lastPerfectDayDate: guest.lastPerfectDayDate || '',
        lastFlawlessDayDate: guest.lastFlawlessDayDate || '',
        perfectDayCount: guest.perfectDayCount || 0,
        convertedFromGuestAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'usernames', usernameLower), { uid, authEmail });
    if (guestSnap.exists()) batch.delete(doc(db, 'guests', uid));
    if (guest.nameKey) batch.delete(doc(db, 'guestNames', guest.nameKey));
    await batch.commit();
    clearPendingConversion();
    markBrowserAsMember();
    rememberProfileKind(uid, 'registered');

    await relabelPastScores(uid, displayName);
}

/** Past `gameScores` docs carry the name and guest flag they were written with; after a
 * conversion they're updated in chunks (firestore.rules allow exactly this two-field change, and
 * only by the owner once they're a member). Best-effort: a failure here never undoes the
 * conversion itself. */
async function relabelPastScores(uid, displayName) {
    try {
        const snap = await getDocs(query(collection(db, 'gameScores'), where('userId', '==', uid)));
        const docs = snap.docs.filter((d) => d.data().isGuest !== false || d.data().displayName !== displayName);
        for (let i = 0; i < docs.length; i += 400) {
            const batch = writeBatch(db);
            docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { displayName, isGuest: false }));
            await batch.commit();
        }
    } catch {
        // Leaderboards fall back to the newest member-labelled score anyway (leaderboard-data.js).
    }
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
        xp: data.xp || 0,
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
        xp: data.xp || 0,
        raw: data,
    };
}

/**
 * Loads the profile for an existing Firebase Auth session (guest or registered), using
 * user.isAnonymous to pick the collection -- no extra read needed to know which kind it is.
 *
 * A guest whose doc is gone (removed by Admin's guest clean-up after 30+ days away) quietly gets
 * a fresh guest profile on the same login instead of an error. A member whose doc is missing but
 * who has a conversion pending on this browser has that conversion finished here. Otherwise signs
 * the user out and throws if the account is banned or its profile doc is missing.
 */
export async function loadSessionProfile(user) {
    if (user.isAnonymous) {
        rememberProfileKind(user.uid, 'guest');
        const ref = doc(db, 'guests', user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            const data = await createGuestProfile(user.uid);
            return normalizeGuest(user.uid, data);
        }
        await updateDoc(ref, { lastLoginAt: serverTimestamp() });
        return normalizeGuest(user.uid, snap.data());
    }

    rememberProfileKind(user.uid, 'registered');
    const ref = doc(db, 'registeredUsers', user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
        const pending = readPendingConversion();
        if (pending) {
            try {
                await convertGuestToMember(user.uid, pending);
                snap = await getDoc(ref);
            } catch { /* fall through to the not-found handling below */ }
        }
    }
    if (!snap.exists()) {
        await signOutSession();
        throw new ProfileNotFoundError();
    }
    const data = snap.data();
    if (data.isBanned) {
        await signOutSession();
        throw new BannedError(data.bannedReason);
    }
    markBrowserAsMember();
    return normalizeRegistered(user.uid, data);
}

/** XP + whether the guest has played at all -- used to warn a guest before they log in to a
 * different (member) account, since guest progress can't be merged into an existing account. */
export async function getGuestProgressSummary(uid) {
    const [guestSnap, scoresSnap] = await Promise.all([
        getDoc(doc(db, 'guests', uid)),
        getDocs(query(collection(db, 'gameScores'), where('userId', '==', uid))),
    ]);
    const guest = guestSnap.exists() ? guestSnap.data() : {};
    const points = scoresSnap.docs.reduce((sum, d) => sum + (d.data().score || 0), 0);
    return { displayName: guest.displayName || 'Guest', xp: guest.xp || 0, points, scoreCount: scoresSnap.size };
}

export async function isUsernameTaken(usernameLower) {
    const snap = await getDoc(doc(db, 'usernames', usernameLower));
    return snap.exists();
}

export async function updateRegisteredProfile(uid, fields) {
    await updateDoc(doc(db, 'registeredUsers', uid), { ...fields, updatedAt: serverTimestamp() });
}
