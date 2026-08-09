// AI captains.
//
// These sail the same hulls, under the same physics, with the same guns as a
// player — there is no cheating layer. What makes them dangerous is that they
// fight the way a real captain does: they work for the broadside, hold a firing
// range instead of ramming, shoot where you are going rather than where you
// are, and run for it when their hull is gone.

import { normalizeAngle, classOf } from './physics.js';
import { MAX_RANGE, MIN_RANGE, SHOT, BATTERIES, gunsFor, CLASS_STATS } from './combat.js';
import { inSafeWater, safeRadius } from './world.js';

export const FACTIONS = {
  // `weight` biases which end of the level band a faction takes: the Armada
  // sails the heaviest hull the band allows, freebooters the lightest.
  armada:   { name: 'Spanish Armada', accent: 0xb8322c, skill: 0.85, weight: 1.0, escort: 1 },
  dutch:    { name: 'Dutch Navy',     accent: 0xd97a1f, skill: 0.95, weight: 0.7, escort: 0 },
  treasure: { name: 'Treasure Fleet', accent: 0xd8b23c, skill: 0.45, weight: 0.85, escort: -1 },
  pirate:   { name: 'Freebooters',    accent: 0x3c3a38, skill: 0.70, weight: 0.15, escort: 1 },
  // Not a faction that spawns — the flag your own consorts sail under.
  consort:  { name: 'Consort',        accent: 0x6f8fa8, skill: 0.75, weight: 0.5, escort: 0 },
};

/**
 * What is afloat at a given player level. A new captain in a sailboat should be
 * meeting cutters and brigantines, not a three-decker — the ladder only means
 * anything if the opposition climbs it with you.
 */
export const LEVEL_BANDS = [
  { upTo: 4,  hulls: ['sailboat', 'cutter'],                    size: [1, 2] },
  { upTo: 9,  hulls: ['cutter', 'brigantine'],                  size: [1, 3] },
  { upTo: 16, hulls: ['brigantine', 'corvette'],                size: [2, 3] },
  { upTo: 24, hulls: ['corvette', 'frigate'],                   size: [2, 4] },
  { upTo: 34, hulls: ['frigate', 'galleon'],                    size: [2, 4] },
  { upTo: 45, hulls: ['galleon', 'manofwar'],                   size: [3, 4] },
  { upTo: 999, hulls: ['manofwar', 'flagship', 'leviathan'],    size: [3, 5] },
];

export const bandFor = (level) =>
  LEVEL_BANDS.find((b) => level <= b.upTo) || LEVEL_BANDS[LEVEL_BANDS.length - 1];

/**
 * Build a squadron matched to `level`: which hulls, how many, and how well
 * worked up their crews are.
 */
export function fleetFor(level, factionKey) {
  const f = FACTIONS[factionKey];
  const band = bandFor(level);
  const [lo, hi] = band.size;
  const size = Math.max(1, Math.round(lo + (hi - lo) * Math.random()) + (f.escort || 0));

  // A treasure fleet is not a squadron of warships — it is the fattest hold in
  // the band with a lighter escort, which is exactly why it is worth taking.
  const order = factionKey === 'treasure'
    ? [...band.hulls].sort((a, b) =>
        (CLASS_STATS[a]?.cargo || 0) - (CLASS_STATS[b]?.cargo || 0))
    : band.hulls;

  // Pick along the band by faction weight. Each ship after the flag leans a
  // step lighter, so a squadron is a mix rather than four of the same hull.
  const hulls = [];
  for (let i = 0; i < size; i++) {
    const bias = f.weight + (Math.random() - 0.5) * 0.5 - i * 0.28;
    const idx = Math.round(Math.min(1, Math.max(0, bias)) * (order.length - 1));
    hulls.push(order[idx]);
  }
  // The flag leads.
  hulls.sort((a, b) => order.indexOf(b) - order.indexOf(a));

  // Crews work up with the opposition, capped so they never out-talent a player.
  const ranks = Math.max(0, Math.floor(level / 5));
  const picks = {
    broadside: 40,
    gunnery: Math.min(ranks, 8),
    reload: Math.min(Math.floor(level / 6), 8),
    hull: Math.min(ranks, 8),
    handling: Math.min(Math.floor(level / 7), 8),
  };
  return { hulls, picks, size: hulls.length };
}

const IDEAL_RANGE = MAX_RANGE * 0.52;    // where a broadside actually tells
const BREAK_OFF = 0.28;                  // hull fraction at which she runs

/**
 * One AI captain. `think` returns the helm and throttle orders for this tick
 * and, when the guns bear, the aim to fire with.
 */
export class Captain {
  constructor(ship, faction, opts = {}) {
    this.ship = ship;
    this.faction = faction;
    this.skill = FACTIONS[faction]?.skill ?? 0.7;
    this.state = 'patrol';
    this.station = opts.station ?? null;   // offset from the flag, in hull lengths
    this.leader = opts.leader ?? null;
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.patrolR = opts.patrolR ?? 900;
    this.fireCooldown = 0;
    this.target = null;
  }

