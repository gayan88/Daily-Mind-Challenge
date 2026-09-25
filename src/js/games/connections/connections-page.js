import { trySession, showLoggedOutHeader } from '../../app.js';
import { icon } from '../../utils/icons.js';
import { showToast, escapeHtml, getQueryParam, getTodayDateString } from '../../utils/helpers.js';
import { checkPlayedToday, checkPlayedTodayAll } from '../../utils/points.js';
import { awardDailyCompletionXp } from '../../progression/xp-service.js';
import { advanceStreakForDailyCompletion } from '../../progression/streak-service.js';
import { playConnectionsRound, GROUP_EMOJI } from './connections-engine.js';
import { MAX_MISTAKES, CLASSIC_COMPLETION_POINTS, markSharedToFacebook, markSharedWithFriends } from './connections-scoring.js';
import { getTodayChallenge, recordDailyResult, getDailyAttemptState, recordDailyAttempt } from './connections-daily-data.js';
import { getRandomClassicPuzzle, recordClassicResult } from './connections-classic-data.js';
import { listActiveTournaments, getAttempt, getOrStartAttempt, recordPuzzleResult, finalizeTournament } from './connections-tournament-data.js';
import { showConnectionsSummaryModal } from './connections-summary-modal.js';

const FACEBOOK_GROUP_URL = 'https://www.facebook.com/groups/playdailymindchallenge';
const TOURNAMENTS_TAB_URL = `${window.location.origin}/connections?tab=tournaments`;
const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// Daily: how long a failed attempt locks the player out before retrying today's puzzle. Same
// unlimited-hourly-retry model as Wordle's Daily Challenge -- no reveal on a loss, no score.
const DAILY_RETRY_COOLDOWN_MS = 60 * 60 * 1000;

const ICON_CALENDAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const ICON_TARGET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>`;
const ICON_LIGHTNING = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>`;

