# Functional Requirements Specification (FRS)
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | Reflects the system as implemented, as of 2026-08-29 |
| **Product** | Daily Mind Challenge — a free, browser-based daily puzzle site (Wordle, Sudoku, Word Search) |
| **Live domain** | `dailymindchallenge.com` |
| **Related docs** | `docs/architecture.md`, `docs/data-flow.md`, `docs/deployment.md`, `docs/changelog-2026-08.md`, and the `CLAUDE.md` file colocated with almost every source directory |

This document specifies the functional and non-functional requirements of the system **as it
exists today**. It was written retrospectively, from the shipped codebase, rather than before
development — its purpose is to serve as a single reference for what the product does, for anyone
(human or AI assistant) picking up this project without prior context.

---

## 1. Introduction

### 1.1 Purpose
Describe, precisely and testably, what Daily Mind Challenge does — every user-facing feature,
every rule that governs it, and the constraints the system operates under — independent of *how*
each requirement happens to be implemented.

### 1.2 Scope
Covers the public site (three games, leaderboard, accounts, legal/informational pages) and the
admin panel used to operate it. Does not cover deployment mechanics (see `docs/deployment.md`) or
line-level code structure (see the various `CLAUDE.md` files) except where necessary to state a
requirement precisely.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| Guest | A player using the site via Firebase Anonymous Auth, no email/password |
| Registered user | A player with a username + password (Firebase Email/Password Auth under a synthetic or real email) |
| Admin | A registered user with `isAdmin: true` on their profile doc |
| Daily Challenge | The mode common to all three games: one puzzle per day, identical for every player, scored once |
| Classic | Unlimited-replay mode (Sudoku, Word Search only) at a chosen difficulty |
| Tournament | A timed, multi-puzzle/word run with a completion bonus (all three games) |
| `gameScores` | The single Firestore collection holding every scored result, across every game/mode |
| FRS | This document |

### 1.4 References
- `docs/architecture.md` — system architecture and its rationale
- `docs/data-flow.md` — how data moves through the system
- `docs/deployment.md` — hosting/deploy process
- `docs/changelog-2026-08.md` — a chronological log of one development session's decisions
- `firebase/firestore.rules` — the actual server-side enforcement of many requirements below

---

## 2. Overall Description

### 2.1 Product perspective
A static, multi-page site (plain HTML/CSS/JS, no build tooling, no framework) served by Firebase
Hosting, backed entirely by Firebase Authentication and Firestore. There is no application
server — every read/write goes directly from the browser to Firestore, governed by security rules,
not a backend API.

### 2.2 User classes
| Class | Can do | Cannot do |
|---|---|---|
| **Anonymous visitor** (no session) | View the home page, the three game pages' static content, Privacy Policy, Cookie Consent Notice, About & Contact | Play any game, appear on the leaderboard, view Profile/Settings/Admin |
| **Guest** | Play all games/modes, appear on the leaderboard, earn points | Claim the daily login bonus, create a Wordle Challenge, change their display name, access Settings |
| **Registered user** | Everything a Guest can, plus: daily login bonus, create/browse Wordle Challenges, change display name/password/recovery email via Settings | Access the Admin panel |
| **Admin** | Everything a Registered user can except *play* games (blocked deliberately), plus the full Admin panel | — |

### 2.3 Operating environment
Modern desktop and mobile browsers (Chrome, Safari, Firefox, Edge). No native app. Requires
JavaScript (ES modules) and `fetch()`; degrades to non-functional (not partially functional)
without them, by design — there is no server-rendered fallback.

### 2.4 Design constraints
- No backend server and no Cloud Functions — every requirement below that implies "the system
  checks/prevents X" is enforced either client-side (UX-only) or via Firestore security rules
  (actually enforced). Where the distinction matters, it's called out.
- No client-side router — every page is a real, separate `.html` file and a real navigation.
- Firestore reads/writes are one-shot (`getDoc`/`getDocs`), never real-time listeners.

---

## 3. Functional Requirements

### 3.1 Authentication & Account Management

