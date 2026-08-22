import { escapeHtml } from '../../utils/helpers.js';

/**
 * Shared post-round popup for Word Search's Daily Challenge and Classic modes: points breakdown
 * and an optional Facebook share button. No colored-grid visualization (unlike Wordle's summary
 * modal) since Word Search has no per-guess history to render. Builds its own DOM and
 * appends/removes it from document.body, so callers don't need any modal markup of their own in
 * wordsearch.html beyond loading wordsearch.css.
 *
 * Tournament mode does NOT use this per-puzzle (it shows a lighter inline pass/fail message
 * instead, mirroring Sudoku Tournament's own inline per-puzzle state) -- it reuses this same
 * modal once, for the final run summary after all puzzles have been attempted.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {{label: string, points: number}[]} opts.breakdown - only entries with points > 0 shown, except the total
 * @param {number} opts.totalPoints
 * @param {string} [opts.shareText] - if set, a Facebook share button is shown
 * @param {boolean} [opts.alreadyShared]
 * @param {() => Promise<{applied: boolean, newScore: number}>} [opts.onShare]
 * @param {(newScore?: number) => void} [opts.onClose]
 */
export function showWordSearchSummaryModal({
    title,
    subtitle = '',
    breakdown = [],
    totalPoints,
    shareText = '',
    alreadyShared = false,
    onShare = null,
    onClose = null,
}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'wordsearch-summary-modal';

    const breakdownHtml = breakdown
        .filter((line) => line.points > 0)
        .map((line) => `
            <div class="wordsearch-summary-line">
                <span>${escapeHtml(line.label)}</span>
                <span>+${line.points}</span>
            </div>
        `).join('');

    overlay.innerHTML = `
        <div class="modal-dialog wordsearch-summary-dialog">
            <button class="modal-close" id="wordsearch-summary-close" type="button" aria-label="Close">&times;</button>
            <div class="wordsearch-summary-title">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="wordsearch-summary-subtitle">${escapeHtml(subtitle)}</div>` : ''}
            <div class="wordsearch-summary-breakdown">
                ${breakdownHtml}
                <div class="wordsearch-summary-line wordsearch-summary-total">
                    <span>Total</span>
                    <span>+${totalPoints}</span>
                </div>
            </div>
            ${shareText ? `
                <button class="btn primary wordsearch-summary-share" id="wordsearch-summary-share-btn" type="button" ${alreadyShared ? 'disabled' : ''}>
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

    overlay.querySelector('#wordsearch-summary-close').addEventListener('click', () => close());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);

    const shareBtn = overlay.querySelector('#wordsearch-summary-share-btn');
    if (shareBtn && onShare) {
        shareBtn.addEventListener('click', async () => {
            const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(shareText)}`;
            window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500');
            const result = await onShare();
            if (result && result.applied) {
                shareBtn.disabled = true;
                shareBtn.textContent = 'Shared to Facebook';
                const totalEl = overlay.querySelector('.wordsearch-summary-total span:last-child');
                if (totalEl) totalEl.textContent = `+${result.newScore}`;
            }
        });
    }
}
