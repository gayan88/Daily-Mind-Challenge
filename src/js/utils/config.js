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
    myChallengesPageSize: {
        size: 15,
        description: 'Challenges shown per page in "My Challenges" on wordle.html (Load More fetches this many at a time)',
    },
    browseChallengesPageSize: {
        size: 15,
        description: 'Challenges shown per page in "Browse" on wordle.html (Load More fetches this many at a time)',
    },
    leaderboardPageSize: {
        size: 20,
        description: 'Rows shown per page on leaderboard.html (Load More reveals this many more at a time)',
    },
    challengeAttemptsPageSize: {
        size: 10,
        description: 'Attempts shown per page in a Challenge a Friend\'s "More Info" detail view (Load More fetches this many at a time)',
    },
    sudokuTournamentSettings: {
        puzzleCount: 10,
        timeLimitSeconds: 600,
        maxErrors: 3,
        description: 'Global rules applied to every Sudoku Tournament: puzzle count (a guideline for admins creating one), seconds allowed per puzzle, and errors allowed per puzzle before it\'s failed. The completion bonus is set per tournament when it\'s created.',
    },
    wordsearchTournamentSettings: {
        puzzleCount: 10,
        timeLimitSeconds: 300,
        completedPoints: 50,
        failedPoints: 10,
        description: 'Global rules applied to every Word Search Tournament: puzzle count (a guideline for admins creating one), seconds allowed per puzzle, and points awarded for completing/failing a puzzle. The completion bonus is set per tournament when it\'s created.',
    },
    wordValidationAPI: {
        // v2, not v1 -- v1 returns 502 (not 404) for a word that doesn't exist, which makes it
        // impossible to distinguish "not a real word" from "the API is down".
        endpoint: 'https://api.dictionaryapi.dev/api/v2/entries/en/',
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
