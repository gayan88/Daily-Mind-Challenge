import { getConfig } from '../../utils/config.js';

/**
 * Checks a word against config/wordValidationAPI.endpoint (the Free Dictionary API by default).
 * Fails OPEN -- if the API is unreachable, times out (5s), or returns anything other than a
 * clean 200/404, the word is treated as valid rather than blocking play/challenge creation on a
 * flaky third-party dependency. Only an explicit 404 ("no entry for this word") counts as invalid.
 *
 * Used both at Challenge a Friend creation time (`wordle-challenge-data.js`) and live during play
 * across all three Wordle modes (`wordle-engine.js`'s optional `validateGuess` callback, wired up
 * in `wordle-page.js`) -- kept in its own file, not tied to the challenges collection, since it's
 * no longer just a challenge-creation concern.
 */
export async function isRealWord(word) {
    const { endpoint } = await getConfig('wordValidationAPI');
    try {
        const res = await fetch(`${endpoint}${word.toLowerCase()}`, { signal: AbortSignal.timeout(5000) });
        if (res.status === 404) return false;
        return true;
    } catch (err) {
        console.warn('Word validation API unreachable, allowing the word through:', err);
        return true;
    }
}
