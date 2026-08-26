import { setConsent } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js';
import { analytics } from '../api/firebase-init.js';
import { getConfig } from './config.js';

const STORAGE_KEY = 'dmc_cookie_consent'; // 'accepted' | 'rejected', per-browser, see below

function getStoredChoice() {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null; // private browsing / storage blocked -- banner just shows again next visit
    }
}

function storeChoice(choice) {
    try {
        localStorage.setItem(STORAGE_KEY, choice);
    } catch {
        // ignore -- same as above, nothing to persist to
    }
}

/**
 * Applies Google Consent Mode via Firebase Analytics' own setConsent() (a thin wrapper around
 * gtag('consent', 'update', ...)) -- this doesn't block the Analytics SDK from loading, it signals
 * Google's own systems to restrict what they do with the data, which is the mechanism Google
 * actually expects apps to use rather than trying to conditionally skip loading the SDK itself.
 * `analytics` is null on unsupported environments (see api/firebase-init.js), in which case there's
 * nothing to signal.
 */
function applyConsent(choice) {
    if (!analytics) return;
    const state = choice === 'accepted' ? 'granted' : 'denied';
    setConsent({
        analytics_storage: state,
        ad_storage: state,
        ad_user_data: state,
        ad_personalization: state,
    });
}

function renderBanner() {
    const el = document.createElement('div');
    el.className = 'cookie-banner';
    el.innerHTML = `
        <p class="cookie-banner-text">We use cookies to run this site and, with your consent, for analytics and ads. See our <a href="/cookie-consent">Cookie Consent Notice</a> for details.</p>
        <div class="cookie-banner-actions">
            <button class="btn" type="button" id="cookie-banner-decline">Decline</button>
            <button class="btn primary" type="button" id="cookie-banner-accept">Accept</button>
        </div>
    `;
    document.body.appendChild(el);

    function choose(choice) {
        storeChoice(choice);
        applyConsent(choice);
        el.remove();
    }
    el.querySelector('#cookie-banner-accept').addEventListener('click', () => choose('accepted'));
    el.querySelector('#cookie-banner-decline').addEventListener('click', () => choose('rejected'));
}

/**
 * Shows the Accept/Decline banner once per browser (not per account -- consent is a per-browser,
 * not per-user, concept, and guests don't have an account to attach it to anyway), gated by
 * `config/cookieConsent.enabled` (admin toggle, Admin > General). If the visitor already chose on
 * a previous visit, re-applies that same choice via applyConsent() instead of showing the banner
 * again -- this has to happen on every page load because each page mounts its own fresh Analytics
 * instance, so a prior page's setConsent() call doesn't carry over on its own.
 */
export async function initCookieConsentBanner() {
    const stored = getStoredChoice();
    if (stored) {
        applyConsent(stored);
        return;
    }

    const { enabled } = await getConfig('cookieConsent');
    if (!enabled) return;

    renderBanner();
}
