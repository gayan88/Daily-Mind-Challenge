import { trySession, showLoggedOutHeader } from '../app.js';
import { getOverallLeaderboard, getGameLeaderboard, findUserInLeaderboard, getXpForUids } from './leaderboard-data.js';
import { escapeHtml } from '../utils/helpers.js';
import { icon } from '../utils/icons.js';
import { getConfig } from '../utils/config.js';
import { calculateRankProgress, GUEST_RANK_IMAGE } from '../progression/rank-service.js';
import { showPlayerProfileModal } from './player-profile-modal.js';
import { GAMES } from '../progression/game-registry.js';

const EMPTY_MESSAGES = {
    today: 'No scores yet today. Be the first!',
    week: 'No scores yet this week. Be the first!',
    month: 'No scores yet this month. Be the first!',
    year: 'No scores yet this year. Be the first!',
    all: 'No scores yet. Be the first!',
};

// Soft ceiling on ranked rows fetched per query -- both leaderboard functions already aggregate
// every matching gameScores doc for the period before ranking (there's no way to correctly rank
// "top N" without seeing every user's total first), so this doesn't change read cost either way.
// Pagination below only controls how many of these already-fetched rows are revealed per page.
const FETCH_CAP = 500;

/** Gold/silver/bronze medal emoji for the top 3, a plain rank number below that -- same treatment
 * as the home page's top-5 preview (src/js/pages/home.js), duplicated here rather than shared
 * since it's two small pure functions, not worth a cross-page module for. */
function rankMarkerHtml(rank) {
    if (rank === 1) return `<span class="hlb-medal">${icon('GOLD_MEDAL')}</span>`;
    if (rank === 2) return `<span class="hlb-medal">${icon('SILVER_MEDAL')}</span>`;
    if (rank === 3) return `<span class="hlb-medal">${icon('BRONZE_MEDAL')}</span>`;
    return `<span class="hlb-rank-number">${rank}</span>`;
}

function badgeHtml(row, uid) {
    if (row.uid === uid) return '<span class="hlb-badge hlb-badge-you">You</span>';
    if (row.isGuest) return '<span class="hlb-badge hlb-badge-guest">Guest</span>';
    return '';
}

function rowHtml(row, uid) {
    return `
        <div class="hlb-row hlb-row-clickable ${row.uid === uid ? 'hlb-you' : ''}" data-uid="${row.uid}" tabindex="0">
            <div class="hlb-rank">${rankMarkerHtml(row.rank)}</div>
            <div class="hlb-divider"></div>
            <img class="hlb-avatar" src="${row.avatarImage}" alt="" />
            <div class="hlb-name">${escapeHtml(row.displayName)}</div>
            ${badgeHtml(row, uid)}
            <div class="hlb-score"><span class="hlb-score-num">${row.points.toLocaleString()}</span><span class="hlb-score-label">pts</span></div>
        </div>
    `;
}

/**
 * Phase 10 leaderboard UX fix: previously the only way to find your own rank was scrolling/"Load
 * More"-ing until your highlighted `.hlb-you` row happened to appear -- for anyone ranked below
 * the first page, that could mean many clicks. This renders a small always-visible summary at the
 * top of the page, independent of how many rows are currently revealed below, using the same
 * `findUserInLeaderboard()` lookup against the already-fetched `allRows` (no extra Firestore
 * read). Shown for guests too, not just registered players -- guests appear on leaderboards
 * (Section 4 of the progression spec), so this isn't a progression-gated feature.
 *
 * Inherits the same `FETCH_CAP` truncation as the rest of this page (both leaderboard functions
 * already rank+slice before returning) -- a player ranked below 500 would show as "haven't scored
 * yet" here too, same pre-existing limitation `.hlb-you` already had.
 */
function renderYourRank(userRow) {
    const el = document.getElementById('lb-your-rank');
    el.hidden = false;

    if (!userRow) {
        el.innerHTML = `<span class="lb-your-rank-text">You haven't scored in this period yet — play a game to join the board!</span>`;
        return;
    }

    el.innerHTML = `
        <div class="lb-your-rank-marker">${rankMarkerHtml(userRow.rank)}</div>
        <span class="lb-your-rank-text">You're ranked <strong>#${userRow.rank}</strong> with <strong>${userRow.points.toLocaleString()}</strong> pts</span>
    `;
}

