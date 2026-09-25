import { escapeHtml, showToast } from '../utils/helpers.js';
import {
    DIFFICULTIES, parsePuzzleText, puzzleToText,
    listDailyConnectionsPuzzles, addDailyConnectionsPuzzles, updateDailyConnectionsPuzzle,
    listClassicConnectionsPuzzles, addClassicConnectionsPuzzles, updateClassicConnectionsPuzzle,
    listConnectionsTournaments, createConnectionsTournament, setConnectionsTournamentActive, deleteConnectionsTournament,
} from './connections-admin.js';
// Same year > month (Daily) and difficulty (Classic) grouping every other game's admin table
// uses -- shared from admin-page.js's own extraction, see admin-table-grouping.js's doc comment.
import {
    monthLabel, groupWordsByMonth, groupMonthsByYear, groupByDifficulty, DIFFICULTY_LABELS,
    wireCollapsibleToggles,
} from './admin-table-grouping.js';

const FORMAT_HELP = `Format: 4 lines per puzzle, easiest group first (yellow, green, blue, purple), each as <code>Group name: word, word, word, word</code>. Separate puzzles with a blank line. All 16 words in a puzzle must be unique.`;
const PLACEHOLDER = `Fish: Bass, Pike, Perch, Carp
Musical terms: Flat, Sharp, Note, Scale
Kitchen items: Pan, Whisk, Ladle, Grater
Hidden colors: Bored, Scarlet, Tangerine, Bluff

Chess pieces: King, Queen, Rook, Pawn
Currencies: Yen, Peso, Rand, Franc
Card games: Bridge, Hearts, Spades, Poker
Dental: Crown, Filling, Root, Brace`;

// Shown next to "Or import a file" as a literal file-contents example -- unlike Sudoku/Word
// Search, an uploaded Connections file is plain text in this exact block format, not a
// spreadsheet-style CSV, so it's worth spelling out concretely rather than only via the
// textarea's placeholder above (which the file-upload path doesn't otherwise show at all).
const FILE_EXAMPLE = PLACEHOLDER;
const CLASSIC_FILE_EXAMPLE = `difficulty: easy
Fruits: Apple, Banana, Orange, Grape
Animals: Lion, Tiger, Zebra, Monkey
Colors: Red, Blue, Green, Yellow
Furniture: Chair, Table, Sofa, Bed

difficulty: hard
Anagrams of colors: Der, Nurb, Ergne, Lube
Homophones of numbers: Won, Too, Ate, Fore
Silent letters: Knight, Gnome, Wrist, Psalm
Palindromes: Level, Radar, Civic, Kayak`;

function fileExampleHtml(example) {
    return `
        <p class="form-hint">A <code>.txt</code> file with this exact content is a valid upload -- one puzzle per block, blank line between blocks, no header row or commas-as-columns like a spreadsheet CSV:</p>
        <pre class="cx-admin-example">${escapeHtml(example)}</pre>
    `;
}

