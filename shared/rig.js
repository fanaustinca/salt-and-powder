// Per-class ship geometry. A Flagship is not a big cutter — it is a different
// vessel: four masts rigged square throughout, four tiers of canvas on each,
// three gun decks and a stern castle. Everything is generated from the class so
// adding a hull is a table entry, not a modelling job.
//
// This lives in shared/ because the CLIENT places the gun meshes from it and
// the HOST spawns cannonballs from it. If they used separate numbers the shot
// would not come out of the barrel — which is exactly what used to happen.

export const RIGS = {
  // Shape, not just size. These are what stop the big hulls being one silhouette:
  //   bow      how full the bow is — low is fine and sharp, high is bluff
  //   transom  stern width as a fraction of beam — galleons are slab-sterned
  //   sheer    how far the rail sweeps up at bow and stern
  //   castle   stepped decks in the aftercastle (1 = a plain quarterdeck)
  //   beak     a long low beakhead forward, the way a galleon carried one
  //   mizzen   'gaff' | 'lateen' | 'none' — the sail on the aftmost mast
  //   rake     how far the masts lean aft, in radians
  sailboat: {
    L: 14, B: 4.6, draft: 2.3, decks: 1, masts: 1, yards: 0, gaff: 1, jib: 0,
    quarter: 0.0, forecastle: 0.0, gallery: 0, mastH: 13, guns: 3,
    bow: 0.72, transom: 0.78, sheer: 0.5, castle: 0, beak: 0, mizzen: 'gaff', rake: 0.03,
    tumble: 0.02, flare: 0.10, bilge: 0.72, keelFrac: 0.11,
    features: ['openboat','tiller'],
  },
  cutter: {
    L: 17, B: 5.4, draft: 2.6, decks: 1, masts: 1, yards: 0, gaff: 1, jib: 1,
    quarter: 0.5, forecastle: 0.0, gallery: 0.2, mastH: 16, guns: 4,
    bow: 0.62, transom: 0.70, sheer: 0.7, castle: 1, beak: 0, mizzen: 'gaff', rake: 0.06,
    tumble: 0.04, flare: 0.16, bilge: 0.95, keelFrac: 0.08,
    features: ['deckhouse','longsprit','tiller'],
  },
  brigantine: {
    L: 22, B: 6.6, draft: 3.0, decks: 1, masts: 2, yards: 0, gaff: 2, jib: 1,
    quarter: 0.9, forecastle: 0.5, gallery: 0.4, mastH: 18, guns: 6,
    bow: 0.68, transom: 0.74, sheer: 0.9, castle: 1, beak: 0, mizzen: 'gaff', rake: 0.05,
    tumble: 0.07, flare: 0.09, bilge: 0.80, keelFrac: 0.10,
    features: ['deckhouse','davits','nettings'],
  },
  corvette: {
    // Sleek and low: a fine entry, flat sheer, one light quarterdeck.
    L: 27, B: 7.8, draft: 3.4, decks: 1, masts: 3, yards: 2, gaff: 1, jib: 1,
    quarter: 1.2, forecastle: 0.7, gallery: 0.7, mastH: 21, guns: 8,
    bow: 0.58, transom: 0.62, sheer: 0.6, castle: 1, beak: 0, mizzen: 'gaff', rake: 0.04,
    tumble: 0.11, flare: 0.12, bilge: 1.15, keelFrac: 0.07,
    features: ['flushdeck','nettings','boats'],
  },
  frigate: {
    // Longer and finer still — the greyhound of the line.
    L: 32, B: 9.0, draft: 3.8, decks: 2, masts: 3, yards: 3, gaff: 1, jib: 2,
    quarter: 1.5, forecastle: 0.9, gallery: 0.9, mastH: 24, guns: 10,
    bow: 0.52, transom: 0.56, sheer: 0.5, castle: 1, beak: 0, mizzen: 'gaff', rake: 0.02,
    tumble: 0.14, flare: 0.14, bilge: 1.38, keelFrac: 0.06,
    features: ['quarterdeck','boats','nettings','entryport'],
  },
  galleon: {
    // Bluff-bowed, slab-sterned, enormous sheer, a three-step aftercastle, a
    // beakhead forward and a lateen on the mizzen. Nothing else looks like her.
    L: 38, B: 10.8, draft: 4.2, decks: 2, masts: 3, yards: 3, gaff: 1, jib: 1,
    quarter: 2.6, forecastle: 2.4, gallery: 3.2, mastH: 26, guns: 12,
    bow: 1.02, transom: 1.00, sheer: 3.2, castle: 3, beak: 1, mizzen: 'lateen', rake: 0.13,
    tumble: 0.36, flare: 0.02, bilge: 0.52, keelFrac: 0.15,
    features: ['beakhead','galleries','lateenrig','lanterns'],
  },
  manofwar: {
    // Beamy and square, a long flush quarterdeck with a poop above it.
    L: 44, B: 12.0, draft: 4.8, decks: 3, masts: 3, yards: 3, gaff: 1, jib: 2,
    quarter: 2.2, forecastle: 1.3, gallery: 1.5, mastH: 30, guns: 15,
    bow: 0.80, transom: 0.86, sheer: 1.2, castle: 2, beak: 0, mizzen: 'gaff', rake: 0.05,
    tumble: 0.27, flare: 0.04, bilge: 0.70, keelFrac: 0.12,
    features: ['poop','quartergalleries','entryport','boats','lanterns'],
  },
  // The two biggest are rigged square on all four masts: no headsails on the
  // bowsprit and no fore-and-aft sail aft, so the silhouette is nothing but
  // stacked yards. `gaff: 0` hands the aftmost mast its square yards back —
  // ship.js only skips a mast's yards when it is carrying a gaff or a lateen.
  flagship: {
    L: 56, B: 15.0, draft: 5.6, decks: 3, masts: 4, yards: 4, gaff: 0, jib: 0,
    quarter: 2.8, forecastle: 1.7, gallery: 2.0, mastH: 37, guns: 20,
    bow: 0.74, transom: 0.90, sheer: 1.4, castle: 2, beak: 0, mizzen: 'none', rake: 0.06,
    tumble: 0.30, flare: 0.05, bilge: 0.66, keelFrac: 0.12,
    features: ['poop','quartergalleries','entryport','boats','lanterns','carvedstern'],
  },
  leviathan: {
    L: 68, B: 18.0, draft: 6.4, decks: 4, masts: 4, yards: 4, gaff: 0, jib: 0,
    quarter: 3.2, forecastle: 2.0, gallery: 2.8, mastH: 44, guns: 28,
    bow: 0.86, transom: 0.98, sheer: 1.8, castle: 3, beak: 0, mizzen: 'none', rake: 0.08,
    tumble: 0.32, flare: 0.06, bilge: 0.60, keelFrac: 0.13,
    features: ['poop','quartergalleries','entryport','boats','lanterns','carvedstern','rambow'],
  },
};

