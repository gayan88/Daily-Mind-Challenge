/**
 * Pounce puzzle generator + grader + validator. Pure logic -- no DOM, no Firebase -- runs in the
 * admin page's browser tab when content is generated, so there's no local script to run.
 *
 * Pipeline (generatePuzzle):
 *   1. Place the cats: one per row and column, no two touching (random backtracking).
 *   2. Grow one region around each cat, a random cell at a time, so regions are organic blobs.
 *   3. Repair until unique: while pounce-solver.js finds a second solution, break it -- move one
 *      of its cats' cells into a neighbouring region, put a dog on it (Medium+), or add a pawprint
 *      that disagrees with it (Hard). The intended cats never move, so they stay a solution.
 *   4. Grade with pounce-logic.js (the hardest technique a full logic solve needs) and keep the
 *      puzzle only if it's solvable without guessing and its grade is inside the band.
 *
 * Seeded (`seed` string -> mulberry32), so the same seed always gives the same puzzle.
 */

import { mulberry32, stringToSeed } from '../../utils/helpers.js';
import { solve, regionGrid, neighbours, blockedGrid, ruleProblems } from './pounce-solver.js';
import { solveByLogic, TECHNIQUES } from './pounce-logic.js';

export const DIFFICULTIES = {
    easy: { label: 'Easy', size: 6, maxDogs: 0, pawprints: false, tiers: [1, 2] },
    medium: { label: 'Medium', size: 8, maxDogs: 3, pawprints: false, tiers: [2, 4] },
    hard: { label: 'Hard', size: 9, maxDogs: 4, pawprints: true, minPawprints: 2, tiers: [3, 5] },
};

/** Nine Lives Run boards, in order: size grows 5 -> 9, rules get harder. */
export const RUN_BOARDS = [
    { size: 5, difficulty: 'easy' },
    { size: 6, difficulty: 'easy' },
    { size: 7, difficulty: 'medium' },
    { size: 8, difficulty: 'medium' },
    { size: 9, difficulty: 'hard' },
];

export const MIN_SIZE = 5;
export const MAX_SIZE = 10;
const SOLVER_STEPS = 400_000;

/** Random cat columns, one per row and column, no two cats touching. */
export function placeCats(size, rng) {
    const cats = new Array(size).fill(-1);
    const used = new Uint8Array(size);
    const order = () => shuffle(Array.from({ length: size }, (_, i) => i), rng);
    function place(y) {
        if (y === size) return true;
        for (const x of order()) {
            if (used[x] || (y > 0 && Math.abs(x - cats[y - 1]) <= 1)) continue;
            cats[y] = x; used[x] = 1;
            if (place(y + 1)) return true;
            used[x] = 0;
        }
        return false;
    }
    if (!place(0)) throw new Error(`no cat layout exists for a ${size}×${size} board`);
    return cats;
}

/** Grows one connected region per cat. Returns region ids per cell (Int8Array, row-major). */
export function growRegions(size, cats, rng) {
    const grid = new Int8Array(size * size).fill(-1);
    const ids = shuffle(Array.from({ length: size }, (_, i) => i), rng);
    cats.forEach((x, y) => { grid[y * size + x] = ids[y]; });
    let left = size * size - size;
    while (left > 0) {
        const frontier = [];
        for (let idx = 0; idx < grid.length; idx++) {
            if (grid[idx] !== -1) continue;
            const owners = orthogonal(size, idx).map((n) => grid[n]).filter((r) => r !== -1);
            if (owners.length) frontier.push([idx, owners]);
        }
        const [idx, owners] = frontier[Math.floor(rng() * frontier.length)];
        grid[idx] = owners[Math.floor(rng() * owners.length)];
        left--;
    }
    return grid;
}

/**
 * Generates a puzzle. Returns `{ difficulty, size, regions, solution, dogs, pawprints, grade }`
 * or throws an Error whose message is safe to show the admin. `size` overrides the difficulty's
 * board size (Nine Lives Run boards).
 */
