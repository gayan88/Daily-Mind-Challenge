import { mulberry32 } from '../../utils/helpers.js';
import { icon } from '../../utils/icons.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Right, left, down, up -- Classic Easy places words only along these (no diagonal, no reverse).
export const DIRECTIONS_2WAY = [[1, 0], [0, 1]];
// All 4 axes, both ways -- Daily, Classic Medium/Hard, and Tournament.
export const DIRECTIONS_8WAY = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, -1], [1, -1], [-1, 1],
];

function formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function canPlace(grid, word, row, col, dr, dc, size) {
    for (let i = 0; i < word.length; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (r < 0 || r >= size || c < 0 || c >= size) return false;
        const existing = grid[r][c];
        if (existing !== null && existing !== word[i]) return false;
    }
    return true;
}

function place(grid, word, row, col, dr, dc) {
    const cells = [];
    for (let i = 0; i < word.length; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        grid[r][c] = word[i];
        cells.push({ row: r, col: c });
    }
    return cells;
}

/** Returns the cells the word was placed on, or null if it couldn't be placed at all. */
function placeWord(grid, word, rng, size, directions) {
    for (let attempt = 0; attempt < 400; attempt++) {
        const [dr, dc] = directions[Math.floor(rng() * directions.length)];
        const row = Math.floor(rng() * size);
        const col = Math.floor(rng() * size);
        if (canPlace(grid, word, row, col, dr, dc, size)) {
            return place(grid, word, row, col, dr, dc);
        }
    }
    // Deterministic exhaustive fallback -- guarantees placement whenever geometrically possible.
    for (const [dr, dc] of directions) {
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (canPlace(grid, word, row, col, dr, dc, size)) {
                    return place(grid, word, row, col, dr, dc);
                }
            }
        }
    }
    return null;
}

/** Returns { grid, placements } -- placements maps each word to the cells it occupies, used to
 * reveal unfound words if a Tournament round times out. */
function generateGrid(words, seed, size, directions) {
    const rng = mulberry32(seed);
    const grid = Array.from({ length: size }, () => new Array(size).fill(null));
    const placements = new Map();

    const sorted = [...words].sort((a, b) => b.length - a.length);
    sorted.forEach((word) => {
        const cells = placeWord(grid, word, rng, size, directions);
        if (cells) placements.set(word, cells);
    });

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (grid[r][c] === null) {
                grid[r][c] = ALPHABET[Math.floor(rng() * ALPHABET.length)];
            }
        }
    }
    return { grid, placements };
}

function cellsInLine(start, end) {
    const dr = Math.sign(end.row - start.row);
    const dc = Math.sign(end.col - start.col);
    const steps = Math.max(Math.abs(end.row - start.row), Math.abs(end.col - start.col));

    // Only straight lines (horizontal, vertical, or perfect diagonal) are valid selections.
    if (
        !(dr === 0 || dc === 0 || Math.abs(end.row - start.row) === Math.abs(end.col - start.col))
    ) {
        return null;
    }

    const cells = [];
    for (let i = 0; i <= steps; i++) {
        cells.push({ row: start.row + dr * i, col: start.col + dc * i });
    }
    return cells;
}

/**
 * Mounts a playable Word Search round into `container`. `gridSize`/`directions` are required --
 * every mode (Daily, Classic x3 difficulties, Tournament) supplies its own via
 * `wordsearch-modes.js`. Direction only controls where words get *placed*; a player can still
 * drag either way along the line they select regardless of which direction it was placed in
 * (`endSelection` below checks both the forward and reversed letter string).
 *
 * Always shows a live stats bar (Words Found + Time), like `sudoku-engine.js`. `timeLimitSeconds`
 * is optional (Tournament only) -- when set, the stats bar counts down instead of up, and hitting
 * zero ends the round as a loss (`timedOut: true`) with the un-found words revealed.
 *
 * Calls `onComplete({ won, wordsFound, totalWords, timeTakenSeconds, timedOut })` exactly once.
 */
