import {
    doc,
    collection,
    query,
    where,
    documentId,
    getDocs,
    setDoc,
    runTransaction,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { getTodayDateString, addDaysToDateString, getISOWeekInfo, getISOWeekMonday } from '../utils/helpers.js';
import { GAMES } from './game-registry.js';
import { getGameScoresForDateRange } from '../leaderboard/leaderboard-data.js';

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** The most recently CLOSED ISO week relative to `today` -- last week, never the still-in-progress
 * current one. `periodKey` matches Section 20 of the progression spec's exact format
 * ("2026-W36"). */
export function getPreviousWeekPeriod(today = getTodayDateString()) {
    const thisWeekMonday = getISOWeekMonday(today);
    const startDate = addDaysToDateString(thisWeekMonday, -7);
    const endDate = addDaysToDateString(startDate, 6);
    const { isoYear, week } = getISOWeekInfo(startDate);
    return { periodKey: `${isoYear}-W${pad2(week)}`, startDate, endDate };
}

/** The most recently CLOSED calendar month relative to `today`. */
export function getPreviousMonthPeriod(today = getTodayDateString()) {
    const [year, month] = today.split('-').map(Number);
    const py = month === 1 ? year - 1 : year;
    const pm = month === 1 ? 12 : month - 1;
    const startDate = `${py}-${pad2(pm)}-01`;
    const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate(); // day 0 of next month = last day of pm
    const endDate = `${py}-${pad2(pm)}-${pad2(lastDay)}`;
    return { periodKey: `${py}-${pad2(pm)}`, startDate, endDate };
}

function periodResultDocId(gameId, periodType, periodKey) {
    return `${gameId}_${periodType}_${periodKey}`;
}

async function finalizePeriod(gameId, periodType, { periodKey, startDate, endDate }) {
    const scores = await getGameScoresForDateRange(gameId, startDate, endDate);
    // Registered-only eligibility: a guest can top a period's raw scores, but can't hold an
    // accumulating championship achievement (Achievements are registered-only, Section 4 of the
    // spec) -- so the next-highest *registered* player is the one actually crowned.
    const winner = scores.find((row) => !row.isGuest) || null;

    await setDoc(doc(db, 'periodResults', periodResultDocId(gameId, periodType, periodKey)), {
        gameId,
        periodType,
        periodKey,
        startDate,
        endDate,
        winnerUid: winner ? winner.uid : null,
        winnerDisplayName: winner ? winner.displayName : null,
        winnerPoints: winner ? winner.points : 0,
        claimed: winner === null,
        finalizedAt: serverTimestamp(),
    });
}

/**
 * Lazy finalization (Section 22 of the progression spec): for every game in the registry, checks
 * whether the most recently closed week and month already have a periodResults doc, and computes
 * + creates one for any that don't. Called from leaderboard-page.js on every visit -- the trigger
 * point decided for Phase 6 (any signed-in visitor to the leaderboard can cause this to run, not
 * just registered players viewing their own profile, since who wins a period is global platform
 * data, not any one player's own).
 *
 * Deliberately only ever looks at the single most-recently-closed period per game/periodType, not
 * a backlog of older un-finalized ones -- explicit product decision (see
 * docs/progression-gamification-roadmap.md's Phase 6 section): if nobody visits the leaderboard
 * for a long stretch, older periods are permanently skipped rather than backfilled. This keeps
 * the check cheap and bounded (one batched read of up to `GAMES` × 2 potential doc ids, via a
 * `documentId() in [...]` query -- Firestore caps `in` queries at 10 values, comfortably above
 * today's 3 games × 2 period types = 6, but worth revisiting once a game #6 makes this 12).
 *
 * Registered, non-banned players only may actually finalize (firestore.rules'
 * isRegisteredNonBanned()) -- guests can still read the results, just not trigger creating them.
 * This doesn't verify the *computed* winner is actually correct against reality -- there's no
 * backend to re-run the aggregation server-side -- same "v1-pragmatic, not fully cheat-proof"
 * model as the rest of this app's points/achievements.
 */
export async function finalizeRecentPeriodsIfNeeded() {
    const periods = [
        { periodType: 'week', period: getPreviousWeekPeriod() },
        { periodType: 'month', period: getPreviousMonthPeriod() },
    ];

    const candidates = Object.keys(GAMES).flatMap((gameId) =>
        periods.map(({ periodType, period }) => ({ gameId, periodType, period }))
    );
    if (candidates.length === 0) return;

    const ids = candidates.map((c) => periodResultDocId(c.gameId, c.periodType, c.period.periodKey));
    const existingSnap = await getDocs(query(collection(db, 'periodResults'), where(documentId(), 'in', ids)));
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    const missing = candidates.filter(
        (c) => !existingIds.has(periodResultDocId(c.gameId, c.periodType, c.period.periodKey))
    );
    await Promise.all(missing.map((c) => finalizePeriod(c.gameId, c.periodType, c.period)));
}

/**
 * Checks for any periodResults the caller has won but not yet converted into a playerAchievements
 * record, and claims them -- one Firestore transaction per unclaimed win, incrementing (or
 * creating) the matching `{gameId}-{periodType}ly-champion` achievement's count. Called from
 * profile.js on every registered-player visit, right alongside Phase 5's `syncPlayerAchievements()`
 * (this claiming intentionally happens first, so a freshly-claimed win is reflected in the same
 * page render).
 *
 * Deliberately separate from finalizeRecentPeriodsIfNeeded() above: the visitor who triggers a
 * period's finalization is usually a *different* person from whoever actually won it, and
 * Firestore's security rules only ever allow a client to write to its own uid's data -- so the
 * winner has to be the one to claim their own achievement, nobody can do it on their behalf.
 */
export async function claimChampionshipAchievements(uid) {
    const q = query(
        collection(db, 'periodResults'),
        where('winnerUid', '==', uid),
        where('claimed', '==', false)
    );
    const snap = await getDocs(q);

    await Promise.all(snap.docs.map(async (periodDoc) => {
        const { gameId, periodType } = periodDoc.data();
        const achievementId = `${gameId}-${periodType}ly-champion`;
        const achievementRef = doc(db, 'playerAchievements', `${uid}_${achievementId}`);

        try {
            await runTransaction(db, async (tx) => {
                const periodSnap = await tx.get(periodDoc.ref);
                if (periodSnap.data().claimed) return; // already claimed by a concurrent call
                const achievementSnap = await tx.get(achievementRef);

                tx.update(periodDoc.ref, { claimed: true });
                if (achievementSnap.exists()) {
                    tx.update(achievementRef, { count: achievementSnap.data().count + 1 });
                } else {
                    tx.set(achievementRef, {
                        uid,
                        achievementId,
                        category: 'championship',
                        count: 1,
                        earnedAt: serverTimestamp(),
                    });
                }
            });
        } catch {
            // Lost a race (e.g. two tabs open) -- already claimed, harmless no-op.
        }
    }));
}
