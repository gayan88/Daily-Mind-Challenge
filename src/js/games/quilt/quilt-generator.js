/**
 * Quilt puzzle generator + validator: picture in, uniquely-solvable puzzle out. Pure logic -- no
 * DOM, no Firebase -- runs in the admin page's browser tab when content is imported, so there's no
 * local script for anyone to run.
 *
 * Pipeline (generatePuzzle):
 *   1. Split each colour region of the picture into rectangles (largest first, capped at the
 *      difficulty's max area, random tie-breaks), so every rectangle is a single colour and the
 *      solved board *is* the picture.
 *   2. Hard mode: 1×1 rectangles become blockers (cells nobody covers) instead of dull "1" clues,
 *      and some rectangles get a shape clue (square / strip).
 *   3. Put one clue in a random cell of each rectangle.
 *   4. Keep it only if quilt-solver.js proves exactly one solution; otherwise re-place clues, and
 *      after enough failures re-split the picture.
 *
 * Seeded (`seed` string -> mulberry32), so the same picture + seed always gives the same puzzle.
 */

import { mulberry32, stringToSeed } from '../../utils/helpers.js';
import { solve } from './quilt-solver.js';
import { pictureProblems } from './quilt-picture.js';

export const DIFFICULTIES = {
    easy: { label: 'Easy', size: 7, maxArea: 8, blockers: false, shapeClues: false },
    medium: { label: 'Medium', size: 10, maxArea: 12, blockers: false, shapeClues: false },
    hard: { label: 'Hard', size: 14, maxArea: 16, blockers: true, shapeClues: true },
};

const SOLVER_STEPS = 300_000;

/** Greedy single-colour rectangle split. Returns `[{ x, y, w, h }]` covering every cell once. */
export function splitPicture(pixels, maxArea, rng) {
    const height = pixels.length;
    const width = pixels[0].length;
    const covered = Array.from({ length: height }, () => new Array(width).fill(false));
    const rects = [];

    for (;;) {
        let bestArea = 0;
        let best = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (covered[y][x]) continue;
                const colour = pixels[y][x];
                // Widest run of free same-colour cells along each row from (x, y), narrowing as h grows.
                let maxW = width - x;
                for (let h = 1; y + h <= height; h++) {
                    let w = 0;
                    while (w < maxW && !covered[y + h - 1][x + w] && pixels[y + h - 1][x + w] === colour) w++;
                    if (w === 0) break;
                    maxW = w;
                    for (let ww = 1; ww <= w; ww++) {
                        const area = ww * h;
                        if (area > maxArea) break;
                        if (area > bestArea) { bestArea = area; best = []; }
                        if (area === bestArea) best.push({ x, y, w: ww, h });
                    }
                }
            }
        }
        if (best.length === 0) return rects;
        const pick = best[Math.floor(rng() * best.length)];
        for (let yy = pick.y; yy < pick.y + pick.h; yy++) {
            for (let xx = pick.x; xx < pick.x + pick.w; xx++) covered[yy][xx] = true;
        }
        rects.push(pick);
    }
}

function shapeFor(rect) {
    if (rect.w === rect.h && rect.w >= 2) return 'square';
    if ((rect.w === 1 || rect.h === 1) && rect.w * rect.h >= 3) return 'strip';
    return null;
}

/**
 * Generates a puzzle from a picture. Returns
 * `{ title, difficulty, width, height, palette, pixels, rects, clues, blockers }` or throws an Error
 * whose message is safe to show the admin.
 */
export function generatePuzzle({ title = '', difficulty = 'medium', palette, pixels, seed = '' }, { splits = 30, placementsPerSplit = 25 } = {}) {
    const settings = DIFFICULTIES[difficulty];
    if (!settings) throw new Error(`unknown difficulty "${difficulty}" (use easy, medium or hard)`);
    const problems = pictureProblems({ palette, pixels });
    if (problems.length) throw new Error(problems.join('; '));

    const width = pixels[0].length;
    const height = pixels.length;
    const rng = mulberry32(stringToSeed(`${seed}|${title}|${difficulty}|${pixels.join('')}`));

    for (let s = 0; s < splits; s++) {
        const allRects = splitPicture(pixels, settings.maxArea, rng);
        const blockers = settings.blockers ? allRects.filter((r) => r.w * r.h === 1).map(({ x, y }) => ({ x, y })) : [];
        const rects = settings.blockers ? allRects.filter((r) => r.w * r.h > 1) : allRects;

        for (let p = 0; p < placementsPerSplit; p++) {
            // Hard mode: start with shape clues on ~30% of eligible rectangles, and add more as
            // placements keep failing -- extra shape clues are the cheapest way to force uniqueness.
            const shapeShare = settings.shapeClues ? Math.min(1, 0.3 + (p / placementsPerSplit) * 0.7) : 0;
            const clues = rects.map((r) => {
                const clue = { x: r.x + Math.floor(rng() * r.w), y: r.y + Math.floor(rng() * r.h), n: r.w * r.h };
                const shape = shapeFor(r);
                if (shape && rng() < shapeShare) clue.shape = shape;
                return clue;
            });
            const result = solve({ width, height, clues, blockers }, { limit: 2, maxSteps: SOLVER_STEPS });
            if (result.count === 1 && !result.exhausted) {
                return { title, difficulty, width, height, palette: [...palette], pixels: [...pixels], rects, clues, blockers };
            }
        }
    }
    throw new Error('couldn\'t find a uniquely-solvable layout -- try a blockier picture (fewer single-cell details)');
}

