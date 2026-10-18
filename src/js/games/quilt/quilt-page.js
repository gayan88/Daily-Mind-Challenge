import { trySession, showLoggedOutHeader } from '../../app.js';
import { icon } from '../../utils/icons.js';
import { getTodayDateString, showToast, escapeHtml, getQueryParam, formatDuration } from '../../utils/helpers.js';
import { getConfig } from '../../utils/config.js';
import { checkPlayedToday, checkPlayedTodayAll, markSharedToFacebook, markSharedWithFriends } from '../../utils/points.js';
import { awardDailyCompletionXp } from '../../progression/xp-service.js';
import { advanceStreakForDailyCompletion } from '../../progression/streak-service.js';
import { trackGameCompleted } from '../../utils/meta-pixel.js';
import { playQuiltRound } from './quilt-engine.js';
import { getTodayChallenge, recordDailyResult } from './quilt-daily-data.js';
import { getClassicPuzzle, recordClassicResult } from './quilt-classic-data.js';
import { classicPoints, TOURNAMENT_TILE_PASS_POINTS, TOURNAMENT_TILE_FAIL_POINTS } from './quilt-scoring.js';
import {
    listActiveQuiltTournaments, getAttempt, getOrStartAttempt, recordTileResult,
    completeTournamentIfNeeded, completionBonusFor,
    markSharedToFacebook as markRunSharedToFacebook,
    markSharedWithFriends as markRunSharedWithFriends,
} from './quilt-tournament-data.js';
import { DIFFICULTIES } from './quilt-generator.js';
import { pictureToEmojiRows } from './quilt-picture.js';
import { showQuiltSummaryModal, quiltPictureHtml } from './quilt-summary-modal.js';

const FACEBOOK_GROUP_URL = 'https://www.facebook.com/groups/playdailymindchallenge';
const CLASSIC_TAB_URL = `${window.location.origin}/quilt?tab=classic`;
const TOURNAMENT_TAB_URL = `${window.location.origin}/quilt?tab=tournament`;
const DIFFICULTY_BLURB = {
    easy: 'A quick, relaxed stitch.',
    medium: 'The Daily size.',
    hard: 'Bigger board, with knots and shape clues.',
};

// Outlined line icons for the points breakdown (same set as sudoku-page.js).
const ICON_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
const ICON_STOPWATCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="9" y1="2.5" x2="15" y2="2.5"/></svg>`;
const ICON_BONUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const ICON_CHECK_SM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_TILES = `<svg class="quilt-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
const ICON_CLOCK = `<svg class="quilt-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/></svg>`;
const ICON_STAR = `<svg class="quilt-tournament-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const ICON_SPARKLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>`;

const HOW_TO = 'Drag from corner to corner to draw rectangles. Each rectangle needs exactly one number, equal to its area. Cover the whole grid to reveal the picture.';

function renderAdminBlocked(mount) {
    mount.innerHTML = `<div class="empty-state">Admin accounts don't play games.</div>`;
}

/** Shown instead of the game when there's no session, so `/quilt` stays a real, crawlable page
 * (same reasoning as sudoku-page.js#renderSignInPrompt). */
function renderSignInPrompt(mount) {
    const redirectTo = encodeURIComponent(window.location.pathname + window.location.search);
    mount.innerHTML = `
        <div class="empty-state">
            Sign in or continue as a guest to play today's Quilt.
            <br><br>
            <a class="btn primary" href="/?redirect=${redirectTo}">Sign In to Play</a>
        </div>
    `;
}

function renderNoPuzzlesSeeded(mount) {
    mount.innerHTML = `<div class="empty-state">Today's Quilt isn't ready yet &mdash; check back soon.</div>`;
}

/** Already solved today: show the picture they revealed (no spoiler -- they've seen it). */
async function renderAlreadyPlayedDaily(mount, played) {
    mount.innerHTML = `
        <div class="empty-state">
            ${icon('CHECK')} You already completed today's Quilt #${played.challengeId}${played.title ? ` &mdash; &ldquo;${escapeHtml(played.title)}&rdquo;` : ''} (+${played.score.toLocaleString()} points). Come back tomorrow for a new picture!
        </div>
        <div id="quilt-played-picture"></div>
    `;
    const challenge = await getTodayChallenge().catch(() => null);
    const holder = mount.querySelector('#quilt-played-picture');
    if (!challenge || !holder) return;
    holder.innerHTML = quiltPictureHtml(challenge.puzzle, "Today's finished quilt");
}

