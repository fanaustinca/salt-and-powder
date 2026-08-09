// Is the hull actually solid, and does it face outwards?
//
// The lofted hull shipped inside-out: the material is FrontSide, so every face
// wound the wrong way is simply not drawn and you look straight through her
// side. That is invisible in a wireframe, invisible in the vertex counts, and
// obvious only if you happen to look at the right ship from the right angle.
//
// So check the geometry itself. For a closed hull, every triangle's normal
// should point away from the centreline — outboard on both sides, down under
// the keel. A face pointing inboard is a hole.
//
//   node tools/hull-test.js

import { RIGS, rigOf, hullHalfAt, deckHeight, keelDepth, gunPlacements } from '../shared/rig.js';

// A tiny stand-in for what ship.js builds, so this needs no browser. It must
// stay in step with hullGeometry() — same rings, same winding.
function loft(rig) {
  const N = 56;
  const M = 12;
  const RING = 2 * M + 1;
  const deck = deckHeight(rig);
  const keel = keelDepth(rig);
  const pos = [];
  const idx = [];
  const yAt = (j) => deck + (-keel - deck) * (j / M);
  for (let i = 0; i <= N; i++) {
    const t = 1 - (i / N) * 2;
    const z = t * (rig.L / 2);
    for (let r = 0; r < RING; r++) {
      const j = r <= M ? r : 2 * M - r;
      const y = yAt(j);
      const hw = j === M ? 0 : hullHalfAt(rig, t, y);
      pos.push(r <= M ? hw : -hw, y, z);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let r = 0; r < RING - 1; r++) {
      const a = i * RING + r;
      const b = a + RING;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return { pos, idx, RING, N };
}

const V = (pos, i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

const problems = [];
console.log('class         faces   inward   worst gun clearance   beam @ deck / @ water');

for (const cls of Object.keys(RIGS)) {
  const rig = rigOf(cls);
  const { pos, idx } = loft(rig);

  let inward = 0;
  let faces = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const p0 = V(pos, idx[f]);
    const p1 = V(pos, idx[f + 1]);
    const p2 = V(pos, idx[f + 2]);
    const n = cross(sub(p1, p0), sub(p2, p0));
    if (len(n) < 1e-9) continue;              // a degenerate sliver at the keel
    faces++;
    // Outward = away from the centreline, at the height of the face.
    const mid = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, 0];
    const out = [mid[0], Math.min(0, mid[1] + keelDepth(rig)) - 0.0001, 0];
    // Sides: compare against the athwartships direction. Near the keel the
    // surface turns under, so allow the bottom faces to point down instead.
    const ref = Math.abs(mid[0]) > 0.05 ? [Math.sign(mid[0]), 0, 0] : [0, -1, 0];
    if (dot(n, ref) < 0 && dot(n, out) < 0) inward++;
  }

  // And the guns must still be in her side, not floating beside it.
  let worst = Infinity;
  for (const g of gunPlacements(rig, rig.guns)) {
    const t = g.along / (rig.L / 2);
    const surface = hullHalfAt(rig, t, g.height);
    worst = Math.min(worst, g.side - surface);   // 0 means exactly on the skin
  }

  const atDeck = hullHalfAt(rig, 0, deckHeight(rig)) * 2;
  const atWater = hullHalfAt(rig, 0, 0) * 2;
  console.log(`${cls.padEnd(12)} ${String(faces).padStart(6)} ${String(inward).padStart(8)}   ` +
    `${worst.toFixed(3).padStart(18)}   ${atDeck.toFixed(1)} / ${atWater.toFixed(1)} m`);

  if (inward > 0) {
    problems.push(`${cls}: ${inward} of ${faces} faces point inboard — you can see through her`);
  }
  if (Math.abs(worst) > 0.01) {
    problems.push(`${cls}: a gun sits ${worst.toFixed(2)} m off the hull surface`);
  }
  // Tumblehome has to be visible, or the section change was pointless.
  if (rig.tumble > 0.2 && atDeck > atWater * 0.93) {
    problems.push(`${cls}: tumblehome barely shows (${atDeck.toFixed(1)} vs ${atWater.toFixed(1)} m)`);
  }
}

console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK — every hull is closed, faces outward, and carries its guns in its side.');
