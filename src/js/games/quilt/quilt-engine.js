import { icon } from '../../utils/icons.js';
import { escapeHtml } from '../../utils/helpers.js';
import { checkBoard } from './quilt-solver.js';

// Soft "fabric" tints for rectangles while the round is in play. The real picture colours are
// only applied once the board is solved -- showing them per rectangle would let a player spot a
// wrong rectangle by its colour instead of by logic.
const PLAY_TINTS = ['#E8E4F8', '#FDE7D9', '#DFF3EA', '#FDF3C8', '#E3EEFC', '#F8E1EC'];
const REVEAL_DELAY_MS = 1800;

function formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function pct(value, total) {
    return `${(value / total) * 100}%`;
}

function normalise(ax, ay, bx, by) {
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) + 1, h: Math.abs(ay - by) + 1 };
}

function overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function containsCell(r, x, y) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Mounts a playable Quilt round into `container`. `puzzle` is the stored shape from
 * quilt-generator.js (`{ width, height, palette, pixels, clues, blockers, rects }`) -- `rects` (the
 * answer) is only used to show the solution after a Tournament timeout; a win is decided by
 * quilt-solver.js#checkBoard against the rules, not by comparing with `rects`.
 *
 * Controls: drag from one corner to the opposite corner to draw a rectangle (pointer events, so
 * mouse, touch and pen all work; the board sets `touch-action: none` so a drag doesn't scroll the
 * page). Drawing over existing rectangles replaces them. Tapping a single empty cell places a 1×1;
 * tapping a placed rectangle removes it. Undo button / Ctrl+Z (⌘Z) steps back; Clear removes all.
 * While dragging, a label shows the size ("3×2 = 6"). Rectangles that break a rule (no number, two
 * numbers, wrong area, wrong shape) are outlined red straight away.
 *
 * Perfect Stitch: a win with no undo and no rectangle ever removed (tap-remove, replace-by-overlap
 * or Clear all count as removals).
 *
 * Stats bar: Time (stopwatch starting on the first touch of the board -- same reasoning as
 * sudoku-engine.js; or, with `timeLimitSeconds` (Tournament), a countdown starting at mount whose
 * expiry ends the round as a loss) and Pieces (placed / needed). `roundLabel` is optional text such
 * as "Tile 2 of 4" (Tournament).
 *
 * On the end of a round the picture is revealed (solved: the player's rectangles take their real
 * colours; timed out: the answer is shown, greyed) and `onComplete({ won, timedOut,
 * timeTakenSeconds, undos, removals, perfect, pieces })` fires once, `REVEAL_DELAY_MS` later so the
 * reveal animation is seen before the page opens its summary modal.
 * The engine has no Firebase/session knowledge; the mode data files own scoring.
 */
