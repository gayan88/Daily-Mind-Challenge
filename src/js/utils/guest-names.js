/**
 * Guest names: "Adjective Animal NNN", e.g. "Clever Fox 482". Every guest gets one automatically
 * (no name form). Uniqueness is guaranteed by a `guestNames/{nameKey}` reservation doc that only
 * one account can ever create (see auth/user-profile.js#createGuestProfile and firestore.rules).
 *
 * Both lists are hand-picked to be positive and family-friendly, and short enough that the
 * longest possible name (7 + 7 letters + a 4-digit fallback number) still fits a phone
 * leaderboard row and the 24-character display-name limit.
 */
const ADJECTIVES = [
    'Clever', 'Swift', 'Lucky', 'Sunny', 'Bright', 'Brave', 'Witty', 'Jolly', 'Nimble', 'Merry',
    'Happy', 'Gentle', 'Bold', 'Calm', 'Cheery', 'Cosmic', 'Daring', 'Eager', 'Fancy', 'Fuzzy',
    'Golden', 'Grand', 'Jazzy', 'Keen', 'Kind', 'Lively', 'Mighty', 'Noble', 'Peppy', 'Plucky',
    'Proud', 'Quick', 'Quiet', 'Rapid', 'Rosy', 'Silver', 'Smart', 'Snappy', 'Sparky', 'Spry',
    'Steady', 'Super', 'Sweet', 'Tidy', 'Upbeat', 'Vivid', 'Wise', 'Zesty', 'Breezy', 'Dapper',
];

const ANIMALS = [
    'Fox', 'Owl', 'Panda', 'Otter', 'Koala', 'Tiger', 'Falcon', 'Dolphin', 'Kitten', 'Penguin',
    'Badger', 'Beaver', 'Bunny', 'Robin', 'Cub', 'Deer', 'Duck', 'Eagle', 'Ferret', 'Finch',
    'Gecko', 'Hare', 'Hedgie', 'Heron', 'Ibis', 'Jay', 'Kiwi', 'Lamb', 'Lemur', 'Lion',
    'Llama', 'Lynx', 'Moose', 'Newt', 'Puffin', 'Pony', 'Quail', 'Raven', 'Seal', 'Sloth',
    'Swan', 'Toucan', 'Turtle', 'Walrus', 'Whale', 'Wombat', 'Wren', 'Yak', 'Zebra', 'Bear',
];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

/** A random guest name. `longNumber` adds a 4th digit (the fallback after repeated clashes). */
export function randomGuestName(longNumber = false) {
    const number = longNumber
        ? 1000 + Math.floor(Math.random() * 9000)
        : 100 + Math.floor(Math.random() * 900);
    return `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${number}`;
}

/** The reservation doc id for a name: lowercase, spaces -> hyphens ("clever-fox-482"). Must match
 * the same derivation in firestore.rules' `guests` create rule. */
export function guestNameKey(name) {
    return name.toLowerCase().replace(/ /g, '-');
}

/** True for anything in the guest pattern ("Word Word 123"/"Word Word 1234") -- members can't use
 * such a display name, so a member can never be mistaken for a guest (or a guest for a member). */
export function looksLikeGuestName(name) {
    return /^[A-Za-z]+ [A-Za-z]+ \d{3,4}$/.test((name || '').trim());
}

/** Suggested member username for a converting guest: "Clever Fox 482" -> "CleverFox482". */
export function usernameSuggestionFor(guestName) {
    return (guestName || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24);
}
