// Headless smoke test: loads the client, joins, checks the helm answers the
// right way, then summons a rogue wave and photographs the whole thing.
//   node tools/smoke.js [url] [outdir]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || './shots';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });

const errors = [];
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => errors.push(`REQ FAIL ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#sail:not([hidden])');
await page.type('#name', 'Smoketest');
await page.click('#sail');
await wait(3000);

// --- does D actually turn her to starboard on screen? -----------------------
// Sample the reference heading immediately before the rudder goes over. Taking
// it before the four seconds of gathering way meant anything that moved her in
// between — an AI fleet, a respawn onto a fresh heading — was measured as part
// of the turn, and this reported a mirrored helm on a build whose helm was fine.
await page.keyboard.down('KeyW');
await wait(4000);
// Watch for anything that would move her other than the rudder. A Kraken arm or
// an AI broadside that sinks her mid-measurement respawns her on a fresh random
// heading, and the swing that produces is unrelated to the helm — reporting it
// as a mirrored helm sends you hunting a bug that is not there.
await page.evaluate(() => {
  window.__disturbed = null;
  window.__game.net.socket.on('respawned', () => { window.__disturbed = 'she was sunk and refitted'; });
  window.__game.net.socket.on('aground', () => { window.__disturbed = 'she ran aground'; });
});
const before = await page.evaluate(() => ({ h: window.__game.me.heading }));
await page.keyboard.down('KeyD');
await wait(1600);
await page.keyboard.up('KeyD');
const helm = await page.evaluate(async (h0) => {
  const THREE = await import('/vendor/three/three.module.js');
  const g = window.__game;
  const bow = (h) => new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
  // The camera's own right-hand axis, straight out of its world matrix.
  const right = new THREE.Vector3().setFromMatrixColumn(g.camera.matrixWorld, 0).setY(0).normalize();
  const swing = bow(g.me.heading).sub(bow(h0));
  const w = await import('/shared/world.js');
  return {
    turnedOnScreen: swing.dot(right) > 0 ? 'RIGHT' : 'LEFT',
    delta: +swing.length().toFixed(3),
    disturbed: window.__disturbed,
    // If she barely swung, the useful question is whether she had any way on.
    speed: +(g.me.speed * 1.94384).toFixed(1),
    throttle: +g.me.throttle.toFixed(2),
    clear: +w.landClearance(g.me.x, g.me.z).toFixed(0),
    touch: document.body.classList.contains('touch'),
  };
}, before.h);
if (helm.disturbed) {
  console.log(`held D  ->  INCONCLUSIVE: ${helm.disturbed} mid-measurement, so the ` +
    'swing is not the rudder\'s. Re-run.');
} else {
  console.log(`held D  ->  bow swung ${helm.turnedOnScreen} on screen (expected RIGHT)` +
    `  [${helm.speed} kn, throttle ${helm.throttle}, ${helm.clear} m of land, ` +
    `touch ${helm.touch}, swing ${helm.delta}]`);
  if (helm.delta < 0.05) {
    console.log('    ^ she barely swung, so that direction is noise, not a verdict.');
  }
}

await wait(2500);
await page.screenshot({ path: `${OUT}/sailing.png` });

// --- rogue wave -------------------------------------------------------------
await page.evaluate(() => window.__game.net.socket.emit('summon-tsunami', { lead: 26 }));
await wait(6000);
const warned = await page.evaluate(() => ({
  showing: document.getElementById('alert').classList.contains('on'),
  text: document.getElementById('alertdetail').textContent,
  received: !!window.__game.net.tsunami,
}));
if (!warned.received) console.log('!! no tsunami arrived from the server (one already running?)');
console.log(`warning banner: ${warned.showing ? 'SHOWN' : 'MISSING'} — "${warned.text}"`);
await page.screenshot({ path: `${OUT}/tsunami-warning.png` });

// Ride it out: watch the water under the ship rise as the crest arrives.
let peak = { h: -99, t: 0 };
for (let i = 0; i < 34; i++) {
  const s = await page.evaluate(async () => {
    const w = await import('/shared/waves.js');
    const g = window.__game;
    return { y: w.waterHeight(g.me.x, g.me.z, g.net.serverNow()), eta: g.net.tsunami
      ? g.net.tsunami.t0 + (g.me.x * g.net.tsunami.dx + g.me.z * g.net.tsunami.dz) / g.net.tsunami.speed - g.net.serverNow()
      : null };
  });
  if (s.y > peak.h) peak = { h: s.y, eta: s.eta };
  if (s.eta !== null && Math.abs(s.eta) < 0.8) await page.screenshot({ path: `${OUT}/tsunami-crest.png` });
  await wait(900);
}
console.log(`highest water under the hull: ${peak.h.toFixed(1)} m`);

const report = await page.evaluate(() => {
  const t = (id) => document.getElementById(id)?.textContent;
  const g = window.__game;
  return {
    speed: t('speed'), heading: t('heading'), twa: t('twa'), wind: t('windspd'),
    trim: t('trimword'), sea: t('seastate'), net: t('net'),
    ship: t('shipclass'), hold: t('cargotext'), throttle: t('thrpct'),
    triangles: g.renderer.info.render.triangles,
  };
});
await page.screenshot({ path: `${OUT}/after.png` });

console.log('--- readouts ---');
console.log(report);
console.log('--- console ---');
console.log(logs.slice(0, 20).join('\n') || '(silent)');
console.log('--- errors ---');
console.log(errors.join('\n') || '(none)');

await browser.close();
process.exit(errors.length ? 1 : 0);