/**
 * Full check of a stored/imported puzzle. Returns a list of human-readable errors (empty = valid).
 * `checkUnique: false` skips the (slower) solver run.
 */
export function validatePuzzle(puzzle, { checkUnique = true } = {}) {
    const errors = pictureProblems(puzzle);
    if (errors.length) return errors;
    const { width, height, pixels, rects = [], clues = [], blockers = [], difficulty } = puzzle;
    if (!DIFFICULTIES[difficulty]) errors.push(`unknown difficulty "${difficulty}"`);
    if (width !== pixels[0].length || height !== pixels.length) errors.push('width/height don\'t match the pixel grid');
    if (errors.length) return errors;

    const owner = Array.from({ length: height }, () => new Array(width).fill(-1));
    const claim = (x, y, who) => {
        if (x < 0 || y < 0 || x >= width || y >= height) { errors.push(`${who} is outside the grid`); return; }
        if (owner[y][x] !== -1) errors.push(`${who} overlaps another rectangle/blocker at (${x}, ${y})`);
        owner[y][x] = who;
    };
    blockers.forEach((b, i) => claim(b.x, b.y, `blocker ${i + 1}`));
    rects.forEach((r, i) => {
        const colour = pixels[r.y]?.[r.x];
        for (let y = r.y; y < r.y + r.h; y++) {
            for (let x = r.x; x < r.x + r.w; x++) {
                claim(x, y, `rectangle ${i + 1}`);
                if (pixels[y]?.[x] !== colour) errors.push(`rectangle ${i + 1} spans more than one colour`);
            }
        }
        const inside = clues.filter((c) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h);
        if (inside.length !== 1) errors.push(`rectangle ${i + 1} contains ${inside.length} clues (needs exactly 1)`);
        else if (inside[0].n !== r.w * r.h) errors.push(`rectangle ${i + 1}'s clue says ${inside[0].n} but its area is ${r.w * r.h}`);
    });
    if (clues.length !== rects.length) errors.push(`${clues.length} clues for ${rects.length} rectangles`);
    owner.forEach((row, y) => row.forEach((o, x) => { if (o === -1) errors.push(`cell (${x}, ${y}) isn't covered`); }));
    if (errors.length) return [...new Set(errors)].slice(0, 10);

    if (checkUnique) {
        const result = solve({ width, height, clues, blockers }, { limit: 2, maxSteps: SOLVER_STEPS * 4 });
        if (result.exhausted) errors.push('solver gave up -- puzzle too ambiguous to verify');
        else if (result.count !== 1) errors.push(result.count === 0 ? 'puzzle has no solution' : 'puzzle has more than one solution');
    }
    return errors;
}

/** Soft quality warnings for the admin preview (the puzzle is still valid). */
export function puzzleWarnings({ width, height, rects, blockers = [] }) {
    const warnings = [];
    const singles = rects.filter((r) => r.w * r.h === 1).length;
    if (singles > rects.length * 0.25) warnings.push(`${singles} of ${rects.length} rectangles are single cells -- the puzzle may feel fiddly`);
    if (blockers.length > width * height * 0.12) warnings.push(`${blockers.length} blockers -- quite a lot for one board`);
    if (rects.length < (width * height) / 14) warnings.push('very few rectangles -- the puzzle may be too easy');
    return warnings;
}

/**
 * Patchwork Run builder: cuts one big picture into a `cols` × `rows` grid of tiles and generates a
 * uniquely-solvable puzzle for each (Medium rules -- no knots or shape clues, tiles are timed).
 * The picture's sides must divide evenly by `cols`/`rows`, and each tile must be 5–20 cells a
 * side. Returns `{ title, palette, pixels, width, height, cols, rows, tiles }` where `tiles` is in
 * reading order (left→right, top→bottom), each a full puzzle plus its `tileX`/`tileY` offset in
 * the big picture. Throws an admin-readable Error naming the failing tile.
 */
export function buildPatchwork({ title = '', palette, pixels, cols = 2, rows = 2, seed = '' }) {
    const problems = pictureProblems({ palette, pixels }, { minSize: 10, maxSize: 60 });
    if (problems.length) throw new Error(problems.join('; '));
    const width = pixels[0].length;
    const height = pixels.length;
    if (width % cols || height % rows) throw new Error(`a ${width}×${height} picture can't be cut into ${cols}×${rows} equal tiles`);
    const tileW = width / cols;
    const tileH = height / rows;
    if (tileW < 5 || tileH < 5 || tileW > 20 || tileH > 20) throw new Error(`tiles would be ${tileW}×${tileH} (each side must be 5–20)`);

    const tiles = [];
    for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
            const tilePixels = pixels.slice(ty * tileH, (ty + 1) * tileH).map((row) => row.slice(tx * tileW, (tx + 1) * tileW));
            try {
                const puzzle = generatePuzzle({ title: `${title} ${tiles.length + 1}`, difficulty: 'medium', palette, pixels: tilePixels, seed: `${seed}|tile${tiles.length}` });
                tiles.push({ ...puzzle, tileX: tx * tileW, tileY: ty * tileH });
            } catch (err) {
                throw new Error(`tile ${tiles.length + 1}: ${err.message}`);
            }
        }
    }
    return { title, palette: [...palette], pixels: [...pixels], width, height, cols, rows, tiles };
}
