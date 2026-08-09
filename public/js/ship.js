import * as THREE from 'three';
import { waterHeight } from '/shared/waves.js';
import {
  rigOf, mastPositions, yardPlan, deckHeightsOf, gunPlacements, chaserPlacement,
  barrelLength, gaffMasts, jibPlan, sheerAt, halfBeamAt,
} from '/shared/rig.js';

const WOOD_DARK = 0x3a2a1d;
const WOOD = 0x6b4c31;
const WOOD_LIGHT = 0x9a7550;
const CANVAS = 0xe8dfc9;
const IRON = 0x2b2b30;

// Materials are shared by every ship afloat; only the accent stripe differs.
const MAT = {
  hull: new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.7 }),
  dark: new THREE.MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.72 }),
  deck: new THREE.MeshStandardMaterial({ color: WOOD_LIGHT, roughness: 0.85 }),
  iron: new THREE.MeshStandardMaterial({ color: IRON, roughness: 0.5, metalness: 0.55 }),
  canvas: new THREE.MeshStandardMaterial({
    color: CANVAS, side: THREE.DoubleSide, roughness: 0.95,
  }),
  port: new THREE.MeshStandardMaterial({ color: 0x141014, roughness: 0.95 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0xffdf9a, emissive: 0xffc24a, emissiveIntensity: 1.4, roughness: 0.4,
  }),
};

/**
 * How each class's canvas is painted. Cloth seams and reef bands are on every
 * sail; the colours and the device are what tell a Galleon's suit from a
 * Leviathan's across a mile of water.
 */
const SAIL_LOOK = {
  sailboat:   { base: '#d6cfba', seam: '#c2b9a1', bands: [], patches: true },
  cutter:     { base: '#eae3cd', seam: '#d6ccb2', bands: [] },
  brigantine: { base: '#e6ddc4', seam: '#d2c8ab', bands: [{ y: 0.44, h: 0.14, c: '#a8412f' }] },
  corvette:   { base: '#efeada', seam: '#dbd4bf', bands: [
                  { y: 0.30, h: 0.05, c: '#31527e' }, { y: 0.62, h: 0.05, c: '#31527e' }] },
  frigate:    { base: '#f3efe2', seam: '#dfd9c7', bands: [
                  { y: 0.10, h: 0.09, c: '#1e3a63' }, { y: 0.81, h: 0.09, c: '#1e3a63' }] },
  galleon:    { base: '#dfc38e', seam: '#c8aa73', bands: [], cross: '#ad2b23' },
  manofwar:   { base: '#f7f4ea', seam: '#e3ded0', bands: [
                  { y: 0.20, h: 0.045, c: '#26262a' }, { y: 0.75, h: 0.045, c: '#26262a' }] },
  flagship:   { base: '#fbf8f0', seam: '#e7e1d1', bands: [{ y: 0.46, h: 0.11, c: '#c9a04a' }],
                device: '#8c2f2a' },
  leviathan:  { base: '#8d9199', seam: '#7a7e86', bands: [
                  { y: 0.28, h: 0.10, c: '#1e2228' }, { y: 0.66, h: 0.10, c: '#1e2228' }],
                device: '#0f1216' },
};

const sailMatCache = new Map();
/** One painted canvas material per class, shared by every sail on the ship. */
function sailMaterial(clsKey) {
  if (sailMatCache.has(clsKey)) return sailMatCache.get(clsKey);
  const look = SAIL_LOOK[clsKey] || SAIL_LOOK.cutter;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = look.base;
  ctx.fillRect(0, 0, 256, 256);

  // Cloths: sails are strips sewn together, and the seams read at any distance.
  ctx.strokeStyle = look.seam;
  ctx.lineWidth = 2;
  for (let x = 16; x < 256; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  // Reef bands across the sail.
  ctx.globalAlpha = 0.5;
  for (const y of [0.34, 0.56, 0.78]) {
    ctx.beginPath();
    ctx.moveTo(0, y * 256);
    ctx.lineTo(256, y * 256);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const b of look.bands || []) {
    ctx.fillStyle = b.c;
    ctx.fillRect(0, b.y * 256, 256, b.h * 256);
  }
  if (look.cross) {
    ctx.fillStyle = look.cross;
    ctx.fillRect(110, 40, 36, 176);
    ctx.fillRect(52, 88, 152, 36);
  }
  if (look.device) {
    ctx.fillStyle = look.device;
    ctx.beginPath();
    ctx.arc(128, 128, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.base;
    ctx.beginPath();
    ctx.arc(128, 128, 28, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.patches) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = look.seam;
    ctx.fillRect(60, 150, 44, 34);
    ctx.fillRect(160, 70, 32, 28);
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, side: THREE.DoubleSide, roughness: 0.95,
  });
  sailMatCache.set(clsKey, mat);
  return mat;
}

/** Top-down deck outline. Counter-clockwise, or ExtrudeGeometry inverts it. */
/**
 * Deck outline, sampled from halfBeamAt() in shared/rig.js — the very same
 * profile the guns are placed against, so a barrel can never end up buried in
 * the hull amidships or hanging in the air at the bow.
 */
function shapeOf(rig, scale = 1) {
  const N = 44;
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = 1 - (i / N) * 2;                    // +1 bow -> -1 stern
    pts.push([halfBeamAt(rig, t) * scale, t * (rig.L / 2) * scale]);
  }
  s.moveTo(0, pts[0][1]);
  for (const [x, z] of pts) s.lineTo(-x, z);      // down the -X side
  for (let i = pts.length - 1; i >= 0; i--) s.lineTo(pts[i][0], pts[i][1]);
  return s;
}

