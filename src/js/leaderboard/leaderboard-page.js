import { initShell } from '../app.js';
import { getOverallLeaderboard, getGameLeaderboard } from './leaderboard-data.js';
import { escapeHtml, formatLeaderboardName } from '../utils/helpers.js';
import { getConfig } from '../utils/config.js';

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

function rowHtml(row, uid) {
    return `
        <div class="lb-row ${row.uid === uid ? 'lb-you' : ''}">
            <div class="lb-rank">${row.rank}</div>
            <div class="lb-name">${escapeHtml(formatLeaderboardName(row.displayName, row.isGuest))}</div>
            <div class="lb-score">${row.points} pts</div>
        </div>
    `;
}

async function init() {
    const { uid } = await initShell();
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
