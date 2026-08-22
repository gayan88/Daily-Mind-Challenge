import { initShell } from '../../app.js';
import { icon } from '../../utils/icons.js';
import { showToast, escapeHtml, getQueryParam } from '../../utils/helpers.js';
import { checkPlayedToday } from '../../utils/points.js';
import { getConfig } from '../../utils/config.js';
import { playWordleRound } from './wordle-engine.js';
import { isRealWord } from './wordle-word-validation.js';
import { getTodayChallenge, recordDailyResult, markSharedToFacebook } from './wordle-daily-data.js';
import {
    listActiveTournaments, getAttempt, getOrStartAttempt, recordWordResult, finalizeTournament,
} from './wordle-tournament-data.js';
import {
    createWordleChallenge, getWordleChallenge, isWordleChallengeExpired,
    listPublicWordleChallengesPage, listMyWordleChallenges, listMyWordleChallengesPage,
    listWordleChallengeCompletionsPage, getWordleChallengeCompletion,
    getWordleChallengeSolveCount, getWordleChallengeAttemptCount,
    recordWordleChallengeCompletion, syncCreatorRewards,
} from './wordle-challenge-data.js';
import { showWordleSummaryModal } from './wordle-summary-modal.js';

const MAX_GUESSES = 6;
const SHARE_EMOJI = { correct: '🟩', present: '🟨', absent: '⬛' };

function renderAdminBlocked(mount) {
    mount.innerHTML = `<div class="empty-state">Admin accounts don't play games.</div>`;
}

function renderNoWordsSeeded(mount) {
    mount.innerHTML = `<div class="empty-state">Today's Wordle isn't ready yet &mdash; check back soon.</div>`;
}

function renderAlreadyPlayedDaily(mount, played) {
    const status = played.won ? `solved in ${played.attempts}/${MAX_GUESSES}` : 'not solved';
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already played today's Wordle #${played.challengeId} (${status}, +${played.score} points). Come back tomorrow for a new word!
        </div>
    `;
}

function shareTextFor(challengeId, guessStates, won) {
    const attemptsLabel = won ? `${guessStates.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
    const grid = guessStates.map((row) => row.map((state) => SHARE_EMOJI[state]).join('')).join('\n');
    return `Daily Mind Challenge Wordle #${challengeId} ${attemptsLabel}\n\n${grid}`;
}

async function renderDailyMode(mount, uid, profile) {
    const played = await checkPlayedToday(uid, 'wordle');
    if (played) {
        renderAlreadyPlayedDaily(mount, played);
        return;
    }

    const challenge = await getTodayChallenge();
    if (!challenge) {
        renderNoWordsSeeded(mount);
        return;
    }

    mount.innerHTML = `
        <h2 class="wordle-title">Daily Wordle #${challenge.challengeId}</h2>
        <p class="wordle-subtitle">Guess the 5-letter word in 6 tries. Everyone gets the same word today.</p>
        <div id="wordle-round-mount"></div>
    `;
    const roundMount = document.getElementById('wordle-round-mount');
    const startTime = Date.now();

    playWordleRound({
        container: roundMount,
        targetWord: challenge.word,
        maxGuesses: MAX_GUESSES,
        validateGuess: isRealWord,
        onComplete: async ({ won, attempts, guessStates }) => {
            const timeTakenSeconds = Math.round((Date.now() - startTime) / 1000);
            const result = await recordDailyResult(uid, profile, {
                challengeId: challenge.challengeId,
                won,
                attempts,
                timeTakenSeconds,
            });
            if (!result) return;

            showWordleSummaryModal({
                title: won ? 'You solved it!' : `The word was ${challenge.word}`,
                subtitle: `Daily Wordle #${challenge.challengeId}`,
                guessStates,
                breakdown: [
                    { label: 'Playing today', points: result.playPoints },
                    { label: 'Attempts bonus', points: result.attemptsPoints },
                    { label: 'Speed bonus', points: result.timePoints },
                ],
                totalPoints: result.score,
                shareText: shareTextFor(challenge.challengeId, guessStates, won),
                onShare: () => markSharedToFacebook(uid),
            });
            showToast(`+${result.score} points!`);
        },
    });
}

async function renderTournamentsMode(mount, uid, profile) {
    const tournaments = await listActiveTournaments();
    if (tournaments.length === 0) {
        mount.innerHTML = `<div class="empty-state">No tournaments running right now. Check back soon!</div>`;
        return;
    }

    const attempts = await Promise.all(tournaments.map((t) => getAttempt(t.id, uid)));

    mount.innerHTML = `
        <div class="wordle-tournament-list">
            ${tournaments.map((t, i) => {
                const attempt = attempts[i];
                const numWords = t.words.length;
                let statusLabel = 'Start';
                if (attempt?.completed) statusLabel = 'Completed';
                else if (attempt && attempt.currentWordIndex > 0) statusLabel = `Continue (word ${attempt.currentWordIndex + 1}/${numWords})`;

                return `
                    <div class="wordle-tournament-card">
                        <div class="wordle-tournament-name">${escapeHtml(t.name)}</div>
                        <div class="wordle-tournament-divider"></div>
                        <div class="wordle-tournament-footer">
                            <div class="wordle-tournament-meta-row">
                                <span class="wordle-tournament-meta-item">${icon('WORDS')} ${numWords} words</span>
                                <span class="wordle-tournament-sep">|</span>
                                <span class="wordle-tournament-meta-item">${icon('STOPWATCH')} ${t.timePerWordSeconds}s/word</span>
                                <span class="wordle-tournament-sep">|</span>
                                <span class="wordle-tournament-meta-item">${icon('STAR')} +${t.bonusPoints} bonus</span>
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
            playTournamentRound(mount, uid, profile, tournament);
        });
    });
}

