import { loadHeaderFooter, trySession } from '../app.js';
import { applyIcons, icon } from '../utils/icons.js';
import { getOverallLeaderboard, findUserInLeaderboard, getXpForUids } from '../leaderboard/leaderboard-data.js';
import { checkPlayedTodayAll, getUserLifetimeStats } from '../utils/points.js';
import { getConfig } from '../utils/config.js';
import { escapeHtml, getQueryParam, getTodayDateString } from '../utils/helpers.js';
import { calculateOverallProgress, XP_PER_LEVEL } from '../progression/xp-service.js';
import { calculateRankProgress, GUEST_RANK_IMAGE } from '../progression/rank-service.js';
import { showPlayerProfileModal } from '../leaderboard/player-profile-modal.js';
import { syncDailyMissions, DAILY_MISSIONS } from '../progression/mission-service.js';
import { getPlayerAchievements } from '../progression/achievement-engine.js';
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

/* ---------- Dashboard (rendered for every visitor, logged in or not) ---------- */

// Outlined line icons (not this app's usual emoji set, see icons.js) -- used only on the status
// card's stat tiles, matching a monochrome-purple mockup emoji can't reproduce.
const ICON_STAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const ICON_TROPHY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 4h3a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4"/><path d="M7 4H4a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4"/></svg>`;
const ICON_CHART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="14" width="4" height="6" rx="1"/><rect x="10" y="9" width="4" height="11" rx="1"/><rect x="16" y="4" width="4" height="16" rx="1"/></svg>`;
const ICON_MEDAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>`;

function statTile(iconSvg, label, value, valueId) {
    return `
        <div class="status-stat-card">
            <div class="status-stat-icon-wrap">${iconSvg}</div>
            <div class="status-stat-label">${label}</div>
            <div class="status-stat-value"${valueId ? ` id="${valueId}"` : ''}>${value}</div>
        </div>
    `;
}

/** The highlighted callout at the bottom of the status card -- generalizes the old plain-text
 * rank row into three states: leading today, ranked but not leading, and not played yet. */
function highlightForTodayRank(todayRank) {
    if (todayRank === 1) {
        return { title: "You're leading today's leaderboard", desc: 'Keep it up! Play more puzzles to stay on top.' };
    }
    if (todayRank) {
        return { title: `You're #${todayRank} on today's leaderboard`, desc: 'Play more puzzles to climb higher.' };
    }
    return { title: "You haven't played today yet", desc: 'Play a game today to join the leaderboard!' };
}

function renderStatusCardLoggedOut() {
    const card = document.getElementById('status-card');
    card.innerHTML = `
        <div class="status-welcome">Welcome to Daily Mind Challenge!</div>
        <div class="status-row"><span class="status-icon" data-icon="STAR"></span>Log in or continue as a guest to play and start earning points.</div>
    `;
    applyIcons(card);
}

