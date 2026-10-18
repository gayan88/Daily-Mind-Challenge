import { escapeHtml, showToast } from '../utils/helpers.js';
import {
    DIFFICULTY_IDS, pictureFromFile, picturesFromText, puzzleToText, preparePuzzles,
    listDailyQuiltPuzzles, addDailyQuiltPuzzles, updateDailyQuiltPuzzle,
    listClassicQuiltPuzzles, addClassicQuiltPuzzles, updateClassicQuiltPuzzle,
    listQuiltTournaments, preparePatchwork, createQuiltTournament, createQuiltTournaments, setQuiltTournamentActive, deleteQuiltTournament,
} from './quilt-admin.js';
import { quiltPictureHtml } from '../games/quilt/quilt-summary-modal.js';
import { DIFFICULTIES } from '../games/quilt/quilt-generator.js';
import { pictureProblems } from '../games/quilt/quilt-picture.js';
// Same year > month (Daily) and difficulty (Classic) grouping as every other game's admin tables.
import {
    monthLabel, groupWordsByMonth, groupMonthsByYear, groupByDifficulty, DIFFICULTY_LABELS,
    wireCollapsibleToggles,
} from './admin-table-grouping.js';

const TEXT_EXAMPLE = `title: Cosy House
difficulty: medium
palette: #87ceeb #b22222 #f5deb3 #8b4513 #2e7d32
0000110000
0001111000
0011111100
0111111110
1111111111
0222222220
0233223320
0233223320
0222332220
4444334444`;

const FORMAT_HELP = `Give each picture as a <strong>PNG drawn at 1 pixel per cell</strong> (no smoothing, at most 8 colours; the file name becomes the title) or as text: <code>title:</code>, <code>difficulty:</code> and <code>palette:</code> lines, then one row of digits per grid row (each digit = a palette colour, first colour = 0). Separate pictures with a blank line. Sizes: Easy 7&times;7, Medium 10&times;10 (the Daily size), Hard 14&times;14 &mdash; any 5&ndash;20 per side works. Every picture is turned into a puzzle and checked to have exactly one solution before it can be added. Blocky shapes work best; lots of single-pixel detail makes fiddly puzzles.`;

function pictureInputHtml(prefix, { withDifficulty, defaultDifficulty }) {
    return `
        <div class="sudoku-puzzle-form">
            <div class="form-field">
                <label for="${prefix}-input">Picture(s) as text</label>
                <textarea id="${prefix}-input" rows="8" placeholder="${escapeHtml(TEXT_EXAMPLE)}"></textarea>
            </div>
            <div class="form-field">
                <label for="${prefix}-file">And/or upload PNG or .txt files</label>
                <input type="file" id="${prefix}-file" accept=".png,.gif,.webp,.txt,image/png,text/plain" multiple>
            </div>
            <div class="form-field" ${withDifficulty ? '' : 'hidden'}>
                <label for="${prefix}-difficulty">Difficulty (for pictures that don't set one)</label>
                <select id="${prefix}-difficulty">
                    ${DIFFICULTY_IDS.map((d) => `<option value="${d}" ${d === defaultDifficulty ? 'selected' : ''}>${DIFFICULTIES[d].label} (${DIFFICULTIES[d].size}&times;${DIFFICULTIES[d].size})</option>`).join('')}
                </select>
            </div>
            <div class="mod-search-row">
                <button class="btn primary" id="${prefix}-preview-btn" type="button">Preview</button>
                <button class="btn" id="${prefix}-export" type="button">Download</button>
            </div>
            <div id="${prefix}-preview"></div>
        </div>
    `;
}