async function finishTournament(mount, uid, profile, tournament, numWords) {
    const result = await finalizeTournament(uid, profile, tournament);
    if (!result) {
        mount.innerHTML = `
            <div class="empty-state">You solved every word, but saving your points failed &mdash; check the browser console for the error, then try again.</div>
            <div class="wordle-tournament-actions">
                <button class="btn primary" id="tournament-finalize-retry-btn" type="button">Try Again</button>
                <button class="btn" id="tournament-back-btn" type="button">Back to Tournaments</button>
            </div>
        `;
        showToast("Couldn't save your tournament points");
        document.getElementById('tournament-finalize-retry-btn').addEventListener('click', () => {
            finishTournament(mount, uid, profile, tournament, numWords);
        });
        document.getElementById('tournament-back-btn').addEventListener('click', () => {
            renderTournamentsMode(mount, uid, profile);
        });
        return;
    }

    showWordleSummaryModal({
        title: 'Tournament complete!',
        subtitle: tournament.name,
        breakdown: [
            { label: 'Starting the tournament', points: 30 },
            { label: `${numWords} words solved`, points: 15 * numWords },
            { label: 'Tournament bonus', points: tournament.bonusPoints || 0 },
        ],
        totalPoints: result.score,
        onClose: () => renderTournamentsMode(mount, uid, profile),
    });
    showToast(`Tournament complete! +${result.score} points`);
}

async function playTournamentRound(mount, uid, profile, tournament) {
    const attempt = await getOrStartAttempt(tournament.id, uid, profile);
    const numWords = tournament.words.length;

    if (attempt.completed) {
        mount.innerHTML = `<div class="empty-state">You already completed "${escapeHtml(tournament.name)}".</div>`;
        return;
    }

    if (attempt.currentWordIndex >= numWords) {
        // Every word was already won on a prior run, but finalizing (saving points) failed --
        // retry that instead of trying to play a word index that doesn't exist.
        mount.innerHTML = `<div class="loading-text">Saving your points&hellip;</div>`;
        await finishTournament(mount, uid, profile, tournament, numWords);
        return;
    }

    const wordIndex = attempt.currentWordIndex;
    const word = tournament.words[wordIndex];

    mount.innerHTML = `
        <h2 class="wordle-title">${escapeHtml(tournament.name)}</h2>
        <div id="wordle-round-mount"></div>
    `;
    const roundMount = document.getElementById('wordle-round-mount');

    playWordleRound({
        container: roundMount,
        targetWord: word,
        maxGuesses: MAX_GUESSES,
        timeLimitSeconds: tournament.timePerWordSeconds,
        roundLabel: `Word ${wordIndex + 1} of ${numWords}`,
        validateGuess: isRealWord,
        onComplete: async ({ won }) => {
            const updated = await recordWordResult(tournament.id, uid, won);

            if (!won) {
                mount.innerHTML = `
                    <div class="empty-state">
                        Word ${wordIndex + 1} failed &mdash; progress reset. Try "${escapeHtml(tournament.name)}" again from word 1 whenever you're ready.
                    </div>
                    <div class="wordle-tournament-actions">
                        <button class="btn primary" id="tournament-retry-btn" type="button">Retry from Word 1</button>
                        <button class="btn" id="tournament-back-btn" type="button">Back to Tournaments</button>
                    </div>
                `;
                document.getElementById('tournament-retry-btn').addEventListener('click', () => {
                    playTournamentRound(mount, uid, profile, tournament);
                });
                document.getElementById('tournament-back-btn').addEventListener('click', () => {
                    renderTournamentsMode(mount, uid, profile);
                });
                return;
            }

            if (updated.currentWordIndex >= numWords) {
                await finishTournament(mount, uid, profile, tournament, numWords);
            } else {
                showToast(`Word ${wordIndex + 1} solved! On to the next one.`);
                playTournamentRound(mount, uid, profile, tournament);
            }
        },
    });
}

