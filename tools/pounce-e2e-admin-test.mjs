// End-to-end check of Admin → Pounce against the local Firebase emulators, in the system Google
// Chrome: Generate + Add Daily boards (with a start date), Regenerate, Classic Generate + Add +
// Delete, JSON import (incl. a broken board), Nine Lives Run create + bulk create + activate, the
// Run settings form. (Players reading this content is covered by pounce-e2e-modes-test.mjs.)
// Setup as in tools/pounce-e2e-test.mjs. It WIPES the local emulator database first (no seed needed):
//   node tools/pounce-e2e-admin-test.mjs <screenshot-dir> [hostingPort=5002]
// The admin account is made by signing up, then setting isAdmin through the emulator's owner bypass
// (the same manual step as the README's "bootstrapping the first admin").
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? '.';
const site = `http://127.0.0.1:${process.argv[3] || 5002}`;
const fsBase = 'http://127.0.0.1:8080/v1/projects/playdailymindchallenge/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };
const USER = `admin${Date.now() % 100000}`;
const log = [];
const check = (cond, msg) => { const l = `${cond ? 'PASS' : 'FAIL'} ${msg}`; log.push(l); console.log(l); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const val = (f) => {
    if (!f) return undefined;
    if (f.integerValue !== undefined) return Number(f.integerValue);
    if (f.booleanValue !== undefined) return f.booleanValue;
    if (f.stringValue !== undefined) return f.stringValue;
    if (f.nullValue !== undefined) return null;
    if (f.arrayValue) return (f.arrayValue.values || []).map(val);
    if (f.mapValue) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, val(v)]));
    return null;
};
const fsList = async (coll) => ((await (await fetch(`${fsBase}/${coll}?pageSize=1000`, { headers: OWNER })).json()).documents || [])
    .map((d) => ({ id: d.name.split('/').pop(), ...val({ mapValue: { fields: d.fields } }) }));
const fsGet = async (path) => { const r = await fetch(`${fsBase}/${path}`, { headers: OWNER }); return r.ok ? val({ mapValue: { fields: (await r.json()).fields } }) : null; };
// Start from an EMPTY local emulator database (the emulator's clear-all endpoint -- local data
// only), so the "first board needs a start date" path runs. Re-run the seed script afterwards if
// you want the other tests' data back.
await fetch('http://127.0.0.1:8080/emulator/v1/projects/playdailymindchallenge/databases/(default)/documents', { method: 'DELETE' });

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 120000 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// Errors the page logs on purpose before showing them as a toast (an expected refusal) are allowed.
const EXPECTED = /already in the Classic pool/;
page.on('console', async (m) => {
    if (m.type() !== 'error') return;
    const parts = await Promise.all(m.args().map((a) => a.evaluate((v) => (v instanceof Error ? v.message : String(v))).catch(() => '')));
    const text = parts.join(' ') || m.text();
    if (EXPECTED.test(text) || /Could not reach Cloud Firestore backend|favicon|googlesyndication|adsbygoogle|google-analytics|googletagmanager|facebook|fbevents|ERR_BLOCKED|net::ERR/.test(text)) return;
    errors.push(text);
});
page.on('dialog', (d) => d.accept());
const toastText = () => page.$eval('.toast', (el) => el.textContent).catch(() => '');

// ---- Sign up, become admin -------------------------------------------------------------------
await page.goto(`${site}/?redirect=%2Fadmin`, { waitUntil: 'domcontentloaded' });
// Decline via the element itself: a positional click lands on the sign-in modal's backdrop and closes it.
await page.waitForSelector('#cookie-banner-decline', { visible: true, timeout: 15000 }).then(() => page.$eval('#cookie-banner-decline', (el) => el.click())).catch(() => {});
await page.waitForSelector('#tab-signup', { visible: true, timeout: 60000 });
await page.click('#tab-signup');
await page.type('#signup-username', USER);
await page.type('#signup-displayname', 'Pounce Admin');
await page.type('#signup-password', 'TestPassword123');
await page.click('#signup-submit');
let uid = null;
for (let i = 0; i < 60 && !uid; i++) {
    await wait(1000);
    uid = (await fsList('registeredUsers')).find((u) => u.username === USER || u.usernameLower === USER)?.id || null;
}
check(!!uid, 'registered account created');
await fetch(`${fsBase}/registeredUsers/${uid}?updateMask.fieldPaths=isAdmin`, { method: 'PATCH', headers: { ...OWNER, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { isAdmin: { booleanValue: true } } }) });

