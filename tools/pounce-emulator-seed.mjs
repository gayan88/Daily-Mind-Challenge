// Seeds the LOCAL Firestore emulator (never the real project -- it only talks to 127.0.0.1:8080
// with the emulator's "owner" bypass) for tools/pounce-e2e-test.mjs and pounce-e2e-modes-test.mjs:
// today's Daily, 3 Classic boards per difficulty, two active Nine Lives Runs ("Run A", "Run B",
// completion bonus 100) and short Run settings (3 lives, 20 s per board) so every path is quick.
//   node tools/pounce-emulator-seed.mjs
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { generatePuzzle, buildRun } = await import(`${repo}/src/js/games/pounce/pounce-generator.js`);
const { getTodayDateString } = await import(`${repo}/src/js/utils/helpers.js`);

const base = 'http://127.0.0.1:8080/v1/projects/playdailymindchallenge/databases/(default)/documents';
const enc = (v) => {
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    if (v && typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    return { stringValue: String(v) };
};
async function put(path, data) {
    const res = await fetch(`${base}/${path}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

const today = getTodayDateString();
const puzzle = generatePuzzle({ difficulty: 'medium', seed: `daily-${today}` });
await put('pounceDailyPuzzles/_meta', { totalCount: 1, firstDate: today, lastDate: today });
await put(`pounceDailyPuzzles/${today}`, { challengeNumber: 1, ...puzzle });
console.log(`seeded pounceDailyPuzzles/${today}: ${puzzle.size}x${puzzle.size}, ${puzzle.dogs.length} dogs, grade ${puzzle.grade.technique}`);

for (const difficulty of ['easy', 'medium', 'hard']) {
    for (let i = 1; i <= 3; i++) await put(`pounceClassicPuzzles/${difficulty}-${i}`, generatePuzzle({ difficulty, seed: `classic-${difficulty}-${i}` }));
}
for (const name of ['Run A', 'Run B']) {
    await put(`pounceTournaments/${name.replace(' ', '-').toLowerCase()}`, { name, active: true, completionBonus: 100, boards: buildRun({ seed: name }) });
}
await put('config/pounceTournamentSettings', { timeLimitSeconds: 20, lives: 3, description: 'test settings' });
console.log('seeded 9 Classic boards, 2 Nine Lives Runs, Run settings 3 lives / 20 s');
