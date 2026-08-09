// The authoritative game: weather, players, crowns, and the fixed-step tick.
//
// This file knows nothing about sockets, HTTP or the filesystem. It talks to a
// transport and a profile store (see transport.js), which is what lets the exact
// same simulation run on a Node server or inside a browser tab hosting a
// peer-to-peer lobby.
import {
  TICK_DT, TICK_HZ, SNAPSHOT_HZ, WORLD,
  createShip, defaultInput, stepShip, classOf, nextClass, SHIP_CLASSES,
} from './physics.js';
import {
  ISLANDS, HAVENS, BASES, TRADE, dockedAt, landClearance, inSafeWater, safeRadius,
} from './world.js';
import { SEA, seaStateFor, tsunamiAt } from './waves.js';
import { CROWNS, TRAILS } from './cosmetics.js';
import {
  TALENTS, statsFor, gunsFor, pointsFree, pointsSpent, rollOffer, TALENT_GROUPS,
  levelFromXp,
} from './combat.js';
import { Combat } from './combat-host.js';
import { Captain, FACTIONS, fleetFor, bandFor } from './ai.js';
import { Kraken, KRAKEN } from './kraken.js';
import {
  AMMO, RESOURCES, ARMOUR_SETS, CRAFT_BATCH, consortSpec, FLEET_LEVEL, rollOffer as roll2,
} from './combat.js';
import { createShip as newShip } from './physics.js';

export class GameHost {
  /**
   * @param transport host-side transport: { broadcast, send }
   * @param profiles  profile store: { get, award, buy, equip, flush }
   * @param now       () => seconds on the shared clock
   * @param dev       enable the testing hooks (rogue waves, free crowns, teleport)
   */
  constructor({ transport, profiles, now, dev = false, log = () => {} }) {
    this.tx = transport;
    this.profiles = profiles;
    this.now = now;
    this.dev = dev;
    this.log = log;

    this.players = new Map();
    // Wind no longer drives the ships — the sea state is its own slow weather.
    this.weather = { rough: 11, target: 11 };
    this.spawnCounter = 0;
    this.combat = new Combat(transport, this.players, now);
    this.cargoDrops = [];
    this.nextDropId = 1;
    this.combat.spill = (x, z, units) => this.spill(x, z, units);

    // --- Phase 4: the world has other things in it now --------------------
    this.npcs = new Map();          // id -> { ship, captain }
    this.nextNpcId = 1;
    this.kraken = null;
    this.nextFleet = now() + 20;
    this.nextKraken = now() + 200 + Math.random() * 240;

    // Shots and barrels must be able to find AI hulls, not just players.
    this.combat.targets = () => [
      ...[...this.players.values()].map((p) => p.ship),
      ...[...this.npcs.values()].map((n) => n.ship),
    ];
    this.combat.onKill = (target, shooter) => this.onKill(target, shooter);
    this.combat.onLevel = (p) => {
      p.ship.offer = rollOffer(p.ship.picks, p.ship.cls, Math.random, p.ship.level);
    };
    this.combat.krakenHit = (shot) => this.hitKraken(shot);

    SEA.scale = seaStateFor(this.weather.rough);
    SEA.tsunami = null;
    this.nextTsunami = now() + 150 + Math.random() * 220;

    this.acc = 0;
    this.sinceSnapshot = 0;
  }

  nextSpawnAngle() {
    // Golden angle, so ships never stack up on the spawn circle.
    return (this.spawnCounter++ * 2.399963) % (Math.PI * 2);
  }

  // ------------------------------------------------------------- connections
  join(clientId, payload = {}) {
    if (this.players.has(clientId)) return;
    const name = String(payload.name || 'Sailor').slice(0, 16).trim() || 'Sailor';
    const profile = this.profiles.get(name);
    const ship = createShip(clientId, name, this.nextSpawnAngle(), profile.cls || 'sailboat');
    ship.trail = profile.trail;
    ship.armour = profile.armour || 0;
    // Your base is a fixed island, so you always know where home is.
    const home = BASES[hashName(name) % BASES.length];
    ship.home = home.id;
    // Her own consorts must never fight her, and every AI must treat the whole
    // squadron as one enemy — so a captain and her fleet share a faction.
    ship.faction = `crew:${clientId}`;

    // Everything you have EARNED. This used to live only on the ship, which is
    // built fresh by createShip on every join — so reconnecting, or the host
    // reloading their tab, silently wiped every level and every talent point
    // while the coins and the hull came back fine.
    ship.xp = Math.max(0, Number(profile.xp) || 0);
    ship.level = levelFromXp(ship.xp);
    ship.picks = { ...(profile.picks || {}) };
    const restored = statsFor(ship.picks, ship.cls);
    ship.maxHp = restored.maxHp;
    ship.hp = restored.maxHp;

    // After the picks and the level, or the hand is dealt for a fresh captain.
    ship.offer = rollOffer(ship.picks, ship.cls, Math.random, ship.level);

    this.players.set(clientId, {
      ship, input: defaultInput(), name, profile,
      metres: 0, lastX: ship.x, lastZ: ship.z, rodeWave: null,
    });

    this.tx.send(clientId, 'init', {
      id: clientId,
      t: this.now(),
      world: { radius: WORLD.radius },
      tickHz: TICK_HZ,
      snapshotHz: SNAPSHOT_HZ,
      state: this.snapshot(),
      profile,
      islands: ISLANDS,
      home: ship.home,
      // Whether this host honours the dev hooks at all. Without it the console
      // cheats cheerfully report success while the host quietly drops every one
      // of them, which is indistinguishable from the cheats being broken.
      dev: !!this.dev,
    });
    this.tx.broadcast('joined', { id: clientId, name });
    this.log(`[+] ${name} (${clientId}) — ${this.players.size} aboard`);
  }

