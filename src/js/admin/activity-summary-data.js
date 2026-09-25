import {
    collection,
    query,
    where,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';

/**
 * One row per mode that represents an actual finished play, mapped to the exact `gameType` whose
 * doc count means "one completion". Tournament modes are the subtlety here: they write multiple
 * gameScores docs per run (one per puzzle/word, via `*-tournament`, plus a one-shot completion
 * doc via `wordle-tournament`/`*-tournament-bonus`) -- counting every tournament-prefixed
 * gameType would wildly overcount runs by however many puzzles/words each tournament has. Only
 * the one-shot completion gameType is counted here. `wordle-challenge-creator` (the creator's
 * per-solver reward) is deliberately excluded -- it's a reward, not a play, and would double-count
 * activity already represented by `wordle-challenge`.
 */
const ACTIVITY_ROWS = [
    { game: 'Wordle', label: 'Daily Challenge Completed', gameType: 'wordle' },
    { game: 'Wordle', label: 'Tournament Completed', gameType: 'wordle-tournament' },
    { game: 'Wordle', label: 'Challenge a Friend Completed', gameType: 'wordle-challenge' },
    { game: 'Sudoku', label: 'Daily Challenge Completed', gameType: 'sudoku' },
    { game: 'Sudoku', label: 'Classic Sudoku Completed', gameType: 'sudoku-classic' },
    { game: 'Sudoku', label: 'Tournament Completed', gameType: 'sudoku-tournament-bonus' },
    { game: 'Word Search', label: 'Daily Challenge Completed', gameType: 'wordsearch' },
    { game: 'Word Search', label: 'Classic Word Search Completed', gameType: 'wordsearch-classic' },
    { game: 'Word Search', label: 'Tournament Completed', gameType: 'wordsearch-tournament-bonus' },
    { game: 'Connections', label: 'Daily Challenge Completed', gameType: 'connections' },
    { game: 'Connections', label: 'Classic Connections Completed', gameType: 'connections-classic' },
    { game: 'Connections', label: 'Tournament Completed', gameType: 'connections-tournament' },
];

/**
 * Aggregates one day's activity for the admin panel's Daily Activity Summary: a single-field
 * equality query on `scoreDate` (cheap and safe at any scale, since it's always bounded to one
 * day's worth of docs, unlike an all-time sum) fetches every gameScores doc for that date, then
 * everything else is a client-side tally over that one result set -- unique logged-in users
 * (guest vs. registered, deduped by `userId`, since one player can show up in several rows) and
 * a per-mode breakdown grouped by game, with per-game subtotals. `totalPlays` is the sum of the
 * breakdown rows, not a raw doc count, so it stays consistent with the table (excludes
 * per-puzzle Tournament docs and creator-reward docs, same as the rows themselves).
 */
export async function getDailyActivitySummary(dateString) {
    const q = query(collection(db, 'gameScores'), where('scoreDate', '==', dateString));
    const snap = await getDocs(q);
    const docs = snap.docs.map((d) => d.data());

    const guestByUid = new Map();
    docs.forEach((d) => {
        if (!guestByUid.has(d.userId)) guestByUid.set(d.userId, !!d.isGuest);
    });
    const guestUsers = Array.from(guestByUid.values()).filter(Boolean).length;
    const loggedUsers = guestByUid.size;
    const registeredUsers = loggedUsers - guestUsers;

    const rows = ACTIVITY_ROWS.map(({ game, label, gameType }) => {
        const matching = docs.filter((d) => d.gameType === gameType);
        const guest = matching.filter((d) => d.isGuest).length;
        return { game, label, guest, registered: matching.length - guest, total: matching.length };
    });

    const games = [];
    rows.forEach((row) => {
        let gameGroup = games.find((g) => g.game === row.game);
        if (!gameGroup) {
            gameGroup = { game: row.game, guest: 0, registered: 0, total: 0, rows: [] };
            games.push(gameGroup);
        }
        gameGroup.guest += row.guest;
        gameGroup.registered += row.registered;
        gameGroup.total += row.total;
        gameGroup.rows.push(row);
    });

    const totalPlays = games.reduce((sum, g) => sum + g.total, 0);

    return { loggedUsers, guestUsers, registeredUsers, totalPlays, games };
}
