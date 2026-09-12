import { trySession, showLoggedOutHeader } from '../../app.js';
import { icon } from '../../utils/icons.js';
import { getTodayDateString, showToast, escapeHtml, stringToSeed, getQueryParam } from '../../utils/helpers.js';
import { getConfig } from '../../utils/config.js';
import { checkPlayedToday, checkPlayedTodayAll, markSharedToFacebook, markSharedWithFriends } from '../../utils/points.js';
import { awardDailyCompletionXp } from '../../progression/xp-service.js';
import { advanceStreakForDailyCompletion } from '../../progression/streak-service.js';
import { playWordSearchRound } from './wordsearch-engine.js';
import { DAILY_MODE, CLASSIC_MODES, TOURNAMENT_MODE } from './wordsearch-modes.js';
import { getTodayChallenge, recordDailyResult } from './wordsearch-daily-data.js';
import { getRandomClassicPuzzle, recordClassicResult } from './wordsearch-classic-data.js';
import {
    listActiveWordsearchTournaments, getAttempt, getOrStartAttempt,
    recordPuzzleResult, completeTournamentIfNeeded,
    markSharedToFacebook as markTournamentSharedToFacebook,
    markSharedWithFriends as markTournamentSharedWithFriends,
} from './wordsearch-tournament-data.js';
import { showWordSearchSummaryModal } from './wordsearch-summary-modal.js';

const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const DIFFICULTY_POINTS = { easy: 10, medium: 15, hard: 25 };
const FACEBOOK_GROUP_URL = 'https://www.facebook.com/groups/playdailymindchallenge';
const TOURNAMENTS_TAB_URL = `${window.location.origin}/wordsearch?tab=tournament`;

// Outlined line icons (not this app's usual emoji set, see icons.js) -- used only on the
// tournament list card, matching the treatment sudoku-page.js's own tournament card uses.
const ICON_PUZZLES = `<svg class="wordsearch-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
const ICON_BONUS = `<svg class="wordsearch-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

// Outlined line icons for the Daily/Classic points breakdown (mirrors sudoku-page.js's own set).
const ICON_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
const ICON_STOPWATCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="9" y1="2.5" x2="15" y2="2.5"/></svg>`;
const ICON_CHECK_SM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function renderAdminBlocked(mount) {
    mount.innerHTML = `<div class="empty-state">Admin accounts don't play games.</div>`;
}

/** Shown in place of the game when there's no session, instead of the old hard redirect to `/` --
 * this keeps `/wordsearch` itself a real page with visible content (see the static "How to Play"
 * block in wordsearch.html) rather than one that always bounces an anonymous visitor away before
 * anything renders, which made the page invisible to crawlers/an AdSense reviewer. */
function renderSignInPrompt(mount) {
    const redirectTo = encodeURIComponent(window.location.pathname + window.location.search);
    mount.innerHTML = `
        <div class="empty-state">
            Sign in or continue as a guest to play today's Word Search.
            <br><br>
            <a class="btn primary" href="/?redirect=${redirectTo}">Sign In to Play</a>
        </div>
    `;
}

function renderNoPuzzlesSeeded(mount) {
    mount.innerHTML = `<div class="empty-state">Today's Word Search isn't ready yet &mdash; check back soon.</div>`;
}

function renderAlreadyPlayedDaily(mount, played) {
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already completed today's Word Search #${played.challengeId} (+${played.score} points). Come back tomorrow for a new puzzle!
        </div>
    `;
}

function shareTextForDaily(challengeId, timeTaken, wordsFound, totalWords, score) {
    return `🧠 Daily Mind Challenge\n\n🔍 Daily Word Search #${challengeId}\n🎉 Found ${wordsFound}/${totalWords} words in ${timeTaken}\n⭐ Score: ${score} points\n\nCan you beat my result? 👀\n\nPlay today's challenge:\n${window.location.href}`;
}

function shareTextForClassic(difficulty, timeTaken, wordsFound, totalWords, score) {
    return `🧩 Daily Mind Challenge\n\nClassic Word Search — ${DIFFICULTY_LABELS[difficulty]}\n🎉 Found ${wordsFound}/${totalWords} words in ${timeTaken}\n⭐ Score: ${score} points\n\nCan you beat my result? 👀\n\nPlay here:\n${window.location.href}`;
}