const ADMIN_HTML = `
    <div class="section">
        <div class="section-title">Daily Puzzles</div>
        <div class="card">
            <p class="config-form-desc">Each puzzle is stored under the exact date it plays on. Add-only, and each new puzzle automatically gets the day right after the previous one. ${FORMAT_HELP}</p>
            <div class="form-field" id="qa-daily-start-field" hidden>
                <label for="qa-daily-start">Start date for Challenge #1</label>
                <input type="date" id="qa-daily-start">
            </div>
            ${pictureInputHtml('qa-daily', { withDifficulty: false, defaultDifficulty: 'medium' })}
            <div id="qa-daily-table"><div class="loading-text">Loading&hellip;</div></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Classic Puzzles</div>
        <div class="card">
            <p class="config-form-desc">Classic serves pictures a player hasn't solved yet first, from the chosen difficulty's pool. Hard puzzles automatically get knots (no single-cell pieces) and shape clues. ${FORMAT_HELP}</p>
            ${pictureInputHtml('qa-classic', { withDifficulty: true, defaultDifficulty: 'medium' })}
            <div id="qa-classic-table"><div class="loading-text">Loading&hellip;</div></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Global Configs</div>
        <div id="quilt-tournament-settings-form"><div class="loading-text">Loading&hellip;</div></div>
    </div>

    <div class="section">
        <div class="section-title">Patchwork Runs</div>
        <div class="card">
            <p class="config-form-desc">A run is one big picture cut into tiles; players solve each tile against the clock (time per tile is the Global Config above). A tile that runs out of time banks 10 points instead of 30 and the run carries on. Completing every tile adds the bonus below, plus 25 for a Perfect Patchwork. The picture's sides must divide evenly into the tile layout, with each tile 5&ndash;20 cells a side &mdash; e.g. a 20&times;20 picture as 2&times;2 tiles of 10&times;10.</p>
            <div id="qa-runs-table"><div class="loading-text">Loading&hellip;</div></div>
            <div class="tournament-form">
                <div class="form-field">
                    <label for="qa-run-name">Name</label>
                    <input type="text" id="qa-run-name" placeholder="e.g. Autumn Cottage">
                </div>
                <div class="form-field">
                    <label for="qa-run-input">Picture as text (or upload below)</label>
                    <textarea id="qa-run-input" rows="8" placeholder="title: ...&#10;palette: ...&#10;(digit rows)"></textarea>
                </div>
                <div class="form-field">
                    <label for="qa-run-file">Or upload a PNG / .txt</label>
                    <input type="file" id="qa-run-file" accept=".png,.gif,.webp,.txt,image/png,text/plain">
                </div>
                <div class="tournament-form-row">
                    <div class="form-field">
                        <label for="qa-run-layout">Tiles</label>
                        <select id="qa-run-layout">
                            <option value="2x2">2 &times; 2 (4 tiles)</option>
                            <option value="3x2">3 wide &times; 2 tall (6 tiles)</option>
                            <option value="3x3">3 &times; 3 (9 tiles)</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label for="qa-run-bonus">Completion bonus</label>
                        <input type="number" id="qa-run-bonus" value="100" min="0">
                    </div>
                </div>
                <div class="mod-search-row">
                    <button class="btn" id="qa-run-preview-btn" type="button">Preview Tiles</button>
                    <button class="btn primary" id="qa-run-create" type="button" disabled>Create Run</button>
                </div>
                <div id="qa-run-preview"></div>
            </div>
            <div class="tournament-form qa-bulk-runs">
                <div class="qa-bulk-title">Bulk import runs</div>
                <p class="config-form-desc">Upload a .txt with many pictures (blank line between them, e.g. <code>docs/quilt-content/test-patchwork-runs-100.txt</code>). One run is created per picture, named after its <code>title:</code>, all with the layout, bonus and status below. Tip: import as Inactive and activate a few at a time &mdash; every active run is listed to players.</p>
                <div class="form-field">
                    <label for="qa-bulk-file">Pictures file (.txt)</label>
                    <input type="file" id="qa-bulk-file" accept=".txt,text/plain">
                </div>
                <div class="tournament-form-row">
                    <div class="form-field">
                        <label for="qa-bulk-layout">Tiles</label>
                        <select id="qa-bulk-layout">
                            <option value="2x2">2 &times; 2 (4 tiles)</option>
                            <option value="3x2">3 wide &times; 2 tall (6 tiles)</option>
                            <option value="3x3">3 &times; 3 (9 tiles)</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label for="qa-bulk-bonus">Completion bonus (each)</label>
                        <input type="number" id="qa-bulk-bonus" value="100" min="0">
                    </div>
                    <div class="form-field">
                        <label for="qa-bulk-active">Start as</label>
                        <select id="qa-bulk-active">
                            <option value="inactive">Inactive</option>
                            <option value="active">Active</option>
                        </select>
                    </div>
                </div>
                <div class="mod-search-row">
                    <button class="btn" id="qa-bulk-preview-btn" type="button">Preview Runs</button>
                </div>
                <div id="qa-bulk-preview"></div>
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

/** Pictures from a textarea + any chosen files (PNG or .txt), in that order. */
async function collectPictures(textValue, files, difficulty) {
    const pictures = textValue.trim() ? picturesFromText(textValue, difficulty) : [];
    for (const file of files) {
        if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
            pictures.push(...picturesFromText(await file.text(), difficulty));
        } else {
            pictures.push({ ...(await pictureFromFile(file)), difficulty });
        }
    }
    return pictures;
}

function statsLine(puzzle) {
    const shapes = puzzle.clues.filter((c) => c.shape).length;
    return `${DIFFICULTIES[puzzle.difficulty].label} · ${puzzle.width}×${puzzle.height} · ${puzzle.rects.length} pieces${puzzle.blockers.length ? ` · ${puzzle.blockers.length} knots` : ''}${shapes ? ` · ${shapes} shape clues` : ''}`;
}

/** The picture thumbnail, or a placeholder when the picture itself is malformed (bad rows/palette). */
function safePictureHtml(picture, label) {
    if (!picture?.pixels?.length || pictureProblems(picture, { maxSize: 60 }).length) return '<div class="qa-preview-nopic">?</div>';
    return quiltPictureHtml(picture, label);
}

/** Preview cards for prepared puzzles; returns true when every picture is valid. */
function renderPreview(container, prepared) {
    const okCount = prepared.filter((p) => !p.error).length;
    container.innerHTML = `
        <div class="qa-preview-summary">${okCount} of ${prepared.length} picture${prepared.length === 1 ? '' : 's'} ready${okCount < prepared.length ? ' &mdash; fix the ones marked in red, then preview again' : ''}.</div>
        <div class="qa-preview-grid">
            ${prepared.map((p) => `
                <div class="qa-preview-card ${p.error ? 'qa-preview-bad' : ''}">
                    ${safePictureHtml(p.picture, p.label)}
                    <div class="qa-preview-title">${escapeHtml(p.label)}</div>
                    ${p.error ? `<div class="qa-preview-error">${escapeHtml(p.error)}</div>` : `<div class="qa-preview-meta">${escapeHtml(statsLine(p.puzzle))}</div>`}
                    ${p.warnings.map((w) => `<div class="qa-preview-warning">${escapeHtml(w)}</div>`).join('')}
                </div>
            `).join('')}
        </div>
    `;
    return okCount === prepared.length && prepared.length > 0;
}

/** Inline editor for one stored puzzle: its text form, regenerated on save. */
function wireEditRows(container, attr, findPuzzle, onSave) {
    container.querySelectorAll(`[${attr}]`).forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute(attr);
            const puzzle = findPuzzle(key);
            const editor = btn.closest('.cx-admin-row').querySelector('.cx-admin-editor');
            editor.hidden = false;
            editor.innerHTML = `
                <textarea rows="10">${escapeHtml(puzzleToText(puzzle))}</textarea>
                <div class="mod-search-row">
                    <button class="btn primary" data-save type="button">Save</button>
                    <button class="btn" data-cancel type="button">Cancel</button>
                </div>
                <div class="qa-edit-preview"></div>
            `;
            editor.querySelector('[data-cancel]').addEventListener('click', () => { editor.hidden = true; });
            editor.querySelector('[data-save]').addEventListener('click', async () => {
                try {
                    const pictures = picturesFromText(editor.querySelector('textarea').value, puzzle.difficulty);
                    if (pictures.length !== 1) throw new Error('Edit exactly one picture.');
                    const prepared = preparePuzzles(pictures);
                    if (!renderPreview(editor.querySelector('.qa-edit-preview'), prepared)) return;
                    await onSave(key, prepared[0]);
                    showToast('Puzzle saved');
                } catch (err) {
                    errorToast(err, "Couldn't save -- check Firestore rules are deployed");
                }
            });
        });
    });
}

function rowHtml(label, puzzle, editAttr, key) {
    return `
        <div class="cx-admin-row">
            <div class="sudoku-daily-row">
                <span class="qa-row-thumb">${quiltPictureHtml(puzzle, puzzle.title || 'Quilt')}</span>
                <span class="cx-admin-id">${label}</span>
                <span class="sudoku-daily-meta">${escapeHtml(`${puzzle.title || 'Untitled'} — ${statsLine(puzzle)}`)}</span>
                <button class="btn" ${editAttr}="${key}" type="button">Edit</button>
            </div>
            <div class="cx-admin-editor" hidden></div>
        </div>
    `;
}

async function renderDailyTable() {
    const container = $('qa-daily-table');
    let puzzles;
    try {
        puzzles = await listDailyQuiltPuzzles();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load daily puzzles &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }
    $('qa-daily-start-field').hidden = puzzles.length > 0;
    container._puzzles = puzzles;
    if (puzzles.length === 0) {
        container.innerHTML = `<div class="empty-state">No puzzles seeded yet. Pick a start date above and add pictures to activate the Daily Challenge.</div>`;
        return;
    }
    const yearGroups = groupMonthsByYear(groupWordsByMonth(puzzles));
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
                                ${monthPuzzles.map((p) => rowHtml(`#${p.challengeNumber ?? '?'} &middot; ${p.date}`, p, 'data-edit-qa-daily', p.date)).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
    wireCollapsibleToggles(container);
    wireEditRows(container, 'data-edit-qa-daily', (date) => puzzles.find((p) => p.date === date),
        async (date, prepared) => { await updateDailyQuiltPuzzle(date, prepared); renderDailyTable(); });
}