/** Daily share text: stats only, never the picture -- it would spoil the puzzle for friends. */
function shareTextForDaily(challengeId, timeTaken, perfect, score) {
    return `🧵 Daily Mind Challenge\n\n🧩 Daily Quilt #${challengeId}\n🎉 Solved in ${timeTaken}${perfect ? ' · Perfect Stitch ✨' : ''}\n⭐ Score: ${score.toLocaleString()} points\n\nCan you reveal today's picture? 👀\n\nPlay today's challenge:\n${window.location.origin}/quilt`;
}

/** Classic share text: the picture as an emoji mosaic is fine here -- there's no shared daily
 * picture to spoil, and it's the most eye-catching part of the post. */
function shareTextForClassic(difficulty, puzzle, timeTaken, perfect, score) {
    const mosaic = pictureToEmojiRows(puzzle).join('\n');
    return `🧵 Daily Mind Challenge\n\nClassic Quilt — ${DIFFICULTIES[difficulty].label}${puzzle.title ? `\n“${puzzle.title}”` : ''}\n${mosaic}\n🎉 Solved in ${timeTaken}${perfect ? ' · Perfect Stitch ✨' : ''}\n⭐ Score: ${score.toLocaleString()} points\n\nCan you stitch it faster? 👀\n\nPlay here:\n${CLASSIC_TAB_URL}`;
}

async function renderDailyMode(mount, uid, profile, setActiveRound) {
    const played = await checkPlayedToday(uid, 'quilt');
    if (played) {
        await renderAlreadyPlayedDaily(mount, played);
        return;
    }

    const challenge = await getTodayChallenge();
    if (!challenge) {
        renderNoPuzzlesSeeded(mount);
        return;
    }

    mount.innerHTML = `
        <h2 class="quilt-title">Daily Quilt #${challenge.challengeId}</h2>
        <p class="quilt-subtitle">${HOW_TO}</p>
        <div id="quilt-round-mount"></div>
    `;
    const roundMount = document.getElementById('quilt-round-mount');

    setActiveRound(playQuiltRound({
        container: roundMount,
        puzzle: challenge.puzzle,
        onComplete: async ({ timeTakenSeconds, perfect, undos, removals }) => {
            setActiveRound(null);
            const result = await recordDailyResult(uid, profile, {
                challengeId: challenge.challengeId,
                title: challenge.puzzle.title,
                timeTakenSeconds,
                perfect,
                undos,
                removals,
            });
            if (!result) return;
            trackGameCompleted('quilt');

            // Progression XP + streak for registered players, checked after the write so it
            // includes this completion (same as sudoku-page.js).
            if (profile.kind === 'registered') {
                const playedToday = await checkPlayedTodayAll(uid);
                const allDone = Object.values(playedToday).every(Boolean);
                const allWon = Object.values(playedToday).every((d) => d?.won === true);
                await awardDailyCompletionXp(uid, allDone, allWon);
                await advanceStreakForDailyCompletion(uid);
            }

            showQuiltSummaryModal({
                title: challenge.puzzle.title ? `“${challenge.puzzle.title}”` : 'Solved!',
                subtitle: `Daily Quilt #${challenge.challengeId} · ${result.timeTaken}`,
                picture: challenge.puzzle,
                perfect,
                breakdown: [
                    { label: 'Completing the quilt', points: result.completionPoints, icon: ICON_GRID },
                    { label: 'Speed bonus', points: result.timeBonusPoints, icon: ICON_STOPWATCH },
                    { label: 'Perfect Stitch', points: result.perfectBonusPoints, icon: ICON_SPARKLE },
                ],
                totalPoints: result.score,
                shareText: shareTextForDaily(challenge.challengeId, result.timeTaken, perfect, result.score),
                communityUrl: FACEBOOK_GROUP_URL,
                shareLink: `${window.location.origin}/quilt`,
                onShareCommunity: () => markSharedToFacebook(uid, 'quilt', getTodayDateString()),
                onShareFriends: () => markSharedWithFriends(uid, 'quilt', getTodayDateString()),
            });
            showToast(`+${result.score.toLocaleString()} points!`);
        },
    }));
}

