// End-to-end checks for Pounce Classic, Zen and the Nine Lives Run against the local Firebase
// emulators, in the system Google Chrome. Same setup as tools/pounce-e2e-test.mjs (see its header):
// emulators running, then `node tools/pounce-emulator-seed.mjs`, then
//   node tools/pounce-e2e-modes-test.mjs <screenshot-dir> [hostingPort=5002]
// The seed sets Run settings to 3 lives / 20 s so a timeout and running out of lives are quick.
// Each board's answer is found by matching the page's region colours against the seeded boards.
import puppeteer from 'puppeteer-core';
import { REGION_COLOURS } from '../src/js/games/pounce/pounce-engine.js';

const out = process.argv[2] ?? '.';
const site = `http://127.0.0.1:${process.argv[3] || 5002}`;
const fsBase = 'http://127.0.0.1:8080/v1/projects/playdailymindchallenge/databases/(default)/documents';
const NAME = `Modes${Date.now() % 100000}`;
const log = [];
const check = (cond, msg) => { const l = `${cond ? 'PASS' : 'FAIL'} ${msg}`; log.push(l); console.log(l); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Firestore (emulator, owner bypass) helpers -----------------------------------------------
const val = (f) => {
    if (!f) return undefined;
    if (f.integerValue !== undefined) return Number(f.integerValue);
    if (f.booleanValue !== undefined) return f.booleanValue;
    if (f.stringValue !== undefined) return f.stringValue;
    if (f.arrayValue) return (f.arrayValue.values || []).map(val);
    if (f.mapValue) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, val(v)]));
    return null;
};
const fsList = async (coll) => ((await (await fetch(`${fsBase}/${coll}?pageSize=500`, { headers: { Authorization: 'Bearer owner' } })).json()).documents || [])
    .map((d) => ({ id: d.name.split('/').pop(), ...val({ mapValue: { fields: d.fields } }) }));

const boards = [
    ...(await fsList('pounceClassicPuzzles')),
    ...(await fsList('pounceTournaments')).flatMap((t) => t.boards),
];
const colourKey = (p) => p.regions.join('').split('').map((d) => REGION_COLOURS[Number(d)].colour.toLowerCase()).join(',');
const byKey = new Map(boards.map((b) => [colourKey(b), b]));

// ---- Browser ---------------------------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 60000 });
const page = await browser.newPage();
await page.setViewport({ width: 400, height: 860, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Could not reach Cloud Firestore backend|favicon|googlesyndication|adsbygoogle|google-analytics|googletagmanager|facebook|fbevents|ERR_BLOCKED|net::ERR/.test(m.text())) errors.push(m.text()); });

const settle = () => page.waitForFunction(() => !/Loading/.test(document.querySelector('#game-mount')?.innerText || 'Loading'), { timeout: 60000 });
const mountText = () => page.$eval('#game-mount', (el) => el.innerText);
const cellSel = (i) => `#pounce-round-mount .pn-cell[data-idx="${i}"]`;
const tap = async (i) => { await (await page.$(cellSel(i))).click(); await wait(120); };
async function currentBoard() {
    await page.waitForSelector('#pounce-round-mount .pn-cell', { timeout: 60000 });
    await wait(1500); // the mount auto-scroll
    const key = await page.$$eval('#pounce-round-mount .pn-cell', (els) => els.map((el) => el.style.getPropertyValue('--pn-region').trim().toLowerCase()).join(','));
    const b = byKey.get(key);
    if (!b) throw new Error('board on the page matches no seeded board');
    return b;
}
const cats = (b) => b.solution.map((x, y) => y * b.size + x);
const wrongCell = (b, skip = []) => {
    const sol = new Set(cats(b));
    const fixed = new Set([...b.dogs, ...b.pawprints].map((c) => c.y * b.size + c.x));
    return [...Array(b.size * b.size).keys()].find((i) => !sol.has(i) && !fixed.has(i) && !skip.includes(i));
};
async function solve(b) {
    for (const i of cats(b)) {
        const has = await page.$eval(cellSel(i), (el) => !!el.querySelector('.pn-cat')).catch(() => true);
        if (!has) await tap(i);
    }
}
const pen = async () => { if (!(await page.$eval('[data-pn-catpen]', (el) => el.checked))) await page.click('[data-pn-catpen]'); };
const myScores = async (gameType) => (await fsList('gameScores')).filter((d) => d.displayName === NAME && d.gameType === gameType);
const closeModal = async () => { await page.click('#pounce-summary-close'); await wait(300); };

