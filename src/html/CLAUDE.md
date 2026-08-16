# src/html

Nine real, separate HTML pages — no client-side routing, no templating. Each page follows the same skeleton:

```html
<link rel="stylesheet" href="../css/base.css">
<link rel="stylesheet" href="../css/components.css">
<link rel="stylesheet" href="../css/pages/<name>.css">
...
<div id="site-header"></div>   <!-- filled by src/js/app.js via fetch('../partials/header.html') -->
<div class="content"> ... </div>
<div id="site-footer"></div>
...
<script type="module" src="../js/.../<page>.js"></script>
```

All paths are `../`-prefixed since these pages live one level below `src/` while `css/`, `js/`, and `partials/` are siblings of `html/`, not children of it.

## Pages

| Page | Script |
|---|---|
| `index.html` | `../js/pages/home.js` — dashboard **and** the sign-in surface (no separate login page) |
| `wordle.html` | `../js/games/wordle/wordle-page.js` |
| `sudoku.html` | `../js/games/sudoku/sudoku-page.js` |
| `wordsearch.html` | `../js/games/wordsearch/wordsearch-page.js` |
| `leaderboard.html` | `../js/leaderboard/leaderboard-page.js` |
| `challenges.html` | `../js/pages/challenges.js` |
| `profile.html` | `../js/pages/profile.js` |
| `settings.html` | `../js/pages/settings.js` (registered users only) |
| `admin.html` | `../js/admin/admin-page.js` (admins only) |

## Running locally

`fetch()` for the partials and the Firebase SDK's `<script type="module">` both require an actual HTTP server (not `file://`). From the **project root**: `python3 -m http.server 8000`, then open `http://localhost:8000/src/html/index.html`.
