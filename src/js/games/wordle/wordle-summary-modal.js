import { escapeHtml } from '../../utils/helpers.js';

/**
 * Shared post-round popup for all three Wordle modes (daily challenge, tournaments, user
 * challenges): points breakdown, a colored-square grid of the round's guesses, and an optional
 * Facebook share button. Builds its own DOM and appends/removes it from document.body, so callers
 * don't need any modal markup of their own in wordle.html beyond loading wordle.css.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {string[][]} opts.guessStates - per-guess 'correct'|'present'|'absent' arrays
 * @param {{label: string, points: number}[]} opts.breakdown - only entries with points > 0 shown, except the total
 * @param {number} opts.totalPoints
 * @param {string} [opts.shareText] - if set, a Facebook share button is shown
 * @param {boolean} [opts.alreadyShared]
 * @param {() => Promise<{applied: boolean, newScore: number}>} [opts.onShare]
 * @param {(newScore?: number) => void} [opts.onClose]
 */
export function showWordleSummaryModal({
    title,
    subtitle = '',
    guessStates = [],
    breakdown = [],
    totalPoints,
    shareText = '',
    alreadyShared = false,
    onShare = null,
    onClose = null,
}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'wordle-summary-modal';

    const gridHtml = guessStates.map((row) => `
        <div class="wordle-summary-row">
            ${row.map((state) => `<div class="wordle-summary-cell" data-state="${state}"></div>`).join('')}
        </div>
    `).join('');

    const breakdownHtml = breakdown
        .filter((line) => line.points > 0)
        .map((line) => `
            <div class="wordle-summary-line">
                <span>${escapeHtml(line.label)}</span>
                <span>+${line.points}</span>
            </div>
        `).join('');

    overlay.innerHTML = `
        <div class="modal-dialog wordle-summary-dialog">
            <button class="modal-close" id="wordle-summary-close" type="button" aria-label="Close">&times;</button>
            <div class="wordle-summary-title">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="wordle-summary-subtitle">${escapeHtml(subtitle)}</div>` : ''}
            ${gridHtml ? `<div class="wordle-summary-grid">${gridHtml}</div>` : ''}
            <div class="wordle-summary-breakdown">
                ${breakdownHtml}
                <div class="wordle-summary-line wordle-summary-total">
                    <span>Total</span>
                    <span>+${totalPoints}</span>
                </div>
            </div>
            ${shareText ? `
                <button class="btn primary wordle-summary-share" id="wordle-summary-share-btn" type="button" ${alreadyShared ? 'disabled' : ''}>
                    ${alreadyShared ? 'Shared to Facebook' : 'Share to Facebook (+20)'}
                </button>
            ` : ''}
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

    const shareBtn = overlay.querySelector('#wordle-summary-share-btn');
    if (shareBtn && onShare) {
        shareBtn.addEventListener('click', async () => {
            const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(shareText)}`;
            window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500');
            const result = await onShare();
            if (result && result.applied) {
                shareBtn.disabled = true;
                shareBtn.textContent = 'Shared to Facebook';
                const totalEl = overlay.querySelector('.wordle-summary-total span:last-child');
                if (totalEl) totalEl.textContent = `+${result.newScore}`;
            }
        });
    }
}
