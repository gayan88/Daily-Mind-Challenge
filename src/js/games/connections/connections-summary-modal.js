import { escapeHtml, shareUrl, showToast } from '../../utils/helpers.js';

const ICON_TROPHY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 4h3a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4"/><path d="M7 4H4a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4"/></svg>`;
const ICON_COMMUNITY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-1 2c-3.3 0-6 1.8-6 4v2h9v-2c0-.8.2-1.5.6-2.1A8.6 8.6 0 0 0 8 14Zm7.5-3a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 2c-.6 0-1.2.1-1.7.3.9 1 1.5 2.3 1.5 3.7v2h6v-2c0-2.2-2.6-4-5.8-4Z"/></svg>`;
const ICON_SHARE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

/**
 * Post-round popup for all three Connections modes (Daily, Classic, Tournament): points breakdown,
 * a colored-square grid of the round's guesses (one row per submitted guess, each square the true
 * group color of that word), and -- when the caller passes `shareText`/`onShareCommunity`/
 * `onShareFriends` -- the two independent, stackable share bonuses (+20 community, +10 friends).
 * Same shape as wordle-summary-modal.js (each game keeps its own copy by convention); builds its
 * own DOM into document.body.
 *
 * @param {number[][]} [opts.guessHistory] - per-guess arrays of group indexes 0..3
 * @param {{label: string, points: number, icon?: string}[]} opts.breakdown - only entries with points > 0 shown
 * @param {boolean} [opts.celebrate] - trophy + confetti header, wins only
 * @param {string} [opts.shareLink] - link handed to the native share sheet; defaults to the page URL
 * @param {() => Promise<{applied: boolean, newScore: number}>} [opts.onShareCommunity]
 * @param {() => Promise<{applied: boolean, newScore: number}>} [opts.onShareFriends]
 * @param {(newScore?: number) => void} [opts.onClose]
 */
export function showConnectionsSummaryModal({
    title,
    subtitle = '',
    guessHistory = [],
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
    overlay.id = 'cx-summary-modal';

    const gridHtml = guessHistory.length ? `
        <div class="cx-summary-grid">
            ${guessHistory.map((row) => `
                <div class="cx-summary-row">
                    ${row.map((gi) => `<div class="cx-summary-cell" data-group="${gi}"></div>`).join('')}
                </div>
            `).join('')}
        </div>
    ` : '';

    const breakdownHtml = breakdown
        .filter((line) => line.points > 0)
        .map((line) => `
            <div class="cx-summary-line">
                <span class="cx-summary-line-label">${line.icon ? `<span class="cx-summary-line-icon">${line.icon}</span>` : ''}${escapeHtml(line.label)}</span>
                <span>+${line.points.toLocaleString()}</span>
            </div>
        `).join('');

    const shareOptionsHtml = shareText ? `
        <div class="cx-share-options">
            ${communityUrl ? `
                <button class="cx-share-option cx-share-community" id="cx-share-community-btn" type="button">
                    <span class="cx-share-option-icon">${ICON_COMMUNITY}</span>
                    <span class="cx-share-option-body">
                        <span class="cx-share-option-title">Copy Result &amp; Share with Community</span>
                        <span class="cx-share-option-desc">We'll copy your result and open the Community. Just paste it in your post and share!</span>
                    </span>
                    <span class="cx-share-option-side">
                        <span class="cx-share-badge">+20</span>
                        <span class="cx-share-option-arrow">${ICON_CHEVRON}</span>
                    </span>
                </button>
                <div class="cx-share-or"><span>OR</span></div>
            ` : ''}
            <button class="cx-share-option cx-share-friends" id="cx-share-friends-btn" type="button">
                <span class="cx-share-option-icon">${ICON_SHARE}</span>
                <span class="cx-share-option-body">
                    <span class="cx-share-option-title">Share with Friends</span>
                    <span class="cx-share-option-desc">Share via WhatsApp, Messenger, Telegram, Email or other apps.</span>
                </span>
                <span class="cx-share-option-side">
                    <span class="cx-share-badge cx-share-badge-green">+10</span>
                    <span class="cx-share-option-arrow">${ICON_CHEVRON}</span>
                </span>
            </button>
        </div>
    ` : '';

    overlay.innerHTML = `
        <div class="modal-dialog cx-summary-dialog">
            <button class="modal-close" id="cx-summary-close" type="button" aria-label="Close">&times;</button>
            ${celebrate ? `
                <div class="cx-summary-celebrate">
                    <span class="cx-summary-confetti cx-summary-confetti-1"></span>
                    <span class="cx-summary-confetti cx-summary-confetti-2"></span>
                    <span class="cx-summary-confetti cx-summary-confetti-3"></span>
                    <span class="cx-summary-confetti cx-summary-confetti-4"></span>
                    <span class="cx-summary-trophy-wrap">${ICON_TROPHY}</span>
                </div>
            ` : ''}
            <div class="cx-summary-title">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="cx-summary-subtitle">${escapeHtml(subtitle)}</div>` : ''}
            ${gridHtml}
            <div class="cx-summary-breakdown">
                ${breakdownHtml}
                <div class="cx-summary-line cx-summary-total">
                    <span>Total Score</span>
                    <span>+${totalPoints.toLocaleString()}</span>
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

    overlay.querySelector('#cx-summary-close').addEventListener('click', () => close());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);

    /** Marks just this one option as claimed -- the other option (if any) stays fully clickable. */
    function markClaimed(btn) {
        btn.disabled = true;
        btn.classList.add('cx-share-option-claimed');
        const sideEl = btn.querySelector('.cx-share-option-side');
        if (sideEl) sideEl.innerHTML = ICON_CHECK;
        const descEl = btn.querySelector('.cx-share-option-desc');
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
            const totalEl = overlay.querySelector('.cx-summary-total span:last-child');
            if (totalEl) totalEl.textContent = `+${result.newScore}`;
            markClaimed(btn);
        }
    }

    const communityBtn = overlay.querySelector('#cx-share-community-btn');
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

    const friendsBtn = overlay.querySelector('#cx-share-friends-btn');
    if (friendsBtn && onShareFriends) {
        friendsBtn.addEventListener('click', async () => {
            const shared = await shareUrl(shareLink, shareText);
            if (!shared) return;
            await applyShare(friendsBtn, onShareFriends);
        });
    }
}
