// Gerstner wave field. The JS version (used for ship buoyancy) and the GLSL
// version (used to displace the ocean mesh) are generated from the same table,
// so hulls always sit in the water the player can see.

export const GRAVITY = 9.81;

// dir is normalised at load; len = wavelength (m); steep 0..1 controls the peak sharpness.
export const WAVES = [
  { dir: [1.0, 0.32], amp: 0.62, len: 74, steep: 0.72, phase: 0.0 },
  { dir: [0.72, -1.0], amp: 0.38, len: 41, steep: 0.66, phase: 1.7 },
  { dir: [-0.45, 1.0], amp: 0.22, len: 23, steep: 0.58, phase: 3.4 },
  { dir: [1.0, 0.95], amp: 0.11, len: 12.5, steep: 0.5, phase: 5.1 },
];

for (const w of WAVES) {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  w.dir = [w.dir[0] / l, w.dir[1] / l];
  w.k = (Math.PI * 2) / w.len;
  w.omega = Math.sqrt(GRAVITY * w.k); // deep-water dispersion
  w.q = w.steep / (w.k * w.amp * WAVES.length);
}

/**
 * Live sea state, shared by every consumer on this process.
 *   scale   — swell height multiplier, driven by how hard it is blowing
 *   tsunami — the one rogue wave crossing the map, or null
 *
 * The server sets this from its own weather; each client sets it from the
 * snapshot, so both sides agree on where the water is.
 */
export const SEA = { scale: 1, tsunami: null };

/** Sea state that a given wind speed (m/s) eventually works up to. */
export function seaStateFor(windSpeed) {
  const s = 0.32 + 0.082 * (windSpeed - 4);
  return s < 0.3 ? 0.3 : s > 2.7 ? 2.7 : s;
}

/**
 * A tsunami is one travelling ridge: a deep trough out front (the drawback you
 * see before it lands) followed by a single enormous crest.
 *
 *   ts = { dx, dz, t0, speed, amp, width }
 * where the crest passes the world origin at t0 and runs along (dx, dz).
 */
export function tsunamiAt(x, z, t, ts) {
  if (!ts) return 0;
  const front = (t - ts.t0) * ts.speed;
  const s = x * ts.dx + z * ts.dz;
  const u = (s - front) / ts.width;
  if (u < -6 || u > 9) return 0;
  const crest = Math.exp(-u * u * 0.5);
  const draw = Math.exp(-((u - 2.4) * (u - 2.4)) * 0.32);
  return ts.amp * (crest - 0.45 * draw);
}

/** Up-slope of the rogue wave alone (dh/dx, dh/dz) — what makes ships surf. */
export function tsunamiSlope(x, z, t, ts, out = { x: 0, z: 0 }) {
  out.x = 0;
  out.z = 0;
  if (!ts) return out;
  const e = 6;
  const d =
    (tsunamiAt(x + ts.dx * e, z + ts.dz * e, t, ts) -
      tsunamiAt(x - ts.dx * e, z - ts.dz * e, t, ts)) /
    (2 * e);
  out.x = d * ts.dx;
  out.z = d * ts.dz;
  return out;
}

/** Displacement of the water surface for the undisplaced grid point (x, z). */
export function gerstner(x, z, t, scale = 1, out = { x: 0, y: 0, z: 0 }) {
  // Horizontal motion grows slower than height, or a big sea pinches into loops.
  const hs = Math.pow(scale, 0.6);
  out.x = 0;
  out.y = 0;
  out.z = 0;
  for (const w of WAVES) {
    const f = w.k * (w.dir[0] * x + w.dir[1] * z) - w.omega * t + w.phase;
    const c = Math.cos(f);
    out.x += w.q * w.amp * w.dir[0] * c * hs;
    out.z += w.q * w.amp * w.dir[1] * c * hs;
    out.y += w.amp * Math.sin(f) * scale;
  }
  return out;
}

const _d = { x: 0, y: 0, z: 0 };

/**
 * Height of the surface directly above/below world position (x, z).
 * Gerstner waves move points horizontally, so invert that with a couple of
 * fixed-point iterations before reading the height.
 */
export function waterHeight(x, z, t, scale = SEA.scale, ts = SEA.tsunami) {
  let qx = x;
  let qz = z;
  for (let i = 0; i < 3; i++) {
    gerstner(qx, qz, t, scale, _d);
    qx = x - _d.x;
    qz = z - _d.z;
  }
  gerstner(qx, qz, t, scale, _d);
  return _d.y + tsunamiAt(x, z, t, ts);
}

/** Up-slope of the sea at a point, handy for surge and for leaning the hull. */
export function waterSlope(x, z, t, step = 4) {
  const hx = waterHeight(x + step, z, t) - waterHeight(x - step, z, t);
  const hz = waterHeight(x, z + step, t) - waterHeight(x, z - step, t);
  return { x: hx / (2 * step), z: hz / (2 * step) };
}

/** GLSL source for the same field, injected into the ocean shader. */
export function wavesGLSL() {
  const rows = WAVES.map(
    (w) =>
      `  W(vec2(${w.dir[0].toFixed(5)}, ${w.dir[1].toFixed(5)}), ${w.amp.toFixed(
        4
      )}, ${w.k.toFixed(6)}, ${w.omega.toFixed(6)}, ${w.q.toFixed(5)}, ${w.phase.toFixed(4)});`
  ).join('\n');

  return /* glsl */ `
uniform float uSea;          // swell height multiplier
uniform vec4  uTsu;          // xy = travel direction, z = crest position, w = amplitude
uniform float uTsuWidth;

float tsunami(vec2 p) {
  if (uTsu.w <= 0.0) return 0.0;
  float u = (dot(p, uTsu.xy) - uTsu.z) / uTsuWidth;
  if (u < -6.0 || u > 9.0) return 0.0;
  float crest = exp(-u * u * 0.5);
  float draw  = exp(-(u - 2.4) * (u - 2.4) * 0.32);
  return uTsu.w * (crest - 0.45 * draw);
}

/** Lean the surface normal onto the long, smooth face of the rogue wave. */
vec3 tsunamiTilt(vec2 p, vec3 nrm) {
  if (uTsu.w <= 0.0) return nrm;
  float e = 6.0;
  float dh = (tsunami(p + uTsu.xy * e) - tsunami(p - uTsu.xy * e)) / (2.0 * e);
  return normalize(nrm - vec3(uTsu.x, 0.0, uTsu.y) * dh);
}

vec3 gerstner(vec2 p, float t, float fade, out vec3 nrm) {
  float sc = uSea * fade;
  float hs = pow(max(sc, 0.0001), 0.6);
  vec3 disp = vec3(0.0);
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bino = vec3(0.0, 0.0, 1.0);
  #define W(D, A, K, OM, Q, PH) { \\
    float f = K * dot(D, p) - OM * t + PH; \\
    float c = cos(f), s = sin(f); \\
    disp.xz += Q * A * D * c * hs; \\
    disp.y  += A * s * sc; \\
    tang.x  -= Q * A * D.x * D.x * K * s * hs; \\
    tang.y  += D.x * A * K * c * sc; \\
    tang.z  -= Q * A * D.x * D.y * K * s * hs; \\
    bino.x  -= Q * A * D.x * D.y * K * s * hs; \\
    bino.y  += D.y * A * K * c * sc; \\
    bino.z  -= Q * A * D.y * D.y * K * s * hs; \\
  }
${rows}
  #undef W
  nrm = normalize(cross(bino, tang));
  return disp; // the rogue wave is added by the caller, so foam can tell them apart
}
`;
}
