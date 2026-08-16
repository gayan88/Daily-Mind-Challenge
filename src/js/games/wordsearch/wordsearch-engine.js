import { mulberry32 } from '../../utils/helpers.js';

const GRID_SIZE = 13;
// Forward-only directions: right, down, diagonal down-right, diagonal down-left.
const DIRECTIONS = [
    [1, 0],
    [0, 1],
    [1, 1],
    [-1, 1],
];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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
    for (let i = 0; i < word.length; i++) {
        grid[row + dr * i][col + dc * i] = word[i];
    }
}

function placeWord(grid, word, rng, size) {
    for (let attempt = 0; attempt < 400; attempt++) {
        const [dr, dc] = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)];
        const row = Math.floor(rng() * size);
        const col = Math.floor(rng() * size);
        if (canPlace(grid, word, row, col, dr, dc, size)) {
            place(grid, word, row, col, dr, dc);
            return true;
        }
    }
    // Deterministic exhaustive fallback -- guarantees placement whenever geometrically possible.
    for (const [dr, dc] of DIRECTIONS) {
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (canPlace(grid, word, row, col, dr, dc, size)) {
                    place(grid, word, row, col, dr, dc);
                    return true;
                }
            }
        }
    }
    return false;
}

function generateGrid(words, seed, size = GRID_SIZE) {
    const rng = mulberry32(seed);
    const grid = Array.from({ length: size }, () => new Array(size).fill(null));

    const sorted = [...words].sort((a, b) => b.length - a.length);
    sorted.forEach((word) => placeWord(grid, word, rng, size));

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (grid[r][c] === null) {
                grid[r][c] = ALPHABET[Math.floor(rng() * ALPHABET.length)];
            }
        }
    }
    return grid;
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
 * Mounts a playable Word Search round into `container`. Calls `onComplete()` once every word in
 * `words` has been found via mouse/touch drag selection.
 */
export function playWordSearchRound({ container, words, seed, onComplete }) {
    const size = GRID_SIZE;
    const grid = generateGrid(words, seed, size);
    const remaining = new Set(words.map((w) => w.toUpperCase()));
    const found = new Set();

    container.innerHTML = `
        <div class="wordsearch-layout">
            <div class="wordsearch-grid" id="ws-grid"></div>
            <div class="wordsearch-words" id="ws-words"></div>
        </div>
    `;

    const gridEl = container.querySelector('#ws-grid');
    const wordsEl = container.querySelector('#ws-words');
    gridEl.style.setProperty('--ws-size', size);

    const cellEls = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = document.createElement('div');
            cell.className = 'ws-cell';
            cell.textContent = grid[r][c];
            cell.dataset.row = r;
            cell.dataset.col = c;
            gridEl.appendChild(cell);
            cellEls.push(cell);
        }
    }

    words.forEach((word) => {
        const item = document.createElement('div');
        item.className = 'ws-word';
        item.textContent = word.toUpperCase();
        item.dataset.word = word.toUpperCase();
        wordsEl.appendChild(item);
    });

    let selecting = false;
    let startCell = null;

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
            const el = cellEls[row * size + col];
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
            cellEls[row * size + col].classList.add('found');
        });
        const item = wordsEl.querySelector(`[data-word="${word}"]`);
        if (item) item.classList.add('found');
    }

    function endSelection(endCell) {
        if (!startCell || !endCell) {
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
            onComplete();
        }
    }

    gridEl.addEventListener('mousedown', (e) => {
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
    window.addEventListener('mouseup', (e) => {
        if (!selecting) return;
        endSelection(cellFromPoint(e.clientX, e.clientY));
    });

    gridEl.addEventListener('touchstart', (e) => {
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

    return {
        destroy() {},
    };
}
