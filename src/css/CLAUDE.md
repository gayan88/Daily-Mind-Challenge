# src/css

Plain CSS, no preprocessor, no build step. Loaded via `<link>` tags directly in each HTML page (no `styles.css` bundler/importer file — each page links only the stylesheets it needs).

## Files

- **`base.css`** — CSS custom properties (`:root` palette, spacing/radius/shadow tokens), the global reset, `body`/`html` sticky-footer flex layout, and the `[hidden] { display: none !important; }` override (needed because several component classes set their own `display`, which would otherwise beat the browser's default `[hidden]` rule).
- **`components.css`** — every shared, reused-across-pages component: header, footer, buttons, cards, form fields, the game-tile grid, leaderboard rows, challenge cards, auth tabs/modal-adjacent form styles, toasts. This is the largest file and the first place to look for an existing class before adding a new one.
- **`pages/*.css`** — one file per page, containing only that page's layout/overrides not covered by `components.css` (e.g. `wordle.css` has the Wordle board/keyboard grid, `admin.css` has the config-form layout). Each page's HTML links `base.css` + `components.css` + its own `pages/<name>.css`.

## Conventions

- Colors, spacing, and radii should come from the CSS variables in `base.css`'s `:root`, not hardcoded hex/px values.
- If a style is used on more than one page, it belongs in `components.css`, not duplicated across `pages/*.css` files.
