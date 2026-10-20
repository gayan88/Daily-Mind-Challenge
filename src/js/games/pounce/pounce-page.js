import { trySession, showLoggedOutHeader } from '../../app.js';
import { icon } from '../../utils/icons.js';
import { getTodayDateString, showToast, getQueryParam, escapeHtml, formatDuration } from '../../utils/helpers.js';
import { getConfig } from '../../utils/config.js';
import { checkPlayedToday, checkPlayedTodayAll, markSharedToFacebook, markSharedWithFriends } from '../../utils/points.js';
import { awardDailyCompletionXp } from '../../progression/xp-service.js';
import { advanceStreakForDailyCompletion } from '../../progression/streak-service.js';
import { trackGameCompleted } from '../../utils/meta-pixel.js';
import { playPounceRound, staticBoardHtml } from './pounce-engine.js';
import { getTodayChallenge, recordDailyResult } from './pounce-daily-data.js';
import { getClassicPuzzle, recordClassicResult } from './pounce-classic-data.js';
import {
    listActivePounceTournaments, getAttempt, getOrStartAttempt, spendLife, recordBoardResult,
    completeTournamentIfNeeded, runIsOver,
    markSharedToFacebook as markRunSharedToFacebook,
    markSharedWithFriends as markRunSharedWithFriends,
} from './pounce-tournament-data.js';
import { classicPoints, runBonusFor, RUN_BOARD_PASS_POINTS, RUN_BOARD_FAIL_POINTS } from './pounce-scoring.js';
import { DIFFICULTIES } from './pounce-generator.js';
import { catSvg, cafeCat } from './pounce-cats.js';
import { showPounceSummaryModal } from './pounce-summary-modal.js';

const FACEBOOK_GROUP_URL = 'https://www.facebook.com/groups/playdailymindchallenge';
const MODES = ['daily', 'classic', 'zen', 'tournament'];
const CLASSIC_TAB_URL = `${window.location.origin}/pounce?tab=classic`;
const TOURNAMENT_TAB_URL = `${window.location.origin}/pounce?tab=tournament`;
const DIFFICULTY_BLURB = {
    easy: 'A quick 6×6 nap.',
    medium: 'The Daily size, with sleeping dogs.',
    hard: 'Dogs plus pawprint clues.',
};

// Outlined line icons for the points breakdown (same set as quilt-page.js).
const ICON_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
const ICON_STOPWATCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="9" y1="2.5" x2="15" y2="2.5"/></svg>`;
const ICON_MINUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
const ICON_CHECK_SM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_BONUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const ICON_PAW = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="9" r="2.2"/><circle cx="10" cy="5.5" r="2.2"/><circle cx="14" cy="5.5" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M12 11c-3.5 0-6 3-6 5.7C6 19 7.8 20 9.5 20c1 0 1.6-.5 2.5-.5s1.5.5 2.5.5c1.7 0 3.5-1 3.5-3.3C18 14 15.5 11 12 11z"/></svg>`;
const ICON_CLOCK = `<svg class="pounce-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/></svg>`;
const ICON_BOARDS = `<svg class="pounce-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
const ICON_STAR = `<svg class="pounce-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
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

// ---------- Classic + Zen ----------

function shareTextForClassic(difficulty, size, timeTaken, mistakes, tips, perfect, score) {
    const hisses = `${mistakes} hiss${mistakes === 1 ? '' : 'es'}`;
    const tipText = `${tips} tip${tips === 1 ? '' : 's'}`;
    return `🐾 Daily Mind Challenge\n\nClassic Pounce — ${DIFFICULTIES[difficulty].label} ${size}×${size}${perfect ? ' — Purrfect! ✨' : ''}\n${'🐱'.repeat(size)}  ${timeTaken} · ${hisses} · ${tipText}\n⭐ Score: ${score.toLocaleString()} points\n\nCan you pounce faster? 👀\n\nPlay here:\n${CLASSIC_TAB_URL}`;
}

