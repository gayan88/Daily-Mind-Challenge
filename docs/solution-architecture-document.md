# Solution Architecture Document (SAD)
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | Reflects the system as implemented, as of 2026-10-17 (Quilt and Pounce added 2026-10-20). Formerly `docs/architecture.md`; renamed and expanded to the Solution Architecture Document template (system architecture, components, technology stack, architectural decisions, integrations, security, scalability, deployment architecture). |
| **Related docs** | `docs/functional-requirements-specification.md` (SRS), `docs/technical-design-document.md` (TDD), `docs/database-design-document.md`, `docs/api-documentation.md`, `docs/data-flow.md`, `docs/deployment-and-release-document.md` |

---

## 1. Overview

Daily Mind Challenge is a static, multi-page site (plain HTML/CSS/JS, no build tooling, no
bundler, no npm dependencies) backed entirely by Firebase — Authentication (Anonymous +
Email/Password) and Firestore. There is no application server: every read/write goes directly
from the browser to Firestore, governed by `firebase/firestore.rules`.

```
Browser
  ├── src/html/*.html         (13 real pages + 404.html, plain <a href> navigation)
  ├── src/css/*                (plain CSS, no preprocessor)
  ├── src/js/*                 (ES modules, loaded via <script type="module">, ~66 files)
  └── src/partials/*.html      (header/footer, injected via fetch())
        │
        ▼  Firebase JS SDK v10.7.1 (loaded from the gstatic.com CDN, no local install)
Firebase (project playdailymindchallenge)
  ├── Authentication            (Anonymous for guests, Email/Password for registered accounts)
  ├── Firestore                 (29 collections -- see docs/database-design-document.md)
  └── Hosting                   (serves src/ at dailymindchallenge.com and *.web.app)
        │
        ▼  client-side, consent-gated
Third parties
  ├── Google Analytics (Firebase Analytics SDK)       -- page views, account-type segmentation
  ├── Google AdSense                                  -- ad placement slots (admin-controlled)
  ├── Meta Pixel                                       -- PageView, consent-gated
  └── Google Search Console / Bing Webmaster Tools     -- indexing, verified via static files
```

## 2. Components

| Component | Responsibility | Key files |
|---|---|---|
| Page shell | Header/footer injection, session resolution, cookie banner | `src/js/app.js`, `src/partials/` |
| Auth | Guest/registered session logic | `src/js/auth/` |
| Game engines (×6) | Mode-agnostic playable mechanic per game | `src/js/games/{wordle,sudoku,wordsearch,connections,quilt,pounce}/*-engine.js` |
| Quilt puzzle core | Solver (proves exactly one solution), picture → puzzle generator, picture parsing/emoji mosaic — pure modules shared by the Quilt engine and the admin importer | `src/js/games/quilt/quilt-{solver,generator,picture}.js` |
| Pounce puzzle core | Uniqueness solver, human-technique logic solver (Whisker Tips + difficulty grading), board generator/validator, SVG cats — pure modules shared by the engine, the page and the admin generator | `src/js/games/pounce/pounce-{solver,logic,generator,cats}.js` |
| Game page glue (×6) | Mode tab wiring, session gating, per-mode render functions | `src/js/games/*/​*-page.js` |
| Per-mode data layers | Firestore reads/writes, points formulas, share bonuses | `src/js/games/*/​*-{daily,classic,tournament}-data.js` |
| Progression engine | Points→Level, XP→Rank, Streaks, Achievements, Championships, Missions | `src/js/progression/` |
| Leaderboard | Aggregation queries, leaderboard page, player-profile popup | `src/js/leaderboard/` |
| Admin panel | Content seeding, moderation, config, championship finalization | `src/js/admin/` |
| Utilities | Cross-cutting helpers (config, cookie consent, Meta Pixel, ads, icons) | `src/js/utils/` |
| Firestore rules | The actual server-side enforcement boundary | `firebase/firestore.rules` |

