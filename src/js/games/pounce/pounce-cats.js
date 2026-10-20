/**
 * Pounce cats: code-drawn SVG cat faces, shared by the board (one coat per row's cat, so a solved
 * board looks like a houseful of different cats) and the Cat Café (each Daily date adopts a cat).
 * Pure functions returning SVG strings -- no DOM, no Firebase -- so they also run under Node.
 *
 * Brand: round heads, half-closed "judging" eyes, charcoal outline, warm colours.
 */

import { mulberry32, stringToSeed } from '../../utils/helpers.js';

const OUTLINE = '#3a3340';

export const COATS = {
    ginger: { label: 'ginger', fur: '#F28C38', dark: '#C9651A', light: '#FBD3A8', eye: '#5C8F3A' },
    black: { label: 'black', fur: '#2E2A33', dark: '#1C1A20', light: '#4A4452', eye: '#E8C33A' },
    white: { label: 'white', fur: '#F8F4EC', dark: '#E2DACB', light: '#FFFFFF', eye: '#4D8FCC' },
    tabby: { label: 'tabby', fur: '#A68E74', dark: '#6E5A47', light: '#D8C8B4', eye: '#7A9A3A' },
    calico: { label: 'calico', fur: '#F8F4EC', dark: '#2E2A33', light: '#FFFFFF', eye: '#C98A2A' },
    grey: { label: 'grey', fur: '#8E96A3', dark: '#6A717D', light: '#C3C8D0', eye: '#E0A63A' },
};
export const COAT_IDS = Object.keys(COATS);

export const ACCESSORIES = ['none', 'bow', 'bell', 'flower', 'bandana', 'crown'];
export const EYES = ['smug', 'sleepy', 'wide'];

const NAMES = [
    'Biscuit', 'Mochi', 'Pepper', 'Nutmeg', 'Pickles', 'Waffles', 'Miso', 'Tofu', 'Clementine',
    'Pumpkin', 'Sardine', 'Noodle', 'Toast', 'Ziggy', 'Marmalade', 'Bean', 'Juniper', 'Olive',
    'Pippin', 'Muffin', 'Sesame', 'Ginger', 'Socks', 'Truffle', 'Velvet', 'Basil', 'Crumpet',
    'Dumpling', 'Fig', 'Hazel', 'Kiwi', 'Latte', 'Maple', 'Nori', 'Pudding', 'Quinoa', 'Saffron',
    'Tinker', 'Udon', 'Wasabi', 'Yuzu', 'Zuzu', 'Bramble', 'Cocoa', 'Domino', 'Ember', 'Fudge',
    'Gnocchi', 'Honey', 'Inky', 'Jellybean', 'Kipper', 'Lentil', 'Mango', 'Nacho', 'Oreo',
    'Paprika', 'Rascal', 'Smudge', 'Tapioca', 'Whiskey', 'Pretzel', 'Chai', 'Sprout',
];

/**
 * SVG markup for one cat face. `coat` is a COATS key; `eyes` and `accessory` default to the
 * board look (smug eyes, no accessory). `title` becomes the accessible name.
 */
export function catSvg({ coat = 'ginger', eyes = 'smug', accessory = 'none', title = '' } = {}) {
    const c = COATS[coat] ?? COATS.ginger;
    const parts = [];
    // Ears (outer + pink inner).
    parts.push(`<path d="M18 46 L22 10 L44 28 Z" fill="${c.fur}" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/>`);
    parts.push(`<path d="M82 46 L78 10 L56 28 Z" fill="${c.fur}" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/>`);
    parts.push('<path d="M24 38 L26 19 L38 29 Z" fill="#F4A7B4"/>');
    parts.push('<path d="M76 38 L74 19 L62 29 Z" fill="#F4A7B4"/>');
    // Head.
    parts.push(`<ellipse cx="50" cy="56" rx="36" ry="32" fill="${c.fur}" stroke="${OUTLINE}" stroke-width="3"/>`);
    parts.push(...pattern(coat, c));
    // Muzzle.
    parts.push(`<ellipse cx="50" cy="68" rx="15" ry="10" fill="${c.light}" opacity="0.9"/>`);
    parts.push(...eyeMarks(eyes, c, coat));
    // Nose, mouth, whiskers.
    parts.push('<path d="M45.5 62 L54.5 62 L50 67 Z" fill="#E8798A" stroke="#B9505F" stroke-width="1" stroke-linejoin="round"/>');
    parts.push(`<path d="M50 67 Q50 72 45 72 M50 67 Q50 72 55 72" fill="none" stroke="${OUTLINE}" stroke-width="2" stroke-linecap="round"/>`);
    const whisker = coat === 'black' ? '#BDB6C4' : OUTLINE;
    parts.push(`<path d="M33 66 L14 62 M33 70 L14 72 M67 66 L86 62 M67 70 L86 72" stroke="${whisker}" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>`);
    parts.push(...accessoryMarks(accessory));
    const label = title ? `<title>${escapeXml(title)}</title>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img"${title ? '' : ' aria-hidden="true"'}>${label}${parts.join('')}</svg>`;
}