function renderDifficultyPicker(mount, onPick) {
    mount.innerHTML = `
        <h2 class="quilt-title">Classic Quilt</h2>
        <p class="quilt-subtitle">Pick a size for a new picture. Play as many as you like &mdash; pictures you haven't solved come first.</p>
        <div class="quilt-difficulty-picker">
            ${Object.entries(DIFFICULTIES).map(([difficulty, d]) => `
                <button class="quilt-difficulty-btn" data-difficulty="${difficulty}" type="button">
                    <span class="quilt-difficulty-text">
                        <span class="quilt-difficulty-name">${d.label} &middot; ${d.size}&times;${d.size}</span>
                        <span class="quilt-difficulty-blurb">${DIFFICULTY_BLURB[difficulty]}</span>
                    </span>
                    <span class="quilt-difficulty-points">up to ${classicPoints({ timeTakenSeconds: 0, perfect: true, difficulty }).score} pts</span>
                </button>
            `).join('')}
        </div>
    `;
    mount.querySelectorAll('[data-difficulty]').forEach((btn) => {
        btn.addEventListener('click', () => onPick(btn.dataset.difficulty));
    });
}

async function playClassicRound(mount, uid, profile, difficulty, setActiveRound, lastPuzzleId = null) {
    mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
    const data = await getClassicPuzzle(uid, difficulty, lastPuzzleId);
    if (!data) {
        mount.innerHTML = `
            <div class="empty-state">No ${DIFFICULTIES[difficulty].label.toLowerCase()} quilts are ready yet &mdash; check back soon.</div>
            <div class="quilt-tournament-actions"><button class="btn" id="quilt-classic-back-btn" type="button">Choose another size</button></div>
        `;
        document.getElementById('quilt-classic-back-btn').addEventListener('click', () => renderClassicMode(mount, uid, profile, setActiveRound));
        return;
    }
    const { puzzle, puzzleId } = data;
    const label = DIFFICULTIES[difficulty].label;

    mount.innerHTML = `
        <h2 class="quilt-title">Classic Quilt &mdash; ${label}</h2>
        <p class="quilt-subtitle">${HOW_TO}${puzzle.blockers.length || puzzle.clues.some((c) => c.shape) ? ' Knots can\'t be covered; a framed number must be a square (box) or a single row/column (pill).' : ''}</p>
        <div id="quilt-round-mount"></div>
    `;
    const roundMount = document.getElementById('quilt-round-mount');
    const playAgain = () => playClassicRound(mount, uid, profile, difficulty, setActiveRound, puzzleId);

    setActiveRound(playQuiltRound({
        container: roundMount,
        puzzle,
        onComplete: async ({ timeTakenSeconds, perfect, undos, removals }) => {
            setActiveRound(null);
            const result = await recordClassicResult(uid, profile, { puzzleId, difficulty, title: puzzle.title, timeTakenSeconds, perfect, undos, removals });
            if (!result) {
                showToast("Couldn't save this result -- check the browser console");
                return;
            }
            trackGameCompleted('quilt-classic');

            showQuiltSummaryModal({
                title: puzzle.title ? `“${puzzle.title}”` : 'Solved!',
                subtitle: `Classic Quilt — ${label} · ${result.timeTaken}`,
                picture: puzzle,
                perfect,
                breakdown: [
                    { label: 'Completing the quilt', points: result.completionPoints, icon: ICON_GRID },
                    { label: 'Speed bonus', points: result.timeBonusPoints, icon: ICON_STOPWATCH },
                    { label: 'Perfect Stitch', points: result.perfectBonusPoints, icon: ICON_SPARKLE },
                ],
                totalPoints: result.score,
                shareText: shareTextForClassic(difficulty, puzzle, result.timeTaken, perfect, result.score),
                communityUrl: FACEBOOK_GROUP_URL,
                shareLink: CLASSIC_TAB_URL,
                onShareCommunity: () => markSharedToFacebook(uid, 'quilt-classic', result.gameDate),
                onShareFriends: () => markSharedWithFriends(uid, 'quilt-classic', result.gameDate),
                onClose: () => {
                    mount.innerHTML = `
                        <div class="empty-state">${icon('CHECK')} ${escapeHtml(puzzle.title || 'Quilt')} complete (+${result.score.toLocaleString()} points).</div>
                        <div class="quilt-tournament-actions">
                            <button class="btn primary" id="quilt-classic-again-btn" type="button">Next ${label} Quilt</button>
                            <button class="btn" id="quilt-classic-back-btn" type="button">Choose another size</button>
                        </div>
                    `;
                    document.getElementById('quilt-classic-again-btn').addEventListener('click', playAgain);
                    document.getElementById('quilt-classic-back-btn').addEventListener('click', () => renderClassicMode(mount, uid, profile, setActiveRound));
                },
            });
            showToast(`+${result.score.toLocaleString()} points!`);
        },
    }));
}