/** Difficulty buttons for Classic (with the best possible score) or Zen (no points). */
function renderDifficultyPicker(mount, { title, subtitle, zen }, onPick) {
    mount.innerHTML = `
        <h2 class="pounce-title">${title}</h2>
        <p class="pounce-subtitle">${subtitle}</p>
        <div class="pounce-difficulty-picker">
            ${Object.entries(DIFFICULTIES).map(([difficulty, d]) => `
                <button class="pounce-difficulty-btn" data-difficulty="${difficulty}" type="button">
                    <span class="pounce-difficulty-text">
                        <span class="pounce-difficulty-name">${d.label} &middot; ${d.size}&times;${d.size}</span>
                        <span class="pounce-difficulty-blurb">${DIFFICULTY_BLURB[difficulty]}</span>
                    </span>
                    ${zen ? '' : `<span class="pounce-difficulty-points">up to ${classicPoints({ timeTakenSeconds: 0, mistakes: 0, tips: 0, perfect: true, difficulty }).score} pts</span>`}
                </button>
            `).join('')}
        </div>
    `;
    mount.querySelectorAll('[data-difficulty]').forEach((btn) => {
        btn.addEventListener('click', () => onPick(btn.dataset.difficulty));
    });
}

function renderNotReady(mount, difficulty, onBack) {
    mount.innerHTML = `
        <div class="empty-state">No ${DIFFICULTIES[difficulty].label.toLowerCase()} boards are ready yet &mdash; check back soon.</div>
        <div class="pounce-tournament-actions"><button class="btn" id="pounce-back-btn" type="button">Choose another size</button></div>
    `;
    document.getElementById('pounce-back-btn').addEventListener('click', onBack);
}

function extrasNote(puzzle) {
    const notes = [];
    if (puzzle.dogs.length) notes.push('Sleeping dogs 🐶 mark cells no cat naps on.');
    if (puzzle.pawprints.length) notes.push('A pawprint 🐾 shows how many cats touch that cell.');
    return notes.length ? ` ${notes.join(' ')}` : '';
}

async function playClassicRound(mount, uid, profile, difficulty, setActiveRound, lastPuzzleId = null) {
    mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
    const back = () => renderClassicMode(mount, uid, profile, setActiveRound);
    const data = await getClassicPuzzle(uid, difficulty, lastPuzzleId);
    if (!data) {
        renderNotReady(mount, difficulty, back);
        return;
    }
    const { puzzle, puzzleId } = data;
    const label = DIFFICULTIES[difficulty].label;

    mount.innerHTML = `
        <h2 class="pounce-title">Classic Pounce &mdash; ${label}</h2>
        <p class="pounce-subtitle">${HOW_TO}${extrasNote(puzzle)}</p>
        <div id="pounce-round-mount"></div>
    `;
    const playAgain = () => playClassicRound(mount, uid, profile, difficulty, setActiveRound, puzzleId);

    setActiveRound(playPounceRound({
        container: document.getElementById('pounce-round-mount'),
        puzzle,
        mode: 'classic',
        seed: puzzleId,
        onComplete: async ({ timeTakenSeconds, mistakes, tips, perfect }) => {
            setActiveRound(null);
            const result = await recordClassicResult(uid, profile, { puzzleId, difficulty, timeTakenSeconds, mistakes, tips, perfect });
            if (!result) {
                showToast("Couldn't save this result -- check the browser console");
                return;
            }
            trackGameCompleted('pounce-classic');

            showPounceSummaryModal({
                title: 'Every cat found its spot!',
                subtitle: `Classic Pounce — ${label} · ${result.timeTaken}`,
                celebrate: true,
                perfect,
                breakdown: [
                    { label: 'Solving the board', points: result.completionPoints, icon: ICON_GRID },
                    { label: 'Speed bonus', points: result.timeBonusPoints, icon: ICON_STOPWATCH },
                    { label: `Hisses & tips (${mistakes} + ${tips})`, points: result.penaltyPoints, icon: ICON_MINUS },
                    { label: 'Purrfect', points: result.perfectBonusPoints, icon: ICON_SPARKLE },
                ],
                totalPoints: result.score,
                shareText: shareTextForClassic(difficulty, puzzle.size, result.timeTaken, mistakes, tips, perfect, result.score),
                communityUrl: FACEBOOK_GROUP_URL,
                shareLink: CLASSIC_TAB_URL,
                onShareCommunity: () => markSharedToFacebook(uid, 'pounce-classic', result.gameDate),
                onShareFriends: () => markSharedWithFriends(uid, 'pounce-classic', result.gameDate),
                onClose: () => {
                    mount.innerHTML = `
                        <div class="empty-state">${icon('CHECK')} ${label} board solved (+${result.score.toLocaleString()} points).</div>
                        <div class="pounce-tournament-actions">
                            <button class="btn primary" id="pounce-classic-again-btn" type="button">Next ${label} Board</button>
                            <button class="btn" id="pounce-back-btn" type="button">Choose another size</button>
                        </div>
                    `;
                    document.getElementById('pounce-classic-again-btn').addEventListener('click', playAgain);
                    document.getElementById('pounce-back-btn').addEventListener('click', back);
                },
            });
            showToast(`+${result.score.toLocaleString()} points!`);
        },
    }));
}