export function playQuiltRound({ container, puzzle, timeLimitSeconds = null, roundLabel = null, onComplete }) {
    const { width, height, palette, pixels, clues, blockers = [] } = puzzle;

    container.innerHTML = `
        <div class="qt-stats">
            ${roundLabel ? `<span class="qt-stat qt-round-label">${escapeHtml(roundLabel)}</span>` : ''}
            <span class="qt-stat">
                <span class="qt-stat-icon">${icon('STOPWATCH')}</span>
                <span class="qt-stat-label">Time</span>
                <span class="qt-stat-value" data-qt-time>${timeLimitSeconds ? formatClock(timeLimitSeconds) : '0:00'}</span>
            </span>
            <span class="qt-stat">
                <span class="qt-stat-icon">${icon('THREAD')}</span>
                <span class="qt-stat-label">Pieces</span>
                <span class="qt-stat-value" data-qt-pieces>0/${clues.length}</span>
            </span>
        </div>
        <div class="qt-board" tabindex="0" role="application"
             aria-label="Quilt board, ${width} by ${height}. Drag to draw rectangles; each must contain one number equal to its area."
             style="--qt-cols: ${width}; --qt-rows: ${height};">
            <div class="qt-rects"></div>
            <div class="qt-knots"></div>
            <div class="qt-preview" hidden><span class="qt-preview-label"></span></div>
            <div class="qt-clues"></div>
        </div>
        <div class="qt-message" aria-live="polite"></div>
        <div class="qt-controls">
            <button type="button" class="qt-control-btn" data-qt-undo disabled>${icon('UNDO')} Undo</button>
            <button type="button" class="qt-control-btn" data-qt-clear disabled>Clear</button>
        </div>
    `;

    const boardEl = container.querySelector('.qt-board');
    const rectsEl = container.querySelector('.qt-rects');
    const knotsEl = container.querySelector('.qt-knots');
    const previewEl = container.querySelector('.qt-preview');
    const previewLabelEl = container.querySelector('.qt-preview-label');
    const cluesEl = container.querySelector('.qt-clues');
    const messageEl = container.querySelector('.qt-message');
    const timeEl = container.querySelector('[data-qt-time]');
    const piecesEl = container.querySelector('[data-qt-pieces]');
    const undoBtn = container.querySelector('[data-qt-undo]');
    const clearBtn = container.querySelector('[data-qt-clear]');

    const blockedAt = new Set(blockers.map((b) => `${b.x},${b.y}`));
    let rects = [];
    const history = [];
    let undos = 0;
    let removals = 0;
    let gameOver = false;
    let elapsedSeconds = 0;
    let timerInterval = null;
    let drag = null;
    const pendingTimeouts = new Set();

    const place = (el, r) => {
        el.style.left = pct(r.x, width);
        el.style.top = pct(r.y, height);
        el.style.width = pct(r.w, width);
        el.style.height = pct(r.h, height);
    };

    // Static layers: clue numbers (with Hard-mode shape badges) and blocker knots.
    clues.forEach((c) => {
        const el = document.createElement('span');
        el.className = 'qt-clue';
        if (c.shape) el.classList.add(`qt-clue-${c.shape}`);
        el.textContent = String(c.n);
        if (c.shape) el.title = c.shape === 'square' ? 'Must be a square' : 'Must be a single row or column';
        place(el, { x: c.x, y: c.y, w: 1, h: 1 });
        cluesEl.appendChild(el);
    });
    blockers.forEach((b) => {
        const el = document.createElement('span');
        el.className = 'qt-knot';
        el.dataset.colour = palette[Number(pixels[b.y][b.x])];
        el.title = 'Knot: no rectangle can cover this cell';
        place(el, { x: b.x, y: b.y, w: 1, h: 1 });
        knotsEl.appendChild(el);
    });

    // Font sizes follow the cell size, so 7×7 and 14×14 boards both read well.
    const resizeObserver = new ResizeObserver(() => {
        boardEl.style.setProperty('--qt-cell', `${boardEl.clientWidth / width}px`);
    });
    resizeObserver.observe(boardEl);

    function render() {
        const { rectErrors } = checkBoard(puzzle, rects);
        rectsEl.innerHTML = '';
        rects.forEach((r, i) => {
            const el = document.createElement('div');
            el.className = 'qt-rect';
            if (rectErrors[i]) el.classList.add('qt-rect-error');
            el.style.setProperty('--qt-tint', PLAY_TINTS[(r.x * 7 + r.y * 13 + r.w * 3 + r.h) % PLAY_TINTS.length]);
            place(el, r);
            rectsEl.appendChild(el);
        });
        piecesEl.textContent = `${rects.filter((_, i) => !rectErrors[i]).length}/${clues.length}`;
        undoBtn.disabled = gameOver || history.length === 0;
        clearBtn.disabled = gameOver || rects.length === 0;
    }

    function commit(next, removedCount) {
        history.push(rects);
        rects = next;
        removals += removedCount;
        messageEl.textContent = '';
        render();
        if (checkBoard(puzzle, rects).solved) finish(true, { timedOut: false });
    }

    function cellFromEvent(e) {
        const box = boardEl.getBoundingClientRect();
        const x = Math.floor(((e.clientX - box.left) / box.width) * width);
        const y = Math.floor(((e.clientY - box.top) / box.height) * height);
        return { x: Math.max(0, Math.min(width - 1, x)), y: Math.max(0, Math.min(height - 1, y)) };
    }

    function showPreview() {
        const r = normalise(drag.ax, drag.ay, drag.bx, drag.by);
        place(previewEl, r);
        previewEl.hidden = false;
        previewLabelEl.textContent = r.w === 1 && r.h === 1 ? '1' : `${r.w}×${r.h} = ${r.w * r.h}`;
        previewEl.classList.toggle('qt-preview-top', r.y + r.h >= height - 1);
    }

    function onPointerDown(e) {
        if (gameOver || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        startTimer();
        const { x, y } = cellFromEvent(e);
        drag = { id: e.pointerId, ax: x, ay: y, bx: x, by: y };
        boardEl.setPointerCapture(e.pointerId);
        boardEl.focus({ preventScroll: true });
        showPreview();
    }

    function onPointerMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const { x, y } = cellFromEvent(e);
        if (x === drag.bx && y === drag.by) return;
        drag.bx = x;
        drag.by = y;
        showPreview();
    }

    function onPointerUp(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const r = normalise(drag.ax, drag.ay, drag.bx, drag.by);
        drag = null;
        previewEl.hidden = true;
        if (gameOver) return;

        if (r.w === 1 && r.h === 1) {
            const hit = rects.find((existing) => containsCell(existing, r.x, r.y));
            if (hit) { commit(rects.filter((existing) => existing !== hit), 1); return; }
        }
        for (let y = r.y; y < r.y + r.h; y++) {
            for (let x = r.x; x < r.x + r.w; x++) {
                if (blockedAt.has(`${x},${y}`)) {
                    messageEl.textContent = 'Rectangles can\'t cover a knot.';
                    return;
                }
            }
        }
        const kept = rects.filter((existing) => !overlaps(existing, r));
        commit([...kept, r], rects.length - kept.length);
    }

    function onPointerCancel(e) {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        previewEl.hidden = true;
    }

    function undo() {
        if (gameOver || history.length === 0) return;
        rects = history.pop();
        undos += 1;
        messageEl.textContent = '';
        render();
    }

    function clearAll() {
        if (gameOver || rects.length === 0) return;
        commit([], rects.length);
    }

    function onKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
        }
    }

    boardEl.addEventListener('pointerdown', onPointerDown);
    boardEl.addEventListener('pointermove', onPointerMove);
    boardEl.addEventListener('pointerup', onPointerUp);
    boardEl.addEventListener('pointercancel', onPointerCancel);
    container.addEventListener('keydown', onKeydown);
    undoBtn.addEventListener('click', undo);
    clearBtn.addEventListener('click', clearAll);

    function revealPicture(shown, { greyed }) {
        rectsEl.innerHTML = '';
        // Stagger outward from the centre so the picture "settles" into place.
        const cx = width / 2;
        const cy = height / 2;
        const maxDist = Math.hypot(cx, cy);
        shown.forEach((r) => {
            const el = document.createElement('div');
            el.className = 'qt-rect';
            el.style.setProperty('--qt-tint', PLAY_TINTS[(r.x * 7 + r.y * 13 + r.w * 3 + r.h) % PLAY_TINTS.length]);
            place(el, r);
            const dist = Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
            el.style.transitionDelay = `${Math.round((dist / maxDist) * 500)}ms`;
            el.dataset.colour = palette[Number(pixels[r.y][r.x])];
            rectsEl.appendChild(el);
        });
        boardEl.classList.add(greyed ? 'qt-failed' : 'qt-solved');
        // Next frame, so the tint -> picture-colour change actually transitions.
        requestAnimationFrame(() => {
            container.querySelectorAll('[data-colour]').forEach((el) => {
                el.style.setProperty('--qt-colour', el.dataset.colour);
            });
        });
    }

    function cleanup() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        pendingTimeouts.forEach((id) => clearTimeout(id));
        pendingTimeouts.clear();
        resizeObserver.disconnect();
        boardEl.removeEventListener('pointerdown', onPointerDown);
        boardEl.removeEventListener('pointermove', onPointerMove);
        boardEl.removeEventListener('pointerup', onPointerUp);
        boardEl.removeEventListener('pointercancel', onPointerCancel);
        container.removeEventListener('keydown', onKeydown);
    }

    function finish(won, { timedOut }) {
        if (gameOver) return;
        gameOver = true;
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        drag = null;
        previewEl.hidden = true;
        undoBtn.disabled = true;
        clearBtn.disabled = true;

        const perfect = won && undos === 0 && removals === 0;
        if (won) {
            messageEl.textContent = perfect ? 'Solved! Perfect Stitch \u{2728}' : 'Solved! Your quilt is complete.';
            revealPicture(rects, { greyed: false });
        } else {
            messageEl.textContent = 'Time\'s up! Here\'s the finished quilt.';
            revealPicture(puzzle.rects ?? [], { greyed: true });
        }

        const result = { won, timedOut, timeTakenSeconds: elapsedSeconds, undos, removals, perfect, pieces: rects.length };
        const id = setTimeout(() => {
            pendingTimeouts.delete(id);
            onComplete(result);
        }, REVEAL_DELAY_MS);
        pendingTimeouts.add(id);
    }

    function tick() {
        elapsedSeconds += 1;
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
        if (timerInterval || gameOver) return;
        timerInterval = setInterval(tick, 1000);
    }

    // Tournament's countdown starts at mount (a real time-attack limit); Daily/Classic's
    // stopwatch starts on the first touch of the board (see onPointerDown).
    if (timeLimitSeconds != null) startTimer();
    render();

    return {
        destroy: cleanup,
    };
}
