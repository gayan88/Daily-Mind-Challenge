# src/js

Plain ES modules, loaded via `<script type="module">` directly in each HTML page — no bundler, no npm, no build step. Every file that needs the Firebase SDK imports it directly from the `gstatic.com` CDN (see `api/CLAUDE.md`); there's no local `node_modules`.

## Layout

| Folder | Purpose |
|---|---|
| `api/` | Firebase SDK initialization only |
| `auth/` | Session/login logic + guest & registered profile documents |
| `games/wordle/`, `games/sudoku/`, `games/wordsearch/` | Each game's engine, page glue, and daily-content data, colocated |
| `leaderboard/` | Daily leaderboard queries + the leaderboard page |
| `admin/` | Moderation actions + the admin page |
| `pages/` | Page glue for home, profile, settings, challenges (features without a dedicated folder) |
| `utils/` | Cross-cutting helpers used by more than one feature area |
| `app.js` | Top-level app shell (see below) |

## `app.js`

The one file every page loads first (via `initShell()` for protected pages, or `trySession()`/`loadHeaderFooter()` directly for the home page, which is allowed to render without a session). Responsibilities:

1. Injects the shared header/footer partials (`src/partials/*.html`) via `fetch()`.
2. Resolves the current session (`getSessionUser()` from `auth/auth.js` — **never** auto-creates a guest).
3. For protected pages (`initShell()`): redirects to the home page (with a `?redirect=` param) if there's no valid session.
4. Loads the session's profile, applies the daily login bonus if not already claimed today, and wires the header (display name, `[Guest]` badge, Admin nav link, Logout button).

## No client-side router

Every page is a real, separate `.html` file under `src/html/`, navigated between with plain `<a href>` links — there is no `router.js` and no single-page-app shell. If that ever changes, it would be a significant enough shift to warrant its own planning pass rather than being bolted on here.
