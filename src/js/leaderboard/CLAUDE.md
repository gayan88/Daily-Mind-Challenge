# src/js/leaderboard

## Files

- **`leaderboard-data.js`** — `getOverallLeaderboard(period, limitCount)` (sums a period's `gameScores` per user across all three games) and `getGameLeaderboard(gameType, period, limitCount)` (single-game ranking for that period). `period` is one of `'today' | 'week' | 'month' | 'year' | 'all'` — `'today'` and `'all'` are exact-date-equality and no-filter respectively, `'week'/'month'/'year'` are **rolling** windows (last 7/30/365 days including today, via `getDateDaysAgo()` in `src/js/utils/helpers.js`), not calendar-aligned periods — simpler and avoids timezone/calendar-boundary edge cases. Both functions filter out banned users via a `getBannedUids()` query that's cached in-memory for the page's lifetime (so switching tabs on the leaderboard page doesn't re-fetch the banned list every time). `findUserInLeaderboard(rows, uid)` is a plain array helper, no Firestore call.
- **`leaderboard-page.js`** — page glue for `src/html/leaderboard.html`: two independent tab rows (game type: Overall/Wordle/Sudoku/Word Search; period: Today/Week/Month/Year/All-time), tracked as two pieces of state that both feed the same render call. The period tab is labeled "All-time" in the UI rather than "Overall" specifically to avoid confusion with the game-type tab of the same name — they mean different things (all games vs. all time).

## Firestore indexes

Every period/game combination is covered by indexes that already exist — no new composite index was needed when periods were added. Equality-only queries (`gameDate == today`, `gameType == X`) use Firestore's automatic single-field indexes; range queries (`gameDate >= startDate`) also use the automatic single-field index; and the equality+range combination (`gameType == X AND gameDate >= startDate`) is covered by the existing `(gameType ASC, gameDate ASC)` composite index in `firebase/firestore.indexes.json`, since Firestore composite indexes support an equality prefix plus one trailing range field.

## Why the daily login bonus isn't included

Per the intended points-system design, the daily login bonus is deliberately **excluded** from these leaderboard totals — the leaderboard is meant to rank game-playing skill/effort, not who happened to log in. (The player's own "today's points" stat on the home page's status card *does* include the login bonus, computed separately in `src/js/pages/home.js` — that's a different, personal-facing number from the competitive leaderboard.)

## Known limitation

The "All-time" period sums every `gameScores` document ever written per user with no `limit` on the read — fine at current scale, but unbounded as the collection grows. A pre-computed/cached leaderboard collection (updated by a scheduled Cloud Function) would be the way to make this scale further; out of scope for now, consistent with this project having no Cloud Functions at all.
