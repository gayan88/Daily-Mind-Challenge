import { trySession, showLoggedOutHeader } from '../../app.js';
import { icon } from '../../utils/icons.js';
import { getTodayDateString, showToast, getQueryParam } from '../../utils/helpers.js';
import { checkPlayedToday, checkPlayedTodayAll, markSharedToFacebook, markSharedWithFriends } from '../../utils/points.js';
import { awardDailyCompletionXp } from '../../progression/xp-service.js';
import { advanceStreakForDailyCompletion } from '../../progression/streak-service.js';
import { trackGameCompleted } from '../../utils/meta-pixel.js';
import { playPounceRound, staticBoardHtml } from './pounce-engine.js';
import { getTodayChallenge, recordDailyResult } from './pounce-daily-data.js';
import { catSvg, cafeCat } from './pounce-cats.js';
import { showPounceSummaryModal } from './pounce-summary-modal.js';

const FACEBOOK_GROUP_URL = 'https://www.facebook.com/groups/playdailymindchallenge';
const MODES = ['daily', 'classic', 'zen', 'tournament'];

// Outlined line icons for the points breakdown (same set as quilt-page.js).
const ICON_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
const ICON_STOPWATCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="9" y1="2.5" x2="15" y2="2.5"/></svg>`;
const ICON_MINUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
const ICON_SPARKLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>`;

const HOW_TO = 'Place one cat in every row, every column and every colour region. Cats can\'t touch, not even diagonally. Tap once for ✕, again for a cat; long-press to place a cat straight away.';

/**
 * How to Play example: a solved 5×5 (one cat per row, column and region, none touching), shown
 * asleep. Generated once (`generatePuzzle({ difficulty: 'easy', size: 5, seed: 'htp-example' })`)
 * and pasted here so the page's static content never changes.
 */
const HTP_EXAMPLE = {
    size: 5,
    regions: ['33002', '33342', '13344', '11144', '11144'],
    solution: [2, 4, 1, 3, 0],
    dogs: [],
    pawprints: [],
};

function renderAdminBlocked(mount) {
    mount.innerHTML = `<div class="empty-state">Admin accounts don't play games.</div>`;
}

/** Shown instead of the game when there's no session, so `/pounce` stays a real, crawlable page
 * (same reasoning as quilt-page.js#renderSignInPrompt). */
function renderSignInPrompt(mount) {
    const redirectTo = encodeURIComponent(window.location.pathname + window.location.search);
    mount.innerHTML = `
        <div class="empty-state">
            Sign in or continue as a guest to play today's Pounce.
            <br><br>
            <a class="btn primary" href="/?redirect=${redirectTo}">Sign In to Play</a>
        </div>
    `;
}

function renderNoPuzzlesSeeded(mount) {
    mount.innerHTML = `<div class="empty-state">Today's Pounce isn't ready yet &mdash; check back soon.</div>`;
}

/** Classic, Zen and Nine Lives Run arrive in sprint 4 (docs/pounce-backlog.md P-401/P-402/P-501). */
function renderComingSoon(mount, name) {
    mount.innerHTML = `<div class="empty-state">${name} is coming soon. Try today's Daily Challenge!</div>`;
}

function cafeCaption(cat) {
    return `You adopted ${cat.description}!`;
}

/** Already solved today: show the solved board and the cat they adopted (no spoiler -- they've seen it). */
async function renderAlreadyPlayedDaily(mount, played) {
    const cat = cafeCat(getTodayDateString());
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already solved today's Daily Pounce #${played.challengeId} (+${played.score.toLocaleString()} points) and adopted ${cat.name}. Come back tomorrow for a new board!
        </div>
        <div id="pounce-played-board"></div>
    `;
    const challenge = await getTodayChallenge().catch(() => null);
    const holder = mount.querySelector('#pounce-played-board');
    if (!challenge || !holder) return;
    holder.innerHTML = staticBoardHtml(challenge.puzzle, { label: "Today's solved board", className: 'pounce-played-board' });
}

/** Daily share text: stats only, never the board -- it would spoil the puzzle for friends. */
function shareTextForDaily({ challengeId, size, timeTaken, mistakes, tips, perfect, score, cat }) {
    const cats = '🐱'.repeat(size);
    const hisses = `${mistakes} hiss${mistakes === 1 ? '' : 'es'}`;
    const tipText = `${tips} tip${tips === 1 ? '' : 's'}`;
    return `🐾 Daily Mind Challenge\n\nDaily Pounce #${challengeId}${perfect ? ' — Purrfect! ✨' : ''}\n${cats}  ${timeTaken} · ${hisses} · ${tipText}\n🧡 Adopted ${cat.description}\n⭐ Score: ${score.toLocaleString()} points\n\nCan you find every cat's spot? 👀\n\nPlay today's challenge:\n${window.location.origin}/pounce`;
}

