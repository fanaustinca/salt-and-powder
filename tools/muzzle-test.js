// Checks a fired ball actually leaves the barrel you can see. The client places
// gun meshes from shared/rig.js and the host fires from the same table, so the
// two positions should agree to within centimetres on every class.
import { GameHost } from '../shared/game-host.js';
import { NullTransport, MemoryProfiles } from '../shared/transport.js';
import { TICK_HZ } from '../shared/physics.js';
import { rigOf, gunPlacements } from '../shared/rig.js';
import { muzzle, gunsFor } from '../shared/combat.js';

let clock = 0;
const tx = new NullTransport();
const host = new GameHost({ transport: tx, profiles: new MemoryProfiles(),
  now: () => clock, dev: true, log: () => {} });
host.join('a', { name: 'Gunner' });
const p = host.players.get('a');

let worst = 0;
for (const cls of ['sailboat', 'brigantine', 'frigate', 'manofwar', 'flagship']) {
  const rig = rigOf(cls);
  p.ship.cls = cls;
  p.ship.picks = { broadside: 30 };                 // every gun run out
  Object.assign(p.ship, { x: 0, z: 0, heading: 0.7, vx: 0, vz: 0 });
  const count = gunsFor(p.ship.picks, cls).port;
  const places = gunPlacements(rig, count);

  let maxOff = 0;
  for (let i = 0; i < count; i++) {
    const m = muzzle(p.ship, 'port', i, count, 1.234, Math.PI / 2, 0.05);
    const g = places[i];
    // Where that barrel is drawn, in world space.
    const h = p.ship.heading;
    // The ball must leave the muzzle END of the drawn barrel, not its centre.
    const wx = p.ship.x + Math.sin(h) * g.along + Math.cos(h) * g.out;
    const wz = p.ship.z + Math.cos(h) * g.along - Math.sin(h) * g.out;
    maxOff = Math.max(maxOff, Math.hypot(m.x - wx, m.z - wz), Math.abs(m.y - g.height));
  }
  worst = Math.max(worst, maxOff);
  console.log(`${cls.padEnd(11)} ${String(count).padStart(2)} guns/side, ` +
    `${new Set(places.map(q => q.height)).size} decks — worst muzzle offset ${maxOff.toFixed(3)} m`);
}
console.log(worst < 0.5 ? '\nOK — shots leave the guns.' : '\nFAILED — shots miss their barrels.');

// --- and the host must fire one ball per gun, on every class ----------------
import { GameHost as GH2 } from '../shared/game-host.js';
const tx2 = new NullTransport();
let c2 = 0;
const h2 = new GH2({ transport: tx2, profiles: new MemoryProfiles(), now: () => c2, dev: true, log: () => {} });
h2.join('g', { name: 'Broadside' });
const gp = h2.players.get('g');
let allGood = true;
for (const cls of ['sailboat', 'cutter', 'brigantine', 'corvette', 'frigate',
                   'galleon', 'manofwar', 'flagship', 'leviathan']) {
  gp.ship.cls = cls;
  gp.ship.picks = { broadside: 40 };
  gp.ship.reload = { port: 0, starboard: 0, bow: 0, stern: 0 };
  gp.ship.sunk = false;
  const before = tx2.sent.filter((m) => m.event === 'shot').length;
  h2.combat.shots.length = 0;
  h2.message('g', 'fire', { b: Math.PI / 2, r: 90 });
  const ev = tx2.sent.filter((m) => m.event === 'shot').slice(before)[0];
  const expect = gunsFor(gp.ship.picks, cls).port;
  const ok = ev && ev.data.count === expect && h2.combat.shots.length === expect;
  if (!ok) allGood = false;
  console.log(`${cls.padEnd(11)} guns ${String(expect).padStart(2)} -> ` +
    `balls in the air ${String(h2.combat.shots.length).padStart(2)} ${ok ? '' : '  <-- MISMATCH'}`);
}
console.log(allGood ? 'OK — every gun fires a ball.' : 'FAILED — guns are not all firing.');
if (!allGood) process.exit(1);

process.exit(worst < 0.5 && allGood ? 0 : 1);
