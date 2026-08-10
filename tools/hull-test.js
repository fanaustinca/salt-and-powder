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

import {
  RIGS, rigOf, halfBeamAt, hullHalfAt, deckHeight, keelDepth, gunPlacements,
} from '../shared/rig.js';

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
  // The transom cap, which the first version of this test left out entirely —
  // so it could not see the hole across the top of the stern.
  const sternRing = N * RING;
  const centre = pos.length / 3;
  pos.push(0, deck - (deck + keel) * 0.5, -rig.L / 2);
  for (let r = 0; r < RING; r++) {
    idx.push(sternRing + ((r + 1) % RING), centre, sternRing + r);
  }
  return { pos, idx, RING, N, deck };
}

/**
 * Edges used by only one triangle: the boundary of the surface.
 *
 * A hull should be open in exactly one place — the deck, which the deck mesh
 * covers. A boundary edge anywhere BELOW the rail is a hole you can see
 * through, which is what the missing transom was.
 */
function openEdges(pos, idx) {
  // Key edges by POSITION, not by index. At the stem the half-breadth is zero,
  // so the port and starboard rings hold coincident-but-separate vertices; an
  // index-based map reads that seam as twenty-four holes when the surface is
  // in fact closed there. Welding by position asks the question that matters:
  // is there a gap you could see through?
  const at = (i) => {
    const [x, y, z] = V(pos, i);
    return `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  };
  const seen = new Map();
  for (let f = 0; f < idx.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = at(idx[f + e]);
      const b = at(idx[f + ((e + 1) % 3)]);
      if (a === b) continue;                       // degenerate sliver
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const rec = seen.get(key) || { n: 0, pts: [V(pos, idx[f + e]), V(pos, idx[f + ((e + 1) % 3)])] };
      rec.n++;
      seen.set(key, rec);
    }
  }
  return [...seen.values()].filter((r) => r.n === 1).map((r) => r.pts);
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
  const { pos, idx, deck } = loft(rig);

  // Holes. Anything open below the rail is somewhere you can see inside her.
  const open = openEdges(pos, idx);
  // The ONLY legitimate opening is the deck, whose boundary runs along the rail
  // at deck height for the whole length. So an edge is a hole if EITHER end
  // drops below the rail — not both. Requiring both let the missing transom
  // through, because each of its two open edges had one end up at the rail.
  const below = open.filter(([a, b]) => a[1] < deck - 0.05 || b[1] < deck - 0.05);

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
    `${worst.toFixed(3).padStart(18)}   ${atDeck.toFixed(1)} / ${atWater.toFixed(1)} m` +
    `   holes below the rail: ${below.length}`);

  if (below.length) {
    const lowest = below.reduce((lo, [a]) => Math.min(lo, a[1]), Infinity);
    problems.push(`${cls}: ${below.length} open edges below the rail (down to y=${lowest.toFixed(1)}) ` +
      '— you can see inside her');
  }
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

// --- the plan view: every class a different shape from above ----------------
// Not just a different size. The widest point used to be pinned amidships for
// everyone, so from a masthead they were one lens shape at nine scales.
console.log('\nfrom above — breadth as a fraction of her beam, bow to stern:');
console.log('class          L/B    t=.6  t=.2  t=-.2 t=-.6   widest at');
const seen = new Map();
for (const cls of Object.keys(RIGS)) {
  const rig = rigOf(cls);
  const at = (t) => (2 * halfBeamAt(rig, t)) / rig.B;
  const sig = [0.6, 0.2, -0.2, -0.6].map((t) => at(t).toFixed(2));
  // Where she is actually broadest, found rather than read off the table.
  let best = -1;
  let bestT = 0;
  for (let t = -1; t <= 1; t += 0.01) {
    const v = at(t);
    if (v > best) { best = v; bestT = t; }
  }
  const ratio = rig.L / rig.B;
  console.log(`${cls.padEnd(12)} ${ratio.toFixed(2).padStart(5)}   ` +
    `${sig.join('  ')}   ${bestT.toFixed(2).padStart(6)}`);

  const key = sig.join('/');
  if (seen.has(key)) problems.push(`${cls} and ${seen.get(key)} have the same plan shape`);
  seen.set(key, cls);
}
// And the fleet as a whole has to span a real range of proportions, or they all
// read as the same hull however carefully each one is shaped.
const ratios = Object.keys(RIGS).map((c) => rigOf(c).L / rigOf(c).B);
const span = Math.max(...ratios) / Math.min(...ratios);
console.log(`\nlength-to-beam spans ${Math.min(...ratios).toFixed(2)} to ` +
  `${Math.max(...ratios).toFixed(2)} — a factor of ${span.toFixed(2)}`);
if (span < 1.25) problems.push(`every hull is nearly the same proportion (factor ${span.toFixed(2)})`);

console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK — every hull is closed, faces outward, and carries its guns in its side.');
