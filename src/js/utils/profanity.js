import { getConfig } from './config.js';

/** Case-insensitive substring check against config/profanityList.blockedWords. */
export async function containsBlockedWord(text) {
    const { blockedWords } = await getConfig('profanityList');
    const lower = text.toLowerCase();
    return (blockedWords || []).some((word) => lower.includes(word.toLowerCase()));
}
