import { initShell } from '../lib/partials.js';
import { icon } from '../lib/icons.js';
import { getTodayDateString, showToast, formatDuration } from '../lib/utils.js';
import { recordGameScore, checkPlayedToday } from '../lib/points.js';
import { getDailySudokuPuzzle } from '../data/sudoku-puzzles.js';
import { playSudokuRound } from '../games/sudoku.js';

const SUDOKU_SCORE = 6; // flat score on completion, kept on the same 0-6 scale as Wordle

function renderAlreadyPlayed(mount) {
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already completed today's Sudoku. Come back tomorrow for a new puzzle!
        </div>
    `;
}

function renderAdminBlocked(mount) {
    mount.innerHTML = `<div class="empty-state">Admin accounts don't play games.</div>`;
}

async function init() {
    const { uid, profile } = await initShell();
    const mount = document.getElementById('game-mount');

    if (profile.isAdmin) {
        renderAdminBlocked(mount);
        return;
    }

    const played = await checkPlayedToday(uid, 'sudoku');
    if (played) {
        renderAlreadyPlayed(mount);
        return;
    }

    const { puzzle, solution } = getDailySudokuPuzzle(getTodayDateString());
    const startTime = Date.now();

    playSudokuRound({
        container: mount,
        puzzle,
        solution,
        onComplete: async () => {
            const timeTaken = formatDuration(Date.now() - startTime);
            const recorded = await recordGameScore(uid, profile, 'sudoku', SUDOKU_SCORE, timeTaken);
            if (recorded) showToast(`+${SUDOKU_SCORE} points!`);
        },
    });
}

init();