/** Board cats: a stable coat per row, so every cat on a board looks different. */
export function boardCoats(size, seed = '') {
    const rng = mulberry32(stringToSeed(`coats|${seed}`));
    const order = [...COAT_IDS];
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return Array.from({ length: size }, (_, i) => order[i % order.length]);
}

/**
 * The Cat Café cat a Daily date adopts: `{ name, coat, eyes, accessory, description }`. Same date,
 * same cat for everyone. Pass it to `catSvg()` to draw it.
 */
export function cafeCat(dateString) {
    const rng = mulberry32(stringToSeed(`cafe|${dateString}`));
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const cat = { name: pick(NAMES), coat: pick(COAT_IDS), eyes: pick(EYES), accessory: pick(ACCESSORIES) };
    const extra = cat.accessory === 'none' ? '' : ` with a ${cat.accessory}`;
    cat.description = `${cat.name} the ${COATS[cat.coat].label} cat${extra}`;
    return cat;
}

// ---------------------------------------------------------------------------------------------

function pattern(coat, c) {
    if (coat === 'ginger' || coat === 'tabby') {
        // Forehead stripes + cheek stripes.
        return [
            `<path d="M50 26 L50 38 M42 28 L44 37 M58 28 L56 37" stroke="${c.dark}" stroke-width="3.5" stroke-linecap="round"/>`,
            `<path d="M16 54 L26 56 M16 61 L25 61 M84 54 L74 56 M84 61 L75 61" stroke="${c.dark}" stroke-width="3" stroke-linecap="round"/>`,
        ];
    }
    if (coat === 'calico') {
        return [
            '<path d="M22 34 Q34 24 46 28 Q44 44 30 48 Q20 46 22 34 Z" fill="#F28C38"/>',
            '<path d="M60 26 Q74 26 80 40 Q72 48 62 42 Q56 34 60 26 Z" fill="#2E2A33"/>',
        ];
    }
    if (coat === 'white') return [`<path d="M40 30 Q50 26 60 30" stroke="${c.dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`];
    if (coat === 'grey') return [`<path d="M44 27 L46 36 M56 27 L54 36" stroke="${c.dark}" stroke-width="3" stroke-linecap="round"/>`];
    return [];
}

function eyeMarks(eyes, c, coat) {
    if (eyes === 'sleepy') {
        const line = coat === 'black' ? '#BDB6C4' : OUTLINE;
        return [`<path d="M28 52 Q35 57 42 52 M58 52 Q65 57 72 52" fill="none" stroke="${line}" stroke-width="3" stroke-linecap="round"/>`];
    }
    const iris = (cx) => `<ellipse cx="${cx}" cy="51" rx="7" ry="${eyes === 'wide' ? 8 : 6.5}" fill="${c.eye}" stroke="${OUTLINE}" stroke-width="2"/>`
        + `<ellipse cx="${cx}" cy="51.5" rx="2" ry="${eyes === 'wide' ? 6 : 4.5}" fill="#1C1A20"/>`
        + `<circle cx="${cx + 2.2}" cy="48.5" r="1.4" fill="#fff"/>`;
    const out = [iris(35), iris(65)];
    if (eyes === 'smug') {
        // Heavy upper lids: the half-closed "judging" look.
        out.push(`<path d="M27 50 Q35 41 43 50 Z M57 50 Q65 41 73 50 Z" fill="${c.fur}" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/>`);
    }
    return out;
}

function accessoryMarks(accessory) {
    switch (accessory) {
    case 'bow':
        return ['<path d="M66 22 L80 14 L80 30 Z M66 22 L54 13 L55 30 Z" fill="#E8556D" stroke="#3a3340" stroke-width="2" stroke-linejoin="round"/><circle cx="66" cy="22" r="3.5" fill="#C23B55"/>'];
    case 'bell':
        return ['<path d="M30 86 Q50 94 70 86" stroke="#D9433F" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="50" cy="92" r="5" fill="#F2C230" stroke="#3a3340" stroke-width="1.6"/>'];
    case 'flower':
        return ['<g transform="translate(28 24)"><circle r="4" cx="0" cy="-5" fill="#F7A1C4"/><circle r="4" cx="5" cy="0" fill="#F7A1C4"/><circle r="4" cx="0" cy="5" fill="#F7A1C4"/><circle r="4" cx="-5" cy="0" fill="#F7A1C4"/><circle r="3" fill="#F2C230"/></g>'];
    case 'bandana':
        return ['<path d="M24 80 Q50 92 76 80 L50 99 Z" fill="#3E7CC9" stroke="#3a3340" stroke-width="2" stroke-linejoin="round"/>'];
    case 'crown':
        return ['<path d="M38 26 L38 12 L44 19 L50 9 L56 19 L62 12 L62 26 Z" fill="#F2C230" stroke="#3a3340" stroke-width="2" stroke-linejoin="round"/>'];
    default:
        return [];
    }
}

function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}
