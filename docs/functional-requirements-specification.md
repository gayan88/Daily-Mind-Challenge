# Software Requirements Specification (SRS)
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | Reflects the system as implemented, as of 2026-10-17. Supersedes the 2026-09-20 FRS baseline — adds Connections (the fourth game) and Quilt (the fifth, 2026-10-18), the retuned XP/Rank curve, the Meta Pixel integration, the cookie-consent reliability fixes, and the Google/Bing Search Console setup. |
| **Product** | Daily Mind Challenge — a free, browser-based daily puzzle site (Wordle, Sudoku, Word Search, Connections, Quilt) |
| **Live domain** | `dailymindchallenge.com` |
| **Related docs** | `docs/solution-architecture-document.md` (formerly architecture.md), `docs/database-design-document.md`, `docs/api-documentation.md`, `docs/technical-design-document.md`, `docs/data-flow.md`, `docs/deployment-and-release-document.md`, and the `CLAUDE.md` file colocated with almost every source directory |

This document specifies the functional and non-functional requirements of the system **as it
exists today**. It was written retrospectively, from the shipped codebase, rather than before
development — its purpose is to serve as a single reference for what the product does, for anyone
(human or AI assistant) picking up this project without prior context. This is also this
project's **Software Requirements Specification (SRS)** in the formal sense: it covers functional
requirements, non-functional requirements, use cases, validation rules, error handling, and
acceptance criteria.

---

## 1. Introduction

### 1.1 Purpose
Describe, precisely and testably, what Daily Mind Challenge does — every user-facing feature,
every rule that governs it, and the constraints the system operates under — independent of *how*
each requirement happens to be implemented.

