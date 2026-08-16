# src/js/api

Raw Firebase SDK setup only. No app-specific logic lives here — that's in `src/js/auth/`, `src/js/utils/`, etc., which import from this folder.

## Files

- **`firebase-config.js`** — exports the plain `firebaseConfig` object (apiKey, authDomain, projectId, etc.) for this project's real Firebase project. No `initializeApp()` call here — this file loads as a plain ES module with no bundler, so it just exports data for `firebase-init.js` to consume.
- **`firebase-init.js`** — calls `initializeApp()`, `getAuth()`, and `initializeFirestore()` once, exporting `auth` and `db` for every other module to import. Firestore is initialized with `experimentalForceLongPolling: true` — this app never uses `onSnapshot()` real-time listeners, so the default streaming "Listen" WebChannel connection is pure overhead, and on some networks (VPNs, proxies, certain routers) that streaming connection can hang for 30+ seconds before falling back. Long-polling avoids that.

## Notes

- There is no backend server and no `java-backend.js` — this is a pure Firebase app (Auth + Firestore only). If a real backend is ever introduced, it would live in a new top-level folder, not here.
- The Firebase JS SDK is loaded from the `gstatic.com` CDN via bare `https://` import specifiers in each file that needs it (no npm install, no bundler) — every file across the codebase that talks to Firebase imports directly from the CDN URL rather than re-exporting SDK functions through this folder.