  leave(clientId) {
    const p = this.players.get(clientId);
    if (!p) return;
    this.players.delete(clientId);
    this.profiles.flush();
    this.tx.broadcast('left', { id: clientId, name: p.ship.name });
    this.log(`[-] ${p.ship.name} left — ${this.players.size} aboard`);
  }

  // ------------------------------------------------------------------ fleets
  /** Put a squadron on the chart: a flag and her consorts, in line ahead. */
  spawnFleet(factionKey) {
    const f = FACTIONS[factionKey];
    // Match the opposition to whoever is actually out there. With several
    // players afloat, anchor on one of them so nobody sails into a squadron
    // built for somebody thirty levels above them.
    const crew = [...this.players.values()].filter((p) => !p.ship.sunk);
    const anchor = crew.length ? crew[Math.floor(Math.random() * crew.length)] : null;
    const level = anchor ? anchor.ship.level : 1;
    const plan = fleetFor(level, factionKey);
    const size = plan.size;
    // Fleets form up in open water, never inside a Safe Haven's ring.
    let ox = 0;
    let oz = 0;
    let clear = false;
    for (let tries = 0; tries < 60 && !clear; tries++) {
      const bearing = Math.random() * Math.PI * 2;
      if (anchor) {
        // Over the horizon from the anchor, but close enough to actually meet.
        const d = 700 + Math.random() * 700;
        ox = anchor.ship.x + Math.sin(bearing) * d;
        oz = anchor.ship.z + Math.cos(bearing) * d;
        const fromMiddle = Math.hypot(ox, oz);
        if (fromMiddle > WORLD.radius * 0.94) {
          ox *= (WORLD.radius * 0.94) / fromMiddle;
          oz *= (WORLD.radius * 0.94) / fromMiddle;
        }
      } else {
        const r = WORLD.radius * (0.35 + Math.random() * 0.5);
        ox = Math.sin(bearing) * r;
        oz = Math.cos(bearing) * r;
      }
      clear = !inSafeWater(ox, oz) && landClearance(ox, oz) > 150;
    }
    if (!clear) {
      // Nowhere random worked; shove the point clear of the nearest ring rather
      // than dropping a squadron inside a Safe Haven where it cannot fire.
      const isle = inSafeWater(ox, oz);
      if (isle) {
        const dx = ox - isle.x;
        const dz = oz - isle.z;
        const len = Math.hypot(dx, dz) || 1;
        const want = safeRadius(isle) + 220;
        ox = isle.x + (dx / len) * want;
        oz = isle.z + (dz / len) * want;
      }
    }
    const bearing = Math.atan2(-ox, -oz);
    let flag = null;

    for (let i = 0; i < size; i++) {
      const cls = plan.hulls[i];
      const id = `ai${this.nextNpcId++}`;
      const ship = newShip(id, f.name, 0, cls);
      ship.x = ox + (Math.random() - 0.5) * 60;
      ship.z = oz + (Math.random() - 0.5) * 60 - i * classOf(cls).length * 1.6;
      ship.heading = bearing + Math.PI;
      ship.faction = factionKey;
      ship.ai = true;
      ship.throttle = 0.8;
      // Guns already run out, and a crew worked up to match the opposition.
      ship.picks = { ...plan.picks };
      const st = statsFor(ship.picks, cls);
      ship.maxHp = st.maxHp;
      ship.hp = st.maxHp;
      ship.cargo = factionKey === 'treasure' ? classOf(cls).cargo : Math.round(classOf(cls).cargo * 0.35);

      const captain = new Captain(ship, factionKey, {
        leader: i === 0 ? null : flag,
        station: { along: 1.6 * i, across: (i % 2 ? 0.7 : -0.7) },
        patrolR: Math.hypot(ox, oz),
        skill: plan.skill,       // green crews early on, worked up by level 25
      });
      if (i === 0) flag = ship;
      this.npcs.set(id, { ship, captain });
    }
    this.log(`[~] ${f.name} sighted — ${size} sail (for level ${level}: ` +
      `${[...new Set(plan.hulls)].join(', ')})`);
    this.tx.broadcast('fleet', { faction: factionKey, name: f.name, size, level });
  }

