// Phase 3 in the browser: islands render, throttle drives the ship, docking
// opens the right menu, and selling cargo actually pays.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('./shots', { recursive: true });

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#sail:not([hidden])');
await page.evaluate(() => { document.getElementById('name').value = ''; });
await page.type('#name', 'Trader');
await page.click('#sail');
await wait(3000);

console.log('islands in scene:', await page.evaluate(() => window.__game.islands.group.children.length));

// Throttle: full ahead and see how fast she gets.
await page.keyboard.down('KeyW');
await wait(9000);
await page.keyboard.up('KeyW');
const fast = await page.evaluate(() => ({
  kn: +(window.__game.me.speed * 1.94384).toFixed(1),
  throttle: +window.__game.me.throttle.toFixed(2),
  cls: window.__game.you.cls,
}));
console.log('flat out:', JSON.stringify(fast));
await page.screenshot({ path: './shots/phase3-sailing.png' });

// Put her alongside a Safe Haven with a full hold.
const info = await page.evaluate(async () => {
  const w = await import('/shared/world.js');
  const h = w.HAVENS[0];
  window.__game.net.socket.emit('dev-place', { x: h.x + h.radius + 18, z: h.z, h: 0 });
  return { name: h.name, x: h.x, z: h.z, r: h.radius };
});
await wait(1600);
const docked = await page.evaluate(() => ({
  docked: window.__game.you.docked?.name ?? null,
  panel: document.getElementById('dock').classList.contains('on'),
  buttons: [...document.querySelectorAll('#dockbody button')].map((b) => b.textContent),
}));
console.log(`alongside ${info.name}: docked=${docked.docked} panel=${docked.panel}`);
console.log('dock options:', JSON.stringify(docked.buttons));
await page.screenshot({ path: './shots/phase3-dock.png' });

// Give her cargo and coins, then trade for real through the UI.
await page.evaluate(() => { window.__game.net.socket.emit('dev-cargo', 8); });
await wait(900);
const beforeCoins = await page.evaluate(() => window.__game.you.coins);
await page.click('#dockbody button');           // sell cargo
await wait(1200);
const afterSell = await page.evaluate(() => ({
  coins: window.__game.you.coins, cargo: window.__game.you.cargo,
}));
console.log(`sold cargo: ${beforeCoins} -> ${afterSell.coins} coins, hold now ${afterSell.cargo}`);

await page.evaluate(() => { window.__game.net.socket.emit('grant-coins', 3000); });
await wait(900);
const buttons = await page.$$('#dockbody button');
if (buttons[1]) await buttons[1].click();       // buy the next ship
await wait(1500);
console.log('after buying a hull:', await page.evaluate(() => window.__game.you.cls));
await page.screenshot({ path: './shots/phase3-ship.png' });

console.log('--- errors ---');
console.log(errors.join('\n') || '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
