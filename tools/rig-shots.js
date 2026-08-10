// Photograph every class, so a rig change can be looked at rather than imagined.
//
// Builds each hull straight from shared/rig.js in an empty scene, frames it
// broadside-on, and writes shots/rig-<class>.png. Also counts what each class
// actually carries, which is the quickest way to see that a table edit did what
// it was supposed to.
//
//   node tools/rig-shots.js [url]

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:3000';
const OUT = './shots';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 620, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#sail:not([hidden])');
await page.type('#name', 'Rigger');
await page.click('#sail');
await page.waitForFunction(() => window.__game?.me, { timeout: 30000 });
await wait(2500);

// A bare scene with one ship in it, lit the same way the game lights them.
await page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.js');
  const g = window.__game;
  // Stop the game's own loop, or it repaints the canvas between our render and
  // the screenshot and we photograph the sea instead of the ship. The running
  // chain is a self-scheduling rAF, so taking rAF away ends it after this frame.
  window.requestAnimationFrame = () => 0;
  document.getElementById('ui').style.display = 'none';
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x9fb6c4);
  s.environment = g.scene.environment;
  const key = new THREE.DirectionalLight(0xfff2dc, 2.6);
  key.position.set(-40, 60, 40);
  s.add(key, new THREE.HemisphereLight(0xbfd8ef, 0x27343c, 1.0));
  window.__rig = { THREE, s, cam: new THREE.PerspectiveCamera(38, 1100 / 620, 0.5, 4000) };
});

const CLASSES = ['sailboat', 'cutter', 'brigantine', 'corvette', 'frigate',
  'galleon', 'manofwar', 'flagship', 'leviathan'];

console.log('class        masts  square sails  gaff/lateen  jibs   yard span');
for (const cls of CLASSES) {
  const info = await page.evaluate(async (c) => {
    const { THREE, s, cam } = window.__rig;
    const shipMod = await import('/js/ship.js');
    const rigMod = await import('/shared/rig.js');
    // Clear whatever was posed last.
    for (const child of [...s.children]) if (child.userData.hull) s.remove(child);

    const vis = shipMod.buildShip(0xa8342c, c);
    vis.group.userData.hull = true;
    shipMod.setGuns(vis, { port: 99, starboard: 99, bow: 1, stern: 1 });
    shipMod.animateSails(vis, 1, 0);
    s.add(vis.group);

    const rig = rigMod.rigOf(c);
    const box = new THREE.Box3().setFromObject(vis.group);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    // Three-quarter from the bow. Dead abeam is the worst angle for judging a
    // square rig: the yards point straight at the camera and every sail is
    // edge-on, so a full suit of canvas reads as a row of vertical strips.
    const span = Math.max(size.z, size.y * 1.4);
    cam.position.set(span * 1.02, mid.y + size.y * 0.28, span * 0.82);
    cam.lookAt(mid.x, mid.y, mid.z);
    cam.updateProjectionMatrix();

    const kinds = {};
    for (const sail of vis.sails) kinds[sail.kind] = (kinds[sail.kind] || 0) + 1;
    return {
      masts: rig.masts, kinds, gaff: rig.gaff, jib: rig.jib, mizzen: rig.mizzen,
      sails: vis.sails.length, width: +size.x.toFixed(1), len: +size.z.toFixed(1),
    };
  }, cls);

  // Render the posed scene into the real canvas, then photograph it.
  await page.evaluate(() => {
    const g = window.__game;
    const { s, cam } = window.__rig;
    g.renderer.render(s, cam);
  });
  await page.screenshot({ path: `${OUT}/rig-${cls}.png` });

  // A second shot from ahead and low. Everything on the stem — beakhead, ram,
  // figurehead, bowsprit — is edge-on or hidden in the three-quarter view, and
  // two of those shipped pointing backwards without it being visible there.
  await page.evaluate(() => {
    const { THREE, s, cam } = window.__rig;
    const hull = s.children.find((c) => c.userData.hull);
    const box = new THREE.Box3().setFromObject(hull);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    cam.position.set(size.x * 0.75, mid.y + size.y * 0.06, box.max.z + size.z * 0.42);
    cam.lookAt(0, mid.y - size.y * 0.08, box.max.z - size.z * 0.18);
    cam.updateProjectionMatrix();
    window.__game.renderer.render(s, cam);
  });
  await page.screenshot({ path: `${OUT}/bow-${cls}.png` });

  // And straight down, with the rig hidden — the plan view is a hull's other
  // signature, and it is the one thing neither of the other two shots shows.
  await page.evaluate(() => {
    const { THREE, s, cam } = window.__rig;
    const hull = s.children.find((c) => c.userData.hull);
    hull.traverse((o) => {
      if (o.isMesh && o.position.y > 6) { o.userData.hidden = true; o.visible = false; }
    });
    const box = new THREE.Box3().setFromObject(hull);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    cam.position.set(mid.x, mid.y + Math.max(size.z, size.x) * 1.5, mid.z);
    cam.up.set(0, 0, 1);
    cam.lookAt(mid.x, mid.y, mid.z);
    cam.updateProjectionMatrix();
    window.__game.renderer.render(s, cam);
    hull.traverse((o) => { if (o.userData.hidden) o.visible = true; });
    cam.up.set(0, 1, 0);
  });
  await page.screenshot({ path: `${OUT}/plan-${cls}.png` });

  const sq = info.kinds.square || 0;
  const fa = (info.kinds.gaff || 0);
  console.log(`${cls.padEnd(12)} ${String(info.masts).padStart(3)}  ` +
    `${String(sq).padStart(11)}  ${String(fa).padStart(11)}  ` +
    `${String(info.jib).padStart(4)}   ${String(info.width).padStart(5)} m`);
}

console.log(`\nwrote ${CLASSES.length} shots to ${OUT}/`);
console.log('errors:', errors.join('\n') || '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
