import { initShell } from '../app.js';
import { ensureConfigDefaults, updateConfig } from '../utils/config.js';
import { AD_SLOTS, DEFAULT_ADS_CONFIG } from '../utils/ads.js';
import { lookupUserByUsername, setUserBanned, setUserAdmin } from './moderation.js';
import {
    listDailyWords, addDailyWord, updateDailyWord, bulkAddDailyWords,
    listTournaments, createTournament, setTournamentActive, deleteTournament,
} from './wordle-admin.js';
import {
    listDailySudokuPuzzles, addDailySudokuPuzzle, updateDailySudokuPuzzle, bulkAddDailySudokuPuzzles,
    listClassicSudokuPuzzles, addClassicSudokuPuzzle, updateClassicSudokuPuzzle, bulkAddClassicSudokuPuzzles,
    listSudokuTournaments, createSudokuTournament, setSudokuTournamentActive, deleteSudokuTournament,
} from './sudoku-admin.js';
import {
    listDailyWordsearchPuzzles, addDailyWordsearchPuzzle, updateDailyWordsearchPuzzle, bulkAddDailyWordsearchPuzzles,
    listClassicWordsearchPuzzles, addClassicWordsearchPuzzle, updateClassicWordsearchPuzzle, bulkAddClassicWordsearchPuzzles,
    listWordsearchTournaments, createWordsearchTournament, setWordsearchTournamentActive, deleteWordsearchTournament,
} from './wordsearch-admin.js';
import { getDailyActivitySummary } from './activity-summary-data.js';
import { escapeHtml, showToast, getTodayDateString } from '../utils/helpers.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Drops a leading "no,date,..." header line, if present -- lets a CSV downloaded from one of the
 * "Download CSV" buttons below be re-uploaded through "Import" unchanged, rather than the header
 * row itself getting misread as a malformed data row. */
function stripCsvHeaderRow(lines) {
    return lines[0]?.trim().toLowerCase().startsWith('no,date,') ? lines.slice(1) : lines;
}

/** Groups an already date-sorted word list by "YYYY-MM" -- a Map preserves insertion order, so
 * the resulting groups come out in chronological order for free. */
function groupWordsByMonth(words) {
    const groups = new Map();
    words.forEach((w) => {
        const key = w.date.slice(0, 7);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(w);
    });
    return groups;
}

/** Further groups a chronologically-ordered month-groups Map (see groupWordsByMonth()) by "YYYY"
 * -- a Map preserves insertion order here too, so years (and the months within each year) both
 * come out in chronological order for free, same reasoning as groupWordsByMonth() itself. Exists
 * because a pool seeded years ahead turns into dozens of flat month rows otherwise -- nesting
 * under a year first means expanding any point in a multi-year pool is at most two clicks away,
 * rather than depending on how far down a flat (or paginated) list that month happens to be. */
const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Groups a Classic-puzzle list (Sudoku or Word Search) by difficulty, always in Easy/Medium/Hard
 * order regardless of insertion order (ids interleave difficulties, since all three share one
 * numeric counter) -- a difficulty with nothing seeded yet is omitted rather than shown as an
 * empty group. */
function groupByDifficulty(items) {
    const groups = new Map();
    DIFFICULTY_ORDER.forEach((d) => {
        const matching = items.filter((item) => item.difficulty === d);
        if (matching.length > 0) groups.set(d, matching);
    });
    return groups;
}

function groupMonthsByYear(monthGroups) {
    const years = new Map();
    monthGroups.forEach((items, monthKey) => {
        const year = monthKey.slice(0, 4);
        if (!years.has(year)) years.set(year, new Map());
        years.get(year).set(monthKey, items);
    });
    return years;
}

const CONFIG_FORMS = [
    {
        id: 'dailyLoginReward',
        title: 'Daily Login Reward',
        fields: [{ key: 'points', type: 'number', label: 'Points' }],
    },
    {
        id: 'challengeExpiration',
        title: 'Challenge Expiration',
        fields: [{ key: 'days', type: 'number', label: 'Days' }],
    },
    {
        id: 'myChallengesPageSize',
        title: 'My Challenges Page Size',
        fields: [{ key: 'size', type: 'number', label: 'Challenges per page (Load More)' }],
    },
    {
        id: 'browseChallengesPageSize',
        title: 'Browse Challenges Page Size',
        fields: [{ key: 'size', type: 'number', label: 'Challenges per page (Load More)' }],
    },
    {
        id: 'leaderboardPageSize',
        title: 'Leaderboard Page Size',
        fields: [{ key: 'size', type: 'number', label: 'Rows per page (Load More)' }],
    },
    {
        id: 'challengeAttemptsPageSize',
        title: 'Challenge Attempts Page Size',
        fields: [{ key: 'size', type: 'number', label: 'Attempts per page (Load More)' }],
    },
    {
        id: 'sudokuTournamentSettings',
        title: 'Sudoku Tournament Settings',
        fields: [
            { key: 'puzzleCount', type: 'number', label: 'Puzzles per tournament' },
            { key: 'timeLimitSeconds', type: 'number', label: 'Seconds allowed per puzzle' },
            { key: 'maxErrors', type: 'number', label: 'Errors allowed per puzzle' },
        ],
    },
    {
        id: 'wordsearchTournamentSettings',
        title: 'Word Search Tournament Settings',
        fields: [
            { key: 'puzzleCount', type: 'number', label: 'Puzzles per tournament' },
            { key: 'timeLimitSeconds', type: 'number', label: 'Seconds allowed per puzzle' },
            { key: 'completedPoints', type: 'number', label: 'Points for completing a puzzle' },
            { key: 'failedPoints', type: 'number', label: 'Points for failing a puzzle' },
        ],
    },
    {
        id: 'cookieConsent',
        title: 'Cookie Consent Banner',
        fields: [{ key: 'enabled', type: 'checkbox', label: 'Show the cookie consent banner to visitors' }],
    },
    {
        id: 'wordValidationAPI',
        title: 'Word Validation API',
        fields: [{ key: 'endpoint', type: 'text', label: 'Endpoint URL' }],
    },
    {
        id: 'profanityList',
        title: 'Profanity List',
        fields: [{ key: 'blockedWords', type: 'textarea', label: 'Blocked words (comma-separated)', isArray: true }],
    },
];

// Outlined line icons (not this app's usual emoji set, see icons.js) -- used only on the Daily
// Activity Summary's stat cards.
const ICON_PEOPLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const ICON_PERSON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const ICON_PERSON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>`;
const ICON_GAMEPAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><rect x="2" y="6" width="20" height="12" rx="6"/></svg>`;

function activityStatCard(iconSvg, label, value) {
    return `
        <div class="status-stat-card">
            <div class="status-stat-icon-wrap">${iconSvg}</div>
            <div class="status-stat-label">${label}</div>
            <div class="status-stat-value">${value}</div>
        </div>
    `;
}