function formatCountdown(msRemaining) {
    const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function mistakesLabel(mistakes) {
    return mistakes === 0 ? 'no mistakes' : `${mistakes} mistake${mistakes === 1 ? '' : 's'}`;
}

function emojiGrid(guessHistory) {
    return guessHistory.map((row) => row.map((gi) => GROUP_EMOJI[gi]).join('')).join('\n');
}

function renderAdminBlocked(mount) {
    mount.innerHTML = `<div class="empty-state">Admin accounts don't play games.</div>`;
}

/** Shown in place of the game when there's no session, so /connections stays a real, crawlable page. */
function renderSignInPrompt(mount) {
    const redirectTo = encodeURIComponent(window.location.pathname + window.location.search);
    mount.innerHTML = `
        <div class="empty-state">
            Sign in or continue as a guest to play Connections.
            <br><br>
            <a class="btn primary" href="/?redirect=${redirectTo}">Sign In to Play</a>
        </div>
    `;
}

function renderLoadError(mount, err) {
    console.error(err);
    mount.innerHTML = `<div class="empty-state">Something went wrong loading this &mdash; check the browser console for details (often a Firestore rules/index that hasn't been deployed yet).</div>`;
}

/* ---------------------------------- Daily Challenge ---------------------------------- */

function renderRetryCountdown(mount, challengeId, retryAtMs, onReady) {
    mount.innerHTML = `
        <div class="empty-state">
            😅 Not quite &mdash; out of mistakes on today's Connections #${challengeId}.
            <br><br>
            Try again in <strong id="cx-retry-countdown"></strong>.
        </div>
    `;
    const el = document.getElementById('cx-retry-countdown');

    const tick = () => {
        const liveEl = document.getElementById('cx-retry-countdown');
        if (!liveEl) {
            clearInterval(interval);
            return;
        }
        const remaining = retryAtMs - Date.now();
        if (remaining <= 0) {
            clearInterval(interval);
            onReady();
            return;
        }
        liveEl.textContent = formatCountdown(remaining);
    };

    el.textContent = formatCountdown(retryAtMs - Date.now());
    const interval = setInterval(tick, 1000);
}

function shareTextForDaily(challengeId, guessHistory, mistakes, score) {
    return `🧠 Daily Mind Challenge\n\n🔗 Daily Connections #${challengeId}\n🎉 Solved with ${mistakesLabel(mistakes)}\n⭐ Score: ${score.toLocaleString()} points\n\n${emojiGrid(guessHistory)}\n\nCan you beat my result? 👀\n\nPlay today's challenge:\n${window.location.origin}/connections`;
}

async function renderDailyMode(mount, uid, profile, setActiveRound) {
    // A gameScores doc for today only exists once solved -- the terminal state for the day.
    const played = await checkPlayedToday(uid, 'connections');
    if (played) {
        mount.innerHTML = `
            <div class="empty-state">
                ${icon('CHECK')} You already solved today's Connections #${played.challengeId} (${mistakesLabel(played.mistakes)}, +${played.score.toLocaleString()} points). Come back tomorrow for a new puzzle!
            </div>
        `;
        return;
    }

    const challenge = await getTodayChallenge();
    if (!challenge) {
        mount.innerHTML = `<div class="empty-state">Today's Connections isn't ready yet &mdash; check back soon.</div>`;
        return;
    }

    const attemptState = await getDailyAttemptState(uid);
    if (attemptState) {
        const retryAtMs = (attemptState.lastAttemptAt?.toMillis?.() ?? 0) + DAILY_RETRY_COOLDOWN_MS;
        if (Date.now() < retryAtMs) {
            renderRetryCountdown(mount, challenge.challengeId, retryAtMs, () => renderDailyMode(mount, uid, profile, setActiveRound));
            return;
        }
    }

    mount.innerHTML = `
        <h2 class="cx-title">Daily Connections #${challenge.challengeId}</h2>
        <p class="cx-subtitle">Find four groups of four words that share something in common. Everyone gets the same puzzle today.</p>
        <div id="cx-round-mount"></div>
    `;

    setActiveRound(playConnectionsRound({
        container: document.getElementById('cx-round-mount'),
        groups: challenge.groups,
        maxMistakes: MAX_MISTAKES,
        revealAnswersOnLoss: false,
        onComplete: async ({ won, mistakes, guessHistory, timeTakenSeconds }) => {
            await recordDailyAttempt(uid, won);

            if (!won) {
                renderRetryCountdown(mount, challenge.challengeId, Date.now() + DAILY_RETRY_COOLDOWN_MS, () => renderDailyMode(mount, uid, profile, setActiveRound));
                return;
            }

            const result = await recordDailyResult(uid, profile, { challengeId: challenge.challengeId, mistakes, timeTakenSeconds });
            if (!result) return;

            if (profile.kind === 'registered') {
                const playedToday = await checkPlayedTodayAll(uid);
                const allDone = Object.values(playedToday).every(Boolean);
                const allWon = Object.values(playedToday).every((d) => d?.won === true);
                await awardDailyCompletionXp(uid, allDone, allWon);
                await advanceStreakForDailyCompletion(uid);
            }

            showConnectionsSummaryModal({
                title: 'You solved it!',
                subtitle: `Daily Connections #${challenge.challengeId}`,
                guessHistory,
                celebrate: true,
                breakdown: [
                    { label: 'Playing today', points: result.playPoints, icon: ICON_CALENDAR },
                    { label: `Mistakes bonus (${mistakesLabel(result.mistakes)})`, points: result.mistakesPoints, icon: ICON_TARGET },
                    { label: `Speed bonus (${result.timeTaken})`, points: result.timePoints, icon: ICON_LIGHTNING },
                ],
                totalPoints: result.score,
                shareText: shareTextForDaily(challenge.challengeId, guessHistory, mistakes, result.score),
                communityUrl: FACEBOOK_GROUP_URL,
                onShareCommunity: () => markSharedToFacebook(uid, 'connections', getTodayDateString()),
                onShareFriends: () => markSharedWithFriends(uid, 'connections', getTodayDateString()),
            });
            showToast(`+${result.score.toLocaleString()} points!`);
        },
    }));
}

/* -------------------------------------- Classic -------------------------------------- */

function renderDifficultyPicker(mount, onPick) {
    mount.innerHTML = `
        <h2 class="cx-title">Classic Connections</h2>
        <p class="cx-subtitle">Pick a difficulty. Play as many puzzles as you like &mdash; every win scores.</p>
        <div class="cx-difficulty-list">
            ${Object.entries(DIFFICULTY_LABELS).map(([key, label]) => `
                <button class="cx-difficulty-card" data-difficulty="${key}" type="button">
                    <span class="cx-difficulty-name">${label}</span>
                    <span class="cx-difficulty-points">${CLASSIC_COMPLETION_POINTS[key]} pts + bonuses</span>
                </button>
            `).join('')}
        </div>
    `;
    mount.querySelectorAll('[data-difficulty]').forEach((btn) => {
        btn.addEventListener('click', () => onPick(btn.dataset.difficulty));
    });
}

function shareTextForClassic(difficulty, mistakes, guessHistory, score) {
    return `🧠 Daily Mind Challenge\n\n🔗 Classic Connections — ${DIFFICULTY_LABELS[difficulty]}\n🎉 Solved with ${mistakesLabel(mistakes)}\n⭐ Score: ${score.toLocaleString()} points\n\n${emojiGrid(guessHistory)}\n\nCan you beat my result? 👀\n\nPlay here:\n${window.location.origin}/connections`;
}

async function playClassicRound(mount, uid, profile, difficulty, setActiveRound, lastPuzzleId = null) {
    mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
    let puzzle;
    try {
        puzzle = await getRandomClassicPuzzle(difficulty, lastPuzzleId);
    } catch (err) {
        renderLoadError(mount, err);
        return;
    }
    const backToPicker = () => renderDifficultyPicker(mount, (d) => playClassicRound(mount, uid, profile, d, setActiveRound));

    if (!puzzle) {
        mount.innerHTML = `
            <div class="empty-state">No ${DIFFICULTY_LABELS[difficulty]} puzzles are ready yet &mdash; check back soon.</div>
            <div class="cx-tournament-actions"><button class="btn" id="cx-back-btn" type="button">Back</button></div>
        `;
        document.getElementById('cx-back-btn').addEventListener('click', backToPicker);
        return;
    }

    mount.innerHTML = `
        <h2 class="cx-title">Classic Connections &mdash; ${DIFFICULTY_LABELS[difficulty]}</h2>
        <div id="cx-round-mount"></div>
    `;

    setActiveRound(playConnectionsRound({
        container: document.getElementById('cx-round-mount'),
        groups: puzzle.groups,
        maxMistakes: MAX_MISTAKES,
        onComplete: async ({ won, mistakes, guessHistory, timeTakenSeconds }) => {
            if (!won) {
                mount.innerHTML = `
                    <div class="empty-state">Out of mistakes &mdash; no points this round. Ready for another puzzle?</div>
                    <div class="cx-tournament-actions">
                        <button class="btn primary" id="cx-next-btn" type="button">Play Another</button>
                        <button class="btn" id="cx-back-btn" type="button">Change Difficulty</button>
                    </div>
                `;
                document.getElementById('cx-next-btn').addEventListener('click', () => playClassicRound(mount, uid, profile, difficulty, setActiveRound, puzzle.puzzleId));
                document.getElementById('cx-back-btn').addEventListener('click', backToPicker);
                return;
            }

            const result = await recordClassicResult(uid, profile, { puzzleId: puzzle.puzzleId, difficulty, mistakes, timeTakenSeconds });
            if (!result) {
                showToast("Couldn't save your points");
                backToPicker();
                return;
            }

            showConnectionsSummaryModal({
                title: 'You solved it!',
                subtitle: `Classic Connections — ${DIFFICULTY_LABELS[difficulty]}`,
                guessHistory,
                celebrate: true,
                breakdown: [
                    { label: `${DIFFICULTY_LABELS[difficulty]} puzzle`, points: result.completionPoints, icon: ICON_CALENDAR },
                    { label: `Mistakes bonus (${mistakesLabel(result.mistakes)})`, points: result.mistakesPoints, icon: ICON_TARGET },
                    { label: `Speed bonus (${result.timeTaken})`, points: result.timePoints, icon: ICON_LIGHTNING },
                ],
                totalPoints: result.score,
                shareText: shareTextForClassic(difficulty, mistakes, guessHistory, result.score),
                communityUrl: FACEBOOK_GROUP_URL,
                onShareCommunity: () => markSharedToFacebook(uid, 'connections-classic', result.gameDate),
                onShareFriends: () => markSharedWithFriends(uid, 'connections-classic', result.gameDate),
                onClose: backToPicker,
            });
            showToast(`+${result.score.toLocaleString()} points!`);
        },
    }));
}

function renderClassicMode(mount, uid, profile, setActiveRound) {
    renderDifficultyPicker(mount, (difficulty) => playClassicRound(mount, uid, profile, difficulty, setActiveRound));
}

/* ------------------------------------ Tournament ------------------------------------ */

async function renderTournamentsMode(mount, uid, profile, setActiveRound) {
    const tournaments = await listActiveTournaments();
    if (tournaments.length === 0) {
        mount.innerHTML = `<div class="empty-state">No tournaments running right now. Check back soon!</div>`;
        return;
    }

    const attempts = await Promise.all(tournaments.map((t) => getAttempt(t.id, uid)));

    mount.innerHTML = `
        <div class="cx-tournament-list">
            ${tournaments.map((t, i) => {
                const attempt = attempts[i];
                const numPuzzles = t.puzzles.length;
                let statusLabel = 'Start';
                if (attempt?.completed) statusLabel = 'Completed';
                else if (attempt && attempt.currentPuzzleIndex > 0) statusLabel = `Continue (puzzle ${attempt.currentPuzzleIndex + 1}/${numPuzzles})`;

                return `
                    <div class="cx-tournament-card">
                        <div class="cx-tournament-name">${escapeHtml(t.name)}</div>
                        <div class="cx-tournament-divider"></div>
                        <div class="cx-tournament-footer">
                            <div class="cx-tournament-meta-row">
                                <span class="cx-tournament-meta-item">${icon('WORDS')} ${numPuzzles} puzzles</span>
                                <span class="cx-tournament-sep">|</span>
                                <span class="cx-tournament-meta-item">${icon('STOPWATCH')} ${t.timePerPuzzleSeconds}s/puzzle</span>
                                <span class="cx-tournament-sep">|</span>
                                <span class="cx-tournament-meta-item">${icon('STAR')} +${(t.bonusPoints || 0).toLocaleString()} bonus</span>
                            </div>
                            <button class="btn primary" data-play-tournament="${t.id}" ${attempt?.completed ? 'disabled' : ''} type="button">${statusLabel}</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    mount.querySelectorAll('[data-play-tournament]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tournament = tournaments.find((t) => t.id === btn.dataset.playTournament);
            playTournamentRound(mount, uid, profile, tournament, setActiveRound);
        });
    });
}

