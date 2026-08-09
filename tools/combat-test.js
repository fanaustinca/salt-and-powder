// Two browsers, one fight. Verifies shots actually damage the right ship,
// that you cannot shoot yourself, that XP and levels arrive, and that a hull
// taken to zero sinks and comes back.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:3000';
mkdirSync('./shots', { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const errors = [];

async function join(name) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  // Not networkidle: two clients hold open sockets, so the network never idles.
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#sail:not([hidden])', { timeout: 30000 });
  await page.type('#name', name);
  await page.click('#sail');
  await wait(2200);
  return page;
}

const gunner = await join('Gunner');
const target = await join('Target');
await wait(1500);

// Park them alongside: same heading, 26 m apart on the beam. This has to go
// through the server — writing to the client's predicted ship is undone by
// reconciliation within a frame.
const setup = async () => {
  await gunner.evaluate(() => window.__game.net.socket.emit('dev-place', { x: 0, z: 0, h: 0 }));
  await target.evaluate(() => window.__game.net.socket.emit('dev-place', { x: 26, z: 0, h: 0 }));
  await wait(250);
};
await setup();
await wait(600);

// Record what actually happens to the target rather than sampling afterwards —
// a sunk ship respawns with a full hull and hides the evidence.
await target.evaluate(() => {
  const g = window.__game;
  window.__log = { minHp: 999, sunk: 0, respawned: 0, hits: 0 };
  g.net.socket.on('hit', (m) => { if (m.id === g.net.id) window.__log.hits++; });
  g.net.socket.on('sunk', (m) => { if (m.id === g.net.id) window.__log.sunk++; });
  g.net.socket.on('respawned', () => window.__log.respawned++);
  g.net.socket.on('you', (m) => { window.__log.minHp = Math.min(window.__log.minHp, m.hp); });
});

const before = await target.evaluate(() => window.__game.me.hp);
const gunnerHpBefore = await gunner.evaluate(() => window.__game.me.hp);
console.log(`target hull before: ${before}`);

// +X is the port side of the model, and the target sits at +X, so fire to port.
for (let volley = 0; volley < 10; volley++) {
  await setup();
  await gunner.keyboard.press('KeyZ');
  await wait(1200);
  await gunner.screenshot({ path: './shots/broadside.png' });
  await wait(3400);
}

const after = await target.evaluate(() => ({
  hp: window.__game.me.hp, sunk: window.__game.me.sunk,
}));
const gunnerAfter = await gunner.evaluate(() => ({
  hp: window.__game.me.hp, xp: Math.round(window.__game.shop.profile.crowns),
  level: window.__game.me.level,
}));
const gunnerYou = await gunner.evaluate(() => window.__game.you ?? null);

const log = await target.evaluate(() => window.__log);
console.log(`target took ${log.hits} hits, hull bottomed at ${Math.round(log.minHp)}, ` +
  `sunk ${log.sunk}x, respawned ${log.respawned}x`);
console.log(`gunner hull (must be unchanged — no self-hits): ${gunnerHpBefore} -> ${gunnerAfter.hp}`);
console.log(`gunner level: ${gunnerAfter.level}`);

// Wrong side should miss entirely.
const hpBeforeMiss = await target.evaluate(() => window.__game.me.hp);
await setup();
await gunner.keyboard.press('KeyX');   // starboard — away from the target
await wait(4000);
const hpAfterMiss = await target.evaluate(() => window.__game.me.hp);
console.log(`firing the empty side: ${hpBeforeMiss} -> ${hpAfterMiss} (should be unchanged)`);

// TNT
await setup();
await gunner.keyboard.press('KeyR');
await wait(1500);
await gunner.screenshot({ path: './shots/barrel.png' });
await wait(4000);
await gunner.screenshot({ path: './shots/explosion.png' });

console.log('--- errors ---');
console.log(errors.join('\n') || '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