function renderClassicMode(mount, uid, profile, setActiveRound) {
    renderDifficultyPicker(mount, {
        title: 'Classic Pounce',
        subtitle: 'Pick a size for a new board. Play as many as you like &mdash; boards you haven\'t solved come first.',
    }, (difficulty) => playClassicRound(mount, uid, profile, difficulty, setActiveRound));
}

/** Zen: the Classic pool with no clock, no score, free tips and nothing written. */
async function playZenRound(mount, uid, difficulty, setActiveRound, lastPuzzleId = null) {
    mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
    const back = () => renderZenMode(mount, uid, setActiveRound);
    const data = await getClassicPuzzle(uid, difficulty, lastPuzzleId, { preferUnplayed: false });
    if (!data) {
        renderNotReady(mount, difficulty, back);
        return;
    }
    const { puzzle, puzzleId } = data;
    const label = DIFFICULTIES[difficulty].label;
    mount.innerHTML = `
        <h2 class="pounce-title">Zen &mdash; ${label}</h2>
        <p class="pounce-subtitle">No clock, no score, free Whisker Tips. ${HOW_TO}${extrasNote(puzzle)}</p>
        <div id="pounce-round-mount"></div>
    `;
    setActiveRound(playPounceRound({
        container: document.getElementById('pounce-round-mount'),
        puzzle,
        mode: 'zen',
        seed: puzzleId,
        onComplete: () => {
            setActiveRound(null);
            mount.insertAdjacentHTML('beforeend', `
                <div class="pounce-tournament-actions">
                    <button class="btn primary" id="pounce-zen-next-btn" type="button">Next ${label} Board</button>
                    <button class="btn" id="pounce-back-btn" type="button">Choose another size</button>
                </div>
            `);
            document.getElementById('pounce-zen-next-btn').addEventListener('click', () => playZenRound(mount, uid, difficulty, setActiveRound, puzzleId));
            document.getElementById('pounce-back-btn').addEventListener('click', back);
        },
    }));
}

function renderZenMode(mount, uid, setActiveRound) {
    renderDifficultyPicker(mount, {
        title: 'Zen',
        subtitle: 'Just you and the cats: no clock, no score, and Whisker Tips are free.',
        zen: true,
    }, (difficulty) => playZenRound(mount, uid, difficulty, setActiveRound));
}

// ---------- Nine Lives Run (Tournament) ----------