export function playWordSearchRound({ container, words, seed, gridSize, directions, timeLimitSeconds = null, onComplete }) {
    const upperWords = words.map((w) => w.toUpperCase());
    const { grid, placements } = generateGrid(upperWords, seed, gridSize, directions);
    const remaining = new Set(upperWords);
    const found = new Set();

    container.innerHTML = `
        <div class="wordsearch-stats" id="wordsearch-stats">
            <span class="wordsearch-stat">
                <span class="wordsearch-stat-icon">${icon('WORDS')}</span>
                <span class="wordsearch-stat-label">Words Found</span>
                <span class="wordsearch-stat-value" id="ws-found-stat">0/${upperWords.length}</span>
            </span>
            <span class="wordsearch-stat">
                <span class="wordsearch-stat-icon">${icon('STOPWATCH')}</span>
                <span class="wordsearch-stat-label">Time</span>
                <span class="wordsearch-stat-value" id="ws-time-stat">${timeLimitSeconds ? formatClock(timeLimitSeconds) : '0:00'}</span>
            </span>
        </div>
        <div class="wordsearch-layout">
            <div class="wordsearch-grid" id="ws-grid"></div>
            <div class="wordsearch-words" id="ws-words"></div>
        </div>
    `;

    const foundStatEl = container.querySelector('#ws-found-stat');
    const timeStatEl = container.querySelector('#ws-time-stat');
    const gridEl = container.querySelector('#ws-grid');
    const wordsEl = container.querySelector('#ws-words');
    gridEl.style.setProperty('--ws-size', gridSize);

    const cellEls = [];
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            const cell = document.createElement('div');
            cell.className = 'ws-cell';
            cell.textContent = grid[r][c];
            cell.dataset.row = r;
            cell.dataset.col = c;
            gridEl.appendChild(cell);
            cellEls.push(cell);
        }
    }

    upperWords.forEach((word) => {
        const item = document.createElement('div');
        item.className = 'ws-word';
        item.textContent = word;
        item.dataset.word = word;
        wordsEl.appendChild(item);
    });

    let selecting = false;
    let startCell = null;
    let gameOver = false;
    let elapsedSeconds = 0;
    let destroyed = false;

    function cellFromPoint(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el || !el.classList.contains('ws-cell')) return null;
        return { row: Number(el.dataset.row), col: Number(el.dataset.col), el };
    }

    function clearPreview() {
        cellEls.forEach((el) => el.classList.remove('preview'));
    }

    function previewLine(cells) {
        clearPreview();
        if (!cells) return;
        cells.forEach(({ row, col }) => {
            const el = cellEls[row * gridSize + col];
            if (el) el.classList.add('preview');
        });
    }

    function lettersForLine(cells) {
        return cells.map(({ row, col }) => grid[row][col]).join('');
    }

    function markFound(word, cells) {
        found.add(word);
        remaining.delete(word);
        cells.forEach(({ row, col }) => {
            cellEls[row * gridSize + col].classList.add('found');
        });
        const item = wordsEl.querySelector(`[data-word="${word}"]`);
        if (item) item.classList.add('found');
        foundStatEl.textContent = `${found.size}/${upperWords.length}`;
    }

    function endSelection(endCell) {
        if (gameOver || !startCell || !endCell) {
            selecting = false;
            startCell = null;
            clearPreview();
            return;
        }
        const cells = cellsInLine(startCell, endCell);
        if (cells) {
            const forward = lettersForLine(cells);
            const backward = forward.split('').reverse().join('');
            const match = [...remaining].find((w) => w === forward || w === backward);
            if (match) markFound(match, cells);
        }
        selecting = false;
        startCell = null;
        clearPreview();

        if (remaining.size === 0) {
            finish(true, { timedOut: false });
        }
    }

    function cleanup() {
        destroyed = true;
        if (timerInterval) clearInterval(timerInterval);
        window.removeEventListener('mouseup', onWindowMouseUp);
    }

    function finish(won, { timedOut }) {
        if (gameOver) return;
        gameOver = true;
        cleanup();

        if (!won) {
            remaining.forEach((word) => {
                const cells = placements.get(word);
                if (cells) cells.forEach(({ row, col }) => cellEls[row * gridSize + col].classList.add('revealed'));
                const item = wordsEl.querySelector(`[data-word="${word}"]`);
                if (item) item.classList.add('revealed');
            });
        }

        onComplete({ won, wordsFound: found.size, totalWords: upperWords.length, timeTakenSeconds: elapsedSeconds, timedOut });
    }

    function onWindowMouseUp(e) {
        if (destroyed || !selecting) return;
        endSelection(cellFromPoint(e.clientX, e.clientY));
    }

    gridEl.addEventListener('mousedown', (e) => {
        if (gameOver) return;
        const cell = cellFromPoint(e.clientX, e.clientY);
        if (!cell) return;
        selecting = true;
        startCell = cell;
        previewLine([cell]);
    });
    gridEl.addEventListener('mousemove', (e) => {
        if (!selecting) return;
        const cell = cellFromPoint(e.clientX, e.clientY);
        if (cell) previewLine(cellsInLine(startCell, cell));
    });
    window.addEventListener('mouseup', onWindowMouseUp);

    gridEl.addEventListener('touchstart', (e) => {
        if (gameOver) return;
        const t = e.touches[0];
        const cell = cellFromPoint(t.clientX, t.clientY);
        if (!cell) return;
        selecting = true;
        startCell = cell;
        previewLine([cell]);
    }, { passive: true });
    gridEl.addEventListener('touchmove', (e) => {
        if (!selecting) return;
        const t = e.touches[0];
        const cell = cellFromPoint(t.clientX, t.clientY);
        if (cell) previewLine(cellsInLine(startCell, cell));
    }, { passive: true });
    gridEl.addEventListener('touchend', (e) => {
        if (!selecting) return;
        const t = e.changedTouches[0];
        endSelection(cellFromPoint(t.clientX, t.clientY));
    });

    let timerInterval = setInterval(() => {
        elapsedSeconds += 1;

        if (timeLimitSeconds != null) {
            const remainingSeconds = timeLimitSeconds - elapsedSeconds;
            if (remainingSeconds <= 0) {
                timeStatEl.textContent = formatClock(0);
                finish(false, { timedOut: true });
                return;
            }
            timeStatEl.textContent = formatClock(remainingSeconds);
            timeStatEl.classList.toggle('urgent', remainingSeconds <= 30);
        } else {
            timeStatEl.textContent = formatClock(elapsedSeconds);
        }
    }, 1000);

    return {
        destroy: cleanup,
    };
}
