// Proves the split worked: run the whole authoritative game with NO server,
// NO sockets and NO browser — just GameHost, a transport that records messages,
// and an in-memory profile store. If this passes, the same simulation can be
// hosted from a browser tab over WebRTC data channels.
import { GameHost } from '../shared/game-host.js';
import { NullTransport, MemoryProfiles } from '../shared/transport.js';
import { TICK_HZ, classOf } from '../shared/physics.js';
import { HAVENS, BASES, TRADE } from '../shared/world.js';

let clock = 0;
const tx = new NullTransport();
const host = new GameHost({
  transport: tx,
  profiles: new MemoryProfiles(),
  now: () => clock,
  dev: true,
  log: () => {},
});

const sent = (to, event) => tx.sent.filter((m) => m.to === to && m.event === event);
const last = (to, event) => sent(to, event).at(-1)?.data;

// --- two players join a world that has never seen a socket ------------------
host.join('alice', { name: 'Alice' });
host.join('bob', { name: 'Bob' });
console.log(`joined: ${host.players.size} players; alice got init: ${!!last('alice', 'init')}`);

// --- run a minute of game time at the real tick rate ------------------------
const dt = 1 / TICK_HZ;
for (let i = 0; i < TICK_HZ * 60; i++) {
  clock += dt;
  host.tick(dt);
}

const a = host.players.get('alice').ship;
console.log(`after 60 s: alice at (${a.x.toFixed(0)}, ${a.z.toFixed(0)}) ` +
  `doing ${(a.speed * 1.94384).toFixed(1)} kn, hull ${a.hp}/${a.maxHp}`);
// Top speed: full throttle in a straight line.
host.message('alice', 'input', { r: 0, t: 1 });
for (let i = 0; i < TICK_HZ * 25; i++) { clock += dt; host.tick(dt); }
console.log(`flat out in a ${classOf(a.cls).name}: ${(a.speed * 1.94384).toFixed(1)} kn ` +
  `(class top ${(classOf(a.cls).maxSpeed * 1.94384).toFixed(0)} kn)`);
console.log(`state broadcasts: ${sent('*', 'state').length} (expect ~900 at 15 Hz)`);
console.log(`crowns earned by sailing: ${Math.floor(host.players.get('alice').profile.crowns)}`);

// --- combat with no network ------------------------------------------------
Object.assign(host.players.get('alice').ship, { x: 0, z: 0, heading: 0, vx: 0, vz: 0 });
Object.assign(host.players.get('bob').ship, { x: 26, z: 0, heading: 0, vx: 0, vz: 0 });
const bobBefore = host.players.get('bob').ship.hp;

for (let volley = 0; volley < 12; volley++) {
  host.message('alice', 'fire', 'port');
  for (let i = 0; i < TICK_HZ * 5; i++) { clock += dt; host.tick(dt); }
  Object.assign(host.players.get('alice').ship, { x: 0, z: 0, heading: 0, vx: 0, vz: 0 });
  if (!host.players.get('bob').ship.sunk) {
    Object.assign(host.players.get('bob').ship, { x: 26, z: 0, heading: 0, vx: 0, vz: 0 });
  }
}
console.log(`bob's hull ${bobBefore} -> ${Math.round(host.players.get('bob').ship.hp)}; ` +
  `sunk events: ${sent('*', 'sunk').length}`);
console.log(`alice level: ${host.players.get('alice').ship.level} ` +
  `(gained XP from hits, with no server involved)`);

// --- mouse aiming ----------------------------------------------------------
// Fire at a bearing and range; the ball should land near where it was aimed,
// the host should pick the battery, and locked or out-of-arc shots do nothing.
const alice = host.players.get('alice');
Object.assign(alice.ship, { x: 0, z: 0, heading: 0, vx: 0, vz: 0, hp: 100, sunk: false });
alice.ship.reload = { port: 0, starboard: 0, bow: 0, stern: 0 };
host.players.get('bob').ship.sunk = true; // keep him out of the way

function shootAndLand(bearing, range) {
  const shotsBefore = tx.sent.filter((m) => m.event === 'shot').length;
  host.combat.shots.length = 0;
  alice.ship.reload = { port: 0, starboard: 0, bow: 0, stern: 0 };
  host.message('alice', 'fire', { b: bearing, r: range });
  if (tx.sent.filter((m) => m.event === 'shot').length === shotsBefore) return null;
  const ball = host.combat.shots[0];
  const start = { x: ball.x, z: ball.z };
  // Fly it until it reaches the water.
  for (let i = 0; i < 400 && ball.y > 0; i++) { clock += dt; host.tick(dt); }
  return Math.hypot(start.x - 0, start.z - 0) + 0; // (start offset only)
}

