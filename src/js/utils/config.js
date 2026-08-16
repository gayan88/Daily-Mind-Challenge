import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';

// Hardcoded fallbacks so the app works correctly even before an admin has visited admin.html
// to seed these documents in Firestore. admin.html writes these same shapes into config/*.
export const CONFIG_DEFAULTS = {
    dailyLoginReward: {
        points: 10,
        description: 'Daily login reward for registered users',
    },
    challengeExpiration: {
        days: 3,
        description: 'Challenge expires after N days',
    },
    maxChallengeCreationsPerDay: {
        limit: null,
        description: 'Max challenges user can create per day (null = no limit)',
    },
    wordValidationAPI: {
        endpoint: 'https://api.dictionaryapi.dev/api/v1/entries/en/',
        description: 'Free Dictionary API endpoint for word validation',
    },
    profanityList: {
        blockedWords: ['fuck', 'shit', 'asshole', 'bitch', 'damn', 'bastard', 'crap', 'dick'],
        description: 'Words blocked from display names',
    },
};

const cache = {};

/** Reads config/{docId}, falling back to CONFIG_DEFAULTS[docId] (or a caller-supplied default) if missing/unreadable. */
export async function getConfig(docId, fallbackDefaults = CONFIG_DEFAULTS[docId]) {
    if (cache[docId]) return cache[docId];
    try {
        const snap = await getDoc(doc(db, 'config', docId));
        const data = snap.exists() ? snap.data() : fallbackDefaults;
        cache[docId] = data;
        return data;
    } catch {
        return fallbackDefaults;
    }
}

/** Creates config/{docId} with defaults if it doesn't exist yet. Used once by admin.html on load. */
export async function ensureConfigDefaults(docId, defaults = CONFIG_DEFAULTS[docId]) {
    const ref = doc(db, 'config', docId);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const data = { ...defaults, updatedAt: serverTimestamp() };
    await setDoc(ref, data);
    cache[docId] = data;
    return data;
}

export async function updateConfig(docId, fields) {
    const ref = doc(db, 'config', docId);
    const data = { ...fields, updatedAt: serverTimestamp() };
    await setDoc(ref, data, { merge: true });
    delete cache[docId];
}
