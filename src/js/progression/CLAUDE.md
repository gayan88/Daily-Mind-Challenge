# src/js/progression

Phases 1-7 of `docs/progression-gamification-roadmap.md` — the game-agnostic engine that turns a
player's existing lifetime `gameScores` Points into a per-game Level (read-only, no new Firestore
writes), plus the global XP system (Phase 3), the Streak (Phase 4), the Achievement Engine
(Phase 5), Championships (Phase 6), and Daily Missions (Phase 7) — all five of which *do*
introduce new Firestore fields/collections and write paths since none of them can be purely
derived the way Game Level can. `rank-service.js` (Overall Rank, also Section 14) is a
read-only/derived-only follow-up to Phase 3, picked back up after being deferred -- no new storage.

## Files

- **`game-registry.js`** — `GAMES`: stable `gameId` -> `{ label, logo, scoreTypes, modes }`.
  `scoreTypes` is the full list of `gameType` strings (Daily/Classic/Tournament/etc.) that count
  toward that game's lifetime Points, mirroring the old `GAME_TYPES` map that used to live only in
  `leaderboard-data.js`. **The single source of truth** for "which gameTypes belong to which
  game" — `leaderboard-data.js` now derives its own `GAME_TYPES` from this instead of keeping a
  separate copy. `logo` is the same tile image already used on the home page's game tiles.
  `modes` groups a subset of `scoreTypes` into the semantic "modes played" buckets shown on the
  profile page (`daily`/`classic`/`tournament`/`challenges`) — deliberately not a strict subset of
  `scoreTypes` (e.g. `wordle-challenge-creator` counts toward Wordle's Points but is excluded from
  `modes.challenges`, since it's the creator's reward for someone *else* solving their challenge,
  not a challenge this player played). Adding a new game means adding one entry here.
- **`progression-service.js`** — pure functions, no Firestore dependency:
  `calculateGameLevel(points)` / `calculateGameProgress(points)` (the 5,000-points-per-level
  formula plus next-level threshold/points-remaining/progress %, per Section 6/7 of the spec),
  and `getGameProgressByGame(byGameType)`, which buckets a `{ [gameType]: { score, count } }` map
  (from `utils/points.js#getUserScoreByGameType`) into per-game progress *and* per-mode play
  counts, using the registry. Level is always derived from Points at call time, never stored, so
  the two can never drift apart.
- **`xp-service.js`** — the global XP system (Phase 3). `XP_AMOUNTS` (the constants for every
  XP-earning event, decided with the user before implementation per the spec's "don't hardcode
  thresholds blindly" instruction -- see `docs/progression-gamification-roadmap.md`'s Phase 3
  section for the full list and rationale) and `calculateOverallLevel(xp)` /
  `calculateOverallProgress(xp)` (500-XP-per-level, same derived-not-stored style as Game Level).
  `awardDailyCompletionXp(uid, allDailyGamesCompletedToday)` and `awardShareXp(uid)` are the two
  actual Firestore-writing functions, called from each game's Daily Challenge completion handler
  and from every `markSharedToFacebook()`/`markSharedWithFriends()` implementation across the
  codebase respectively. Both silently no-op for a uid with no `registeredUsers` doc (guests), so
  call sites never need their own `profile.kind === 'registered'` check before calling them --
  though the Daily Challenge call sites still check it anyway, to skip an unnecessary
  `checkPlayedTodayAll()` read for guests.
