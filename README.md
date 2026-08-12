# Daily Mind Challenge

A daily puzzle games site — Wordle, Sudoku, and Word Search — with guest login, points, a daily leaderboard, and shareable challenges.

Plain HTML/CSS/JS, no build tooling. Firebase (Anonymous Auth + Firestore) for the backend.

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

The app will run but auth/points/leaderboard/challenges won't work until you do this:

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new project.
2. **Build > Authentication > Get started > Sign-in method** — enable the **Anonymous** provider.
3. **Build > Firestore Database > Create database** — start in test mode for local development (tighten later using `firebase/firestore.rules`).
4. **Project settings > General > Your apps** — click the web icon (`</>`) to register a web app, then copy the `firebaseConfig` object it gives you.
5. Paste those values into `js/firebase/firebase-config.js`, replacing the placeholder strings.
6. In the Firestore console, open the **Rules** tab and paste in the contents of `firebase/firestore.rules`, then Publish. Add the composite index described in `firebase/firestore.indexes.json` (Firestore will also prompt you with a direct link to create it the first time the leaderboard query runs).

## Adding new daily content

- **Wordle answers**: add words to the list in `js/data/words-wordle.js`. The daily word is picked deterministically from the list by date, so the list order matters (avoid reordering once live, or the "daily word" will shift for existing players).
- **Sudoku puzzles**: add `{ puzzle, solution }` pairs (81-character strings, `0` = blank) to `js/data/sudoku-puzzles.js`.
- **Word Search themes**: add a day's word list to `js/data/wordsearch-words.js`; the grid itself is generated at runtime from a date-seeded random layout, so you only supply words.

## Known v1 scope limitations

- Ad spaces are static placeholders — no real AdSense integration.
- "Share on Facebook" links to the plain `sharer.php` share dialog, no App ID/rich cards.
- Guests only — no email/password or social login, no way to recover a guest identity if local browser data is cleared.
- Challenges are shareable links, not a real friends graph (see the plan notes / code comments in `js/lib/challenges.js`).
- Points are protected by Firestore security rules capping per-write deltas, not full server-authoritative scoring (no Cloud Functions in v1).
