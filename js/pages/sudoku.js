import { initShell } from '../lib/partials.js';
import { icon } from '../lib/icons.js';
import { getTodayDateString, showToast } from '../lib/utils.js';
import { awardGamePoints, hasPlayedToday } from '../lib/points.js';
import { getDailySudokuPuzzle } from '../data/sudoku-puzzles.js';
import { playSudokuRound } from '../games/sudoku.js';

const SUDOKU_POINTS = 30;

function renderAlreadyPlayed(mount) {
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already completed today's Sudoku. Come back tomorrow for a new puzzle!
        </div>
    `;
}

async function init() {
    const { uid, profile } = await initShell();
    const mount = document.getElementById('game-mount');

    if (hasPlayedToday(profile, 'sudoku')) {
        renderAlreadyPlayed(mount);
        return;
    }

    const { puzzle, solution } = getDailySudokuPuzzle(getTodayDateString());

    playSudokuRound({
        container: mount,
        puzzle,
        solution,
        onComplete: async () => {
            await awardGamePoints(uid, 'sudoku', SUDOKU_POINTS, { completed: true });
            showToast(`+${SUDOKU_POINTS} points!`);
        },
    });
}

init();
