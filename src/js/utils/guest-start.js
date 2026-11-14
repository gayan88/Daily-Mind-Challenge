import { signInAsGuest } from '../auth/auth.js';
import { createGuestProfile } from '../auth/user-profile.js';
import { browserHasMember } from '../auth/profile-ref.js';
import { trackGuestStarted } from './meta-pixel.js';
import { escapeHtml, showToast } from './helpers.js';

/**
 * Instant play (2026-11-14): starts a guest session -- anonymous login + a guest profile with an
 * automatic unique name -- with no form to fill in. Used by every game page's "Play now" button and
 * the sign-in box's "Play as Guest" tab. The account is only created on that tap, never on page
 * load, so crawlers and one-glance visitors don't create empty accounts.
 */
export async function startGuestSession() {
    const user = await signInAsGuest();
    await createGuestProfile(user.uid);
    trackGuestStarted();
    return user;
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
