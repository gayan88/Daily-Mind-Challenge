# API Documentation
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | New as of 2026-10-17. |
| **Related docs** | `docs/database-design-document.md`, `docs/solution-architecture-document.md`, `firebase/firestore.rules` |

---

## 1. There Is No Custom REST/GraphQL API

This is the single most important fact to understand before reading further: **there is no
backend server, no custom endpoints, and no Cloud Functions.** The browser talks directly to
Cloud Firestore and Firebase Authentication using Google's client SDKs. There are no routes like
`GET /api/scores` or `POST /api/games/wordle/complete` anywhere in this system.

The actual "API" — the contract that determines what a client is and isn't allowed to do — is
**`firebase/firestore.rules`**. This document treats that file as the API specification it
functionally is: every collection below is "endpoint," every `allow create/read/update/delete`
rule is the equivalent of an HTTP method's authorization logic, and the Firestore SDK calls in
`src/js/**/*.js` are the equivalent of API client code.

## 2. Authentication

| Mechanism | How it works |
|---|---|
| Anonymous (Guest) | `signInAnonymously()` (Firebase Auth) — no credentials; `request.auth.uid` exists but corresponds to no password |
| Email/Password (Registered) | `createUserWithEmailAndPassword()` / `signInWithEmailAndPassword()`; a username-based UX is layered on top via the `usernames/{username}` → email lookup collection, since Firebase Auth itself only knows email/password |
| Session state | Managed entirely client-side by the Firebase Auth SDK (`getSessionUser()` in `src/js/auth/auth.js`); there is no server-issued session token this app manages itself |
| Authorization | Every Firestore request automatically carries the caller's ID token; `firestore.rules` evaluates `request.auth.uid` and (for admin checks) reads the caller's own `registeredUsers` document server-side |

There is no API key a client application presents — the Firebase Web SDK config
(`src/js/api/firebase-config.js`) is public by design; access control is entirely the Firestore
rules layer, not a secret.

## 3. "Endpoints" (Firestore Collections) by Operation

Every collection is reachable via the standard Firestore SDK calls (`getDoc`, `getDocs`, `setDoc`,
`updateDoc`, `runTransaction`, `deleteDoc`) — there's no separate request/response schema beyond
the document shape itself (see `docs/database-design-document.md`). The table below summarizes the
**authorization** shape per collection family; HTTP-style status codes don't apply — a disallowed
operation throws a `FirebaseError` with code `permission-denied` on the client.

| Collection family | Read | Create | Update | Delete |
|---|---|---|---|---|
| `guests` / `registeredUsers` | Public | Owner only, at sign-up | Owner (self-service fields, bounded deltas) or Admin (moderation fields) | Never |
| `usernames` | Public | Owner only, matching their own `uid` | Never | Never |
| `gameScores` | Public | Owner only; deterministic ID; score ≤ per-`gameType` cap | Owner only, for the two share-bonus fields, each exactly once | Admin only |
| `{game}Daily*` / `{game}Classic*` / `{game}Tournaments` | Public | Admin only | Admin only | Admin only (Classic/Tournaments); Daily content has no delete path by design (see `docs/technical-design-document.md`/each game's `CLAUDE.md`) |
| `{game}TournamentAttempts` | Public | Owner only, fresh-start shape | Owner only, bounded progression (index only increases by exactly 1, or resets to 0) | Admin only |
| `{wordle,connections}DailyAttempts` | Public | Owner only, `attemptsCount == 1` | Owner only, `attemptsCount` advances by exactly 1, locked once `won == true` | Admin only |
| `wordleChallenges` + `completions` | Public | Registered, non-banned users only | Creator only, bounded fields | Admin only |
| `playerAchievements` | Public | Owner only, `achievementId` in a fixed allow-list, `count == 1` | Never | Admin only |
| `championshipWinTallies` | Public | Owner only, `count == 1` | Owner only, advances by exactly 1 | Admin only |
| `periodResults` | Public | Admin only | Admin only (finalize), or the winner only (claim `claimed: false → true`) | Admin only |
| `playerMissions` | Public | Owner only | Never | Admin only |
| `config` | Public | Admin only | Admin only | Admin only |

## 4. Representative Request/Response Shapes

Since there's no formal request/response envelope, "request" here means the object passed to the
Firestore SDK call, and "response" means the document that results.

### Create a game score (Connections Daily win)
```js
// Request (src/js/games/connections/connections-daily-data.js#recordDailyResult)
setDoc(doc(db, 'gameScores', `${uid}_connections_${today}`), {
    userId: uid,
    displayName: profile.displayName,
    isGuest: profile.kind === 'guest',
    gameType: 'connections',
    score: 28,                 // 10 base + mistakesBonus + timeBonus, capped at 30 by firestore.rules
    gameDate: today,
    scoreDate: today,
    challengeId: 1,
    won: true,
    mistakes: 1,
    playPoints: 10,
    mistakesPoints: 8,
    timePoints: 10,
    sharedToFacebook: false,
    sharedWithFriends: false,
    createdAt: serverTimestamp(),
});
```
```
// Rejected (response) if score > 30, userId doesn't match the caller, or the doc ID
// already exists (already scored today) -- a FirebaseError, code 'permission-denied'.
```

### Read today's leaderboard, filtered by game
```js
// Request (src/js/leaderboard/leaderboard-data.js#getGameLeaderboard)
query(
    collection(db, 'gameScores'),
    where('gameType', 'in', ['connections', 'connections-classic', 'connections-tournament']),
    where('scoreDate', '>=', todayStart),
    where('scoreDate', '<=', todayEnd),
);
```
The resulting documents are aggregated **client-side**, per user, into ranked rows — there is no
server-side aggregation endpoint.

## 5. Third-Party APIs Consumed

| API | Used for | Auth | Failure behavior |
|---|---|---|---|
| Firebase Auth REST (via SDK) | Login/signup/session | Firebase project credentials (client config, not secret) | SDK-level errors surfaced as friendly messages (`friendlyAuthErrorMessage()`) |
| Cloud Firestore (via SDK) | All persistent data | Firestore rules | See §3/§4 above |
| Free Dictionary API v2 | Wordle guess validation | None (public API) | **Fails open** — any non-404 error, timeout, or network failure treats the guess as valid, so a flaky third party never blocks play |
| Meta Graph/Pixel endpoints (`connect.facebook.net`, `facebook.com/tr`) | Ad measurement (PageView only) | Pixel ID, not a secret | Not called at all unless the visitor has accepted cookies; no retry/fallback needed since it's fire-and-forget |
| Google Analytics (via Firebase Analytics SDK) | Usage analytics | Firebase project config | Degrades to inactive (not an error) in unsupported environments |

## 6. Rate Limiting & Quotas

No custom rate limiting exists in this system. The only effective limits are:
- **Firestore rules' per-write bounds** (point caps, bounded XP/streak deltas) — these limit the
  *magnitude* of a single write, not the *frequency* of writes.
- **Google's own platform quotas** for Firestore/Auth (not specific to this project, and not
  currently a binding constraint at this project's traffic level).
- **The Free Dictionary API's own, unpublished rate limits** — mitigated only by the fail-open
  behavior above, not by any client-side throttling.

There is no API gateway, no per-user request quota, and no DDoS protection beyond what Firebase
Hosting/Firestore provide by default.
