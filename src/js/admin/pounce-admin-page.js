import { escapeHtml, showToast } from '../utils/helpers.js';
import {
    DIFFICULTY_IDS, DAILY_DIFFICULTY, signature, generateBoards, summarise, boardsFromJson, boardsToJson,
    listDailyPounceBoards, addDailyPounceBoards, regenerateDailyPounceBoard,
    listClassicPounceBoards, addClassicPounceBoards, regenerateClassicPounceBoard, deleteClassicPounceBoard,
    listPounceTournaments, prepareRun, createPounceTournaments, setPounceTournamentActive, deletePounceTournament,
} from './pounce-admin.js';
import { DIFFICULTIES } from '../games/pounce/pounce-generator.js';
import { TECHNIQUES } from '../games/pounce/pounce-logic.js';
import { REGION_COLOURS } from '../games/pounce/pounce-engine.js';
// Same year > month (Daily) and difficulty (Classic) grouping as every other game's admin tables.
import {
    monthLabel, groupWordsByMonth, groupMonthsByYear, groupByDifficulty, DIFFICULTY_LABELS,
    wireCollapsibleToggles,
} from './admin-table-grouping.js';

const SAMPLE_COUNT = 12;

const JSON_HELP = 'Hand-made boards: a JSON array of <code>{ "difficulty": "medium", "size": 8, "regions": ["00011122", &hellip;], "solution": [3, 0, 6, &hellip;], "dogs": [{ "x": 2, "y": 4 }], "pawprints": [{ "x": 5, "y": 1, "n": 2 }] }</code> &mdash; <code>regions</code> is one digit string per row (a digit per region), <code>solution</code> the cat\'s column for each row. Each one is checked for exactly one solution, solvable by logic. Download gives the same format.';

