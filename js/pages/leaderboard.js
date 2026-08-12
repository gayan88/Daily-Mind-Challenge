import { initShell } from '../lib/partials.js';
import { getTodayLeaderboard, getAllTimeLeaderboard } from '../lib/leaderboard.js';
import { escapeHtml } from '../lib/utils.js';

function renderRows(rows, uid, scoreField) {
    const el = document.getElementById('leaderboard-full');
    if (rows.length === 0) {
        el.innerHTML = `<div class="empty-state">No scores yet. Be the first!</div>`;
        return;
    }
    el.innerHTML = rows
        .map((row) => `
            <div class="lb-row ${row.uid === uid ? 'lb-you' : ''}">
                <div class="lb-rank">${row.rank}</div>
                <div class="lb-name">${escapeHtml(row.displayName)}</div>
                <div class="lb-score">${row[scoreField]} pts</div>
            </div>
        `)
        .join('');
}

async function init() {
    const { uid } = await initShell();
    const todayTab = document.getElementById('tab-today');
    const allTimeTab = document.getElementById('tab-alltime');
    const el = document.getElementById('leaderboard-full');

    async function showToday() {
        todayTab.classList.add('active');
        allTimeTab.classList.remove('active');
        el.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
        renderRows(await getTodayLeaderboard(50), uid, 'points');
    }

    async function showAllTime() {
        allTimeTab.classList.add('active');
        todayTab.classList.remove('active');
        el.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
        renderRows(await getAllTimeLeaderboard(50), uid, 'totalPoints');
    }

    todayTab.addEventListener('click', showToday);
    allTimeTab.addEventListener('click', showAllTime);

    showToday();
}

init();
