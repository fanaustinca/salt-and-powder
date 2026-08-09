import * as THREE from 'three';
import { SHOT, AMMO, TNT, muzzle, stepShot } from '/shared/combat.js';
import { waterHeight } from '/shared/waves.js';

/**
 * Everything you see of a fight. The server decides what hit what; this replays
 * the same ballistics from the same launch data so the ball you watch lands
 * where the server said it did.
 */
export class CombatFX {
  constructor(scene, net) {
    this.scene = scene;
    this.net = net;
    this.shots = [];
    this.puffs = [];
    this.rings = [];
    this.barrels = [];

    const ballGeo = new THREE.SphereGeometry(SHOT.radius, 10, 8);
    this.ballMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.55, metalness: 0.3 });
    this.hotMat = new THREE.MeshStandardMaterial({
      color: 0xff7a2a, emissive: 0xff5510, emissiveIntensity: 2.4, roughness: 0.5,
    });
    this.ballGeo = ballGeo;

    // One shared billboard for smoke, splash and fire — recoloured per use.
    this.puffGeo = new THREE.PlaneGeometry(1, 1);
    this.smokeTex = softDisc(0.55);
    this.ringTex = ringTexture();

    this.barrelGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.3, 10);
    this.barrelMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });

    net.socket.on('shot', (m) => this.onShot(m));
    net.socket.on('splash', (m) => this.splash(m.x, m.z, m.r));
    net.socket.on('hit', (m) => this.impact(m));
    net.socket.on('boom', (m) => this.explosion(m.x, m.z, m.r));
    net.socket.on('barrel', (m) => this.addBarrel(m));
  }

  /** Recreate a whole broadside from the launch data the server sent. */
  onShot(m) {
    const ship = { x: m.x, z: m.z, heading: m.h, vx: m.vx, vz: m.vz };
    const hot = AMMO[m.ammo]?.burns || AMMO[m.ammo]?.blast;

    for (let i = 0; i < m.count; i++) {
      // Same launch data the host used, so the ball you watch is the ball it scored.
      const launch = muzzle(ship, m.battery, i, m.count, m.seed, m.rb, m.el);
      const mesh = new THREE.Mesh(this.ballGeo, hot ? this.hotMat : this.ballMat);
      mesh.castShadow = false;
      this.scene.add(mesh);
      const s = { ...launch, age: 0, mesh, trail: 0 };
      mesh.position.set(s.x, s.y, s.z);
      this.shots.push(s);

      // Muzzle smoke, blown along the barrel.
      this.smoke(s.x, s.y + 0.3, s.z, 3.4, 0.9, 0xdfe3e6);
    }
  }

  update(dt, t) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const alive = stepShot(s, dt);
      s.mesh.position.set(s.x, s.y, s.z);

      // A thin smoke trail so you can read the arc.
      s.trail += dt;
      if (s.trail > 0.055) {
        s.trail = 0;
        this.smoke(s.x, s.y, s.z, 0.75, 0.42, 0xc9ced2);
      }

      if (!alive || s.y <= waterHeight(s.x, s.z, t)) {
        if (s.y <= waterHeight(s.x, s.z, t)) this.splash(s.x, s.z, 1.5);
        this.scene.remove(s.mesh);
        this.shots.splice(i, 1);
      }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.scene.remove(p.mesh);
        this.puffs.splice(i, 1);
        continue;
      }
      p.mesh.position.y += p.rise * dt;
      p.mesh.scale.setScalar(p.size * (0.5 + k * 1.6));
      p.mesh.material.opacity = p.alpha * (1 - k) * (1 - k);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.position.y = waterHeight(r.x, r.z, t) + 0.08;
      r.mesh.scale.setScalar(r.size * (0.35 + k * 1.9));
      r.mesh.material.opacity = 0.75 * (1 - k);
    }

    for (let i = this.barrels.length - 1; i >= 0; i--) {
      const b = this.barrels[i];
      const k = (t - b.born) / TNT.fuse;
      if (k > 1.05) {            // the server's 'boom' has been and gone
        this.scene.remove(b.mesh);
        this.barrels.splice(i, 1);
        continue;
      }
      b.mesh.position.y = waterHeight(b.x, b.z, t) + 0.35;
      b.mesh.rotation.z = Math.sin(t * 1.7 + b.id) * 0.22;
      b.mesh.rotation.x = Math.cos(t * 1.3 + b.id) * 0.18;
      // Fuse spark, redder and faster as the clock runs down.
      if (t - b.lastSpark > (k > 0.7 ? 0.09 : 0.18)) {
        b.lastSpark = t;
        this.smoke(b.x, b.mesh.position.y + 0.9, b.z, 0.5, 0.3, k > 0.7 ? 0xff9a3c : 0xd8dde0);
      }
    }
  }

  addBarrel(m) {
    const mesh = new THREE.Mesh(this.barrelGeo, this.barrelMat);
    mesh.position.set(m.x, 0, m.z);
    this.scene.add(mesh);
    this.barrels.push({ ...m, mesh, lastSpark: 0 });
  }

  smoke(x, y, z, size, life, colour) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.smokeTex, color: colour, transparent: true, depthWrite: false,
      opacity: 0.8, blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(this.puffGeo, mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.puffs.push({
      mesh, age: 0, life, size, alpha: 0.8, rise: 1.1 + Math.random(),
      face: null,
    });
  }

  splash(x, z, r) {
    this.ring(x, z, r * 2.2, 1.1, 0xdff0f6);
    for (let i = 0; i < 4; i++) {
      this.smoke(x + (Math.random() - 0.5) * 2, 0.6 + Math.random(), z + (Math.random() - 0.5) * 2,
        1.5, 0.7, 0xe8f4f8);
    }
  }

  impact(m) {
    for (let i = 0; i < 7; i++) {
      this.smoke(m.x + (Math.random() - 0.5) * 3, m.y + Math.random() * 2, m.z + (Math.random() - 0.5) * 3,
        1.7, 0.75, i % 2 ? 0x8a7060 : 0xd8d2c8);
    }
  }

  explosion(x, z, r) {
    this.ring(x, z, r * 0.9, 1.5, 0xffd9a0);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r * 0.55;
      this.smoke(x + Math.cos(a) * d, 0.5 + Math.random() * 7, z + Math.sin(a) * d,
        4 + Math.random() * 4, 1.1 + Math.random() * 0.7,
        i < 10 ? 0xffb04a : i < 18 ? 0x8d8d8d : 0x4a4a4a);
    }
  }

  ring(x, z, size, life, colour) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.ringTex, color: colour, transparent: true, depthWrite: false, opacity: 0.75,
    });
    const mesh = new THREE.Mesh(this.puffGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0, z);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.rings.push({ mesh, x, z, age: 0, life, size });
  }

  /** Billboards need to face the camera; done once per frame from outside. */
  faceCamera(camera) {
    for (const p of this.puffs) p.mesh.quaternion.copy(camera.quaternion);
  }
}

function softDisc(soft) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(soft, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 30, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
