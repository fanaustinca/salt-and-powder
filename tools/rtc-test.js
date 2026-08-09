// Does the peer-to-peer lobby actually work?
//
// No Node game server anywhere in this test. It serves the built static site
// the way GitHub Pages does — from a sub-path, with nothing but files — opens
// two browser tabs, has one host a lobby and the other join it by code, and
// then checks that two captains can genuinely see and shoot at each other over
// a WebRTC data channel.
//
// Signalling runs against a PeerServer started here rather than the public
// broker, so the test is deterministic and works offline. The handshake code
// under test is identical either way.
//
//   node tools/build-static.js && node tools/rtc-test.js

import puppeteer from 'puppeteer';
import { PeerServer } from 'peer';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist');
const BASE = '/salt-and-powder';      // a project Pages site, not a domain root
const PORT = 4173;
const SIGNAL_PORT = 9000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// A static file server with no idea this is a game — exactly Pages' level of help.
const files = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (!rel.startsWith(BASE)) { res.writeHead(404).end('not found'); return; }
  rel = rel.slice(BASE.length) || '/';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => files.listen(PORT, r));

// PeerServer does not re-emit 'listening' on the object it hands back, so wait
// on the endpoint the client will actually call rather than on an event.
const signal = PeerServer({ port: SIGNAL_PORT, path: '/', allow_discovery: false });
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://localhost:${SIGNAL_PORT}/peerjs/id`)).ok) break;
  } catch { /* not up yet */ }
  if (i > 50) throw new Error('the signalling server never came up');
  await wait(100);
}
console.log(`signalling on :${SIGNAL_PORT}, static site on :${PORT}${BASE}/`);

const URL_BASE = `http://localhost:${PORT}${BASE}/?dev=1&broker=localhost:${SIGNAL_PORT}`;
const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const problems = [];
async function tab(label) {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 600 });
  // The /healthz probe is *meant* to 404 here — that is how the page works out
  // there is no server behind it — so its noise is not a problem.
  const expected = (url = '') => url.endsWith('/healthz');
  page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e}`));
  page.on('requestfailed', (r) => {
    if (!expected(r.url())) problems.push(`${label} REQ FAIL ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('Failed to load resource')) return;
    problems.push(`${label} console: ${m.text()}`);
  });
  return page;
}

// ---------------------------------------------------------------- the host tab
const hostPage = await tab('host');
await hostPage.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await hostPage.waitForSelector('#hostlobby');

// The static host has no /healthz, so the server route must not be on offer.
const serverOffered = await hostPage.$eval('#sail', (el) => !el.hidden);
console.log(`server route offered on a static host: ${serverOffered} (expect false)`);

// Both tabs are the same origin, so the name box remembers what the other one
// typed. Clear it or the second captain signs on as "HawkinsSilver".
const nameIt = async (page, who) => {
  await page.$eval('#name', (el) => { el.value = ''; });
  await page.type('#name', who);
};
await nameIt(hostPage, 'Hawkins');
await hostPage.click('#hostlobby');
await hostPage.waitForFunction(() => !document.getElementById('lobbychip').hidden,
  { timeout: 30000 });
const code = await hostPage.$eval('#lobbychip b', (el) => el.textContent.trim());
console.log(`lobby open, room code ${code}`);

await hostPage.waitForFunction(() => window.__game?.me, { timeout: 20000 });
await wait(2000);

