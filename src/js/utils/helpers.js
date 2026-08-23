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

/** Returns the "YYYY-MM-DD" date `daysAgo` days before today (0 = today itself). */
export function getDateDaysAgo(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

/**
 * Shares a URL via the native Web Share API when the browser supports it (the OS's own share
 * sheet -- user picks Facebook, Messages, WhatsApp, copy link, etc.), falling back to the classic
 * facebook.com/sharer.php popup when it doesn't (most desktop browsers).
 *
 * The popup approach alone doesn't work reliably on mobile: opening a facebook.com URL there gets
 * intercepted by the OS and handed to the Facebook app if it's installed, but sharer.php is a
 * web-only dialog the app has no way to open, so the app just opens to the feed and nothing
 * happens. The Web Share API sidesteps that entirely since it hands off to whatever app the user
 * actually picks, rather than trying to force a specific facebook.com URL open.
 *
 * Returns `true` if a share was actually initiated (native share completed, or the popup was
 * opened), `false` if the user explicitly cancelled the native share sheet -- callers that award
 * points for sharing should skip that on `false` rather than treating a cancel as a share.
 */
export async function shareUrl(url, text = '', title = document.title) {
    if (navigator.share) {
        // Every caller here embeds `url` at the end of `text` already, so when both are given,
        // pass only `text` to the native share sheet -- many share targets (WhatsApp, SMS, etc.)
        // treat a separate `url` field as the sole payload and silently drop `text` alongside it,
        // which left the shared message as just a bare link instead of the full formatted result.
        const payload = text ? { title, text } : { title, url };
        try {
            await navigator.share(payload);
            return true;
        } catch (err) {
            if (err.name === 'AbortError') return false;
            // any other failure (e.g. an unsupported combination of fields) -- fall through to
            // the popup below rather than leaving the user with no way to share at all.
        }
    }
    const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}${text ? `&quote=${encodeURIComponent(text)}` : ''}`;
    window.open(fbUrl, '_blank', 'noopener,noreferrer,width=600,height=500');
    return true;
}