function difficultyOptions(selected) {
    return DIFFICULTY_IDS.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${DIFFICULTIES[d].label} (${DIFFICULTIES[d].size}&times;${DIFFICULTIES[d].size})</option>`).join('');
}

function poolInputHtml(prefix, { withDifficulty, defaultCount }) {
    return `
        <div class="sudoku-puzzle-form">
            <div class="tournament-form-row">
                <div class="form-field" ${withDifficulty ? '' : 'hidden'}>
                    <label for="${prefix}-difficulty">Difficulty</label>
                    <select id="${prefix}-difficulty">${difficultyOptions('medium')}</select>
                </div>
                <div class="form-field">
                    <label for="${prefix}-count">How many boards</label>
                    <input type="number" id="${prefix}-count" value="${defaultCount}" min="1" max="2000">
                </div>
            </div>
            <div class="mod-search-row">
                <button class="btn primary" id="${prefix}-generate-btn" type="button">Generate</button>
                <button class="btn" id="${prefix}-export" type="button">Download</button>
            </div>
            <div class="admin-subsection pa-import" data-collapsible>
                <button class="admin-subsection-header" type="button">Import hand-made boards (JSON)</button>
                <div class="card">
                    <p class="config-form-desc">${JSON_HELP}</p>
                    <div class="form-field">
                        <label for="${prefix}-json">Boards as JSON</label>
                        <textarea id="${prefix}-json" rows="6" placeholder="[ { &quot;size&quot;: 8, &quot;regions&quot;: [...], &quot;solution&quot;: [...] } ]"></textarea>
                    </div>
                    <div class="form-field">
                        <label for="${prefix}-json-file">Or upload a .json file</label>
                        <input type="file" id="${prefix}-json-file" accept=".json,application/json">
                    </div>
                    <div class="mod-search-row">
                        <button class="btn" id="${prefix}-import-btn" type="button">Preview Import</button>
                    </div>
                </div>
            </div>
            <div id="${prefix}-preview"></div>
        </div>
    `;
}

const ADMIN_HTML = `
    <div class="section">
        <div class="section-title">Daily Boards</div>
        <div class="card">
            <p class="config-form-desc">The Daily is a Medium 8&times;8 board (with sleeping dogs). Each board is stored under the exact date it plays on; add-only, and every new board gets the day after the previous one. <strong>Generate</strong> makes boards right here in the browser &mdash; each is proven to have exactly one solution and to be solvable by logic alone &mdash; so a year of Dailies is one click. Preview them, then Add. Regenerate swaps one board for a fresh one without moving its date.</p>
            <div class="form-field" id="pa-daily-start-field" hidden>
                <label for="pa-daily-start">Start date for Challenge #1</label>
                <input type="date" id="pa-daily-start">
            </div>
            ${poolInputHtml('pa-daily', { withDifficulty: false, defaultCount: 365 })}
            <div id="pa-daily-table"><div class="loading-text">Loading&hellip;</div></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Classic Boards</div>
        <div class="card">
            <p class="config-form-desc">Classic serves boards a player hasn't solved yet first, from the chosen difficulty's pool; Zen plays the same pool without scoring. Easy 6&times;6 &middot; Medium 8&times;8 with dogs &middot; Hard 9&times;9 with dogs and pawprint clues.</p>
            ${poolInputHtml('pa-classic', { withDifficulty: true, defaultCount: 100 })}
            <div id="pa-classic-table"><div class="loading-text">Loading&hellip;</div></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Global Configs</div>
        <div id="pounce-tournament-settings-form"><div class="loading-text">Loading&hellip;</div></div>
    </div>

    <div class="section">
        <div class="section-title">Nine Lives Runs</div>
        <div class="card">
            <p class="config-form-desc">A run is five boards that grow from 5&times;5 to 9&times;9, played against the clock with one shared set of lives (time per board and lives are the Global Config above). A wrong cat or a board that runs out of time costs a life; a solved board banks 30, a failed one 10. A run that reaches the end adds its completion bonus plus 5 per life left. Every active run is listed to players.</p>
            <div id="pa-runs-table"><div class="loading-text">Loading&hellip;</div></div>
            <div class="tournament-form">
                <div class="qa-bulk-title">Create one run</div>
                <div class="tournament-form-row">
                    <div class="form-field">
                        <label for="pa-run-name">Name</label>
                        <input type="text" id="pa-run-name" placeholder="e.g. Autumn Nap">
                    </div>
                    <div class="form-field">
                        <label for="pa-run-bonus">Completion bonus</label>
                        <input type="number" id="pa-run-bonus" value="100" min="0">
                    </div>
                </div>
                <div class="mod-search-row">
                    <button class="btn" id="pa-run-preview-btn" type="button">Generate &amp; Preview</button>
                    <button class="btn primary" id="pa-run-create" type="button" disabled>Create Run (active)</button>
                </div>
                <div id="pa-run-preview"></div>
            </div>
            <div class="tournament-form qa-bulk-runs">
                <div class="qa-bulk-title">Create many runs</div>
                <p class="config-form-desc">Generates N runs named "&lt;name&gt; 1", "&lt;name&gt; 2", &hellip; Tip: create them Inactive and activate a few at a time.</p>
                <div class="tournament-form-row">
                    <div class="form-field">
                        <label for="pa-bulk-count">How many runs</label>
                        <input type="number" id="pa-bulk-count" value="10" min="1" max="200">
                    </div>
                    <div class="form-field">
                        <label for="pa-bulk-name">Name</label>
                        <input type="text" id="pa-bulk-name" value="Nine Lives Run">
                    </div>
                    <div class="form-field">
                        <label for="pa-bulk-bonus">Completion bonus (each)</label>
                        <input type="number" id="pa-bulk-bonus" value="100" min="0">
                    </div>
                    <div class="form-field">
                        <label for="pa-bulk-active">Start as</label>
                        <select id="pa-bulk-active">
                            <option value="inactive">Inactive</option>
                            <option value="active">Active</option>
                        </select>
                    </div>
                </div>
                <div class="mod-search-row">
                    <button class="btn" id="pa-bulk-generate-btn" type="button">Generate Runs</button>
                </div>
                <div id="pa-bulk-preview"></div>
            </div>
        </div>
    </div>
`;

function $(id) {
    return document.getElementById(id);
}

function downloadText(filename, text) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

function errorToast(err, fallback) {
    console.error(err);
    showToast(err?.message && !err.code ? err.message : fallback);
}

const paint = () => new Promise((r) => setTimeout(r, 30)); // let loading text paint before CPU work

/**
 * A small board thumbnail: region colours, the solution's cats as dots, dogs and pawprints.
 * Self-contained (pounce.css isn't loaded on the admin page); styles in admin.css (.pa-thumb).
 */
function thumbHtml(p, label = 'Pounce board') {
    const n = p.size;
    const dog = new Set((p.dogs || []).map((d) => d.y * n + d.x));
    const paw = new Map((p.pawprints || []).map((c) => [c.y * n + c.x, c.n]));
    let cells = '';
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const idx = y * n + x;
            const colour = REGION_COLOURS[Number(p.regions[y][x])]?.colour || '#fff';
            let mark = '';
            if (dog.has(idx)) mark = '<i class="pa-dog"></i>';
            else if (paw.has(idx)) mark = `<b>${paw.get(idx)}</b>`;
            else if (p.solution?.[y] === x) mark = '<i class="pa-cat"></i>';
            cells += `<span style="background:${colour}">${mark}</span>`;
        }
    }
    return `<div class="pa-thumb" style="--pa-n: ${n};" role="img" aria-label="${escapeHtml(label)}">${cells}</div>`;
}

function statsLine(p) {
    const technique = p.grade?.technique ? TECHNIQUES[p.grade.technique]?.label || p.grade.technique : 'ungraded';
    return `${DIFFICULTIES[p.difficulty]?.label || p.difficulty} · ${p.size}×${p.size}${p.dogs?.length ? ` · ${p.dogs.length} dogs` : ''}${p.pawprints?.length ? ` · ${p.pawprints.length} pawprints` : ''} · hardest step: ${technique}`;
}

/** Preview of a generated/imported batch: counts, grade spread, warnings, a sample of boards. */
function renderBatchPreview(container, boards, { title }) {
    const { techniques, warnings } = summarise(boards);
    const spread = Object.entries(techniques)
        .sort((a, b) => (TECHNIQUES[a[0]]?.tier ?? 9) - (TECHNIQUES[b[0]]?.tier ?? 9))
        .map(([t, c]) => `${escapeHtml(TECHNIQUES[t]?.label || t)} ${c}`).join(' · ');
    container.innerHTML = `
        <div class="qa-preview-summary">${escapeHtml(title)} &mdash; every one has exactly one solution and is solvable by logic. Hardest step needed: ${spread}.</div>
        ${warnings.length ? `<div class="qa-preview-warning">${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${escapeHtml(warnings.slice(0, 5).join('; '))}${warnings.length > 5 ? '&hellip;' : ''}</div>` : ''}
        <div class="qa-preview-grid">
            ${boards.slice(0, SAMPLE_COUNT).map((b, i) => `
                <div class="qa-preview-card">
                    ${thumbHtml(b, `Board ${i + 1}`)}
                    <div class="qa-preview-title">Board ${i + 1}</div>
                    <div class="qa-preview-meta">${escapeHtml(statsLine(b))}</div>
                </div>
            `).join('')}
        </div>
        ${boards.length > SAMPLE_COUNT ? `<div class="qa-preview-meta">&hellip; and ${boards.length - SAMPLE_COUNT} more.</div>` : ''}
    `;
}

function rowHtml(label, p, key, { canDelete }) {
    return `
        <div class="cx-admin-row">
            <div class="sudoku-daily-row">
                <span class="cx-admin-id">${label}</span>
                <span class="sudoku-daily-meta">${escapeHtml(statsLine(p))}</span>
                <button class="btn" data-pa-view="${key}" type="button">View</button>
                <button class="btn" data-pa-regen="${key}" type="button">Regenerate</button>
                ${canDelete ? `<button class="btn danger" data-pa-delete="${key}" type="button">Delete</button>` : ''}
            </div>
            <div class="cx-admin-editor" hidden></div>
        </div>
    `;
}

/** View (thumbnail toggle), Regenerate and Delete buttons on a table's rows. */
function wireRows(container, findBoard, { onRegen, onDelete }) {
    container.querySelectorAll('[data-pa-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const box = btn.closest('.cx-admin-row').querySelector('.cx-admin-editor');
            box.hidden = !box.hidden;
            if (!box.hidden) box.innerHTML = thumbHtml(findBoard(btn.dataset.paView));
        });
    });
    container.querySelectorAll('[data-pa-regen]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm('Replace this board with a freshly generated one? Anyone mid-way through it will see the new board next time.')) return;
            btn.disabled = true;
            try {
                await onRegen(btn.dataset.paRegen);
                showToast('Board regenerated');
            } catch (err) {
                btn.disabled = false;
                errorToast(err, "Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
    container.querySelectorAll('[data-pa-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm('Delete this board? Players who solved it keep their points.')) return;
            try {
                await onDelete(btn.dataset.paDelete);
                showToast('Board deleted');
            } catch (err) {
                errorToast(err, "Couldn't delete -- check Firestore rules are deployed");
            }
        });
    });
}

async function renderDailyTable() {
    const container = $('pa-daily-table');
    let boards;
    try {
        boards = await listDailyPounceBoards();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load Daily boards &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }
    $('pa-daily-start-field').hidden = boards.length > 0;
    container._boards = boards;
    if (boards.length === 0) {
        container.innerHTML = `<div class="empty-state">No Daily boards yet. Pick a start date above, Generate, then Add to activate the Daily Challenge.</div>`;
        return;
    }
    const yearGroups = groupMonthsByYear(groupWordsByMonth(boards));
    container.innerHTML = `<div class="qa-preview-summary">${boards.length} Daily boards: ${boards[0].date} &rarr; ${boards[boards.length - 1].date}</div>` + Array.from(yearGroups.entries()).map(([year, yearMonths]) => {
        const yearCount = Array.from(yearMonths.values()).reduce((sum, arr) => sum + arr.length, 0);
        return `
            <div class="admin-subsection" data-collapsible>
                <button class="admin-subsection-header" type="button">${year} (${yearCount})</button>
                <div class="card">
                    ${Array.from(yearMonths.entries()).map(([monthKey, monthBoards]) => `
                        <div class="admin-subsection admin-subsection-nested" data-collapsible>
                            <button class="admin-subsection-header" type="button">${monthLabel(monthKey)} (${monthBoards.length})</button>
                            <div class="card">
                                ${monthBoards.map((b) => rowHtml(`#${b.challengeNumber ?? '?'} &middot; ${b.date}`, b, b.date, { canDelete: false })).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
    wireCollapsibleToggles(container);
    wireRows(container, (date) => boards.find((b) => b.date === date), {
        onRegen: async (date) => { await regenerateDailyPounceBoard(date); renderDailyTable(); },
    });
}

async function renderClassicTable() {
    const container = $('pa-classic-table');
    let boards;
    try {
        boards = await listClassicPounceBoards();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load Classic boards &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }
    container._boards = boards;
    if (boards.length === 0) {
        container.innerHTML = `<div class="empty-state">No Classic boards yet.</div>`;
        return;
    }
    const groups = groupByDifficulty(boards);
    // Classic difficulties open by default (only three), like every other game's admin.
    container.innerHTML = Array.from(groups.entries()).map(([difficulty, group]) => `
        <div class="admin-subsection open" data-collapsible>
            <button class="admin-subsection-header" type="button">${DIFFICULTY_LABELS[difficulty]} (${group.length})</button>
            <div class="card">
                ${group.map((b) => rowHtml(`#${escapeHtml(b.id)}`, b, b.id, { canDelete: true })).join('')}
            </div>
        </div>
    `).join('');
    wireCollapsibleToggles(container);
    const find = (id) => boards.find((b) => String(b.id) === String(id));
    wireRows(container, find, {
        onRegen: async (id) => { await regenerateClassicPounceBoard(id, find(id).difficulty); renderClassicTable(); },
        onDelete: async (id) => { await deleteClassicPounceBoard(id); renderClassicTable(); },
    });
}

async function renderRunsTable() {
    const container = $('pa-runs-table');
    let runs;
    try {
        runs = await listPounceTournaments();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load Nine Lives Runs &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }
    if (runs.length === 0) {
        container.innerHTML = `<div class="empty-state">No Nine Lives Runs yet. Create one below.</div>`;
        return;
    }
    container.innerHTML = runs.map((t) => `
        <div class="cx-admin-row">
            <div class="tournament-row">
                <span class="tournament-row-name">${escapeHtml(t.name)}</span>
                <span class="tournament-row-meta">${t.boards.length} boards (${t.boards.map((b) => `${b.size}×${b.size}`).join(', ')}) &bull; +${t.completionBonus || 0} bonus</span>
                <span class="status-pill ${t.active ? 'on' : ''}">${t.active ? 'Active' : 'Inactive'}</span>
                <div class="tournament-row-actions">
                    <button class="btn" data-pa-run-view="${t.id}" type="button">View</button>
                    <button class="btn" data-toggle-pa-run="${t.id}" data-active="${t.active}" type="button">${t.active ? 'Deactivate' : 'Activate'}</button>
                    <button class="btn danger" data-delete-pa-run="${t.id}" type="button">Delete</button>
                </div>
            </div>
            <div class="cx-admin-editor" hidden></div>
        </div>
    `).join('');
    container.querySelectorAll('[data-pa-run-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const box = btn.closest('.cx-admin-row').querySelector('.cx-admin-editor');
            box.hidden = !box.hidden;
            const run = runs.find((t) => t.id === btn.dataset.paRunView);
            if (!box.hidden) box.innerHTML = `<div class="pa-run-boards">${run.boards.map((b, i) => thumbHtml(b, `Board ${i + 1}`)).join('')}</div>`;
        });
    });
    container.querySelectorAll('[data-toggle-pa-run]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await setPounceTournamentActive(btn.dataset.togglePaRun, btn.dataset.active !== 'true');
                renderRunsTable();
            } catch {
                showToast("Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
    container.querySelectorAll('[data-delete-pa-run]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm("Delete this Nine Lives Run? Players' progress on it will be orphaned.")) return;
            try {
                await deletePounceTournament(btn.dataset.deletePaRun);
                showToast('Nine Lives Run deleted');
                renderRunsTable();
            } catch {
                showToast("Couldn't delete -- check Firestore rules are deployed");
            }
        });
    });
}

/**
 * Generate / Import → Preview → Add flow shared by Daily and Classic. The Add button appears only
 * for a batch that is entirely valid, and the add itself is all-or-nothing.
 */
function wirePool(prefix, { difficultyOf, addFn, onAdded, exportName, exportFn, existingFn, startInput }) {
    const previewEl = $(`${prefix}-preview`);

    function offerAdd(boards) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn primary';
        addBtn.type = 'button';
        addBtn.id = `${prefix}-add`;
        addBtn.textContent = `Add ${boards.length} Board${boards.length === 1 ? '' : 's'}`;
        previewEl.appendChild(addBtn);
        addBtn.addEventListener('click', async () => {
            addBtn.disabled = true;
            addBtn.textContent = 'Saving…';
            try {
                const result = await addFn(boards, startInput?.value || undefined);
                if (startInput) startInput.value = '';
                previewEl.innerHTML = '';
                showToast(`Added ${result.count} board${result.count === 1 ? '' : 's'}${result.firstDate ? ` (${result.firstDate} → ${result.lastDate})` : ''}`);
                onAdded();
            } catch (err) {
                addBtn.disabled = false;
                addBtn.textContent = `Add ${boards.length} Board${boards.length === 1 ? '' : 's'}`;
                errorToast(err, "Couldn't add -- check Firestore rules are deployed");
            }
        });
    }

    $(`${prefix}-generate-btn`).addEventListener('click', async () => {
        const count = Math.round(Number($(`${prefix}-count`).value));
        if (!(count >= 1 && count <= 2000)) { showToast('Choose between 1 and 2000 boards'); return; }
        const difficulty = difficultyOf();
        const btn = $(`${prefix}-generate-btn`);
        btn.disabled = true;
        previewEl.innerHTML = `<div class="loading-text" id="${prefix}-progress">Generating ${count} ${DIFFICULTIES[difficulty].label} boards&hellip;</div>`;
        await paint();
        try {
            const avoid = new Set((existingFn() || []).map(signature));
            const boards = await generateBoards(difficulty, count, {
                avoid,
                onProgress: (done) => { const el = $(`${prefix}-progress`); if (el) el.textContent = `Generating… ${done} of ${count}`; },
            });
            renderBatchPreview(previewEl, boards, { title: `${boards.length} ${DIFFICULTIES[difficulty].label} ${DIFFICULTIES[difficulty].size}×${DIFFICULTIES[difficulty].size} boards ready` });
            offerAdd(boards);
        } catch (err) {
            previewEl.innerHTML = '';
            errorToast(err, "Couldn't generate boards");
        } finally {
            btn.disabled = false;
        }
    });

    $(`${prefix}-import-btn`).addEventListener('click', async () => {
        try {
            const file = $(`${prefix}-json-file`).files[0];
            const text = file ? await file.text() : $(`${prefix}-json`).value;
            if (!text.trim()) { showToast('Paste JSON or choose a file first'); return; }
            previewEl.innerHTML = '<div class="loading-text">Checking boards&hellip;</div>';
            await paint();
            const results = boardsFromJson(text, difficultyOf());
            const bad = results.filter((r) => r.error);
            if (bad.length) {
                previewEl.innerHTML = `
                    <div class="qa-preview-summary">${results.length - bad.length} of ${results.length} boards valid &mdash; fix the ones below, then preview again.</div>
                    ${bad.slice(0, 20).map((r) => `<div class="qa-preview-error">${escapeHtml(r.label)}: ${escapeHtml(r.error)}</div>`).join('')}
                `;
                return;
            }
            const boards = results.map((r) => r.puzzle);
            renderBatchPreview(previewEl, boards, { title: `${boards.length} imported board${boards.length === 1 ? '' : 's'} valid` });
            offerAdd(boards);
        } catch (err) {
            previewEl.innerHTML = '';
            errorToast(err, "Couldn't read those boards");
        }
    });

    $(`${prefix}-export`).addEventListener('click', () => {
        const boards = exportFn();
        if (boards.length === 0) { showToast('Nothing to download yet'); return; }
        downloadText(exportName, `${boardsToJson(boards)}\n`);
    });
}

function wireRunCreate() {
    let boards = null;
    const createBtn = $('pa-run-create');
    $('pa-run-preview-btn').addEventListener('click', async () => {
        const previewEl = $('pa-run-preview');
        createBtn.disabled = true;
        previewEl.innerHTML = '<div class="loading-text">Generating 5 boards&hellip;</div>';
        await paint();
        try {
            boards = prepareRun(`${$('pa-run-name').value.trim()}-${Date.now()}`);
            previewEl.innerHTML = `
                <div class="qa-preview-summary">5 boards, each with exactly one solution: ${boards.map((b) => `${b.size}×${b.size} ${DIFFICULTIES[b.difficulty].label}`).join(' → ')}.</div>
                <div class="pa-run-boards">${boards.map((b, i) => thumbHtml(b, `Board ${i + 1}`)).join('')}</div>
            `;
            createBtn.disabled = false;
        } catch (err) {
            boards = null;
            previewEl.innerHTML = `<div class="qa-preview-error">${escapeHtml(err.message)}</div>`;
        }
    });
    createBtn.addEventListener('click', async () => {
        createBtn.disabled = true;
        try {
            await createPounceTournaments([{ name: $('pa-run-name').value, boards }], { completionBonus: Number($('pa-run-bonus').value), active: true });
            $('pa-run-name').value = '';
            $('pa-run-preview').innerHTML = '';
            boards = null;
            showToast('Nine Lives Run created');
            renderRunsTable();
        } catch (err) {
            createBtn.disabled = !boards;
            errorToast(err, "Couldn't create -- check Firestore rules are deployed");
        }
    });
}

function wireRunBulk() {
    const previewEl = $('pa-bulk-preview');
    $('pa-bulk-generate-btn').addEventListener('click', async () => {
        const count = Math.round(Number($('pa-bulk-count').value));
        const base = $('pa-bulk-name').value.trim();
        if (!(count >= 1 && count <= 200)) { showToast('Choose between 1 and 200 runs'); return; }
        if (!base) { showToast('Give the runs a name'); return; }
        previewEl.innerHTML = '<div class="loading-text" id="pa-bulk-progress">Generating runs&hellip;</div>';
        await paint();
        const runs = [];
        try {
            const stamp = Date.now();
            for (let i = 0; i < count; i++) {
                runs.push({ name: `${base} ${i + 1}`, boards: prepareRun(`${base}-${stamp}-${i}`) });
                if (i % 5 === 4) {
                    const el = $('pa-bulk-progress');
                    if (el) el.textContent = `Generating… ${i + 1} of ${count} runs`;
                    await new Promise((r) => setTimeout(r, 0));
                }
            }
        } catch (err) {
            previewEl.innerHTML = `<div class="qa-preview-error">${escapeHtml(err.message)}</div>`;
            return;
        }
        const active = $('pa-bulk-active').value === 'active';
        previewEl.innerHTML = `
            <div class="qa-preview-summary">${runs.length} run${runs.length === 1 ? '' : 's'} ready (${escapeHtml(runs[0].name)} &hellip; ${escapeHtml(runs[runs.length - 1].name)}), 5 boards each, every board with exactly one solution.</div>
            <div class="pa-run-boards">${runs[0].boards.map((b, i) => thumbHtml(b, `${runs[0].name} board ${i + 1}`)).join('')}</div>
        `;
        const createBtn = document.createElement('button');
        createBtn.className = 'btn primary';
        createBtn.type = 'button';
        createBtn.id = 'pa-bulk-create';
        createBtn.textContent = `Create ${runs.length} Run${runs.length === 1 ? '' : 's'} (${active ? 'active' : 'inactive'})`;
        previewEl.appendChild(createBtn);
        createBtn.addEventListener('click', async () => {
            createBtn.disabled = true;
            try {
                const result = await createPounceTournaments(runs, { completionBonus: Number($('pa-bulk-bonus').value), active });
                previewEl.innerHTML = '';
                showToast(`Created ${result.count} Nine Lives Run${result.count === 1 ? '' : 's'}`);
                renderRunsTable();
            } catch (err) {
                createBtn.disabled = false;
                errorToast(err, "Couldn't create -- check Firestore rules are deployed");
            }
        });
    });
}

/**
 * Renders the whole Pounce admin section into `#pounce-admin-root`. Called once by
 * admin-page.js's init(), which afterwards renders the `pounceTournamentSettings` config form into
 * `#pounce-tournament-settings-form` (inside this section, like Quilt's own settings).
 */
export async function initPounceAdmin() {
    const root = $('pounce-admin-root');
    if (!root) return;
    root.innerHTML = ADMIN_HTML;
    wireCollapsibleToggles(root);
    wirePool('pa-daily', {
        difficultyOf: () => DAILY_DIFFICULTY,
        addFn: addDailyPounceBoards,
        onAdded: renderDailyTable,
        exportName: 'pounce-daily-boards.json',
        exportFn: () => $('pa-daily-table')._boards || [],
        existingFn: () => $('pa-daily-table')._boards,
        startInput: $('pa-daily-start'),
    });
    wirePool('pa-classic', {
        difficultyOf: () => $('pa-classic-difficulty').value,
        addFn: (boards) => addClassicPounceBoards(boards),
        onAdded: renderClassicTable,
        exportName: 'pounce-classic-boards.json',
        exportFn: () => $('pa-classic-table')._boards || [],
        existingFn: () => $('pa-classic-table')._boards,
    });
    wireRunCreate();
    wireRunBulk();
    await Promise.all([renderDailyTable(), renderClassicTable(), renderRunsTable()]);
}
