import { initShell } from '../app.js';
import { icon } from '../utils/icons.js';
import { updateRegisteredProfile } from '../auth/user-profile.js';
import { containsBlockedWord } from '../utils/profanity.js';
import { getUserScoreByGameType, getUserGameHistory } from '../utils/points.js';
import { showToast } from '../utils/helpers.js';
import { getGameProgressByGame } from '../progression/progression-service.js';
import { getStreakMilestoneTier } from '../progression/streak-service.js';
import { ACHIEVEMENTS } from '../progression/achievement-registry.js';
import { syncPlayerAchievements } from '../progression/achievement-engine.js';
import { claimChampionshipAchievements } from '../progression/championship-service.js';
import { DAILY_MISSIONS, syncDailyMissions } from '../progression/mission-service.js';
import { calculateRankProgress, GUEST_RANK_IMAGE, MAIN_RANKS } from '../progression/rank-service.js';

// Every gameType any gameScores doc can be written under, across all 9 game/mode data files --
// GAME_LABELS used to only know the three Daily Challenge ones, so a Classic/Tournament/Challenge
// row fell back to showing its raw gameType string instead of a real label.
const GAME_LABELS = {
    wordle: 'Wordle',
    'wordle-tournament': 'Wordle Tournament',
    'wordle-challenge': 'Wordle Challenge',
    'wordle-challenge-creator': 'Wordle Challenge Reward',
    sudoku: 'Sudoku',
    'sudoku-classic': 'Sudoku Classic',
    'sudoku-tournament': 'Sudoku Tournament',
    'sudoku-tournament-bonus': 'Sudoku Tournament Bonus',
    wordsearch: 'Word Search',
    'wordsearch-classic': 'Word Search Classic',
    'wordsearch-tournament': 'Word Search Tournament',
    'wordsearch-tournament-bonus': 'Word Search Tournament Bonus',
};

/** Avatar (a Rank badge image -- see progression/rank-service.js), name, current-rank tagline
 * (replaces the old static "Play daily..." text), and streak. Rank tagline/streak are
 * registered-player-only concepts (see docs/progression-gamification-roadmap.md's ground rules),
 * so guests get the original static tagline back and no streak line at all, rather than a
 * placeholder "—". The avatar itself is shown for guests too, just as the fixed GUEST_RANK_IMAGE
 * rather than a real rank -- guests don't earn XP/Rank (Section 4 of the spec), so defaulting
 * them into "Novice" would misrepresent it as a real, if low, rank. */
function renderHero(profile) {
    const avatarEl = document.getElementById('profile-avatar');
    const taglineEl = document.getElementById('profile-hero-tagline');

    if (profile.kind === 'registered') {
        const progress = calculateRankProgress(profile.xp);
        avatarEl.src = progress.subRankImage;
        avatarEl.alt = `${progress.label} rank badge`;
        avatarEl.title = progress.label;
        taglineEl.textContent = progress.label;
    } else {
        avatarEl.src = GUEST_RANK_IMAGE;
        avatarEl.alt = 'Guest';
        avatarEl.title = 'Guest';
        taglineEl.textContent = 'Play daily. Keep your streak alive!';
    }

    document.getElementById('profile-name-display').textContent = profile.displayName;

    const streakEl = document.getElementById('profile-streak');
    if (profile.kind === 'registered') {
        const streak = profile.raw.currentStreak || 0;
        streakEl.innerHTML = `${icon('FLAME')} ${streak} day streak`;
        // Milestone (7/30/100/365 days) is a visual-only highlight for now -- Achievements
        // (Phase 5) will turn these into real badges later; see progression/streak-service.js.
        streakEl.className = 'profile-hero-streak';
        const tier = getStreakMilestoneTier(streak);
        if (tier) streakEl.classList.add(`profile-hero-streak-tier-${tier}`);
        streakEl.hidden = false;
    } else {
        streakEl.hidden = true;
    }
}