function shareTextForTournament(tournament, numPuzzles, score, puzzleResults) {
    const puzzleLines = puzzleResults.map((passed, i) => `Puzzle ${i + 1} - ${passed ? 'Passed' : 'Failed'}`).join('\n');
    return `🏆 Word Search Tournament Complete!\n\nI completed ${tournament.name} 🎉\n\n🧩 Puzzles: ${numPuzzles}/${numPuzzles}\n⭐ Score: ${score} points\n\n${puzzleLines}\n\nThink you can beat my score? 👀\n\nJoin the tournament:\n${TOURNAMENTS_TAB_URL}`;
}

async function renderDailyMode(mount, uid, profile, setActiveRound) {
    const played = await checkPlayedToday(uid, 'wordsearch');
    if (played) {
        renderAlreadyPlayedDaily(mount, played);
        return;
    }

    const challenge = await getTodayChallenge();
    if (!challenge) {
        renderNoPuzzlesSeeded(mount);
        return;
    }

    mount.innerHTML = `
        <h2 class="wordsearch-title">Daily Word Search #${challenge.challengeId}</h2>
        <p class="wordsearch-subtitle">Drag across letters to select a straight line and find every word.</p>
        <div id="wordsearch-round-mount"></div>
    `;
    const roundMount = document.getElementById('wordsearch-round-mount');

    setActiveRound(playWordSearchRound({
        container: roundMount,
        words: challenge.words,
        seed: stringToSeed(getTodayDateString()),
        gridSize: DAILY_MODE.gridSize,
        directions: DAILY_MODE.directions,
        onComplete: async ({ wordsFound, totalWords, timeTakenSeconds }) => {
            setActiveRound(null);
            const result = await recordDailyResult(uid, profile, {
                challengeId: challenge.challengeId,
                theme: challenge.theme,
                timeTakenSeconds,
                wordsFound,
                totalWords,
            });
            if (!result) return;

            // Phase 3 progression XP (registered players only, see docs/progression-gamification-roadmap.md)
            // -- checked *after* recordDailyResult() above, so it reflects this completion.
            if (profile.kind === 'registered') {
                const playedToday = await checkPlayedTodayAll(uid);
                const allDone = Object.values(playedToday).every(Boolean);
                await awardDailyCompletionXp(uid, allDone);
                await advanceStreakForDailyCompletion(uid);
            }

            showWordSearchSummaryModal({
                title: 'Solved!',
                subtitle: `Daily Word Search #${challenge.challengeId}`,
                celebrate: true,
                breakdown: [
                    { label: 'Completing the puzzle', points: result.completionPoints, icon: ICON_GRID },
                    { label: 'Speed bonus', points: result.timeBonusPoints, icon: ICON_STOPWATCH },
                ],
                totalPoints: result.score,
                shareText: shareTextForDaily(challenge.challengeId, result.timeTaken, wordsFound, totalWords, result.score),
                communityUrl: FACEBOOK_GROUP_URL,
                onShareCommunity: () => markSharedToFacebook(uid, 'wordsearch', getTodayDateString()),
                onShareFriends: () => markSharedWithFriends(uid, 'wordsearch', getTodayDateString()),
            });
            showToast(`+${result.score} points!`);
        },
    }));
}

function renderDifficultyPicker(mount, onPick) {
    mount.innerHTML = `
        <h2 class="wordsearch-title">Classic Word Search</h2>
        <p class="wordsearch-subtitle">Pick a difficulty for a random puzzle. Play as many rounds as you like.</p>
        <div class="wordsearch-difficulty-picker">
            ${Object.keys(DIFFICULTY_LABELS).map((difficulty) => `
                <button class="wordsearch-difficulty-btn" data-difficulty="${difficulty}" type="button">
                    <span class="wordsearch-difficulty-name">${DIFFICULTY_LABELS[difficulty]}</span>
                    <span class="wordsearch-difficulty-points">+${DIFFICULTY_POINTS[difficulty]} pts</span>
                </button>
            `).join('')}
        </div>
    `;
    mount.querySelectorAll('[data-difficulty]').forEach((btn) => {
        btn.addEventListener('click', () => onPick(btn.dataset.difficulty));
    });
}

