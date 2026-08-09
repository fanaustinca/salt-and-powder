// Server-side gunnery. The server owns every shot and every hit; clients only
// replay the ballistics they are told about, so nobody can invent a kill.
import {
  BATTERIES, SHOT, AMMO, TNT, HULL_DIMS, MAX_RANGE,
  muzzle, stepShot, hitsHull, statsFor, gunsFor, levelFromXp,
  batteryForBearing, clampToArc, solveElevation,
} from './combat.js';
import { waterHeight } from './waves.js';
import { WORLD, createShip, classOf } from './physics.js';
import { TRADE, inSafeWater } from './world.js';

const RELOAD_BASE = { port: 4.2, starboard: 4.2, bow: 3.0, stern: 3.0 };
const RESPAWN_DELAY = 7;

export class Combat {
  constructor(tx, players, now) {
    this.tx = tx;
    this.players = players;
    this.now = now;
    this.shots = [];
    this.barrels = [];
    this.nextId = 1;
    // Overridden by the host so shots can hit AI hulls as well as players.
    this.targets = () => [...players.values()].map((p) => p.ship);
    this.onKill = null;
    this.krakenHit = null;
  }

  /**
   * A player pulls the lanyard. `aim` is where they clicked: a bearing relative
   * to the bow, plus a range. The HOST decides which battery can bear — the
   * client never gets to say which gun fired or how far it reached.
   */
  fire(p, aim) {
    const ship = p.ship;
    if (ship.sunk) return;
    // Guns are housed inside the white ring. Nobody fights in a Safe Haven.
    if (inSafeWater(ship.x, ship.z)) {
      this.tx.send(ship.id, 'trade', { ok: false, why: 'No guns in a Safe Haven' });
      return;
    }

    let relBearing;
    let range;
    if (typeof aim === 'string') {
      // Keyboard fallback: straight out that battery's beam, at middling reach.
      if (!BATTERIES[aim]) return;
      relBearing = BATTERIES[aim].bearing;
      range = MAX_RANGE * 0.6;
    } else if (aim && Number.isFinite(aim.b)) {
      relBearing = aim.b;
      range = Number.isFinite(aim.r) ? aim.r : MAX_RANGE * 0.6;
    } else {
      return;
    }

    const batteryKey = batteryForBearing(relBearing);
    if (!batteryKey) return;                    // nothing trains that way
    if (ship.reload[batteryKey] > 0) return;

    // No gun there yet — that battery has to be bought with a talent point.
    // The class matters: without it this falls back to the Sailboat's cap and
    // a Flagship fires three balls out of twenty guns.
    const count = gunsFor(ship.picks, ship.cls)[batteryKey];
    if (count <= 0) return;

    const trained = clampToArc(batteryKey, relBearing);
    const elevation = solveElevation(range);

    const stats = statsFor(ship.picks);
    ship.reload[batteryKey] = RELOAD_BASE[batteryKey] * stats.reload;
    const seed = this.nextId * 0.6180339887;
    const ammo = AMMO[ship.ammo] || AMMO.round;

    for (let i = 0; i < count; i++) {
      const m = muzzle(ship, batteryKey, i, count, seed, trained, elevation);
      this.shots.push({
        id: this.nextId++,
        owner: ship.id,
        ammo: ship.ammo,
        dmg: 12 * ammo.dmg * stats.damage,
        age: 0,
        ...m,
      });
    }

    this.tx.broadcast('shot', {
      by: ship.id, battery: batteryKey, ammo: ship.ammo, count, seed,
      rb: trained, el: elevation,
      x: ship.x, z: ship.z, h: ship.heading, vx: ship.vx, vz: ship.vz,
      t: this.now(),
    });
  }

