/**
 * Mounts a playable Sudoku round into `container`. Tap a cell, then tap a number to fill it
 * (mobile-friendly, avoids raw <input> zoom/keyboard issues). Correctness is checked by direct
 * comparison against `solution` -- no general constraint-solving engine needed for v1.
 * Calls `onComplete({ won: true })` once every cell matches the solution.
 */
export function playSudokuRound({ container, puzzle, solution, onComplete }) {
    container.innerHTML = `
        <div class="sudoku-grid" id="sudoku-grid"></div>
        <div class="sudoku-message" id="sudoku-message" aria-live="polite"></div>
        <div class="sudoku-palette" id="sudoku-palette"></div>
    `;

    const gridEl = container.querySelector('#sudoku-grid');
    const messageEl = container.querySelector('#sudoku-message');
    const paletteEl = container.querySelector('#sudoku-palette');

    const cells = [];
    let selectedIndex = null;
    let gameOver = false;
    const values = puzzle.split('');
    const givens = puzzle.split('').map((ch) => ch !== '0');

    for (let i = 0; i < 81; i++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'sudoku-cell';
        const row = Math.floor(i / 9);
        const col = i % 9;
        if (col % 3 === 0) cell.classList.add('border-left');
        if (row % 3 === 0) cell.classList.add('border-top');
        if (col === 8) cell.classList.add('border-right');
        if (row === 8) cell.classList.add('border-bottom');

        if (givens[i]) {
            cell.textContent = values[i];
            cell.classList.add('given');
            cell.disabled = true;
        } else {
            cell.addEventListener('click', () => selectCell(i));
        }

        gridEl.appendChild(cell);
        cells.push(cell);
    }

    for (let n = 1; n <= 9; n++) {
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'sudoku-key';
        key.textContent = String(n);
        key.addEventListener('click', () => enterValue(String(n)));
        paletteEl.appendChild(key);
    }
    const clearKey = document.createElement('button');
    clearKey.type = 'button';
    clearKey.className = 'sudoku-key wide';
    clearKey.textContent = 'Clear';
    clearKey.addEventListener('click', () => enterValue('0'));
    paletteEl.appendChild(clearKey);

    function selectCell(index) {
        if (gameOver) return;
        if (selectedIndex !== null) cells[selectedIndex].classList.remove('selected');
        selectedIndex = index;
        cells[index].classList.add('selected');
    }

    function enterValue(digit) {
        if (gameOver || selectedIndex === null || givens[selectedIndex]) return;
        values[selectedIndex] = digit;
        const cell = cells[selectedIndex];
        cell.textContent = digit === '0' ? '' : digit;
        cell.classList.remove('error');

        if (digit !== '0' && digit !== solution[selectedIndex]) {
            cell.classList.add('error');
        }

        checkCompletion();
    }

    function checkCompletion() {
        const complete = values.every((v, i) => v === solution[i]);
        if (complete) {
            gameOver = true;
            messageEl.textContent = 'Solved! Great work.';
            onComplete({ won: true });
        }
    }

    return {
        destroy() {},
    };
}
