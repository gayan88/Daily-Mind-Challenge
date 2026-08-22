import { DIRECTIONS_2WAY, DIRECTIONS_8WAY } from './wordsearch-engine.js';

// Single source of truth for grid size / word count / allowed placement directions per mode --
// shared by wordsearch-page.js (mounting the engine) and wordsearch-admin.js (validating word
// lists an admin enters), so the numbers can't drift between the two.
export const DAILY_MODE = { gridSize: 12, wordCount: 10, directions: DIRECTIONS_8WAY };
export const TOURNAMENT_MODE = { gridSize: 12, wordCount: 10, directions: DIRECTIONS_8WAY };
export const CLASSIC_MODES = {
    easy: { gridSize: 10, wordCount: 6, directions: DIRECTIONS_2WAY },
    medium: { gridSize: 12, wordCount: 10, directions: DIRECTIONS_8WAY },
    hard: { gridSize: 15, wordCount: 10, directions: DIRECTIONS_8WAY },
};

export const WORD_MIN_LENGTH = 4;
export const WORD_MAX_LENGTH = 9;
