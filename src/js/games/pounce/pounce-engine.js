import { icon } from '../../utils/icons.js';
import { escapeHtml } from '../../utils/helpers.js';
import { regionGrid, neighbours } from './pounce-solver.js';
import { analyse, nextStep, UNKNOWN, CAT, NOT } from './pounce-logic.js';
import { catSvg, boardCoats } from './pounce-cats.js';

/**
 * Region colours: muted "blankets and cushions", all distinct (boards have ≤ 10 regions), with
 * thick charcoal borders between regions so the board reads without relying on colour. `name` is
 * what Whisker Tips call the region ("the sage region").
 */
export const REGION_COLOURS = [
    { name: 'peach', colour: '#F9C9A6' },
    { name: 'sage', colour: '#C5DDB0' },
    { name: 'lavender', colour: '#D3C6EE' },
    { name: 'butter', colour: '#F6E3A1' },
    { name: 'sky', colour: '#B9D9F0' },
    { name: 'rose', colour: '#F2B9C4' },
    { name: 'mint', colour: '#A9E0D2' },
    { name: 'sand', colour: '#E4D3BD' },
    { name: 'plum', colour: '#CFA0C8' },
    { name: 'slate', colour: '#C9CED8' },
];

const LONG_PRESS_MS = 450;
const HISS_MS = 420;
const FINISH_DELAY_MS = 1700;
const TIP_HIGHLIGHT_MS = 4500;

function formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

const PAW_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="9" cy="15" r="4.5"/><circle cx="16" cy="8" r="4.5"/><circle cx="24" cy="8" r="4.5"/><circle cx="31" cy="15" r="4.5"/><path d="M20 17c-7 0-12 6-12 11.5C8 33 11.5 35 15 35c2 0 3.2-1 5-1s3 1 5 1c3.5 0 7-2 7-6.5C32 23 27 17 20 17z"/></svg>';

/**
 * A non-interactive board as an HTML string (same `pn-` look as a live round): regions, dogs,
 * pawprints and -- with `cats: true` -- the solution's cats asleep. Used by the already-played
 * Daily view and the How to Play example. `className` adds a class to the board.
 */
export function staticBoardHtml(puzzle, { cats = true, label = 'Pounce board', className = '', seed = '' } = {}) {
    const { size: n, solution = [], dogs = [], pawprints = [] } = puzzle;
    const region = regionGrid(puzzle);
    const coats = boardCoats(n, seed || puzzle.regions.join(''));
    const dogAt = new Set(dogs.map((d) => d.y * n + d.x));
    const pawAt = new Map(pawprints.map((p) => [p.y * n + p.x, p.n]));
    let cells = '';
    for (let idx = 0; idx < n * n; idx++) {
        const x = idx % n;
        const y = (idx - x) / n;
        const classes = ['pn-cell', 'pn-fixed'];
        if (x < n - 1 && region[idx + 1] !== region[idx]) classes.push('pn-br');
        if (y < n - 1 && region[idx + n] !== region[idx]) classes.push('pn-bb');
        if (x === n - 1) classes.push('pn-last-col');
        if (y === n - 1) classes.push('pn-last-row');
        let inner = '';
        if (dogAt.has(idx)) inner = '<span class="pn-dog">🐶<span class="pn-dog-z">z</span></span>';
        else if (pawAt.has(idx)) inner = `<span class="pn-paw">${PAW_SVG}<span class="pn-paw-n">${pawAt.get(idx)}</span></span>`;
        else if (cats && solution[y] === x) inner = `<span class="pn-cat">${catSvg({ coat: coats[y], eyes: 'sleepy' })}</span>`;
        cells += `<div class="${classes.join(' ')}" style="--pn-region: ${REGION_COLOURS[region[idx]].colour};">${inner}</div>`;
    }
    return `<div class="pn-board pn-static ${escapeHtml(className)}" style="--pn-n: ${n};" role="img" aria-label="${escapeHtml(label)}">${cells}</div>`;
}

