# Guest play: instant play, guest progression, saving progress

> Built 2026-11-14. **Why:** with six games and no players yet, the biggest barrier was the site
> itself. Every game page showed "Sign In to Play", and a guest had to open a box and type a name
> before trying a single puzzle. Guests also earned no Rank, XP, streak or badges, and signing up
> created a *new* account, so a guest lost everything they had earned. This change removes the
> barrier, gives guests the full ranking system, and makes "save your progress" the reason to sign up.
> 2026-11-15: guests are now created **automatically** on game pages (no tap), with bot detection and
> an "Already have an account? Log in" bar for members on a new device.

## What players see

| Moment | What happens |
|---|---|
| A new visitor opens a game | **Since 2026-11-15: a guest is created automatically and the puzzle loads straight away**, with no tap. A slim bar above the game says *"You're playing as Clever Fox 482. Already have an account? Log in"* until it's dismissed, they log in, or they finish a Daily. |
| When it is *not* automatic | **Home page** (browsing needs no account), **search-engine bots / automated browsers** (they see the **"Play now"** card, so the page stays crawlable), a **browser a member has used** ("Welcome back, Log in" first), and right after a **guest logged out on purpose** ("Play now" instead, so logging out works). |
| Guest name | Automatic and unique: **adjective + animal + 3 digits**, e.g. "Clever Fox 482" (4 digits after repeated clashes). Guests can't rename themselves; choosing a name is a member perk. |
| Guests earn | Points, **XP, Rank, Level, streak, achievements, missions**, Cat Café: everything members earn. |
| Members only | Weekly/Monthly/Daily **championships** (titles and champion badges), **Challenge a Friend**, the daily login bonus, Settings. |
| After finishing a Daily | A "Nice one, Clever Fox 482!" card: progress lives on this browser for 30 days after the last visit, so save it. At most once a day per browser. |
| Profile / home | Real rank, level, streak, missions and badges, plus a "Your progress isn't saved yet" banner / line. |
| Header menu (guest) | **Save my progress** and **Log in to an account**, instead of Settings. |
| Save my progress | `/?save=1` opens Sign Up in "Save your progress" mode with a suggested username ("CleverFox482"). The **same account** becomes a member, so every point, badge, streak and score is kept. |
| A guest logs in to an existing account | If the guest has progress, a warning first: it can't be merged into an existing account and is left behind. Cancel keeps the guest signed in. |
| A member's browser | Game pages show **"Welcome back! Log In to Play"** first (with "Play as a guest" as the alternative), so returning members don't end up with stray guest accounts. |
| Taken username | "That username is already taken. If it's yours, use the Log In tab instead." |
| Display names | Members can't pick a name in the guest pattern (word word digits), so a member never looks like a guest. |

## How it works

- **Starting a guest:** `app.js#trySessionOrGuest()` (all six game pages) and `utils/guest-start.js`:
  - `trySessionOrGuest()` resolves the session, or creates a guest automatically when `shouldAutoStartGuest()` allows it;
  - `shouldAutoStartGuest()` = not a bot (`isLikelyBot()`: `navigator.webdriver` or a crawler/headless/link-preview user agent), no member flag on this browser, and no "guest logged out" flag (`dmc_no_auto_guest`, set by app.js on a guest's logout, cleared when a guest starts again);
  - `renderAutoGuestBar()` shows the "Already have an account?" bar while `dmc_new_auto_guest` is set;
  - `renderPlayGate()` is the game pages' no-session view (bots, members' browsers, after logout);
  - `startGuestSession()` does the anonymous sign-in plus the profile.
- **Slow first read:** `app.js` retries the profile read twice when Firestore says it can't reach the server yet ("client is offline"), so a slow phone connection no longer bounces a signed-in player to the home page.
- **Unique names:** `utils/guest-names.js` and `auth/user-profile.js#createGuestProfile()`.
  - The guest doc and `guestNames/{nameKey}` (e.g. `clever-fox-482`) are written in one batch.
  - The rules let a name be *created* once and never overwritten, so a clash fails the batch and the guest draws again (5 tries, then 4 digits).
- **Where progression is saved:** `auth/profile-ref.js#profileDocRef(uid)`.
  - `xp-service`, `streak-service` and `mission-service` write to `guests/{uid}` or `registeredUsers/{uid}`, depending on the session kind recorded by `loadSessionProfile()`.
  - The rules bound guest changes exactly like member changes: XP +0..300 per write, streak +1 or reset to 1, perfect-day count +1.
