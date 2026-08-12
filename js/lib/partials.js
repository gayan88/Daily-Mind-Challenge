import { getCurrentUser, signOutGuest } from '../firebase/auth.js';
import { ensureUserDoc, subscribeToUserDoc } from './user-profile.js';
import { applyDailyLoginBonus } from './points.js';
import { applyIcons } from './icons.js';
import { showToast } from './utils.js';

async function injectPartial(placeholderId, path) {
    const el = document.getElementById(placeholderId);
    if (!el) return;
    const res = await fetch(path);
    el.innerHTML = await res.text();
}

function wireLogout(uid) {
    const btn = document.getElementById('logout-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const confirmed = window.confirm(
            'Logging out will end this guest session. Without this browser\'s saved login, your points and progress on this guest identity cannot be recovered. Continue?'
        );
        if (!confirmed) return;
        await signOutGuest();
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

function updateUserBadge(profile) {
    const badge = document.getElementById('user-badge');
    if (!badge) return;
    badge.textContent = `${profile.displayName} · ${profile.totalPoints} pts`;
}

/**
 * Loads the shared header/footer into a page's #site-header/#site-footer placeholders,
 * signs the guest in (creating their Firestore profile on first visit), applies the daily
 * +10 login bonus if not already claimed today, and wires common header/footer behavior.
 *
 * Returns { uid, profile, bonusApplied } for page-specific scripts to build on.
 */
export async function initShell() {
    await Promise.all([
        injectPartial('site-header', 'partials/header.html'),
        injectPartial('site-footer', 'partials/footer.html'),
    ]);
    applyIcons(document);
    wireFooterShare();

    const user = await getCurrentUser();
    const uid = user.uid;

    await ensureUserDoc(uid);
    const bonusApplied = await applyDailyLoginBonus(uid);

    wireLogout(uid);

    let profile = await new Promise((resolve) => {
        const unsubscribe = subscribeToUserDoc(uid, (data) => {
            updateUserBadge(data);
            resolve(data);
            unsubscribe();
        });
    });

    subscribeToUserDoc(uid, updateUserBadge);

    if (bonusApplied) {
        showToast('+10 points for visiting today!');
    }

    return { uid, profile, bonusApplied };
}
