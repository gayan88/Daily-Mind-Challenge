import { escapeHtml, shareUrl, showToast } from '../../utils/helpers.js';

const ICON_TROPHY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 4h3a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4"/><path d="M7 4H4a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4"/></svg>`;
const ICON_COMMUNITY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-1 2c-3.3 0-6 1.8-6 4v2h9v-2c0-.8.2-1.5.6-2.1A8.6 8.6 0 0 0 8 14Zm7.5-3a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 2c-.6 0-1.2.1-1.7.3.9 1 1.5 2.3 1.5 3.7v2h6v-2c0-2.2-2.6-4-5.8-4Z"/></svg>`;
const ICON_SHARE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const TOTAL_ROWS = 6;

/**
 * Shared post-round popup for all three Wordle modes (daily challenge, tournaments, user
 * challenges): points breakdown, a colored-square grid of the round's guesses, and (when the
 * caller opts in via `shareText`/`onShareCommunity`/`onShareFriends`) two independent share
 * options. Builds its own DOM and appends/removes it from document.body, so callers don't need
 * any modal markup of their own in wordle.html beyond loading wordle.css.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {string[][]} opts.guessStates - per-guess 'correct'|'present'|'absent' arrays. Always
 *   rendered as a fixed 6-row grid -- rows beyond what was actually played show as empty
 *   placeholders, so the grid's shape doesn't change based on how many guesses it took.
 * @param {{label: string, points: number, icon?: string}[]} opts.breakdown - only entries with
 *   points > 0 shown, except the total. `icon` is optional raw SVG markup shown beside the label.
 * @param {number} opts.totalPoints
 * @param {boolean} [opts.celebrate] - shows a trophy-in-a-circle + confetti header above the
 *   title. Only pass this for an actual win -- there's no separate "loss" treatment, so callers
 *   showing a loss screen should leave it false.
 * @param {string} [opts.shareText] - if set, the two share options are shown (each also needs its
 *   own `onShareX` callback below to actually render): "Copy Result & Share with Community"
 *   (copies `shareText` to the clipboard and opens `communityUrl` in a new tab) and "Share with
 *   Friends" (the native Web Share API / sharer.php fallback via `shareUrl()`). The two are
 *   independent, stackable bonuses, not alternatives -- a player can claim both. Using an option
 *   whose bonus was already claimed still performs the share action, just without re-awarding
 *   points (the caller's own server-side guard is what actually prevents a double award).
 * @param {string} [opts.communityUrl] - the Facebook Group (or similar community) URL the first
 *   share option opens. Required for that option to render.
 * @param {string} [opts.shareLink] - the link "Share with Friends" hands to the native share
 *   sheet as its separate `url` field. Defaults to `window.location.href`, but callers whose
 *   `shareText` embeds a different canonical link (e.g. Tournament's `?tab=tournaments` deep
 *   link, which the current page URL doesn't reflect) should pass that same link here too --
 *   otherwise the share sheet can present two different URLs for the same result.
 * @param {() => Promise<{applied: boolean, newScore: number}>} [opts.onShareCommunity]
 * @param {() => Promise<{applied: boolean, newScore: number}>} [opts.onShareFriends]
 * @param {(newScore?: number) => void} [opts.onClose]
 */
