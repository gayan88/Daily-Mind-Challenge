/**
 * Pounce human-technique solver: finds the *next deduction a person could make*, one step at a
 * time. The same steps drive Whisker Tips (the engine shows `cells` + `text` and applies `place` /
 * `eliminate`) and difficulty grading (`gradePuzzle` = the hardest technique a full solve needs).
 * Pure logic -- no DOM, no Firebase.
 *
 * Board state is an Int8Array, one entry per cell: UNKNOWN, CAT or NOT (✕). Dogs and pawprint
 * cells start as NOT. A step is
 *   `{ technique, tier, place: [idx], eliminate: [idx], cells: [idx], text }`
 * where `cells` are the cells to highlight. Techniques, easiest first (tier):
 *   1 cat-neighbours  a cat rules out its row, column, region and the 8 cells around it
 *   1 last-cell       a row / column / region has one spot left, so its cat goes there
 *   2 pawprint        a pawprint already has its cats (✕ the rest), or needs every spot left
 *   2 line-lock       a region fits in one row/column (✕ the rest of that line), or the reverse
 *   3 would-empty     a cat here would leave some row / column / region with no room
 *   4 group-lock      k regions fit in k rows/columns (✕ other regions there), or the reverse
 *   5 what-if         a cat here leads, by simple steps, to a row / column / region with no room
 */

import { regionGrid, neighbours, blockedGrid } from './pounce-solver.js';

export const UNKNOWN = 0;
export const CAT = 1;
export const NOT = -1;

export const TECHNIQUES = {
    'cat-neighbours': { tier: 1, label: 'Cat neighbours' },
    'last-cell': { tier: 1, label: 'Last spot' },
    pawprint: { tier: 2, label: 'Pawprint count' },
    'line-lock': { tier: 2, label: 'Region in one line' },
    'would-empty': { tier: 3, label: 'No room left' },
    'group-lock': { tier: 4, label: 'Locked group' },
    'what-if': { tier: 5, label: 'What if…' },
};

const ORDINAL = (n) => `${n + 1}`;

/**
 * Precomputes everything the techniques need about a puzzle. `regionNames` (optional) lets the
 * engine say "the blue region" instead of "region 3".
 */
export function analyse(puzzle, { regionNames } = {}) {
    const { size, pawprints = [] } = puzzle;
    const region = regionGrid(puzzle);
    const units = [];
    for (let y = 0; y < size; y++) units.push({ kind: 'row', id: y, cells: Array.from({ length: size }, (_, x) => y * size + x) });
    for (let x = 0; x < size; x++) units.push({ kind: 'col', id: x, cells: Array.from({ length: size }, (_, y) => y * size + x) });
    for (let r = 0; r < size; r++) units.push({ kind: 'region', id: r, cells: [] });
    for (let idx = 0; idx < size * size; idx++) units[2 * size + region[idx]].cells.push(idx);
    const unitsOf = Array.from({ length: size * size }, (_, idx) => {
        const x = idx % size;
        const y = (idx - x) / size;
        return [y, size + x, 2 * size + region[idx]];
    });
    const near = Array.from({ length: size * size }, (_, idx) => neighbours(size, idx));
    const name = (u) => {
        if (u.kind === 'row') return `row ${ORDINAL(u.id)}`;
        if (u.kind === 'col') return `column ${ORDINAL(u.id)}`;
        return regionNames?.[u.id] ? `the ${regionNames[u.id]} region` : `region ${ORDINAL(u.id)}`;
    };
    const cellName = (idx) => `row ${ORDINAL(Math.floor(idx / size))}, column ${ORDINAL(idx % size)}`;
    return { puzzle, size, region, units, unitsOf, near, pawprints, name, cellName };
}

/** Starting state: everything unknown except dogs and pawprints. */
export function initialState(puzzle) {
    const blocked = blockedGrid(puzzle);
    return Int8Array.from(blocked, (b) => (b ? NOT : UNKNOWN));
}

const unknownsOf = (state, cells) => cells.filter((idx) => state[idx] === UNKNOWN);
const hasCat = (state, cells) => cells.some((idx) => state[idx] === CAT);

/** Cells a cat at `idx` rules out (its row, column, region, neighbours), still unknown. */
function ruledOutBy(a, state, idx) {
    const out = new Set();
    a.unitsOf[idx].forEach((u) => a.units[u].cells.forEach((c) => out.add(c)));
    a.near[idx].forEach((c) => out.add(c));
    out.delete(idx);
    return [...out].filter((c) => state[c] === UNKNOWN);
}

/**
 * Returns a description of why `state` can't lead to a solution (`{ unit?, text }`), or null if
 * no contradiction is visible yet: a unit with two cats or no room, touching cats, a pawprint over
 * its count or unable to reach it.
 */