export function generatePuzzle({ difficulty = 'medium', size, seed = '' } = {}, { attempts = 300, repairs = 80 } = {}) {
    const settings = DIFFICULTIES[difficulty];
    if (!settings) throw new Error(`unknown difficulty "${difficulty}" (use easy, medium or hard)`);
    const n = size ?? settings.size;
    if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) throw new Error(`board size must be ${MIN_SIZE}–${MAX_SIZE}`);
    const rng = mulberry32(stringToSeed(`${seed}|${difficulty}|${n}`));
    // Small boards can't reach the harder techniques, so the band's floor is relaxed for them.
    const [minTier, maxTier] = n < settings.size ? [1, settings.tiers[1]] : settings.tiers;

    for (let attempt = 0; attempt < attempts; attempt++) {
        const cats = placeCats(n, rng);
        const grid = growRegions(n, cats, rng);
        const dogs = [];
        const pawprints = [];
        const isCat = new Uint8Array(n * n);
        cats.forEach((x, y) => { isCat[y * n + x] = 1; });

        let unique = false;
        for (let r = 0; r < repairs; r++) {
            const puzzle = { size: n, regions: gridToRows(grid, n), dogs, pawprints };
            const result = solve(puzzle, { limit: 2, maxSteps: SOLVER_STEPS });
            if (result.exhausted) break;
            const other = result.solutions.find((s) => s.some((x, y) => x !== cats[y]));
            if (!other) { unique = result.count >= 1; break; }
            if (!breakSolution({ n, grid, cats, isCat, other, dogs, pawprints, settings, rng })) break;
        }
        if (!unique) continue;

        if (settings.pawprints) addPawprints({ n, grid, cats, isCat, dogs, pawprints, want: settings.minPawprints, rng });
        const puzzle = { difficulty, size: n, regions: gridToRows(grid, n), solution: [...cats], dogs, pawprints };
        // A region with one usable cell gives its cat away -- reject it.
        if (smallestFreeRegion(puzzle) < 2) continue;
        const logic = solveByLogic(puzzle);
        if (!logic.solved || logic.cats.some((x, y) => x !== cats[y])) continue;
        if (logic.maxTier < minTier || logic.maxTier > maxTier) continue;
        puzzle.grade = { technique: logic.technique, tier: logic.maxTier, steps: logic.steps };
        return puzzle;
    }
    throw new Error(`couldn't generate a ${DIFFICULTIES[difficulty].label} ${n}×${n} puzzle in the grade band -- try another seed`);
}

/** Generates the 5 boards of a Nine Lives Run. Throws an admin-readable Error naming the board. */
export function buildRun({ seed = '' } = {}) {
    return RUN_BOARDS.map((b, i) => {
        try {
            return generatePuzzle({ difficulty: b.difficulty, size: b.size, seed: `${seed}|run${i}` });
        } catch (err) {
            throw new Error(`board ${i + 1}: ${err.message}`);
        }
    });
}

/** Changes the board so the solution `other` stops working. Returns false if it can't. */
function breakSolution({ n, grid, cats, isCat, other, dogs, pawprints, settings, rng }) {
    // Cells where `other` has a cat but the intended solution doesn't.
    const extras = shuffle(other.map((x, y) => y * n + x).filter((idx) => !isCat[idx]), rng);
    const roll = rng();

    if (settings.pawprints && roll < 0.45) {
        const spot = pawprintAgainst({ n, cats, isCat, other, dogs, pawprints, rng });
        if (spot) { pawprints.push(spot); return true; }
    }
    if (settings.maxDogs && dogs.length < settings.maxDogs && roll < 0.7) {
        const idx = extras.find((i) => !takenBy(dogs, pawprints, i, n));
        if (idx !== undefined) { dogs.push({ x: idx % n, y: Math.floor(idx / n) }); return true; }
    }
    for (const idx of extras) {
        const from = grid[idx];
        const targets = shuffle([...new Set(orthogonal(n, idx).map((c) => grid[c]).filter((r) => r !== from))], rng);
        if (!targets.length || !staysConnected(n, grid, idx)) continue;
        grid[idx] = targets[0];
        return true;
    }
    return false;
}

/** A pawprint on a free cell whose count differs between the intended cats and `other`. */
function pawprintAgainst({ n, isCat, other, dogs, pawprints, rng }) {
    const otherCat = new Uint8Array(n * n);
    other.forEach((x, y) => { otherCat[y * n + x] = 1; });
    const spots = [];
    for (let idx = 0; idx < n * n; idx++) {
        if (isCat[idx] || otherCat[idx] || takenBy(dogs, pawprints, idx, n)) continue;
        const around = neighbours(n, idx);
        const mine = around.filter((c) => isCat[c]).length;
        if (mine !== around.filter((c) => otherCat[c]).length) spots.push({ x: idx % n, y: Math.floor(idx / n), n: mine });
    }
    return spots.length ? spots[Math.floor(rng() * spots.length)] : null;
}

/** Tops a Hard board up to `want` pawprints with true counts (extra clues never break uniqueness). */
function addPawprints({ n, isCat, dogs, pawprints, want, rng }) {
    const free = shuffle(Array.from({ length: n * n }, (_, i) => i).filter((idx) => !isCat[idx] && !takenBy(dogs, pawprints, idx, n)), rng);
    for (const idx of free) {
        if (pawprints.length >= want) return;
        // Prefer informative pawprints (touching at least one cat).
        const count = neighbours(n, idx).filter((c) => isCat[c]).length;
        if (count > 0) pawprints.push({ x: idx % n, y: Math.floor(idx / n), n: count });
    }
}

const takenBy = (dogs, pawprints, idx, n) => dogs.concat(pawprints).some((c) => c.y * n + c.x === idx);

