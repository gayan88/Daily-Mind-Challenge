// Pounce engine browser checks: drives tools/pounce-preview.html in the system Google Chrome with
// real mouse/keyboard input, checks every control and mode, and saves screenshots.
// One-time setup (tools/node_modules is git-ignored):
//   cd tools && npm i --no-save puppeteer-core@23.11.1
// Run (from the repo root, with `python3 -m http.server 8123 --bind 127.0.0.1` serving the repo):
//   node tools/pounce-browser-test.mjs <screenshot-dir>
// Prints PASS/FAIL per check; exits non-zero on any FAIL.
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? '.';
const base = 'http://127.0.0.1:8123/tools/pounce-preview.html';
const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
});
const log = [];
const check = (cond, msg) => log.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);

async function open(params, viewport) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}?${params}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.pn-cell');
    return { page, errors };
}

const center = async (page, idx) => {
    const box = await (await page.$(`.pn-cell[data-idx="${idx}"]`)).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const tapCell = async (page, idx) => { const c = await center(page, idx); await page.mouse.click(c.x, c.y); };
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
const cellHtml = (page, idx) => page.$eval(`.pn-cell[data-idx="${idx}"]`, (el) => el.innerHTML);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Phone, Hard, Daily: the full interaction set ------------------------------------------
{
    const { page, errors } = await open('difficulty=hard&mode=daily&seed=demo', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
    const p = await page.evaluate(() => window.__puzzle);
    const n = p.size;
    const sol = new Set(p.solution.map((x, y) => y * n + x));
    const fixed = new Set([...p.dogs, ...p.pawprints].map((c) => c.y * n + c.x));
    const free = [...Array(n * n).keys()].filter((i) => !fixed.has(i));
    const wrong = free.find((i) => !sol.has(i));
    await page.screenshot({ path: `${out}/1-phone-start.png`, fullPage: true });

    await tapCell(page, wrong);
    check((await cellHtml(page, wrong)).includes('pn-xmark'), 'tap on empty cell marks ✕');
    await tapCell(page, wrong);
    await wait(80);
    check((await cellHtml(page, wrong)).includes('pn-hiss'), 'second tap places a cat; wrong spot hisses');
    check(await text(page, '[data-pn-mistakes]') === '1', 'wrong cat counts one hiss');
    check((await text(page, '.pn-message')).startsWith('Hiss!'), 'hiss message shown');
    await wait(500);
    check((await cellHtml(page, wrong)).includes('pn-xmark'), 'wrong cat leaves a ✕ behind');
    check(await text(page, '[data-pn-time]') !== '' , 'timer shown');

    // Long-press a real cat spot.
    const right = [...sol][0];
    const c = await center(page, right);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await wait(600);
    await page.mouse.up();
    check((await cellHtml(page, right)).includes('pn-cat'), 'long-press places a cat on a right spot');
    check(await text(page, '[data-pn-cats]') === `1/${n}`, 'cat counter is 1');

    // Drag-paint ✕ across a row of free non-cat cells.
    const row = Math.floor(right / n) === 0 ? n - 1 : 0;
    const rowCells = [...Array(n).keys()].map((x) => row * n + x).filter((i) => !fixed.has(i) && !sol.has(i));
    if (rowCells.length >= 3) {
        const a = await center(page, rowCells[0]);
        const b = await center(page, rowCells[rowCells.length - 1]);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 12 });
        await page.mouse.up();
        const marked = [];
        for (const i of rowCells) marked.push((await cellHtml(page, i)).includes('pn-xmark'));
        check(marked.filter(Boolean).length >= 2, `drag paints ✕ (${marked.filter(Boolean).length}/${rowCells.length} cells between start and end)`);
    }

    // Undo the drag.
    await page.click('[data-pn-undo]');
    check(!(await cellHtml(page, rowCells[0])).includes('pn-xmark'), 'undo reverts the drag');

    // Whisker Tips.
    const tipsText = [];
    for (let i = 0; i < 4; i++) {
        await page.click('[data-pn-tip]');
        tipsText.push(await text(page, '.pn-tip-text'));
        if (i === 0) await page.screenshot({ path: `${out}/2-phone-tip.png`, fullPage: true });
    }
    check(tipsText.every((t) => t.length > 20), 'tips show sentences');
    check(await text(page, '[data-pn-tips]') === '4', 'tips counted');
    log.push(...tipsText.map((t) => `      tip: ${t}`));

    // Finish with "Tap places 🐱".
    await page.click('[data-pn-catpen]');
    for (const i of sol) await tapCell(page, i);
    await wait(300);
    await page.screenshot({ path: `${out}/3-phone-solved.png`, fullPage: true });
    await page.waitForFunction(() => window.__result, { timeout: 4000 });
    const result = await page.evaluate(() => window.__result);
    check(result.won && !result.perfect && result.mistakes === 1 && result.tips === 4, `onComplete fires once with the right result ${JSON.stringify(result)}`);
    check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
    await page.close();
}

