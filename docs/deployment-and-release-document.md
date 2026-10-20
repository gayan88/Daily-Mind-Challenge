# Deployment and Release Document

| | |
|---|---|
| **Document status** | Reflects the system as implemented, as of 2026-10-17. Formerly `docs/deployment.md`; renamed and expanded to the Deployment and Release Document template (build instructions, environment configuration, deployment steps, release notes, database migrations, rollback procedures, release approvals). |
| **Related docs** | `docs/solution-architecture-document.md`, `docs/operations-support-runbook.md`, `docs/database-design-document.md` |

Deployed on Firebase Hosting, project **`playdailymindchallenge`** (the `default` in `.firebaserc`; `daily-mind-challenge` is the old, retired project -- do not deploy there). Live at the custom domain `dailymindchallenge.com` (the canonical/OG tags, the sitemap, and Google Search Console are all set up against this domain, not the Firebase one) -- the auto-provisioned `playdailymindchallenge.web.app` also stays live serving identical content, see "Custom domain" below.

**Account gotcha:** the real `playdailymindchallenge` project lives under the **`lazyprogrammer88@gmail.com`** Google account, not `gayan.sliit2009@gmail.com` (which only sees the old project). If `firebase deploy` fails with "Failed to get Firebase project", run `firebase login:use lazyprogrammer88@gmail.com` first and always pass `--project playdailymindchallenge` explicitly -- `firebase use` may still point at the old project.

## Firebase project setup (one-time, manual)

Covered in full in the root `README.md` — summary: create a Firebase project, enable the **Anonymous** and **Email/Password** Auth providers, create a Firestore database, register a web app and paste its config into `src/js/api/firebase-config.js`, then publish `firebase/firestore.rules` and the indexes in `firebase/firestore.indexes.json` via the Firestore console.

## Hosting config (`firebase.json`)

```json
{
  "hosting": {
    "public": "src",
    "cleanUrls": false,
    "rewrites": [
      { "source": "/", "destination": "/html/index.html" },
      { "source": "/leaderboard", "destination": "/html/leaderboard.html" },
      { "source": "/profile", "destination": "/html/profile.html" },
      { "source": "/settings", "destination": "/html/settings.html" },
      { "source": "/admin", "destination": "/html/admin.html" },
      { "source": "/wordle", "destination": "/html/wordle.html" },
      { "source": "/sudoku", "destination": "/html/sudoku.html" },
      { "source": "/wordsearch", "destination": "/html/wordsearch.html" },
      { "source": "/connections", "destination": "/html/connections.html" },
      { "source": "/quilt", "destination": "/html/quilt.html" },
      { "source": "/privacy-policy", "destination": "/html/privacy-policy.html" },
      { "source": "/terms-of-service", "destination": "/html/terms-of-service.html" },
      { "source": "/cookie-consent", "destination": "/html/cookie-consent.html" },
      { "source": "/about", "destination": "/html/about.html" }
    ]
  }
}
```

