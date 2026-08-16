# src/js/games/wordsearch

## Files

- **`wordsearch-engine.js`** — `playWordSearchRound({ container, words, seed, onComplete })`. Generates a 13×13 grid at runtime using a seeded PRNG (`mulberry32`, seeded from the date string via `stringToSeed`), placing words forward-only (right / down / diagonal-down-right / diagonal-down-left) with a random-attempts-then-exhaustive-fallback placement algorithm that guarantees every word is placed whenever geometrically possible. Selection is mouse/touch drag constrained to straight lines. Calls `onComplete()` once every word is found.
- **`wordsearch-page.js`** — page glue for `src/html/wordsearch.html`: `initShell()`, admin block, `checkPlayedToday(uid, 'wordsearch')` check, picks the day's theme from `wordsearch-words.js`, mounts the engine with a date-derived seed, awards a flat score on completion.
- **`wordsearch-words.js`** — 20 curated `{ theme, words }` entries (themes like Animals, Fruits, Space, etc.), cycled by date the same way as the other two games. Words within a theme are kept substring-free of each other so the engine's selection-matching logic can't ambiguously satisfy two words with one selection.

## Scoring

Flat 6 points on completion (kept on the same 0–6 scale as Wordle's remaining-guesses score).
