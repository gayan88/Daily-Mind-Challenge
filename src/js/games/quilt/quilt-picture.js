/**
 * Quilt picture helpers: turning admin input (text grids or a PNG's pixels) into
 * `{ palette, pixels }`, and turning a picture into the emoji mosaic used in share text.
 * Pure logic -- no DOM, no Firebase.
 *
 * A picture is `palette` (hex colours, index = digit) plus `pixels` (one string per row, one digit
 * per cell). Strings rather than nested arrays because Firestore can't store arrays of arrays.
 */

export const MAX_COLOURS = 8;
const HEX = /^#[0-9a-f]{6}$/;

/**
 * Parses the admin text-import format: blocks separated by a blank line, each with `key: value`
 * header lines followed by the digit rows, e.g.
 *
 *     title: Pumpkin
 *     difficulty: medium
 *     palette: #1f2a44 #ff8a1f #3fa34d #3b1f0e
 *     0000220000
 *     ...
 *
 * Returns `[{ title, difficulty, palette, pixels, line }]` (`line` = 1-based line the block starts
 * on, for error messages). Doesn't validate -- see quilt-generator.js#validatePicture.
 */
export function parsePictureBlocks(text) {
    const blocks = [];
    let current = null;
    text.split(/\r?\n/).forEach((raw, i) => {
        const line = raw.trim();
        if (!line) { current = null; return; }
        if (!current) {
            current = { title: '', difficulty: '', palette: [], pixels: [], line: i + 1 };
            blocks.push(current);
        }
        const header = line.match(/^(title|difficulty|palette)\s*:\s*(.*)$/i);
        if (header) {
            const key = header[1].toLowerCase();
            const value = header[2].trim();
            if (key === 'palette') current.palette = value.split(/[\s,]+/).filter(Boolean).map((c) => c.toLowerCase());
            else if (key === 'difficulty') current.difficulty = value.toLowerCase();
            else current.title = value;
        } else {
            current.pixels.push(line.replace(/\s+/g, ''));
        }
    });
    return blocks;
}

function toHex(r, g, b) {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Builds a picture from canvas ImageData-shaped input (`{ width, height, data }`, RGBA bytes),
 * where 1 image pixel = 1 grid cell. Transparent pixels (alpha < 128) become white. Colours are
 * numbered in order of first appearance. Throws if the image has more than MAX_COLOURS colours --
 * usually a sign of anti-aliasing or a picture that wasn't drawn at 1 pixel per cell.
 */
export function pictureFromImageData({ width, height, data }) {
    const palette = [];
    const pixels = [];
    for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const hex = data[i + 3] < 128 ? '#ffffff' : toHex(data[i], data[i + 1], data[i + 2]);
            let idx = palette.indexOf(hex);
            if (idx === -1) {
                palette.push(hex);
                idx = palette.length - 1;
                if (palette.length > MAX_COLOURS) {
                    throw new Error(`Image has more than ${MAX_COLOURS} colours -- draw it at 1 pixel per cell with no smoothing/anti-aliasing.`);
                }
            }
            row += String(idx);
        }
        pixels.push(row);
    }
    return { palette, pixels };
}

/** Basic shape checks for a picture; returns a list of human-readable problems (empty = OK). */
export function pictureProblems({ palette, pixels }, { minSize = 5, maxSize = 20 } = {}) {
    const problems = [];
    if (!Array.isArray(palette) || palette.length < 2) problems.push('palette needs at least 2 colours');
    else if (palette.length > MAX_COLOURS) problems.push(`palette has ${palette.length} colours (max ${MAX_COLOURS})`);
    else palette.forEach((c) => { if (!HEX.test(c)) problems.push(`"${c}" is not a #rrggbb colour`); });

    if (!Array.isArray(pixels) || pixels.length === 0) {
        problems.push('no pixel rows');
        return problems;
    }
    const width = pixels[0].length;
    const height = pixels.length;
    if (width < minSize || width > maxSize || height < minSize || height > maxSize) {
        problems.push(`grid is ${width}×${height} (each side must be ${minSize}–${maxSize})`);
    }
    pixels.forEach((row, y) => {
        if (row.length !== width) problems.push(`row ${y + 1} has ${row.length} cells, expected ${width}`);
        for (const ch of row) {
            if (!/[0-9]/.test(ch) || Number(ch) >= (palette?.length ?? 0)) {
                problems.push(`row ${y + 1} uses "${ch}", which isn't a palette index`);
                break;
            }
        }
    });
    return problems;
}

function hexToHsl(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
}

/**
 * Maps a colour to one of the 9 emoji squares available in share text. Hue-based rather than
 * nearest-RGB: plain RGB distance sends dark greens/blues to ⬛, which reads wrong in a mosaic.
 */
export function nearestEmoji(hex) {
    const [h, s, l] = hexToHsl(hex);
    if (l < 0.13) return '⬛';
    if (l > 0.9) return '⬜';
    if (s < 0.18) return l < 0.5 ? '⬛' : '⬜';
    if (h >= 12 && h < 45 && l < 0.4) return '🟫';
    if (h >= 30 && h < 70 && l > 0.72) return '🟨';
    if (h < 12 || h >= 330) return '🟥';
    if (h < 45) return '🟧';
    if (h < 70) return '🟨';
    if (h < 170) return '🟩';
    if (h < 255) return '🟦';
    return '🟪';
}

/**
 * The picture as rows of emoji squares, downscaled so neither side exceeds `maxCells` (share text
 * has to stay readable in a Facebook post). Each output square takes the most common colour of the
 * cells it covers.
 */
export function pictureToEmojiRows({ palette, pixels }, maxCells = 7) {
    const height = pixels.length;
    const width = pixels[0].length;
    const scale = Math.max(1, Math.ceil(Math.max(width, height) / maxCells));
    const emoji = palette.map(nearestEmoji);
    const rows = [];
    for (let y0 = 0; y0 < height; y0 += scale) {
        let row = '';
        for (let x0 = 0; x0 < width; x0 += scale) {
            const counts = new Map();
            for (let y = y0; y < Math.min(y0 + scale, height); y++) {
                for (let x = x0; x < Math.min(x0 + scale, width); x++) {
                    const d = pixels[y][x];
                    counts.set(d, (counts.get(d) ?? 0) + 1);
                }
            }
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
            row += emoji[Number(top)];
        }
        rows.push(row);
    }
    return rows;
}