function shareTextForTournament(tournament, numPuzzles, score, puzzleMistakes) {
    const lines = puzzleMistakes.map((m, i) => `Puzzle ${i + 1} - ${mistakesLabel(m)}`).join('\n');
    return `🏆 Connections Tournament Complete!\n\nI completed ${tournament.name} 🎉\n\n🧩 Puzzles: ${numPuzzles}/${numPuzzles}\n⭐ Score: ${score.toLocaleString()} points\n\n${lines}\n\nThink you can beat my score? 👀\n\nJoin the tournament:\n${TOURNAMENTS_TAB_URL}`;
}

async function finishTournament(mount, uid, profile, tournament, numPuzzles, setActiveRound) {
    const result = await finalizeTournament(uid, profile, tournament);
    if (!result) {
        mount.innerHTML = `
            <div class="empty-state">You solved every puzzle, but saving your points failed &mdash; check the browser console for the error, then try again.</div>
            <div class="cx-tournament-actions">
                <button class="btn primary" id="cx-finalize-retry-btn" type="button">Try Again</button>
                <button class="btn" id="cx-back-btn" type="button">Back to Tournaments</button>
            </div>
        `;
        showToast("Couldn't save your tournament points");
        document.getElementById('cx-finalize-retry-btn').addEventListener('click', () => finishTournament(mount, uid, profile, tournament, numPuzzles, setActiveRound));
        document.getElementById('cx-back-btn').addEventListener('click', () => renderTournamentsMode(mount, uid, profile, setActiveRound));
        return;
    }

    const puzzleMistakes = result.puzzleMistakes || [];

    showConnectionsSummaryModal({
        title: 'Tournament complete!',
        subtitle: tournament.name,
        celebrate: true,
        breakdown: [
            { label: 'Starting the tournament', points: 30 },
            ...puzzleMistakes.map((m, i) => ({ label: `Puzzle ${i + 1}: solved with ${mistakesLabel(m)}`, points: 15 })),
            { label: 'Tournament bonus', points: tournament.bonusPoints || 0 },
        ],
        totalPoints: result.score,
        shareText: shareTextForTournament(tournament, numPuzzles, result.score, puzzleMistakes),
        communityUrl: FACEBOOK_GROUP_URL,
        shareLink: TOURNAMENTS_TAB_URL,
        onShareCommunity: () => markSharedToFacebook(uid, 'connections-tournament', tournament.id),
        onShareFriends: () => markSharedWithFriends(uid, 'connections-tournament', tournament.id),
        onClose: () => renderTournamentsMode(mount, uid, profile, setActiveRound),
    });
    showToast(`Tournament complete! +${result.score.toLocaleString()} points`);
}

