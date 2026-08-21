import { loadHeaderFooter, trySession } from '../app.js';
import { applyIcons } from '../utils/icons.js';
import { getOverallLeaderboard, findUserInLeaderboard } from '../leaderboard/leaderboard-data.js';
import { checkPlayedTodayAll } from '../utils/points.js';
import { getConfig } from '../utils/config.js';
import { escapeHtml, formatLeaderboardName, getQueryParam, getTodayDateString } from '../utils/helpers.js';
import {
    signInAsGuest,
    signUpWithUsername,
    loginWithUsername,
    requestPasswordReset,
    friendlyAuthErrorMessage,
} from '../auth/auth.js';
import {
    createGuestProfile,
    createRegisteredProfile,
    isUsernameTaken,
    loadSessionProfile,
    BannedError,
} from '../auth/user-profile.js';
import { containsBlockedWord } from '../utils/profanity.js';

/* ---------- Sign-in modal ---------- */

let pendingRedirect = null;

function openAuthModal(redirectTarget) {
    pendingRedirect = redirectTarget || null;
    document.getElementById('auth-modal').hidden = false;
}

function closeAuthModal() {
    document.getElementById('auth-modal').hidden = true;
}

function setLoggedOutHeaderState() {
    document.getElementById('user-menu-loggedout')?.removeAttribute('hidden');
    document.getElementById('user-menu-loggedin')?.setAttribute('hidden', '');
    document.getElementById('header-login-btn')?.addEventListener('click', () => openAuthModal());
}

function wireModalDismiss() {
    document.getElementById('auth-modal-close').addEventListener('click', closeAuthModal);
    document.getElementById('auth-modal').addEventListener('click', (e) => {
        if (e.target.id === 'auth-modal') closeAuthModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.getElementById('auth-modal').hidden) closeAuthModal();
    });
}

function wireAuthForms() {
    const errorEl = document.getElementById('auth-error');

    function showError(message) {
        errorEl.textContent = message;
        errorEl.classList.add('visible');
    }

    function clearError() {
        errorEl.classList.remove('visible');
    }

    function goToApp() {
        window.location.href = pendingRedirect || getQueryParam('redirect') || '/';
    }

    const tabs = {
        guest: { tab: document.getElementById('tab-guest'), panel: document.getElementById('panel-guest') },
        login: { tab: document.getElementById('tab-login'), panel: document.getElementById('panel-login') },
        signup: { tab: document.getElementById('tab-signup'), panel: document.getElementById('panel-signup') },
    };

    function selectTab(name) {
        clearError();
        Object.entries(tabs).forEach(([key, { tab, panel }]) => {
            tab.classList.toggle('active', key === name);
            panel.classList.toggle('active', key === name);
        });
    }

    Object.entries(tabs).forEach(([key, { tab }]) => tab.addEventListener('click', () => selectTab(key)));

    async function withErrorHandling(fn) {
        clearError();
        try {
            await fn();
        } catch (err) {
            if (err instanceof BannedError) {
                showError(`Your account has been banned. Reason: ${err.message}`);
            } else {
                showError(friendlyAuthErrorMessage(err));
            }
        }
    }

    function onFormSubmit(formId, handler) {
        document.getElementById(formId).addEventListener('submit', (e) => {
            e.preventDefault();
            withErrorHandling(handler);
        });
    }

    onFormSubmit('guest-form', async () => {
        const name = document.getElementById('guest-name').value.trim();
        if (!name) throw new Error('Please enter a display name.');
        if (await containsBlockedWord(name)) throw new Error('That display name isn\'t allowed. Please choose another.');

        const user = await signInAsGuest();
        await createGuestProfile(user.uid, name);
        goToApp();
    });

    onFormSubmit('login-form', async () => {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        if (!username || !password) throw new Error('Please enter your username and password.');

        const user = await loginWithUsername(username, password);
        await loadSessionProfile(user); // throws BannedError and signs out if banned
        goToApp();
    });

    document.getElementById('forgot-password-link').addEventListener('click', (e) => {
        e.preventDefault();
        withErrorHandling(async () => {
            const username = window.prompt('Enter your username to receive a password reset email:');
            if (!username) return;
            await requestPasswordReset(username);
            showError('If that account has a recovery email on file, a reset link has been sent.');
        });
    });

    const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

    onFormSubmit('signup-form', async () => {
        const username = document.getElementById('signup-username').value.trim();
        const displayName = document.getElementById('signup-displayname').value.trim();
        const password = document.getElementById('signup-password').value;
        const email = document.getElementById('signup-email').value.trim();

        if (!username || !displayName || !password) throw new Error('Username, display name, and password are required.');
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw new Error('Username must be 3-24 characters: letters, numbers, underscores.');
        if (!PASSWORD_RULE.test(password)) throw new Error('Password needs at least 8 characters, 1 uppercase letter, and 1 number.');
        if (await containsBlockedWord(displayName)) throw new Error('That display name isn\'t allowed. Please choose another.');

        const usernameLower = username.toLowerCase();
        if (await isUsernameTaken(usernameLower)) throw new Error('That username is already taken.');

        const { user, authEmail } = await signUpWithUsername(username, password, email);
        await createRegisteredProfile(user.uid, { usernameLower, displayName, email: email || null, authEmail });
        goToApp();
    });
}

