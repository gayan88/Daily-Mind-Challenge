// End-to-end Daily Pounce check against the local Firebase emulators, in the system Google Chrome:
// signed-out page, guest sign-in, a Daily solve with one hiss + one tip, the summary popup, the
// gameScores doc, the +20 share update (firestore.rules), the already-played view, leaderboard,
// profile and the home tile.
// Setup: `cd tools && npm i --no-save puppeteer-core@23.11.1` (as for pounce-browser-test.mjs) and
// Java for the Firestore emulator. Then, from the repo root:
//   firebase emulators:start --only firestore,auth,hosting --project playdailymindchallenge
//   node tools/pounce-emulator-seed.mjs
//   node tools/pounce-e2e-test.mjs <screenshot-dir> [hostingPort=5002]
// Known emulator quirks (also hit by Quilt): pages load ~25 s slowly after the home page, and a
// session restored after visiting the home page sometimes comes back signed out, so the home
// check runs last and can flake. Accepting cookies loads ad/analytics scripts that freeze
// headless Chrome on localhost, so the test declines the banner.
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? '.';
const site = `http://127.0.0.1:${process.argv[3] || 5002}`;
const fsBase = 'http://127.0.0.1:8080/v1/projects/playdailymindchallenge/databases/(default)/documents';
const log = [];
const check = (cond, msg) => { const l = `${cond ? 'PASS' : 'FAIL'} ${msg}`; log.push(l); console.log(l); };
const NAME = `Tester${Date.now() % 100000}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The local emulator answers slowly after the home page (~25 s, the same for live Quilt), so every
// page waits for its real content rather than a fixed time.
const settle = (p) => p.waitForFunction(() => !/Loading/.test(document.querySelector('#game-mount')?.innerText || 'Loading'), { timeout: 60000 });

async function fsGet(path) {
    const res = await fetch(`${fsBase}/${path}`, { headers: { Authorization: 'Bearer owner' } });
    return res.ok ? res.json() : null;
}
const val = (f) => f && (f.integerValue !== undefined ? Number(f.integerValue) : f.stringValue ?? f.booleanValue ?? f.arrayValue?.values?.map(val));

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 30000 });

const page = await browser.newPage();
await page.setViewport({ width: 400, height: 860, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Could not reach Cloud Firestore backend|favicon|googlesyndication|adsbygoogle|google-analytics|googletagmanager|facebook|fbevents|ERR_BLOCKED|net::ERR/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.dismiss());

// 1. Signed out: crawlable page with the sign-in prompt, How to Play example and FAQ.
await page.goto(`${site}/pounce`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#game-mount')?.textContent.includes('Sign in'), { timeout: 15000 });
check(await page.$eval('#game-mount', (el) => el.textContent.includes('Sign in or continue as a guest')), 'signed out: sign-in prompt shown');
// Decline the cookie banner (it covers the board's bottom rows on a phone; accepting loads ad/analytics scripts that freeze headless Chrome on localhost).
await page.waitForSelector('#cookie-banner-decline', { visible: true, timeout: 10000 }).then(() => page.click('#cookie-banner-decline')).catch(() => {});
check(await page.$$eval('#htp-pounce-example .pn-cat', (els) => els.length) === 5, 'How to Play example board shows 5 sleeping cats');
check(await page.$$eval('.faq-item', (els) => els.length) === 20, 'FAQ has 20 questions');
await page.screenshot({ path: `${out}/e1-signed-out.png`, fullPage: true });

// 2. Guest sign-in on the home page; the Pounce tile is there.
await page.click('#game-mount a.btn');
await page.waitForSelector('#guest-name', { visible: true, timeout: 15000 });
await page.type('#guest-name', NAME);
await page.click('#guest-submit');
await page.waitForSelector('#pounce-round-mount .pn-cell', { timeout: 30000 });
check(page.url() === `${site}/pounce`, 'sign-in redirects back to /pounce with the Daily loaded');
// 3. Daily: one wrong cat, one tip, then solve.
await page.waitForSelector('#pounce-round-mount .pn-cell', { timeout: 5000 }).catch(async () => {
    console.log('DAILY DID NOT LOAD. game-mount says:', await page.$eval('#game-mount', (el) => el.innerText));
    console.log('errors so far:', errors.join(' | '));
    await page.screenshot({ path: `${out}/e-fail.png`, fullPage: true });
    process.exit(1);
});
check(await page.$eval('.pounce-title', (el) => el.textContent.trim()) === 'Daily Pounce #1', 'daily: title "Daily Pounce #1"');
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const pdoc = await fsGet(`pounceDailyPuzzles/${today}`);
const size = val(pdoc.fields.size);
const solution = val(pdoc.fields.solution);
const fixed = new Set((pdoc.fields.dogs.arrayValue.values || []).map((v) => Number(v.mapValue.fields.y.integerValue) * size + Number(v.mapValue.fields.x.integerValue)));
const sol = solution.map((x, y) => y * size + x);
const wrong = [...Array(size * size).keys()].find((i) => !sol.includes(i) && !fixed.has(i));
const tapCell = async (idx) => { await (await page.$(`#pounce-round-mount .pn-cell[data-idx="${idx}"]`)).click(); await wait(120); };
await wait(1500); // let the mount auto-scroll finish
await page.click('[data-pn-catpen]');
await tapCell(wrong);
await wait(500);
check(await page.$eval('[data-pn-mistakes]', (el) => el.textContent) === '1', 'daily: the wrong cat counted one hiss');
await page.click('[data-pn-tip]');
await page.screenshot({ path: `${out}/e2-daily-playing.png`, fullPage: true });
for (const idx of sol) {
    const has = await page.$eval(`#pounce-round-mount .pn-cell[data-idx="${idx}"]`, (el) => !!el.querySelector('.pn-cat'));
    if (!has) await tapCell(idx);
}

