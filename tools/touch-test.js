// The game on a phone.
//
// Emulates an iPhone and an iPad — real touch events, no mouse, no keyboard —
// and checks that the two things you cannot play without actually work: the
// helm answers a thumb, and a tap on the sea fires at the place you tapped.
//
// Runs against a browser-hosted lobby, so it also covers the case that matters
// most on mobile: someone opening the published link on their phone.
//
//   node tools/build-static.js && node tools/touch-test.js

import puppeteer from 'puppeteer';
import { PeerServer } from 'peer';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist');
const OUT = path.join(root, 'shots');
const BASE = '/salt-and-powder';
const PORT = 4175;
const SIGNAL_PORT = 9002;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

await mkdir(OUT, { recursive: true });
const files = http.createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!rel.startsWith(BASE)) { res.writeHead(404).end(); return; }
  rel = rel.slice(BASE.length) || '/';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
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

const DEVICES = [
  { name: 'iPhone 14', width: 390, height: 844, dpr: 3,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  { name: 'iPad landscape', width: 1180, height: 820, dpr: 2,
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
];

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const problems = [];

for (const dev of DEVICES) {
  console.log(`\n--- ${dev.name} (${dev.width}x${dev.height}) ---`);
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`${dev.name} pageerror: ${e}`));
  await page.setUserAgent(dev.ua);
  await page.setViewport({
    width: dev.width, height: dev.height, deviceScaleFactor: dev.dpr,
    isMobile: true, hasTouch: true,
  });
  // Chrome only reports pointer:coarse / hover:none once told there is no mouse.
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });

  await page.goto(`http://localhost:${PORT}${BASE}/?dev=1&broker=localhost:${SIGNAL_PORT}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#hostlobby');

  // The join card has to fit without scrolling, or you cannot reach the button.
  const fits = await page.evaluate(() =>
    document.querySelector('#join .card').getBoundingClientRect().bottom <= innerHeight + 1);
  console.log(`  join card fits on screen: ${fits}`);
  if (!fits) problems.push(`${dev.name}: the join card runs off the bottom`);

  await page.$eval('#name', (el) => { el.value = ''; });
  await page.type('#name', 'Thumbs');
  await page.tap('#hostlobby');
  await page.waitForFunction(() => window.__game?.me, { timeout: 40000 });
  await wait(2500);

  // Did the controls appear on their own, without needing a canvas touch first?
  const built = await page.evaluate(() => ({
    ui: !!document.getElementById('touchui'),
    bodyClass: document.body.classList.contains('touch'),
    helm: !!document.getElementById('thelm'),
    sail: !!document.getElementById('tsail'),
    buttons: [...document.querySelectorAll('#tbtns button')].map((b) => b.textContent),
  }));
  console.log(`  controls built: ${built.ui} · buttons: ${built.buttons.join(' ')}`);
  if (!built.ui || !built.helm || !built.sail) {
    problems.push(`${dev.name}: touch controls never appeared`);
  }

  // Nothing may sit under a thumb: the controls must not overlap the HUD.
  const overlaps = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const hit = (a, b) => a && b && a.left < b.right && b.left < a.right
      && a.top < b.bottom && b.top < a.bottom;
    const controls = ['#thelm', '#tsail', '#tbtns'].map(box);
    const hud = ['#dials', '#vitals', '#battle', '#seastate'].map(box);
    const bad = [];
    for (const c of controls) for (const h of hud) if (hit(c, h)) bad.push('overlap');
    const offscreen = controls.filter((c) => c && (c.right > innerWidth + 1
      || c.bottom > innerHeight + 1 || c.left < -1 || c.top < -1));
    return { bad: bad.length, offscreen: offscreen.length };
  });
  console.log(`  control/HUD overlaps: ${overlaps.bad} · off-screen: ${overlaps.offscreen}`);
  if (overlaps.bad) problems.push(`${dev.name}: a control sits on top of the HUD`);
  if (overlaps.offscreen) problems.push(`${dev.name}: a control is off the screen`);

  // ---- the helm answers a thumb --------------------------------------------
  const helm = await page.evaluate(() => {
    const r = document.querySelector('#thelm .track').getBoundingClientRect();
    return { x: r.left + r.width * 0.92, y: r.top + r.height / 2, cx: r.left + r.width / 2 };
  });
  await page.evaluate(() => { window.__game.net.socket.emit('input', { r: 0, t: 1 }); });
  await wait(4000);
  const h0 = await page.evaluate(() => window.__game.me.heading);

  // Hold the helm hard over to starboard with one finger.
  await page.touchscreen.touchStart(helm.x, helm.y);
  await wait(2600);
  const held = await page.evaluate(() => ({
    rudder: +window.__game.touchRudder.toFixed(2),
    h: window.__game.me.heading,
  }));
  await page.touchscreen.touchEnd();
  await wait(600);
  const centred = await page.evaluate(() => +window.__game.touchRudder.toFixed(2));

  const turned = held.h - h0;
  console.log(`  helm hard over: rudder ${held.rudder}, heading moved ${turned.toFixed(2)} rad`);
  console.log(`  helm springs back on release: ${centred === 0}`);
  // Bow on +Z means a starboard turn LOWERS the heading.
  if (!(held.rudder > 0.8)) problems.push(`${dev.name}: the helm did not answer (${held.rudder})`);
  if (!(turned < -0.15)) problems.push(`${dev.name}: dragging the helm right did not turn her to starboard`);
  if (centred !== 0) problems.push(`${dev.name}: the helm did not spring back amidships`);

  // ---- a proportional helm, not just hard over -----------------------------
  const easy = helm.cx + (helm.x - helm.cx) * 0.35;
  await page.touchscreen.touchStart(easy, helm.y);
  await wait(400);
  const gentle = await page.evaluate(() => +window.__game.touchRudder.toFixed(2));
  await page.touchscreen.touchEnd();
  console.log(`  eased over a third: rudder ${gentle} (proportional, not hard over)`);
  if (!(gentle > 0.15 && gentle < 0.7)) {
    problems.push(`${dev.name}: the helm is not proportional (${gentle})`);
  }

  // ---- the sail lever holds its setting ------------------------------------
  const sail = await page.evaluate(() => {
    const r = document.querySelector('#tsail .track').getBoundingClientRect();
    return { x: r.left + r.width / 2, top: r.top + 6, bottom: r.bottom - 6 };
  });
  await page.touchscreen.touchStart(sail.x, sail.bottom);   // all sail off her
  await page.touchscreen.touchEnd();
  await wait(3500);
  const furled = await page.evaluate(() => ({
    order: +window.__game.touchSail.toFixed(2),
    carrying: +window.__game.me.throttle.toFixed(2),
  }));
  await page.touchscreen.touchStart(sail.x, sail.top);      // and everything back on
  await page.touchscreen.touchEnd();
  await wait(3500);
  const full = await page.evaluate(() => ({
    order: +window.__game.touchSail.toFixed(2),
    carrying: +window.__game.me.throttle.toFixed(2),
  }));
  console.log(`  sail furled -> ordered ${furled.order}, carrying ${furled.carrying}`);
  console.log(`  sail full   -> ordered ${full.order}, carrying ${full.carrying}`);
  if (furled.carrying > 0.25) problems.push(`${dev.name}: furling the sail did not slow her`);
  if (full.carrying < 0.75) problems.push(`${dev.name}: full sail did not set`);

  // ---- a tap on the sea fires there ----------------------------------------
  await page.evaluate(() => {
    window.__shots = [];
    window.__game.net.socket.on('shot', (m) => window.__shots.push(m));
    window.__game.net.socket.emit('dev-picks', { broadside: 10 });
  });
  await wait(1200);

  // How much of the screen can you actually put a shot on? This is the number
  // that was 14% on a portrait phone before the camera was widened for tall
  // screens — you could sail but not fight. Scanning for a live firing solution
  // also picks the tap point below, so this works on any screen shape rather
  // than depending on a fraction that happens to bear on one device.
  const reach = await page.evaluate(() => {
    const g = window.__game;
    let hits = 0, cells = 0, best = null, far = 0;
    for (let fx = 0.05; fx <= 0.95; fx += 0.05) {
      for (let fy = 0.35; fy <= 0.9; fy += 0.05) {
        cells++;
        const x = innerWidth * fx, y = innerHeight * fy;
        g.aim.setPointer(x, y);
        const s = g.aim.update(g.me, g.you.guns, g.you.reload, g.net.serverNow(), true);
        if (!s) continue;
        hits++;
        if (s.r > far) { far = s.r; best = { x, y, r: s.r, b: s.b * 180 / Math.PI }; }
      }
    }
    return { pct: Math.round(hits / cells * 100), best, far: Math.round(far) };
  });
  console.log(`  aimable: ${reach.pct}% of the screen, out to ${reach.far} m`);
  if (reach.pct < 25) {
    problems.push(`${dev.name}: only ${reach.pct}% of the screen can be aimed at — you cannot fight`);
  }
  if (reach.far < 45) {
    problems.push(`${dev.name}: nothing beyond ${reach.far} m is reachable`);
  }

  if (reach.best) {
    await page.touchscreen.touchStart(reach.best.x, reach.best.y);
    await page.touchscreen.touchEnd();
    await wait(1400);
    const fired = await page.evaluate(() => ({
      shots: window.__shots.length,
      battery: window.__shots[0]?.battery ?? null,
    }));
    console.log(`  tapping at ${reach.best.b.toFixed(0)}° / ${reach.best.r.toFixed(0)} m fired: ` +
      `${fired.shots} volley(s) from the ${fired.battery}`);
    if (!fired.shots) problems.push(`${dev.name}: tapping a live firing solution did not fire`);
  }

  // ---- a drag looks around instead of firing -------------------------------
  const before = await page.evaluate(() => +window.__game.cam.yaw.toFixed(3));
  await page.evaluate(() => { window.__shots.length = 0; });
  await page.touchscreen.touchStart(dev.width * 0.5, dev.height * 0.5);
  for (let i = 1; i <= 8; i++) {
    await page.touchscreen.touchMove(dev.width * 0.5 + i * 9, dev.height * 0.5);
    await wait(30);
  }
  await page.touchscreen.touchEnd();
  await wait(600);
  const after = await page.evaluate(() => ({
    yaw: +window.__game.cam.yaw.toFixed(3), shots: window.__shots.length,
  }));
  console.log(`  drag turned the camera ${(after.yaw - before).toFixed(3)} rad, ` +
    `and fired ${after.shots} (must be 0)`);
  if (Math.abs(after.yaw - before) < 0.05) problems.push(`${dev.name}: dragging did not look around`);
  if (after.shots) problems.push(`${dev.name}: a drag to look around also fired the guns`);

  // ---- the buttons -----------------------------------------------------------
  await page.tap('#tbtns button[data-act="talents"]');
  await wait(500);
  const talOpen = await page.evaluate(() => window.__game.talents.open);
  await page.tap('#tbtns button[data-act="talents"]');
  await wait(300);
  console.log(`  TAL opened the talent sheet: ${talOpen}`);
  if (!talOpen) problems.push(`${dev.name}: the TAL button did not open the talent sheet`);

  // SHOT, with nothing but round shot aboard. The host correctly refuses shot
  // you do not hold, so the button must SAY so — silence here is the failure.
  await page.tap('#tbtns button[data-act="ammo"]');
  await wait(500);
  const said = await page.$eval('#toasts', (el) => el.textContent);
  console.log(`  SHOT with an empty magazine said: "${said.trim().slice(0, 48)}"`);
  if (!/craft|round shot/i.test(said)) {
    problems.push(`${dev.name}: SHOT did nothing and said nothing with an empty magazine`);
  }

  // And with something to switch to, it switches. The magazine is faked on the
  // client because the only way to earn real shot is to craft it from salvage;
  // what is under test here is the button, not the host's stock-keeping.
  const cycled = await page.evaluate(async () => {
    const g = window.__game;
    g.you.ammoStock = { chain: 12 };
    const sent = [];
    const real = g.net.socket.emit.bind(g.net.socket);
    g.net.socket.emit = (ev, d) => { if (ev === 'set-ammo') sent.push(d); return real(ev, d); };
    document.querySelector('#tbtns button[data-act="ammo"]')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    g.net.socket.emit = real;
    return sent;
  });
  console.log(`  SHOT with chainshot aboard asked for: ${JSON.stringify(cycled)}`);
  if (!cycled.includes('chain')) {
    problems.push(`${dev.name}: SHOT did not cycle onto the shot in the magazine`);
  }

  await page.screenshot({ path: path.join(OUT, `touch-${dev.name.replace(/\W+/g, '-')}.png`) });
  await page.close();
}

await browser.close();
files.close();
console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK — she sails from a phone: helm, sail, guns and menus all by thumb.');
process.exit(0);