async function init() {
    // trySession(), not initShell() -- the leaderboard itself is public, non-personal data (same
    // rankings shown to everyone, guests included per Section 4 of the progression spec), so an
    // anonymous visitor (including a crawler) should see the real page instead of being redirected
    // away with nothing rendered. `uid` is null for that visitor; every use of it below already
    // null-safely resolves to "no matching row" (findUserInLeaderboard, the click handlers' `row`
    // lookup), so no extra branching is needed beyond wiring the header correctly.
    const session = await trySession();
    if (!session) showLoggedOutHeader();
    const uid = session?.uid ?? null;

    // The game picker is a <select> filled from the game registry (not a row of tabs), so adding a
    // game to GAMES adds it here with no HTML change and the control doesn't outgrow the screen.
    const gameSelect = document.getElementById('lb-game-select');
    Object.entries(GAMES).forEach(([gameId, game]) => {
        gameSelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(gameId)}">${escapeHtml(game.label)}</option>`);
    });
    const periodSelect = document.getElementById('lb-period-select');
    const el = document.getElementById('leaderboard-full');

    // Delegated on the container (rebuilt wholesale on every render) rather than per-row, so this
    // survives every re-render without re-attaching listeners.
    el.addEventListener('click', (e) => {
        const rowEl = e.target.closest('.hlb-row');
        if (!rowEl) return;
        const row = allRows.find((r) => r.uid === rowEl.dataset.uid);
        if (row) showPlayerProfileModal(row);
    });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const rowEl = e.target.closest('.hlb-row');
        if (!rowEl) return;
        e.preventDefault();
        const row = allRows.find((r) => r.uid === rowEl.dataset.uid);
        if (row) showPlayerProfileModal(row);
    });

    // Optional deep link, e.g. /leaderboard?game=connections -- ignored if it isn't a known game.
    const requestedGame = new URLSearchParams(window.location.search).get('game');
    let currentGame = requestedGame && GAMES[requestedGame] ? requestedGame : 'overall';
    let currentPeriod = 'today';
    let allRows = [];
    let visibleCount = 0;
    const { size: pageSize } = await getConfig('leaderboardPageSize');

    // Sub-rank avatar per uid, resolved lazily and only for rows actually rendered (not every row
    // up to FETCH_CAP) -- see leaderboard-data.js#getXpForUids()'s own doc comment. Kept across
    // tab switches and Load More clicks since a player's XP doesn't change moment-to-moment.
    const avatarCache = new Map();

    async function ensureAvatars(rows) {
        const missingUids = [...new Set(rows.filter((r) => !r.isGuest && !avatarCache.has(r.uid)).map((r) => r.uid))];
        if (missingUids.length > 0) {
            const xpByUid = await getXpForUids(missingUids);
            missingUids.forEach((u) => avatarCache.set(u, calculateRankProgress(xpByUid.get(u) || 0).subRankImage));
        }
        rows.forEach((r) => { r.avatarImage = r.isGuest ? GUEST_RANK_IMAGE : avatarCache.get(r.uid); });
    }

    async function renderVisible() {
        document.getElementById('lb-load-more')?.remove();

        if (allRows.length === 0) {
            el.innerHTML = `<div class="empty-state">${EMPTY_MESSAGES[currentPeriod] || EMPTY_MESSAGES.today}</div>`;
            return;
        }

        const visibleRows = allRows.slice(0, visibleCount);
        await ensureAvatars(visibleRows);
        el.innerHTML = visibleRows.map((row) => rowHtml(row, uid)).join('');

        if (visibleCount < allRows.length) {
            el.insertAdjacentHTML(
                'afterend',
                `<button class="btn lb-load-more" id="lb-load-more" type="button">Load More</button>`
            );
            document.getElementById('lb-load-more').addEventListener('click', () => {
                visibleCount += pageSize;
                renderVisible();
            });
        }
    }

    async function render() {
        gameSelect.value = currentGame;
        periodSelect.value = currentPeriod;
        document.getElementById('lb-load-more')?.remove();
        el.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;

        allRows = currentGame === 'overall'
            ? await getOverallLeaderboard(currentPeriod, FETCH_CAP)
            : await getGameLeaderboard(currentGame, currentPeriod, FETCH_CAP);
        visibleCount = pageSize;
        renderYourRank(findUserInLeaderboard(allRows, uid));
        renderVisible();
    }

    gameSelect.addEventListener('change', () => {
        currentGame = gameSelect.value;
        render();
    });
    periodSelect.addEventListener('change', () => {
        currentPeriod = periodSelect.value;
        render();
    });

    render();
}

init();
