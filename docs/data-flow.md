# Data Flow

## Session bootstrap (every page)

1. `src/js/app.js#loadHeaderFooter()` fetches and injects `src/partials/header.html`/`footer.html`.
2. `getSessionUser()` (`src/js/auth/auth.js`) checks Firebase Auth's local state — resolves to the existing user or `null`. **Never** creates a session automatically.
3. If no session and the page requires one (`initShell()`), redirect to `index.html?redirect=<page>`.
4. If a session exists, `loadSessionProfile()` (`src/js/auth/user-profile.js`) reads `guests/{uid}` or `registeredUsers/{uid}` (picked via `user.isAnonymous`, no extra read needed) — signs out and throws if the account is banned or its profile doc is missing.
5. `applyDailyLoginBonus()` runs **only** if `profile.lastLoginDate !== today` (skipped entirely otherwise, to avoid two wasted Firestore reads on every page load after the first one each day) — a transaction that awards `config/dailyLoginReward.points` once per day and updates the login streak.
6. The header renders (display name, `[Guest]` badge, Admin link, Logout) and the page's own script takes over.

## Guest / Login / Sign Up (home page only)

- **Guest**: `signInAsGuest()` (Firebase Anonymous Auth) → `createGuestProfile(uid, displayName)` → redirect.
- **Sign Up**: username/password/display-name/optional-email → `signUpWithUsername()` (creates the Firebase Auth account, email = real email if given, else `username@dmc.local`) → `createRegisteredProfile()` (batch-writes `registeredUsers/{uid}` + `usernames/{usernameLower}` together) → redirect.
- **Log In**: username → look up `usernames/{username}` for the Auth email → `signInWithEmailAndPassword()` → `loadSessionProfile()` (throws if banned) → redirect.

## Playing a game

1. Page script (`src/js/games/*/​*-page.js`) calls `initShell()`, blocks admins, checks `checkPlayedToday(uid, gameType)` (a direct `getDoc` on the deterministic `gameScores/{uid}_{gameType}_{date}` ID — no query needed).
2. If not yet played, mounts the game engine with the day's content (deterministic by date, same for every player).
3. On completion, `recordGameScore()` writes the `gameScores` doc. The real "can't replay for points" guarantee is enforced by Firestore rules (only `create`, never `update`, is allowed on that path), not just the client-side pre-check.

## Leaderboard

`src/js/leaderboard/leaderboard-data.js` queries `gameScores where gameDate == today` (optionally `+ gameType`), sums per user client-side, and filters out banned users (a separately-cached `registeredUsers where isBanned == true` query). **Login points are excluded** from this ranking — see `src/js/leaderboard/CLAUDE.md` for why.

## Home page "today's points" (personal stat, different from the leaderboard)

`gameScoreToday` (from the leaderboard aggregate) + `config/dailyLoginReward.points` if `profile.lastLoginDate === today`. This is why the login-bonus toast's promised points actually show up here even though they're absent from the competitive leaderboard.

## Challenge a Friend (Wordle only)

`createWordleChallenge()` (registered, non-banned users only) → `wordleChallenges/{id}` doc with an expiry read from `config/challengeExpiration.days`. Solving reuses the Wordle engine pointed at the challenge's word; one attempt is recorded per solver in a `wordleChallenges/{id}/completions/{uid}` subcollection doc. See `src/js/games/wordle/CLAUDE.md` for the full points flow (player's own score plus the creator's separately-synced reward).

## Config

`src/js/utils/config.js#getConfig(docId)` reads `config/{docId}` with an in-memory cache (per page load) and a hardcoded fallback default if the doc doesn't exist yet. Admins seed/edit these via `src/js/admin/admin-page.js`.
