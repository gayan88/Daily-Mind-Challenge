const KEYBOARD_ROWS = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK'],
];

/** Two-pass evaluation so duplicate letters are scored the way Wordle actually scores them. */
function evaluateGuess(guess, target) {
    const result = new Array(guess.length).fill('absent');
    const targetLetters = target.split('');
    const used = new Array(target.length).fill(false);

    for (let i = 0; i < guess.length; i++) {
        if (guess[i] === targetLetters[i]) {
            result[i] = 'correct';
            used[i] = true;
        }
    }
    for (let i = 0; i < guess.length; i++) {
        if (result[i] === 'correct') continue;
        const idx = targetLetters.findIndex((letter, j) => letter === guess[i] && !used[j]);
        if (idx !== -1) {
            result[i] = 'present';
            used[idx] = true;
        }
    }
    return result;
}

/**
 * Mounts a playable Wordle round into `container`. Calls `onComplete({ won, attempts })` exactly
 * once when the round ends (win or out of guesses). Reused by both wordle.html (daily word) and
 * challenges.html solve mode (a challenge's target word).
 */
export function playWordleRound({ container, targetWord, maxGuesses = 6, onComplete }) {
    const target = targetWord.toUpperCase();
    const wordLength = target.length;

    container.innerHTML = `
        <div class="wordle-board" id="wordle-board"></div>
        <div class="wordle-message" id="wordle-message" aria-live="polite"></div>
        <div class="wordle-keyboard" id="wordle-keyboard"></div>
    `;

    const boardEl = container.querySelector('#wordle-board');
    const messageEl = container.querySelector('#wordle-message');
    const keyboardEl = container.querySelector('#wordle-keyboard');

    const rows = [];
    for (let r = 0; r < maxGuesses; r++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'wordle-row';
        const cells = [];
        for (let c = 0; c < wordLength; c++) {
            const cell = document.createElement('div');
            cell.className = 'wordle-cell';
            rowEl.appendChild(cell);
            cells.push(cell);
        }
        boardEl.appendChild(rowEl);
        rows.push({ el: rowEl, cells });
    }

    const keyEls = {};
    KEYBOARD_ROWS.forEach((rowKeys) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'wordle-kb-row';
        rowKeys.forEach((key) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'wordle-key' + (key === 'ENTER' || key === 'BACK' ? ' wide' : '');
            btn.textContent = key === 'BACK' ? '⌫' : key === 'ENTER' ? 'ENTER' : key;
            btn.addEventListener('click', () => handleKey(key));
            rowEl.appendChild(btn);
            if (key.length === 1) keyEls[key] = btn;
        });
        keyboardEl.appendChild(rowEl);
    });

    let currentGuess = '';
    let rowIndex = 0;
    let gameOver = false;

    function setMessage(text) {
        messageEl.textContent = text;
    }

    function renderCurrentRow() {
        const row = rows[rowIndex];
        row.cells.forEach((cell, i) => {
            cell.textContent = currentGuess[i] || '';
        });
    }

    function shakeCurrentRow() {
        const row = rows[rowIndex];
        row.el.classList.add('shake');
        setTimeout(() => row.el.classList.remove('shake'), 400);
    }

    function upgradeKeyState(letter, state) {
        const priority = { absent: 0, present: 1, correct: 2 };
        const btn = keyEls[letter];
        if (!btn) return;
        const current = btn.dataset.state;
        if (!current || priority[state] > priority[current]) {
            btn.dataset.state = state;
        }
    }

    function submitGuess() {
        if (currentGuess.length !== wordLength) {
            setMessage(`Word must be ${wordLength} letters`);
            shakeCurrentRow();
            return;
        }
        if (!/^[A-Z]+$/.test(currentGuess)) {
            setMessage('Letters only');
            shakeCurrentRow();
            return;
        }

        const states = evaluateGuess(currentGuess, target);
        const row = rows[rowIndex];
        row.cells.forEach((cell, i) => {
            cell.dataset.state = states[i];
            upgradeKeyState(currentGuess[i], states[i]);
        });

        const won = currentGuess === target;
        rowIndex++;

        if (won) {
            gameOver = true;
            setMessage('You solved it!');
            finish(true, rowIndex);
        } else if (rowIndex === maxGuesses) {
            gameOver = true;
            setMessage(`Out of guesses! The word was ${target}`);
            finish(false, rowIndex);
        } else {
            currentGuess = '';
            setMessage('');
        }
    }

    function handleKey(key) {
        if (gameOver) return;
        if (key === 'ENTER') {
            submitGuess();
            return;
        }
        if (key === 'BACK') {
            currentGuess = currentGuess.slice(0, -1);
            renderCurrentRow();
            return;
        }
        if (currentGuess.length < wordLength && /^[A-Z]$/.test(key)) {
            currentGuess += key;
            renderCurrentRow();
        }
    }

    function onPhysicalKeydown(e) {
        if (gameOver) return;
        if (e.key === 'Enter') handleKey('ENTER');
        else if (e.key === 'Backspace') handleKey('BACK');
        else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
    }

    document.addEventListener('keydown', onPhysicalKeydown);

    function finish(won, attempts) {
        document.removeEventListener('keydown', onPhysicalKeydown);
        onComplete({ won, attempts });
    }

    return {
        destroy() {
            document.removeEventListener('keydown', onPhysicalKeydown);
        },
    };
}
