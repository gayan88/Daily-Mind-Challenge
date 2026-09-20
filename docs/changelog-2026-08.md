# Development Changelog — August 2026

A detailed record of one extended development session, covering a leaderboard scoring bug fix, a
full score-logic audit, several gameplay/UX fixes, and a large push to get the site ready for
Google AdSense approval. Written to preserve *why* things were built the way they were, not just
what changed — the session's own chat context will not be available afterward.

All work described here was deployed via `firebase deploy --only hosting --project
playdailymindchallenge --account lazyprogrammer88@gmail.com`, one push per completed change, only
ever on the user's explicit "Push to Live" instruction. No Firestore rules/indexes changes were
needed for anything in this session except the `scoreDate` composite index noted below.

---

## 1. Leaderboard bug: Sudoku Tournament (and Classic/Challenge) scores invisible

**Symptom:** Sudoku Tournament points weren't showing up on the Daily or Sudoku leaderboards.

**Root cause:** `gameDate` is a dual-purpose field across this codebase — a real calendar date for
Daily Challenge modes (used in `gameScores` doc IDs, `{uid}_{gameType}_{date}`), but *repurposed*
as a deterministic key (tournament ID, challenge ID, a random token, or a compound
`{tournamentId}_{puzzleIndex}`) for Classic/Tournament/Challenge modes. The leaderboard's period
filters (`where('gameDate', '==', today)` etc.) silently excluded every non-Daily score, since
those docs' `gameDate` was never actually today's date.

**Fix:** Added a *second*, always-a-real-calendar-date field, `scoreDate: getTodayDateString()`,
to all 12 `gameScores` write sites across all 9 game/mode data files (Wordle Daily/Tournament/
Challenge+CreatorReward, Sudoku Daily/Classic/Tournament×2, Word Search Daily/Classic/
Tournament×2) — `gameDate` itself was left untouched, since its doc-ID role still needs it.
`src/js/leaderboard/leaderboard-data.js`'s `periodConstraints()` switched from filtering on
`gameDate` to `scoreDate`. Added a new Firestore composite index `(gameType ASC, scoreDate ASC)`
in `firebase/firestore.indexes.json` (the old `(gameType, gameDate)` index was left in place,
unused but harmless).

**Explicitly no backfill** — the user confirmed historical data doesn't need correcting; only
future scores are correctly bucketed from the point this shipped onward.

---

## 2. Full score-logic audit (all 3 games × 3 modes)

Requested as a follow-up to the leaderboard bug, to catch anything else in the same family. Read
every game/mode data file fresh and cross-checked against each game's own documented point
formulas.

**Findings:**
- All `scoreDate` fields present and correct (from the fix above).
- All point formulas matched their documented caps.
- All double-scoring guards correct (create-only Firestore doc IDs + transactional idempotency
  where a run spans multiple writes).
- **Fixed:** `src/js/games/wordsearch/CLAUDE.md` documented "Max pre-share: 70" for Daily/Classic,
  which was wrong — the real max is 50 (25 completion + 25 max time bonus). Documentation-only fix.
- **Flagged, not fixed:** Sudoku/Word Search Daily+Classic writes never explicitly set
  `sharedWithFriends: false` at creation. Harmless — Firestore's `undefined` reads as falsy in
  every guard that checks it — but cosmetically inconsistent with other write sites. Left alone,
  not asked to fix.
- **Flagged, not fixed:** `wordle-tournament` (cap 1000) and both `*-tournament-bonus` gameTypes
  (cap 2000) scale with an admin-set bonus value and could theoretically be exceeded by a very
  generous admin-set bonus. Pre-existing, judgment-call headroom, not touched.

---

## 3. Gameplay/UX fixes and small features

### Footer "Share with Friends"
`src/partials/footer.html`'s Facebook link became `Share with Friends`. `app.js#wireFooterShare()`
now shares a **fixed home-page link** (`${origin}/`), not `window.location.href` — reasoning: this
is a site-wide "come join us" invite, so a friend clicking it should never land on the sharer's own
`/settings` or `/profile`. Uses a new `FOOTER_SHARE_TEXT` constant via the existing `shareUrl()`
helper (native Web Share API first, `sharer.php` popup fallback on desktop).

### Sudoku: physical-keyboard number entry
`src/js/games/sudoku/sudoku-engine.js`'s `playSudokuRound()` — a `keydown` listener attached to
`container` (not `document`) maps `1-9` → `enterValue(key)`, `Backspace`/`Delete` → `enterValue(
'0')`. `selectCell()` explicitly calls `.focus()` on the chosen cell (a real `<button>`), since
Safari doesn't focus a button on plain click by default, which the keydown listener depends on.
Deliberately **not** using Wordle's `document`-level listener pattern (which needed an
explicit-cleanup fix earlier in the project for a stale-listener bug) — `container` is fully
detached from the DOM on a mode-tab switch, so a detached node can never receive real keydown
events again, meaning this can't leak the same way. `cleanup()` still removes the listener, for
tidiness rather than correctness. Applies to all three Sudoku modes automatically, since they all
share this one engine.

### Wordle: Attempts stat + Share button on Challenge links
- **Attempts stat**: added to the live stats bar (`0/6`, updates after every submitted guess),
  matching Sudoku's Time+Errors bar and Word Search's Words-Found+Time bar. Present in all three
  Wordle modes.
