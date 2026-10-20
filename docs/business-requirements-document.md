# Business Requirements Document (BRD)
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | New as of 2026-10-17; updated 2026-10-20 for Quilt, the fifth game, and Pounce, the sixth. Written retrospectively from the shipped product, the marketing brief, and product decisions already made — not a pre-development planning document. Several fields below are marked **TBD** because they're genuine business decisions the project owner hasn't recorded anywhere I have access to; fill these in rather than treat the placeholders as answers. |
| **Related docs** | `docs/functional-requirements-specification.md` (SRS), `docs/facebook-campaign-brief.md`, `docs/progression-gamification-roadmap.md` |

---

## 1. Business Objectives

Inferred from the product's actual design decisions and the marketing brief already prepared for
it (`docs/facebook-campaign-brief.md`):

- Build a daily-habit puzzle product that competes for the same audience as Wordle, NYT Games, and
  similar daily-puzzle sites, by offering multiple puzzle formats (currently six: Wordle, Sudoku,
  Word Search, Connections, Quilt, Pounce) in one free, no-signup-required site.
- Generate advertising revenue via Google AdSense (pending/approval-stage as of this writing) and,
  separately, drive paid-acquisition value via Meta ads (Meta Pixel installed and active).
- Build a registered, retained user base via account-gated progression (XP, Rank, Streaks,
  Achievements, Championships) that gives a free account tangible value over guest play.
- Grow a community presence (an existing Facebook Page and Facebook Group) as both a retention
  channel and a built-in, zero-cost distribution loop (in-game "Share with Community" bonuses feed
  directly into the Group).

**TBD:** a formal, numeric business goal (e.g. target MAU, target ad revenue, target registered
user count by a given date) is not recorded anywhere in this repository or its docs. The product
and marketing materials are built as if these matter, but the actual targets are a business
decision only the project owner can supply.

## 2. Business Problems

| Problem | How the product addresses it |
|---|---|
| Players juggle multiple separate apps for different daily puzzle types (a Wordle app, a separate Sudoku app, a separate word-search app) | One site, six games, one account, one leaderboard, one streak — the "6-in-1" pitch in the marketing brief |
| Most daily-puzzle products require an app install or an account before playing | Guest play with zero friction — a visitor is playing within one tap, no signup wall |
| Free puzzle sites often look low-effort / thin, hurting both player trust and ad-network approval (this product was specifically rejected once by AdSense for "Low value content") | Each game page carries real explanatory content (How to Play, Tips & Strategy, a ~20-question FAQ), and the progression system (XP/Rank/Achievements/Championships) gives the product genuine depth beyond "one puzzle a day" |
| New site, not yet discoverable via search | Google Search Console and Bing Webmaster Tools are both set up and verified; sitemap submitted; indexing explicitly requested for key pages (see `docs/operations-support-runbook.md`) |

## 3. Scope

**In scope (built and live):**
- Six playable games, each with Daily Challenge, Classic (where applicable), and Tournament modes. Quilt (added 2026-10-18) is the first original format rather than a well-known one: a Shikaku-style logic puzzle whose solved board reveals a pixel-art picture. Pounce (2026-10-20) is a Star Battle-style cat puzzle (one cat per row, column and region, none touching) with explained hints, a Zen mode, a nine-lives tournament and a Cat Café collection; its content is generated, not authored.
- Guest and registered account types.
- A full progression layer: Points, per-game Level, site-wide XP, Rank (10 tiers × 10 sub-ranks),
  Streaks, 121 Achievements, and Daily/Weekly/Monthly Championships.
- A public leaderboard.
- An admin panel for content seeding, moderation, platform configuration, and Championship
  finalization.
- Legal/informational pages (Privacy Policy, Terms of Service, Cookie Consent Notice, About).
- Analytics (Google Analytics), advertising infrastructure (AdSense slots, Meta Pixel), and SEO
  setup (sitemap, meta tags, search-engine verification).

**Out of scope (not built, and not currently planned — see each related doc for detail):**
- Native mobile apps.
- A custom backend server or Cloud Functions (see `docs/solution-architecture-document.md` §9).
- Server-authoritative anti-cheat (the scoring model is a documented, accepted v1-pragmatic
  tradeoff — see the SAD's Security Model).
- Automated testing (see `docs/test-plan-and-test-cases.md`).
- Paid-tier/monetized gameplay features — the product's own Terms of Service explicitly states
  points/XP have no cash value and there are no purchases.

## 4. Stakeholders

| Role | Who | Notes |
|---|---|---|
| Product owner / operator | **TBD** — not named in any doc; `support@dailymindchallenge.com` is the public-facing contact alias, deliberately not a personal address (see `src/html/CLAUDE.md`'s note on `about.html`) | Final decision-maker on scope, budget, and priorities |
| Primary development | Built iteratively with AI-assisted development (Claude Code) across multiple sessions, directed by the product owner | No separate internal engineering team identified |
| Marketing/agency | A paid-social campaign brief exists (`docs/facebook-campaign-brief.md`) written to be handed to an external agency; whether one has been engaged is **TBD** | Budget and flight dates for the campaign are explicitly marked "not yet set" in that brief |
| End users | Two classes: Guests (anonymous, no account) and Registered users (username/password accounts) | See the SRS §2.2 for the full permission matrix |

## 5. Business Rules

- **No real-money mechanics.** Points and XP are explicitly non-monetary, stated in the Terms of
  Service; there is no purchase flow anywhere in the product.
- **One scored attempt per Daily Challenge per player per day**, enforced at the data layer, not
  just the UI — a core trust/integrity rule for the leaderboard and Championships to mean anything.
- **Admins cannot play.** A content-integrity rule preventing an admin from seeding puzzles and
  then playing them to inflate their own standing.
- **Guests are full participants in gameplay and the leaderboard, but not in progression.** Guests
  earn Points and can rank on the leaderboard, but do not earn XP, Rank, Streaks, or Achievements —
  a deliberate incentive to register, without making guest play feel crippled.
- **Advertising/tracking only runs with consent.** The Meta Pixel in particular is gated entirely
  behind the cookie banner's Accept choice; it never loads for a visitor who declines or hasn't
  chosen yet.

## 6. Expected Outcomes

- A player can discover the site, start playing within one tap as a guest, and optionally convert
  to a registered account to unlock the full progression layer.
- The site is indexable by search engines and has a real paid-social campaign ready to run.
- The product can add further games (a fifth, sixth, etc.) following the established, documented
  checklist (`docs/adding-a-new-game.md`) without re-architecting the shared systems (progression,
  leaderboard, admin panel).

**TBD — business-side success metrics not yet defined in any available document:**
- Target daily/monthly active users, by what date.
- Target ad revenue (AdSense + any Meta-driven conversions).
- Target registered-user conversion rate from guest play.
- Budget ceiling for paid acquisition (Meta campaign).

These should be supplied by the project owner and added here before this BRD is treated as
complete for planning purposes — everything above it is derived from what the shipped product and
existing docs actually commit to, not invented to fill the template.
