import { setUserProperties } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js';
import { analytics } from './api/firebase-init.js';
import { getSessionUser, signOutSession } from './auth/auth.js';
import { loadSessionProfile } from './auth/user-profile.js';
import { applyDailyLoginBonus } from './utils/points.js';
import { applyIcons } from './utils/icons.js';
import { applyAdSlots } from './utils/ads.js';
import { initCookieConsentBanner } from './utils/cookie-consent.js';
import { showToast, getTodayDateString, shareUrl } from './utils/helpers.js';
import { XP_AMOUNTS } from './progression/xp-service.js';
import { initSaveProgressNudge } from './utils/save-progress-nudge.js';
import {
    shouldAutoStartGuest,
    startGuestSession,
    noteGuestLoggedOut,
    isNewAutoGuest,
    renderAutoGuestBar,
} from './utils/guest-start.js';

async function injectPartial(placeholderId, path) {
    const el = document.getElementById(placeholderId);
    if (!el) return;
    const res = await fetch(path);
    el.innerHTML = await res.text();
}

function currentPageWithQuery() {
    return window.location.pathname + window.location.search;
}

function redirectToSignIn() {
    const here = currentPageWithQuery();
    window.location.href = here === '/'
        ? '/'
        : `/?redirect=${encodeURIComponent(here)}`;
}

function wireLogout(profile) {
    const btn = document.getElementById('logout-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const message = profile.kind === 'guest'
            ? 'Logging out ends this guest session, and your guest points, rank, streak and badges cannot be recovered afterwards. To keep them, choose "Save my progress" in this menu first.\n\nLog out anyway?'
            : 'Log out of your account?';
        if (!window.confirm(message)) return;
        // A guest who logs out on purpose isn't silently given a new guest by the next game page.
        if (profile.kind === 'guest') noteGuestLoggedOut();
        await signOutSession();
        window.location.href = '/';
    });
}

/** Highlights whichever header nav link matches the current page -- there's exactly one nav item
 * per clean URL (`/`, `/leaderboard`, `/profile`, `/admin`), so a plain href match is enough. */
function markActiveNavLink() {
    const path = window.location.pathname;
    document.querySelectorAll('.header-nav a').forEach((link) => {
        link.classList.toggle('active', link.getAttribute('href') === path);
    });
}

/** The header's user menu is a click-to-toggle dropdown (trigger button + panel), closed by
 * clicking outside it, pressing Escape, or navigating away (the panel is torn down along with the
 * rest of the page). Wired once per page load, right after the header partial is injected. */
function wireUserDropdown() {
    const trigger = document.getElementById('user-trigger');
    const dropdown = document.getElementById('user-dropdown');
    if (!trigger || !dropdown) return;

    function close() {
        dropdown.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    }

    function open() {
        dropdown.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdown.hidden) open(); else close();
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.hidden && !dropdown.contains(e.target) && !trigger.contains(e.target)) close();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !dropdown.hidden) close();
    });
}

const FOOTER_SHARE_TEXT = '🧠 Daily Mind Challenge\n\nPlay daily Wordle, Sudoku, Word Search, Connections, Quilt, and Pounce puzzles, earn points, and climb the leaderboard!\n\nJoin me:\nhttps://dailymindchallenge.com';

function wireFooterShare() {
    const link = document.getElementById('footer-share-fb');
    if (!link) return;
    link.addEventListener('click', (e) => {
        e.preventDefault();
        // Always the home page, not window.location.href -- this is a site-wide "come join us"
        // invite, not a per-page share, so a friend clicking it should never land on e.g. the
        // sharer's own /settings or /profile page.
        shareUrl(`${window.location.origin}/`, FOOTER_SHARE_TEXT);
    });
}

function updateHeader(profile) {
    // .user-name-text/.user-guest-badge each appear twice -- once in the compact trigger button,
    // once in the dropdown's header -- so both stay in sync from a single call here.
    document.querySelectorAll('.user-name-text').forEach((el) => {
        el.textContent = profile.displayName;
    });
    document.querySelectorAll('.user-guest-badge').forEach((el) => {
        el.hidden = profile.kind !== 'guest';
    });
    // Guests: "Save my progress" (sign up keeping everything) instead of Settings (which only has
    // member things -- password, email).
    const isGuest = profile.kind === 'guest';
    document.getElementById('save-progress-link')?.toggleAttribute('hidden', !isGuest);
    document.getElementById('guest-login-link')?.toggleAttribute('hidden', !isGuest);
    document.getElementById('settings-menu-link')?.toggleAttribute('hidden', isGuest);
    const adminLink = document.getElementById('admin-nav-link');
    if (adminLink) {
        adminLink.hidden = !profile.isAdmin;
    }
    document.getElementById('user-menu-loggedin')?.removeAttribute('hidden');
    document.getElementById('user-menu-loggedout')?.setAttribute('hidden', '');
}

/**
 * For pages that render for anonymous visitors via `trySession()` but have no sign-in modal of
 * their own (the three game pages -- only `index.html` has `#auth-modal` in its markup): shows
 * the header's logged-out state (both menu variants are `hidden` by default in header.html, and
 * nothing un-hides either one unless a session resolves via `updateHeader()` above or the home
 * page's own `setLoggedOutHeaderState()`, which is what left the header with neither menu visible
 * at all -- no Login button -- on these pages before this existed). The Login button navigates to
 * `/?redirect=<current page>` instead of opening a modal in place, since there's no modal here to
 * open -- same `?redirect=` mechanism `initShell()`'s old redirect used, and the home page already
 * opens its modal automatically when that param is present.
 */
