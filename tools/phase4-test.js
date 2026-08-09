// Phase 4 with no browser: do the AI captains actually fight like captains?
import { GameHost } from '../shared/game-host.js';
import { NullTransport, MemoryProfiles } from '../shared/transport.js';
import { TICK_HZ, classOf, normalizeAngle } from '../shared/physics.js';
import { FACTIONS } from '../shared/ai.js';
import { KRAKEN } from '../shared/kraken.js';

let clock = 0;
const dt = 1 / TICK_HZ;
const tx = new NullTransport();
const host = new GameHost({ transport: tx, profiles: new MemoryProfiles(),
  now: () => clock, dev: true, log: () => {} });
const sent = (ev) => tx.sent.filter((m) => m.event === ev);
const run = (secs) => { for (let i = 0; i < TICK_HZ * secs; i++) { clock += dt; host.tick(dt); } };

host.join('p1', { name: 'Player' });
// Respawning REPLACES the ship object, so never hold a stale reference.
const P = () => host.players.get('p1').ship;
let me = P();
me.picks = { broadside: 40, hull: 8 };
const resync = () => { me = P(); me.picks = { broadside: 40, hull: 8 }; };
const hold = () => { me.vx = 0; me.vz = 0; me.throttle = 0; me.omega = 0; };
// The AI is lethal enough to kill her in one broadside, and every later check
// needs a live hull, so patch her up between sections.
const revive = () => {
  resync();
  me.sunk = false; me.hp = me.maxHp; me.burning = 0; me.rigged = 0;
  me.reload = { port: 0, starboard: 0, bow: 0, stern: 0 };
};

// --- fleets turn up on their own -------------------------------------------
host.message('p1', 'dev-fleet', 'armada');
host.message('p1', 'dev-fleet', 'dutch');
run(40);
console.log(`fleets sighted: ${sent('fleet').length}, hulls afloat: ${host.npcs.size}`);
const byFaction = {};
for (const n of host.npcs.values()) byFaction[n.ship.faction] = (byFaction[n.ship.faction] || 0) + 1;
console.log('factions at sea:', JSON.stringify(byFaction));

// --- do they keep station? --------------------------------------------------
const fleet = [...host.npcs.values()].filter((n) => n.captain.leader);
if (fleet.length) {
  const gaps = fleet.map((n) => Math.hypot(n.ship.x - n.captain.leader.x, n.ship.z - n.captain.leader.z));
  console.log(`consorts holding station ${gaps.map((g) => g.toFixed(0)).join(', ')} m off the flag`);
}

// --- put a player in front of one ship and watch the tactics ---------------
// Keep exactly one AI on the chart: fleets otherwise fight each other, which is
// good to see in play but makes a measurement meaningless.
const enemy = [...host.npcs.values()].find((n) => n.ship.faction !== 'treasure');
for (const [id, n] of host.npcs) if (n !== enemy) host.npcs.delete(id);
if (enemy) { enemy.captain.leader = null; enemy.ship.hp = enemy.ship.maxHp; }
host.nextFleet = clock + 9999;
if (enemy) {
  // Fight in open water: inside a Safe Haven ring nobody may fire, and the AI
  // now correctly refuses to chase anyone in there.
  const wOpen = await import('../shared/world.js');
  let fx = 0;
  let fz = 0;
  for (let a = 0; a < 64; a++) {
    fx = Math.cos(a) * 1700;
    fz = Math.sin(a) * 1700;
    if (!wOpen.inSafeWater(fx, fz) && wOpen.landClearance(fx, fz) > 250) break;
  }
  Object.assign(enemy.ship, { x: fx, z: fz, vx: 0, vz: 0 });
  Object.assign(me, { x: fx + 130, z: fz, heading: 0, hp: me.maxHp });
  const anchor = { x: me.x, z: me.z };
  const before = me.hp;
  let beamCount = 0, samples = 0, minRange = 1e9, maxRange = 0;
  for (let i = 0; i < TICK_HZ * 45; i++) {
    clock += dt; host.tick(dt);
    hold(); me.x = anchor.x; me.z = anchor.z;      // a fixed mark to shoot at
    if (me.hp < me.maxHp * 0.35) revive();          // keep her alive to observe
    if (i % 15 === 0 && !enemy.ship.sunk) {
      const e = enemy.ship;
      const d = Math.hypot(me.x - e.x, me.z - e.z);
      const rel = Math.abs(normalizeAngle(Math.atan2(me.x - e.x, me.z - e.z) - e.heading));
      // Beam-on means the target is 90 degrees off her bow.
      if (Math.abs(rel - Math.PI / 2) < 0.6) beamCount++;
      samples++;
      minRange = Math.min(minRange, d);
      maxRange = Math.max(maxRange, d);
      // (held still above so she is a fixed mark for the AI)
    }
  }
  console.log(`AI held the enemy on her beam ${Math.round(100 * beamCount / samples)}% of the time`);
  console.log(`AI kept the range between ${minRange.toFixed(0)} and ${maxRange.toFixed(0)} m ` +
    `(she never rammed: ${minRange > 30 ? 'yes' : 'NO'})`);
  console.log(`player hull ${before} -> ${Math.round(me.hp)} — the AI can actually shoot`);
  console.log(`shots fired by AI: ${sent('shot').filter((m) => String(m.data.by).startsWith('ai')).length}`);
  const w1 = await import('../shared/world.js');
  const c = await import('../shared/combat.js');
  const e = enemy.ship;
  const d = Math.hypot(me.x - e.x, me.z - e.z);
  const rel = normalizeAngle(Math.atan2(me.x - e.x, me.z - e.z) - e.heading);
  console.log(`  why: state=${enemy.captain.state} range=${d.toFixed(0)} ` +
    `rel=${(rel * 180 / Math.PI).toFixed(0)}deg guns=${JSON.stringify(c.gunsFor(e.picks, e.cls))} ` +
    `reload=${JSON.stringify(e.reload)} cd=${enemy.captain.fireCooldown.toFixed(2)} ` +
    `aiSafe=${!!w1.inSafeWater(e.x, e.z)} meSafe=${!!w1.inSafeWater(me.x, me.z)} sunk=${e.sunk}`);
}

