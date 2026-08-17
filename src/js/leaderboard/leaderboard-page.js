import { initShell } from '../app.js';
import { getOverallLeaderboard, getGameLeaderboard } from './leaderboard-data.js';
import { escapeHtml, formatLeaderboardName } from '../utils/helpers.js';

const EMPTY_MESSAGES = {
    today: 'No scores yet today. Be the first!',
    week: 'No scores yet this week. Be the first!',
    month: 'No scores yet this month. Be the first!',
    year: 'No scores yet this year. Be the first!',
    all: 'No scores yet. Be the first!',
};

function renderRows(rows, uid, period) {
    const el = document.getElementById('leaderboard-full');
    if (rows.length === 0) {
        el.innerHTML = `<div class="empty-state">${EMPTY_MESSAGES[period] || EMPTY_MESSAGES.today}</div>`;
        return;
    }
    el.innerHTML = rows
        .map((row) => `
            <div class="lb-row ${row.uid === uid ? 'lb-you' : ''}">
                <div class="lb-rank">${row.rank}</div>
                <div class="lb-name">${escapeHtml(formatLeaderboardName(row.displayName, row.isGuest))}</div>
                <div class="lb-score">${row.points} pts</div>
            </div>
        `)
        .join('');
}

async function init() {
    const { uid } = await initShell();
    const gameTabs = Array.from(document.querySelectorAll('.lb-tab'));
    const periodTabs = Array.from(document.querySelectorAll('.lb-period-tab'));
    const el = document.getElementById('leaderboard-full');

    let currentGame = 'overall';
    let currentPeriod = 'today';

    async function render() {
        gameTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.game === currentGame));
        periodTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.period === currentPeriod));
        el.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
        const rows = currentGame === 'overall'
            ? await getOverallLeaderboard(currentPeriod, 50)
            : await getGameLeaderboard(currentGame, currentPeriod, 50);
        renderRows(rows, uid, currentPeriod);
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