function shareLinkForChallenge(challengeId) {
    const url = new URL(window.location.href);
    url.search = `?challenge=${encodeURIComponent(challengeId)}`;
    return url.toString();
}

function challengeTitle(c) {
    return c.challengeNumber ? `${c.creatorDisplayName}'s Challenge #${c.challengeNumber}` : `${c.creatorDisplayName}'s Challenge`;
}

function solveCountLabel(count) {
    if (count === 0) return 'No one has solved it yet';
    if (count === 1) return '1 person solved it';
    return `${count} people solved it`;
}

const CHALLENGE_SHARE_MESSAGE = 'Daily Mind Challenge: I created a Wordle just for you! Can you crack it in 6 attempts?';

function wireCopyLink(btn, link) {
    btn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(`${CHALLENGE_SHARE_MESSAGE}\n${link}`);
            showToast('Link copied!');
        } catch {
            showToast('Copy failed — select and copy manually');
        }
    });
}

async function renderChallengeCreate(container, profile) {
    if (profile.kind !== 'registered') {
        container.innerHTML = `<div class="empty-state">Sign up for an account to create a challenge. Guests can still solve and browse them!</div>`;
        return;
    }

    container.innerHTML = `
        <div class="form-field">
            <label for="wc-word-input">5-letter word</label>
            <input type="text" id="wc-word-input" maxlength="5" placeholder="e.g. BRAVE">
        </div>
        <div class="wc-visibility-row">
            <label><input type="radio" name="wc-visibility" value="public" checked> Public &mdash; anyone can browse &amp; solve it</label>
            <label><input type="radio" name="wc-visibility" value="private"> Private &mdash; link only</label>
        </div>
        <button class="btn primary" id="wc-create-btn" type="button">Create Challenge</button>
        <div id="wc-share-result"></div>
    `;

    document.getElementById('wc-create-btn').addEventListener('click', async () => {
        const word = document.getElementById('wc-word-input').value.trim();
        if (!/^[A-Za-z]{5}$/.test(word)) {
            showToast('Enter a 5-letter word');
            return;
        }
        const visibility = document.querySelector('input[name="wc-visibility"]:checked').value;

        try {
            const id = await createWordleChallenge(profile, word, visibility);
            const link = shareLinkForChallenge(id);
            document.getElementById('wc-share-result').innerHTML = `
                <div class="share-box">
                    <input type="text" readonly value="${escapeHtml(link)}" id="wc-share-link-input">
                    <button class="btn primary wc-copy-btn" id="wc-copy-link-btn" type="button" aria-label="Copy link" title="Copy link">${icon('CLIPBOARD')}</button>
                </div>
            `;
            wireCopyLink(document.getElementById('wc-copy-link-btn'), link);
            showToast('Challenge created!');
        } catch (err) {
            showToast(err.message);
        }
    });
}

function renderBrowseCard(c, solveCount) {
    return `
        <div class="challenge-card">
            <div class="challenge-info">
                <div class="challenge-name">${escapeHtml(challengeTitle(c))}</div>
                <div class="challenge-meta">${solveCountLabel(solveCount)}</div>
            </div>
            <a href="/wordle?challenge=${encodeURIComponent(c.id)}" class="challenge-btn">Solve</a>
        </div>
    `;
}