| ID | Requirement |
|---|---|
| FR-1.1 | The system shall let a visitor start playing without registering, as a **Guest**, by choosing a display name. Guest identity persists in the browser via Firebase Anonymous Auth. |
| FR-1.2 | The system shall let a visitor register with a **username**, **display name**, and **password** (min. 8 characters, at least 1 uppercase letter and 1 number). An email address is optional, used only for password recovery. |
| FR-1.3 | The system shall let a registered user log in with their username and password. |
| FR-1.4 | The system shall let a registered user with a recovery email on file reset their password. A username with no real recovery email on file shall be told to contact support instead. |
| FR-1.5 | The system shall reject a username that is already taken, and a display name that contains a blocked word (admin-configurable list). |
| FR-1.6 | The system shall let any logged-in user (guest or registered) log out, with a distinct warning for guests that their identity/progress cannot be recovered afterward. |
| FR-1.7 | The system shall NOT auto-create a guest session on page load — a visitor is anonymous (no session at all) until they explicitly choose Guest or register/log in. |
| FR-1.8 | The system shall grant a registered user (not guests) a one-time-per-day login bonus (admin-configurable point value) the first time they're active each day, and track their consecutive-day streak. |
| FR-1.9 | The system shall let a registered user change their display name and password, and set/change a recovery email, from a Settings page. This page shall not be available to guests. |
| FR-1.10 | The system shall record, per session, whether the current user is a guest or registered, for analytics segmentation purposes (see FR-9). |

### 3.2 Wordle

| ID | Requirement |
|---|---|
| FR-2.1 | **Daily Challenge**: the system shall present one 5-letter target word per calendar day, identical for every player, resolved by a direct date lookup (not a rotating formula), guessed in up to 6 tries. |
| FR-2.2 | The system shall evaluate each guess letter-by-letter as correct (right letter, right position), present (right letter, wrong position), or absent, using duplicate-letter-safe scoring matching the real Wordle rules. |
| FR-2.3 | The system shall validate each non-target guess against a real-word dictionary check before accepting it, without ever blocking the exact target word itself, and without blocking play entirely if the dictionary service is unreachable (fails open). |
| FR-2.4 | The system shall prevent a player from playing the same day's Daily Challenge more than once. |
| FR-2.5 | **Tournaments**: the system shall let a player attempt a named, admin-created sequence of words under a per-word time limit. Failing a word shall reset progress for that run to word 1 (no partial credit banked); the player may retry indefinitely. |
| FR-2.6 | The system shall award Tournament points only once a full run (every word) is completed without failing, as a single lump sum (starting bonus + per-word bonus × word count + an admin-set tournament completion bonus). |
| FR-2.7 | **Challenge a Friend**: the system shall let a registered user create a shareable puzzle from a word of their choosing (validated as a real word), set as public (browsable by anyone) or private (link-only), with an expiration set by admin-configurable days-from-creation. |
| FR-2.8 | The system shall let any player (guest or registered) attempt a Challenge a Friend puzzle exactly once via its link, and shall track and display how many people have attempted/solved it to the challenge's creator. |
| FR-2.9 | The system shall reward a Challenge's creator with points once per distinct solver who attempts their challenge, credited automatically the next time the creator views their own challenges list. |
| FR-2.10 | The system shall show a live stats bar during play with the current attempt count (e.g. "2/6") and, for modes without a time limit, an elapsed-time stopwatch that does not begin counting until the player's first keystroke (not from page load). |
| FR-2.11 | After any Wordle round ends, the system shall offer the player two independent, stackable, one-time share bonuses: "Share with Community" and "Share with Friends," each awarding its own point bonus the first time it's used per result. |

### 3.3 Sudoku

| ID | Requirement |
|---|---|
| FR-3.1 | **Daily Challenge**: the system shall present one 9×9 puzzle per calendar day, identical for every player, resolved by direct date lookup. |
| FR-3.2 | The system shall let a player fill any non-given cell by selecting it and entering a digit 1–9, via either an on-screen number palette or the physical keyboard once a cell is selected; a Clear action shall remove a cell's current value. |
| FR-3.3 | The system shall detect and count an incorrect entry as an error without blocking further play, and shall detect a fully-correct grid as a win. |
| FR-3.4 | The system shall prevent a player from playing the same day's Daily Challenge more than once. |
| FR-3.5 | **Classic**: the system shall let a player choose a difficulty (Easy/Medium/Hard) and receive a random puzzle from that difficulty's admin-seeded pool, replayable without limit. |
| FR-3.6 | **Tournament**: the system shall let a player attempt an admin-created sequence of puzzles under a global (admin-configurable) per-puzzle time limit and max-error count. Failing a puzzle (time-out or too many errors) shall bank a lower point value immediately and advance to the next puzzle — unlike Wordle Tournament, a failure shall NOT reset progress or forfeit the whole run. |
| FR-3.7 | The system shall award a one-time completion bonus (set per tournament by the admin) once every puzzle in the tournament has been attempted, regardless of individual pass/fail outcomes. |
| FR-3.8 | The system shall show a live stats bar (elapsed/remaining time, error count) during play; the Daily/Classic stopwatch shall not begin counting until the player's first cell selection. Tournament's countdown shall begin immediately on mount. |
| FR-3.9 | After any Sudoku round ends, the system shall offer the same two independent, stackable share bonuses described in FR-2.11. |

