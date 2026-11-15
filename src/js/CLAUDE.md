# src/js

Plain ES modules, loaded via `<script type="module">` directly in each HTML page — no bundler, no npm, no build step. Every file that needs the Firebase SDK imports it directly from the `gstatic.com` CDN (see `api/CLAUDE.md`); there's no local `node_modules`.

## Layout

| Folder | Purpose |
|---|---|
| `api/` | Firebase SDK initialization only |
| `auth/` | Session/login logic + guest & registered profile documents |
| `games/wordle/`, `games/sudoku/`, `games/wordsearch/`, `games/connections/`, `games/quilt/`, `games/pounce/` | Each game's engine, page glue, and daily-content data, colocated |
| `leaderboard/` | Daily leaderboard queries + the leaderboard page |
| `progression/` | Game-agnostic Points → Level engine (game registry + derived progress calculations) |
| `admin/` | Moderation actions + the admin page |
| `pages/` | Page glue for home, profile, settings (features without a dedicated folder) |
| `utils/` | Cross-cutting helpers used by more than one feature area |
| `app.js` | Top-level app shell (see below) |

## `app.js`

The one file every page loads first. Two entry points, both doing the same header/footer/session-loading work, differing only in what happens when there's no session:

- **`initShell()`** — for pages with no useful unauthenticated state (`profile.html`, `settings.html`, `admin.html`): redirects to the home page (with a `?redirect=` param) if there's no valid session.
- **`trySession()`** — for pages that should still render real content to an anonymous visitor: resolves a session if one exists, but returns `null` instead of redirecting if there isn't one, leaving it to the page to decide what to show. Used by the home page (`index.html`), the public Leaderboard (`leaderboard.html`, renders the real rankings for anonymous visitors), and, since it matters for AdSense/SEO crawlability, all four game pages (`wordle.html`/`sudoku.html`/`wordsearch.html`/`connections.html`) — each one's `init()` calls **`trySessionOrGuest()`** (since 2026-11-15): like `trySession()`, but a real visitor with no session gets a guest created automatically and the game loads straight away, with an "Already have an account? Log in" bar above it. It returns `null` -- and the page renders the one-tap **"Play now"** gate (`utils/guest-start.js#renderPlayGate()`), so the page stays crawlable -- for bots/automated browsers, on a browser a member has used ("Welcome back, Log In to Play" instead), and right after a guest logged out on purpose. The home page never creates a guest. See `docs/guest-play.md`. `profile.html`/`settings.html`/`admin.html` still use `initShell()`, since there's no crawl/ad value in making personal or admin pages visible to an anonymous visitor.

Responsibilities shared by both:

1. Injects the shared header/footer partials (`src/partials/*.html`) via `fetch()`.
2. Resolves the current session (`getSessionUser()` from `auth/auth.js` — never auto-creates a guest itself; only the game pages' `trySessionOrGuest()` does). The profile read is retried twice on a transient "client is offline" error before treating the visitor as signed out.
3. Loads the session's profile (recording guest vs. member in `auth/profile-ref.js` so progression writes go to the right doc, and quietly recreating a guest profile that Admin's clean-up removed), sets the `accountType` Analytics user property (`'guest'`/`'registered'`, see `api/CLAUDE.md`), applies the daily login bonus if not already claimed today, and wires the header (display name, `[Guest]` badge, Admin nav link, Logout button; for guests "Save my progress" + "Log in to an account" instead of Settings, and the after-Daily "save your progress" card from `utils/save-progress-nudge.js`) -- only once a session actually exists, obviously.
4. Shows the cookie consent banner if it's due (`utils/cookie-consent.js#initCookieConsentBanner()`, called from `loadHeaderFooter()` itself, so both entry points get it automatically) — session-independent, since consent is a per-browser choice, not a per-account one.

## No client-side router

Every page is a real, separate `.html` file under `src/html/`, navigated between with plain `<a href>` links — there is no `router.js` and no single-page-app shell. If that ever changes, it would be a significant enough shift to warrant its own planning pass rather than being bolted on here.