async function renderChallengeBrowse(container, uid) {
    const { size: pageSize } = await getConfig('browseChallengesPageSize');

    container.innerHTML = `<div class="wc-browse-list" id="wc-browse-list"></div>`;
    const listEl = document.getElementById('wc-browse-list');
    let cursor = null;
    let shownAny = false;

    async function loadPage() {
        // A raw page can come back entirely filtered out (all the viewer's own challenges, or
        // all expired) -- keep fetching silently rather than showing an empty "Load More" screen
        // with nothing on it and no explanation.
        let open = [];
        let hasMore = true;
        while (open.length === 0 && hasMore) {
            const page = await listPublicWordleChallengesPage(pageSize, cursor);
            cursor = page.lastDoc;
            hasMore = page.hasMore;
            open = page.challenges.filter((c) => c.creatorUid !== uid);
        }

        if (open.length > 0) {
            shownAny = true;
            const solveCounts = await Promise.all(open.map((c) => getWordleChallengeSolveCount(c.id)));
            open.forEach((c, i) => {
                listEl.insertAdjacentHTML('beforeend', renderBrowseCard(c, solveCounts[i]));
            });
        }

        document.getElementById('wc-browse-load-more')?.remove();
        if (hasMore) {
            listEl.insertAdjacentHTML(
                'afterend',
                `<button class="btn wc-load-more" id="wc-browse-load-more" type="button">Load More</button>`
            );
            document.getElementById('wc-browse-load-more').addEventListener('click', loadPage);
        } else if (!shownAny) {
            container.innerHTML = `<div class="empty-state">No public challenges right now. Create one to get started!</div>`;
        }
    }

    await loadPage();
}