const ADMIN_HTML = `
    <div class="section">
        <div class="section-title">Daily Puzzles</div>
        <div class="card">
            <p class="config-form-desc">Each puzzle is stored under the exact date it plays on. Add-only, and each new puzzle automatically gets the day right after the previous one. ${FORMAT_HELP} Paste several puzzles at once to add them in bulk, or upload a .txt file in the same format.</p>
            <div class="form-field" id="cx-admin-daily-start-field" hidden>
                <label for="cx-admin-daily-start">Start date for Challenge #1</label>
                <input type="date" id="cx-admin-daily-start">
            </div>
            <div class="sudoku-puzzle-form">
                <div class="form-field">
                    <label for="cx-admin-daily-input">Puzzle(s)</label>
                    <textarea id="cx-admin-daily-input" rows="7" placeholder="${escapeHtml(PLACEHOLDER)}"></textarea>
                </div>
                <button class="btn primary" id="cx-admin-daily-add" type="button">Add Puzzle(s)</button>
                <div class="form-field">
                    <label for="cx-admin-daily-file">Or import a file</label>
                    <input type="file" id="cx-admin-daily-file" accept=".txt,text/plain">
                    ${fileExampleHtml(FILE_EXAMPLE)}
                </div>
                <div class="mod-search-row">
                    <button class="btn primary" id="cx-admin-daily-import" type="button">Import File</button>
                    <button class="btn" id="cx-admin-daily-export" type="button">Download</button>
                </div>
            </div>
            <div id="cx-admin-daily-table"><div class="loading-text">Loading&hellip;</div></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Classic Puzzles</div>
        <div class="card">
            <p class="config-form-desc">Classic serves a random puzzle from the chosen difficulty's pool. ${FORMAT_HELP} In an uploaded file, a block may begin with a <code>difficulty: easy</code> line to override the selected difficulty.</p>
            <div class="sudoku-puzzle-form">
                <div class="form-field">
                    <label for="cx-admin-classic-input">Puzzle(s)</label>
                    <textarea id="cx-admin-classic-input" rows="7" placeholder="${escapeHtml(PLACEHOLDER)}"></textarea>
                </div>
                <div class="form-field">
                    <label for="cx-admin-classic-difficulty">Difficulty</label>
                    <select id="cx-admin-classic-difficulty">
                        ${DIFFICULTIES.map((d) => `<option value="${d}">${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}
                    </select>
                </div>
                <button class="btn primary" id="cx-admin-classic-add" type="button">Add Puzzle(s)</button>
                <div class="form-field">
                    <label for="cx-admin-classic-file">Or import a file</label>
                    <input type="file" id="cx-admin-classic-file" accept=".txt,text/plain">
                    ${fileExampleHtml(CLASSIC_FILE_EXAMPLE)}
                </div>
                <div class="mod-search-row">
                    <button class="btn primary" id="cx-admin-classic-import" type="button">Import File</button>
                    <button class="btn" id="cx-admin-classic-export" type="button">Download</button>
                </div>
            </div>
            <div id="cx-admin-classic-table"><div class="loading-text">Loading&hellip;</div></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Tournaments</div>
        <div class="card">
            <p class="config-form-desc">Players solve every puzzle in order, each on its own countdown; failing any puzzle resets them to puzzle 1. Points on completion: 30 + 15 per puzzle + the bonus below. ${FORMAT_HELP}</p>
            <div id="cx-admin-tournaments-table"><div class="loading-text">Loading&hellip;</div></div>
            <div class="tournament-form">
                <div class="form-field">
                    <label for="cx-admin-t-name">Name</label>
                    <input type="text" id="cx-admin-t-name" placeholder="e.g. Weekend Sprint">
                </div>
                <div class="form-field">
                    <label for="cx-admin-t-puzzles">Puzzles</label>
                    <textarea id="cx-admin-t-puzzles" rows="10" placeholder="${escapeHtml(PLACEHOLDER)}"></textarea>
                </div>
                <div class="tournament-form-row">
                    <div class="form-field">
                        <label for="cx-admin-t-time">Seconds per puzzle</label>
                        <input type="number" id="cx-admin-t-time" value="180" min="30">
                    </div>
                    <div class="form-field">
                        <label for="cx-admin-t-bonus">Bonus points</label>
                        <input type="number" id="cx-admin-t-bonus" value="50" min="0">
                    </div>
                </div>
                <button class="btn primary" id="cx-admin-t-create" type="button">Create Tournament</button>
            </div>
        </div>
    </div>