// 4. Summary modal.
await page.waitForSelector('#pounce-summary-modal', { timeout: 60000 }).catch(async () => {
    console.log('NO SUMMARY. cats:', await page.$eval('[data-pn-cats]', (el) => el.textContent), 'message:', await page.$eval('.pn-message', (el) => el.textContent));
    const l = await (await fetch(`${fsBase}/gameScores`, { headers: { Authorization: 'Bearer owner' } })).json();
    console.log('gameScores docs:', (l.documents || []).map((d) => d.name.split('/').pop()));
    console.log('errors:', errors.join(' | '));
    await page.screenshot({ path: `${out}/e-nosummary.png`, fullPage: true });
    process.exit(1);
});
await wait(600);
const modal = await page.$eval('#pounce-summary-modal', (el) => el.innerText);
check(modal.includes('Every cat found its spot!'), 'summary: title');
check(/You adopted .+!/.test(modal), `summary: adopted cat caption (${(modal.match(/You adopted [^\n]+/) || [''])[0]})`);
const adoptedName = (modal.match(/You adopted (\S+) the/) || [])[1];
check(modal.includes('−5'), 'summary: hisses & tips line shows −5 (1 hiss −2, 1 tip −3)');
check(/Total Score\s*\+15/.test(modal), 'summary: total +15 (10 + 10 speed − 5)');
await page.screenshot({ path: `${out}/e3-summary.png` });

const list = await (await fetch(`${fsBase}/gameScores`, { headers: { Authorization: 'Bearer owner' } })).json();
const mine = (list.documents || []).find((d) => d.name.endsWith(`_pounce_${today}`) && val(d.fields.displayName) === NAME);
check(!!mine, 'firestore: gameScores {uid}_pounce_{date} written');
if (mine) {
    const f = mine.fields;
    check(val(f.score) === 15 && val(f.gameType) === 'pounce' && val(f.scoreDate) === today && val(f.gameDate) === today,
        `firestore: score 15, gameType pounce, gameDate + scoreDate set`);
    check(val(f.mistakes) === 1 && val(f.tips) === 1 && f.perfect.booleanValue === false && f.sharedToFacebook.booleanValue === false && f.sharedWithFriends.booleanValue === false,
        'firestore: mistakes 1, tips 1, not perfect, both share flags false');
}

