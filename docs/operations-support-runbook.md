# Operations and Support Runbook
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | New as of 2026-10-17. Describes real, currently-available operational tooling for this project — a single-owner-operated, serverless product with no dedicated ops team. Gaps are flagged explicitly rather than papered over with aspirational process. |
| **Related docs** | `docs/deployment-and-release-document.md`, `docs/solution-architecture-document.md`, `docs/database-design-document.md` |

---

## 1. Monitoring

| What | Tool | Notes |
|---|---|---|
| Hosting traffic/errors | Firebase Console → Hosting | Request counts, bandwidth; no custom dashboards configured |
| Firestore usage | Firebase Console → Firestore → Usage tab | Read/write/delete counts, storage size; the primary lever for Firestore cost |
| Authentication activity | Firebase Console → Authentication → Users | User count, sign-in methods in use |
| Site analytics | Google Analytics (via Firebase Analytics) | Page views, account-type segmentation (guest vs. registered) — see FR-12 in the SRS |
| Ad performance | Google AdSense dashboard (once approved) | Not yet active as of this writing |
| Meta ad/pixel activity | Meta Events Manager (Overview + Test Events tabs) | PageView events only; Overview updates in batches (can lag by an hour or more), Test Events is closer to real-time |
| Search indexing | Google Search Console + Bing Webmaster Tools | Both verified and have the sitemap submitted; the **Pages**/**Coverage** report in each shows indexing status per URL |

**Gap:** there is no unified monitoring dashboard, no uptime monitor, and no error-tracking SDK
(e.g. Sentry) capturing client-side JavaScript exceptions from real users. The only way to see a
client-side error today is to reproduce it yourself in a browser's own DevTools console.

## 2. Logging

There is no centralized application log. What exists:
- **Firebase Hosting access logs** — available per-request in the Hosting console, not aggregated
  or searchable beyond Firebase's own UI.
- **Browser console `console.error()` calls** — scattered through the client code at points where
  a Firestore operation fails unexpectedly (e.g. "gameScores write failed"), visible only to
  whoever is looking at that specific browser's DevTools at that moment. These are not collected
  or shipped anywhere.
- **Git history** — the closest thing to an operational log of *changes* (not runtime behavior).

**Gap:** no structured, centralized logging exists. A production issue that doesn't reproduce in
front of a developer is effectively invisible today.

## 3. Alerts

**None are configured.** There is no alerting on Firestore quota approach, authentication anomaly,
error rate, or downtime. The product owner would only learn of an outage or a spike in errors by
either checking the Firebase Console proactively or being told by a user. This is the single
biggest operational gap for a product with paying advertisers (Meta Pixel data quality) and real
user accounts.

**Recommendation, not yet adopted:** Firebase's own budget alerts (Console → Usage and billing →
Budgets & alerts) are a near-zero-effort first step, giving at least a cost-spike signal, which
often correlates with a traffic or bug spike worth investigating.

## 4. Troubleshooting Guide

| Symptom | Likely cause | First thing to check |
|---|---|---|
| A page shows "Couldn't load — check Firestore rules are deployed" | `firebase/firestore.rules` wasn't deployed alongside new client code that depends on it, or a required composite index isn't built yet | `firebase deploy --only firestore:rules,firestore:indexes`; check the Firestore Console's Indexes tab for "Building" vs. "Enabled" |
| Quilt page says "Today's Quilt isn't ready yet" (or a Classic size says "not ready yet") | The Daily pool is empty or has run past its last date, or that Classic difficulty has no pictures | Admin → Quilt → Daily / Classic: add pictures (Preview, then Add). Check the Daily table's last date; test pictures can be recovered with `git checkout deaffe8 -- docs/quilt-content` |
| Admin → Quilt Preview rejects a picture | It can't become a uniquely solvable puzzle (too much single-pixel detail), has more than 8 colours (usually an anti-aliased PNG), or a bad size/row length | The card shows the exact reason; redraw blockier, export at 1 pixel per cell with smoothing off, or fix the text rows |
| A player reports they can't replay a Daily Challenge they believe they lost | Working as designed for Wordle/Connections (a loss doesn't allow immediate retry — see the 1-hour cooldown, FR-2.4/FR-5.5) | Confirm which game; check `wordleDailyAttempts`/`connectionsDailyAttempts/{uid}_{date}` for `lastAttemptAt` |
| Cookie banner never appears for a visitor | `config/cookieConsent.enabled` is `false` (admin-disabled), or (pre-fix) a slow Firestore read — see `docs/technical-design-document.md` §4 | Admin panel → General → Cookie Consent toggle; confirm the fix (1.5s timeout) is deployed |
| Meta Pixel shows no events in Events Manager | Most likely: the visitor declined cookies (by design, no pixel loads); otherwise a domain-verification or Business Settings connection issue on Meta's side | Check with Meta Pixel Helper/Validator in a normal (non-private) browser window with cookies accepted; confirm the domain is verified and connected to the pixel in Business Settings |
| `.web.app` and the custom domain show different content | A deploy only updated one — not actually possible with the current single-site Hosting setup (both are served by the same release), but worth ruling out a propagation delay | Re-run `firebase deploy --only hosting`; both domains serve the same release atomically |
| An admin content import silently does nothing | A validation error was shown as a toast that was missed, or the batch had a duplicate | Re-check the exact error toast text; duplicates are rejected with the specific entry named |
| Leaderboard "All-time" is slow to load | Expected at current scale — it's an unbounded client-side aggregation over the full `gameScores` collection (see SAD §7, Scalability) | Not a bug; a future scaling concern if traffic grows significantly |

## 5. Health Checks

No automated health-check endpoint exists (there's no backend to probe). A manual health check,
run after every deploy, is:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dailymindchallenge.com/
curl -s -o /dev/null -w "%{http_code}\n" https://dailymindchallenge.com/connections
curl -s -o /dev/null -w "%{http_code}\n" https://dailymindchallenge.com/quilt
curl -s -o /dev/null -w "%{http_code}\n" https://dailymindchallenge.com/sitemap.xml
curl -s -o /dev/null -w "%{http_code}\n" https://dailymindchallenge.com/google9a4fa05185ef4666.html
curl -s -o /dev/null -w "%{http_code}\n" https://dailymindchallenge.com/BingSiteAuth.xml
```
All should return `200`. The last two must return `200` directly, never a `3xx` redirect — see
`docs/deployment-and-release-document.md`'s "Search engine verification files" section for why a
redirect there is a real regression, not a cosmetic one.

## 6. Backup and Recovery

**Firestore:** no scheduled export/backup is currently configured for this project. Firestore
supports both Point-in-Time Recovery and scheduled exports to Cloud Storage, but neither has been
set up. **This is the most consequential gap in this runbook** — as of this writing, there is no
tested recovery path for accidental mass data deletion or corruption beyond Firestore's own
default retention of deleted-document history, which is not a substitute for a real backup.
**Recommendation, not yet adopted:** enable either Point-in-Time Recovery (simplest, Google-managed)
or a daily scheduled export (`gcloud firestore export`) via Cloud Scheduler, before this product
holds data the owner isn't prepared to lose.

**Hosting:** every release is retained indefinitely in Firebase Hosting's release history and can
be rolled back to instantly (see `docs/deployment-and-release-document.md`'s Rollback Procedures).
This part is already well-covered.

**Source code:** Git, pushed to GitHub (`gayan88/Daily-Mind-Challenge`). Standard git history
recovery applies; no additional backup needed beyond normal GitHub availability.

## 7. Incident Handling

No formal incident-response process exists (no severity levels, no on-call rotation, no incident
postmortem template). Given the single-operator scale, the practical process is: the operator
notices or is told about an issue, diagnoses it using §4 above, fixes the code if needed, and
deploys the fix — all informally, in one continuous session.

**Recommendation, not yet adopted:** a short `INCIDENTS.md` (date, what happened, root cause, fix,
what would have caught it sooner) costs little and becomes valuable the moment there's more than
one person touching this system, or once there's enough traffic that the same class of incident
could plausibly recur.

## 8. Operational Procedures

### Seeding new Daily content
Admin panel → the relevant game's section → paste or import a batch in that game's accepted
format (see `docs/content-creation-guide.md`). Content is add-only and auto-dated sequentially —
there is deliberately no delete for individual Daily entries (removing one from the middle would
leave a permanent gap on that date); corrections go through the Edit action instead.

### Finalizing a Championship period
Admin panel → "Manual Executions" → either finalize an individual ready period or "Run All
Eligible." See FR-10.6 in the SRS and `src/js/progression/championship-service.js`'s own
documentation for the safe-to-finalize timing logic (12 hours past a period's close in UTC, so
every timezone has had a chance to play that period).

### Moderating a user
Admin panel → General → Moderate Users → search by username → toggle banned/admin status. A banned
user is signed out on their next profile-load attempt.

### Rotating/updating a third-party credential
Not applicable in the traditional sense — the Firebase Web SDK config is not a secret (see the API
Documentation's Authentication section), and there are no other server-side secrets in this
system. The Meta Pixel ID is also not sensitive (it's visible in the page source by design).