/**
 * Mounts a playable Pounce round into `container`. `puzzle` is the stored shape from
 * pounce-generator.js (`{ size, regions, solution, dogs, pawprints }`).
 *
 * Modes (`mode`): 'daily' / 'classic' (stopwatch from the first touch, mistakes and tips counted),
 * 'run' (Nine Lives Run: countdown `timeLimitSeconds` from mount, a wrong cat costs one of
 * `lives`; 0 lives or time up ends the round as a loss) and 'zen' (no clock, nothing counted,
 * free tips).
 *
 * Controls: tap cycles empty → ✕ → cat; long-press (or the "Tap places 🐱" toggle) places a cat
 * straight away; dragging paints ✕ over empty cells (or erases ✕ when the drag starts on one).
 * Keyboard: arrows move, Space cycles, Enter places a cat, X toggles ✕, Ctrl/⌘+Z undoes.
 * A cat is checked against the solution as soon as it lands: a right one stays (and locks); a
 * wrong one hisses, hops off, becomes ✕ and counts as a mistake. "Auto-✕" (off by default) crosses
 * out the cells a new cat rules out -- allowed with Purrfect, since it only saves taps.
 *
 * Whisker Tip: first clears a ✕ the player put on a cat's real spot (if any); otherwise applies
 * pounce-logic.js's easiest next deduction, highlights its cells and shows its sentence.
 *
 * On the end of a round `onComplete({ won, timedOut, outOfLives, timeTakenSeconds, mistakes,
 * tips, perfect, livesLeft })` fires once, FINISH_DELAY_MS later so the curl-up / reveal is seen.
 * Purrfect = a win with no mistakes and no tips (never in Zen). The engine has no Firebase/session
 * knowledge; the mode data files own scoring. `sound` (default off) plays tiny synth chirps.
 */
