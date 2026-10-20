# Pounce — Development Backlog

> Created 2026-10-20. This is the **source of truth for Pounce's work items**. The *what and why*
> (rules, modes, brand, data shape, decisions) lives in `docs/pounce-development-plan.md`.
> Every touchpoint must still follow `docs/adding-a-new-game.md`.
>
> The backlog is built on decisions D2–D10 in the plan (all accepted with the recommended defaults,
> 2026-10-20). If one changes later, the affected tickets are noted next to it.

**Status key:** ⬜ to do · 🔄 in progress · ✅ done · ⏸ blocked
**Size:** S ≈ under half a day · M ≈ 1 day · L ≈ 2–3 days
**Owner:** 🤖 Claude (implementation) · 👤 you

## Summary

| Epic | Tickets | Claude days (approx.) | Status |
|---|---|---|---|
| E1 Puzzle core | P-101 – P-105 | 6–7 | ✅ 2026-10-20 |
| E2 Engine | P-201 – P-207 | 5–6 | ✅ 2026-10-20 |
| E3 Daily end-to-end | P-301 – P-305 | 4 | ✅ 2026-10-20 |
| E4 Classic + Zen | P-401 – P-402 | 1.5 | ✅ 2026-10-20 |
| E5 Nine Lives Run | P-501 – P-502 | 3 | ✅ 2026-10-20 |
| E6 Admin | P-601 – P-604 | 5 | ✅ 2026-10-20 |
| E7 Progression, Cat Café, SEO, docs | P-701 – P-708 | 4 | 🔄 (P-702–P-704, P-707 done) |
| E8 Test & release | P-801 – P-802 | 1.5 | ⬜ |
| **Total** | **33 tickets** | **~30 working days** by ticket size | |
| Owner (you) | O-01 – O-12 | — | 3 of 12 done |

---

## E1 — Puzzle core (no UI)

The foundation: everything else depends on it. P-103 is the riskiest ticket in the project.

**P-101 · Generator** · L · 🤖 · ✅
`src/js/games/pounce/pounce-generator.js`.
- Seeded with `mulberry32` / `stringToSeed` from `helpers.js`; the same seed always gives the same board.
- Places a valid cat layout (one per row/col, no touching), grows N connected regions around the
  cats, adds dogs (Medium+) and pawprints (Hard), and retries until the solution is unique (P-102).
- Covers sizes 5–9 (and 10 for v1.1 Expert) and returns the plan's data shape.
- **Done when:** 100 boards per size generate in < 1 s each on a mid-range phone, all valid.

**P-102 · Uniqueness solver** · M · 🤖 · ✅ · needs P-101
`pounce-solver.js`: a backtracking counter that stops at 2 solutions and supports dogs + pawprints.
- **Done when:** it agrees with brute force on 500 random 5×5/6×6 boards.

**P-103 · Technique solver (hints + grading)** · L · 🤖 · ✅
`pounce-logic.js`: returns one deduction at a time as `{technique, cells, eliminations, text}`.
- Techniques, easiest first: last cell in a row/col/region → neighbours of a cat → region locked
  to one row/col → k regions locked to k rows/cols → pawprint counts → "this placement would
  empty a region".
- Every step has one plain-English sentence (used as the Whisker Tip text).
- **Done when:** it solves ≥ 99% of generated boards without guessing, and every step's
  eliminations are correct against the known solution.

**P-104 · Grader + validator** · S · 🤖 · ✅ · needs P-102, P-103
- Checks size, region count = N, connected regions, a unique solution, solvable by logic, and
  the grade inside the target band for its difficulty.
- Returns readable errors and warnings for the admin preview (P-602).

**P-105 · Generator soak test** · S · 🤖 · ✅ · needs P-104
A repeatable Node script (kept in the repo this time) that generates 1,000 boards per difficulty
and reports the uniqueness, logic-solvable rate, grade distribution and timing.

**Sprint 1 notes (2026-10-20):** `tools/pounce-soak-test.mjs 1000` passes. All 3,000 boards were
generated (≤ ~20 ms each, far under the 1 s bar), all unique and solvable by logic, and every logic
step was checked against the known solution. The solver also matches brute force on 300 small boards,
including dogs and pawprints; this caught a real bug, where a pawprint in the bottom row wasn't checked
exactly. Two quality rules were added along the way: no region may have fewer than 2 usable cells
(it gives its cat away), and the hint text is plain sentences. The hardest step needed per difficulty is
easy = line-lock (100%), medium = line-lock 10% / would-empty 48% / group-lock 42%, and hard =
would-empty 17% / group-lock 16% / what-if 67%. Hard leans on what-if; revisit after play-testing
(O-09) if Hard feels too hard.

