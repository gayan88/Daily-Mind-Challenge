# Daily Mind Challenge

A daily puzzle games site — Wordle, Sudoku, and Word Search — with guest/registered login, points, a daily leaderboard, shareable challenges, and an admin panel.

Plain HTML/CSS/JS, no build tooling. Firebase (Auth + Firestore) for the backend.

## Running locally

Static pages use `fetch()` for shared header/footer partials, and the Firebase SDK loads as an ES module — both require an actual HTTP server, not opening the files directly (`file://`).

From the project root, run either:

```
npx serve .
```

or

```
python3 -m http.server 8000
```

Then open the printed local URL (e.g. `http://localhost:3000` or `http://localhost:8000`).

## Firebase setup (one-time, manual)

The app will run but login/points/leaderboard/challenges won't work until you do this:

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new project.
2. **Build > Authentication > Get started > Sign-in method** — enable both the **Anonymous** provider (for guest login) and the **Email/Password** provider (for registered accounts; used under the hood — see "Login system" below).
3. **Build > Firestore Database > Create database** — start in test mode for local development (tighten later using `firebase/firestore.rules`).
4. **Project settings > General > Your apps** — click the web icon (`</>`) to register a web app, then copy the `firebaseConfig` object it gives you.
5. Paste those values into `js/firebase/firebase-config.js`, replacing the placeholder strings.
6. In the Firestore console, open the **Rules** tab and paste in the contents of `firebase/firestore.rules`, then Publish. Add the composite indexes described in `firebase/firestore.indexes.json` (Firestore will also prompt you with a direct link to create each one the first time its query runs).

## Bootstrapping the first admin

No code path can safely auto-grant admin access. To get your first admin:

1. Sign up for a normal account through the app's Sign Up form.
2. In the Firebase console, open **Firestore Database > Data > registeredUsers**, find that account's document, and manually set `isAdmin` to `true`.
3. Log out and back in (or just refresh) — the **Admin** link appears in the header nav, and `admin.html` seeds the `config/*` documents with their defaults the first time it loads.

## Login system

Three ways in, matching `USER_LOGIN_SCHEMA_SUMMARY.txt`:

- **Guest** — display name only, no automatic sign-in (you must explicitly choose "Continue as Guest" on `login.html`). Can play games and appear on the leaderboard, but can't earn daily login points, create challenges, or change their name, and has no settings page.
- **Log In / Sign Up** — username + password. Under the hood this uses Firebase Auth's email/password provider: your username maps to a synthetic login email (`username@dmc.local`) unless you supply a real email at signup, in which case that becomes the account's actual Auth email so Firebase's built-in password-reset email works. **There is no `passwordHash` field anywhere in Firestore** — Firebase Auth owns password storage/verification entirely, which is the one deliberate deviation from the schema doc (storing/comparing password hashes client-side isn't securely possible with no backend server).
- **Admin** — a flag on a registered account (`registeredUsers/{uid}.isAdmin`), not a separate login type. Admins can access `admin.html` but cannot play games (scores aren't tracked for admin accounts) and are excluded from leaderboards.

## Firestore schema

- `guests/{uid}` — uid is the Firebase Anonymous Auth uid.
- `registeredUsers/{uid}` — uid is the Firebase Auth uid from email/password signup. Holds `username`, `displayName`, `email` (optional real email, separate from the Auth login email), `isAdmin`, `isBanned`, `bannedReason`, `bannedDate`, `loginPoints`, `lastLoginDate`, `currentStreak`.
- `usernames/{usernameLower}` — public `{ uid, authEmail }` mapping, written once at signup, used to resolve a username to its Auth email at login time.
- `gameScores/{uid}_{gameType}_{gameDate}` — one doc per game per day (deterministic ID gives "one attempt per day" for free via Firestore's create-vs-update rules, no extra query needed). `score` is 0–6 for Wordle (remaining guesses) and a flat 6 on completion for Sudoku/Word Search.
- `config/{dailyLoginReward|challengeExpiration|maxChallengeCreationsPerDay|wordValidationAPI|profanityList}` — admin-editable platform settings, seeded with defaults the first time `admin.html` loads.
- `challenges/{id}` + `completions/{uid}` — shareable-link challenges; only registered, non-banned users can create them.

## Adding new daily content

- **Wordle answers**: add words to the list in `js/data/words-wordle.js`. The daily word is picked deterministically from the list by date, so the list order matters (avoid reordering once live, or the "daily word" will shift for existing players).
- **Sudoku puzzles**: add `{ puzzle, solution }` pairs (81-character strings, `0` = blank) to `js/data/sudoku-puzzles.js`.
- **Word Search themes**: add a day's word list to `js/data/wordsearch-words.js`; the grid itself is generated at runtime from a date-seeded random layout, so you only supply words.

## Known v1 scope limitations

- Ad spaces are static placeholders — no real AdSense integration.
- "Share on Facebook" links to the plain `sharer.php` share dialog, no App ID/rich cards.
- Challenges are shareable links, not a real friends graph.
- Points are protected by Firestore security rules capping per-write deltas, not full server-authoritative scoring (no Cloud Functions in v1).
- `config/wordValidationAPI` exists in the schema but isn't wired to any feature yet — the source doc labels custom-word validation a future feature.
- No Analytics collection, no pre-computed/cached leaderboards (both future phases per the source doc) — leaderboards aggregate `gameScores` client-side on each load.
- Password reset only works for accounts that supplied a real email at signup (relies on Firebase Auth's built-in reset email, which needs a real address to send to).
- Changing your password requires a recent login (a Firebase Auth security requirement) — if it fails, log out and back in first.
