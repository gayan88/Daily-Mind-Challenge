# src/js/pages

Page-glue scripts for pages that don't have a dedicated feature folder of their own (compare `src/js/games/*`, `src/js/leaderboard/`, `src/js/admin/`, which keep their page script colocated with their feature's other files instead of living here).

## Files

- **`home.js`** — the busiest file in the app. Loaded by `src/html/index.html`, which doubles as both the landing page (dashboard: status card, game tiles, open-challenges preview, leaderboard preview — all rendered from public data even for logged-out visitors) **and** the sign-in surface (there is no separate login page). If there's no session, it renders a generic dashboard and wires up the header's Login button to open the inline Guest/Log In/Sign Up modal; clicking a game tile while logged out opens that same modal directly (storing the tile's target so it redirects there after a successful sign-in) instead of navigating away first.
- **`profile.js`** — own-account stats (lifetime points = `loginPoints` + summed `gameScores`, day streak, games played) and recent game history. Guests can view but not rename themselves here (settings-style edits are registered-only).
- **`settings.js`** — registered-users-only (redirects/blocks guests entirely, matching the "guests have no settings page" rule). Display name, recovery email, and password change.
- **`challenges.js`** — Browse/Create view by default, Solve view when the URL has `?id=<challengeId>` (reuses the Wordle engine from `src/js/games/wordle/wordle-engine.js` pointed at the challenge's word instead of the daily word). Only registered, non-banned users can create challenges; guests can still solve/browse.
- **`challenges-data.js`** — the Firestore layer challenges.js (and home.js's open-challenges preview) call into: `createChallenge()` (checks `config/challengeExpiration` and `config/maxChallengeCreationsPerDay`), `getChallenge()`, `listOpenChallenges()`, `getChallengeCompletion()`/`recordChallengeCompletion()` (a `completions/{uid}` subcollection under each challenge doc).

## Note on "challenges" having no dedicated top-level folder

Unlike leaderboard/admin/games, challenges don't get their own `src/js/challenges/` folder — the data module (`challenges-data.js`) is kept colocated here since it's tightly coupled to `challenges.js` and also used by `home.js`'s preview, and there wasn't enough surface area to justify a separate folder.