- **Share button**: both the Create-Challenge result box and each My Challenges card's detail
  panel now show a Share button alongside the existing Copy button. The Share button only renders
  when `navigator.share` exists (feature-detected at render time) — `shareUrl()`'s non-native
  fallback opens a Facebook popup rather than copying to clipboard, which would be worse than the
  Copy button already sitting next to it. Both buttons send the same new message template:
  ```
  🟪 I've got a Wordle challenge for you!

  Think you can crack my word in 6 attempts or fewer? 👀🧠

  Give it a try and see how quickly you can solve it:

  {link}

  Can you beat the challenge? 🔥
  ```

### Sudoku/Word Search/Wordle: stopwatch doesn't start until the first move
**Problem raised by the user:** in Sudoku Daily Challenge, the live clock starts ticking the
instant the page loads — before the player has even looked at the puzzle — so load time and
reading time silently ate into the speed bonus.

**Fix, applied to all three games' engines** (`sudoku-engine.js`, `wordsearch-engine.js`,
`wordle-engine.js`): the count-up stopwatch (Daily/Classic — no `timeLimitSeconds`) now only
starts on the player's first real interaction — first cell tap (Sudoku), first drag (Word Search),
first letter keystroke (Wordle) — via a `startTimer()` function guarded to only ever start the
interval once. **Tournament's countdown is untouched** — it still starts immediately on mount,
since it's a genuine time-attack constraint, and delaying it would let a player "pause" it
indefinitely just by not touching the board.

As a side effect, Wordle previously computed its Daily/Challenge `timeTakenSeconds` via a
page-level `Date.now()` diff captured at mount (`wordle-page.js`), which had the exact same
"counts load time" flaw — this was replaced with the engine's own gated `timeTakenSeconds`, so
`renderDailyMode()`/the Challenge-solve handler now just read it off `onComplete()`'s payload.

---

## 4. Word Search: Safari-only drag-selection bug

**Symptom (screenshots provided):** dragging to select a valid, correct word (e.g. a clean
vertical MONKEY) also lit up a large, seemingly unrelated block of extra cells. Reported first in
Chrome-agnostic terms, then narrowed down by the user to **Safari only — Chrome worked correctly**.

**Root cause:** `.wordsearch-grid` only had the unprefixed `user-select: none`. Safari doesn't
always fully suppress its own native text/content selection with the unprefixed property alone —
Safari's own selection engine was highlighting a block of cells in *document order* between the
drag's start and end points (which, for a grid laid out row-major in the DOM, explains both the
"whole rows" and "block of cells" descriptions the user gave at different points), layered visually
on top of the game's own correct `.preview` line underneath.

**Fix:** added `-webkit-user-select: none;` alongside the existing `user-select: none;` on
`.wordsearch-grid` in `src/css/pages/wordsearch.css`.

---

## 5. Firebase Analytics (GA4) enabled

`src/js/api/firebase-init.js` now calls `getAnalytics(app)`, wrapped in try/catch (null on
unsupported environments — some webviews, private browsing — so every consumer must check
`if (analytics)`), exported as `analytics`. Confirmed via `firebase apps:sdkconfig` that
`measurementId: "G-04789HNN23"` was already provisioned for the project but never previously
receiving data.

`app.js#resolveSession()` calls `setUserProperties(analytics, { accountType: profile.kind })`
once per session, right after `profile` resolves — lets GA4 reports be segmented by guest vs.
registered, which GA4 has no way to know about this app's own distinction on its own.

Extensive explain-only discussion (no further changes from it directly) covered: GA4's automatic
page-view collection (free, and a good fit since this app has no client-side router — every page
is a real page load), the difference between automatic events and custom `logEvent()`-based
completion tracking, where guest/registered counts would show up, and which figures GA4
fundamentally can't show (exact Firestore-derived totals need a real admin page, not GA4) — this
directly led to the Daily Activity Summary section below.

---

## 6. Admin: Daily Activity Summary section

Built from a provided visual mockup. New collapsible section, first on the admin page (later
changed to start collapsed along with "General", see below): a date picker (defaults to today)
driving 4 stat cards (Logged Users / Guest / Registered / Total Plays, reusing the home page's
`.status-stats-grid`/`.status-stat-card` classes) plus a table grouped by game with a per-game
subtotal row and indented per-mode sub-rows (Guest/Registered/Total each).

Data logic in `src/js/admin/activity-summary-data.js`: a single `where('scoreDate', '==',
dateString)` equality query — cheap and bounded to one day regardless of total site history — then
client-side tally. A hardcoded `ACTIVITY_ROWS` map defines which single `gameType` represents "one
completion" per mode; Tournament modes count only the one-shot completion doc (e.g.
`sudoku-tournament-bonus`), never the per-puzzle docs, or the count would be wildly inflated by
however many puzzles a tournament has. `wordle-challenge-creator` reward docs are deliberately
excluded (a reward, not a play).

**Follow-up fix:** both "Daily Activity Summary" and "General" loaded expanded at the same time —
fixed by removing the `open` class from General's wrapper in `admin.html` (Activity Summary stays
open by default; General doesn't).

---

## 7. Tournament mechanics discussion (Sudoku/Word Search vs. Wordle) — no mechanics changed

Triggered by a question about wording a Sudoku Tournament share message ("Puzzle 1 - Passed").
This opened into a broader comparison:

- **Wordle Tournament**: failing a word resets the *entire run* back to word 1 — no progress or
  points banked until every word is cleared in one unbroken run, then a single lump-sum payout
  (`30 + 15×numWords + bonusPoints`).
- **Sudoku/Word Search Tournament**: failing a puzzle does *not* reset anything — banks the lower
  "failed" points immediately and moves straight to the next puzzle. This was a deliberate earlier
  design change away from Wordle's harsher model, plus a completion bonus once every puzzle has
  been *attempted* (not necessarily passed).

