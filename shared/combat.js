// Gunnery, ballistics and damage. Shared so the server can be the judge of
// every hit while clients draw the same shot arriving at the same place.

import { rigOf, gunPlacements, chaserPlacement } from './rig.js';

export const GRAVITY = 9.81;

/**
 * Where a battery sits and where it points, relative to the bow.
 *
 * Elevation is deliberately tiny. Guns lobbed at a realistic 10-12 degrees put
 * the ball six metres in the air at close range and sail it clean over anything
 * you are actually fighting — flat trajectories are what make a broadside feel
 * like a broadside. The cost is range, which is the right trade.
 */
// Bearings are relative to the bow in the same convention the rest of the
// physics uses: a vector at relative angle t is (sin(h+t), cos(h+t)), so +PI/2
// is +X, which is the PORT side. Getting these backwards makes each broadside
// fire out of the opposite rail, which is invisible until you shoot at someone.
export const BATTERIES = {
  port:      { label: 'Port battery', bearing: Math.PI / 2,  arc: 1.05, spread: 0.028 },
  starboard: { label: 'Stbd battery', bearing: -Math.PI / 2, arc: 1.05, spread: 0.028 },
  bow:       { label: 'Bow chaser',   bearing: 0,            arc: 0.52, spread: 0.016 },
  stern:     { label: 'Stern chaser', bearing: Math.PI,      arc: 0.52, spread: 0.016 },
};

// Guns train within their arc, so aim is a bearing rather than a fixed beam
// shot. Range is set by elevation, which is solved for where you clicked.
export const MIN_RANGE = 18;
export const MAX_RANGE = 180;

export const SHOT = {
  speed: 110,       // muzzle velocity, m/s — fast and flat, ~130 m of reach
  radius: 0.36,
  drag: 0.0016,     // gentle, just enough to shorten the very long shots
  life: 9,          // seconds before it is gone
};

/**
 * Ammunition. Round shot is free and infinite; everything else is crafted from
 * salvage and spent a broadside at a time.
 *
 *   dmg     damage multiplier
 *   slow    fraction knocked off the target's throttle (chainshot cuts rigging)
 *   blast   splash radius in metres (explosive)
 *   burn    damage per second left behind (heated shot)
 */
export const AMMO = {
  round:     { name: 'Round shot',     short: 'ROUND', dmg: 1.00, cost: null },
  chain:     { name: 'Chainshot',      short: 'CHAIN', dmg: 0.45, slow: 0.5,
               cost: { iron: 2 }, blurb: 'Cuts rigging — halves their speed' },
  grape:     { name: 'Grapeshot',      short: 'GRAPE', dmg: 0.75, pellets: 4,
               cost: { iron: 1, powder: 1 }, blurb: 'Four balls a gun, murderous up close' },
  heated:    { name: 'Heated shot',    short: 'HEAT',  dmg: 1.30, burn: 7,
               cost: { powder: 2, sulphur: 1 }, blurb: 'Sets fires that keep burning' },
  explosive: { name: 'Explosive shot', short: 'EXPL',  dmg: 1.55, blast: 14,
               cost: { powder: 2, sulphur: 2, iron: 1 }, blurb: 'Bursts on impact' },
};

/** What floats free after a fight, and what it is good for. */
export const RESOURCES = {
  timber:  { name: 'Timber',  colour: 0x7a5a34 },
  iron:    { name: 'Iron',    colour: 0x5d6068 },
  powder:  { name: 'Powder',  colour: 0x2f2b28 },
  sulphur: { name: 'Sulphur', colour: 0xc9b13c },
};

/** Armour sets, dropped by the things worth killing. */
export const ARMOUR_SETS = {
  iron:     { name: 'Iron Plate',     reduce: 0.10, hp: 40,  rank: 1 },
  bronze:   { name: 'Bronze Plate',   reduce: 0.18, hp: 90,  rank: 2 },
  platinum: { name: 'Platinum Plate', reduce: 0.28, hp: 180, rank: 3 },
};

/** Rounds you get per craft, and what it costs. */
export const CRAFT_BATCH = 12;

export const TNT = {
  fuse: 4.2,        // seconds from splash to bang
  radius: 24,
  damage: 85,
  armTime: 0.8,     // cannot hurt the ship that dropped it for this long
};

/** XP needed to reach the given level. Level 1 is the start. */
/**
 * Total XP to reach a level.
 *
 * The exponent is the whole curve: at 1.42 the last levels cost far more than
 * the first, so by 60 a level was several thousand XP and the ladder stopped
 * moving. At 1.26 the climb is much flatter — level 60 costs about a third of
 * what it used to, and the per-level step stays in the range a few good fights
 * can cover instead of drifting out of reach.
 *
 *            old       new
 *   lvl 10   1,757     1,120
 *   lvl 30  10,000     4,600
 *   lvl 60  23,594     8,880
 */
