import { initShell } from '../lib/partials.js';
import { icon, applyIcons } from '../lib/icons.js';
import { getTodayLeaderboard, findUserInLeaderboard } from '../lib/leaderboard.js';
import { listOpenChallenges } from '../lib/challenges.js';
import { hasPlayedToday } from '../lib/points.js';
import { escapeHtml } from '../lib/utils.js';

const GAME_LABELS = {
    wordle: 'Wordle',
    sudoku: 'Sudoku',
    wordsearch: 'Word Search',
};

function renderStatusCard(profile, todayRank) {
    const card = document.getElementById('status-card');
    const rankRow = todayRank
        ? `<div class="status-row"><span class="status-icon" data-icon="TROPHY"></span>You are <strong>#${todayRank}</strong> on today's leaderboard</div>`
        : `<div class="status-row"><span class="status-icon" data-icon="STAR"></span>Play a game today to join the leaderboard!</div>`;

    card.innerHTML = `
        <div class="status-welcome">Welcome back, ${escapeHtml(profile.displayName)}!</div>
        <div class="status-row"><span class="status-icon" data-icon="CHECK"></span>You visited today! <strong>+10 login points</strong></div>
        ${rankRow}
        <div class="points-display">
            Your total points: <span class="points-number">${profile.totalPoints}</span>
        </div>
    `;
    applyIcons(card);
}

function markTileCompleted(game, played) {
    const tile = document.getElementById(`tile-${game}`);
    if (!tile) return;
    if (played) {
        tile.classList.add('completed');
        const status = tile.querySelector('.game-status');
        status.textContent = `${icon('CHECK')} Completed today`;
        status.classList.add('completed-status');
    }
}

function renderChallengesPreview(challenges, uid) {
    const el = document.getElementById('challenges-preview');
    if (challenges.length === 0) {
        el.innerHTML = `<div class="empty-state">No open challenges yet. Create one to share with friends!</div>`;
        return;
    }

    el.innerHTML = challenges
        .slice(0, 3)
        .map((c) => {
            const isMine = c.creatorUid === uid;
            return `
                <div class="challenge-card">
                    <div class="challenge-info">
                        <div class="challenge-name">${escapeHtml(c.creatorDisplayName)}'s Challenge</div>
                        <div class="challenge-meta">Word: ${'•'.repeat(c.word.length)} | ${GAME_LABELS[c.game] || c.game}</div>
                    </div>
                    <a href="challenges.html?id=${encodeURIComponent(c.id)}" class="challenge-btn">${isMine ? 'View' : 'Solve'}</a>
                </div>
            `;
        })
        .join('');
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
                <div class="lb-name">${escapeHtml(row.displayName)}</div>
                <div class="lb-score">${row.points} pts</div>
            </div>
        `)
        .join('');
}

async function init() {
    const { uid, profile } = await initShell();

    const [leaderboardRows, openChallenges] = await Promise.all([
        getTodayLeaderboard(20),
        listOpenChallenges(10),
    ]);

    const userRow = findUserInLeaderboard(leaderboardRows, uid);
    renderStatusCard(profile, userRow?.rank ?? null);

    markTileCompleted('wordle', hasPlayedToday(profile, 'wordle'));
    markTileCompleted('sudoku', hasPlayedToday(profile, 'sudoku'));
    markTileCompleted('wordsearch', hasPlayedToday(profile, 'wordsearch'));

    renderChallengesPreview(openChallenges, uid);
    renderLeaderboardPreview(leaderboardRows, uid);
}

init();