---

## E2 — Engine

**P-201 · Board render** · M · 🤖 · ✅ · needs P-101
`pounce-engine.js`: an N×N grid; 10 muted, cozy region colours plus thick region borders
(readable for colour-blind players); dog cells; pawprint numbers.

**P-202 · Input** · M · 🤖 · ✅ · needs P-201
- Tap cycles empty → ✕ → 🐱 → empty; long-press places a cat; a toolbar "cat / ✕" toggle;
  pointer events for mouse + touch.
- The optional Auto-✕ assist (off by default) marks the cells a new cat rules out.
- Undo.

**P-203 · Checking + motion** · M · 🤖 · ✅ · needs P-202
- A cat is checked against the solution on placement; a wrong cat counts as a mistake ("Hiss!
  That spot's taken.") and hops off.
- Animations: pounce on place, hiss on a mistake, everyone curls up + a "zzz" ripple on solve.
  Each ≤ 400 ms, respecting `prefers-reduced-motion`.
- Optional sounds (off by default).

**P-204 · Whisker Tip hints** · M · 🤖 · ✅ · needs P-103, P-201
A hint button → highlights the cells involved, shows the P-103 sentence and applies the
eliminations as ✕ marks. It never reveals a cat outright, except as the very last resort (when
only placements remain).

**P-205 · Stats + lifecycle** · S · 🤖 · ✅ · needs P-203
- Stats bar: a stopwatch from the first touch, cats placed / N, mistakes, tips used.
- Purrfect tracking (0 mistakes, 0 tips; Auto-✕ is allowed).
- A `zen` option (no clock, mistakes highlighted rather than counted, free tips).
- A single `onComplete(result)` and `destroy()`.

**P-206 · Styles** · S · 🤖 · ✅ · needs P-201
`src/css/pages/pounce.css`: brand colours (cream, ginger `#F28C38`, charcoal), responsive down
to 360px. A 9×9 board with pawprints must stay readable on a phone; the board auto-scrolls into
view (as Quilt's does).

**P-207 · Cat coats** · S · 🤖 · ✅
`pounce-cats.js`: SVG cat faces in 6 coats (ginger, black, white, tabby, calico, grey), shared
by the board and the Cat Café (P-701).

**Sprint 2 notes (2026-10-20):** `pounce-engine.js` + `src/css/pages/pounce.css` (colours come
from new `--color-pounce-*` tokens in `base.css`). Beyond the tickets: drag paints ✕ (or erases
them when the drag starts on one), arrow-key/Space/Enter/X keyboard play with ARIA grid labels,
and correct cats lock in place (a wrong cat never stays on the board, so a cat is always right).
A tip first clears any ✕ the player put on a real cat spot. `tools/pounce-preview.html` and
`tools/pounce-browser-test.mjs` (24 checks in the system Chrome: every control, Daily/Classic/
Run/Zen results, keyboard-only Purrfect, out of lives, 360px with no sideways scroll and 36px
cells on 9×9) all pass. While testing, the lilac region colour was swapped for plum (it looked
too like lavender). The engine isn't mounted on a real page yet; that's P-301.

---

## E3 — Daily end-to-end

Built before Classic on purpose, to catch the `scoreDate` / `GAME_TYPES` gotchas early.

**P-301 · Page + routing** · M · 🤖 · ✅ · needs E2
`src/html/pounce.html` (mode tabs Daily / Classic / Zen / Nine Lives Run, ad slots, How to Play,
meta/og tags) + `pounce-page.js` (`trySession()`, `wireModeTabs()`, `activeRound` destroy) + the
`firebase.json` rewrite for `/pounce`.

**P-302 · Daily data + scoring** · M · 🤖 · ✅ · needs P-301 · *D4, D8*
`pounce-daily-data.js` + `pounce-scoring.js`.
- One scored solve per day; score = 10 base + time bonus − mistakes − tips + Purrfect, capped
  at 100.
- Writes `gameDate` **and** `scoreDate`, plus `sharedToFacebook: false` and
  `sharedWithFriends: false`.

**P-303 · Summary modal + share** · M · 🤖 · ✅ · needs P-302
`pounce-summary-modal.js`: stats, the adopted cat (P-207 / P-701), share text in the plan's
format (no spoilers), +20 / +10 share bonuses.

**P-304 · Firestore rules** · M · 🤖 · ✅ · needs P-302
- Collections `pounceDaily`, `pounceClassic`, `pounceTournaments` + attempt docs.
- `maxCreateScore()` caps for all 4 gameTypes; share allow-lists.
- The championship `gameId` lists and **all 18 achievement ids**, added at the same time as
  `pounce` goes into `GAMES`; `firestore.indexes.json` if needed.

**P-305 · Cross-site touchpoints** · S · 🤖 · ✅ · needs P-302
`game-registry.js`, the leaderboard tab, `checkPlayedTodayAll()`, the home tile in `index.html`,
`GAME_LABELS` in `profile.js`, `AD_SLOTS`, and every page or footer that lists the games (grep for
the five-game list).
- **Done when:** a Daily solve appears on the leaderboard (Pounce + Overall), in profile Recent
  Activity and in Level, and the home tile shows its "played today" badge.

**Sprint 3 notes (2026-10-20):** `/pounce` page (tabs Daily / Classic / Zen / Nine Lives Run; the
last three say "coming soon" until sprint 4), `pounce-scoring.js` (penalty line shows the deduction
actually applied, so the breakdown adds up), `pounce-daily-data.js` (`pounceDailyPuzzles`, gameScores
`{uid}_pounce_{date}` with `mistakes`, `tips`, `cafeCat`), `pounce-summary-modal.js` (adopted cat at
the top, "−n" lines). Rules: all four Pounce collections (incl. Run attempts with a `livesLeft`
that can only go down), caps 30/40/30/2000, both share allow-lists, 18 achievement ids, both
championship `gameId` lists. Wired into `GAMES`, `checkPlayedTodayAll()`, `GAME_LABELS`,
`AD_SLOTS` + admin ad-slot forms, home tile (6 tiles = 3 even rows on desktop), sitemap, rewrite,
and every page that lists the games. P-702: 18 badges at 240×240 in `CUSTOM_IMAGES`, checked on dark
and light. P-703: `tile-pounce.png` / `tile-pounce-wide.png` cut from the logo. P-704 was done early:
the How to Play card has a generated example board, Tips & Strategy and a 20-question FAQ; og:image is
the logo on white as `fb-share-pounce.png` until O-05.
`tools/pounce-e2e-test.mjs` + `tools/pounce-emulator-seed.mjs`: 24/24 against the emulators. The run
covers sign-in, a Daily solve with 1 hiss + 1 tip = 15 points, the gameScores doc, the +20 share
allowed by the rules (35), the already-played view, leaderboard, profile and home tile. Found while testing, and true of
**Quilt too** (not Pounce bugs): the cookie banner covers a phone board's bottom rows until
answered; on the emulators pages load ~25 s slowly after the home page, and a session restored after
visiting the home page sometimes comes back signed out (the home-tile check can flake); accepting
cookies freezes headless Chrome on localhost (ad/analytics scripts). **Launch note:** `pounce` now
counts for Perfect Day / "every Daily" achievements, so Daily content must be live before deploy.

---

## E4 — Classic + Zen

**P-401 · Classic** · M · 🤖 · ✅ · needs E3 · *D2, D5*
`pounce-classic-data.js`: a difficulty picker (Easy 6×6 / Medium 8×8 / Hard 9×9), a pool from
`pounceClassic` with unplayed boards first, scoring × 0.8 / 1.0 / 1.3.

**P-402 · Zen** · S · 🤖 · ✅ · needs P-401
A Zen tab over the same Classic pool with the engine's `zen` option. It writes no score docs and
has a "Next board" button.

---

## E5 — Nine Lives Run

**P-501 · Run data** · L · 🤖 · ✅ · needs E4 · *D6*
`pounce-tournament-data.js`: list / start / continue.
- 5 boards (5×5 → 9×9), 9 lives shared, 4 minutes per board.
- A wrong cat −1 life; a timeout −1 life and the next board starts; 0 lives ends the run with
  the points banked so far.
- Pass 30 per board, +5 per life left, the admin-set completion bonus.
- Attempt-progress docs, finalize + retry on write failure.

**P-502 · Run UI** · S · 🤖 · ✅ · needs P-501
A progress strip (5 board pips, 🐾 × 9 lives) and the run summary in the modal.

**Sprint 4 notes (2026-10-20):** Owner OK'd **10 points for a board that runs out of time** (or
out of lives), like Quilt. `pounce-classic-data.js` (unplayed boards first; Zen reads the same pool
with `preferUnplayed: false` and writes nothing) and `pounce-tournament-data.js`: `livesLeft` from
`config/pounceTournamentSettings.lives`; each wrong cat is saved at once by `spendLife()` (engine
`onLifeLost`), so leaving mid-board can't refund lives; a timeout costs one more. The run is over
when all 5 boards are played or lives hit 0. The bonus doc is the completion bonus + 5 × lives, but
only for a finished run (0 for out of lives) and it carries the share bonuses. Run UI: a pip
strip (✓ / ✕ / current size) + lives left; the summary lists each board. Settings defaults:
240 s per board, 9 lives (`CONFIG_DEFAULTS`; the admin form is P-604). Engine fix found in testing:
Run hisses now count as mistakes, so a board that lost a life is no longer "Purrfect".
`tools/pounce-e2e-modes-test.mjs`: 28/28 against the emulators. It covers Classic Purrfect Easy = 20
plus the gameScores doc and next-unplayed board; Zen with no clock, no popup and nothing written; Run A
with a life saved at once, a 20 s timeout and out of lives on board 3 = 50, bonus 0; Run B with all 5 =
150 + 100 + 15 = 265. Still known: leaving mid-board restarts that board's clock (same as Quilt and
Sudoku).

