// Every console cheat, actually exercised.
//
// These are the things you reach for when testing something else, so a cheat
// that silently does nothing costs an afternoon. cheat.kraken() in particular
// existed as a host hook for a long time with no way to call it.
//
// Runs against a browser-hosted lobby with ?dev=1, which also proves the dev
// gate works the same way peer-to-peer as it does on the server.
//
//   node tools/build-static.js && node tools/cheat-test.js

import puppeteer from 'puppeteer';
import { PeerServer } from 'peer';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist');
const BASE = '/salt-and-powder';
const PORT = 4174;
const SIGNAL_PORT = 9001;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const files = http.createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!rel.startsWith(BASE)) { res.writeHead(404).end(); return; }
  rel = rel.slice(BASE.length) || '/';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  // Read before writing the header: a miss after writeHead(200) cannot be
  // turned back into a 404.
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => files.listen(PORT, r));
PeerServer({ port: SIGNAL_PORT, path: '/', allow_discovery: false });
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${SIGNAL_PORT}/peerjs/id`)).ok) break; } catch { /* wait */ }
  if (i > 50) throw new Error('signalling never came up');
  await wait(100);
}

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const problems = [];
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));

const open = async (query) => {
  await page.goto(`http://localhost:${PORT}${BASE}/?${query}&broker=localhost:${SIGNAL_PORT}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#hostlobby');
  await page.$eval('#name', (el) => { el.value = ''; });
  await page.type('#name', 'Cheater');
  await page.click('#hostlobby');
  await page.waitForFunction(() => window.__game?.me, { timeout: 40000 });
  await wait(2500);
};

const you = () => page.evaluate(() => {
  const g = window.__game;
  return {
    cls: g.you.cls, hp: Math.round(g.you.hp), level: g.you.level,
    coins: g.you.coins, crowns: Math.round(g.you.crowns ?? 0), cargo: g.you.cargo,
    guns: g.you.guns, ships: g.net.snapshots.at(-1)?.ships.size ?? 0,
    kraken: !!g.net.kraken, tsunami: !!g.net.tsunami,
  };
});
const run = (code) => page.evaluate((c) => eval(c), code);   // eslint-disable-line no-eval
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(`cheat.${name} did nothing`);
};

// ------------------------------------------------------- cheats ON (?dev=1)
console.log('with ?dev=1:');
await open('dev=1');
const listed = await page.evaluate(() => Object.keys(window.cheat));
console.log(`  exposed: ${listed.join(', ')}`);

const before = await you();
await run('cheat.coins(50000)'); await wait(700);
check('coins', (await you()).coins > before.coins, `${before.coins} -> ${(await you()).coins}`);

await run('cheat.crowns(5000)'); await wait(700);
check('crowns', (await you()).crowns > before.crowns);

await run('cheat.xp(4000)'); await wait(900);
const lvl = await you();
check('xp', lvl.level > before.level, `level ${before.level} -> ${lvl.level}`);

await run('cheat.cargo(6)'); await wait(700);
check('cargo', (await you()).cargo > 0, `hold ${(await you()).cargo}`);

await run('cheat.hurt(30)'); await wait(700);
check('hurt', (await you()).hp < lvl.hp, `hull ${lvl.hp} -> ${(await you()).hp}`);

await run('cheat.ship("flagship")'); await wait(900);
const big = await you();
check('ship', big.cls === 'flagship', `now a ${big.cls}, ${big.hp} hull`);

await run('cheat.picks({broadside:40,bowchaser:1,sternchaser:1})'); await wait(900);
const armed = await you();
check('picks', armed.guns.port > 1 && armed.guns.bow === 1 && armed.guns.stern === 1,
  `${armed.guns.port} a side, bow ${armed.guns.bow}, stern ${armed.guns.stern}`);

// A mistyped talent key must complain rather than quietly do nothing — that is
// how `bow` instead of `bowchaser` cost an afternoon.
const typo = await run('cheat.picks({bow:1})');
check('picks rejects a typo', /no such talent/.test(typo), typo.split('\n')[0]);

await run('cheat.tsunami(9, 20)'); await wait(1200);
check('tsunami', (await you()).tsunami, 'rogue wave inbound');

const shipsBefore = (await you()).ships;
await run('cheat.fleet("dutch")'); await wait(2500);
const shipsAfter = (await you()).ships;
check('fleet', shipsAfter > shipsBefore, `${shipsBefore} -> ${shipsAfter} hulls afloat`);

// The Kraken refuses to surface inside a Safe Haven ring, so get clear first.
await run('window.__game.net.socket.emit("dev-place", {x: 0, z: 0, h: 0})');
await wait(900);
await run('cheat.kraken()');
let sawKraken = false;
for (let i = 0; i < 30 && !sawKraken; i++) {
  sawKraken = (await you()).kraken;
  if (!sawKraken) await wait(500);
}
const arms = sawKraken
  ? await page.evaluate(() => window.__game.net.kraken.arms.length) : 0;
check('kraken', sawKraken, sawKraken ? `up, ${arms} arms` : 'never surfaced');

await run('cheat.goto("home")'); await wait(1200);
check('goto', await page.evaluate(() => !!window.__game.you.docked), 'alongside');

await run('cheat.reset()'); await wait(1200);
const wiped = await you();
check('reset', wiped.cls === 'sailboat' && wiped.coins === 0,
  `${wiped.cls}, ${wiped.coins} coins, ${wiped.guns.port} gun a side`);

// ------------------------------------------------ cheats OFF (no ?dev=1)
// The gate matters more than the cheats: this is a public URL.
console.log('\nwithout ?dev=1 (a public lobby):');
await open('nodev=1');
const plain = await you();
await run('cheat.coins(50000); cheat.ship("leviathan"); cheat.kraken(); cheat.fleet()');
await wait(2500);
const still = await you();
const refused = still.coins === plain.coins && still.cls === plain.cls && !still.kraken;
console.log(`  ${refused ? '✓' : '✗'} host refused them all — ` +
  `${still.coins} coins, still a ${still.cls}, kraken ${still.kraken}`);
if (!refused) problems.push('a lobby without ?dev=1 honoured the cheats anyway');

await browser.close();
files.close();
console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK — every cheat does what it says, and none of them work unasked.');
process.exit(0);