- **`public: "src"`** — the file structure under `src/` (`html/`, `css/`, `js/`, `partials/`, `assets/`) stays exactly as documented in `src/html/CLAUDE.md` and friends; hosting config is a presentation layer on top, not a physical reorganization.
- **`rewrites`** — map each clean production URL to its real `.html` file. This is a deliberate choice over a single-page-app catch-all (`"source": "**" → "/index.html"`, which is `firebase init hosting`'s default suggestion) — this app is real multi-page navigation, not a client-side router, so every route needs its own explicit destination. **Adding a page means adding a rewrite entry here** — see `src/html/CLAUDE.md`'s Pages table for the current full list, which must stay in sync with this file.
- **`cleanUrls: false`** — deliberately off, not just left at its default. It was briefly `true` (auto-stripping `.html` from any raw filename URL) but that redirect triggers off the *requested* URL's own suffix regardless of `rewrites` — which broke Google Search Console's site-verification file (`src/google9a4fa05185ef4666.html`, see "Google Search Console verification file" below), since Google needs that exact `.html` URL to return 200 directly, not a 301. Turning it off cost nothing: every real clean URL on this site (`/wordle`, `/connections`, etc.) already works purely through the explicit `rewrites` above, independent of this flag — nothing on the site ever links to a raw `/html/*.html` path for `cleanUrls` to have been helping with in the first place.
- Every path referenced from inside `src/` (asset `<link>`/`<script>` tags, nav `<a href>`s, `fetch()` calls for partials) is **root-relative** (`/css/...`, not `../css/...`) — this only resolves correctly because the site is served from a domain root. See `src/html/CLAUDE.md` for the one exception (JS `import` statements, which resolve against the importing script's own location and were never affected).

## Deploying

```bash
firebase deploy --only hosting,firestore:rules --project playdailymindchallenge
```

Hosting-only changes (HTML/CSS/JS/images) need just `--only hosting`. Any change to `firebase/firestore.rules` must be deployed in the same release as the frontend code that depends on it (e.g. the `wordleDailyAttempts` collection).

## Static root files

`src/ads.txt` (AdSense publisher line), `src/robots.txt` (allows all, disallows the session-gated `/profile`, `/settings`, `/admin`, points at the sitemap), `src/sitemap.xml` (the 11 public pages -- add new public pages here), and `src/404.html` (Firebase Hosting serves it automatically for any unmatched path; no rewrite needed) are served from the site root because `public` is `src`.

## Search engine verification files

Two static verification files live at the site root and **must never be deleted, renamed, or
moved** -- removing either can revoke that search engine's verified-ownership status:

- **`src/google9a4fa05185ef4666.html`** -- Google Search Console's HTML-file domain-ownership
  verification for `dailymindchallenge.com` (verified 2026-09-26). This is also the reason
  `cleanUrls` is off (see above): Google's checker needs
  `https://dailymindchallenge.com/google9a4fa05185ef4666.html` to return the literal string
  `google-site-verification: google9a4fa05185ef4666.html` directly, not via a redirect.
- **`src/BingSiteAuth.xml`** -- Bing Webmaster Tools' equivalent (added the same day, after Bing's
  "Import from Google Search Console" flow failed due to a Google-account mismatch, so it was
  verified manually instead). Must return 200 with its original exact XML content at
  `https://dailymindchallenge.com/BingSiteAuth.xml`.

If `firebase.json`'s hosting config is ever revisited, re-check both URLs still return 200 with
their original exact content afterward.

## Custom domain

The custom domain `dailymindchallenge.com` is connected and live (set up via Firebase console →
your project → **Build → Hosting → Add custom domain**, following its DNS verification flow -- a
TXT record to prove ownership, then A/AAAA or CNAME records pointing at Firebase). The
auto-provisioned `playdailymindchallenge.web.app` domain remains fully live too, serving identical
content with no redirect between the two -- Firebase Hosting has no built-in way to redirect its
own default domain to a custom one without Cloud Functions (which this project doesn't have; it's
on a plan that doesn't support them). Every indexable page's `<link rel="canonical">` points at the
`dailymindchallenge.com` URL regardless of which domain served the request, which is Google's own
recommended mitigation for this exact same-content-two-domains situation.

## Important: Hosting does not fix Firestore latency

Firebase Hosting serves your **static files** (HTML/CSS/JS) from a global CDN — that part gets fast for users anywhere once deployed. It has **no effect** on Firestore read/write latency, which is determined entirely by your Firestore database's region (set once at creation, e.g. `us-central`) and how far a given user is from it, regardless of where the HTML came from. If most users are in the US/Europe and the database is in `us-central`, that's a reasonable pairing already — see `docs/solution-architecture-document.md` for the rest of the reasoning. Don't expect a Hosting deploy to change the per-request Firestore timing you see in DevTools during local development.

## Deploying rules/indexes changes

Whenever `firebase/firestore.rules` or `firebase/firestore.indexes.json` change, they need to be re-published — either by pasting into the Firestore console's Rules/Indexes tabs manually (the approach used so far in this project), or via:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Indexes take a minute or two to finish "Building" after deploy before queries against them succeed.

## Local dev vs. production parity

`python3 -m http.server`/`npx serve`, run from `src/`, correctly serves the root-relative asset paths but knows nothing about `firebase.json`'s `rewrites` — clean URLs like `/wordle` will 404 under a plain static server, only the raw `/html/wordle.html` works. To test the clean URLs exactly as they behave in production, use the Firebase CLI's own local hosting emulator instead, from the **project root**: `firebase emulators:start --only hosting`.

## Build Instructions

There is no build step. "Building" this project means nothing beyond having the files on disk —
`firebase deploy` uploads `src/` (and `firebase/firestore.rules`/`firestore.indexes.json`)
exactly as they are. There is no `npm install`, no compile, no bundling, no minification. A
developer needs only: Node.js (for the `firebase-tools` CLI), the Firebase CLI itself
(`npm install -g firebase-tools`), and — for local emulator testing — a JDK (the Firestore
emulator runs on the JVM; e.g. `brew install openjdk` on macOS).

## Environment Configuration

There is exactly one environment: **production** (`playdailymindchallenge`). There is no separate
staging/QA Firebase project. "Local" development isn't a separate environment with its own data —
it's the same codebase pointed at the **Firebase Local Emulator Suite** instead of live Firestore,
switched automatically by hostname:

- `src/js/api/firebase-init.js` checks `location.hostname` — `localhost`/`127.0.0.1` connects to
  `localhost:8080` (Firestore emulator) and `localhost:9099` (Auth emulator) instead of the real
  project. Any other hostname (including `*.web.app` previews) talks to live production Firestore.
- Firebase client config (`src/js/api/firebase-config.js`) is a single, public, committed file —
  there's no `.env`/secrets-injection step, since the Firebase web SDK's config values are not
  secret (the actual access boundary is `firestore.rules`, enforced server-side).
- The only environment-specific *operational* knowledge that lives outside the repo is which
  Google account (`lazyprogrammer88@gmail.com`) and which Firebase CLI project alias
  (`playdailymindchallenge`, not the retired `daily-mind-challenge`) to deploy with — see the
  "Account gotcha" note above.

## Release Notes

There is no formal, versioned release-notes document or changelog maintained per deploy. The
closest equivalents that exist today:
- `docs/changelog-2026-08.md` — a prose log of one specific development session's decisions (not
  updated per-release going forward).
- Git commit messages — each deploy-worthy change is committed individually with a descriptive
  message and, where relevant, a short rationale (this repo's actual working convention
  throughout 2026-09 and 2026-10 development).
- Firebase Hosting's own **Release history** (Firebase Console → Hosting), which lists every
  deploy with its timestamp and lets you inspect which files changed between any two releases.

**Recommendation, not yet adopted:** if release notes become necessary (e.g. once there are
multiple contributors or external stakeholders who need a plain-English "what changed" per
release), the lowest-friction option is a `CHANGELOG.md` at the repo root, updated as part of each
deploy, rather than reconstructing history from commit messages after the fact.

## Database Migrations

Firestore is schemaless at the database level — there is no migration framework (no Firestore
equivalent of Rails/Django migrations), and none has been needed to date. Schema evolution in this
project has instead happened through:
- **Additive fields**, read with a default via `.get(field, 0)`-style fallbacks in both
  `firestore.rules` and client code, so a document written before a field existed doesn't need a
  backfill (e.g. `registeredUsers.xp`, added well after the collection itself).
- **New collections** for genuinely new data shapes (e.g. `connectionsDailyAttempts` when
  Connections was added, or the four `quilt*` collections for Quilt), rather than overloading an existing collection's shape.
- **One-shot admin scripts**, run manually when a true backfill was needed (none currently
  required in production).

There is no automated migration/rollback tooling for data changes — a data-shape change that
needs a backfill across existing documents is a manual, one-off operation, not a repeatable,
version-controlled migration step. This is an accepted limitation at the project's current scale,
not an oversight.

## Rollback Procedures

**Hosting (static files):** Firebase Hosting keeps a full history of every release. To roll back:
Firebase Console → Hosting → **Release history** → find the previous good release → **Rollback**.
This is immediate and requires no redeploy from source — Firebase serves the previously-uploaded
file set again. Equivalently, from the CLI: `firebase hosting:rollback`.

**Firestore rules:** the Firestore Console's **Rules** tab keeps a version history with a visual
diff; a previous ruleset can be restored from there. There is no CLI-driven rules rollback
equivalent to `hosting:rollback` in routine use on this project — restoring via the console is the
documented path.

**Firestore data:** there is no automated backup/restore configured for this project (see
`docs/operations-support-runbook.md` for the honest gap this represents). A bad data write from a
code defect would need to be corrected manually (direct document edits via the Firestore Console
or a one-off script), not via a database-level rollback.

**Git:** every deploy corresponds to a specific commit on `main`; reverting to a known-good commit
and redeploying from it is the fallback if a rollback needs to also revert source, not just the
currently-live Hosting release.

## Release Approvals

There is no formal release-approval process (no required PR review, no release-manager sign-off
gate, no staging-environment smoke-test checklist enforced before production deploys). In
practice, deploys have been made directly by the project owner, or by an AI assistant acting under
the owner's explicit instruction for that specific change — every deploy in this project's history
has been a single-person decision, consistent with its current scale and team size of one.

**Recommendation, not yet adopted:** if the team grows beyond a single owner/operator, the lowest-
friction next step is GitHub branch protection on `main` (require at least one review before
merge) plus treating "merged to `main`" as the approval gate for the next deploy, rather than
introducing a heavier formal sign-off process the team's size doesn't yet warrant.
