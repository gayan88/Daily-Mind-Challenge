# Trail — Development Backlog

> Created 2026-11-10. **Source of truth for Trail, the 7th game** (working name). It follows
> `docs/adding-a-new-game.md` for every touchpoint and reuses Pounce's patterns (generated
> content, Admin "Generate", tests in `tools/`). Playable concept sample:
> https://claude.ai/artifact/WZXtXtDYsrFNe8nmeniF9i (Trail section).
>
> The backlog is built on the **recommended defaults** in §2. Any decision still open is marked;
> if one changes, the affected tickets are noted next to it.

**Status key:** ⬜ to do · 🔄 in progress · ✅ done · ⏸ blocked
**Size:** S ≈ under half a day · M ≈ 1 day · L ≈ 2–3 days
**Owner:** 🤖 Claude (implementation) · 👤 you

---

## 1. What Trail is

A path-drawing logic puzzle. The player draws **one continuous line** through a square grid,
moving between side-by-side cells (no diagonals), passing the **numbered checkpoints in order**
(1, 2, 3…), **visiting every cell exactly once** and finishing on the last number. In the same
family as LinkedIn's Zip; never use "Zip" in the product.

**What makes it ours (not a Zip copy):**

| Twist | What it is | Where |
|---|---|---|
| **Walls** | Thin walls between some cells that the line can't cross. They let the generator use fewer numbers, which makes boards harder. | Hard, Summit Climb |
| **Trail Tips** | A hint draws the next correct stretch of the line (to the next number) and says why it's forced, e.g. *"The corner at row 1, column 7 has only one way in."* It never draws the whole path. | All modes (costs points) |
| **Map-route theme** (follows the owner's logo, 2026-11-10) | Numbers are coloured map pins, the line is a golden path on a tiled board. On solve, the path glows along the route and the last pin drops in. | Everywhere |
| **Summit Climb** | The tournament: five boards from 5×5 to 8×8 against the clock, with the summit getting higher as you go. | Tournament |

| Mode | Shape |
|---|---|
| **Daily** | One 7×7 board per day, the same for everyone. |
| **Classic** | Easy 5×5 (more numbers) · Medium 6×6 · Hard 8×8 (fewer numbers + walls). Unsolved boards first. |
| **Summit Climb** (Tournament) | 5 timed boards (5×5 → 8×8). A solved board banks 30; a board that runs out of time banks 10 and the climb continues (Quilt's rule). Completion bonus at the summit. |

Like Pounce, Trail ships with **three modes** (Daily, Classic, Tournament) to match the other
games.

**Controls:** press on 1 and drag through cells; dragging back along the line undoes; tapping a
cell already on the line cuts the line back to it; "Clear line". Keyboard: arrows extend or
retract the line from its end. The line is checked by the rules, not against a stored answer.

**Content is generated, not written** (Pounce's model): Admin → Trail → Generate makes a year
of Dailies in the browser, each proven to have exactly one solution.

### Data shape (one board ≈ 400 bytes)

```json
{
  "difficulty": "hard", "size": 8,
  "checkpoints": [{ "x": 0, "y": 1, "n": 1 }, { "x": 5, "y": 6, "n": 2 }, "..."],
  "walls": [{ "x": 3, "y": 2, "side": "right" }, { "x": 1, "y": 4, "side": "down" }],
  "solution": [8, 0, 1, 9, "...cell indices in path order"],
  "grade": { "checkpoints": 6, "nodes": 1840 }
}
```

gameTypes: `trail` · `trail-classic` · `trail-tournament` · `trail-tournament-bonus`. gameId
`trail`, URL `/trail`.

---

## 2. Decisions (recommended defaults — say "accept all" or change any)

| # | Decision | Recommended default | Affects |
|---|---|---|---|
| D1 | Name | "Trail" — **conflicts with an existing game; to be renamed** (Claude suggests screened names) | T-301 onwards |
| D2 | Sizes | Daily 7×7 · Easy 5×5 · Medium 6×6 · Hard 8×8 · Climb 5→8 | T-101, T-401 |
| D3 | Unique solution required? | **Yes**, every board proven to have exactly one path | T-102, T-104 |
| D4 | Daily scoring | 10 + time bonus (≤1 min 10 / ≤2 min 8 / ≤4 min 6 / else 5) − 3 per Trail Tip (never below 5) + 5 **Trailblazer** (no tips, no "Clear line"); cap 30 | T-302 |
| D5 | Classic scoring | Daily × 0.8 / 1.0 / 1.3 (max 33) | T-401 |
| D6 | Summit Climb | 5 boards · 3 min each · 30 solved / 10 timed out · admin-set completion bonus + 25 if all 5 solved | T-501 |
| D7 | Trail Tips | Unlimited, −3 each, reveal the next stretch only | T-204 |
| D8 | Daily replay | One scored solve per day (as Sudoku/Quilt/Pounce) | T-302 |
| D9 | Launch content | 365 Daily · 100 per Classic difficulty · 10 Climbs (all generated) | O-08 |
| D10 | **"Every Daily" achievements** (Perfect Day, Daily Mind Champion, Triple Threat…) | **Change to "any 5 Dailies in one day"** before Trail launches — 7 Dailies a day is a lot to ask. Owner's call; it changes badges players are working toward | T-706 |

---

## Summary

| Epic | Tickets | Claude days (approx.) | Status |
|---|---|---|---|
| E1 Puzzle core | T-101 – T-105 | 6 | ⬜ |
| E2 Engine | T-201 – T-206 | 5 | ⬜ |
| E3 Daily end-to-end | T-301 – T-305 | 3.5 | ⬜ |
| E4 Classic | T-401 | 1 | ⬜ |
| E5 Summit Climb | T-501 – T-502 | 2.5 | ⬜ |
| E6 Admin | T-601 – T-603 | 3.5 | ⬜ |
| E7 Progression, SEO, docs | T-701 – T-706 | 3 | ⬜ |
| E8 Test & release | T-801 – T-802 | 1.5 | ⬜ |
| **Total** | **30 tickets** | **~26 working days** by ticket size (less than Pounce's ~30: the admin, page and test patterns are reused) | |
| Owner (you) | O-01 – O-12 | — | 1 of 12 done |

---

## E1 — Puzzle core (no UI)

**T-101 · Path generator** · L · 🤖 · ⬜
`src/js/games/trail/trail-generator.js`, seeded (`mulberry32`/`stringToSeed`).
- Random Hamiltonian path over the grid (random walk, fewest-onward-moves first, backtracking),
  then checkpoints on its start, end and points along it.
- **Minimise checkpoints:** remove numbers one by one while the board stays uniquely solvable
  (T-102), down to the difficulty's floor. Hard adds walls on edges the solution doesn't use,
  to cut off other paths and allow even fewer numbers.
- **Done when:** 100 boards per size (5–8) generate in < 1 s each on a mid-range phone, all valid.

**T-102 · Uniqueness solver** · L · 🤖 · ⬜
`trail-solver.js`: counts solutions up to 2 (path search from checkpoint 1, respecting walls and
checkpoint order), with pruning:
- every unvisited cell must stay reachable (one connected region);
- a free cell with only one free neighbour must be the path's end;
- the next checkpoint must stay reachable within the cells left before it.
- Also `checkLine(board, line)` (rules check for the engine) with readable errors.
- **Done when:** it agrees with brute force on 300 random 4×4/5×5 boards, and an 8×8 Hard board
  checks in < 200 ms.

**T-103 · Trail Tips** · M · 🤖 · ⬜
`trail-hints.js`: given the player's current line, find the longest stretch that is **forced**
(every solution shares it) towards the next number, and explain the main reason in one sentence
(dead-end corner, a cell with only two ways in, a wall, the only route to the next number). If
the player's line has left the solution, the tip says so and cuts it back to the last correct cell.

**T-104 · Grader + validator** · S · 🤖 · ⬜
Size, checkpoint order and positions, walls in range, `solution` passes `checkLine`, unique,
grade inside the difficulty band (checkpoint count + search effort). Readable errors for Admin.

**T-105 · Soak test** · S · 🤖 · ⬜
`tools/trail-soak-test.mjs`: solver vs brute force, 1000 boards per difficulty (unique, valid,
seed-stable, timing, grade spread), 10 Summit Climbs.

---

## E2 — Engine

**T-201 · Board render** · M · 🤖 · ⬜
`trail-engine.js`: grid with fixed equal tracks (`minmax(0, 1fr)`, the Pounce Safari lesson),
map-pin checkpoints, walls, the line as an SVG footpath that stays sharp at every size.

**T-202 · Drawing input** · M · 🤖 · ⬜
Pointer events (mouse, touch, pen): start on 1 or the line's end, extend to side-by-side cells,
back up by dragging back, tap a cell on the line to cut back to it, order rule for numbers, walls
block moves. Keyboard play. Undo and Clear.

**T-203 · Feedback + motion** · S · 🤖 · ⬜
Gentle nudge when a move breaks a rule ("Reach 3 before 4"), the checkpoint pin fills as it's
reached, and the solve animation (the trail draws itself, the summit flag rises). Respects
`prefers-reduced-motion`.

**T-204 · Trail Tips panel** · S · 🤖 · ⬜
Hint button → draws the stretch, highlights the reason, shows the sentence; counts tips.

**T-205 · Stats + lifecycle** · S · 🤖 · ⬜
Time (stopwatch from first touch; countdown for the Climb), cells filled / total, tips; Trailblazer
tracking; one `onComplete(result)` + `destroy()`.

**T-206 · Styles** · S · 🤖 · ⬜
`src/css/pages/trail.css` with `--color-trail-*` tokens in `base.css`. 8×8 readable on a 360 px
phone. Tested in **WebKit as well as Chrome** this time (Safari engine), not just Chrome.

---

## E3 — Daily end-to-end

**T-301 · Page + routing** · M · 🤖 · ⬜
`src/html/trail.html` (3 tabs: Daily / Classic / Summit Climb, ad slots, How to Play with an
example board, Tips & Strategy, ~20-question FAQ, meta/og tags), `trail-page.js`
(`trySession()`, mode tabs, `activeRound`), `firebase.json` rewrite, sitemap.

**T-302 · Daily data + scoring** · M · 🤖 · ⬜ · *D4, D8*
`trail-daily-data.js` + `trail-scoring.js`. `gameDate` **and** `scoreDate`; both share flags
created `false`.

**T-303 · Summary + share** · S · 🤖 · ⬜
Summary popup (adapted from Pounce's), share text without spoilers, e.g.
`🥾 Daily Trail #12 — Trailblazer! · 1:42 · 0 tips`, +20 / +10 share bonuses.

**T-304 · Firestore rules** · M · 🤖 · ⬜
`trailDailyPuzzles` / `trailClassicPuzzles` / `trailTournaments` / attempts; caps for all four
gameTypes; share lists; **all 18 achievement ids and both championship `gameId` lists** at the
same time as `trail` goes into `GAMES`.

**T-305 · Site wiring** · S · 🤖 · ⬜
`GAMES`, `checkPlayedTodayAll()`, `GAME_LABELS`, `AD_SLOTS` + admin ad forms, leaderboard
picker (automatic), home tile using a matching `home-tile-trail.png` (7 tiles: the 7th sits in the
middle column of a third row), every page listing the games. **Done when:** the e2e test shows a
Daily solve on the leaderboard, profile and home tile.

---

## E4 — Classic

**T-401 · Classic** · M · 🤖 · ⬜ · *D2, D5*
`trail-classic-data.js`: Easy / Medium / Hard picker, unsolved boards first, scoring × 0.8 / 1 / 1.3.

---

## E5 — Summit Climb

**T-501 · Climb data** · L · 🤖 · ⬜ · *D6*
`trail-tournament-data.js` on Quilt's Patchwork Run shape: list / start / continue, per-board
countdown, 30 / 10 banked per board in one transaction, completion bonus + 25 for a clean climb,
retry-safe finish.

**T-502 · Climb UI** · S · 🤖 · ⬜
Progress as a mountain profile with 5 camps (✓ / ✕ / current), summit flag at the end, summary.

---

## E6 — Admin

**T-601 · Admin section** · M · 🤖 · ⬜
`trail-admin.js` + `trail-admin-page.js` (Pounce's two-module pattern): Daily (year → month) and
Classic (by difficulty) tables with View / Regenerate (+ Delete for Classic), JSON import/export.

**T-602 · Generate in the browser** · M · 🤖 · ⬜
Count + difficulty (+ start date for #1) → Generate (with progress) → preview (grade spread,
sample boards) → Add, all-or-nothing, duplicates refused.

**T-603 · Climb builder + plumbing** · S · 🤖 · ⬜
One or many Climbs, Active / Inactive; `trailTournamentSettings` form; activity-summary rows.

---

## E7 — Progression, SEO, docs

**T-701 · Badges** · S · 🤖 · ⬜ · needs O-04
18 badges → `tools/process-badges.py` → 240 px → `CUSTOM_IMAGES`; checked on dark and light.

**T-702 · Tiles** · S · 🤖 · ⬜ · needs O-03
`tile-trail.png` (square, profile + How to Play) and `home-tile-trail.png` (400×320, same sizing
as the other six).

**T-703 · SEO** · S · 🤖 · ⬜
Tips & Strategy, FAQ, og/twitter tags (stand-in until O-05), sitemap.

**T-704 · Docs** · M · 🤖 · ⬜
`src/js/games/trail/CLAUDE.md`, every CLAUDE.md and project doc that lists the games (as for
Pounce), content guide section, `adding-a-new-game.md` lessons.

**T-705 · Meta Pixel** · S · 🤖 · ⬜
`GameCompleted` for `trail` / `trail-classic` / `trail-tournament`.

**T-706 · "Every Daily" achievements** · S · 🤖 · ⏸ needs D10
If D10 is accepted: Perfect Day / Daily Mind Champion / Triple Threat count **any 5** Dailies in a
day (achievement copy, `xp-service.js`, `mission-service.js`, profile progress), with a note for
players. Ship before or with Trail.

---

## E8 — Test & release

**T-801 · Test pass** · M · 🤖 · ⬜
Soak 1000, engine browser test (**Chrome + WebKit**), e2e Daily / modes / admin against the
emulators, site smoke over all 7 games.

**T-802 · Release notes** · S · 🤖 · ⬜
`docs/trail-release-notes.md`: deploy order (deploy → Admin Generate + Add → announce), rollback.

---

## Owner backlog (you)

| ID | Task | Needed by | Status |
|---|---|---|---|
| O-01 | Accept or change decisions D1–D10 (especially **D10**) | before E1 | ⬜ |
| O-02 | Pick the final name from Claude's screened suggestions ("Trail" conflicts) — no separate trademark task | before T-301 | ⬜ |
| O-03 | Logo | T-702 | ✅ 2026-11-10 — `logos/trail.png` in the OneDrive reference folder (1756×895; was `docs/Images/Trail - Logo.png`): a tiled board, numbered map pins 1–4, golden path, pin as the "I"; a test home tile matches the other six |
| O-04 | 18 achievement badges (same set as other games) | T-701 | ⬜ |
| O-05 | Share image 1200×630 — no art needed: Claude generates it from the logo with `tools/make-share-image.py` (needs one tagline) | T-703 | ⬜ |
| O-06 | ~~How to Play banner~~ | T-301 | ➖ dropped 2026-11-13 — not needed: no game uses a How to Play banner image (the card shows the logo/tile) |
| O-07 | Play-test the engine sample on your phone and in Safari | after E2 | ⬜ |
| O-08 | Generate content in Admin → Trail (365 Daily, 100 per Classic level, 10 Climbs) | after deploy | ⬜ |
| O-09 | Final play-test (phone, desktop, Safari) | after T-801 | ⬜ |
| O-10 | Approve deploy | after T-802 | ⬜ |
| O-11 | Indexing for `/trail`: Bing — Claude submits via IndexNow after deploy; Google — owner requests in Search Console | after deploy | ⬜ |
| O-12 | Launch post in the Facebook group | after deploy | ⬜ |

**Carried over from Pounce (still open, 2026-11-13):** request Google indexing for `/pounce`, and one
Facebook post for Quilt + Pounce. (Runs and play-test done; trademark and banner items dropped.)

---

## Suggested sprints

| Sprint | Tickets | Outcome |
|---|---|---|
| 1 | T-101 – T-105 | Boards generate, are unique, graded; tips work on any line |
| 2 | T-201 – T-206 | A playable board on any screen, Chrome + Safari → you do O-07 |
| 3 | T-301 – T-305, T-702 | **Daily works end to end** on the emulators |
| 4 | T-401, T-501, T-502 | Classic and Summit Climb |
| 5 | T-601 – T-603 | Admin generates all content |
| 6 | T-701, T-703 – T-706, T-801, T-802 | Badges, SEO, docs, achievements change, test, release |
