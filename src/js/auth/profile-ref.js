import { doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';

/**
 * Where a player's progression fields (xp, currentStreak, lastStreakDate, lastPerfectDayDate,
 * lastFlawlessDayDate, perfectDayCount) live: `registeredUsers/{uid}` for members, `guests/{uid}`
 * for guests (since 2026-11-14 guests earn XP/Rank/Streak/Achievements/Missions too). The kind is
 * recorded once per page load by auth/user-profile.js#loadSessionProfile(), before any game or
 * page can award anything, so xp-service / streak-service / mission-service just call
 * profileDocRef(uid) instead of hardcoding `registeredUsers`.
 */
const kindByUid = new Map();

export function rememberProfileKind(uid, kind) {
    kindByUid.set(uid, kind);
}

export function profileKindOf(uid) {
    return kindByUid.get(uid) || 'registered';
}

export function profileDocRef(uid) {
    return doc(db, profileKindOf(uid) === 'guest' ? 'guests' : 'registeredUsers', uid);
}

// "This browser has been used by a member" -- lets the game pages offer "Log in" first instead of
// quietly starting a new guest (so a returning member doesn't end up with a stray guest account).
// Per-browser convenience only; wrapped because storage can throw (private mode, blocked data).
const MEMBER_FLAG = 'dmc_member';

export function markBrowserAsMember() {
    try { localStorage.setItem(MEMBER_FLAG, '1'); } catch { /* storage unavailable */ }
}

export function browserHasMember() {
    try { return localStorage.getItem(MEMBER_FLAG) === '1'; } catch { return false; }
}