// Hull geometry is expensive to build and identical for every ship of a class.
const hullCache = new Map();
function hullGeometry(rig) {
  const key = `${rig.L}x${rig.B}x${rig.draft}x${rig.bow}x${rig.transom}`;
  if (hullCache.has(key)) return hullCache.get(key);
  const geo = new THREE.ExtrudeGeometry(shapeOf(rig), {
    depth: rig.draft + rig.decks * 1.4,
    bevelEnabled: true,
    bevelSegments: 6,
    bevelSize: rig.B * 0.14,
    bevelThickness: rig.draft * 0.26,
    curveSegments: 18,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, rig.draft * 0.24 + rig.decks * 1.4, 0);
  geo.computeVertexNormals();
  hullCache.set(key, geo);
  return geo;
}

/**
 * Build one ship of the given class. Returns the group plus the handles the
 * renderer animates: sails, guns, pennant, tiller.
 */
export function buildShip(accent = 0xa8342c, clsKey = 'sailboat') {
  const rig = rigOf(clsKey);
  const g = new THREE.Group();
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
  const cloth = sailMaterial(clsKey);
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  const L = rig.L;
  const B = rig.B;
  const deckY = rig.draft * 0.24 + rig.decks * 1.4;   // main deck height

  // ---- hull ---------------------------------------------------------------
  const hull = new THREE.Mesh(hullGeometry(rig), MAT.hull);
  hull.castShadow = hull.receiveShadow = true;
  g.add(hull);

  const deckGeo = new THREE.ShapeGeometry(shapeOf(rig, 0.95), 18);
  deckGeo.rotateX(-Math.PI / 2);
  add(deckGeo, MAT.deck, 0, deckY + 0.05, 0);

  // Bulwarks, swept up at bow and stern. A constant-height rail is what made
  // every big hull read as the same box — the sheer line is most of a ship's
  // character, and it is per class.
  {
    const pts = shapeOf(rig).getPoints(90);
    const base = B * 0.13;
    const verts = [];
    const idx = [];
    pts.forEach((pt, i) => {
      const t = pt.y / (L / 2);
      const h = base + sheerAt(rig, t);
      verts.push(pt.x, deckY, pt.y, pt.x, deckY + h, pt.y);
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a0 = i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const rails = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({
      color: WOOD_DARK, roughness: 0.72, side: THREE.DoubleSide,
    }));
    rails.castShadow = rails.receiveShadow = true;
    g.add(rails);
  }

  // ---- wales: one painted band per gun deck -------------------------------
  const decks = deckHeightsOf(rig);
  decks.forEach((h, i) => {
    const bandGeo = new THREE.ExtrudeGeometry(shapeOf(rig, 1.006), {
      depth: 0.42, bevelEnabled: false, curveSegments: 18,
    });
    bandGeo.rotateX(Math.PI / 2);
    add(bandGeo, i === decks.length - 1 ? accentMat : MAT.dark, 0, h, 0);
  });

  // ---- superstructure -----------------------------------------------------
  // Stepped aftercastle: one plain quarterdeck on a frigate, three towering
  // steps on a galleon. This is the single biggest silhouette difference.
  const steps = Math.max(rig.castle || 0, 0);
  let castleTop = deckY;
  for (let k = 0; k < steps; k++) {
    const f = k / Math.max(1, steps);
    const len = L * (0.32 - f * 0.08);
    const wide = B * (0.9 - f * 0.14);
    const h = rig.quarter * (0.8 + f * 0.5);
    const z = -L * (0.24 + f * 0.09);
    add(new THREE.BoxGeometry(wide, h, len), MAT.hull, 0, castleTop + h / 2, z);
    add(new THREE.BoxGeometry(wide * 1.02, 0.22, len), MAT.deck, 0, castleTop + h + 0.11, z);
    castleTop += h;
  }
  if (rig.forecastle > 0) {
    add(new THREE.BoxGeometry(B * 0.74, rig.forecastle, L * 0.19), MAT.hull,
      0, deckY + rig.forecastle / 2, L * 0.32);
    add(new THREE.BoxGeometry(B * 0.76, 0.2, L * 0.19), MAT.deck,
      0, deckY + rig.forecastle + 0.1, L * 0.32);
  }
  if (rig.gallery > 0) {
    // Stern castle with lit windows, stacked on top of the aftercastle steps.
    const sternH = rig.gallery * 1.9;
    add(new THREE.BoxGeometry(B * rig.transom * 0.92, sternH, L * 0.1), MAT.hull,
      0, castleTop + sternH / 2, -L * 0.45);
    const rows = Math.max(1, Math.round(rig.gallery * 0.9));
    for (let r = 0; r < rows; r++) {
      for (let k = -2; k <= 2; k++) {
        add(new THREE.BoxGeometry(B * 0.1, 0.75, 0.3), MAT.glass,
          k * B * 0.15, castleTop + 0.9 + r * 1.5, -L * 0.45 - L * 0.052);
      }
    }
    castleTop += sternH;
  }

  // A beakhead: the long low platform a galleon carried under her bowsprit.
  if (rig.beak > 0) {
    const bk = add(new THREE.BoxGeometry(B * 0.42, 0.5, L * 0.24), MAT.deck,
      0, deckY - rig.forecastle * 0.35, L * 0.55);
    bk.rotation.x = -0.12;
    for (const sx of [1, -1]) {
      const rail = add(new THREE.BoxGeometry(0.24, B * 0.16, L * 0.24), MAT.dark,
        sx * B * 0.2, deckY - rig.forecastle * 0.2, L * 0.55);
      rail.rotation.x = -0.12;
    }
  }

  // ---- bowsprit -----------------------------------------------------------
  const bowL = L * 0.34;
  const bowsprit = add(new THREE.CylinderGeometry(B * 0.028, B * 0.045, bowL, 8),
    MAT.dark, 0, deckY + rig.forecastle + B * 0.1, L * 0.5 + bowL * 0.36);
  bowsprit.rotation.x = Math.PI / 2 - 0.2;

  // ---- masts and sails ----------------------------------------------------
  const sails = [];
  const mastAt = mastPositions(rig);
  const gaffOn = new Set(gaffMasts(rig));
  let sailPivot = null;

  mastAt.forEach((frac, i) => {
    const z = frac * L;
    const isMain = i === (rig.masts > 2 ? 1 : 0);
    const mastH = rig.mastH * (isMain ? 1 : 0.9);
    const r0 = B * 0.035;

    const rake = rig.rake || 0;
    const mast = add(new THREE.CylinderGeometry(r0 * 0.7, r0, mastH, 10),
      MAT.dark, 0, deckY + mastH / 2, z);
    mast.rotation.x = rake;                       // masts lean aft
    mast.position.z -= Math.sin(rake) * mastH * 0.5;
    add(new THREE.BoxGeometry(B * 0.34, 0.16, B * 0.2), MAT.dark, 0, deckY + mastH * 0.62, z);

    // Square yards, but only on masts that are not carrying a fore-and-aft sail.
    if (rig.yards > 0 && !gaffOn.has(i)) {
      for (const y of yardPlan(rig, i)) {
        const yz = deckY + mastH * y.at;
        const yard = add(new THREE.CylinderGeometry(r0 * 0.45, r0 * 0.45, y.width, 6),
          MAT.dark, 0, yz, z);
        yard.rotation.z = Math.PI / 2;

        const sail = makeSquareSail(y.width * 0.94, y.height, cloth);
        sail.topY = yz;
        sail.mesh.position.set(0, yz - y.height / 2, z);
        g.add(sail.mesh);
        sails.push(sail);
      }
    }

    // A lateen: one long raked yard with a triangular sail, on the mizzen.
    if (gaffOn.has(i) && rig.mizzen === 'lateen') {
      const yardL = mastH * 1.05;
      const yard = add(new THREE.CylinderGeometry(r0 * 0.4, r0 * 0.5, yardL, 6),
        MAT.dark, 0, deckY + mastH * 0.5, z);
      yard.rotation.x = -0.95;
      const lat = makeLateen(yardL * 0.82, mastH * 0.5, cloth);
      lat.mesh.position.set(0, deckY + mastH * 0.34, z - mastH * 0.06);
      g.add(lat.mesh);
      sails.push(lat);
    } else if (gaffOn.has(i)) {
      const pivot = new THREE.Group();
      pivot.position.set(0, deckY, z);
      g.add(pivot);
      if (!sailPivot) sailPivot = pivot;

      // The main should dominate the headsail on a fore-and-aft rig.
      const boomL = Math.min(L * (rig.masts === 1 ? 0.56 : 0.44), mastH * 0.7);
      const bm = new THREE.Mesh(
        new THREE.CylinderGeometry(B * 0.022, B * 0.028, boomL, 8), MAT.dark);
      bm.rotation.x = Math.PI / 2;
      bm.position.set(0, B * 0.3, -boomL / 2);
      pivot.add(bm);

      const gaff = makeGaffSail(boomL, mastH * 0.74, cloth);
      gaff.mesh.position.set(0, B * 0.32, 0);
      pivot.add(gaff.mesh);
      sails.push(gaff);
    }
  });
  if (!sailPivot) {
    sailPivot = new THREE.Group();
    sailPivot.position.set(0, deckY, 0);
    g.add(sailPivot);
  }

  // ---- headsails on the bowsprit -----------------------------------------
  // The "front sail" — a jib set between the bowsprit and the foremast.
  const foreZ = mastAt[0] * L;
  for (const j of jibPlan(rig)) {
    const jib = makeJib(j.tack - foreZ, j.hoist, j.foot, cloth);
    jib.mesh.position.set(0, deckY + B * 0.16, foreZ);
    g.add(jib.mesh);
    sails.push(jib);
  }

  // ---- guns ---------------------------------------------------------------
  // Positions come from shared/rig.js, the same table the host fires from.
  const guns = { port: [], starboard: [], bow: [], stern: [] };
  // Guns are mounted inboard with only the muzzle showing, which is how they
  // actually sat — hanging the whole barrel outside the hull looks like scaffolding.
  const gunLen = barrelLength(rig);
  const gunGeo = new THREE.CylinderGeometry(B * 0.024, B * 0.032, gunLen, 8);
  gunGeo.rotateZ(Math.PI / 2);
  const portGeo = new THREE.BoxGeometry(0.3, B * 0.11, B * 0.11);
  const carriageGeo = new THREE.BoxGeometry(B * 0.09, B * 0.05, B * 0.11);

  for (const g0 of gunPlacements(rig, rig.guns)) {
    for (const side of ['port', 'starboard']) {
      const sx = side === 'port' ? 1 : -1;      // +X is port
      add(portGeo, MAT.port, sx * g0.side * 0.99, g0.height, g0.along);
      add(carriageGeo, MAT.dark, sx * g0.side * 0.78, g0.height - B * 0.03, g0.along);
      const barrel = new THREE.Mesh(gunGeo, MAT.iron);
      barrel.position.set(sx * g0.mount, g0.height, g0.along);
      barrel.rotation.y = side === 'port' ? 0 : Math.PI;
      barrel.castShadow = true;
      g.add(barrel);
      guns[side].push(barrel);
    }
  }
  for (const side of ['bow', 'stern']) {
    const c = chaserPlacement(rig, side);
    const barrel = new THREE.Mesh(gunGeo, MAT.iron);
    barrel.position.set(0, c.height, c.mountAlong ?? c.along);
    barrel.rotation.y = side === 'bow' ? -Math.PI / 2 : Math.PI / 2;
    barrel.castShadow = true;
    g.add(barrel);
    guns[side].push(barrel);
  }

  // ---- features: what actually tells the classes apart --------------------
  const has = (f) => (rig.features || []).includes(f);
  const gold = new THREE.MeshStandardMaterial({
    color: 0xc9a04a, roughness: 0.42, metalness: 0.65,
  });

  // Shrouds: ladders of rigging up to every masthead.
  if (rig.masts >= 1 && L >= 16) {
    const shroudMat = new THREE.LineBasicMaterial({ color: 0x241c14, transparent: true, opacity: 0.9 });
    mastAt.forEach((frac, i) => {
      const z = frac * L;
      const mastH = rig.mastH * (i === (rig.masts > 2 ? 1 : 0) ? 1 : 0.9);
      const topY = deckY + mastH * 0.6;
      for (const sx of [1, -1]) {
        const pts = [];
        const spread = B * 0.44;
        for (let k = 0; k < 5; k++) {
          pts.push(new THREE.Vector3(sx * spread * (0.5 + k * 0.16), deckY + B * 0.16, z + (k - 2) * B * 0.08));
          pts.push(new THREE.Vector3(0, topY, z));
        }
        for (let r = 1; r < 6; r++) {
          const f = r / 6;
          pts.push(new THREE.Vector3(sx * spread * 0.5 * (1 - f), deckY + B * 0.16 + (topY - deckY) * f, z));
          pts.push(new THREE.Vector3(sx * spread * 1.3 * (1 - f), deckY + B * 0.16 + (topY - deckY) * f, z + B * 0.05));
        }
        g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), shroudMat));
      }
    });
  }

  // An open boat has no deck furniture at all — just thwarts you can see into.
  if (has('openboat')) {
    for (let k = -1; k <= 1; k++) {
      add(new THREE.BoxGeometry(B * 0.78, 0.14, 0.5), MAT.deck, 0, deckY + 0.35, k * L * 0.16);
    }
  }

  // A cabin trunk on the smaller decked hulls.
  if (has('deckhouse')) {
    add(new THREE.BoxGeometry(B * 0.5, B * 0.22, L * 0.16), MAT.deck, 0, deckY + B * 0.11, -L * 0.12);
    add(new THREE.BoxGeometry(B * 0.54, 0.14, L * 0.17), MAT.dark, 0, deckY + B * 0.22, -L * 0.12);
  }

  // Hammock netting along the rail — a pale band the eye reads instantly.
  if (has('nettings')) {
    const pts = shapeOf(rig, 0.99).getPoints(70);
    const verts = [];
    const idx = [];
    pts.forEach((pt) => {
      const t = pt.y / (L / 2);
      const base = deckY + B * 0.13 + sheerAt(rig, t);
      verts.push(pt.x, base, pt.y, pt.x, base + B * 0.075, pt.y);
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a0 = i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    ng.setIndex(idx);
    ng.computeVertexNormals();
    g.add(new THREE.Mesh(ng, new THREE.MeshStandardMaterial({
      color: 0xb9b0a0, roughness: 0.98, side: THREE.DoubleSide,
    })));
  }

  // Ship's boats: stowed amidships on the rates, slung from davits on a brig.
  if (has('boats') || has('davits')) {
    const hullBoat = new THREE.SphereGeometry(B * 0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const place = has('davits')
      ? [[B * 0.46, -L * 0.34], [-B * 0.46, -L * 0.34]]
      : [[0, L * 0.02], [0, -L * 0.08]];
    for (const [bx, bz] of place) {
      const boat = add(hullBoat, MAT.deck, bx, deckY + (has('davits') ? B * 0.2 : 0.55), bz);
      boat.rotation.x = Math.PI;
      boat.scale.set(1, 0.65, 2.0);
      if (has('davits')) {
        for (const dz of [-1, 1]) {
          const dav = add(new THREE.TorusGeometry(B * 0.11, 0.09, 6, 10, Math.PI), MAT.dark,
            bx, deckY + B * 0.2, bz + dz * B * 0.2);
          dav.rotation.y = Math.PI / 2;
        }
      }
    }
  }

  // Quarter galleries: the bay windows on the stern corners. Nothing says
  // "rated warship" faster, and nothing else in the fleet has them.
  if (has('quartergalleries')) {
    for (const sx of [1, -1]) {
      const gx = sx * B * rig.transom * 0.46;
      const gy = castleTop - rig.gallery * 1.2;
      const body = add(new THREE.CylinderGeometry(B * 0.11, B * 0.09, rig.gallery * 1.7, 8, 1, false, 0, Math.PI),
        MAT.hull, gx, gy, -L * 0.4);
      body.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      add(new THREE.SphereGeometry(B * 0.11, 8, 6), gold, gx, gy + rig.gallery * 0.9, -L * 0.4);
      for (let r = 0; r < 2; r++) {
        add(new THREE.BoxGeometry(0.3, 0.6, B * 0.14), MAT.glass,
          gx + sx * B * 0.03, gy - 0.4 + r * 1.1, -L * 0.4);
      }
    }
  }

  // A gilded, carved transom.
  if (has('carvedstern')) {
    add(new THREE.BoxGeometry(B * rig.transom * 0.94, 0.5, 0.4), gold,
      0, castleTop - 0.4, -L * 0.47);
    add(new THREE.BoxGeometry(B * rig.transom * 0.7, 0.9, 0.35), gold,
      0, castleTop + 0.6, -L * 0.47);
  }

  // Stepped galleries down the stern of a galleon.
  if (has('galleries')) {
    for (let r = 0; r < 3; r++) {
      add(new THREE.BoxGeometry(B * rig.transom * (0.96 - r * 0.1), 0.4, 0.5), gold,
        0, deckY + rig.quarter * 0.5 + r * rig.gallery * 0.75, -L * 0.46);
    }
  }

  // An entry port: the decorated doorway amidships with steps down the side.
  if (has('entryport')) {
    const side = halfBeamAt(rig, 0);
    add(new THREE.BoxGeometry(0.4, B * 0.2, B * 0.16), MAT.port, side * 0.99, deckY - B * 0.06, 0);
    add(new THREE.BoxGeometry(0.5, B * 0.24, B * 0.2), gold, side * 1.01, deckY - B * 0.06, 0);
    for (let k = 0; k < 5; k++) {
      add(new THREE.BoxGeometry(0.6, 0.14, B * 0.1), MAT.dark,
        side * 1.02, deckY - B * 0.16 - k * B * 0.09, 0);
    }
  }

  // Stern lanterns — one on a galleon, three on a first rate.
  if (has('lanterns')) {
    const n = has('carvedstern') ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const lx = n === 1 ? 0 : (k - 1) * B * 0.3;
      add(new THREE.CylinderGeometry(B * 0.05, B * 0.06, B * 0.14, 6), gold,
        lx, castleTop + B * 0.09, -L * 0.44);
      add(new THREE.SphereGeometry(B * 0.05, 8, 6), MAT.glass, lx, castleTop + B * 0.17, -L * 0.44);
    }
  }

  // A ram beak on the biggest hull of all.
  if (has('rambow')) {
    const ram = add(new THREE.ConeGeometry(B * 0.16, L * 0.14, 6), MAT.dark,
      0, decks[0] - 0.4, L * 0.53);
    ram.rotation.x = -Math.PI / 2;
    add(new THREE.ConeGeometry(B * 0.1, L * 0.08, 6), gold, 0, decks[0] + 0.6, L * 0.55);
  }

  // Anchors and a figurehead, on anything with a proper bow.
  if (L >= 20) {
    for (const sx of [1, -1]) {
      const stock = add(new THREE.BoxGeometry(0.2, B * 0.26, 0.2), MAT.iron,
        sx * B * 0.4, decks[decks.length - 1] + 1.0, L * 0.38);
      stock.rotation.z = sx * 0.35;
      add(new THREE.TorusGeometry(B * 0.09, 0.1, 6, 12, Math.PI), MAT.iron,
        sx * B * 0.4, decks[decks.length - 1] + 0.5, L * 0.38);
    }
    const fig = add(new THREE.ConeGeometry(B * 0.08, B * 0.3, 6),
      has('carvedstern') ? gold : MAT.deck, 0, decks[decks.length - 1] + 1.2, L * 0.5);
    fig.rotation.x = -Math.PI / 2 + 0.3;
  }

  // Capstan, gratings and casks on any decked ship.
  if (!has('openboat')) {
    add(new THREE.CylinderGeometry(B * 0.07, B * 0.09, B * 0.15, 10), MAT.dark,
      0, deckY + B * 0.075, -L * 0.06);
    for (const hz of [L * 0.18, -L * 0.02]) {
      add(new THREE.BoxGeometry(B * 0.24, 0.16, B * 0.28), MAT.dark, 0, deckY + 0.14, hz);
    }
    for (let k = 0; k < 4; k++) {
      const cask = add(new THREE.CylinderGeometry(B * 0.04, B * 0.04, B * 0.1, 8), MAT.dark,
        ((k % 2) - 0.5) * B * 0.4, deckY + B * 0.05, -L * 0.14 - (k >> 1) * B * 0.22);
      cask.rotation.z = Math.PI / 2;
    }
  }

  // A poop deck above the aftercastle.
  if (has('poop')) {
    add(new THREE.BoxGeometry(B * 0.66, rig.quarter * 0.75, L * 0.14), MAT.hull,
      0, castleTop + rig.quarter * 0.37, -L * 0.36);
    add(new THREE.BoxGeometry(B * 0.68, 0.2, L * 0.14), MAT.deck,
      0, castleTop + rig.quarter * 0.75 + 0.1, -L * 0.36);
  }

  // ---- tiller and pennant -------------------------------------------------
  const tiller = add(new THREE.BoxGeometry(0.12, 0.12, L * 0.12), MAT.dark,
    0, deckY + rig.quarter + 0.5, -L * 0.36);

  const pennantPivot = new THREE.Group();
  pennantPivot.position.set(0, deckY + rig.mastH - 0.4, mastAt[Math.min(1, mastAt.length - 1)] * L);
  g.add(pennantPivot);
  const pennantGeo = new THREE.PlaneGeometry(B * 0.5, B * 0.11, 10, 1);
  pennantGeo.translate(-B * 0.25, 0, 0);
  const pennant = new THREE.Mesh(pennantGeo,
    new THREE.MeshStandardMaterial({ color: accent, side: THREE.DoubleSide, roughness: 0.9 }));
  pennant.rotation.y = Math.PI / 2;
  pennantPivot.add(pennant);

  const vis = {
    group: g, clsKey, rig, sails, sailPivot, guns, tiller,
    pennant, pennantGeo, pennantBase: pennantGeo.attributes.position.array.slice(),
    pennantPivot, accent,
  };
  setGuns(vis, { port: 1, starboard: 1, bow: 0, stern: 0 });
  return vis;
}

/** A square sail: a rectangle that bellies away from the mast. */
function makeSquareSail(w, h, mat) {
  const geo = new THREE.PlaneGeometry(w, h, 10, 6);
  const base = geo.attributes.position.array.slice();
  const mesh = new THREE.Mesh(geo, mat || MAT.canvas);
  mesh.castShadow = true;
  return { mesh, geo, base, kind: 'square', w, h };
}

/** A triangular fore-and-aft sail on the mast and boom. */
function makeGaffSail(boomL, hoist, mat) {
  const geo = new THREE.PlaneGeometry(boomL, hoist, 12, 12);
  const pos = geo.attributes.position;
  const base = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / boomL + 0.5;
    const v = pos.getY(i) / hoist + 0.5;
    const x = -u * boomL * (1 - 0.78 * v);
    const y = v * hoist;
    base[i * 3] = x;
    base[i * 3 + 1] = y;
    pos.setXYZ(i, x, y, 0);
  }
  const mesh = new THREE.Mesh(geo, mat || MAT.canvas);
  mesh.rotation.y = -Math.PI / 2;
  mesh.castShadow = true;
  return { mesh, geo, base, kind: 'gaff', w: boomL, h: hoist };
}

