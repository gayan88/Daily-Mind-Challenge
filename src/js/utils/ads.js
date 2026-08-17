import { getConfig } from './config.js';
import { escapeHtml } from './helpers.js';

// Single source of truth for every ad slot in the app -- both the admin panel (which needs the
// full list + labels to render a form per slot) and applyAdSlots() (which just needs the current
// settings) import from here.
// `group` is used purely to organize the admin panel's collapsible sections (General/
// Advertisements/Game-wise) -- it has no bearing on how applyAdSlots() renders a slot.
export const AD_SLOTS = [
    { id: 'home-1', label: 'Home Page — Ad 1', group: 'home' },
    { id: 'home-2', label: 'Home Page — Ad 2', group: 'home' },
    { id: 'home-3', label: 'Home Page — Ad 3', group: 'home' },
    { id: 'wordle-top', label: 'Wordle — Top', group: 'wordle' },
    { id: 'wordle-bottom', label: 'Wordle — Bottom', group: 'wordle' },
    { id: 'sudoku-top', label: 'Sudoku — Top', group: 'sudoku' },
    { id: 'sudoku-bottom', label: 'Sudoku — Bottom', group: 'sudoku' },
    { id: 'wordsearch-top', label: 'Word Search — Top', group: 'wordsearch' },
    { id: 'wordsearch-bottom', label: 'Word Search — Bottom', group: 'wordsearch' },
];

function defaultSlotSettings() {
    return { enabled: true, type: 'google', imageUrl: '', linkUrl: '' };
}

export const DEFAULT_ADS_CONFIG = {
    description: 'Per-slot ad settings -- enabled, type (google placeholder or manual image+link), imageUrl, linkUrl.',
    slots: Object.fromEntries(AD_SLOTS.map((s) => [s.id, defaultSlotSettings()])),
};

/**
 * Applies admin-configured ad settings to every [data-ad-slot="<id>"] element under `root`.
 * Disabled slots are hidden entirely. "google" slots (or "image" slots with no imageUrl set yet)
 * are left showing their static placeholder markup already in the HTML -- there's no real AdSense
 * integration, so that placeholder is the honest default. "image" slots with a URL set get
 * rewritten into a linked ad image.
 */
export async function applyAdSlots(root = document) {
    const els = root.querySelectorAll('[data-ad-slot]');
    if (els.length === 0) return;

    const { slots } = await getConfig('ads', DEFAULT_ADS_CONFIG);

    els.forEach((el) => {
        const slotId = el.getAttribute('data-ad-slot');
        const slot = slots?.[slotId] || defaultSlotSettings();

        el.hidden = !slot.enabled;
        if (!slot.enabled) return;

        if (slot.type === 'image' && slot.imageUrl) {
            el.classList.add('ad-image');
            el.innerHTML = `<a href="${escapeHtml(slot.linkUrl || '#')}" target="_blank" rel="noopener noreferrer sponsored"><img src="${escapeHtml(slot.imageUrl)}" alt="Advertisement"></a>`;
        } else {
            el.classList.remove('ad-image');
        }
    });
}
