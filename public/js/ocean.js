import * as THREE from 'three';
import { wavesGLSL } from '/shared/waves.js';

const VERT = /* glsl */ `
uniform float uTime;
uniform vec2  uOffset;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
varying float vTsu;
varying float vFade;

${wavesGLSL()}

void main() {
  vec2 p = position.xz + uOffset;

  // Out past the detailed grid there are not enough vertices left to carry the
  // swell, and undersampled waves shatter into shards. Settle the sea down into
  // flat water before that happens and let the haze take it from there.
  float d = length(position.xz);
  // Must reach zero before the coarse skirt starts at 190 m.
  float fade = 1.0 - smoothstep(115.0, 185.0, d);

  vec3 nrm;
  vec3 disp = gerstner(p, uTime, fade, nrm);
  nrm = normalize(mix(vec3(0.0, 1.0, 0.0), nrm, fade));

  // The rogue wave keeps its full height everywhere — it is long enough that
  // even the coarse skirt can carry it, and you want to see it coming.
  float ts = tsunami(p);
  vec3 world = vec3(p.x + disp.x, disp.y + ts, p.y + disp.z);

  vWorld = world;
  vNormal = tsunamiTilt(p, nrm);
  vCrest = disp.y;
  vTsu = uTsu.w > 0.0 ? ts / uTsu.w : 0.0;
  vFade = fade;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uSea;   // also declared in the vertex stage by the wave GLSL
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
varying float vTsu;
varying float vFade;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);

  // Water body colour: steeper viewing angle looks deeper.
  float facing = clamp(dot(N, V), 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, pow(facing, 1.6) * 0.85);

  // Sky reflection through a Schlick fresnel.
  float fres = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uSkyColor, clamp(R.y * 1.6, 0.0, 1.0));

  // Sun glitter.
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0) * 1.9
             + pow(max(dot(N, H), 0.0), 26.0) * 0.16;

  // Foam rides the crests, and a little more where the water is steep.
  float steep = 1.0 - clamp(N.y, 0.0, 1.0);
  float crest = vCrest / max(uSea, 0.25);
  float foam = smoothstep(0.62, 1.05, crest) * 0.55 + smoothstep(0.16, 0.42, steep) * 0.5;
  foam *= 0.9 * vFade;
  // A band of white along the top of the rogue wave — not the whole raised sea.
  foam += smoothstep(0.55, 0.98, vTsu) * 0.45;

  vec3 col = mix(body, sky, fres);
  col += uSunColor * spec;
  col += max(dot(N, uSunDir), 0.0) * 0.045;
  col = mix(col, vec3(0.93, 0.96, 0.97), clamp(foam, 0.0, 0.72));

  // Blend into the haze so the flat water beyond the swell reads as distance.
  float fog = smoothstep(260.0, 1700.0, dist);
  col = mix(col, uHorizon, fog);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Ocean {
  constructor(scene, sunDir) {
    this.uniforms = {
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector2() },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(1.0, 0.93, 0.78) },
      uSkyColor: { value: new THREE.Color(0.32, 0.52, 0.78) },
      uHorizon: { value: new THREE.Color(0.66, 0.75, 0.83) },
      uDeep: { value: new THREE.Color(0.014, 0.055, 0.105) },
      uShallow: { value: new THREE.Color(0.05, 0.22, 0.27) },
      uSea: { value: 1 },
      uTsu: { value: new THREE.Vector4(1, 0, 0, 0) }, // xy dir, z crest, w amplitude
      uTsuWidth: { value: 70 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });
    this.material = mat;

    // Dense grid under the player...
    this.cell = 400 / 256;
    const near = new THREE.PlaneGeometry(400, 400, 256, 256).rotateX(-Math.PI / 2);
    this.near = new THREE.Mesh(near, mat);
    this.near.frustumCulled = false;

    // ...and a flat skirt of calm water carrying it out to the horizon. The
    // square's corners reach past the ring's inner edge, so the two overlap and
    // are exactly coplanar out there — nudge the skirt back in depth or the
    // overlap z-fights.
    const skirtMat = mat.clone();
    skirtMat.uniforms = mat.uniforms; // share the live uniforms, not a copy
    skirtMat.polygonOffset = true;
    skirtMat.polygonOffsetFactor = 1;
    skirtMat.polygonOffsetUnits = 2;
    const far = new THREE.RingGeometry(190, 4000, 96, 6).rotateX(-Math.PI / 2);
    this.far = new THREE.Mesh(far, skirtMat);
    this.far.frustumCulled = false;

    scene.add(this.near, this.far);
  }

  /**
   * Keep the grid under the ship, snapped to a cell so vertices don't swim.
   * Both meshes live at the origin — the shader does the sliding via uOffset,
   * which is why it builds world position itself instead of using modelMatrix.
   */
  update(time, centerX, centerZ, sea = 1, tsunami = null) {
    this.uniforms.uTime.value = time;
    this.uniforms.uSea.value = sea;
    const sx = Math.round(centerX / this.cell) * this.cell;
    const sz = Math.round(centerZ / this.cell) * this.cell;
    this.uniforms.uOffset.value.set(sx, sz);

    const t = this.uniforms.uTsu.value;
    if (tsunami) {
      t.set(tsunami.dx, tsunami.dz, (time - tsunami.t0) * tsunami.speed, tsunami.amp);
      this.uniforms.uTsuWidth.value = tsunami.width;
    } else {
      t.w = 0;
    }
  }
}
