// Site-wide smoke test against the local emulators (hosting on :5002 by default), in the system
// Google Chrome: signs in as a guest, then opens home, every game page (each tab), leaderboard and
// profile, and fails on any page error / console error or a page that never leaves "Loading".
// Setup as in tools/pounce-e2e-test.mjs.   node tools/site-smoke-test.mjs [hostingPort=5002]
import puppeteer from 'puppeteer-core';

const site = `http://127.0.0.1:${process.argv[2] || 5002}`;
const log = [];
const check = (cond, msg) => { const l = `${cond ? 'PASS' : 'FAIL'} ${msg}`; log.push(l); console.log(l); };
const NOISE = /Could not reach Cloud Firestore backend|favicon|googlesyndication|adsbygoogle|google-analytics|googletagmanager|facebook|fbevents|ERR_BLOCKED|net::ERR/;

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 120000 });
const page = await browser.newPage();
await page.setViewport({ width: 400, height: 860 });
let errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', async (m) => {
    if (m.type() !== 'error') return;
    const parts = await Promise.all(m.args().map((a) => a.evaluate((v) => (v instanceof Error ? v.message : String(v))).catch(() => '')));
    const text = parts.join(' ') || m.text();
    if (!NOISE.test(text)) errors.push(text);
});

await page.goto(`${site}/?redirect=%2Fleaderboard`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#cookie-banner-decline', { visible: true, timeout: 15000 }).then(() => page.$eval('#cookie-banner-decline', (el) => el.click())).catch(() => {});
await page.waitForSelector('#guest-name', { visible: true, timeout: 60000 });
await page.type('#guest-name', `Smoke${Date.now() % 100000}`);
await page.click('#guest-submit');
await page.waitForFunction(() => location.pathname === '/leaderboard', { timeout: 60000 });

const settled = (sel) => page.waitForFunction((s) => { const el = document.querySelector(s); return el && !/Loading/.test(el.innerText); }, { timeout: 90000 }, sel);
async function visit(path, sel, label, after) {
    errors = [];
    await page.goto(`${site}${path}`, { waitUntil: 'domcontentloaded' });
    const ok = await settled(sel).then(() => true).catch(() => false);
    if (ok && after) await after();
    check(ok && errors.length === 0, `${label}${ok ? '' : ' (never finished loading)'}${errors.length ? `: ${errors.join(' | ')}` : ''}`);
}
const tabs = async (selector) => {
    for (const mode of await page.$$eval(selector, (els) => els.map((e) => e.dataset.mode))) {
        await page.click(`${selector}[data-mode="${mode}"]`);
        await settled('#game-mount').catch(() => errors.push(`tab ${mode} never finished loading`));
    }
};

await visit('/', '#game-grid', 'home (6 tiles)', async () => {
    const n = await page.$$eval('#game-grid .game-tile', (els) => els.length);
    if (n !== 6) errors.push(`expected 6 game tiles, saw ${n}`);
});
for (const game of ['wordle', 'sudoku', 'wordsearch', 'connections', 'quilt', 'pounce']) {
    await visit(`/${game}`, '#game-mount', `${game}: every mode tab`, () => tabs(`.${game === 'connections' ? 'cx' : game}-mode-tab`).catch(() => {}));
}
await visit('/leaderboard', '.content', 'leaderboard (Pounce in the picker)', async () => {
    if (!(await page.$('#lb-game-select option[value="pounce"]'))) errors.push('no Pounce option');
});
await visit('/profile', '#profile-history', 'profile (Cat Café panel present)', async () => {
    if (!(await page.$('#profile-cafe'))) errors.push('no Cat Café panel');
});

await browser.close();
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
