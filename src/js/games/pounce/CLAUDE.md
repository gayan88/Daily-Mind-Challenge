# src/js/games/pounce

Pounce — a Star Battle-style cat puzzle (the sixth game, in development). Place one cat per row,
column and coloured region; no two cats may touch, not even diagonally. Hard adds pawprint clues
(how many cats touch this cell) and every level from Medium up adds sleeping dogs (blocked cells).
Plan, brand and decisions: `docs/pounce-development-plan.md`. Tickets: `docs/pounce-backlog.md`.
Never call it "Meowdoku" or "Queens" in the product.

**Status: built and release-tested, not deployed (2026-10-20).** All four modes (Daily, Classic, Zen,
Nine Lives Run), wired into the site (`GAMES`, rules, home tile, leaderboard, profile + Cat Café,
badges), and Admin → Pounce generates all content (`src/js/admin/pounce-admin*.js`). Deploy order
and steps: `docs/pounce-release-notes.md`.

## Files

- **`pounce-solver.js`** — board helpers (`regionGrid()`, `neighbours()`, `blockedGrid()`),
  `solve(puzzle, { limit, maxSteps })` (row-by-row backtracking; returns `{ count, solutions,
  exhausted }`), `hasUniqueSolution()`, `ruleProblems(puzzle, cats)` (rules-only check, readable
  messages). A puzzle is `{ size, regions: [digit strings], dogs: [{x,y}], pawprints: [{x,y,n}] }`;
  a solution is `cats[row] = column`. Pawprint cells never hold a cat.
- **`pounce-logic.js`** — the human-technique solver behind both Whisker Tips and grading.
  `analyse(puzzle, { regionNames })` once, then `nextStep(a, state)` returns the easiest deduction
  `{ technique, tier, place, eliminate, cells, text }`; `apply(state, step)`; `solveByLogic(puzzle)`
  returns the hardest technique used. State is an Int8Array of `UNKNOWN` / `CAT` / `NOT`.
  Techniques, tiers 1–5: cat-neighbours, last-cell, pawprint, line-lock, would-empty, group-lock,
  what-if (bounded look-ahead using only tier ≤ 2 steps). Step `text` is shown to players, so keep
  it plain English.
- **`pounce-generator.js`** — `DIFFICULTIES` (easy 6×6 tiers 1–2 · medium 8×8 + ≤3 dogs, tiers
  2–4 · hard 9×9 + ≤4 dogs + ≥2 pawprints, tiers 3–5), `RUN_BOARDS` (5→9), `generatePuzzle({
  difficulty, size?, seed })` (cats → grown regions → repair until unique by moving a cell to a
  neighbouring region / adding a dog / adding a disagreeing pawprint → logic grade inside the band,
  no region with < 2 usable cells), `buildRun({ seed })`, `validatePuzzle()` (admin-readable
  errors, incl. uniqueness + logic-solvable), `puzzleWarnings()`, `smallestFreeRegion()`.
  Stored shape adds `difficulty`, `solution`, `grade: { technique, tier, steps }`.
- **`pounce-cats.js`** — code-drawn SVG cat faces: `catSvg({ coat, eyes, accessory, title })`,
  `COATS` (ginger, black, white, tabby, calico, grey), `boardCoats(size, seed)` (a different coat
  per row's cat), `cafeCat(date)` (the Cat Café cat a Daily adopts: name, coat, eyes, accessory,
  description).
- **`pounce-engine.js`** — `playPounceRound({ container, puzzle, mode, timeLimitSeconds, lives,
  roundLabel, seed, sound, onComplete })` → `{ destroy }`. Modes: daily / classic (stopwatch from
  the first touch, hisses + tips counted), run (countdown from mount; a wrong cat costs one of
  `lives`; 0 lives or time up = loss) and zen (no clock, nothing counted). Tap cycles empty → ✕ →
  cat; long-press or "Tap places 🐱" places a cat; drag paints/erases ✕; keyboard arrows/Space/
  Enter/X, Ctrl/⌘+Z. Cats are checked against `solution` on landing: right ones lock, wrong ones
  hiss off and leave a ✕. Optional Auto-✕. Whisker Tip = clear a ✕ on a real cat spot, else
  `nextStep()` from pounce-logic.js (cells highlighted + sentence). `onComplete({ won, timedOut,
  outOfLives, timeTakenSeconds, mistakes, tips, perfect, livesLeft })` once, 1.7 s after the
  curl-up / reveal. `REGION_COLOURS` (10 named muted colours; the names are used in tips).
  Styles: `src/css/pages/pounce.css` (`pn-` prefix, `--color-pounce-*` tokens in base.css).
  `staticBoardHtml(puzzle, { cats, label, className })` draws a non-interactive board (already-
  played Daily, How to Play example).