`;

function $(id) {
    return document.getElementById(id);
}

function downloadText(filename, text) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

function errorToast(err, fallback) {
    console.error(err);
    showToast(err?.message && !err.code ? err.message : fallback);
}

/** Read-only summary + inline "Edit" for one puzzle row; `onSave(puzzle)` persists the edited text. */
function wireEditRows(container, attr, findPuzzle, onSave) {
    container.querySelectorAll(`[${attr}]`).forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute(attr);
            const puzzle = findPuzzle(key);
            const row = btn.closest('.cx-admin-row');
            const editor = row.querySelector('.cx-admin-editor');
            editor.hidden = false;
            editor.innerHTML = `
                <textarea rows="5">${escapeHtml(puzzleToText(puzzle))}</textarea>
                <div class="mod-search-row">
                    <button class="btn primary" data-save type="button">Save</button>
                    <button class="btn" data-cancel type="button">Cancel</button>
                </div>
            `;
            editor.querySelector('[data-cancel]').addEventListener('click', () => { editor.hidden = true; });
            editor.querySelector('[data-save]').addEventListener('click', async () => {
                try {
                    const [parsed] = parsePuzzleText(editor.querySelector('textarea').value);
                    if (!parsed) throw new Error('Nothing to save.');
                    await onSave(key, { ...puzzle, groups: parsed.groups });
                    showToast('Puzzle saved');
                } catch (err) {
                    errorToast(err, "Couldn't save -- check Firestore rules are deployed");
                }
            });
        });
    });
}

function rowHtml(label, meta, editAttr, key, puzzle) {
    return `
        <div class="cx-admin-row">
            <div class="sudoku-daily-row">
                <span class="cx-admin-id">${label}</span>
                <span class="sudoku-daily-meta">${escapeHtml(meta)}</span>
                <button class="btn" ${editAttr}="${key}" type="button">Edit</button>
            </div>
            <div class="cx-admin-editor" hidden></div>
        </div>
    `;
}

async function renderDailyTable() {
    const container = $('cx-admin-daily-table');
    let puzzles;
    try {
        puzzles = await listDailyConnectionsPuzzles();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load daily puzzles &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }
    $('cx-admin-daily-start-field').hidden = puzzles.length > 0;
    if (puzzles.length === 0) {
        container.innerHTML = `<div class="empty-state">No puzzles seeded yet. Pick a start date above and add one to activate the Daily Challenge.</div>`;
        return;
    }

    // Grouped by year, then month, both collapsed by default -- same treatment as Wordle/Sudoku/
    // Word Search's own Daily tables, so a multi-year pool doesn't become one long flat scroll.
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
                                ${monthPuzzles.map((p) => rowHtml(
                                    `#${p.challengeNumber ?? '?'} &middot; ${p.date}`,
                                    p.groups.map((g) => g.name).join(' / '),
                                    'data-edit-daily', p.date, p,
                                )).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');

    wireCollapsibleToggles(container);
    wireEditRows(container, 'data-edit-daily', (date) => puzzles.find((p) => p.date === date),
        async (date, puzzle) => { await updateDailyConnectionsPuzzle(date, puzzle); renderDailyTable(); });
    container._puzzles = puzzles;
}