async function playTournamentRound(mount, uid, profile, tournament, setActiveRound) {
    const attempt = await getOrStartAttempt(tournament.id, uid, profile);
    const numPuzzles = tournament.puzzles.length;

    if (attempt.completed) {
        mount.innerHTML = `<div class="empty-state">You already completed "${escapeHtml(tournament.name)}".</div>`;
        return;
    }

    if (attempt.currentPuzzleIndex >= numPuzzles) {
        // Every puzzle was already won on a prior run, but finalizing failed -- retry that instead.
        mount.innerHTML = `<div class="loading-text">Saving your points&hellip;</div>`;
        await finishTournament(mount, uid, profile, tournament, numPuzzles, setActiveRound);
        return;
    }

    const puzzleIndex = attempt.currentPuzzleIndex;

    mount.innerHTML = `
        <h2 class="cx-title">${escapeHtml(tournament.name)}</h2>
        <div id="cx-round-mount"></div>
    `;

    setActiveRound(playConnectionsRound({
        container: document.getElementById('cx-round-mount'),
        groups: tournament.puzzles[puzzleIndex].groups,
        maxMistakes: MAX_MISTAKES,
        timeLimitSeconds: tournament.timePerPuzzleSeconds,
        roundLabel: `Puzzle ${puzzleIndex + 1} of ${numPuzzles}`,
        onComplete: async ({ won, mistakes }) => {
            const updated = await recordPuzzleResult(tournament.id, uid, won, mistakes);

            if (!won) {
                mount.innerHTML = `
                    <div class="empty-state">
                        Puzzle ${puzzleIndex + 1} failed &mdash; progress reset. Try "${escapeHtml(tournament.name)}" again from puzzle 1 whenever you're ready.
                    </div>
                    <div class="cx-tournament-actions">
                        <button class="btn primary" id="cx-retry-btn" type="button">Retry from Puzzle 1</button>
                        <button class="btn" id="cx-back-btn" type="button">Back to Tournaments</button>
                    </div>
                `;
                document.getElementById('cx-retry-btn').addEventListener('click', () => playTournamentRound(mount, uid, profile, tournament, setActiveRound));
                document.getElementById('cx-back-btn').addEventListener('click', () => renderTournamentsMode(mount, uid, profile, setActiveRound));
                return;
            }

            if (updated.currentPuzzleIndex >= numPuzzles) {
                await finishTournament(mount, uid, profile, tournament, numPuzzles, setActiveRound);
            } else {
                showToast(`Puzzle ${puzzleIndex + 1} solved! On to the next one.`);
                playTournamentRound(mount, uid, profile, tournament, setActiveRound);
            }
        },
    }));
}

/* ------------------------------------- Page wiring ------------------------------------- */

function wireModeTabs(uid, profile, initialMode) {
    const tabs = Array.from(document.querySelectorAll('.cx-mode-tab'));
    const mount = document.getElementById('game-mount');
    let activeRound = null;
    const setActiveRound = (round) => { activeRound = round; };

    async function render(mode) {
        // Destroy first, so an abandoned round's timer/keydown listener can't fire on top of the next mode.
        activeRound?.destroy();
        activeRound = null;
        tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
        mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
        try {
            if (mode === 'daily') await renderDailyMode(mount, uid, profile, setActiveRound);
            else if (mode === 'classic') renderClassicMode(mount, uid, profile, setActiveRound);
            else await renderTournamentsMode(mount, uid, profile, setActiveRound);
        } catch (err) {
            renderLoadError(mount, err);
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

    const tab = getQueryParam('tab');
    const initialMode = tab === 'tournaments' ? 'tournaments' : tab === 'classic' ? 'classic' : 'daily';
    wireModeTabs(uid, profile, initialMode);
}

init();