async function playClassicRound(mount, uid, profile, difficulty, setActiveRound) {
    mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
    const puzzleData = await getRandomClassicPuzzle(difficulty);
    if (!puzzleData) {
        mount.innerHTML = `<div class="empty-state">No ${DIFFICULTY_LABELS[difficulty].toLowerCase()} puzzles are seeded yet &mdash; check back soon.</div>`;
        return;
    }

    mount.innerHTML = `
        <h2 class="wordsearch-title">Classic Word Search &mdash; ${DIFFICULTY_LABELS[difficulty]}</h2>
        <p class="wordsearch-subtitle">Puzzle #${puzzleData.puzzleId} &mdash; drag across letters to find every word.</p>
        <div id="wordsearch-round-mount"></div>
    `;
    const roundMount = document.getElementById('wordsearch-round-mount');
    const modeConfig = CLASSIC_MODES[difficulty];

    setActiveRound(playWordSearchRound({
        container: roundMount,
        words: puzzleData.words,
        // Fresh random layout every round -- unlike Daily/Tournament, Classic allows unlimited
        // replays of the same word list, so a puzzleId-derived (deterministic) seed would make
        // every replay render an identical, memorizable grid.
        seed: Math.floor(Math.random() * 4294967296),
        gridSize: modeConfig.gridSize,
        directions: modeConfig.directions,
        onComplete: async ({ wordsFound, totalWords, timeTakenSeconds }) => {
            setActiveRound(null);
            const result = await recordClassicResult(uid, profile, {
                puzzleId: puzzleData.puzzleId,
                difficulty,
                timeTakenSeconds,
                wordsFound,
                totalWords,
            });
            if (!result) return;

            showWordSearchSummaryModal({
                title: 'Solved!',
                subtitle: `Classic Word Search — ${DIFFICULTY_LABELS[difficulty]}`,
                celebrate: true,
                breakdown: [
                    { label: 'Completing the puzzle', points: result.completionPoints, icon: ICON_GRID },
                    { label: 'Speed bonus', points: result.timeBonusPoints, icon: ICON_STOPWATCH },
                ],
                totalPoints: result.score,
                shareText: shareTextForClassic(difficulty, result.timeTaken, wordsFound, totalWords, result.score),
                communityUrl: FACEBOOK_GROUP_URL,
                onShareCommunity: () => markSharedToFacebook(uid, 'wordsearch-classic', result.gameDate),
                onShareFriends: () => markSharedWithFriends(uid, 'wordsearch-classic', result.gameDate),
                onClose: () => renderDifficultyPicker(mount, (nextDifficulty) => playClassicRound(mount, uid, profile, nextDifficulty, setActiveRound)),
            });
            showToast(`+${result.score} points!`);
        },
    }));
}

function renderClassicMode(mount, uid, profile, setActiveRound) {
    renderDifficultyPicker(mount, (difficulty) => playClassicRound(mount, uid, profile, difficulty, setActiveRound));
}

async function renderTournamentMode(mount, uid, profile, setActiveRound) {
    const tournaments = await listActiveWordsearchTournaments();
    if (tournaments.length === 0) {
        mount.innerHTML = `<div class="empty-state">No tournaments running right now. Check back soon!</div>`;
        return;
    }

    const attempts = await Promise.all(tournaments.map((t) => getAttempt(t.id, uid)));

    mount.innerHTML = `
        <div class="wordsearch-tournament-list">
            ${tournaments.map((t, i) => {
                const attempt = attempts[i];
                const numPuzzles = t.puzzles.length;
                let statusLabel = 'Start';
                if (attempt?.completed) statusLabel = 'Completed';
                else if (attempt && attempt.currentPuzzleIndex > 0) statusLabel = `Continue (puzzle ${attempt.currentPuzzleIndex + 1}/${numPuzzles})`;

                return `
                    <div class="wordsearch-tournament-card">
                        <div class="wordsearch-tournament-info">
                            <div class="wordsearch-tournament-name">${escapeHtml(t.name)}</div>
                            <div class="wordsearch-tournament-meta-row">
                                <span class="wordsearch-tournament-meta-item">${ICON_PUZZLES} ${numPuzzles} Puzzles</span>
                                <span class="wordsearch-tournament-sep">|</span>
                                <span class="wordsearch-tournament-meta-item">${ICON_BONUS} +${t.completionBonus} Bonus</span>
                            </div>
                        </div>
                        <button class="btn primary" data-play-wordsearch-tournament="${t.id}" ${attempt?.completed ? 'disabled' : ''} type="button">${statusLabel}</button>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    mount.querySelectorAll('[data-play-wordsearch-tournament]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tournament = tournaments.find((t) => t.id === btn.dataset.playWordsearchTournament);
            playWordsearchTournamentRound(mount, uid, profile, tournament, setActiveRound);
        });
    });
}