async function renderActivitySummary(dateString) {
    const container = document.getElementById('activity-summary-content');
    container.innerHTML = `<div class="loading-text">Loading&hellip;</div>`;

    let summary;
    try {
        summary = await getDailyActivitySummary(dateString);
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load activity for this date &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    const statsHtml = `
        <div class="status-stats-grid activity-summary-stats">
            ${activityStatCard(ICON_PEOPLE, 'Logged Users', summary.loggedUsers)}
            ${activityStatCard(ICON_PERSON, 'Guest', summary.guestUsers)}
            ${activityStatCard(ICON_PERSON_CHECK, 'Registered', summary.registeredUsers)}
            ${activityStatCard(ICON_GAMEPAD, 'Total Plays', summary.totalPlays)}
        </div>
    `;

    const tableHtml = `
        <div class="activity-summary-table">
            <div class="activity-summary-row activity-summary-header">
                <span>Game / Activity</span>
                <span>Guest</span>
                <span>Registered</span>
                <span>Total</span>
            </div>
            ${summary.games.map((g, i) => `
                <div class="activity-summary-row activity-summary-game-row">
                    <span class="activity-summary-game-name"><span class="activity-summary-badge">${i + 1}</span>${escapeHtml(g.game)}</span>
                    <span>${g.guest}</span>
                    <span>${g.registered}</span>
                    <span>${g.total}</span>
                </div>
                ${g.rows.map((r) => `
                    <div class="activity-summary-row activity-summary-sub-row">
                        <span class="activity-summary-sub-label">${escapeHtml(r.label)}</span>
                        <span>${r.guest}</span>
                        <span>${r.registered}</span>
                        <span>${r.total}</span>
                    </div>
                `).join('')}
            `).join('')}
        </div>
    `;

    container.innerHTML = statsHtml + tableHtml;
}

function wireActivitySummary() {
    const input = document.getElementById('activity-summary-date-input');
    input.value = getTodayDateString();
    input.addEventListener('change', () => {
        if (input.value) renderActivitySummary(input.value);
    });
    renderActivitySummary(input.value);
}

function wireCollapsibleSections() {
    document.querySelectorAll('[data-collapsible] > .admin-section-header, [data-collapsible] > .admin-subsection-header').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('[data-collapsible]').classList.toggle('open');
        });
    });
}

function blockNonAdminAccess() {
    document.getElementById('admin-content').innerHTML = `
        <div class="section">
            <div class="empty-state">You don't have access to this page. <a href="/">Back to home</a></div>
        </div>
    `;
}