The user considered unifying all three around a middle-ground design (retry-only-the-failed-puzzle
until passed, no full-run reset, but no partial credit for a fail either) and asked directly:
**"Honestly do you think these changes are required?"** — the answer given, and accepted, was
**no** — the current Sudoku/Word Search design was a deliberate earlier choice, the whole thread
started from a small wording question, and the "v1-pragmatic" scoring philosophy already
established in this codebase favors the more forgiving pay-as-you-go model. **No tournament
mechanics were changed.**

What *did* ship from this thread:
- Sudoku Tournament's completion **summary modal + share text** already showed per-puzzle time
  and error count instead of "Passed"/"Failed" wording (a prior-session change, verified still
  correct).
- Per explicit request, the **share text** (only) was changed back to include Passed/Failed
  wording *alongside* the time/errors, e.g. `Puzzle 1 - Passed (0:45, 1 error)` — the mid-run
  "Next Puzzle" transition message and the summary modal's own breakdown were deliberately left
  untouched (still time/errors only, no Passed/Failed).

---

## 8. AdSense readiness — the main body of this session's work

### 8.1 Discovery: login-gating blocks AdSense review and SEO

`initShell()` (used by every protected page) redirected any visitor with no session — including
anonymous crawlers/reviewers — straight back to `/` before any page content rendered. A "guest"
session isn't automatic either; it only exists after an explicit "Continue as Guest" click, which
a crawler would never do. Net effect: `/wordle`, `/sudoku`, `/wordsearch` (the pages actually
carrying ad slots) were invisible to Google's AdSense reviewer and to organic search.

### 8.2 Fix: `trySession()` instead of `initShell()` on the three game pages

`app.js` already had two entry points doing the same header/footer/session work, differing only in
the no-session case:
- **`initShell()`** — redirects to `/` (used by `profile.html`/`settings.html`/`admin.html`,
  where there's no useful unauthenticated state).
- **`trySession()`** — resolves a session if present, returns `null` instead of redirecting
  otherwise (previously only used by the home page).

`wordle-page.js`/`sudoku-page.js`/`wordsearch-page.js` were switched from `initShell()` to
`trySession()`. When there's no session, each page's `init()` now renders a `renderSignInPrompt()`
into `#game-mount` — a "Sign In to Play" button linking to `/?redirect=<current page>` (reusing
`initShell()`'s own old redirect mechanism; the home page already auto-opens its sign-in modal
when it sees `?redirect=`) — instead of bouncing the visitor off the page.

**Follow-up bugs found and fixed after this shipped:**
- **Home page tile clicks still blocked signed-out play.** `home.js#wireGameTileGate()`
  intercepted tile clicks for logged-out visitors and opened the sign-in modal directly instead of
  letting the `<a href>` navigate — correct back when every game page required a session, now
  wrong. Removed entirely (dead code, not just disabled).
- **No Login button in the header on game pages when signed out.** `header.html`'s two user-menu
  variants (`#user-menu-loggedin`/`#user-menu-loggedout`) are both `hidden` by default; only
  `home.js`'s own logged-out-header logic ever un-hid the logged-out one, and the three game pages
  never called anything equivalent. Added a new shared `showLoggedOutHeader()` in `app.js`,
  wired into all three game pages' no-session branch — its Login button navigates to
  `/?redirect=<page>` (there's no sign-in modal markup on these pages to open in place).

### 8.3 Static, crawlable content added to each game page

Each game page (`wordle.html`/`sudoku.html`/`wordsearch.html`) gained a static "How to Play"
block, always present in the raw HTML regardless of session — this is what a crawler/reviewer
actually needs to see. Initially plain prose, later redesigned (see 8.6).

### 8.4 New legal/informational pages

All three are deliberately **not** gated behind `initShell()` — they call `loadHeaderFooter()`
directly, same as the home page, for the same crawlability reason as 8.2.

- **`/privacy-policy`** (`src/html/privacy-policy.html`) — covers what's actually collected
  (guest = display name only via Firebase anonymous auth; registered = username/display name/
  password via Firebase Auth, optional recovery email), gameplay data, GA4 usage data, a
  forward-looking AdSense/cookies disclosure, third-party services (Firebase/Google), data
  retention, a standard "not directed at children under 13" clause, and a Contact section.
- **`/cookie-consent`** (`src/html/cookie-consent.html`) — Essential/Analytics/Advertising cookie
  categories in plain language, plus how to manage them in-browser.
- **`/about`** (`src/html/about.html`) — a generic, no-personal-name About blurb plus a Contact
  section.

Footer (`src/partials/footer.html`) updated to link **About & Contact / Privacy Policy / Cookie
Consent Notice / Share with Friends** — Leaderboard/Profile/Settings were deliberately dropped
from the footer (already in the header nav; the footer was refocused on what AdSense review
expects to find).

A shared `.prose-content` block (renamed from an earlier, narrower `.legal-content`) in
`components.css` provides consistent heading/paragraph/list styling, reused by the legal pages,
the About page, and later the game pages' own How-to-Play sections.

### 8.5 Contact email without exposing personal identity

The user didn't want to expose a personal email (spam risk). Agreed approach: a dedicated,
non-personal alias — **`support@dailymindchallenge.com`** — used in both `/about` and the Privacy
Policy's Contact Us section. **This alias needs to actually be set up as real email forwarding
(e.g. Cloudflare Email Routing, or the domain registrar's free forwarding) pointing at a real
inbox — the site only links to it, it doesn't create the mailbox.** As of this writing, that setup
step is still the user's to do.

### 8.6 "How to Play" redesign (icons, mini live-style previews)

Replaced the plain-prose How to Play blocks with a richer structure, prototyped on Sudoku first
from a provided mockup, then ported to Wordle and Word Search:

- A **banner**: the game's existing tile logo image (`tile-sudoku.png`/`tile-wordle.png`/
  `tile-wordsearch.png`, already used on the home page) at 200×200, centered, with a "How to Play"
  caption beneath it. (Two earlier iterations were tried and superseded: first the logo as a small
  40px badge next to a text heading — rejected, the logo has "SUDOKU" etc. baked into it and would
  be illegible that small, and redundant with the adjacent heading text; then the logo placed
  separately above a small-icon heading row — superseded when the user asked to make it "a real
  banner," i.e. drop the small icon+heading row entirely in favor of the large logo doing that
  job.)
- **Rules** row — icon badge + description + a small non-interactive preview built from the game's
  *real* CSS classes rather than a new illustration: a static 9×9 grid using `.sudoku-cell` (the
  classic textbook example Sudoku puzzle, the same one from Wikipedia's Sudoku article — chosen
  specifically as a generic, non-proprietary example), a colored guess row using `.wordle-cell`
  (`data-state="correct"/"present"/"absent"`), a 6×6 grid using `.ws-cell` with one word marked
  `.found`.
- **Controls** row — icon + description + (Sudoku/Wordle only) a second mini preview: a scaled
  `.sudoku-key` palette, a scaled `.wordle-key` QWERTY keyboard. Word Search's Controls row instead
  shows a second mini grid with a diagonal `.preview`-highlighted line, demonstrating the drag
  gesture.
- **Game Modes** row — three sub-items (Daily Challenge / Classic or Tournaments or Challenge a
  Friend / Tournament), each a small icon badge + name + one-line description.
- A closing tip line ("Enjoy the challenge and have fun!").

All icons are small hand-written inline SVGs matching the app's existing outlined-icon style
(stroke, not fill) — explicitly **not** copies of the reference mockup's exact icon graphics, per
the user's preference. All mini previews are non-interactive (`pointer-events: none` on the
wrapper, `tabindex="-1"`/plain `<span>` instead of `<button>` for decorative keys, `aria-hidden`).

The shared layout (`.htp-card`, `.htp-banner`, `.htp-logo`, `.htp-row`, `.htp-icon-badge`,
`.htp-modes`, `.htp-tip`, etc.) lives in `components.css` since all three pages use it; each page's
own CSS file only keeps its game-specific mini-visual overrides (`.htp-mini-sudoku`,
`.htp-mini-wordle-row`, `.htp-mini-wordle-keyboard`, `.htp-mini-wordsearch`).

**Placement follow-up:** the How to Play block was moved to sit *after* the bottom ad slot on all
three game pages (was originally between the game and the bottom ad).

### 8.7 SEO meta tags + a pre-existing stale-domain bug

Added to every page eventually (game pages, legal pages, About): a real `<meta
name="description">` (this tag was missing site-wide before this session — only the Open-Graph/
Twitter variants existed), and `<link rel="canonical">`.

**Bug found while doing this:** every page's `og:url`/`og:image`/`twitter:image` pointed at
`daily-mind-challenge.web.app` — the project's *old* Firebase alias (`.firebaserc`'s `"old"` key),
not the live custom domain. Fixed to `dailymindchallenge.com` everywhere, across all 10 pages that
existed by the end of the session (`index.html`, `wordle.html`, `sudoku.html`, `wordsearch.html`,
`leaderboard.html`, `profile.html`, `settings.html`, `admin.html`, `privacy-policy.html`,
`cookie-consent.html`; `about.html` was written correctly from the start).

