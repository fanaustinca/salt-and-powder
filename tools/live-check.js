// Does the published site actually work?
//
// Everything else is tested against a local static server and a local
// signalling server. This drives the real https://<user>.github.io/<repo>/ with
// the real public broker, because "the build is correct" and "the deploy works"
// are different claims and only one of them is checked by CI.
//
//   node tools/live-check.js [url]

import puppeteer from 'puppeteer';

const URL = process.argv[2] || 'https://fanaustinca.github.io/salt-and-powder/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const problems = [];
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 700 });
page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
page.on('requestfailed', (r) => {
  if (!r.url().endsWith('/healthz')) problems.push(`REQ FAIL ${r.url()} ${r.failure()?.errorText}`);
});
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().endsWith('/healthz')) {
    problems.push(`HTTP ${r.status()} ${r.url()}`);
  }
});

console.log(`loading ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#hostlobby', { timeout: 30000 });

// The import map has to survive the /<repo>/ base path or nothing loads at all.
await page.waitForFunction(() => !!window.__game, { timeout: 30000 })
  .catch(() => problems.push('the client never finished booting'));

const offered = await page.$eval('#sail', (el) => !el.hidden);
console.log(`server route offered: ${offered} (expect false on Pages)`);
if (offered) problems.push('Pages is somehow claiming to have a game server');

// Open a lobby for real, against the public PeerJS broker.
await page.$eval('#name', (el) => { el.value = ''; });
await page.type('#name', 'Livecheck');
await page.click('#hostlobby');
try {
  await page.waitForFunction(() => !document.getElementById('lobbychip').hidden,
    { timeout: 45000 });
  const code = await page.$eval('#lobbychip b', (el) => el.textContent.trim());
  console.log(`lobby open on the public broker, room code ${code}`);
} catch {
  const why = await page.$eval('#joinstatus', (el) => el.textContent);
  problems.push(`could not open a lobby on the live site: "${why}"`);
}

await wait(4000);
const state = await page.evaluate(() => {
  const g = window.__game;
  return g?.me ? {
    mode: g.net.socket.mode,
    hulls: g.net.snapshots.at(-1)?.ships.size ?? 0,
    snapshots: g.net.snapshots.length,
    tris: g.renderer.info.render.triangles,
  } : null;
});
console.log(state
  ? `sailing: mode=${state.mode} hulls=${state.hulls} snapshots=${state.snapshots} ` +
    `triangles=${state.tris}`
  : 'never got on the water');
if (!state) problems.push('the live site never put a ship on the water');
else if (state.snapshots < 5) problems.push('the live host is not producing snapshots');
else if (!state.tris) problems.push('nothing is being rendered');

await browser.close();
console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK — the published site boots, hosts a lobby and sails.');
process.exit(0);
