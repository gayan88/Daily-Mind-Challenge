import { daysSinceEpoch } from '../../utils/helpers.js';

// Curated per-day theme word lists. The grid itself is generated at runtime (seeded by date, see
// js/games/wordsearch.js) so only the words need to be supplied here -- no hand-authored grids.
// Keep words within a theme free of substrings of each other (e.g. don't pair "CAT" with "CATFISH")
// so the selection-matching logic in the game engine can't ambiguously satisfy two words at once.
export const WORDSEARCH_THEMES = [
    { theme: 'Animals', words: ['TIGER', 'ZEBRA', 'RABBIT', 'PANDA', 'EAGLE', 'DOLPHIN', 'GIRAFFE'] },
    { theme: 'Fruits', words: ['APPLE', 'MANGO', 'BANANA', 'ORANGE', 'PAPAYA', 'CHERRY', 'LEMON'] },
    { theme: 'Space', words: ['PLANET', 'COMET', 'GALAXY', 'ROCKET', 'METEOR', 'ORBIT', 'NEBULA'] },
    { theme: 'Ocean', words: ['CORAL', 'SHARK', 'WHALE', 'OCTOPUS', 'TURTLE', 'OYSTER', 'ANCHOR'] },
    { theme: 'Weather', words: ['STORM', 'CLOUD', 'THUNDER', 'RAINBOW', 'BREEZE', 'DROUGHT', 'FROST'] },
    { theme: 'Sports', words: ['SOCCER', 'TENNIS', 'HOCKEY', 'BOXING', 'CRICKET', 'ARCHERY', 'GOLF'] },
    { theme: 'Kitchen', words: ['SPOON', 'KETTLE', 'SKILLET', 'BLENDER', 'LADLE', 'WHISK', 'OVEN'] },
    { theme: 'Music', words: ['GUITAR', 'PIANO', 'DRUMS', 'VIOLIN', 'TRUMPET', 'FLUTE', 'CHORUS'] },
    { theme: 'Colors', words: ['CRIMSON', 'INDIGO', 'AMBER', 'TEAL', 'MAROON', 'IVORY', 'VIOLET'] },
    { theme: 'Insects', words: ['BEETLE', 'MANTIS', 'LOCUST', 'HORNET', 'SPIDER', 'CICADA', 'TERMITE'] },
    { theme: 'Vehicles', words: ['TRACTOR', 'SCOOTER', 'TRAILER', 'BICYCLE', 'SUBWAY', 'CANOE', 'GLIDER'] },
    { theme: 'Countries', words: ['FRANCE', 'BRAZIL', 'KENYA', 'JAPAN', 'CANADA', 'EGYPT', 'NORWAY'] },
    { theme: 'School', words: ['PENCIL', 'MARKER', 'NOTEBOOK', 'CRAYON', 'BACKPACK', 'RULER', 'ERASER'] },
    { theme: 'Gems', words: ['EMERALD', 'SAPPHIRE', 'TOPAZ', 'GARNET', 'OPAL', 'QUARTZ', 'PEARL'] },
    { theme: 'Birds', words: ['SPARROW', 'FALCON', 'PARROT', 'TOUCAN', 'OSTRICH', 'PELICAN', 'ROBIN'] },
    { theme: 'Desserts', words: ['COOKIE', 'PUDDING', 'WAFFLE', 'BROWNIE', 'ECLAIR', 'SORBET', 'CUSTARD'] },
    { theme: 'Trees', words: ['MAPLE', 'WILLOW', 'CEDAR', 'BIRCH', 'SPRUCE', 'WALNUT', 'SEQUOIA'] },
    { theme: 'Tools', words: ['HAMMER', 'WRENCH', 'CHISEL', 'PLIERS', 'DRILL', 'SANDER', 'MALLET'] },
    { theme: 'Camping', words: ['TENT', 'LANTERN', 'COMPASS', 'HAMMOCK', 'CAMPFIRE', 'BACKPACK', 'KAYAK'] },
    { theme: 'Emotions', words: ['HAPPY', 'CALM', 'EAGER', 'PROUD', 'GENTLE', 'CURIOUS', 'JOYFUL'] },
];

export function getDailyWordSearch(dateString) {
    const index = daysSinceEpoch(dateString) % WORDSEARCH_THEMES.length;
    return WORDSEARCH_THEMES[index];
}
