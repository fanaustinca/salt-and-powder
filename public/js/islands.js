import * as THREE from 'three';
import { ISLANDS, HAVENS, landHeight, safeRadius } from '/shared/world.js';

/**
 * The land. Every island is a dome built from the same deterministic height
 * function the host uses for grounding, so what you sail into is what stops you.
 */
export class Islands {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const sand = new THREE.MeshStandardMaterial({ color: 0xc9b183, roughness: 0.95 });
    const rock = new THREE.MeshStandardMaterial({ color: 0x6d6a5f, roughness: 0.9 });
    const green = new THREE.MeshStandardMaterial({ color: 0x4a6b3a, roughness: 0.95 });

    for (const isle of ISLANDS) {
      const SEG = 40;
      const geo = new THREE.PlaneGeometry(isle.radius * 2.3, isle.radius * 2.3, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colours = new Float32Array(pos.count * 3);
      const c = new THREE.Color();

      for (let i = 0; i < pos.count; i++) {
        const wx = pos.getX(i) + isle.x;
        const wz = pos.getZ(i) + isle.z;
        // Dip the skirt below the waterline so there is never a visible seam.
        const h = landHeight(wx, wz);
        pos.setY(i, h > 0.05 ? h : -3);

        // Beach at the waterline, greenery above it, rock on the peaks.
        const t = h / Math.max(isle.height, 1);
        if (t < 0.14) c.setHex(0xd8c08d);
        else if (t < 0.62) c.copy(green.color).multiplyScalar(0.85 + t * 0.5);
        else c.copy(rock.color).multiplyScalar(0.9 + t * 0.3);
        c.toArray(colours, i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.95, flatShading: false,
      }));
      mesh.position.set(isle.x, 0, isle.z);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.group.add(mesh);

      const top = landHeight(isle.x, isle.z);
      let crown = top;

      if (isle.haven) {
        crown = this.buildPort(isle, top);
      } else if (isle.kind === 'base') {
        crown = this.buildBase(isle, top);
      } else {
        // Islets get nothing but a few rocks — they are hazards, not places.
        for (let k = 0; k < 4; k++) {
          const a = k * 2.1 + isle.seed;
          const d = isle.radius * (0.3 + 0.4 * ((k * 7) % 5) / 5);
          const rx = isle.x + Math.sin(a) * d;
          const rz = isle.z + Math.cos(a) * d;
          const rock = new THREE.Mesh(
            new THREE.DodecahedronGeometry(2 + (k % 3) * 1.6),
            new THREE.MeshStandardMaterial({ color: 0x6a675e, roughness: 0.95 })
          );
          rock.position.set(rx, landHeight(rx, rz) + 1, rz);
          rock.castShadow = true;
          this.group.add(rock);
        }
        crown = top + 4;
      }

      // Name plate, readable from a good way off.
      const label = makeSign(isle.name, isle.haven ? '#ffd98a' : '#d8cdbb');
      label.position.set(isle.x, crown + 16, isle.z);
      label.scale.multiplyScalar(isle.kind === 'islet' ? 0.55 : 1);
      this.group.add(label);
    }
  }

  /** A walled port: castle on the high ground, a town below it, and a jetty. */
  buildPort(isle, top) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.92 });
    const dark  = new THREE.MeshStandardMaterial({ color: 0x6a6760, roughness: 0.92 });
    const roof  = new THREE.MeshStandardMaterial({ color: 0x8c4a37, roughness: 0.9 });
    const wall  = new THREE.MeshStandardMaterial({ color: 0xd9cdb4, roughness: 0.95 });
    const wood  = new THREE.MeshStandardMaterial({ color: 0x6b5232, roughness: 0.95 });

    const put = (geo, mat, x, z, lift) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, landHeight(x, z) + lift, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    const rr = (n) => {
      const v = Math.sin(n * 57.3 + isle.seed * 13.1) * 4711.7;
      return v - Math.floor(v);
    };

    // --- castle on the summit: keep, four towers, a curtain wall -------------
    const keepH = 30;
    put(new THREE.BoxGeometry(26, keepH, 26), stone, isle.x, isle.z, keepH / 2);
    put(new THREE.BoxGeometry(29, 3, 29), dark, isle.x, isle.z, keepH + 1.5);

    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const tx = isle.x + Math.sin(a) * 20;
      const tz = isle.z + Math.cos(a) * 20;
      const th = 38;
      put(new THREE.CylinderGeometry(6, 7, th, 10), stone, tx, tz, th / 2);
      put(new THREE.CylinderGeometry(7.4, 7.4, 2.6, 10), dark, tx, tz, th + 1.3);
      put(new THREE.ConeGeometry(7.6, 9, 10), roof, tx, tz, th + 7);
    }

    // Curtain wall ringing the citadel.
    const wallR = 40;
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2;
      const wx = isle.x + Math.sin(a) * wallR;
      const wz = isle.z + Math.cos(a) * wallR;
      const seg = put(new THREE.BoxGeometry(11, 12, 4), stone, wx, wz, 6);
      seg.rotation.y = -a;
    }

    // --- the town, spilling down the slope toward the water -----------------
    const houses = 26;
    for (let k = 0; k < houses; k++) {
      const a = rr(k) * Math.PI * 2;
      const d = isle.radius * (0.46 + rr(k + 90) * 0.34);
      const hx = isle.x + Math.sin(a) * d;
      const hz = isle.z + Math.cos(a) * d;
      if (landHeight(hx, hz) < 1.5) continue;         // do not build in the sea
      const w = 7 + rr(k + 30) * 6;
      const h = 6 + rr(k + 60) * 6;
      const b = put(new THREE.BoxGeometry(w, h, w * 0.85), wall, hx, hz, h / 2);
      b.rotation.y = rr(k + 120) * Math.PI;
      const cap = put(new THREE.ConeGeometry(w * 0.82, h * 0.55, 4), roof, hx, hz, h + h * 0.27);
      cap.rotation.y = b.rotation.y + Math.PI / 4;
    }

    // A church, so the skyline has something to point at.
    const cA = rr(7) * Math.PI * 2;
    const cD = isle.radius * 0.42;
    const cx = isle.x + Math.sin(cA) * cD;
    const cz = isle.z + Math.cos(cA) * cD;
    put(new THREE.BoxGeometry(12, 14, 20), wall, cx, cz, 7);
    put(new THREE.BoxGeometry(7, 24, 7), wall, cx, cz, 12);
    put(new THREE.ConeGeometry(5.6, 13, 6), roof, cx, cz, 30);

    // --- jetty running out into the shallows --------------------------------
    const jA = rr(3) * Math.PI * 2;
    for (let k = 0; k < 9; k++) {
      const d = isle.radius * 0.92 + k * 7;
      const jx = isle.x + Math.sin(jA) * d;
      const jz = isle.z + Math.cos(jA) * d;
      const plank = put(new THREE.BoxGeometry(9, 1.2, 8), wood, jx, jz, 0);
      plank.position.y = Math.max(landHeight(jx, jz), 0) + 2.2;
      plank.rotation.y = -jA;
    }

    // --- lighthouse at the harbour mouth ------------------------------------
    const lA = jA + 0.7;
    const lx = isle.x + Math.sin(lA) * isle.radius * 0.9;
    const lz = isle.z + Math.cos(lA) * isle.radius * 0.9;
    put(new THREE.CylinderGeometry(3.4, 5, 30, 12), wall, lx, lz, 15);
    put(new THREE.CylinderGeometry(4.6, 4.6, 3, 12), dark, lx, lz, 31);
    const lamp = put(new THREE.SphereGeometry(2.8, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xffb44a, emissiveIntensity: 2.6 }),
      lx, lz, 34);
    lamp.castShadow = false;

    return top + keepH + 10;
  }

  /** A home base: a modest fort and a couple of huts. */
  buildBase(isle, top) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.94 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x5f4433, roughness: 0.93 });
    const put = (geo, mat, x, z, lift) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, landHeight(x, z) + lift, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };

    put(new THREE.BoxGeometry(18, 14, 18), stone, isle.x, isle.z, 7);
    put(new THREE.BoxGeometry(21, 2.4, 21), roof, isle.x, isle.z, 15);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.6;
      const tx = isle.x + Math.sin(a) * 13;
      const tz = isle.z + Math.cos(a) * 13;
      put(new THREE.CylinderGeometry(3.4, 4, 18, 8), stone, tx, tz, 9);
    }
    for (let k = 0; k < 5; k++) {
      const a = k * 1.9 + isle.seed;
      const d = isle.radius * 0.55;
      const hx = isle.x + Math.sin(a) * d;
      const hz = isle.z + Math.cos(a) * d;
      if (landHeight(hx, hz) < 1.5) continue;
      put(new THREE.BoxGeometry(7, 6, 6), stone, hx, hz, 3);
      put(new THREE.ConeGeometry(5.6, 4, 4), roof, hx, hz, 8);
    }
    return top + 22;
  }
}

