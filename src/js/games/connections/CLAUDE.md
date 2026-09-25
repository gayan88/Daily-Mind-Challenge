# src/js/games/connections

`connections.html` (served at `/connections`) has three modes selected by a tab row: **Daily Challenge**, **Classic**, **Tournament**. NYT-style puzzle: 16 words, 4 hidden groups of 4 ordered easiest→hardest (yellow/green/blue/purple), 4 mistakes allowed. Deep links: `?tab=classic`, `?tab=tournaments`.

**Status: live in code** -- registered in `GAMES`, home tile, leaderboard tab, profile labels, `checkPlayedTodayAll()`, activity-summary rows, sitemap, achievement badge art (`connections-*.png`, wired via `CUSTOM_IMAGES`), admin section. Adding it to `checkPlayedTodayAll()` means Perfect Day / "Daily Mind Champion" now need all four Dailies (achievement/mission copy was reworded from "all 3" accordingly; `.game-grid`'s odd-tile-spans-full rule in components.css handles 3 or 4 tiles).

## Files

- **`connections-engine.js`** — mode-agnostic round: `playConnectionsRound({ container, groups, maxMistakes, timeLimitSeconds, roundLabel, revealAnswersOnLoss, onComplete })`. `onComplete({ won, mistakes, guessHistory, solvedOrder, timeTakenSeconds, timedOut })` fires once. `guessHistory` = per-guess true group index of each word (drives the emoji share grid). Stopwatch starts on first tile tap; `timeLimitSeconds` (Tournament) is a countdown starting at mount. Grid is reshuffled on every mount. Wrong guess repeated verbatim → "Already guessed", no penalty; 3-of-4 → "One away!".
- **`connections-page.js`** — page glue (`trySession()`, single `activeRound` destroyed on tab switch, same pattern as wordle-page.js). Daily uses Wordle's hourly-retry model: loss = no reveal, no score, 1-hour cooldown countdown.
- **`connections-scoring.js`** — shared points helpers + the +20/+10 share transactions (`markSharedToFacebook`/`markSharedWithFriends(uid, gameType, gameDate)`), used by all three modes.
- **`connections-daily-data.js`** — `connectionsDailyPuzzles/{YYYY-MM-DD}` + `_meta`, `connectionsDailyAttempts/{uid}_{date}`, `gameScores` type `connections`.
- **`connections-classic-data.js`** — `connectionsClassicPuzzles/{n}` (`difficulty`, `groups`), random pick excluding the last played; wins only, unique `gameDate` token per round, type `connections-classic`.
- **`connections-tournament-data.js`** — `connectionsTournaments`, `connectionsTournamentAttempts/{tid}_{uid}` (fail resets to puzzle 1), one-shot `finalizeTournament()`, type `connections-tournament`.
- **`connections-summary-modal.js`** — post-round popup (own copy per convention).

## Points

- Daily: `10 + mistakesBonus[10,8,6,5 for 0-3 mistakes] + timeBonus[≤180s:10, ≤300:8, ≤600:6, else 5]`, win only (max 30).
- Classic: `{easy:10, medium:15, hard:25} + same bonuses`, win only (max 45).
- Tournament: `30 + 15 × puzzles + bonusPoints` on full completion.
- Every score write needs both `gameDate` and `scoreDate`.

## Testing locally

`localhost`/`127.0.0.1` auto-connects to the Firebase emulators (see `api/firebase-init.js`). Needs a JDK for the Firestore emulator (`brew install openjdk`, then `PATH="/opt/homebrew/opt/openjdk/bin:$PATH" firebase emulators:start --project playdailymindchallenge`), site at http://127.0.0.1:5002/connections. Seed puzzles through Admin → Connections using `docs/connections-content/*.txt`.

## Content

`docs/connections-content/` has a reviewed starter set (32 Daily, 24 Classic across all tiers, 1 five-puzzle Tournament). Puzzles are meant to be edited by a human before launch -- especially the hard tier's wordplay groups.

## Known gap: social-share image

`fb-share-connections.png` (the `og:image`/`twitter:image` in `connections.html`) is currently just a wide crop of the same artwork already used for the home-tile (`tile-connections-wide.png`) and the How to Play banner (`tile-connections.png`) -- not a dedicated image designed for a small social-feed thumbnail. See `docs/adding-a-new-game.md`'s "7b. SEO / AdSense" for the split: needs a separate source image (project owner to supply) before this can be fixed properly.