/**
 * Half-breadth of the hull at a point `t` along the keel (-1 stern .. +1 bow).
 *
 * THE hull profile: the mesh is built by sampling this, and the guns are placed
 * from it, so a gun always sits in the ship's side. Using the maximum beam
 * everywhere is what left them buried amidships and hanging in the air forward.
 */
export function halfBeamAt(rig, t) {
  const hb = rig.B / 2;
  if (t >= 0) {
    // Forward: a fine bow fines away fast, a bluff one carries its beam on.
    const k = Math.max(0.4, 1.65 - rig.bow);
    return hb * Math.pow(Math.max(0, 1 - t), k);
  }
  // Aft: tapers to the transom width at the stern.
  const a = Math.min(1, -t);
  return hb * (1 - (1 - rig.transom) * Math.pow(a, 1.7));
}

/** Rail height above the waterline, and how deep the keel sits below it. */
export const deckHeight = (rig) => rig.draft * 0.24 + rig.decks * 1.4;
export const keelDepth = (rig) => rig.draft * 0.76;

/**
 * Half-breadth at a station AND a height: the actual hull surface.
 *
 * `halfBeamAt` alone is only the widest line. Everything used to be extruded
 * straight down from it, which made every class the same vertical-sided prism
 * at a different scale — the plan view differed, the SHIP did not. A hull's
 * character is mostly in its section:
 *
 *   tumble    topsides drawn in toward the rail. The signature of a galleon or
 *             a three-decker: enormous at the waterline, narrow on deck.
 *   flare     the opposite, sides pushed out above the water. Fine-lined
 *             frigates and cutters carry it forward to keep the bow dry.
 *   bilge     the turn from the bottom to the side. Below 1 is a full round
 *             bilge that carries her beam right down; above 1 cuts away to a
 *             sharp V.
 *   keelFrac  how much breadth survives at the keel, so she has a keel rather
 *             than a knife edge.
 *
 * The guns are placed against THIS, not against `halfBeamAt` — with tumblehome
 * the hull at gun height is narrower than the waterline, and placing a barrel
 * from the wrong one is how they ended up hanging in the air before.
 */
