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
const PIXEL_ID = '1627198078795313';

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
