// Is the early game survivable, and is the Kraken a fight rather than a wall?
//
// Reported from play: "I'm level 1 and I can't beat someone with 5 cannons",
// and "the Kraken does way too much damage, even a Leviathan gets sunk". Both
// were true, and both are the kind of thing that silently comes back the next
// time someone tunes a number — so they are measured here.
//
//   node tools/balance-test.js

import { fleetFor, bandFor, FACTIONS } from '../shared/ai.js';
import { gunsFor, xpForLevel, STARTING_GUNS } from '../shared/combat.js';
import { KRAKEN, Kraken } from '../shared/kraken.js';
import { classOf, SHIP_CLASSES } from '../shared/physics.js';

const problems = [];

// --- what a captain actually meets at each level ----------------------------
console.log('level   squadron            guns/side   crew');
for (const level of [1, 3, 6, 12, 20, 30, 45, 60]) {
  const worst = ['armada', 'dutch', 'pirate', 'treasure']
    .map((f) => ({ f, plan: fleetFor(level, f) }))
    // The hardest thing the band can produce, since that is what decides
    // whether the level is survivable.
    .sort((a, b) => b.plan.size - a.plan.size)[0];
  const { plan } = worst;
  const guns = gunsFor(plan.picks, plan.hulls[0]);
  console.log(`${String(level).padStart(5)}   ${String(plan.size).padStart(2)} x ` +
    `${plan.hulls[0].padEnd(12)} ${String(guns.port).padStart(7)}   ` +
    `skill ${plan.skill.toFixed(2)}`);

  if (level <= 2) {
    // A new captain has exactly one gun a side. Anything more than a like-for-
    // like fight is a wall, not a difficulty curve.
    if (guns.port > STARTING_GUNS.port) {
      problems.push(`level ${level}: AI has ${guns.port} guns a side vs the player's ${STARTING_GUNS.port}`);
    }
    if (plan.size > 1) problems.push(`level ${level}: ${plan.size} ships against a beginner`);
    if (plan.skill > 0.5) problems.push(`level ${level}: crews are too well worked up (${plan.skill.toFixed(2)})`);
  }
  // And the other end: it must still climb, or the ladder means nothing.
  if (level >= 45 && guns.port < 8) {
    problems.push(`level ${level}: AI is still only firing ${guns.port} a side`);
  }
}

// --- the Kraken: how long does she take to kill you, and you her? ------------
console.log('\nKraken, per hull — her bite, and how long she needs to sink you:');
console.log('hull          hull hp   bite   arms/min   seconds to sink you');
const perMinute = (60 / KRAKEN.armCooldown) * KRAKEN.arms * 0.45;   // ~45% land
for (const cls of Object.keys(SHIP_CLASSES)) {
  const c = classOf(cls);
  const bite = Math.min(KRAKEN.slamMax, Math.max(KRAKEN.slamMin, c.hp * KRAKEN.slamFrac));
  // Falloff averages out around 0.6 over the slam radius.
  const dps = (bite * 0.6 * perMinute) / 60;
  const ttk = c.hp / dps;
  console.log(`${cls.padEnd(12)} ${String(c.hp).padStart(7)}   ${bite.toFixed(0).padStart(4)}   ` +
    `${perMinute.toFixed(0).padStart(8)}   ${ttk.toFixed(0).padStart(10)} s`);
  // She should be genuinely dangerous but never delete a first rate in seconds.
  if (ttk < 25) problems.push(`${cls} is sunk by the Kraken in ${ttk.toFixed(0)}s — too fast`);
  if (ttk > 240) problems.push(`${cls} barely notices the Kraken (${ttk.toFixed(0)}s) — too slow`);
}

// --- and how much hull she brings ------------------------------------------
console.log('\nher own hull, by the level she surfaces beside:');
for (const level of [KRAKEN.minLevel, 20, 40, 60]) {
  const k = new Kraken(0, 0, 0, level);
  console.log(`  level ${String(level).padStart(2)}: ${k.maxHp} hull`);
  if (level === KRAKEN.minLevel && k.maxHp > 1200) {
    problems.push(`at level ${level} she brings ${k.maxHp} hull — unkillable that early`);
  }
}
if (KRAKEN.minLevel < 5) problems.push('she can surface under a near-beginner');

// --- the XP ladder ----------------------------------------------------------
console.log('\nXP: total to reach a level, and the step from the one below:');
let last = 0;
for (const level of [5, 10, 20, 30, 40, 50, 60]) {
  const total = xpForLevel(level);
  const step = total - xpForLevel(level - 1);
  console.log(`  level ${String(level).padStart(2)}: ${String(total).padStart(6)} total, ` +
    `${String(step).padStart(4)} for the last one`);
  if (step < last) problems.push(`level ${level} costs less than the level below it`);
  last = step;
  // A kill is 120 XP plus damage. A level should never need more than a
  // handful of good fights, or the ladder stops moving near the top.
  if (step > 900) problems.push(`level ${level} needs ${step} XP for one level — too steep`);
}

console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK — a beginner meets a fair fight, and the Kraken is a fight, not a wall.');
