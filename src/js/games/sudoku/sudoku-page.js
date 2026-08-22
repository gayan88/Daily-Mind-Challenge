import { initShell } from '../../app.js';
import { icon } from '../../utils/icons.js';
import { getTodayDateString, showToast, escapeHtml } from '../../utils/helpers.js';
import { getConfig } from '../../utils/config.js';
import { checkPlayedToday, markSharedToFacebook } from '../../utils/points.js';
import { playSudokuRound } from './sudoku-engine.js';
import { getTodayChallenge, recordDailyResult } from './sudoku-daily-data.js';
import { getRandomClassicPuzzle, recordClassicResult } from './sudoku-classic-data.js';
import {
    listActiveSudokuTournaments, getAttempt, getOrStartAttempt,
    recordPuzzleResult, completeTournamentIfNeeded,
} from './sudoku-tournament-data.js';
import { showSudokuSummaryModal } from './sudoku-summary-modal.js';

const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const DIFFICULTY_POINTS = { easy: 10, medium: 15, hard: 25 };

// Outlined line icons (not this app's usual emoji set, see icons.js) -- used only on the
// tournament list card, whose mockup called for a purple-outline look emoji can't reproduce.
const ICON_PUZZLES = `<svg class="sudoku-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
const ICON_BONUS = `<svg class="sudoku-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

function renderAdminBlocked(mount) {
    mount.innerHTML = `<div class="empty-state">Admin accounts don't play games.</div>`;
}

function renderNoPuzzlesSeeded(mount) {
    mount.innerHTML = `<div class="empty-state">Today's Sudoku isn't ready yet &mdash; check back soon.</div>`;
}

function renderAlreadyPlayedDaily(mount, played) {
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already completed today's Sudoku #${played.challengeId} (+${played.score} points). Come back tomorrow for a new puzzle!
        </div>
    `;
}

function shareTextForDaily(challengeId, timeTaken, errors) {
    return `Daily Mind Challenge Sudoku #${challengeId} — solved in ${timeTaken} with ${errors} error${errors === 1 ? '' : 's'}!`;
}

function shareTextForClassic(difficulty, timeTaken, errors) {
    return `Daily Mind Challenge Sudoku (${DIFFICULTY_LABELS[difficulty]}) — solved in ${timeTaken} with ${errors} error${errors === 1 ? '' : 's'}!`;
}

async function renderDailyMode(mount, uid, profile, setActiveRound) {
    const played = await checkPlayedToday(uid, 'sudoku');
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
        <h2 class="sudoku-title">Daily Sudoku #${challenge.challengeId}</h2>
        <p class="sudoku-subtitle">Tap a cell, then tap a number to fill it in. Fill the whole grid to win.</p>
        <div id="sudoku-round-mount"></div>
    `;
    const roundMount = document.getElementById('sudoku-round-mount');

    setActiveRound(playSudokuRound({
        container: roundMount,
        puzzle: challenge.puzzle,
        solution: challenge.solution,
        onComplete: async ({ errors, timeTakenSeconds }) => {
            setActiveRound(null);
            const result = await recordDailyResult(uid, profile, {
                challengeId: challenge.challengeId,
                errors,
                timeTakenSeconds,
            });
            if (!result) return;

            showSudokuSummaryModal({
                title: 'Solved!',
                subtitle: `Daily Sudoku #${challenge.challengeId}`,
                breakdown: [
                    { label: 'Completing the puzzle', points: result.completionPoints },
                    { label: 'Speed bonus', points: result.timeBonusPoints },
                    { label: 'Accuracy bonus', points: result.errorBonusPoints },
                ],
                totalPoints: result.score,
                shareText: shareTextForDaily(challenge.challengeId, result.timeTaken, errors),
                onShare: () => markSharedToFacebook(uid, 'sudoku', getTodayDateString()),
            });
            showToast(`+${result.score} points!`);
        },
    }));
}

