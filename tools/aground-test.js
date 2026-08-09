// Can you get off a beach?
//
// Reported from play: "I'm stuck after crashing into the safe haven." Two
// things conspired. Steerage was proportional to speed with no floor, so a ship
// stopped against the land could not turn away from it; and keepOffTheRocks put
// her down exactly on its own margin, so `clear > margin` never became true and
// it re-ran every tick, scaling her whole velocity by a quarter — including the
// part heading out to sea. Bow into the beach, no turn, no way on, for ever.
//
// This drives the real host: run her ashore, then try to leave.
//
//   node tools/aground-test.js

import { GameHost } from '../shared/game-host.js';
import { NullTransport, MemoryProfiles } from '../shared/transport.js';
import { TICK_HZ, classOf, MIN_STEERAGE } from '../shared/physics.js';
import { HAVENS, landClearance } from '../shared/world.js';

let clock = 0;
const dt = 1 / TICK_HZ;
const tx = new NullTransport();
const host = new GameHost({
  transport: tx, profiles: new MemoryProfiles(), now: () => clock, dev: true, log: () => {},
});

const run = (ticks) => { for (let i = 0; i < ticks; i++) { clock += dt; host.tick(dt); } };
const problems = [];
const isle = HAVENS[0];

/** Put her hard against `isle`, bow pointing straight at it, dead in the water. */
function strandHer(p, cls) {
  p.ship.cls = cls;
  p.ship.maxHp = classOf(cls).hp;
  p.ship.hp = classOf(cls).hp;
  Object.assign(p.ship, {
    // Just off the beach on the +X side, heading due -X: straight into the land.
    x: isle.x + isle.radius + 1,
    z: isle.z,
    heading: -Math.PI / 2,
    vx: 0, vz: 0, omega: 0, throttle: 1, sunk: false,
  });
}

console.log(`aground on ${isle.name} (radius ${isle.radius} m)\n`);

for (const cls of ['sailboat', 'frigate', 'leviathan']) {
  host.join(cls, { name: cls });
  const p = host.players.get(cls);
  strandHer(p, cls);

  // Five seconds of sail, hard into the beach, to get well and truly stuck.
  host.message(cls, 'input', { r: 0, t: 1 });
  run(TICK_HZ * 5);
  const stuck = {
    clear: +landClearance(p.ship.x, p.ship.z).toFixed(1),
    speed: +p.ship.speed.toFixed(2),
    heading: p.ship.heading,
  };

  // Work her round and stand out to sea — steering for open water the way a
  // player would, rather than holding one setting and hoping.
  const standOut = (seconds) => {
    for (let s = 0; s < TICK_HZ * seconds; s++) {
      const out = Math.atan2(p.ship.x - isle.x, p.ship.z - isle.z);
      let err = out - p.ship.heading;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      host.message(cls, 'input', { r: Math.abs(err) < 0.05 ? 0 : -Math.sign(err), t: 1 });
      clock += dt;
      host.tick(dt);
    }
    return +landClearance(p.ship.x, p.ship.z).toFixed(1);
  };
  const away = standOut(18);
  const turned = Math.abs(p.ship.heading - stuck.heading);
  const speed = +p.ship.speed.toFixed(2);
  // What matters is that she is leaving, not that she has covered some fixed
  // distance — a Leviathan takes half a minute to do what a sailboat does in
  // five seconds, and that is the hull, not a bug.
  const later = standOut(8);

  console.log(`${cls.padEnd(10)} pinned ${String(stuck.clear).padStart(5)} m clear, ` +
    `${stuck.speed} m/s  ->  swung ${String((turned * 57.3).toFixed(0)).padStart(3)}°  ->  ` +
    `${String(away).padStart(6)} m clear at 18 s, ${String(later).padStart(6)} m at 26 s, ` +
    `making ${speed} m/s`);

  if (turned < 0.5) problems.push(`${cls}: could not turn away from the beach (${(turned * 57.3).toFixed(0)}°)`);
  if (away < 15) problems.push(`${cls}: barely moved — ${away} m clear after 18 s standing out`);
  if (later <= away + 15) problems.push(`${cls}: not getting away — ${away} m then ${later} m`);
  if (speed < 2) problems.push(`${cls}: cannot gather way off the beach (${speed} m/s)`);
  if (p.ship.sunk) problems.push(`${cls}: sank while trying to get off`);
  host.leave(cls);
}

// --- the helm must still be worth having way on for --------------------------
// The floor is a rescue, not a free hand: she should turn markedly better with
// speed than without, or the sailing model stops meaning anything.
host.join('helm', { name: 'Helm' });
const p = host.players.get('helm');
const swing = (throttle, seconds) => {
  Object.assign(p.ship, {
    x: 0, z: 0, heading: 0, vx: 0, vz: 0, omega: 0, throttle, sunk: false,
  });
  // Let her gather way at that setting first.
  host.message('helm', 'input', { r: 0, t: 0 });
  run(TICK_HZ * 10);
  const h0 = p.ship.heading;
  host.message('helm', 'input', { r: 1, t: 0 });
  run(TICK_HZ * seconds);
  return Math.abs(p.ship.heading - h0) * 57.3;
};
const stopped = swing(0, 4);
const underway = swing(1, 4);
console.log(`\nfour seconds of hard helm: stopped ${stopped.toFixed(0)}°, ` +
  `under way ${underway.toFixed(0)}°  (floor is ${MIN_STEERAGE} of full)`);
if (stopped < 3) problems.push('a stopped ship still cannot turn at all');
if (underway < stopped * 1.6) {
  problems.push(`speed barely helps the helm (${stopped.toFixed(0)}° vs ${underway.toFixed(0)}°) — ` +
    'the floor is too high');
}

console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const q of problems) console.log(`  - ${q}`);
  process.exit(1);
}
console.log('OK — you can always work her off a beach, and speed still buys you helm.');
