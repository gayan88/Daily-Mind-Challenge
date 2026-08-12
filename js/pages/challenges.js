import { initShell } from '../lib/partials.js';
import { icon } from '../lib/icons.js';
import { getQueryParam, escapeHtml, showToast } from '../lib/utils.js';
import {
    createChallenge,
    getChallenge,
    isChallengeExpired,
    listOpenChallenges,
    getChallengeCompletion,
    recordChallengeCompletion,
} from '../lib/challenges.js';
import { WORDLE_ANSWERS } from '../data/words-wordle.js';
import { playWordleRound } from '../games/wordle.js';

const GAME_LABELS = { wordle: 'Wordle' };

function shareLinkFor(challengeId) {
    const url = new URL(window.location.href);
    url.search = `?id=${encodeURIComponent(challengeId)}`;
    return url.toString();
}

function renderShareResult(challengeId) {
    const el = document.getElementById('share-result');
    const link = shareLinkFor(challengeId);
    el.innerHTML = `
        <div class="share-box">
            <input type="text" readonly value="${escapeHtml(link)}" id="share-link-input">
            <button class="btn primary" id="copy-link-btn" type="button">Copy Link</button>
        </div>
    `;
    document.getElementById('copy-link-btn').addEventListener('click', async () => {
        const input = document.getElementById('share-link-input');
        input.select();
        try {
            await navigator.clipboard.writeText(link);
            showToast('Link copied!');
        } catch {
            showToast('Copy failed — select and copy manually');
        }
    });
}

async function initCreateForm(uid, profile) {
    const select = document.getElementById('word-select');
    select.innerHTML = WORDLE_ANSWERS.map((w) => `<option value="${w}">${w}</option>`).join('');

    document.getElementById('random-word-btn').addEventListener('click', () => {
        const word = WORDLE_ANSWERS[Math.floor(Math.random() * WORDLE_ANSWERS.length)];
        select.value = word;
    });

    document.getElementById('create-btn').addEventListener('click', async () => {
        const word = select.value;
        const id = await createChallenge(uid, profile.displayName, word, 'wordle');
        renderShareResult(id);
        showToast('Challenge created!');
        loadOpenChallenges(uid);
    });
}

async function loadOpenChallenges(uid) {
    const el = document.getElementById('challenges-list');
    const challenges = await listOpenChallenges(20);
    if (challenges.length === 0) {
        el.innerHTML = `<div class="empty-state">No open challenges yet. Create one above to share with friends!</div>`;
        return;
    }
    el.innerHTML = challenges
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

async function initBrowseView(uid, profile) {
    document.getElementById('browse-view').hidden = false;
    await initCreateForm(uid, profile);
    await loadOpenChallenges(uid);
}

async function initSolveView(uid, profile, challengeId) {
    document.getElementById('solve-view').hidden = false;
    const mount = document.getElementById('solve-mount');

    const challenge = await getChallenge(challengeId);
    if (!challenge) {
        mount.innerHTML = `<div class="empty-state">This challenge doesn't exist or was removed.</div>`;
        return;
    }
    if (isChallengeExpired(challenge)) {
        mount.innerHTML = `<div class="empty-state">This challenge has expired.</div>`;
        return;
    }

    const existing = await getChallengeCompletion(challengeId, uid);
    const header = document.createElement('div');
    header.className = 'solve-header';
    header.innerHTML = `Challenge from <strong>${escapeHtml(challenge.creatorDisplayName)}</strong> — guess the ${challenge.word.length}-letter word in 6 tries.`;
    mount.innerHTML = '';
    mount.appendChild(header);

    const gameMount = document.createElement('div');
    mount.appendChild(gameMount);

    if (existing) {
        const status = existing.won
            ? `solved it in ${existing.attempts} ${existing.attempts === 1 ? 'try' : 'tries'}`
            : 'did not solve it';
        gameMount.innerHTML = `<div class="empty-state">${icon('CHECK')} You already attempted this challenge and ${status}.</div>`;
        return;
    }

    if (challenge.creatorUid === uid) {
        gameMount.innerHTML = `<div class="empty-state">This is your own challenge — share the link with a friend so they can solve it!</div>`;
        return;
    }

    playWordleRound({
        container: gameMount,
        targetWord: challenge.word,
        maxGuesses: 6,
        onComplete: async ({ won, attempts }) => {
            await recordChallengeCompletion(challengeId, uid, profile.displayName, won, attempts);
            showToast(won ? 'Challenge solved!' : 'Challenge attempt recorded.');
        },
    });
}

async function init() {
    const { uid, profile } = await initShell();
    const challengeId = getQueryParam('id');

    if (challengeId) {
        await initSolveView(uid, profile, challengeId);
    } else {
        await initBrowseView(uid, profile);
    }
}

init();