// Renders a subset of CONFIG_FORMS (by id) into a given container -- called once for the General
// section's remaining forms, and once more for each game section's own tournament-settings form
// (moved there so admins find "Sudoku Tournament Settings" alongside Sudoku's other admin
// controls, rather than buried in a General/Platform Config list of unrelated forms).
async function renderConfigForms(containerId, formIds) {
    const container = document.getElementById(containerId);
    const forms = CONFIG_FORMS.filter((form) => formIds.includes(form.id));
    const docs = await Promise.all(forms.map((form) => ensureConfigDefaults(form.id)));

    container.innerHTML = forms.map((form, i) => {
        const data = docs[i];
        // Each field gets its own label -- with a single field per form (the common case so
        // far) the form title alone made this readable without one, but that breaks down once a
        // form has several fields side by side (e.g. Sudoku Tournament Settings' four numbers).
        const fieldsHtml = form.fields.map((field) => {
            const value = data[field.key];
            const inputHtml = field.type === 'textarea'
                ? `<textarea id="cfg-${form.id}-${field.key}">${escapeHtml(field.isArray ? (value || []).join(', ') : (value || ''))}</textarea>`
                : field.type === 'checkbox'
                    ? `<input type="checkbox" id="cfg-${form.id}-${field.key}" ${value ? 'checked' : ''}>`
                    : `<input type="${field.type}" id="cfg-${form.id}-${field.key}" value="${value === null || value === undefined ? '' : escapeHtml(String(value))}">`;
            return `
                <div class="config-form-field">
                    <label for="cfg-${form.id}-${field.key}">${escapeHtml(field.label)}</label>
                    ${inputHtml}
                </div>
            `;
        }).join('');

        return `
            <div class="config-form">
                <div class="config-form-title">${form.title}</div>
                <div class="config-form-desc">${escapeHtml(data.description || '')}</div>
                <div class="config-form-row">
                    ${fieldsHtml}
                    <button class="btn primary" data-save-config="${form.id}" type="button">Save</button>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('[data-save-config]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const formId = btn.dataset.saveConfig;
            const form = CONFIG_FORMS.find((f) => f.id === formId);
            const fields = {};
            form.fields.forEach((field) => {
                const el = document.getElementById(`cfg-${formId}-${field.key}`);
                if (field.isArray) {
                    fields[field.key] = el.value.split(',').map((w) => w.trim()).filter(Boolean);
                } else if (field.type === 'checkbox') {
                    fields[field.key] = el.checked;
                } else if (field.type === 'number') {
                    fields[field.key] = el.value === '' ? (field.nullable ? null : 0) : Number(el.value);
                } else {
                    fields[field.key] = el.value;
                }
            });
            await updateConfig(formId, fields);
            showToast(`${form.title} saved`);
        });
    });
}

// Renders each AD_SLOTS group into its own admin-panel container (General/Advertisements/Game
// wise sections), but all groups share one `slots` object -- saving a slot in any group re-reads
// the whole map and writes it back, so editing e.g. a Wordle ad never clobbers the Home ads.
async function renderAdSlotForms() {
    const adsConfig = await ensureConfigDefaults('ads', DEFAULT_ADS_CONFIG);
    let slots = { ...adsConfig.slots };

    function fieldId(slotId, field) {
        return `ad-${slotId}-${field}`;
    }

    function renderGroup(containerId, groupName) {
        const container = document.getElementById(containerId);
        const groupSlots = AD_SLOTS.filter((s) => s.group === groupName);

        container.innerHTML = groupSlots.map(({ id, label }) => {
            const slot = slots[id] || DEFAULT_ADS_CONFIG.slots[id];
            const imageFieldsHidden = slot.type !== 'image' ? 'hidden' : '';
            return `
                <div class="config-form">
                    <div class="config-form-title">${escapeHtml(label)}</div>
                    <div class="ad-slot-row">
                        <label class="ad-slot-enabled">
                            <input type="checkbox" id="${fieldId(id, 'enabled')}" ${slot.enabled ? 'checked' : ''}>
                            Enabled
                        </label>
                        <select id="${fieldId(id, 'type')}" data-ad-type-select="${id}">
                            <option value="google" ${slot.type === 'google' ? 'selected' : ''}>Google AdSense placeholder</option>
                            <option value="image" ${slot.type === 'image' ? 'selected' : ''}>Manual image ad</option>
                        </select>
                    </div>
                    <div class="ad-slot-image-fields" id="${fieldId(id, 'image-fields')}" ${imageFieldsHidden}>
                        <div class="form-field">
                            <label for="${fieldId(id, 'imageUrl')}">Image URL</label>
                            <input type="text" id="${fieldId(id, 'imageUrl')}" value="${escapeHtml(slot.imageUrl || '')}" placeholder="https://example.com/ad.png">
                        </div>
                        <div class="form-field">
                            <label for="${fieldId(id, 'linkUrl')}">Click-through URL</label>
                            <input type="text" id="${fieldId(id, 'linkUrl')}" value="${escapeHtml(slot.linkUrl || '')}" placeholder="https://example.com">
                        </div>
                    </div>
                    <button class="btn primary" data-save-ad-slot="${id}" type="button">Save</button>
                </div>
            `;
        }).join('');

        container.querySelectorAll('[data-ad-type-select]').forEach((select) => {
            select.addEventListener('change', () => {
                const slotId = select.dataset.adTypeSelect;
                document.getElementById(fieldId(slotId, 'image-fields')).hidden = select.value !== 'image';
            });
        });

        container.querySelectorAll('[data-save-ad-slot]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const slotId = btn.dataset.saveAdSlot;
                slots = {
                    ...slots,
                    [slotId]: {
                        enabled: document.getElementById(fieldId(slotId, 'enabled')).checked,
                        type: document.getElementById(fieldId(slotId, 'type')).value,
                        imageUrl: document.getElementById(fieldId(slotId, 'imageUrl')).value.trim(),
                        linkUrl: document.getElementById(fieldId(slotId, 'linkUrl')).value.trim(),
                    },
                };
                await updateConfig('ads', { slots });
                showToast(`${AD_SLOTS.find((s) => s.id === slotId).label} saved`);
            });
        });
    }

    renderGroup('ad-slot-forms-home', 'home');
    renderGroup('ad-slot-forms-wordle', 'wordle');
    renderGroup('ad-slot-forms-sudoku', 'sudoku');
    renderGroup('ad-slot-forms-wordsearch', 'wordsearch');
}

async function renderDailyWordsTable() {
    const container = document.getElementById('daily-words-table');
    const startDateField = document.getElementById('daily-word-start-date-field');
    let words;
    try {
        words = await listDailyWords();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load daily words &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    // The start-date input only matters for the very first word (it sets Challenge #1's date) --
    // hide it once a pool already exists, since every word after that is dated automatically.
    startDateField.hidden = words.length > 0;

    if (words.length === 0) {
        container.innerHTML = `<div class="empty-state">No words seeded yet. Pick a start date above and add one to activate the Daily Challenge.</div>`;
        return;
    }

    // Grouped by year, then month -- see groupMonthsByYear()'s doc comment. Both levels start
    // fully collapsed (not defaulting the current year/month open) since even a single month's
    // worth of entries can already be a long list on its own.
    const monthGroups = groupWordsByMonth(words);
    const yearGroups = groupMonthsByYear(monthGroups);

    container.innerHTML = Array.from(yearGroups.entries()).map(([year, yearMonths]) => {
        const yearCount = Array.from(yearMonths.values()).reduce((sum, arr) => sum + arr.length, 0);
        return `
        <div class="admin-subsection" data-collapsible>
            <button class="admin-subsection-header" type="button">${year} (${yearCount})</button>
            <div class="card">
                ${Array.from(yearMonths.entries()).map(([monthKey, monthWords]) => `
                    <div class="admin-subsection admin-subsection-nested" data-collapsible>
                        <button class="admin-subsection-header" type="button">${monthLabel(monthKey)} (${monthWords.length})</button>
                        <div class="card">
                            ${monthWords.map((w) => `
                                <div class="daily-word-row">
                                    <span class="daily-word-id">#${w.challengeNumber ?? '?'} &middot; ${w.date}</span>
                                    <span class="daily-word-text">${escapeHtml(w.word)}</span>
                                    <button class="btn" data-edit-word="${w.date}" type="button">Edit</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    }).join('');

    // Scoped to this container (not the whole document) so it never double-binds the page's
    // other, statically-present collapsible sections that wireCollapsibleSections() already wired.
    container.querySelectorAll('[data-collapsible] > .admin-subsection-header').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('[data-collapsible]').classList.toggle('open');
        });
    });

    container.querySelectorAll('[data-edit-word]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const date = btn.dataset.editWord;
            const current = words.find((w) => w.date === date);
            const nextWord = window.prompt('Word text:', current.word);
            if (nextWord === null || !nextWord.trim()) return;
            const validCurrentDate = DATE_RE.test(date) ? date : '';
            const nextDate = window.prompt('Date (YYYY-MM-DD):', validCurrentDate);
            if (nextDate === null) return;
            if (!DATE_RE.test(nextDate.trim())) {
                showToast('Enter the date as YYYY-MM-DD');
                return;
            }
            try {
                await updateDailyWord(date, { word: nextWord, date: nextDate.trim() });
                showToast('Word updated');
                renderDailyWordsTable();
            } catch (err) {
                showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
}

function wireDailyWordsAdd() {
    document.getElementById('daily-word-add-btn').addEventListener('click', async () => {
        const input = document.getElementById('daily-word-input');
        const startDateField = document.getElementById('daily-word-start-date-field');
        const startDateInput = document.getElementById('daily-word-start-date-input');
        const word = input.value.trim();
        if (!/^[A-Za-z]{5}$/.test(word)) {
            showToast('Enter a 5-letter word');
            return;
        }
        if (!startDateField.hidden && !startDateInput.value) {
            showToast('Pick a start date for Challenge #1');
            return;
        }
        try {
            const result = await addDailyWord(word, startDateInput.value || undefined);
            input.value = '';
            startDateInput.value = '';
            showToast(`Word #${result.challengeNumber} added (${result.date})`);
            renderDailyWordsTable();
        } catch (err) {
            showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
        }
    });
}

/** Parses an uploaded word-list file: one word per line, ignoring blank lines and -- in case a
 * real CSV with extra columns gets uploaded -- everything after the first comma on each line. */
function parseWordListFile(text) {
    return stripCsvHeaderRow(text.split(/\r?\n/))
        .map((line) => line.split(',')[0].trim())
        .filter(Boolean);
}

function wireDailyWordsImportExport() {
    document.getElementById('daily-word-import-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('daily-word-import-input');
        const startDateField = document.getElementById('daily-word-start-date-field');
        const startDateInput = document.getElementById('daily-word-start-date-input');
        const file = fileInput.files[0];
        if (!file) {
            showToast('Choose a word-list file first');
            return;
        }
        if (!startDateField.hidden && !startDateInput.value) {
            showToast('Pick a start date for Challenge #1');
            return;
        }

        const words = parseWordListFile(await file.text());
        if (words.length === 0) {
            showToast('No words found in that file');
            return;
        }
        if (!window.confirm(`Import ${words.length} word${words.length === 1 ? '' : 's'}?`)) return;

        try {
            const result = await bulkAddDailyWords(words, startDateInput.value || undefined);
            fileInput.value = '';
            startDateInput.value = '';
            showToast(`Imported ${result.count} word${result.count === 1 ? '' : 's'} (${result.firstDate} → ${result.lastDate})`);
            renderDailyWordsTable();
        } catch (err) {
            showToast(err.message || "Couldn't import -- check Firestore rules are deployed");
        }
    });

    document.getElementById('daily-word-export-btn').addEventListener('click', async () => {
        let words;
        try {
            words = await listDailyWords();
        } catch {
            showToast("Couldn't load daily words to export");
            return;
        }
        if (words.length === 0) {
            showToast('No words seeded yet');
            return;
        }

        const csvRows = ['no,date,word', ...words.map((w) => `${w.challengeNumber ?? ''},${w.date},${w.word}`)];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'wordle-daily-words.csv';
        link.click();
        URL.revokeObjectURL(url);
    });
}

function parseWordsInput(raw) {
    return raw.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
}