function renderStatusCard(profile, todayRank, todayPoints, bonusApplied, totalPoints) {
    const card = document.getElementById('status-card');

    const bonusRow = bonusApplied
        ? `<div class="status-row"><span class="status-icon" data-icon="CHECK"></span>You visited today! <strong>+login points</strong></div>`
        : profile.kind === 'guest'
            ? `<div class="status-row"><span class="status-icon" data-icon="CHECK"></span>Welcome, guest! Sign up to earn daily login points.</div>`
            : '';

    const highlight = highlightForTodayRank(todayRank);

    // Same avatar/rank-label treatment as the leaderboard row/player-profile popup -- sub-rank
    // badge + "{Rank} {Numeral}" for a registered player, the fixed Guest badge otherwise (guests
    // don't earn XP/Rank, Section 4 of the progression spec).
    const rankInfo = profile.kind === 'registered'
        ? calculateRankProgress(profile.xp || 0)
        : null;
    const avatarImage = rankInfo ? rankInfo.subRankImage : GUEST_RANK_IMAGE;
    const rankLabel = rankInfo ? rankInfo.label : 'Guest';

    // Same Level/XP card as the player-profile popup (leaderboard/player-profile-modal.js) --
    // guests don't earn XP/Level either, so this is omitted entirely for them rather than showing
    // a meaningless "Level 1 (0 XP)". +1 display shift, same convention as Game Level's own cards
    // -- see xp-service.js's own doc comment on calculateOverallLevel().
    const levelProgress = profile.kind === 'registered' ? calculateOverallProgress(profile.xp || 0) : null;

    // Streak + Total XP, right under the rank label -- registered players only (Section 4). Total
    // XP (not the full Level breakdown -- that's already shown in the card beside the header) so
    // the compact identity block still surfaces the one number that's a running lifetime total.
    const streakLabel = profile.kind === 'registered'
        ? `
            <div class="status-streak-label">
                <span>${icon('FLAME')} ${profile.raw.currentStreak || 0} day streak</span>
                <span>${icon('STAR')} ${levelProgress.xp.toLocaleString()} Total XP</span>
            </div>
        `
        : '';

    const levelCard = levelProgress ? `
        <div class="status-level-card">
            <div class="status-level-row">
                <span class="status-level-title">Level ${levelProgress.level + 1}</span>
                <span class="status-level-xp">${levelProgress.xpIntoLevel.toLocaleString()} / ${XP_PER_LEVEL.toLocaleString()} XP</span>
            </div>
            <div class="status-level-bar"><div class="status-level-fill" style="width:${levelProgress.progressPercent}%"></div></div>
            <div class="status-level-caption">${levelProgress.xpToNextLevel.toLocaleString()} XP to reach Level ${levelProgress.nextLevel + 1}</div>
        </div>
    ` : '';

    card.innerHTML = `
        <div class="status-top-row">
            <div class="status-header">
                <img class="status-avatar" src="${avatarImage}" alt="">
                <div class="status-header-text">
                    <div class="status-welcome">Welcome back, ${escapeHtml(profile.displayName)}!</div>
                    <div class="status-rank-label">${rankLabel}</div>
                    ${streakLabel}
                </div>
            </div>
            ${levelCard}
        </div>
        ${bonusRow}
        <div class="status-stats-grid">
            ${statTile(ICON_STAR, "Today's Points", todayPoints.toLocaleString())}
            ${statTile(ICON_TROPHY, "Today's Rank", todayRank ? `#${todayRank}` : '&mdash;')}
            ${statTile(ICON_CHART, 'Total Points', totalPoints.toLocaleString())}
            ${statTile(ICON_MEDAL, 'Overall Rank', '&hellip;', 'status-overall-rank')}
        </div>
        <div class="status-divider"></div>
        <div class="status-highlight">
            <div class="status-highlight-icon-wrap">${ICON_TROPHY}</div>
            <div>
                <div class="status-highlight-title">${highlight.title}</div>
                <div class="status-highlight-desc">${highlight.desc}</div>
            </div>
        </div>
    `;
    applyIcons(card);
}

/** Compact "Daily Missions" / "Achievements" summary (Phase 8's "compact summary" scope decision
 * -- full detail stays on /profile, this is just a teaser). Registered players only; the whole
 * section stays hidden for guests. `missionResult` is whatever `syncDailyMissions()` returned in
 * renderLoggedInDashboard() below -- this function does no evaluation/awarding of its own, purely
 * display. `achievementsCount` is a plain count read (achievement-engine.js#getPlayerAchievements),
 * not a re-evaluation -- keeps this page's Firestore work light, per the same scope decision. */
function renderWorkoutExtras(profile, missionResult, achievementsCount) {
    const section = document.getElementById('workout-extras-section');
    if (profile.kind !== 'registered') {
        section.hidden = true;
        return;
    }
    section.hidden = false;

    const doneCount = DAILY_MISSIONS.filter((m) => missionResult.completedMissionIds.has(m.id)).length;
    const missionsPercent = Math.round((doneCount / DAILY_MISSIONS.length) * 100);

    document.getElementById('workout-missions').innerHTML = `
        <div class="workout-extras-icon-wrap"><span class="workout-extras-icon" data-icon="TARGET"></span></div>
        <div class="workout-extras-body">
            <div class="workout-extras-title">Daily Missions</div>
            <div class="workout-extras-subtitle">Complete your daily missions</div>
            <div class="workout-extras-stat"><strong>${doneCount}/${DAILY_MISSIONS.length}</strong> completed</div>
            <div class="workout-extras-progress"><div class="workout-extras-progress-fill" style="width:${missionsPercent}%"></div></div>
        </div>
        <a href="/profile" class="workout-extras-link">View <span data-icon="ARROW_RIGHT"></span></a>
    `;
    document.getElementById('workout-achievements').innerHTML = `
        <div class="workout-extras-icon-wrap"><span class="workout-extras-icon" data-icon="GOLD_MEDAL"></span></div>
        <div class="workout-extras-body">
            <div class="workout-extras-title">Achievements</div>
            <div class="workout-extras-subtitle">Badges you've earned</div>
            <div class="workout-extras-stat"><strong>${achievementsCount}</strong> badge${achievementsCount === 1 ? '' : 's'} earned</div>
        </div>
        <a href="/profile" class="workout-extras-link">View <span data-icon="ARROW_RIGHT"></span></a>
    `;
    applyIcons(section);
}

function markTileCompleted(game, played) {
    const tile = document.getElementById(`tile-${game}`);
    if (!tile || !played) return;
    tile.classList.add('completed');
    tile.title = 'Completed today';
}

/** Gold/silver/bronze medal emoji for the top 3, a plain rank number below that. */
function rankMarkerHtml(rank) {
    if (rank === 1) return `<span class="hlb-medal">${icon('GOLD_MEDAL')}</span>`;
    if (rank === 2) return `<span class="hlb-medal">${icon('SILVER_MEDAL')}</span>`;
    if (rank === 3) return `<span class="hlb-medal">${icon('BRONZE_MEDAL')}</span>`;
    return `<span class="hlb-rank-number">${rank}</span>`;
}

/** "You" only ever applies to a row that's already within the displayed top 5 -- this preview
 * never inserts an extra row to surface the current player if they're ranked lower than that. */
function badgeHtml(row, uid) {
    if (row.uid === uid) return '<span class="hlb-badge hlb-badge-you">You</span>';
    if (row.isGuest) return '<span class="hlb-badge hlb-badge-guest">Guest</span>';
    return '';
}

/** Sub-rank avatars for just these 5 rows -- see leaderboard-data.js#getXpForUids()'s own doc
 * comment for why this stays scoped to what's actually rendered rather than every leaderboard row. */
async function avatarsForRows(rows) {
    const uids = [...new Set(rows.filter((r) => !r.isGuest).map((r) => r.uid))];
    const xpByUid = uids.length > 0 ? await getXpForUids(uids) : new Map();
    return new Map(rows.map((r) => [
        r.uid,
        r.isGuest ? GUEST_RANK_IMAGE : calculateRankProgress(xpByUid.get(r.uid) || 0).subRankImage,
    ]));
}

// Current top-5 preview rows, keyed by uid -- updated on every renderLeaderboardPreview() call so
// the single delegated click listener below (wired once) always resolves against whatever's
// actually on screen, not a stale snapshot from the first render.
let previewRowsByUid = new Map();

async function renderLeaderboardPreview(rows, uid) {
    const el = document.getElementById('leaderboard-preview');
    if (rows.length === 0) {
        el.innerHTML = `<div class="empty-state">No scores yet today. Be the first!</div>`;
        return;
    }

    const topRows = rows.slice(0, 5);
    const avatarByUid = await avatarsForRows(topRows);
    previewRowsByUid = new Map(topRows.map((row) => [row.uid, row]));

    el.innerHTML = topRows
        .map((row) => `
            <div class="hlb-row hlb-row-clickable ${row.uid === uid ? 'hlb-you' : ''}" data-uid="${row.uid}" tabindex="0">
                <div class="hlb-rank">${rankMarkerHtml(row.rank)}</div>
                <div class="hlb-divider"></div>
                <img class="hlb-avatar" src="${avatarByUid.get(row.uid)}" alt="" />
                <div class="hlb-name">${escapeHtml(row.displayName)}</div>
                ${badgeHtml(row, uid)}
                <div class="hlb-score"><span class="hlb-score-num">${row.points.toLocaleString()}</span><span class="hlb-score-label">pts</span></div>
            </div>
        `)
        .join('');

    if (!el.dataset.clickWired) {
        el.dataset.clickWired = '1';
        el.addEventListener('click', (e) => {
            const rowEl = e.target.closest('.hlb-row');
            if (!rowEl) return;
            const row = previewRowsByUid.get(rowEl.dataset.uid);
            if (row) showPlayerProfileModal(row);
        });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const rowEl = e.target.closest('.hlb-row');
            if (!rowEl) return;
            e.preventDefault();
            const row = previewRowsByUid.get(rowEl.dataset.uid);
            if (row) showPlayerProfileModal(row);
        });
    }
}

async function renderLoggedOutDashboard() {
    renderStatusCardLoggedOut();

    const leaderboardRows = await getOverallLeaderboard('today', 20);
    await renderLeaderboardPreview(leaderboardRows, null);
}

async function renderLoggedInDashboard(uid, profile, bonusApplied) {
    // The daily login bonus is intentionally excluded from the competitive gameScores-based
    // leaderboard (games-only ranking, per the schema doc), but it should still count toward the
    // player's own "today's points" -- otherwise the login toast promises points that never show up.
    const needsBonusConfig = profile.kind === 'registered' && profile.lastLoginDate === getTodayDateString();

    const isRegistered = profile.kind === 'registered';

    const [leaderboardRows, playedToday, dailyRewardConfig, lifetimeStats, missionResult, achievements] = await Promise.all([
        getOverallLeaderboard('today', 20),
        checkPlayedTodayAll(uid),
        needsBonusConfig ? getConfig('dailyLoginReward') : Promise.resolve(null),
        getUserLifetimeStats(uid),
        // Missions (Phase 7) evaluated + awarded right here, not only on /profile -- the home
        // page is the actual "daily habit" destination (Section 24 of the progression spec), so
        // this is the more natural place for "did I finish today's workout" to actually resolve.
        // Safe to also run again on a later /profile visit -- syncDailyMissions() is idempotent.
        isRegistered ? syncDailyMissions(uid) : Promise.resolve(null),
        // Achievements are only *read* here (a plain count), not re-evaluated -- that heavier
        // context-assembly stays exclusive to profile.js, per Phase 8's "compact summary" scope
        // decision (keep the home page's Firestore work light).
        isRegistered ? getPlayerAchievements(uid) : Promise.resolve([]),
    ]);

    const userRow = findUserInLeaderboard(leaderboardRows, uid);
    const todayPoints = (userRow?.points ?? 0) + (needsBonusConfig ? dailyRewardConfig.points : 0);
    const totalPoints = isRegistered ? profile.loginPoints + lifetimeStats.totalScore : lifetimeStats.totalScore;

    // Keeps the in-memory profile in sync with any XP a mission reward just awarded -- same
    // reasoning as app.js's login-bonus XP sync and profile.js's own mission-sync call.
    if (missionResult) profile.xp = (profile.xp || 0) + missionResult.xpAwarded;

    renderStatusCard(profile, userRow?.rank ?? null, todayPoints, bonusApplied, totalPoints);

    markTileCompleted('wordle', !!playedToday.wordle);
    markTileCompleted('sudoku', !!playedToday.sudoku);
    markTileCompleted('wordsearch', !!playedToday.wordsearch);

    renderLeaderboardPreview(leaderboardRows, uid);
    renderWorkoutExtras(profile, missionResult, achievements.length);

    // Overall Rank requires aggregating the entire all-time gameScores collection (the same
    // unbounded-read cost leaderboard.html's All-time tab already accepts -- see its CLAUDE.md's
    // "Known limitation") just to find this one user's position. Deliberately not awaited above
    // so it can't slow down the rest of the dashboard; the tile shows "…" until this fills it in.
    loadOverallRank(uid);
}

async function loadOverallRank(uid) {
    let overallRank = null;
    try {
        const allTimeLeaderboardRows = await getOverallLeaderboard('all', 500);
        overallRank = findUserInLeaderboard(allTimeLeaderboardRows, uid)?.rank ?? null;
    } catch {
        // leave overallRank null -- shown as an em dash below, same as "not ranked yet"
    }
    const el = document.getElementById('status-overall-rank');
    if (el) el.textContent = overallRank ? `#${overallRank}` : '—';
}

/* ---------- Entry point ---------- */

async function init() {
    await loadHeaderFooter();
    wireModalDismiss();
    wireAuthForms();

    const session = await trySession();

    if (!session) {
        setLoggedOutHeaderState();
        await renderLoggedOutDashboard();

        // Another page redirected here because it needs a session -- open the modal right away.
        if (getQueryParam('redirect')) openAuthModal();
        return;
    }

    const { uid, profile, bonusApplied } = session;
    await renderLoggedInDashboard(uid, profile, bonusApplied);
}

init();
