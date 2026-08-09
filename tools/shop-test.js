// Drives the chandlery end to end: earn crowns, get refused, buy, wear it,
// and confirm the wake actually changes colour on screen.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:3000';
mkdirSync('./shots', { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle2' });
await page.type('#name', 'Trailtest');
await page.click('#sail');
await wait(2500);

const start = await page.evaluate(() => Number(document.getElementById('crowns').textContent));
console.log(`crowns on joining: ${start}`);

// A purchase we cannot afford must be refused by the server.
await page.evaluate(() => window.__game.net.socket.emit('buy-trail', 'spectre'));
await wait(600);
const afterBroke = await page.evaluate(() => window.__game.shop.profile.owned.join(','));
console.log(`tried to buy Spectre while poor -> owned: [${afterBroke}]`);

// A forged item id must not crash or grant anything.
await page.evaluate(() => window.__game.net.socket.emit('buy-trail', 'free_everything'));
await wait(400);

// Sail a while and watch crowns accrue for distance made good.
await wait(14000);
const earned = await page.evaluate(() => Number(document.getElementById('crowns').textContent));
console.log(`crowns after ~15s of sailing: ${earned}`);

// Give this captain a purse (dev hook), then buy for real.
await page.evaluate(() => window.__game.net.socket.emit('grant-crowns', 600));
await wait(700);
await page.evaluate(() => window.__game.net.socket.emit('buy-trail', 'azure'));
await wait(900);
const bought = await page.evaluate(() => ({
  owned: window.__game.shop.profile.owned,
  worn: window.__game.shop.profile.trail,
  crowns: Math.floor(window.__game.shop.profile.crowns),
  wakeColour: '#' + window.__game.myWakeColour(),
}));
console.log('after buying Azure:', bought);

await page.keyboard.press('KeyB');
await wait(700);
await page.screenshot({ path: './shots/shop.png' });

// Now look at the trails themselves, from astern where the wake shows.
await page.keyboard.press('KeyB');
for (const [id, label] of [['azure', 'azure'], ['ember', 'ember'], ['spectre', 'spectre']]) {
  // Buy it if we don't own it, wear it either way — same as clicking the row.
  await page.evaluate((t) => {
    window.__game.net.socket.emit('buy-trail', t);
    window.__game.net.socket.emit('equip-trail', t);
    window.__freezeCamera = true;
  }, id);
  await wait(6000);
  await page.evaluate(() => {
    // Off the quarter and high, so both the hull and the trail astern are framed.
    const g = window.__game;
    const h = g.me.heading;
    g.camera.position.set(g.me.x + Math.cos(h) * 30, 17, g.me.z - Math.sin(h) * 30);
    g.camera.lookAt(g.me.x - Math.sin(h) * 13, 0, g.me.z - Math.cos(h) * 13);
  });
  await wait(400);
  await page.screenshot({ path: `./shots/trail-${label}.png` });
}

console.log('--- errors ---');
console.log(errors.join('\n') || '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
