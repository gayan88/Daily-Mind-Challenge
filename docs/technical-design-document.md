# Technical Design Document (TDD)
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | New as of 2026-10-17; Quilt rows added 2026-10-20. Module designs, data schemas, and business-logic implementation for the pieces of the system most worth understanding before changing them. Not exhaustive — each source directory's own `CLAUDE.md` is the line-level reference; this document is the entry point into *why* those modules are shaped the way they are. |
| **Related docs** | `docs/solution-architecture-document.md` (SAD), `docs/database-design-document.md`, `docs/api-documentation.md` |

---

## 1. Module Map

| Module | Files | Depends on |
|---|---|---|
| Game registry | `src/js/progression/game-registry.js` | Nothing — the single source of truth for "which `gameType`s belong to which game," read by the leaderboard, progression, and admin layers |
| Per-game engine | `src/js/games/*/​*-engine.js` | Nothing Firebase-related — pure DOM + callback, mode-agnostic |
| Quilt puzzle core | `src/js/games/quilt/quilt-{solver,generator,picture}.js` | `utils/helpers.js` only (seeded RNG) — no DOM, no Firebase, so the same code runs in the engine (board check), the admin page (picture → puzzle, uniqueness proof) and plain Node |
| Per-game data layer | `src/js/games/*/​*-{daily,classic,tournament}-data.js` | Firestore SDK, the engine's `onComplete` payload shape |
| Per-game page glue | `src/js/games/*/​*-page.js` | `app.js` (session), the engine, the data layer, the game's own summary-modal |
| Progression | `src/js/progression/{rank,xp,progression,streak}-service.js`, `achievement-registry.js`, `achievement-engine.js`, `championship-service.js`, `mission-service.js` | `game-registry.js`; otherwise mutually independent, read-only/derived except where noted |
| Leaderboard | `src/js/leaderboard/*` | `game-registry.js` for its `GAME_TYPES` map |
| Admin | `src/js/admin/*` | Every per-game admin data layer, `admin-table-grouping.js` (shared), `config.js` |
| Utilities | `src/js/utils/*` | Varies per file; `cookie-consent.js` → `meta-pixel.js`, `config.js` |

## 2. Component Interaction: Playing and Scoring a Daily Challenge

Representative sequence, using Connections' Daily Challenge as the example (every game's Daily
mode follows this same shape):

```
Player               connections-page.js         connections-daily-data.js        Firestore
  │  opens /connections    │                              │                            │
  ├────────────────────────►                               │                            │
  │                        │  checkPlayedToday(uid, 'connections')                       │
  │                        ├──────────────────────────────────────────────────────────► getDoc
  │                        │                               │                            │
  │                        │◄──────────────────────────────────────────────────────────  (no doc = not yet played)
  │                        │  getTodayChallenge()          │                            │
  │                        ├──────────────────────────────►│                            │
  │                        │                               ├───────────────────────────► getDoc(connectionsDailyPuzzles/{today})
  │                        │                               │◄───────────────────────────┤
  │                        │◄──────────────────────────────┤                            │
  │                        │  mounts playConnectionsRound() -- pure engine, no Firestore knowledge
  │  plays, wins           │                               │                            │
  │◄───────────────────────┤  onComplete({ won, mistakes, guessHistory, timeTakenSeconds })
  │                        │  recordDailyAttempt(uid, won) │                            │
  │                        ├──────────────────────────────►├───────────────────────────► setDoc(connectionsDailyAttempts/{uid}_{date})
  │                        │  recordDailyResult(...)       │                            │
  │                        ├──────────────────────────────►├───────────────────────────► setDoc(gameScores/{uid}_connections_{date})  (create-only)
  │                        │  showConnectionsSummaryModal()│                            │
  │◄───────────────────────┤                               │                            │
```

**Key design points this generalizes to every game:**
- The **engine** never touches Firestore — it's handed a config object and calls `onComplete()`
  once with a plain result payload. This is what lets the same engine serve Daily, Classic, and
  Tournament modes unmodified.
- The **data layer** owns all scoring math and all Firestore access for its mode.
- A **loss on a retry-eligible Daily Challenge** (Wordle, Connections) writes only the attempt-
  tracking doc, never `gameScores` — so a `gameScores` document existing for today is itself the
  signal "already solved," with no separate flag needed.
- **Quilt** has no loss condition in Daily or Classic (unlimited undo, no time limit), so its Daily
  is a single scored solve per day like Sudoku's; a win is decided by checking the player's
  rectangles against the rules (`quilt-solver.js#checkBoard`), not by comparing with a stored answer.
- The actual **"can't be scored twice" guarantee is the Firestore rule**, not the client-side
  `checkPlayedToday()` call — that check is purely a UX optimization to avoid a doomed write.

## 3. Business Logic: The Rank/XP Curve

`src/js/progression/rank-service.js` is worth detailing because its design (a generated threshold
table instead of pure division) replaced an earlier, simpler implementation and the reasoning
matters for anyone retuning it again.

