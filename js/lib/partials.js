import { getSessionUser, signOutSession } from '../firebase/auth.js';
import { loadSessionProfile, BannedError } from './user-profile.js';
import { applyDailyLoginBonus } from './points.js';
import { applyIcons } from './icons.js';
import { showToast } from './utils.js';

async function injectPartial(placeholderId, path) {
    const el = document.getElementById(placeholderId);
    if (!el) return;
    const res = await fetch(path);
    el.innerHTML = await res.text();
}

function currentPageWithQuery() {
    return window.location.pathname.replace(/^\//, '') + window.location.search;
}

function redirectToLogin() {
    window.location.href = `login.html?redirect=${encodeURIComponent(currentPageWithQuery())}`;
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
        window.location.href = 'login.html';
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
}

/**
 * Loads the shared header/footer, then resolves the current session. If there is no session at
 * all, redirects to login.html (no automatic guest creation). If the session is banned or its
 * profile doc is missing, the user has already been signed out by loadSessionProfile -- redirect
 * to login.html for that too. Otherwise applies the daily login bonus (registered users only)
 * and wires up common header/footer behavior.
 *
 * Returns { uid, profile, bonusApplied }.
 */
export async function initShell() {
    await Promise.all([
        injectPartial('site-header', 'partials/header.html'),
        injectPartial('site-footer', 'partials/footer.html'),
    ]);
    applyIcons(document);
    wireFooterShare();

    const user = await getSessionUser();
    if (!user) {
        redirectToLogin();
        return new Promise(() => {}); // never resolves; the redirect is already underway
    }

    let profile;
    try {
        profile = await loadSessionProfile(user);
    } catch (err) {
        redirectToLogin();
        return new Promise(() => {});
    }

    let bonusApplied = false;
    if (profile.kind === 'registered') {
        const bonus = await applyDailyLoginBonus(user.uid);
        bonusApplied = bonus.applied;
        if (bonus.applied) {
            profile.loginPoints += bonus.amount;
        }
    }

    updateHeader(profile);
    wireLogout(profile);

    if (bonusApplied) {
        showToast('+10 points for visiting today!');
    }

    return { uid: user.uid, profile, bonusApplied };
}
