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
  `awardDailyCompletionXp(uid, allDailyGamesCompletedToday, allDailyGamesWonToday)` and
  `awardShareXp(uid)` are the two actual Firestore-writing functions, called from each game's
  Daily Challenge completion handler and from every `markSharedToFacebook()`/
  `markSharedWithFriends()` implementation across the codebase respectively. `allDailyGamesWonToday`
  (added alongside `achievement-registry.js`'s "Perfect Day"/"Triple Threat") is a separate signal
  from completion -- Wordle can record a score on a *loss* (6 failed guesses still writes a doc),
  while Sudoku/Word Search Daily have no loss condition at all (see their own `won: true` doc
  comments in `sudoku-daily-data.js`/`wordsearch-daily-data.js`), so in practice only Wordle can
  make this false. When both completion and win are true and it's a new calendar day for this:
  writes `lastFlawlessDayDate` (a stricter twin of `lastPerfectDayDate` -- completed-and-won all 3,
  not just completed) and increments a lifetime `perfectDayCount` tally (for "Triple Threat": N
  *different* days with a flawless day, not a streak of consecutive ones). Both silently no-op for
  a uid with no `registeredUsers` doc (guests), so call sites never need their own
  `profile.kind === 'registered'` check before calling them --
  though the Daily Challenge call sites still check it anyway, to skip an unnecessary
  `checkPlayedTodayAll()` read for guests.
- **`rank-service.js`** — Overall Rank (Section 14), picked back up after being deferred out of
  Phase 3. Pure and read-only, no Firestore code at all. `MAIN_RANKS`: 10 tiers (10,000 XP per
  tier -- Novice through Legend, the user's exact thresholds/names), each `{ tier, name, image,
  color }` -- `image` points at one of the cropped *generic per-tier* badge assets in
  `src/assets/images/` (`rank-novice.png` .. `rank-legend.png`), used for the "All Ranks" strip and
  the hero progress bar's flanking main-rank icons; `color` is that tier's accent hex, sampled
  directly off the user-supplied `sub-ranks.png` reference sheet's own row background -- tracked
  for later use (e.g. tinting rank-related UI) even though nothing reads it yet. `calculateMainRank(xp)`
  returns just the tier object.

  `subRankImagePath(mainRank, subRankNumber)` (internal) resolves one of the **100** per-sub-rank
  badge images at `src/assets/images/sub-ranks/{rankName}-{1..10}.png` (e.g. `novice-7.png`) --
  cropped from a separate user-supplied 10x10 reference sheet, one badge per exact "{Rank}
  {Numeral}" combination. These are what the profile page's avatar actually shows now (via
  `calculateRankProgress()`'s `subRankImage` field, see `profile.js` below) -- the original
  `MAIN_RANKS[].image` badges are still used, just no longer as the avatar; they're the "generic
  tier" icon everywhere a granularity coarser than the player's exact sub-rank makes sense.

  `calculateRankProgress(xp)` returns the full breakdown used by the profile page: sub-rank fields
  (`label` e.g. "Novice VII", `subRankImage` -- the exact-sub-rank badge path above,
  `progressPercent`/`xpToNextSubRank`/`nextLabel`/`nextSubRankImage` for the 1,000-XP-wide sub-rank
  band -- 10 sub-ranks per main rank, Roman numerals I-X, matching the spec's own "Grandmaster III"
  mockup -- confirmed with the user after an earlier "9 sub-ranks" reading based on ambiguous
  example numbers turned out wrong) *and* main-rank fields
  (`mainRankProgressPercent`/`xpToNextMainRank`/`nextMainRank` for the coarser 10,000-XP band) --
  both granularities are shown at once on the profile page (sub-rank as the big "X / 1,000 XP"
  number, main-rank as the flanking-icon progress bar it sits inside), deliberately not the same
  metric twice. Caps at Legend (and sub-rank X) for any XP >= 90,000 (an assumption made when this
  was built, not an explicit decision -- there's no 11th tier to grow into); at max rank,
  `nextSubRankImage` just repeats the current badge, same fallback the label/mainRank fields
  already use. `GUEST_RANK_IMAGE` is a separate, fixed badge (`rank-guest.png`) for guests, who
  don't earn XP/Rank (Section 4) -- shown instead of defaulting them into "Novice," which would
  misrepresent it as a real rank.

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

- **`achievement-registry.js`** — the Achievement Engine's definitions, a static code registry
  (decided with the user, not Firestore/admin-editable) rather than one big
  `WordleAchievementService`/etc — this is exactly the "generic engine" the spec's Section 17
  insists on. Fully replaced once, wholesale, with a user-supplied 67-achievement list -- the
  earlier, smaller registry (a single per-game `{Game} Master` at Level 10, `explorer-5/10/20`
  "played N different games", `puzzle-collector`, and non-tiered Championships) is gone entirely;
  old ids not in the new list just stop being evaluated (any already-earned `playerAchievements`
  docs under them are harmless orphans, same as every earlier id rename in this app -- no
  migration needed). `ACHIEVEMENTS`: an array of
  `{ id, category, label, description, evaluate(context), progress(context)?, target? }`. Both
  `evaluate()` and `progress()` are pure functions, no Firestore access -- they only read whatever
  `context` `profile.js` assembled. `progress()`/`target` are optional -- used by `profile.js` to
  sort an *unearned* achievement into "In Progress" (progress > 0) vs. "Not Started" (progress ===
  0) for its status-grouped layout, and to render a live "current / target" line + bar for the
  former; entries without a `progress()` (`daily-mind-champion`, `perfect-day`) stay binary,
  since "did I ever have one" isn't a cumulative fraction.

  Categories:
  - `game` — three level tiers per entry in `GAMES` (`{gameId}-expert/-master/-grandmaster`, at
    Levels 25/50/100). Descriptions/progress use the raw level + 1 (progression-service.js's Game
    Level is 0-indexed; `profile.js`'s "Your Games" cards display level+1), so "Reach Level 25"
    means a raw threshold of 24.
  - `streak` — `streak-7/30/100/200/365`, mirroring `streak-service.js`'s own milestone list as a
    separate literal (kept decoupled from any Firestore-touching module).
  - `global` — `daily-mind-champion` (completed all 3 that day, any outcome), `perfect-day`
    (stricter: completed *and won* all 3 -- see `xp-service.js#awardDailyCompletionXp()`),
    `triple-threat` (`perfectDayCount >= 7`, a lifetime tally of distinct flawless days, not a
    streak), `all-rounder`/`puzzle-enthusiast`/`mind-master` (Level 2/5/10 in *every* game
    simultaneously -- a lower per-game bar than the `game` category's own tiers, since it needs
    all 3 at once), `puzzle-addict` (100 games played total, any mode/game --
    `context.totalGamesPlayed`), `mind-athlete` (10,000 lifetime points).
  - `championship` — 45 entries (3 games x {Daily, Weekly, Monthly} x 5 win-count tiers each:
    Daily 1/7/30/50/100, Weekly 1/5/10/25/50, Monthly 1/3/6/9/12). **No `evaluate()`** -- unlike
    every other category, these can't be locally evaluated from progression data alone; they're
    awarded by `championship-service.js` instead (one separate one-time achievement id per tier,
    not one achievement whose `count` accumulates -- see that file's own doc comment for the full
    design). They DO have a `progress()`, sourced from `context.championshipTallies` (the running
    win count `championship-service.js#getChampionshipTallies()` returns), so an unearned tier can
    still show real "12 / 30"-style progress. `CHAMPIONSHIP_TIERS`/`PERIOD_LABEL`/`PERIOD_ID` here
    must exactly match `championship-service.js`'s own copies -- kept as separate literals (this
    file stays Firestore-free) rather than imported, same precedent as `STREAK_MILESTONES` above.
