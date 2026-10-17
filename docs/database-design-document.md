# Database Design Document
## Daily Mind Challenge

| | |
|---|---|
| **Document status** | New as of 2026-10-17, describing the Cloud Firestore schema as enforced by `firebase/firestore.rules` and implemented by the per-collection data-layer files under `src/js/games/*` and `src/js/progression/`. |
| **Database** | Cloud Firestore, native mode, single database, project `playdailymindchallenge` |
| **Related docs** | `docs/solution-architecture-document.md`, `docs/api-documentation.md`, `docs/data-flow.md`, `firebase/firestore.rules`, `firebase/firestore.indexes.json` |

---

## 1. Overview

This is a **document database**, not relational — there are no foreign keys, joins, or a formal
ER diagram in the SQL sense. "Relationships" are expressed by convention: documents reference each
other by storing another document's ID as a plain string field (most commonly a Firebase Auth
`uid`), and related reads are done as separate, explicit queries, not database-level joins. There
are **29 top-level collections** (plus one subcollection, `wordleChallenges/{id}/completions`).

Every collection falls into one of five groups:

| Group | Collections |
|---|---|
| Accounts | `guests`, `registeredUsers`, `usernames` |
| Scoring | `gameScores` |
| Per-game content (×4 games) | `{game}DailyWords\|Puzzles`, `{game}ClassicPuzzles`, `{game}Tournaments`, `{game}TournamentAttempts`, plus Wordle's `wordleChallenges` + `completions` subcollection and `wordleDailyAttempts`/`connectionsDailyAttempts` |
| Progression | `playerAchievements`, `championshipWinTallies`, `periodResults`, `playerMissions` |
| Platform | `config` |

## 2. Accounts

### `guests/{uid}`
| Field | Type | Notes |
|---|---|---|
| `displayName` | string | Chosen at guest creation |
| `createdAt` | timestamp | Server timestamp |
| `isBanned` | boolean | Admin-settable |

### `registeredUsers/{uid}`
| Field | Type | Notes |
|---|---|---|
| `username` | string | Immutable after creation; also the doc ID used in `usernames/{usernameLower}` |
| `displayName` | string | Self-service editable |
| `email` | string | Optional; real email or a synthetic `{username}@dmc.local` |
| `isAdmin` | boolean | Admin-only field |
| `isBanned` | boolean | Admin-only field |
| `loginPoints` | number | Accumulated daily-login bonus, capped per-write delta in rules |
| `lastLoginDate` | string (`YYYY-MM-DD`) | Gates the once-per-day login bonus |
| `xp` | number | Global XP; capped per-write delta (≤300) in rules |
| `currentStreak` | number | Consecutive-day Daily Challenge completion streak |
| `lastStreakDate` | string (`YYYY-MM-DD`) | Separate from `lastLoginDate` — streak advances on gameplay, not login |
| `lastPerfectDayDate` / `lastFlawlessDayDate` | string (`YYYY-MM-DD`) | "Completed all" vs. "completed and won all" Daily Challenges for a day |
| `perfectDayCount` | number | Lifetime count of flawless days (Triple Threat achievement) |

### `usernames/{usernameLower}`
| Field | Type | Notes |
|---|---|---|
| `uid` | string | Points back to the owning `registeredUsers` doc; create-only, enabling username→email lookup for login |

## 3. Scoring

### `gameScores/{uid}_{gameType}_{dateOrToken}`
The single collection every scored result across every game/mode writes into.