/** The progress bar under the hero -- back to *sub-rank* progress (1,000 XP wide, e.g. "Novice I"
 * -> "Novice II"), flanked by the current and next sub-rank's badge + label, with a large
 * centered "current / 1,000 XP" readout. (This briefly showed *main*-rank progress instead, back
 * when there was a separate side panel already showing sub-rank progress -- now that the side
 * panel is gone in favor of the flatter "All Ranks" strip below, sub-rank is the single progress
 * bar again, since it's the more frequently-moving, immediately actionable number.) Registered-
 * only, same as the rest of this page's progression UI -- guests have no XP/Rank to show progress
 * toward. */
function renderRankCard(profile, isRegistered) {
    const cardEl = document.getElementById('profile-rank-card');
    if (!isRegistered) {
        cardEl.hidden = true;
        return;
    }
    cardEl.hidden = false;

    const progress = calculateRankProgress(profile.xp);
    // At max rank there's no "next" sub-rank -- reuse the current (Legend X) badge/label on both
    // sides rather than leaving the right-hand side broken/empty.
    const nextLabel = progress.isMaxRank ? progress.label : progress.nextLabel;

    document.getElementById('profile-rank-current-icon').src = progress.subRankImage;
    document.getElementById('profile-rank-current-icon').alt = progress.label;
    document.getElementById('profile-rank-current-label').textContent = progress.label;
    document.getElementById('profile-rank-next-icon').src = progress.nextSubRankImage;
    document.getElementById('profile-rank-next-icon').alt = nextLabel;
    document.getElementById('profile-rank-next-label').textContent = nextLabel;
    document.getElementById('profile-rank-bar-fill').style.width = `${progress.progressPercent}%`;
    document.getElementById('profile-rank-xp-big').innerHTML = `${progress.xpIntoSubRank.toLocaleString()} <span class="rank-progress-xp-big-muted">/ 1,000 XP</span>`;
    document.getElementById('profile-rank-next').textContent = progress.isMaxRank
        ? 'Max rank reached!'
        : `${progress.xpToNextSubRank.toLocaleString()} XP to reach ${progress.nextLabel}`;
}

/** "All Ranks" -- a compact horizontal strip of all 10 main ranks (built generically from
 * rank-service.js#MAIN_RANKS, no game/rank hardcoded here beyond what that registry already
 * holds), replacing the earlier vertical ladder + separate Current/Next Rank boxes --
 * that took up a lot of vertical space for what's fundamentally the same 10 icons. Each rank's
 * name/XP threshold is a native `title` tooltip ("hover to see details") rather than always-on
 * text, keeping the strip dense. The player's current tier gets a highlighted ring and a small
 * "Current" marker underneath. Registered-only, same as the rest of this page's progression UI. */
function renderRankPanel(profile, isRegistered) {
    const panelEl = document.getElementById('profile-rank-panel');
    if (!isRegistered) {
        panelEl.hidden = true;
        return;
    }
    panelEl.hidden = false;

    const progress = calculateRankProgress(profile.xp);

    document.getElementById('rank-strip').innerHTML = MAIN_RANKS.map((r) => {
        const isCurrent = r.tier === progress.mainRank.tier;
        // A custom CSS tooltip (data-tooltip + :hover/:focus in profile.css), not the native
        // `title` attribute -- browser-native title tooltips have an inconsistent hover delay
        // (and render poorly/not at all in some browsers), so hovering just changed the cursor
        // to "?" without ever actually showing the text.
        return `
            <div class="rank-strip-item ${isCurrent ? 'rank-strip-item-current' : ''}" data-tooltip="${r.name} — ${(r.tier * 10000).toLocaleString()} XP total, sub-ranks I–X" tabindex="0">
                <img class="rank-strip-icon" src="${r.image}" alt="${r.name}">
                <div class="rank-strip-name">${r.name}</div>
                <div class="rank-strip-current-marker">${isCurrent ? '▲<br>Current' : ''}</div>
            </div>
        `;
    }).join('');
}