// --------------------------------------------------------------- the guest tab
// Straight in on the invite link, which is what a guest is actually sent.
const guestPage = await tab('guest');
await guestPage.goto(`${URL_BASE}&join=${code}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await guestPage.waitForSelector('#codego');
await nameIt(guestPage, 'Silver');
await guestPage.click('#codego');
await guestPage.waitForFunction(() => window.__game?.me, { timeout: 30000 });
console.log('guest is aboard');
await wait(3000);

// ---------------------------------------------------------- do they see a world?
const survey = (label) => async (page) => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    return {
      id: g.net.id,
      mode: g.net.socket.mode,
      ships: g.net.latest(g.net.id) ? g.net.snapshots.at(-1).ships.size : 0,
      remotes: g.remotes.size,
      snapshots: g.net.snapshots.length,
      x: +g.me.x.toFixed(0), z: +g.me.z.toFixed(0),
      sea: +g.net.sea.toFixed(2),
      rtt: +(g.net.rtt * 1000).toFixed(0),
    };
  });
  console.log(`${label}: mode=${r.mode} id=${r.id?.slice(0, 8)} hulls=${r.ships} ` +
    `others drawn=${r.remotes} snapshots=${r.snapshots} at (${r.x},${r.z}) sea=${r.sea} rtt=${r.rtt}ms`);
  return r;
};
const h1 = await survey('host ')(hostPage);
const g1 = await survey('guest')(guestPage);

if (h1.mode !== 'host') problems.push(`host tab reported mode "${h1.mode}"`);
if (g1.mode !== 'guest') problems.push(`guest tab reported mode "${g1.mode}"`);
if (g1.snapshots < 5) problems.push('guest is receiving almost no snapshots');
if (h1.ships < 2) problems.push('host does not have both captains in its world');
if (g1.ships < 2) problems.push('guest cannot see the host');
if (g1.remotes < 1) problems.push('guest never built a mesh for the other ship');
if (h1.remotes < 1) problems.push('host never built a mesh for the guest');

// ------------------------------------------------- does the helm reach the host?
// The guest predicts locally, so only the HOST's copy of the guest proves the
// input crossed the channel and was simulated authoritatively.
const before = await hostPage.evaluate((id) => {
  const s = window.__game.net.latest(id);
  return s ? { x: s.x, z: s.z } : null;
}, g1.id);
await guestPage.evaluate(() => { window.__game.net.socket.emit('input', { r: 0, t: 1 }); });
await guestPage.keyboard.down('KeyW');
await wait(5000);
await guestPage.keyboard.up('KeyW');
const after = await hostPage.evaluate((id) => {
  const s = window.__game.net.latest(id);
  return s ? { x: s.x, z: s.z, speed: Math.hypot(s.vx, s.vz) } : null;
}, g1.id);
const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
console.log(`guest sailed ${moved.toFixed(1)} m as measured by the HOST ` +
  `(${(after?.speed * 1.94384).toFixed(1)} kn)`);
if (moved < 5) problems.push('guest input never reached the host');

// ----------------------------------------------------- do the guns cross the wire?
// Lay them alongside and have the guest fire. Bow on +Z means +X is PORT, so
// the guest goes to windward of nothing in particular at -X and fires to port,
// which is where the host is. (Get this backwards and the test "proves" the
// guns are broken while both ships sit there unharmed.)
const layAlongside = async () => {
  await hostPage.evaluate(() => window.__game.net.socket.emit('dev-place', { x: 0, z: 0, h: 0 }));
  await guestPage.evaluate(() => window.__game.net.socket.emit('dev-place', { x: -28, z: 0, h: 0 }));
};
await layAlongside();
await wait(1200);
const hullBefore = await hostPage.evaluate((id) => window.__game.net.latest(id)?.hp, h1.id);
for (let volley = 0; volley < 8; volley++) {
  await guestPage.evaluate(() => window.__game.net.socket.emit('fire', 'port'));
  await wait(900);
  await layAlongside();
  await wait(600);
}
const hullAfter = await hostPage.evaluate((id) => window.__game.net.latest(id)?.hp, h1.id);
console.log(`host's hull under fire from the guest: ${hullBefore} -> ${hullAfter}`);
if (!(hullAfter < hullBefore)) problems.push('the guest\'s guns did not hurt the host');

// --------------------------------------------------- profiles survive in the host
const saved = await hostPage.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('pirate.profiles') || '{}');
  return Object.keys(raw);
});
console.log(`captains on the host's books: ${saved.join(', ') || '(none yet)'}`);
if (!saved.includes('hawkins') || !saved.includes('silver')) {
  problems.push(`the host did not record both captains (got ${JSON.stringify(saved)})`);
}

// ---------------------------------------------------- a code nobody is sitting on
// Should fail fast and say why, rather than spinning until the open timeout.
const lostPage = await tab('stray');
await lostPage.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await lostPage.waitForSelector('#joinlobby');
await nameIt(lostPage, 'Nobody');
await lostPage.click('#joinlobby');
await lostPage.type('#code', 'ZZZZ');
const askedAt = Date.now();
await lostPage.click('#codego');
await lostPage.waitForFunction(
  () => /no lobby|could not|did not answer/i.test(document.getElementById('joinstatus').textContent),
  { timeout: 25000 });
const complaint = await lostPage.$eval('#joinstatus', (el) => el.textContent);
const took = ((Date.now() - askedAt) / 1000).toFixed(1);
console.log(`bad room code rejected in ${took}s: "${complaint}"`);
if (Date.now() - askedAt > 12000) problems.push('a bad room code took far too long to be refused');
if (!/no lobby is open/i.test(complaint)) {
  problems.push(`a bad room code gave a vague reason: "${complaint}"`);
}
await lostPage.close();

// ------------------------------------------- and when the host closes the lobby?
// The channel does not die the instant the tab does — ICE has to notice — so
// give it a while rather than asserting on a race.
await hostPage.close();
let stranded = false;
for (let i = 0; i < 40 && !stranded; i++) {
  stranded = await guestPage.evaluate(() =>
    window.__game.net.socket.wire === null
    && document.getElementById('lobbychip').classList.contains('gone'));
  if (!stranded) await wait(500);
}
console.log(`guest was told the lobby closed: ${stranded}`);
if (!stranded) problems.push('the guest was never told the host had gone');

await browser.close();
files.close();
signal.close?.();

console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK — two browsers played the same sea with no game server between them.');
process.exit(0);
