// Plan view of the ship with the bow pointing up the screen, so the boom's
// side can be checked against the wind by eye.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:3000';
mkdirSync('./shots', { recursive: true });

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 700, height: 700 });
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)));
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.type('#name', 'Plan');
await page.click('#sail');
await new Promise((r) => setTimeout(r, 4000));
await page.keyboard.down('Space'); // auto-trim so she is properly set
await new Promise((r) => setTimeout(r, 5000));
await page.keyboard.up('Space');

const info = await page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.js');
  const g = window.__game;
  const me = g.me;

  // Freeze a plan view: camera overhead, bow pointing up the screen.
  window.__freezeCamera = true;
  const fwd = new THREE.Vector3(Math.sin(me.heading), 0, Math.cos(me.heading));
  g.camera.up.copy(fwd);
  g.camera.position.set(me.x, 42, me.z);
  g.camera.lookAt(me.x, 0, me.z);
  g.renderer.render(g.scene, g.camera);

  return {
    heading: +(me.heading * 180 / Math.PI).toFixed(1),
    windDirBlowingToward: +(g.net.wind.dir * 180 / Math.PI).toFixed(1),
    twaDeg: +(me.twa * 180 / Math.PI).toFixed(1),
    awRel: +me.awRel.toFixed(2),
    sailSide: me.sailSide,
    sailAngleDeg: +(me.sailAngle * 180 / Math.PI).toFixed(1),
    expect: me.sailSide > 0
      ? 'wind blows toward starboard -> boom should be on STARBOARD = RIGHT of screen'
      : 'wind blows toward port -> boom should be on PORT = LEFT of screen',
  };
});
console.log(info);

await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: './shots/plan.png' });

await browser.close();