### 8.8 Interactive cookie consent banner + admin toggle

Earlier in the session, the Cookie Consent Notice page (8.4) was flagged as informational-only,
not a real consent mechanism — this closed that gap.

**`src/js/utils/cookie-consent.js`** (new) — `initCookieConsentBanner()`, called from
`app.js#loadHeaderFooter()` on every page (not awaited). Shows an Accept/Decline bar fixed to the
bottom of the viewport on first visit. The choice (`'accepted'`/`'rejected'`) is stored in
`localStorage` under `dmc_cookie_consent` (wrapped in try/catch for private-browsing/storage-
blocked cases) — a genuinely per-browser, not per-account, concept, and this is the app's first
use of `localStorage` anywhere. Declining calls Firebase Analytics' own `setConsent()` (a thin
wrapper around Google Consent Mode's `gtag('consent', 'update', ...)`) to set
`analytics_storage`/`ad_storage`/`ad_user_data`/`ad_personalization` to `'denied'` — this is the
mechanism Google expects apps to use; it doesn't block the Analytics SDK from loading, it signals
Google's own systems to restrict data use. Because each page mounts its own fresh Analytics
instance, a previously-stored choice is re-applied via `setConsent()` on every page load (not just
the page where the banner was originally answered).

**Admin toggle:** a new `cookieConsent` config (`{ enabled: true }` by default) added to `Admin →
General`, rendered by the existing generic config-form system. This required extending
`admin-page.js`'s `renderConfigForms()` to support a `type: 'checkbox'` field (previously only
text/number/textarea) — reads `.checked` instead of `.value`, a small reusable addition, not a
one-off hack.

### 8.9 Broken-link audit

