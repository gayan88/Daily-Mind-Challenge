import { escapeHtml, getTodayDateString } from './helpers.js';

/**
 * The guest "save your progress" card (2026-11-14). Shown after a guest finishes a Daily Challenge
 * (xp-service.js#awardDailyCompletionXp fires `dmc:guest-daily-complete`), at most once a day per
 * browser, so it reads as a friendly reminder at a good moment rather than a nag. Links to
 * `/?save=1`, which opens the sign-up box in "Save your progress" mode (pages/home.js) -- the guest
 * keeps everything when they sign up. Wired by app.js for guest sessions only.
 */
const SHOWN_KEY = 'dmc_save_nudge_date';
const SHOW_DELAY_MS = 1500;

function shownToday() {
    try { return localStorage.getItem(SHOWN_KEY) === getTodayDateString(); } catch { return false; }
}

function markShown() {
    try { localStorage.setItem(SHOWN_KEY, getTodayDateString()); } catch { /* storage unavailable */ }
}

function showCard(profile) {
    if (document.getElementById('save-progress-nudge')) return;
    const card = document.createElement('div');
    card.id = 'save-progress-nudge';
    card.className = 'save-nudge';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Save your progress');
    card.innerHTML = `
        <button type="button" class="save-nudge-close" aria-label="Close">&times;</button>
        <div class="save-nudge-title">Nice one, ${escapeHtml(profile.displayName)}!</div>
        <div class="save-nudge-text">Your points, rank and streak are saved on this browser only, for 30 days after your last visit. Save them for good. It takes 10 seconds and you keep everything.</div>
        <div class="save-nudge-actions">
            <a class="btn primary save-nudge-btn" href="/?save=1">Save my progress</a>
            <button type="button" class="btn save-nudge-later">Later</button>
        </div>
    `;
    const close = () => card.remove();
    card.querySelector('.save-nudge-close').addEventListener('click', close);
    card.querySelector('.save-nudge-later').addEventListener('click', close);
    document.body.appendChild(card);
    markShown();
}

export function initSaveProgressNudge(profile) {
    window.addEventListener('dmc:guest-daily-complete', () => {
        if (shownToday()) return;
        setTimeout(() => showCard(profile), SHOW_DELAY_MS);
    });
}