  /**
   * Keep every captain's consorts matched to the ranks she has taken. Ships are
   * raised alongside her and sail as a squadron; sunk ones are replaced after a
   * spell, so a fleet is an asset you maintain rather than one you lose forever.
   */
  refitFleets(t) {
    for (const [id, p] of this.players) {
      const ship = p.ship;
      const spec = consortSpec(ship.picks);
      p.fleet = (p.fleet || []).filter((c) => this.npcs.has(c));

      // Retire anything over the limit or of the wrong class.
      while (p.fleet.length > spec.count) {
        const gone = p.fleet.pop();
        this.npcs.delete(gone);
      }
      for (const cid of [...p.fleet]) {
        const n = this.npcs.get(cid);
        if (!n || n.ship.cls === spec.cls) continue;
        this.npcs.delete(cid);                       // she goes back to the yard
        p.fleet.splice(p.fleet.indexOf(cid), 1);
      }
      if (p.fleet.length >= spec.count || ship.sunk) continue;
      if (t - (p.lastLaunch || 0) < 6) continue;     // one at a time
      p.lastLaunch = t;

      const cid = `ai${this.nextNpcId++}`;
      const c = newShip(cid, `${ship.name}'s consort`, 0, spec.cls);
      const idx = p.fleet.length;
      const off = classOf(spec.cls).length * (1.8 + idx * 0.9);
      c.x = ship.x - Math.sin(ship.heading) * off + Math.cos(ship.heading) * (idx % 2 ? 30 : -30);
      c.z = ship.z - Math.cos(ship.heading) * off - Math.sin(ship.heading) * (idx % 2 ? 30 : -30);
      c.heading = ship.heading;
      c.faction = ship.faction;                      // one squadron, one flag
      c.ai = true;
      c.owner = id;
      c.consort = true;
      c.throttle = 0.8;
      c.picks = { ...spec.picks };
      c.extraGuns = spec.extraGuns;
      const st = statsFor(c.picks, spec.cls);
      c.maxHp = st.maxHp + spec.extraHull;
      c.hp = c.maxHp;

      const captain = new Captain(c, 'consort', {
        leader: ship,
        station: { along: 1.5 + idx * 0.8, across: idx % 2 ? 0.8 : -0.8 },
      });
      captain.skill = 0.6 + Math.min(0.35, (ship.picks.fleetgunnery || 0) * 0.04);
      this.npcs.set(cid, { ship: c, captain });
      p.fleet.push(cid);
      this.tx.send(id, 'consort', { cls: spec.cls, n: p.fleet.length, of: spec.count });
    }
  }

  stepNpcs(dt, t) {
    const all = this.combat.targets();
    for (const [id, n] of this.npcs) {
      const ship = n.ship;
      if (ship.sunk) {
        // Leave the wreck a moment, then clear her off the chart.
        if (t - (ship.sunkAt || t) > 12) this.npcs.delete(id);
        else stepShip(ship, { rudder: 0, throttle: 0 }, dt, t);
        continue;
      }
      // Hostile to players and to every other faction.
      const foes = all.filter((s) => s !== ship && !s.sunk &&
        (!s.faction || s.faction !== ship.faction));
      const { input, fire } = n.captain.think(foes, dt, t);
      stepShip(ship, input, dt, t);
      this.keepOffTheRocks(ship);
      if (fire) this.combat.fire({ ship, name: ship.name, profile: {} }, fire);
    }

    this.refitFleets(t);

    const wild = [...this.npcs.values()].filter((n) => !n.ship.consort).length;
    if (wild < 10 && t > this.nextFleet) {
      this.nextFleet = t + 70 + Math.random() * 90;
      const roll = Math.random();
      this.spawnFleet(roll < 0.28 ? 'treasure' : roll < 0.55 ? 'armada'
        : roll < 0.82 ? 'dutch' : 'pirate');
    }
  }

  // ------------------------------------------------------------------ kraken
  stepKraken(dt, t) {
    if (this.kraken) {
      // Anything sheltering inside a ring is out of her reach.
      const reachable = this.combat.targets().filter((s) => !inSafeWater(s.x, s.z));
      this.kraken.step(dt, t, reachable, (ship, dmg, at) => {
        this.combat.damage(ship, dmg, null, at, 'kraken');
      });
      if (this.kraken.dead) {
        this.tx.broadcast('kraken', null);
        this.spill(this.kraken.x, this.kraken.z, KRAKEN.bounty.cargo);
        this.spillResources(this.kraken.x, this.kraken.z, 14);
        this.log('[~] the Kraken goes down');
        this.kraken = null;
        this.nextKraken = t + 260 + Math.random() * 300;
      }
      return;
    }
    if (t < this.nextKraken || this.players.size === 0) return;
    // She will not come up under a Safe Haven — nothing can be hurt in there,
    // so a Kraken inside the ring is just an animation flailing at nobody.
    const open = [...this.players.values()]
      .map((p) => p.ship)
      // She does not come up under a beginner. A captain with one gun a side
      // cannot fight her and cannot outrun her, so meeting her is not an event,
      // it is a death. `cheat.kraken()` sets `krakenForced` to override this.
      .filter((s) => !s.sunk && !inSafeWater(s.x, s.z)
        && (this.krakenForced || (s.level || 1) >= KRAKEN.minLevel));
    if (!open.length) { this.nextKraken = t + 30; return; }
    this.krakenForced = false;
    const victim = open[Math.floor(Math.random() * open.length)];
    let kx = victim.x + (Math.random() - 0.5) * 120;
    let kz = victim.z + (Math.random() - 0.5) * 120;
    if (inSafeWater(kx, kz)) { kx = victim.x; kz = victim.z; }
    // Sized to whoever she came up under, so she is a fight rather than a wall.
    this.kraken = new Kraken(kx, kz, t, victim.level || 1);
    this.tx.broadcast('kraken-rises', { x: this.kraken.x, z: this.kraken.z });
    this.log(`[~] KRAKEN — ${this.kraken.maxHp} hull, for level ${victim.level || 1}`);
  }