function renderDifficultyPicker(mount, onPick) {
    mount.innerHTML = `
        <h2 class="sudoku-title">Classic Sudoku</h2>
        <p class="sudoku-subtitle">Pick a difficulty for a random puzzle. Play as many rounds as you like.</p>
        <div class="sudoku-difficulty-picker">
            ${Object.keys(DIFFICULTY_LABELS).map((difficulty) => `
                <button class="sudoku-difficulty-btn" data-difficulty="${difficulty}" type="button">
                    <span class="sudoku-difficulty-name">${DIFFICULTY_LABELS[difficulty]}</span>
                    <span class="sudoku-difficulty-points">+${DIFFICULTY_POINTS[difficulty]} pts</span>
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
        <h2 class="sudoku-title">Classic Sudoku &mdash; ${DIFFICULTY_LABELS[difficulty]}</h2>
        <p class="sudoku-subtitle">Tap a cell, then tap a number to fill it in. Fill the whole grid to win.</p>
        <div id="sudoku-round-mount"></div>
    `;
    const roundMount = document.getElementById('sudoku-round-mount');

    setActiveRound(playSudokuRound({
        container: roundMount,
        puzzle: puzzleData.puzzle,
        solution: puzzleData.solution,
        onComplete: async ({ errors, timeTakenSeconds }) => {
            setActiveRound(null);
            const result = await recordClassicResult(uid, profile, {
                puzzleId: puzzleData.puzzleId,
                difficulty,
                errors,
                timeTakenSeconds,
            });
            if (!result) return;

            showSudokuSummaryModal({
                title: 'Solved!',
                subtitle: `Classic Sudoku — ${DIFFICULTY_LABELS[difficulty]}`,
                breakdown: [
                    { label: 'Completing the puzzle', points: result.completionPoints },
                    { label: 'Speed bonus', points: result.timeBonusPoints },
                    { label: 'Accuracy bonus', points: result.errorBonusPoints },
                ],
                totalPoints: result.score,
                shareText: shareTextForClassic(difficulty, result.timeTaken, errors),
                onShare: () => markSharedToFacebook(uid, 'sudoku-classic', result.gameDate),
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
    const tournaments = await listActiveSudokuTournaments();
    if (tournaments.length === 0) {
        mount.innerHTML = `<div class="empty-state">No tournaments running right now. Check back soon!</div>`;
        return;
    }

    const attempts = await Promise.all(tournaments.map((t) => getAttempt(t.id, uid)));

    mount.innerHTML = `
        <div class="sudoku-tournament-list">
            ${tournaments.map((t, i) => {
                const attempt = attempts[i];
                const numPuzzles = t.puzzles.length;
                let statusLabel = 'Start';
                if (attempt?.completed) statusLabel = 'Completed';
                else if (attempt && attempt.currentPuzzleIndex > 0) statusLabel = `Continue (puzzle ${attempt.currentPuzzleIndex + 1}/${numPuzzles})`;

                return `
                    <div class="sudoku-tournament-card">
                        <div class="sudoku-tournament-info">
                            <div class="sudoku-tournament-name">${escapeHtml(t.name)}</div>
                            <div class="sudoku-tournament-meta-row">
                                <span class="sudoku-tournament-meta-item">${ICON_PUZZLES} ${numPuzzles} Puzzles</span>
                                <span class="sudoku-tournament-sep">|</span>
                                <span class="sudoku-tournament-meta-item">${ICON_BONUS} +${t.completionBonus} Bonus</span>
                            </div>
                        </div>
                        <button class="btn primary" data-play-sudoku-tournament="${t.id}" ${attempt?.completed ? 'disabled' : ''} type="button">${statusLabel}</button>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    mount.querySelectorAll('[data-play-sudoku-tournament]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tournament = tournaments.find((t) => t.id === btn.dataset.playSudokuTournament);
            playSudokuTournamentRound(mount, uid, profile, tournament, setActiveRound);
        });
    });
}

/**
 * Awards the one-time completion bonus once every puzzle has been attempted. Unlike Wordle
 * Tournament's finalizeTournament(), this can be safely re-entered (see
 * completeTournamentIfNeeded()'s own docs) -- so both the "just finished the last puzzle" path and
 * the "resumed a tournament that finished attempting but the bonus never landed" path funnel
 * through here.
 */
async function finishSudokuTournament(mount, uid, profile, tournament, setActiveRound) {
    const result = await completeTournamentIfNeeded(uid, profile, tournament);
    if (!result || !result.bonusAwarded) {
        mount.innerHTML = `
            <div class="empty-state">You attempted every puzzle, but saving your bonus failed &mdash; check the browser console for the error, then try again.</div>
            <div class="sudoku-tournament-actions">
                <button class="btn primary" id="sudoku-tournament-finalize-retry-btn" type="button">Try Again</button>
                <button class="btn" id="sudoku-tournament-back-btn" type="button">Back to Tournaments</button>
            </div>
        `;
        showToast("Couldn't save your tournament bonus");
        document.getElementById('sudoku-tournament-finalize-retry-btn').addEventListener('click', () => {
            finishSudokuTournament(mount, uid, profile, tournament, setActiveRound);
        });
        document.getElementById('sudoku-tournament-back-btn').addEventListener('click', () => {
            renderTournamentMode(mount, uid, profile, setActiveRound);
        });
        return;
    }

    const totalPoints = result.puzzlesPassed * 50 + result.puzzlesFailed * 10 + tournament.completionBonus;

    showSudokuSummaryModal({
        title: 'Tournament complete!',
        subtitle: tournament.name,
        breakdown: [
            { label: `${result.puzzlesPassed} puzzle${result.puzzlesPassed === 1 ? '' : 's'} passed`, points: result.puzzlesPassed * 50 },
            { label: `${result.puzzlesFailed} puzzle${result.puzzlesFailed === 1 ? '' : 's'} failed`, points: result.puzzlesFailed * 10 },
            { label: 'Completion bonus', points: tournament.completionBonus },
        ],
        totalPoints,
        onClose: () => renderTournamentMode(mount, uid, profile, setActiveRound),
    });
    showToast(`Tournament complete! +${totalPoints} points`);
}

async function playSudokuTournamentRound(mount, uid, profile, tournament, setActiveRound) {
    const settings = await getConfig('sudokuTournamentSettings');
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
        await finishSudokuTournament(mount, uid, profile, tournament, setActiveRound);
        return;
    }

    const puzzleIndex = attempt.currentPuzzleIndex;
    const puzzleData = tournament.puzzles[puzzleIndex];

    mount.innerHTML = `
        <h2 class="sudoku-title">${escapeHtml(tournament.name)}</h2>
        <p class="sudoku-subtitle">Puzzle ${puzzleIndex + 1} of ${numPuzzles}</p>
        <div id="sudoku-round-mount"></div>
    `;
    const roundMount = document.getElementById('sudoku-round-mount');

    setActiveRound(playSudokuRound({
        container: roundMount,
        puzzle: puzzleData.puzzle,
        solution: puzzleData.solution,
        timeLimitSeconds: settings.timeLimitSeconds,
        maxErrors: settings.maxErrors,
        onComplete: async ({ won, timedOut }) => {
            setActiveRound(null);
            const updated = await recordPuzzleResult(tournament, uid, profile, { puzzleIndex, passed: won });
            if (!updated) {
                mount.innerHTML = `<div class="empty-state">Couldn't save this puzzle's result &mdash; check the browser console, then try again.</div>`;
                showToast("Couldn't save this puzzle's result");
                return;
            }

            if (updated.currentPuzzleIndex >= numPuzzles) {
                await finishSudokuTournament(mount, uid, profile, tournament, setActiveRound);
                return;
            }

            const pointsEarned = won ? 50 : 10;
            const reasonText = won ? 'passed' : (timedOut ? 'failed — time ran out' : 'failed — too many errors');

            mount.innerHTML = `
                <div class="empty-state">Puzzle ${puzzleIndex + 1} ${reasonText} (+${pointsEarned} points).</div>
                <div class="sudoku-tournament-actions">
                    <button class="btn primary" id="sudoku-tournament-next-btn" type="button">Next Puzzle</button>
                </div>
            `;
            document.getElementById('sudoku-tournament-next-btn').addEventListener('click', () => {
                playSudokuTournamentRound(mount, uid, profile, tournament, setActiveRound);
            });
        },
    }));
}

function wireModeTabs(uid, profile) {
    const tabs = Array.from(document.querySelectorAll('.sudoku-mode-tab'));
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
    render('daily');
}

async function init() {
    const { uid, profile } = await initShell();
    const mount = document.getElementById('game-mount');

    if (profile.isAdmin) {
        renderAdminBlocked(mount);
        return;
    }

    wireModeTabs(uid, profile);
}

init();
