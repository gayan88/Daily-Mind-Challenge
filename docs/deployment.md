# Deployment

Deployed on Firebase Hosting, project `daily-mind-challenge` (see `.firebaserc`), currently reachable at `daily-mind-challenge.web.app` pending the custom domain (`dailymindchallenge.com`) being connected in the Firebase console.

## Firebase project setup (one-time, manual)

Covered in full in the root `README.md` — summary: create a Firebase project, enable the **Anonymous** and **Email/Password** Auth providers, create a Firestore database, register a web app and paste its config into `src/js/api/firebase-config.js`, then publish `firebase/firestore.rules` and the indexes in `firebase/firestore.indexes.json` via the Firestore console.

## Hosting config (`firebase.json`)

```json
{
  "hosting": {
    "public": "src",
    "cleanUrls": true,
    "rewrites": [
      { "source": "/", "destination": "/html/index.html" },
      { "source": "/leaderboard", "destination": "/html/leaderboard.html" },
      { "source": "/profile", "destination": "/html/profile.html" },
      { "source": "/settings", "destination": "/html/settings.html" },
      { "source": "/admin", "destination": "/html/admin.html" },
      { "source": "/wordle", "destination": "/html/wordle.html" },
      { "source": "/sudoku", "destination": "/html/sudoku.html" },
      { "source": "/wordsearch", "destination": "/html/wordsearch.html" }
    ]
  }
}
```

- **`public: "src"`** — the file structure under `src/` (`html/`, `css/`, `js/`, `partials/`, `assets/`) stays exactly as documented in `src/html/CLAUDE.md` and friends; hosting config is a presentation layer on top, not a physical reorganization.
- **`rewrites`** — map each clean production URL to its real `.html` file. This is a deliberate choice over a single-page-app catch-all (`"source": "**" → "/index.html"`, which is `firebase init hosting`'s default suggestion) — this app is real multi-page navigation, not a client-side router, so every route needs its own explicit destination. **Adding a ninth page means adding a rewrite entry here** — see `src/html/CLAUDE.md`'s Pages table for the current full list, which must stay in sync with this file.
- **`cleanUrls: true`** — auto-strips `.html` if a raw filename URL is ever hit directly.
- Every path referenced from inside `src/` (asset `<link>`/`<script>` tags, nav `<a href>`s, `fetch()` calls for partials) is **root-relative** (`/css/...`, not `../css/...`) — this only resolves correctly because the site is served from a domain root. See `src/html/CLAUDE.md` for the one exception (JS `import` statements, which resolve against the importing script's own location and were never affected).

## Deploying

```bash
firebase deploy --only hosting
```

## Custom domain

Firebase console → your project → **Build → Hosting → Add custom domain** → follow the DNS verification flow (a TXT record to prove ownership, then A/AAAA or CNAME records pointing at Firebase). Not yet connected as of this writing — the live site is still the default `.web.app` subdomain.

## Important: Hosting does not fix Firestore latency

Firebase Hosting serves your **static files** (HTML/CSS/JS) from a global CDN — that part gets fast for users anywhere once deployed. It has **no effect** on Firestore read/write latency, which is determined entirely by your Firestore database's region (set once at creation, e.g. `us-central`) and how far a given user is from it, regardless of where the HTML came from. If most users are in the US/Europe and the database is in `us-central`, that's a reasonable pairing already — see `docs/architecture.md` for the rest of the reasoning. Don't expect a Hosting deploy to change the per-request Firestore timing you see in DevTools during local development.

## Deploying rules/indexes changes

Whenever `firebase/firestore.rules` or `firebase/firestore.indexes.json` change, they need to be re-published — either by pasting into the Firestore console's Rules/Indexes tabs manually (the approach used so far in this project), or via:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Indexes take a minute or two to finish "Building" after deploy before queries against them succeed.

## Local dev vs. production parity

`python3 -m http.server`/`npx serve`, run from `src/`, correctly serves the root-relative asset paths but knows nothing about `firebase.json`'s `rewrites` — clean URLs like `/wordle` will 404 under a plain static server, only the raw `/html/wordle.html` works. To test the clean URLs exactly as they behave in production, use the Firebase CLI's own local hosting emulator instead, from the **project root**: `firebase emulators:start --only hosting`.