/**
 * The white ring on the water marking where a Safe Haven's peace begins. Drawn
 * on the swell so it reads as a line painted on the sea.
 */
export class SafeRings {
  constructor(scene) {
    this.rings = [];
    const SEGS = 96;
    for (const isle of HAVENS) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position',
        new THREE.BufferAttribute(new Float32Array((SEGS + 1) * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false,
      }));
      line.frustumCulled = false;
      line.renderOrder = 5;
      scene.add(line);
      this.rings.push({ isle, geo, line, SEGS, r: safeRadius(isle) });
    }
  }

  /** Only redraw the rings near the player; the rest sit still far away. */
  update(t, cx, cz, waterHeight) {
    for (const ring of this.rings) {
      const away = Math.hypot(ring.isle.x - cx, ring.isle.z - cz);
      ring.line.visible = away < ring.r + 1400;
      if (!ring.line.visible) continue;
      const pos = ring.geo.attributes.position.array;
      for (let i = 0; i <= ring.SEGS; i++) {
        const a = (i / ring.SEGS) * Math.PI * 2;
        const x = ring.isle.x + Math.sin(a) * ring.r;
        const z = ring.isle.z + Math.cos(a) * ring.r;
        pos[i * 3] = x;
        pos[i * 3 + 1] = waterHeight(x, z, t) + 0.5;
        pos[i * 3 + 2] = z;
      }
      ring.geo.attributes.position.needsUpdate = true;
    }
  }
}

function makeSign(text, colour) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = '600 54px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = colour;
  ctx.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(64, 12, 1);
  spr.renderOrder = 12;
  return spr;
}

/** Floating loot crates, rebuilt from the host's list each snapshot. */
export class CargoDrops {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
    this.geo = new THREE.BoxGeometry(1.5, 1.2, 1.5);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x9a7442, roughness: 0.85 });
  }

  sync(drops, t, waterHeight) {
    const seen = new Set();
    for (const d of drops || []) {
      seen.add(d.id);
      let m = this.meshes.get(d.id);
      if (!m) {
        m = new THREE.Mesh(this.geo, this.mat);
        m.castShadow = true;
        this.scene.add(m);
        this.meshes.set(d.id, m);
      }
      m.position.set(d.x, waterHeight(d.x, d.z, t) + 0.5, d.z);
      m.rotation.y = d.id * 0.7 + t * 0.25;
      m.rotation.z = Math.sin(t * 1.4 + d.id) * 0.16;
    }
    for (const [id, m] of this.meshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      this.meshes.delete(id);
    }
  }
}