| Field | Type | Notes |
|---|---|---|
| `userId` | string | Must equal the writer's own `request.auth.uid` (rules-enforced) |
| `displayName` | string | Denormalized for leaderboard rendering without a second read |
| `isGuest` | boolean | Denormalized account-type flag |
| `gameType` | string | e.g. `wordle`, `sudoku-classic`, `connections-tournament` — see `src/js/progression/game-registry.js` for the full list per game |
| `score` | number | Bounded by `maxCreateScore(gameType)` in rules |
| `gameDate` | string | Part of the doc ID; for Daily, a real date; for Classic/Tournament/Challenge, often a repurposed unique token, not a calendar date |
| `scoreDate` | string (`YYYY-MM-DD`) | **Always** a real calendar date, used for leaderboard period bucketing — the field that exists specifically so `gameDate`'s dual purpose doesn't break period queries |
| `sharedToFacebook` / `sharedWithFriends` | boolean | Each a one-time, independently-claimable +20/+10 share bonus |
| `createdAt` | timestamp | Server timestamp |
| *(game-specific fields)* | varies | e.g. `attempts`, `mistakes`, `difficulty`, `won`, `challengeId` — see each game's own data-layer file |

**Document ID is the access-control mechanism**, not just an identifier: it's deterministic
(`{uid}_{gameType}_{date}`), so a repeat write for the same player/game/day is rejected server-side
as an `update` (Firestore rules only allow `create` on this path) rather than quietly double-
scoring.

## 4. Per-Game Content (one family per game, structurally parallel across all four)

| Collection | Doc ID | Shape |
|---|---|---|
| `wordleDailyWords` | `{YYYY-MM-DD}` + a `_meta` doc | `{ challengeNumber, word }`; `_meta` holds `{ totalCount, firstDate, lastDate }` |
| `sudokuDailyPuzzles` | `{YYYY-MM-DD}` + `_meta` | `{ challengeNumber, puzzle, solution }` (81-char digit strings) |
| `wordsearchDailyPuzzles` | `{YYYY-MM-DD}` + `_meta` | `{ challengeNumber, theme, words[] }` |
| `connectionsDailyPuzzles` | `{YYYY-MM-DD}` + `_meta` | `{ challengeNumber, groups: [{ name, words[4] }] × 4 }` |
| `{game}ClassicPuzzles` | numeric string, one shared counter per game across difficulties | `{ difficulty, ...puzzle fields }` |
| `{game}Tournaments` | auto-ID | `{ name, active, bonusPoints, timePer*Seconds, puzzles[]/words[] }` |
| `{game}TournamentAttempts` | `{tournamentId}_{uid}` | Progress-only (current index, puzzles/words won, completed flag); points are granted separately via the guarded `gameScores` create |
| `wordleDailyAttempts` / `connectionsDailyAttempts` | `{uid}_{date}` | `{ uid, date, attemptsCount, won, lastAttemptAt }` — tracks the hourly-retry state for games whose Daily Challenge allows retries after a loss |
| `wordleChallenges` | auto-ID, + `_meta` (global counter) | `{ creatorUid, word, visibility, challengeNumber, createdAt, expiresAt }` |
| `wordleChallenges/{id}/completions/{uid}` | subcollection, one per solver | `{ won, attempts, completedAt }` |

All Daily collections share the same date-keyed design: a puzzle's document ID **is** the exact
date it plays on, assigned once at creation (sequentially, from an admin-chosen start date or the
day after the previous entry) and never recomputed — adding more puzzles later never shifts an
existing puzzle's date.

## 5. Progression

| Collection | Doc ID | Shape |
|---|---|---|
| `playerAchievements` | `{uid}_{achievementId}` | `{ uid, achievementId, count: 1, createdAt }` — strictly create-only, one doc per earned achievement; `achievementId` must be in a hand-maintained allow-list in `firestore.rules` (85 entries as of this writing) |
| `championshipWinTallies` | `{uid}_{gameId}_{periodType}` | `{ uid, gameId, periodType, count }` — a plain running win count, bounded to advance by exactly +1 per write |
| `periodResults` | `{gameId}_{periodType}_{periodKey}` | `{ gameId, periodType, periodKey, winnerUid, winnerDisplayName, points, claimed }` — one per finalized Championship period, global (not scoped to a player) |
| `playerMissions` | `{uid}_{missionId}_{periodKey}` | `{ uid, missionId, periodType, periodKey, xpAwarded, completedAt }` — create-only, one per completed mission per period |

## 6. Platform

