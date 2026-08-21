# Daily Mind Challenge

A daily puzzle games site — Wordle, Sudoku, and Word Search — with guest/registered login, points, a daily leaderboard, and an admin panel. Wordle has three modes: Daily Challenge, Tournaments, and Challenge a Friend (shareable-link challenges).

Plain HTML/CSS/JS, no build tooling. Firebase (Auth + Firestore) for the backend.

Source lives under `src/` — see `src/README.md` for the folder layout, and `docs/architecture.md` / `docs/data-flow.md` / `docs/deployment.md` for deeper write-ups. Nearly every folder under `src/` also has its own `CLAUDE.md` documenting what's actually implemented there.

## Running locally

Static pages use `fetch()` for shared header/footer partials, and the Firebase SDK loads as an ES module — both require an actual HTTP server, not opening the files directly (`file://`). Paths throughout `src/` are root-relative (`/css/...`, `/js/...`), which assumes the server's root is `src/` itself, not the project root.

From **`src/`**, run either:

```
npx serve .
```

or

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/html/index.html` (adjust the port if `npx serve` picked a different one).

That gets working CSS/JS/partials, but not the clean production URLs (`/wordle` instead of `/html/wordle.html`) — those come from `firebase.json`'s `hosting.rewrites`, which plain `http.server`/`serve` don't know about. To test those exactly as they'll behave live, run the Firebase CLI's local hosting emulator instead, from the **project root**: `firebase emulators:start --only hosting`.

## Firebase setup (one-time, manual)

The app will run but login/points/leaderboard/challenges won't work until you do this:

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new project.
2. **Build > Authentication > Get started > Sign-in method** — enable both the **Anonymous** provider (for guest login) and the **Email/Password** provider (for registered accounts; used under the hood — see "Login system" below).
3. **Build > Firestore Database > Create database** — start in test mode for local development (tighten later using `firebase/firestore.rules`).
4. **Project settings > General > Your apps** — click the web icon (`</>`) to register a web app, then copy the `firebaseConfig` object it gives you.
5. Paste those values into `src/js/api/firebase-config.js`, replacing the placeholder strings.
6. In the Firestore console, open the **Rules** tab and paste in the contents of `firebase/firestore.rules`, then Publish. Add the composite indexes described in `firebase/firestore.indexes.json` (Firestore will also prompt you with a direct link to create each one the first time its query runs).

## Bootstrapping the first admin

No code path can safely auto-grant admin access. To get your first admin:

1. Sign up for a normal account through the app's Sign Up form.
2. In the Firebase console, open **Firestore Database > Data > registeredUsers**, find that account's document, and manually set `isAdmin` to `true`.
3. Log out and back in (or just refresh) — the **Admin** link appears in the header nav, and `admin.html` seeds the `config/*` documents with their defaults the first time it loads.

## Login system

Three ways in:

- **Guest** — display name only, no automatic sign-in (you must explicitly choose "Continue as Guest" from the sign-in modal, opened from the header's Login button or automatically when a page needs a session). Can play games and appear on the leaderboard, but can't earn daily login points, create Wordle challenges, or change their name, and has no settings page.
- There is no separate login page — the home page (`/`) doubles as the dashboard **and** the sign-in surface, showing the Guest/Log In/Sign Up options in a modal whenever there's no active session. Every other page redirects to `/?redirect=<page>` if it loads with no session; after signing in there, you're sent on to that original page.
- **Log In / Sign Up** — username + password. Under the hood this uses Firebase Auth's email/password provider: your username maps to a synthetic login email (`username@dmc.local`) unless you supply a real email at signup, in which case that becomes the account's actual Auth email so Firebase's built-in password-reset email works. **There is no `passwordHash` field anywhere in Firestore** — Firebase Auth owns password storage/verification entirely (storing/comparing password hashes client-side isn't securely possible with no backend server — see `src/js/auth/CLAUDE.md`).
- **Admin** — a flag on a registered account (`registeredUsers/{uid}.isAdmin`), not a separate login type. Admins can access `admin.html` but cannot play games (scores aren't tracked for admin accounts) and are excluded from leaderboards.

## Firestore schema

- `guests/{uid}` — uid is the Firebase Anonymous Auth uid.
- `registeredUsers/{uid}` — uid is the Firebase Auth uid from email/password signup. Holds `username`, `displayName`, `email` (optional real email, separate from the Auth login email), `isAdmin`, `isBanned`, `bannedReason`, `bannedDate`, `loginPoints`, `lastLoginDate`, `currentStreak`.
- `usernames/{usernameLower}` — public `{ uid, authEmail }` mapping, written once at signup, used to resolve a username to its Auth email at login time.
- `gameScores/{uid}_{gameType}_{gameDate}` — one doc per game per day (deterministic ID gives "one attempt per day" for free via Firestore's create-vs-update rules, no extra query needed). `score` is a flat 6 on completion for Sudoku/Word Search; Wordle's three modes (see below) use richer per-mode formulas and repurpose `gameDate` as a generic deterministic key (tournament/challenge id) where the doc isn't tied to a calendar day — see `src/js/games/wordle/CLAUDE.md`.
- `config/{dailyLoginReward|challengeExpiration|wordValidationAPI|profanityList}` — admin-editable platform settings, seeded with defaults the first time `admin.html` loads.
- `wordleDailyWords/{id}` (+ `_meta`) — admin-managed numbered word pool backing Wordle's Daily Challenge, edited from `admin.html`'s Wordle section.
- `wordleTournaments/{id}` + `wordleTournamentAttempts/{tournamentId}_{uid}` — admin-created timed multi-word Wordle tournaments and per-player progress.
- `wordleChallenges/{id}` + `completions/{uid}` — Wordle's "Challenge a Friend" shareable-link challenges, only registered, non-banned users can create them (built into `wordle.html`; the app's older, generic Challenges page/collection has been retired).

Full data-flow write-up: `docs/data-flow.md`.

## Adding new daily content

- **Wordle Daily Challenge words**: add words from `admin.html`'s Wordle section (append-only — the same "don't reorder, it shifts which day gets which word" rule applies, now enforced by the admin UI itself rather than by editing a source file). There's no source file to edit anymore — the old static `words-wordle.js` list was removed along with the generic Challenges feature that was its last consumer.
- **Wordle Tournaments** and **Challenge a Friend** links: also created from `admin.html` (Tournaments) or in-page from `wordle.html` itself (Challenge a Friend) — no source file to edit for either.
- **Sudoku puzzles**: add `{ puzzle, solution }` pairs (81-character strings, `0` = blank) to `src/js/games/sudoku/sudoku-puzzles.js`.
- **Word Search themes**: add a day's word list to `src/js/games/wordsearch/wordsearch-words.js`; the grid itself is generated at runtime from a date-seeded random layout, so you only supply words.

## Known v1 scope limitations

- 9 ad slots across the site (3 on the home page, 2 each on Wordle/Sudoku/Word Search) are admin-configurable via `admin.html` — each can be turned off, left as a static "Google AdSense" placeholder (still no real AdSense integration), or swapped for a manual image ad with a click-through URL.
- "Share on Facebook" links to the plain `sharer.php` share dialog, no App ID/rich cards.
- Challenge a Friend is a shareable link, not a real friends graph.
- Points are protected by Firestore security rules capping per-write deltas, not full server-authoritative scoring (no Cloud Functions in v1).
- No Analytics collection, no pre-computed/cached leaderboards — leaderboards aggregate `gameScores` client-side on each load.
- Password reset only works for accounts that supplied a real email at signup (relies on Firebase Auth's built-in reset email, which needs a real address to send to).
- Changing your password requires a recent login (a Firebase Auth security requirement) — if it fails, log out and back in first.
- Deployed on Firebase Hosting — see `docs/deployment.md` for the URL scheme and how `firebase.json`'s rewrites map clean URLs to the physical pages.
