# Quilt — Development Plan & Backlogs

> Status: **in development** — **all 8 build phases done** 2026-10-18 — ready to deploy (see `docs/quilt-release-notes.md`); owner artwork and content remain; all §2 decisions accepted
> with the recommended defaults; content deferred until the build is done. Logo: `docs/Images/QUILT Logo.png`.
> Follows `docs/adding-a-new-game.md` — that checklist is the source of truth for *every*
> touchpoint; this doc orders the work and splits it between **Claude (implementation)** and
> **Owner (you)**.

## 1. What Quilt is

A Shikaku-style logic puzzle with a **Picture Reveal** twist. The grid shows numbers; the player
drags rectangles so each rectangle holds exactly one number equal to its area, covering the
whole grid. Every solved rectangle fills with colour, and the finished board is a pixel-art
picture. ("Shikaku-style" appears in descriptions/SEO only — never as the game's name.)

| Mode | Shape |
|---|---|
| **Daily** | One picture puzzle per day, same for everyone. Medium size. |
| **Classic** | Unlimited, by difficulty: Easy 7×7 · Medium 10×10 · Hard 14×14 (+ Shape Clues & Blockers). |
| **Tournament — "Patchwork Run"** | Admin-built run of 4 (or 9) puzzles, each one tile of a bigger picture. Per-puzzle time limit; a failed puzzle banks lower points and the run advances (Sudoku/Word Search style); failed tiles show greyed in the final mosaic. Completion bonus. |

**Sharing (decided):** text copy + paste via the existing "Copy Result & Share with Community"
flow. Classic/Tournament share text includes an emoji mosaic of the picture; Daily shares stats
only (no spoiler). Image share cards are out of scope for v1.

### Data shape (one puzzle ≈ 1 KB)

```json
{
  "title": "Pumpkin", "difficulty": "medium", "width": 10, "height": 10,
  "palette": ["#1f2a44", "#ff8a1f", "#3fa34d", "#3b1f0e"],
  "pixels": ["0000220000", "..."],
  "rects":    [{ "x": 0, "y": 0, "w": 4, "h": 1 }, "..."],
  "clues":    [{ "x": 1, "y": 0, "n": 4 }, { "x": 5, "y": 3, "n": 9, "shape": "square" }, "..."],
  "blockers": [{ "x": 2, "y": 4 }]
}
```

Objects, not nested arrays — Firestore can't store arrays of arrays. `shape` (`square` / `strip`)
and `blockers` appear in Hard mode only; Hard turns every 1×1 rectangle into a blocker.

### gameTypes

`quilt` (Daily) · `quilt-classic` · `quilt-tournament` (per puzzle) · `quilt-tournament-bonus`
(completion). gameId `quilt`, URL `/quilt`.

---

## 2. Decisions (all accepted with the recommended default, 2026-10-18)

| # | Decision | Recommended default | Needed by |
|---|---|---|---|
| D1 | Final name confirmed + trademark search done | "Quilt" | Phase 3 |
| D2 | Max colours per picture | 8 (must map to emoji squares 🟥🟧🟨🟩🟦🟪🟫⬛⬜) | Phase 1 |
| D3 | Max rectangle area | Easy 8 · Medium 12 · Hard 16 | Phase 1 |
| D4 | Daily scoring | 10 base + time bonus (≤3m 10 / ≤5m 8 / ≤10m 6 / else 5) + Perfect Stitch (no undo/erase) +5; cap 100 | Phase 3 |
| D5 | Classic scoring | Same formula × difficulty (Easy 0.8 / Medium 1.0 / Hard 1.3) | Phase 4 |
| D6 | Tournament rules | 4 tiles · 3 min per tile · pass 30 / fail 10 · admin-set completion bonus · +25 "Perfect Patchwork" if all tiles pass | Phase 5 |
| D7 | Hard-mode extras in v1? | Yes: Blockers + Shape Clues (▬ strip / ■ square). Can slip to v1.1 without blocking launch. | Phase 4 |
| D8 | Daily replay rule | One scored solve per day (like Sudoku), no retries cooldown | Phase 3 |
| D9 | "Perfect Stitch" name for no-undo bonus | Yes | Phase 3 |
| D10 | Launch content volume | 30 Daily · 20 per Classic difficulty · 2 Tournaments | Phase 8 |

---

## 3. Claude's backlog (implementation)

Sizes: **S** ≈ under half a day · **M** ≈ 1 day · **L** ≈ 2–3 days.

### Phase 1 — Puzzle core (no UI)
- [x] **C1.1 (L)** `src/js/games/quilt/quilt-generator.js`: pixels → rectangle decomposition (max-area cap, per-colour regions), clue placement, seeded RNG (`mulberry32`/`stringToSeed` from `helpers.js`).
- [x] **C1.2 (M)** `quilt-solver.js`: backtracking solver that counts solutions up to 2; generator retries clue placement until exactly one solution. Supports blockers + shape clues.
- [x] **C1.3 (S)** Validator for imported puzzles: size, palette ≤ D2, rects tile the grid exactly, one clue per rect, unique solution. Returns human-readable errors (feeds the admin all-or-nothing import).
- [x] **C1.4 (S)** Picture-quality warnings: too many 1×1 rects, too many colours, solver too slow.

### Phase 2 — Engine
- [x] **C2.1 (L)** `quilt-engine.js`: grid render, drag-to-draw rectangles (mouse + touch, pointer events), tap to remove, live area label while dragging, neutral fabric tint on placed rects (picture colours only on solve, so colour can't give away wrong rects), error highlight (wrong area / 0 or 2+ clues), undo.
- [x] **C2.2 (M)** Picture reveal on completion (rect borders fade, picture "settles"), stats bar (stopwatch starting on first touch, valid pieces / needed), Perfect Stitch tracking (no undo / no removal), single `onComplete()` + `destroy()`.
- [x] **C2.3 (S)** `src/css/pages/quilt.css`, responsive to 360px wide; 14×14 must stay playable on phones.

### Phase 3 — Daily end-to-end (catches the `scoreDate` / `GAME_TYPES` gotchas early)
- [x] **C3.1 (M)** `src/html/quilt.html` (mode tabs, ad slots, How to Play, meta/og tags) + `quilt-page.js` (`trySession()`, `wireModeTabs()`, `activeRound` destroy) + `firebase.json` rewrite.
- [x] **C3.2 (M)** `quilt-daily-data.js` + `quilt-scoring.js` (D4), writes `gameDate` **and** `scoreDate`.
- [x] **C3.3 (M)** `quilt-summary-modal.js`: picture, stats, share text (Daily = stats only; Classic/Tournament = emoji mosaic), +20 / +10 share bonuses.
- [x] **C3.4 (M)** `firestore.rules`: collections `quiltDaily`, `quiltClassic`, `quiltTournaments`, attempt docs; `maxCreateScore()` caps; share allow-lists; `firestore.indexes.json` if needed.
- [x] **C3.5 (S)** Registry & cross-site touchpoints: `game-registry.js`, leaderboard tab, `checkPlayedTodayAll()` in `points.js`, home tile in `index.html`, `GAME_LABELS` in `profile.js`, `AD_SLOTS`.

Phase 3 notes: rules also got `quilt` in both championship `gameId` lists and all 18 achievement
ids (needed as soon as `quilt` is in `GAMES`, since championship/achievement code iterates it), so
C7.1's rules half is done. The share rules now read the flags with `get(..., false)`, which also
fixed a live bug: Sudoku/Word Search Daily + Classic "Share with Friends" +10 was always rejected
(those docs never set `sharedWithFriends`). Home tile, HTP banner and og:image use stand-ins cut from
the logo (`tile-quilt.png`, `tile-quilt-wide.png`) until O4–O6 arrive. Tips & Strategy + 20-question
FAQ are in `quilt.html` already (C7.2 content done; sitemap added too).

### Phase 4 — Classic
- [x] **C4.1 (M)** `quilt-classic-data.js`: difficulty picker, pool from `quiltClassic`, unplayed-first selection, D5 scoring.
- [x] **C4.2 (M)** Hard-mode extras (D7): blocker cells + shape-clue icons in the engine.

Phase 4 notes: Classic serves pictures the player hasn't solved first (a repeated picture is
already spoiled), falling back to "any but the last one". Hard extras were already in the engine
(Phase 2) and generator (Phase 1). The engine now auto-scrolls the whole round into view on mount:
the board blocks touch scrolling and fills a phone's width, so otherwise the bottom rows could only
be reached by scrolling via the 16px margins. Found while testing: the site-wide cookie banner
covers ~45% of a phone screen (and any game board under it) until answered — not Quilt-specific.

### Phase 5 — Tournament "Patchwork Run"
- [x] **C5.1 (L)** `quilt-tournament-data.js`: list/start/continue, per-tile countdown, fail-banks-and-advances, completion bonus, attempt-progress docs, finalize + retry-on-write-failure.
- [x] **C5.2 (M)** Mosaic progress view (2×2 / 3×3 tiles, greyed failed tiles) + final big-picture reveal in the summary modal.

Phase 5 notes: `buildPatchwork()` (generator) cuts one big picture into cols×rows tiles (each 5–20
a side) and makes each a Medium puzzle — the Phase 6 tournament builder just calls it. Per-tile time
is `config/quiltTournamentSettings.timeLimitSeconds` (default 180, in `CONFIG_DEFAULTS`; admin form
in Phase 6). Known limitation shared with Sudoku's tournament: leaving mid-tile and coming back
restarts that tile with a fresh clock.

### Phase 6 — Admin
- [x] **C6.1 (L)** `quilt-admin.js` + admin section: Daily (grouped by year → month) and Classic (grouped by difficulty) tables using `admin-table-grouping.js` helpers from the first draft; add / edit / delete / export.
- [x] **C6.2 (L)** **Import from pixel art in the browser** — upload PNG(s) where 1 pixel = 1 cell (or paste text grids), generator + solver run client-side, preview board + picture, then all-or-nothing save. No local scripts for the owner to run.
- [x] **C6.3 (M)** Tournament builder: upload one big picture (e.g. 20×20), auto-split into 4/9 tiles, each validated as a unique puzzle; activate/deactivate/delete.
- [x] **C6.4 (S)** `ACTIVITY_ROWS` (count completion doc only), `CONFIG_FORMS` / `CONFIG_DEFAULTS` for tournament settings.

Phase 6 notes: Admin → Quilt (`quilt-admin.js` + `quilt-admin-page.js`, Connections' two-module
pattern). Pictures in (PNG at 1 px/cell or text), Preview generates every puzzle and shows a card per
picture with errors/warnings, Add is all-or-nothing. Tables use `admin-table-grouping.js`; Edit
regenerates; Download exports the text format. Patchwork Run builder previews the tile cuts. Also:
`quiltTournamentSettings` config form in the Quilt section, Quilt ad-slot forms, activity-summary
rows. `docs/content-creation-guide.md` has the Quilt format + an AI prompt (C7.4's content-guide part).

### Phase 7 — Progression, SEO, docs
- [x] **C7.1 (S)** Achievement ids in `firestore.rules` `playerAchievements` allow-list (definitions auto-generate from `GAMES`); wire `CUSTOM_IMAGES` once badge art arrives.
- [x] **C7.2 (M)** SEO page content: Tips & Strategy + ~20-question FAQ, `sitemap.xml`, og/twitter tags wired to the supplied share image.
- [x] **C7.3 (S)** Review "all N games" copy and All-Rounder/Mind Master tiers now that there are 5 games.
- [x] **C7.4 (M)** Docs: `src/js/games/quilt/CLAUDE.md`, every CLAUDE.md that lists the games, `content-creation-guide.md` section (PNG + text-grid formats, AI prompts for pixel art).
- [x] **C7.5 (S)** Meta Pixel `GameCompleted` event for Quilt (same as existing games).

Phase 7 notes: achievement ids in the rules match what `achievement-registry.js` generates from
`GAMES`; the 18 Quilt badges use the category emoji until art arrives (O7 → add to `CUSTOM_IMAGES`).
og/twitter tags point at the stand-in `tile-quilt-wide.png` until O6. Every page/README/footer-share
text that listed the games now lists all five (several had still listed only three). Achievement
copy already counts `GAMES` dynamically ("all 5 games"); note for players: adding Quilt makes the
"every game" / "every Daily" achievements harder for anyone who hasn't earned them yet. FRS got a
§3.5a Quilt section; `adding-a-new-game.md` got the extra touchpoints Quilt surfaced.
`trackGameCompleted` fires for quilt / quilt-classic / quilt-tournament.

### Phase 8 — Test & release support
- [x] **C8.1 (M)** Run through `test-plan-and-test-cases.md`-style cases for every mode locally (emulators), incl. leaderboard/profile/home-badge checks.
- [x] **C8.2 (S)** Prepare the deploy command and release notes; Owner runs the deploy.

---

## 4. Owner's backlog (you)

### Before / during Phase 1–3
- [x] **O1** Answer the decisions in §2 — all defaults accepted.
- [ ] **O2** Trademark check for "Quilt" in USPTO, WIPO Global Brand Database and J-PlatPat (~10 min).
- [ ] **O3** Create **5–10 test pictures** for development (any size from 7×7 to 14×14, ≤ 8 colours, blocky shapes). PNG where 1 pixel = 1 cell (Piskel / Aseprite / Lospec), or ask an AI for text grids.

### Artwork (needed by Phase 3 / 7)
- [ ] **O4** Home tile image `tile-quilt.png` (match the existing tiles' size/style).
- [ ] **O5** How to Play banner image.
- [ ] **O6** **Purpose-made** Facebook/link-preview image, wide ~1.91:1 (e.g. 1200×630), simple enough to read as a thumbnail — not a crop of the logo/tile (see `adding-a-new-game.md` §7b).
- [ ] **O7** 18 achievement badges: `quilt-expert`, `-master`, `-grandmaster`, and the Daily / Weekly / Monthly champion tiers (same set as the other games). The game ships with emoji fallbacks if these come later.

### Content (needed by Phase 8)
- [ ] **O8** 30 Daily pictures (Medium, 10×10).
- [ ] **O9** 20 pictures per Classic difficulty (7×7 / 10×10 / 14×14).
- [ ] **O10** 2 Tournament pictures (e.g. 20×20 for 4 tiles), themed (e.g. Halloween, Christmas).
- [ ] **O11** Import all content through **Admin → Quilt** and fix any pictures the validator rejects.

### Testing & launch
- [ ] **O12** Play-test on your phone(s) and desktop: drag feel, 14×14 readability, share text pasting into the FB group.
- [ ] **O13** Deploy: `firebase login:use lazyprogrammer88@gmail.com` then `firebase deploy --only hosting,firestore:rules,firestore:indexes --project playdailymindchallenge`.
- [ ] **O14** Create the first Tournament in Admin and activate it.
- [ ] **O15** Request indexing for `https://dailymindchallenge.com/quilt` in Google Search Console and Bing Webmaster Tools.
- [ ] **O16** Launch post in the Facebook group / campaign update (Meta Pixel events will already include Quilt).

---

## 5. Timeline and dependencies

```
Phase 1 core ──► Phase 2 engine ──► Phase 3 Daily ──► Phase 4 Classic ──► Phase 5 Tournament
                                        │                                       │
   O1 decisions, O3 test pictures ──────┘                    Phase 6 Admin ◄────┘
   O4–O6 artwork ─────────────────────────────────────────► Phase 7 SEO/docs
   O8–O11 content (needs Phase 6 importer) ───────────────► Phase 8 test ──► O13–O16 launch
```

Rough total for Claude's backlog: **~15–18 working days** of implementation. Owner work runs in
parallel; the critical path for launch is usually **content (O8–O11)**, so starting pictures
early matters more than anything else on your list.

**Out of scope for v1** (candidates for later): image share card / clipboard image copy,
"My Gallery" on the profile page, Challenge a Friend for Quilt, Speed Split mode, Odd/Even and
Sum-rectangle rule variants.
