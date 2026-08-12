import { initShell } from '../lib/partials.js';
import { getTodayOverallLeaderboard, getTodayGameLeaderboard } from '../lib/leaderboard.js';
import { escapeHtml, formatLeaderboardName } from '../lib/utils.js';

function renderRows(rows, uid) {
    const el = document.getElementById('leaderboard-full');
    if (rows.length === 0) {
        el.innerHTML = `<div class="empty-state">No scores yet today. Be the first!</div>`;
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
    const tabs = Array.from(document.querySelectorAll('.lb-tab'));
    const el = document.getElementById('leaderboard-full');

    async function showGame(game) {
        tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.game === game));
        el.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
        const rows = game === 'overall'
            ? await getTodayOverallLeaderboard(50)
            : await getTodayGameLeaderboard(game, 50);
        renderRows(rows, uid);
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => showGame(tab.dataset.game)));

    showGame('overall');
}

init();