- **`achievement-engine.js`** — the Phase 5 engine. `getPlayerAchievements(uid)` (reads a player's
  own `playerAchievements` docs) and `syncPlayerAchievements(uid, context)` (evaluates every
  `ACHIEVEMENTS` entry that has an `evaluate()` against `context`, create-only-writes a doc for
  any newly-satisfied one the player doesn't already have, returns the full up-to-date earned
  list -- entries with no `evaluate()`, i.e. `championship`, are skipped here, not evaluated).
  Called from exactly one place — `profile.js`, on every visit — per the "silent, shows up on next
  profile visit" surfacing decision (no toasts/popups, no hooks added to any game page). This
  function does no `profile.kind` check itself (it has no `registeredUsers` read of its own —
  `context` arrives pre-computed), so **callers must already be scoped to registered players**.
- **`championship-service.js`** — Championships, now Daily + Weekly + Monthly (`periodType`
  `'day'`/`'week'`/`'month'`). Pure period-key functions `getPreviousDayPeriod()`/
  `getPreviousWeekPeriod()`/`getPreviousMonthPeriod()` (built on ISO-8601 week math in
  `utils/helpers.js`, always the most recently *closed* period relative to today) plus
  `getPeriodNStepsBack(periodType, n, today)` (an internal generalization used only by the backfill
  scan below, kept separate from the three named functions above so already-relied-upon code stays
  untouched).

  **Finalization is admin-only now** — moved off the original "any registered visitor triggers it
  on the leaderboard page" design specifically because that let whichever visitor's local device
  clock crossed into a new period first decide the cutoff for literally everyone, with no way to
  know if a slower/behind timezone still had legitimate plays coming. `periodSafeInstant(period)` /
  `isPeriodSafeToFinalize(period)` compute a period's safe-to-finalize instant as 12 hours past
  when it closes in UTC — enough for even UTC-12, the last timezone on Earth, to have crossed over
  — as a single absolute instant (not tied to any specific timezone; the admin UI just renders it
  in whatever local time the viewing browser happens to be in).

  - `computeWinner(gameId, startDate, endDate)` — the shared "top-scoring *registered* player over
    a date range" lookup (via `leaderboard-data.js#getGameScoresForDateRange()`), factored out so
    `finalizePeriod()` and `refinalizePeriod()` below don't duplicate it. A guest can top the raw
    scores but can't hold an achievement (Section 4), so the next-highest registered player is
    crowned instead.
  - `getMissingPeriods(gameId, periodType)` — the backfill scan: walks up to
    `MAX_BACKFILL_LOOKBACK` periods back (30 days / 12 weeks / 12 months), keeps only the ones
    already past their safe instant, and returns whichever of those don't have a `periodResults`
    doc yet (via a batched, 10-per-chunk `documentId() in [...]` existence check —
    `fetchExistingPeriodIds()`). Unlike the old lazy version, this isn't limited to "just the
    single most recent period" — a missed admin visit no longer permanently loses a period, it
    just sits in this list until the next run.
  - `getGamePeriodStatus(gameId, periodType)` / `getAllPeriodStatuses()` — the admin panel's
    status-table data: for each game × period type, whether it's already finalized (with winner),
    safe and ready, or still counting down (with the exact safe instant for a live countdown), plus
    any older missing periods bundled in.
  - `finalizeAllPending()` / `finalizePendingFor(gameId, periodType)` — the "Run All Eligible"
    button and the per-row "Finalize" button respectively, both just running `finalizePeriod()`
    over whatever `getMissingPeriods()` currently returns.
  - `refinalizePeriod(gameId, periodType, periodKey)` — admin-only override to recompute and
    overwrite an *already*-finalized period (e.g. after banning a cheater, to credit the rightful
    winner). Reads the existing doc's own `startDate`/`endDate` rather than re-deriving them from
    `periodKey`, and deliberately **preserves** the existing `claimed` flag when the recomputed
    winner is unchanged — otherwise a player who already claimed this win could get silently reset
    to unclaimed and double-increment their own achievement count on their next profile visit.
    Only resets `claimed: false` when the winner has genuinely changed.
  - `getPeriodResult(gameId, periodType, periodKey)` — a single finalized period's result, or
    `null`. Used by the admin panel's Marketing Top 10 viewer (see `admin/CLAUDE.md`) to show that
    exact period's official Champion alongside the live numbers, with a Re-finalize action --
    there's no separate history/audit list anymore, that was merged into this same viewer since
    both needed the identical game/period inputs.
  - `CHAMPIONSHIP_TIERS` — win-count milestones per period type (`day: [1,7,30,50,100]`,
    `week: [1,5,10,25,50]`, `month: [1,3,6,9,12]`) -- must exactly match
    `achievement-registry.js`'s own copy of these numbers (kept as a separate literal there, same
    precedent as streak milestones).
  - `getChampionshipTallies(uid)` — every game's running win-tally across all period types for one
    player (`{ [gameId]: { day, week, month } }`), read by `profile.js` and folded into the
    achievement `context` so `achievement-registry.js`'s championship `progress()` functions have
    something to show for an unearned tier.
  - `claimChampionshipAchievements(uid)` — called from `profile.js`, the one piece of this that
    stays visitor-triggered rather than admin-only: the person who finalizes a period (the admin)
    is essentially never the winner, and Firestore only ever lets a client write its own data — so
    the actual winner still has to claim their own win on a later visit. Per unclaimed win (looped
    sequentially, not `Promise.all` -- see the function's own comment for why two wins claimed in
    the same visit would otherwise race on the same tally doc): flips that `periodResults` doc's
    `claimed` flag and increments a `championshipWinTallies/{uid}_{gameId}_{periodType}` counter
    by exactly 1, in one transaction. If the new tally value exactly matches one of
    `CHAMPIONSHIP_TIERS`' thresholds, that specific tier gets its own one-time, create-only
    `playerAchievements` doc (e.g. crossing 7 total Daily wins creates `{gameId}-daily-champion-7`)
    — a structural change from the original design, where a single accumulating achievement's own
    `count` field tracked wins directly; now the tally is a separate, non-achievement counter, and
    every `playerAchievements` doc (including every championship tier) is uniformly create-only,
    never updated. `tierAchievementId()` builds ids via a `PERIOD_LABEL` map (`day`→`daily`,
    `week`→`weekly`, `month`→`monthly`) rather than naively appending "ly" to `periodType`, which
    would produce the wrong word ("dayly") for the daily case; the tier-1 id for each game/period
    (e.g. `wordle-daily-champion`) is unchanged from the original single-achievement design, so a
    player who'd already won once before this restructuring keeps that badge under the same id.

  `admin-page.js`'s "Manual Executions" section is the only caller of everything above except
  `claimChampionshipAchievements()`/`getChampionshipTallies()` — see `admin/CLAUDE.md`.
