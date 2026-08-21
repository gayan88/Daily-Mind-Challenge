# src/html

Eight real, separate HTML pages — no client-side routing, no templating. Each page follows the same skeleton:

```html
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/components.css">
<link rel="stylesheet" href="/css/pages/<name>.css">
...
<div id="site-header"></div>   <!-- filled by src/js/app.js via fetch('/partials/header.html') -->
<div class="content"> ... </div>
<div id="site-footer"></div>
...
<script type="module" src="/js/.../<page>.js"></script>
```

All paths are **root-relative** (`/css/...`, `/js/...`, `/partials/...`) rather than `../`-relative -- this assumes the site is served from a domain root (`src/` as the Hosting `public` directory, per `firebase.json`), which is true both in production and in local dev (see "Running locally" below). Internal navigation (`<a href>` in `header.html`/`footer.html`, game tiles, etc.) is also root-relative, but points at the **clean URLs** below (`/wordle`, not `/html/wordle.html`) -- `firebase.json`'s `rewrites` map each clean URL to its real file. ES module `import` statements inside `.js` files are the one exception that stayed `../`-relative -- those resolve against the *importing script's own location*, not the page's URL, so they were never affected by any of this.

## Ad slots

The home page and the three game pages each have `<div class="ad-space" data-ad-slot="<id>">` elements (3 on the home page, 2 each on the game pages — top of the game, bottom of the page). The `data-ad-slot` id is what `src/js/utils/ads.js#applyAdSlots()` matches against `config/ads` to decide whether to hide the slot, leave its static placeholder text alone, or rewrite it into an image ad — see `src/js/admin/CLAUDE.md` for the full picture. Don't add a new ad `<div>` without also adding its id to `AD_SLOTS` in `ads.js`, or it won't show up in the admin panel to configure.

## Pages

| Page | Script | Clean URL (production) |
|---|---|---|
| `index.html` | `/js/pages/home.js` — dashboard **and** the sign-in surface (no separate login page) | `/` |
| `wordle.html` | `/js/games/wordle/wordle-page.js` | `/wordle` |
| `sudoku.html` | `/js/games/sudoku/sudoku-page.js` | `/sudoku` |
| `wordsearch.html` | `/js/games/wordsearch/wordsearch-page.js` | `/wordsearch` |
| `leaderboard.html` | `/js/leaderboard/leaderboard-page.js` | `/leaderboard` |
| `profile.html` | `/js/pages/profile.js` | `/profile` |
| `settings.html` | `/js/pages/settings.js` (registered users only) | `/settings` |
| `admin.html` | `/js/admin/admin-page.js` (admins only) | `/admin` |

The clean URLs are defined once, in `firebase.json`'s `hosting.rewrites` at the repo root — that's the single source of truth for the mapping. Adding a ninth page means adding both the physical `.html` file here and a matching rewrite entry there.

## Running locally

`fetch()` for the partials and the Firebase SDK's `<script type="module">` both require an actual HTTP server (not `file://`). Because paths are root-relative, the local server's root must be `src/`, not the project root -- from **`src/`**: `python3 -m http.server 8000`, then open `http://localhost:8000/html/index.html`.

That gets you working CSS/JS/partials locally, but **not** the clean URLs (`/wordle` etc.) -- plain `http.server` doesn't know about `firebase.json`'s rewrites. To test the clean URLs exactly as they'll behave in production, use the Firebase CLI's own local hosting emulator instead (reads `firebase.json` directly): `firebase emulators:start --only hosting` from the **project root**.