- **Achievements and missions:** the rules now allow any non-banned player, member or guest (`isPlayerNonBanned()`).
- **Championships:** these were already members-only. `championship-service.js#topRegisteredPlayer` skips guests, so the best member is crowned.
- **Saving a guest as a member** (same uid):
  1. `auth.js#linkGuestToPassword()` attaches an email/password login to the anonymous user (`linkWithCredential`) and refreshes the token.
  2. `user-profile.js#convertGuestToMember()` runs one batch:
     - creates `registeredUsers/{uid}`, carrying `xp`, `currentStreak`, `lastStreakDate`, `lastPerfectDayDate`, `lastFlawlessDayDate` and `perfectDayCount` over;
     - reserves the username;
     - deletes `guests/{uid}` and its `guestNames` doc.
  3. Past `gameScores` are relabelled with the member's display name and `isGuest: false`. The rule allowing this is `isIdentityRelabel`.
  4. Achievements, missions and attempts are keyed by uid, so nothing else moves.
  - **Interrupted save:** if the tab closes between steps 1 and 2, the details are kept in `localStorage` (`dmc_pending_conversion`), and the next page load finishes the save.
- **Leaderboards:** `leaderboard-data.js`:
  - looks up XP in both collections, so guests show their real rank badge;
  - always prefers a player's member-labelled scores for their name and guest flag.
- **Returning-member hint:** `localStorage` `dmc_member` is set whenever a member session loads, or on sign-up or conversion. It's per browser, holds no personal data, and only decides which button the game page shows first.

## Security rules changed (`firebase/firestore.rules`)

- **`guests/{uid}`:**
  - **create:** anonymous only; fixed field list; XP and streak start at 0; `nameKey` must match the display name; its `guestNames` reservation must belong to this uid.
  - **update:** progression fields with the bounded deltas above.
  - **delete:** the guest themselves (conversion) or an admin (clean-up).
- **`guestNames/{nameKey}`:** create-only reservation; deleted by its owner or an admin.
- **`registeredUsers/{uid}` create (security fix):** before this change it checked nothing but the uid, so a new sign-up could create its own profile with `isAdmin: true` or any XP. Now:
  - the login must be non-anonymous;
  - `isAdmin` and `isBanned` must be false and login points 0;
  - XP, streak and perfect-day count must equal the guest doc's values (0 for a brand-new member).
- **`gameScores` update:** adds `isIdentityRelabel`. The owner, once a member, may change only `displayName` (to their current one) and `isGuest` (to false).
- **`playerAchievements` / `playerMissions` create:** `isPlayerNonBanned()` instead of members-only.

## Admin: Guest clean-up (manual)

Admin → General → **Guest Clean-up** (`admin/guest-cleanup.js`):

1. **Check** lists guests whose last visit (`lastLoginAt`, refreshed on every page load) is older than N days (default 30). Tick **"Only guests who never finished a game"** to list just the empty guests that automatic guest creation leaves behind (safe to clear after about 7 days). It shows how many there are, their scores and records, and the oldest last-seen date. **It deletes nothing.**
2. **Delete N guests** asks for confirmation, then removes each guest along with:
   - their `gameScores`, achievements and missions;
   - every game's attempt docs;
   - their name reservation and their guest doc.

   A progress line shows while it runs.

- **Members are never touched.** Only `guests` docs are listed.
- **Logins aren't deleted.** Guests' Firebase Auth logins can't be deleted from a browser (that needs a server). They hold no data and cost nothing.
- **Returning guests:** a deleted guest who comes back quietly gets a fresh guest profile on the same login (`loadSessionProfile()`), with no error.
- **Past leaderboards:** a deleted guest's scores leave past leaderboards too, so the boards only show real players.

## Cost / performance

- **Rank costs nothing to store:** it is derived from XP at display time.
- **Extra writes:** guest progression adds roughly one small write per finished puzzle, one per achievement or mission, and one name reservation per guest. Cost follows players, not account type.
- **No crawler accounts:** bots are detected and get no account; real visitors get one only on a game page (about 2 small writes each), never on the home page. Empty guests can be cleared with the "never finished a game" filter.

## Testing

`tools/guest-e2e-test.mjs` (emulators; setup as in `pounce-e2e-test.mjs`) covers 43 checks. Pages act as a real visitor (normal user agent, `navigator.webdriver` false); one page keeps headless Chrome's signals to act as a bot:

- a bot gets the Play now gate and no account; a real visitor gets a guest automatically, the Daily and the "Already have an account?" bar; the home page and later game visits keep the same guest;
- a guest who logs out gets Play now (not a new guest), and Play now still works;
- unique names;
- guest XP, streak and achievements, plus the rules that refuse:
  - inflated XP;
  - an anonymous member doc;
  - overwriting a taken name;
- the save card, and the profile banner and rank;
- conversion: same uid, carried-over XP and streak, guest docs removed, achievement kept, scores relabelled, session kept after reload;
- the account-creation fix (no self-admin, no free XP);
- the log-in warning (cancel keeps the guest);
- the returning-member gate;
- Admin clean-up ("never finished a game" filter; Check changes nothing; Delete removes guest data; members untouched);
- a cleaned-up guest coming back.

`pounce-e2e-test.mjs`, `pounce-e2e-modes-test.mjs` and `site-smoke-test.mjs` were updated to the one-tap flow.
