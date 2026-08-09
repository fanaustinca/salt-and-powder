import * as THREE from 'three';
import { waterHeight } from '/shared/waves.js';
import { KRAKEN } from '/shared/kraken.js';

const SEGS = 14;

/**
 * The Kraken you can see. Every arm is a tube whose shape is driven by the same
 * state the host is scoring with — when an arm is in `slam`, the thing coming
 * down on your deck is the thing that is about to hurt you.
 */
export class KrakenFX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const skin = new THREE.MeshStandardMaterial({
      color: 0x4a2f52, roughness: 0.72, metalness: 0.06,
    });
    const under = new THREE.MeshStandardMaterial({
      color: 0x8d5f7a, roughness: 0.6,
    });
    this.skin = skin;

    // Mantle: the bulk that breaks the surface.
    this.body = new THREE.Mesh(new THREE.SphereGeometry(15, 20, 14), skin);
    this.body.scale.set(1, 0.62, 1.35);
    this.body.castShadow = true;
    this.group.add(this.body);

    // Two enormous eyes — the thing that makes it read as alive.
    this.eyes = [];
    for (const sx of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(3.1, 14, 12),
        new THREE.MeshStandardMaterial({
          color: 0xf3e09a, emissive: 0xd8a02a, emissiveIntensity: 1.1, roughness: 0.3,
        }));
      eye.position.set(sx * 7.5, 5.5, 8);
      this.group.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(1.35, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x120a10 }));
      pupil.position.set(sx * 7.5, 5.5, 10.6);
      this.group.add(pupil);
      this.eyes.push(eye, pupil);
    }

    this.arms = [];
    for (let i = 0; i < KRAKEN.arms; i++) {
      const curve = new THREE.CatmullRomCurve3(
        Array.from({ length: SEGS }, () => new THREE.Vector3())
      );
      const geo = new THREE.TubeGeometry(curve, SEGS - 1, 2.6, 8, false);
      const mesh = new THREE.Mesh(geo, i % 2 ? under : skin);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.arms.push({ mesh, curve, pts: curve.points });
    }
  }

  /** Rebuild from the host's snapshot. `k` is null when there is no Kraken. */
  update(k, t) {
    this.group.visible = !!k;
    if (!k) return;

    const surface = waterHeight(k.x, k.z, t);
    // She rises out of the sea rather than popping into existence.
    this.group.position.set(k.x, surface - 12 + k.rise * 13, k.z);
    this.group.rotation.y = Math.sin(t * 0.13) * 0.25;
    const wounded = 1 - k.hp / k.maxHp;
    this.skin.color.setHSL(0.82 - wounded * 0.08, 0.32, 0.24 + wounded * 0.06);

    k.arms.forEach((a, i) => {
      const arm = this.arms[i];
      if (!arm) return;
      // Idle arms still sprawl well clear of the mantle — curled inside it they
      // were invisible, which made her look like a floating aubergine.
      const idleReach = 34;
      // Where the tip wants to be, in the group's local frame.
      const tx = a.x - k.x;
      const tz = a.z - k.z;
      let lift = 0;
      let out = 0;
      if (a.s === 'rising') { lift = 26 * a.t; out = 0.35 + 0.5 * a.t; }
      else if (a.s === 'slam') { lift = 26 * (1 - a.t) - 6 * a.t; out = 0.85 + 0.15 * a.t; }
      else if (a.s === 'recover') { lift = 4 * (1 - a.t); out = 0.7 * (1 - a.t) + 0.2; }
      else { lift = 5 + Math.sin(t * 1.1 + i) * 3; out = 0.3; }

      const baseX = Math.sin(a.a) * 11;
      const baseZ = Math.cos(a.a) * 11;
      const wave = Math.sin(t * 0.8 + i * 1.3) * 6;
      const tipX = a.s === 'idle'
        ? Math.sin(a.a) * (idleReach + wave)
        : baseX + (tx - baseX) * Math.max(out, 0.6);
      const tipZ = a.s === 'idle'
        ? Math.cos(a.a) * (idleReach + wave)
        : baseZ + (tz - baseZ) * Math.max(out, 0.6);

      for (let s = 0; s < SEGS; s++) {
        const f = s / (SEGS - 1);
        const curl = Math.sin(f * Math.PI) * (a.s === 'rising' ? 10 : 5);
        arm.pts[s].set(
          baseX + (tipX - baseX) * f + Math.sin(t * 1.7 + i + f * 4) * 1.4 * f,
          2 + lift * Math.sin(f * Math.PI * 0.85) + curl * 0.35,
          baseZ + (tipZ - baseZ) * f + Math.cos(t * 1.5 + i + f * 4) * 1.4 * f
        );
      }
      arm.curve.points = arm.pts;
      const fresh = new THREE.TubeGeometry(arm.curve, SEGS - 1, 2.6, 8, false);
      // Taper: thick at the mantle, thin at the tip.
      const pos = fresh.attributes.position;
      const centre = new THREE.Vector3();
      for (let s = 0; s <= SEGS - 1; s++) {
        const f = s / (SEGS - 1);
        arm.curve.getPoint(f, centre);
        const scale = 1 - f * 0.72;
        for (let r = 0; r <= 8; r++) {
          const idx = s * 9 + r;
          if (idx >= pos.count) break;
          pos.setXYZ(idx,
            centre.x + (pos.getX(idx) - centre.x) * scale,
            centre.y + (pos.getY(idx) - centre.y) * scale,
            centre.z + (pos.getZ(idx) - centre.z) * scale);
        }
      }
      fresh.computeVertexNormals();
      arm.mesh.geometry.dispose();
      arm.mesh.geometry = fresh;
    });
  }
}