- **`rank-service.js`** — Overall Rank (Section 14), picked back up after being deferred out of
  Phase 3. Pure and read-only, no Firestore code at all. `MAIN_RANKS`: 10 tiers (10,000 XP per
  tier -- Novice through Legend, the user's exact thresholds/names), each `{ tier, name, image }`
  -- `image` points at one of the cropped badge assets in `src/assets/images/` (`rank-novice.png`
  .. `rank-legend.png`), used as the profile page's avatar. `calculateMainRank(xp)` returns just
  the tier object. `calculateRankProgress(xp)` returns the full breakdown used by the profile page:
  sub-rank fields (`label` e.g. "Novice VII", `progressPercent`/`xpToNextSubRank`/`nextLabel` for
  the 1,000-XP-wide sub-rank band -- 10 sub-ranks per main rank, Roman numerals I-X, matching the
  spec's own "Grandmaster III" mockup -- confirmed with the user after an earlier "9 sub-ranks"
  reading based on ambiguous example numbers turned out wrong) *and* main-rank fields
  (`mainRankProgressPercent`/`xpToNextMainRank`/`nextMainRank` for the coarser 10,000-XP band) --
  both granularities are shown at once on the profile page (sub-rank in the "Rank Progression"
  side panel's "Current Rank" box, main-rank in the hero's own progress bar), deliberately not the
  same metric twice. Caps at Legend (and sub-rank X) for any XP >= 90,000 (an assumption made when
  this was built, not an explicit decision -- there's no 11th tier to grow into). `GUEST_RANK_IMAGE`
  is a separate, fixed badge (`rank-guest.png`) for guests, who don't earn XP/Rank (Section 4) --
  shown instead of defaulting them into "Novice," which would misrepresent it as a real rank.

- **`streak-service.js`** — the Streak (Phase 4). `getStreakMilestoneTier(streak)` (pure; returns
  the highest of `[7, 30, 100, 365]` reached, or `null` — drives a visual-only highlight on
  `profile.js`, since the Achievement Engine that would turn these into real badges is Phase 5,
  not built yet) and `advanceStreakForDailyCompletion(uid)` (the one Firestore-writing function,
  called from each game's Daily Challenge completion handler, right alongside
  `xp-service.js#awardDailyCompletionXp()`). **Redefines what "streak day" means**: before Phase
  4, `currentStreak` advanced on login (`utils/points.js#applyDailyLoginBonus()`); as of Phase 4 it
  advances only on actually completing a Daily Challenge, per explicit product decision recorded
  in `docs/progression-gamification-roadmap.md`'s Phase 4 section. The existing `currentStreak`
  field/counter is reused as-is (not replaced) — including a one-time transition rule so a
  player's pre-Phase-4 streak count carries forward as a starting point instead of resetting to 0
  the first time this new logic runs for them. `lastStreakDate` is a **new**, separate field from
  `lastLoginDate` — `lastLoginDate` must keep meaning "last day the login Points bonus was
  claimed," untouched by gameplay, or playing before that bonus runs on page load would silently
  make it look already-claimed for the day.

- **`achievement-registry.js`** — the Achievement Engine's definitions (Phase 5), a static code
  registry (decided with the user, not Firestore/admin-editable) rather than one big
  `WordleAchievementService`/etc — this is exactly the "generic engine" the spec's Section 17
  insists on. `ACHIEVEMENTS`: an array of `{ id, category, label, description, evaluate(context) }`.
  `evaluate()` is a pure function, no Firestore access -- it only reads whatever `context` its
  caller assembled. Categories: `game` (one `{Game} Master` per entry in `GAMES`, at Game Level
  10), `streak` (`streak-7/30/100/365`, mirroring `streak-service.js`'s own milestone list as a
  separate literal, not an import, so this file stays fully decoupled from any Firestore-touching
  module), `exploration` (`explorer-5/10/20`, "played N different games" -- derived from
  `context.gameProgress`, so a new game in `GAMES` counts automatically, no edit needed here),
  `global` (`daily-mind-champion`/`all-rounder`/`puzzle-collector` -- their exact trigger
  conditions were undefined by the spec itself ("finalized later") and were decided with the user
  before implementation, same as Phase 3's XP amounts), and `championship` (Phase 6 --
  `{game}-weekly-champion`/`{game}-monthly-champion`, **no `evaluate()`**: unlike every other
  category, these can't be locally evaluated from progression data alone; they're awarded by
  `championship-service.js` instead, purely listed here for display).
- **`achievement-engine.js`** — the Phase 5 engine. `getPlayerAchievements(uid)` (reads a player's
  own `playerAchievements` docs) and `syncPlayerAchievements(uid, context)` (evaluates every
  `ACHIEVEMENTS` entry that has an `evaluate()` against `context`, create-only-writes a doc for
  any newly-satisfied one the player doesn't already have, returns the full up-to-date earned
  list -- entries with no `evaluate()`, i.e. `championship`, are skipped here, not evaluated).
  Called from exactly one place — `profile.js`, on every visit — per the "silent, shows up on next
  profile visit" surfacing decision (no toasts/popups, no hooks added to any game page). This
  function does no `profile.kind` check itself (it has no `registeredUsers` read of its own —
  `context` arrives pre-computed), so **callers must already be scoped to registered players**.
- **`championship-service.js`** — Championships (Phase 6). Pure period-key functions
  `getPreviousWeekPeriod()`/`getPreviousMonthPeriod()` (built on new ISO-8601 week math in
  `utils/helpers.js`, always the most recently *closed* period relative to today, never the
  in-progress current one) plus two Firestore-writing functions with two very different callers:
  - `finalizeRecentPeriodsIfNeeded()` — called from `leaderboard-page.js` on every visit by a
    registered player. For each game × {week, month}, checks (one batched
    `documentId() in [...]` query) whether a `periodResults` doc already exists for the most
    recently closed period, and computes + creates one for any that don't (via a new
    `leaderboard-data.js#getGameScoresForDateRange()`, sharing that file's existing aggregation
    logic and composite index). The winner is the top-scoring *registered* player (a guest can
    top the raw scores but can't hold an achievement, Section 4 of the spec, so the next-highest
    registered player is crowned instead).
  - `claimChampionshipAchievements(uid)` — called from `profile.js`, **not** from the function
    above. The visitor who finalizes a period is usually not the winner, and Firestore only ever
    lets a client write its own data — so the actual winner has to claim their own win on a later
    visit, flipping that `periodResults` doc's `claimed` flag and incrementing (or creating) their
    own `playerAchievements` doc's `count` in one transaction.
- **`mission-service.js`** — Daily Missions (Phase 7; Weekly missions were explicitly scoped out
  of this pass -- see `docs/progression-gamification-roadmap.md`'s Phase 7 section). `MISSION_XP`
  (`DAILY: 100`, and a reserved-but-unused `WEEKLY: 300` for when weekly missions are added) and
  `DAILY_MISSIONS`: 3 definitions using the spec's own example thresholds directly (complete a
  Daily Challenge / play 2 different games / earn 500 Points), each with `evaluate(context)` *and*
  `progress(context)` (so the UI can show "1/2" without knowing any mission's underlying field
  names). Unlike every earlier phase, mission **progress itself is never stored** -- it's entirely
  recomputed on every check from today's `gameScores` (`getTodayMissionContext()`, internal), same
  "prefer deriving" principle as Game Level; only *completion* is stored (to prevent
  double-awarding), one `playerMissions/{uid}_{missionId}_{today}` doc per mission per day.
  `syncDailyMissions(uid)` is the one Firestore-writing function -- evaluates, create-only-writes a
  doc + increments `xp` for any newly-completed mission, and returns
  `{ context, completedMissionIds, xpAwarded }` so `profile.js` can render progress and keep its
  in-memory `profile.xp` in sync without a second fetch. Called from `profile.js` on every visit,
  same "silent" surfacing as every other phase.

### `xp`/streak/achievement/championship/mission storage -- the exceptions to "everything here is read-only"

Unlike Game Level, none of XP, the Streak, Achievements, Championships, or Mission *completion*
(mission *progress* is the one exception to this section -- see `mission-service.js` above) can be
derived from existing data after the fact (there's no query that reconstructs "every XP event that
ever happened," "was there a qualifying day every single day," "did this player ever cross this
threshold," "who had the highest score during a week that's since passed," or "was this mission's
reward already claimed today"), so all are stored: `xp` + `lastPerfectDayDate` on
`registeredUsers/{uid}` (Phase 3), `currentStreak` + `lastStreakDate` (Phase 4, `currentStreak`
reused from before Phase 4 existed), `playerAchievements/{uid}_{achievementId}` (Phase 5, one doc
per earned achievement -- doesn't fit on `registeredUsers` the way the others do, since it's
naturally one-to-many), `periodResults/{gameId}_{periodType}_{periodKey}` (Phase 6, one doc per
game/period, entirely global -- not scoped to any single player at all), and
`playerMissions/{uid}_{missionId}_{periodKey}` (Phase 7, one doc per completed mission per period).
`firestore.rules`' `isSelfServiceUpdate()` bounds the `registeredUsers` fields the same way it
already bounded `loginPoints`: a capped delta per write for `xp` (0-300 as of Phase 7 -- widened
from Phase 3's original 0-50 once the 100-XP daily mission reward exceeded that) and `currentStreak`
(only +1, or dropping to exactly 1), via `.get(field, 0)` on both sides of each delta so a
registered user whose doc predates a given field doesn't need a migration -- a missing field is
just treated as 0 and heals forward on that user's next write to it. `playerAchievements` has its
own rule: create-only for most achievements (mirrors `gameScores`), plus a narrow `allow update`
added in Phase 6 letting only a championship achievement's own owner increment its `count` by
exactly 1. `periodResults` allows create by any registered, non-banned user (finalizing is global,
not personal), and allows update *only* by the recorded winner, and *only* to flip `claimed`
false→true. `playerMissions` is create-only, like `gameScores`. All four collections' allow-lists
(achievement ids; game ids/period types; mission ids) must be kept in sync with their JS
counterparts by hand, same maintenance coupling as `maxCreateScore()`'s gameType list.

## Not in scope for Phases 1-7

Not implemented yet, in this folder or anywhere: Overall Rank/Title (deferred past Phase 3 by
explicit user decision), Weekly Missions (deliberately scoped out of Phase 7 -- see
`mission-service.js` above; the reward amount is already decided, just unused). Championships only
look at the single most-recently-closed period each time (an explicit product decision, not a gap)
-- older un-finalized periods are permanently skipped if nobody visits the leaderboard in time; see
`docs/progression-gamification-roadmap.md` for the full phase plan and the full backfill-tradeoff
discussion.

`profile.js`'s "Games mastered" stat tile is now a real count (of earned `category: 'game'`
achievements) as of Phase 5 — it was a hardcoded `0` placeholder before this engine existed. The
"Your Games" section only ever lists what's actually in `GAMES` — no
placeholder/"coming soon" rows for unbuilt games (Crossword, Anagrams, Memory, etc.), by explicit
product direction. Don't add an unbuilt game to `GAMES` just to preview it in the UI — it has no
engine, no scoring, and no real gameTypes, so `leaderboard-data.js` and `progression-service.js`
would start treating it as a real, scoreable game.

## Note on `profile.js`'s `GAME_LABELS`

`src/js/pages/profile.js` keeps its own `GAME_LABELS` map, keyed by individual `gameType`
(`'wordle-tournament': 'Wordle Tournament'`, etc.) for its Recent Activity row labels. That's a
**different shape and purpose** from this registry (per-mode display label vs. per-game
Points aggregation) and was deliberately left alone rather than merged into `GAMES` here.
