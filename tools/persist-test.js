// Does what you EARN survive coming back?
//
// Reported from play: "talent points and stuff don't save". They did not.
// join() rebuilt the ship with createShip and restored the hull, the armour and
// the trail from the profile — but XP, level and talent ranks lived only on the
// ship, so every reconnect handed you a level-1 sailboat's armament while your
// coins and your Man-of-War came back intact. A particularly confusing way to
// lose an evening.
//
//   node tools/persist-test.js

import { GameHost } from '../shared/game-host.js';
import { NullTransport, MemoryProfiles } from '../shared/transport.js';
import { TICK_HZ } from '../shared/physics.js';
import { gunsFor, pointsFree, pointsSpent, xpForLevel } from '../shared/combat.js';

const problems = [];
const profiles = new MemoryProfiles();     // stands in for the JSON file / localStorage
let clock = 0;
const dt = 1 / TICK_HZ;

const newHost = () => new GameHost({
  transport: new NullTransport(), profiles, now: () => clock, dev: true, log: () => {},
});
const run = (host, ticks) => { for (let i = 0; i < ticks; i++) { clock += dt; host.tick(dt); } };

// --- an evening's play ------------------------------------------------------
let host = newHost();
host.join('c1', { name: 'Rackham' });
let p = host.players.get('c1');

host.message('c1', 'dev-xp', xpForLevel(24));
host.message('c1', 'grant-coins', 20000);
run(host, 20);

// Spend some points for real, through the same path the talent cards use.
const spendable = ['broadside', 'broadside', 'broadside', 'gunnery', 'hull', 'bowchaser'];
for (const t of spendable) {
  // The host only accepts a pick that was actually on the table, so deal a hand
  // containing it. (An earlier version dealt broadside/gunnery/hull every time,
  // so the bowchaser was silently refused and its assertion compared 0 with 0.)
  p.ship.offer = { guns: t, crew: t, ship: t, fleet: t };
  host.message('c1', 'spend-talent', t);
  run(host, 2);
}
// And buy a hull, which was always saved — the contrast is the point.
host.message('c1', 'dev-class', 'frigate');
run(host, 20);

const before = {
  level: p.ship.level,
  xp: p.ship.xp,
  picks: { ...p.ship.picks },
  spent: pointsSpent(p.ship.picks),
  free: pointsFree(p.ship.level, p.ship.picks),
  guns: gunsFor(p.ship.picks, p.ship.cls),
  cls: p.ship.cls,
  coins: p.profile.coins,
};
console.log(`sailed to level ${before.level} (${before.xp} xp), spent ${before.spent} points ` +
  `-> ${before.guns.port} guns a side, bow ${before.guns.bow}, in a ${before.cls}`);
if (before.spent !== spendable.length) {
  problems.push(`only ${before.spent} of ${spendable.length} talent points were spent — ` +
    'the test is not exercising what it claims');
}
if (before.guns.bow !== 1) problems.push('the bow chaser was never bought, so its check is vacuous');

// --- close the tab ----------------------------------------------------------
host.leave('c1');
profiles.flush();
console.log('...left, and the host went away entirely.');

// --- come back, to a brand-new host with only the saved profile -------------
host = newHost();
host.join('c1', { name: 'Rackham' });
p = host.players.get('c1');
run(host, 20);

const after = {
  level: p.ship.level,
  xp: p.ship.xp,
  spent: pointsSpent(p.ship.picks),
  free: pointsFree(p.ship.level, p.ship.picks),
  guns: gunsFor(p.ship.picks, p.ship.cls),
  cls: p.ship.cls,
  coins: p.profile.coins,
  hp: p.ship.maxHp,
};
console.log(`came back at level ${after.level} (${after.xp} xp), ${after.spent} points spent ` +
  `-> ${after.guns.port} guns a side, bow ${after.guns.bow}, in a ${after.cls}`);

if (after.level !== before.level) problems.push(`level ${before.level} -> ${after.level}`);
if (after.xp !== before.xp) problems.push(`xp ${before.xp} -> ${after.xp}`);
if (after.spent !== before.spent) problems.push(`talent points spent ${before.spent} -> ${after.spent}`);
if (after.free !== before.free) problems.push(`free points ${before.free} -> ${after.free}`);
if (after.guns.port !== before.guns.port) {
  problems.push(`guns a side ${before.guns.port} -> ${after.guns.port}`);
}
if (after.guns.bow !== before.guns.bow) problems.push('the bow chaser was lost');
if (after.cls !== before.cls) problems.push(`hull ${before.cls} -> ${after.cls}`);
if (after.coins !== before.coins) problems.push(`coins ${before.coins} -> ${after.coins}`);
// The talents have to be reflected in the hull she comes back with, not just
// stored: Oak & Tar is worth nothing if maxHp is rebuilt from the bare class.
if (after.hp <= 350) problems.push(`hull ranks did not apply on rejoin (maxHp ${after.hp})`);
console.log(`hull ${after.hp} (a bare frigate is 350, so the Oak & Tar ranks came back)`);

// --- and a wipe must still wipe --------------------------------------------
host.message('c1', 'reset-profile');
run(host, 20);
const wiped = host.players.get('c1').ship;
console.log(`after cheat.reset(): level ${wiped.level}, ${pointsSpent(wiped.picks)} points spent, ` +
  `${gunsFor(wiped.picks, wiped.cls).port} guns a side, ${wiped.cls}`);
if (wiped.level !== 1 || pointsSpent(wiped.picks) !== 0) {
  problems.push('reset-profile left levels or talents behind');
}
// And it must STAY wiped across a rejoin, not come back from the profile.
host.leave('c1');
host = newHost();
host.join('c1', { name: 'Rackham' });
run(host, 10);
const stillWiped = host.players.get('c1').ship;
if (stillWiped.level !== 1 || pointsSpent(stillWiped.picks) !== 0) {
  problems.push('a wiped captain got their levels back on the next join');
}

console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const q of problems) console.log(`  - ${q}`);
  process.exit(1);
}
console.log('OK — levels, talents and the hull they buy all survive a reconnect.');
