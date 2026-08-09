import * as THREE from 'three';
import { waterHeight } from '/shared/waves.js';
import { MAX_RANGE, MIN_RANGE, batteryForBearing } from '/shared/combat.js';
import { normalizeAngle } from '/shared/physics.js';

const SEGS = 26;          // points along the aim line
const START_OUT = 6;      // begin clear of the hull rather than inside it
const LIFT = 0.9;         // ride above the surface so swell does not swallow it

const READY = new THREE.Color('#e8b455');
const BLOCKED = new THREE.Color('#e07a5f');

/**
 * Mouse gunnery. Casts the pointer onto the sea, draws a line from the ship to
 * wherever you are pointing with a ring at the end, and reports the bearing and
 * range for the host to resolve.
 *
 * Gold means a gun can bear, is loaded and the spot is in reach. Red means it
 * cannot: out of range, still reloading, or no gun covers that bearing.
 */
export class Aim {
  constructor(scene, camera) {
    this.camera = camera;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2(0, 0);
    this.point = new THREE.Vector3();
    this.bearing = 0;
    this.range = 0;
    this.battery = null;

    // The line drapes over the swell rather than cutting through it, and draws
    // on top of everything — it is a sight, not something floating in the world.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEGS * 3), 3));
    this.lineGeo = geo;
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: READY, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false,
    }));
    this.line.frustumCulled = false;
    this.line.renderOrder = 20;
    scene.add(this.line);

    const ring = new THREE.RingGeometry(1.7, 2.5, 32).rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
      color: READY, transparent: true, opacity: 0.9,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.marker.renderOrder = 21;
    this.marker.frustumCulled = false;
    scene.add(this.marker);
  }

  setPointer(clientX, clientY) {
    this.ndc.x = (clientX / innerWidth) * 2 - 1;
    this.ndc.y = -(clientY / innerHeight) * 2 + 1;
  }

  /**
   * Resolve the pointer onto the sea and redraw the sight.
   * Returns { b, r } when a shot is actually possible, otherwise null.
   */
  update(ship, guns, reload, t, visible) {
    this.line.visible = visible;
    this.marker.visible = visible;
    if (!visible) return null;

    // Cast onto flat water, then settle onto the real wave height — one
    // correction is plenty at these grazing angles.
    this.ray.setFromCamera(this.ndc, this.camera);
    const dir = this.ray.ray.direction;
    const org = this.ray.ray.origin;
    if (dir.y > -0.02) { this.line.visible = this.marker.visible = false; return null; }
    let s = -org.y / dir.y;
    this.point.copy(org).addScaledVector(dir, s);
    const h0 = waterHeight(this.point.x, this.point.z, t);
    s = (h0 - org.y) / dir.y;
    this.point.copy(org).addScaledVector(dir, s);

    const dx = this.point.x - ship.x;
    const dz = this.point.z - ship.z;
    this.range = Math.hypot(dx, dz);
    this.bearing = normalizeAngle(Math.atan2(dx, dz) - ship.heading);
    this.battery = batteryForBearing(this.bearing);

    const owned = this.battery ? (guns?.[this.battery] ?? 0) > 0 : false;
    const loaded = this.battery ? (reload?.[this.battery] ?? 0) <= 0 : false;
    const inRange = this.range >= MIN_RANGE * 0.5 && this.range <= MAX_RANGE;
    const can = owned && loaded && inRange;

    const colour = can ? READY : BLOCKED;
    this.line.material.color.copy(colour);
    this.marker.material.color.copy(colour);
    this.line.material.opacity = can ? 0.85 : 0.6;
    this.marker.material.opacity = can ? 0.9 : 0.6;

    // Draw from just outside the hull out to the pointer, following the swell.
    const pos = this.lineGeo.attributes.position.array;
    const total = Math.max(this.range, 0.001);
    const ux = dx / total;
    const uz = dz / total;
    const from = Math.min(START_OUT, total * 0.5);
    for (let i = 0; i < SEGS; i++) {
      const d = from + (total - from) * (i / (SEGS - 1));
      const x = ship.x + ux * d;
      const z = ship.z + uz * d;
      pos[i * 3] = x;
      pos[i * 3 + 1] = waterHeight(x, z, t) + LIFT;
      pos[i * 3 + 2] = z;
    }
    this.lineGeo.attributes.position.needsUpdate = true;

    this.marker.position.set(this.point.x, h0 + LIFT, this.point.z);
    // Keep the ring a readable size whatever the zoom.
    const d = this.camera.position.distanceTo(this.marker.position);
    this.marker.scale.setScalar(THREE.MathUtils.clamp(d / 45, 0.7, 3));

    return can ? { b: this.bearing, r: this.range } : null;
  }
}