### 1.2 Scope
Covers the public site (five games, leaderboard, accounts, legal/informational pages), the admin
panel used to operate it, and the third-party integrations that affect user-visible behavior
(analytics, advertising, Meta Pixel, cookie consent). Does not cover deployment mechanics (see
`docs/deployment-and-release-document.md`) or line-level code structure (see the various
`CLAUDE.md` files) except where necessary to state a requirement precisely.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| Guest | A player using the site via Firebase Anonymous Auth, no email/password |
| Registered user | A player with a username + password (Firebase Email/Password Auth under a synthetic or real email) |
| Admin | A registered user with `isAdmin: true` on their profile doc |
| Daily Challenge | The mode common to all five games: one puzzle per day, identical for every player, scored once |
| Classic | Unlimited-replay mode (Sudoku, Word Search, Connections, Quilt) at a chosen difficulty |
| Tournament | A timed, multi-puzzle/word run with a completion bonus (all five games; Quilt's is called Patchwork Run) |
| `gameScores` | The single Firestore collection holding every scored result, across every game/mode |
| Points | A per-game, per-player currency earned by playing; drives the leaderboard and per-game Level |
| XP | A separate, site-wide, registered-only currency; drives Overall Level and Rank |
| SRS | This document |

### 1.4 References
- `docs/solution-architecture-document.md` — system architecture and its rationale
- `docs/database-design-document.md` — Firestore collection schemas
- `docs/api-documentation.md` — the Firestore "API" surface (no custom REST backend)
- `docs/data-flow.md` — how data moves through the system, by scenario
- `docs/deployment-and-release-document.md` — hosting/deploy process
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
| **Anonymous visitor** (no session) | View the home page, the five game pages' static content and FAQs, the public Leaderboard (and open player profile popups), Privacy Policy, Terms of Service, Cookie Consent Notice, About & Contact | Play any game, appear on the leaderboard, view Profile/Settings/Admin |
| **Guest** | Play all games/modes, appear on the leaderboard, earn points | Claim the daily login bonus, create a Wordle Challenge, change their display name, access Settings, earn XP/Rank/Achievements |
| **Registered user** | Everything a Guest can, plus: daily login bonus, create/browse Wordle Challenges, change display name/password/recovery email via Settings, earn XP/Rank/Streak/Achievements | Access the Admin panel |
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
- No automated test suite (see §8, Validation & Testing Approach, and `docs/test-plan-and-test-cases.md`).

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
| FR-1.10 | The system shall record, per session, whether the current user is a guest or registered, for analytics segmentation purposes (see FR-10). |

### 3.2 Wordle

| ID | Requirement |
|---|---|
| FR-2.1 | **Daily Challenge**: the system shall present one 5-letter target word per calendar day, identical for every player, resolved by a direct date lookup (not a rotating formula), guessed in up to 6 tries. |
| FR-2.2 | The system shall evaluate each guess letter-by-letter as correct (right letter, right position), present (right letter, wrong position), or absent, using duplicate-letter-safe scoring matching the real Wordle rules. |
| FR-2.3 | The system shall validate each non-target guess against a real-word dictionary check before accepting it, without ever blocking the exact target word itself, and without blocking play entirely if the dictionary service is unreachable (fails open). |
| FR-2.4 | Once a player has **solved** the day's Daily Challenge, the system shall prevent replaying it until the next calendar day. A failed attempt (6 misses) shall not reveal the word, shall earn no points/XP/streak, and shall allow a retry of the same word after a 1-hour cooldown (live countdown shown), repeatable until solved or the day ends. Attempt state is tracked in `wordleDailyAttempts`; only a win writes a `gameScores` doc. |
| FR-2.5 | **Tournaments**: the system shall let a player attempt a named, admin-created sequence of words under a per-word time limit. Failing a word shall reset progress for that run to word 1 (no partial credit banked); the player may retry indefinitely. |
| FR-2.6 | The system shall award Tournament points only once a full run (every word) is completed without failing, as a single lump sum (starting bonus + per-word bonus × word count + an admin-set tournament completion bonus). |
| FR-2.7 | **Challenge a Friend**: the system shall let a registered user create a shareable puzzle from a word of their choosing (validated as a real word), set as public (browsable by anyone) or private (link-only), with an expiration set by admin-configurable days-from-creation. |
| FR-2.8 | The system shall let any player (guest or registered) attempt a Challenge a Friend puzzle exactly once via its link, and shall track and display how many people have attempted/solved it to the challenge's creator. |
| FR-2.9 | The system shall reward a Challenge's creator with points once per distinct solver who attempts their challenge, credited automatically the next time the creator views their own challenges list. |
| FR-2.10 | The system shall show a live stats bar during play with the current attempt count (e.g. "2/6") and, for modes without a time limit, an elapsed-time stopwatch that does not begin counting until the player's first keystroke (not from page load). |
| FR-2.11 | After any Wordle round ends, the system shall offer the player two independent, stackable, one-time share bonuses: "Share with Community" (+20) and "Share with Friends" (+10), each awarding its own point bonus the first time it's used per result. |

### 3.3 Sudoku

| ID | Requirement |
|---|---|
| FR-3.1 | **Daily Challenge**: the system shall present one 9×9 puzzle per calendar day, identical for every player, resolved by direct date lookup. |
| FR-3.2 | The system shall let a player fill any non-given cell by selecting it and entering a digit 1–9, via either an on-screen number palette or the physical keyboard once a cell is selected; a Clear action shall remove a cell's current value. |
| FR-3.3 | The system shall detect and count an incorrect entry as an error without blocking further play, and shall detect a fully-correct grid as a win. |
| FR-3.4 | The system shall prevent a player from playing the same day's Daily Challenge more than once. |
| FR-3.5 | **Classic**: the system shall let a player choose a difficulty (Easy/Medium/Hard) and receive a random puzzle from that difficulty's admin-seeded pool, replayable without limit. |
| FR-3.6 | **Tournament**: the system shall let a player attempt an admin-created sequence of puzzles under a global (admin-configurable) per-puzzle time limit and max-error count. Failing a puzzle (time-out or too many errors) shall bank a lower point value immediately and advance to the next puzzle — unlike Wordle/Connections Tournaments, a failure shall NOT reset progress or forfeit the whole run. |
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

### 3.5 Connections

| ID | Requirement |
|---|---|
| FR-5.1 | **Daily Challenge**: the system shall present one 16-word grid per calendar day, identical for every player, grouped into 4 hidden groups of 4 ordered easiest-to-hardest (yellow/green/blue/purple). |
| FR-5.2 | The system shall let a player select exactly 4 words and submit them as a guess; a guess matching one of the 4 hidden groups exactly shall reveal that group (with its name and color) and remove its words from the grid. A guess 3-of-4 correct shall tell the player "One away!" without costing an extra mistake beyond the standard one. |
| FR-5.3 | The system shall count an incorrect guess as one of 4 allowed mistakes; reaching 4 mistakes shall end the round as a loss. A guess identical to a previously-submitted incorrect guess shall be rejected without consuming a mistake. |
| FR-5.4 | The system shall let a player shuffle the remaining grid's layout and deselect their current selection at any time, at no cost. |
| FR-5.5 | Once a player has **solved** the day's Daily Challenge, the system shall prevent replaying it until the next calendar day. A failed attempt (4 mistakes) shall not reveal the groups, shall earn no points/XP/streak, and shall allow a retry (freshly reshuffled) after a 1-hour cooldown, repeatable until solved or the day ends — the same model as Wordle's Daily Challenge (FR-2.4). |
| FR-5.6 | **Classic**: the system shall let a player choose a difficulty (Easy/Medium/Hard) and receive a random puzzle from that difficulty's admin-seeded pool, excluding the puzzle they just played where an alternative exists, replayable without limit. |
| FR-5.7 | **Tournament**: the system shall let a player attempt a named, admin-created sequence of puzzles under a per-puzzle time limit. Failing a puzzle shall reset progress for that run to puzzle 1 (no partial credit banked) — the same high-stakes shape as Wordle Tournament (FR-2.5), unlike Sudoku/Word Search Tournaments. |
| FR-5.8 | The system shall award Tournament points only once a full run is completed without failing, as a single lump sum (30 + 15 × puzzle count + an admin-set completion bonus). |
| FR-5.9 | The system shall show a live stats bar (mistakes used / 4, elapsed/remaining time); the Daily/Classic stopwatch shall not begin counting until the player's first tile selection. |
| FR-5.10 | After any Connections round ends, the system shall offer the same two independent, stackable share bonuses described in FR-2.11. |

### 3.5a Quilt

Numbered 3.5a so existing requirement ids don't shift. Plan and decisions: `docs/quilt-development-plan.md`.

| ID | Requirement |
|---|---|
| FR-5a.1 | The system shall present a Shikaku-style grid of numbers that the player divides into rectangles by dragging corner to corner (mouse, touch or pen); each rectangle must contain exactly one number equal to its area, rectangles may not overlap, and every cell (except Hard-mode knots) must be covered. Tapping a rectangle removes it; Undo and Clear are available. |
| FR-5a.2 | The system shall outline in red, immediately, any rectangle that breaks a rule (no number, several numbers, wrong area, wrong shape). |
| FR-5a.3 | The system shall keep placed rectangles in neutral colours during play and reveal the hidden pixel-art picture (each rectangle in its real colour) only when the board is solved, so colour never reveals a wrong rectangle. |
| FR-5a.4 | Every stored puzzle shall have exactly one solution, proven by the solver when the admin adds it. |
| FR-5a.5 | **Daily Challenge**: one shared picture per calendar day, one scored solve per day, no loss condition. Points: 10 + speed bonus (≤3 min 10, ≤5 min 8, ≤10 min 6, else 5) + 5 for a Perfect Stitch (no undo and no removed rectangle). The Daily share text shall show stats only, never the picture. |
| FR-5a.6 | **Classic**: Easy 7×7 / Medium 10×10 / Hard 14×14, unlimited replays, pictures the player hasn't solved served first. Points: the Daily formula × 0.8 / 1.0 / 1.3. Hard puzzles have knots (cells no rectangle may cover) and shape clues (square / single row-or-column). |
| FR-5a.7 | **Patchwork Run** (Tournament): an admin-built run of one picture cut into 4, 6 or 9 tiles, each solved under a global per-tile time limit. A tile that times out banks 10 points (30 if solved) and the run continues; progress is shown as a mosaic. Completing every tile awards the run's completion bonus, plus 25 for a Perfect Patchwork (every tile solved). |
| FR-5a.8 | The stopwatch (Daily/Classic) shall start on the first touch of the board; the Tournament countdown starts on mount. On mount the round scrolls fully into view, since the board blocks touch scrolling. |
| FR-5a.9 | After any Quilt round the system shall offer the same two independent share bonuses as FR-2.11; Classic and Patchwork Run share text include the picture as an emoji mosaic. |
| FR-5a.10 | Admins shall add Quilt content as pictures (PNG at 1 pixel per cell, or text), preview every generated puzzle with errors and warnings before saving, and build Patchwork Runs from one picture with a tile-cut preview. |

### 3.6 Points, Scoring, and Anti-Duplication

| ID | Requirement |
|---|---|
| FR-6.1 | The system shall record every scored result as a document in one shared collection (`gameScores`), tagged with the game, mode, the scoring player, and the points awarded. |
| FR-6.2 | The system shall prevent a player from being scored twice for the same Daily Challenge attempt on the same day, enforced at the data layer (not just the UI), via a deterministic, collision-proof document identifier per player/game/day. |
| FR-6.3 | The system shall bound the maximum points any single scored write can award, per game/mode, independent of client-reported values, as a fraud-resistance measure (acknowledged as not fully server-authoritative — see `docs/solution-architecture-document.md`'s security model). |
| FR-6.4 | The system shall record, for every scored result, both a date used for its own identity/replay-gating purposes and a separate, always-real calendar date used purely for leaderboard period bucketing — so a Tournament/Classic/Challenge result (whose own "date" field may be repurposed as a non-date key) still counts toward Today/Week/Month/Year leaderboard totals correctly. |

### 3.7 Leaderboard

| ID | Requirement |
|---|---|
| FR-7.1 | The system shall show a ranked leaderboard of total points, filterable by game (Overall/Wordle/Sudoku/Word Search/Connections/Quilt) and by period (Today/Week/Month/Year/All-time), presented as two dropdown selectors (Game, Period) rather than a row of tab buttons, so the control set scales past the current five games without crowding. |
| FR-7.2 | The system shall show each player's display name, guest/registered status, and rank; guest identities shall be distinguishable from registered ones. |
| FR-7.3 | The system shall load the leaderboard incrementally (a configurable page size, "Load More" to reveal further rows) rather than one unbounded query. |
| FR-7.4 | The home page shall show a compact preview of the current top players, linking to the full leaderboard. |
| FR-7.5 | The leaderboard shall be viewable without a session. Each row shall show the player's sub-rank avatar (Guest badge for guests) and be clickable, opening a profile popup with name, rank (background in that rank's color), total points/XP, global rank, day streak, Overall Level progress, and earned achievement badges (registered players only; guests get a note). |

### 3.8 Profile

| ID | Requirement |
|---|---|
| FR-8.1 | The system shall show a player's own lifetime stats: total points (login bonuses + summed game scores), current day streak, and games played. |
| FR-8.2 | The system shall show a player's recent game history. |
| FR-8.3 | Guests shall be able to view their own profile but not rename themselves there (name changes are a Settings feature, registered-only). |

### 3.9 Admin Panel

| ID | Requirement |
|---|---|
| FR-9.1 | The system shall restrict the Admin panel to users flagged `isAdmin`; a non-admin visiting it shall see an access-denied state, not the panel. |
| FR-9.2 | Admin accounts shall be blocked from *playing* any game (a deliberate content-integrity rule — an admin cannot inflate their own leaderboard standing by seeding puzzles they then play). |
| FR-9.3 | **Daily Activity Summary**: the system shall show, for an admin-selected date, the count of logged-in users (split guest/registered) and total plays, broken down per game and per mode (Guest/Registered/Total each), across all five games. |
| FR-9.4 | **Platform configuration**: the system shall let an admin edit, without a code deploy: the daily login reward amount, list-page sizes (Challenges/Leaderboard/Attempts), the cookie-consent-banner on/off toggle, the word-validation dictionary endpoint, and the blocked-word list. |
| FR-9.5 | **Content management (per game)**: the system shall let an admin add, edit, and bulk-import (pasted text or file) Daily Challenge content for every game (Wordle words; Sudoku puzzle+solution pairs; Word Search word lists; Connections 4×4 word groups; Quilt pictures, each turned into a uniquely solvable puzzle on import), each keyed to a specific future calendar date assigned automatically in sequence from either an admin-chosen launch date (the very first entry) or the day after the previous entry. |
| FR-9.6 | The system shall reject a Daily-content import or single add that duplicates an entry already in that game's pool, or that repeats within the same uploaded batch, without writing any part of a rejected bulk import. |
| FR-9.7 | The system shall let an admin export a game's current Daily-content pool as a file, in a format that can be re-imported unchanged. |
| FR-9.8 | The system shall present a large Daily-content pool grouped by year and then month (both independently collapsible), collapsed by default, rather than one long flat list. |
| FR-9.9 | **Classic content management** (Sudoku, Word Search, Connections): the system shall let an admin add, edit, bulk-import, and export Classic puzzles for each of the three difficulties, sharing one content pool per game across all difficulties. Duplicate detection (FR-9.6) shall be scoped per difficulty — the same content may legitimately exist in two different difficulties' pools. |
| FR-9.10 | The system shall display a game's Classic content grouped by difficulty (Easy/Medium/Hard). |
| FR-9.11 | **Tournament management** (all five games; Quilt's Patchwork Runs can also be bulk-imported, one run per picture): the system shall let an admin create a named tournament (a sequence of puzzles/words plus a completion bonus), activate/deactivate it without deleting its data or players' history, and delete it. |
| FR-9.12 | **Moderation**: the system shall let an admin look up a user by username and toggle their banned/admin status. |
| FR-9.13 | **Advertising configuration**: the system shall let an admin enable/disable, and optionally replace with a custom image+link, each of the site's defined ad placement slots (home page and per-game top/bottom slots, across all five games), without a code deploy. |
| FR-9.14 | The system shall let an admin turn the visitor-facing cookie-consent banner on or off sitewide (see FR-11.5). |

### 3.10 Progression: XP, Level, Rank, Achievements

| ID | Requirement |
|---|---|
| FR-10.1 | Registered players shall earn global XP (login = 5, Daily Challenge completion = 10, perfect-day bonus = 20, a share action = 5, and +250 per unlocked achievement). Guests earn Points but no XP/Rank/Achievements/Streak. |
| FR-10.2 | Overall Level shall equal `floor(XP / 1,000)`, displayed starting at Level 1 (0 XP = "Level 1"), always derived from XP at display time, never stored independently. |
| FR-10.3 | Rank shall have 10 main tiers (Novice through Legend), each split into 10 sub-ranks (Roman numerals I–X). Each tier's sub-rank XP width shall grow by a fixed amount per tier (500 XP for Novice, increasing by 500 per tier up to 5,000 XP for Legend), for a total of 275,000 XP across the full climb. Rank shall cap permanently at Legend X once 275,000 XP is reached; there is no 11th tier. A player holds a sub-rank as soon as its band is entered — Novice I is free at 0 XP, with no "unranked" state below it. |
| FR-10.4 | "Perfect Day" (completed and won every Daily Challenge in one calendar day) and "Daily Mind Champion" (completed every Daily Challenge, any outcome) shall require all five games, not a fixed count — these requirements track `checkPlayedTodayAll()`'s actual game set and shall be updated whenever a game is added or removed. |
| FR-10.5 | The system shall define a set of achievements (85 as of this document's writing) spanning per-game Level tiers, Daily/Weekly/Monthly Championship win-count tiers, streak milestones, and global milestones, each with custom badge art. Only the next unearned tier of a tiered family shall show as In Progress; later tiers show Not Started. |
| FR-10.6 | Daily/Weekly/Monthly Championships (top scorer per game per period) shall be finalized by an admin action and claimed by the winner on their next profile visit. |
| FR-10.7 | One Daily Mission ("Play 3 Different Games") shall require only 3 of the 4 available games, not all of them — a deliberately lower bar than "Daily Mind Champion," unaffected by adding further games. |

### 3.11 Legal, Informational & Consent

| ID | Requirement |
|---|---|
| FR-11.1 | The system shall publish a Privacy Policy page describing what data is collected (per account type), how it's used, third-party services involved (Google Analytics, Google AdSense, Meta Pixel), and how to contact the site operator. |
| FR-11.2 | The system shall publish a Cookie Consent Notice page describing the categories of cookies/similar technologies used (essential, analytics, advertising, Meta Pixel) and how a visitor can manage or change their choice. |
| FR-11.3 | The system shall publish an About & Contact page identifying the product (without disclosing the operator's personal identity) and a way to reach the site operator that does not expose a personal email address. |
| FR-11.4 | The system shall publish a Terms of Service page (eligibility, accounts, acceptable use, virtual points with no cash value, no purchases, advertising, disclaimers), linked from the footer. |
| FR-11.5 | These pages, and the five game pages' own static descriptive content, shall be viewable by a visitor with no session at all (not gated behind login), so that search engines and ad-network reviewers can index real content. |
| FR-11.6 | The system shall present an Accept/Decline cookie-consent banner to a first-time visitor (when enabled, see FR-9.14). The banner shall not depend on a database read completing before it can show: it shall default to showing (enabled) if the admin-configured setting hasn't loaded within 1.5 seconds. |
| FR-11.7 | The banner shall render at most once per page load regardless of how many times the page's own startup code requests it, so a visitor is never asked to accept/decline more than once for a single page view. |
| FR-11.8 | Declining consent shall signal restricted use of Google Analytics/advertising data via Google Consent Mode, and shall prevent the Meta Pixel from loading at all. Accepting shall load the Meta Pixel and record a PageView. This signal/choice shall be re-applied automatically on every subsequent page the visitor loads, without re-showing the banner, until/unless the stored choice is cleared (e.g. by clearing browser storage). |

### 3.12 Analytics

| ID | Requirement |
|---|---|
| FR-12.1 | The system shall record standard page-view analytics for every page load via Google Analytics (Firebase Analytics SDK). |
| FR-12.2 | The system shall tag each analytics session with whether the visitor is a guest or a registered user, so usage can be segmented by account type. |
| FR-12.3 | Analytics collection shall degrade gracefully (no error, simply inactive) in environments where the underlying analytics SDK is unsupported. |
| FR-12.4 | The system shall load the Meta Pixel (`fbq`) and record a `PageView` event only for visitors who have accepted cookies; it shall never load for a visitor who has declined or not yet chosen. |

### 3.13 Advertising

| ID | Requirement |
|---|---|
| FR-13.1 | The system shall reserve defined ad placement slots on the home page (3) and each game page (2: top and bottom of the game), across all five games (13 slots). |
| FR-13.2 | Each slot's visibility and content shall be controllable per-slot by an admin (FR-9.13) without a code deploy. |

### 3.14 SEO & Discoverability

| ID | Requirement |
|---|---|
| FR-14.1 | Every publicly-crawlable page shall declare a `<meta name="description">` and a `<link rel="canonical">` pointing at the production domain `dailymindchallenge.com`. |
| FR-14.2 | The system shall publish a `sitemap.xml` listing every public page, referenced from `robots.txt`. |
| FR-14.3 | The system shall serve static, unchanging verification files required by search engine webmaster tools (Google Search Console, Bing Webmaster Tools) at their exact expected URL, with no redirect, for as long as that verification remains in effect. |

---

## 4. Use Cases

### UC-1: Guest plays today's Daily Challenge
**Actor:** Anonymous visitor
**Preconditions:** None
**Main flow:**
1. Visitor lands on the home page and selects "Continue as Guest," entering a display name.
2. Visitor opens a game page (e.g. `/connections`) and its Daily Challenge tab.
3. System checks whether this guest has already scored today's Daily Challenge for this game; if not, mounts the puzzle.
4. Guest plays to a win or a loss.
5. On a win, system records the score, shows the results popup with the points breakdown, and offers share bonuses.
**Alternate flow (loss, Wordle/Connections):** System shows a retry countdown instead of the answer; no score is recorded.
**Postconditions:** A `gameScores` document exists for this guest/game/day (win only, for Wordle/Connections).

### UC-2: Registered player climbs Rank
**Actor:** Registered user
**Preconditions:** Account exists and is not banned.
**Main flow:**
1. Player logs in, triggering the daily login bonus (if not already claimed today) and 5 XP.
2. Player completes one or more Daily Challenges, each awarding 10 XP.
3. If this is the last of all five Daily Challenges completed today, the player receives a one-time 20 XP "Perfect Day" bonus.
4. Player visits their Profile page; Overall Level and Rank are recomputed from the player's current total XP and displayed.
**Postconditions:** `registeredUsers/{uid}.xp` reflects all awarded XP; the profile shows the correct Rank/sub-rank for that total.

### UC-3: Admin seeds a new Daily Challenge pool
**Actor:** Admin
**Preconditions:** Logged in with `isAdmin: true`.
**Main flow:**
1. Admin opens `/admin`, expands the relevant game's section.
2. Admin pastes or uploads a batch of puzzles in that game's expected format.
3. System validates every entry (format, no duplicates within the batch or against the existing pool) before writing anything.
4. On success, system assigns each new entry the next sequential calendar date and writes them all.
**Alternate flow:** Any entry fails validation → the entire batch is rejected, nothing is written, and the admin sees which entry failed.
**Postconditions:** The game's Daily pool is extended by N puzzles, each dated correctly, with no gaps or duplicates.

### UC-4: Visitor declines cookies
**Actor:** Anonymous visitor
**Preconditions:** First visit to the site in this browser (no stored consent choice).
**Main flow:**
1. Visitor loads any page; the cookie banner appears within at most 1.5 seconds.
2. Visitor clicks **Decline**.
3. System stores the choice, signals Google Consent Mode as denied, and does not load the Meta Pixel.
**Postconditions:** No Meta Pixel script is ever requested in this browser. Google Analytics requests continue, flagged as consent-denied.

### UC-5: Admin finalizes a Championship period
**Actor:** Admin
**Preconditions:** A Daily/Weekly/Monthly period has closed and is past its safe-to-finalize instant (12 hours past that period's close in UTC).
**Main flow:**
1. Admin opens the "Manual Executions" admin section and sees the period listed as ready.
2. Admin clicks Finalize (or "Run All Eligible" for every ready period at once).
3. System computes the top-scoring registered player for that game/period and writes a `periodResults` document.
**Postconditions:** The period has a permanent result; the winner can claim their Championship achievement on their next profile visit.

---

## 5. Validation Rules

| Area | Rule |
|---|---|
| Username | Must be unique (case-insensitive); checked against the `usernames` collection before account creation. |
| Password | Minimum 8 characters, at least 1 uppercase letter, at least 1 number. |
| Display name | Checked against an admin-configurable blocked-word list; rejected if it matches. |
| Wordle guess | Exactly 5 letters, A–Z only; non-target guesses also checked against a live dictionary API (fails open on error). |
| Connections guess | Exactly 4 selected words; a guess identical to a prior incorrect guess in the same round is rejected without cost. |
| Sudoku cell entry | A single digit 1–9; given (pre-filled) cells cannot be edited. |
| Admin puzzle import (all games) | Every entry must match that game's exact content shape (e.g. Connections: 4 groups × 4 words, all 16 unique, ≤14 characters each); no duplicate within the batch or against the existing pool, checked before any write. |
| `gameScores` write | `userId` must equal the authenticated caller's own UID; document ID must match the deterministic `{uid}_{gameType}_{date}` pattern; `score` must be ≥ 0 and ≤ that gameType's configured cap — all enforced in `firebase/firestore.rules`, not just client-side. |
| Admin-only writes | `isAdmin: true` on the caller's own profile doc, checked server-side via Firestore rules for every content-seeding, moderation, and config write. |

---

## 6. Error Handling

| Scenario | Behavior |
|---|---|
| Dictionary API unreachable (Wordle word validation) | Fails open — the guess is accepted rather than blocking play. |
| `config/cookieConsent` read is slow or fails | Banner shows anyway after a 1.5-second timeout, defaulting to "enabled." |
| A `gameScores` write loses a race (two tabs, repeat attempt) | Rejected server-side as an `update` on an already-existing document ID (only `create` is allowed); the client treats this as "already recorded," not an error to surface. |
| Tournament finalization write fails after every puzzle is won | The player sees a "saving your points failed" state with a Retry action; progress isn't lost, since the attempt document already reflects every puzzle won. |
| Banned user attempts to log in | Signed out immediately after profile load; shown as if no valid session exists. |
| Non-admin visits `/admin` | Shown an access-denied state; no admin data is fetched. |
| Content import batch has one invalid/duplicate entry | The entire batch is rejected before any write; the admin is told which entry and why. |
| Firestore read fails generically (e.g. rules not yet deployed) | Most list views show an explicit "couldn't load — check Firestore rules are deployed" message rather than a silent empty state. |

---

## 7. Acceptance Criteria (representative)

- **AC for FR-5.5 (Connections Daily retry):** Given a registered player has just lost today's Connections Daily Challenge (4 mistakes), when they reload the page within the following hour, then they see a live countdown to their next retry and the puzzle's groups are not shown; when the hour has elapsed and they reload again, then they see a freshly reshuffled board of the same puzzle, playable again.
- **AC for FR-9.6 (duplicate rejection):** Given an admin uploads a batch of 20 puzzles where puzzle #15 is an exact duplicate of one already in the pool, when the import runs, then zero of the 20 puzzles are written and the admin sees an error naming entry #15.
- **AC for FR-10.3 (Rank curve):** Given a registered player has exactly 274,999 XP, when their profile is rendered, then they are shown as "Legend X" with 4,999/5,000 progress, not yet at the capped/complete state; given they have 275,000 XP or more (any amount), then they are shown as "Legend X" at 100% ("Max rank reached!").
- **AC for FR-11.6/FR-11.7 (banner reliability):** Given a first-time visitor loads the home page (where startup code triggers the banner's setup twice), when the page has fully loaded, then exactly one banner is present in the DOM, and clicking Accept or Decline removes it in a single click.
- **AC for FR-12.4 (Meta Pixel consent gate):** Given a visitor has not yet made a cookie choice, when their browser's network traffic is inspected, then no request to `connect.facebook.net` or `facebook.com/tr` has been made.

---

## 8. Validation & Testing Approach

There is no automated test suite (no unit/integration/e2e test framework is configured in this
repository). Functional correctness is established by:
1. Manual exploratory testing against the Firebase Local Emulator Suite (Firestore + Auth) during
   development of each feature.
2. Ad hoc, scripted browser automation (headless Chrome driven via the DevTools Protocol) for
   specific scenarios that are impractical to click through by hand repeatedly — win/loss paths,
   consent-gating, admin import validation, and the like.
3. Direct verification against the live production site after each deploy (HTTP status checks,
   rendered-content checks, and — for third-party integrations like the Meta Pixel — checking the
   provider's own validator/events tools).

See `docs/test-plan-and-test-cases.md` for the full strategy and a representative test case set,
and `docs/architecture... ` → `docs/solution-architecture-document.md`'s security model for why
this is an accepted, documented tradeoff rather than an oversight.

---

## 9. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | Every read is a one-shot Firestore query; the system does not use real-time listeners, trading live-updating UI for lower baseline connection overhead. |
| NFR-2 | Performance | Long lists (leaderboard, challenge browsing, attempt history, admin content pools) shall load incrementally, not as one unbounded query. |
| NFR-3 | Security | All data-modifying operations shall be scoped to the authenticated user's own UID at the Firestore rules layer; a client can never write another user's account document. |
| NFR-4 | Security | Admin-only operations (moderation, content seeding, config edits) shall be enforced by Firestore rules checking an `isAdmin` flag server-side, not merely hidden in the UI. |
| NFR-5 | Security | The scoring model is explicitly **not** fully server-authoritative (no Cloud Functions re-verify gameplay); protection is limited to per-write point caps and replay-proof document identifiers. This is a documented, accepted tradeoff, not an oversight. |
| NFR-6 | Availability | The system shall have no single backend server to go down — availability is bounded by Firebase Hosting/Auth/Firestore's own SLAs. |
| NFR-7 | Compatibility | The system shall function on current versions of Chrome, Safari, Firefox, and Edge, on both desktop and mobile, without a native app. |
| NFR-8 | Accessibility/UX | Decorative content (illustrative mini-previews, icons) shall be marked non-interactive and hidden from assistive technology where it duplicates adjacent real content. |
| NFR-9 | SEO/Discoverability | Every publicly-relevant page shall declare a real meta description and canonical URL pointing at the live production domain (see FR-14). |
| NFR-10 | Privacy | No personal contact information belonging to the site operator shall be exposed publicly; a dedicated, non-personal contact channel shall be used instead. Tracking technologies (Meta Pixel) shall only run with explicit, revocable consent. |
| NFR-11 | Maintainability | The system shall require no build step — every shipped file is exactly what a browser/editor sees, with no compiled/bundled intermediate artifact to keep in sync. |
| NFR-12 | Portability | Ad placement and platform configuration values shall be editable via the admin panel, not hardcoded, so operational changes don't require a code deploy. |
| NFR-13 | Resilience | User-visible functionality that depends on a third-party read (e.g. the cookie banner's config) shall not block indefinitely if that read is slow; a bounded timeout with a safe default shall apply. |

---

## 10. Data Overview

The system's Firestore data model is described in full in `docs/database-design-document.md` and
the various `CLAUDE.md` files under `src/js/`; summarized here only to the extent it clarifies the
functional requirements above:

- **Account data**: separate collections for guest and registered profiles, plus a
  username-to-email lookup collection enabling username-based login on top of Firebase's
  email/password provider.
- **`gameScores`**: one shared collection for every scored result across all games/modes, keyed by
  a deterministic, collision-proof document ID per scoring event (see FR-6.2).
- **Per-game content collections**: Daily pools (date-keyed), Classic pools (numeric-id-keyed,
  shared across difficulties), Tournament definitions, and Tournament attempt-progress documents —
  one collection family per game, structurally parallel across all five games.
- **Progression data**: `playerAchievements`, `championshipWinTallies`, `periodResults`,
  `playerMissions`, and `wordleDailyAttempts`/`connectionsDailyAttempts`, plus
  `xp`/`currentStreak`/`perfectDayCount` on `registeredUsers`.
- **`config`**: a small collection of admin-editable platform settings (see FR-9.4), each
  document independently readable by anyone, writable only by admins.

---

## 11. Assumptions and Constraints

- The system assumes a Firebase project already exists with Anonymous and Email/Password
  Authentication enabled, a Firestore database provisioned, and `firebase/firestore.rules`/
  `firebase/firestore.indexes.json` published — see `docs/deployment-and-release-document.md`.
- The system assumes it is served from its domain's root (root-relative asset paths throughout);
  it is not designed to be served from a subpath.
- The system assumes JavaScript execution and modern ES module support in the visitor's browser;
  there is no non-JS fallback experience.
- Monetization (Google AdSense) is live-intent; the ad-slot system (FR-13) currently serves
  admin-managed placeholder/image ads, with real AdSense units expected to follow approval.
- Meta Pixel advertising measurement is live and gated on cookie consent (FR-12.4); only
  `PageView` is currently tracked — no custom conversion events (e.g. completed games, sign-ups)
  are implemented as of this document's writing.

---

## 12. Glossary

See §1.3 for core terms. Additional game-specific and admin-specific terminology is defined inline
within each source directory's own `CLAUDE.md` (e.g. "given cell," "puzzle signature," "word set
signature") where a term's precise meaning affects correctness and is worth preserving alongside
the code it describes rather than duplicated here.
