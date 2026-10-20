# User Guide / Technical Handover Document
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | New as of 2026-10-17; Quilt and Pounce added 2026-10-20. Written as the single entry point for someone taking over this project — a new developer, a new admin, or an AI assistant — with no prior context. |
| **Related docs** | Every other document in `docs/` is referenced below at the point it becomes relevant; this document doesn't repeat their content, it tells you when to go read them. |

---

## Part A: Player-Facing User Guide

### What the site is
A free, browser-based puzzle site at `dailymindchallenge.com` with six games — Wordle, Sudoku,
Word Search, Connections, Quilt, and Pounce — each with a Daily Challenge, a Classic/replay mode, and a
Tournament mode. No download, no app install, and playable immediately as a guest.

### Getting started
1. Visit `dailymindchallenge.com`.
2. Choose **Continue as Guest** (just a display name) or **Sign Up** (username, display name,
   password, optional recovery email) from the home page.
3. Pick a game tile and start playing.

### Playing a Daily Challenge
Every game offers one Daily Challenge per calendar day, identical for every player. Wordle and
Connections allow unlimited retries after a loss (a 1-hour cooldown between attempts, no spoiler
shown); Sudoku, Word Search, Quilt and Pounce allow exactly one scored attempt per day. Once solved (Wordle/
Connections) or attempted (Sudoku/Word Search/Quilt/Pounce), that day's challenge is done until the next one
unlocks.

### Classic and Tournament modes
- **Classic** (Sudoku, Word Search, Connections, Quilt, Pounce): pick Easy/Medium/Hard and play as many puzzles
  as you like, any time.
- **Tournament** (all six games): a timed run through several puzzles set up by the site admin.
  In Wordle and Connections, failing any puzzle resets you to puzzle 1. In Sudoku, Word Search and
  Quilt, a failed puzzle banks a smaller reward and the run continues.

### Quilt in one paragraph
Drag rectangles over a grid of numbers so each rectangle holds exactly one number equal to its
area and the whole grid is covered (tap a rectangle to remove it; Undo is available). A rectangle
that breaks a rule turns red straight away. When the board is complete, the pieces take their real
colours and reveal a pixel-art picture. Solving without any undo or removed piece earns a Perfect
Stitch bonus. Hard puzzles add knots (cells you can't cover) and framed numbers (box = must be a
square, pill = must be one row or column). Quilt's Tournament, Patchwork Run, is one big picture
cut into timed tiles that join up as you go.

### Pounce in one paragraph
Place cats on a grid of coloured regions so every row, every column and every region has exactly
one cat, and no two cats touch, even diagonally. Tap once for ✕, again for a cat (or long-press);
drag to cross out many cells. A right cat stays; a wrong one hisses off (a "hiss" costs a few
points). Whisker Tips explain the next step in plain words. Medium boards add sleeping dogs (no cat
there); Hard adds pawprint numbers (how many cats touch that cell). Solving with no hisses and no
tips is Purrfect. Every Daily solved adopts a cat for your **Cat Café** (on your profile).
The Tournament, **Nine Lives Run**, is five timed boards
with nine lives for the whole run.

### Earning Points, XP, and Rank
- **Points** are earned per game by playing, and drive your position on the per-game and overall
  leaderboard.
- **XP** (registered accounts only) is a separate, site-wide total, earned from logging in,
  completing Daily Challenges, sharing results, and unlocking achievements.
- **Rank** (registered accounts only) is a 10-tier prestige title (Novice through Legend), each
  with 10 sub-ranks, based on your total XP. See your Profile page for your exact standing.
- **Guests** earn Points and appear on the leaderboard, but don't earn XP, Rank, Streaks, or
  Achievements — creating a free account unlocks those.

### Achievements, Streaks, and Championships
Registered accounts can earn badges for reaching Level milestones in any game, maintaining a
daily-play streak, and topping the Daily/Weekly/Monthly leaderboard for any game. See your Profile
page's Achievements section for the full list and your progress toward each unearned one.

### Account management
Settings (registered accounts only) lets you change your display name, password, and recovery
email. Guests cannot rename themselves or recover a lost guest session — this is stated clearly in
the logout confirmation for guest accounts.

### Getting help
`support@dailymindchallenge.com`, or the site's Facebook Page/Group (linked from the footer and
the About page). See the Privacy Policy, Terms of Service, and Cookie Consent Notice (footer
links) for the legal details of what data is collected and how.

---

## Part B: Technical Handover

