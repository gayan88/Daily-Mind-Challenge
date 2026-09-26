# Deployment

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

`src/ads.txt` (AdSense publisher line), `src/robots.txt` (allows all, disallows the session-gated `/profile`, `/settings`, `/admin`, points at the sitemap), `src/sitemap.xml` (the 10 public pages -- add new public pages here), and `src/404.html` (Firebase Hosting serves it automatically for any unmatched path; no rewrite needed) are served from the site root because `public` is `src`.

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

Firebase Hosting serves your **static files** (HTML/CSS/JS) from a global CDN — that part gets fast for users anywhere once deployed. It has **no effect** on Firestore read/write latency, which is determined entirely by your Firestore database's region (set once at creation, e.g. `us-central`) and how far a given user is from it, regardless of where the HTML came from. If most users are in the US/Europe and the database is in `us-central`, that's a reasonable pairing already — see `docs/architecture.md` for the rest of the reasoning. Don't expect a Hosting deploy to change the per-request Firestore timing you see in DevTools during local development.

## Deploying rules/indexes changes

Whenever `firebase/firestore.rules` or `firebase/firestore.indexes.json` change, they need to be re-published — either by pasting into the Firestore console's Rules/Indexes tabs manually (the approach used so far in this project), or via:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Indexes take a minute or two to finish "Building" after deploy before queries against them succeed.

## Local dev vs. production parity

`python3 -m http.server`/`npx serve`, run from `src/`, correctly serves the root-relative asset paths but knows nothing about `firebase.json`'s `rewrites` — clean URLs like `/wordle` will 404 under a plain static server, only the raw `/html/wordle.html` works. To test the clean URLs exactly as they behave in production, use the Firebase CLI's own local hosting emulator instead, from the **project root**: `firebase emulators:start --only hosting`.
