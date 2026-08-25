# src/partials

Two plain HTML fragments (not full documents — no `<html>`/`<head>`/`<body>`), injected into every page's `<div id="site-header">`/`<div id="site-footer">` placeholders via `fetch()` from `src/js/app.js`.

## Files

- **`header.html`** — logo, nav links (Home/Leaderboard/Profile, plus a hidden-by-default Admin link shown only for admins), and **two** user-menu variants (`#user-menu-loggedin` and `#user-menu-loggedout`, both `hidden` by default) that `app.js`/`home.js` toggle based on session state — logged in shows the display name badge + Settings + Logout, logged out shows a single Login button.
- **`footer.html`** — footer nav links + the "Share with Friends" link (`#footer-share-fb`, wired up in `app.js#wireFooterShare()` via the shared `shareUrl()` helper -- native Web Share API first, `sharer.php` popup fallback on desktop). Always shares the home page (`${origin}/`) with a fixed promotional message (`FOOTER_SHARE_TEXT` in `app.js`), regardless of which page the footer is clicked from -- this is a site-wide "come join us" invite, not a per-page share, so a friend clicking it should never land on the sharer's own `/settings` or `/profile` page.

## Why two user-menu variants instead of one that gets rewritten

Toggling `hidden` on two pre-built variants is simpler and less error-prone than tearing down/rebuilding the menu's DOM every time login state changes (e.g. after the sign-in modal succeeds without a full page reload in some flows).
