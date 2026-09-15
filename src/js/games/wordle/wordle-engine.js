import { icon } from '../../utils/icons.js';

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

function formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Mounts a playable Wordle round into `container`. Calls `onComplete({ won, attempts, guessStates,
 * timeTakenSeconds, timedOut })` exactly once when the round ends (win, out of guesses, or time
 * limit expiring). `guessStates` is the per-guess correct/present/absent array for each submitted
 * row, for callers that want to render a shareable-style colored grid afterward.
 *
 * Always shows a live stats bar with Attempts (submitted guesses / `maxGuesses`, updated after
 * each guess) and Time, like `sudoku-engine.js`/`wordsearch-engine.js`.
 * `timeLimitSeconds` is optional (Tournament only) -- when set, the stats bar counts DOWN from it
 * and running out of time ends the round as a loss (`timedOut: true`) even with guesses
 * remaining, starting immediately since it's a real time-attack constraint. Without it (Daily
 * Challenge, Challenge a Friend), the stats bar is a pure stopwatch counting UP from zero that
 * doesn't start ticking until the player's first letter keystroke -- otherwise page-load/read
 * time before their first move would silently eat into Daily Challenge's speed bonus -- and its
 * final value is handed back as `timeTakenSeconds` for callers to use (Daily Challenge's own
 * speed-bonus formula lives in `wordle-daily-data.js`, not here).
 * `roundLabel` is an optional plain-text string (e.g. "Word 3 of 10") shown alongside Time inside
 * that same stats box -- only ever passed by Tournament mode today.
 *
 * `validateGuess` is an optional `async (guess) => boolean` callback -- when provided, every guess
 * that isn't the exact target word is checked against it before being accepted (real Wordle rejects
 * gibberish the same way); a rejected guess shakes the row and doesn't consume an attempt. Input is
 * locked while a check is in flight, and the guess is snapshotted before awaiting so an in-flight
 * check can never apply to a guess the player has since edited. The engine has no opinion on *how*
 * `validateGuess` decides -- see `wordle-word-validation.js`'s dictionary-API version, wired up in
 * `wordle-page.js`, which fails open (accepts the guess) on any API error so gameplay never gets
 * stuck on a flaky third party.
 *
 * Shared by all of wordle.html's modes (Daily Challenge, Tournaments, Challenge a Friend) --
 * callers that only destructure `{ won, attempts }` are unaffected by the extra fields.
 *
 * `revealAnswerOnLoss` (default true) controls whether the out-of-guesses in-board status message
 * includes the target word -- Daily Challenge sets this false so a failed attempt doesn't spoil
 * the word before its own 1-hour retry cooldown lets the player try again (see wordle-page.js).
 * Tournament/Challenge a Friend don't set it, so they keep the original always-reveal behavior.
 */
export function playWordleRound({ container, targetWord, maxGuesses = 6, timeLimitSeconds = null, roundLabel = null, validateGuess = null, revealAnswerOnLoss = true, onComplete }) {
    const target = targetWord.toUpperCase();
    const wordLength = target.length;

    container.innerHTML = `
        <div class="wordle-stats" id="wordle-stats">
            ${roundLabel ? `
                <span class="wordle-stat">
                    <span class="wordle-stat-value">${roundLabel}</span>
                </span>
            ` : ''}
            <span class="wordle-stat">
                <span class="wordle-stat-icon">${icon('TARGET')}</span>
                <span class="wordle-stat-label">Attempts</span>
                <span class="wordle-stat-value" id="wordle-attempts-stat">0/${maxGuesses}</span>
            </span>
            <span class="wordle-stat">
                <span class="wordle-stat-icon">${icon('STOPWATCH')}</span>
                <span class="wordle-stat-label">Time</span>
                <span class="wordle-stat-value" id="wordle-timer">${timeLimitSeconds ? formatClock(timeLimitSeconds) : '0:00'}</span>
            </span>
        </div>
        <div class="wordle-board" id="wordle-board"></div>
        <div class="wordle-message" id="wordle-message" aria-live="polite"></div>
        <div class="wordle-keyboard" id="wordle-keyboard"></div>
    `;

    const timerEl = container.querySelector('#wordle-timer');
    const attemptsStatEl = container.querySelector('#wordle-attempts-stat');
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
    let submitting = false;
    const guessStates = [];
    let timerInterval = null;
    let elapsedSeconds = 0;

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

    async function submitGuess() {
        if (submitting) return;
        submitting = true;
        try {
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

            // Snapshot now, before any await -- currentGuess must not be read again after the
            // check resolves, since input is locked but the round could still end from under us
            // (e.g. a tournament timer running out) while the check is in flight.
            const guess = currentGuess;

            if (validateGuess && guess !== target) {
                setMessage('Checking word…');
                const isValid = await validateGuess(guess);
                if (gameOver) return;
                if (!isValid) {
                    setMessage('Not a valid word');
                    shakeCurrentRow();
                    return;
                }
            }

            const states = evaluateGuess(guess, target);
            guessStates.push(states);
            const row = rows[rowIndex];
            row.cells.forEach((cell, i) => {
                cell.dataset.state = states[i];
                upgradeKeyState(guess[i], states[i]);
            });

            const won = guess === target;
            rowIndex++;
            attemptsStatEl.textContent = `${rowIndex}/${maxGuesses}`;

            if (won) {
                gameOver = true;
                setMessage('You solved it!');
                finish(true, rowIndex);
            } else if (rowIndex === maxGuesses) {
                gameOver = true;
                setMessage(revealAnswerOnLoss ? `Out of guesses! The word was ${target}` : 'Out of guesses!');
                finish(false, rowIndex);
            } else {
                currentGuess = '';
                setMessage('');
            }
        } finally {
            submitting = false;
        }
    }

    function handleKey(key) {
        if (gameOver || submitting) return;
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
            startTimer();
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

    function startTimer() {
        if (timerInterval) return;
        if (timeLimitSeconds) {
            let remaining = timeLimitSeconds;
            timerInterval = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    clearInterval(timerInterval);
                    if (!gameOver) {
                        gameOver = true;
                        setMessage(`Time's up! The word was ${target}`);
                        finish(false, rowIndex, { timedOut: true });
                    }
                    return;
                }
                timerEl.textContent = formatClock(remaining);
                timerEl.classList.toggle('urgent', remaining <= 10);
            }, 1000);
        } else {
            timerInterval = setInterval(() => {
                elapsedSeconds += 1;
                timerEl.textContent = formatClock(elapsedSeconds);
            }, 1000);
        }
    }

    // Tournament's countdown is a real time-attack constraint, so it starts the instant the
    // round mounts, same as before. Daily Challenge/Challenge a Friend's stopwatch instead only
    // starts on the player's first letter keystroke (see `handleKey` above).
    if (timeLimitSeconds) startTimer();

    function cleanup() {
        document.removeEventListener('keydown', onPhysicalKeydown);
        if (timerInterval) clearInterval(timerInterval);
    }

    function finish(won, attempts, extra = {}) {
        cleanup();
        onComplete({ won, attempts, guessStates: guessStates.slice(), timeTakenSeconds: elapsedSeconds, timedOut: false, ...extra });
    }

    return {
        destroy: cleanup,
    };
}