async function renderClassicTable() {
    const container = $('cx-admin-classic-table');
    let puzzles;
    try {
        puzzles = await listClassicConnectionsPuzzles();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load classic puzzles &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }
    if (puzzles.length === 0) {
        container.innerHTML = `<div class="empty-state">No Classic puzzles yet.</div>`;
        return;
    }

    // Grouped by difficulty (Easy/Medium/Hard) rather than one flat id-ordered list -- same
    // treatment as Sudoku/Word Search's own Classic tables. Each group defaults open since
    // there are only ever three.
    const groups = groupByDifficulty(puzzles);
    container.innerHTML = Array.from(groups.entries()).map(([difficulty, group]) => `
        <div class="admin-subsection open" data-collapsible>
            <button class="admin-subsection-header" type="button">${DIFFICULTY_LABELS[difficulty]} (${group.length})</button>
            <div class="card">
                ${group.map((p) => rowHtml(
                    `#${p.id}`,
                    p.groups.map((g) => g.name).join(' / '),
                    'data-edit-classic', p.id, p,
                )).join('')}
            </div>
        </div>
    `).join('');

    wireCollapsibleToggles(container);
    wireEditRows(container, 'data-edit-classic', (id) => puzzles.find((p) => String(p.id) === String(id)),
        async (id, puzzle) => { await updateClassicConnectionsPuzzle(id, puzzle); renderClassicTable(); });
    container._puzzles = puzzles;
}

async function renderTournamentsTable() {
    const container = $('cx-admin-tournaments-table');
    let tournaments;
    try {
        tournaments = await listConnectionsTournaments();
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
            <span class="tournament-row-meta">${t.puzzles.length} puzzles &bull; ${t.timePerPuzzleSeconds}s each &bull; +${t.bonusPoints || 0} bonus</span>
            <span class="status-pill ${t.active ? 'on' : ''}">${t.active ? 'Active' : 'Inactive'}</span>
            <div class="tournament-row-actions">
                <button class="btn" data-toggle-cx-tournament="${t.id}" data-active="${t.active}" type="button">${t.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn danger" data-delete-cx-tournament="${t.id}" type="button">Delete</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-toggle-cx-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await setConnectionsTournamentActive(btn.dataset.toggleCxTournament, btn.dataset.active !== 'true');
                renderTournamentsTable();
            } catch {
                showToast("Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
    container.querySelectorAll('[data-delete-cx-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm("Delete this tournament? Players' progress on it will be orphaned.")) return;
            try {
                await deleteConnectionsTournament(btn.dataset.deleteCxTournament);
                showToast('Tournament deleted');
                renderTournamentsTable();
            } catch {
                showToast("Couldn't delete -- check Firestore rules are deployed");
            }
        });
    });
}

function wireDaily() {
    async function submit(text, sourceInput) {
        const startInput = $('cx-admin-daily-start');
        try {
            const puzzles = parsePuzzleText(text);
            if (puzzles.length === 0) { showToast('No puzzles found'); return; }
            if (puzzles.length > 1 && !window.confirm(`Add ${puzzles.length} puzzles?`)) return;
            const result = await addDailyConnectionsPuzzles(puzzles, startInput.value || undefined);
            sourceInput.value = '';
            startInput.value = '';
            showToast(`Added ${result.count} puzzle${result.count === 1 ? '' : 's'} (${result.firstDate} → ${result.lastDate})`);
            renderDailyTable();
        } catch (err) {
            errorToast(err, "Couldn't add -- check Firestore rules are deployed");
        }
    }
    $('cx-admin-daily-add').addEventListener('click', () => submit($('cx-admin-daily-input').value, $('cx-admin-daily-input')));
    $('cx-admin-daily-import').addEventListener('click', async () => {
        const file = $('cx-admin-daily-file').files[0];
        if (!file) { showToast('Choose a file first'); return; }
        await submit(await file.text(), $('cx-admin-daily-file'));
    });
    $('cx-admin-daily-export').addEventListener('click', () => {
        const puzzles = $('cx-admin-daily-table')._puzzles || [];
        if (puzzles.length === 0) { showToast('Nothing to download yet'); return; }
        downloadText('connections-daily-puzzles.txt', puzzles.map(puzzleToText).join('\n\n') + '\n');
    });
}

function wireClassic() {
    async function submit(text, sourceInput) {
        try {
            const selected = $('cx-admin-classic-difficulty').value;
            const puzzles = parsePuzzleText(text).map((p) => ({ ...p, difficulty: p.difficulty ?? selected }));
            if (puzzles.length === 0) { showToast('No puzzles found'); return; }
            if (puzzles.length > 1 && !window.confirm(`Add ${puzzles.length} puzzles?`)) return;
            const result = await addClassicConnectionsPuzzles(puzzles);
            sourceInput.value = '';
            showToast(`Added ${result.count} puzzle${result.count === 1 ? '' : 's'}`);
            renderClassicTable();
        } catch (err) {
            errorToast(err, "Couldn't add -- check Firestore rules are deployed");
        }
    }
    $('cx-admin-classic-add').addEventListener('click', () => submit($('cx-admin-classic-input').value, $('cx-admin-classic-input')));
    $('cx-admin-classic-import').addEventListener('click', async () => {
        const file = $('cx-admin-classic-file').files[0];
        if (!file) { showToast('Choose a file first'); return; }
        await submit(await file.text(), $('cx-admin-classic-file'));
    });
    $('cx-admin-classic-export').addEventListener('click', () => {
        const puzzles = $('cx-admin-classic-table')._puzzles || [];
        if (puzzles.length === 0) { showToast('Nothing to download yet'); return; }
        downloadText('connections-classic-puzzles.txt', puzzles.map((p) => `difficulty: ${p.difficulty}\n${puzzleToText(p)}`).join('\n\n') + '\n');
    });
}

function wireTournamentCreate() {
    $('cx-admin-t-create').addEventListener('click', async () => {
        try {
            await createConnectionsTournament({
                name: $('cx-admin-t-name').value,
                puzzles: parsePuzzleText($('cx-admin-t-puzzles').value),
                timePerPuzzleSeconds: Number($('cx-admin-t-time').value),
                bonusPoints: Number($('cx-admin-t-bonus').value) || 0,
            });
            $('cx-admin-t-name').value = '';
            $('cx-admin-t-puzzles').value = '';
            showToast('Tournament created');
            renderTournamentsTable();
        } catch (err) {
            errorToast(err, "Couldn't create -- check Firestore rules are deployed");
        }
    });
}

/** Renders the whole Connections admin section into `#connections-admin-root`. Called once by admin-page.js's init(). */
export async function initConnectionsAdmin() {
    const root = $('connections-admin-root');
    if (!root) return;
    root.innerHTML = ADMIN_HTML;
    wireDaily();
    wireClassic();
    wireTournamentCreate();
    await Promise.all([renderDailyTable(), renderClassicTable(), renderTournamentsTable()]);
}
