# src/js/pages

Page-glue scripts for pages that don't have a dedicated feature folder of their own (compare `src/js/games/*`, `src/js/leaderboard/`, `src/js/admin/`, which keep their page script colocated with their feature's other files instead of living here).

## Files

- **`home.js`** — the busiest file in the app. Loaded by `src/html/index.html`, which doubles as both the landing page (dashboard: status card, game tiles, leaderboard preview — all rendered from public data even for logged-out visitors) **and** the sign-in surface (there is no separate login page). If there's no session, it renders a generic dashboard and wires up the header's Login button to open the inline Guest/Log In/Sign Up modal; clicking a game tile while logged out opens that same modal directly (storing the tile's target so it redirects there after a successful sign-in) instead of navigating away first.
- **`profile.js`** — own-account stats (lifetime points = `loginPoints` + summed `gameScores`, day streak, games played) and recent game history. Guests can view but not rename themselves here (settings-style edits are registered-only).
- **`settings.js`** — registered-users-only (redirects/blocks guests entirely, matching the "guests have no settings page" rule). Display name, recovery email, and password change.

## Retired: the generic "Challenges" feature

`challenges.html`/`challenges.js`/`challenges-data.js` and the `challenges` Firestore collection have been removed — that feature only ever supported Wordle, and Wordle now has its own richer "Challenge a Friend" mode built directly into `wordle.html` (see `src/js/games/wordle/CLAUDE.md`). The nav/footer "Challenges" links and the home page's "Open challenges" preview section were removed along with it.
