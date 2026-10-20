# Test Plan and Test Cases
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | New as of 2026-10-17. Describes the testing strategy actually used to build and validate this system, and a representative set of test cases — not a description of an automated suite, because none exists. |
| **Related docs** | `docs/functional-requirements-specification.md` §8 (Validation & Testing Approach), `docs/solution-architecture-document.md` |

---

## 1. Testing Scope

**In scope:** functional correctness of all six games (Daily/Classic/Tournament modes),
authentication flows, the progression system (Points/XP/Rank/Streaks/Achievements/Championships),
the admin panel, Firestore security rules, and third-party integration behavior (cookie consent,
Meta Pixel, SEO verification files).

**Out of scope:** load/performance testing, penetration testing, accessibility audits beyond the
NFR-8 spot checks already noted in the SRS, and cross-device visual regression testing.

## 2. Test Strategy

There is **no automated test suite** — no unit tests, no integration tests, no end-to-end test
framework configured in this repository (no `package.json` test script, no CI pipeline). This is
an accepted, documented characteristic of the project's current scale, not an oversight. Testing
has instead relied on three complementary techniques, used throughout the project's development:

### 2.1 Manual exploratory testing against the Firebase Local Emulator Suite
The primary method for verifying new features before they ship. `firebase emulators:start`
(Firestore + Auth) gives a throwaway, production-rules-enforcing environment: `src/js/api/
firebase-init.js` automatically points at `localhost:8080`/`9099` when the site is served from
`localhost`/`127.0.0.1`. A developer signs up test accounts (including a manually-promoted admin
account), seeds content via the real admin panel, and plays through each mode by hand.