async function renderTournamentsTable() {
    const container = document.getElementById('tournaments-table');
    let tournaments;
    try {
        tournaments = await listTournaments();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load tournaments &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    if (tournaments.length === 0) {
        container.innerHTML = `<div class="empty-state">No tournaments yet. Create one below.</div>`;
        return;
    }

    container.innerHTML = tournaments.map((t) => `
        <div class="tournament-row">
            <span class="tournament-row-name">${escapeHtml(t.name)}</span>
            <span class="tournament-row-meta">${t.words.length} words &bull; ${t.timePerWordSeconds}s/word &bull; +${t.bonusPoints} bonus</span>
            <span class="status-pill ${t.active ? 'on' : ''}">${t.active ? 'Active' : 'Inactive'}</span>
            <div class="tournament-row-actions">
                <button class="btn" data-toggle-tournament="${t.id}" data-active="${t.active}" type="button">${t.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn danger" data-delete-tournament="${t.id}" type="button">Delete</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-toggle-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.toggleTournament;
            const isActive = btn.dataset.active === 'true';
            try {
                await setTournamentActive(id, !isActive);
                renderTournamentsTable();
            } catch {
                showToast("Couldn't save -- check Firestore rules are deployed");
            }
        });
    });

    container.querySelectorAll('[data-delete-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm('Delete this tournament? Players\' progress on it will be orphaned.')) return;
            try {
                await deleteTournament(btn.dataset.deleteTournament);
                showToast('Tournament deleted');
                renderTournamentsTable();
            } catch {
                showToast("Couldn't delete -- check Firestore rules are deployed");
            }
        });
    });
}

function wireTournamentCreate() {
    document.getElementById('tournament-create-btn').addEventListener('click', async () => {
        const name = document.getElementById('tournament-name-input').value.trim();
        const words = parseWordsInput(document.getElementById('tournament-words-input').value);
        const timePerWordSeconds = Number(document.getElementById('tournament-time-input').value);
        const bonusPoints = Number(document.getElementById('tournament-bonus-input').value);

        if (!name) {
            showToast('Enter a tournament name');
            return;
        }
        if (words.length === 0 || !words.every((w) => /^[A-Za-z]{5}$/.test(w))) {
            showToast('Enter at least one 5-letter word, comma or newline-separated');
            return;
        }
        if (!timePerWordSeconds || timePerWordSeconds < 10) {
            showToast('Seconds per word must be at least 10');
            return;
        }

        try {
            await createTournament({ name, words, timePerWordSeconds, bonusPoints });
            document.getElementById('tournament-name-input').value = '';
            document.getElementById('tournament-words-input').value = '';
            showToast('Tournament created');
            renderTournamentsTable();
        } catch {
            showToast("Couldn't save -- check Firestore rules are deployed");
        }
    });
}

async function renderSudokuDailyTable() {
    const container = document.getElementById('sudoku-daily-table');
    const startDateField = document.getElementById('sudoku-daily-start-date-field');
    let puzzles;
    try {
        puzzles = await listDailySudokuPuzzles();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load daily puzzles &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    // The start-date input only matters for the very first puzzle (it sets Challenge #1's date)
    // -- hide it once a pool already exists, since every puzzle after that is dated automatically.
    startDateField.hidden = puzzles.length > 0;

    if (puzzles.length === 0) {
        container.innerHTML = `<div class="empty-state">No puzzles seeded yet. Pick a start date above and add one to activate the Daily Challenge.</div>`;
        return;
    }

    // Grouped by year, then month, both collapsed by default -- see renderDailyWordsTable()/
    // groupMonthsByYear()'s doc comment.
    const monthGroups = groupWordsByMonth(puzzles);
    const yearGroups = groupMonthsByYear(monthGroups);

    container.innerHTML = Array.from(yearGroups.entries()).map(([year, yearMonths]) => {
        const yearCount = Array.from(yearMonths.values()).reduce((sum, arr) => sum + arr.length, 0);
        return `
        <div class="admin-subsection" data-collapsible>
            <button class="admin-subsection-header" type="button">${year} (${yearCount})</button>
            <div class="card">
                ${Array.from(yearMonths.entries()).map(([monthKey, monthPuzzles]) => `
                    <div class="admin-subsection admin-subsection-nested" data-collapsible>
                        <button class="admin-subsection-header" type="button">${monthLabel(monthKey)} (${monthPuzzles.length})</button>
                        <div class="card">
                            ${monthPuzzles.map((p) => {
                                const prefilled = p.puzzle.split('').filter((c) => c !== '0').length;
                                return `
                                    <div class="sudoku-daily-row">
                                        <span class="sudoku-daily-id">#${p.challengeNumber ?? '?'} &middot; ${p.date}</span>
                                        <span class="sudoku-daily-meta">${prefilled} Pre-Filled Cells</span>
                                        <button class="btn" data-edit-puzzle="${p.date}" type="button">Edit</button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    }).join('');

    container.querySelectorAll('[data-collapsible] > .admin-subsection-header').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('[data-collapsible]').classList.toggle('open');
        });
    });

    container.querySelectorAll('[data-edit-puzzle]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const date = btn.dataset.editPuzzle;
            const current = puzzles.find((p) => p.date === date);
            const nextPuzzle = window.prompt('Puzzle (81 digits, 0 = blank):', current.puzzle);
            if (nextPuzzle === null) return;
            const nextSolution = window.prompt('Solution (81 digits, 1-9):', current.solution);
            if (nextSolution === null) return;
            const validCurrentDate = DATE_RE.test(date) ? date : '';
            const nextDate = window.prompt('Date (YYYY-MM-DD):', validCurrentDate);
            if (nextDate === null) return;
            if (!DATE_RE.test(nextDate.trim())) {
                showToast('Enter the date as YYYY-MM-DD');
                return;
            }
            try {
                await updateDailySudokuPuzzle(date, {
                    puzzle: nextPuzzle.trim(),
                    solution: nextSolution.trim(),
                    date: nextDate.trim(),
                });
                showToast('Puzzle updated');
                renderSudokuDailyTable();
            } catch (err) {
                showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
}

function wireSudokuDailyAdd() {
    document.getElementById('sudoku-daily-add-btn').addEventListener('click', async () => {
        const puzzleInput = document.getElementById('sudoku-daily-puzzle-input');
        const solutionInput = document.getElementById('sudoku-daily-solution-input');
        const startDateField = document.getElementById('sudoku-daily-start-date-field');
        const startDateInput = document.getElementById('sudoku-daily-start-date-input');
        const puzzle = puzzleInput.value.trim();
        const solution = solutionInput.value.trim();
        if (!startDateField.hidden && !startDateInput.value) {
            showToast('Pick a start date for Challenge #1');
            return;
        }
        try {
            const result = await addDailySudokuPuzzle(puzzle, solution, startDateInput.value || undefined);
            puzzleInput.value = '';
            solutionInput.value = '';
            startDateInput.value = '';
            showToast(`Puzzle #${result.challengeNumber} added (${result.date})`);
            renderSudokuDailyTable();
        } catch (err) {
            showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
        }
    });
}

/** Parses an uploaded puzzle-list file: one "puzzle,solution" pair per line, ignoring blank
 * lines -- mirrors parseWordListFile() but keeps both comma-separated fields instead of just
 * the first, since a puzzle needs both its own string and its solution string. */
function parseSudokuPuzzleListFile(text) {
    return stripCsvHeaderRow(text.split(/\r?\n/))
        .map((line) => line.split(',').map((field) => field.trim()))
        .filter(([puzzle]) => puzzle)
        .map(([puzzle, solution]) => ({ puzzle, solution: solution || '' }));
}

function wireSudokuDailyImportExport() {
    document.getElementById('sudoku-daily-import-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('sudoku-daily-import-input');
        const startDateField = document.getElementById('sudoku-daily-start-date-field');
        const startDateInput = document.getElementById('sudoku-daily-start-date-input');
        const file = fileInput.files[0];
        if (!file) {
            showToast('Choose a puzzle-list file first');
            return;
        }
        if (!startDateField.hidden && !startDateInput.value) {
            showToast('Pick a start date for Challenge #1');
            return;
        }

        const pairs = parseSudokuPuzzleListFile(await file.text());
        if (pairs.length === 0) {
            showToast('No puzzles found in that file');
            return;
        }
        if (!window.confirm(`Import ${pairs.length} puzzle${pairs.length === 1 ? '' : 's'}?`)) return;

        try {
            const result = await bulkAddDailySudokuPuzzles(pairs, startDateInput.value || undefined);
            fileInput.value = '';
            startDateInput.value = '';
            showToast(`Imported ${result.count} puzzle${result.count === 1 ? '' : 's'} (${result.firstDate} → ${result.lastDate})`);
            renderSudokuDailyTable();
        } catch (err) {
            showToast(err.message || "Couldn't import -- check Firestore rules are deployed");
        }
    });

    document.getElementById('sudoku-daily-export-btn').addEventListener('click', async () => {
        let puzzles;
        try {
            puzzles = await listDailySudokuPuzzles();
        } catch {
            showToast("Couldn't load daily puzzles to export");
            return;
        }
        if (puzzles.length === 0) {
            showToast('No puzzles seeded yet');
            return;
        }

        const csvRows = ['no,date,puzzle,solution', ...puzzles.map((p) => `${p.challengeNumber ?? ''},${p.date},${p.puzzle},${p.solution}`)];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'sudoku-daily-puzzles.csv';
        link.click();
        URL.revokeObjectURL(url);
    });
}

