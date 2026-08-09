// Headless numbers for the sailing model: what each class actually does.
//
// This used to sweep the sheet across every point of sail. There is no wind and
// no sheet any more, so the interesting axes are the ones that are left — how
// fast she gets, how long she takes to get there, and how she answers her helm
// at speed and at rest.
//
//   npm run tune

import {
  createShip, stepShip, TICK_DT, TICK_HZ, msToKnots, classOf,
  SHIP_CLASSES, MIN_STEERAGE,
} from '../shared/physics.js';

const sail = (ship, input, seconds) => {
  for (let i = 0; i < TICK_HZ * seconds; i++) stepShip(ship, input, TICK_DT);
  return ship;
};
const fresh = (cls) => {
  const ship = createShip('t', 'tune', 0, cls);
  Object.assign(ship, { x: 0, z: 0, vx: 0, vz: 0, omega: 0, heading: 0, throttle: 0 });
  return ship;
};

console.log('class          top(kn)  0-90%   turn @speed   turn stopped   ratio');
console.log('                          (s)     (deg/s)       (deg/s)');

for (const cls of Object.keys(SHIP_CLASSES)) {
  const spec = classOf(cls);

  // Flat out in a straight line.
  const ship = fresh(cls);
  sail(ship, { rudder: 0, throttle: 1 }, 90);
  const top = msToKnots(ship.speed);

  // How long to reach 90% of that from a standing start.
  const accel = fresh(cls);
  let ticks = 0;
  const target = ship.speed * 0.9;
  while (accel.speed < target && ticks < TICK_HZ * 300) {
    stepShip(accel, { rudder: 0, throttle: 1 }, TICK_DT);
    ticks++;
  }
  const toSpeed = ticks / TICK_HZ;

  // Rate of turn with way on...
  const fast = fresh(cls);
  sail(fast, { rudder: 0, throttle: 1 }, 90);
  const h0 = fast.heading;
  sail(fast, { rudder: 1, throttle: 1 }, 6);
  const turnFast = Math.abs(fast.heading - h0) * 57.2958 / 6;

  // ...and dead in the water, which is the floor that lets you off a beach.
  const still = fresh(cls);
  const h1 = still.heading;
  sail(still, { rudder: 1, throttle: 0 }, 6);
  const turnSlow = Math.abs(still.heading - h1) * 57.2958 / 6;

  console.log(`${cls.padEnd(12)} ${top.toFixed(1).padStart(7)}  ` +
    `${toSpeed.toFixed(1).padStart(5)}   ${turnFast.toFixed(1).padStart(9)}   ` +
    `${turnSlow.toFixed(1).padStart(11)}   ${(turnFast / (turnSlow || 1)).toFixed(1).padStart(5)}` +
    `${top > spec.maxSpeed * 1.94384 * 1.05 ? '  << over class top!' : ''}`);
}

console.log(`\nSteerage floor is ${MIN_STEERAGE} of full, so a stopped ship still answers her`);
console.log('helm at about a third the rate — enough to work her off a beach, not enough');
console.log('to make gathering way pointless. tools/aground-test.js holds both ends of that.');
