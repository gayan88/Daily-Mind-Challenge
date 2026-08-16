# src/js/games/wordle

## Files

- **`wordle-engine.js`** — the playable game itself: `playWordleRound({ container, targetWord, maxGuesses, onComplete })` builds the board + on-screen/physical keyboard into `container`, handles guess evaluation (two-pass duplicate-letter-safe algorithm), and calls `onComplete({ won, attempts })` once. No Firebase/session knowledge at all — this file is reused as-is by `challenges.js` for challenge-mode solving (a different target word, same engine).
- **`wordle-page.js`** — the page glue loaded by `src/html/wordle.html`: calls `initShell()`, blocks admins from playing, checks `checkPlayedToday(uid, 'wordle')` and shows an "already played" state if so, otherwise picks the day's word from `words-wordle.js` and mounts `wordle-engine.js`. On completion, converts `attempts` into a score (remaining guesses, 0–6 scale) and calls `recordGameScore()`.
- **`words-wordle.js`** — curated answer list (`WORDLE_ANSWERS`, also reused by `challenges.js` for the "pick a word" dropdown) and `getDailyWordleWord(dateString)`, which picks deterministically by date (`daysSinceEpoch % answers.length`) so every player sees the same word each day. **Only append to the end of this list** — reordering shifts which word lands on which date for players mid-streak.

## Scoring

Score = remaining guesses if solved (6 = solved in 1 try, 1 = solved in 6 tries), 0 if not solved. This is intentionally on the same 0–6 scale as Sudoku/Word Search's flat 6-on-completion score.