/** A lateen sail: a long triangle slung under a steeply raked yard. */
function makeLateen(len, drop, mat) {
  const geo = new THREE.PlaneGeometry(len, drop, 12, 10);
  const pos = geo.attributes.position;
  const base = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / len + 0.5;
    const v = pos.getY(i) / drop + 0.5;
    // Hangs from the yard, tapering to a point at the forward lower corner.
    const x = (u - 0.5) * len;
    const y = -v * drop * (0.25 + u * 0.75);
    base[i * 3] = x;
    base[i * 3 + 1] = y;
    pos.setXYZ(i, x, y, 0);
  }
  const mesh = new THREE.Mesh(geo, mat || MAT.canvas);
  mesh.rotation.y = -Math.PI / 2;
  mesh.rotation.z = 0.35;
  mesh.castShadow = true;
  return { mesh, geo, base, kind: 'gaff', w: len, h: drop };
}

/**
 * A jib: the triangular headsail forward of the mast. Tack down at the bowsprit,
 * head up near the masthead, clew aft — it lies fore-and-aft like the gaff sail,
 * so the two read as a matched pair on a cutter.
 */
function makeJib(reach, hoist, foot, mat) {
  const len = Math.max(Math.abs(reach), 1);
  const geo = new THREE.PlaneGeometry(len, hoist, 10, 12);
  const pos = geo.attributes.position;
  const base = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / len + 0.5;          // 0 at the mast, 1 at the bowsprit
    const v = pos.getY(i) / hoist + 0.5;        // 0 foot, 1 head
    // The luff rakes back as it climbs; the leech falls nearly straight.
    const x = u * len * (1 - v * 0.92);
    const y = foot + v * (hoist - foot);
    base[i * 3] = x;
    base[i * 3 + 1] = y;
    pos.setXYZ(i, x, y, 0);
  }
  const mesh = new THREE.Mesh(geo, mat || MAT.canvas);
  mesh.rotation.y = -Math.PI / 2;
  mesh.castShadow = true;
  return { mesh, geo, base, kind: 'gaff', w: len, h: hoist };
}

