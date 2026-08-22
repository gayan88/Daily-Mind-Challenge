import { icon } from '../../utils/icons.js';

function formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Mounts a playable Sudoku round into `container`. Tap a cell, then tap a number to fill it
 * (mobile-friendly, avoids raw <input> zoom/keyboard issues). Correctness is checked by direct
 * comparison against `solution` -- no general constraint-solving engine needed for v1.
 *
 * A live stats line (time + errors) is always shown, since all three Sudoku modes (Daily
 * Challenge, Classic, Tournament) display this per their spec -- unlike wordle-engine.js's
 * timer, which only appears when `timeLimitSeconds` is set.
 *
 * `timeLimitSeconds` is optional (Tournament only) -- when set, the stats line counts DOWN from
 * it instead of counting up from zero, and reaching 0 ends the round as a loss (`timedOut: true`).
 * `maxErrors` is optional (Tournament only) -- exceeding it ends the round as a loss immediately.
 *
 * Calls `onComplete({ won, errors, timeTakenSeconds, timedOut })` exactly once when the round
 * ends (win, or a Tournament loss via timeout/too many errors).
 */
export function playSudokuRound({ container, puzzle, solution, timeLimitSeconds = null, maxErrors = null, onComplete }) {
    container.innerHTML = `
        <div class="sudoku-stats" id="sudoku-stats">
            <span class="sudoku-stat">
                <span class="sudoku-stat-icon">${icon('STOPWATCH')}</span>
                <span class="sudoku-stat-label">Time</span>
                <span class="sudoku-stat-value" id="sudoku-time-stat">${timeLimitSeconds ? formatClock(timeLimitSeconds) : '0:00'}</span>
            </span>
            <span class="sudoku-stat">
                <span class="sudoku-stat-icon">${icon('WARNING')}</span>
                <span class="sudoku-stat-label">Errors</span>
                <span class="sudoku-stat-value" id="sudoku-errors-stat">0${maxErrors != null ? `/${maxErrors}` : ''}</span>
            </span>
        </div>
        <div class="sudoku-grid" id="sudoku-grid"></div>
        <div class="sudoku-message" id="sudoku-message" aria-live="polite"></div>
        <div class="sudoku-palette" id="sudoku-palette"></div>
        <button type="button" class="sudoku-clear-btn" id="sudoku-clear-btn">Clear</button>
    `;

    const timeStatEl = container.querySelector('#sudoku-time-stat');
    const errorsStatEl = container.querySelector('#sudoku-errors-stat');
    const gridEl = container.querySelector('#sudoku-grid');
    const messageEl = container.querySelector('#sudoku-message');
    const paletteEl = container.querySelector('#sudoku-palette');
    const clearBtn = container.querySelector('#sudoku-clear-btn');

    const cells = [];
    let selectedIndex = null;
    let gameOver = false;
    let elapsedSeconds = 0;
    let errorCount = 0;
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
    clearBtn.addEventListener('click', () => enterValue('0'));

    function selectCell(index) {
        if (gameOver) return;
        if (selectedIndex !== null) cells[selectedIndex].classList.remove('selected');
        selectedIndex = index;
        cells[index].classList.add('selected');
    }

    function updateErrorsStat() {
        errorsStatEl.textContent = `${errorCount}${maxErrors != null ? `/${maxErrors}` : ''}`;
    }

    function enterValue(digit) {
        if (gameOver || selectedIndex === null || givens[selectedIndex]) return;
        values[selectedIndex] = digit;
        const cell = cells[selectedIndex];
        cell.textContent = digit === '0' ? '' : digit;
        cell.classList.remove('error');

        if (digit !== '0' && digit !== solution[selectedIndex]) {
            cell.classList.add('error');
            errorCount += 1;
            updateErrorsStat();

            if (maxErrors != null && errorCount > maxErrors) {
                messageEl.textContent = `Too many errors! The solution is shown below.`;
                finish(false, { timedOut: false });
                return;
            }
        }

        checkCompletion();
    }

    function checkCompletion() {
        const complete = values.every((v, i) => v === solution[i]);
        if (complete) {
            messageEl.textContent = 'Solved! Great work.';
            finish(true, { timedOut: false });
        }
    }

    function cleanup() {
        if (timerInterval) clearInterval(timerInterval);
    }

    function finish(won, { timedOut }) {
        if (gameOver) return;
        gameOver = true;
        cleanup();

        if (!won) {
            cells.forEach((cell, i) => {
                if (givens[i]) return;
                cell.textContent = solution[i];
                cell.disabled = true;
                cell.classList.remove('error', 'selected');
                if (values[i] !== solution[i]) cell.classList.add('revealed');
            });
        }

        onComplete({ won, errors: errorCount, timeTakenSeconds: elapsedSeconds, timedOut });
    }

    let timerInterval = setInterval(() => {
        elapsedSeconds += 1;

        if (timeLimitSeconds != null) {
            const remaining = timeLimitSeconds - elapsedSeconds;
            if (remaining <= 0) {
                timeStatEl.textContent = formatClock(0);
                messageEl.textContent = "Time's up! The solution is shown below.";
                finish(false, { timedOut: true });
                return;
            }
            timeStatEl.textContent = formatClock(remaining);
            timeStatEl.classList.toggle('urgent', remaining <= 30);
        } else {
            timeStatEl.textContent = formatClock(elapsedSeconds);
        }
    }, 1000);

    return {
        destroy: cleanup,
    };
}
