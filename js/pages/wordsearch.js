import { initShell } from '../lib/partials.js';
import { icon } from '../lib/icons.js';
import { getTodayDateString, showToast, stringToSeed } from '../lib/utils.js';
import { awardGamePoints, hasPlayedToday } from '../lib/points.js';
import { getDailyWordSearch } from '../data/wordsearch-words.js';
import { playWordSearchRound } from '../games/wordsearch.js';

const WORDSEARCH_POINTS = 25;

function renderAlreadyPlayed(mount) {
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already completed today's Word Search. Come back tomorrow for a new one!
        </div>
    `;
}

async function init() {
    const { uid, profile } = await initShell();
    const mount = document.getElementById('game-mount');
    const today = getTodayDateString();
    const { theme, words } = getDailyWordSearch(today);

    document.getElementById('ws-theme-title').textContent = `Today's Word Search: ${theme}`;

    if (hasPlayedToday(profile, 'wordsearch')) {
        renderAlreadyPlayed(mount);
        return;
    }

    playWordSearchRound({
        container: mount,
        words,
        seed: stringToSeed(today),
        onComplete: async () => {
            await awardGamePoints(uid, 'wordsearch', WORDSEARCH_POINTS, { completed: true });
            showToast(`+${WORDSEARCH_POINTS} points! All words found.`);
        },
    });
}

init();