**Original design:** 10 main ranks × 10 sub-ranks, every band exactly 1,000 XP wide (10,000 XP per
main rank). `calculateMainRank()`/`calculateRankProgress()` used plain division
(`Math.floor(xp / bandWidth)`).

**Current design:** each main rank has its own flat per-sub-rank width, growing by a fixed amount
per tier:

```js
const TIER_STEP_XP = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
// Novice=500 ... Legend=5000, +500 per tier. Total: 275,000 XP for the full climb.
```

The 100 cumulative thresholds (`RANK_END_XP`) are generated from this one array at module load:

```js
let cumulative = 0;
for (let tier = 0; tier < TIER_STEP_XP.length; tier++) {
    for (let sub = 0; sub < SUB_RANKS_PER_TIER; sub++) {
        cumulative += TIER_STEP_XP[tier];
        RANK_END_XP.push(cumulative);
    }
}
```

`rankIndexForXp(xp)` then finds the current rank by scanning this table (a plain linear scan over
100 entries — simple, and fast enough at this scale) rather than computing it algebraically, since
the variable band widths make the algebra non-trivial. A player holds a rank as soon as its band
is entered (Novice I is free at 0 XP) and stays capped at index 99 (Legend X) for any XP at or
beyond 275,000 — there is no 101st band.

**Why this matters for future changes:** retuning the pace (e.g. a different total XP target)
means editing the 10-entry `TIER_STEP_XP` array, not hand-editing 100 thresholds. This was a
direct design goal when the curve was last retuned, after an earlier proposal that *did* use 100
hand-typed values was found to be error-prone and hard to verify.

## 4. Business Logic: Consent-Gated Third-Party Loading

`src/js/utils/cookie-consent.js` and `src/js/utils/meta-pixel.js` implement a pattern worth
reusing for any future consent-gated integration:

1. **The banner's own setup is idempotent**, guarded by a module-level flag set *synchronously*,
   before any `await`:
   ```js
   let initStarted = false;
   export async function initCookieConsentBanner() {
       if (initStarted) return;
       initStarted = true;
       // ...
   }
   ```
   This was added after a real bug: the home page calls `loadHeaderFooter()` twice (once from its
   own `init()`, once inside `trySession()`), and each call independently rendered a banner,
   requiring two Accept/Decline clicks to actually dismiss it.

2. **The banner doesn't block on a slow database read.** The admin on/off setting
   (`config/cookieConsent.enabled`) is raced against a fixed timeout:
   ```js
   const { enabled } = await Promise.race([
       getConfig('cookieConsent'),
       new Promise((resolve) => setTimeout(() => resolve({ enabled: true }), CONFIG_TIMEOUT_MS)),
   ]);
   ```
   Defaulting to "enabled" on timeout, rather than "disabled," because the fail-safe direction for
   a consent mechanism is to *ask*, not to silently skip asking.

3. **The tracked script itself is a single idempotent function**, not a page-load `<script>` tag:
   ```js
   let loaded = false;
   export function loadMetaPixel() {
       if (loaded) return;
       loaded = true;
       // ... standard Meta bootstrap, then fbq('init', ID); fbq('track', 'PageView');
   }
   ```
   Called from exactly two places in `cookie-consent.js`: on an Accept click, and on a later page
   load where the stored choice is already `'accepted'`. It is never called, and the Meta script
   is never requested, for a visitor who has declined or not yet chosen — deliberately no
   `<noscript>` pixel-image fallback, since that would fire unconditionally.

## 5. API Specification

This system has no custom backend API — see `docs/api-documentation.md` for the full treatment of
Firestore's security rules as the de facto API contract.

## 6. Database Schemas

See `docs/database-design-document.md`.

## 7. Error Handling Design

Consistent pattern across every Firestore-writing function in this codebase: a `try/catch` around
the `setDoc`/`runTransaction` call, returning `null`/`false` on failure rather than throwing up to
the UI layer, with the caller responsible for a user-visible retry affordance where the write
matters (e.g. Tournament finalization shows an explicit "saving your points failed — Retry"
state). Read failures (e.g. a Firestore rules/index not yet deployed) are generally surfaced as a
plain `"Couldn't load — check Firestore rules are deployed"` empty-state message rather than a
silent blank screen — a deliberate choice to make a common development-time mistake (forgetting to
deploy rules alongside new client code) immediately diagnosable.

## 8. Known Technical Debt / Deliberate Simplifications

- **Scoring is not server-authoritative.** Documented at length in the SAD's Security Model —
  accepted for this project's current scale and threat model.
- **No automated tests.** See `docs/test-plan-and-test-cases.md`.
- **Leaderboard "All-time"/"Overall" views read the entire `gameScores` collection client-side.**
  Fine today; would need a scheduled aggregation (Cloud Function) at meaningfully larger scale.
- **`playerAchievements` and `championshipWinTallies` allow-lists in `firestore.rules` are hand-
  maintained**, not generated from the JS registries that are the actual source of truth for
  achievement/game IDs, because Firestore rules cannot `import` JavaScript. Adding a game or an
  achievement tier requires remembering to update both places — a known, repeatedly-flagged
  maintenance coupling (see `docs/adding-a-new-game.md`).