export function xpForLevel(level) {
  return Math.round(70 * Math.pow(level - 1, 1.26));
}

/**
 * There is no level cap.
 *
 * This used to stop dead at 60 — `while (lvl < 60 && ...)` — so past that you
 * kept earning XP and never got another talent point, with nothing on screen to
 * say why. Since the curve is a plain power law it inverts exactly, which also
 * means no loop to bound: level 400 costs one multiply, same as level 4.
 */
export function levelFromXp(xp) {
  if (!(xp > 0)) return 1;
  let lvl = Math.max(1, Math.floor(1 + Math.pow(xp / 70, 1 / 1.26)));
  // xpForLevel ROUNDS, so a threshold can sit a fraction below where the
  // analytic inverse puts it and land you one level short of your own
  // level-up. Step onto the right side of it — one or two iterations, never
  // a scan from level 1.
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  while (lvl > 1 && xp < xpForLevel(lvl)) lvl--;
  return lvl;
}

/** Fleet command opens here, and never grows past fifteen sail or a Galleon. */
export const FLEET_LEVEL = 40;
export const FLEET_MAX = 15;
export const FLEET_HULLS =
  ['sailboat', 'cutter', 'brigantine', 'corvette', 'frigate', 'galleon'];

/**
 * The talent tree. You start with one gun a side and nothing else — every
 * other barrel on the ship is bought with a talent point, one per level.
 */
export const TALENTS = {
  broadside:   { name: 'Run Out the Guns', blurb: '+1 gun each side (up to the hull\'s limit)', max: 27, group: 'guns' },
  bowchaser:   { name: 'Bow Chaser',       blurb: 'A gun that fires ahead',   max: 1, group: 'guns' },
  sternchaser: { name: 'Stern Chaser',     blurb: 'A gun to cover your wake', max: 1, group: 'guns' },
  gunnery:     { name: 'Gunnery',          blurb: '+9% cannon damage',        max: 8, group: 'crew' },
  reload:      { name: 'Powder Monkeys',   blurb: '−8% reload time',          max: 8, group: 'crew' },
  handling:    { name: 'Seamanship',       blurb: '+7% helm, +3% speed',      max: 8, group: 'crew' },
  hull:        { name: 'Oak & Tar',        blurb: '+18 hull',                 max: 8, group: 'ship' },
  powder:      { name: 'Powder Store',     blurb: '+1 TNT barrel',            max: 4, group: 'ship' },

  // --- fleet command, unlocked at level 40 -------------------------------
  // These have no ceiling worth reaching: a fleet is capped by hull class and
  // by how many consorts you can raise, not by how far you can work them up.
  fleetsize:    { name: 'Consorts',      blurb: '+1 ship under your command',
                  max: FLEET_MAX, group: 'fleet', from: FLEET_LEVEL },
  fleetyard:    { name: 'Fleet Yard',    blurb: 'Bigger consort hulls, up to a Galleon',
                  max: 5, group: 'fleet', from: FLEET_LEVEL },
  fleetguns:    { name: 'Consort Guns',  blurb: '+1 gun a side on every consort',
                  max: 99, group: 'fleet', from: FLEET_LEVEL },
  fleethull:    { name: 'Consort Oak',   blurb: '+30 hull on every consort',
                  max: 99, group: 'fleet', from: FLEET_LEVEL },
  fleetgunnery: { name: 'Fleet Gunnery', blurb: '+8% consort damage',
                  max: 99, group: 'fleet', from: FLEET_LEVEL },
};

/** What a consort is, given the ranks her admiral has taken. */
export function consortSpec(picks = {}) {
  const yard = Math.min(picks.fleetyard || 0, FLEET_HULLS.length - 1);
  const cls = FLEET_HULLS[yard];
  return {
    cls,
    count: Math.min(picks.fleetsize || 0, FLEET_MAX),
    picks: {
      // Consorts run out every gun their hull can carry, plus the extra ranks.
      broadside: 40,
      gunnery: picks.fleetgunnery || 0,
      hull: 0,
      reload: Math.floor((picks.fleetgunnery || 0) / 2),
    },
    extraGuns: picks.fleetguns || 0,
    extraHull: 30 * (picks.fleethull || 0),
  };
}

export const STARTING_GUNS = { port: 1, starboard: 1, bow: 0, stern: 0 };

export const TALENT_GROUPS = ['guns', 'crew', 'ship', 'fleet'];