### 3.4 Word Search

| ID | Requirement |
|---|---|
| FR-4.1 | **Daily Challenge**: the system shall present one word-search grid per calendar day (a fixed word list, grid generated at play time from a seed), identical for every player. |
| FR-4.2 | The system shall let a player select a word by clicking/tapping a letter and dragging in a straight line (horizontal, vertical, or diagonal) to the word's other end, matching the dragged letters against the remaining word list in either direction. |
| FR-4.3 | The system shall visually confirm a correctly-found word and track how many of the puzzle's words remain unfound. |
| FR-4.4 | The system shall prevent a player from playing the same day's Daily Challenge more than once. |
| FR-4.5 | **Classic**: the system shall let a player choose a difficulty (Easy/Medium/Hard, each with its own grid size and word count) and receive a random puzzle from that difficulty's admin-seeded pool, with a freshly randomized grid layout on every replay (not a fixed layout per puzzle). |
| FR-4.6 | **Tournament**: the system shall let a player attempt an admin-created sequence of puzzles under a global (admin-configurable) per-puzzle time limit. Failing a puzzle (time-out) shall bank a lower point value immediately and advance to the next puzzle without resetting the run, same as Sudoku Tournament. |
| FR-4.7 | The system shall award a one-time completion bonus (set per tournament by the admin) once every puzzle has been attempted, and shall show the player a live running score throughout the run, computed from puzzles passed/failed so far. |
| FR-4.8 | The system shall show a live stats bar (words found / total, elapsed/remaining time); the Daily/Classic stopwatch shall not begin counting until the player's first drag gesture. |
| FR-4.9 | After any Word Search round ends, the system shall offer the same two independent, stackable share bonuses described in FR-2.11. |

### 3.5 Points, Scoring, and Anti-Duplication

