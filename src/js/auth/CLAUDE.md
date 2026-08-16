# src/js/auth

Three login paths: Guest (Firebase Anonymous Auth), Log In / Sign Up (Firebase email/password Auth, with a username-based UX layered on top). There is no separate login page — the guest/login/signup UI lives inline on the home page (`src/js/pages/home.js`), opened from a modal triggered by the header's Login button. Session is **never** created automatically; a user must explicitly choose Guest or submit Log In/Sign Up.

## Files

- **`auth.js`** — thin business-logic wrapper around Firebase Auth SDK calls: `getSessionUser()` (resolves the existing session or `null`, no auto-anonymous sign-in), `signInAsGuest()`, `signUpWithUsername()`, `loginWithUsername()`, `requestPasswordReset()`, `changePassword()`, `signOutSession()`, and `friendlyAuthErrorMessage()` (maps raw `auth/...` error codes to user-facing copy).
- **`user-profile.js`** — Firestore profile documents layered on top of the Auth session: `createGuestProfile()`/`createRegisteredProfile()` (called once, right after signup), `loadSessionProfile()` (called on every page load, picks `guests`/`registeredUsers` based on `user.isAnonymous`, signs out and throws if banned or the profile doc is missing), `updateRegisteredProfile()`, `isUsernameTaken()`.

## Key design decision: no password hashes in Firestore

Credential login uses Firebase Auth's email/password provider under the hood — a username maps to a synthetic login email (`username@dmc.local`) unless a real email was supplied at signup, in which case that becomes the account's actual Auth email (so Firebase's built-in password-reset email works). **There is no `passwordHash` field anywhere in Firestore.** Storing/comparing password hashes client-side isn't securely possible with no backend server (an unauthenticated client would need to read the hash to verify it, meaning anyone could read every user's hash — and nothing would stop a client from writing `isAdmin: true` onto any account, since there'd be no `request.auth` for Firestore rules to check).

## Data model

- `guests/{uid}` — uid is the Firebase Anonymous Auth uid. `displayName`, `createdAt`, `lastLoginAt`. Guests can't rename themselves, don't earn login points, and have no settings page.
- `registeredUsers/{uid}` — uid is the Firebase Auth uid. `username` (permanent), `displayName`, `email` (optional, separate from the Auth login email), `isAdmin`, `isBanned`, `bannedReason`, `bannedDate`, `loginPoints`, `lastLoginDate`, `currentStreak`.
- `usernames/{usernameLower}` — public `{ uid, authEmail }` mapping, written once at signup, used to resolve a username to its Auth login email at login time.
