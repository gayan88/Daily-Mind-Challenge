# Quilt — Release Notes & Deploy Steps

> Release: Quilt, the fifth game (commits `1999e20` → `895e0c5`, plus this doc). Built and
> release-tested locally on 2026-10-18. **Not deployed yet** — the owner runs the deploy below.
> Plan, decisions and backlogs: `docs/quilt-development-plan.md`.

## What's in this release

**New game — Quilt** (`/quilt`): a Shikaku-style logic puzzle. Players drag rectangles so each
holds exactly one number equal to its area; when the board is solved, the pieces take their real
colours and reveal a pixel-art picture.

- **Daily Challenge** — one shared picture per day (10×10). 10 + speed bonus + 5 Perfect Stitch
  (max 25). Share text is stats-only, so it never spoils the picture.
- **Classic** — Easy 7×7 / Medium 10×10 / Hard 14×14 (Hard adds knots and shape clues), unlimited
  replays, unsolved pictures first. Max 20 / 25 / 33 points.
- **Patchwork Run** (Tournament) — one big picture cut into 4–9 timed tiles; 30 per solved tile,
  10 per timed-out tile, plus the run's completion bonus and +25 Perfect Patchwork.
- Home tile, leaderboard option, profile activity labels, achievements (Level + Championship
  tiers), streak/XP via the Daily, Meta Pixel `GameCompleted`, 2 ad slots, sitemap entry.

**Admin → Quilt** — add content as pictures (PNG at 1 pixel per cell, or text); Preview proves
every puzzle has exactly one solution before it can be saved. Patchwork Run builder and the
per-tile time setting (default 180 s) are in the same section. Formats and an AI prompt for making
pictures: `docs/content-creation-guide.md` → Quilt.

**Fixes to existing games**

- **"Share with Friends" (+10) now works for Sudoku and Word Search Daily + Classic.** Those score
  records never had a `sharedWithFriends` field, which the security rules treated as a denial, so
  players got "Couldn't save your share bonus". Fixed in the rules (applies to old records too).
- Page descriptions, About, Terms, privacy policy, the footer share text and the README now list
  all five games (several still listed only three).

**Heads-up for players** — "every game" / "every Daily" achievements (All-Rounder, Puzzle
Enthusiast, Mind Master, Daily Mind Champion, Perfect Day, Triple Threat) now include Quilt, so
they're harder for anyone who hasn't earned them yet. Already-earned badges are kept. Worth a line
in the launch post.

## Release testing (2026-10-18, Firebase emulators, headless Chrome)

| Suite | Result |
|---|---|
| Admin on a fresh database (sign-up → admin, Daily/Classic/PNG import, edit, duplicates, run builder, settings, ads) | 24/24 |
| Regression smoke: every public page anonymous; every mode tab of all 5 games as a guest; home tiles, leaderboard options, profile | all pass |
| Classic on a 375 px phone with touch (Hard 14×14, unsolved-first, shares) | 20/20 |
| Patchwork Run (pass, timeout, resume after reload, bonus doc, perfect run) | 16/16 |
| Daily (sign-in, solve, score doc, both share bonuses, rules caps, already-played, home/leaderboard/profile) | 21/21 |
| Board engine (drag, undo, clear, errors, touch, timeout, destroy) | 22/22 |
| Solver/generator incl. 60 random pictures 7×7–20×20 | all pass (worst 1.2 s at 20×20) |

The test scripts were run from a scratch folder and are **not** in the repo (the repo has no test
runner — see `test-plan-and-test-cases.md` §6). Ask if you want them added.

Not tested: real phones (only Chrome's phone emulation), Safari/Firefox, and production Firestore
(the emulator doesn't enforce indexes; Quilt's only new query uses two equality filters, which
production serves without a composite index).

## Deploy

1. Make sure you're on the right Google account and project:

   ```bash
   firebase login:use lazyprogrammer88@gmail.com
   ```

2. Deploy hosting and rules **together** (the Quilt pages need the new rules, and the share-bonus
   fix is in the rules):

   ```bash
   firebase deploy --only hosting,firestore:rules --project playdailymindchallenge
   ```

   No `firestore:indexes` change in this release.

3. **Straight after deploying, add content** in Admin → Quilt — until then the Quilt tile opens a
   page that says "Today's Quilt isn't ready yet":
   - Daily: at least a few pictures, start date = today (or tomorrow — before the start date,
     players get puzzle #1 as a preview).
   - Classic: a few pictures per difficulty (each empty difficulty says "not ready yet").
   - Patchwork Run: optional at launch; the tab says "No Patchwork Runs right now" until one exists.
   - Opening Admin once also creates `config/quiltTournamentSettings` with the 180 s default.

## After deploying

- [ ] Play today's Daily on your phone and desktop; check the summary, share text, home ✓.
- [ ] Check Sudoku "Share with Friends" now adds +10 (the fix).
- [ ] Request indexing for `https://dailymindchallenge.com/quilt` in Google Search Console and
      Bing Webmaster Tools (plan item O15).
- [ ] Launch post in the Facebook group, mentioning the harder all-games achievements.

## Still open (owner backlog)

- Artwork: How to Play banner (O5; currently uses the tile/logo), 1.91:1 share image (O6, the page uses a
  logo stand-in for now), 18 achievement badges (O7, emoji fallback until then).
- Content: 30 Daily, 20 per Classic difficulty, 2 Patchwork Runs (O8–O11).
- Trademark check for "Quilt" (O2).

## Rollback

Hosting: Firebase console → Hosting → release history → roll back to the previous release.
Rules: redeploy the previous rules — `git show 294a444:firebase/firestore.rules > /tmp/rules.prev`,
copy it over `firebase/firestore.rules` and `firebase deploy --only firestore:rules` (294a444 is
the last commit before the Quilt work). Rolling back the rules also undoes the share-bonus fix. Quilt
content and scores stay in Firestore and reappear if Quilt is redeployed.