const aimed = [];
for (const r of [40, 90, 150]) {
  host.combat.shots.length = 0;
  alice.ship.reload = { port: 0, starboard: 0, bow: 0, stern: 0 };
  Object.assign(alice.ship, { x: 0, z: 0, heading: 0, vx: 0, vz: 0 });
  host.message('alice', 'fire', { b: Math.PI / 2, r });     // straight out to port
  const ball = host.combat.shots[0];
  if (!ball) { aimed.push(`${r}m -> no shot`); continue; }
  let steps = 0;
  while (ball.y > 0 && steps++ < 600) { ball.age = 0; stepBall(ball, dt); }
  aimed.push(`aimed ${r}m -> landed ${Math.hypot(ball.x, ball.z).toFixed(0)}m`);
}
function stepBall(s, d) {
  const v = Math.hypot(s.vx, s.vy, s.vz);
  const k = 0.0016 * v;
  s.vx -= s.vx * k * d; s.vy -= (s.vy * k + 9.81) * d; s.vz -= s.vz * k * d;
  s.x += s.vx * d; s.y += s.vy * d; s.z += s.vz * d;
}
console.log(aimed.join('; '));

// The host picks the gun: a bearing to port must not fire the starboard guns.
host.combat.shots.length = 0;
alice.ship.reload = { port: 0, starboard: 0, bow: 0, stern: 0 };
host.message('alice', 'fire', { b: Math.PI / 2, r: 80 });
console.log(`bearing to port fired the: ${sent('*', 'shot').at(-1).data.battery} battery`);

// Dead ahead is the bow chaser's arc, which alice has not bought.
const before = sent('*', 'shot').length;
alice.ship.reload = { port: 0, starboard: 0, bow: 0, stern: 0 };
host.message('alice', 'fire', { b: 0, r: 80 });
console.log(`firing dead ahead with no bow chaser: ` +
  `${sent('*', 'shot').length === before ? 'nothing happened (correct)' : 'FIRED (wrong)'}`);

// --- Phase 3: cargo, havens, ship classes ----------------------------------
const haven = HAVENS[0];
const al = host.players.get('alice');

// Sinking bob should have spilled cargo into the water.
console.log(`cargo floating after the sinking: ${host.cargoDrops.length}`);

// Park alice on top of the crates and let her scoop them up.
const drop = host.cargoDrops[0];
if (drop) {
  for (let i = 0; i < 40 && host.cargoDrops.length; i++) {
    const d = host.cargoDrops[0];
    Object.assign(al.ship, { x: d.x, z: d.z, vx: 0, vz: 0 });
    clock += dt; host.tick(dt);
  }
}
console.log(`alice hold: ${al.ship.cargo}/${classOf(al.ship.cls).cargo}`);

// Selling only works alongside a Safe Haven, and only with something to sell.
Object.assign(al.ship, { x: 0, z: 0, vx: 0, vz: 0, speed: 0 });
host.message('alice', 'sell-cargo');
console.log(`selling at sea: "${last('alice', 'trade')?.why}"`);

Object.assign(al.ship, { x: haven.x + haven.radius + 20, z: haven.z, vx: 0, vz: 0, speed: 0 });
al.ship.docked = null;
clock += dt; host.tick(dt);
console.log(`docked at: ${al.ship.docked?.name ?? 'nowhere'} (haven: ${al.ship.docked?.haven})`);
host.message('alice', 'sell-cargo');
console.log(`selling alongside: "${last('alice', 'trade')?.why}"`);

// Ship classes: too poor, then rich enough.
host.message('alice', 'buy-ship');
console.log(`buying a ship while poor: "${last('alice', 'trade')?.why}"`);
al.profile.coins = 5000;
host.message('alice', 'buy-ship');
console.log(`buying with coin: "${last('alice', 'trade')?.why}" -> now a ${classOf(al.ship.cls).name} ` +
  `(hull ${al.ship.maxHp}, hold ${classOf(al.ship.cls).cargo})`);

// Armour is Crowns, and only at your own base.
host.message('alice', 'buy-armour');
console.log(`armour at a haven: "${last('alice', 'trade')?.why}"`);
const home = BASES.find((b) => b.id === al.ship.home);
Object.assign(al.ship, { x: home.x + home.radius + 20, z: home.z, vx: 0, vz: 0, speed: 0 });
clock += dt; host.tick(dt);
al.profile.crowns = 900;
host.message('alice', 'buy-armour');
console.log(`armour at home: "${last('alice', 'trade')?.why}"`);

// Islands are solid.
Object.assign(al.ship, { x: home.x, z: home.z, vx: 12, vz: 0 });
clock += dt; host.tick(dt);
const clearOf = Math.hypot(al.ship.x - home.x, al.ship.z - home.z) - home.radius;
console.log(`driven into ${home.name}: pushed back to ${clearOf.toFixed(1)} m clear of the beach`);

// --- talents ---------------------------------------------------------------
host.message('alice', 'dev-xp', 3000);
host.message('alice', 'spend-talent', 'bowchaser');
host.message('alice', 'spend-talent', 'broadside');
const you = last('alice', 'you');
console.log(`alice guns after talents: ${JSON.stringify(last('alice', 'talents')?.picks)}`);

// --- leaving ---------------------------------------------------------------
host.leave('bob');
console.log(`after bob leaves: ${host.players.size} player(s), left broadcast: ` +
  `${sent('*', 'left').length}`);

const ok = host.players.size === 1 && sent('*', 'state').length > 500;
console.log(ok ? '\nOK — the game runs with no transport at all.' : '\nFAILED');
process.exit(ok ? 0 : 1);