export function contradiction(a, state) {
    for (const u of a.units) {
        const cats = u.cells.filter((idx) => state[idx] === CAT).length;
        if (cats > 1) return { unit: u, text: `${a.name(u)} would have two cats` };
        if (cats === 0 && unknownsOf(state, u.cells).length === 0) return { unit: u, text: `there'd be no room left for a cat in ${a.name(u)}` };
    }
    for (let idx = 0; idx < state.length; idx++) {
        if (state[idx] === CAT && a.near[idx].some((c) => state[c] === CAT)) return { text: 'two cats would touch' };
    }
    for (const p of a.pawprints) {
        const around = a.near[p.y * a.size + p.x];
        const cats = around.filter((idx) => state[idx] === CAT).length;
        const open = around.filter((idx) => state[idx] === UNKNOWN).length;
        if (cats > p.n || cats + open < p.n) return { text: `the ${p.n} pawprint at ${a.cellName(p.y * a.size + p.x)} couldn't be right` };
    }
    return null;
}

// ---------------------------------------------------------------------------------------------
// Techniques. Each returns a step or null.

function catNeighbours(a, state) {
    for (let idx = 0; idx < state.length; idx++) {
        if (state[idx] !== CAT) continue;
        const out = ruledOutBy(a, state, idx);
        if (out.length) {
            return step('cat-neighbours', { eliminate: out, cells: [idx, ...out],
                text: `A cat naps at ${a.cellName(idx)}, so no other cat can use its row, its column, its region or the 8 cells around it.` });
        }
    }
    return null;
}

function lastCell(a, state) {
    for (const u of a.units) {
        if (hasCat(state, u.cells)) continue;
        const open = unknownsOf(state, u.cells);
        if (open.length === 1) {
            return step('last-cell', { place: open, cells: u.cells,
                text: `${capital(a.name(u))} has only one spot left, so its cat goes at ${a.cellName(open[0])}.` });
        }
    }
    return null;
}

function pawprint(a, state) {
    for (const p of a.pawprints) {
        const at = p.y * a.size + p.x;
        const around = a.near[at];
        const cats = around.filter((idx) => state[idx] === CAT).length;
        const open = unknownsOf(state, around);
        if (!open.length) continue;
        if (cats === p.n) {
            return step('pawprint', { eliminate: open, cells: [at, ...open],
                text: p.n === 0
                    ? `The 0 pawprint at ${a.cellName(at)} means no cat touches it, so all the cells around it are empty.`
                    : `The ${p.n} pawprint at ${a.cellName(at)} already touches ${p.n} cat${p.n > 1 ? 's' : ''}, so the other cells around it are empty.` });
        }
        // Needs every remaining spot -- only safe when those spots can all hold cats together.
        if (cats + open.length === p.n && open.every((c, i) => open.slice(i + 1).every((d) => !a.near[c].includes(d)))) {
            return step('pawprint', { place: [open[0]], cells: [at, ...open],
                text: `The ${p.n} pawprint at ${a.cellName(at)} needs a cat in every spot still open around it, so a cat goes at ${a.cellName(open[0])}.` });
        }
    }
    return null;
}

/**
 * Locked groups: `k` units of one kind (e.g. regions) whose open cells all fit inside `k` units
 * of another kind (e.g. rows) own those lines, so other cells in those lines are empty. k = 1 is
 * the tier-2 "line-lock"; k >= 2 is the tier-4 "group-lock".
 */
function lockedGroups(a, state, { minK, maxK, technique }) {
    const { size, units } = a;
    const pairs = [['region', 'row'], ['region', 'col'], ['row', 'region'], ['col', 'region']];
    for (let k = minK; k <= maxK; k++) {
        for (const [fromKind, toKind] of pairs) {
            const open = units.filter((u) => u.kind === fromKind && !hasCat(state, u.cells));
            if (open.length <= k) continue;
            const masks = open.map((u) => {
                let mask = 0;
                unknownsOf(state, u.cells).forEach((idx) => { mask |= 1 << toUnitId(a, idx, toKind); });
                return mask;
            });
            for (const combo of combinations(open.length, k)) {
                let mask = 0;
                combo.forEach((i) => { mask |= masks[i]; });
                if (popcount(mask) !== k) continue;
                const inGroup = new Set(combo.flatMap((i) => open[i].cells));
                const targets = [];
                for (let t = 0; t < size; t++) {
                    if (!(mask & (1 << t))) continue;
                    const line = units.find((u) => u.kind === toKind && u.id === t);
                    unknownsOf(state, line.cells).forEach((idx) => { if (!inGroup.has(idx)) targets.push(idx); });
                }
                if (!targets.length) continue;
                const fromNames = combo.map((i) => a.name(open[i]));
                const toNames = [];
                for (let t = 0; t < size; t++) if (mask & (1 << t)) toNames.push(a.name(units.find((u) => u.kind === toKind && u.id === t)));
                const text = k === 1
                    ? `All the open spots in ${fromNames[0]} are in ${toNames[0]}, so that cat will use ${toNames[0]}. No other spot in ${toNames[0]} can hold a cat.`
                    : `${capital(list(fromNames))} only have room in ${list(toNames)}. Those ${k} cats will use all ${k}, so no other spot there can hold a cat.`;
                return step(technique, { eliminate: targets, cells: [...inGroup].filter((idx) => state[idx] === UNKNOWN).concat(targets), text });
            }
        }
    }
    return null;
}