---

## E6 — Admin

**P-601 · Admin section + tables** · L · 🤖 · ✅ · needs E3
`pounce-admin.js` + `pounce-admin-page.js` and an `admin.html` section:
- Daily (year → month) and Classic (by difficulty) tables using the `admin-table-grouping.js`
  helpers from the first draft.
- Edit / delete / export.

**P-602 · Generate in the browser** · M · 🤖 · ✅ · needs P-104, P-601
- Choose a mode, difficulty and count (+ a start date for Daily).
- Preview cards with grade and warnings; regenerate any single board; save all or nothing.
- Import / export JSON for hand-made boards.

**P-603 · Run builder** · M · 🤖 · ✅ · needs P-501, P-601
Generate a run (one board per size) or bulk-generate N runs; activate / deactivate / delete.

**P-604 · Admin plumbing** · S · 🤖 · ✅ · needs P-601
- `ACTIVITY_ROWS` (count only the run completion doc).
- `CONFIG_FORMS` / `CONFIG_DEFAULTS` for the run settings (time per board, lives).
- The Pounce ad-slot forms.

**Sprint 5 notes (2026-10-20):** `src/js/admin/pounce-admin.js` + `pounce-admin-page.js`, rendered
into Admin → Pounce (`#pounce-admin-root`), plus the `pounceTournamentSettings` form inside it,
Pounce rows in the Daily Activity Summary, and thumbnail styles in `admin.css` (`.pa-thumb`, since
`pounce.css` isn't loaded there).
- **Daily:** a start date for #1 (only while empty) + how many → **Generate** (365 boards take ~1 s in
  Chrome) → a preview with the grade spread, warnings and 12 sample boards → **Add**. It is add-only
  and continues from `_meta.lastDate`; **Regenerate** swaps one board and keeps its date and number.
