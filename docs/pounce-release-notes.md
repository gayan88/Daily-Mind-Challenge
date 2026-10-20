# Pounce — Release Notes & Deploy Steps

> Release: Pounce, the sixth game (commits `deaffe8` → sprint 6, plus this doc). Built and
> release-tested locally on 2026-10-20. **Not deployed yet.** Plan, brand and decisions:
> `docs/pounce-development-plan.md`; tickets and per-sprint notes: `docs/pounce-backlog.md`.

## What's in this release

**New game — Pounce** (`/pounce`): a Star Battle-style cat logic puzzle. Players give every row,
column and colour region exactly one cat, with no two cats touching (not even diagonally). A right
cat pounces into its spot and stays; a wrong one hisses, hops off and leaves a ✕.

- **Daily Challenge** — one shared Medium 8×8 board per day (sleeping dogs block some cells).
  10 + speed bonus (≤2 min 10 / ≤4 min 8 / ≤8 min 6 / else 5) − 2 per hiss − 3 per Whisker Tip
  (never below 5) + 5 Purrfect (max 25). Every Daily solved **adopts a cat** for the player's **Cat
  Café** (same cat for everyone that day). Share text never shows the board.
- **Classic** — Easy 6×6 / Medium 8×8 + dogs / Hard 9×9 + dogs + pawprint clues; unlimited replays,
  unsolved boards first. The Daily formula × 0.8 / 1.0 / 1.3 (max 20 / 25 / 33).