- **`pounce-scoring.js`** — Daily `10 + timeBonus(≤120s 10 / ≤240 8 / ≤480 6 / else 5) − 2/hiss −
  3/tip (min 5) + 5 Purrfect` (max 25); Classic = Daily parts × {easy .8, medium 1, hard 1.3}
  rounded (max 33). `penaltyPoints` is the deduction actually applied. Run: board 30 solved / 10
  out of time or lives; `runBonusFor()` = completion bonus + 5 × lives, finished runs only. Rules caps: pounce 30,
  pounce-classic 40, pounce-tournament 30, pounce-tournament-bonus 2000.
- **`pounce-daily-data.js`** — `pounceDailyPuzzles/{YYYY-MM-DD}` + `_meta` (Quilt's scheme) holding
  `{ challengeNumber, ...puzzle }`; gameScores `{uid}_pounce_{date}`, one solve per day, always
  `won: true`, stores `mistakes`, `tips`, `cafeCat`, both share flags created `false`.
- **`pounce-classic-data.js`** — `pounceClassicPuzzles/{id}` (`{ difficulty, ...puzzle }`).
  `getClassicPuzzle(uid, difficulty, excludeId, { preferUnplayed })` — Classic serves boards the
  player hasn't solved first (their `pounce-classic` gameScores `puzzleId`s); Zen passes
  `preferUnplayed: false`. `recordClassicResult()` — unique `gameDate` token + real `scoreDate`.
- **`pounce-tournament-data.js`** — Nine Lives Run: `pounceTournaments/{id}` (`{ name, active,
  completionBonus, boards: [5 puzzles] }`, from `buildRun()`), `pounceTournamentAttempts/{tid}_{uid}`
  (Quilt's fields + `livesLeft`, which only goes down). `spendLife()` saves a wrong cat at once;
  `recordBoardResult()` banks 30 / 10 and advances in one transaction (a timeout costs a life);
  `runIsOver()` = all boards played or 0 lives; `completeTournamentIfNeeded()` writes the bonus doc
  (completion bonus + 5 × lives for a finished run, else 0) where the share bonuses land.
  Settings: `config/pounceTournamentSettings` `{ timeLimitSeconds: 240, lives: 9 }`.
- **`pounce-cafe-data.js`** — `getAdoptedCats(uid)`: the player's `pounce` gameScores dates →
  `cafeCat(date)`, newest first (the profile's Cat Café panel, `pages/profile.js#renderCafe`).
- **`pounce-summary-modal.js`** — `showPounceSummaryModal()`, adapted from Quilt's: optional `cat`
  ({ svg, caption }) at the top, Purrfect badge, breakdown lines may be negative ("−n").
- **`pounce-page.js`** — `trySession()` page glue, mode tabs with one `activeRound`, Daily flow
  (record → XP/streak for registered → summary + shares), already-played view, Classic / Zen
  pickers and rounds, Nine Lives Run list → boards → run summary (pip strip + lives), How to Play
  example (a fixed generated 5×5). Share text never shows the board.

The solver, logic, generator and cats modules are pure ES modules (no DOM, no Firebase) importing only `utils/helpers.js`, so they run
under plain Node.

## Tests

`node tools/pounce-soak-test.mjs [boardsPerDifficulty]` (default 200; the backlog's bar is 1000).
It checks the solver against brute force (incl. dogs + pawprints), every logic step against the
known solution, validity, no giveaway regions, seed determinism, grade spread and timing, plus 10
Nine Lives Runs. Run it after any change to these modules. At 1000 (2026-10-20): every board is
generated, max ~20 ms each; the hardest steps used are easy = line-lock, medium = would-empty /
group-lock, hard = mostly what-if.

Engine: `tools/pounce-preview.html` mounts a generated board (`?difficulty=&size=&mode=&seed=`;
serve the repo root, e.g. `python3 -m http.server 8123 --bind 127.0.0.1`).
`tools/pounce-browser-test.mjs` drives it in the system Chrome (setup in its header) and checks
every control and mode at phone and desktop sizes. Run it after any engine/CSS change.

Site: `tools/pounce-e2e-test.mjs` (with `tools/pounce-emulator-seed.mjs`) runs the Daily end to end
against the Firebase emulators (setup + known emulator quirks in its header): 24 checks incl. the
gameScores doc, the share rule, leaderboard, profile and home tile. `tools/pounce-e2e-modes-test.mjs`
covers Classic, Zen and every Nine Lives Run path (28 checks).