// 5. Share with Community -> +20 through the new rule.
await page.click('#pounce-share-community-btn');
await page.waitForFunction(() => /Total Score\s*\+35/.test(document.querySelector('#pounce-summary-modal')?.innerText || ''), { timeout: 60000 }).catch(() => {});
for (const p of await browser.pages()) if (p !== page && p.url() !== 'about:blank') await p.close().catch(() => {});
await page.bringToFront();
const modalAfter = await page.$eval('#pounce-summary-modal', (el) => el.innerText).catch(() => '');
check(/Total Score\s*\+35/.test(modalAfter), 'share: community bonus applied, total +35');
const after = await (await fetch(`${fsBase}/${mine.name.split('/documents/')[1]}`, { headers: { Authorization: 'Bearer owner' } })).json();
check(val(after.fields.score) === 35 && after.fields.sharedToFacebook.booleanValue === true, 'firestore: share update allowed by rules (score 35, sharedToFacebook true)');
await page.click('#pounce-summary-close');

// 6. Already played.
await page.goto(`${site}/pounce`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.pounce-played-board', { timeout: 60000 });
check(await page.$eval('#game-mount', (el) => el.textContent.includes('You already solved today')), 'replay: already-played message');
check(await page.$$eval('.pounce-played-board .pn-cat', (els) => els.length) === size, 'replay: solved board shows every cat');
await page.screenshot({ path: `${out}/e4-already-played.png`, fullPage: true });

// 7. Exactly three mode tabs; switching tears the Daily view down and shows the Classic picker.
check((await page.$$eval('.pounce-mode-tab', (els) => els.map((e) => e.dataset.mode).join())) === 'daily,classic,tournament', 'tabs: Daily, Classic, Nine Lives Run (no Zen)');
await page.click('.pounce-mode-tab[data-mode="classic"]');
await page.waitForSelector('.pounce-difficulty-btn', { timeout: 30000 }).catch(() => {});
check((await page.$$('.pounce-difficulty-btn')).length === 3, 'classic tab: difficulty picker');

// 9. Leaderboard: Pounce option and the guest's row.
await page.goto(`${site}/leaderboard`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#lb-game-select option[value="quilt"]', { timeout: 60000 }).catch(() => {});
const hasOption = await page.$('#lb-game-select option[value="pounce"]');
check(!!hasOption, 'leaderboard: Pounce in the game picker');
if (hasOption) {
    await page.select('#lb-game-select', 'pounce');
    await page.waitForFunction((n) => document.querySelector('.content').innerText.includes(n), { timeout: 60000 }, NAME).catch(() => {});
    const lbText = await page.$eval('.content', (el) => el.innerText);
    check(lbText.includes(NAME) && lbText.includes('35'), 'leaderboard: guest listed with 35 points under Pounce');
    await page.screenshot({ path: `${out}/e6-leaderboard.png`, fullPage: true });
}

// 10. Profile: recent activity label + Cat Café.
await page.goto(`${site}/profile`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /Pounce/.test(document.querySelector('.content').innerText), { timeout: 60000 }).catch(() => {});
await wait(3000);
const profText = await page.$eval('.content', (el) => el.innerText);
check(/Pounce/.test(profText) && !/pounce-/.test(profText) && !/undefined/.test(profText), 'profile: shows "Pounce" (no raw gameType / undefined)');
const cafe = await page.$$eval('#profile-cafe .cafe-cat-name', (els) => els.map((e) => e.textContent));
check(cafe.length === 1 && cafe[0] === adoptedName, `profile: Cat Café shows the adopted cat (${cafe.join(', ')} vs ${adoptedName})`);
await page.screenshot({ path: `${out}/e7-profile.png`, fullPage: true });

// 8. Home tile marked done.
await page.goto(`${site}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#tile-pounce')?.classList.contains('completed'), { timeout: 60000 }).catch(() => {});
check(!!(await page.$('#tile-pounce img[src="/assets/images/tile-pounce-wide.png"]')), 'home: Pounce tile with its logo');
check(await page.$eval('#tile-pounce', (el) => el.classList.contains('completed')), 'home: Pounce tile marked done');
await page.screenshot({ path: `${out}/e5-home.png`, fullPage: true });

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
