// Do the balls come out of the barrels you can SEE?
//
// muzzle-test compares the host against shared/rig.js, which is the host's own
// source — it cannot catch the two sides disagreeing. This reads the actual
// world position of every drawn barrel out of the scene graph and compares it
// with where the host says that gun's ball starts.
//
// The bug it was written for: the client built the hull's FULL complement of
// guns and merely hid the surplus, so with three guns aboard you saw barrels
// 0, 1 and 2 of a twenty-eight-gun layout — bunched at one end — while the host
// fired from three guns spread down the whole side. Nothing lined up, and no
// headless test could see it, because both halves were individually consistent.
//
//   node tools/gunfit-test.js [url]

import puppeteer from 'puppeteer';

const URL = process.argv[2] || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#sail:not([hidden])');
await page.type('#name', 'Gunfit');
await page.click('#sail');
await page.waitForFunction(() => window.__game?.me, { timeout: 30000 });
await wait(2000);

const CASES = [
  ['sailboat', 1], ['sailboat', 3],
  ['brigantine', 1], ['brigantine', 4], ['brigantine', 6],
  ['frigate', 2], ['frigate', 10],
  ['manofwar', 3], ['manofwar', 15],
  ['leviathan', 1], ['leviathan', 5], ['leviathan', 28],
];

console.log('class        guns   worst barrel-to-muzzle gap   spread along the side');
const results = await page.evaluate(async (cases) => {
  const THREE = await import('/vendor/three/three.module.js');
  const ship = await import('/js/ship.js');
  const { muzzle } = await import('/shared/combat.js');
  const out = [];

  for (const [cls, want] of cases) {
    const vis = ship.buildShip(0xa8342c, cls);
    ship.setGuns(vis, { port: want, starboard: want, bow: 0, stern: 0 });
    // Park her at the origin, heading zero, so hull space IS world space.
    vis.group.position.set(0, 0, 0);
    vis.group.rotation.set(0, 0, 0);
    vis.group.updateMatrixWorld(true);

    const drawn = vis.guns.port
      .filter((g) => g.visible)
      .map((g) => g.userData.barrel.getWorldPosition(new THREE.Vector3()));

    const fake = {
      x: 0, z: 0, heading: 0, vx: 0, vz: 0, cls,
      picks: {}, ammo: 'round',
    };
    let worst = 0;
    let minAlong = Infinity;
    let maxAlong = -Infinity;
    for (let i = 0; i < drawn.length; i++) {
      const m = muzzle(fake, 'port', i, drawn.length, 1.234, Math.PI / 2, 0.05);
      // The ball leaves the muzzle END; the mesh is centred on the barrel. Half
      // a barrel apart is expected and fine, so compare along the keel and in
      // height, which is where a mismatched LAYOUT shows up.
      worst = Math.max(worst, Math.abs(m.z - drawn[i].z), Math.abs(m.y - drawn[i].y));
      minAlong = Math.min(minAlong, drawn[i].z);
      maxAlong = Math.max(maxAlong, drawn[i].z);
    }
    out.push({
      cls, want, drawn: drawn.length, worst,
      spread: drawn.length > 1 ? maxAlong - minAlong : 0,
    });
  }
  return out;
}, CASES);

for (const r of results) {
  console.log(`${r.cls.padEnd(12)} ${String(r.want).padStart(4)}   ` +
    `${r.worst.toFixed(3).padStart(23)} m   ${r.spread.toFixed(1).padStart(6)} m`);
  if (r.drawn !== r.want) {
    problems.push(`${r.cls} with ${r.want} guns drew ${r.drawn}`);
  }
  if (r.worst > 0.35) {
    problems.push(`${r.cls} with ${r.want} guns: a ball starts ${r.worst.toFixed(2)} m ` +
      'from the barrel it is supposed to leave');
  }
  // Guns aboard should use the ship's side, not huddle at one end.
  if (r.want >= 4 && r.spread < 4) {
    problems.push(`${r.cls} with ${r.want} guns: they are bunched into ${r.spread.toFixed(1)} m`);
  }
}

await browser.close();
console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK — every ball leaves the barrel you can see, at every armament.');
process.exit(0);
