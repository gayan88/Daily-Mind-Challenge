# Progression & Gamification Roadmap

Tracking doc for implementing `Daily-Mind-Challenge-Master-Progression-Gamification-Specification.md`.
Update the Status column as work lands — this file is the running source of truth for "what phase are we on."

## Ground rules (apply to every phase)

- No Cloud Functions / backend unless explicitly approved.
- Points stay game-specific; XP stays global — never merge them.
- Prefer deriving values (Level, progress %, rank) from a source of truth instead of storing them.
- Guests keep Points + leaderboard access only — XP/Level/Streak/Achievements are registered-player features.
- Each phase should be reviewed and approved before the next one starts.

## Status legend

`Not started` · `In progress` · `Blocked` · `Done`

| Phase | Name | Status | Depends on |
|---|---|---|---|
| 1 | Core Progression Foundation | Done | — |
| 2 | Player Profile Foundation | Done | 1 |
| 3 | XP | Done | 1, 2 |
| 4 | Streak | Done | 1 |
| 5 | Achievement Engine | Done | 1, 3, 4 |
| 6 | Championships | Done | 5 |
| 7 | Missions | Done (Daily only) | 3, 5 |
| 8 | Daily Brain Workout | Done | 3, 4, 5, 7 |
| 9 | New Games | Ongoing (per new game) | 1–8 |
| 10 | Competitive/Social Improvements | Partially done | all above |

---

## Phase 1 — Core Progression Foundation ✅ Done

**Goal:** a reusable, game-agnostic engine that turns existing lifetime Points into a Game Level, with no new writes.

- [x] Game Registry — `src/js/progression/game-registry.js` (`GAMES`: stable `gameId` → `{ label, scoreTypes }`). `leaderboard-data.js`'s `GAME_TYPES` now derives from this instead of keeping its own copy. (`profile.js`'s per-gameType `GAME_LABELS` map is a different shape/purpose — per-mode display label, not per-game aggregation — and was deliberately left alone.)
- [x] `calculateGameLevel(points)` / `calculateGameProgress(points)` — `src/js/progression/progression-service.js`, pure functions, 5,000-points-per-level, always derived, never stored.
- [x] Per-game lifetime Points — `utils/points.js#getUserScoreByGameType(uid)` (new query, one read, byGameType breakdown) → `progression-service.js#getGameProgressByGame(byGameType)`.
- [x] Minimal progression UI — a "Game progress" section on `profile.html` showing Level, Points, and a progress bar per game.

**Explicitly excluded (unchanged):** XP, Overall Level, Streak, Achievements, Missions, Challenge-a-Friend, new games.

No Firestore writes, security rule changes, or data migration were needed — everything is derived live from existing `gameScores` docs.

## Phase 2 — Player Profile Foundation ✅ Done

**Goal:** surface Phase 1's engine properly, for registered players only.

- [x] Full "Your Games" section on the profile page: game logo, Level, lifetime Points, progress bar, points-to-next-Level, and "modes played" counts (Daily/Classic/Tournament/Challenges) per game.
- [x] Hero header (avatar initial, display name, streak headline) and restructured stat tiles (Total points, Games played, Games mastered).
- [x] **Registered-only gating** — Level/progress/modes-played are shown only to registered players; guests still see their real per-game Points (guests do earn Points, per Section 4 of the spec), but get a locked placeholder instead of a Level, plus a note that signing up unlocks it. This directly enforces this roadmap's own ground rule ("XP/Level/Streak/Achievements are registered-player features") — Phase 1's initial build had shown Level to guests too, which this phase corrected.
- [x] "Games mastered" stat tile only shown to registered players (Achievements are registered-only) — value is honestly `0` for everyone, a stub for the Phase 5 Achievement Engine, not a fabricated number.
- No new gamification concepts introduced — display + the guest/registered access boundary only.

## Phase 3 — XP ✅ Done

**Goal:** a global, cross-game progression number, separate from Points.

