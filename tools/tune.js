// Headless check of the sailing model: hold a heading, trim optimally, and see
// what she does on every point of sail.  `npm run tune`
import { createShip, stepShip, TICK_DT, MAX_SAIL_ANGLE, msToKnots, clamp } from '../shared/physics.js';

const wind = { dir: 0, speed: 11 };

console.log('TWA   sheet   speed(kn)   eff   VMG(kn)');
for (let deg = 0; deg <= 180; deg += 15) {
  const ship = createShip('t', 'test', 0);
  // Wind blows toward +Z; sail with the requested true wind angle off the bow.
  ship.heading = Math.PI - (deg * Math.PI) / 180;
  ship.x = ship.z = ship.vx = ship.vz = 0;

  for (let i = 0; i < 30 * 90; i++) {
    // Auto-trim does the sheet; the autopilot just pins the test angle.
    ship.heading = Math.PI - (deg * Math.PI) / 180;
    ship.omega = 0;
    stepShip(ship, { rudder: 0, sheet: 0, hoist: 0 }, wind, TICK_DT);
  }
  // Signed: inside the no-go zone the sail is aback and she makes sternway.
  const kn = msToKnots(Math.sign(ship.vf) * ship.speed);
  const vmg = msToKnots(ship.speed * Math.cos(ship.twa)); // + = gaining ground to windward
  console.log(
    `${String(deg).padStart(3)}   ${ship.sheet.toFixed(2)}    ${kn.toFixed(2).padStart(6)}    ` +
      `${ship.efficiency.toFixed(2)}   ${vmg.toFixed(2).padStart(6)}`
  );
}

// Mistrim penalty at a beam reach.
console.log('\nbeam reach, sheet swept:');
for (let sheet = 0; sheet <= 1.0001; sheet += 0.125) {
  const ship = createShip('t', 'test', 0);
  ship.heading = Math.PI / 2;
  ship.x = ship.z = ship.vx = ship.vz = 0;
  for (let i = 0; i < 30 * 90; i++) {
    ship.sheet = sheet;
    ship.manual = 1; // hold off auto-trim so the forced sheet stands
    ship.heading = Math.PI / 2;
    ship.omega = 0;
    stepShip(ship, { rudder: 0, sheet: 0, hoist: 0 }, wind, TICK_DT);
  }
  console.log(`  sheet ${sheet.toFixed(3)}  ->  ${msToKnots(ship.speed).toFixed(2)} kn  (eff ${ship.efficiency.toFixed(2)})`);
}
