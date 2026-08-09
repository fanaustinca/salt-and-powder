import * as THREE from 'three';
import { waterHeight } from '/shared/waves.js';

// The ribbon is bounded by segment COUNT, not just by time. Time alone lets it
// grow without limit as the ship speeds up — at 9 m/s a 9.5 s trail is 80 m of
// ribbon, which reads as a permanent scar rather than a wake.
const MAX = 40;          // hard cap: 40 x SPACING = ~44 m of trail, ever
const SPACING = 1.1;     // metres between drops
const PLAIN_LIFE = 3.5;  // plain foam dies away quickly — it is not a feature
const TRAIL_LIFE = 5.5;  // a trail you paid for streams a bit further astern

/** A foam ribbon trailing astern, laid on the water surface. */
export class Wake {
  constructor(scene) {
    this.points = [];
    this.trailId = null;
    this.alphaScale = 1;
    this.life = PLAIN_LIFE;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 2 * 3);
    this.alpha = new Float32Array(MAX * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    const idx = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);

    this.age = new Float32Array(MAX * 2);
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1));

    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uA: { value: new THREE.Color('#eef6f9') },
          uB: { value: new THREE.Color('#c4dae6') },
          uGlow: { value: 0 },
        },
        vertexShader: `
          attribute float aAlpha;
          attribute float aAge;
          varying float vA;
          varying float vAge;
          void main() {
            vA = aAlpha;
            vAge = aAge;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 uA;
          uniform vec3 uB;
          uniform float uGlow;
          varying float vA;
          varying float vAge;
          void main() {
            if (vA <= 0.001) discard;
            // Fresh water astern is the bright colour; it cools as it falls back.
            vec3 col = mix(uA, uB, vAge);
            col += uA * uGlow * (1.0 - vAge) * 0.85;
            gl_FragColor = vec4(col, vA);
          }`,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.geo = geo;
    scene.add(this.mesh);
  }

  /** Call every frame with the ship's position, heading and speed. */
  update(x, z, heading, speed, t, dt) {
    const head = this.points[this.points.length - 1];
    const moved = head ? Math.hypot(x - head.x, z - head.z) : Infinity;
    if (moved > SPACING) {
      this.points.push({ x, z, h: heading, born: t, w: 0.7 + Math.min(speed, 8) * 0.13 });
      if (this.points.length > MAX) this.points.shift();
    }

    // Drop what has faded out. Skipping them instead of removing them left the
    // buffer full of dead points and ate the segment budget at speed.
    while (this.points.length && t - this.points[0].born > this.life) this.points.shift();

    let n = 0;
    for (const p of this.points) {
      const age = t - p.born;
      const life = 1 - age / this.life;
      const spread = p.w * (1 + age * 0.13);
      // Perpendicular to the heading the ship had when this drop was laid.
      const px = Math.cos(p.h) * spread;
      const pz = -Math.sin(p.h) * spread;

      // Sit a touch proud of the surface, or wave crests chop the ribbon into
      // floating fragments as it passes behind them.
      const y = waterHeight(p.x, p.z, t) + 0.14;
      this.pos.set([p.x - px, y, p.z - pz, p.x + px, y, p.z + pz], n * 6);
      // Brightest just astern, and gone well before the end of its life.
      const a = Math.pow(life, 2.2) * 0.4 * Math.min(1, speed / 2.2) * this.alphaScale;
      this.alpha[n * 2] = a;
      this.alpha[n * 2 + 1] = a;
      this.age[n * 2] = 1 - life;
      this.age[n * 2 + 1] = 1 - life;
      n++;
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aAge.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }

  /** Wear a bought trail. Glowing ones burn additively over the water. */
  setTrail(trail) {
    if (this.trailId === trail.id) return;
    this.trailId = trail.id;
    const u = this.mesh.material.uniforms;
    u.uA.value.set(trail.a);
    u.uB.value.set(trail.b);
    u.uGlow.value = trail.glow;
    const additive = trail.glow > 0.5;
    const bought = trail.price > 0;
    this.mesh.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    // White foam reads at low opacity; a colour has to fight the water it sits
    // on, and additive over bright water needs pulling back or it blows out.
    this.alphaScale = additive ? 1.35 : bought ? 1.55 : 1;
    this.life = bought ? TRAIL_LIFE : PLAIN_LIFE;
    this.mesh.material.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
    this.mesh.material.dispose();
  }
}