A full pass, run both statically and live against `dailymindchallenge.com`: every internal
`href` cross-checked against `firebase.json`'s actual routes and confirmed each destination file
exists; every CSS/JS/image reference confirmed present on disk; the one dynamically-built link in
JS (Wordle's `?challenge=` deep link) confirmed valid; all 4 `og:image`/`twitter:image` share
images confirmed to load live; all 7 external links (Facebook Page/Group, Instagram, Google's
AdSense/policy pages) confirmed to resolve. **Nothing broken found** — verification-only, no code
changed.

### 8.10 Final AdSense-readiness checklist (status at end of session)

**Done:** Privacy Policy, Cookie Consent Notice (informational page *and* a real interactive
consent banner), game pages viewable without login, About & Contact with a non-personal email,
footer links, real meta descriptions + canonical tags, the stale-domain bug fixed everywhere,
substantial real content on every game page, broken-link audit clean.

**Still open, not code the assistant can finish alone:**
- **`ads.txt`** — cannot be created with real content until a Google AdSense Publisher ID exists,
  which only happens after signing up. Not actually a blocker to *applying* — Google asks for it
  after approval. Come back to this once a Publisher ID exists.
- **Setting up the `support@dailymindchallenge.com` mailbox/forwarding** — the site links to it;
  the user still needs to create the actual forwarding rule.
- **Signing up for AdSense itself and submitting the site** — entirely account-side, on Google's
  own site, not something achievable from inside this codebase.
- Optional/lower-priority, not done: meta descriptions on the still-gated pages (leaderboard/
  profile/settings/admin) — skipped deliberately, since those pages aren't crawlable anyway and
  there's no SEO value in adding them.

---

## 9. Admin panel polish (CSV import, duplicate prevention, grouping, layout)

### 9.1 CSV format hints + duplicate validation for Daily content

Format-hint text (`.form-hint`) added directly under each Daily import control in `admin.html`
for all three games, describing the exact expected CSV row shape.

Duplicate validation added to both the single "Add" and the bulk "Import" paths, in
`wordle-admin.js`/`sudoku-admin.js`/`wordsearch-admin.js`:
- **Wordle**: rejects a word (case-insensitive) already anywhere in the Daily Words pool, or
  repeated within the uploaded file.
- **Sudoku**: rejects an exact-duplicate 81-digit puzzle string.
- **Word Search**: rejects a duplicate *word set* — same 10 words regardless of order or theme
  (`wordSetSignature()`, a sorted/uppercased join).

Bulk imports validate everything up front, before any Firestore write, and reject the whole file
on any single duplicate — no partial imports. Scope was deliberately limited to Daily content's
add/import paths only; editing an existing entry (`updateDailyWord()` etc.) was left untouched.

### 9.2 Year → Month nested grouping for Daily tables

**Problem:** a Sudoku Daily Puzzles pool seeded ~2+ years ahead turned into dozens of flat,
same-level month collapsibles — a very long scroll just to find one month.

**Considered and rejected:** Load More-style pagination (used elsewhere in the app for
Challenges/Leaderboard) — rejected because this list is forward-chronological and navigated by
"jump to a specific month," not "browse recent activity from the top"; Load More would mean
clicking through many pages just to reach a distant month.

**Implemented instead:** a `groupMonthsByYear()` helper wraps the existing month-groups Map,
producing a Year → Month two-level nested collapsible structure (`.admin-subsection` at the year
level, `.admin-subsection.admin-subsection-nested` — a lighter header background — at the month
level within it). No changes were needed to the existing click-toggle wiring
(`closest('[data-collapsible]')`-based), since it already generalizes correctly to nesting.
Applied identically to all three games' Daily tables.

**Follow-up:** the year/month containing today originally defaulted open — changed, per explicit
request, to **fully collapsed by default** across all three games, since even a single month's
list can be long. The now-dead default-open computation was removed, not just disabled.

### 9.3 Classic Puzzles: CSV import + difficulty-grouped display

Extended to Sudoku and Word Search's Classic Puzzles sections (previously add/edit-only, flat
id-ordered list):

