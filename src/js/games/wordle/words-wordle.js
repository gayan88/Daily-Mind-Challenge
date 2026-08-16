import { daysSinceEpoch } from '../../utils/helpers.js';

// Curated 5-letter answer list. The daily word is picked deterministically from this list by
// date, so the same word shows for every player each day. Add new words to the END of the list
// only — inserting/removing/reordering earlier entries will shift which word lands on which
// past/future date for players already mid-streak.
//
// v1 simplification: guesses are only checked for "5 alphabetic letters", not validated against
// a full dictionary (that would require bundling a much larger word list). See README.
export const WORDLE_ANSWERS = [
    'ABOUT', 'ABOVE', 'ABUSE', 'ACTOR', 'ACUTE', 'ADMIT', 'ADOPT', 'ADULT', 'AFTER', 'AGAIN',
    'AGENT', 'AGREE', 'AHEAD', 'ALARM', 'ALBUM', 'ALERT', 'ALIKE', 'ALIVE', 'ALLOW', 'ALONE',
    'ALONG', 'ALTER', 'AMONG', 'ANGER', 'ANGLE', 'ANGRY', 'APPLE', 'APPLY', 'ARENA', 'ARGUE',
    'ARISE', 'ARRAY', 'ASIDE', 'ASSET', 'AVOID', 'AWAKE', 'AWARD', 'AWARE', 'BADLY', 'BASIC',
    'BEACH', 'BEGIN', 'BEING', 'BELOW', 'BENCH', 'BIRTH', 'BLACK', 'BLAME', 'BLANK', 'BLAST',
    'BLIND', 'BLOCK', 'BLOOD', 'BOARD', 'BOOST', 'BOOTH', 'BOUND', 'BRAIN', 'BRAND', 'BREAD',
    'BREAK', 'BREED', 'BRIEF', 'BRING', 'BROAD', 'BROKE', 'BROWN', 'BUILD', 'BUILT', 'BUYER',
    'CABLE', 'CANDY', 'CARRY', 'CATCH', 'CAUSE', 'CHAIN', 'CHAIR', 'CHAOS', 'CHARM', 'CHART',
    'CHASE', 'CHEAP', 'CHECK', 'CHEST', 'CHIEF', 'CHILD', 'CHOSE', 'CIVIL', 'CLAIM', 'CLASS',
    'CLEAN', 'CLEAR', 'CLICK', 'CLIMB', 'CLOCK', 'CLOSE', 'CLOUD', 'COACH', 'COAST', 'COULD',
    'COUNT', 'COURT', 'COVER', 'CRAFT', 'CRASH', 'CRAZY', 'CREAM', 'CRIME', 'CROSS', 'CROWD',
    'CROWN', 'CURVE', 'CYCLE', 'DAILY', 'DANCE', 'DEALT', 'DEATH', 'DEBUT', 'DELAY', 'DEPTH',
    'DOING', 'DOUBT', 'DOZEN', 'DRAFT', 'DRAMA', 'DRANK', 'DREAM', 'DRESS', 'DRINK', 'DRIVE',
    'DROVE', 'DYING', 'EAGER', 'EARLY', 'EARTH', 'EIGHT', 'ELITE', 'EMPTY', 'ENEMY', 'ENJOY',
    'ENTER', 'ENTRY', 'EQUAL', 'ERROR', 'EVENT', 'EVERY', 'EXACT', 'EXIST', 'EXTRA', 'FAITH',
    'FALSE', 'FAULT', 'FIBER', 'FIELD', 'FIFTH', 'FIFTY', 'FIGHT', 'FINAL', 'FIRST', 'FIXED',
    'FLASH', 'FLEET', 'FLOOR', 'FLUID', 'FOCUS', 'FORCE', 'FORTH', 'FORUM', 'FOUND', 'FRAME',
    'FRANK', 'FRESH', 'FRONT', 'FRUIT', 'FULLY', 'FUNNY', 'GHOST', 'GIANT', 'GLASS', 'GLOBE',
    'GRACE', 'GRADE', 'GRAND', 'GRANT', 'GRASS', 'GREAT', 'GREEN', 'GROUP', 'GROWN', 'GUARD',
    'GUESS', 'GUEST', 'GUIDE', 'HAPPY', 'HARSH', 'HEART', 'HEAVY', 'HORSE', 'HOTEL', 'HOUSE',
];

export function getDailyWordleWord(dateString) {
    const index = daysSinceEpoch(dateString) % WORDLE_ANSWERS.length;
    return WORDLE_ANSWERS[index];
}