// Sign in as a guest (declining cookies: the banner covers the board's bottom rows on a phone).
await page.goto(`${site}/pounce?tab=classic`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#cookie-banner-decline', { visible: true, timeout: 15000 }).then(() => page.click('#cookie-banner-decline')).catch(() => {});
await settle();
await page.click('#game-mount a.btn');
await page.waitForSelector('#guest-name', { visible: true, timeout: 30000 });
await page.type('#guest-name', NAME);
await page.click('#guest-submit');
await page.waitForSelector('.pounce-difficulty-btn', { timeout: 60000 });
check(page.url().endsWith('/pounce?tab=classic'), 'sign-in returns to the Classic tab');

// ---- Classic: Easy, Purrfect -----------------------------------------------------------------
check((await mountText()).includes('up to 20 pts'), 'classic picker: Easy shows "up to 20 pts" (8 + 8 + 4)');
await page.click('[data-difficulty="easy"]');
let b = await currentBoard();
check(b.size === 6 && b.difficulty === 'easy', 'classic: Easy serves a 6×6 board');
const firstKey = colourKey(b);
await pen();
await solve(b);
await page.waitForSelector('#pounce-summary-modal', { timeout: 60000 });
await wait(500);
let modal = await page.$eval('#pounce-summary-modal', (el) => el.innerText);
check(/Purrfect/.test(modal) && /Total Score\s*\+20/.test(modal), 'classic: Purrfect Easy solve scores +20');
await page.screenshot({ path: `${out}/m1-classic-summary.png` });
let docs = await myScores('pounce-classic');
check(docs.length === 1 && docs[0].score === 20 && docs[0].difficulty === 'easy' && docs[0].perfect === true && docs[0].scoreDate?.length === 10,
    'classic: gameScores pounce-classic doc (score 20, easy, perfect, scoreDate)');
await closeModal();
check(!!(await page.$('#pounce-classic-again-btn')), 'classic: "Next Easy Board" offered after closing');
await page.click('#pounce-classic-again-btn');
b = await currentBoard();
check(colourKey(b) !== firstKey && b.difficulty === 'easy', 'classic: the next board is a different (unplayed) Easy board');

// ---- Zen -------------------------------------------------------------------------------------
await page.click('.pounce-mode-tab[data-mode="zen"]');
await page.waitForSelector('.pounce-difficulty-btn', { timeout: 30000 });
check(!(await mountText()).includes('pts'), 'zen picker: no points shown');
await page.click('[data-difficulty="hard"]');
b = await currentBoard();
check(b.size === 9 && b.pawprints.length >= 2, 'zen: Hard serves a 9×9 board with pawprints');
check(!(await page.$('[data-pn-time]')), 'zen: no clock');
await pen();
await tap(wrongCell(b));
await wait(500);
await page.click('[data-pn-tip]');
await solve(b);
await page.waitForSelector('#pounce-zen-next-btn', { timeout: 30000 });
check(!(await page.$('#pounce-summary-modal')), 'zen: no score popup');
check((await myScores('pounce-classic')).length === 1, 'zen: nothing written to gameScores');
await page.screenshot({ path: `${out}/m2-zen-done.png`, fullPage: true });

// ---- Nine Lives Run A: hiss, timeout, out of lives ------------------------------------------
await page.click('.pounce-mode-tab[data-mode="tournament"]');
await page.waitForSelector('[data-play-pounce-run="run-a"]', { timeout: 60000 });
check((await mountText()).includes('3 lives'), 'run list: explains the run with 3 lives (seeded settings)');
await page.screenshot({ path: `${out}/m3-run-list.png`, fullPage: true });
await page.click('[data-play-pounce-run="run-a"]');
b = await currentBoard();
check(b.size === 5, 'run A board 1 is 5×5');
check((await page.$eval('.pounce-run-lives', (el) => el.innerText)).includes('3'), 'run strip shows 3 lives');
await pen();
await tap(wrongCell(b));
await wait(2500);
const attemptA = async () => (await fsList('pounceTournamentAttempts')).find((a) => a.displayName === NAME && a.tournamentId === 'run-a');
check((await attemptA())?.livesLeft === 2, 'run: a wrong cat saves the lost life at once (attempt livesLeft 2)');
await solve(b);
await page.waitForSelector('#pounce-run-next-btn', { timeout: 60000 });
check((await mountText()).includes('+30 points, 1 life lost'), 'run: board 1 solved, +30, 1 life lost');
check(!(await mountText()).includes('Purrfect'), 'run: a board with a lost life is not Purrfect');
await page.screenshot({ path: `${out}/m4-run-board1.png`, fullPage: true });

await page.click('#pounce-run-next-btn');
b = await currentBoard();
check(b.size === 6, 'run A board 2 is 6×6; waiting out the 20 s clock');
await page.waitForSelector('#pounce-run-next-btn', { timeout: 60000 });
check((await mountText()).includes('ran out of time (+10 points, 1 life lost)'), 'run: board 2 timed out, +10, 1 life lost');

await page.click('#pounce-run-next-btn');
b = await currentBoard();
await pen();
await tap(wrongCell(b));
await page.waitForSelector('#pounce-summary-modal', { timeout: 60000 });
await wait(600);
modal = await page.$eval('#pounce-summary-modal', (el) => el.innerText);
check(modal.includes('Out of lives!') && /Total Score\s*\+50/.test(modal), 'run: last life lost on board 3 ends the run, total +50 (30 + 10 + 10)');
await page.screenshot({ path: `${out}/m5-run-out-of-lives.png` });
let a = await attemptA();
check(a?.completed === true && a.livesLeft === 0 && a.currentPuzzleIndex === 3, 'run: attempt completed with 0 lives after 3 boards');
let bonus = (await myScores('pounce-tournament-bonus')).find((d) => d.tournamentId === 'run-a');
check(bonus && bonus.score === 0 && bonus.finished === false, 'run: bonus doc written with 0 (no completion bonus when out of lives)');
check((await myScores('pounce-tournament')).filter((d) => d.tournamentId === 'run-a').map((d) => d.score).sort().join() === '10,10,30', 'run: board docs 30 + 10 + 10');
// Share on the run's bonus doc (+10 via the rules).
await page.click('#pounce-share-friends-btn').catch(() => {});
await wait(3000);
for (const p of await browser.pages()) if (p !== page && p.url() !== 'about:blank') await p.close().catch(() => {});
await page.bringToFront();
bonus = (await myScores('pounce-tournament-bonus')).find((d) => d.tournamentId === 'run-a');
log.push(`INFO share with friends on the run: ${bonus?.sharedWithFriends ? 'applied (+10)' : 'not triggered in headless Chrome (no share sheet)'}`);
await closeModal().catch(() => {});

// ---- Nine Lives Run B: all five boards, perfect ---------------------------------------------
await page.click('.pounce-mode-tab[data-mode="tournament"]');
await page.waitForSelector('[data-play-pounce-run="run-b"]', { timeout: 60000 });
check(await page.$eval('[data-play-pounce-run="run-a"]', (el) => el.disabled && el.textContent.includes('Completed')), 'run list: Run A now shows Completed');
await page.click('[data-play-pounce-run="run-b"]');
for (let i = 0; i < 5; i++) {
    b = await currentBoard();
    await pen();
    await solve(b);
    if (i < 4) {
        await page.waitForSelector('#pounce-run-next-btn', { timeout: 60000 });
        await page.click('#pounce-run-next-btn');
    }
}
await page.waitForSelector('#pounce-summary-modal', { timeout: 60000 });
await wait(600);
modal = await page.$eval('#pounce-summary-modal', (el) => el.innerText);
check(modal.includes('Nine Lives Run complete!') && /Total Score\s*\+265/.test(modal), 'run B: all 5 solved = 150 + 100 bonus + 3 lives × 5 = +265');
await page.screenshot({ path: `${out}/m6-run-complete.png` });
bonus = (await myScores('pounce-tournament-bonus')).find((d) => d.tournamentId === 'run-b');
check(bonus && bonus.score === 115 && bonus.finished === true && bonus.livesLeft === 3, 'run B: bonus doc 115 (100 + 15), finished, 3 lives');
await closeModal();

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