export function playPounceRound({
    container, puzzle, mode = 'daily', timeLimitSeconds = null, lives = null, roundLabel = null,
    seed = '', sound = false, onComplete,
}) {
    const { size: n, solution, dogs = [], pawprints = [] } = puzzle;
    const zen = mode === 'zen';
    const run = mode === 'run';
    const region = regionGrid(puzzle);
    const coats = boardCoats(n, seed || puzzle.regions.join(''));
    const names = REGION_COLOURS.map((c) => c.name);
    const logic = analyse(puzzle, { regionNames: names });
    const isSolution = new Uint8Array(n * n);
    solution.forEach((x, y) => { isSolution[y * n + x] = 1; });
    const fixed = new Map();
    dogs.forEach((d) => fixed.set(d.y * n + d.x, { kind: 'dog' }));
    pawprints.forEach((p) => fixed.set(p.y * n + p.x, { kind: 'paw', n: p.n }));

    const marks = new Int8Array(n * n);
    fixed.forEach((_, idx) => { marks[idx] = NOT; });

    container.innerHTML = `
        <div class="pn-stats">
            ${roundLabel ? `<span class="pn-stat pn-round-label">${escapeHtml(roundLabel)}</span>` : ''}
            ${zen ? '' : `<span class="pn-stat">
                <span class="pn-stat-icon">${icon('STOPWATCH')}</span>
                <span class="pn-stat-label">Time</span>
                <span class="pn-stat-value" data-pn-time>${timeLimitSeconds ? formatClock(timeLimitSeconds) : '0:00'}</span>
            </span>`}
            <span class="pn-stat">
                <span class="pn-stat-icon" aria-hidden="true">🐱</span>
                <span class="pn-stat-label">Cats</span>
                <span class="pn-stat-value" data-pn-cats>0/${n}</span>
            </span>
            ${run ? `<span class="pn-stat">
                <span class="pn-stat-icon" aria-hidden="true">🐾</span>
                <span class="pn-stat-label">Lives</span>
                <span class="pn-stat-value" data-pn-lives>${lives}</span>
            </span>` : ''}
            ${zen || run ? '' : `<span class="pn-stat">
                <span class="pn-stat-icon" aria-hidden="true">😾</span>
                <span class="pn-stat-label">Hisses</span>
                <span class="pn-stat-value" data-pn-mistakes>0</span>
            </span>`}
            ${zen ? '' : `<span class="pn-stat">
                <span class="pn-stat-icon" aria-hidden="true">💡</span>
                <span class="pn-stat-label">Tips</span>
                <span class="pn-stat-value" data-pn-tips>0</span>
            </span>`}
        </div>
        <div class="pn-board" role="grid" style="--pn-n: ${n};"
             aria-label="Pounce board, ${n} by ${n}. Place one cat in every row, column and colour region; cats can't touch, not even diagonally."></div>
        <div class="pn-tip" aria-live="polite" hidden>
            <span class="pn-tip-icon" aria-hidden="true">💡</span>
            <span class="pn-tip-text"></span>
        </div>
        <div class="pn-message" aria-live="polite"></div>
        <div class="pn-controls">
            <button type="button" class="pn-control-btn pn-tip-btn" data-pn-tip>💡 Whisker Tip</button>
            <button type="button" class="pn-control-btn" data-pn-undo disabled>${icon('UNDO')} Undo</button>
            <button type="button" class="pn-control-btn" data-pn-clear disabled>Clear ✕</button>
        </div>
        <div class="pn-options">
            <label class="pn-toggle"><input type="checkbox" data-pn-catpen> Tap places 🐱</label>
            <label class="pn-toggle"><input type="checkbox" data-pn-autox> Auto-✕</label>
        </div>
    `;

    const boardEl = container.querySelector('.pn-board');
    const tipEl = container.querySelector('.pn-tip');
    const tipTextEl = container.querySelector('.pn-tip-text');
    const messageEl = container.querySelector('.pn-message');
    const timeEl = container.querySelector('[data-pn-time]');
    const catsEl = container.querySelector('[data-pn-cats]');
    const livesEl = container.querySelector('[data-pn-lives]');
    const mistakesEl = container.querySelector('[data-pn-mistakes]');
    const tipsEl = container.querySelector('[data-pn-tips]');
    const tipBtn = container.querySelector('[data-pn-tip]');
    const undoBtn = container.querySelector('[data-pn-undo]');
    const clearBtn = container.querySelector('[data-pn-clear]');
    const catPenEl = container.querySelector('[data-pn-catpen]');
    const autoXEl = container.querySelector('[data-pn-autox]');

    // Cells: rows use `display: contents` so the board is one CSS grid but still has ARIA rows.
    const cellEls = [];
    for (let y = 0; y < n; y++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'pn-row';
        rowEl.setAttribute('role', 'row');
        for (let x = 0; x < n; x++) {
            const idx = y * n + x;
            const el = document.createElement('div');
            el.className = 'pn-cell';
            el.setAttribute('role', 'gridcell');
            el.dataset.idx = String(idx);
            el.tabIndex = idx === 0 ? 0 : -1;
            el.style.setProperty('--pn-region', REGION_COLOURS[region[idx]].colour);
            if (x < n - 1 && region[idx + 1] !== region[idx]) el.classList.add('pn-br');
            if (y < n - 1 && region[idx + n] !== region[idx]) el.classList.add('pn-bb');
            if (x === n - 1) el.classList.add('pn-last-col');
            if (y === n - 1) el.classList.add('pn-last-row');
            if (fixed.has(idx)) el.classList.add('pn-fixed');
            rowEl.appendChild(el);
            cellEls.push(el);
        }
        boardEl.appendChild(rowEl);
    }

    let catCount = 0;
    let mistakes = 0;
    let tips = 0;
    let livesLeft = lives;
    let gameOver = false;
    let won = false;
    let revealed = false;
    let elapsedSeconds = 0;
    let timerInterval = null;
    let press = null;
    let focusIdx = 0;
    let highlight = [];
    let highlightTimer = null;
    const history = [];
    const animate = new Map();
    const hissing = new Set();
    const pendingTimeouts = new Set();

    const later = (fn, ms) => {
        const id = setTimeout(() => { pendingTimeouts.delete(id); fn(); }, ms);
        pendingTimeouts.add(id);
        return id;
    };

    const resizeObserver = new ResizeObserver(() => {
        boardEl.style.setProperty('--pn-cell', `${boardEl.clientWidth / n}px`);
    });
    resizeObserver.observe(boardEl);

    // ---- Rendering -----------------------------------------------------------------------------

    function cellLabel(idx) {
        const x = idx % n;
        const y = (idx - x) / n;
        const f = fixed.get(idx);
        let what = 'empty';
        if (f?.kind === 'dog') what = 'sleeping dog, no cat here';
        else if (f?.kind === 'paw') what = `pawprint ${f.n}: touches ${f.n} cat${f.n === 1 ? '' : 's'}`;
        else if (marks[idx] === CAT) what = 'cat';
        else if (marks[idx] === NOT) what = 'crossed out';
        return `Row ${y + 1}, column ${x + 1}, ${names[region[idx]]} region, ${what}`;
    }

    function renderCell(idx) {
        const el = cellEls[idx];
        const y = Math.floor(idx / n);
        const f = fixed.get(idx);
        let html = '';
        if (f?.kind === 'dog') {
            html = '<span class="pn-dog" aria-hidden="true">🐶<span class="pn-dog-z">z</span></span>';
        } else if (f?.kind === 'paw') {
            html = `<span class="pn-paw" aria-hidden="true">${PAW_SVG}<span class="pn-paw-n">${f.n}</span></span>`;
        } else if (marks[idx] === CAT || hissing.has(idx) || (revealed && isSolution[idx])) {
            const anim = hissing.has(idx) ? 'pn-hiss' : (animate.get(idx) === 'pounce' ? 'pn-pounce' : '');
            const ghost = revealed && marks[idx] !== CAT ? ' pn-ghost' : '';
            const delay = won ? ` style="--pn-delay: ${Math.round(((idx % n) + y) * 60)}ms"` : '';
            html = `<span class="pn-cat ${anim}${ghost}"${delay}>${catSvg({ coat: coats[y], eyes: won ? 'sleepy' : 'smug' })}</span>`;
            if (won) html += `<span class="pn-zzz" aria-hidden="true"${delay}>z</span>`;
        } else if (marks[idx] === NOT) {
            html = '<span class="pn-xmark" aria-hidden="true">✕</span>';
        }
        el.innerHTML = html;
        el.setAttribute('aria-label', cellLabel(idx));
        el.classList.toggle('pn-hl', highlight.includes(idx));
        animate.delete(idx);
    }

    function render() {
        for (let idx = 0; idx < n * n; idx++) renderCell(idx);
        renderStats();
    }

    function renderStats() {
        catsEl.textContent = `${catCount}/${n}`;
        if (mistakesEl) mistakesEl.textContent = String(mistakes);
        if (tipsEl) tipsEl.textContent = String(tips);
        if (livesEl) livesEl.textContent = String(livesLeft);
        undoBtn.disabled = gameOver || history.length === 0;
        clearBtn.disabled = gameOver || !marks.some((v, idx) => v === NOT && !fixed.has(idx));
        tipBtn.disabled = gameOver;
    }

    // ---- State changes -------------------------------------------------------------------------

    function snapshot() {
        history.push({ marks: Int8Array.from(marks), catCount });
        if (history.length > 200) history.shift();
    }

    function clearHighlight() {
        if (highlightTimer) clearTimeout(highlightTimer);
        highlightTimer = null;
        const old = highlight;
        highlight = [];
        old.forEach((idx) => cellEls[idx].classList.remove('pn-hl'));
    }

    function setHighlight(cells) {
        clearHighlight();
        highlight = cells;
        cells.forEach((idx) => cellEls[idx].classList.add('pn-hl'));
        highlightTimer = setTimeout(clearHighlight, TIP_HIGHLIGHT_MS);
    }

    function ruledOutBy(idx) {
        const x = idx % n;
        const y = (idx - x) / n;
        const out = new Set(neighbours(n, idx));
        for (let i = 0; i < n; i++) { out.add(y * n + i); out.add(i * n + x); }
        for (let i = 0; i < n * n; i++) if (region[i] === region[idx]) out.add(i);
        out.delete(idx);
        return [...out];
    }

    /** Puts a known-correct cat on `idx` (from a tap, a tip or the keyboard). */
    function landCat(idx) {
        marks[idx] = CAT;
        catCount++;
        animate.set(idx, 'pounce');
        chirp('place');
        if (autoXEl.checked) {
            ruledOutBy(idx).forEach((c) => { if (marks[c] === UNKNOWN) { marks[c] = NOT; renderCell(c); } });
        }
        renderCell(idx);
    }

    function placeCat(idx) {
        if (gameOver || fixed.has(idx) || marks[idx] === CAT) return;
        startTimer();
        snapshot();
        hideTip();
        if (isSolution[idx]) {
            landCat(idx);
            messageEl.textContent = '';
            renderStats();
            if (catCount === n) finish(true);
            return;
        }
        // Wrong spot: hiss, hop off, leave a ✕ behind.
        marks[idx] = NOT;
        hissing.add(idx);
        chirp('hiss');
        if (!zen) {
            if (run) livesLeft = Math.max(0, livesLeft - 1);
            else mistakes++;
        }
        messageEl.textContent = zen ? 'That spot\'s taken. Try another!' : 'Hiss! That spot\'s taken.';
        cellEls[idx].classList.add('pn-wrong');
        renderCell(idx);
        renderStats();
        later(() => {
            hissing.delete(idx);
            cellEls[idx].classList.remove('pn-wrong');
            renderCell(idx);
        }, HISS_MS);
        if (run && livesLeft <= 0) finish(false, { outOfLives: true });
    }

    function setMark(idx, value) {
        if (fixed.has(idx) || marks[idx] === CAT || marks[idx] === value) return false;
        marks[idx] = value;
        renderCell(idx);
        return true;
    }

    function tap(idx) {
        if (gameOver || fixed.has(idx)) return;
        startTimer();
        if (marks[idx] === CAT) return;
        if (catPenEl.checked || marks[idx] === NOT) { placeCat(idx); return; }
        snapshot();
        hideTip();
        setMark(idx, NOT);
        renderStats();
    }

    function toggleX(idx) {
        if (gameOver || fixed.has(idx) || marks[idx] === CAT) return;
        startTimer();
        snapshot();
        setMark(idx, marks[idx] === NOT ? UNKNOWN : NOT);
        renderStats();
    }

    function undo() {
        if (gameOver || history.length === 0) return;
        const prev = history.pop();
        marks.set(prev.marks);
        catCount = prev.catCount;
        hideTip();
        messageEl.textContent = '';
        render();
    }

    function clearMarks() {
        if (gameOver) return;
        snapshot();
        for (let idx = 0; idx < n * n; idx++) if (marks[idx] === NOT && !fixed.has(idx)) marks[idx] = UNKNOWN;
        hideTip();
        render();
    }

    // ---- Whisker Tips --------------------------------------------------------------------------

    function showTip(cells, text) {
        tipTextEl.textContent = text;
        tipEl.hidden = false;
        setHighlight(cells);
    }

    function hideTip() {
        tipEl.hidden = true;
        clearHighlight();
    }

    function giveTip() {
        if (gameOver) return;
        startTimer();
        snapshot();
        if (!zen) tips++;
        messageEl.textContent = '';

        const wrongX = solution.map((x, y) => y * n + x).find((idx) => marks[idx] === NOT);
        if (wrongX !== undefined) {
            marks[wrongX] = UNKNOWN;
            renderCell(wrongX);
            showTip([wrongX], 'One of your ✕ marks is on a spot where a cat belongs, so it\'s been cleared. Take another look there.');
            renderStats();
            return;
        }
        const step = nextStep(logic, Int8Array.from(marks));
        if (!step) {
            // Shouldn't happen for generated puzzles (they're logic-solvable); never leave the
            // player stuck.
            const idx = solution.map((x, y) => y * n + x).find((i) => marks[i] !== CAT);
            if (idx !== undefined) {
                landCat(idx);
                showTip([idx], 'Here\'s a free cat to get you going.');
            }
        } else {
            step.eliminate.forEach((idx) => setMark(idx, NOT));
            step.place.forEach((idx) => { if (marks[idx] !== CAT) landCat(idx); });
            showTip(step.cells, step.text);
        }
        renderStats();
        if (catCount === n) finish(true);
    }

    // ---- Pointer input -------------------------------------------------------------------------

    function cellAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY)?.closest('.pn-cell');
        return el && boardEl.contains(el) ? Number(el.dataset.idx) : -1;
    }

    function onPointerDown(e) {
        if (gameOver || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const idx = cellAt(e.clientX, e.clientY);
        if (idx < 0) return;
        e.preventDefault();
        boardEl.setPointerCapture(e.pointerId);
        moveFocus(idx, false);
        press = { id: e.pointerId, idx, painting: false, paintValue: marks[idx] === NOT ? UNKNOWN : NOT, long: false, timer: null };
        press.timer = setTimeout(() => {
            if (!press || press.painting) return;
            press.long = true;
            if (navigator.vibrate) navigator.vibrate(15);
            placeCat(press.idx);
        }, LONG_PRESS_MS);
    }

    function onPointerMove(e) {
        if (!press || e.pointerId !== press.id || press.long) return;
        const idx = cellAt(e.clientX, e.clientY);
        if (idx < 0 || (idx === press.idx && !press.painting)) return;
        if (!press.painting) {
            // First move onto another cell: this is a ✕-painting drag, not a tap.
            clearTimeout(press.timer);
            press.painting = true;
            startTimer();
            snapshot();
            hideTip();
            setMark(press.idx, press.paintValue);
        }
        setMark(idx, press.paintValue);
        renderStats();
    }

    function onPointerUp(e) {
        if (!press || e.pointerId !== press.id) return;
        clearTimeout(press.timer);
        const { idx, painting, long } = press;
        press = null;
        if (!painting && !long) tap(idx);
    }

    function onPointerCancel(e) {
        if (!press || e.pointerId !== press.id) return;
        clearTimeout(press.timer);
        press = null;
    }

    // ---- Keyboard ------------------------------------------------------------------------------

    function moveFocus(idx, focus = true) {
        cellEls[focusIdx].tabIndex = -1;
        focusIdx = idx;
        cellEls[idx].tabIndex = 0;
        if (focus) cellEls[idx].focus();
    }

    function onKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
            return;
        }
        if (!boardEl.contains(document.activeElement)) return;
        const x = focusIdx % n;
        const y = (focusIdx - x) / n;
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (moves[e.key]) {
            e.preventDefault();
            const [dx, dy] = moves[e.key];
            const nx = Math.max(0, Math.min(n - 1, x + dx));
            const ny = Math.max(0, Math.min(n - 1, y + dy));
            moveFocus(ny * n + nx);
        } else if (e.key === ' ') {
            e.preventDefault();
            tap(focusIdx);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            placeCat(focusIdx);
        } else if (e.key.toLowerCase() === 'x') {
            e.preventDefault();
            toggleX(focusIdx);
        }
    }

    // ---- Sound (off by default) -----------------------------------------------------------------

    let audio = null;
    function chirp(kind) {
        if (!sound) return;
        try {
            audio ??= new (window.AudioContext || window.webkitAudioContext)();
            const notes = { place: [[520, 0], [780, 0.07]], hiss: [[160, 0]], solve: [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]] }[kind];
            notes.forEach(([freq, at]) => {
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                osc.type = kind === 'hiss' ? 'sawtooth' : 'triangle';
                osc.frequency.value = freq;
                const t = audio.currentTime + at;
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(kind === 'hiss' ? 0.05 : 0.12, t + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hiss' ? 0.3 : 0.18));
                osc.connect(gain).connect(audio.destination);
                osc.start(t);
                osc.stop(t + 0.35);
            });
        } catch {
            // Audio is a nicety; ignore browsers that block it.
        }
    }

    // ---- Lifecycle -----------------------------------------------------------------------------

    boardEl.addEventListener('pointerdown', onPointerDown);
    boardEl.addEventListener('pointermove', onPointerMove);
    boardEl.addEventListener('pointerup', onPointerUp);
    boardEl.addEventListener('pointercancel', onPointerCancel);
    boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
    container.addEventListener('keydown', onKeydown);
    tipBtn.addEventListener('click', giveTip);
    undoBtn.addEventListener('click', undo);
    clearBtn.addEventListener('click', clearMarks);

    function cleanup() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        if (press) clearTimeout(press.timer);
        press = null;
        clearHighlight();
        pendingTimeouts.forEach((id) => clearTimeout(id));
        pendingTimeouts.clear();
        resizeObserver.disconnect();
        boardEl.removeEventListener('pointerdown', onPointerDown);
        boardEl.removeEventListener('pointermove', onPointerMove);
        boardEl.removeEventListener('pointerup', onPointerUp);
        boardEl.removeEventListener('pointercancel', onPointerCancel);
        container.removeEventListener('keydown', onKeydown);
        if (audio) audio.close().catch(() => {});
    }

    function finish(didWin, { timedOut = false, outOfLives = false } = {}) {
        if (gameOver) return;
        gameOver = true;
        won = didWin;
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        if (press) clearTimeout(press.timer);
        press = null;
        hideTip();

        const perfect = didWin && !zen && mistakes === 0 && tips === 0;
        if (didWin) {
            messageEl.textContent = perfect ? 'Purrfect! Every cat found its spot. \u{2728}' : 'Every cat found its spot.';
            boardEl.classList.add('pn-solved');
            chirp('solve');
        } else {
            revealed = true;
            messageEl.textContent = timedOut
                ? 'Time\'s up! Here\'s where the cats wanted to nap.'
                : 'Out of lives! Here\'s where the cats wanted to nap.';
            boardEl.classList.add('pn-failed');
        }
        render();
        container.querySelector('.pn-options').classList.add('pn-options-done');

        const result = { won: didWin, timedOut, outOfLives, timeTakenSeconds: elapsedSeconds, mistakes, tips, perfect, livesLeft };
        later(() => onComplete?.(result), FINISH_DELAY_MS);
    }

    function tick() {
        elapsedSeconds += 1;
        if (!timeEl) return;
        if (timeLimitSeconds != null) {
            const remaining = timeLimitSeconds - elapsedSeconds;
            if (remaining <= 0) {
                timeEl.textContent = formatClock(0);
                finish(false, { timedOut: true });
                return;
            }
            timeEl.textContent = formatClock(remaining);
            timeEl.classList.toggle('urgent', remaining <= 30);
        } else {
            timeEl.textContent = formatClock(elapsedSeconds);
        }
    }

    function startTimer() {
        if (timerInterval || gameOver || zen) return;
        timerInterval = setInterval(tick, 1000);
    }

    // The Run's countdown starts at mount (a real time-attack limit); Daily/Classic's stopwatch
    // starts on the first touch of the board; Zen has no clock.
    if (timeLimitSeconds != null && !zen) startTimer();
    render();

    // Bring the whole round (stats bar → options) into view on mount, as quilt-engine.js does:
    // the board blocks touch scrolling (drags paint ✕), and on a phone it fills the width.
    requestAnimationFrame(() => {
        const top = container.querySelector('.pn-stats').getBoundingClientRect().top;
        const bottom = container.querySelector('.pn-options').getBoundingClientRect().bottom;
        if (top >= 0 && bottom <= window.innerHeight) return;
        const fits = bottom - top + 16 <= window.innerHeight;
        window.scrollBy({ top: fits ? bottom - window.innerHeight + 8 : top - 8, behavior: 'smooth' });
    });

    return {
        destroy: cleanup,
    };
}
