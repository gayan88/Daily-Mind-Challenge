# src/js/games/quilt

Quilt — a Shikaku-style picture-reveal puzzle (the fifth game, live since 2026-10-18). Drag rectangles so each
holds exactly one number equal to its area; every solved rectangle fills with colour and the
finished board is a pixel-art picture. Plan, decisions and backlogs: `docs/quilt-development-plan.md`.

**Status: live in production** — all three modes (Daily, Classic, Patchwork Run) registered in
`GAMES`, home tile, leaderboard option, profile labels, `checkPlayedTodayAll()` (so Perfect Day needs
all five Dailies), ad slots, rules, sitemap, achievement badge art. Content is managed in
Admin → Quilt (`src/js/admin/quilt-admin*.js`), including bulk Patchwork Run import; test pictures
were in `docs/quilt-content/` (removed 2026-10-20; recover with `git checkout deaffe8 -- docs/quilt-content`).

## Files

- **`quilt-solver.js`** — `candidateRects()`, `solve(puzzle, { limit, maxSteps })` (counts
  solutions up to `limit`, returns the first; `exhausted: true` = gave up, answer unknown),
  `hasUniqueSolution()`, and `checkBoard(puzzle, rects)` — the rules-based completion check the
  engine will use (any valid tiling wins; returns a per-rectangle error code for highlighting).
- **`quilt-generator.js`** — `DIFFICULTIES` (easy 7×7 / max area 8, medium 10×10 / 12, hard 14×14 /
  16 + blockers + shape clues), `splitPicture()` (greedy single-colour rectangles), `generatePuzzle()`
  (seeded, retries clue placement and re-splits until the solver proves exactly one solution; Hard
  turns 1×1 rectangles into blockers and adds shape clues, more of them as attempts fail),
  `validatePuzzle()` (full structural + uniqueness check, admin-readable errors), `puzzleWarnings()`.
- **`quilt-picture.js`** — `parsePictureBlocks()` (admin text format: `title:` / `difficulty:` /
  `palette:` headers + digit rows, blocks separated by blank lines), `pictureFromImageData()` (PNG at
  1 pixel = 1 cell, max 8 colours), `pictureProblems()`, `nearestEmoji()` (hue-based, 9 squares) and
  `pictureToEmojiRows()` (share-text mosaic, downscaled to ≤ 7×7 by majority colour).

