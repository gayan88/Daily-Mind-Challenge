# Architecture

## Overview

Daily Mind Challenge is a static, multi-page site (plain HTML/CSS/JS, no build tooling, no bundler, no npm dependencies) backed entirely by Firebase — Authentication (Anonymous + Email/Password) and Firestore. There is no application server: every read/write goes directly from the browser to Firestore, governed by `firebase/firestore.rules`.

```
Browser
  ├── src/html/*.html         (9 real pages, plain <a href> navigation)
  ├── src/css/*                (plain CSS, no preprocessor)
  ├── src/js/*                 (ES modules, loaded via <script type="module">)
  └── src/partials/*.html      (header/footer, injected via fetch())
        │
        ▼  Firebase JS SDK (loaded from the gstatic.com CDN, no local install)
Firebase
  ├── Authentication            (Anonymous for guests, Email/Password for registered accounts)
  └── Firestore                 (guests, registeredUsers, usernames, gameScores, config, challenges)
```

## Why no build tooling

A deliberate choice: every file is served exactly as authored, so "view source" on any page shows real, readable code, and there's no compile step to keep in sync. The tradeoff is manual relative-path management (see `src/js/CLAUDE.md`) and no code-splitting/minification — acceptable for this project's current scale. If that stops being true, introducing a bundler (Vite is the natural fit for a no-framework project like this) would be a deliberate follow-up, not something to bolt on quietly.

## Why Firebase Auth instead of a custom login system

The product originally called for a Firestore-stored `passwordHash` compared client-side. That's not securely possible with no backend server — see `src/js/auth/CLAUDE.md` for the full reasoning. Firebase Auth's email/password provider is used instead, with a username-based UX layered on top via the `usernames/{username}` → email lookup collection.

## Why Firestore is initialized with `experimentalForceLongPolling`

This app never uses `onSnapshot()` real-time listeners, so Firestore's default streaming "Listen" connection is pure overhead — and on some networks it hangs for 30+ seconds before falling back. Long-polling skips that entirely. See `src/js/api/CLAUDE.md`.

## Security model

Firestore security rules (`firebase/firestore.rules`) are the actual enforcement boundary, not client-side checks:
- Every write is scoped to `request.auth.uid` — a client can only ever write its own `guests`/`registeredUsers` doc.
- `registeredUsers` writes are split into self-service fields (displayName/email, with a capped `loginPoints` delta) vs. admin-only moderation fields (`isAdmin`/`isBanned`/etc.), gated by an `isAdmin()` rule function.
- `gameScores` uses a deterministic document ID (`{uid}_{gameType}_{date}`) so a repeat write for the same game/day is rejected as an `update` (not allowed) rather than a `create` (allowed) — the "one attempt per game per day" rule is enforced server-side, not just in the UI.
- This is a **v1-pragmatic** model, not full server-authoritative validation — there's no Cloud Function re-computing scores. A determined attacker could still make small, rule-compliant fraudulent writes. Full server-side validation would require Cloud Functions, which this project doesn't use.

## What doesn't exist (and why)

- **No backend server.** Pure Firebase. If one is ever added, it's a separate architectural decision, not an incremental addition.
- **No client-side router.** Real multi-page navigation via `<a href>`.
- **No build step / npm / bundler.**
- **No real-time listeners.** Every read is a one-shot `getDoc`/`getDocs`.
- **No pre-computed/cached leaderboards.** Aggregated client-side from `gameScores` on each page load — fine at current scale, would need a scheduled Cloud Function to stay fine at much larger scale.