/**
 * Belly and furl every sail. Below about a third throttle the canvas is being
 * taken in, so the sails roll up toward their yards instead of staying full and
 * flat — on a four-masted ship that difference is most of what tells you whether
 * she is under way.
 */
export function animateSails(vis, fill, t) {
  const set = Math.max(0.06, Math.min(1, (fill - 0.22) / 0.6));
  for (const s of vis.sails) {
    // Furl toward the yard (square) or down to the boom (gaff).
    s.mesh.scale.y = set;
    if (s.kind === 'square') s.mesh.position.y = s.topY - (s.h * set) / 2;
    const pos = s.geo.attributes.position;
    const camber = 0.35 + fill * (s.kind === 'square' ? 0.055 * s.w : 1.1);
    for (let i = 0; i < pos.count; i++) {
      const x = s.base[i * 3];
      const y = s.base[i * 3 + 1];
      const u = s.kind === 'square'
        ? Math.cos((x / s.w) * Math.PI)              // deepest in the middle
        : Math.sin(Math.min(Math.abs(x) / s.w, 1) * Math.PI);
      const v = s.kind === 'square'
        ? Math.sin(((y / s.h) + 0.5) * Math.PI)
        : Math.sin(Math.min((y / s.h) * 1.25, 1) * Math.PI);
      pos.setXYZ(i, x, y, u * v * camber * (s.kind === 'square' ? 1 : -1));
    }
    pos.needsUpdate = true;
    s.geo.computeVertexNormals();
  }
}