/**
 * The bottom stat row -- redesigned from 3 plain tiles to 4 icon-circle tiles with subtitles.
 * "Games mastered" (a narrow count of just `category: 'game'` achievements) was replaced with a
 * general "Achievements" tile (the count of *all* distinct achievements earned, any category) per
 * explicit product direction -- the old label/caption ("Completed all levels in a game") didn't
 * match how this app's achievements actually work anyway (games don't have discrete "levels" to
 * complete). "Total XP" is new here too -- previously only shown inline in the hero. Total
 * Points/Games Played are unchanged in meaning, just restyled. XP/Achievements are
 * registered-player-only concepts (Section 4), so guests get a 2-tile row instead of 4.
 */
function renderStats(isRegistered, totalPoints, totalXp, gamesPlayedCount, achievementsEarnedCount) {
    const el = document.getElementById('profile-stats');
    el.classList.toggle('profile-stats-two', !isRegistered);

    const registeredTiles = isRegistered ? `
        <div class="profile-stat-tile">
            <div class="profile-stat-icon profile-stat-icon-xp">${icon('STAR')}</div>
            <div class="profile-stat-value">${totalXp.toLocaleString()}</div>
            <div class="profile-stat-label">Total XP</div>
            <div class="profile-stat-subtitle">Used for levels and ranks</div>
        </div>
        <div class="profile-stat-tile">
            <div class="profile-stat-icon profile-stat-icon-games">${icon('TARGET')}</div>
            <div class="profile-stat-value">${gamesPlayedCount}</div>
            <div class="profile-stat-label">Games Played</div>
            <div class="profile-stat-subtitle">Across all games</div>
        </div>
        <div class="profile-stat-tile">
            <div class="profile-stat-icon profile-stat-icon-achievements">${icon('GOLD_MEDAL')}</div>
            <div class="profile-stat-value">${achievementsEarnedCount}</div>
            <div class="profile-stat-label">Achievements</div>
            <div class="profile-stat-subtitle">Badges earned</div>
        </div>
    ` : `
        <div class="profile-stat-tile">
            <div class="profile-stat-icon profile-stat-icon-games">${icon('TARGET')}</div>
            <div class="profile-stat-value">${gamesPlayedCount}</div>
            <div class="profile-stat-label">Games Played</div>
            <div class="profile-stat-subtitle">Across all games</div>
        </div>
    `;

    el.innerHTML = `
        <div class="profile-stat-tile">
            <div class="profile-stat-icon profile-stat-icon-points">${icon('TROPHY')}</div>
            <div class="profile-stat-value">${totalPoints.toLocaleString()}</div>
            <div class="profile-stat-label">Total Points</div>
            <div class="profile-stat-subtitle">Your leaderboard points</div>
        </div>
        ${registeredTiles}
    `;
}

const MODE_META = {
    daily: { label: 'Daily', icon: 'SUN' },
    classic: { label: 'Classic', icon: 'PLAY' },
    tournament: { label: 'Tournament', icon: 'TROPHY' },
    challenges: { label: 'Challenges', icon: 'PEOPLE' },
};

/** Per-game Level + Points + progress-to-next-level + modes played -- Phase 1/2 of the
 * progression spec. Purely a read/derive of existing gameScores data; no new Firestore writes or
 * fields. Only lists games from the registry (the 3 real games) -- no placeholder/"coming soon"
 * entries for unbuilt games, per explicit product direction.
 *
 * Level/progress/modes are a registered-player-only "persistent progression profile" (Section 4
 * of the spec) -- guests still earn real Points per game (shown as-is), but see a locked card
 * instead of a Level, consistent with "registration unlocks progression, not a requirement to
 * play" rather than guests being blocked from playing or earning Points at all.
 */
// How many game cards to reveal at once -- generic regardless of how many games the registry
// ever grows to hold (Section 28 of the progression spec: never hardcode a specific game count).
const GAMES_PAGE_SIZE = 3;