### If you're picking this project up for the first time, read in this order:
1. This document (orientation).
2. `docs/solution-architecture-document.md` (how the system is built, and why).
3. `docs/functional-requirements-specification.md` (what the system does, precisely).
4. `docs/database-design-document.md` + `docs/api-documentation.md` (the data model and access
   rules — remember, there's no custom backend; Firestore rules *are* the API).
5. The `CLAUDE.md` file in whichever source directory you're about to touch — these are the
   line-level reference, kept close to the code they describe rather than in `docs/`.

### Getting a local dev environment running
See the root `README.md`'s "Running locally" section for the full one-time Firebase project setup.
Short version:
```bash
# From src/, for static files + partials (no Firestore):
python3 -m http.server 8000

# From the project root, for real clean URLs + Firestore/Auth emulators:
firebase emulators:start --only hosting,firestore,auth
```
`src/js/api/firebase-init.js` auto-detects `localhost`/`127.0.0.1` and points at the emulators
instead of production — no config flag to flip.

### Deploying
```bash
firebase deploy --only hosting,firestore:rules --project playdailymindchallenge
```
See `docs/deployment-and-release-document.md` for the full process, the account gotcha
(`lazyprogrammer88@gmail.com`, not whatever account you're logged into Firebase with by default),
and rollback procedures.

### Dependencies
There are no installed dependencies in the traditional sense — no `package.json`, no
`node_modules`. Every runtime dependency is a CDN-loaded script:
- Firebase JS SDK v10.7.1, loaded per-module from `gstatic.com` (see `src/js/api/CLAUDE.md`).
- The Meta Pixel bootstrap, loaded from `connect.facebook.net` only after cookie consent.
- The only *tooling* dependency (not a runtime one) is the `firebase-tools` CLI
  (`npm install -g firebase-tools`) and, for the Firestore emulator specifically, a JDK.

### Known Limitations (consolidated)
These are referenced in more depth throughout the other docs; collected here for a single
"what am I getting into" view:
- No automated tests (`docs/test-plan-and-test-cases.md`).
- No Cloud Functions / no server-authoritative scoring (`docs/solution-architecture-document.md`
  §6, Security Model).
- No centralized logging, alerting, or error tracking (`docs/operations-support-runbook.md` §2–3).
- No Firestore backup/export configured (`docs/operations-support-runbook.md` §6) — the single
  highest-priority operational gap to close.
- No staging environment — production is the only real Firebase project
  (`docs/deployment-and-release-document.md`, Environment Configuration).
- Two hand-maintained allow-lists in `firestore.rules` (achievement IDs, Championship game IDs)
  that must be kept in sync with the JS source of truth by hand when a game or achievement is
  added (`docs/technical-design-document.md` §8).
- No formal release-approval or incident-response process — appropriate at today's single-operator
  scale, worth revisiting if the team grows (`docs/deployment-and-release-document.md`'s Release
  Approvals; `docs/operations-support-runbook.md` §7).

### Maintenance Guidance

**Adding a sixth game:** follow `docs/adding-a-new-game.md` exactly — it's a checklist built from
the real experience of adding the fourth, fifth and sixth games (Connections, Quilt, then Pounce), including the specific things that
were missed the first time (achievement/mission copy that assumed exactly three games, the
`firestore.rules` allow-lists, the admin table's year/month grouping). Reusing it is significantly
faster than re-deriving the pattern from the existing six games' code. Quilt's own build is
documented phase by phase in `docs/quilt-development-plan.md` and `docs/quilt-release-notes.md`; Pounce's
sprint by sprint in `docs/pounce-backlog.md` and `docs/pounce-release-notes.md`.

**Generating puzzle content with an AI:** `docs/content-creation-guide.md` has the exact file
format and validation rules per game/mode, written specifically so a prompt like "generate 100
Wordle Daily Challenge words" produces something the admin import will actually accept. Quilt takes
pictures (PNG at 1 pixel per cell, or text), not puzzles — Admin → Quilt turns each into a puzzle and
proves it has one solution.
Pounce needs no content at all: Admin → Pounce generates every board itself.

**Retuning the progression economy** (XP amounts, the Rank curve, Point formulas): see
`docs/technical-design-document.md` §3 for how the Rank curve is structured, and
`src/js/progression/xp-service.js#XP_AMOUNTS` for the XP constants. Changes here affect every
registered player's displayed standing immediately on next load — there's no migration, since both
Level and Rank are always derived from stored XP/Points at display time, never stored themselves.

**Touching the cookie banner or Meta Pixel:** read `docs/technical-design-document.md` §4 first —
both have had real bugs (a double-render, a slow-database hang) with non-obvious causes, and the
fixes are specifically designed to be easy to accidentally regress if the idempotency guard or the
timeout race is refactored away without understanding why they're there.

### Support Contacts
- **Product/business ownership:** the project owner (see `docs/business-requirements-document.md`
  §4 — not individually named in this document set; reachable via
  `support@dailymindchallenge.com`).
- **Firebase project access:** the `lazyprogrammer88@gmail.com` Google account owns the
  `playdailymindchallenge` Firebase project — see the "Account gotcha" note in
  `docs/deployment-and-release-document.md`.
- **Domain/DNS:** wherever `dailymindchallenge.com` is registered — not documented in this
  repository; obtain from the project owner if DNS changes are ever needed.