/** Which sections are open to a captain of this level. */
export function groupsFor(level) {
  return TALENT_GROUPS.filter((g) => {
    const first = Object.values(TALENTS).find((t) => t.group === g);
    return !first?.from || level >= first.from;
  });
}

/**
 * Roll the offer for one talent point: exactly one candidate per section, drawn
 * at random from whatever is not already maxed out. You choose between three
 * cards rather than shopping the whole tree, so a build is something you are
 * dealt as much as something you plan.
 */
export function rollOffer(picks = {}, clsKey, rand = Math.random, level = 1) {
  const offer = {};
  for (const group of groupsFor(level)) {
    const pool = Object.entries(TALENTS).filter(([id, t]) => {
      if (t.group !== group) return false;
      if (t.from && level < t.from) return false;
      if (id === 'broadside') {
        // Capped by the hull you are in, not just by the talent's own maximum.
        const cap = (CLASS_STATS[clsKey] || CLASS_STATS.sailboat).maxBroadside;
        return (picks[id] || 0) < Math.min(t.max, cap - STARTING_GUNS.port);
      }
      return (picks[id] || 0) < t.max;
    });
    offer[group] = pool.length ? pool[Math.floor(rand() * pool.length)][0] : null;
  }
  return offer;
}

/** How many barrels each battery actually has, given the talents taken. */
export function gunsFor(picks = {}, clsKey) {
  const cap = (CLASS_STATS[clsKey] || CLASS_STATS.sailboat).maxBroadside;
  const b = Math.min(picks.broadside || 0, cap - STARTING_GUNS.port);
  return {
    port: STARTING_GUNS.port + b,
    starboard: STARTING_GUNS.starboard + b,
    bow: picks.bowchaser ? 1 : 0,
    stern: picks.sternchaser ? 1 : 0,
  };
}

/**
 * Talents fold into whatever class you are sailing, so a Frigate keeps its
 * bigger hull and its own gun limit while still feeling the ranks you bought.
 */
export function statsFor(picks = {}, clsKey) {
  const base = CLASS_STATS[clsKey] || CLASS_STATS.sailboat;
  return {
    damage: 1 + 0.09 * (picks.gunnery || 0),
    rudder: 1 + 0.07 * (picks.handling || 0),
    speed: 1 + 0.03 * (picks.handling || 0),
    reload: 1 / (1 + 0.08 * (picks.reload || 0)),
    barrels: 1 + (picks.powder || 0),
    maxHp: base.hp + 18 * (picks.hull || 0),
    maxBroadside: base.maxBroadside,
    cargoCap: base.cargo,
  };
}

// Mirrored from SHIP_CLASSES. Kept here rather than imported so combat.js has
// no dependency on physics.js — physics.js already imports this one.
export const CLASS_STATS = {
  sailboat:   { hp: 100,  maxBroadside: 3,  cargo: 8 },
  cutter:     { hp: 140,  maxBroadside: 4,  cargo: 12 },
  brigantine: { hp: 200,  maxBroadside: 6,  cargo: 18 },
  corvette:   { hp: 280,  maxBroadside: 8,  cargo: 24 },
  frigate:    { hp: 350,  maxBroadside: 10, cargo: 32 },
  galleon:    { hp: 460,  maxBroadside: 12, cargo: 64 },
  manofwar:   { hp: 560,  maxBroadside: 15, cargo: 50 },
  flagship:   { hp: 850,  maxBroadside: 20, cargo: 72 },
  leviathan:  { hp: 1250, maxBroadside: 28, cargo: 104 },
};

/** One point a level; level 1 starts you with none. */
export const pointsAtLevel = (level) => level - 1;
export const pointsSpent = (picks = {}) =>
  Object.keys(TALENTS).reduce((n, k) => n + (picks[k] || 0), 0);
export const pointsFree = (level, picks) => pointsAtLevel(level) - pointsSpent(picks);

/**
 * Which battery can bear on this bearing, given as an angle relative to the
 * bow. Returns null if nothing covers it. Ties go to the closer arc centre.
 */
export function batteryForBearing(relBearing) {
  let best = null;
  let bestOff = Infinity;
  for (const [key, b] of Object.entries(BATTERIES)) {
    const off = Math.abs(normalizeAngle(relBearing - b.bearing));
    if (off <= b.arc && off < bestOff) {
      best = key;
      bestOff = off;
    }
  }
  return best;
}

export const MUZZLE_HEIGHT = 2.4;

