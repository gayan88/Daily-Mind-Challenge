# src/js/games/sudoku

## Files

- **`sudoku-engine.js`** — `playSudokuRound({ container, puzzle, solution, onComplete })`. Tap-a-cell-then-tap-a-number entry (mobile-friendly, avoids raw `<input>` zoom/keyboard issues). Correctness is checked by direct string comparison against the known `solution` — there's no general constraint-solving/validation engine, which is a deliberate v1 simplification. Calls `onComplete({ won: true })` once every cell matches.
- **`sudoku-page.js`** — page glue for `src/html/sudoku.html`: `initShell()`, admin block, `checkPlayedToday(uid, 'sudoku')` already-played check, picks the day's puzzle from `sudoku-puzzles.js`, mounts the engine, awards a flat score on completion via `recordGameScore()`.
- **`sudoku-puzzles.js`** — static bank of 30 `{ puzzle, solution }` pairs (81-character strings, row-major, `'0'` = blank). These were generated programmatically (randomized digit relabeling + band/stack shuffles of a base Latin-square pattern, all validated) rather than hand-authored. `getDailySudokuPuzzle(dateString)` picks by date the same way Wordle does.

## Scoring

Flat 6 points on completion (kept on the same 0–6 scale as Wordle's remaining-guesses score).
