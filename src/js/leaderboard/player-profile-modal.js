/**
 * "Click a leaderboard row" player profile popup -- shared by leaderboard-page.js and home.js's
 * top-5 preview, since both render the same `hlb-row` shape. Builds its own DOM into
 * document.body on first use (same pattern as wordle-summary-modal.js -- no markup for this lives
 * in leaderboard.html/index.html themselves), reusing the generic `.modal-overlay`/`.modal-dialog`
 * component (components.css) rather than a page-specific one.
 *
 * Redesigned per a user-supplied mockup: a colored header (that player's main-rank accent color --
 * rank-service.js#MAIN_RANKS, sampled off the user's own reference sheet, tracked there for
 * exactly this kind of use even though nothing read it until this modal) with avatar/name/rank and
 * a "#N Global Rank" pill, a stats row (Total Points, Total XP, Global Rank, Day Streak), an
 * Overall Level/XP progress bar, and a grid of *earned* achievement badges with their label shown
 * underneath (not just on hover) -- not the full In Progress/Not Started breakdown, which would
 * require assembling the clicked player's entire progression context (game levels, streak,
 * championship tallies), far more reads than a quick-look popup on a stranger warrants.
 *
 * Guests have no rank/XP/streak/achievements (Section 4 of the progression spec) -- a fixed
 * neutral header color, the Guest avatar, and a short note in place of the stats/level/achievements
 * sections, same gate profile.js's own Achievements section already applies.
 *
 * Global Rank is the one genuinely expensive field here: it means ranking this player against
 * *every* player's all-time total (home.js's own "Overall Rank" tile already accepts this same
 * unbounded-read cost for the logged-in player -- see its own "Known limitation" doc comment).
 * Computing it fresh on every single row click would repeat that full scan every time, so the
 * fetched all-time leaderboard is cached at module scope after the first click and reused for
 * every subsequent one during this page's lifetime -- a player's all-time rank doesn't move often
 * enough within one browsing session to need a live re-fetch per click.
 */
import { getPlayerAchievements } from '../progression/achievement-engine.js';
import { ACHIEVEMENTS } from '../progression/achievement-registry.js';
import { calculateRankProgress, GUEST_RANK_IMAGE } from '../progression/rank-service.js';
import { calculateOverallProgress } from '../progression/xp-service.js';
import { getRegisteredUserSummary, getOverallLeaderboard, findUserInLeaderboard } from './leaderboard-data.js';
import { getUserLifetimeStats } from '../utils/points.js';
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/helpers.js';

// No MAIN_RANKS tier applies to a guest -- a fixed neutral color instead of defaulting to Novice's
// green, which would visually claim a rank they haven't earned (same reasoning as GUEST_RANK_IMAGE
// itself existing in the first place).
const GUEST_WINDOW_COLOR = '#5B6472';

const ACHIEVEMENT_CATEGORY_ICON = {
    game: 'TROPHY',
    streak: 'FLAME',
    global: 'STAR',
    championship: 'GOLD_MEDAL',
};

let modalEl = null;
let openToken = 0;

// See this module's own doc comment above -- the expensive all-time scan is paid once per page
// session, not once per click. Reset to null on failure so a later click can retry.
let allTimeRowsPromise = null;
function getAllTimeRowsCached() {
    if (!allTimeRowsPromise) {
        allTimeRowsPromise = getOverallLeaderboard('all', 500).catch((err) => {
            allTimeRowsPromise = null;
            throw err;
        });
    }
    return allTimeRowsPromise;
}

function achievementIconContent(a) {
    return a.image
        ? `<img src="${a.image}" alt="" class="player-profile-badge-image">`
        : icon(ACHIEVEMENT_CATEGORY_ICON[a.category]);
}

function badgeCardHtml(a) {
    const tooltip = a.description;
    const cls = a.image ? 'player-profile-badge player-profile-badge-image' : 'player-profile-badge';
    return `
        <div class="player-profile-badge-card">
            <div class="${cls}" data-tooltip="${escapeHtml(tooltip)}" tabindex="0">
                ${achievementIconContent(a)}
            </div>
            <span class="player-profile-badge-label">${escapeHtml(a.label)}</span>
        </div>
    `;
}

function statHtml(iconName, value, label) {
    return `
        <div class="player-profile-stat">
            <span class="player-profile-stat-icon">${icon(iconName)}</span>
            <div class="player-profile-stat-text">
                <div class="player-profile-stat-value">${value}</div>
                <div class="player-profile-stat-label">${label}</div>
            </div>
        </div>
    `;
}

function hidePlayerProfileModal() {
    if (modalEl) modalEl.hidden = true;
}

function ensureModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.className = 'modal-overlay';
    modalEl.hidden = true;
    modalEl.innerHTML = `
        <div class="modal-dialog player-profile-dialog" id="player-profile-dialog">
            <button class="modal-close player-profile-close" type="button" aria-label="Close">&times;</button>
            <div class="player-profile-header" id="player-profile-header">
                <img class="player-profile-avatar" src="" alt="">
                <div class="player-profile-name"></div>
                <div class="player-profile-rank-label"></div>
                <div class="player-profile-rank-pill" hidden></div>
            </div>
            <div id="player-profile-body"></div>
        </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hidePlayerProfileModal(); });
    modalEl.querySelector('.player-profile-close').addEventListener('click', hidePlayerProfileModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalEl.hidden) hidePlayerProfileModal();
    });

    return modalEl;
}

function renderGuestContent(el) {
    const dialog = el.querySelector('#player-profile-dialog');
    const header = el.querySelector('#player-profile-header');
    const body = el.querySelector('#player-profile-body');

    dialog.style.background = GUEST_WINDOW_COLOR;
    header.querySelector('.player-profile-avatar').src = GUEST_RANK_IMAGE;
    header.querySelector('.player-profile-rank-label').textContent = 'Guest';
    header.querySelector('.player-profile-rank-pill').hidden = true;
    body.innerHTML = `<div class="player-profile-guest-note">Guests don't earn Rank, XP, or Achievements -- sign up to start!</div>`;
}

/** `row` is a leaderboard row as returned by leaderboard-data.js -- needs `uid`, `displayName`,
 * `isGuest` at minimum. */
export async function showPlayerProfileModal(row) {
    const el = ensureModal();
    const dialog = el.querySelector('#player-profile-dialog');
    const header = el.querySelector('#player-profile-header');
    const body = el.querySelector('#player-profile-body');
    const avatarEl = header.querySelector('.player-profile-avatar');
    const rankLabelEl = header.querySelector('.player-profile-rank-label');
    const pillEl = header.querySelector('.player-profile-rank-pill');

    const token = ++openToken;
    el.hidden = false;
    header.querySelector('.player-profile-name').textContent = row.displayName;

    if (row.isGuest) {
        renderGuestContent(el);
        return;
    }

    dialog.style.background = 'var(--color-surface)';
    avatarEl.src = GUEST_RANK_IMAGE; // placeholder until real data resolves below
    rankLabelEl.textContent = 'Loading…';
    pillEl.hidden = true;
    body.innerHTML = `<div class="loading-text">Loading profile&hellip;</div>`;

    const [summary, lifetimeStats, earnedDocs, allTimeRows] = await Promise.all([
        getRegisteredUserSummary(row.uid),
        getUserLifetimeStats(row.uid),
        getPlayerAchievements(row.uid),
        getAllTimeRowsCached().catch(() => null),
    ]);

    // The modal may have been closed or reopened for a different player while these reads were
    // in flight -- discard a stale response rather than overwriting whatever's showing now.
    if (token !== openToken || el.hidden) return;

    const rankProgress = calculateRankProgress(summary.xp);
    const levelProgress = calculateOverallProgress(summary.xp);
    const totalPoints = summary.loginPoints + lifetimeStats.totalScore;
    const globalRank = allTimeRows ? (findUserInLeaderboard(allTimeRows, row.uid)?.rank ?? null) : null;
    const earnedIds = new Set(earnedDocs.map((d) => d.achievementId));
    const earned = ACHIEVEMENTS.filter((a) => earnedIds.has(a.id));
    const xpIntoLevel = levelProgress.xp - levelProgress.level * 500;

    dialog.style.background = rankProgress.mainRank.color;
    avatarEl.src = rankProgress.subRankImage;
    rankLabelEl.textContent = rankProgress.label;
    if (globalRank) {
        pillEl.hidden = false;
        pillEl.innerHTML = `${icon('GOLD_MEDAL')} #${globalRank} Global Rank`;
    } else {
        pillEl.hidden = true;
    }

    const badgesHtml = earned.length
        ? `
            <div class="player-profile-badges-title">Achievements <span class="player-profile-badges-count">${earned.length}</span></div>
            <div class="player-profile-badges-grid">${earned.map(badgeCardHtml).join('')}</div>
        `
        : `<div class="player-profile-no-badges">No achievements earned yet.</div>`;

    body.innerHTML = `
        <div class="player-profile-stats">
            ${statHtml('TROPHY', totalPoints.toLocaleString(), 'Total Points')}
            ${statHtml('STAR', summary.xp.toLocaleString(), 'Total XP')}
            ${statHtml('GOLD_MEDAL', globalRank ? `#${globalRank}` : '—', 'Global Rank')}
            ${statHtml('FLAME', summary.currentStreak.toLocaleString(), 'Day Streak')}
        </div>
        <div class="player-profile-level-card">
            <div class="player-profile-level-row">
                <span class="player-profile-level-title">Level ${levelProgress.level + 1}</span>
                <span class="player-profile-level-xp">${xpIntoLevel.toLocaleString()} / 500 XP</span>
            </div>
            <div class="player-profile-level-bar"><div class="player-profile-level-fill" style="width:${levelProgress.progressPercent}%"></div></div>
            <div class="player-profile-level-caption">${levelProgress.xpToNextLevel.toLocaleString()} XP to reach Level ${levelProgress.nextLevel + 1}</div>
        </div>
        <div class="player-profile-badges-section">${badgesHtml}</div>
    `;
}
