/**
 * Shared admin-table grouping/labeling helpers -- extracted out of admin-page.js so every game's
 * admin section (Wordle/Sudoku/Word Search there, Connections in its own connections-admin-page.js)
 * reuses the exact same grouping instead of each keeping a slightly-drifting copy. Pure functions,
 * no game-specific knowledge: everything here just operates on a plain `{ date, ... }` or
 * `{ difficulty, ... }` shaped item list. A future game's own admin module should import from here
 * too rather than re-implementing this.
 */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Groups an already date-sorted item list by "YYYY-MM" -- a Map preserves insertion order, so
 * the resulting groups come out in chronological order for free. */
export function groupWordsByMonth(items) {
    const groups = new Map();
    items.forEach((item) => {
        const key = item.date.slice(0, 7);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    });
    return groups;
}

/** Further groups a chronologically-ordered month-groups Map (see groupWordsByMonth()) by "YYYY"
 * -- a Map preserves insertion order here too, so years (and the months within each year) both
 * come out in chronological order for free, same reasoning as groupWordsByMonth() itself. Exists
 * because a pool seeded years ahead turns into dozens of flat month rows otherwise -- nesting
 * under a year first means expanding any point in a multi-year pool is at most two clicks away,
 * rather than depending on how far down a flat (or paginated) list that month happens to be. */
export function groupMonthsByYear(monthGroups) {
    const years = new Map();
    monthGroups.forEach((items, monthKey) => {
        const year = monthKey.slice(0, 4);
        if (!years.has(year)) years.set(year, new Map());
        years.get(year).set(monthKey, items);
    });
    return years;
}

export const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];
export const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Groups a Classic-puzzle list by difficulty, always in Easy/Medium/Hard order regardless of
 * insertion order (ids typically interleave difficulties, since all three share one numeric
 * counter) -- a difficulty with nothing seeded yet is omitted rather than shown as an empty group. */
export function groupByDifficulty(items) {
    const groups = new Map();
    DIFFICULTY_ORDER.forEach((d) => {
        const matching = items.filter((item) => item.difficulty === d);
        if (matching.length > 0) groups.set(d, matching);
    });
    return groups;
}

/** Wires the click-to-toggle behavior for `[data-collapsible]` subsections rendered fresh into
 * `container` (year/month or difficulty groups) -- scoped to `container` and re-run on every
 * render, rather than the page-wide `wireCollapsibleSections()` in admin-page.js, since these
 * subsections are regenerated wholesale each time and wiring them globally would double-bind. */
export function wireCollapsibleToggles(container) {
    container.querySelectorAll('[data-collapsible] > .admin-subsection-header').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('[data-collapsible]').classList.toggle('open');
        });
    });
}