- **New bulk-import functions**: `bulkAddClassicSudokuPuzzles()` (`difficulty,puzzle,solution` per
  line) and `bulkAddClassicWordsearchPuzzles()` (`difficulty,theme,word1,word2,...` per line —
  theme is always its own field, never optionally omitted like Daily's format, since Classic's
  word count already varies by difficulty (6 for Easy, 10 for Medium/Hard) so field-count alone
  can't disambiguate whether a theme is present).
- **Duplicate checks scoped per difficulty** — a duplicate puzzle/word-set is rejected only within
  the *same* difficulty's pool; the same content in two different difficulties is fine, since each
  difficulty's pool is picked from independently. Added to both single "Add" and bulk import.
- **Difficulty-grouped display**: replaced the flat list with three always-open collapsible groups
  (Easy/Medium/Hard) via a shared `groupByDifficulty()` helper (fixed Easy→Medium→Hard order,
  regardless of the interleaved insertion order caused by the shared numeric id counter).

### 9.4 Config-form label alignment fix

**Symptom (screenshot):** in a multi-field config form (e.g. Word Search Tournament Settings), a
label that happened to wrap to two lines ("Points for completing a puzzle") pushed its own input
box down, misaligning it against the other fields' single-line-label inputs in the same row.

**Fix:** `.config-form-field label` now reserves a fixed `min-height` (room for 2 lines) and uses
`display: flex; align-items: flex-end;` so a short single-line label bottom-aligns within that
reserved space — every label's last line sits directly above its input regardless of how many
lines the label text actually took. General fix, affects every multi-field config form on the
admin page, not just Word Search's.

---

## 10. Miscellaneous discussion (no code)

- **Wordle Tournament scoring explained**: `30 + 15×numWords + bonusPoints`, flat per word
  (doesn't reward guess efficiency the way Daily Challenge's attempts-bonus does) — user confirmed
  they consider this fair as-is; no change requested.
- **AdSense connection process explained**: account-side signup steps (Google's own site) vs.
  code-side steps (loader script, `ads.txt`, ad-unit placement into the existing 9-slot ad-space
  system already in this codebase, which is honestly *not* real AdSense today — it's a
  self-managed placeholder/image-ad system, per `src/js/utils/ads.js`'s own doc comment).
- **Marketing summary** of all three games written on request (short blurb covering each game's
  three modes) — content only, not saved as a separate file.
- **Claude Code session storage explained**: this conversation is saved under
  `~/.claude/projects/<encoded-project-path>/`, not inside the project/git repo itself; clearing
  the chat or starting a new project elsewhere doesn't delete it — it stays resumable by returning
  to this project directory.

---

## Files touched this session (non-exhaustive index, see git history/diffs for exact line-level changes)

**New files:**
- `src/html/privacy-policy.html`, `src/html/cookie-consent.html`, `src/html/about.html`
- `src/js/utils/cookie-consent.js`
- `src/js/admin/activity-summary-data.js`
- `docs/changelog-2026-08.md` (this file)

**Most-touched existing files:**
- `src/js/app.js` — Analytics init call site, `showLoggedOutHeader()`, cookie-banner wiring,
  footer share behavior.
- `src/js/pages/home.js` — removed `wireGameTileGate()`.
- `src/js/games/wordle/wordle-page.js`, `wordle-engine.js`, `sudoku-page.js`, `sudoku-engine.js`,
  `wordsearch-page.js`, `wordsearch-engine.js` — `trySession()` swap, sign-in prompts, delayed
  stopwatch starts, Wordle Attempts stat, Wordle Share button.
- `src/html/wordle.html`, `sudoku.html`, `wordsearch.html` — How to Play redesign, meta tags,
  domain fixes.
- `src/js/admin/admin-page.js`, `wordle-admin.js`, `sudoku-admin.js`, `wordsearch-admin.js` — CSV
  duplicate validation, Year/Month grouping, Classic CSV + difficulty grouping.
- `src/css/components.css`, `src/css/pages/{admin,wordle,sudoku,wordsearch}.css` — shared
  `.prose-content`/`.htp-*`/`.cookie-banner` styles, per-game mini-visual overrides, config-form
  alignment fix.
- `firebase.json` — new page rewrites (`/privacy-policy`, `/cookie-consent`, `/about`).
- `firebase/firestore.indexes.json` — new `(gameType, scoreDate)` composite index.
- Every game/mode data file under `src/js/games/*/` — `scoreDate` field addition.

## 11. Addendum — early September 2026

Work that happened after the AdSense-readiness push above, in later sessions.

### 11.1 `ads.txt` completed
Once a real AdSense Publisher ID existed, `src/ads.txt` was created with the actual line Google
provided (`google.com, pub-2846401176879660, DIRECT, f08c47fec0942fa0`) and deployed — this was
the one item from §8.10's checklist that had to wait on account-side signup.

### 11.2 AdSense's consent-message requirement (explained, not built)
Google's AdSense onboarding separately requires a **certified Consent Management Platform (CMP)**
for EEA/UK/Switzerland traffic — this is a different, more specific requirement than the custom
cookie-consent banner built in §8.8. That banner only signals Firebase Analytics/Google Consent
Mode; it isn't wired into the IAB Transparency & Consent Framework AdSense's real-time-bidding
ecosystem reads from, and isn't a "Google-certified CMP." Recommended (not yet implemented):
Google's own CMP with the 3-choice message (Consent / Do not consent / Manage options) — Google
would supply a script snippet to add to the site once that's set up. **Open item.**

### 11.3 Facebook/Instagram campaign brief
Built on request for handing to an external marketing agency: a Claude Artifact (design grounded
in the app's real brand colors and each game's own accent), plus a self-contained repo copy at
`docs/facebook-campaign-brief.md` with all logos/share-images copied into `docs/assets/campaign/`
(not just referenced from `src/`, since the agency has no codebase access), and a print-ready PDF
export (`docs/Daily-Mind-Challenge-Campaign-Brief.pdf`, generated via headless Chrome so every
image renders directly on the page rather than as a link). Includes a full mode-by-mode breakdown
of all three games, written for a non-technical audience.

### 11.4 Leaderboard bug: per-game tabs only showed Daily Challenge scores
**Symptom:** Word Search Tournament points weren't showing under the Word Search leaderboard tab
(reported by the user; Sudoku/Wordle's own tabs had the identical bug, unreported but confirmed by
code inspection).

**Root cause:** `getGameLeaderboard()` in `leaderboard-data.js` filtered with
`where('gameType', '==', gameType)` — an exact match against one literal string (e.g.
`'wordsearch'`). Each game actually writes multiple `gameType` values depending on mode (Daily,
Classic, Tournament, Tournament-bonus, and for Wordle, Challenge/Challenge-creator) — only the
Daily one matched, so Classic and Tournament scores were silently excluded from that game's own
tab (though still correctly counted on "Overall", which has no `gameType` filter at all). This is
a different bug from the `scoreDate` issue in §1/§8 — that one was the wrong *date field*; this one
was the *gameType filter* being too narrow.

**Fix:** added a `GAME_TYPES` map (each game's full list of gameTypes) and switched the query to
`where('gameType', 'in', GAME_TYPES[game])`. `wordle-challenge-creator` was deliberately included
in Wordle's list, so a player's Wordle-tab total stays consistent with the Wordle portion of their
Overall-tab total. No new Firestore index needed — Firestore treats `in` the same as `==` for
composite-index purposes, so the existing `(gameType, scoreDate)` index still covers it. Confirmed
with the user beforehand that this wouldn't require a backfill: unlike the `scoreDate` fix, the
underlying documents already had the correct `gameType` all along — only the query was wrong — so
every already-played Tournament/Classic score (written since the `scoreDate` fix) became correctly
visible immediately on deploy, no backfill needed.

### 11.5 Profile page: Recent Activity showed raw data for non-Daily scores
**Symptom (screenshot):** rows for Tournament scores showed the raw `gameType` string as the label
(e.g. `wordsearch-tournament-bonus` instead of a real name), a Firestore document key instead of a
date (`FnNzJ5bjIsmLLuFtgNEN`), and the literal text `(undefined)` instead of a time.

**Root cause:** `profile.js#renderHistory()` was written assuming every `gameScores` doc has the
Daily Challenge shape — a `gameType` of exactly `wordle`/`sudoku`/`wordsearch`, a `gameDate` that's
a real date, and a `timeTaken` formatted string. Tournament/Classic/Challenge docs break all three
assumptions (see §11.4 and the whole `gameDate`-repurposing story throughout this changelog) — this
was the same underlying architectural fact causing a third, separate display bug.

**Fix:** `GAME_LABELS` expanded to all 12 gameTypes across the three games (e.g.
`wordle-tournament` → "Wordle Tournament"); the date shown now prefers `scoreDate` (always real)
over `gameDate`; the time suffix is only appended when `timeTaken` actually exists, instead of
interpolating `undefined` as literal text. Display-only fix — no scoring data was touched. Old
Tournament rows written before the `scoreDate` fix will still show their raw key as the date (that
part isn't backfilled either), but the label and the "(undefined)" text are fixed for every row
regardless of age.

### 11.6 Known, unresolved: Safari-only footer disappears after playing Word Search
**Symptom reported:** after finishing a Word Search round and navigating to the home page (and
even a further game page after that), the footer doesn't render — persists until a manual refresh.
**Confirmed Safari-only** (not Chrome).

**Investigated, not yet fixed.** Ruled out via code inspection: no service worker, no
`pushState`/`history` manipulation, no `beforeunload`/`pagehide`/`visibilitychange` handlers
anywhere in the codebase — and `loadHeaderFooter()` injects the footer as the very first thing it
does, independent of and before any session/profile/game-specific logic, so a hang or error
elsewhere shouldn't be able to un-inject it. Leading hypothesis: Safari's back-forward cache
(bfcache), which is more aggressive than Chrome's about restoring a frozen page snapshot instead
of a real reload — this would specifically require the user to be navigating via the browser's
Back button or a swipe-back gesture, not fresh link clicks, which hasn't yet been confirmed. If
confirmed, the standard fix is a `pageshow` listener checking `event.persisted`, re-running setup
(or forcing a real reload) when a bfcache restore is detected. **Next step, if picked back up:**
confirm the exact navigation method being used, then decide whether to implement that fix
speculatively even without 100% confirmation, given the strong circumstantial match (Safari-only,
symptom persists across multiple subsequent page loads until refresh).

### 11.7 New doc: `docs/adding-a-new-game.md`
A checklist (not a chronological log) of every touchpoint a new fourth game would need —
requested after this session's leaderboard bug (§11.4) doubled as a concrete example of "the
things that are easy to forget when a new game/mode is added": no central "list of games" registry
exists anywhere in this codebase, so a new game means updating roughly a dozen independent
hardcoded lists (leaderboard `GAME_TYPES`, home page's `checkPlayedTodayAll()`, admin's
`ACTIVITY_ROWS`, Profile's `GAME_LABELS`, `AD_SLOTS`, and more) one at a time, not registering it
once.

### 11.8 Discussed, not built: "Wordle Plus" (variable-length Wordle variant)
The user is considering a fourth game — same three modes as Wordle (Daily/Tournaments/Challenge a
Friend), but with 6–12 letter words instead of a fixed 5, and explicitly **not** to be built as a
new mode inside existing Wordle (a separate game, existing Wordle untouched). Explain-only so far,
nothing implemented. Key points from that discussion, for whoever picks this up:

- `wordle-engine.js`'s core guessing mechanic is already word-length-agnostic (`wordLength =
  targetWord.length`, used throughout) — the engine doesn't need new logic, just reuse.
- Recommended: Wordle Plus should get **its own copy** of the engine
  (`games/wordle-plus/wordle-plus-engine.js`), not import Wordle's file directly — matching this
  codebase's existing precedent of each game keeping its own copy of near-identical logic (see how
  `wordle-summary-modal.js`/`sudoku-summary-modal.js`/`wordsearch-summary-modal.js` are already
  three separate, nearly-identical files by design) and guaranteeing zero risk to the existing,
  explicitly-must-not-change Wordle game.
- Being a full separate game (not a mode), the entire checklist in §11.7/`docs/adding-a-new-game.md`
  applies: own home tile, own leaderboard tab + `GAME_TYPES` entry, own gameType family
  (`wordle-plus`, `wordle-plus-tournament`, `wordle-plus-challenge`, `wordle-plus-challenge-creator`),
  own Firestore collections/rules, own admin section, own entries everywhere the three existing
  games are hardcoded.
- Open design decisions flagged, not yet answered: whether word length is fixed or varies
  puzzle-to-puzzle within 6–12 (affects how much responsive-CSS board-sizing work is needed since
  the current tile CSS is sized for exactly 5 letters), what the guess budget should be (classic
  Wordle's 6 is tuned for 5 letters specifically, and the attempts-bonus point formula is sized to
  match whatever that number is), and who sources the 6–12 letter word content.

## Every JS/CSS/HTML file's own `CLAUDE.md` was kept up to date alongside its code

This project keeps a `CLAUDE.md` file in most source directories documenting that directory's
"why," not just its "what." Every change in this session that touched a documented file also
updated that file's `CLAUDE.md` in the same pass — those docs are the fastest way to re-orient on
any of the above without re-reading this changelog, and are more likely to stay accurate over time
since they live next to the code they describe.


---

# Addendum: 2026-09-13 to 2026-09-20

Work after §11. Numbering restarts here; the file name says 2026-08 for historical reasons.

## A. Achievements

- **Registry replaced wholesale** with a user-supplied 67-achievement list (per-game Level tiers,
  Daily/Weekly/Monthly Championship win-count tiers, 5 streak milestones, 8 global ones). Old ids
  just stop being evaluated (orphan docs are harmless). Three decisions confirmed with the user:
  Daily Champion base tier = "win once"; Perfect Day = a *win* in all 3 games (Wordle/Word Search
  have no clean "error"); Triple Threat needs a new lifetime `perfectDayCount` counter.
- **Bug: sibling tiers all showed In Progress at once** (e.g. Wordle Daily Champion 30/50/100 all
  "7/x"). Fix: a `family` (+ `familyOrder` for the all-games tiers, which share `target: 3`) field;
  `profile.js` lets only the lowest not-yet-earned tier of each family show progress.
- **Not Started icons** are the real badge, grayscaled, not a lock. Strip layout changed from
  flex-wrap (13 tiny icons/row) to a 5-column grid with a matching icon size cap.
- **Badge art pipeline**: user uploads land in `src/assets/images/New/` under auto-generated
  "ChatGPT Image..." names. Each is viewed to identify it, MD5-checked (several were byte-identical
  re-uploads and were discarded), trimmed/squared/resized to 240x240 into `images/achievements/`,
  and the original is renamed to the same `{achievementId}.png`. One early upload had no alpha
  channel (opaque background) and needed a corner flood-fill; later batches were real RGBA.
  Final state: **67/67 achievements have art**.
- **+250 XP per unlock** (`awardAchievementXp`, called once per achievement from both
  `syncPlayerAchievements` and `claimChampionshipAchievements`; kept under the 300-XP rules cap).

## B. XP and Levels

- Overall Level changed from 500 to **1,000 XP per level** and now displays from Level 1 (display-only
  `+1`, same convention as Game Level; the math stays 0-indexed). `XP_PER_LEVEL` is exported and
  `calculateOverallProgress` returns `xpIntoLevel`, replacing two hardcoded copies of `500`.
- Points and XP now render with thousands separators everywhere (`toLocaleString()`).

## C. Leaderboard and profile popup

- Rows show each player's sub-rank avatar (Guest badge for guests), resolved with a batched
  `documentId() in [...]` XP lookup only for rendered rows.
- **Click a row -> player profile popup** (`player-profile-modal.js`): rank-colored header, stats,
  Overall Level card, earned badges. "Global Rank" needs the unbounded all-time scan, so it is
  fetched once per page and cached. Bug fixed along the way: the dialog's `overflow: hidden`
  clipped long badge lists instead of scrolling; badges are now a one-row, vertical-only scroller.
- `/leaderboard` now uses `trySession()`, so anonymous visitors and crawlers see it.

## D. Home page

- Status card: sub-rank avatar, name-only heading (the "Welcome back," prefix was dropped after long
  names crowded the Level card), rank, streak + Total XP, and a Level/XP progress card. The
  "complete every game" hint and its plumbing were removed. Missions/Achievements became two
  full cards with a "View" pill.

## E. Wordle Daily Challenge redesign

- A failed attempt no longer reveals the word or scores. The player can retry the same word after a
  **1-hour cooldown** (live countdown), unlimited times until solved or the day ends. Confirmed
  with the user: same word, unlimited retries, retry wins score normally.
- New `wordleDailyAttempts/{uid}_{date}` collection (attempt count, won flag, server-timestamped
  `lastAttemptAt`); only a win writes `gameScores`, so XP/streak/perfect-day now key off a win.
  The engine gained `revealAnswerOnLoss` (Daily passes false; Tournament/Challenge unchanged).
- **Admin toggle** for the dictionary word check (`config/wordValidationAPI.enabled`). Bug found:
  a config doc saved before a new field existed rendered its checkbox *unchecked* while the feature
  was actually on; `renderConfigForms` now falls back to `CONFIG_DEFAULTS`. Checkbox CSS fixed
  (generic text-input styling had been applied to checkboxes).

## F. AdSense "Low value content" rejection response

- Each game page: Tips & Strategy row and a 20-question FAQ (`<details>`), grounded in real code
  behavior (scoring, local-midnight reset, per-difficulty word directions, retry rule).
- New: Terms of Service page, expanded About, `robots.txt`, `sitemap.xml`, custom `404.html`,
  leaderboard meta tags. Not fixable in code: Google also weighs site age/traffic. Blog was assessed
  as feasible (Firestore + a `/blog/**` rewrite) but deferred; per-post OG tags would need
  server-side rendering.

## G. Production deployment (2026-09-15/16)

- First production deploy of rules + hosting in this whole line of work (rules had never been
  deployed). **Gotcha:** `.firebaserc` default `playdailymindchallenge` belongs to the
  `lazyprogrammer88@gmail.com` account; `gayan.sliit2009@gmail.com` only sees the old
  `daily-mind-challenge` project, and `firebase use` pointed at the old one. Deploy with
  `firebase login:use lazyprogrammer88@gmail.com` and `--project playdailymindchallenge`.
- Local test data (seeded scores, achievements, users) lives only in the emulator and was never
  pushed to production.

## H. Documentation

- CLAUDE.md files, FRS, deployment, architecture, marketing brief and the adding-a-game checklist
  were refreshed 2026-09-20. The campaign brief PDF is still an older export.
