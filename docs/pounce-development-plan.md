# Pounce — Development Plan & Backlogs

> Status: **planning → sprint 1** — drafted 2026-10-20. All §2 decisions accepted with the
> recommended defaults (2026-10-20). Name chosen 2026-10-20: **Pounce** (trademark check still to do, D1).
> Follows `docs/adding-a-new-game.md`, which stays the source of truth for *every* touchpoint.
> This doc orders the work and splits it between **Claude (implementation)** and **Owner (you)**,
> the same way `docs/quilt-development-plan.md` did for Quilt.

## 1. What Pounce is

A Star Battle-style placement puzzle (the same family as Meowdoku and LinkedIn's Queens) about
cats looking for nap spots. The board is an N×N grid split into N coloured regions. The player
places one cat per **row**, per **column** and per **region**, and no two cats may **touch**, not
even diagonally. Each puzzle has exactly one solution, and logic alone reaches it.
("Star Battle-style" goes in descriptions/SEO only. Never use "Meowdoku" or "Queens" anywhere.)

Quilt already owns the picture reveal, so Pounce stands out from the copies in other ways:

| Twist | What it is | Where |
|---|---|---|
| **Pawprint clues** 🐾 | Some empty cells show a number (0–2): how many cats are in the 8 cells around them. This adds Minesweeper-style logic that no Queens clone has. | Classic Hard, the last boards of a run |
| **Sleeping dogs** 🐕 | Blocked cells: no cat can nap on a dog's cell. Lets the generator shape difficulty. | Medium and up |
| **"Why?" hints** 💡 | A hint never just reveals a cell. It highlights the cells involved and explains the deduction, e.g. *"The blue region fits only in row 5, so no other cat can use row 5."* | All modes (costs points) |
| **Nine Lives Run** | The tournament: a run of boards that grows from 5×5 to 9×9, with **9 lives shared across the whole run**. | Tournament |
| **Cat Café** | Each solved Daily "adopts" a unique cat (coat, pattern, accessory, name) drawn from that day's seed. The profile shows your collection. | Daily → profile |

The same step-by-step logic solver drives both the hints and the **difficulty grading**:
a puzzle's difficulty is the hardest technique it needs, not just its size. That gives a much
fairer Easy/Medium/Hard than size alone.

| Mode | Shape |
|---|---|
| **Daily** | One 8×8 puzzle per day, the same for everyone, graded Medium. Dogs allowed, no pawprints. |
| **Classic** | Unlimited, by difficulty: Easy 6×6 · Medium 8×8 (+ dogs) · Hard 9×9 (+ dogs + pawprints). |
| **Tournament: "Nine Lives Run"** | 5 boards (5×5 → 9×9), 9 lives for the whole run. A wrong cat costs a life; running out ends the run with the points banked so far. Completion bonus + a bonus per life left. |
| **Zen** | Unscored Classic boards (any difficulty): no timer, mistakes highlighted rather than counted, free hints. Writes no score docs. Added to v1 on 2026-10-20. |

**Controls:** tap cycles empty → ✕ → 🐱 → empty. Long-press (or a toolbar toggle) places a cat
directly. An optional "Auto-✕" assist marks the cells a new cat rules out (off by default, and
using it doesn't block the no-mistakes bonus). A cat is checked against the solution as soon as
it's placed: a wrong one shakes, counts as a mistake and is removed.

**Sharing:** text copy + paste through the existing "Copy Result & Share with Community" flow.
The share text holds stats and an emoji line (e.g. `🐱🐱🐱 · 2:41 · 0 mistakes · 0 hints`) and
never spoils the board. The Daily share includes the adopted cat's name.

### Data shape (one puzzle ≈ 300 bytes)

```json
{
  "difficulty": "hard", "size": 9,
  "regions":   ["000111222", "..."],
  "solution":  [3, 0, 6, 1, 8, 2, 5, 7, 4],
  "dogs":      [{ "x": 2, "y": 4 }],
  "pawprints": [{ "x": 5, "y": 1, "n": 2 }],
  "grade":     { "technique": "region-lock", "steps": 31 }
}
```

`regions` uses digit-string rows (one digit per region, max 10 regions), and `solution` is the
cat's column for each row. Both are flat, so Firestore can store them as they are.

### gameTypes

`pounce` (Daily) · `pounce-classic` · `pounce-tournament` (per board) · `pounce-tournament-bonus`
(completion). gameId `pounce`, URL `/pounce`.

### Brand (drafted 2026-10-20)

**Idea:** cozy, cheeky house cats who each want their own spot, and who don't share. Meowdoku is
"sweet cats"; Pounce is **"cats with attitude"**: playful, a little smug, never babyish. The
personality comes from the cats, not from puns everywhere. Make our own look; never copy
Meowdoku's art, colours or layout.

- **Taglines:** "Find the spot. Pounce." (main) · "One cat per row. No cuddling." (social/ads)
  · "Nine lives. Five boards. No mercy." (Run)
- **Mascot:** **Mochi**, a round ginger cat with half-closed, judging eyes. She's in the logo,
  How to Play, empty states and the Run.
- **Visuals:** warm cream background, **ginger orange `#F28C38`** as the accent, a soft charcoal
  outline. Regions use 10 muted cozy colours (blanket, cushion and rug colours) separated by thick
  borders, so the board stays readable for colour-blind players. Rounded, chunky shapes.
- **Cats on the board:** 6 coat variants (ginger, black, white, tabby, calico, grey), so a solved
  board looks like a houseful of different cats. The variants also feed the Cat Café.
- **Motion (the "pounce"):** placing a cat → a crouch, a butt-wiggle, a hop into the cell.
  Wrong cat → it puffs up, hisses and hops off. Solved → every cat curls up, followed by a "zzz"
  ripple. Each lasts ≤ 400 ms and respects `prefers-reduced-motion`.
- **Optional sound** (off by default): a soft "mrrp" on placing, a hiss on a mistake, a purr on solve.

**Words used in the game** (keep them short; one cat word per message at most):

| Thing | Word |
|---|---|
| Daily puzzle | **Daily Pounce #N** |
| ✕ mark | "Not here" |
| Mistake | "Hiss! That spot's taken." |
| Hint | **Whisker Tip** (always explains why) |
| No mistakes + no hints | **Purrfect** (+5) |
| Solved | "Every cat found its spot." |
| Tournament | **Nine Lives Run** (❤️ → 🐾 lives) |
| Collection | **Cat Café**: "You adopted Biscuit!" |

**Share text** (no spoilers):

```
🐾 Daily Pounce #42 — Purrfect!
🐱🐱🐱🐱🐱🐱🐱🐱  2:41 · 0 hisses · 0 tips
Adopted: Biscuit the tabby 🧡
dailymindchallenge.com/pounce
```

**Art prompts for the owner** (any AI image tool; ask for the exact ratio up front):

- **Logo (square):** "Flat vector logo for a puzzle game called POUNCE. A round ginger cat
  mid-pounce, front paws reaching, half-closed smug eyes, chunky rounded letters in charcoal with
  a ginger-orange accent, warm cream background, simple shapes, readable at 64px, no gradients,
  no text other than POUNCE."
- **How to Play banner (~3:1):** "The same ginger cat and five other house cats (black, white,
  tabby, calico, grey) each sitting on its own cushion on a colourful patchwork floor grid, none
  touching, cozy flat vector style, cream background, room on the left for a title."
- **Share image (1200×630, 1.91:1):** "Wide flat vector banner: the POUNCE logo on the left and
  the ginger cat leaping onto a glowing grid cell on the right, cream background, bold and simple
  so it reads as a small thumbnail."
- **Badges (18, square, transparent background):** the ginger cat with a tier prop: bronze /
  silver / gold collar bell (Expert / Master / Grand Master); a cushion, a cat tower and a crown
  for the Daily / Weekly / Monthly champion tiers. Follow the existing badge workflow
  (Claude removes the background, resizes to 240px and wires `CUSTOM_IMAGES`).

### Content is generated, not drawn

Unlike Quilt, the owner doesn't make any puzzle content. The admin page gets a **"Generate"**
button (runs in the browser): pick a mode, difficulty and count, preview the boards with their
grades, then save all or nothing. A year of Dailies is one click. That takes content off the
launch critical path, which was the longest owner task for Quilt.

---

## 2. Decisions (all D2–D10 accepted with the recommended default, 2026-10-20)

| # | Decision | Recommended default | Needed by |
|---|---|---|---|
| D1 | Final name + trademark search | **Pounce** — chosen 2026-10-20 (rejected: Catnap, a Poppy Playtime character; Kitty Corners, an existing game with the same rules). Trademark check pending (O-02). | Phase 3 |
| D2 | Board sizes | Daily 8 · Easy 6 · Medium 8 · Hard 9 · Run 5→9 | Phase 1 |
| D3 | Wrong cat handling | Checked against the solution right away, counts as a mistake, no game over outside the Run | Phase 2 |
| D4 | Daily scoring | 10 base + time bonus (≤2m 10 / ≤4m 8 / ≤8m 6 / else 5) − 2 per mistake − 3 per hint (min 5) + "Purrfect" +5 (0 mistakes, 0 hints); cap 100 | Phase 3 |
| D5 | Classic scoring | Same formula × difficulty (Easy 0.8 / Medium 1.0 / Hard 1.3) | Phase 4 |
| D6 | Run rules | 5 boards · 9 lives shared · 4 min per board (timeout = −1 life, next board) · board pass 30 · +5 per life left · admin-set completion bonus | Phase 5 |
| D7 | Hints | Unlimited, −3 points each, explained deduction, never a bare reveal | Phase 2 |
| D8 | Daily replay rule | One scored solve per day (as with Sudoku/Quilt) | Phase 3 |
| D9 | Cat Café in v1? | Yes, as a "lite" version: cats are derived from solved Daily dates (no new collection or rules), with procedural SVG cats (no art needed) | Phase 7 |
| D10 | Launch content volume | 365 Daily · 100 per Classic difficulty · 10 Runs (all generated) | Phase 8 |

---

## 3–4. Backlogs

Moved to **`docs/pounce-backlog.md`** (2026-10-20): 33 Claude tickets (P-101 – P-802) with
acceptance criteria, the owner backlog (O-01 – O-12), and suggested sprints. Logo and badges are
already done.

---

## 5. Timeline and dependencies

```
Phase 1 core (generator + logic solver) ──► Phase 2 engine ──► Phase 3 Daily ──► Phase 4 Classic
                                                                   │                  │
   O-01 decisions, O-02 TM ──────────────────────────────────────────┘   Phase 5 Run ◄──┘
   O-05 – O-06 art ─────────────────────────────────────────────► Phase 7 Café/SEO/docs
   Phase 6 admin generator ──► O-08 content──────────────────────► Phase 8 test ──► O-09 – O-12 launch
```

Rough total for Claude's backlog: **~30 working days** by ticket size (see the backlog). The riskiest piece is P-103 (the
technique solver): hints, grading and the generator's quality all depend on it, so it comes first.
Because content is generated, the critical path is **the trademark check + share image and banner (O-02, O-05, O-06)**, not content.

**Out of scope for v1** (candidates for later): Expert mode with 2 cats per row/column/region on
10×10 (v1.1), a Learn / Academy mode of technique lessons (v1.1), a full Cat Café (rarities,
outfits, a shareable café card), Speed Paws, a Weekly Big Board, Challenge a Friend, an image
share card.