// `g.level`/`g.nextLevel` are progression-service.js's raw 0-indexed values (0 at 0 points) --
// achievement-registry.js's GAME_MASTER_LEVEL/ALL_ROUNDER_LEVEL thresholds compare against that
// same raw number, so it's left untouched there. Displaying "Level 1" instead of "Level 0" for a
// brand-new player is purely cosmetic, so the +1 is applied only here, at render time.
function gameProgressCardHtml(g, isRegistered) {
    if (!isRegistered) {
        return `
            <div class="game-progress-card game-progress-card-guest">
                <img class="game-progress-logo" src="${g.logo}" alt="${g.label}">
                <div class="game-progress-body">
                    <div class="game-progress-top-row">
                        <div class="game-progress-name">${g.label}</div>
                        <div class="game-progress-level game-progress-level-locked">${icon('LOCK')}</div>
                    </div>
                    <div class="game-progress-points">${g.lifetimePoints.toLocaleString()} Points</div>
                </div>
            </div>
        `;
    }

    const modeChips = Object.entries(g.modes)
        .map(([key, count]) => {
            const meta = MODE_META[key];
            return `<span class="mode-chip">${icon(meta.icon)} ${meta.label} <strong>${count}</strong></span>`;
        })
        .join('');

    return `
        <div class="game-progress-card">
            <img class="game-progress-logo" src="${g.logo}" alt="${g.label}">
            <div class="game-progress-body">
                <div class="game-progress-top-row">
                    <div class="game-progress-name">${g.label}</div>
                    <div class="game-progress-level">Level ${g.level + 1}</div>
                </div>
                <div class="game-progress-points">${g.lifetimePoints.toLocaleString()} Points</div>
                <div class="progress-bar"><div class="progress-bar-fill" style="width: ${g.progressPercent}%"></div></div>
                <div class="game-progress-next">${g.pointsToNextLevel.toLocaleString()} Points to Level ${g.nextLevel + 1}</div>
                <div class="game-progress-modes">${modeChips}</div>
            </div>
        </div>
    `;
}

function renderGameProgress(progressByGame, isRegistered) {
    const el = document.getElementById('profile-game-progress');
    const guestNote = document.getElementById('profile-games-guest-note');
    guestNote.hidden = isRegistered;

    // Highest lifetime Points first -- a plain sort, so this keeps working correctly (and still
    // shows the player's best games up front) however many games the registry eventually holds.
    const sortedGames = Object.values(progressByGame).sort((a, b) => b.lifetimePoints - a.lifetimePoints);
    let visibleCount = GAMES_PAGE_SIZE;

    function renderVisible() {
        document.getElementById('game-progress-load-more')?.remove();
        el.innerHTML = sortedGames.slice(0, visibleCount).map((g) => gameProgressCardHtml(g, isRegistered)).join('');

        if (visibleCount < sortedGames.length) {
            el.insertAdjacentHTML(
                'afterend',
                `<button class="btn game-progress-load-more" id="game-progress-load-more" type="button">Load More</button>`
            );
            document.getElementById('game-progress-load-more').addEventListener('click', () => {
                visibleCount += GAMES_PAGE_SIZE;
                renderVisible();
            });
        }
    }

    renderVisible();
}

/** Today's Daily Missions (Phase 7 of the progression spec) -- registered players only, "silent"
 * surfacing like Achievements/Championships: `init()` below already evaluated + awarded XP for
 * any newly-completed mission via `mission-service.js#syncDailyMissions()` before this renders,
 * so this is purely display. `context`/`completedMissionIds` come straight from that call --
 * nothing here re-derives anything. */