### `config/{docId}`
One document per admin-editable setting group (`dailyLoginReward`, `challengeExpiration`,
`myChallengesPageSize`, `browseChallengesPageSize`, `leaderboardPageSize`,
`challengeAttemptsPageSize`, `sudokuTournamentSettings`, `wordsearchTournamentSettings`,
`cookieConsent`, `wordValidationAPI`, `profanityList`, `ads`). Publicly readable, admin-write-only.
Each doc's shape is specific to its setting (see `src/js/utils/config.js#CONFIG_DEFAULTS`).

## 7. Relationships

Since there are no database-level joins, every "relationship" is one of these patterns:

1. **By `uid`** — the dominant pattern. A player's `gameScores`, `playerAchievements`,
   `championshipWinTallies`, `playerMissions`, and `*Attempts` documents are all found by querying
   `where('userId'/'uid', '==', uid)` or by direct ID lookup (`{uid}_...`), never a join.
2. **By deterministic composite ID** — `{uid}_{gameType}_{date}`, `{tournamentId}_{uid}`,
   `{uid}_{achievementId}`, etc. The ID itself encodes the relationship and doubles as the
   uniqueness/replay-prevention constraint.
3. **Denormalization over lookup** — `displayName` and `isGuest` are copied onto `gameScores` at
   write time rather than looked up from `registeredUsers`/`guests` at read time, so rendering a
   leaderboard needs zero additional per-row reads.
4. **Subcollections** — used exactly once (`wordleChallenges/{id}/completions/{uid}`), for a
   genuinely one-to-many, always-fetched-together relationship (a challenge and its solvers).

## 8. Indexes

Composite indexes defined in `firebase/firestore.indexes.json`:

| Collection | Fields | Supports |
|---|---|---|
| `gameScores` | `gameType ASC, gameDate ASC` | Per-game Daily Challenge "already played today" style lookups by date-as-key |
| `gameScores` | `gameType ASC, scoreDate ASC` | Per-game leaderboard queries over a real calendar period |
| `gameScores` | `userId ASC, createdAt DESC` | A player's recent activity feed |
| `gameScores` | `userId ASC, gameDate ASC` | A player's own history by game-date key |
| `wordleChallenges` | `visibility ASC, createdAt DESC` | Browsing public challenges, newest first |
| `wordleChallenges` | `creatorUid ASC, createdAt DESC` | A creator's own challenge list |

Every other query in the system is either a single-field equality/range query (Firestore's
automatic single-field indexes cover these with no explicit definition needed) or a direct
document-ID `getDoc`.

## 9. Constraints

Firestore has no native column types, foreign keys, or check constraints — every constraint in
this system is enforced in `firebase/firestore.rules` at write time:

- **Ownership:** `request.auth.uid` must match the document's own `userId`/`uid` field for any
  self-service write.
- **Uniqueness/replay prevention:** deterministic document IDs combined with create-only rules
  (no `update` allowed on that ID pattern) — see `gameScores`, `playerAchievements`.
- **Bounded deltas:** `registeredUsers.xp`/`loginPoints`/`currentStreak`/`perfectDayCount` may only
  change by a capped amount per write (e.g. XP ≤ +300 per write), preventing a single malicious
  write from awarding unlimited progression currency.
- **Value caps:** `gameScores.score` is capped per `gameType` via `maxCreateScore()`.
- **Allow-lists:** `playerAchievements.achievementId` and `championshipWinTallies.gameId` must
  match a hand-maintained list in rules (rules can't import the JS registries that are the
  *actual* source of truth, so these two lists must be kept in sync by hand when a game or
  achievement is added — a known, documented maintenance coupling).
- **Admin gating:** all content-seeding and moderation writes require `isAdmin() == true`,
  evaluated server-side against the caller's own `registeredUsers` document.

## 10. Data Migration Notes

See `docs/deployment-and-release-document.md`'s "Database Migrations" section — there is no
migration framework; schema evolution happens via additive, default-tolerant fields and new
collections, not versioned migrations.
