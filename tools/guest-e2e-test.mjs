// End-to-end check of guest play (2026-11-14) against the local Firebase emulators, in the system
// Google Chrome: one-tap "Play now", automatic unique guest names, guest XP/streak/achievements
// (and the rules that bound them), the "save your progress" card, profile banner, saving a guest
// as a member (same uid, everything carried over, past scores relabelled), the account-creation
// rule fix, the "log in to another account" warning, the returning-member gate, and Admin's
// guest clean-up (plus a cleaned-up guest coming back).
// Setup (as for pounce-e2e-test.mjs): `cd tools && npm i --no-save puppeteer-core@23.11.1`, Java
// for the Firestore emulator, then from the repo root:
//   firebase emulators:start --only firestore,auth,hosting --project playdailymindchallenge
//   node tools/pounce-emulator-seed.mjs
//   node tools/guest-e2e-test.mjs <screenshot-dir> [hostingPort=5002]
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? '.';
const site = `http://127.0.0.1:${process.argv[3] || 5002}`;
const fsBase = 'http://127.0.0.1:8080/v1/projects/playdailymindchallenge/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };
const log = [];
const check = (cond, msg) => { const l = `${cond ? 'PASS' : 'FAIL'} ${msg}`; log.push(l); console.log(l); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GUEST_NAME = /^[A-Z][a-z]+ [A-Z][a-z]+ \d{3,4}$/;
const run = Date.now() % 100000;

async function fsGet(path) {
    const res = await fetch(`${fsBase}/${path}`, { headers: OWNER });
    return res.ok ? res.json() : null;
}
async function fsPatch(path, fields) {
    const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
    const res = await fetch(`${fsBase}/${path}?${mask}`, { method: 'PATCH', headers: { ...OWNER, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}
const val = (f) => f && (f.integerValue !== undefined ? Number(f.integerValue) : f.stringValue ?? f.booleanValue);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 240000 });
const errors = [];

// Pages act as a real visitor by default (normal Chrome user agent, navigator.webdriver false), so
// game pages create a guest automatically; `{ bot: true }` keeps headless Chrome's own signals, which
// the site treats as a crawler (no automatic guest, the Play now gate instead).
const HUMAN_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
async function newPage(context, { bot = false } = {}) {
    const page = await context.newPage();
    if (!bot) {
        await page.setUserAgent(HUMAN_UA);
        await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
    }
    await page.setViewport({ width: 400, height: 860, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Could not reach Cloud Firestore backend|favicon|googlesyndication|adsbygoogle|google-analytics|googletagmanager|facebook|fbevents|ERR_BLOCKED|net::ERR|Missing or insufficient permissions|PERMISSION_DENIED/.test(m.text())) errors.push(m.text()); });
    page.dialogs = [];
    page.dialogAnswer = false;
    page.on('dialog', (d) => { page.dialogs.push(d.message()); (page.dialogAnswer ? d.accept() : d.dismiss()); });
    return page;
}
async function declineCookies(page) {
    await page.waitForSelector('#cookie-banner-decline', { visible: true, timeout: 8000 }).then(() => page.click('#cookie-banner-decline')).catch(() => {});
}
const currentUser = (page) => page.evaluate(async () => {
    const { auth } = await import('/js/api/firebase-init.js');
    await auth.authStateReady();
    const u = auth.currentUser;
    return u ? { uid: u.uid, anonymous: u.isAnonymous } : null;
});
async function startGuestOnPounce(page) {
    // A real visitor: the guest is created automatically and the Daily loads with no tap.
    await page.goto(`${site}/pounce`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#pounce-round-mount .pn-cell', { timeout: 90000 });
    await declineCookies(page);
    return currentUser(page);
}
// Runs the real app modules in the page (same module instances the page uses).
const recordProgress = (page, gameType, score) => page.evaluate(async (gameType, score) => {
    const { auth } = await import('/js/api/firebase-init.js');
    const { loadSessionProfile } = await import('/js/auth/user-profile.js');
    const { recordGameScore } = await import('/js/utils/points.js');
    const { awardDailyCompletionXp } = await import('/js/progression/xp-service.js');
    const { advanceStreakForDailyCompletion } = await import('/js/progression/streak-service.js');
    const profile = await loadSessionProfile(auth.currentUser);
    await recordGameScore(auth.currentUser.uid, profile, gameType, score, 30);
    await awardDailyCompletionXp(auth.currentUser.uid, false, false);
    await advanceStreakForDailyCompletion(auth.currentUser.uid);
}, gameType, score);
// Attempts a raw Firestore write in the page as the signed-in user; returns 'ok' or the error code.
const tryWrite = (page, path, data, merge = false) => page.evaluate(async (path, data, merge) => {
    const { db } = await import('/js/api/firebase-init.js');
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    try { await setDoc(doc(db, path), data, merge ? { merge: true } : {}); return 'ok'; } catch (e) { return e.code || e.message; }
}, path, data, merge);

// ---- 1. A crawler / automated browser: the Play now gate, no account ----------------------------------
const ctxBot = await browser.createBrowserContext();
const bot = await newPage(ctxBot, { bot: true });
await bot.goto(`${site}/pounce`, { waitUntil: 'domcontentloaded' });
await bot.waitForSelector('.play-gate', { timeout: 60000 });
check(await bot.$eval('.play-gate', (el) => el.textContent.includes('Play now') && el.textContent.includes('No sign-up needed')), 'a bot sees the Play now gate (page stays crawlable)');
check((await currentUser(bot)) === null, 'no account is created for a bot');
await declineCookies(bot);
await bot.screenshot({ path: `${out}/g1-play-gate.png` });
await ctxBot.close();

// ---- 2. A real visitor: a guest is created automatically, straight into the Daily ----------------------
const ctxA = await browser.createBrowserContext();
const a = await newPage(ctxA);
const guestA = await startGuestOnPounce(a);
check(guestA?.anonymous === true, 'a real visitor gets a guest automatically and the Daily board loads with no tap');
await a.waitForSelector('#auto-guest-bar', { timeout: 10000 }).catch(() => {});
check(await a.$eval('#auto-guest-bar', (el) => /Already have an account\? Log in/.test(el.textContent)).catch(() => false), 'the "Already have an account? Log in" bar shows above the game');
await a.screenshot({ path: `${out}/g1b-auto-guest.png` });
await a.goto(`${site}/`, { waitUntil: 'domcontentloaded' });
await wait(4000);
check(!!(await currentUser(a)) && (await a.$('#auth-modal[hidden]')) !== null, 'the home page keeps the same guest (no new account, no sign-in box)');
await a.goto(`${site}/pounce`, { waitUntil: 'domcontentloaded' });
await a.waitForSelector('#pounce-round-mount .pn-cell', { timeout: 90000 });
check((await currentUser(a))?.uid === guestA.uid, 'returning to a game keeps the same guest');
const gdoc = await fsGet(`guests/${guestA.uid}`);
const guestNameA = val(gdoc?.fields?.displayName);
check(GUEST_NAME.test(guestNameA || ''), `guest got an automatic name (${guestNameA})`);
const nameKey = val(gdoc?.fields?.nameKey);
check(val((await fsGet(`guestNames/${nameKey}`))?.fields?.uid) === guestA.uid, 'the name is reserved in guestNames for this guest');
check(await a.$eval('#save-progress-link', (el) => !el.hidden) && await a.$eval('#settings-menu-link', (el) => el.hidden), 'header menu: Save my progress shown, Settings hidden for a guest');

// ---- 3. Guest progression + the rules that bound it ----------------------------------------------
await recordProgress(a, 'pounce', 20);
let g = (await fsGet(`guests/${guestA.uid}`)).fields;
check(val(g.xp) === 10 && val(g.currentStreak) === 1, `guest earns XP and a streak on their own doc (xp ${val(g.xp)}, streak ${val(g.currentStreak)})`);
await a.waitForSelector('#save-progress-nudge', { timeout: 8000 }).catch(() => {});
check(!!(await a.$('#save-progress-nudge')), 'the "save your progress" card appears after a guest finishes a Daily');
await a.screenshot({ path: `${out}/g2-nudge.png` });
check(await tryWrite(a, `playerAchievements/${guestA.uid}_perfect-day`, { uid: guestA.uid, achievementId: 'perfect-day', category: 'special', count: 1 }) === 'ok', 'a guest can earn an achievement (rules)');
check(await tryWrite(a, `guests/${guestA.uid}`, { xp: 5000 }, true) !== 'ok', 'a guest cannot jump their XP by 4,990 (rules)');
check(await tryWrite(a, `registeredUsers/${guestA.uid}`, { username: 'x', displayName: 'x', isAdmin: false, isBanned: false, xp: 10 }) !== 'ok', 'a still-anonymous guest cannot create a member doc (rules)');
check(await tryWrite(a, `guestNames/${nameKey}`, { uid: 'someone-else' }) !== 'ok', 'a taken guest name cannot be overwritten (rules)');

// ---- 4. Profile: real rank + the save banner ------------------------------------------------------
await a.goto(`${site}/profile`, { waitUntil: 'domcontentloaded' });
await a.waitForFunction(() => !/Play daily/.test(document.getElementById('profile-hero-tagline')?.textContent || 'Play daily') && !document.getElementById('profile-save-banner').hidden, { timeout: 90000 }).catch(() => {});
check(!/Play daily/.test(await a.$eval('#profile-hero-tagline', (el) => el.textContent)), `profile shows the guest's real rank (${await a.$eval('#profile-hero-tagline', (el) => el.textContent)})`);
await a.waitForFunction(() => document.querySelectorAll('#profile-missions > *').length > 0, { timeout: 60000 }).catch(() => {});
check(await a.$eval('#profile-missions-guest-note', (el) => el.hidden), 'missions are open to guests (no "sign up" lock note)');
await a.screenshot({ path: `${out}/g3-profile-guest.png`, fullPage: true });

// ---- 5. Save progress: guest -> member, same uid, everything carried over -------------------------
const memberName = `tester${run}`;
await a.goto(`${site}/?save=1`, { waitUntil: 'domcontentloaded' });
await a.waitForSelector('#auth-modal:not([hidden]) #auth-save-intro:not([hidden])', { timeout: 60000 });
check(await a.$eval('#signup-username', (el) => el.value.length > 0), `sign-up suggests a username (${await a.$eval('#signup-username', (el) => el.value)})`);
check(await a.$eval('#tab-guest', (el) => el.hidden), 'save mode hides the Guest tab');
await a.screenshot({ path: `${out}/g4-save-modal.png` });
await a.$eval('#signup-username', (el) => { el.value = ''; });
await a.type('#signup-username', memberName);
await a.type('#signup-displayname', 'Clever Fox 999');
await a.type('#signup-password', 'Passw0rd1');
await a.click('#signup-submit');
await wait(1500);
check(/guest name/.test(await a.$eval('#auth-error', (el) => el.textContent)), 'a guest-style display name is refused for members');
await a.$eval('#signup-displayname', (el) => { el.value = ''; });
await a.type('#signup-displayname', 'Puzzle Pro');
await Promise.all([a.waitForNavigation({ timeout: 90000 }), a.click('#signup-submit')]);
const memberA = await currentUser(a);
check(memberA?.uid === guestA.uid && memberA.anonymous === false, 'the same account (uid) is now a member login');
const m = (await fsGet(`registeredUsers/${guestA.uid}`))?.fields;
check(m && val(m.xp) === 10 && val(m.currentStreak) === 1 && val(m.isAdmin) === false, 'member doc carries the guest XP and streak, not admin');
check(!(await fsGet(`guests/${guestA.uid}`)) && !(await fsGet(`guestNames/${nameKey}`)), 'guest doc and name reservation removed');
check(!!(await fsGet(`playerAchievements/${guestA.uid}_perfect-day`)), 'the guest-earned achievement is still there');
const today = new Date().toLocaleDateString('en-CA');
const score = (await fsGet(`gameScores/${guestA.uid}_pounce_${today}`))?.fields;
check(score && val(score.isGuest) === false && val(score.displayName) === 'Puzzle Pro', 'past scores relabelled with the member name');
check(val((await fsGet(`usernames/${memberName}`))?.fields?.uid) === guestA.uid, 'username reserved for the member');
await a.goto(`${site}/profile`, { waitUntil: 'domcontentloaded' });
await wait(8000);
const afterReload = await currentUser(a);
check(afterReload?.uid === guestA.uid && afterReload.anonymous === false, 'the converted member stays signed in after a reload');

// ---- 6. The account-creation hole is closed ----------------------------------------------------------
const ctxB = await browser.createBrowserContext();
const b = await newPage(ctxB);
await b.goto(`${site}/`, { waitUntil: 'domcontentloaded' });
await declineCookies(b);
const fresh = await b.evaluate(async (email) => {
    const { auth } = await import('/js/api/firebase-init.js');
    const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const c = await createUserWithEmailAndPassword(auth, email, 'Passw0rd1');
    return c.user.uid;
}, `hacker${run}@dmc.local`);
check(await tryWrite(b, `registeredUsers/${fresh}`, { username: `hacker${run}`, displayName: 'Hacker', isAdmin: true, isBanned: false, loginPoints: 0, xp: 0 }) !== 'ok', 'a new account cannot make itself admin (rules)');
check(await tryWrite(b, `registeredUsers/${fresh}`, { username: `hacker${run}`, displayName: 'Hacker', isAdmin: false, isBanned: false, loginPoints: 0, xp: 99999 }) !== 'ok', 'a new account cannot give itself XP (rules)');
check(await tryWrite(b, `registeredUsers/${fresh}`, { username: `hacker${run}`, displayName: 'Hacker', isAdmin: false, isBanned: false, loginPoints: 0, xp: 0 }) === 'ok', 'a normal new member doc is still allowed');
await ctxB.close();

// ---- 7. A guest logging in to an existing account is warned first -----------------------------------
const ctxC = await browser.createBrowserContext();
const c = await newPage(ctxC);
const guestC = await startGuestOnPounce(c);
await recordProgress(c, 'pounce', 15);
await c.goto(`${site}/?login=1`, { waitUntil: 'domcontentloaded' });
await c.waitForSelector('#auth-modal:not([hidden]) #panel-login.active', { timeout: 60000 });
await c.type('#login-username', memberName);
await c.type('#login-password', 'Passw0rd1');
c.dialogAnswer = false;
await c.click('#login-submit');
await wait(2500);
check(c.dialogs.some((d) => /can't be moved into an existing account/.test(d)), 'logging in from a guest with progress warns first');
check((await currentUser(c))?.uid === guestC.uid, 'cancelling the warning keeps the guest signed in');
c.dialogAnswer = true;
await Promise.all([c.waitForNavigation({ timeout: 90000 }), c.click('#login-submit')]);
check((await currentUser(c))?.uid === guestA.uid, 'confirming logs in to the member account');

// ---- 8. Returning member on this browser gets "Log in" first ---------------------------------------
await c.evaluate(async () => { const { signOutSession } = await import('/js/auth/auth.js'); await signOutSession(); });
await c.goto(`${site}/pounce`, { waitUntil: 'domcontentloaded' });
await c.waitForSelector('.play-gate', { timeout: 60000 });
check(await c.$eval('.play-gate', (el) => el.textContent.includes('Welcome back') && el.textContent.includes('Play as a guest')), 'a browser a member used shows "Welcome back / Log in" first');
await c.screenshot({ path: `${out}/g5-welcome-back.png` });

// ---- 8b. A guest who logs out on purpose isn't given a new guest automatically -------------------------
const ctxE = await browser.createBrowserContext();
const e = await newPage(ctxE);
await startGuestOnPounce(e);
e.dialogAnswer = true;
await e.click('#user-trigger');
await Promise.all([e.waitForNavigation({ timeout: 60000 }), e.click('#logout-btn')]);
await e.goto(`${site}/pounce`, { waitUntil: 'domcontentloaded' });
await e.waitForSelector('.play-gate [data-play-gate-start]', { timeout: 60000 });
check((await currentUser(e)) === null, 'after a guest logs out, the game page shows Play now instead of a new guest');
await e.click('.play-gate [data-play-gate-start]');
await e.waitForSelector('#pounce-round-mount .pn-cell', { timeout: 90000 });
check((await currentUser(e))?.anonymous === true, 'Play now still starts a guest after logging out');
await ctxE.close();

// ---- 9. A guest who will be cleaned up and then comes back -------------------------------------------
const ctxD = await browser.createBrowserContext();
const d = await newPage(ctxD);
const guestD = await startGuestOnPounce(d);
const nameD = val((await fsGet(`guests/${guestD.uid}`)).fields.displayName);

// ---- 10. Admin guest clean-up -------------------------------------------------------------------------
const OLD = { timestampValue: '2026-01-01T00:00:00Z' };
await fsPatch(`guests/${guestC.uid}`, { lastLoginAt: OLD });
await fsPatch(`guests/${guestD.uid}`, { lastLoginAt: OLD });
await fsPatch(`registeredUsers/${guestA.uid}`, { isAdmin: { booleanValue: true } });
// Emulator quirk (see pounce-e2e-test.mjs): a restored session sometimes resolves as signed out
// on the first page load after the home page, bouncing /admin to /?redirect=. Retry a few times.
// Let the restored session settle before opening Admin (see the emulator quirk below).
await a.evaluate(async () => {
    const { auth } = await import('/js/api/firebase-init.js');
    await auth.authStateReady();
    const { loadSessionProfile } = await import('/js/auth/user-profile.js');
    await loadSessionProfile(auth.currentUser);
});
for (let i = 0; i < 4; i++) {
    await a.goto(`${site}/admin`, { waitUntil: 'domcontentloaded' });
    await wait(6000);
    if (a.url().endsWith('/admin')) break;
}
// Wait until admin-page.js has wired the sections (it renders the config forms after that).
await a.waitForSelector('#pounce-admin-root #pa-runs-table', { timeout: 180000 }) // the last section admin-page.js#init() renders
    .catch(async (e) => {
        await a.screenshot({ path: `${out}/g6-admin-fail.png` });
        console.log('admin url', a.url(), 'content:', (await a.$eval('body', (el) => el.innerText)).slice(0, 300));
        throw e;
    });
await wait(3000);
await a.evaluate(() => {
    const header = [...document.querySelectorAll('.admin-section-header')].find((h) => h.textContent.trim() === 'General');
    if (header && !header.closest('[data-collapsible]').classList.contains('open')) header.click();
});
await a.waitForSelector('#guest-cleanup-check', { visible: true, timeout: 10000 });
// "Never played" filter: guest C has a score, guest D doesn't.
await a.click('#guest-cleanup-never-played');
await a.click('#guest-cleanup-check');
await a.waitForFunction(() => /inactive|Nothing|failed/.test(document.getElementById('guest-cleanup-result').textContent) && !/Checking/.test(document.getElementById('guest-cleanup-result').textContent), { timeout: 60000 }).catch(() => {});
const neverPlayed = await a.$eval('#guest-cleanup-result', (el) => el.textContent.replace(/\s+/g, ' ').trim());
check(/^1 never-played guest inactive 30\+ days/.test(neverPlayed), `"never finished a game" filter finds only the empty guest (${neverPlayed})`);
await a.click('#guest-cleanup-never-played');
await a.click('#guest-cleanup-check');
await a.waitForFunction(() => /inactive|Nothing|failed/.test(document.getElementById('guest-cleanup-result').textContent) && !/Checking/.test(document.getElementById('guest-cleanup-result').textContent), { timeout: 60000 })
    .catch(async () => console.log('cleanup result:', await a.$eval('#guest-cleanup-result', (el) => el.textContent)));
const preview = await a.$eval('#guest-cleanup-result', (el) => el.textContent.replace(/\s+/g, ' ').trim());
check(/^2 guests inactive 30\+ days/.test(preview), `Check counts the 2 inactive guests and changes nothing (${preview})`);
check(!!(await fsGet(`guests/${guestC.uid}`)), 'Check alone deletes nothing');
await a.screenshot({ path: `${out}/g6-admin-cleanup.png` });
a.dialogAnswer = true;
await a.click('#guest-cleanup-delete');
await a.waitForFunction(() => /^Done/.test(document.getElementById('guest-cleanup-result').textContent), { timeout: 60000 });
check(!(await fsGet(`guests/${guestC.uid}`)) && !(await fsGet(`gameScores/${guestC.uid}_pounce_${today}`)), 'Delete removes the guest and their scores');
check(!!(await fsGet(`registeredUsers/${guestA.uid}`)), 'members are untouched');

// ---- 11. The cleaned-up guest comes back: a fresh guest, no error ------------------------------------
await d.goto(`${site}/pounce`, { waitUntil: 'domcontentloaded' });
await d.waitForSelector('#pounce-round-mount .pn-cell', { timeout: 90000 });
const back = (await fsGet(`guests/${guestD.uid}`))?.fields;
check(!!back && GUEST_NAME.test(val(back.displayName)), `a cleaned-up guest returning gets a fresh guest profile (${nameD} -> ${val(back?.displayName)})`);

check(errors.length === 0, `no unexpected page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
await browser.close();
const failed = log.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${log.length - failed}/${log.length} passed`);
process.exit(failed ? 1 : 0);
