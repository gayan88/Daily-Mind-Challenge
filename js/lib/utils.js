export function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function daysSinceEpoch(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    const utcMs = Date.UTC(year, month - 1, day);
    return Math.floor(utcMs / 86400000);
}

export function isConsecutiveDay(prevDateString, todayDateString) {
    if (!prevDateString) return false;
    return daysSinceEpoch(todayDateString) - daysSinceEpoch(prevDateString) === 1;
}

export function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

export function qs(selector, root = document) {
    return root.querySelector(selector);
}

export function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** Formats a duration in milliseconds as "M:SS" (or "H:MM:SS" past an hour), for gameScores.timeTaken. */
export function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatLeaderboardName(displayName, isGuest) {
    return isGuest ? `${displayName} [Guest]` : displayName;
}

export function showToast(message, duration = 2200) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

/** Simple deterministic PRNG (mulberry32) so daily word-search grids are reproducible from a string seed. */
export function mulberry32(seed) {
    let a = seed;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function stringToSeed(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
    }
    return hash;
}