function formatChallengeDate(c) {
    const date = c.createdAt?.toDate ? c.createdAt.toDate() : null;
    return date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function renderMineCardCompact(c, attemptCount) {
    const dateLabel = formatChallengeDate(c);
    return `
        <div class="wc-mine-item" data-mine-item="${c.id}">
            <div class="challenge-card wc-mine-summary-card">
                <div class="challenge-info">
                    <div class="wc-mine-title">${c.challengeNumber ? `#${c.challengeNumber} &bull; ` : ''}${escapeHtml(c.word)}</div>
                    <div class="wc-mine-meta-row">
                        ${dateLabel ? `<span class="wc-mine-meta">${icon('CALENDAR')} ${dateLabel}</span>` : ''}
                        <span class="wc-mine-meta">${icon('PEOPLE')} ${attemptCount} Attempt${attemptCount === 1 ? '' : 's'}</span>
                        <span class="wc-mine-meta">${icon('GLOBE')} ${c.visibility === 'public' ? 'Public' : 'Private'}</span>
                        ${isWordleChallengeExpired(c) ? '<span class="wc-mine-meta wc-expired">Expired</span>' : ''}
                    </div>
                </div>
                <button class="btn wc-more-info-btn" data-more-info type="button">More Info</button>
            </div>
            <div class="wc-mine-detail" id="wc-mine-detail-${c.id}" hidden></div>
        </div>
    `;
}

function renderDetailShell(c) {
    const link = shareLinkForChallenge(c.id);
    return `
        <div class="wc-detail-header">
            <div class="wc-mine-title">${c.challengeNumber ? `#${c.challengeNumber} &bull; ` : ''}${escapeHtml(c.word)}</div>
            <button class="wc-detail-close" data-close-detail type="button" aria-label="Close">&times;</button>
        </div>
        <div class="share-box">
            <input type="text" readonly value="${escapeHtml(link)}">
            <button class="btn wc-copy-btn" data-copy-mine type="button" aria-label="Copy link" title="Copy link">${icon('CLIPBOARD')}</button>
        </div>
        <div class="wc-attempts-title">Attempts</div>
        <div class="wc-attempts-table" id="wc-attempts-table-${c.id}"></div>
    `;
}

function renderAttemptRow(comp, index) {
    return `
        <div class="wc-attempt-row">
            <span class="wc-attempt-index">${index}</span>
            <span class="wc-attempt-user">${escapeHtml(comp.displayName)}</span>
            <span class="wc-attempt-count">${comp.attempts}/${MAX_GUESSES}</span>
            <span class="wc-attempt-result ${comp.won ? 'solved' : 'failed'}">${comp.won ? 'Solved' : 'Failed'}</span>
        </div>
    `;
}

/**
 * Wires one card's "More Info" toggle. The attempts list is lazy: nothing is fetched until the
 * card is expanded for the first time (avoids fetching completions for all 40-50 cards up front
 * just to render a compact summary), and from there it's paginated with its own "Load More"
 * (`config/challengeAttemptsPageSize.size` at a time). Re-opening after collapsing doesn't
 * re-fetch -- `loaded` just toggles `hidden`.
 */
function wireMineDetailToggle(itemEl, c, attemptsPageSize) {
    const btn = itemEl.querySelector('[data-more-info]');
    const detailEl = itemEl.querySelector('.wc-mine-detail');
    let loaded = false;
    let cursor = null;
    let rowIndex = 0;

    async function loadAttemptsPage() {
        const tableEl = document.getElementById(`wc-attempts-table-${c.id}`);
        const { completions, lastDoc, hasMore } = await listWordleChallengeCompletionsPage(c.id, attemptsPageSize, cursor);
        cursor = lastDoc;

        if (rowIndex === 0 && completions.length === 0) {
            tableEl.innerHTML = `<div class="wc-no-completions">No one has attempted this yet.</div>`;
            return;
        }
        if (rowIndex === 0) {
            tableEl.insertAdjacentHTML('beforeend', `
                <div class="wc-attempt-row wc-attempt-header">
                    <span>#</span><span>User</span><span>Attempts</span><span>Result</span>
                </div>
            `);
        }

        document.getElementById(`wc-attempts-load-more-${c.id}`)?.remove();
        completions.forEach((comp) => {
            rowIndex += 1;
            tableEl.insertAdjacentHTML('beforeend', renderAttemptRow(comp, rowIndex));
        });

        if (hasMore) {
            tableEl.insertAdjacentHTML(
                'afterend',
                `<button class="btn wc-load-more" id="wc-attempts-load-more-${c.id}" type="button">Load More</button>`
            );
            document.getElementById(`wc-attempts-load-more-${c.id}`).addEventListener('click', loadAttemptsPage);
        }
    }

    btn.addEventListener('click', async () => {
        if (!loaded) {
            loaded = true;
            detailEl.innerHTML = renderDetailShell(c);
            wireCopyLink(detailEl.querySelector('[data-copy-mine]'), shareLinkForChallenge(c.id));
            detailEl.querySelector('[data-close-detail]').addEventListener('click', () => {
                detailEl.hidden = true;
            });
            detailEl.hidden = false;
            await loadAttemptsPage();
            return;
        }
        detailEl.hidden = !detailEl.hidden;
    });
}

/**
 * "My Challenges": paginated for display (see listMyWordleChallengesPage()'s doc comment), but
 * the reward sync below always scans the creator's FULL challenge list regardless of pagination
 * -- otherwise completions on challenges past the first page would sit uncredited until the
 * creator happened to click "Load More" far enough to reach them.
 */
async function renderChallengeMine(container, uid, profile) {
    const allMine = await listMyWordleChallenges(uid);
    if (allMine.length === 0) {
        container.innerHTML = `<div class="empty-state">You haven't created any challenges yet.</div>`;
        return;
    }

    const newlyAwarded = await syncCreatorRewards(uid, profile, allMine);
    if (newlyAwarded > 0) showToast(`+${newlyAwarded} points from friends completing your challenges!`);

    const [{ size: pageSize }, { size: attemptsPageSize }] = await Promise.all([
        getConfig('myChallengesPageSize'),
        getConfig('challengeAttemptsPageSize'),
    ]);

    container.innerHTML = `<div class="wc-mine-list" id="wc-mine-list"></div>`;
    const listEl = document.getElementById('wc-mine-list');
    let cursor = null;

    async function loadPage() {
        const { challenges, lastDoc, hasMore } = await listMyWordleChallengesPage(uid, pageSize, cursor);
        cursor = lastDoc;

        const attemptCounts = await Promise.all(challenges.map((c) => getWordleChallengeAttemptCount(c.id)));

        challenges.forEach((c, i) => {
            listEl.insertAdjacentHTML('beforeend', renderMineCardCompact(c, attemptCounts[i]));
            const itemEl = listEl.querySelector(`[data-mine-item="${c.id}"]`);
            wireMineDetailToggle(itemEl, c, attemptsPageSize);
        });

        document.getElementById('wc-mine-load-more')?.remove();
        if (hasMore) {
            listEl.insertAdjacentHTML(
                'afterend',
                `<button class="btn wc-load-more" id="wc-mine-load-more" type="button">Load More</button>`
            );
            document.getElementById('wc-mine-load-more').addEventListener('click', loadPage);
        }
    }

    await loadPage();
}