/** Game tiles link straight to their page for a logged-in user, but open the sign-in modal
 * (instead of navigating away) for a fresh visitor. */
function wireGameTileGate() {
    document.querySelectorAll('.game-tile').forEach((tile) => {
        tile.addEventListener('click', (e) => {
            e.preventDefault();
            openAuthModal(tile.getAttribute('href'));
        });
    });
}

/* ---------- Dashboard (rendered for every visitor, logged in or not) ---------- */

function renderStatusCardLoggedOut() {
    const card = document.getElementById('status-card');
    card.innerHTML = `
        <div class="status-welcome">Welcome to Daily Mind Challenge!</div>
        <div class="status-row"><span class="status-icon" data-icon="STAR"></span>Log in or continue as a guest to play and start earning points.</div>
    `;
    applyIcons(card);
}

function renderStatusCard(profile, todayRank, todayPoints, bonusApplied) {
    const card = document.getElementById('status-card');
    const rankRow = todayRank
        ? `<div class="status-row"><span class="status-icon" data-icon="TROPHY"></span>You are <strong>#${todayRank}</strong> on today's leaderboard</div>`
        : `<div class="status-row"><span class="status-icon" data-icon="STAR"></span>Play a game today to join the leaderboard!</div>`;

    const bonusRow = bonusApplied
        ? `<div class="status-row"><span class="status-icon" data-icon="CHECK"></span>You visited today! <strong>+login points</strong></div>`
        : profile.kind === 'guest'
            ? `<div class="status-row"><span class="status-icon" data-icon="CHECK"></span>Welcome, guest! Sign up to earn daily login points.</div>`
            : '';

    card.innerHTML = `
        <div class="status-welcome">Welcome back, ${escapeHtml(profile.displayName)}!</div>
        ${bonusRow}
        ${rankRow}
        <div class="points-display">
            Today's points: <span class="points-number">${todayPoints}</span>
        </div>
    `;
    applyIcons(card);
}

function markTileCompleted(game, played) {
    const tile = document.getElementById(`tile-${game}`);
    if (!tile || !played) return;
    tile.classList.add('completed');
    tile.title = 'Completed today';
}

function renderLeaderboardPreview(rows, uid) {
    const el = document.getElementById('leaderboard-preview');
    if (rows.length === 0) {
        el.innerHTML = `<div class="empty-state">No scores yet today. Be the first!</div>`;
        return;
    }

    el.innerHTML = rows
        .slice(0, 5)
        .map((row) => `
            <div class="lb-row ${row.uid === uid ? 'lb-you' : ''}">
                <div class="lb-rank">${row.rank}</div>
                <div class="lb-name">${escapeHtml(formatLeaderboardName(row.displayName, row.isGuest))}</div>
                <div class="lb-score">${row.points} pts</div>
            </div>
        `)
        .join('');
}

async function renderLoggedOutDashboard() {
    renderStatusCardLoggedOut();

    const leaderboardRows = await getOverallLeaderboard('today', 20);
    renderLeaderboardPreview(leaderboardRows, null);
}

async function renderLoggedInDashboard(uid, profile, bonusApplied) {
    // The daily login bonus is intentionally excluded from the competitive gameScores-based
    // leaderboard (games-only ranking, per the schema doc), but it should still count toward the
    // player's own "today's points" -- otherwise the login toast promises points that never show up.
    const needsBonusConfig = profile.kind === 'registered' && profile.lastLoginDate === getTodayDateString();

    const [leaderboardRows, playedToday, dailyRewardConfig] = await Promise.all([
        getOverallLeaderboard('today', 20),
        checkPlayedTodayAll(uid),
        needsBonusConfig ? getConfig('dailyLoginReward') : Promise.resolve(null),
    ]);

    const userRow = findUserInLeaderboard(leaderboardRows, uid);
    const todayPoints = (userRow?.points ?? 0) + (needsBonusConfig ? dailyRewardConfig.points : 0);

    renderStatusCard(profile, userRow?.rank ?? null, todayPoints, bonusApplied);

    markTileCompleted('wordle', !!playedToday.wordle);
    markTileCompleted('sudoku', !!playedToday.sudoku);
    markTileCompleted('wordsearch', !!playedToday.wordsearch);

    renderLeaderboardPreview(leaderboardRows, uid);
}

/* ---------- Entry point ---------- */

async function init() {
    await loadHeaderFooter();
    wireModalDismiss();
    wireAuthForms();

    const session = await trySession();

    if (!session) {
        setLoggedOutHeaderState();
        wireGameTileGate();
        await renderLoggedOutDashboard();

        // Another page redirected here because it needs a session -- open the modal right away.
        if (getQueryParam('redirect')) openAuthModal();
        return;
    }

    const { uid, profile, bonusApplied } = session;
    await renderLoggedInDashboard(uid, profile, bonusApplied);
}

init();