async function renderSudokuClassicTable() {
    const container = document.getElementById('sudoku-classic-table');
    let puzzles;
    try {
        puzzles = await listClassicSudokuPuzzles();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load classic puzzles &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    if (puzzles.length === 0) {
        container.innerHTML = `<div class="empty-state">No puzzles seeded yet. Add one above for each difficulty you want to offer.</div>`;
        return;
    }

    // Grouped by difficulty (Easy/Medium/Hard) rather than one flat id-ordered list -- see
    // groupByDifficulty()'s doc comment. Each group defaults open since there are only ever three.
    const groups = groupByDifficulty(puzzles);
    container.innerHTML = Array.from(groups.entries()).map(([difficulty, group]) => `
        <div class="admin-subsection open" data-collapsible>
            <button class="admin-subsection-header" type="button">${DIFFICULTY_LABELS[difficulty]} (${group.length})</button>
            <div class="card">
                ${group.map((p) => {
                    const prefilled = p.puzzle.split('').filter((c) => c !== '0').length;
                    return `
                        <div class="sudoku-daily-row">
                            <span class="sudoku-daily-id">#${p.id}</span>
                            <span class="sudoku-daily-meta">${prefilled} Pre-Filled Cells</span>
                            <button class="btn" data-edit-classic-puzzle="${p.id}" type="button">Edit</button>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-collapsible] > .admin-subsection-header').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('[data-collapsible]').classList.toggle('open');
        });
    });

    container.querySelectorAll('[data-edit-classic-puzzle]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.editClassicPuzzle;
            const current = puzzles.find((p) => String(p.id) === id);
            const nextPuzzle = window.prompt('Puzzle (81 digits, 0 = blank):', current.puzzle);
            if (nextPuzzle === null) return;
            const nextSolution = window.prompt('Solution (81 digits, 1-9):', current.solution);
            if (nextSolution === null) return;
            const nextDifficulty = window.prompt('Difficulty (easy, medium, or hard):', current.difficulty);
            if (nextDifficulty === null) return;
            try {
                await updateClassicSudokuPuzzle(id, nextPuzzle.trim(), nextSolution.trim(), nextDifficulty.trim());
                showToast(`Puzzle #${id} updated`);
                renderSudokuClassicTable();
            } catch (err) {
                showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
}

function wireSudokuClassicAdd() {
    document.getElementById('sudoku-classic-add-btn').addEventListener('click', async () => {
        const puzzleInput = document.getElementById('sudoku-classic-puzzle-input');
        const solutionInput = document.getElementById('sudoku-classic-solution-input');
        const difficultySelect = document.getElementById('sudoku-classic-difficulty-select');
        const puzzle = puzzleInput.value.trim();
        const solution = solutionInput.value.trim();
        const difficulty = difficultySelect.value;
        try {
            const id = await addClassicSudokuPuzzle(puzzle, solution, difficulty);
            puzzleInput.value = '';
            solutionInput.value = '';
            showToast(`Puzzle #${id} added`);
            renderSudokuClassicTable();
        } catch (err) {
            showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
        }
    });
}

/** Parses an uploaded Classic-puzzle-list file: one "difficulty,puzzle,solution" trio per line,
 * ignoring blank lines -- mirrors parseSudokuPuzzleListFile() with difficulty as the leading
 * field, since Classic (unlike Daily) needs one. */
function parseSudokuClassicListFile(text) {
    return stripCsvHeaderRow(text.split(/\r?\n/))
        .map((line) => line.split(',').map((field) => field.trim()))
        .filter(([difficulty]) => difficulty)
        .map(([difficulty, puzzle, solution]) => ({ difficulty, puzzle: puzzle || '', solution: solution || '' }));
}

function wireSudokuClassicImportExport() {
    document.getElementById('sudoku-classic-import-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('sudoku-classic-import-input');
        const file = fileInput.files[0];
        if (!file) {
            showToast('Choose a puzzle-list file first');
            return;
        }

        const entries = parseSudokuClassicListFile(await file.text());
        if (entries.length === 0) {
            showToast('No puzzles found in that file');
            return;
        }
        if (!window.confirm(`Import ${entries.length} puzzle${entries.length === 1 ? '' : 's'}?`)) return;

        try {
            const result = await bulkAddClassicSudokuPuzzles(entries);
            fileInput.value = '';
            showToast(`Imported ${result.count} puzzle${result.count === 1 ? '' : 's'}`);
            renderSudokuClassicTable();
        } catch (err) {
            showToast(err.message || "Couldn't import -- check Firestore rules are deployed");
        }
    });

    document.getElementById('sudoku-classic-export-btn').addEventListener('click', async () => {
        let puzzles;
        try {
            puzzles = await listClassicSudokuPuzzles();
        } catch {
            showToast("Couldn't load classic puzzles to export");
            return;
        }
        if (puzzles.length === 0) {
            showToast('No puzzles seeded yet');
            return;
        }

        const csvRows = ['id,difficulty,puzzle,solution', ...puzzles.map((p) => `${p.id},${p.difficulty},${p.puzzle},${p.solution}`)];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'sudoku-classic-puzzles.csv';
        link.click();
        URL.revokeObjectURL(url);
    });
}