- [x] **XP-earning events** (decided with the user before building, per the spec's "do not hardcode thresholds" instruction) — `src/js/progression/xp-service.js#XP_AMOUNTS`: Daily Challenge completion (+10, any game), a one-time-per-day "perfect day" bonus (+20, when every registered game's Daily Challenge is done), daily login (+5, folded into `utils/points.js#applyDailyLoginBonus()`'s existing transaction), and sharing (+5, one bump per "Share to Facebook"/"Share with Friends" action across *every* mode of every game — Daily, Classic, Tournament, and Wordle's Challenge a Friend — not just Daily Challenge).
- [x] **XP accumulation + storage** — a new `xp` field on `registeredUsers/{uid}` (plus `lastPerfectDayDate` to guard the one-time daily bonus), since unlike Game Level, XP can't be purely derived from existing data — there's no query that reconstructs "every XP event that ever happened." New Firestore security rule: `xp`/`lastPerfectDayDate` added to `registeredUsers`' existing bounded self-service update allowlist, same delta-cap pattern already used for `loginPoints` (0–50 per write here, covering the largest legitimate single write: a Daily Challenge completion + the perfect-day bonus together). Uses `.get(field, 0)` on both sides of the delta check, so **no data migration was needed** — an existing registered user's doc with no `xp` field yet is treated as 0 and heals forward on its first XP-awarding write.
- [x] `calculateOverallLevel(xp)` / `calculateOverallProgress(xp)` — same fixed-threshold style as Game Level, 500 XP per level, always derived, never stored.
- [x] Overall Level/XP display in the profile page hero (registered players only), with a progress bar toward the next level.
- Overall Rank/Title tiers were explicitly **deferred** to a later phase, per the user's decision — Phase 3 itself was XP + Overall Level display only.