| ID | Requirement |
|---|---|
| FR-5.1 | The system shall record every scored result as a document in one shared collection, tagged with the game, mode, the scoring player, and the points awarded. |
| FR-5.2 | The system shall prevent a player from being scored twice for the same Daily Challenge attempt on the same day, enforced at the data layer (not just the UI), via a deterministic, collision-proof document identifier per player/game/day. |
| FR-5.3 | The system shall bound the maximum points any single scored write can award, per game/mode, independent of client-reported values, as a fraud-resistance measure (acknowledged as not fully server-authoritative — see `docs/architecture.md`'s security model). |
| FR-5.4 | The system shall record, for every scored result, both a date used for its own identity/replay-gating purposes and a separate, always-real calendar date used purely for leaderboard period bucketing — so a Tournament/Classic/Challenge result (whose own "date" field may be repurposed as a non-date key) still counts toward Today/Week/Month/Year leaderboard totals correctly. |

### 3.6 Leaderboard

| ID | Requirement |
|---|---|
| FR-6.1 | The system shall show a ranked leaderboard of total points, filterable by game (Overall/Wordle/Sudoku/Word Search) and by period (Today/Week/Month/Year/All-time). |
| FR-6.2 | The system shall show each player's display name, guest/registered status, and rank; guest identities shall be distinguishable from registered ones. |
| FR-6.3 | The system shall load the leaderboard incrementally (a configurable page size, "Load More" to reveal further rows) rather than one unbounded query. |
| FR-6.4 | The home page shall show a compact preview of the current top players, linking to the full leaderboard. |

### 3.7 Profile

| ID | Requirement |
|---|---|
| FR-7.1 | The system shall show a player's own lifetime stats: total points (login bonuses + summed game scores), current day streak, and games played. |
| FR-7.2 | The system shall show a player's recent game history. |
| FR-7.3 | Guests shall be able to view their own profile but not rename themselves there (name changes are a Settings feature, registered-only). |

### 3.8 Admin Panel

| ID | Requirement |
|---|---|
| FR-8.1 | The system shall restrict the Admin panel to users flagged `isAdmin`; a non-admin visiting it shall see an access-denied state, not the panel. |
| FR-8.2 | Admin accounts shall be blocked from *playing* any game (a deliberate content-integrity rule — an admin cannot inflate their own leaderboard standing by seeding puzzles they then play). |
| FR-8.3 | **Daily Activity Summary**: the system shall show, for an admin-selected date, the count of logged-in users (split guest/registered) and total plays, broken down per game and per mode (Guest/Registered/Total each). |
| FR-8.4 | **Platform configuration**: the system shall let an admin edit, without a code deploy: the daily login reward amount, list-page sizes (Challenges/Leaderboard/Attempts), the cookie-consent-banner on/off toggle, the word-validation dictionary endpoint, and the blocked-word list. |
| FR-8.5 | **Content management (per game)**: the system shall let an admin add, edit, and bulk-import (CSV/text file) Daily Challenge content (Wordle words; Sudoku puzzle+solution pairs; Word Search word lists), each keyed to a specific future calendar date assigned automatically in sequence from either an admin-chosen launch date (the very first entry) or the day after the previous entry. |
| FR-8.6 | The system shall reject a Daily-content import or single add that duplicates an entry already in that game's pool, or that repeats within the same uploaded file, without writing any part of a rejected bulk import. |
| FR-8.7 | The system shall let an admin export a game's current Daily-content pool as a CSV file, in a format that can be re-imported unchanged. |
| FR-8.8 | The system shall present a large Daily-content pool grouped by year and then month (both independently collapsible), collapsed by default, rather than one long flat list. |
| FR-8.9 | **Classic content management** (Sudoku, Word Search): the system shall let an admin add, edit, bulk-import, and export Classic puzzles for each of the three difficulties, sharing one content pool per game across all difficulties. Duplicate detection (FR-8.6) shall be scoped per difficulty — the same content may legitimately exist in two different difficulties' pools. |
| FR-8.10 | The system shall display a game's Classic content grouped by difficulty (Easy/Medium/Hard). |
| FR-8.11 | **Tournament management** (all three games): the system shall let an admin create a named tournament (a sequence of puzzles/words plus a completion bonus), activate/deactivate it without deleting its data or players' history, and delete it. |
| FR-8.12 | **Moderation**: the system shall let an admin look up a user by username and toggle their banned/admin status. |
| FR-8.13 | **Advertising configuration**: the system shall let an admin enable/disable, and optionally replace with a custom image+link, each of the site's defined ad placement slots (home page and per-game top/bottom slots), without a code deploy. |
| FR-8.14 | The system shall let an admin turn the visitor-facing cookie-consent banner on or off sitewide (see FR-10.4). |

### 3.9 Legal, Informational & Consent

| ID | Requirement |
|---|---|
| FR-9.1 | The system shall publish a Privacy Policy page describing what data is collected (per account type), how it's used, third-party services involved, and how to contact the site operator. |
| FR-9.2 | The system shall publish a Cookie Consent Notice page describing the categories of cookies/similar technologies used (essential, analytics, advertising) and how a visitor can manage them via their browser. |
| FR-9.3 | The system shall publish an About & Contact page identifying the product (without disclosing the operator's personal identity) and a way to reach the site operator that does not expose a personal email address. |
| FR-9.4 | These three pages, and the three game pages' own static descriptive content, shall be viewable by a visitor with no session at all (not gated behind login), so that search engines and ad-network reviewers can index real content. |
| FR-9.5 | The system shall present an Accept/Decline cookie-consent banner to a first-time visitor (when enabled, see FR-8.14), and shall remember that visitor's choice in their own browser without requiring an account. |
| FR-9.6 | Declining consent shall signal restricted use of analytics/advertising data to the site's analytics provider; this signal shall be re-applied automatically on every subsequent page the visitor loads, without re-showing the banner, until/unless the stored choice is cleared (e.g. by clearing browser storage). |

### 3.10 Analytics

| ID | Requirement |
|---|---|
| FR-10.1 | The system shall record standard page-view analytics for every page load. |
| FR-10.2 | The system shall tag each analytics session with whether the visitor is a guest or a registered user, so usage can be segmented by account type. |
| FR-10.3 | Analytics collection shall degrade gracefully (no error, simply inactive) in environments where the underlying analytics SDK is unsupported. |

### 3.11 Advertising

| ID | Requirement |
|---|---|
| FR-11.1 | The system shall reserve defined ad placement slots on the home page (3) and each game page (2: top and bottom of the game). |
| FR-11.2 | Each slot's visibility and content shall be controllable per-slot by an admin (FR-8.13) without a code deploy. |

---

## 4. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | Every read is a one-shot Firestore query; the system does not use real-time listeners, trading live-updating UI for lower baseline connection overhead. |
| NFR-2 | Performance | Long lists (leaderboard, challenge browsing, attempt history) shall load incrementally, not as one unbounded query. |
| NFR-3 | Security | All data-modifying operations shall be scoped to the authenticated user's own UID at the Firestore rules layer; a client can never write another user's account document. |
| NFR-4 | Security | Admin-only operations (moderation, content seeding, config edits) shall be enforced by Firestore rules checking an `isAdmin` flag server-side, not merely hidden in the UI. |
| NFR-5 | Security | The scoring model is explicitly **not** fully server-authoritative (no Cloud Functions re-verify gameplay); protection is limited to per-write point caps and replay-proof document identifiers. This is a documented, accepted tradeoff, not an oversight. |
| NFR-6 | Availability | The system shall have no single backend server to go down — availability is bounded by Firebase Hosting/Auth/Firestore's own SLAs. |
| NFR-7 | Compatibility | The system shall function on current versions of Chrome, Safari, Firefox, and Edge, on both desktop and mobile, without a native app. |
| NFR-8 | Accessibility/UX | Decorative content (illustrative mini-previews, icons) shall be marked non-interactive and hidden from assistive technology where it duplicates adjacent real content. |
| NFR-9 | SEO/Discoverability | Every publicly-relevant page shall declare a real meta description and canonical URL pointing at the live production domain. |
| NFR-10 | Privacy | No personal contact information belonging to the site operator shall be exposed publicly; a dedicated, non-personal contact channel shall be used instead. |
| NFR-11 | Maintainability | The system shall require no build step — every shipped file is exactly what a browser/editor sees, with no compiled/bundled intermediate artifact to keep in sync. |
| NFR-12 | Portability | Ad placement and platform configuration values shall be editable via the admin panel, not hardcoded, so operational changes don't require a code deploy. |

---

## 5. Data Overview

The system's Firestore data model is described in full in `docs/data-flow.md` and the various
`CLAUDE.md` files under `src/js/`; summarized here only to the extent it clarifies the functional
requirements above:

- **Account data**: separate collections for guest and registered profiles, plus a
  username-to-email lookup collection enabling username-based login on top of Firebase's
  email/password provider.
- **`gameScores`**: one shared collection for every scored result across all games/modes, keyed by
  a deterministic, collision-proof document ID per scoring event (see FR-5.2).
- **Per-game content collections**: Daily pools (date-keyed), Classic pools (numeric-id-keyed,
  shared across difficulties), Tournament definitions, and Tournament attempt-progress documents —
  one collection family per game, structurally parallel across all three.
- **`config`**: a small collection of admin-editable platform settings (see FR-8.4), each
  document independently readable by anyone, writable only by admins.

---

## 6. Assumptions and Constraints

- The system assumes a Firebase project already exists with Anonymous and Email/Password
  Authentication enabled, a Firestore database provisioned, and `firebase/firestore.rules`/
  `firebase/firestore.indexes.json` published — see `docs/deployment.md`.
- The system assumes it is served from its domain's root (root-relative asset paths throughout);
  it is not designed to be served from a subpath.
- The system assumes JavaScript execution and modern ES module support in the visitor's browser;
  there is no non-JS fallback experience.
- Monetization (Google AdSense) is assumed to be pending/not-yet-approved as of this document's
  writing — the ad-slot system (FR-11) currently serves admin-managed placeholder/image ads, not
  live AdSense units; see `docs/changelog-2026-08.md` §8 for the readiness work already completed
  toward requesting approval.

---

## 7. Glossary

See §1.3 for core terms. Additional game-specific and admin-specific terminology is defined inline
within each source directory's own `CLAUDE.md` (e.g. "given cell," "puzzle signature," "word set
signature") where a term's precise meaning affects correctness and is worth preserving alongside
the code it describes rather than duplicated here.
