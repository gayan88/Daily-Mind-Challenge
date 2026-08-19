# src/js/utils

Cross-cutting modules used by more than one feature area (games, pages, auth, admin). If a module is only ever used by one feature, it belongs with that feature instead of here.

## Files

- **`helpers.js`** — generic, no-Firebase-dependency helpers: `getTodayDateString()`, `daysSinceEpoch()`, `isConsecutiveDay()`, `getQueryParam()`, DOM helpers (`qs`/`qsa`), `escapeHtml()`, `formatLeaderboardName()`, `formatDuration()`, `showToast()`, and the seeded-random helpers (`mulberry32`, `stringToSeed`) used by Word Search's grid generator.
- **`icons.js`** — the single source of truth for every emoji used across the app, kept as explicit Unicode escapes (e.g. `CHECK: '✅'`) rather than pasted glyphs, specifically so a bad copy/paste or editor re-encoding can't silently turn them into mojibake. `applyIcons(root)` fills every `[data-icon="NAME"]` element under `root` via `textContent`.
- **`config.js`** — reads `config/{docId}` from Firestore with an in-memory per-page-load cache and a hardcoded fallback default (`CONFIG_DEFAULTS`) if the doc doesn't exist yet or is unreachable, so the app works correctly even before an admin has seeded the config documents. `ensureConfigDefaults()`/`updateConfig()` are the admin-only write side (used by `src/js/admin/admin-page.js`).
- **`profanity.js`** — `containsBlockedWord(text)`, a lowercase substring check against `config/profanityList.blockedWords` (via `config.js`). Used on guest display names, sign-up display names, and display-name changes.
- **`points.js`** — the `gameScores` write/read layer: `recordGameScore()` (deterministic doc ID `{uid}_{gameType}_{date}`, so a repeat attempt the same day is rejected server-side by Firestore rules rather than needing a separate "already played" field), `checkPlayedToday()` / `checkPlayedTodayAll()` (single-game vs. all-three-games-in-one-query, the latter used by the home page), `applyDailyLoginBonus()` (registered users only, reads the bonus amount from `config/dailyLoginReward`), `getUserLifetimeStats()` / `getUserGameHistory()` (used by `profile.js`).
- **`ads.js`** — `AD_SLOTS` (the canonical list of all 9 ad placements, id + label, used by the admin panel) and `applyAdSlots(root)`, which reads `config/ads` and shows/hides/rewrites every `[data-ad-slot]` element under `root` per the admin's settings. Called automatically on every page from `src/js/app.js#loadHeaderFooter()` — pages don't need to call it themselves, they just need an element with the right `data-ad-slot` attribute already in their HTML.

## Note

`config.js` is genuinely shared (points.js, `wordle-challenge-data.js`, profanity.js, admin-page.js, home.js, and `src/js/app.js` all depend on it) — resist the temptation to move it into `src/js/admin/` just because the admin page is where it gets *edited*.
