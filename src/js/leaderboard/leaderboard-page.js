import { initShell } from '../app.js';
import { getOverallLeaderboard, getGameLeaderboard, findUserInLeaderboard } from './leaderboard-data.js';
import { escapeHtml } from '../utils/helpers.js';
import { icon } from '../utils/icons.js';
import { getConfig } from '../utils/config.js';
import { finalizeRecentPeriodsIfNeeded } from '../progression/championship-service.js';

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
        <div class="hlb-row ${row.uid === uid ? 'hlb-you' : ''}">
            <div class="hlb-rank">${rankMarkerHtml(row.rank)}</div>
            <div class="hlb-divider"></div>
            <div class="hlb-name">${escapeHtml(row.displayName)}</div>
            ${badgeHtml(row, uid)}
            <div class="hlb-score"><span class="hlb-score-num">${row.points}</span><span class="hlb-score-label">pts</span></div>
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
        <span class="lb-your-rank-text">You're ranked <strong>#${userRow.rank}</strong> with <strong>${userRow.points}</strong> pts</span>
    `;
}

async function init() {
    const { uid, profile } = await initShell();

    // Lazy Championship finalization (Phase 6 of docs/progression-gamification-roadmap.md,
    // Section 22 of the progression spec) -- only registered, non-banned visitors can actually
    // finalize a period (firestore.rules), and this is a best-effort background task: it never
    // blocks or affects this page's own rendering, and a failure (e.g. a race with another tab
    // also finalizing the same period) is silently ignored.
    if (profile.kind === 'registered') {
        finalizeRecentPeriodsIfNeeded().catch(() => {});
    }

    const gameTabs = Array.from(document.querySelectorAll('.lb-tab'));
    const periodTabs = Array.from(document.querySelectorAll('.lb-period-tab'));
    const el = document.getElementById('leaderboard-full');

    let currentGame = 'overall';
    let currentPeriod = 'today';
    let allRows = [];
    let visibleCount = 0;
    const { size: pageSize } = await getConfig('leaderboardPageSize');

    function renderVisible() {
        document.getElementById('lb-load-more')?.remove();

        if (allRows.length === 0) {
            el.innerHTML = `<div class="empty-state">${EMPTY_MESSAGES[currentPeriod] || EMPTY_MESSAGES.today}</div>`;
            return;
        }

        el.innerHTML = allRows.slice(0, visibleCount).map((row) => rowHtml(row, uid)).join('');

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
        gameTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.game === currentGame));
        periodTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.period === currentPeriod));
        document.getElementById('lb-load-more')?.remove();
        el.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;

        allRows = currentGame === 'overall'
            ? await getOverallLeaderboard(currentPeriod, FETCH_CAP)
            : await getGameLeaderboard(currentGame, currentPeriod, FETCH_CAP);
        visibleCount = pageSize;
        renderYourRank(findUserInLeaderboard(allRows, uid));
        renderVisible();
    }

    gameTabs.forEach((tab) => tab.addEventListener('click', () => {
        currentGame = tab.dataset.game;
        render();
    }));
    periodTabs.forEach((tab) => tab.addEventListener('click', () => {
        currentPeriod = tab.dataset.period;
        render();
    }));

    render();
}

init();