async function renderChallengeSolve(mount, uid, profile, challengeId) {
    const challenge = await getWordleChallenge(challengeId);
    if (!challenge) {
        mount.innerHTML = `<div class="empty-state">This challenge doesn't exist or was removed.</div>`;
        return;
    }
    if (isWordleChallengeExpired(challenge)) {
        mount.innerHTML = `<div class="empty-state">This challenge has expired.</div>`;
        return;
    }
    if (challenge.creatorUid === uid) {
        mount.innerHTML = `<div class="empty-state">This is your own challenge &mdash; share the link with a friend so they can solve it! Check "My Challenges" to see who's completed it.</div>`;
        return;
    }

    const existing = await getWordleChallengeCompletion(challengeId, uid);
    if (existing) {
        const status = existing.won ? `solved it in ${existing.attempts} ${existing.attempts === 1 ? 'try' : 'tries'}` : 'did not solve it';
        mount.innerHTML = `<div class="empty-state">${icon('CHECK')} You already attempted this challenge and ${status}.</div>`;
        return;
    }

    mount.innerHTML = `
        <h2 class="wordle-title">${escapeHtml(challengeTitle(challenge))}</h2>
        <p class="wordle-subtitle">Guess the ${challenge.word.length}-letter word in 6 tries.</p>
        <div id="wordle-round-mount"></div>
    `;
    const roundMount = document.getElementById('wordle-round-mount');
    const startTime = Date.now();

    playWordleRound({
        container: roundMount,
        targetWord: challenge.word,
        maxGuesses: MAX_GUESSES,
        validateGuess: isRealWord,
        onComplete: async ({ won, attempts, guessStates }) => {
            const timeTakenSeconds = Math.round((Date.now() - startTime) / 1000);
            const result = await recordWordleChallengeCompletion(challengeId, uid, profile, { won, attempts, timeTakenSeconds });
            if (!result) {
                showToast("Couldn't save your points -- check the browser console for the error");
                return;
            }

            showWordleSummaryModal({
                title: won ? 'Challenge solved!' : `The word was ${challenge.word}`,
                subtitle: challengeTitle(challenge),
                guessStates,
                breakdown: [
                    { label: 'Attempting the challenge', points: 10 },
                    { label: 'Solved it', points: won ? 20 : 0 },
                ],
                totalPoints: result.score,
            });
            showToast(`+${result.score} points!`);
        },
    });
}

async function renderChallengeMode(mount, uid, profile, deepLinkChallengeId) {
    if (deepLinkChallengeId) {
        mount.innerHTML = `<div id="wc-solve-mount"></div>`;
        await renderChallengeSolve(document.getElementById('wc-solve-mount'), uid, profile, deepLinkChallengeId);
        return;
    }

    mount.innerHTML = `
        <div class="wc-subtabs">
            <button class="wc-subtab active" data-subtab="browse" type="button">Browse</button>
            <button class="wc-subtab" data-subtab="create" type="button">Create</button>
            <button class="wc-subtab" data-subtab="mine" type="button">My Challenges</button>
        </div>
        <div id="wc-subtab-content"></div>
    `;

    const subtabs = Array.from(mount.querySelectorAll('.wc-subtab'));
    const content = document.getElementById('wc-subtab-content');

    async function renderSub(name) {
        subtabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.subtab === name));
        content.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
        try {
            if (name === 'browse') await renderChallengeBrowse(content, uid);
            else if (name === 'create') await renderChallengeCreate(content, profile);
            else await renderChallengeMine(content, uid, profile);
        } catch (err) {
            console.error(err);
            content.innerHTML = `<div class="empty-state">Something went wrong loading this &mdash; check the browser console for details (often a Firestore rules/index that hasn't been deployed yet).</div>`;
        }
    }

    subtabs.forEach((btn) => btn.addEventListener('click', () => renderSub(btn.dataset.subtab)));
    renderSub('browse');
}

function wireModeTabs(uid, profile, initialMode, deepLinkChallengeId) {
    const tabs = Array.from(document.querySelectorAll('.wordle-mode-tab'));
    const mount = document.getElementById('game-mount');
    let pendingDeepLink = deepLinkChallengeId;

    async function render(mode) {
        tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
        mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
        if (mode === 'daily') {
            await renderDailyMode(mount, uid, profile);
        } else if (mode === 'tournaments') {
            await renderTournamentsMode(mount, uid, profile);
        } else {
            await renderChallengeMode(mount, uid, profile, pendingDeepLink);
            pendingDeepLink = null;
        }
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => render(tab.dataset.mode)));
    render(initialMode);
}

async function init() {
    const { uid, profile } = await initShell();
    const mount = document.getElementById('game-mount');

    if (profile.isAdmin) {
        renderAdminBlocked(mount);
        return;
    }

    const deepLinkChallengeId = getQueryParam('challenge');
    wireModeTabs(uid, profile, deepLinkChallengeId ? 'challenges' : 'daily', deepLinkChallengeId);
}

init();