function renderMissions(context, completedMissionIds, isRegistered) {
    const el = document.getElementById('profile-missions');
    const guestNote = document.getElementById('profile-missions-guest-note');
    guestNote.hidden = isRegistered;

    if (!isRegistered) {
        el.innerHTML = '';
        return;
    }

    const ICON_VARIANTS = ['variant-0', 'variant-1', 'variant-2', 'variant-3', 'variant-4'];

    el.innerHTML = DAILY_MISSIONS.map((m, i) => {
        const done = completedMissionIds.has(m.id);
        const current = m.progress(context);
        const percent = Math.min(100, Math.round((current / m.target) * 100));
        return `
            <div class="mission-card ${done ? 'mission-card-done' : ''}">
                <div class="mission-icon-circle ${ICON_VARIANTS[i % ICON_VARIANTS.length]}">${done ? icon('CHECK') : icon('TARGET')}</div>
                <div class="mission-body">
                    <div class="mission-top-row">
                        <div class="mission-label">${m.label}</div>
                        <div class="mission-reward">+${m.xp} XP</div>
                    </div>
                    <div class="mission-progress">${done ? 'Complete!' : `<strong>${current.toLocaleString()}</strong> <span class="mission-progress-muted">/ ${m.target.toLocaleString()}</span>`}</div>
                    <div class="progress-bar"><div class="progress-bar-fill" style="width: ${percent}%"></div></div>
                </div>
            </div>
        `;
    }).join('');
}

const ACHIEVEMENT_CATEGORY_ICON = {
    game: 'TROPHY',
    streak: 'FLAME',
    exploration: 'GLOBE',
    global: 'STAR',
    championship: 'GOLD_MEDAL',
};

/** Every achievement in the registry, earned ones highlighted with their category icon, unearned
 * ones shown locked/dimmed with their real (not fabricated) condition as a description -- Phase 5
 * of the progression spec, "silent" surfacing (no toast/popup): a badge just appears here the next
 * time this page is visited after it's earned. Registered-only, same as the rest of this page's
 * progression UI. `earnedCounts` is a Map of achievementId -> count -- Championship achievements
 * (Phase 6) accumulate across repeat wins, so a "×N" is shown alongside those once count > 1;
 * every other category is one-time and never shows a count. */
function renderAchievements(earnedCounts, isRegistered) {
    const el = document.getElementById('profile-achievements');
    const guestNote = document.getElementById('profile-achievements-guest-note');
    guestNote.hidden = isRegistered;

    if (!isRegistered) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = ACHIEVEMENTS.map((a) => {
        const count = earnedCounts.get(a.id) || 0;
        const earned = count > 0;
        const iconName = earned ? ACHIEVEMENT_CATEGORY_ICON[a.category] : 'LOCK';
        const countBadge = count > 1 ? ` <span class="achievement-count">×${count}</span>` : '';
        return `
            <div class="achievement-card ${earned ? 'achievement-card-earned' : 'achievement-card-locked'}">
                <div class="achievement-icon">${icon(iconName)}</div>
                <div class="achievement-label">${a.label}${countBadge}</div>
                <div class="achievement-description">${a.description}</div>
            </div>
        `;
    }).join('');
}

function renderHistory(history) {
    const el = document.getElementById('profile-history');
    if (history.length === 0) {
        el.innerHTML = `<div class="empty-state">No games played yet — head to the home page to get started!</div>`;
        return;
    }
    el.innerHTML = history
        .map((entry) => {
            // `gameDate` is a real calendar date only for Daily Challenge docs -- Classic/
            // Tournament/Challenge modes repurpose it as a deterministic key (a tournament id, a
            // {tournamentId}_{puzzleIndex} pair, etc.), so `scoreDate` (always a real date,
            // regardless of mode) is shown instead when present. `timeTaken` only exists on
            // Daily/Classic docs -- Tournament docs track different fields entirely (wordAttempts,
            // puzzleResults, raw errors/timeTakenSeconds), so it's omitted rather than shown as
            // the literal text "undefined" when absent.
            const date = entry.scoreDate || entry.gameDate;
            const timeSuffix = entry.timeTaken ? ` (${entry.timeTaken})` : '';
            return `
                <div class="history-row">
                    <div class="history-game">${GAME_LABELS[entry.gameType] || entry.gameType}</div>
                    <div class="history-detail">${date} — ${entry.score} pts${timeSuffix}</div>
                </div>
            `;
        })
        .join('');
}