function renderClassicMode(mount, uid, profile, setActiveRound) {
    renderDifficultyPicker(mount, (difficulty) => playClassicRound(mount, uid, profile, difficulty, setActiveRound));
}

// ---------- Patchwork Run (Tournament) ----------

function tileRegion(tournament, i) {
    const tile = tournament.tiles[i];
    return { x: tile.tileX, y: tile.tileY, w: tile.width, h: tile.height };
}

/**
 * The run's big picture with each tile in its state: solved tiles in colour, timed-out tiles grey,
 * the current tile highlighted and later tiles covered (so the picture stays hidden until earned).
 */
function mosaicHtml(tournament, results, currentIndex = -1) {
    const greyRegions = results.map((r, i) => (r.passed ? null : tileRegion(tournament, i))).filter(Boolean);
    const covers = tournament.tiles.map((_, i) => {
        if (i < results.length) return '';
        const r = tileRegion(tournament, i);
        const state = i === currentIndex ? 'current' : 'locked';
        return `<span class="quilt-mosaic-tile quilt-mosaic-${state}" style="left:${(r.x / tournament.width) * 100}%; top:${(r.y / tournament.height) * 100}%; width:${(r.w / tournament.width) * 100}%; height:${(r.h / tournament.height) * 100}%;">${i + 1}</span>`;
    }).join('');
    return `<div class="quilt-mosaic">${quiltPictureHtml({ palette: tournament.palette, pixels: tournament.pixels, greyRegions }, 'Patchwork Run progress')}${covers}</div>`;
}