## 3. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Markup/Styling | Plain HTML5 + CSS3 | No preprocessor, no CSS framework |
| Client logic | Vanilla JavaScript (ES modules) | No framework (React/Vue/etc.), no TypeScript, no bundler |
| Backend | None (Firebase-only) | No Node/Express server, no Cloud Functions |
| Auth | Firebase Authentication | Anonymous + Email/Password providers |
| Database | Cloud Firestore | Native mode, single database, region set at project creation |
| Hosting | Firebase Hosting | Global CDN; serves `src/` as the public root |
| Firebase SDK | `firebase*.js` v10.7.1 | Loaded per-module from `https://www.gstatic.com/firebasejs/10.7.1/...`, not npm-installed |
| Analytics | Firebase Analytics (Google Analytics) | Consent-gated via Google Consent Mode |
| Advertising | Google AdSense (pending/approval-stage) + Meta Pixel | Both consent-gated for EU/UK-style compliance where applicable |
| Local dev | Firebase Emulator Suite (Firestore + Auth), `python3 -m http.server` | No containerization, no CI pipeline configured |
| Version control | Git, hosted on GitHub (`gayan88/Daily-Mind-Challenge`) | No branch protection or required-reviews configuration observed |

## 4. Architectural Decisions

### 4.1 Why no build tooling
A deliberate choice: every file is served exactly as authored, so "view source" on any page shows
real, readable code, and there's no compile step to keep in sync. The tradeoff is manual
relative-path management (see `src/js/CLAUDE.md`) and no code-splitting/minification — acceptable
for this project's current scale. If that stops being true, introducing a bundler (Vite is the
natural fit for a no-framework project like this) would be a deliberate follow-up, not something
to bolt on quietly.

### 4.2 Why Firebase Auth instead of a custom login system
The product originally called for a Firestore-stored `passwordHash` compared client-side. That's
not securely possible with no backend server — see `src/js/auth/CLAUDE.md` for the full reasoning.
Firebase Auth's email/password provider is used instead, with a username-based UX layered on top
via the `usernames/{username}` → email lookup collection.

### 4.3 Why Firestore is initialized with `experimentalForceLongPolling`
This app never uses `onSnapshot()` real-time listeners, so Firestore's default streaming "Listen"
connection is pure overhead — and on some networks it hangs for 30+ seconds before falling back.
Long-polling skips that entirely. See `src/js/api/CLAUDE.md`.

### 4.4 Why six parallel game implementations instead of one generic engine
Each game (Wordle, Sudoku, Word Search, Connections, Quilt, Pounce) has a genuinely distinct playable mechanic,
distinct scoring formula shape, and distinct Firestore content schema. Rather than build one
over-abstracted "puzzle engine," each game owns its own engine/page/data files, following an
established, copy-and-adapt convention (`docs/adding-a-new-game.md`). What *is* shared and
genuinely generic — the game registry, progression math, admin table grouping, the leaderboard —
lives in dedicated cross-game modules (`src/js/progression/game-registry.js`,
`src/js/admin/admin-table-grouping.js`) specifically so those pieces don't drift into six
near-duplicate copies the way the gameplay itself deliberately does.

### 4.5 Why the cookie banner doesn't block on a Firestore read indefinitely
Originally, the banner waited on `config/cookieConsent` before rendering at all. On a slow or
congested connection this could take 20+ seconds, during which no consent could be given and the
Meta Pixel could never load. Fixed by racing the config read against a 1.5-second timeout,
defaulting to "show the banner" if the read hasn't resolved — see §4.7 of
`docs/technical-design-document.md` for the implementation.

### 4.6 Why the Rank curve uses a generated threshold table, not a stored list
The 100 Rank thresholds (10 tiers × 10 sub-ranks, non-uniform band widths growing per tier) are
generated at module load from a single 10-entry array (`TIER_STEP_XP`), not hand-listed. Retuning
the pace later means editing 10 numbers, not auditing/regenerating 100 by hand. See
`src/js/progression/rank-service.js` and `docs/technical-design-document.md` §3.

## 5. Integrations