function toUnitId(a, idx, kind) {
    if (kind === 'row') return Math.floor(idx / a.size);
    if (kind === 'col') return idx % a.size;
    return a.region[idx];
}

function wouldEmpty(a, state) {
    for (let idx = 0; idx < state.length; idx++) {
        if (state[idx] !== UNKNOWN) continue;
        const out = new Set(ruledOutBy(a, state, idx));
        const own = new Set(a.unitsOf[idx]);
        for (let ui = 0; ui < a.units.length; ui++) {
            const u = a.units[ui];
            if (own.has(ui) || hasCat(state, u.cells)) continue;
            const open = unknownsOf(state, u.cells);
            if (open.length && open.every((c) => out.has(c))) {
                return step('would-empty', { eliminate: [idx], cells: [idx, ...open],
                    text: `A cat at ${a.cellName(idx)} would rule out every open spot in ${a.name(u)}, so no cat can go there.` });
            }
        }
        // A cat here would push a pawprint over its count.
        for (const p of a.pawprints) {
            const around = a.near[p.y * a.size + p.x];
            if (around.includes(idx) && around.filter((c) => state[c] === CAT).length + 1 > p.n) {
                return step('would-empty', { eliminate: [idx], cells: [idx, p.y * a.size + p.x],
                    text: `A cat at ${a.cellName(idx)} would give the ${p.n} pawprint at ${a.cellName(p.y * a.size + p.x)} too many cats.` });
            }
        }
    }
    return null;
}

/** Applies only tier-1/2 steps until nothing changes; returns the contradiction found, if any. */
function propagate(a, state) {
    for (let guard = 0; guard < 400; guard++) {
        const bad = contradiction(a, state);
        if (bad) return bad;
        const s = catNeighbours(a, state) || lastCell(a, state) || pawprint(a, state)
            || lockedGroups(a, state, { minK: 1, maxK: 1, technique: 'line-lock' });
        if (!s) return null;
        apply(state, s);
    }
    return null;
}

function whatIf(a, state) {
    for (let idx = 0; idx < state.length; idx++) {
        if (state[idx] !== UNKNOWN) continue;
        const trial = Int8Array.from(state);
        trial[idx] = CAT;
        const bad = propagate(a, trial);
        if (bad) {
            return step('what-if', { eliminate: [idx], cells: [idx, ...(bad.unit ? unknownsOf(state, bad.unit.cells) : [])],
                text: `Imagine a cat at ${a.cellName(idx)}. Following the simple rules from there, ${bad.text}. So no cat can go there.` });
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------

/**
 * The easiest next deduction for `state`, or null when the board is solved or stuck. Cats the
 * player placed wrongly aren't this function's job -- the engine checks cats against the solution.
 */
export function nextStep(a, state) {
    return catNeighbours(a, state)
        || lastCell(a, state)
        || pawprint(a, state)
        || lockedGroups(a, state, { minK: 1, maxK: 1, technique: 'line-lock' })
        || wouldEmpty(a, state)
        || lockedGroups(a, state, { minK: 2, maxK: Math.floor(a.size / 2), technique: 'group-lock' })
        || whatIf(a, state);
}

/** Applies a step to `state` in place. */
export function apply(state, s) {
    s.eliminate.forEach((idx) => { state[idx] = NOT; });
    s.place.forEach((idx) => { state[idx] = CAT; });
}

/** True when every row holds a cat. */
export function isComplete(a, state) {
    return a.units.slice(0, a.size).every((u) => hasCat(state, u.cells));
}

/**
 * Solves by logic alone. Returns `{ solved, cats, steps, maxTier, technique, counts }` where
 * `technique` is the hardest one used and `counts` how often each was used.
 */
export function solveByLogic(puzzle, { maxSteps = 500 } = {}) {
    const a = analyse(puzzle);
    const state = initialState(puzzle);
    const counts = {};
    let maxTier = 0;
    let technique = null;
    let steps = 0;
    while (!isComplete(a, state) && steps < maxSteps) {
        const s = nextStep(a, state);
        if (!s) break;
        apply(state, s);
        steps++;
        counts[s.technique] = (counts[s.technique] || 0) + 1;
        if (s.tier > maxTier) { maxTier = s.tier; technique = s.technique; }
    }
    const solved = isComplete(a, state) && !contradiction(a, state);
    const cats = solved ? Array.from({ length: a.size }, (_, y) => a.units[y].cells.findIndex((idx) => state[idx] === CAT)) : null;
    return { solved, cats, steps, maxTier, technique, counts };
}

// ---------------------------------------------------------------------------------------------

function step(technique, { place = [], eliminate = [], cells = [], text }) {
    return { technique, tier: TECHNIQUES[technique].tier, place, eliminate, cells: [...new Set(cells)], text };
}

function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function list(names) {
    return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function popcount(n) { let c = 0; while (n) { n &= n - 1; c++; } return c; }

function* combinations(n, k, start = 0, prefix = []) {
    if (prefix.length === k) { yield prefix; return; }
    for (let i = start; i <= n - (k - prefix.length); i++) yield* combinations(n, k, i + 1, [...prefix, i]);
}
