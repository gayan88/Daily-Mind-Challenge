import { getSessionUser, signOutSession } from './auth/auth.js';
import { loadSessionProfile } from './auth/user-profile.js';
import { applyDailyLoginBonus } from './utils/points.js';
import { applyIcons } from './utils/icons.js';
import { applyAdSlots } from './utils/ads.js';
import { showToast, getTodayDateString } from './utils/helpers.js';

async function injectPartial(placeholderId, path) {
    const el = document.getElementById(placeholderId);
    if (!el) return;
    const res = await fetch(path);
    el.innerHTML = await res.text();
}

function currentPageWithQuery() {
    return window.location.pathname.replace(/^\//, '') + window.location.search;
}

function redirectToSignIn() {
    const here = currentPageWithQuery();
    window.location.href = here === 'index.html'
        ? 'index.html'
        : `index.html?redirect=${encodeURIComponent(here)}`;
}

function wireLogout(profile) {
    const btn = document.getElementById('logout-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const message = profile.kind === 'guest'
            ? 'Logging out will end this guest session. Without this browser\'s saved login, your points and progress on this guest identity cannot be recovered. Continue?'
            : 'Log out of your account?';
        if (!window.confirm(message)) return;
        await signOutSession();
        window.location.href = 'index.html';
    });
}

function wireFooterShare() {
    const link = document.getElementById('footer-share-fb');
    if (!link) return;
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`;
        window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500');
    });
}

function updateHeader(profile) {
    const badge = document.getElementById('user-badge');
    if (badge) {
        badge.textContent = profile.kind === 'guest' ? `${profile.displayName} [Guest]` : profile.displayName;
    }
    const adminLink = document.getElementById('admin-nav-link');
    if (adminLink) {
        adminLink.hidden = !profile.isAdmin;
    }
    document.getElementById('user-menu-loggedin')?.removeAttribute('hidden');
    document.getElementById('user-menu-loggedout')?.setAttribute('hidden', '');
}

/** Injects the shared header/footer partials and applies admin-configured ad slot settings.
 * Safe to call whether or not a session exists yet. */
export async function loadHeaderFooter() {
    await Promise.all([
        injectPartial('site-header', '../partials/header.html'),
        injectPartial('site-footer', '../partials/footer.html'),
        applyAdSlots(document),
    ]);
    applyIcons(document);
    wireFooterShare();
}

/** Resolves an existing session (loads its profile, applies the daily bonus, wires the header)
 * without redirecting. Returns null if there's no session, or if it's banned/broken (in which
 * case the caller has already been signed out by loadSessionProfile). */
async function resolveSession(user) {
    let profile;
    try {
        profile = await loadSessionProfile(user);
    } catch {
        return null;
    }

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
            profile.raw.currentStreak = bonus.newStreak;
        }
    }

    updateHeader(profile);
    wireLogout(profile);

    if (bonusApplied) {
        showToast('+10 points for visiting today!');
    }

    return { uid: user.uid, profile, bonusApplied };
}

/**
 * For every page EXCEPT index.html: loads the header/footer, then requires a session -- redirects
 * to index.html (which shows the guest/login/sign-up options inline, see js/pages/home.js) if
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
 * For index.html only: loads the header/footer, then resolves a session WITHOUT redirecting.
 * Returns { uid, profile, bonusApplied }, or null if there's no valid session -- the caller is
 * expected to show the guest/login/sign-up UI inline in that case.
 */
export async function trySession() {
    await loadHeaderFooter();
    const user = await getSessionUser();
    if (!user) return null;
    return resolveSession(user);
}
