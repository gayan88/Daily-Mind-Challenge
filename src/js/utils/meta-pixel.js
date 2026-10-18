/**
 * Meta (Facebook) Pixel. Loaded only after the visitor clicks Accept on the cookie banner -- never
 * on page load by default -- because the pixel tracks visitors across sites, which needs the same
 * consent as any other ad/tracking cookie under GDPR/ePrivacy. Called from cookie-consent.js:
 * on Accept, and on any later page load where the stored choice is 'accepted'. Declining (or
 * the banner being disabled entirely in admin) means the pixel never loads for that browser.
 *
 * Deliberately no <noscript> fallback image: that would fire a tracking request even without
 * consent, which is exactly what this gating exists to prevent.
 */
const PIXEL_ID = '1883519629480679';

let loaded = false;

export function loadMetaPixel() {
    if (loaded) return;
    loaded = true;

    // Standard Meta Pixel bootstrap, inlined as a function so it can run on demand instead of as
    // a page-load <script>. Mirrors Meta's own snippet line-for-line apart from that.
    (function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = true;
        n.version = '2.0';
        n.queue = [];
        t = b.createElement(e);
        t.async = true;
        t.src = v;
        s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
}

/**
 * Standard Meta conversion event -- fired once, right after a new registered account's profile
 * doc is created (src/js/pages/home.js's signup handler). A no-op if the pixel never loaded (the
 * visitor declined cookies, or the banner is admin-disabled) -- `window.fbq` won't exist yet.
 */
export function trackCompleteRegistration() {
    if (!window.fbq) return;
    window.fbq('track', 'CompleteRegistration');
}

/**
 * Custom event (not one of Meta's standard event names, hence `trackCustom` rather than `track`)
 * -- fired after every successful `gameScores` write across all four games' Daily/Classic/
 * Tournament modes, so Meta has an actual engagement signal beyond PageView to optimize ads
 * against. Same no-op-if-not-loaded guard as trackCompleteRegistration().
 */
export function trackGameCompleted(gameType) {
    if (!window.fbq) return;
    window.fbq('trackCustom', 'GameCompleted', { gameType });
}
