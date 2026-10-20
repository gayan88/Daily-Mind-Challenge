// Pounce puzzle-core checks (no test runner in this repo -- plain Node):
//   node tools/pounce-soak-test.mjs [boardsPerDifficulty=200]
// 1. solver vs brute force on small random boards,
// 2. every logic step agrees with the known solution (never rules out a real cat, never places a
//    wrong one),
// 3. generator soak: uniqueness, no giveaway regions, logic-solvable, grade spread and timing per difficulty, plus a
//    few Nine Lives Runs.
// Exits non-zero on any failure.

import { solve, ruleProblems } from '../src/js/games/pounce/pounce-solver.js';
import { analyse, initialState, nextStep, apply, isComplete, TECHNIQUES, CAT } from '../src/js/games/pounce/pounce-logic.js';
import { generatePuzzle, buildRun, validatePuzzle, placeCats, growRegions, smallestFreeRegion, DIFFICULTIES } from '../src/js/games/pounce/pounce-generator.js';
import { mulberry32 } from '../src/js/utils/helpers.js';

const perDifficulty = Number(process.argv[2] ?? 200);
let failures = 0;
const fail = (msg) => { failures++; if (failures <= 20) console.log('  FAIL', msg); };

// --- 1. Solver vs brute force -------------------------------------------------------------------
function bruteForce(puzzle) {
    const { size } = puzzle;
    let count = 0;
    const cats = [];
    (function rec(y) {
        if (y === size) { if (!ruleProblems(puzzle, cats).length) count++; return; }
        for (let x = 0; x < size; x++) { cats[y] = x; rec(y + 1); }
    })(0);
    return count;
}
{
    const rng = mulberry32(42);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
        const size = 5 + (i % 2);
        const grid = growRegions(size, placeCats(size, rng), rng);
        const regions = Array.from({ length: size }, (_, y) => Array.from(grid.slice(y * size, (y + 1) * size)).join(''));
        const dogs = i % 3 === 0 ? [{ x: Math.floor(rng() * size), y: Math.floor(rng() * size) }] : [];
        const pawprints = i % 4 === 1 ? [{ x: Math.floor(rng() * size), y: Math.floor(rng() * size), n: Math.floor(rng() * 3) }] : [];
        if (pawprints.length && dogs.some((d) => d.x === pawprints[0].x && d.y === pawprints[0].y)) pawprints.length = 0;
        const puzzle = { size, regions, dogs, pawprints };
        const expected = bruteForce(puzzle);
        const got = solve(puzzle, { limit: 1000 }).count;
        if (expected !== got) fail(`solver found ${got} solutions, brute force ${expected}: ${JSON.stringify(puzzle)}`);
        checked++;
    }
    console.log(`1. solver vs brute force: ${checked} boards checked`);
}

// --- 2 + 3. Generator soak with step-by-step logic checks ---------------------------------------
function checkLogicSteps(puzzle) {
    const a = analyse(puzzle);
    const state = initialState(puzzle);
    const truth = new Set(puzzle.solution.map((x, y) => y * puzzle.size + x));
    for (let guard = 0; guard < 500 && !isComplete(a, state); guard++) {
        const s = nextStep(a, state);
        if (!s) return 'logic got stuck';
        if (s.eliminate.some((idx) => truth.has(idx))) return `${s.technique} ruled out a real cat: ${s.text}`;
        if (s.place.some((idx) => !truth.has(idx))) return `${s.technique} placed a wrong cat: ${s.text}`;
        if (!s.text || (!s.eliminate.length && !s.place.length)) return `${s.technique} step did nothing`;
        apply(state, s);
    }
    for (const idx of truth) if (state[idx] !== CAT) return 'solve finished without every cat';
    return state.some((v, idx) => v === CAT && !truth.has(idx)) ? 'a wrong cat is on the final board' : null;
}

for (const difficulty of Object.keys(DIFFICULTIES)) {
    const tiers = {};
    const times = [];
    let generated = 0;
    let errors = 0;
    for (let i = 0; i < perDifficulty; i++) {
        const t0 = performance.now();
        let puzzle;
        try {
            puzzle = generatePuzzle({ difficulty, seed: `soak-${i}` });
        } catch (err) {
            errors++;
            fail(`${difficulty} seed soak-${i}: ${err.message}`);
            continue;
        }
        times.push(performance.now() - t0);
        generated++;
        const problems = validatePuzzle(puzzle);
        if (problems.length) fail(`${difficulty} soak-${i} invalid: ${problems.join('; ')}`);
        if (smallestFreeRegion(puzzle) < 2) fail(`${difficulty} soak-${i}: a region gives its cat away`);
        const logicProblem = checkLogicSteps(puzzle);
        if (logicProblem) fail(`${difficulty} soak-${i}: ${logicProblem}`);
        tiers[puzzle.grade.technique] = (tiers[puzzle.grade.technique] || 0) + 1;
        const again = generatePuzzle({ difficulty, seed: `soak-${i}` });
        if (JSON.stringify(again) !== JSON.stringify(puzzle)) fail(`${difficulty} soak-${i}: same seed gave a different puzzle`);
    }
    times.sort((x, y) => x - y);
    const pct = (p) => (times[Math.floor((times.length - 1) * p)] ?? 0).toFixed(0);
    const spread = Object.entries(tiers).sort((x, y) => TECHNIQUES[x[0]].tier - TECHNIQUES[y[0]].tier).map(([t, c]) => `${t} ${c}`).join(', ');
    console.log(`2/3. ${difficulty}: ${generated}/${perDifficulty} generated (${errors} gave up) · ms median ${pct(0.5)} p95 ${pct(0.95)} max ${pct(1)} · hardest step: ${spread}`);
}

{
    let ok = 0;
    for (let i = 0; i < 10; i++) {
        try {
            const boards = buildRun({ seed: `run-${i}` });
            if (boards.map((b) => b.size).join() !== '5,6,7,8,9') fail(`run-${i}: wrong board sizes`);
            boards.forEach((b, j) => { const p = validatePuzzle(b); if (p.length) fail(`run-${i} board ${j + 1}: ${p.join('; ')}`); });
            ok++;
        } catch (err) {
            fail(`run-${i}: ${err.message}`);
        }
    }
    console.log(`3. Nine Lives Runs: ${ok}/10 built`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