  /**
   * @param ships  every hull afloat: { ship, hostile }
   * @returns { input, fire } — fire is {b, r} or null
   */
  think(ships, dt, t) {
    const me = this.ship;
    const input = { rudder: 0, throttle: 0 };
    if (me.sunk) return { input, fire: null };

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    // --- pick a target: the nearest hostile she can actually reach ---------
    let best = null;
    let bestD = Infinity;
    for (const other of ships) {
      if (other === me || other.sunk) continue;
      const d = Math.hypot(other.x - me.x, other.z - me.z);
      // No sense chasing something into water where guns do not work.
      if (inSafeWater(other.x, other.z)) continue;
      if (d < bestD && d < 850) { best = other; bestD = d; }
    }
    this.target = best;

    // Nobody's guns work inside a Safe Haven's ring, so a captain who finds
    // herself in one gets out of it before she does anything else.
    const ring = inSafeWater(me.x, me.z);
    if (ring) {
      const away = Math.atan2(me.x - ring.x, me.z - ring.z);
      const err0 = normalizeAngle(away - me.heading);
      input.rudder = Math.abs(err0) < 0.05 ? 0 : -Math.sign(err0);
      input.throttle = 1;
      this.state = 'clearing';
      return { input, fire: null };
    }

    const hurt = me.hp / me.maxHp;
    if (hurt < BREAK_OFF && best) this.state = 'flee';
    else if (best && bestD < 700) this.state = 'engage';
    else this.state = this.leader ? 'station' : 'patrol';

    let desired = me.heading;
    let throttle = 1;

    if (this.state === 'flee') {
      // Straight downrange of the enemy, everything set.
      desired = Math.atan2(me.x - best.x, me.z - best.z);
    } else if (this.state === 'engage') {
      desired = this.#fightingCourse(best, bestD);
      // Ease off when closing so she settles onto the range rather than ramming.
      throttle = bestD < IDEAL_RANGE * 0.7 ? 0.45 : 1;
    } else if (this.state === 'station' && this.leader && !this.leader.sunk) {
      const L = classOf(this.leader.cls).length;
      const sx = Math.sin(this.leader.heading);
      const sz = Math.cos(this.leader.heading);
      // Line ahead: astern of the flag and offset onto her quarter.
      const px = this.leader.x - sx * L * this.station.along + sz * L * this.station.across;
      const pz = this.leader.z - sz * L * this.station.along - sx * L * this.station.across;
      const d = Math.hypot(px - me.x, pz - me.z);
      desired = Math.atan2(px - me.x, pz - me.z);
      throttle = d > L * 1.5 ? 1 : d > L * 0.6 ? 0.7 : 0.35;
    } else {
      this.patrolAngle += dt * 0.06;
      const px = Math.sin(this.patrolAngle) * this.patrolR;
      const pz = Math.cos(this.patrolAngle) * this.patrolR;
      desired = Math.atan2(px - me.x, pz - me.z);
      throttle = 0.7;
    }

    // --- helm: heading is a maths angle, so a starboard turn LOWERS it -----
    const err = normalizeAngle(desired - me.heading);
    input.rudder = Math.abs(err) < 0.04 ? 0 : -Math.sign(err);
    input.throttle = throttle > me.throttle + 0.02 ? 1 : throttle < me.throttle - 0.02 ? -1 : 0;

    return { input, fire: this.state === 'engage' ? this.#gunnery(best, bestD, t) : null };
  }

  /**
   * Where to steer to fight. Not "at the enemy" — a captain works to bring his
   * broadside to bear at a range his guns can hold, which means steering to put
   * the enemy abeam and then holding that.
   */
  #fightingCourse(target, dist) {
    const me = this.ship;
    const toTarget = Math.atan2(target.x - me.x, target.z - me.z);

    if (dist > IDEAL_RANGE * 1.35) return toTarget;              // close the range
    if (dist < IDEAL_RANGE * 0.55) {                             // too close, open out
      return normalizeAngle(toTarget + Math.PI * 0.55);
    }

    // On station: turn until the enemy is on the beam of a battery that is
    // loaded, preferring whichever side is ready.
    const guns = gunsFor(me.picks, me.cls);
    const portReady = guns.port > 0 && me.reload.port <= 0.6;
    const stbdReady = guns.starboard > 0 && me.reload.starboard <= 0.6;
    let side;
    if (portReady && !stbdReady) side = 1;
    else if (stbdReady && !portReady) side = -1;
    else {
      // Both or neither: keep the turn short.
      const rel = normalizeAngle(toTarget - me.heading);
      side = rel > 0 ? 1 : -1;
    }
    // Beam-on means the target sits 90 degrees off the bow.
    return normalizeAngle(toTarget - side * Math.PI * 0.5);
  }

  /**
   * Deflection shooting: aim where the target will be when the ball arrives,
   * not where it is now. Poorer crews lead worse and scatter more.
   */
  #gunnery(target, dist, t) {
    const me = this.ship;
    if (this.fireCooldown > 0) return null;
    if (dist > MAX_RANGE * 0.95 || dist < MIN_RANGE) return null;

    const flight = dist / SHOT.speed;
    const lead = 0.55 + this.skill * 0.6;          // a good crew leads properly
    const px = target.x + target.vx * flight * lead - me.vx * flight * 0.25;
    const pz = target.z + target.vz * flight * lead - me.vz * flight * 0.25;

    const aimRange = Math.hypot(px - me.x, pz - me.z);
    let rel = normalizeAngle(Math.atan2(px - me.x, pz - me.z) - me.heading);

    // Which battery covers that bearing, and is it loaded?
    let key = null;
    for (const [k, b] of Object.entries(BATTERIES)) {
      if (Math.abs(normalizeAngle(rel - b.bearing)) <= b.arc) {
        if ((gunsFor(me.picks, me.cls)[k] || 0) > 0 && me.reload[k] <= 0) { key = k; break; }
      }
    }
    if (!key) return null;

    // Human-scale error: worse crews miss by more.
    const slop = (1 - this.skill) * 0.09;
    rel += (Math.random() - 0.5) * slop;
    this.fireCooldown = 0.35 + (1 - this.skill) * 0.8;
    return { b: rel, r: aimRange * (0.94 + Math.random() * 0.12) };
  }
}