**Follow-up, picked back up later: Overall Rank (`src/js/progression/rank-service.js`)** — 10 named tiers (Novice → Legend), 10,000 XP per tier, defined with the user (replacing the spec's own placeholder "Beginner...Legend" example names). Pure/derived, no new storage, same as Level. Currently used as the profile page's **avatar image** (10 custom badge assets in `src/assets/images/`, `rank-novice.png`..`rank-legend.png`, plus a separate `rank-guest.png` for guests) — caps at Legend above 90,000 XP (an assumption, not an explicit decision). **Sub-ranks are still open**: the user wants a "II"/"III"-style suffix within each 10,000-XP tier (matching the spec's own "Grandmaster III" mockup, Section 15) — undecided whether that's 9 or 10 sub-bands per tier (see the discussion: examples given implied 10 clean 1,000-XP bands but were labeled up to "IX," not "X"). Not implemented until that's resolved. Also still open: whether Rank should be displayed as text anywhere (not just as the avatar image) — e.g. alongside "Overall Level" — and whether it belongs on the home page too, not just profile.

**Where XP is awarded (all guarded to registered-only by `xp-service.js`'s functions silently no-op'ing when a uid has no `registeredUsers` doc):**
- `wordle-page.js` / `sudoku-page.js` / `wordsearch-page.js` — after a successful Daily Challenge `recordDailyResult()`, calls `awardDailyCompletionXp()`, checking `checkPlayedTodayAll()` *after* that write to decide the perfect-day bonus.
- `utils/points.js#applyDailyLoginBonus()` — the daily login XP bump, in the same transaction as the existing `loginPoints` bonus.
- All 6 places in the codebase that implement a share bonus (`utils/points.js`, `wordle-daily-data.js`, `wordle-tournament-data.js`, `wordle-challenge-data.js`, `sudoku-tournament-data.js`, `wordsearch-tournament-data.js`) — each `markSharedToFacebook()`/`markSharedWithFriends()` now calls `awardShareXp()` after its own transaction resolves, only when the Points-side bonus was newly applied.

## Phase 4 — Streak ✅ Done

**Goal:** registered-player daily-activity streak, date-based not timer-based.

- [x] **Streak-day definition** (decided with the user before building) — completing at least one game's Daily Challenge, not merely logging in. This is a real behavior change: before this phase, `currentStreak` advanced on login (`utils/points.js#applyDailyLoginBonus()`); it no longer does.
- [x] **Migration approach** (decided with the user) — the existing `currentStreak` counter is reused, not replaced or renamed; a one-time transition rule in `progression/streak-service.js#advanceStreakForDailyCompletion()` carries a player's pre-Phase-4 count forward as a starting point (continues it by +1 on their first Daily Challenge completion under the new system) instead of resetting to 0. A **new** `lastStreakDate` field tracks the last qualifying day, kept deliberately separate from `lastLoginDate` (which must keep gating only the login Points bonus, untouched by gameplay).
- [x] Streak continuation / reset logic — date-based (`isConsecutiveDay()`, already used elsewhere in the app), not a browser timer.
- [x] **Streak milestones** (decided with the user) — visual-only highlight at 7/30/100/365 days (`progression/streak-service.js#getStreakMilestoneTier()`, escalating color/size on the profile page), no new storage. Real badges wait for the Phase 5 Achievement Engine.
- [x] New Firestore rule: `currentStreak`'s delta is now bounded (+1, or drop to exactly 1) and `lastStreakDate` added to the self-service update allowlist — same pattern as `loginPoints`/`xp`.
- **Incidental fix while in this code**: `app.js` was syncing the in-memory profile's streak from the login bonus's old return value after every claim, which no longer applies — replaced with syncing `profile.xp` instead (a real Phase 3 bug: the login bonus's XP increment wasn't being reflected in the same page's rendered Overall Level/XP until a reload).

## Phase 5 — Achievement Engine ✅ Done

**Goal:** one generic engine, not a per-game achievement service.

- [x] **Categories built** (decided with the user) — Game, Streak, Exploration, and Global. **Championship was excluded** — it needs Phase 6's period/results data, which doesn't exist yet, so there's nothing to evaluate it against. Global Achievements' exact definitions (the spec explicitly leaves these undefined — "finalized later") were decided with the user:
  - **Game**: one `{game} Master` per registered game, at Game Level 10 (50,000 lifetime points).
  - **Streak**: `streak-7`/`30`/`100`/`365`, reusing the exact thresholds from Phase 4's `streak-service.js`.
  - **Exploration**: Puzzle Explorer (5 different games played), Mind Adventurer (10), Mind Explorer (20) — exact names/thresholds from the spec. None earnable yet with only 3 games total, but the rule is generic (driven by the Game Registry) and forward-compatible.
  - **Global**: Daily Mind Champion (first "perfect day," reusing Phase 3's exact condition), All-Rounder (Level 1+ in every registered game), Puzzle Collector (100,000 total lifetime Points).
- [x] **Generic rule definitions** — `src/js/progression/achievement-registry.js#ACHIEVEMENTS`, a static code registry (decided with the user, not Firestore-backed/admin-editable) of `{ id, category, label, description, evaluate(context) }`. `evaluate()` is a pure function over already-computed progression data — no game-specific logic, no Firestore access; a new game plugs in automatically for Game/Exploration/All-Rounder achievements just by being added to the Game Registry.
- [x] **Player achievement records** — new `playerAchievements/{uid}_{achievementId}` Firestore collection (`src/js/progression/achievement-engine.js`), create-only (same one-time-write pattern as `gameScores`), guarded by a new Firestore rule with an achievementId allow-list (must be kept in sync with the registry by hand — rules can't import JS). `count` is included in the schema (for future accumulating achievements, e.g. Championships in Phase 6) but always `1` for now, since every Phase 5 achievement is one-time.
- [x] **Evaluation trigger / surfacing** (decided with the user) — silent: `profile.js` calls `syncPlayerAchievements()` on every visit (registered players only), which evaluates all definitions and creates records for any newly-earned ones. No toasts/popups, no hooks added to any game page — everything needed (Level, Points, Streak, perfect-day) was already being computed on the profile page from earlier phases.
- [x] The Phase 1 "Games mastered" stat tile (hardcoded to `0` since Phase 1) is now wired to the real count of earned Game achievements.
- [x] New "Achievements" section on the profile page — every achievement shown, earned ones highlighted with a category icon, unearned ones dimmed/locked with their real (not fabricated) condition as the description. Registered-only, same gating pattern as the rest of the page.

## Phase 6 — Championships ✅ Done

**Goal:** weekly/monthly per-game champions, computed lazily (no scheduled backend job).

- [x] **Periods** (decided with the user) — both Weekly and Monthly, per game. Deterministic period keys exactly matching Section 20 of the spec (`2026-W36`, `2026-09`), via new ISO-8601 week math added to `utils/helpers.js` (`getISOWeekInfo`/`getISOWeekMonday`) and verified against known reference dates (e.g. 2021-01-01 falls in ISO week `2020-W53`).
- [x] **Period-results schema** — new `periodResults/{gameId}_{periodType}_{periodKey}` collection (`progression/championship-service.js`): `{ gameId, periodType, periodKey, startDate, endDate, winnerUid, winnerDisplayName, winnerPoints, claimed, finalizedAt }`. Winner is the top-scoring **registered** player for that game/date-range (a guest can top the raw scores but can't hold an accumulating achievement, so the next-highest registered player is crowned) — reuses a new `getGameScoresForDateRange()` in `leaderboard-data.js`, sharing its existing aggregation logic (refactored into `aggregateScores()`) and its existing `(gameType, scoreDate)` composite index, so no new index was needed.
- [x] **Lazy finalization** (decided with the user) — triggered from `leaderboard-page.js` on every visit by a registered, non-banned user; a guest visiting doesn't trigger it (Firestore rules require registration to create a `periodResults` doc), but can still read one. **Only the single most-recently-closed week/month per game is ever checked** (decided with the user) — if the site goes unvisited for a long stretch, older un-finalized periods are permanently skipped rather than backfilled.
- [x] **Weekly/Monthly Champion achievements** — 6 new accumulating entries in `achievement-registry.js` (`{game}-weekly-champion`/`{game}-monthly-champion`), `category: 'championship'`, no `evaluate()` (unlike every other category, these aren't locally evaluable — they depend on global period data). Awarded through a **separate claiming step**: the visitor who finalizes a period is usually not the winner, and Firestore only allows a client to write its own data, so the actual winner claims their own win (`claimChampionshipAchievements()`, called from `profile.js` alongside Phase 5's sync) by flipping the period's `claimed` flag and incrementing their own `playerAchievements` doc's `count` — a new capability, since every other achievement is one-time/create-only. `count` (already in the Phase 5 schema, unused until now) is what actually accumulates, shown on the profile page as "×N".
- [x] New Firestore rules: `periodResults` (create by registered non-banned users; update restricted to the recorded winner flipping `claimed` only) and a new bounded `playerAchievements` update rule (championship ids only, `count` +1 per write, owner only).

**Known limitation, stated plainly (per Section 22's "don't claim this is tamper-proof")**: nothing here re-verifies the computed winner against reality — there's no backend to re-run the aggregation server-side, so this trusts the same self-reported score data every other part of this app already trusts.

## Phase 7 — Missions ✅ Done (Daily only — Weekly deliberately deferred, see below)

**Goal:** daily/weekly objectives with XP rewards, generic across all games.

- [x] **Reward model** (decided with the user) — per-mission XP, not one bundled reward for the whole day's set. The spec's single "+100 XP" line under 4 example missions was genuinely ambiguous between the two.
- [x] **Mission set built**: 3 Daily missions, using the spec's own example thresholds directly (not invented) — Complete a Daily Challenge (any game, 1), Play 2 Different Games, Earn 500 Points. Deliberately **not** included: "Complete today's Wordle" — that one example is game-specific, which directly contradicts the same section's "mission architecture MUST be generic" instruction, so it was dropped rather than reconciled.
- [x] **Weekly missions scoped out of this pass** (the user selected only the Daily option when asked which set to build) — the weekly reward amount was still decided (+300 XP each, 3x daily) and is sitting ready in `mission-service.js#MISSION_XP.WEEKLY`, unused. Adding weekly missions later is mostly just new entries in `WEEKLY_MISSIONS` + a matching Firestore rule allow-list update, not new architecture.
- [x] **Fully derived, no progress storage** — mission progress (points earned today, distinct games played today, Daily Challenges completed today) is recomputed from existing `gameScores` on every check, same "prefer deriving" principle as Game Level; only *completion* (to prevent double-awarding) is stored, in a new `playerMissions/{uid}_{missionId}_{periodKey}` collection, create-only (mirrors `gameScores`/`playerAchievements`).
- [x] **Silent surfacing** — evaluated and awarded from `profile.js` on every visit, alongside Phases 5/6's own sync calls; a new "Today's Missions" section shows each mission's progress (`current/target`) and reward.
- [x] Widened `firestore.rules`' `xp` delta cap from 50 to 300 — the 100-XP daily mission reward (and the reserved 300-XP weekly one) both exceed the old cap, which had only ever needed to cover Phase 3/4's smaller per-write amounts.

## Phase 8 — Daily Brain Workout ✅ Done

**Goal:** the dashboard becomes the daily-return destination.

- [x] **"Complete today's workout +100 XP" conflict resolved** (decided with the user) — the spec mockup's own bonus overlaps with Phase 3's already-built "perfect day" bonus (20 XP). Rather than introduce a second, competing "finish everything today" reward, the home page reuses the real, existing amount (`progression/xp-service.js#XP_AMOUNTS.PERFECT_DAY_BONUS`) so the number can never drift out of sync with reality.
- [x] **Dashboard scope: compact summary, not a full rebuild** (decided with the user) — the home page (`home.js`) now shows streak + Overall Level/XP in the status card, plus a new "Daily Missions: N/3 complete" / "N badges earned" strip that links out to `/profile` for full detail, rather than duplicating the full missions list or achievements grid on two pages.
- [x] **Per-game checklist**: reused the *existing* game-tile completed-badges (already built pre-Phase-8) rather than adding a second, separate checklist widget — they already serve exactly this purpose.
- [x] **Missions now evaluate/award from the home page too**, not only `/profile` — `syncDailyMissions()` is idempotent, so calling it from both pages is safe; the home page is genuinely the more natural place for "did I finish today's workout" to resolve, since it's the page a player lands on first.
- [x] Achievements are only **read** (a count) on the home page, not re-evaluated — keeps its Firestore work light, consistent with the "compact summary" decision.
- Streak/Level/XP/missions/achievements are all still registered-player-only (Section 4) — guests get the existing dashboard unchanged, no new locked placeholders added to the home page for this phase.

**Not done**: a fully *dynamic*, registry-driven per-game checklist (today's version is still the pre-existing 3 hardcoded game tiles) — deferred to Phase 9, since it's only meaningful once there's a 4th game to prove the pattern against.

## Phase 9 — New Games

**Goal:** every future game plugs into the existing systems without redesigning them.

- Each new game registers in the Game Registry and gets Points/Level/XP/Achievements/Missions/Leaderboards "for free"
- Re-run per new game, not a one-time phase

## Phase 10 — Competitive/Social Improvements 🟡 Partially done (scoped down, on purpose)

**Goal:** polish once the core loop is in place.

Unlike every earlier phase, the spec gives this one **zero concrete detail** — just a bullet list of loosely-scoped "later improvements." Building all of them shallowly in one pass would really be six small, unrelated projects, not one phase, so scope was narrowed down with the user to exactly what was asked for:

- [x] **Leaderboard UX: "Your rank" summary** — `leaderboard-page.js#renderYourRank()`. Previously the only way to find your own rank was scrolling/"Load More"-ing until your highlighted row happened to appear; now a small always-visible "You're ranked #N — X pts" box sits above the tabs, computed from the same already-fetched data (no extra Firestore read). Shown for guests too, not gated to registered players (guests appear on leaderboards, Section 4).
- **Not done, explicitly deferred** (the user picked leaderboard UX only, out of the offered set):
  - **Championship presentation** — flagged as the most concrete real gap (Phase 6 built the entire weekly/monthly champion engine, but there's still no page where anyone can see who won) — still open.
  - Personal ranking / Personal Best elsewhere in the app (beyond the leaderboard fix above).
  - Challenge-a-Friend improvements — no direction given yet; needs the user's own specifics to scope, the spec has none.
  - Social sharing improvements.
  - Further leaderboard UX items considered but not chosen: total player count per tab, collapsing the period tabs into a dropdown on mobile.

---

## Open decisions to revisit each phase

- Whether any derived value (Game Level, XP total) ever needs to be cached for performance — and if so, what bounded/guarded write rule prevents it from drifting from its source of truth (mirror the existing `loginPoints` delta-cap pattern in `firestore.rules`).
- Whether the existing login-streak field (`registeredUsers.currentStreak`) is reused for Phase 4 or superseded by a gameplay-based definition.
