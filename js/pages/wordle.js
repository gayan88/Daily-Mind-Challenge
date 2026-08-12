import { initShell } from '../lib/partials.js';
import { icon } from '../lib/icons.js';
import { getTodayDateString, showToast } from '../lib/utils.js';
import { awardGamePoints, hasPlayedToday } from '../lib/points.js';
import { getDailyWordleWord } from '../data/words-wordle.js';
import { playWordleRound } from '../games/wordle.js';

const POINTS_BY_ATTEMPTS = { 1: 50, 2: 40, 3: 30, 4: 20, 5: 15, 6: 10 };

function renderAlreadyPlayed(mount, played) {
    const status = played.won
        ? `solved in ${played.attempts} ${played.attempts === 1 ? 'try' : 'tries'}`
        : 'not solved';
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already played today's Wordle (${status}). Come back tomorrow for a new word!
        </div>
    `;
}

async function init() {
    const { uid, profile } = await initShell();
    const mount = document.getElementById('game-mount');
    const word = getDailyWordleWord(getTodayDateString());

    if (hasPlayedToday(profile, 'wordle')) {
        renderAlreadyPlayed(mount, profile.gamesCompleted.wordle);
        return;
    }

    playWordleRound({
        container: mount,
        targetWord: word,
        maxGuesses: 6,
        onComplete: async ({ won, attempts }) => {
            const points = won ? POINTS_BY_ATTEMPTS[attempts] || 10 : 0;
            await awardGamePoints(uid, 'wordle', points, { won, attempts });
            if (points > 0) showToast(`+${points} points!`);
        },
    });
}

init();
