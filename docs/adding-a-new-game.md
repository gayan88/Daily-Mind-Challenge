# Adding a New Game

A checklist of everything that needs to be built or updated to add a fourth game, based on how
Wordle, Sudoku, and Word Search are each actually wired into the app.

**The main thing to know upfront: there is no central "list of games" registry in this codebase.**
Each of the touchpoints below hardcodes the three existing games independently, in its own file.
Adding a game means updating each of these separately, not registering it once somewhere.

## 1. Core gameplay

- A new engine (`src/js/games/<game>/<game>-engine.js`) — the actual playable mechanic,
  mode-agnostic, with its own live stats bar and a single `onComplete()` callback.
- Per-mode data files (Daily / Classic / Tournament, as applicable) — Firestore reads/writes,
  points formulas, share bonuses.
- A summary modal — each existing game keeps its own copy of this popup rather than sharing one,
  by established convention; a new game should follow the same pattern.

## 2. Page & routing

- `src/html/<game>.html` — mode tabs, ad slots, the "How to Play" static section, meta tags
  (`name="description"`, canonical, `og:*`/`twitter:*`).
- `src/js/games/<game>/<game>-page.js` — session handling via `trySession()` (not `initShell()`,
  so the page stays crawlable when signed out — see `src/js/CLAUDE.md`), mode-tab wiring with a
  single `activeRound` handle that gets `.destroy()`'d on every tab switch.
- A new entry in `firebase.json`'s `hosting.rewrites` (`/<game>` → its `.html` file).
- A page-specific CSS file (`src/css/pages/<game>.css`).

## 3. Firestore schema & security rules

- New collections for Daily/Classic/Tournament content plus Tournament attempt-progress docs.
- `firebase/firestore.rules` needs:
  - Read/write rules for each new collection (public read, admin-only write for content;
    bounded create/update rules for Tournament attempts, mirroring the existing pattern).
  - The new gameTypes added to `maxCreateScore()`'s point caps.
  - The new gameTypes added to the share-bonus allow-lists (`isCommunityShareUpdate()` /
    `isFriendsShareUpdate()`).
- Every score write needs **both** `gameDate` (its doc-ID-key role) **and** `scoreDate` (always a
  real calendar date, regardless of mode) — this is the exact bug that had to be fixed twice this
  session (once for the leaderboard's date filtering, once for its per-game `gameType` filtering).
  A new game built without `scoreDate` from day one would hit the identical "invisible on the
  leaderboard" problem.

## 4. Progression + Leaderboard

- Add one entry to `GAMES` in `src/js/progression/game-registry.js` — `gameId`, display `label`,
  and the full list of `gameType`s the new game can score under. This single entry now feeds
  both the profile page's per-game Level/Points display (`progression-service.js`) **and**
  `leaderboard-data.js`'s `GAME_TYPES`, which derives from this registry instead of keeping its
  own copy. Forgetting this means the new game's Tournament/Classic scores silently don't count
  on its own leaderboard tab (only on "Overall", which has no `gameType` filter at all) **and**
  don't show up in its own Level/progress on the profile page.
- Add a new tab button in `src/html/leaderboard.html`.

## 4.5. Achievements

- **Per-game Level tiers** (Expert/Master/Grand Master) and **Championship tiers** (Daily/Weekly/
  Monthly win-count milestones) in `src/js/progression/achievement-registry.js` are already
  generic -- they're built by iterating `GAMES` (`Object.entries(GAMES).flatMap(...)`), so adding
  the new game to `game-registry.js` (step 4 above) is enough to generate all of its achievement
  *definitions* automatically, with generic ids/labels/descriptions derived from `game.label`. No
  hand-written achievement entries needed for these two categories.
- **But `firebase/firestore.rules`' `playerAchievements` `allow create` allow-list does NOT
  auto-generate** -- it's a hand-maintained array of every valid achievement id (rules can't
  import JS). Forgetting to add the new game's ~18 ids (3 Level tiers + 15 Championship tiers)
  there means every one of its achievements is silently rejected on create -- the player would see
  them stuck at "Not Started"/"In Progress" forever, never actually earnable. This is the single
  easiest achievement-related step to miss.
- **Custom badge art is optional** -- `CUSTOM_IMAGES` in `achievement-registry.js` is currently
  Wordle-only; a new game's achievements render fine with the generic per-category emoji fallback
  (`profile.js`'s `ACHIEVEMENT_CATEGORY_ICON`) until/unless illustrated art is added for it later.
- The "all 3 games at once" tiers (All-Rounder/Puzzle Enthusiast/Mind Master, `ALL_GAMES_TIERS`)
  and `puzzle-addict`/`mind-athlete` (total games played / total points) already read from
  `context.gameProgress`/`totalGamesPlayed`/`totalPoints`, which are assembled generically across
  every entry in `GAMES` -- nothing to add there either, a fourth game just makes them harder.

## 5. Home page

- A new game tile in `src/html/index.html`, plus a new logo/tile image asset
  (`src/assets/images/tile-<game>.png`).
- `checkPlayedTodayAll()` in `src/js/utils/points.js` is **hardcoded to check exactly
  `{wordle, sudoku, wordsearch}`** for the "completed today" tile badges — this needs the new game
  added, or its badge never lights up.

## 6. Admin panel

- A whole new collapsible section: Daily content (add/edit/import/export, grouped by year then
  month), Classic content if applicable (same, grouped by difficulty), Tournament management
  (create/list/activate/delete).
- A new `src/js/admin/<game>-admin.js` Firestore layer, mirroring the existing three.
- New ad slot IDs registered in `AD_SLOTS` (`src/js/utils/ads.js`).
- New rows in the Daily Activity Summary's `ACTIVITY_ROWS` map
  (`src/js/admin/activity-summary-data.js`) — with the same care already taken there: count only
  the one-shot Tournament *completion* doc, never the per-puzzle docs, or the count gets wildly
  inflated.
- If the game has a Tournament mode with global settings, a new `CONFIG_FORMS` entry plus a
  matching `CONFIG_DEFAULTS` entry (`src/js/utils/config.js`, `src/js/admin/admin-page.js`).

## 7. Profile page

- The `GAME_LABELS` map in `src/js/pages/profile.js` needs the new game's gameTypes added too, or
  its Recent Activity rows fall into the same "raw gameType string, missing date, literal
  'undefined'" display bug that was just fixed there for the existing three games.

## 8. Documentation

- A new `CLAUDE.md` for the game's own folder.
- Updates to every other `CLAUDE.md` that lists "the three games" by name: `src/js/CLAUDE.md`'s
  layout table, `src/html/CLAUDE.md`'s pages table, `src/js/admin/CLAUDE.md`,
  `src/js/leaderboard/CLAUDE.md`.

## Suggested build order

Following the same order the original Word Search revamp used:

1. Engine.
2. Daily mode end-to-end — including the leaderboard, profile, and home-page touchpoints, tested
   early specifically to catch the two known gotchas (`scoreDate`, `GAME_TYPES`) before they
   propagate into Classic/Tournament work.
3. Classic.
4. Tournament.
5. Admin panel, last.