- **`mission-service.js`** — Daily Missions (Weekly missions were explicitly scoped out of Phase 7
  -- see `docs/progression-gamification-roadmap.md`'s Phase 7 section). `MISSION_XP` now holds only
  a reserved-but-unused `WEEKLY: 300`; the original flat `DAILY: 100` was removed once the user's
  5-mission redesign gave each mission its own distinct `xp` value instead of one shared amount.
  `DAILY_MISSIONS`: 5 definitions (replacing the original 3), each with `evaluate(context)` *and*
  `progress(context)` (so the UI can show "current / target" without knowing any mission's
  underlying field names):
  - `daily-complete-3-challenges` (75 XP) -- all 3 games' Daily Challenges today.
  - `daily-play-3-games` (30 XP) -- 3 different games today.
  - `daily-earn-1000-points` (50 XP) -- 1,000 Points today, any game.
  - `daily-wordle-challenge-3-plays` (300 XP) -- **strict same-day**: create a *new* Wordle
    Challenge today AND have it reach 3 total plays that same day (an explicit user decision,
    chosen over a "progress carries across days" one-time-unlock alternative). Deliberately
    Wordle-specific -- a one-off exception to "no hardcoded specific game," since Wordle is the
    only game with a Challenge-a-Friend feature to hang this on at all. Needs
    `wordle-challenge-data.js#listWordleChallengesCreatedToday()` (new) +
    `getWordleChallengeAttemptCount()` to find the max attempt count across whatever the player
    created today (`getTodaysWordleChallengeMaxAttempts()`, internal).
  - `daily-share-facebook-group` (30 XP) -- derived entirely from today's already-fetched
    `gameScores` docs (`sharedToFacebookToday`, checked off the same query used for
    `pointsEarnedToday`) -- no new write path. "Copy Result & Share with Community" on any game
    already opens the exact `facebook.com/groups/playdailymindchallenge` group and sets
    `sharedToFacebook`, so this mission just layers its own separate XP reward on that existing
    signal.

  Unlike every earlier phase, mission **progress itself is never stored** -- it's entirely
  recomputed on every check from today's `gameScores` plus (for the Wordle-challenge mission) a
  small `wordleChallenges` read (`getTodayMissionContext()`, internal), same "prefer deriving"
  principle as Game Level; only *completion* is stored (to prevent double-awarding), one
  `playerMissions/{uid}_{missionId}_{today}` doc per mission per day -- ids were renamed alongside
  the redesign (`daily-complete-challenge`→`daily-complete-3-challenges`, etc.), which is safe
  since old completed-today docs under the retired ids just stop being evaluated, no migration
  needed. `syncDailyMissions(uid)` is the one Firestore-writing function -- evaluates,
  create-only-writes a doc + increments `xp` for any newly-completed mission, and returns
  `{ context, completedMissionIds, xpAwarded }` so `profile.js` can render progress and keep its
  in-memory `profile.xp` in sync without a second fetch. Called from `profile.js` on every visit,
  same "silent" surfacing as every other phase.

### `xp`/streak/achievement/championship/mission storage -- the exceptions to "everything here is read-only"

Unlike Game Level, none of XP, the Streak, Achievements, Championships, or Mission *completion*
(mission *progress* is the one exception to this section -- see `mission-service.js` above) can be
derived from existing data after the fact (there's no query that reconstructs "every XP event that
ever happened," "was there a qualifying day every single day," "did this player ever cross this
threshold," "who had the highest score during a week that's since passed," or "was this mission's
reward already claimed today"), so all are stored: `xp` + `lastPerfectDayDate` +
`lastFlawlessDayDate` + `perfectDayCount` on `registeredUsers/{uid}`, `currentStreak` +
`lastStreakDate` (`currentStreak` reused from before its gameplay-based redefinition),
`playerAchievements/{uid}_{achievementId}` (one doc per earned achievement -- doesn't fit on
`registeredUsers` the way the others do, since it's naturally one-to-many),
`periodResults/{gameId}_{periodType}_{periodKey}` (one doc per game/period, entirely global -- not
scoped to any single player at all), `championshipWinTallies/{uid}_{gameId}_{periodType}` (one doc
per player/game/period-type, a plain running win count -- separate from the achievement docs
themselves, see `championship-service.js`'s own entry above for why), and
`playerMissions/{uid}_{missionId}_{periodKey}` (one doc per completed mission per period).
`firestore.rules`' `isSelfServiceUpdate()` bounds the `registeredUsers` fields the same way it
already bounded `loginPoints`: a capped delta per write for `xp` (0-300, covering the largest
single legitimate write, a 100-XP Daily Mission reward) and `currentStreak`/`perfectDayCount`
(each only ever +1, or `currentStreak` dropping to exactly 1), via `.get(field, 0)` on both sides
of each delta so a registered user whose doc predates a given field doesn't need a migration -- a
missing field is just treated as 0 and heals forward on that user's next write to it.
`playerAchievements` is purely create-only, no exceptions (Championships used to have a narrow
`allow update` to accumulate a `count` -- removed once win-counting moved to the separate
`championshipWinTallies` collection, which has its own bounded +1-per-write `allow update`,
mirroring `currentStreak`'s shape). `periodResults` create/update is admin-only (see
`admin/CLAUDE.md`'s "Manual Executions" section); a separate, narrower `allow update` still lets
only the recorded winner flip `claimed` false→true. `playerMissions` is create-only, like
`gameScores`. All these collections' id allow-lists (achievement ids; game ids/period types;
mission ids) must be kept in sync with their JS counterparts by hand, same maintenance coupling as
`maxCreateScore()`'s gameType list -- the achievement one in particular is now 67 entries long.

## Not in scope

Not implemented yet, in this folder or anywhere: Weekly Missions (deliberately scoped out -- see
`mission-service.js` above; the reward amount is already decided, just unused). Overall Rank/Title
is **implemented**, just not in this folder -- see `rank-service.js`'s own entry above, a fully
custom scheme built with the user, superseding the spec's own undefined version. Championship
finalization is admin-only and backfills gaps (up to 30 days / 12 weeks / 12 months) rather than
only ever checking the single most-recently-closed period -- see `championship-service.js`'s own
entry above and `admin/CLAUDE.md`'s "Manual Executions" section for the full design.

`profile.js`'s "Achievements" stat tile shows a real count of every distinct earned achievement,
any category (not just `game`) -- it was a hardcoded `0` placeholder before this engine existed.
The "Your Games" section only ever lists what's actually in `GAMES` — no
placeholder/"coming soon" rows for unbuilt games (Crossword, Anagrams, Memory, etc.), by explicit
product direction. Don't add an unbuilt game to `GAMES` just to preview it in the UI — it has no
engine, no scoring, and no real gameTypes, so `leaderboard-data.js` and `progression-service.js`
would start treating it as a real, scoreable game.

## Note on `profile.js`'s `GAME_LABELS`

`src/js/pages/profile.js` keeps its own `GAME_LABELS` map, keyed by individual `gameType`
(`'wordle-tournament': 'Wordle Tournament'`, etc.) for its Recent Activity row labels. That's a
**different shape and purpose** from this registry (per-mode display label vs. per-game
Points aggregation) and was deliberately left alone rather than merged into `GAMES` here.