function parsePuzzleLines(raw) {
    return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function renderSudokuTournamentsTable() {
    const container = document.getElementById('sudoku-tournaments-table');
    let tournaments;
    try {
        tournaments = await listSudokuTournaments();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load tournaments &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    if (tournaments.length === 0) {
        container.innerHTML = `<div class="empty-state">No tournaments yet. Create one below.</div>`;
        return;
    }

    container.innerHTML = tournaments.map((t) => `
        <div class="tournament-row">
            <span class="tournament-row-name">${escapeHtml(t.name)}</span>
            <span class="tournament-row-meta">${t.puzzles.length} puzzles &bull; +${t.completionBonus} bonus</span>
            <span class="status-pill ${t.active ? 'on' : ''}">${t.active ? 'Active' : 'Inactive'}</span>
            <div class="tournament-row-actions">
                <button class="btn" data-toggle-sudoku-tournament="${t.id}" data-active="${t.active}" type="button">${t.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn danger" data-delete-sudoku-tournament="${t.id}" type="button">Delete</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-toggle-sudoku-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.toggleSudokuTournament;
            const isActive = btn.dataset.active === 'true';
            try {
                await setSudokuTournamentActive(id, !isActive);
                renderSudokuTournamentsTable();
            } catch {
                showToast("Couldn't save -- check Firestore rules are deployed");
            }
        });
    });

    container.querySelectorAll('[data-delete-sudoku-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm('Delete this tournament? Players\' progress on it will be orphaned.')) return;
            try {
                await deleteSudokuTournament(btn.dataset.deleteSudokuTournament);
                showToast('Tournament deleted');
                renderSudokuTournamentsTable();
            } catch {
                showToast("Couldn't delete -- check Firestore rules are deployed");
            }
        });
    });
}

function wireSudokuTournamentCreate() {
    document.getElementById('sudoku-tournament-create-btn').addEventListener('click', async () => {
        const name = document.getElementById('sudoku-tournament-name-input').value.trim();
        const puzzleLines = parsePuzzleLines(document.getElementById('sudoku-tournament-puzzles-input').value);
        const solutionLines = parsePuzzleLines(document.getElementById('sudoku-tournament-solutions-input').value);
        const completionBonus = Number(document.getElementById('sudoku-tournament-bonus-input').value);

        if (!name) {
            showToast('Enter a tournament name');
            return;
        }
        if (puzzleLines.length === 0) {
            showToast('Enter at least one puzzle');
            return;
        }
        if (puzzleLines.length !== solutionLines.length) {
            showToast(`Puzzle count (${puzzleLines.length}) doesn't match solution count (${solutionLines.length})`);
            return;
        }

        const puzzles = puzzleLines.map((puzzle, i) => ({ puzzle, solution: solutionLines[i] }));

        try {
            await createSudokuTournament({ name, puzzles, completionBonus });
            document.getElementById('sudoku-tournament-name-input').value = '';
            document.getElementById('sudoku-tournament-puzzles-input').value = '';
            document.getElementById('sudoku-tournament-solutions-input').value = '';
            document.getElementById('sudoku-tournament-bonus-input').value = '250';
            showToast('Tournament created');
            renderSudokuTournamentsTable();
        } catch (err) {
            showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
        }
    });
}

