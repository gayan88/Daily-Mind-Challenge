import { initShell } from '../lib/partials.js';
import { icon } from '../lib/icons.js';
import { updateDisplayName } from '../lib/user-profile.js';
import { showToast } from '../lib/utils.js';

const GAME_LABELS = { wordle: 'Wordle', sudoku: 'Sudoku', wordsearch: 'Word Search' };

function renderStats(profile) {
    const el = document.getElementById('profile-stats');
    el.innerHTML = `
        <div class="stat-tile">
            <div class="stat-value">${profile.totalPoints}</div>
            <div class="stat-label">Total points</div>
        </div>
        <div class="stat-tile">
            <div class="stat-value">${profile.currentStreak || 0}</div>
            <div class="stat-label">Day streak ${icon('FLAME')}</div>
        </div>
        <div class="stat-tile">
            <div class="stat-value">${Object.keys(profile.gamesCompleted || {}).length}</div>
            <div class="stat-label">Games played</div>
        </div>
    `;
}

function renderHistory(profile) {
    const el = document.getElementById('profile-history');
    const entries = Object.entries(profile.gamesCompleted || {});
    if (entries.length === 0) {
        el.innerHTML = `<div class="empty-state">No games played yet — head to the home page to get started!</div>`;
        return;
    }
    el.innerHTML = entries
        .map(([game, data]) => {
            let detail = data.date;
            if (game === 'wordle') {
                detail += data.won ? ` — solved in ${data.attempts}` : ' — not solved';
            } else if (data.completed) {
                detail += ' — completed';
            }
            return `
                <div class="history-row">
                    <div class="history-game">${GAME_LABELS[game] || game}</div>
                    <div class="history-detail">${detail}</div>
                </div>
            `;
        })
        .join('');
}

async function init() {
    const { uid, profile } = await initShell();

    const nameInput = document.getElementById('display-name-input');
    nameInput.value = profile.displayName;

    document.getElementById('save-name-btn').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
            showToast('Display name cannot be empty');
            return;
        }
        await updateDisplayName(uid, name);
        showToast('Display name updated');
    });

    renderStats(profile);
    renderHistory(profile);
}

init();
