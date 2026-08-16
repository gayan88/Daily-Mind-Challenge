import { initShell } from '../app.js';
import { icon } from '../utils/icons.js';
import { updateRegisteredProfile } from '../auth/user-profile.js';
import { containsBlockedWord } from '../utils/profanity.js';
import { getUserLifetimeStats, getUserGameHistory } from '../utils/points.js';
import { showToast } from '../utils/helpers.js';

const GAME_LABELS = { wordle: 'Wordle', sudoku: 'Sudoku', wordsearch: 'Word Search' };

function renderStats(profile, totalScore, gamesPlayedCount) {
    const el = document.getElementById('profile-stats');
    const totalPoints = profile.kind === 'registered' ? profile.loginPoints + totalScore : totalScore;
    const streak = profile.kind === 'registered' ? (profile.raw.currentStreak || 0) : '—';

    el.innerHTML = `
        <div class="stat-tile">
            <div class="stat-value">${totalPoints}</div>
            <div class="stat-label">Total points</div>
        </div>
        <div class="stat-tile">
            <div class="stat-value">${streak}</div>
            <div class="stat-label">Day streak ${icon('FLAME')}</div>
        </div>
        <div class="stat-tile">
            <div class="stat-value">${gamesPlayedCount}</div>
            <div class="stat-label">Games played</div>
        </div>
    `;
}

function renderHistory(history) {
    const el = document.getElementById('profile-history');
    if (history.length === 0) {
        el.innerHTML = `<div class="empty-state">No games played yet — head to the home page to get started!</div>`;
        return;
    }
    el.innerHTML = history
        .map((entry) => `
            <div class="history-row">
                <div class="history-game">${GAME_LABELS[entry.gameType] || entry.gameType}</div>
                <div class="history-detail">${entry.gameDate} — ${entry.score} pts (${entry.timeTaken})</div>
            </div>
        `)
        .join('');
}

async function init() {
    const { uid, profile } = await initShell();

    const nameInput = document.getElementById('display-name-input');
    const saveBtn = document.getElementById('save-name-btn');
    nameInput.value = profile.displayName;

    if (profile.kind === 'guest') {
        nameInput.disabled = true;
        saveBtn.disabled = true;
        saveBtn.title = 'Guests cannot change their display name. Sign up for an account to do that.';
    } else {
        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) {
                showToast('Display name cannot be empty');
                return;
            }
            if (await containsBlockedWord(name)) {
                showToast('That display name isn\'t allowed. Please choose another.');
                return;
            }
            await updateRegisteredProfile(uid, { displayName: name });
            showToast('Display name updated');
        });
    }

    const [{ totalScore, gamesPlayedCount }, history] = await Promise.all([
        getUserLifetimeStats(uid),
        getUserGameHistory(uid, 20),
    ]);

    renderStats(profile, totalScore, gamesPlayedCount);
    renderHistory(history);
}

init();