  hitKraken(shot) {
    const k = this.kraken;
    if (!k) return false;
    if (Math.hypot(shot.x - k.x, shot.z - k.z) > 26 || shot.y > 22) return false;
    const killed = k.damage(shot.dmg * 1.4);
    this.tx.broadcast('hit', { id: 'kraken', x: shot.x, y: shot.y, z: shot.z,
      dmg: Math.round(shot.dmg * 1.4), kind: 'shot' });
    if (killed) {
      const p = [...this.players.values()].find((q) => q.ship.id === shot.owner);
      if (p) {
        this.combat.awardXp(p, KRAKEN.bounty.xp);
        p.profile.crowns += KRAKEN.bounty.crowns;
        this.tx.send(p.ship.id, 'earned',
          { amount: KRAKEN.bounty.crowns, why: 'killed the Kraken' });
      }
    }
    return true;
  }

  /** Salvage floating free after something big goes down. */
  spillResources(x, z, n) {
    const kinds = Object.keys(RESOURCES);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 5 + Math.random() * 22;
      this.cargoDrops.push({
        id: this.nextDropId++,
        x: x + Math.sin(a) * d,
        z: z + Math.cos(a) * d,
        born: this.now(),
        res: kinds[Math.floor(Math.random() * kinds.length)],
      });
    }
  }

  /** Something died: hand out the loot it was carrying. */
  onKill(target, shooter) {
    if (!target.ai) return;
    const f = FACTIONS[target.faction];
    this.spillResources(target.x, target.z, 4 + Math.floor(Math.random() * 6));
    if (!shooter) return;
    // Rated warships and treasure hulls carry plate worth having.
    const roll = Math.random();
    const tier = target.faction === 'treasure' ? 0.55 : 0.28;
    if (roll < tier) {
      const set = roll < tier * 0.25 ? 'platinum' : roll < tier * 0.6 ? 'bronze' : 'iron';
      const cur = ARMOUR_SETS[shooter.profile.armourSet]?.rank ?? 0;
      if (ARMOUR_SETS[set].rank > cur) {
        shooter.profile.armourSet = set;
        shooter.ship.armour = Math.max(shooter.ship.armour, ARMOUR_SETS[set].reduce);
        this.profiles.dirty = true;
        this.tx.send(shooter.ship.id, 'loot',
          { set, name: ARMOUR_SETS[set].name, reduce: ARMOUR_SETS[set].reduce });
      }
    }
    this.tx.send(shooter.ship.id, 'earned',
      { amount: 25, why: `sank a ${f ? f.name : 'hull'}` });
    shooter.profile.crowns += 25;
  }

  /** Every message a client can send. Unknown events are ignored. */
  message(clientId, event, data) {
    const p = this.players.get(clientId);

    switch (event) {
      case 'join':
        return this.join(clientId, data);

      case 'input': {
        if (!p || !data) return;
        // Clamp rather than quantise. A keyboard only ever sends -1, 0 or 1, but
        // a touch helm is proportional — snapping it to hard-over here would put
        // the host and the client's own prediction on different rudders every
        // tick, which reads as the ship fighting your thumb. The cap is what
        // stops a client asking for a rudder it does not have.
        const cl = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.min(Math.max(n, -1), 1) : 0;
        };
        p.input.rudder = cl(data.r);
        p.input.throttle = cl(data.t);
        if (typeof data.seq === 'number' && data.seq > p.input.seq) p.input.seq = data.seq;
        return;
      }

      case 'ping-t':
        return this.tx.send(clientId, 'pong-t', { c: data, s: this.now() });

      // data is either a battery name (keyboard) or {b, r} from mouse aim;
      // combat.fire validates both and picks the battery itself.
      case 'fire':
        if (p) this.combat.fire(p, data);
        return;

      case 'drop-tnt':
        if (p) this.combat.dropBarrel(p);
        return;

      case 'spend-talent':
        return this.spendTalent(p, data, clientId);

      case 'buy-trail':
        return this.buyTrail(p, data, clientId);

      case 'set-ammo':
        if (!p || !AMMO[data]) return;
        if (data !== 'round' && (p.profile.ammo?.[data] || 0) <= 0) return;
        p.ship.ammo = data;
        return;

      case 'craft':
        return this.craft(p, data, clientId);

      case 'sell-cargo':
        return this.sellCargo(p, clientId);

      case 'buy-ship':
        return this.buyShip(p, clientId);

      case 'buy-armour':
        return this.buyArmour(p, clientId);

      case 'equip-trail':
        if (!p) return;
        if (this.profiles.equip(p.name, data)) p.ship.trail = p.profile.trail;
        return this.tx.send(clientId, 'profile', { ...p.profile, result: 'ok', item: data });

      // ---- testing hooks -------------------------------------------------
      case 'summon-tsunami': {
        if (!this.dev) return;
        const amp = Number(data?.amp);
        return this.spawnTsunami(this.now(), {
          lead: Math.min(Math.max(Number(data?.lead) || 25, 6), 180),
          amp: Number.isFinite(amp) ? Math.min(Math.max(amp, 1), 200) : undefined,
          width: Number.isFinite(Number(data?.width)) ? Number(data.width) : undefined,
        });
      }

      case 'grant-crowns':
        if (!this.dev || !p) return;
        this.profiles.award(p.name, Math.min(Math.max(Number(data) || 0, 0), 5000));
        return this.tx.send(clientId, 'profile', { ...p.profile, result: 'ok' });

      case 'dev-class': {
        if (!this.dev || !p) return;
        if (!classOf(data) || !SHIP_CLASSES[data]) return;
        const stats = statsFor(p.ship.picks, data);
        p.ship.cls = data;
        p.profile.cls = data;
        p.ship.maxHp = stats.maxHp;
        p.ship.hp = stats.maxHp;
        return;
      }

      case 'reset-profile': {
        if (!this.dev || !p) return;
        // Wipe the purse and the hull back to a fresh captain, keeping the name.
        Object.assign(p.profile, {
          crowns: 0, coins: 0, cls: 'sailboat', armour: 0,
          owned: ['foam'], trail: 'foam',
          // Levels and talents are saved now, so a wipe has to clear them too
          // or you come back a bare sailboat still carrying forty talent points.
          xp: 0, level: 1, picks: {},
        });
        p.savedSpent = 0;
        this.profiles.dirty = true;
        this.profiles.flush?.();
        const fresh = createShip(p.ship.id, p.ship.name, this.nextSpawnAngle(), 'sailboat');
        fresh.home = p.ship.home;
        fresh.offer = rollOffer({}, 'sailboat', Math.random, 1);
        fresh.faction = `crew:${clientId}`;
        p.ship = fresh;
        p.lastX = fresh.x;
        p.lastZ = fresh.z;
        p.metres = 0;
        this.log(`[!] ${p.name} reset their profile`);
        this.tx.send(clientId, 'profile', { ...p.profile, result: 'ok' });
        this.tx.send(clientId, 'trade', { ok: true, why: 'Profile reset — fresh sailboat' });
        this.tx.send(clientId, 'respawned', { x: fresh.x, z: fresh.z, h: fresh.heading });
        return;
      }

      case 'dev-fleet':
        if (!this.dev) return;
        return this.spawnFleet(FACTIONS[data] ? data : 'armada');

      case 'dev-kraken':
        if (!this.dev) return;
        this.nextKraken = this.now();
        this.krakenForced = true;   // summon her regardless of level
        return;

      case 'dev-picks': {
        if (!this.dev || !p) return;
        p.ship.picks = { ...(data || {}) };
        const st = statsFor(p.ship.picks, p.ship.cls);
        p.ship.maxHp = st.maxHp;
        p.ship.hp = st.maxHp;
        p.ship.offer = rollOffer(p.ship.picks, p.ship.cls, Math.random, p.ship.level);
        return;
      }

      case 'dev-hurt':
        if (!this.dev || !p) return;
        p.ship.hp = Math.max(1, p.ship.hp - (Number(data) || 0));
        return;

      case 'dev-cargo':
        if (!this.dev || !p) return;
        p.ship.cargo = Math.min(classOf(p.ship.cls).cargo, Math.max(0, Number(data) || 0));
        return;

      case 'grant-coins':
        if (!this.dev || !p) return;
        p.profile.coins = (p.profile.coins || 0) + Math.min(Math.max(Number(data) || 0, 0), 50000);
        this.profiles.dirty = true;
        return;

      case 'dev-xp':
        if (!this.dev || !p) return;
        return this.combat.awardXp(p, Math.min(Math.max(Number(data) || 0, 0), 100000));

      case 'dev-place': {
        if (!this.dev || !p) return;
        const { x = 0, z = 0, h = 0 } = data || {};
        Object.assign(p.ship, {
          x: Number(x) || 0, z: Number(z) || 0, heading: Number(h) || 0,
          vx: 0, vz: 0, omega: 0, throttle: 0,
        });
        p.lastX = p.ship.x;
        p.lastZ = p.ship.z;
        return;
      }
      default:
        return;
    }
  }

  spendTalent(p, which, clientId) {
    if (!p || !TALENTS[which]) return;
    const ship = p.ship;
    if (pointsFree(ship.level, ship.picks) <= 0) return;
    // Only the three cards you were dealt are on the table.
    if (!TALENT_GROUPS.some((g) => ship.offer?.[g] === which)) return;
    const rank = (ship.picks[which] || 0) + 1;
    if (rank > TALENTS[which].max) return;
    ship.picks[which] = rank;

    // Hull and powder take effect at once; the extra hull comes as fresh timber.
    const stats = statsFor(ship.picks, ship.cls);
    const gained = stats.maxHp - ship.maxHp;
    ship.maxHp = stats.maxHp;
    ship.hp = Math.min(ship.maxHp, ship.hp + Math.max(0, gained));
    ship.barrels = Math.max(ship.barrels, stats.barrels);
    ship.offer = rollOffer(ship.picks, ship.cls, Math.random, ship.level); // fresh hand
    this.tx.send(clientId, 'talents', {
      picks: ship.picks, level: ship.level, offer: ship.offer,
    });
  }

  buyTrail(p, id, clientId) {
    if (!p) return;
    const result = this.profiles.buy(p.name, id);
    if (result === 'ok') {
      p.ship.trail = p.profile.trail;
      this.log(`[$] ${p.name} bought ${TRAILS[id].name} (${p.profile.crowns | 0} crowns left)`);
    }
    this.tx.send(clientId, 'profile', { ...p.profile, result, item: id });
  }

  // -------------------------------------------------------------------- trade
  /**
   * Cargo spilled by a broken hull. It floats, and anyone can take it — sinking
   * someone next to a rival is a real risk.
   */
  spill(x, z, units) {
    for (let i = 0; i < units; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 14;
      this.cargoDrops.push({
        id: this.nextDropId++,
        x: x + Math.sin(a) * d,
        z: z + Math.cos(a) * d,
        born: this.now(),
      });
    }
    if (this.cargoDrops.length > 400) this.cargoDrops.splice(0, this.cargoDrops.length - 400);
  }

  /** Sail over a crate to take it aboard, if there is room in the hold. */
  collectCargo() {
    const t = this.now();
    for (let i = this.cargoDrops.length - 1; i >= 0; i--) {
      const d = this.cargoDrops[i];
      if (t - d.born > 240) { this.cargoDrops.splice(i, 1); continue; }
      for (const [id, p] of this.players) {
        const s = p.ship;
        if (s.sunk) continue;
        const cap = classOf(s.cls).cargo;
        if (!d.res && s.cargo >= cap) continue;
        if (Math.hypot(s.x - d.x, s.z - d.z) > classOf(s.cls).beam + 6) continue;
        this.cargoDrops.splice(i, 1);
        if (d.res) {
          p.profile.res = p.profile.res || {};
          p.profile.res[d.res] = (p.profile.res[d.res] || 0) + 1;
          this.profiles.dirty = true;
          this.tx.send(id, 'picked', { res: d.res, n: p.profile.res[d.res] });
        } else {
          s.cargo++;
          this.tx.send(id, 'picked', { cargo: s.cargo, cap });
        }
        break;
      }
    }
  }

  /** Islands are solid. Run at one and you stop, and it hurts. */
  /**
   * Write what a captain has earned back to their profile.
   *
   * Levels, XP and talent ranks are ship state, and the ship is rebuilt on
   * every join — so without this they survived exactly as long as the
   * connection did. Coins and hulls were saved and the levels were not, which
   * is a particularly confusing way to lose an evening's play.
   *
   * Called every snapshot; the guard makes that free, and the store's own
   * throttled flush decides when it actually reaches disk or localStorage.
   */
  saveProgress(p) {
    const s = p.ship;
    const spent = pointsSpent(s.picks);
    if (p.profile.xp === s.xp && p.profile.level === s.level && p.savedSpent === spent) return;
    p.savedSpent = spent;
    p.profile.xp = s.xp;
    p.profile.level = s.level;
    p.profile.picks = { ...s.picks };
    this.profiles.dirty = true;
  }

  keepOffTheRocks(ship) {
    const clear = landClearance(ship.x, ship.z);
    const margin = classOf(ship.cls).beam * 0.6;
    if (clear > margin) return;

    let nearest = null;
    let best = Infinity;
    for (const isle of ISLANDS) {
      const d = Math.hypot(ship.x - isle.x, ship.z - isle.z) - isle.radius;
      if (d < best) { best = d; nearest = isle; }
    }
    if (!nearest) return;

    const nx = ship.x - nearest.x;
    const nz = ship.z - nearest.z;
    const len = Math.hypot(nx, nz) || 1;
    const ux = nx / len;
    const uz = nz / len;
    // Set her down a hair OUTSIDE the margin, not exactly on it. Parked exactly
    // on it, `clear > margin` was false for ever, so this ran every tick.
    const want = nearest.radius + margin * 1.04;
    ship.x = nearest.x + ux * want;
    ship.z = nearest.z + uz * want;

    const into = -(ship.vx * ux + ship.vz * uz);   // +ve = still driving ashore
    // Stop the way she has on TOWARD the beach, and leave the rest. Scaling the
    // whole velocity meant that even pointing out to sea, every tick quartered
    // whatever speed she had just built — she could never get off again.
    if (into > 0) {
      ship.vx += ux * into;
      ship.vz += uz * into;
    }
    // What is left still drags: grounding should cost you way, not all of it.
    ship.vx *= 0.82;
    ship.vz *= 0.82;
    if (into > 4 && !ship.sunk) {
      const p = [...this.players.values()].find((q) => q.ship === ship);
      this.combat.damage(ship, into * 1.6, null, { x: ship.x, y: 1, z: ship.z }, 'ground');
      if (p) this.tx.send(ship.id, 'aground', { name: nearest.name });
    }
  }

  /** Turn salvage into shot. Only alongside — you cannot found a foundry at sea. */
  craft(p, kind, clientId) {
    if (!p) return;
    const recipe = AMMO[kind];
    if (!recipe || !recipe.cost) return;
    if (!dockedAt(p.ship)) {
      return this.tx.send(clientId, 'trade', { ok: false, why: 'Craft alongside an island' });
    }
    const have = p.profile.res || (p.profile.res = {});
    for (const [k, n] of Object.entries(recipe.cost)) {
      if ((have[k] || 0) < n) {
        return this.tx.send(clientId, 'trade',
          { ok: false, why: `Need ${n} ${RESOURCES[k].name.toLowerCase()}` });
      }
    }
    for (const [k, n] of Object.entries(recipe.cost)) have[k] -= n;
    p.profile.ammo = p.profile.ammo || {};
    p.profile.ammo[kind] = (p.profile.ammo[kind] || 0) + CRAFT_BATCH;
    this.profiles.dirty = true;
    this.tx.send(clientId, 'trade',
      { ok: true, why: `${CRAFT_BATCH} ${recipe.name.toLowerCase()} in the locker` });
  }

  sellCargo(p, clientId) {
    if (!p) return;
    const isle = dockedAt(p.ship);
    if (!isle || !isle.haven) {
      return this.tx.send(clientId, 'trade', { ok: false, why: 'Not alongside a Safe Haven' });
    }
    if (p.ship.cargo <= 0) {
      return this.tx.send(clientId, 'trade', { ok: false, why: 'The hold is empty' });
    }
    const coins = p.ship.cargo * TRADE.coinsPerCargo;
    p.profile.coins = (p.profile.coins || 0) + coins;
    this.profiles.dirty = true;
    this.log(`[$] ${p.name} sold ${p.ship.cargo} cargo at ${isle.name} for ${coins} coins`);
    p.ship.cargo = 0;
    this.tx.send(clientId, 'trade', {
      ok: true, why: `Sold at ${isle.name} for ${coins} coins`, coins: p.profile.coins,
    });
  }

  buyShip(p, clientId) {
    if (!p) return;
    const isle = dockedAt(p.ship);
    if (!isle || !isle.haven) {
      return this.tx.send(clientId, 'trade', { ok: false, why: 'Ships are traded at Safe Havens' });
    }
    const next = nextClass(p.ship.cls);
    if (!next) return this.tx.send(clientId, 'trade', { ok: false, why: 'Nothing bigger afloat' });
    const cost = classOf(next).cost;
    if ((p.profile.coins || 0) < cost) {
      return this.tx.send(clientId, 'trade', { ok: false, why: `${cost} coins needed` });
    }
    p.profile.coins -= cost;
    p.profile.cls = next;
    this.profiles.dirty = true;

    const stats = statsFor(p.ship.picks, next);
    p.ship.cls = next;
    p.ship.maxHp = stats.maxHp;
    p.ship.hp = stats.maxHp;
    p.ship.cargo = Math.min(p.ship.cargo, classOf(next).cargo);
    this.log(`[$] ${p.name} took command of a ${classOf(next).name}`);
    this.tx.broadcast('newship', { id: p.ship.id, name: p.name, cls: next });
    this.tx.send(clientId, 'trade', {
      ok: true, why: `She's yours — a ${classOf(next).name}`, coins: p.profile.coins,
    });
  }

  /** Crowns buy armour, and only while you are alongside your own base. */
  buyArmour(p, clientId) {
    if (!p) return;
    const isle = dockedAt(p.ship);
    if (!isle || isle.id !== p.ship.home) {
      return this.tx.send(clientId, 'trade', { ok: false, why: 'Only at your home base' });
    }
    const rank = Math.round((p.profile.armour || 0) / 0.06);
    if (rank >= 8) return this.tx.send(clientId, 'trade', { ok: false, why: 'Fully plated' });
    const cost = 120 + rank * 90;
    if ((p.profile.crowns || 0) < cost) {
      return this.tx.send(clientId, 'trade', { ok: false, why: `${cost} crowns needed` });
    }
    p.profile.crowns -= cost;
    p.profile.armour = (rank + 1) * 0.06;
    p.ship.armour = p.profile.armour;
    this.profiles.dirty = true;
    this.tx.send(clientId, 'trade', {
      ok: true, why: `Armour ${rank + 1}/8 — ${Math.round(p.ship.armour * 100)}% off every hit`,
    });
    this.tx.send(clientId, 'profile', { ...p.profile, result: 'ok' });
  }

  // ------------------------------------------------------------------ weather
  /** Weather now only decides how big the sea is, never how fast you go. */
  updateWeather(dt) {
    const w = this.weather;
    if (Math.random() < dt * 0.045) {
      w.target = Math.random() < 0.18 ? 17 + Math.random() * 9 : 5 + Math.random() * 9;
    }
    w.rough += (w.target - w.rough) * 0.16 * dt;
    SEA.scale += (seaStateFor(w.rough) - SEA.scale) * 0.05 * dt; // swell lags by minutes
  }

  updateTsunami(t) {
    const ts = SEA.tsunami;
    if (ts) {
      if ((t - ts.t0) * ts.speed > WORLD.radius + 900) {
        SEA.tsunami = null;
        this.nextTsunami = t + 240 + Math.random() * 360;
        this.tx.broadcast('tsunami', null);
      }
      return;
    }
    if (t < this.nextTsunami || this.players.size === 0) return;
    this.spawnTsunami(t);
  }

  /**
   * One rogue wave, broadcast the moment it starts its run from off the edge of
   * the chart. The Gaussian is flat that far out so nothing pops into view, and
   * each client counts down its own arrival.
   */
  spawnTsunami(t, opts = {}) {
    const bearing = Math.random() * Math.PI * 2;
    const speed = opts.speed ?? 30 + Math.random() * 10;
    const amp = opts.amp ?? 6 + Math.random() * 6;
    // Width follows height. A hundred-metre crest packed into a seventy-metre
    // front is a vertical cliff, and the surge off that face would fling ships
    // across the map — so a bigger wave is also a longer one.
    const width = opts.width ?? Math.min(Math.max(amp * 8, 55), 900);
    SEA.tsunami = {
      dx: Math.sin(bearing),
      dz: Math.cos(bearing),
      t0: t + (opts.lead ?? (WORLD.radius + 800) / speed),
      speed,
      amp,
      width,
    };
    this.tx.broadcast('tsunami', SEA.tsunami);
    this.log(`[~] TSUNAMI on bearing ${((bearing * 180) / Math.PI).toFixed(0)}°, ` +
      `${SEA.tsunami.amp.toFixed(1)} m crest`);
  }

  // ------------------------------------------------------------------- crowns
  payCrowns() {
    const t = this.now();
    const ts = SEA.tsunami;

    for (const [id, p] of this.players) {
      const s = p.ship;
      const before = Math.floor(p.profile.crowns);

      p.metres += Math.hypot(s.x - p.lastX, s.z - p.lastZ);
      p.lastX = s.x;
      p.lastZ = s.z;
      if (p.metres > 0) {
        p.profile.crowns += p.metres * CROWNS.perMetre;
        p.metres = 0;
        this.profiles.dirty = true;
      }

      // Riding it out: the crest is within half its own width of the hull.
      if (ts && p.rodeWave !== ts.t0) {
        const lift = tsunamiAt(s.x, s.z, t, ts);
        if (lift > ts.amp * 0.55) {
          p.rodeWave = ts.t0;
          p.profile.crowns += CROWNS.rogueWave;
          this.profiles.dirty = true;
          this.tx.send(id, 'earned', { amount: CROWNS.rogueWave, why: 'rode out a rogue wave' });
        }
      }

      if (Math.floor(p.profile.crowns) !== before) {
        this.tx.send(id, 'profile', { ...p.profile, result: 'ok' });
      }
    }
  }

  // ----------------------------------------------------------------- snapshot
  snapshot() {
    const ships = [];
    const rows = [...[...this.players.values()].map((p) => ({ s: p.ship, seq: p.input.seq })),
                  ...[...this.npcs.values()].map((n) => ({ s: n.ship, seq: 0 }))];
    for (const row of rows) {
      const s = row.s;
      ships.push({
        id: s.id, n: s.name,
        x: +s.x.toFixed(3), z: +s.z.toFixed(3), h: +s.heading.toFixed(4),
        vx: +s.vx.toFixed(3), vz: +s.vz.toFixed(3), om: +s.omega.toFixed(4),
        tr: s.trail, hp: Math.round(s.hp), mhp: s.maxHp, lv: s.level,
        c: s.cls, th: +s.throttle.toFixed(2),
        g: Object.values(gunsFor(s.picks, s.cls)),
        sk: s.sunk ? 1 : 0,
        ai: s.ai ? 1 : 0,
        fac: s.faction || null,
        seq: row.seq | 0,
      });
    }
    return {
      t: this.now(),
      sea: +SEA.scale.toFixed(3),
      drops: this.cargoDrops,
      ts: SEA.tsunami,
      kraken: this.kraken ? this.kraken.wire() : null,
      ships,
    };
  }

  // --------------------------------------------------------------------- tick
  /** Feed this the wall-clock delta; it runs the fixed steps and the snapshots. */
  tick(frame) {
    if (frame > 0.25) frame = 0.25; // a stalled process must not fast-forward the world
    this.acc += frame;

    while (this.acc >= TICK_DT) {
      this.updateWeather(TICK_DT);
      const t = this.now();
      for (const p of this.players.values()) {
        stepShip(p.ship, p.input, TICK_DT, t);
        this.keepOffTheRocks(p.ship);
      }
      this.acc -= TICK_DT;
    }

    this.stepNpcs(Math.min(frame, 0.1), this.now());
    this.stepKraken(Math.min(frame, 0.1), this.now());
    this.combat.step(Math.min(frame, 0.1));
    this.combat.respawn(() => this.nextSpawnAngle());
    this.collectCargo();
    this.updateTsunami(this.now());
    this.payCrowns();
    for (const p of this.players.values()) {
      const isle = dockedAt(p.ship);
      p.ship.docked = isle ? { id: isle.id, name: isle.name, haven: isle.haven } : null;

      // Inside the white ring the carpenters get to work.
      const s = p.ship;
      s.safe = !s.sunk && !!inSafeWater(s.x, s.z);
      if (s.safe && s.hp < s.maxHp) {
        s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.09 * frame);
      }
    }

    this.sinceSnapshot += frame;
    if (this.sinceSnapshot >= 1 / SNAPSHOT_HZ) {
      this.sinceSnapshot = 0;
      if (this.players.size) this.broadcastState();
    }
  }

  broadcastState() {
    this.tx.broadcast('state', this.snapshot());
    // Private bits only the owner needs — reload timers, XP, barrels, points.
    for (const [id, p] of this.players) {
      const s = p.ship;
      this.saveProgress(p);
      this.tx.send(id, 'you', {
        hp: s.hp, maxHp: s.maxHp, xp: s.xp, level: s.level,
        picks: s.picks, barrels: s.barrels, ammo: s.ammo, sunk: s.sunk,
        free: pointsFree(s.level, s.picks), guns: gunsFor(s.picks, s.cls),
        offer: s.offer,
        reload: s.reload, armour: s.armour,
        cls: s.cls, cargo: s.cargo, cargoCap: classOf(s.cls).cargo, safe: s.safe,
        coins: Math.floor(p.profile.coins || 0),
        docked: s.docked, throttle: s.throttle,
        res: p.profile.res || {}, ammoStock: p.profile.ammo || {},
        armourSet: p.profile.armourSet || null,
        consorts: (p.fleet || []).length,
      });
    }
  }
}

/** Stable per-name hash so your home island never moves between sessions. */
function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}
