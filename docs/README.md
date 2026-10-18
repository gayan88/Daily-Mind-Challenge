# Documentation Index

A quick map of everything in `docs/`. Start with `user-guide-technical-handover.md` if you're new
to this project — it's written as the single entry point and tells you what order to read the rest
in.

## Core software documentation (the "10 docs" set)

| Document | Covers |
|---|---|
| [business-requirements-document.md](business-requirements-document.md) | Why this product exists, who it's for, business goals |
| [functional-requirements-specification.md](functional-requirements-specification.md) | What the system does, precisely (the SRS) |
| [solution-architecture-document.md](solution-architecture-document.md) | How it's built and why (the SAD) |
| [technical-design-document.md](technical-design-document.md) | Module-level design, key algorithms, sequence flows |
| [api-documentation.md](api-documentation.md) | Firestore rules as the de facto API spec (no custom backend exists) |
| [database-design-document.md](database-design-document.md) | Every Firestore collection, relationships, indexes |
| [test-plan-and-test-cases.md](test-plan-and-test-cases.md) | Testing strategy and representative test cases |
| [deployment-and-release-document.md](deployment-and-release-document.md) | How to build, deploy, and roll back |
| [operations-support-runbook.md](operations-support-runbook.md) | Monitoring, troubleshooting, incident handling |
| [user-guide-technical-handover.md](user-guide-technical-handover.md) | Player-facing guide + the technical handover entry point above |

## Living / operational docs

| Document | Covers |
|---|---|
| [adding-a-new-game.md](adding-a-new-game.md) | Checklist for adding a 5th game, built from the real Connections experience |
| [quilt-development-plan.md](quilt-development-plan.md) | Plan and split backlogs (Claude / owner) for Quilt, the 5th game |
| [quilt-release-notes.md](quilt-release-notes.md) | Quilt release notes, test results, deploy and rollback steps |
| [content-creation-guide.md](content-creation-guide.md) | Exact file formats for AI-assisted puzzle content generation, per game/mode |
| [progression-gamification-roadmap.md](progression-gamification-roadmap.md) | The phased plan behind Points/XP/Rank/Achievements/Streaks/Championships |
| [data-flow.md](data-flow.md) | Sequence-level reference for session bootstrap, auth, and scoring flows |
| [changelog-2026-08.md](changelog-2026-08.md) | Historical record of what shipped in August 2026 |
| [facebook-campaign-brief.md](facebook-campaign-brief.md) | Marketing brief for running Facebook/Meta ad campaigns |

## Supporting assets

- **`assets/campaign/`** — processed images referenced by `facebook-campaign-brief.md` (badges, tiles, share images, logo).
- **`connections-content/`** — reviewed starter puzzle content for the Connections game (see `adding-a-new-game.md`/`content-creation-guide.md`).
- **`Images/`** — raw source images (not currently referenced by any doc or page); kept as source material for future campaign asset edits.