/** Show exactly the guns this ship has bought. */
export function setGuns(vis, counts) {
  if (!vis.guns || !counts) return;
  for (const key in vis.guns) {
    const want = counts[key] ?? 0;
    vis.guns[key].forEach((barrel, i) => { barrel.visible = i < want; });
  }
}

export function recoilGuns(vis, battery, amount) {
  const list = vis.guns?.[battery];
  if (!list) return;
  for (const b of list) if (b.visible) b.userData.recoil = amount;
}

export function updateGuns(vis, dt) {
  if (!vis.guns) return;
  for (const key in vis.guns) {
    for (const b of vis.guns[key]) {
      if (b.userData.base === undefined) b.userData.base = { x: b.position.x, z: b.position.z };
      const r = b.userData.recoil || 0;
      if (r <= 0) continue;
      b.userData.recoil = Math.max(0, r - dt * 2.4);
      const back = b.userData.recoil * 0.9;
      b.position.x = b.userData.base.x - Math.cos(b.rotation.y) * back;
      b.position.z = b.userData.base.z + Math.sin(b.rotation.y) * back;
    }
  }
}

/** Pennant streams astern with a lazy ripple. */
export function animatePennant(vis, relAngle, strength, t) {
  vis.pennantPivot.rotation.y = -relAngle + Math.PI / 2;
  const pos = vis.pennantGeo.attributes.position;
  const base = vis.pennantBase;
  const span = vis.rig.B * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const k = Math.abs(x) / span;
    pos.setXYZ(i, x,
      base[i * 3 + 1] + Math.sin(t * 9 + k * 7) * 0.16 * k * (0.4 + strength),
      Math.sin(t * 11 + k * 6) * 0.2 * k * (0.3 + strength));
  }
  pos.needsUpdate = true;
}