export function hullHalfAt(rig, t, y) {
  const max = halfBeamAt(rig, t);
  if (max <= 0) return 0;
  if (y >= 0) {
    const f = Math.min(1, y / Math.max(deckHeight(rig), 0.001));
    // Both fade to nothing at the waterline, where the breadth is the max.
    return Math.max(0, max * (1 + (rig.flare || 0) * f - (rig.tumble || 0) * f * f));
  }
  const d = Math.min(1, -y / Math.max(keelDepth(rig), 0.001));
  const kf = rig.keelFrac ?? 0.1;
  return max * (kf + (1 - kf) * Math.pow(1 - d, rig.bilge ?? 0.9));
}

/** Rail height above the main deck at a point `t` (-1 stern .. +1 bow). */
export function sheerAt(rig, t) {
  const a = Math.abs(t);
  // Rises toward both ends, harder at the stern than the bow.
  return rig.sheer * (a * a) * (t < 0 ? 1.25 : 1.0);
}

export const rigOf = (key) => RIGS[key] || RIGS.sailboat;

/** Where the masts stand, as a fraction of length from the bow. */
export function mastPositions(rig) {
  const n = rig.masts;
  if (n === 1) return [0.06];
  if (n === 2) return [0.26, -0.16];
  // Fore, main, mizzen.
  if (n === 3) return [0.34, 0.02, -0.28];
  // Four masts want even spacing over the whole waist. The three-masted plan
  // with a jigger squeezed in aft was fine while that mast carried a gaff, but
  // once it is square-rigged its yards sit right on top of the mizzen's.
  return [0.36, 0.13, -0.10, -0.33];
}

/** Which masts carry a fore-and-aft sail — always the aftmost ones. */
export function gaffMasts(rig) {
  const out = [];
  for (let i = rig.masts - (rig.gaff || 0); i < rig.masts; i++) if (i >= 0) out.push(i);
  return out;
}

/** Headsails, from the outer end of the bowsprit working inboard. */
export function jibPlan(rig) {
  const out = [];
  const bowL = rig.L * 0.34;
  const tip = rig.L * 0.5 + bowL * 0.5;
  for (let i = 0; i < (rig.jib || 0); i++) {
    const t = i / Math.max(1, rig.jib);
    out.push({
      tack: tip - t * bowL * 0.55,      // forward foot, out on the bowsprit
      hoist: rig.mastH * (0.72 - t * 0.14),
      foot: rig.mastH * 0.20,
    });
  }
  return out;
}

/**
 * Yard lengths as a fraction of beam, tallest last. Courses are wide, topsails
 * narrower, topgallants narrower still — that taper is most of what makes a
 * square rig read as a square rig.
 */
export function yardPlan(rig, mastIndex) {
  const out = [];
  // Spread by mast: main widest, fore a little less, and everything abaft the
  // main shorter again. Without the taper a square-rigged jigger throws a yard
  // as wide as the mainyard out over the narrowest part of the hull.
  // (Three-masted ships carry a gaff aft, so index 2 never reached this before —
  // these numbers leave every existing class exactly as it was.)
  const SPREAD = [1.9, 2.1, 1.88, 1.6];
  const base = rig.masts === 1 ? 1.6 : (SPREAD[mastIndex] ?? 2.1);

  // A mast stepped well aft stands on the quarterdeck and the poop above it, so
  // its lowest yard has to start higher or the course hangs straight through the
  // aftercastle. (Only reachable on the four-masted classes: everything with
  // three masts carries a gaff aft and never asks for yards there.)
  const z = mastPositions(rig)[mastIndex] ?? 0;
  const lowest = 0.28 + (z < 0 ? Math.min(0.16, -z * 0.42) : 0);

  for (let i = 0; i < rig.yards; i++) {
    const t = i / Math.max(1, rig.yards - 1);
    out.push({
      // fraction of mast height where the yard sits
      at: lowest + t * (0.83 - lowest),
      width: rig.B * base * (1 - t * 0.42),
      height: rig.mastH * (0.22 - t * 0.05),
    });
  }
  return out;
}