// ---- Desktop, Medium, keyboard only, Purrfect ------------------------------------------------
{
    const { page, errors } = await open('difficulty=medium&mode=classic&seed=kbd', { width: 1280, height: 900 });
    const p = await page.evaluate(() => window.__puzzle);
    const n = p.size;
    await page.focus('.pn-cell[data-idx="0"]');
    let at = 0;
    for (let y = 0; y < n; y++) {
        const target = y * n + p.solution[y];
        while (at % n < target % n) { await page.keyboard.press('ArrowRight'); at++; }
        while (at % n > target % n) { await page.keyboard.press('ArrowLeft'); at--; }
        while (Math.floor(at / n) < y) { await page.keyboard.press('ArrowDown'); at += n; }
        await page.keyboard.press('Enter');
    }
    await page.waitForFunction(() => window.__result, { timeout: 4000 });
    const result = await page.evaluate(() => window.__result);
    check(result.won && result.perfect, `keyboard-only solve is Purrfect ${JSON.stringify(result)}`);
    await page.screenshot({ path: `${out}/4-desktop-solved.png` });
    check(errors.length === 0, `no console errors (desktop) ${errors.join(' | ')}`);
    await page.close();
}

// ---- Run: lives and out-of-lives; Zen: nothing counted ----------------------------------------
{
    const { page, errors } = await open('difficulty=easy&size=5&mode=run&seed=run&lives=2', { width: 390, height: 844 });
    const p = await page.evaluate(() => window.__puzzle);
    const n = p.size;
    const sol = new Set(p.solution.map((x, y) => y * n + x));
    const wrongs = [...Array(n * n).keys()].filter((i) => !sol.has(i)).slice(0, 2);
    await page.click('[data-pn-catpen]');
    await tapCell(page, wrongs[0]);
    check(await text(page, '[data-pn-lives]') === '1', 'run: a wrong cat costs a life');
    await tapCell(page, wrongs[1]);
    await page.waitForFunction(() => window.__result, { timeout: 4000 });
    const result = await page.evaluate(() => window.__result);
    check(!result.won && result.outOfLives && result.livesLeft === 0, `run: out of lives ends the round ${JSON.stringify(result)}`);
    await page.screenshot({ path: `${out}/5-run-out-of-lives.png`, fullPage: true });
    check(errors.length === 0, `no console errors (run) ${errors.join(' | ')}`);
    await page.close();
}
{
    const { page, errors } = await open('difficulty=easy&mode=zen&seed=zen', { width: 390, height: 844 });
    check(!(await page.$('[data-pn-time]')) && !(await page.$('[data-pn-tips]')), 'zen: no clock, no tip counter');
    const p = await page.evaluate(() => window.__puzzle);
    const n = p.size;
    const sol = new Set(p.solution.map((x, y) => y * n + x));
    await page.click('[data-pn-catpen]');
    await tapCell(page, [...Array(n * n).keys()].find((i) => !sol.has(i)));
    await page.click('[data-pn-tip]');
    for (const i of sol) await tapCell(page, i);
    await page.waitForFunction(() => window.__result, { timeout: 4000 });
    const result = await page.evaluate(() => window.__result);
    check(result.won && !result.perfect && result.mistakes === 0 && result.tips === 0, `zen: nothing counted, never Purrfect ${JSON.stringify(result)}`);
    check(errors.length === 0, `no console errors (zen) ${errors.join(' | ')}`);
    await page.close();
}

// ---- Narrowest phone, 9×9 readability --------------------------------------------------------
{
    const { page } = await open('difficulty=hard&mode=daily&seed=narrow', { width: 360, height: 740, deviceScaleFactor: 2 });
    const cell = await (await page.$('.pn-cell')).boundingBox();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, 'no horizontal scroll at 360px');
    check(cell.width >= 34, `9×9 cells are tappable at 360px (${cell.width.toFixed(1)}px)`);
    await page.screenshot({ path: `${out}/6-phone-360-hard.png`, fullPage: true });
    await page.close();
}

await browser.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
