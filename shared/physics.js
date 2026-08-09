// Shared ship movement. Runs identically on the host (authority) and on the
// client (local prediction), so both sides must import this exact file.
//
// Conventions
//   heading h : yaw in radians. Forward = (sin h, 0, cos h).
//               +X is the PORT side. `heading` is a maths angle about +Y, which
//               runs anticlockwise from the helmsman's view, so a starboard turn
//               LOWERS it — hence the negated rudder below. Getting this wrong
//               mirrors the controls and the compass.
import { SEA, tsunamiSlope } from './waves.js';
import { statsFor } from './combat.js';

const _slope = { x: 0, z: 0 };

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;
export const SNAPSHOT_HZ = 15;

/**
 * How much helm she still answers with no way on at all, as a fraction of full
 * steerage. Realistically this would be zero — a rudder does nothing without
 * water moving past it — but zero makes running aground unrecoverable: stopped
 * against a beach with the bow into it, you cannot turn, and sail only drives
 * you further on. Being able to work her round slowly is worth more than the
 * realism.
 */
export const MIN_STEERAGE = 0.34;

export const WORLD = {
  radius: 2500,
  spawnRadius: 260,
};

/**
 * The ladder. Bigger ships hit harder and carry more, and pay for it in speed
 * and turning. Top speeds are in m/s — a sailboat's 15 is about 29 knots, which
 * is a bit over one ship length a second and reads as genuinely quick.
 *
 * Everything gained roughly 17% on top speed and 30% on acceleration, because
 * the old numbers made crossing open water a chore and left a stern chase
 * feeling like neither ship was trying. Drag is derived from these two below,
 * so a class always settles at exactly the top speed written here.
 */
export const SHIP_CLASSES = {
  sailboat: {
    name: 'Sailboat', tier: 0, cost: 0,
    length: 14, beam: 4.6,
    hp: 100, maxSpeed: 15.2, accel: 3.8, turn: 1.55, angDamp: 3.00,
    maxBroadside: 3, cargo: 8,
  },
  cutter: {
    name: 'Cutter', tier: 1, cost: 400,
    length: 17, beam: 5.4,
    // A cutter's headsail makes her the quickest thing afloat for her size.
    hp: 140, maxSpeed: 15.9, accel: 4.0, turn: 1.50, angDamp: 2.95,
    maxBroadside: 4, cargo: 12,
  },
  brigantine: {
    name: 'Brigantine', tier: 2, cost: 1100,
    length: 22, beam: 6.6,
    hp: 200, maxSpeed: 14.8, accel: 3.2, turn: 1.22, angDamp: 2.70,
    maxBroadside: 6, cargo: 18,
  },
  corvette: {
    name: 'Corvette', tier: 3, cost: 2400,
    length: 27, beam: 7.8,
    hp: 280, maxSpeed: 14.1, accel: 2.9, turn: 1.10, angDamp: 2.55,
    maxBroadside: 8, cargo: 24,
  },
  frigate: {
    name: 'Frigate', tier: 4, cost: 4400,
    length: 32, beam: 9.0,
    hp: 350, maxSpeed: 13.5, accel: 2.6, turn: 0.98, angDamp: 2.40,
    maxBroadside: 10, cargo: 32,
  },
  galleon: {
    name: 'Galleon', tier: 5, cost: 6400,
    length: 38, beam: 10.8,
    // Tubby and slow, but she carries a fortune and towers over a frigate.
    hp: 460, maxSpeed: 11.9, accel: 2.3, turn: 0.86, angDamp: 2.25,
    maxBroadside: 12, cargo: 64,
  },
  manofwar: {
    name: 'Man-of-War', tier: 6, cost: 9800,
    length: 44, beam: 12.0,
    hp: 560, maxSpeed: 12.6, accel: 2.1, turn: 0.78, angDamp: 2.10,
    maxBroadside: 15, cargo: 50,
  },
  flagship: {
    name: 'Flagship', tier: 7, cost: 19000,
    length: 56, beam: 15.0,
    hp: 850, maxSpeed: 11.7, accel: 1.7, turn: 0.62, angDamp: 1.90,
    maxBroadside: 20, cargo: 72,
  },
  leviathan: {
    name: 'Leviathan', tier: 8, cost: 38000,
    length: 68, beam: 18.0,
    hp: 1250, maxSpeed: 10.8, accel: 1.5, turn: 0.52, angDamp: 1.80,
    maxBroadside: 28, cargo: 104,
  },
};

// Quadratic drag chosen so each class actually settles at its stated top speed.
for (const c of Object.values(SHIP_CLASSES)) {
  c.drag = c.accel / (c.maxSpeed * c.maxSpeed);
  c.dragLat = c.drag * 9;   // the hull slides sideways far less willingly
}

export const CLASS_ORDER = Object.keys(SHIP_CLASSES)
  .sort((a, b) => SHIP_CLASSES[a].tier - SHIP_CLASSES[b].tier);