/**
 * Gun deck heights above the waterline, lowest first.
 *
 * Spread between the waterline and just under the rail rather than stacked at a
 * fixed 2.4 m — on a three-decker the top row used to climb above the main deck
 * and end up sitting in the bulwark instead of in the ship's side.
 */
export function deckHeightsOf(rig) {
  const deckY = rig.draft * 0.24 + rig.decks * 1.4;
  const top = deckY - 0.95;
  const bottom = Math.min(1.35, top);
  const out = [];
  for (let d = 0; d < rig.decks; d++) {
    const t = rig.decks === 1 ? 1 : d / (rig.decks - 1);
    out.push(bottom + (top - bottom) * t);
  }
  return out;
}

/**
 * How much of the barrel shows outside the hull, as a fraction of its length.
 * A flat offset buries most of a three-metre gun inside a fifteen-metre beam;
 * scaling it means every class shows about the same slice of barrel.
 */
export const PROTRUDE_FRAC = 0.45;

/** Barrel length for a hull of this beam — never a telegraph pole. */
export const barrelLength = (rig) => Math.min(Math.max(rig.B * 0.28, 1.4), 3.0);

/**
 * Where every gun on one broadside actually sits, in hull space.
 *   along  — metres forward of amidships (+Z is the bow)
 *   height — metres above the waterline
 *   mount  — centreline offset of the barrel's CENTRE (where the mesh goes)
 *   out    — centreline offset of the MUZZLE (where the ball leaves)
 *
 * The client places barrels at `mount` and the host fires from `out`. One
 * source, so they cannot drift apart.
 */
export function gunPlacements(rig, count) {
  const decks = deckHeightsOf(rig);
  const n = Math.max(1, Math.min(count, rig.guns));
  // What a DECK can carry, not what this ship happens to have aboard. Dividing
  // the guns you own between all the decks put one gun on each and stacked them
  // at a single station: a Man-of-War with three guns showed a vertical column
  // amidships instead of three ports down her side. Fill the lowest deck first,
  // the way a ship is armed.
  const perDeck = Math.ceil(rig.guns / rig.decks);
  const out = [];
  let placed = 0;
  for (let d = 0; d < rig.decks && placed < n; d++) {
    const rows = Math.min(perDeck, n - placed);
    for (let k = 0; k < rows; k++) {
      // Guns are spread over the part of the hull that is actually wide enough
      // to carry them, and each one follows the local half-breadth.
      const along = rows > 1 ? (k / (rows - 1) - 0.5) * rig.L * 0.62 - rig.L * 0.03 : -rig.L * 0.02;
      // Against the hull at THIS GUN'S HEIGHT, not at the waterline. On a hull
      // with tumblehome the two differ by most of a metre, and a barrel placed
      // from the waterline breadth hangs in the air outside the ship's side.
      const hw = hullHalfAt(rig, along / (rig.L / 2), decks[d]);
      const len = barrelLength(rig);
      const muzzle = hw + len * PROTRUDE_FRAC;
      out.push({
        along,
        height: decks[d],
        side: hw,                 // the hull surface this gun pokes through
        mount: muzzle - len / 2,
        out: muzzle,
        len,
      });
      placed++;
    }
  }
  return out;
}

/** Bow and stern chasers sit on the main deck, on the centreline. */
export function chaserPlacement(rig, which) {
  const deckY = rig.draft * 0.24 + rig.decks * 1.4;
  const stick = barrelLength(rig) * PROTRUDE_FRAC;
  const nose = which === 'bow' ? rig.L * 0.5 + stick : -(rig.L * 0.5 + stick);
  return {
    along: nose,
    height: deckY + rig.B * 0.09,
    mount: 0,
    out: 0,
    len: barrelLength(rig),
    // Chasers fire along the keel, so the barrel sits just inboard of the stem.
    mountAlong: nose - Math.sign(nose) * barrelLength(rig) / 2,
  };
}