The solver, generator and picture modules are pure ES modules (no DOM, no Firebase) and import only `utils/helpers.js`
(`mulberry32`, `stringToSeed`), so they also run under plain Node for testing
(`node some-test.mjs` importing them by path — there's no test runner in this repo).

- **`quilt-engine.js`** — `playQuiltRound({ container, puzzle, timeLimitSeconds, roundLabel, onComplete })`
  → `{ destroy }`. Pointer-event drag (mouse/touch/pen; board has `touch-action: none`), drawing over
  rects replaces them, tap empty cell = 1×1, tap rect = remove, Undo / Ctrl+Z, Clear. Rule-breaking
  rects outlined red at once; placed rects use neutral fabric tints and only take picture colours
  when solved (so colour never gives away a wrong rect). `onComplete({ won, timedOut,
  timeTakenSeconds, undos, removals, perfect, pieces })` fires once, 1.8 s after the reveal starts.
  Perfect Stitch = win with no undo and no removal. Stopwatch starts on first touch; Tournament
  countdown starts at mount and on expiry shows the answer greyed. On mount it scrolls the whole
  round (stats → controls) into view, since the board blocks touch scrolling. Styles: `src/css/pages/quilt.css`
  (`qt-` prefix; shape clues drawn as a frame round the number — box = square, pill = strip;
  blockers drawn as sewn buttons/"knots").

- **`quilt-scoring.js`** — every mode's points rules: Daily `10 + timeBonus(≤180s 10 / ≤300 8 /
  ≤600 6 / else 5) + 5 Perfect Stitch` (max 25), Classic = Daily parts × {easy .8, medium 1, hard 1.3}
  rounded (max 33), Patchwork Run tile 30 pass / 10 fail, +25 Perfect Patchwork. Rules caps:
  quilt 30, quilt-classic 40, quilt-tournament 30, quilt-tournament-bonus 2000.
- **`quilt-daily-data.js`** — `quiltDailyPuzzles/{YYYY-MM-DD}` (+ `_meta { totalCount, firstDate,
  lastDate }`, same scheme as Sudoku) holding `{ challengeNumber, ...puzzle }`; `gameScores` type
  `quilt`, doc `{uid}_quilt_{date}`, one solve per day, always `won: true`, both share flags created
  `false`.
- **`quilt-classic-data.js`** — `quiltClassicPuzzles/{id}` (`{ difficulty, ...puzzle }`).
  `getClassicPuzzle(uid, difficulty, excludeId)` prefers pictures the player has never solved (from
  their own `quilt-classic` gameScores `puzzleId`s), else any but the one just played.
  `recordClassicResult()` — unique `gameDate` token per round + real `scoreDate`, type
  `quilt-classic`, both share flags created `false`.
- **`quilt-tournament-data.js`** — Patchwork Run: `quiltTournaments/{id}` (`{ name, active,
  completionBonus, title, palette, pixels, width, height, cols, rows, tiles: [puzzle + tileX/tileY] }`,
  built by `quilt-generator.js#buildPatchwork`), `quiltTournamentAttempts/{tid}_{uid}` (same fields
  and rules shape as Sudoku's: `currentPuzzleIndex`/`puzzlesPassed`/`puzzlesFailed`/`puzzleResults
  [{ passed, timeTakenSeconds, perfect }]`). Each tile banks 30 / 10 as `quilt-tournament` in the
  same transaction that advances the attempt; a timed-out tile never resets the run. The retry-safe
  completion doc `quilt-tournament-bonus` holds `completionBonus` + 25 Perfect Patchwork (all tiles
  passed) and receives the share bonuses. Time per tile: `config/quiltTournamentSettings`.
- **`quilt-summary-modal.js`** — own copy of the summary modal (convention) plus the solved picture
  and a Perfect Stitch badge (`perfectLabel` for "Perfect Patchwork"). Exports `quiltPictureHtml()`
  (picture as a cell grid, optional `greyRegions` for timed-out tiles), reused by the page.
- **`quilt-page.js`** — page glue (`trySession()`, sign-in prompt for anonymous visitors, admins
  blocked, single `activeRound` destroyed on tab switch, `?tab=classic|tournament`). Already-played
  Daily shows the revealed picture. Daily share text is stats-only (never the picture); Classic share
  text includes the picture as an emoji mosaic (`pictureToEmojiRows`). Classic flow: picker (size +
  "up to N pts") → round → summary → "Next {size} Quilt" / "Choose another size". Patchwork Run:
  run list → per tile a mosaic (solved tiles in colour, timed-out grey, current highlighted, later
  covered) + timed round → inline result + "Next Tile" → final summary with the whole picture; share
  text has the picture mosaic plus a ✅/❌ per tile.

## Testing locally

Same as Connections: `PATH="/opt/homebrew/opt/openjdk/bin:$PATH" firebase emulators:start --only
firestore,auth,hosting --project playdailymindchallenge`, site at http://127.0.0.1:5002/quilt. Seed
content through Admin → Quilt (make an emulator account admin by PATCHing its `registeredUsers` doc
via the emulator REST API with `Authorization: Bearer owner`).

## Data shape

Puzzles use objects, not nested arrays (Firestore can't store arrays of arrays):
`{ title, difficulty, width, height, palette: [hex], pixels: [digit strings], rects: [{x,y,w,h}],
clues: [{x,y,n,shape?}], blockers: [{x,y}] }`.

## Performance

Generation measured at ~1–2 ms for 7×7–14×14 pictures and ≤ ~1.2 s worst case for 20×20 (60 random
pictures, all valid and unique). The solver is bounded by `maxSteps` so a pathological picture
fails with a readable error instead of freezing the admin tab.