- **Zen** — the Classic boards with no clock, no score and free tips; nothing is recorded.
- **Nine Lives Run** (Tournament) — five timed boards (5×5 → 9×9), one shared set of lives (default
  9, 240 s per board). A wrong cat costs a life (saved at once, so leaving can't refund it); a
  timed-out board costs a life and banks 10 (30 if solved); 0 lives ends the run with banked points.
  Finishing adds the run's completion bonus + 5 per life left.
- **Whisker Tips** — explain the next logical step in a sentence and highlight its cells; they
  never just reveal a cat.
- **Cat Café** on the profile — the cats adopted, newest first (guests too).
- Home tile (the six tiles now fill three even rows), leaderboard option, profile activity labels,
  18 achievement badges with art, streak/XP via the Daily, Meta Pixel `GameCompleted`, 2 ad
  slots, sitemap entry, a How to Play card with a sample board, Tips & Strategy and a 20-question FAQ.

**Admin → Pounce** — no content to write: **Generate** makes Daily / Classic boards in the browser
(365 Dailies in ~1 s), each proven to have exactly one solution and solvable by logic, previews the
grade spread and sample boards, then **Add** saves them all-or-nothing. Regenerate / Delete per
board, JSON import/export for hand-made boards, and Nine Lives Runs built one at a time or in bulk.
The Run settings (seconds per board, lives) are in the same section. Guide:
`docs/content-creation-guide.md` → Pounce.

**Other changes**

- Page descriptions, About, Terms, privacy policy, the footer share text and the README list all
  six games; the project docs (BRD, FRS §3.5b, architecture, design, database, API, data flow,
  deploy, runbook, test plan TC-25–TC-30, user guide, campaign brief) cover Pounce.
- New brand tokens `--color-pounce-*` in `base.css`.
- `tools/process-badges.py` — the badge background-removal + 240 px tool, now in the repo.

**Heads-up for players** — the "every game" / "every Daily" achievements (All-Rounder, Puzzle
Enthusiast, Mind Master, Daily Mind Champion, Perfect Day, Triple Threat) now include Pounce, so
they're harder for anyone who hasn't earned them yet (already-earned badges are kept). Their
descriptions update themselves ("all 6 games"). Worth a line in the launch post.

## Release testing (2026-10-20, Firebase emulators, headless Chrome)

All scripts are in `tools/` this time (setup notes in each file's header).

| Suite | Script | Result |
|---|---|---|
| Puzzle core: solver vs brute force (300 boards incl. dogs + pawprints), 1000 boards per difficulty (unique, logic-solvable, every hint step checked against the answer, no giveaway regions, seed-stable), 10 Runs | `pounce-soak-test.mjs 1000` | all pass; ≤ 20 ms per board |
| Board engine: tap / long-press / drag ✕ / undo, hiss, tips, keyboard-only Purrfect, Run lives + out of lives, Zen, 360 px phone (no sideways scroll, 36 px cells on 9×9) | `pounce-browser-test.mjs` | 24/24 |
| Daily: signed-out page, guest sign-in, solve with 1 hiss + 1 tip (15), score doc, +20 share via the rules (35), already-played, tabs, leaderboard, profile + Cat Café, home tile | `pounce-e2e-test.mjs` | 25/25 (see note) |
| Classic (Purrfect Easy 20, next unplayed), Zen (nothing written), Run A (life saved at once, 20 s timeout, out of lives = 50, bonus 0), Run B (all 5 = 265) | `pounce-e2e-modes-test.mjs` | 28/28 |
| Admin on a fresh database: sign-up → admin, Generate 365 + 5 Dailies (dates), Regenerate, Classic add/delete, JSON import (bad board, duplicates), run create + bulk + activate, settings | `pounce-e2e-admin-test.mjs` | 23/23 |
| Regression smoke: home (6 tiles), every mode tab of all 6 games, leaderboard, profile — no errors | `site-smoke-test.mjs` | 9/9 |

Note: the home-tile "played today" check in the Daily suite passed on the final run but is
intermittent on the emulators (a session restored after visiting the home page sometimes comes back
signed out). Quilt behaves identically, so it's an emulator quirk, not a Pounce bug.

Found and fixed during development: a pawprint in the bottom row wasn't counted exactly (solver),
regions with one usable cell gave their cat away, Run hisses didn't cost Purrfect, a lilac/lavender
colour clash, squashed admin thumbnails, Classic admin groups starting collapsed.

Not tested: real phones (only Chrome's phone emulation), Safari/Firefox, production Firestore. No
new composite index is needed: Pounce's queries are single-field or two equality filters.

Known, site-wide (not Pounce-specific): the cookie banner covers the bottom of a phone screen —
including a game board's lower rows — until the visitor answers it.

## Deploy

**Order matters.** As soon as Pounce is in `GAMES`, Perfect Day and the other "every Daily"
achievements need a Pounce Daily, and content can only be generated through the deployed admin page.
So: deploy → add content straight away → then announce.

1. Make sure you're on the right Google account and project:

   ```bash
   firebase login:use lazyprogrammer88@gmail.com
   ```

2. Deploy hosting and rules **together** (the Pounce pages need the new rules):

   ```bash
   firebase deploy --only hosting,firestore:rules --project playdailymindchallenge
   ```

   No `firestore:indexes` change in this release.

3. **Straight after deploying, open Admin → Pounce** (until then `/pounce` says "Today's Pounce
   isn't ready yet"):
   - **Daily Boards:** start date = today (or tomorrow; before it, players get #1 as a preview),
     365 → Generate → Add.
   - **Classic Boards:** Easy, Medium and Hard, ~100 each → Generate → Add.
   - **Nine Lives Runs:** "Create many runs", e.g. 10, Inactive → then Activate one or two.
   - Opening Admin once also creates `config/pounceTournamentSettings` (240 s, 9 lives).

## After deploying

- [ ] Play today's Daily on your phone and desktop: tap feel, 9×9 readability (try a Hard
      Classic), hint wording, the summary and share text, home ✓, the Cat Café on your profile (O-09).
- [ ] Play part of a Nine Lives Run.
- [ ] Request indexing for `https://dailymindchallenge.com/pounce` in Google Search Console and
      Bing Webmaster Tools, plus Bing for `/quilt` (O-11).
- [ ] One Facebook-group launch post for Quilt + Pounce, mentioning the harder all-games
      achievements (O-12).

## Still open (owner backlog)

- Trademark check for "Pounce" (O-02).
- Artwork: the 1.91:1 share image (O-05; `fb-share-pounce.png` is the logo on white for now) and a
  How to Play banner (O-06; the page uses the tile) — both also wanted for Quilt.

## Rollback

Hosting: Firebase console → Hosting → release history → roll back to the previous release.
Rules: redeploy the previous rules — `git show 2512b1a^:firebase/firestore.rules > /tmp/rules.prev`,
copy it over `firebase/firestore.rules` and `firebase deploy --only firestore:rules` (`2512b1a^` is
the last commit before Pounce touched the rules). Pounce content, scores and run progress stay in
Firestore and reappear if Pounce is redeployed.
