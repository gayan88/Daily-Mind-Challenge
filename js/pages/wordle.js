import { initShell } from '../lib/partials.js';
import { icon } from '../lib/icons.js';
import { getTodayDateString, showToast, formatDuration } from '../lib/utils.js';
import { recordGameScore, checkPlayedToday } from '../lib/points.js';
import { getDailyWordleWord } from '../data/words-wordle.js';
import { playWordleRound } from '../games/wordle.js';

const MAX_GUESSES = 6;

function renderAlreadyPlayed(mount, played) {
    const status = played.score > 0
        ? `solved with a score of ${played.score}`
        : 'not solved';
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already played today's Wordle (${status}). Come back tomorrow for a new word!
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

    const played = await checkPlayedToday(uid, 'wordle');
    if (played) {
        renderAlreadyPlayed(mount, played);
        return;
    }

    const word = getDailyWordleWord(getTodayDateString());
    const startTime = Date.now();

    playWordleRound({
        container: mount,
        targetWord: word,
        maxGuesses: MAX_GUESSES,
        onComplete: async ({ won, attempts }) => {
            const score = won ? MAX_GUESSES + 1 - attempts : 0;
            const timeTaken = formatDuration(Date.now() - startTime);
            const recorded = await recordGameScore(uid, profile, 'wordle', score, timeTaken);
            if (recorded && score > 0) showToast(`+${score} points!`);
        },
    });
}

init();
