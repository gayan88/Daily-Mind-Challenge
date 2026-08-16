# Deployment

This project isn't deployed yet — it currently runs via a local static server (`python3 -m http.server`, see root `README.md`). This doc covers what's needed to actually host it.

## Firebase project setup (one-time, manual)

Covered in full in the root `README.md` — summary: create a Firebase project, enable the **Anonymous** and **Email/Password** Auth providers, create a Firestore database, register a web app and paste its config into `src/js/api/firebase-config.js`, then publish `firebase/firestore.rules` and the indexes in `firebase/firestore.indexes.json` via the Firestore console.

## Deploying static assets (Firebase Hosting)

Not set up yet — no `firebase.json`, no Firebase CLI project init has been done. To add it:

```bash
npm install -g firebase-tools   # one-time, global
firebase login
firebase init hosting           # in the project root
```

When prompted:
- **Public directory**: `src/html` would serve pages at the root URL (`/index.html` etc.), but `src/css`/`src/js`/`src/partials` need to be reachable too — since Firebase Hosting serves from a single public directory, the practical choice is pointing it at `src/` itself (so URLs become `/html/index.html`, `/css/base.css`, etc.) or restructuring with a small deploy-time copy step that flattens `src/html/*` up to the hosting root while keeping `css/`/`js/`/`partials/` as siblings. Decide this before the first deploy — changing it later means every internal link/path in `src/html/*.html` changes again.
- **Single-page app rewrite**: No — this is real multi-page navigation, not a client-side router.

Then: `firebase deploy --only hosting`.

## Important: Hosting does not fix Firestore latency

Firebase Hosting serves your **static files** (HTML/CSS/JS) from a global CDN — that part gets fast for users anywhere once deployed. It has **no effect** on Firestore read/write latency, which is determined entirely by your Firestore database's region (set once at creation, e.g. `us-central`) and how far a given user is from it, regardless of where the HTML came from. If most users are in the US/Europe and the database is in `us-central`, that's a reasonable pairing already — see `docs/architecture.md` for the rest of the reasoning. Don't expect a Hosting deploy to change the per-request Firestore timing you see in DevTools during local development.

## Deploying rules/indexes changes

Whenever `firebase/firestore.rules` or `firebase/firestore.indexes.json` change, they need to be re-published — either by pasting into the Firestore console's Rules/Indexes tabs manually (the approach used so far in this project), or, once `firebase init` has been run, via:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Indexes take a minute or two to finish "Building" after deploy before queries against them succeed.