// --- does a beaten AI run? --------------------------------------------------
revive();
const runner = [...host.npcs.values()].find((n) => !n.ship.sunk);
if (runner) {
  runner.ship.hp = runner.ship.maxHp * 0.15;
  Object.assign(me, { x: runner.ship.x + 90, z: runner.ship.z, vx: 0, vz: 0 });
  const d0 = Math.hypot(runner.ship.x - me.x, runner.ship.z - me.z);
  for (let i = 0; i < TICK_HZ * 14; i++) { hold(); clock += dt; host.tick(dt); }
  const d1 = Math.hypot(runner.ship.x - me.x, runner.ship.z - me.z);
  console.log(`crippled AI: ${d0.toFixed(0)} m -> ${d1.toFixed(0)} m ` +
    `(${d1 > d0 ? 'she ran for it' : 'STOOD AND FOUGHT'}), state=${runner.captain.state}`);
}

// --- the Kraken -------------------------------------------------------------
revive();
host.nextKraken = clock;
run(2);
console.log(`kraken surfaced: ${!!host.kraken}, arms ${host.kraken?.arms.length}`);
if (host.kraken) {
  for (const [id] of host.npcs) host.npcs.delete(id);    // she should chase the player
  Object.assign(me, { x: host.kraken.x + 20, z: host.kraken.z, hp: me.maxHp });
  const hp0 = me.hp;
  let slams = 0;
  const seen = new Set();
  // Hold her under the arms — otherwise she simply sails out of reach.
  for (let i = 0; i < TICK_HZ * 20; i++) {
    hold(); clock += dt; host.tick(dt);
    for (const a of host.kraken.arms) { seen.add(a.state); if (a.state === 'slam') slams++; }
  }
  const w0 = await import('../shared/world.js');
  console.log(`  arm states seen: ${[...seen].join(',')} | slam ticks ${slams} | ` +
    `player sunk=${me.sunk} | in safe water=${!!w0.inSafeWater(me.x, me.z)} | ` +
    `range to kraken ${Math.hypot(me.x - host.kraken.x, me.z - host.kraken.z).toFixed(0)}m`);
  console.log(`arms landed on the player: hull ${Math.round(hp0)} -> ${Math.round(me.hp)}`);
  const before = host.kraken.hp;
  host.kraken.damage(9999);
  run(1);
  console.log(`kraken killed -> salvage floating: ${host.cargoDrops.filter((d) => d.res).length} crates`);
}

// --- salvage, crafting and ammo --------------------------------------------
revive();
const prof = host.players.get('p1').profile;
prof.res = { iron: 9, powder: 9, sulphur: 9, timber: 9 };
host.players.get('p1').ship.speed = 0;
const w = await import('../shared/world.js');
const hx = w.HAVENS[0].x + w.HAVENS[0].radius + 20;
const hz = w.HAVENS[0].z;
Object.assign(me, { x: hx, z: hz, vx: 0, vz: 0 });
for (let i = 0; i < 6; i++) { hold(); me.x = hx; me.z = hz; clock += dt; host.tick(dt); }
console.log(`  docked at: ${me.docked?.name ?? 'nowhere'} ` +
  `(${(Math.hypot(me.x - w.HAVENS[0].x, me.z - w.HAVENS[0].z) - w.HAVENS[0].radius).toFixed(0)} m off the beach)`);