### 2.2 Scripted browser automation for repeatable or hard-to-click-through scenarios
For scenarios impractical to repeat by hand on every change (e.g. "does the cookie banner still
double-render," "does a Daily Challenge loss correctly withhold points across four different
games"), short one-off Node.js scripts drive headless Chrome via the DevTools Protocol —
navigating, clicking, reading `localStorage`/DOM state, and capturing screenshots or console
errors. These scripts are throwaway (written into a session-scoped scratch directory, not checked
into the repository) rather than a maintained suite, but they exercise exactly the same UI a real
user would, rather than calling internal functions directly.

### 2.3 Live production verification after deploy
For changes with no safe way to fully rehearse locally (third-party integrations like Google
Search Console, Bing Webmaster Tools, and the Meta Pixel, which require real, publicly-reachable
URLs and external platforms that don't have a local-emulator equivalent), verification happens
against the live site immediately after deploying: HTTP status/content checks via `curl`, and the
third party's own validator tools (Meta's Pixel Helper/Validator extension, Meta Events Manager's
Test Events, Google's Search Console, Bing Webmaster Tools).

## 3. Test Environments

| Environment | Data | Used for |
|---|---|---|
| Local Emulator Suite | Firestore + Auth emulators, empty on each restart, manually seeded per test session | Functional testing of any Firestore-touching feature before it's considered done |
| Local static server (`python3 -m http.server`, no emulators) | None (no Firestore connection) | Pure front-end/styling checks only; doesn't exercise clean URLs (`firebase.json` rewrites aren't known to a plain static server) or Firestore-backed behavior |
| Production (`dailymindchallenge.com`) | Real, live player data | Final verification after every deploy; the only environment where third-party integrations can be fully validated |

There is no separate staging/QA Firebase project — see `docs/deployment-and-release-document.md`'s
Environment Configuration section.

## 4. Representative Test Scenarios

| ID | Scenario | Steps | Expected Result |
|---|---|---|---|
| TC-1 | Guest completes a Wordle Daily Challenge win | Guest session; play to a correct 6th-or-fewer guess | `gameScores` doc written with correct score breakdown; summary modal shown; replay blocked until next calendar day |
| TC-2 | Wordle Daily Challenge loss and hourly retry | Guest session; exhaust all 6 guesses without solving | No `gameScores` doc written; retry countdown shown; board playable again (reshuffled content where applicable) after the cooldown elapses |
| TC-3 | Connections "one away" detection | Select 4 words, 3 of which belong to one hidden group | "One away!" message shown; mistake counted; group not revealed |
| TC-4 | Duplicate Daily-content import rejected | Admin uploads a batch where one entry duplicates an existing pool entry | Entire batch rejected; zero documents written; admin shown which entry failed |
| TC-5 | `gameScores` replay-write rejected at the rules layer | Simulate a second `setDoc` to an already-existing `gameScores/{uid}_{gameType}_{date}` ID directly (bypassing the client's own pre-check) | Firestore rejects the write (`permission-denied`), confirming the guarantee is server-side, not just UI-side |
| TC-6 | Score write exceeding the point cap | Attempt a `gameScores` create with `score` above that `gameType`'s configured cap | Write rejected |
| TC-7 | Admin-only write attempted by a non-admin | A registered, non-admin user attempts to write to a `*DailyPuzzles` collection directly | Write rejected |
| TC-8 | Cookie banner shows once per page, even when setup runs twice | Load the home page fresh (triggers `loadHeaderFooter()` twice) | Exactly one `.cookie-banner` element in the DOM; a single Accept/Decline click dismisses it |
| TC-9 | Cookie banner doesn't hang on a slow config read | Simulate a slow/unresponsive `config/cookieConsent` read | Banner still appears within ~1.5 seconds, defaulting to shown |
| TC-10 | Meta Pixel never loads before consent | Fresh browser profile, load the home page, inspect network requests before any click | No request to `connect.facebook.net` or `facebook.com/tr` |
| TC-11 | Meta Pixel loads after Accept | Click Accept on the cookie banner | `fbevents.js` and a `PageView` request are sent; `window.fbq` is defined |
| TC-12 | Meta Pixel declines to load after Decline | Click Decline on the cookie banner | `window.fbq` remains `undefined`; no Meta network requests at any point in the session |
| TC-13 | Rank display at the Legend X boundary | Set a test account's `xp` to 274,999, then to 275,000+ | At 274,999: "Legend X," 4,999/5,000 progress. At 275,000 or beyond: "Legend X," 100%, "Max rank reached!" |
| TC-14 | "Perfect Day" requires every game | Complete 5 of 6 Daily Challenges (not Pounce), then check Perfect Day status; then complete the 6th | Not awarded after 5; awarded after the 6th, same calendar day |
| TC-15 | Admin cannot play a game | Log in as an admin, navigate to any game page | Game mount shows an "admins don't play games" state, not a playable board |
| TC-16 | Search-engine verification files serve correctly | `curl` the exact verification URLs for Google and Bing | Both return HTTP 200 directly (no redirect), with content byte-for-byte matching what each service issued |
| TC-17 | Tournament failure resets progress (Wordle/Connections) | Fail one puzzle/word partway through a multi-puzzle Tournament run | `currentWordIndex`/`currentPuzzleIndex` resets to 0; no points banked for that run |
| TC-18 | Tournament failure banks partial credit (Sudoku/Word Search/Quilt) | Fail one puzzle partway through a multi-puzzle Tournament run | A lower point value is banked immediately for that puzzle; the run advances to the next puzzle rather than resetting |
| TC-19 | Quilt rule errors shown immediately | Draw a rectangle with no number, two numbers, or the wrong area | It's outlined red at once; the Pieces counter doesn't count it; the board isn't solved |
| TC-20 | Quilt picture stays hidden until solved | Place several correct rectangles, then finish the board | Pieces show neutral tints while playing; only on the final valid rectangle do they all take the picture's colours |
| TC-21 | Quilt Perfect Stitch | Solve once with no undo/removal, once after one undo | +5 Perfect Stitch only on the first; the score doc's `perfect` matches |
| TC-22 | Quilt Daily share text never contains the picture | Solve the Daily, use "Copy Result & Share with Community" | Clipboard has stats only (no emoji squares); Classic/Patchwork Run share text does include the emoji mosaic |
| TC-23 | Quilt admin import is all-or-nothing | Preview a batch where one picture is invalid or already in the pool | No Add button / batch rejected, nothing written, the bad picture named with its reason |
| TC-24 | Patchwork Run bulk import | Upload `docs/quilt-content/test-patchwork-runs-100.txt` (removed 2026-10-20; recover with `git checkout deaffe8 -- docs/quilt-content`), 2×2, Inactive, Create; activate one | 100 inactive runs in file order; players see only the activated run; re-importing the same file is rejected |
| TC-25 | Pounce wrong cat | Place a cat on a wrong cell (Daily) | It hisses off, leaves a ✕, Hisses +1; the summary shows −2; no Purrfect |
| TC-26 | Pounce Whisker Tip | Cross out a real cat spot, press Whisker Tip; press it again | First tip clears that ✕ and says so; the next highlights cells and explains a deduction; Tips counter +1 each |
| TC-27 | *(Withdrawn 2026-10-21 with Zen mode)* Pounce has exactly three mode tabs | Open `/pounce` | Daily Challenge, Classic, Nine Lives Run — no Zen tab |
| TC-28 | Nine Lives Run lives | Lose a life, reload mid-board; time out a board; lose the last life | Lives stay lost after reload; timeout banks 10 and costs a life; 0 lives ends the run, no completion bonus |
| TC-29 | Pounce admin generate | Admin → Pounce → Daily: start date, 365, Generate, Add; add 5 more | `_meta` covers 365 then 370 days in order; preview shows the grade spread; second batch continues from the last date |
| TC-30 | Cat Café | Solve a Daily Pounce, open the profile | Cat Café shows that date's cat (same name/look as the summary), newest first |

## 5. Test Data

No synthetic/fixture data files are maintained in the repository (Pounce generates its own content; `tools/pounce-emulator-seed.mjs` seeds the emulators), except Quilt's:
`docs/quilt-content/` (removed from the repo 2026-10-20; recover with `git checkout deaffe8 -- docs/quilt-content`) held generated test pictures (500 Daily, 300 Classic, 100 Patchwork Run), each
verified to make a uniquely solvable puzzle — see its README. Test accounts and content are
created ad hoc per test session against the emulator (a registered test user, manually promoted to
`isAdmin: true` via a direct emulator REST write, plus admin-panel-seeded puzzle content for each
game). `docs/content-creation-guide.md` documents the exact file formats accepted by each game's
admin import, useful for quickly generating realistic bulk test content.

## 6. Execution Status

Not tracked in a formal test-management tool. Historically, each feature's manual/scripted
verification happens once, at the time it's built, as part of the same working session — there is
no regression suite that re-runs the scenarios in §4 on a schedule or before every deploy. This is
a real gap: a change to shared code (e.g. `rank-service.js`, `cookie-consent.js`) relies on the
developer remembering which scenarios it could affect and re-checking them manually, rather than
an automated suite catching a regression.

The Quilt release (2026-10-18) was the exception: before handing over the deploy, every Quilt mode
plus a regression smoke pass over all five games was run end to end against the emulators with
scripted headless Chrome — results in `docs/quilt-release-notes.md`. Those scripts lived in a
scratch folder, so they aren't re-runnable from the repo yet.

## 7. Defect Tracking

No issue tracker (e.g. GitHub Issues) is actively used for this project as of this writing. Defects
found during development are fixed directly, in the same session they're found, with the fix
described in the corresponding git commit message. **Recommendation, not yet adopted:** if the
project grows beyond single-session, single-developer iteration, adopting GitHub Issues (already
available at no extra cost via the existing repository) for anything that can't be fixed
immediately would be the lowest-friction next step.

Pounce (2026-10-20) keeps its scripted tests in the repo: `tools/pounce-soak-test.mjs` (puzzle core,
1000 boards per difficulty), `tools/pounce-browser-test.mjs` (engine), and `tools/pounce-e2e-test.mjs`,
`pounce-e2e-modes-test.mjs`, `pounce-e2e-admin-test.mjs` against the emulators. Results:
`docs/pounce-release-notes.md`.
