// Checks the starter ship is properly bare, that locked batteries genuinely
// cannot fire, that talent points are only spendable when earned, and that
// buying a battery makes it work.
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
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#sail:not([hidden])');
await page.evaluate(() => { document.getElementById('name').value = ''; });
await page.type('#name', 'Cadet' + Math.floor(Math.random() * 9999));
await page.click('#sail');
await wait(2600);

const start = await page.evaluate(() => window.__game.you);
console.log(`starting guns: ${JSON.stringify(start.guns)}  (want port 1, stbd 1, bow 0, stern 0)`);
console.log(`starting free points: ${start.free}  hull ${start.maxHp}  barrels ${start.barrels}`);

// Count how many shots each battery actually launches.
await page.evaluate(() => {
  window.__fired = {};
  window.__game.net.socket.on('shot', (m) => {
    window.__fired[m.battery] = (window.__fired[m.battery] || 0) + m.count;
  });
});

for (const key of ['KeyZ', 'KeyX', 'KeyF', 'KeyV']) {
  await page.keyboard.press(key);
  await wait(450);
}
await wait(800);
console.log('shots launched per battery:', await page.evaluate(() => window.__fired));

// Spending with no points must be refused by the server.
await page.evaluate(() => window.__game.net.socket.emit('spend-talent', 'broadside'));
await wait(700);
const cheated = await page.evaluate(() => window.__game.you.guns);
console.log(`spend with 0 points -> guns ${JSON.stringify(cheated)} (must be unchanged)`);

// Earn levels, then buy the bow chaser and a second gun a side.
await page.evaluate(() => window.__game.net.socket.emit('dev-xp', 4000));
await wait(900);
const levelled = await page.evaluate(() => window.__game.you);
console.log(`after xp grant: level ${levelled.level}, free points ${levelled.free}`);

await page.evaluate(() => {
  const s = window.__game.net.socket;
  s.emit('spend-talent', 'bowchaser');
  s.emit('spend-talent', 'broadside');
  s.emit('spend-talent', 'hull');
});
await wait(900);
const after = await page.evaluate(() => window.__game.you);
console.log(`after 3 talents: guns ${JSON.stringify(after.guns)} hull ${after.maxHp} free ${after.free}`);

await page.evaluate(() => { window.__fired = {}; });
await page.keyboard.press('KeyF');
await wait(900);
console.log('bow chaser after unlock:', await page.evaluate(() => window.__fired));

// The chip is the visible affordance; check it is actually reachable, then open.
const chip = await page.evaluate(() => {
  const r = document.getElementById('talalert').getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { shown: r.width > 0, unobstructed: top?.id === 'talalert' };
});
console.log(`talent chip: shown=${chip.shown} unobstructed=${chip.unobstructed}`);
await page.click('#talalert');
await wait(700);
const panel = await page.evaluate(() => {
  const el = document.getElementById('talents');
  return {
    open: window.__game.talents.open,
    visible: getComputedStyle(el).display !== 'none',
    rows: el.querySelectorAll('[data-talent]').length,
    spendable: el.querySelectorAll('.tal.can').length,
  };
});
console.log(`talent panel: open=${panel.open} visible=${panel.visible} ` +
  `rows=${panel.rows} spendable=${panel.spendable}`);
await page.screenshot({ path: './shots/talents.png' });

console.log('--- errors ---');
console.log(errors.join('\n') || '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
