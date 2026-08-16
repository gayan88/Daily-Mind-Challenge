import { initShell } from '../lib/partials.js';
import { icon } from '../lib/icons.js';
import { getTodayDateString, showToast, formatDuration, stringToSeed } from '../lib/utils.js';
import { recordGameScore, checkPlayedToday } from '../lib/points.js';
import { getDailyWordSearch } from '../data/wordsearch-words.js';
import { playWordSearchRound } from '../games/wordsearch.js';

const WORDSEARCH_SCORE = 6; // flat score on completion, kept on the same 0-6 scale as Wordle

function renderAlreadyPlayed(mount) {
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already completed today's Word Search. Come back tomorrow for a new one!
        </div>
    `;
}

function renderAdminBlocked(mount) {
    mount.innerHTML = `<div class="empty-state">Admin accounts don't play games.</div>`;
}

async function init() {
    const { uid, profile } = await initShell();
    const mount = document.getElementById('game-mount');
    const today = getTodayDateString();
    const { theme, words } = getDailyWordSearch(today);

    document.getElementById('ws-theme-title').textContent = `Today's Word Search: ${theme}`;

    if (profile.isAdmin) {
        renderAdminBlocked(mount);
        return;
    }

    const played = await checkPlayedToday(uid, 'wordsearch');
    if (played) {
        renderAlreadyPlayed(mount);
        return;
    }

    const startTime = Date.now();

    playWordSearchRound({
        container: mount,
        words,
        seed: stringToSeed(today),
        onComplete: async () => {
            const timeTaken = formatDuration(Date.now() - startTime);
            const recorded = await recordGameScore(uid, profile, 'wordsearch', WORDSEARCH_SCORE, timeTaken);
            if (recorded) showToast(`+${WORDSEARCH_SCORE} points! All words found.`);
        },
    });
}

init();