async function renderWordsearchDailyTable() {
    const container = document.getElementById('wordsearch-daily-table');
    const startDateField = document.getElementById('wordsearch-daily-start-date-field');
    let puzzles;
    try {
        puzzles = await listDailyWordsearchPuzzles();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load daily puzzles &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    // The start-date input only matters for the very first puzzle (it sets Challenge #1's date)
    // -- hide it once a pool already exists, since every puzzle after that is dated automatically.
    startDateField.hidden = puzzles.length > 0;

    if (puzzles.length === 0) {
        container.innerHTML = `<div class="empty-state">No puzzles seeded yet. Pick a start date above and add one to activate the Daily Challenge.</div>`;
        return;
    }

    // Grouped by year, then month, both collapsed by default -- see renderDailyWordsTable()/
    // groupMonthsByYear()'s doc comment.
    const monthGroups = groupWordsByMonth(puzzles);
    const yearGroups = groupMonthsByYear(monthGroups);

    container.innerHTML = Array.from(yearGroups.entries()).map(([year, yearMonths]) => {
        const yearCount = Array.from(yearMonths.values()).reduce((sum, arr) => sum + arr.length, 0);
        return `
        <div class="admin-subsection" data-collapsible>
            <button class="admin-subsection-header" type="button">${year} (${yearCount})</button>
            <div class="card">
                ${Array.from(yearMonths.entries()).map(([monthKey, monthPuzzles]) => `
                    <div class="admin-subsection admin-subsection-nested" data-collapsible>
                        <button class="admin-subsection-header" type="button">${monthLabel(monthKey)} (${monthPuzzles.length})</button>
                        <div class="card">
                            ${monthPuzzles.map((p) => `
                                <div class="sudoku-daily-row">
                                    <span class="sudoku-daily-id">#${p.challengeNumber ?? '?'} &middot; ${p.date}</span>
                                    <span class="sudoku-daily-meta">${p.theme ? `${escapeHtml(p.theme)} &bull; ` : ''}${p.words.length} words</span>
                                    <button class="btn" data-edit-ws-daily="${p.date}" type="button">Edit</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    }).join('');

    container.querySelectorAll('[data-collapsible] > .admin-subsection-header').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('[data-collapsible]').classList.toggle('open');
        });
    });

    container.querySelectorAll('[data-edit-ws-daily]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const date = btn.dataset.editWsDaily;
            const current = puzzles.find((p) => p.date === date);
            const nextTheme = window.prompt('Theme (optional):', current.theme || '');
            if (nextTheme === null) return;
            const nextWords = window.prompt('Words (comma or newline-separated):', current.words.join(', '));
            if (nextWords === null) return;
            const validCurrentDate = DATE_RE.test(date) ? date : '';
            const nextDate = window.prompt('Date (YYYY-MM-DD):', validCurrentDate);
            if (nextDate === null) return;
            if (!DATE_RE.test(nextDate.trim())) {
                showToast('Enter the date as YYYY-MM-DD');
                return;
            }
            try {
                await updateDailyWordsearchPuzzle(date, {
                    theme: nextTheme,
                    words: parseWordsInput(nextWords),
                    date: nextDate.trim(),
                });
                showToast('Puzzle updated');
                renderWordsearchDailyTable();
            } catch (err) {
                showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
}

function wireWordsearchDailyAdd() {
    document.getElementById('wordsearch-daily-add-btn').addEventListener('click', async () => {
        const themeInput = document.getElementById('wordsearch-daily-theme-input');
        const wordsInput = document.getElementById('wordsearch-daily-words-input');
        const startDateField = document.getElementById('wordsearch-daily-start-date-field');
        const startDateInput = document.getElementById('wordsearch-daily-start-date-input');
        if (!startDateField.hidden && !startDateInput.value) {
            showToast('Pick a start date for Challenge #1');
            return;
        }
        try {
            const result = await addDailyWordsearchPuzzle(
                { theme: themeInput.value, words: parseWordsInput(wordsInput.value) },
                startDateInput.value || undefined
            );
            themeInput.value = '';
            wordsInput.value = '';
            startDateInput.value = '';
            showToast(`Puzzle #${result.challengeNumber} added (${result.date})`);
            renderWordsearchDailyTable();
        } catch (err) {
            showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
        }
    });
}

/** Parses an uploaded puzzle-list file: one puzzle per line, comma-separated fields. Each row is
 * either DAILY_MODE.wordCount (10) fields (just words, no theme) or one more than that (a leading
 * theme field followed by the words) -- matches the export format, so a downloaded CSV can be
 * re-imported unchanged. */
function parseWordsearchDailyListFile(text) {
    const WORD_COUNT = 10;
    return stripCsvHeaderRow(text.split(/\r?\n/))
        .map((line) => line.split(',').map((field) => field.trim()).filter((field, i, arr) => !(i === arr.length - 1 && field === '')))
        .filter((fields) => fields.length > 0 && fields.some(Boolean))
        .map((fields) => {
            if (fields.length === WORD_COUNT) return { theme: '', words: fields };
            if (fields.length === WORD_COUNT + 1) return { theme: fields[0], words: fields.slice(1) };
            throw new Error(`Each row must have ${WORD_COUNT} words (optionally preceded by a theme) -- one row has ${fields.length} fields`);
        });
}

function wireWordsearchDailyImportExport() {
    document.getElementById('wordsearch-daily-import-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('wordsearch-daily-import-input');
        const startDateField = document.getElementById('wordsearch-daily-start-date-field');
        const startDateInput = document.getElementById('wordsearch-daily-start-date-input');
        const file = fileInput.files[0];
        if (!file) {
            showToast('Choose a puzzle-list file first');
            return;
        }
        if (!startDateField.hidden && !startDateInput.value) {
            showToast('Pick a start date for Challenge #1');
            return;
        }

        let entries;
        try {
            entries = parseWordsearchDailyListFile(await file.text());
        } catch (err) {
            showToast(err.message);
            return;
        }
        if (entries.length === 0) {
            showToast('No puzzles found in that file');
            return;
        }
        if (!window.confirm(`Import ${entries.length} puzzle${entries.length === 1 ? '' : 's'}?`)) return;

        try {
            const result = await bulkAddDailyWordsearchPuzzles(entries, startDateInput.value || undefined);
            fileInput.value = '';
            startDateInput.value = '';
            showToast(`Imported ${result.count} puzzle${result.count === 1 ? '' : 's'} (${result.firstDate} → ${result.lastDate})`);
            renderWordsearchDailyTable();
        } catch (err) {
            showToast(err.message || "Couldn't import -- check Firestore rules are deployed");
        }
    });

    document.getElementById('wordsearch-daily-export-btn').addEventListener('click', async () => {
        let puzzles;
        try {
            puzzles = await listDailyWordsearchPuzzles();
        } catch {
            showToast("Couldn't load daily puzzles to export");
            return;
        }
        if (puzzles.length === 0) {
            showToast('No puzzles seeded yet');
            return;
        }

        const csvRows = ['no,date,theme,words...', ...puzzles.map((p) => [p.challengeNumber ?? '', p.date, p.theme || '', ...p.words].join(','))];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'wordsearch-daily-puzzles.csv';
        link.click();
        URL.revokeObjectURL(url);
    });
}

async function renderWordsearchClassicTable() {
    const container = document.getElementById('wordsearch-classic-table');
    let puzzles;
    try {
        puzzles = await listClassicWordsearchPuzzles();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load classic puzzles &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    if (puzzles.length === 0) {
        container.innerHTML = `<div class="empty-state">No puzzles seeded yet. Add one above for each difficulty you want to offer.</div>`;
        return;
    }

    // Grouped by difficulty (Easy/Medium/Hard) rather than one flat id-ordered list -- see
    // groupByDifficulty()'s doc comment. Each group defaults open since there are only ever three.
    const groups = groupByDifficulty(puzzles);
    container.innerHTML = Array.from(groups.entries()).map(([difficulty, group]) => `
        <div class="admin-subsection open" data-collapsible>
            <button class="admin-subsection-header" type="button">${DIFFICULTY_LABELS[difficulty]} (${group.length})</button>
            <div class="card">
                ${group.map((p) => `
                    <div class="sudoku-daily-row">
                        <span class="sudoku-daily-id">#${p.id}</span>
                        <span class="sudoku-daily-meta">${p.theme ? `${escapeHtml(p.theme)} &bull; ` : ''}${p.words.length} words</span>
                        <button class="btn" data-edit-ws-classic="${p.id}" type="button">Edit</button>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-collapsible] > .admin-subsection-header').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('[data-collapsible]').classList.toggle('open');
        });
    });

    container.querySelectorAll('[data-edit-ws-classic]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.editWsClassic;
            const current = puzzles.find((p) => String(p.id) === id);
            const nextTheme = window.prompt('Theme (optional):', current.theme || '');
            if (nextTheme === null) return;
            const nextWords = window.prompt('Words (comma or newline-separated):', current.words.join(', '));
            if (nextWords === null) return;
            const nextDifficulty = window.prompt('Difficulty (easy, medium, or hard):', current.difficulty);
            if (nextDifficulty === null) return;
            try {
                await updateClassicWordsearchPuzzle(id, { theme: nextTheme, words: parseWordsInput(nextWords), difficulty: nextDifficulty.trim() });
                showToast(`Puzzle #${id} updated`);
                renderWordsearchClassicTable();
            } catch (err) {
                showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
}

function wireWordsearchClassicAdd() {
    document.getElementById('wordsearch-classic-add-btn').addEventListener('click', async () => {
        const themeInput = document.getElementById('wordsearch-classic-theme-input');
        const wordsInput = document.getElementById('wordsearch-classic-words-input');
        const difficultySelect = document.getElementById('wordsearch-classic-difficulty-select');
        try {
            const id = await addClassicWordsearchPuzzle({
                theme: themeInput.value,
                words: parseWordsInput(wordsInput.value),
                difficulty: difficultySelect.value,
            });
            themeInput.value = '';
            wordsInput.value = '';
            showToast(`Puzzle #${id} added`);
            renderWordsearchClassicTable();
        } catch (err) {
            showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
        }
    });
}

/** Parses an uploaded Classic-puzzle-list file: one puzzle per line, "difficulty,theme,word1,
 * word2,..." -- unlike Daily's fixed 10-word rows, Classic's word count varies by difficulty (6
 * for Easy, 10 for Medium/Hard), so the theme field is always present (never omitted) rather than
 * inferred from field count like parseWordsearchDailyListFile() does; word-count validation
 * itself happens downstream in bulkAddClassicWordsearchPuzzles(), which already knows each
 * difficulty's required count. */
function parseWordsearchClassicListFile(text) {
    return stripCsvHeaderRow(text.split(/\r?\n/))
        .map((line) => line.split(',').map((field) => field.trim()).filter((field, i, arr) => !(i === arr.length - 1 && field === '')))
        .filter((fields) => fields.length > 1)
        .map(([difficulty, theme, ...words]) => ({ difficulty, theme: theme || '', words }));
}

function wireWordsearchClassicImportExport() {
    document.getElementById('wordsearch-classic-import-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('wordsearch-classic-import-input');
        const file = fileInput.files[0];
        if (!file) {
            showToast('Choose a puzzle-list file first');
            return;
        }

        const entries = parseWordsearchClassicListFile(await file.text());
        if (entries.length === 0) {
            showToast('No puzzles found in that file');
            return;
        }
        if (!window.confirm(`Import ${entries.length} puzzle${entries.length === 1 ? '' : 's'}?`)) return;

        try {
            const result = await bulkAddClassicWordsearchPuzzles(entries);
            fileInput.value = '';
            showToast(`Imported ${result.count} puzzle${result.count === 1 ? '' : 's'}`);
            renderWordsearchClassicTable();
        } catch (err) {
            showToast(err.message || "Couldn't import -- check Firestore rules are deployed");
        }
    });

    document.getElementById('wordsearch-classic-export-btn').addEventListener('click', async () => {
        let puzzles;
        try {
            puzzles = await listClassicWordsearchPuzzles();
        } catch {
            showToast("Couldn't load classic puzzles to export");
            return;
        }
        if (puzzles.length === 0) {
            showToast('No puzzles seeded yet');
            return;
        }

        const csvRows = ['id,difficulty,theme,words...', ...puzzles.map((p) => [p.id, p.difficulty, p.theme || '', ...p.words].join(','))];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'wordsearch-classic-puzzles.csv';
        link.click();
        URL.revokeObjectURL(url);
    });
}