/**
 * Awards the one-time completion bonus once every puzzle has been attempted. Both the
 * "just finished the last puzzle" path and the "resumed a tournament that finished attempting but
 * the bonus never landed" path funnel through here -- see completeTournamentIfNeeded()'s own docs.
 */
async function finishWordsearchTournament(mount, uid, profile, tournament, setActiveRound) {
    const result = await completeTournamentIfNeeded(uid, profile, tournament);
    if (!result || !result.bonusAwarded) {
        mount.innerHTML = `
            <div class="empty-state">You attempted every puzzle, but saving your bonus failed &mdash; check the browser console for the error, then try again.</div>
            <div class="wordsearch-tournament-actions">
                <button class="btn primary" id="wordsearch-tournament-finalize-retry-btn" type="button">Try Again</button>
                <button class="btn" id="wordsearch-tournament-back-btn" type="button">Back to Tournaments</button>
            </div>
        `;
        showToast("Couldn't save your tournament bonus");
        document.getElementById('wordsearch-tournament-finalize-retry-btn').addEventListener('click', () => {
            finishWordsearchTournament(mount, uid, profile, tournament, setActiveRound);
        });
        document.getElementById('wordsearch-tournament-back-btn').addEventListener('click', () => {
            renderTournamentMode(mount, uid, profile, setActiveRound);
        });
        return;
    }

    const settings = await getConfig('wordsearchTournamentSettings');
    const numPuzzles = tournament.puzzles.length;
    const puzzleResults = result.puzzleResults || [];
    let currentTotal = result.puzzlesPassed * settings.completedPoints
        + result.puzzlesFailed * settings.failedPoints
        + tournament.completionBonus;

    showWordSearchSummaryModal({
        title: 'Tournament complete!',
        subtitle: tournament.name,
        celebrate: true,
        breakdown: [
            ...puzzleResults.map((passed, i) => ({
                label: `Puzzle ${i + 1}: ${passed ? 'Passed' : 'Failed'}`,
                points: passed ? settings.completedPoints : settings.failedPoints,
                icon: passed ? ICON_CHECK_SM : undefined,
            })),
            { label: 'Completion bonus', points: tournament.completionBonus, icon: ICON_BONUS },
        ],
        totalPoints: currentTotal,
        shareText: shareTextForTournament(tournament, numPuzzles, currentTotal, puzzleResults),
        communityUrl: FACEBOOK_GROUP_URL,
        shareLink: TOURNAMENTS_TAB_URL,
        onShareCommunity: async () => {
            const r = await markTournamentSharedToFacebook(uid, tournament.id);
            if (r.applied) currentTotal += 20;
            return { applied: r.applied, newScore: currentTotal };
        },
        onShareFriends: async () => {
            const r = await markTournamentSharedWithFriends(uid, tournament.id);
            if (r.applied) currentTotal += 10;
            return { applied: r.applied, newScore: currentTotal };
        },
        onClose: () => renderTournamentMode(mount, uid, profile, setActiveRound),
    });
    showToast(`Tournament complete! +${currentTotal} points`);
}