export const nextClass = (key) => CLASS_ORDER[CLASS_ORDER.indexOf(key) + 1] || null;
export const classOf = (key) => SHIP_CLASSES[key] || SHIP_CLASSES.sailboat;

export function normalizeAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createShip(id, name, spawnAngle, cls = 'sailboat') {
  const c = classOf(cls);
  const r = WORLD.spawnRadius;
  return {
    id,
    name,
    cls,
    x: Math.sin(spawnAngle) * r,
    z: Math.cos(spawnAngle) * r,
    heading: normalizeAngle(spawnAngle + Math.PI),
    vx: 0,
    vz: 0,
    omega: 0,
    throttle: 0.5,   // 0..1 — a sailing ship has no astern gear
    speed: 0,
    vf: 0,

    // --- combat ---
    hp: c.hp,
    maxHp: c.hp,
    armour: 0,
    xp: 0,
    level: 1,
    picks: {},
    sunk: false,
    reload: { port: 0, starboard: 0, bow: 0, stern: 0 },
    barrels: 1,
    ammo: 'round',

    // --- trade ---
    cargo: 0,
    docked: null,
  };
}

export function defaultInput() {
  return { rudder: 0, throttle: 0, seq: 0 };
}

/**
 * Advance one ship by dt seconds. Mutates `ship`.
 * input.rudder/throttle are each -1, 0 or +1 (key state).
 * `time` is the shared clock, needed only so a passing rogue wave can shove her.
 */
export function stepShip(ship, input, dt, time = null) {
  const cls = classOf(ship.cls);
  const stats = statsFor(ship.picks);

  // Guns run out and are sponged whether or not anyone is watching.
  for (const k in ship.reload) if (ship.reload[k] > 0) ship.reload[k] = Math.max(0, ship.reload[k] - dt);

  if (ship.sunk) {
    ship.vx *= 1 - 1.6 * dt;
    ship.vz *= 1 - 1.6 * dt;
    ship.x += ship.vx * dt;
    ship.z += ship.vz * dt;
    ship.speed = Math.hypot(ship.vx, ship.vz);
    return ship;
  }

  // --- sail handling: no astern on a square rig, and she is slow to gather way ---
  ship.throttle = clamp(ship.throttle + (input.throttle || 0) * 0.8 * dt, 0, 1);

  const fx = Math.sin(ship.heading);
  const fz = Math.cos(ship.heading);
  const rx = Math.cos(ship.heading);
  const rz = -Math.sin(ship.heading);

  let vf = ship.vx * fx + ship.vz * fz;
  let vl = ship.vx * rx + ship.vz * rz;

  const thrust = ship.throttle * cls.accel * stats.speed;
  vf += (thrust - Math.sign(vf) * cls.drag * vf * vf) * dt;
  vl -= Math.sign(vl) * cls.dragLat * vl * vl * dt;
  vf -= vf * 0.05 * dt;
  vl -= vl * 0.9 * dt;

  ship.vx = fx * vf + rx * vl;
  ship.vz = fz * vf + rz * vl;

  // A rogue wave's face is steep enough to slide down — she surfs off the crest.
  if (time !== null && SEA.tsunami) {
    tsunamiSlope(ship.x, ship.z, time, SEA.tsunami, _slope);
    ship.vx -= 9.81 * 0.8 * _slope.x * dt;
    ship.vz -= 9.81 * 0.8 * _slope.z * dt;
  }

  // --- steering: she answers best with water flowing over the rudder ---
  // But never not at all. Zero steerage at zero speed meant a ship stopped
  // against a beach could not turn away from it, and drove straight back on
  // every time you gave her sail — a dead end you could only leave by sinking.
  // The floor is her being worked round with sweeps and a kedge: slow, but
  // always possible.
  const way = clamp(Math.abs(vf) / (cls.maxSpeed * 0.22), 0, 1);
  // Making sternway reverses the helm, but only once she really is going
  // astern — flipping it either side of dead stop makes the wheel feel random.
  const sense = vf < -cls.maxSpeed * 0.04 ? -1 : 1;
  const steerage = Math.max(way, MIN_STEERAGE) * sense;
  const torque = -(input.rudder || 0) * cls.turn * stats.rudder * steerage;
  ship.omega += (torque - ship.omega * cls.angDamp) * dt;
  ship.heading = normalizeAngle(ship.heading + ship.omega * dt);

  ship.x += ship.vx * dt;
  ship.z += ship.vz * dt;

  // --- soft boundary: the open ocean pushes you back toward the chart ---
  const dist = Math.hypot(ship.x, ship.z);
  if (dist > WORLD.radius) {
    const push = Math.min((dist - WORLD.radius) * 0.02, 2.5) * dt * 60;
    ship.x -= (ship.x / dist) * push;
    ship.z -= (ship.z / dist) * push;
  }

  ship.speed = Math.hypot(ship.vx, ship.vz);
  ship.vf = vf;
  return ship;
}

export const msToKnots = (v) => v * 1.94384;