function parseWordsearchTournamentPuzzlesInput(raw) {
    return raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => ({
        words: line.split(',').map((w) => w.trim()).filter(Boolean),
    }));
}

async function renderWordsearchTournamentsTable() {
    const container = document.getElementById('wordsearch-tournaments-table');
    let tournaments;
    try {
        tournaments = await listWordsearchTournaments();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load tournaments &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    if (tournaments.length === 0) {
        container.innerHTML = `<div class="empty-state">No tournaments yet. Create one below.</div>`;
        return;
    }

    container.innerHTML = tournaments.map((t) => `
        <div class="tournament-row">
            <span class="tournament-row-name">${escapeHtml(t.name)}</span>
            <span class="tournament-row-meta">${t.puzzles.length} puzzles &bull; +${t.completionBonus} bonus</span>
            <span class="status-pill ${t.active ? 'on' : ''}">${t.active ? 'Active' : 'Inactive'}</span>
            <div class="tournament-row-actions">
                <button class="btn" data-toggle-ws-tournament="${t.id}" data-active="${t.active}" type="button">${t.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn danger" data-delete-ws-tournament="${t.id}" type="button">Delete</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-toggle-ws-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.toggleWsTournament;
            const isActive = btn.dataset.active === 'true';
            try {
                await setWordsearchTournamentActive(id, !isActive);
                renderWordsearchTournamentsTable();
            } catch {
                showToast("Couldn't save -- check Firestore rules are deployed");
            }
        });
    });

    container.querySelectorAll('[data-delete-ws-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm('Delete this tournament? Players\' progress on it will be orphaned.')) return;
            try {
                await deleteWordsearchTournament(btn.dataset.deleteWsTournament);
                showToast('Tournament deleted');
                renderWordsearchTournamentsTable();
            } catch {
                showToast("Couldn't delete -- check Firestore rules are deployed");
            }
        });
    });
}

function wireWordsearchTournamentCreate() {
    document.getElementById('wordsearch-tournament-create-btn').addEventListener('click', async () => {
        const name = document.getElementById('wordsearch-tournament-name-input').value.trim();
        const puzzles = parseWordsearchTournamentPuzzlesInput(document.getElementById('wordsearch-tournament-puzzles-input').value);
        const completionBonus = Number(document.getElementById('wordsearch-tournament-bonus-input').value);

        if (!name) {
            showToast('Enter a tournament name');
            return;
        }
        if (puzzles.length === 0) {
            showToast('Enter at least one puzzle');
            return;
        }

        try {
            await createWordsearchTournament({ name, puzzles, completionBonus });
            document.getElementById('wordsearch-tournament-name-input').value = '';
            document.getElementById('wordsearch-tournament-puzzles-input').value = '';
            document.getElementById('wordsearch-tournament-bonus-input').value = '250';
            showToast('Tournament created');
            renderWordsearchTournamentsTable();
        } catch (err) {
            showToast(err.message || "Couldn't save -- check Firestore rules are deployed");
        }
    });
}

function renderModResult(user) {
    const el = document.getElementById('mod-result');
    if (!user) {
        el.innerHTML = `<div class="empty-state">No user found with that username.</div>`;
        return;
    }

    el.innerHTML = `
        <div class="mod-user-card">
            <div class="mod-user-row"><span>Display name</span><strong>${escapeHtml(user.displayName)}</strong></div>
            <div class="mod-user-row"><span>Username</span><strong>${escapeHtml(user.username)}</strong></div>
            <div class="mod-user-row"><span>Admin</span><span class="status-pill ${user.isAdmin ? 'on' : ''}">${user.isAdmin ? 'Yes' : 'No'}</span></div>
            <div class="mod-user-row"><span>Banned</span><span class="status-pill ${user.isBanned ? 'banned' : ''}">${user.isBanned ? `Yes (${escapeHtml(user.bannedReason || '')})` : 'No'}</span></div>
            <div class="mod-actions">
                <button class="btn ${user.isBanned ? '' : 'danger'}" id="mod-ban-toggle" type="button">${user.isBanned ? 'Unban' : 'Ban'}</button>
                <button class="btn" id="mod-admin-toggle" type="button">${user.isAdmin ? 'Remove Admin' : 'Make Admin'}</button>
            </div>
        </div>
    `;

    document.getElementById('mod-ban-toggle').addEventListener('click', async () => {
        if (user.isBanned) {
            await setUserBanned(user.uid, false);
            showToast('User unbanned');
        } else {
            const reason = window.prompt('Ban reason:');
            if (reason === null) return;
            await setUserBanned(user.uid, true, reason);
            showToast('User banned');
        }
        const refreshed = await lookupUserByUsername(user.username);
        renderModResult(refreshed);
    });

    document.getElementById('mod-admin-toggle').addEventListener('click', async () => {
        await setUserAdmin(user.uid, !user.isAdmin);
        showToast(user.isAdmin ? 'Admin removed' : 'User is now an admin');
        const refreshed = await lookupUserByUsername(user.username);
        renderModResult(refreshed);
    });
}

function wireModeration() {
    document.getElementById('mod-search-btn').addEventListener('click', async () => {
        const username = document.getElementById('mod-search-input').value.trim();
        if (!username) return;
        const user = await lookupUserByUsername(username);
        renderModResult(user);
    });
}

async function init() {
    const { profile } = await initShell();

    if (!profile.isAdmin) {
        blockNonAdminAccess();
        return;
    }

    wireCollapsibleSections();
    wireActivitySummary();
    const gameSectionConfigIds = ['challengeExpiration', 'sudokuTournamentSettings', 'wordsearchTournamentSettings'];
    const generalConfigIds = CONFIG_FORMS
        .map((form) => form.id)
        .filter((id) => !gameSectionConfigIds.includes(id));
    await renderConfigForms('config-forms', generalConfigIds);
    await renderConfigForms('wordle-challenge-expiration-form', ['challengeExpiration']);
    await renderConfigForms('sudoku-tournament-settings-form', ['sudokuTournamentSettings']);
    await renderConfigForms('wordsearch-tournament-settings-form', ['wordsearchTournamentSettings']);
    await renderAdSlotForms();
    wireModeration();
    wireDailyWordsAdd();
    wireDailyWordsImportExport();
    await renderDailyWordsTable();
    wireTournamentCreate();
    await renderTournamentsTable();
    wireSudokuDailyAdd();
    wireSudokuDailyImportExport();
    await renderSudokuDailyTable();
    wireSudokuClassicAdd();
    wireSudokuClassicImportExport();
    await renderSudokuClassicTable();
    wireSudokuTournamentCreate();
    await renderSudokuTournamentsTable();
    wireWordsearchDailyAdd();
    wireWordsearchDailyImportExport();
    await renderWordsearchDailyTable();
    wireWordsearchClassicAdd();
    wireWordsearchClassicImportExport();
    await renderWordsearchClassicTable();
    wireWordsearchTournamentCreate();
    await renderWordsearchTournamentsTable();
}

init();
