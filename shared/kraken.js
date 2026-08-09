// The Kraken.
//
// Not a ship — a thing that comes up under you. It surfaces near whoever is
// making the most noise, sweeps with its arms, and drags itself back down when
// beaten. Tentacles are the hitbox and the weapon both: they telegraph, then
// they slam.

export const KRAKEN = {
  hp: 2600,
  reach: 78,            // how far the arms sweep
  arms: 8,
  windUp: 1.6,          // seconds an arm is raised before it comes down
  slamDamage: 95,
  slamRadius: 22,
  armCooldown: 3.4,
  submergeAt: 0.0,
  lifetime: 240,        // gives up and sinks after this long
  bounty: { xp: 900, crowns: 260, cargo: 26 },
};

/**
 * One arm. `phase` runs 0..1 through rise -> hold -> slam -> recover, so the
 * client can draw exactly the swing the host is scoring.
 */
function makeArm(i, n) {
  return {
    i,
    angle: (i / n) * Math.PI * 2,
    state: 'idle',
    t: 0,
    targetX: 0,
    targetZ: 0,
    cool: Math.random() * KRAKEN.armCooldown,
  };
}

export class Kraken {
  constructor(x, z, now) {
    this.x = x;
    this.z = z;
    this.hp = KRAKEN.hp;
    this.maxHp = KRAKEN.hp;
    this.born = now;
    this.dead = false;
    this.rise = 0;                 // 0 submerged, 1 fully up
    this.arms = Array.from({ length: KRAKEN.arms }, (_, i) => makeArm(i, KRAKEN.arms));
  }

  /** Serialised for the wire — small enough to send every snapshot. */
  wire() {
    return {
      x: +this.x.toFixed(1), z: +this.z.toFixed(1),
      hp: Math.round(this.hp), maxHp: this.maxHp, rise: +this.rise.toFixed(3),
      arms: this.arms.map((a) => ({
        a: +a.angle.toFixed(3), s: a.state, t: +a.t.toFixed(2),
        x: +a.targetX.toFixed(1), z: +a.targetZ.toFixed(1),
      })),
    };
  }

  /**
   * @param ships every hull afloat
   * @param hit   (ship, damage, at) called when an arm lands
   */
  step(dt, now, ships, hit) {
    if (this.dead) return;
    this.rise = Math.min(1, this.rise + dt * 0.35);

    // She drifts slowly toward whatever is nearest.
    let near = null;
    let nearD = Infinity;
    for (const s of ships) {
      if (s.sunk) continue;
      const d = Math.hypot(s.x - this.x, s.z - this.z);
      if (d < nearD) { near = s; nearD = d; }
    }
    if (near && nearD > 30) {
      const k = dt * 1.6;
      this.x += ((near.x - this.x) / nearD) * k * 4;
      this.z += ((near.z - this.z) / nearD) * k * 4;
    }

    for (const arm of this.arms) {
      arm.cool -= dt;
      if (arm.state === 'idle') {
        if (arm.cool > 0 || !near || nearD > KRAKEN.reach) continue;
        // Pick a hull inside reach and wind up on it.
        const picks = ships.filter(
          (s) => !s.sunk && Math.hypot(s.x - this.x, s.z - this.z) < KRAKEN.reach
        );
        if (!picks.length) continue;
        const mark = picks[Math.floor(Math.random() * picks.length)];
        arm.targetX = mark.x + mark.vx * KRAKEN.windUp * 0.8;
        arm.targetZ = mark.z + mark.vz * KRAKEN.windUp * 0.8;
        arm.state = 'rising';
        arm.t = 0;
      } else if (arm.state === 'rising') {
        arm.t += dt / KRAKEN.windUp;
        if (arm.t >= 1) { arm.state = 'slam'; arm.t = 0; }
      } else if (arm.state === 'slam') {
        arm.t += dt / 0.28;
        if (arm.t >= 1) {
          // It lands. Anything close enough takes it.
          for (const s of ships) {
            if (s.sunk) continue;
            const d = Math.hypot(s.x - arm.targetX, s.z - arm.targetZ);
            if (d > KRAKEN.slamRadius) continue;
            const falloff = 1 - d / KRAKEN.slamRadius;
            hit(s, KRAKEN.slamDamage * falloff, { x: arm.targetX, y: 2, z: arm.targetZ });
          }
          arm.state = 'recover';
          arm.t = 0;
        }
      } else if (arm.state === 'recover') {
        arm.t += dt / 0.9;
        if (arm.t >= 1) {
          arm.state = 'idle';
          arm.cool = KRAKEN.armCooldown * (0.7 + Math.random() * 0.6);
        }
      }
    }

    if (now - this.born > KRAKEN.lifetime) this.dead = true;
  }

  damage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; return true; }
    return false;
  }
}