function formatLimit(seconds) {
    if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds} sec`;
}

function boardRunTotal(results) {
    return results.reduce((sum, r) => sum + (r.passed ? RUN_BOARD_PASS_POINTS : RUN_BOARD_FAIL_POINTS), 0);
}

/** Progress strip: one pip per board (✓ solved, ✕ failed, current highlighted) + lives left. */
function runStripHtml(tournament, attempt, currentIndex = -1) {
    const results = attempt.puzzleResults || [];
    const pips = tournament.boards.map((b, i) => {
        const r = results[i];
        const state = r ? (r.passed ? 'passed' : 'failed') : (i === currentIndex ? 'current' : 'locked');
        const mark = r ? (r.passed ? '✓' : '✕') : `${b.size}×${b.size}`;
        return `<span class="pounce-run-pip pounce-run-pip-${state}" title="Board ${i + 1}">${mark}</span>`;
    }).join('');
    return `
        <div class="pounce-run-strip">
            <div class="pounce-run-pips">${pips}</div>
            <div class="pounce-run-lives" aria-label="${attempt.livesLeft} lives left">${ICON_PAW}<span>${attempt.livesLeft}</span> ${attempt.livesLeft === 1 ? 'life' : 'lives'} left</div>
        </div>
    `;
}

function shareTextForRun(tournament, attempt, score) {
    const results = attempt.puzzleResults || [];
    const boards = tournament.boards.map((_, i) => (results[i] ? (results[i].passed ? '✅' : '❌') : '⬜')).join('');
    const finished = runBonusFor(tournament, attempt).finished;
    return `🐾 Nine Lives Run${finished ? ' complete!' : ''}\n\n“${tournament.name}”\nBoards: ${boards}\nLives left: ${'🐾'.repeat(attempt.livesLeft) || '0'}\n⭐ Score: ${score.toLocaleString()} points\n\nThink you can keep more lives? 👀\n\nJoin the run:\n${TOURNAMENT_TAB_URL}`;
}

async function renderTournamentMode(mount, uid, profile, setActiveRound) {
    const [tournaments, settings] = await Promise.all([listActivePounceTournaments(), getConfig('pounceTournamentSettings')]);
    if (tournaments.length === 0) {
        mount.innerHTML = `<div class="empty-state">No Nine Lives Runs right now. Check back soon!</div>`;
        return;
    }
    const attempts = await Promise.all(tournaments.map((t) => getAttempt(t.id, uid)));

    mount.innerHTML = `
        <h2 class="pounce-title">Nine Lives Run</h2>
        <p class="pounce-subtitle">Five boards, from 5&times;5 to 9&times;9, each against the clock &mdash; with ${settings.lives} lives for the whole run. A wrong cat or running out of time costs a life. Lose them all and the run ends, but you keep the points you've banked.</p>
        <div class="pounce-tournament-list">
            ${tournaments.map((t, i) => {
                const attempt = attempts[i];
                const n = t.boards.length;
                let statusLabel = 'Start';
                if (attempt?.completed) statusLabel = 'Completed';
                else if (attempt && runIsOver(t, attempt)) statusLabel = 'Finish';
                else if (attempt && attempt.currentPuzzleIndex > 0) statusLabel = `Continue (board ${attempt.currentPuzzleIndex + 1}/${n})`;
                return `
                    <div class="pounce-tournament-card">
                        <div class="pounce-tournament-info">
                            <div class="pounce-tournament-name">${escapeHtml(t.name)}</div>
                            <div class="pounce-tournament-meta-row">
                                <span class="pounce-tournament-meta-item">${ICON_BOARDS} ${n} Boards</span>
                                <span class="pounce-tournament-sep">|</span>
                                <span class="pounce-tournament-meta-item">${ICON_CLOCK} ${formatLimit(settings.timeLimitSeconds)} each</span>
                                <span class="pounce-tournament-sep">|</span>
                                <span class="pounce-tournament-meta-item">${ICON_STAR} +${t.completionBonus} Bonus</span>
                            </div>
                        </div>
                        <button class="btn primary" data-play-pounce-run="${t.id}" ${attempt?.completed ? 'disabled' : ''} type="button">${statusLabel}</button>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    mount.querySelectorAll('[data-play-pounce-run]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tournament = tournaments.find((t) => t.id === btn.dataset.playPounceRun);
            playRunBoard(mount, uid, profile, tournament, settings, setActiveRound);
        });
    });
}

/** Awards the run bonus (retry-safe) and shows the run summary. */
async function finishRun(mount, uid, profile, tournament, settings, setActiveRound) {
    const result = await completeTournamentIfNeeded(uid, profile, tournament);
    const backToRuns = () => renderTournamentMode(mount, uid, profile, setActiveRound);
    if (!result || !result.bonusAwarded) {
        mount.innerHTML = `
            <div class="empty-state">Your run is over, but saving it failed &mdash; check the browser console for the error, then try again.</div>
            <div class="pounce-tournament-actions">
                <button class="btn primary" id="pounce-run-finalize-retry-btn" type="button">Try Again</button>
                <button class="btn" id="pounce-run-back-btn" type="button">Back to Nine Lives Runs</button>
            </div>
        `;
        showToast("Couldn't save your Nine Lives Run");
        document.getElementById('pounce-run-finalize-retry-btn').addEventListener('click', () => finishRun(mount, uid, profile, tournament, settings, setActiveRound));
        document.getElementById('pounce-run-back-btn').addEventListener('click', backToRuns);
        return;
    }
    trackGameCompleted('pounce-tournament');

    const results = result.puzzleResults || [];
    const bonus = runBonusFor(tournament, result);
    let currentTotal = boardRunTotal(results) + bonus.score;

    mount.innerHTML = `
        <div class="empty-state">${icon('CHECK')} &ldquo;${escapeHtml(tournament.name)}&rdquo; ${bonus.finished ? 'complete!' : 'is over &mdash; out of lives.'}</div>
        ${runStripHtml(tournament, result)}
        <div class="pounce-tournament-actions"><button class="btn" id="pounce-run-back-btn" type="button">Back to Nine Lives Runs</button></div>
    `;
    document.getElementById('pounce-run-back-btn').addEventListener('click', backToRuns);

    showPounceSummaryModal({
        title: bonus.finished ? 'Nine Lives Run complete!' : 'Out of lives!',
        subtitle: tournament.name,
        celebrate: true,
        breakdown: [
            ...results.map((r, i) => ({
                label: `Board ${i + 1}: ${r.passed ? formatDuration(r.timeTakenSeconds * 1000) : (r.timedOut ? 'out of time' : 'out of lives')}${r.perfect ? ' • Purrfect' : ''}`,
                points: r.passed ? RUN_BOARD_PASS_POINTS : RUN_BOARD_FAIL_POINTS,
                icon: r.passed ? ICON_CHECK_SM : undefined,
            })),
            { label: 'Completion bonus', points: bonus.completionBonus, icon: ICON_BONUS },
            { label: `Lives left (${result.livesLeft} × 5)`, points: bonus.livesBonus, icon: ICON_PAW },
        ],
        totalPoints: currentTotal,
        shareText: shareTextForRun(tournament, result, currentTotal),
        communityUrl: FACEBOOK_GROUP_URL,
        shareLink: TOURNAMENT_TAB_URL,
        onShareCommunity: async () => {
            const r = await markRunSharedToFacebook(uid, tournament.id);
            if (r.applied) currentTotal += 20;
            return { applied: r.applied, newScore: currentTotal };
        },
        onShareFriends: async () => {
            const r = await markRunSharedWithFriends(uid, tournament.id);
            if (r.applied) currentTotal += 10;
            return { applied: r.applied, newScore: currentTotal };
        },
    });
    showToast(`${bonus.finished ? 'Run complete!' : 'Run over.'} +${currentTotal} points`);
}

async function playRunBoard(mount, uid, profile, tournament, settings, setActiveRound) {
    mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
    const attempt = await getOrStartAttempt(tournament.id, uid, profile, settings.lives);
    const n = tournament.boards.length;

    if (attempt.completed) {
        mount.innerHTML = `<div class="empty-state">You already played &ldquo;${escapeHtml(tournament.name)}&rdquo;.</div>${runStripHtml(tournament, attempt)}`;
        return;
    }
    if (runIsOver(tournament, attempt)) {
        // Every board (or every life) was used on an earlier visit but the finish never saved.
        mount.innerHTML = `<div class="loading-text">Saving your run&hellip;</div>`;
        await finishRun(mount, uid, profile, tournament, settings, setActiveRound);
        return;
    }

    const boardIndex = attempt.currentPuzzleIndex;
    const livesAtStart = attempt.livesLeft;
    const puzzle = tournament.boards[boardIndex];
    mount.innerHTML = `
        <h2 class="pounce-title">${escapeHtml(tournament.name)}</h2>
        <p class="pounce-subtitle">Board ${boardIndex + 1} of ${n} &mdash; ${formatLimit(settings.timeLimitSeconds)} on the clock.${extrasNote(puzzle)}</p>
        ${runStripHtml(tournament, attempt, boardIndex)}
        <div id="pounce-round-mount"></div>
    `;

    setActiveRound(playPounceRound({
        container: document.getElementById('pounce-round-mount'),
        puzzle,
        mode: 'run',
        lives: livesAtStart,
        timeLimitSeconds: settings.timeLimitSeconds,
        roundLabel: `Board ${boardIndex + 1} of ${n}`,
        seed: `${tournament.id}_${boardIndex}`,
        onLifeLost: (livesLeft) => spendLife(tournament.id, uid, livesLeft),
        onComplete: async ({ won, timedOut, outOfLives, timeTakenSeconds, perfect, livesLeft }) => {
            setActiveRound(null);
            const updated = await recordBoardResult(tournament, uid, profile, {
                boardIndex, passed: won, timedOut, outOfLives, timeTakenSeconds, perfect, livesLeft, livesAtStart,
            });
            if (!updated) {
                mount.innerHTML = `<div class="empty-state">Couldn't save this board's result &mdash; check the browser console, then try again.</div>`;
                showToast("Couldn't save this board's result");
                return;
            }
            trackGameCompleted('pounce-tournament');

            if (runIsOver(tournament, updated)) {
                await finishRun(mount, uid, profile, tournament, settings, setActiveRound);
                return;
            }
            const points = won ? RUN_BOARD_PASS_POINTS : RUN_BOARD_FAIL_POINTS;
            const lost = livesAtStart - updated.livesLeft;
            mount.innerHTML = `
                <div class="empty-state">Board ${boardIndex + 1} ${won ? `solved${perfect ? ' &mdash; Purrfect \u{2728}' : ''}` : 'ran out of time'} (+${points} points${lost ? `, ${lost} ${lost === 1 ? 'life' : 'lives'} lost` : ''}).</div>
                ${runStripHtml(tournament, updated, updated.currentPuzzleIndex)}
                <div class="pounce-tournament-actions">
                    <button class="btn primary" id="pounce-run-next-btn" type="button">Next Board</button>
                </div>
            `;
            document.getElementById('pounce-run-next-btn').addEventListener('click', () => playRunBoard(mount, uid, profile, tournament, settings, setActiveRound));
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
        else if (mode === 'classic') renderClassicMode(mount, uid, profile, setActiveRound);
        else if (mode === 'zen') renderZenMode(mount, uid, setActiveRound);
        else await renderTournamentMode(mount, uid, profile, setActiveRound);
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