export function showLoggedOutHeader() {
    document.getElementById('user-menu-loggedout')?.removeAttribute('hidden');
    document.getElementById('user-menu-loggedin')?.setAttribute('hidden', '');
    document.getElementById('header-login-btn')?.addEventListener('click', () => {
        window.location.href = `/?redirect=${encodeURIComponent(currentPageWithQuery())}`;
    });
}

/** Injects the shared header/footer partials, applies admin-configured ad slot settings, and
 * shows the cookie consent banner if it's due (see utils/cookie-consent.js -- not awaited, since
 * it doesn't block anything else here). Safe to call whether or not a session exists yet. */
export async function loadHeaderFooter() {
    await Promise.all([
        injectPartial('site-header', '/partials/header.html'),
        injectPartial('site-footer', '/partials/footer.html'),
        applyAdSlots(document),
    ]);
    applyIcons(document);
    markActiveNavLink();
    wireUserDropdown();
    wireFooterShare();
    initCookieConsentBanner();
}

/** loadSessionProfile(), retried twice when Firestore reports it can't reach the server yet
 * ("client is offline" / `unavailable` -- a slow or briefly dropped phone connection on the first
 * read of a page load). Without this, one slow read bounced a signed-in player to the home page as if
 * logged out. Banned / missing-profile errors are not retried. */
async function loadProfileWithRetry(user) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await loadSessionProfile(user);
        } catch (err) {
            const transient = err?.code === 'unavailable' || /offline/i.test(err?.message || '');
            if (!transient || attempt >= 2) throw err;
            await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        }
    }
}

/** Resolves an existing session (loads its profile, applies the daily bonus, wires the header)
 * without redirecting. Returns null if there's no session, or if it's banned/broken (in which
 * case the caller has already been signed out by loadSessionProfile). */
async function resolveSession(user) {
    let profile;
    try {
        profile = await loadProfileWithRetry(user);
    } catch (err) {
        console.warn('Could not load the session profile:', err?.message || err);
        return null;
    }

    // Lets Analytics reports be segmented by guest vs. registered (e.g. "Active Users" filtered by
    // accountType) -- GA4 has no way to know this app's own guest/registered distinction on its
    // own, so it has to be told explicitly, once per session, as soon as `profile.kind` is known.
    if (analytics) setUserProperties(analytics, { accountType: profile.kind });

    // applyDailyLoginBonus() costs 2 Firestore reads (a config lookup + a transaction re-read of
    // the profile doc we just loaded). Skip it entirely once loadSessionProfile already told us
    // today's bonus was claimed -- that's true for the large majority of page loads in a day.
    let bonusApplied = false;
    if (profile.kind === 'registered' && profile.lastLoginDate !== getTodayDateString()) {
        const bonus = await applyDailyLoginBonus(user.uid);
        bonusApplied = bonus.applied;
        if (bonus.applied) {
            profile.loginPoints += bonus.amount;
            profile.lastLoginDate = getTodayDateString();
            // Keeps the in-memory profile in sync with the XP that write also just awarded
            // (progression/xp-service.js#XP_AMOUNTS.DAILY_LOGIN) -- otherwise a page that renders
            // Overall Level/XP from this same `profile` object (profile.js) would show a stale,
            // pre-bonus value on the exact page load where the bonus was just applied.
            profile.xp = (profile.xp || 0) + XP_AMOUNTS.DAILY_LOGIN;
        }
    }

    updateHeader(profile);
    wireLogout(profile);
    if (profile.kind === 'guest') initSaveProgressNudge(profile);

    if (bonusApplied) {
        showToast('+10 points for visiting today!');
    }

    return { uid: user.uid, profile, bonusApplied };
}

/**
 * For every page EXCEPT the home page (`/`): loads the header/footer, then requires a session --
 * redirects to `/` (which shows the guest/login/sign-up options inline, see js/pages/home.js) if
 * there isn't one. Returns { uid, profile, bonusApplied }.
 */
export async function initShell() {
    await loadHeaderFooter();

    const user = await getSessionUser();
    if (!user) {
        redirectToSignIn();
        return new Promise(() => {}); // never resolves; the redirect is already underway
    }

    const session = await resolveSession(user);
    if (!session) {
        redirectToSignIn();
        return new Promise(() => {});
    }

    return session;
}

/**
 * For the home page (`/`) only: loads the header/footer, then resolves a session WITHOUT
 * redirecting. Returns { uid, profile, bonusApplied }, or null if there's no valid session --
 * the caller is expected to show the guest/login/sign-up UI inline in that case.
 */
export async function trySession() {
    await loadHeaderFooter();
    const user = await getSessionUser();
    if (!user) return null;
    return resolveSession(user);
}

function showAutoGuestBarIfNew(session) {
    if (session?.profile.kind === 'guest' && isNewAutoGuest()) {
        renderAutoGuestBar(document.getElementById('game-mount'), session.profile.displayName);
    }
}

/**
 * For the six game pages (2026-11-15): like trySession(), but a real visitor with no session gets
 * a guest created automatically and the game loads straight away -- no button to press. Returns
 * null (so the page shows its "Play now" / "Welcome back, Log in" gate instead) for crawlers and
 * automated browsers, on a browser a member has used, after a guest logged out on purpose, or if
 * starting the guest fails. A guest made this way sees an "Already have an account? Log in" bar
 * above the game (utils/guest-start.js#renderAutoGuestBar) until they dismiss it or finish a Daily.
 * Never used on the home page: browsing the home page doesn't need an account.
 */
export async function trySessionOrGuest() {
    const session = await trySession();
    if (session) {
        showAutoGuestBarIfNew(session);
        return session;
    }
    if (!shouldAutoStartGuest()) return null;
    try {
        await startGuestSession({ auto: true });
    } catch {
        return null;
    }
    const user = await getSessionUser();
    if (!user) return null;
    const created = await resolveSession(user);
    showAutoGuestBarIfNew(created);
    return created;
}