export function showWordleSummaryModal({
    title,
    subtitle = '',
    guessStates = [],
    breakdown = [],
    totalPoints,
    celebrate = false,
    shareText = '',
    communityUrl = '',
    shareLink = window.location.href,
    onShareCommunity = null,
    onShareFriends = null,
    onClose = null,
}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'wordle-summary-modal';

    const wordLength = guessStates[0]?.length || 5;
    const gridHtml = guessStates.length ? `
        <div class="wordle-summary-grid">
            ${Array.from({ length: TOTAL_ROWS }, (_, i) => guessStates[i] || null).map((row) => `
                <div class="wordle-summary-row">
                    ${row
                        ? row.map((state) => `<div class="wordle-summary-cell" data-state="${state}"></div>`).join('')
                        : Array.from({ length: wordLength }, () => '<div class="wordle-summary-cell empty"></div>').join('')}
                </div>
            `).join('')}
        </div>
    ` : '';

    const breakdownHtml = breakdown
        .filter((line) => line.points > 0)
        .map((line) => `
            <div class="wordle-summary-line">
                <span class="wordle-summary-line-label">${line.icon ? `<span class="wordle-summary-line-icon">${line.icon}</span>` : ''}${escapeHtml(line.label)}</span>
                <span>+${line.points}</span>
            </div>
        `).join('');

    const shareOptionsHtml = shareText ? `
        <div class="wordle-share-options">
            ${communityUrl ? `
                <button class="wordle-share-option wordle-share-community" id="wordle-share-community-btn" type="button">
                    <span class="wordle-share-option-icon">${ICON_COMMUNITY}</span>
                    <span class="wordle-share-option-body">
                        <span class="wordle-share-option-title">Copy Result &amp; Share with Community</span>
                        <span class="wordle-share-option-desc">We'll copy your result and open the Community. Just paste it in your post and share!</span>
                    </span>
                    <span class="wordle-share-option-side">
                        <span class="wordle-share-badge">+20</span>
                        <span class="wordle-share-option-arrow">${ICON_CHEVRON}</span>
                    </span>
                </button>
                <div class="wordle-share-or"><span>OR</span></div>
            ` : ''}
            <button class="wordle-share-option wordle-share-friends" id="wordle-share-friends-btn" type="button">
                <span class="wordle-share-option-icon">${ICON_SHARE}</span>
                <span class="wordle-share-option-body">
                    <span class="wordle-share-option-title">Share with Friends</span>
                    <span class="wordle-share-option-desc">Share via WhatsApp, Messenger, Telegram, Email or other apps.</span>
                </span>
                <span class="wordle-share-option-side">
                    <span class="wordle-share-badge wordle-share-badge-green">+10</span>
                    <span class="wordle-share-option-arrow">${ICON_CHEVRON}</span>
                </span>
            </button>
        </div>
    ` : '';

    overlay.innerHTML = `
        <div class="modal-dialog wordle-summary-dialog">
            <button class="modal-close" id="wordle-summary-close" type="button" aria-label="Close">&times;</button>
            ${celebrate ? `
                <div class="wordle-summary-celebrate">
                    <span class="wordle-summary-confetti wordle-summary-confetti-1"></span>
                    <span class="wordle-summary-confetti wordle-summary-confetti-2"></span>
                    <span class="wordle-summary-confetti wordle-summary-confetti-3"></span>
                    <span class="wordle-summary-confetti wordle-summary-confetti-4"></span>
                    <span class="wordle-summary-trophy-wrap">${ICON_TROPHY}</span>
                </div>
            ` : ''}
            <div class="wordle-summary-title">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="wordle-summary-subtitle">${escapeHtml(subtitle)}</div>` : ''}
            ${gridHtml}
            <div class="wordle-summary-breakdown">
                ${breakdownHtml}
                <div class="wordle-summary-line wordle-summary-total">
                    <span>Total Score</span>
                    <span>+${totalPoints}</span>
                </div>
            </div>
            ${shareOptionsHtml}
        </div>
    `;

    document.body.appendChild(overlay);

    function close(newScore) {
        overlay.remove();
        document.removeEventListener('keydown', onKeydown);
        if (onClose) onClose(newScore);
    }

    function onKeydown(e) {
        if (e.key === 'Escape') close();
    }

    overlay.querySelector('#wordle-summary-close').addEventListener('click', () => close());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);

    /** Marks just this one option as claimed -- the other option (if any) stays fully clickable. */
    function markClaimed(btn) {
        btn.disabled = true;
        btn.classList.add('wordle-share-option-claimed');
        const sideEl = btn.querySelector('.wordle-share-option-side');
        if (sideEl) sideEl.innerHTML = ICON_CHECK;
        const descEl = btn.querySelector('.wordle-share-option-desc');
        if (descEl) descEl.textContent = 'Shared! Bonus added.';
    }

    async function applyShare(btn, awardShare) {
        let result;
        try {
            result = await awardShare();
        } catch (err) {
            console.error('applyShare: bonus award failed', err);
            showToast("Couldn't save your share bonus -- check the browser console for the error");
            return;
        }
        if (result && result.applied) {
            const totalEl = overlay.querySelector('.wordle-summary-total span:last-child');
            if (totalEl) totalEl.textContent = `+${result.newScore}`;
            markClaimed(btn);
        }
    }

    const communityBtn = overlay.querySelector('#wordle-share-community-btn');
    if (communityBtn && onShareCommunity) {
        communityBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(shareText);
                showToast('Result copied! Paste it into your post.');
            } catch {
                showToast("Couldn't copy automatically -- copy your result manually before posting.");
            }
            window.open(communityUrl, '_blank', 'noopener,noreferrer');
            await applyShare(communityBtn, onShareCommunity);
        });
    }

    const friendsBtn = overlay.querySelector('#wordle-share-friends-btn');
    if (friendsBtn && onShareFriends) {
        friendsBtn.addEventListener('click', async () => {
            const shared = await shareUrl(shareLink, shareText);
            if (!shared) return;
            await applyShare(friendsBtn, onShareFriends);
        });
    }
}
