// Single source of truth for every emoji/icon used across pages.
// Kept as explicit Unicode escapes (not pasted glyphs) so a bad copy/paste
// or editor re-encoding can never turn these into mojibake again.
export const ICONS = {
    CHECK: '✅',          // ✅
    TROPHY: '\u{1F3C6}',      // 🏆
    GEAR: '⚙️',     // ⚙️
    ARROW_RIGHT: '→',    // →
    LINK: '\u{1F517}',        // 🔗
    STAR: '⭐',           // ⭐
    FLAME: '\u{1F525}',       // 🔥 streak
    LOCK: '\u{1F512}',        // 🔒
};

export function icon(name) {
    return ICONS[name] || '';
}

/** Fills every [data-icon="NAME"] element under root with its mapped emoji via textContent. */
export function applyIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
        el.textContent = icon(el.getAttribute('data-icon'));
    });
}