/**
 * Sit the hull in the water: sample the wave field fore, aft and either beam so
 * she pitches over the swell and rolls with the sea.
 */
export function floatShip(group, x, z, heading, t, heel = 0, rig) {
  const L = rig?.L ?? 14;
  const B = rig?.B ?? 4.6;
  const draft = rig?.draft ?? 2.3;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const fx = sin * (L * 0.4);
  const fz = cos * (L * 0.4);
  const rx = cos * (B * 0.5);
  const rz = -sin * (B * 0.5);

  const hBow = waterHeight(x + fx, z + fz, t);
  const hStern = waterHeight(x - fx, z - fz, t);
  const hStbd = waterHeight(x + rx, z + rz, t);
  const hPort = waterHeight(x - rx, z - rz, t);

  const y = (hBow + hStern + hStbd + hPort) * 0.25;
  // A big hull does not follow every short wave face the way a dinghy does.
  const damp = Math.min(1, 0.6 * (14 / L) + 0.18);
  const pitch = Math.atan2(hBow - hStern, L * 0.8) * damp;
  const roll = Math.atan2(hStbd - hPort, B) * damp;
  const lean = Math.max(-0.5, Math.min(0.5, roll + heel));

  group.position.set(x, y - draft * 0.16, z);
  group.rotation.set(0, 0, 0);
  group.rotateY(heading);
  group.rotateX(-Math.max(-0.45, Math.min(0.45, pitch)));
  group.rotateZ(lean);
}

/** Floating name tag drawn to a canvas. */
export function makeLabel(text, accent = 0xffffff) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 84;
  const ctx = c.getContext('2d');
  ctx.font = '600 44px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#' + new THREE.Color(accent).getHexString();
  ctx.fillText(text, 160, 44);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(9, 2.4, 1);
  spr.renderOrder = 10;
  return spr;
}