- **Classic:** difficulty + count → Generate → Add; Regenerate / Delete per board.
- **Both:** a "hand-made boards (JSON)" import, fully validated (unique + logic-solvable), plus a
  JSON Download in the same format. Every add is all-or-nothing, and duplicates (same regions,
  dogs and pawprints) are refused within the batch and against the pool.
- **Runs:** "Create one run" (Generate & Preview the 5 boards → Create, active) and "Create many
  runs" (N runs named "<name> 1…N", Active or Inactive); View / Activate / Delete per run.

`tools/pounce-e2e-admin-test.mjs` (wipes the local emulator DB, signs up, gets admin through the
emulator) passes 23/23 on two runs in a row. Fixed while testing: Classic difficulty groups open by
default, and 9×9 thumbnails no longer squash. Checked afterwards as a player: today previews Daily #1
(first date 1 Nov), Classic Hard serves 9×9, and only active runs are listed.
**O-08 order:** the content can only be generated through the deployed admin page, so the code goes
live first (Pounce shows "isn't ready yet" until content exists). Deploy, Generate and Add straight
away, then announce. Mind the Perfect Day note from sprint 3.

---

## E7 — Progression, Cat Café, SEO, docs

**P-701 · Cat Café (lite)** · M · 🤖 · ⬜ · needs P-207, P-302 · *D9*
- Each Daily date seeds a cat (coat, pattern, eyes, accessory, name).
- The profile gets a "Cat Café" panel built from the player's `pounce` Daily score docs. No new
  collection, no new rules.