function formatLimit(seconds) {
    return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds} sec`;
}

function tileRunTotal(results) {
    return results.reduce((sum, r) => sum + (r.passed ? TOURNAMENT_TILE_PASS_POINTS : TOURNAMENT_TILE_FAIL_POINTS), 0);
}

function shareTextForRun(tournament, results, score) {
    const mosaic = pictureToEmojiRows(tournament).join('\n');
    const tiles = results.map((r) => (r.passed ? '✅' : '❌')).join('');
    return `🏆 Patchwork Run Complete!\n\nI stitched “${tournament.name}” 🧵\n${mosaic}\nTiles: ${tiles}\n⭐ Score: ${score.toLocaleString()} points\n\nThink you can beat my score? 👀\n\nJoin the run:\n${TOURNAMENT_TAB_URL}`;
}

async function renderTournamentMode(mount, uid, profile, setActiveRound) {
    const [tournaments, settings] = await Promise.all([listActiveQuiltTournaments(), getConfig('quiltTournamentSettings')]);
    if (tournaments.length === 0) {
        mount.innerHTML = `<div class="empty-state">No Patchwork Runs right now. Check back soon!</div>`;
        return;
    }
    const attempts = await Promise.all(tournaments.map((t) => getAttempt(t.id, uid)));

    mount.innerHTML = `
        <h2 class="quilt-title">Patchwork Run</h2>
        <p class="quilt-subtitle">Each run is one big picture cut into tiles. Solve each tile against the clock &mdash; a tile that runs out of time still counts, but stays grey in your finished quilt.</p>
        <div class="quilt-tournament-list">
            ${tournaments.map((t, i) => {
                const attempt = attempts[i];
                const n = t.tiles.length;
                let statusLabel = 'Start';
                if (attempt?.completed) statusLabel = 'Completed';
                else if (attempt && attempt.currentPuzzleIndex > 0) statusLabel = `Continue (tile ${Math.min(attempt.currentPuzzleIndex + 1, n)}/${n})`;
                return `
                    <div class="quilt-tournament-card">
                        <div class="quilt-tournament-info">
                            <div class="quilt-tournament-name">${escapeHtml(t.name)}</div>
                            <div class="quilt-tournament-meta-row">
                                <span class="quilt-tournament-meta-item">${ICON_TILES} ${n} Tiles</span>
                                <span class="quilt-tournament-sep">|</span>
                                <span class="quilt-tournament-meta-item">${ICON_CLOCK} ${formatLimit(settings.timeLimitSeconds)} each</span>
                                <span class="quilt-tournament-sep">|</span>
                                <span class="quilt-tournament-meta-item">${ICON_STAR} +${t.completionBonus} Bonus</span>
                            </div>
                        </div>
                        <button class="btn primary" data-play-quilt-run="${t.id}" ${attempt?.completed ? 'disabled' : ''} type="button">${statusLabel}</button>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    mount.querySelectorAll('[data-play-quilt-run]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tournament = tournaments.find((t) => t.id === btn.dataset.playQuiltRun);
            playRunTile(mount, uid, profile, tournament, settings, setActiveRound);
        });
    });
}

/** Awards the completion bonus (retry-safe) and shows the run summary with the finished mosaic. */
async function finishRun(mount, uid, profile, tournament, settings, setActiveRound) {
    const result = await completeTournamentIfNeeded(uid, profile, tournament);
    if (!result || !result.bonusAwarded) {
        mount.innerHTML = `
            <div class="empty-state">You played every tile, but saving your bonus failed &mdash; check the browser console for the error, then try again.</div>
            <div class="quilt-tournament-actions">
                <button class="btn primary" id="quilt-run-finalize-retry-btn" type="button">Try Again</button>
                <button class="btn" id="quilt-run-back-btn" type="button">Back to Patchwork Runs</button>
            </div>
        `;
        showToast("Couldn't save your Patchwork Run bonus");
        document.getElementById('quilt-run-finalize-retry-btn').addEventListener('click', () => finishRun(mount, uid, profile, tournament, settings, setActiveRound));
        document.getElementById('quilt-run-back-btn').addEventListener('click', () => renderTournamentMode(mount, uid, profile, setActiveRound));
        return;
    }
    trackGameCompleted('quilt-tournament');

    const results = result.puzzleResults || [];
    const { bonus, perfectPatchwork, perfectPatchworkBonus } = completionBonusFor(tournament, result);
    let currentTotal = tileRunTotal(results) + bonus + perfectPatchworkBonus;
    const greyRegions = results.map((r, i) => (r.passed ? null : tileRegion(tournament, i))).filter(Boolean);

    mount.innerHTML = `
        <div class="empty-state">${icon('CHECK')} &ldquo;${escapeHtml(tournament.name)}&rdquo; complete!</div>
        ${mosaicHtml(tournament, results)}
        <div class="quilt-tournament-actions"><button class="btn" id="quilt-run-back-btn" type="button">Back to Patchwork Runs</button></div>
    `;
    document.getElementById('quilt-run-back-btn').addEventListener('click', () => renderTournamentMode(mount, uid, profile, setActiveRound));

    showQuiltSummaryModal({
        title: 'Patchwork complete!',
        subtitle: tournament.name,
        picture: { palette: tournament.palette, pixels: tournament.pixels, greyRegions },
        breakdown: [
            ...results.map((r, i) => ({
                label: `Tile ${i + 1}: ${r.passed ? formatDuration(r.timeTakenSeconds * 1000) : 'out of time'}${r.perfect ? ' • Perfect Stitch' : ''}`,
                points: r.passed ? TOURNAMENT_TILE_PASS_POINTS : TOURNAMENT_TILE_FAIL_POINTS,
                icon: r.passed ? ICON_CHECK_SM : undefined,
            })),
            { label: 'Completion bonus', points: bonus, icon: ICON_BONUS },
            { label: 'Perfect Patchwork', points: perfectPatchworkBonus, icon: ICON_SPARKLE },
        ],
        totalPoints: currentTotal,
        perfect: perfectPatchwork,
        perfectLabel: 'Perfect Patchwork',
        shareText: shareTextForRun(tournament, results, currentTotal),
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
    showToast(`Patchwork complete! +${currentTotal} points`);
}

async function playRunTile(mount, uid, profile, tournament, settings, setActiveRound) {
    mount.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;
    const attempt = await getOrStartAttempt(tournament.id, uid, profile);
    const n = tournament.tiles.length;

    if (attempt.completed) {
        mount.innerHTML = `<div class="empty-state">You already completed &ldquo;${escapeHtml(tournament.name)}&rdquo;.</div>${mosaicHtml(tournament, attempt.puzzleResults || [])}`;
        return;
    }
    if (attempt.currentPuzzleIndex >= n) {
        // Every tile was played on an earlier visit but the bonus never saved -- retry that.
        mount.innerHTML = `<div class="loading-text">Saving your bonus&hellip;</div>`;
        await finishRun(mount, uid, profile, tournament, settings, setActiveRound);
        return;
    }

    const tileIndex = attempt.currentPuzzleIndex;
    const results = attempt.puzzleResults || [];
    mount.innerHTML = `
        <h2 class="quilt-title">${escapeHtml(tournament.name)}</h2>
        <p class="quilt-subtitle">Tile ${tileIndex + 1} of ${n} &mdash; ${formatLimit(settings.timeLimitSeconds)} on the clock.</p>
        ${mosaicHtml(tournament, results, tileIndex)}
        <div id="quilt-round-mount"></div>
    `;

    setActiveRound(playQuiltRound({
        container: document.getElementById('quilt-round-mount'),
        puzzle: tournament.tiles[tileIndex],
        timeLimitSeconds: settings.timeLimitSeconds,
        roundLabel: `Tile ${tileIndex + 1} of ${n}`,
        onComplete: async ({ won, timeTakenSeconds, perfect }) => {
            setActiveRound(null);
            const updated = await recordTileResult(tournament, uid, profile, { tileIndex, passed: won, timeTakenSeconds, perfect });
            if (!updated) {
                mount.innerHTML = `<div class="empty-state">Couldn't save this tile's result &mdash; check the browser console, then try again.</div>`;
                showToast("Couldn't save this tile's result");
                return;
            }
            trackGameCompleted('quilt-tournament');

            if (updated.currentPuzzleIndex >= n) {
                await finishRun(mount, uid, profile, tournament, settings, setActiveRound);
                return;
            }
            const points = won ? TOURNAMENT_TILE_PASS_POINTS : TOURNAMENT_TILE_FAIL_POINTS;
            mount.innerHTML = `
                <div class="empty-state">Tile ${tileIndex + 1} ${won ? `stitched${perfect ? ' &mdash; Perfect Stitch \u{2728}' : ''}` : 'ran out of time'} (+${points} points).</div>
                ${mosaicHtml(tournament, updated.puzzleResults || [], updated.currentPuzzleIndex)}
                <div class="quilt-tournament-actions">
                    <button class="btn primary" id="quilt-run-next-btn" type="button">Next Tile</button>
                </div>
            `;
            document.getElementById('quilt-run-next-btn').addEventListener('click', () => playRunTile(mount, uid, profile, tournament, settings, setActiveRound));
        },
    }));
}

function wireModeTabs(uid, profile, initialMode) {
    const tabs = Array.from(document.querySelectorAll('.quilt-mode-tab'));
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

    const tab = getQueryParam('tab');
    const initialMode = tab === 'classic' || tab === 'tournament' ? tab : 'daily';
    wireModeTabs(uid, profile, initialMode);
}

init();
