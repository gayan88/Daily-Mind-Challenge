import { initShell } from '../lib/partials.js';
import { icon, applyIcons } from '../lib/icons.js';
import { getTodayOverallLeaderboard, findUserInLeaderboard } from '../lib/leaderboard.js';
import { listOpenChallenges } from '../lib/challenges.js';
import { checkPlayedToday } from '../lib/points.js';
import { escapeHtml, formatLeaderboardName } from '../lib/utils.js';

const GAME_LABELS = {
    wordle: 'Wordle',
    sudoku: 'Sudoku',
    wordsearch: 'Word Search',
};

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
                <div class="lb-name">${escapeHtml(formatLeaderboardName(row.displayName, row.isGuest))}</div>
                <div class="lb-score">${row.points} pts</div>
            </div>
        `)
        .join('');
}

async function init() {
    const { uid, profile, bonusApplied } = await initShell();

    const [leaderboardRows, openChallenges, playedWordle, playedSudoku, playedWordsearch] = await Promise.all([
        getTodayOverallLeaderboard(20),
        listOpenChallenges(10),
        checkPlayedToday(uid, 'wordle'),
        checkPlayedToday(uid, 'sudoku'),
        checkPlayedToday(uid, 'wordsearch'),
    ]);

    const userRow = findUserInLeaderboard(leaderboardRows, uid);
    renderStatusCard(profile, userRow?.rank ?? null, userRow?.points ?? 0, bonusApplied);

    markTileCompleted('wordle', !!playedWordle);
    markTileCompleted('sudoku', !!playedSudoku);
    markTileCompleted('wordsearch', !!playedWordsearch);

    renderChallengesPreview(openChallenges, uid);
    renderLeaderboardPreview(leaderboardRows, uid);
}

init();