**P-702 · Badges** · S · 🤖 · ✅ · needs P-304 · **art ready ✅**
- 240×240 copies of the 18 transparent badges in `docs/Images/` → `src/assets/images/achievements/`.
- `CUSTOM_IMAGES` entries; checked on dark + light.

**P-703 · Home tile** · S · 🤖 · ✅ · **logo ready ✅**
Cut `tile-pounce.png` (400×400) and `tile-pounce-wide.png` from
`docs/Images/Playful Pounce Cat Puzzle Logo.png`.

**P-704 · SEO content** · M · 🤖 · ✅ · needs P-301
- Tips & Strategy, a ~20-question FAQ, `sitemap.xml`.
- og/twitter tags (stand-in wide tile until O-05 arrives).

**P-705 · Six-game copy review** · S · 🤖 · ⬜ · needs P-305
"All N games" copy and the All-Rounder / Mind Master tiers; note that the "every game"
achievements get harder.

**P-706 · Docs** · M · 🤖 · ⬜
- `src/js/games/pounce/CLAUDE.md` and every CLAUDE.md that lists the games.
- A `content-creation-guide.md` section; BRD/FRS/SAD/TDD/DB/API/test plan/user guide game
  lists (as done for Quilt).
- `adding-a-new-game.md` lessons.

**P-707 · Meta Pixel** · S · 🤖 · ✅ (wired in sprints 3–4) · needs P-302
`GameCompleted` for `pounce` / `pounce-classic` / `pounce-tournament`.

**P-708 · Badge tool in the repo** · S · 🤖 · ⬜ · optional
Save the background-removal + 240px script as `tools/process-badges.py`, so it isn't rebuilt for
every game.

---

## E8 — Test & release

**P-801 · Test pass** · M · 🤖 · ⬜ · needs everything above
- Test-plan cases for every mode on the emulators: leaderboard, profile, Cat Café, home badge,
  admin generate/import, rules.
- Re-run P-105.

**P-802 · Release notes + deploy** · S · 🤖 · ⬜ · needs P-801
`docs/pounce-release-notes.md` with deploy and rollback steps.

---

## Owner backlog (you)

| ID | Task | Needed by | Status |
|---|---|---|---|
| O-01 | Accept or change decisions D2–D10 in the plan | before E1 | ✅ 2026-10-20 (accepted all) |
| O-02 | Trademark check for "Pounce" (USPTO, WIPO, J-PlatPat) | before P-301 | ⬜ |
| O-03 | Logo | P-703 | ✅ 2026-10-20 |
| O-04 | 18 achievement badges | P-702 | ✅ 2026-10-20 (made transparent) |
| O-05 | **Share image** 1200×630 for Pounce **and Quilt** (deferred Quilt O6) | P-704 | ⬜ |
| O-06 | **How to Play banner** for Pounce **and Quilt** (deferred Quilt O5) | P-301 | ⬜ |
| O-07 | Decide about the Quilt originals deleted from `docs/Images/` (restore from git or leave) | any time | ⬜ |
| O-08 | Generate content in Admin → Pounce (after deploying the code, see below): 365 Daily, 100 per Classic difficulty, 10 Runs | after P-602 ✅ — ready | ⬜ |
| O-09 | Play-test on phone + desktop (tap feel, 9×9 readability, hint wording, share text) | P-801 | ⬜ |
| O-10 | Deploy and activate the first Run | after P-802 | ⬜ |
| O-11 | Indexing: Google + Bing for `/pounce`, **plus Bing for `/quilt`** | after O-10 | ⬜ |
| O-12 | One Facebook-group launch post for **Quilt + Pounce** | after O-10 | ⬜ |

---

## Suggested sprints

| Sprint | Tickets | Outcome |
|---|---|---|
| 1 | P-101 – P-105, P-207 | Boards generate, are unique, solvable by logic and graded |
| 2 | P-201 – P-206 | A playable board with hints, on any screen |
| 3 | P-301 – P-305, P-702, P-703 | **Daily works end to end** on the emulators |
| 4 | P-401, P-402, P-501, P-502 | Classic, Zen and the Nine Lives Run |
| 5 | P-601 – P-604 | Admin can generate all content → you do O-08 |
| 6 | P-701, P-704 – P-708, P-801, P-802 | Cat Café, SEO, docs, test, release → you do O-09 – O-12 |