await page.goto(`${site}/admin`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pounce-admin-root #pa-daily-generate-btn', { timeout: 90000 });
await page.waitForFunction(() => !document.querySelector('#pa-daily-table .loading-text'), { timeout: 90000 });
check(true, 'admin page renders the Pounce section');
await page.evaluate(() => {
    const header = [...document.querySelectorAll('.admin-section-header')].find((b) => b.textContent.trim() === 'Pounce');
    header.click();
});
check(await page.$eval('#pa-daily-start-field', (el) => !el.hidden), 'daily: start-date field shown while the pool is empty');
await page.waitForSelector('#pounce-tournament-settings-form input', { timeout: 60000 });
check(true, 'run settings form rendered inside the section');

// ---- Daily: generate 365, add from a start date ----------------------------------------------
await page.$eval('#pa-daily-count', (el) => { el.value = '365'; });
const t0 = Date.now();
await page.click('#pa-daily-generate-btn');
await page.waitForSelector('#pa-daily-add', { timeout: 120000 });
const genSeconds = (Date.now() - t0) / 1000;
const preview = await page.$eval('#pa-daily-preview', (el) => el.innerText);
check(preview.includes('365 Medium 8×8 boards ready') && preview.includes('Hardest step needed'), `daily: 365 boards generated in ${genSeconds.toFixed(1)} s with a grade summary`);
check((await page.$$('#pa-daily-preview .pa-thumb')).length === 12, 'daily: 12 sample thumbnails');
await page.screenshot({ path: `${out}/a1-daily-preview.png` });
await page.$eval('#pa-daily-start', (el) => { el.value = '2026-11-01'; });
await page.click('#pa-daily-add');
await page.waitForFunction(() => !document.querySelector('#pa-daily-add'), { timeout: 120000 });
await wait(1500);
const meta = await fsGet('pounceDailyPuzzles/_meta');
check(meta?.totalCount === 365 && meta.firstDate === '2026-11-01' && meta.lastDate === '2027-10-31', `daily: _meta 365 boards, 2026-11-01 → 2027-10-31 (${JSON.stringify(meta)})`);
const first = await fsGet('pounceDailyPuzzles/2026-11-01');
check(first?.challengeNumber === 1 && first.size === 8 && first.difficulty === 'medium' && first.solution?.length === 8, 'daily: 2026-11-01 is Challenge #1, a medium 8×8 with its solution');
await page.waitForFunction(() => document.querySelector('#pa-daily-table')?.innerText.includes('365 Daily boards'), { timeout: 60000 });
check(await page.$eval('#pa-daily-start-field', (el) => el.hidden), 'daily: start-date field hidden once seeded');

// Add 5 more: they continue the calendar.
await page.$eval('#pa-daily-count', (el) => { el.value = '5'; });
await page.click('#pa-daily-generate-btn');
await page.waitForSelector('#pa-daily-add', { timeout: 60000 });
await page.click('#pa-daily-add');
await page.waitForFunction(() => !document.querySelector('#pa-daily-add'), { timeout: 60000 });
await wait(1500);
check((await fsGet('pounceDailyPuzzles/_meta'))?.lastDate === '2027-11-05', 'daily: a second batch continues from the last date (→ 2027-11-05)');

// Regenerate one: same date + number, new board.
await page.evaluate(() => document.querySelectorAll('#pa-daily-table .admin-subsection-header').forEach((h) => h.click()));
const before = JSON.stringify((await fsGet('pounceDailyPuzzles/2026-11-01')).regions);
await page.click('#pa-daily-table [data-pa-regen="2026-11-01"]');
await page.waitForFunction(() => /regenerated/.test(document.querySelector('.toast')?.textContent || ''), { timeout: 60000 }).catch(() => {});
await wait(1000);
const after = await fsGet('pounceDailyPuzzles/2026-11-01');
check(after.challengeNumber === 1 && JSON.stringify(after.regions) !== before, 'daily: Regenerate swaps the board, keeps date and #1');

// ---- Classic: 10 Hard, then delete one ------------------------------------------------------
await page.select('#pa-classic-difficulty', 'hard');
await page.$eval('#pa-classic-count', (el) => { el.value = '10'; });
await page.click('#pa-classic-generate-btn');
await page.waitForSelector('#pa-classic-add', { timeout: 60000 });
check((await page.$eval('#pa-classic-preview', (el) => el.innerText)).includes('10 Hard 9×9 boards ready'), 'classic: 10 Hard boards generated');
await page.click('#pa-classic-add');
await page.waitForFunction(() => !document.querySelector('#pa-classic-add'), { timeout: 60000 });
await wait(1500);
let classic = (await fsList('pounceClassicPuzzles')).filter((d) => d.id !== '_meta');
check(classic.length === 10 && classic.every((d) => d.difficulty === 'hard' && d.size === 9 && d.pawprints.length >= 2), 'classic: 10 hard 9×9 docs with pawprints');
await page.waitForSelector('#pa-classic-table [data-pa-delete="1"]', { timeout: 30000 });
await page.click('#pa-classic-table [data-pa-delete="1"]');
await wait(2500);
classic = (await fsList('pounceClassicPuzzles')).filter((d) => d.id !== '_meta');
check(classic.length === 9 && !classic.some((d) => d.id === '1'), 'classic: Delete removes board #1');

// ---- JSON import: a valid batch and a broken board ------------------------------------------
const good = classic.slice(0, 2).map(({ size, regions, solution, dogs, pawprints }) => ({ size, regions, solution, dogs, pawprints, difficulty: 'easy' }));
await page.evaluate(() => { const h = [...document.querySelectorAll('#pounce-admin-root .pa-import .admin-subsection-header')][1]; h.click(); });
const broken = [{ ...good[0], solution: [0, 0, 0, 0, 0, 0, 0, 0, 0] }];
await page.$eval('#pa-classic-json', (el, v) => { el.value = v; }, JSON.stringify(broken));
await page.click('#pa-classic-import-btn');
await wait(800);
check((await page.$eval('#pa-classic-preview', (el) => el.innerText)).includes('0 of 1 boards valid'), 'import: a broken board is rejected with its error');
check(!(await page.$('#pa-classic-add')), 'import: no Add button for an invalid batch');
await page.$eval('#pa-classic-json', (el, v) => { el.value = v; }, JSON.stringify(good));
await page.click('#pa-classic-import-btn');
await page.waitForSelector('#pa-classic-add', { timeout: 30000 });
await page.click('#pa-classic-add');
await wait(2500);
check((await toastText()).includes('already in the Classic pool'), 'import: boards already in the pool are refused (all-or-nothing)');

// ---- Nine Lives Runs: one active run + 3 inactive, then activate one ------------------------
await page.type('#pa-run-name', 'Autumn Nap');
await page.click('#pa-run-preview-btn');
await page.waitForFunction(() => !document.querySelector('#pa-run-create').disabled, { timeout: 60000 });
check((await page.$$('#pa-run-preview .pa-thumb')).length === 5, 'run: preview shows 5 boards');
await page.screenshot({ path: `${out}/a2-run-preview.png` });
await page.click('#pa-run-create');
await wait(2500);
await page.$eval('#pa-bulk-count', (el) => { el.value = '3'; });
await page.click('#pa-bulk-generate-btn');
await page.waitForSelector('#pa-bulk-create', { timeout: 60000 });
await page.click('#pa-bulk-create');
await wait(3000);
let runs = await fsList('pounceTournaments');
const autumn = runs.find((r) => r.name === 'Autumn Nap');
check(runs.length === 4 && autumn?.active === true && autumn.boards.map((b) => b.size).join() === '5,6,7,8,9' && autumn.completionBonus === 100,
    'runs: "Autumn Nap" active with 5 boards 5→9 and +100; 3 more created');
check(runs.filter((r) => r.name.startsWith('Nine Lives Run ')).every((r) => r.active === false), 'runs: bulk runs start inactive');
const bulk1 = runs.find((r) => r.name === 'Nine Lives Run 1');
await page.click(`[data-toggle-pa-run="${bulk1.id}"]`);
await wait(2000);
check((await fsGet(`pounceTournaments/${bulk1.id}`))?.active === true, 'runs: Activate turns a run on');

// ---- Settings form -------------------------------------------------------------------------
const settingsInputs = await page.$$('#pounce-tournament-settings-form input');
check(settingsInputs.length === 2, 'settings: two fields (seconds per board, lives)');
await page.screenshot({ path: `${out}/a3-admin-section.png`, fullPage: false });

await browser.close();
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
