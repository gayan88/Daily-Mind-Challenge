/**
 * Quilt (Shikaku-style) solver. Pure logic -- no DOM, no Firebase -- so the generator, the admin
 * importer's validator and the engine's completion check can all share it.
 *
 * A puzzle here is `{ width, height, clues, blockers }`:
 *   - `clues`: `[{ x, y, n, shape? }]` -- `n` is the area of the rectangle that must contain this
 *     cell; optional `shape` is `'square'` (w === h) or `'strip'` (w === 1 or h === 1), Hard mode only.
 *   - `blockers`: `[{ x, y }]` -- cells no rectangle may cover (Hard mode only; may be empty).
 * Rectangles are `{ x, y, w, h }`. Objects rather than nested arrays throughout, because Firestore
 * can't store arrays of arrays.
 */

export function shapeAllows(shape, w, h) {
    if (shape === 'square') return w === h;
    if (shape === 'strip') return w === 1 || h === 1;
    return true;
}

/**
 * Every rectangle each clue could legally become: right area, inside the grid, matching its shape
 * clue, containing no blocker and no other clue. Returns one array per clue (same order as
 * `puzzle.clues`), each entry `{ rect, cells }` where `cells` is an array of flat cell indices.
 */
export function candidateRects({ width, height, clues, blockers = [] }) {
    const clueAt = new Int32Array(width * height).fill(-1);
    clues.forEach((c, i) => { clueAt[c.y * width + c.x] = i; });
    const blocked = new Uint8Array(width * height);
    blockers.forEach((b) => { blocked[b.y * width + b.x] = 1; });

    return clues.map((clue, ci) => {
        const options = [];
        for (let w = 1; w <= clue.n; w++) {
            if (clue.n % w !== 0) continue;
            const h = clue.n / w;
            if (w > width || h > height || !shapeAllows(clue.shape, w, h)) continue;
            for (let x = Math.max(0, clue.x - w + 1); x <= Math.min(clue.x, width - w); x++) {
                for (let y = Math.max(0, clue.y - h + 1); y <= Math.min(clue.y, height - h); y++) {
                    const cells = [];
                    let ok = true;
                    for (let yy = y; yy < y + h && ok; yy++) {
                        for (let xx = x; xx < x + w; xx++) {
                            const idx = yy * width + xx;
                            if (blocked[idx] || (clueAt[idx] !== -1 && clueAt[idx] !== ci)) { ok = false; break; }
                            cells.push(idx);
                        }
                    }
                    if (ok) options.push({ rect: { x, y, w, h }, cells });
                }
            }
        }
        return options;
    });
}

/**
 * Counts solutions, stopping at `limit` (2 is enough to answer "is it unique?"). Also returns the
 * first solution found, as rects in clue order. `maxSteps` bounds the search so a pathological
 * picture can't freeze the admin page -- `exhausted: true` means the answer is unknown.
 *
 * Search: at every step, place the unplaced clue with the fewest still-possible rectangles (fail
 * fast when one hits zero), and prune when some uncovered, unblocked cell can no longer be covered
 * by any remaining clue's candidates.
 */
export function solve(puzzle, { limit = 2, maxSteps = 2_000_000 } = {}) {
    const { width, height, clues, blockers = [] } = puzzle;
    const cellCount = width * height;
    const cands = candidateRects(puzzle);
    const used = new Uint8Array(cellCount);
    blockers.forEach((b) => { used[b.y * width + b.x] = 1; });

    const totalArea = clues.reduce((sum, c) => sum + c.n, 0);
    if (totalArea + blockers.length !== cellCount || cands.some((list) => list.length === 0)) {
        return { count: 0, solution: null, exhausted: false };
    }

    const placed = new Array(clues.length).fill(null);
    const remaining = new Set(clues.map((_, i) => i));
    let count = 0;
    let solution = null;
    let steps = 0;
    let exhausted = false;

    const fits = (cells) => cells.every((idx) => !used[idx]);

    function everyCellCoverable() {
        const coverable = new Uint8Array(cellCount);
        for (const ci of remaining) {
            for (const opt of cands[ci]) {
                if (fits(opt.cells)) opt.cells.forEach((idx) => { coverable[idx] = 1; });
            }
        }
        for (let idx = 0; idx < cellCount; idx++) {
            if (!used[idx] && !coverable[idx]) return false;
        }
        return true;
    }

    function dfs() {
        if (count >= limit || exhausted) return;
        if (++steps > maxSteps) { exhausted = true; return; }
        if (remaining.size === 0) {
            count++;
            if (!solution) solution = placed.map((opt) => ({ ...opt.rect }));
            return;
        }
        let best = -1;
        let bestOptions = null;
        for (const ci of remaining) {
            const options = cands[ci].filter((opt) => fits(opt.cells));
            if (options.length === 0) return;
            if (!bestOptions || options.length < bestOptions.length) {
                best = ci;
                bestOptions = options;
                if (options.length === 1) break;
            }
        }
        if (bestOptions.length > 1 && !everyCellCoverable()) return;

        remaining.delete(best);
        for (const opt of bestOptions) {
            opt.cells.forEach((idx) => { used[idx] = 1; });
            placed[best] = opt;
            dfs();
            opt.cells.forEach((idx) => { used[idx] = 0; });
            if (count >= limit || exhausted) break;
        }
        placed[best] = null;
        remaining.add(best);
    }

    dfs();
    return { count, solution, exhausted };
}

/** True only when the puzzle provably has exactly one solution. */
export function hasUniqueSolution(puzzle, options) {
    const result = solve(puzzle, { ...options, limit: 2 });
    return result.count === 1 && !result.exhausted;
}

/**
 * Checks a player's board against the rules (not against a stored answer -- any valid tiling
 * wins, and generated puzzles only have one anyway). Returns `{ solved, rectErrors }` where
 * `rectErrors[i]` is null for a valid rectangle or `'no-clue' | 'many-clues' | 'wrong-area' |
 * 'wrong-shape' | 'blocked'` for one the engine should highlight.
 */
export function checkBoard({ width, height, clues, blockers = [] }, rects) {
    const owner = new Int32Array(width * height).fill(-1);
    const blocked = new Uint8Array(width * height);
    blockers.forEach((b) => { blocked[b.y * width + b.x] = 1; });
    let overlap = false;

    const rectErrors = rects.map((r, ri) => {
        const inside = clues.filter((c) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h);
        let hitsBlocker = false;
        for (let y = r.y; y < r.y + r.h; y++) {
            for (let x = r.x; x < r.x + r.w; x++) {
                const idx = y * width + x;
                if (blocked[idx]) hitsBlocker = true;
                if (owner[idx] !== -1) overlap = true;
                owner[idx] = ri;
            }
        }
        if (hitsBlocker) return 'blocked';
        if (inside.length === 0) return 'no-clue';
        if (inside.length > 1) return 'many-clues';
        if (inside[0].n !== r.w * r.h) return 'wrong-area';
        if (!shapeAllows(inside[0].shape, r.w, r.h)) return 'wrong-shape';
        return null;
    });

    const covered = owner.every((o, idx) => o !== -1 || blocked[idx]);
    const solved = !overlap && covered && rectErrors.every((e) => e === null);
    return { solved, rectErrors };
}
