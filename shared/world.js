// The chart: islands, Safe Havens and home bases.
//
// Every island is derived from a seed, so the host and every client build the
// identical world without anyone sending terrain over the wire.

import { WORLD } from './physics.js';

export const DOCK_RANGE = 60;      // how close counts as alongside
export const DOCK_SPEED = 3.2;     // and how slowly you must be going
export const SAFE_MARGIN = 230;    // no guns fire this close to a Safe Haven

/** Deterministic 0..1 — same number on every machine for the same input. */
function rnd(n) {
  const s = Math.sin(n * 91.7 + 41.3) * 39187.4517;
  return s - Math.floor(s);
}

/**
 * Islands sit on two rings so there is always somewhere to run to, and never so
 * close to spawn that a new ship is boxed in.
 */
function buildIslands() {
  const out = [];
  const rings = [
    // Big trading ports on the inner ring, home bases further out, and a
    // scatter of small rocks in between so the sea is not empty water.
    { count: 5,  radius: WORLD.radius * 0.44, haven: true,  min: 175, span: 90,  hi: 60, kind: 'haven' },
    { count: 7,  radius: WORLD.radius * 0.78, haven: false, min: 110, span: 70,  hi: 44, kind: 'base' },
    { count: 14, radius: WORLD.radius * 0.62, haven: false, min: 26,  span: 46,  hi: 22, kind: 'islet' },
    { count: 10, radius: WORLD.radius * 0.94, haven: false, min: 20,  span: 34,  hi: 16, kind: 'islet' },
  ];

  let i = 0;
  for (const ring of rings) {
    for (let k = 0; k < ring.count; k++) {
      const jitter = (rnd(i * 3.1) - 0.5) * (ring.kind === 'islet' ? 0.5 : 0.26);
      const a = (k / ring.count) * Math.PI * 2 + jitter;
      const r = ring.radius * (0.86 + rnd(i * 7.7) * 0.28);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const radius = ring.min + rnd(i * 5.3) * ring.span;
      // Islands that overlap look wrong and confuse which port you are at, so
      // drop any that crowds one already placed.
      const clash = out.some(
        (o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius + 260
      );
      if (clash) { i++; continue; }
      out.push({
        id: i,
        name: ring.kind === 'islet' ? ISLET_NAMES[i % ISLET_NAMES.length]
                                    : ISLAND_NAMES[i % ISLAND_NAMES.length],
        x,
        z,
        radius,
        height: ring.hi * (0.7 + rnd(i * 11.9) * 0.6),
        seed: i,
        haven: ring.haven,
        kind: ring.kind,
      });
      i++;
    }
  }
  return out;
}

const ISLAND_NAMES = [
  'Port Royal', 'Tortuga', 'Nassau', 'Isla Mona', 'Saint Kitts', 'Barbuda',
  'Gallows Point', 'Cutlass Cay', 'Providence', 'Anegada', 'Petit Cul',
  'Salt Tortuga',
];
const ISLET_NAMES = [
  'Dead Man Rock', 'Skull Reef', 'The Needles', 'Gull Rock', 'Bone Cay',
  'Black Shoal', 'Widow Rock', 'The Teeth', 'Wreckers Cay', 'Low Cay',
  'Hangman Rock', 'Split Rock', 'Cinder Cay', 'The Anvil',
];

export const ISLANDS = buildIslands();
export const HAVENS = ISLANDS.filter((i) => i.haven);
export const BASES = ISLANDS.filter((i) => i.kind === 'base');
export const ISLETS = ISLANDS.filter((i) => i.kind === 'islet');

/** Radius of the no-guns water around a Safe Haven. */
export const safeRadius = (isle) => isle.radius + SAFE_MARGIN;

/** Inside any Safe Haven's white ring, nothing can shoot and nothing can be hit. */
export function inSafeWater(x, z) {
  for (const isle of HAVENS) {
    if (Math.hypot(x - isle.x, z - isle.z) < safeRadius(isle)) return isle;
  }
  return null;
}

/** Which island a ship is alongside, if any. Nothing counts at speed. */
export function dockedAt(ship) {
  if (ship.sunk || ship.speed > DOCK_SPEED) return null;
  // Nearest, not merely the first in the list — islands can be close enough
  // that first-match names the wrong port.
  let best = null;
  let bestD = Infinity;
  for (const isle of ISLANDS) {
    const d = Math.hypot(ship.x - isle.x, ship.z - isle.z) - isle.radius;
    if (d < DOCK_RANGE && d < bestD) { best = isle; bestD = d; }
  }
  return best;
}

/** Distance from a point to the nearest bit of land, negative when aground. */
export function landClearance(x, z) {
  let best = Infinity;
  for (const isle of ISLANDS) {
    const d = Math.hypot(x - isle.x, z - isle.z) - isle.radius;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Height of the island surface at a world point, 0 at sea level. A smooth dome
 * with a couple of deterministic lumps so the islands are not plain cones.
 */
export function landHeight(x, z) {
  let h = 0;
  for (const isle of ISLANDS) {
    const d = Math.hypot(x - isle.x, z - isle.z);
    if (d > isle.radius) continue;
    const t = 1 - d / isle.radius;
    const lumps =
      0.82 +
      0.18 * Math.sin(x * 0.035 + isle.seed) * Math.cos(z * 0.031 - isle.seed * 1.7);
    h = Math.max(h, isle.height * Math.pow(t, 1.6) * lumps);
  }
  return h;
}

/** Prices for what a Safe Haven will pay and what a base will sell you. */
export const TRADE = {
  coinsPerCargo: 34,        // paid at a Safe Haven for each unit of loot
  cargoPerSink: 6,          // loot that spills out of a hull you sink
};