for (const kind of ['chain', 'grape', 'heated', 'explosive']) {
  host.message('p1', 'craft', kind);
}
console.log(`  last trade reply: ${tx.sent.filter(m=>m.event==='trade').at(-1)?.data.why}`);
console.log('crafted:', JSON.stringify(prof.ammo), '| salvage left:', JSON.stringify(prof.res));
host.message('p1', 'set-ammo', 'explosive');
console.log(`ammo selected: ${me.ammo}`);
host.message('p1', 'set-ammo', 'heated');
console.log(`switched to: ${me.ammo}`);

console.log('\nOK — Phase 4 runs with no server, no sockets and no browser.');

// --- opposition should match the captain it turns up for --------------------
console.log('\nlevel-matched spawning:');
for (const lvl of [1, 8, 22, 48]) {
  for (const [id] of host.npcs) host.npcs.delete(id);
  const me2 = P();
  me2.level = lvl;
  me2.xp = 0;
  host.message('p1', 'dev-fleet', 'armada');
  host.message('p1', 'dev-fleet', 'treasure');
  const hulls = [...host.npcs.values()].map((n) => n.ship.cls);
  const crew = [...host.npcs.values()][0]?.ship.picks;
  const dists = [...host.npcs.values()]
    .map((n) => Math.hypot(n.ship.x - me2.x, n.ship.z - me2.z));
  console.log(`  a level-${String(lvl).padStart(2)} captain meets: ${hulls.join(', ')}`);
  console.log(`     crews: gunnery ${crew?.gunnery} reload ${crew?.reload} hull ${crew?.hull} | ` +
    `sighted ${Math.min(...dists).toFixed(0)}-${Math.max(...dists).toFixed(0)} m away`);
}

// --- fleet command ----------------------------------------------------------
console.log('\nfleet command:');
for (const [id] of host.npcs) host.npcs.delete(id);
host.nextFleet = clock + 9999;
const adm = host.players.get('p1');
adm.ship.level = 39;
adm.ship.offer = (await import('../shared/combat.js')).rollOffer({}, adm.ship.cls, Math.random, 39);
console.log(`  at level 39 the sections are: ${Object.keys(adm.ship.offer).join(', ')}`);
adm.ship.level = 44;
adm.ship.offer = (await import('../shared/combat.js')).rollOffer({}, adm.ship.cls, Math.random, 44);
console.log(`  at level 44 the sections are: ${Object.keys(adm.ship.offer).join(', ')}`);

adm.ship.picks = { fleetsize: 4, fleetyard: 2, fleetguns: 2, fleethull: 3, fleetgunnery: 4 };
for (let i = 0; i < 40; i++) { clock += 1; host.tick(1); }
const squadron = (adm.fleet || []).map((c) => host.npcs.get(c)).filter(Boolean);
console.log(`  consorts raised: ${squadron.length}/4 — ${[...new Set(squadron.map((c) => c.ship.cls))].join(', ')}`);
console.log(`  each: hull ${squadron[0]?.ship.maxHp}, guns/side ` +
  `${(await import('../shared/combat.js')).gunsFor(squadron[0]?.ship.picks, squadron[0]?.ship.cls).port}`);
console.log(`  station keeping: ${squadron.map((c) =>
  Math.hypot(c.ship.x - adm.ship.x, c.ship.z - adm.ship.z).toFixed(0)).join(', ')} m off the flag`);

// caps
adm.ship.picks = { fleetsize: 40, fleetyard: 40 };
for (let i = 0; i < 130; i++) { clock += 1; host.tick(1); }
const big = (adm.fleet || []).map((c) => host.npcs.get(c)).filter(Boolean);
console.log(`  asked for 40 consorts of the biggest hull -> got ${big.length} x ${big[0]?.ship.cls}`);

// friendly fire
const c0 = big[0].ship;
Object.assign(c0, { x: adm.ship.x + 40, z: adm.ship.z, vx: 0, vz: 0 });
const hp0 = c0.hp;
adm.ship.reload = { port: 0, starboard: 0, bow: 0, stern: 0 };
host.message('p1', 'fire', { b: Math.PI / 2, r: 40 });
for (let i = 0; i < TICK_HZ * 3; i++) { clock += dt; host.tick(dt); }
console.log(`  fired into her own consort: ${hp0} -> ${Math.round(c0.hp)} ` +
  `(${c0.hp === hp0 ? 'no friendly fire' : 'FRIENDLY FIRE'})`);
