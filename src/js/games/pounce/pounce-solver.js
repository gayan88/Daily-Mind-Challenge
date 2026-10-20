/**
 * Pounce (Star Battle-style) solver. Pure logic -- no DOM, no Firebase -- so the generator, the
 * admin validator and the engine can all share it.
 *
 * A puzzle here is `{ size, regions, dogs, pawprints }`:
 *   - `regions`: `size` digit strings, one digit (0..size-1) per cell = the cell's region.
 *   - `dogs`: `[{ x, y }]` -- cells no cat may nap on (Medium and up; may be empty).
 *   - `pawprints`: `[{ x, y, n }]` -- an empty cell showing how many of its 8 neighbours hold a cat
 *     (Hard; may be empty). A pawprint cell never holds a cat itself.
 * A solution is `cats[row] = column`. The rules: one cat per row, column and region, and no two
 * cats touching, not even diagonally. Objects and flat arrays only (Firestore can't store arrays
 * of arrays).
 */

/** Flat cell index helpers shared by the generator, logic solver and engine. */
export const cellIndex = (size, x, y) => y * size + x;

/** `regions` digit strings -> Int8Array of region ids, one per cell (row-major). */
export function regionGrid({ size, regions }) {
    const grid = new Int8Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) grid[y * size + x] = regions[y].charCodeAt(x) - 48;
    }
    return grid;
}

/** Up to 8 neighbour indices of a cell. */
export function neighbours(size, idx) {
    const x = idx % size;
    const y = (idx - x) / size;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < size && ny < size) out.push(ny * size + nx);
        }
    }
    return out;
}

/** Cells a cat may never use: dogs and pawprints. Uint8Array, 1 = blocked. */
export function blockedGrid({ size, dogs = [], pawprints = [] }) {
    const blocked = new Uint8Array(size * size);
    dogs.forEach((d) => { blocked[d.y * size + d.x] = 1; });
    pawprints.forEach((p) => { blocked[p.y * size + p.x] = 1; });
    return blocked;
}

/**
 * Counts solutions, stopping at `limit` (2 is enough to answer "is it unique?"), and returns the
 * ones it found as `cats` arrays. `maxSteps` bounds the search so a bad import can't freeze the
 * admin page -- `exhausted: true` means the answer is unknown.
 *
 * Search: one row at a time (the row's cat must differ in column and region from the rows above,
 * and sit at least 2 columns from the previous row's cat). Prunes when a pawprint is over its
 * count or can no longer reach it, or when a region still without a cat has no free cell left in
 * the remaining rows.
 */
export function solve(puzzle, { limit = 2, maxSteps = 2_000_000 } = {}) {
    const { size, pawprints = [] } = puzzle;
    const region = regionGrid(puzzle);
    const blocked = blockedGrid(puzzle);
    const usedCol = new Uint8Array(size);
    const usedRegion = new Uint8Array(size);
    const cats = new Int8Array(size).fill(-1);
    const pawCount = new Int8Array(pawprints.length);
    // Pawprints touching each cell, and the last row whose cat can still reach each pawprint.
    const pawsAt = Array.from({ length: size * size }, () => []);
    pawprints.forEach((p, i) => neighbours(size, p.y * size + p.x).forEach((idx) => pawsAt[idx].push(i)));
    const solutions = [];
    let steps = 0;
    let exhausted = false;

    function regionsReachable(fromRow) {
        const reach = new Uint8Array(size);
        for (let y = fromRow; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = y * size + x;
                if (!blocked[idx] && !usedCol[x]) reach[region[idx]] = 1;
            }
        }
        for (let r = 0; r < size; r++) if (!usedRegion[r] && !reach[r]) return false;
        return true;
    }

    function pawprintsOk(row) {
        // Every pawprint whose neighbourhood is fully decided (its last row, p.y + 1 or the board's
        // bottom row, is done) must match exactly; the rest must not be over, and must still be
        // reachable.
        for (let i = 0; i < pawprints.length; i++) {
            const p = pawprints[i];
            const lastRow = Math.min(p.y + 1, size - 1);
            if (pawCount[i] > p.n) return false;
            if (lastRow <= row && pawCount[i] !== p.n) return false;
            const rowsLeft = Math.max(0, lastRow - row);
            if (pawCount[i] + rowsLeft < p.n) return false;
        }
        return true;
    }

    function dfs(y) {
        if (solutions.length >= limit || exhausted) return;
        if (++steps > maxSteps) { exhausted = true; return; }
        if (y === size) { solutions.push(Array.from(cats)); return; }
        const prev = y > 0 ? cats[y - 1] : -9;
        for (let x = 0; x < size; x++) {
            const idx = y * size + x;
            const r = region[idx];
            if (usedCol[x] || usedRegion[r] || blocked[idx] || Math.abs(x - prev) <= 1) continue;
            cats[y] = x; usedCol[x] = 1; usedRegion[r] = 1;
            pawsAt[idx].forEach((i) => { pawCount[i]++; });
            if (pawprintsOk(y) && regionsReachable(y + 1)) dfs(y + 1);
            pawsAt[idx].forEach((i) => { pawCount[i]--; });
            cats[y] = -1; usedCol[x] = 0; usedRegion[r] = 0;
            if (solutions.length >= limit || exhausted) return;
        }
    }

    dfs(0);
    return { count: solutions.length, solutions, exhausted };
}

/** True only when the puzzle provably has exactly one solution. */
export function hasUniqueSolution(puzzle, options) {
    const result = solve(puzzle, { ...options, limit: 2 });
    return result.count === 1 && !result.exhausted;
}

/**
 * Rules-only check of a full set of cats (`cats[row] = column`). Returns a list of
 * human-readable problems; empty = every rule holds. Used by the validator and tests.
 */
export function ruleProblems(puzzle, cats) {
    const { size, pawprints = [] } = puzzle;
    const region = regionGrid(puzzle);
    const blocked = blockedGrid(puzzle);
    const problems = [];
    if (!Array.isArray(cats) || cats.length !== size) return [`needs ${size} cats, one per row`];
    const cols = new Set();
    const regs = new Set();
    const catAt = new Uint8Array(size * size);
    cats.forEach((x, y) => {
        if (!Number.isInteger(x) || x < 0 || x >= size) { problems.push(`row ${y + 1}'s cat is outside the board`); return; }
        const idx = y * size + x;
        catAt[idx] = 1;
        if (cols.has(x)) problems.push(`two cats in column ${x + 1}`);
        if (regs.has(region[idx])) problems.push(`two cats in region ${region[idx] + 1}`);
        if (blocked[idx]) problems.push(`row ${y + 1}'s cat sits on a dog or pawprint`);
        if (y > 0 && Math.abs(x - cats[y - 1]) <= 1) problems.push(`the cats in rows ${y} and ${y + 1} touch`);
        cols.add(x); regs.add(region[idx]);
    });
    pawprints.forEach((p) => {
        const n = neighbours(size, p.y * size + p.x).filter((idx) => catAt[idx]).length;
        if (n !== p.n) problems.push(`the pawprint at row ${p.y + 1}, column ${p.x + 1} says ${p.n} but touches ${n} cats`);
    });
    return problems;
}
