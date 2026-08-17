# src/js/admin

Everything here is gated on `profile.isAdmin` — `admin-page.js` redirects non-admins away immediately. `src/html/admin.html` is the only page that loads this folder's code.

## Files

- **`moderation.js`** — direct Firestore operations restricted to admins by security rules: `lookupUserByUsername()`, `setUserBanned()`/`setUserAdmin()` (toggle a `registeredUsers` doc's moderation fields), `deleteChallenge()`.
- **`admin-page.js`** — page glue for `src/html/admin.html`. Content is organized into two collapsible top-level sections: **General** (Platform Config forms — `dailyLoginReward`, `challengeExpiration`, `maxChallengeCreationsPerDay`, `wordValidationAPI`, `profanityList`, each seeded with defaults on first load via `ensureConfigDefaults()` — plus Moderate Users and Delete Challenge) and **Advertisements** (the 3 home-page ad slots, plus a "Game wise" subsection with a nested collapsible per game — Wordle/Sudoku/Word Search — each showing that game's top/bottom ad slots). This grouping exists purely to keep the page scannable; it has no bearing on the data model.

The collapsibles are plain `<div data-collapsible>` + `<button>` (see `wireCollapsibleSections()`), **not** `<details>`/`<summary>` — `<details>` was tried first but its box width behaved inconsistently between open/closed states across at least one browser, which a `<details>`-based fix couldn't reliably override. The current approach toggles an `.open` class via a click handler, and CSS shows/hides the inner content with plain `display: none`/`block`, which can never affect the outer box's own width (already fixed at `width: 100%; max-width: var(--content-max-width)`).

## Ad slots

`config/ads` holds per-slot settings for all 9 ad placements across the site (`src/js/utils/ads.js#AD_SLOTS` is the canonical list — id, label, and a `group` used only to sort slots into the admin panel's sections above). Each slot has `enabled` (hide it entirely when off), `type` (`'google'` shows the existing static AdSense-placeholder markup already in the HTML — there's still no real AdSense integration, just an honest placeholder — while `'image'` rewrites the slot into a clickable image ad using `imageUrl`/`linkUrl`), and those two URL fields. `admin-page.js#renderAdSlotForms()` renders each group into its own container (`ad-slot-forms-home`/`-wordle`/`-sudoku`/`-wordsearch`) but all four share one in-memory `slots` object — saving any single slot's form re-reads/merges that shared map before writing the whole `config/ads` doc back, so editing e.g. a Wordle ad from the "Game wise" subsection never clobbers the Home ads. The actual per-page rendering happens automatically on every page load via `applyAdSlots()`, called from `src/js/app.js#loadHeaderFooter()` — admin-page.js only edits the settings, it doesn't render the ads itself.

## Bootstrapping the first admin

No code path can safely auto-grant admin — see the root `README.md` for the one-time manual step (sign up normally, then flip `isAdmin: true` on that account's `registeredUsers` doc via the Firebase console).

## Not implemented

`config/wordValidationAPI` exists as a config document (editable here) but isn't wired to any feature yet — custom-challenge word validation against a dictionary API is a future addition. There's no analytics panel and no pre-computed/scheduled jobs (no Cloud Functions in this app at all).