| Integration | Purpose | Trigger / gating |
|---|---|---|
| Firebase Authentication | Identity | Every session |
| Cloud Firestore | All persistent data | Every read/write |
| Firebase Hosting | Static file serving + custom domain | Every request |
| Google Analytics | Usage analytics | Every page load; restricted (not blocked) via Consent Mode on decline |
| Google AdSense | Ad placement slots | Admin-controlled per slot; real AdSense units pending approval |
| Meta Pixel | Ad measurement/retargeting (`PageView` only) | Loads only after cookie-consent Accept; never loads on decline |
| Free Dictionary API | Wordle guess validation | Live, per-guess; fails open (treats guess as valid) on any error/timeout |
| Google Search Console | Search indexing | Static HTML verification file at site root; sitemap submitted |
| Bing Webmaster Tools | Search indexing | Static XML verification file at site root; sitemap submitted |

No Cloud Functions, no message queue, no scheduled jobs, no server-to-server integrations exist.
Every integration above is a client-side SDK or a client-initiated HTTP call.

## 6. Security Model

Firestore security rules (`firebase/firestore.rules`) are the actual enforcement boundary, not
client-side checks:
- Every write is scoped to `request.auth.uid` — a client can only ever write its own
  `guests`/`registeredUsers` doc.
- `registeredUsers` writes are split into self-service fields (displayName/email, with capped
  `loginPoints`/`xp` deltas) vs. admin-only moderation fields (`isAdmin`/`isBanned`/etc.), gated
  by an `isAdmin()` rule function.
- `gameScores` uses a deterministic document ID (`{uid}_{gameType}_{date}`) so a repeat write for
  the same game/day is rejected as an `update` (not allowed) rather than a `create` (allowed) —
  the "one attempt per game per day" rule is enforced server-side, not just in the UI.
- Per-`gameType` point caps (`maxCreateScore()`) bound the maximum a single write can award,
  independent of what the client claims.
- Content-seeding collections (Daily/Classic/Tournament puzzles, `config`) are publicly readable,
  admin-write-only.
- This is a **v1-pragmatic** model, not full server-authoritative validation — there's no Cloud
  Function re-computing scores. A determined attacker could still make small, rule-compliant
  fraudulent writes. Full server-side validation would require Cloud Functions, which this
  project doesn't use.
- Tracking/advertising scripts (Meta Pixel) are gated on explicit visitor consent, not loaded
  unconditionally — see FR-12.4 in the SRS.

## 7. Scalability

| Dimension | Current approach | Scaling path if needed |
|---|---|---|
| Static assets | Firebase Hosting CDN | Already globally distributed; no action needed |
| Firestore reads (leaderboard) | Client-side aggregation over `gameScores`, unbounded for "All-time"/"Overall" views | Would need a scheduled Cloud Function to pre-aggregate once read volume/cost becomes material — a known, documented limitation, not yet hit |
| Firestore writes | One doc per scored event, deterministic IDs | Naturally shards by document ID; no hot-spotting pattern observed |
| Content delivery | No caching layer beyond Hosting's own CDN and Firestore's client SDK cache | Sufficient at current traffic; would reconsider if per-page Firestore read counts became a cost concern |
| Compute | None (no server) | N/A — there is no compute tier to scale |

## 8. Deployment Architecture

See `docs/deployment-and-release-document.md` for the full process. In summary: `firebase deploy`
publishes `src/` to Firebase Hosting (serving both the custom domain `dailymindchallenge.com` and
the auto-provisioned `playdailymindchallenge.web.app`, which stays live with identical content —
see that document's "Search engine verification files" section for why) and
`firebase/firestore.rules`/`firebase/firestore.indexes.json` to Firestore, independently. There is
no CI/CD pipeline; deploys are run manually from a developer's machine, by the project owner or an
AI assistant working under their direction.

## 9. What Doesn't Exist (and Why)

- **No backend server.** Pure Firebase. If one is ever added, it's a separate architectural
  decision, not an incremental addition.
- **No client-side router.** Real multi-page navigation via `<a href>`.
- **No build step / npm / bundler.**
- **No real-time listeners.** Every read is a one-shot `getDoc`/`getDocs`.
- **No pre-computed/cached leaderboards.** Aggregated client-side from `gameScores` on each page
  load — fine at current scale, would need a scheduled Cloud Function to stay fine at much larger
  scale.
- **No Cloud Functions, no server-to-server webhooks, no message queue, no CI/CD pipeline, no
  automated test suite.** See `docs/test-plan-and-test-cases.md` for how correctness is validated
  instead.