/**
 * Barrel elevation that drops a ball at `range` metres, fired from the gun deck
 * rather than from the waterline.
 *
 * The textbook v² sin(2θ)/g assumes you launch and land at the same height. Two
 * and a half metres of freeboard makes that badly wrong up close — solving for
 * 40 m with it actually threw the ball 97 m. So solve the real quadratic:
 *   0 = h + R·tanθ − gR²(1 + tan²θ) / 2v²
 * and take the low root, which at short range is a slight *depression*.
 */
export function solveElevation(range, h = MUZZLE_HEIGHT) {
  const clamped = Math.min(Math.max(range, MIN_RANGE), MAX_RANGE);
  // The solution below is drag-free, and SHOT.drag steals a little more the
  // further the ball flies. Aim slightly long to cover it; measured against
  // tools/host-test.js this lands within a few metres across the whole range,
  // which is well inside the natural spread anyway.
  const R = clamped * (1 + 0.00085 * clamped);
  const v2 = SHOT.speed * SHOT.speed;
  const A = (GRAVITY * R * R) / (2 * v2);
  const disc = R * R - 4 * A * (A - h);
  if (disc <= 0) return 0.25;              // beyond reach: throw it as far as it goes
  const u = (R - Math.sqrt(disc)) / (2 * A);
  return Math.atan(u);
}

/** Clamp a desired bearing into what the battery can actually train through. */
export function clampToArc(batteryKey, relBearing) {
  const b = BATTERIES[batteryKey];
  const off = normalizeAngle(relBearing - b.bearing);
  return b.bearing + Math.max(-b.arc, Math.min(b.arc, off));
}

function normalizeAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * Launch data for one gun. `seed` keeps host and client agreeing on where a
 * shot went without sending a vector per ball. `relBearing` and `elevation`
 * come from the aim the host resolved.
 */
export function muzzle(ship, batteryKey, index, count, seed, relBearing, elevation) {
  const b = BATTERIES[batteryKey];
  const rig = rigOf(ship.cls);
  const heading = ship.heading;
  const bearing = heading + (relBearing ?? b.bearing);

  // The exact barrel this shot leaves, from the same table the model is built
  // from — so the smoke and the ball come out of the gun you can see.
  const side = batteryKey === 'port' || batteryKey === 'starboard';
  const g = side
    ? (gunPlacements(rig, count)[index] || gunPlacements(rig, 1)[0])
    : chaserPlacement(rig, batteryKey);

  const jitter = (hash01(seed + index * 7.13) - 0.5) * 2 * b.spread;
  const dirX = Math.sin(bearing + jitter);
  const dirZ = Math.cos(bearing + jitter);
  const el = (elevation ?? 0.055) + (hash01(seed + index * 3.7) - 0.5) * 0.006;

  // Hull space -> world: `along` runs down the keel, `out` along the gun's line.
  const px = ship.x + Math.sin(heading) * g.along + dirX * g.out;
  const pz = ship.z + Math.cos(heading) * g.along + dirZ * g.out;

  const horiz = Math.cos(el) * SHOT.speed;
  return {
    x: px,
    y: g.height,
    z: pz,
    vx: dirX * horiz + ship.vx,
    vy: Math.sin(el) * SHOT.speed,
    vz: dirZ * horiz + ship.vz,
  };
}

/** Deterministic 0..1 from a number — same on both sides of the wire. */
export function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Advance a cannonball. Returns false once it is spent. */
export function stepShot(s, dt) {
  const v = Math.hypot(s.vx, s.vy, s.vz);
  const k = SHOT.drag * v;
  s.vx -= s.vx * k * dt;
  s.vy -= (s.vy * k + GRAVITY) * dt;
  s.vz -= s.vz * k * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;
  s.age += dt;
  return s.age < SHOT.life;
}

/**
 * Does this point sit inside a hull? Ships are treated as a box around the
 * centreline — close enough at cannonball scale and cheap enough to run for
 * every ball against every ship, every tick.
 */
export function hitsHull(px, py, pz, ship, dims, pad = 0) {
  // Deck, bulwarks and a little rigging. Taking the whole mast height would
  // count every ball that merely passed overhead as a hit.
  if (py < -1.5 || py > dims.height) return false;
  const dx = px - ship.x;
  const dz = pz - ship.z;
  const c = Math.cos(-ship.heading);
  const sn = Math.sin(-ship.heading);
  // Rotate into hull space: +z forward, +x across.
  const along = dx * sn + dz * c;
  const across = dx * c - dz * sn;
  return (
    Math.abs(along) < dims.length / 2 + pad &&
    Math.abs(across) < dims.beam / 2 + pad
  );
}

export const HULL_DIMS = { length: 14, beam: 4.6, height: 5.5 };