async function playWordsearchTournamentRound(mount, uid, profile, tournament, setActiveRound) {
    const settings = await getConfig('wordsearchTournamentSettings');
    const attempt = await getOrStartAttempt(tournament.id, uid, profile);
    const numPuzzles = tournament.puzzles.length;

    if (attempt.completed) {
        mount.innerHTML = `<div class="empty-state">You already completed "${escapeHtml(tournament.name)}".</div>`;
        return;
    }

    if (attempt.currentPuzzleIndex >= numPuzzles) {
        // Every puzzle was already attempted on a prior visit, but the completion bonus wasn't
        // saved yet (e.g. a dropped connection right after the last puzzle) -- retry that instead
        // of trying to play a puzzle index that doesn't exist.
        mount.innerHTML = `<div class="loading-text">Saving your bonus&hellip;</div>`;
        await finishWordsearchTournament(mount, uid, profile, tournament, setActiveRound);
        return;
    }

    const puzzleIndex = attempt.currentPuzzleIndex;
    const puzzleData = tournament.puzzles[puzzleIndex];
    // No new schema field needed -- correct even after resuming a reloaded page mid-run, since
    // it's recomputed from the attempt's own already-tracked counters every time.
    const runningScore = attempt.puzzlesPassed * settings.completedPoints + attempt.puzzlesFailed * settings.failedPoints;

    mount.innerHTML = `
        <h2 class="wordsearch-title">${escapeHtml(tournament.name)}</h2>
        <p class="wordsearch-subtitle">Puzzle ${puzzleIndex + 1} of ${numPuzzles} &mdash; Current Score: ${runningScore}</p>
        <div id="wordsearch-round-mount"></div>
    `;
    const roundMount = document.getElementById('wordsearch-round-mount');

    setActiveRound(playWordSearchRound({
        container: roundMount,
        words: puzzleData.words,
        seed: stringToSeed(`${tournament.id}_${puzzleIndex}`),
        gridSize: TOURNAMENT_MODE.gridSize,
        directions: TOURNAMENT_MODE.directions,
        timeLimitSeconds: settings.timeLimitSeconds,
        onComplete: async ({ won }) => {
            setActiveRound(null);
            const updated = await recordPuzzleResult(tournament, uid, profile, {
                puzzleIndex,
                passed: won,
                completedPoints: settings.completedPoints,
                failedPoints: settings.failedPoints,
            });
            if (!updated) {
                mount.innerHTML = `<div class="empty-state">Couldn't save this puzzle's result &mdash; check the browser console, then try again.</div>`;
                showToast("Couldn't save this puzzle's result");
                return;
            }

            if (updated.currentPuzzleIndex >= numPuzzles) {
                await finishWordsearchTournament(mount, uid, profile, tournament, setActiveRound);
                return;
            }

            // Word Search has no "wrong answer" concept -- the only way to fail a puzzle is the
            // timer running out, so a loss here always means timedOut.
            const pointsEarned = won ? settings.completedPoints : settings.failedPoints;
            const reasonText = won ? 'passed' : 'failed — time ran out';

            mount.innerHTML = `
                <div class="empty-state">Puzzle ${puzzleIndex + 1} ${reasonText} (+${pointsEarned} points).</div>
                <div class="wordsearch-tournament-actions">
                    <button class="btn primary" id="wordsearch-tournament-next-btn" type="button">Next Puzzle</button>
                </div>
            `;
            document.getElementById('wordsearch-tournament-next-btn').addEventListener('click', () => {
                playWordsearchTournamentRound(mount, uid, profile, tournament, setActiveRound);
            });
        },
    }));
}

function wireModeTabs(uid, profile, initialMode) {
    const tabs = Array.from(document.querySelectorAll('.wordsearch-mode-tab'));
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
        if (mode === 'daily') {
            await renderDailyMode(mount, uid, profile, setActiveRound);
        } else if (mode === 'classic') {
            renderClassicMode(mount, uid, profile, setActiveRound);
        } else {
            await renderTournamentMode(mount, uid, profile, setActiveRound);
        }
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => render(tab.dataset.mode)));
    render(initialMode);
}

async function init() {
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

    const initialMode = getQueryParam('tab') === 'tournament' ? 'tournament' : 'daily';
    wireModeTabs(uid, profile, initialMode);
}

init();