async function init() {
    const { uid, profile } = await initShell();

    // "Edit Profile" (a pencil icon button in the card's corner) now opens a modal to change the
    // display name, instead of toggling an inline field -- reuses the same .modal-overlay
    // component the home page's sign-in modal uses. The underlying rename logic below is
    // unchanged, only how the field is shown/hidden.
    const editModalEl = document.getElementById('edit-profile-modal');
    document.getElementById('edit-profile-btn').addEventListener('click', () => {
        editModalEl.hidden = false;
    });
    document.getElementById('edit-profile-modal-close').addEventListener('click', () => {
        editModalEl.hidden = true;
    });
    editModalEl.addEventListener('click', (e) => {
        if (e.target === editModalEl) editModalEl.hidden = true;
    });

    const nameInput = document.getElementById('display-name-input');
    const saveBtn = document.getElementById('save-name-btn');
    nameInput.value = profile.displayName;

    if (profile.kind === 'guest') {
        nameInput.disabled = true;
        saveBtn.disabled = true;
        saveBtn.title = 'Guests cannot change their display name. Sign up for an account to do that.';
    } else {
        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) {
                showToast('Display name cannot be empty');
                return;
            }
            if (await containsBlockedWord(name)) {
                showToast('That display name isn\'t allowed. Please choose another.');
                return;
            }
            await updateRegisteredProfile(uid, { displayName: name });
            document.getElementById('profile-name-display').textContent = name;
            editModalEl.hidden = true;
            showToast('Display name updated');
        });
    }

    const [{ byGameType, totalScore, gamesPlayedCount }, history] = await Promise.all([
        getUserScoreByGameType(uid),
        getUserGameHistory(uid, 20),
    ]);

    const isRegistered = profile.kind === 'registered';
    const totalPoints = isRegistered ? profile.loginPoints + totalScore : totalScore;
    const gameProgress = getGameProgressByGame(byGameType);

    let earnedCounts = new Map();
    let missionContext = null;
    let completedMissionIds = new Set();
    if (isRegistered) {
        // Claiming (Phase 6) happens before syncing (Phase 5) so a championship win claimed just
        // now shows up in the same render, not only on the next visit.
        await claimChampionshipAchievements(uid);

        const missionResult = await syncDailyMissions(uid);
        missionContext = missionResult.context;
        completedMissionIds = missionResult.completedMissionIds;
        // Keeps the in-memory profile in sync with any XP a mission reward just awarded -- same
        // reasoning as app.js's login-bonus XP sync (see there for the full rationale).
        profile.xp = (profile.xp || 0) + missionResult.xpAwarded;

        const context = {
            gameProgress,
            totalPoints,
            currentStreak: profile.raw.currentStreak || 0,
            hasPerfectDay: !!profile.raw.lastPerfectDayDate,
        };
        const earned = await syncPlayerAchievements(uid, context);
        earnedCounts = new Map(earned.map((a) => [a.achievementId, a.count || 1]));
    }
    // Total distinct achievements earned, any category -- replaces the old narrower
    // "games mastered" (category: 'game' only) count on the stat tile, per explicit product
    // direction (see renderStats()'s own doc comment for the full reasoning).
    const achievementsEarnedCount = earnedCounts.size;

    // Rendered after all of the above, not at the top of init(), so the rank card's Overall
    // Level/XP reflects any mission reward just awarded this visit rather than the value loaded
    // at session-start.
    renderHero(profile);
    renderRankCard(profile, isRegistered);
    renderRankPanel(profile, isRegistered);
    renderStats(isRegistered, totalPoints, profile.xp || 0, gamesPlayedCount, achievementsEarnedCount);
    renderGameProgress(gameProgress, isRegistered);
    renderMissions(missionContext, completedMissionIds, isRegistered);
    renderAchievements(earnedCounts, isRegistered);
    renderHistory(history);
}

init();
