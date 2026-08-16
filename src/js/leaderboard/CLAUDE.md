# src/js/leaderboard

## Files

- **`leaderboard-data.js`** — `getTodayOverallLeaderboard(limitCount)` (sums today's `gameScores` per user across all three games) and `getTodayGameLeaderboard(gameType, limitCount)` (single-game daily ranking). Both filter out banned users via a `getBannedUids()` query that's cached in-memory for the page's lifetime (so switching tabs on the leaderboard page doesn't re-fetch the banned list every time). `findUserInLeaderboard(rows, uid)` is a plain array helper, no Firestore call.
- **`leaderboard-page.js`** — page glue for `src/html/leaderboard.html`: renders the Overall/Wordle/Sudoku/Word Search tabs, calling the matching `leaderboard-data.js` function per tab.

## Why leaderboards are "today only" and games-only

Per the intended points-system design, the daily login bonus is deliberately **excluded** from these leaderboard totals — the leaderboard is meant to rank game-playing skill/effort for the day, not who happened to log in. (The player's own "today's points" stat on the home page's status card *does* include the login bonus, computed separately in `src/js/pages/home.js` — that's a different, personal-facing number from the competitive leaderboard.) There's no "all-time" leaderboard tab currently — that would mean summing every `gameScores` document ever written per user, which is unbounded and not something to query client-side at growing scale; a pre-computed/cached leaderboard collection would be the way to add that later.