async function renderDailyMode(mount, uid, profile, setActiveRound) {
    const played = await checkPlayedToday(uid, 'pounce');
    if (played) {
        await renderAlreadyPlayedDaily(mount, played);
        return;
    }

    const challenge = await getTodayChallenge();
    if (!challenge) {
        renderNoPuzzlesSeeded(mount);
        return;
    }

    const today = getTodayDateString();
    mount.innerHTML = `
        <h2 class="pounce-title">Daily Pounce #${challenge.challengeId}</h2>
        <p class="pounce-subtitle">${HOW_TO}</p>
        <div id="pounce-round-mount"></div>
    `;

    setActiveRound(playPounceRound({
        container: document.getElementById('pounce-round-mount'),
        puzzle: challenge.puzzle,
        mode: 'daily',
        seed: today,
        onComplete: async ({ timeTakenSeconds, mistakes, tips, perfect }) => {
            setActiveRound(null);
            const cat = cafeCat(today);
            const result = await recordDailyResult(uid, profile, {
                challengeId: challenge.challengeId,
                timeTakenSeconds,
                mistakes,
                tips,
                perfect,
                cafeCat: cat.name,
            });
            if (!result) return;
            trackGameCompleted('pounce');

            // Progression XP + streak for registered players, checked after the write so it
            // includes this completion (same as quilt-page.js).
            if (profile.kind === 'registered') {
                const playedToday = await checkPlayedTodayAll(uid);
                const allDone = Object.values(playedToday).every(Boolean);
                const allWon = Object.values(playedToday).every((d) => d?.won === true);
                await awardDailyCompletionXp(uid, allDone, allWon);
                await advanceStreakForDailyCompletion(uid);
            }

            showPounceSummaryModal({
                title: 'Every cat found its spot!',
                subtitle: `Daily Pounce #${challenge.challengeId} · ${result.timeTaken}`,
                cat: { svg: catSvg(cat), caption: cafeCaption(cat) },
                perfect,
                breakdown: [
                    { label: 'Solving the board', points: result.completionPoints, icon: ICON_GRID },
                    { label: 'Speed bonus', points: result.timeBonusPoints, icon: ICON_STOPWATCH },
                    { label: `Hisses & tips (${mistakes} + ${tips})`, points: result.penaltyPoints, icon: ICON_MINUS },
                    { label: 'Purrfect', points: result.perfectBonusPoints, icon: ICON_SPARKLE },
                ],
                totalPoints: result.score,
                shareText: shareTextForDaily({
                    challengeId: challenge.challengeId, size: challenge.puzzle.size, timeTaken: result.timeTaken,
                    mistakes, tips, perfect, score: result.score, cat,
                }),
                communityUrl: FACEBOOK_GROUP_URL,
                shareLink: `${window.location.origin}/pounce`,
                onShareCommunity: () => markSharedToFacebook(uid, 'pounce', today),
                onShareFriends: () => markSharedWithFriends(uid, 'pounce', today),
            });
            showToast(`+${result.score.toLocaleString()} points!`);
        },
    }));
}

function wireModeTabs(uid, profile, initialMode) {
    const tabs = Array.from(document.querySelectorAll('.pounce-mode-tab'));
    const mount = document.getElementById('game-mount');
    let activeRound = null;

    function setActiveRound(round) {
        activeRound = round;
    }

    async function render(mode) {
        activeRound?.destroy();
        activeRound = null;
        tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
        mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
        if (mode === 'daily') await renderDailyMode(mount, uid, profile, setActiveRound);
        else if (mode === 'classic') renderComingSoon(mount, 'Classic Pounce');
        else if (mode === 'zen') renderComingSoon(mount, 'Zen');
        else renderComingSoon(mount, 'The Nine Lives Run');
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => render(tab.dataset.mode)));
    render(initialMode);
}

function renderHowToPlayExample() {
    const holder = document.getElementById('htp-pounce-example');
    if (holder) holder.innerHTML = staticBoardHtml(HTP_EXAMPLE, { label: 'A solved 5 by 5 Pounce board', className: 'htp-mini-pounce', seed: 'htp' });
}

async function init() {
    renderHowToPlayExample();
    const session = await trySession();
    const mount = document.getElementById('game-mount');
    if (!session) {
        showLoggedOutHeader();
        renderSignInPrompt(mount);
        return;
    }
    const { uid, profile } = session;

    if (profile.isAdmin) {
        renderAdminBlocked(mount);
        return;
    }

    const tab = getQueryParam('tab');
    wireModeTabs(uid, profile, MODES.includes(tab) ? tab : 'daily');
}

init();
