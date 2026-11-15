import { signInAsGuest } from '../auth/auth.js';
import { createGuestProfile } from '../auth/user-profile.js';
import { browserHasMember } from '../auth/profile-ref.js';
import { trackGuestStarted } from './meta-pixel.js';
import { escapeHtml, showToast } from './helpers.js';

// Per-browser flags (localStorage; every access wrapped, storage can throw in private mode).
// NO_AUTO: a guest logged out on purpose -- don't start a new guest behind their back; they get
// the "Play now" button instead until they start one themselves. NEW_GUEST: a guest was just
// created automatically -- game pages show the "Already have an account? Log in" bar until it's
// dismissed, the guest logs in, or they finish a Daily.
const NO_AUTO_KEY = 'dmc_no_auto_guest';
const NEW_GUEST_KEY = 'dmc_new_auto_guest';

function getFlag(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function setFlag(key, value) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/** Search-engine crawlers and automated browsers: they see the page as it is (the "Play now"
 * gate, still crawlable) and never get an account. */
export function isLikelyBot() {
    if (typeof navigator === 'undefined') return true;
    if (navigator.webdriver) return true;
    return /bot|crawl|spider|slurp|mediapartners|adsbot|google-inspectiontool|lighthouse|headless|preview|facebookexternalhit|embedly|whatsapp|telegram/i.test(navigator.userAgent || '');
}

/** True when a game page may create a guest automatically (2026-11-15): a real browser, never
 * used by a member (they get "Welcome back, Log in" instead), and no guest logged out on purpose. */
export function shouldAutoStartGuest() {
    return !isLikelyBot() && !browserHasMember() && getFlag(NO_AUTO_KEY) !== '1';
}

/** Called when a guest logs out on purpose (app.js), so the next game page doesn't recreate one. */
export function noteGuestLoggedOut() {
    setFlag(NO_AUTO_KEY, '1');
    setFlag(NEW_GUEST_KEY, null);
}

export function isNewAutoGuest() {
    return getFlag(NEW_GUEST_KEY) === '1';
}

export function clearNewAutoGuest() {
    setFlag(NEW_GUEST_KEY, null);
}

/**
 * Starts a guest session -- anonymous login + a guest profile with an automatic unique name -- with
 * no form to fill in. Used automatically by the game pages (`auto: true`, since 2026-11-15) and by
 * the "Play now" / "Play as Guest" buttons. Never on the home page and never for bots, so crawlers
 * and one-glance visitors don't create empty accounts.
 */
export async function startGuestSession({ auto = false } = {}) {
    const user = await signInAsGuest();
    await createGuestProfile(user.uid);
    trackGuestStarted();
    setFlag(NO_AUTO_KEY, null);
    setFlag(NEW_GUEST_KEY, auto ? '1' : null);
    return user;
}

/** The slim bar above a game for a guest created automatically: "You're playing as Clever Fox 482.
 * Already have an account? Log in". Catches members on a new device before they play. */
export function renderAutoGuestBar(mount, displayName) {
    if (!mount || document.getElementById('auto-guest-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'auto-guest-bar';
    bar.className = 'auto-guest-bar';
    bar.innerHTML = `
        <span>You're playing as <strong>${escapeHtml(displayName)}</strong>. Already have an account? <a href="/?login=1&redirect=${encodeURIComponent(window.location.pathname + window.location.search)}">Log in</a></span>
        <button type="button" class="auto-guest-bar-close" aria-label="Dismiss">&times;</button>
    `;
    bar.querySelector('.auto-guest-bar-close').addEventListener('click', () => {
        clearNewAutoGuest();
        bar.remove();
    });
    bar.querySelector('a').addEventListener('click', clearNewAutoGuest);
    mount.parentElement.insertBefore(bar, mount);
    window.addEventListener('dmc:guest-daily-complete', clearNewAutoGuest, { once: true });
}

/**
 * What a game page shows when there's no session yet (replaces the old "Sign In to Play" prompt).
 * The page stays a real, crawlable page either way. A browser that a member has used before gets
 * "Log in" as the main button instead, so a returning member isn't nudged into a stray guest
 * account; everyone else gets one-tap "Play now". After starting, the page reloads so its normal
 * session flow (trySession) picks the new guest up.
 */
export function renderPlayGate(mount, gameName) {
    const redirectTo = encodeURIComponent(window.location.pathname + window.location.search);
    const loginHref = `/?redirect=${redirectTo}`;
    const name = escapeHtml(gameName);

    mount.innerHTML = browserHasMember()
        ? `
            <div class="play-gate">
                <div class="play-gate-title">Welcome back!</div>
                <div class="play-gate-text">Log in to play today's ${name} and keep your streak and rank.</div>
                <a class="btn primary play-gate-btn" href="${loginHref}">Log In to Play</a>
                <div class="play-gate-alt">Not you? <button type="button" class="play-gate-link" data-play-gate-start>Play as a guest</button></div>
            </div>
        `
        : `
            <div class="play-gate">
                <div class="play-gate-title">Play today's ${name}</div>
                <div class="play-gate-text">No sign-up needed. Tap Play and you're in. You'll earn points, XP, a rank and a streak straight away.</div>
                <button type="button" class="btn primary play-gate-btn" data-play-gate-start>Play now</button>
                <div class="play-gate-alt">Have an account? <a href="${loginHref}">Log in</a></div>
            </div>
        `;

    const startBtn = mount.querySelector('[data-play-gate-start]');
    startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        const label = startBtn.textContent;
        startBtn.textContent = 'Starting…';
        try {
            await startGuestSession();
            window.location.reload();
        } catch {
            startBtn.disabled = false;
            startBtn.textContent = label;
            showToast('Could not start the game. Please check your connection and try again.');
        }
    });
}
