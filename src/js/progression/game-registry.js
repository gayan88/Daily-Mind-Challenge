/**
 * Central game registry: stable gameId -> display label + every gameScores `gameType` string
 * that counts toward that game's lifetime Points. One logical game writes several distinct
 * gameTypes depending on mode (Daily Challenge, Classic, Tournament, Wordle's Challenge-a-Friend
 * pair) -- see docs/adding-a-new-game.md and src/js/leaderboard/CLAUDE.md's GAME_TYPES note.
 *
 * This is the single source of truth other modules should import from, rather than keeping
 * their own copy of "which gameTypes belong to which game" (leaderboard-data.js used to keep an
 * independent copy of exactly this mapping).
 *
 * `modes` groups a game's scoreTypes into the semantic "modes played" buckets shown on the
 * profile page (progression-service.js#getGameProgressByGame counts *documents*, not points,
 * per bucket) -- deliberately a separate list from `scoreTypes`, not a partition of it.
 * `wordle-challenge-creator` (points a Challenge creator earns when someone else solves their
 * challenge) is in `scoreTypes` because it's real Points this player earned, but left out of
 * `modes.challenges` because it doesn't represent a challenge *this player played*.
 *
 * `logo` is the same tile image already used on the home page's game tiles.
 *
 * Adding a new game: add one entry here with its gameId, label, logo, scoreTypes, and modes.
 * Nothing in progression-service.js needs to change.
 */
export const GAMES = {
    wordle: {
        label: 'Wordle',
        logo: '/assets/images/tile-wordle.png',
        scoreTypes: ['wordle', 'wordle-tournament', 'wordle-challenge', 'wordle-challenge-creator'],
        modes: {
            daily: ['wordle'],
            tournament: ['wordle-tournament'],
            challenges: ['wordle-challenge'],
        },
    },
    sudoku: {
        label: 'Sudoku',
        logo: '/assets/images/tile-sudoku.png',
        scoreTypes: ['sudoku', 'sudoku-classic', 'sudoku-tournament', 'sudoku-tournament-bonus'],
        modes: {
            daily: ['sudoku'],
            classic: ['sudoku-classic'],
            tournament: ['sudoku-tournament', 'sudoku-tournament-bonus'],
        },
    },
    wordsearch: {
        label: 'Word Search',
        logo: '/assets/images/tile-wordsearch.png',
        scoreTypes: ['wordsearch', 'wordsearch-classic', 'wordsearch-tournament', 'wordsearch-tournament-bonus'],
        modes: {
            daily: ['wordsearch'],
            classic: ['wordsearch-classic'],
            tournament: ['wordsearch-tournament', 'wordsearch-tournament-bonus'],
        },
    },
    connections: {
        label: 'Connections',
        logo: '/assets/images/tile-connections.png',
        scoreTypes: ['connections', 'connections-classic', 'connections-tournament'],
        modes: {
            daily: ['connections'],
            classic: ['connections-classic'],
            tournament: ['connections-tournament'],
        },
    },
};
