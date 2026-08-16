# src/js/admin

Everything here is gated on `profile.isAdmin` — `admin-page.js` redirects non-admins away immediately. `src/html/admin.html` is the only page that loads this folder's code.

## Files

- **`moderation.js`** — direct Firestore operations restricted to admins by security rules: `lookupUserByUsername()`, `setUserBanned()`/`setUserAdmin()` (toggle a `registeredUsers` doc's moderation fields), `deleteChallenge()`.
- **`admin-page.js`** — page glue for `src/html/admin.html`. Two panels: **Config** (one form per `config/*` document — `dailyLoginReward`, `challengeExpiration`, `maxChallengeCreationsPerDay`, `wordValidationAPI`, `profanityList` — each seeded with defaults on first load via `ensureConfigDefaults()` from `src/js/utils/config.js`, since there's no server to seed them ahead of time), and **Moderate** (username lookup → ban/unban, promote/demote admin, plus a delete-challenge-by-ID action).

## Bootstrapping the first admin

No code path can safely auto-grant admin — see the root `README.md` for the one-time manual step (sign up normally, then flip `isAdmin: true` on that account's `registeredUsers` doc via the Firebase console).

## Not implemented

`config/wordValidationAPI` exists as a config document (editable here) but isn't wired to any feature yet — custom-challenge word validation against a dictionary API is a future addition. There's no analytics panel and no pre-computed/scheduled jobs (no Cloud Functions in this app at all).
