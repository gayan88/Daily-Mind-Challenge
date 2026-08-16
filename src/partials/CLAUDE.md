# src/partials

Two plain HTML fragments (not full documents — no `<html>`/`<head>`/`<body>`), injected into every page's `<div id="site-header">`/`<div id="site-footer">` placeholders via `fetch()` from `src/js/app.js`.

## Files

- **`header.html`** — logo, nav links (Home/Leaderboard/Challenges/Profile, plus a hidden-by-default Admin link shown only for admins), and **two** user-menu variants (`#user-menu-loggedin` and `#user-menu-loggedout`, both `hidden` by default) that `app.js`/`home.js` toggle based on session state — logged in shows the display name badge + Settings + Logout, logged out shows a single Login button.
- **`footer.html`** — footer nav links + the "Share on Facebook" link (wired up in `app.js` to open `sharer.php` in a popup).

## Why two user-menu variants instead of one that gets rewritten

Toggling `hidden` on two pre-built variants is simpler and less error-prone than tearing down/rebuilding the menu's DOM every time login state changes (e.g. after the sign-in modal succeeds without a full page reload in some flows).
