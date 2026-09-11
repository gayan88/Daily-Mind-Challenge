import { initShell } from '../app.js';
import { icon } from '../utils/icons.js';
import { updateRegisteredProfile } from '../auth/user-profile.js';
import { containsBlockedWord } from '../utils/profanity.js';
import { getUserLifetimeStats, getUserGameHistory } from '../utils/points.js';
import { showToast } from '../utils/helpers.js';

// Every gameType any gameScores doc can be written under, across all 9 game/mode data files --
// GAME_LABELS used to only know the three Daily Challenge ones, so a Classic/Tournament/Challenge
// row fell back to showing its raw gameType string instead of a real label.
const GAME_LABELS = {
    wordle: 'Wordle',
    'wordle-tournament': 'Wordle Tournament',
    'wordle-challenge': 'Wordle Challenge',
    'wordle-challenge-creator': 'Wordle Challenge Reward',
    sudoku: 'Sudoku',
    'sudoku-classic': 'Sudoku Classic',
    'sudoku-tournament': 'Sudoku Tournament',
    'sudoku-tournament-bonus': 'Sudoku Tournament Bonus',
    wordsearch: 'Word Search',
    'wordsearch-classic': 'Word Search Classic',
    'wordsearch-tournament': 'Word Search Tournament',
    'wordsearch-tournament-bonus': 'Word Search Tournament Bonus',
};

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
        .map((entry) => {
            // `gameDate` is a real calendar date only for Daily Challenge docs -- Classic/
            // Tournament/Challenge modes repurpose it as a deterministic key (a tournament id, a
            // {tournamentId}_{puzzleIndex} pair, etc.), so `scoreDate` (always a real date,
            // regardless of mode) is shown instead when present. `timeTaken` only exists on
            // Daily/Classic docs -- Tournament docs track different fields entirely (wordAttempts,
            // puzzleResults, raw errors/timeTakenSeconds), so it's omitted rather than shown as
            // the literal text "undefined" when absent.
            const date = entry.scoreDate || entry.gameDate;
            const timeSuffix = entry.timeTaken ? ` (${entry.timeTaken})` : '';
            return `
                <div class="history-row">
                    <div class="history-game">${GAME_LABELS[entry.gameType] || entry.gameType}</div>
                    <div class="history-detail">${date} — ${entry.score} pts${timeSuffix}</div>
                </div>
            `;
        })
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