async function renderClassicTable() {
    const container = $('qa-classic-table');
    let puzzles;
    try {
        puzzles = await listClassicQuiltPuzzles();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load classic puzzles &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }
    container._puzzles = puzzles;
    if (puzzles.length === 0) {
        container.innerHTML = `<div class="empty-state">No Classic puzzles yet.</div>`;
        return;
    }
    const groups = groupByDifficulty(puzzles);
    container.innerHTML = Array.from(groups.entries()).map(([difficulty, group]) => `
        <div class="admin-subsection open" data-collapsible>
            <button class="admin-subsection-header" type="button">${DIFFICULTY_LABELS[difficulty]} (${group.length})</button>
            <div class="card">
                ${group.map((p) => rowHtml(`#${p.id}`, p, 'data-edit-qa-classic', p.id)).join('')}
            </div>
        </div>
    `).join('');
    wireCollapsibleToggles(container);
    wireEditRows(container, 'data-edit-qa-classic', (id) => puzzles.find((p) => String(p.id) === String(id)),
        async (id, prepared) => { await updateClassicQuiltPuzzle(id, prepared); renderClassicTable(); });
}

async function renderRunsTable() {
    const container = $('qa-runs-table');
    let runs;
    try {
        runs = await listQuiltTournaments();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load Patchwork Runs &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }
    if (runs.length === 0) {
        container.innerHTML = `<div class="empty-state">No Patchwork Runs yet. Create one below.</div>`;
        return;
    }
    container.innerHTML = runs.map((t) => `
        <div class="tournament-row">
            <span class="qa-row-thumb">${quiltPictureHtml(t, t.name)}</span>
            <span class="tournament-row-name">${escapeHtml(t.name)}</span>
            <span class="tournament-row-meta">${t.tiles.length} tiles (${t.cols}&times;${t.rows}) &bull; ${t.width}&times;${t.height} picture &bull; +${t.completionBonus || 0} bonus</span>
            <span class="status-pill ${t.active ? 'on' : ''}">${t.active ? 'Active' : 'Inactive'}</span>
            <div class="tournament-row-actions">
                <button class="btn" data-toggle-qa-run="${t.id}" data-active="${t.active}" type="button">${t.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn danger" data-delete-qa-run="${t.id}" type="button">Delete</button>
            </div>
        </div>
    `).join('');
    container.querySelectorAll('[data-toggle-qa-run]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await setQuiltTournamentActive(btn.dataset.toggleQaRun, btn.dataset.active !== 'true');
                renderRunsTable();
            } catch {
                showToast("Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
    container.querySelectorAll('[data-delete-qa-run]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm("Delete this Patchwork Run? Players' progress on it will be orphaned.")) return;
            try {
                await deleteQuiltTournament(btn.dataset.deleteQaRun);
                showToast('Patchwork Run deleted');
                renderRunsTable();
            } catch {
                showToast("Couldn't delete -- check Firestore rules are deployed");
            }
        });
    });
}

/**
 * Preview → Add flow shared by Daily and Classic: "Preview" generates every picture and shows a
 * card per picture; an "Add N" button appears only when all of them are valid.
 */
function wirePool(prefix, { addFn, onAdded, exportName, exportFn, startInput }) {
    $(`${prefix}-preview-btn`).addEventListener('click', async () => {
        const previewEl = $(`${prefix}-preview`);
        try {
            const pictures = await collectPictures($(`${prefix}-input`).value, Array.from($(`${prefix}-file`).files), $(`${prefix}-difficulty`).value);
            if (pictures.length === 0) { showToast('Paste a picture or choose files first'); return; }
            previewEl.innerHTML = `<div class="loading-text">Generating ${pictures.length} puzzle${pictures.length === 1 ? '' : 's'}&hellip;</div>`;
            await new Promise((r) => setTimeout(r, 30)); // let the loading text paint before the CPU work
            const prepared = preparePuzzles(pictures);
            const allOk = renderPreview(previewEl, prepared);
            if (!allOk) return;
            const addBtn = document.createElement('button');
            addBtn.className = 'btn primary';
            addBtn.type = 'button';
            addBtn.id = `${prefix}-add`;
            addBtn.textContent = `Add ${prepared.length} Puzzle${prepared.length === 1 ? '' : 's'}`;
            previewEl.appendChild(addBtn);
            addBtn.addEventListener('click', async () => {
                addBtn.disabled = true;
                try {
                    const result = await addFn(prepared, startInput?.value || undefined);
                    $(`${prefix}-input`).value = '';
                    $(`${prefix}-file`).value = '';
                    if (startInput) startInput.value = '';
                    previewEl.innerHTML = '';
                    showToast(`Added ${result.count} puzzle${result.count === 1 ? '' : 's'}${result.firstDate ? ` (${result.firstDate} → ${result.lastDate})` : ''}`);
                    onAdded();
                } catch (err) {
                    addBtn.disabled = false;
                    errorToast(err, "Couldn't add -- check Firestore rules are deployed");
                }
            });
        } catch (err) {
            previewEl.innerHTML = '';
            errorToast(err, "Couldn't read those pictures");
        }
    });
    $(`${prefix}-export`).addEventListener('click', () => {
        const puzzles = exportFn();
        if (puzzles.length === 0) { showToast('Nothing to download yet'); return; }
        downloadText(exportName, puzzles.map(puzzleToText).join('\n\n') + '\n');
    });
}

function wireRunCreate() {
    let patchwork = null;
    const createBtn = $('qa-run-create');
    const invalidate = () => { patchwork = null; createBtn.disabled = true; };
    ['qa-run-input', 'qa-run-file', 'qa-run-layout', 'qa-run-name'].forEach((id) => $(id).addEventListener('input', invalidate));
    $('qa-run-layout').addEventListener('change', invalidate);

    $('qa-run-preview-btn').addEventListener('click', async () => {
        const previewEl = $('qa-run-preview');
        invalidate();
        try {
            const pictures = await collectPictures($('qa-run-input').value, Array.from($('qa-run-file').files), 'medium');
            if (pictures.length !== 1) throw new Error(pictures.length ? 'A run uses exactly one picture.' : 'Paste a picture or choose a file first.');
            const [cols, rows] = $('qa-run-layout').value.split('x').map(Number);
            patchwork = preparePatchwork({ name: $('qa-run-name').value.trim(), picture: pictures[0], cols, rows });
            const tileW = patchwork.width / cols;
            const tileH = patchwork.height / rows;
            previewEl.innerHTML = `
                <div class="qa-preview-summary">${patchwork.tiles.length} tiles of ${tileW}&times;${tileH}, each checked to have exactly one solution.</div>
                <div class="qa-run-preview-pic" style="--qa-cols: ${cols}; --qa-rows: ${rows};">${quiltPictureHtml(patchwork, patchwork.title)}<span class="qa-run-grid"></span></div>
                <div class="qa-preview-meta">${patchwork.tiles.map((t, i) => `Tile ${i + 1}: ${t.rects.length} pieces`).join(' · ')}</div>
            `;
            createBtn.disabled = false;
        } catch (err) {
            previewEl.innerHTML = `<div class="qa-preview-error">${escapeHtml(err.message)}</div>`;
        }
    });

    createBtn.addEventListener('click', async () => {
        createBtn.disabled = true;
        try {
            await createQuiltTournament({ name: $('qa-run-name').value, patchwork, completionBonus: Number($('qa-run-bonus').value) });
            ['qa-run-name', 'qa-run-input', 'qa-run-file'].forEach((id) => { $(id).value = ''; });
            $('qa-run-preview').innerHTML = '';
            patchwork = null;
            showToast('Patchwork Run created');
            renderRunsTable();
        } catch (err) {
            createBtn.disabled = !patchwork;
            errorToast(err, "Couldn't create -- check Firestore rules are deployed");
        }
    });
}

/**
 * Bulk run import: one run per picture in an uploaded .txt, all with the same layout/bonus/status.
 * Preview builds every run (buildPatchwork) and shows a card each; "Create N Runs" appears only
 * when all of them cut cleanly.
 */
function wireRunBulk() {
    const previewEl = $('qa-bulk-preview');
    ['qa-bulk-file', 'qa-bulk-layout'].forEach((id) => $(id).addEventListener('change', () => { previewEl.innerHTML = ''; }));

    $('qa-bulk-preview-btn').addEventListener('click', async () => {
        const file = $('qa-bulk-file').files[0];
        if (!file) { showToast('Choose a .txt file first'); return; }
        const [cols, rows] = $('qa-bulk-layout').value.split('x').map(Number);
        let pictures;
        try {
            pictures = picturesFromText(await file.text(), 'medium');
        } catch (err) {
            errorToast(err, "Couldn't read that file");
            return;
        }
        if (pictures.length === 0) { showToast('No pictures found in that file'); return; }
        previewEl.innerHTML = `<div class="loading-text">Building ${pictures.length} run${pictures.length === 1 ? '' : 's'}&hellip;</div>`;
        await new Promise((r) => setTimeout(r, 30)); // let the loading text paint before the CPU work

        const built = pictures.map((picture, i) => {
            const name = picture.title || `Run ${i + 1}`;
            try {
                return { name, picture, patchwork: preparePatchwork({ name, picture, cols, rows }), error: null };
            } catch (err) {
                return { name, picture, patchwork: null, error: err.message };
            }
        });
        const okCount = built.filter((b) => !b.error).length;
        previewEl.innerHTML = `
            <div class="qa-preview-summary">${okCount} of ${built.length} run${built.length === 1 ? '' : 's'} ready (${cols}&times;${rows} tiles each)${okCount < built.length ? ' &mdash; fix or remove the ones marked in red, then preview again' : ''}.</div>
            <div class="qa-preview-grid">
                ${built.map((b) => `
                    <div class="qa-preview-card ${b.error ? 'qa-preview-bad' : ''}">
                        ${safePictureHtml(b.picture, b.name)}
                        <div class="qa-preview-title">${escapeHtml(b.name)}</div>
                        ${b.error ? `<div class="qa-preview-error">${escapeHtml(b.error)}</div>` : `<div class="qa-preview-meta">${b.patchwork.width}&times;${b.patchwork.height} &middot; ${b.patchwork.tiles.length} tiles</div>`}
                    </div>
                `).join('')}
            </div>
        `;
        if (okCount !== built.length) return;

        const active = $('qa-bulk-active').value === 'active';
        const createBtn = document.createElement('button');
        createBtn.className = 'btn primary';
        createBtn.type = 'button';
        createBtn.id = 'qa-bulk-create';
        createBtn.textContent = `Create ${built.length} Run${built.length === 1 ? '' : 's'} (${active ? 'active' : 'inactive'})`;
        previewEl.appendChild(createBtn);
        createBtn.addEventListener('click', async () => {
            createBtn.disabled = true;
            try {
                const result = await createQuiltTournaments(built.map(({ name, patchwork }) => ({ name, patchwork })), {
                    completionBonus: Number($('qa-bulk-bonus').value),
                    active: $('qa-bulk-active').value === 'active',
                });
                $('qa-bulk-file').value = '';
                previewEl.innerHTML = '';
                showToast(`Created ${result.count} Patchwork Run${result.count === 1 ? '' : 's'}`);
                renderRunsTable();
            } catch (err) {
                createBtn.disabled = false;
                errorToast(err, "Couldn't create -- check Firestore rules are deployed");
            }
        });
    });
}

/**
 * Renders the whole Quilt admin section into `#quilt-admin-root`. Called once by admin-page.js's
 * init(), which afterwards renders the `quiltTournamentSettings` config form into
 * `#quilt-tournament-settings-form` (inside this section, like Sudoku/Word Search's own settings).
 */
export async function initQuiltAdmin() {
    const root = $('quilt-admin-root');
    if (!root) return;
    root.innerHTML = ADMIN_HTML;
    wirePool('qa-daily', {
        addFn: addDailyQuiltPuzzles,
        onAdded: renderDailyTable,
        exportName: 'quilt-daily-puzzles.txt',
        exportFn: () => $('qa-daily-table')._puzzles || [],
        startInput: $('qa-daily-start'),
    });
    wirePool('qa-classic', {
        addFn: (prepared) => addClassicQuiltPuzzles(prepared),
        onAdded: renderClassicTable,
        exportName: 'quilt-classic-puzzles.txt',
        exportFn: () => $('qa-classic-table')._puzzles || [],
    });
    wireRunCreate();
    wireRunBulk();
    await Promise.all([renderDailyTable(), renderClassicTable(), renderRunsTable()]);
}