  dropBarrel(p) {
    const ship = p.ship;
    if (ship.sunk || ship.barrels <= 0) return;
    if (inSafeWater(ship.x, ship.z)) return;
    ship.barrels--;
    const astern = 9;
    const b = {
      id: this.nextId++,
      owner: ship.id,
      x: ship.x - Math.sin(ship.heading) * astern,
      z: ship.z - Math.cos(ship.heading) * astern,
      born: this.now(),
    };
    this.barrels.push(b);
    this.tx.broadcast('barrel', b);
  }

  step(dt) {
    const t = this.now();
    this.stepShots(dt, t);
    this.stepBarrels(t);
    this.stepAfflictions(dt);
    this.restock(dt);
  }

  /** The hold makes up more powder kegs, slowly, so nobody is left unarmed. */
  restock(dt) {
    for (const p of this.players.values()) {
      const ship = p.ship;
      const max = statsFor(ship.picks).barrels;
      if (ship.barrels >= max) { p.kegTimer = 0; continue; }
      p.kegTimer = (p.kegTimer || 0) + dt;
      if (p.kegTimer >= 40) {
        p.kegTimer = 0;
        ship.barrels++;
      }
    }
  }

  stepShots(dt, t) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const alive = stepShot(s, dt);

      let done = !alive;
      if (!done) {
        // Ships first — a ball that would splash next tick can still hit a hull.
        for (const target of this.targets()) {
          if (target.id === s.owner || target.sunk) continue;
          const dims = { length: classOf(target.cls).length, beam: classOf(target.cls).beam,
                         height: HULL_DIMS.height };
          if (!hitsHull(s.x, s.y, s.z, target, dims, SHOT.radius)) continue;
          this.applyShot(s, target);
          done = true;
          break;
        }
        // The Kraken is a target too, and a big one.
        if (!done && this.krakenHit && this.krakenHit(s)) done = true;
      }
      if (!done && s.y <= waterHeight(s.x, s.z, t)) {
        this.tx.broadcast('splash', { x: s.x, z: s.z, r: 1.6 });
        done = true;
      }
      if (done) this.shots.splice(i, 1);
    }
  }

  stepBarrels(t) {
    for (let i = this.barrels.length - 1; i >= 0; i--) {
      const b = this.barrels[i];
      if (t - b.born < TNT.fuse) continue;
      this.barrels.splice(i, 1);
      this.tx.broadcast('boom', { x: b.x, z: b.z, r: TNT.radius });

      for (const target of this.targets()) {
        if (target.sunk) continue;
        if (target.id === b.owner && t - b.born < TNT.armTime) continue;
        const d = Math.hypot(target.x - b.x, target.z - b.z);
        if (d > TNT.radius) continue;
        // Full force at the centre, tailing off to nothing at the rim.
        const falloff = 1 - d / TNT.radius;
        this.damage(target, TNT.damage * falloff * falloff, b.owner, { x: b.x, y: 1, z: b.z }, 'tnt');
      }
    }
  }

  /** What a ball does when it arrives, which depends on what was in the gun. */
  applyShot(s, target) {
    const a = AMMO[s.ammo] || AMMO.round;
    const at = { x: s.x, y: s.y, z: s.z };
    if (a.blast) {
      // Explosive bursts: everything close by takes a share.
      this.tx.broadcast('boom', { x: s.x, z: s.z, r: a.blast });
      for (const other of this.targets()) {
        if (other.sunk) continue;
        const d = Math.hypot(other.x - s.x, other.z - s.z);
        if (d > a.blast) continue;
        this.damage(other, s.dmg * (1 - d / a.blast), s.owner, at, 'shot');
      }
      return;
    }
    this.damage(target, s.dmg, s.owner, at, 'shot');
    if (a.slow) {
      // Chainshot in the rigging: she loses her way for a while.
      target.throttle = Math.max(0, target.throttle * (1 - a.slow));
      target.rigged = (target.rigged || 0) + 6;
    }
    if (a.burn) {
      target.burning = Math.max(target.burning || 0, 6);
      target.burnBy = s.owner;
      target.burnRate = a.burn;
    }
  }

  /** Fires still burning, rigging still cut. */
  stepAfflictions(dt) {
    for (const target of this.targets()) {
      if (target.sunk) continue;
      if (target.burning > 0) {
        target.burning -= dt;
        this.damage(target, (target.burnRate || 6) * dt, target.burnBy, 
          { x: target.x, y: 2, z: target.z }, 'fire');
      }
      if (target.rigged > 0) target.rigged -= dt;
    }
  }

  damage(target, amount, byId, at, kind) {
    // Running aground still hurts inside the ring; shot and powder do not.
    if (kind !== 'ground' && inSafeWater(target.x, target.z)) return;

    // No firing into your own squadron — a captain and her consorts share a
    // faction, and so do the ships of a fleet.
    if (byId) {
      const from = this.targets().find((s) => s.id === byId);
      if (from && from.faction && from.faction === target.faction) return;
    }
    const dealt = Math.max(0, amount * (1 - (target.armour || 0)));
    target.hp = Math.max(0, target.hp - dealt);

    this.tx.broadcast('hit', { id: target.id, x: at.x, y: at.y, z: at.z, dmg: Math.round(dealt), kind });

    // XP goes to whoever landed it — and a consort's work is her admiral's.
    let shooter = [...this.players.values()].find((p) => p.ship.id === byId);
    if (!shooter && byId) {
      const gun = this.targets().find((s) => s.id === byId);
      if (gun?.owner) shooter = this.players.get(gun.owner);
    }
    if (shooter && shooter.ship.id !== target.id) this.awardXp(shooter, dealt);

    if (target.hp <= 0 && !target.sunk) this.sink(target, shooter);
  }

  awardXp(p, amount) {
    const ship = p.ship;
    ship.xp += amount;
    const now = levelFromXp(ship.xp);
    if (now > ship.level) {
      ship.level = now;
      // Levelling can open a whole new section (fleet command at 40), so the
      // hand has to be dealt again or the new cards never appear.
      this.onLevel?.(p);
      this.tx.send(p.ship.id, 'levelled', { level: ship.level, offer: ship.offer });
    }
  }

  sink(target, shooter) {
    target.sunk = true;
    target.sunkAt = this.now();
    target.hoist = 0;
    const by = shooter?.ship.name ?? 'the sea';
    this.tx.broadcast('sunk', { id: target.id, name: target.name, by });
    // A broken hull spills its hold, plus whatever it was already carrying.
    this.spill?.(target.x, target.z, TRADE.cargoPerSink + Math.round(target.cargo || 0));
    this.onKill?.(target, shooter);
    if (shooter) {
      this.awardXp(shooter, 120);
      this.tx.send(shooter.ship.id, 'earned', { amount: 40, why: `sank ${target.name}` });
      shooter.kills = (shooter.kills || 0) + 1;
    }
  }

  /** Bring the sunk back after a spell treading water. */
  respawn(spawnAngle) {
    const t = this.now();
    for (const p of this.players.values()) {
      const ship = p.ship;
      if (!ship.sunk || t - ship.sunkAt < RESPAWN_DELAY) continue;
      const fresh = createShip(ship.id, ship.name, spawnAngle(), ship.cls);
      const stats = statsFor(ship.picks, ship.cls);
      // Keep everything earned; replace everything broken. Cargo in the hold
      // goes down with the ship — that is the risk of a long run home.
      Object.assign(fresh, {
        xp: ship.xp, level: ship.level, picks: ship.picks,
        trail: ship.trail, armour: ship.armour,
        maxHp: stats.maxHp, hp: stats.maxHp,
        barrels: stats.barrels,
      });
      p.ship = fresh;
      p.lastX = fresh.x;
      p.lastZ = fresh.z;
      this.tx.send(p.ship.id, 'respawned', { x: fresh.x, z: fresh.z, h: fresh.heading });
    }
  }
}

export { RESPAWN_DELAY };
