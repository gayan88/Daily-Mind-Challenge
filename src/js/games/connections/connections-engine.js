import { icon } from '../../utils/icons.js';

export const GROUP_EMOJI = ['🟨', '🟩', '🟦', '🟪'];
export const GROUP_SIZE = 4;

function formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function shuffled(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Mounts a playable Connections round into `container`. `groups` is an array of 4 groups ordered
 * easiest to hardest (index 0..3 = yellow/green/blue/purple), each `{ name, words: [4 strings] }`.
 * Calls `onComplete({ won, mistakes, guessHistory, solvedOrder, timeTakenSeconds, timedOut })`
 * exactly once when the round ends (all groups found, out of mistakes, or time limit expiring).
 * `guessHistory` is one array per submitted guess (correct or not) holding the true group index of
 * each of its 4 words, sorted ascending -- the source of the shareable emoji grid.
 *
 * Always shows a live stats bar with Mistakes (used / `maxMistakes`) and Time. `timeLimitSeconds`
 * is optional (Tournament only) -- when set, the clock counts DOWN from it starting immediately and
 * hitting zero ends the round as a timed-out loss. Without it (Daily, Classic) the clock is a
 * stopwatch that only starts on the player's first tile tap, so read time before the first move
 * doesn't eat the speed bonus (same reasoning as wordle-engine.js).
 *
 * `revealAnswersOnLoss` (default true) controls whether a loss reveals the unsolved groups on the
 * board -- Daily sets it false so a failed attempt doesn't spoil the puzzle before its own hourly
 * retry (see connections-page.js). The grid is reshuffled on every mount, so a retry never shows
 * the same layout twice.
 *
 * `roundLabel` is optional plain text (e.g. "Puzzle 3 of 5") shown in the stats bar -- Tournament only.
 * The engine has no Firebase/session knowledge; the mode data files own scoring.
 */
export function playConnectionsRound({ container, groups, maxMistakes = 4, timeLimitSeconds = null, roundLabel = null, revealAnswersOnLoss = true, onComplete }) {
    const wordToGroup = new Map();
    groups.forEach((g, gi) => g.words.forEach((w) => wordToGroup.set(w.toUpperCase(), gi)));

    let tiles = shuffled(groups.flatMap((g) => g.words.map((w) => w.toUpperCase())));
    let selected = [];
    const solved = [];
    const guessHistory = [];
    const previousGuessKeys = new Set();
    let mistakes = 0;
    let gameOver = false;
    let busy = false;
    let timerInterval = null;
    let elapsedSeconds = 0;
    const pendingTimeouts = new Set();

    container.innerHTML = `
        <div class="cx-stats">
            ${roundLabel ? `<span class="cx-stat"><span class="cx-stat-value">${roundLabel}</span></span>` : ''}
            <span class="cx-stat">
                <span class="cx-stat-icon">${icon('TARGET')}</span>
                <span class="cx-stat-label">Mistakes</span>
                <span class="cx-stat-value" id="cx-mistakes-stat">0/${maxMistakes}</span>
            </span>
            <span class="cx-stat">
                <span class="cx-stat-icon">${icon('STOPWATCH')}</span>
                <span class="cx-stat-label">Time</span>
                <span class="cx-stat-value" id="cx-timer">${timeLimitSeconds ? formatClock(timeLimitSeconds) : '0:00'}</span>
            </span>
        </div>
        <div class="cx-board">
            <div class="cx-solved" id="cx-solved"></div>
            <div class="cx-grid" id="cx-grid"></div>
        </div>
        <div class="cx-message" id="cx-message" aria-live="polite"></div>
        <div class="cx-lives" id="cx-lives" aria-label="Mistakes remaining"></div>
        <div class="cx-actions">
            <button class="btn" id="cx-shuffle-btn" type="button">Shuffle</button>
            <button class="btn" id="cx-deselect-btn" type="button">Deselect All</button>
            <button class="btn primary" id="cx-submit-btn" type="button" disabled>Submit</button>
        </div>
    `;

    const timerEl = container.querySelector('#cx-timer');
    const mistakesStatEl = container.querySelector('#cx-mistakes-stat');
    const solvedEl = container.querySelector('#cx-solved');
    const gridEl = container.querySelector('#cx-grid');
    const messageEl = container.querySelector('#cx-message');
    const livesEl = container.querySelector('#cx-lives');
    const shuffleBtn = container.querySelector('#cx-shuffle-btn');
    const deselectBtn = container.querySelector('#cx-deselect-btn');
    const submitBtn = container.querySelector('#cx-submit-btn');

    function later(fn, ms) {
        const id = setTimeout(() => {
            pendingTimeouts.delete(id);
            fn();
        }, ms);
        pendingTimeouts.add(id);
    }

    function setMessage(text) {
        messageEl.textContent = text;
    }

    function renderLives() {
        livesEl.innerHTML = Array.from({ length: maxMistakes }, (_, i) =>
            `<span class="cx-life${i < maxMistakes - mistakes ? '' : ' lost'}"></span>`).join('');
    }

    function renderSolvedGroup(gi) {
        const group = groups[gi];
        const el = document.createElement('div');
        el.className = 'cx-solved-group';
        el.dataset.group = String(gi);
        el.innerHTML = `
            <div class="cx-solved-name"></div>
            <div class="cx-solved-words"></div>
        `;
        el.querySelector('.cx-solved-name').textContent = group.name;
        el.querySelector('.cx-solved-words').textContent = group.words.map((w) => w.toUpperCase()).join(', ');
        solvedEl.appendChild(el);
    }

    function renderGrid() {
        gridEl.innerHTML = '';
        tiles.forEach((word) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cx-tile' + (selected.includes(word) ? ' selected' : '');
            btn.dataset.word = word;
            btn.textContent = word;
            if (word.length > 9) btn.classList.add('long');
            else if (word.length > 6) btn.classList.add('medium');
            btn.addEventListener('click', () => toggleTile(word));
            gridEl.appendChild(btn);
        });
        submitBtn.disabled = selected.length !== GROUP_SIZE || gameOver || busy;
        shuffleBtn.disabled = gameOver || busy;
        deselectBtn.disabled = selected.length === 0 || gameOver || busy;
    }

    function toggleTile(word) {
        if (gameOver || busy) return;
        startTimer();
        if (selected.includes(word)) {
            selected = selected.filter((w) => w !== word);
        } else if (selected.length < GROUP_SIZE) {
            selected.push(word);
        }
        setMessage('');
        renderGrid();
    }

    function markSolved(gi) {
        solved.push(gi);
        const words = new Set(groups[gi].words.map((w) => w.toUpperCase()));
        tiles = tiles.filter((w) => !words.has(w));
        renderSolvedGroup(gi);
    }

    function shakeSelected() {
        gridEl.querySelectorAll('.cx-tile.selected').forEach((el) => el.classList.add('shake'));
        busy = true;
        renderGrid();
        // renderGrid() rebuilt the tiles, so re-apply the shake to the fresh selected ones.
        gridEl.querySelectorAll('.cx-tile.selected').forEach((el) => el.classList.add('shake'));
        later(() => {
            busy = false;
            renderGrid();
        }, 450);
    }

    function submitGuess() {
        if (gameOver || busy || selected.length !== GROUP_SIZE) return;

        const indexes = selected.map((w) => wordToGroup.get(w));
        const key = selected.slice().sort().join('|');
        const counts = {};
        indexes.forEach((gi) => { counts[gi] = (counts[gi] || 0) + 1; });
        const [topGroup, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

        if (topCount === GROUP_SIZE) {
            guessHistory.push(indexes.slice().sort((a, b) => a - b));
            selected = [];
            markSolved(Number(topGroup));
            setMessage('');
            renderGrid();
            if (solved.length === groups.length) {
                gameOver = true;
                setMessage('You found every group!');
                renderGrid();
                later(() => finish(true), 900);
            }
            return;
        }

        if (previousGuessKeys.has(key)) {
            setMessage('Already guessed!');
            return;
        }
        previousGuessKeys.add(key);
        guessHistory.push(indexes.slice().sort((a, b) => a - b));

        mistakes += 1;
        mistakesStatEl.textContent = `${mistakes}/${maxMistakes}`;
        renderLives();
        setMessage(topCount === GROUP_SIZE - 1 ? 'One away!' : 'Not quite.');

        if (mistakes >= maxMistakes) {
            gameOver = true;
            stopTimer();
            selected = [];
            busy = true;
            renderGrid();
            if (revealAnswersOnLoss) revealRemainingThenFinish();
            else later(() => finish(false), 700);
            return;
        }
        shakeSelected();
    }

    function revealRemainingThenFinish(extra = {}) {
        setMessage(extra.timedOut ? "Time's up! Here are the answers." : 'Out of mistakes! Here are the answers.');
        const remaining = groups.map((_, gi) => gi).filter((gi) => !solved.includes(gi));
        remaining.forEach((gi, i) => {
            later(() => {
                markSolved(gi);
                renderGrid();
            }, 600 * (i + 1));
        });
        later(() => finish(false, extra), 600 * remaining.length + 900);
    }

    function shuffleTiles() {
        if (gameOver || busy) return;
        tiles = shuffled(tiles);
        renderGrid();
    }

    function deselectAll() {
        if (gameOver || busy) return;
        selected = [];
        setMessage('');
        renderGrid();
    }

    function onPhysicalKeydown(e) {
        if (gameOver) return;
        if (e.key === 'Enter') submitGuess();
        else if (e.key === 'Escape') deselectAll();
    }

    shuffleBtn.addEventListener('click', shuffleTiles);
    deselectBtn.addEventListener('click', deselectAll);
    submitBtn.addEventListener('click', submitGuess);
    document.addEventListener('keydown', onPhysicalKeydown);

    function stopTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
    }

    function startTimer() {
        if (timerInterval || gameOver) return;
        if (timeLimitSeconds) {
            let remaining = timeLimitSeconds;
            timerInterval = setInterval(() => {
                remaining -= 1;
                elapsedSeconds = timeLimitSeconds - Math.max(remaining, 0);
                if (remaining <= 0) {
                    stopTimer();
                    if (!gameOver) {
                        gameOver = true;
                        selected = [];
                        busy = true;
                        renderGrid();
                        setMessage("Time's up!");
                        if (revealAnswersOnLoss) revealRemainingThenFinish({ timedOut: true });
                        else later(() => finish(false, { timedOut: true }), 700);
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

    // A countdown is a real time-attack constraint, so it starts the moment the round mounts;
    // the Daily/Classic stopwatch instead starts on the first tile tap (see toggleTile).
    if (timeLimitSeconds) startTimer();

    function cleanup() {
        document.removeEventListener('keydown', onPhysicalKeydown);
        stopTimer();
        pendingTimeouts.forEach((id) => clearTimeout(id));
        pendingTimeouts.clear();
    }

    function finish(won, extra = {}) {
        cleanup();
        onComplete({
            won,
            mistakes,
            guessHistory: guessHistory.slice(),
            solvedOrder: solved.slice(),
            timeTakenSeconds: elapsedSeconds,
            timedOut: Boolean(extra.timedOut),
        });
    }

    renderLives();
    renderGrid();

    return { destroy: cleanup };
}