/** True if the cell's region stays one connected piece without it. */
function staysConnected(n, grid, idx) {
    const r = grid[idx];
    const cells = [];
    for (let i = 0; i < grid.length; i++) if (grid[i] === r && i !== idx) cells.push(i);
    if (!cells.length) return false;
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
        const c = stack.pop();
        for (const nb of orthogonal(n, c)) {
            if (nb !== idx && grid[nb] === r && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
        }
    }
    return seen.size === cells.length;
}

// ---------------------------------------------------------------------------------------------

/**
 * Full check of a stored/imported puzzle. Returns a list of human-readable errors (empty = valid).
 * `checkUnique: false` skips the (slower) solver and logic runs.
 */
export function validatePuzzle(puzzle, { checkUnique = true } = {}) {
    const errors = [];
    const { difficulty, size, regions, solution, dogs = [], pawprints = [] } = puzzle ?? {};
    if (!DIFFICULTIES[difficulty]) errors.push(`unknown difficulty "${difficulty}"`);
    if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) return [...errors, `size must be ${MIN_SIZE}–${MAX_SIZE}`];
    if (!Array.isArray(regions) || regions.length !== size || regions.some((row) => typeof row !== 'string' || row.length !== size)) {
        return [...errors, `regions must be ${size} rows of ${size} digits`];
    }
    if (regions.some((row) => [...row].some((ch) => ch < '0' || ch.charCodeAt(0) - 48 >= size))) {
        return [...errors, `region digits must be 0–${size - 1}`];
    }
    const grid = regionGrid(puzzle);
    for (let r = 0; r < size; r++) {
        const cells = [];
        grid.forEach((g, i) => { if (g === r) cells.push(i); });
        if (!cells.length) errors.push(`region ${r + 1} is missing`);
        else if (!connected(size, grid, cells)) errors.push(`region ${r + 1} is in more than one piece`);
    }
    const seen = new Set();
    [...dogs, ...pawprints].forEach((c, i) => {
        if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.y < 0 || c.x >= size || c.y >= size) errors.push(`dog/pawprint ${i + 1} is outside the board`);
        const key = `${c.x},${c.y}`;
        if (seen.has(key)) errors.push(`two dogs/pawprints share row ${c.y + 1}, column ${c.x + 1}`);
        seen.add(key);
    });
    pawprints.forEach((p) => { if (!Number.isInteger(p.n) || p.n < 0 || p.n > 4) errors.push(`pawprint at row ${p.y + 1}, column ${p.x + 1} has a bad number`); });
    if (errors.length) return [...new Set(errors)].slice(0, 10);
    errors.push(...ruleProblems(puzzle, solution));
    if (errors.length) return [...new Set(errors)].slice(0, 10);

    if (checkUnique) {
        const result = solve(puzzle, { limit: 2, maxSteps: SOLVER_STEPS * 4 });
        if (result.exhausted) errors.push('solver gave up -- puzzle too ambiguous to verify');
        else if (result.count !== 1) errors.push(result.count === 0 ? 'puzzle has no solution' : 'puzzle has more than one solution');
        else if (!solveByLogic(puzzle).solved) errors.push('puzzle needs guessing -- it can\'t be solved by logic alone');
    }
    return errors;
}

/** Cells a cat could use in the smallest region (dogs and pawprints don't count). */
export function smallestFreeRegion(puzzle) {
    const grid = regionGrid(puzzle);
    const blocked = blockedGrid(puzzle);
    const free = new Array(puzzle.size).fill(0);
    grid.forEach((r, idx) => { if (!blocked[idx]) free[r]++; });
    return Math.min(...free);
}

/** Soft quality warnings for the admin preview (the puzzle is still valid). */
export function puzzleWarnings(puzzle) {
    const warnings = [];
    const { size, difficulty, dogs = [], grade } = puzzle;
    if (smallestFreeRegion(puzzle) < 2) warnings.push('a region has only one usable cell -- that cat is given away');
    if (dogs.length > size * 0.5) warnings.push(`${dogs.length} dogs -- quite a lot for one board`);
    const band = DIFFICULTIES[difficulty]?.tiers;
    if (grade && band && (grade.tier < band[0] || grade.tier > band[1])) {
        warnings.push(`graded "${TECHNIQUES[grade.technique]?.label ?? grade.technique}" -- outside the usual ${DIFFICULTIES[difficulty].label} range`);
    }
    return warnings;
}

// ---------------------------------------------------------------------------------------------

function gridToRows(grid, n) {
    return Array.from({ length: n }, (_, y) => Array.from(grid.slice(y * n, (y + 1) * n)).join(''));
}

function orthogonal(n, idx) {
    const x = idx % n;
    const y = (idx - x) / n;
    const out = [];
    if (x > 0) out.push(idx - 1);
    if (x < n - 1) out.push(idx + 1);
    if (y > 0) out.push(idx - n);
    if (y < n - 1) out.push(idx + n);
    return out;
}

function connected(n, grid, cells) {
    const r = grid[cells[0]];
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
        const c = stack.pop();
        for (const nb of orthogonal(n, c)) if (grid[nb] === r && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
    return seen.size === cells.length;
}

function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
