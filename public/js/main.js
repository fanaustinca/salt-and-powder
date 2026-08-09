import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  TICK_DT, createShip, defaultInput, stepShip, normalizeAngle, clamp, classOf,
} from '/shared/physics.js';
import { waterHeight, SEA } from '/shared/waves.js';
import { Net } from './net.js';
import { Ocean } from './ocean.js';
import { Wake } from './wake.js';
import { Hud } from './hud.js';
import { Shop } from './shop.js';
import { Talents } from './talents.js';
import { trailOf } from '/shared/cosmetics.js';
import { AMMO } from '/shared/combat.js';
import {
  buildShip, animateSails, animatePennant, floatShip, makeLabel, recoilGuns, updateGuns, setGuns,
} from './ship.js';
import { CombatFX } from './combat-fx.js';
import { Aim } from './aim.js';
import { Islands, CargoDrops, SafeRings } from './islands.js';
import { Dock } from './dock.js';
import { KrakenFX } from './kraken-fx.js';
import { Lobby } from './lobby.js';
import { TouchControls, wantsTouch } from './touch.js';
import { FACTIONS } from '/shared/ai.js';

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.52;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.4, 30000);

// ------------------------------------------------------------------ sky + sun
const SUN_ELEV = 22;
const SUN_AZI = 128;
const phi = THREE.MathUtils.degToRad(90 - SUN_ELEV);
const theta = THREE.MathUtils.degToRad(SUN_AZI);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

const sky = new Sky();
sky.scale.setScalar(20000);
sky.material.uniforms.turbidity.value = 5.2;
sky.material.uniforms.rayleigh.value = 2.1;
sky.material.uniforms.mieCoefficient.value = 0.006;
sky.material.uniforms.mieDirectionalG.value = 0.83;
sky.material.uniforms.sunPosition.value.copy(sunDir);

scene.add(sky);

/**
 * Environment map for the hulls. Baking the Sky shader itself blows past what a
 * half-float target can hold near the sun disc, and the NaNs that come back
 * render every lit material pure black — so bake a hand-drawn LDR sky instead.
 */
function skyEnvironment() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#2f5f96');   // zenith
  grad.addColorStop(0.42, '#8fb4d4');
  grad.addColorStop(0.5, '#cddfe9');   // horizon haze
  grad.addColorStop(0.58, '#33566b');
  grad.addColorStop(1.0, '#0b1c28');   // sea below
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Soft sun, placed where the real one is (three's equirect convention).
  const u = Math.atan2(sunDir.z, -sunDir.x) / (Math.PI * 2) + 0.5;
  const v = Math.acos(THREE.MathUtils.clamp(sunDir.y, -1, 1)) / Math.PI;
  const glow = ctx.createRadialGradient(u * 512, v * 256, 0, u * 512, v * 256, 96);
  glow.addColorStop(0, 'rgba(255,248,226,0.95)');
  glow.addColorStop(0.35, 'rgba(255,236,196,0.35)');
  glow.addColorStop(1, 'rgba(255,236,196,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 256);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = skyEnvironment();
scene.environment = pmrem.fromEquirectangular(envTex).texture;
scene.environmentIntensity = 0.85;
envTex.dispose();

const sun = new THREE.DirectionalLight(0xfff0d4, 2.6);
sun.position.copy(sunDir).multiplyScalar(90);
sun.castShadow = true;
// Only the ship receives shadows (the ocean has its own shader), so this is
// really just the sail shading the deck — a small map is plenty.
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26;
sun.shadow.camera.bottom = -26;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 240;
sun.shadow.bias = -0.0012;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbfd8ef, 0x13232c, 0.65));
scene.fog = new THREE.Fog(0xa8bcc8, 900, 4200);

const ocean = new Ocean(scene, sunDir);
const islands = new Islands(scene);
const cargo = new CargoDrops(scene);
const safeRings = new SafeRings(scene);
const krakenFx = new KrakenFX(scene);

// ------------------------------------------------------------------ input
const keys = Object.create(null);
const input = defaultInput();
let inputSeq = 0;

// Thumb controls. Built lazily — see touch.js for why this is not a media query
// alone. The actions are arrows so they resolve against the panels below.
const touch = new TouchControls({
  onFire: () => { if (aimSolution) net.socket.emit('fire', aimSolution); },
  onBarrel: () => net.socket.emit('drop-tnt'),
  // Cycle only what is actually in the magazine. The host refuses shot you do
  // not hold, so cycling blindly meant the button did nothing at all until you
  // had crafted something — indistinguishable, on a phone, from it being broken.
  onAmmo: () => {
    const held = AMMO_ORDER.filter((a) => a === 'round' || (you.ammoStock?.[a] || 0) > 0);
    if (held.length < 2) {
      hud.toast('Only round shot aboard — craft more at the gunner\'s bench');
      return;
    }
    const next = held[(held.indexOf(you.ammo) + 1) % held.length];
    net.socket.emit('set-ammo', next);
    hud.toast(`${AMMO[next]?.name || next} in the guns`);
  },
  onTalents: () => talents.toggle(),
  onShop: () => shop.toggle(),
});
if (wantsTouch()) touch.enable();

/** True while the player is typing somewhere, e.g. the name box. */
function typingInField(e) {
  const el = e.target;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // These listeners are on window, so without this every letter of your name
  // also works the ship — "Austin" would furl the sail and open the talent
  // sheet before you had even joined.
  if (typingInField(e)) return;
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyT' && e.shiftKey) net.socket.emit('summon-tsunami'); // dev
  if (e.code === 'KeyB') shop.toggle();
  if (e.code === 'Escape') { shop.toggle(false); talents.toggle(false); }

  // --- gunnery (keyboard fallback; the mouse is the real way to aim) ---
  if (e.code === 'KeyZ') net.socket.emit('fire', 'port');
  if (e.code === 'KeyX') net.socket.emit('fire', 'starboard');
  if (e.code === 'KeyF') net.socket.emit('fire', 'bow');
  if (e.code === 'KeyV') net.socket.emit('fire', 'stern');
  if (e.code === 'KeyR') net.socket.emit('drop-tnt');

  if (e.code === 'KeyT' && !e.shiftKey) talents.toggle();

  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
  if (n >= 0) net.socket.emit('set-ammo', AMMO_ORDER[n]);
});
addEventListener('keyup', (e) => { if (!typingInField(e)) keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// Ammunition: 1 round, 2 chain, 3 grape, 4 heated, 5 explosive.
const AMMO_ORDER = ['round', 'chain', 'grape', 'heated', 'explosive'];

function readInput() {
  const k = (a, b) => (keys[a] ? 1 : 0) - (keys[b] ? 1 : 0);
  input.rudder = k('KeyD', 'KeyA') || k('ArrowRight', 'ArrowLeft'); // +1 = helm to starboard
  input.throttle = k('KeyW', 'KeyS') || k('ArrowUp', 'ArrowDown');
  touch.read(input, me?.throttle ?? 0);   // per-axis; the keyboard wins where it speaks
}

// ------------------------------------------------------------------ camera rig
const cam = { yaw: 0, pitch: 0.34, dist: 36, x: 0, y: 12, z: 0 };
let dragging = false;
let lastPointer = { x: 0, y: 0 };

let dragDist = 0;

// A finger has no hover, so where you are pointing is only known once you touch
// the glass — and a tap can be over before the next frame runs. Solve the shot
// here rather than reading the one the last frame happened to leave behind, or
// a tap fires at wherever you tapped previously.
function fireAt(clientX, clientY) {
  if (!me) return;
  aim.setPointer(clientX, clientY);
  const solved = aim.update(me, you.guns, you.reload, net.serverNow(),
    !me.sunk && !shop.open && !talents.open);
  if (solved) net.socket.emit('fire', solved);
}

// Live touches on the canvas, so two fingers can pinch the camera in and out.
const touches = new Map();
let pinchFrom = 0;
const spread = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') {
    touch.enable();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { pinchFrom = spread(); dragging = false; return; }
    if (touches.size > 2) return;
  }
  dragging = true;
  dragDist = 0;
  lastPointer = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointerup', (e) => {
  canvas.releasePointerCapture?.(e.pointerId);
  const wasPinching = touches.size >= 2;
  touches.delete(e.pointerId);
  // A click or tap that did not really move is a shot, not a drag — so you can
  // aim and fire without ever leaving the button, or lifting your thumb.
  if (dragging && !wasPinching && e.button === 0 && dragDist < 8) {
    fireAt(e.clientX, e.clientY);
  }
  dragging = false;
});
canvas.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); dragging = false; });

canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const now = spread();
    if (pinchFrom > 0 && now > 0) {
      cam.dist = clamp(cam.dist * (pinchFrom / now), 11, 95);
      pinchFrom = now;
    }
    return;
  }
  aim.setPointer(e.clientX, e.clientY);
  if (!dragging) return;
  const dx = e.clientX - lastPointer.x;
  const dy = e.clientY - lastPointer.y;
  dragDist += Math.hypot(dx, dy);
  if (dragDist >= 8) {
    cam.yaw -= dx * 0.005;
    cam.pitch = clamp(cam.pitch + dy * 0.004, -0.12, 1.05);
  }
  lastPointer = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.12), 11, 95);
  e.preventDefault();
}, { passive: false });

// ------------------------------------------------------------------ world objs
const ACCENTS = [0xa8342c, 0x2f6f8f, 0x6a8f3a, 0x8a5fa8, 0xc8862e, 0x3f8f74, 0xb03f74, 0x4a5fa8];
const accentFor = (id) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
};

const net = new Net();
const hud = new Hud();
const shop = new Shop(net, (msg) => hud.toast(msg));
const fx = new CombatFX(scene, net);
const talents = new Talents(net, (msg) => hud.toast(msg));
const aim = new Aim(scene, camera);
const dock = new Dock(net, (m) => hud.toast(m));
let aimSolution = null;

// Private state the server keeps for you alone: reload timers, XP, barrels.
let you = { hp: 100, maxHp: 100, xp: 0, level: 1, picks: {}, barrels: 1, free: 0,
            guns: { port: 1, starboard: 1, bow: 0, stern: 0 },
            ammo: 'round', reload: { port: 0, starboard: 0, bow: 0, stern: 0 }, armour: 0 };
net.socket.on('you', (m) => {
  you = m;
  you.crowns = shop.profile.crowns;
  talents.sync(m);
  dock.update(you, myHome);
});
net.socket.on('fleet', ({ name, size }) => hud.toast(`${name} sighted — ${size} sail`));
net.socket.on('consort', ({ cls, n, of }) =>
  hud.toast(`A consort joins your fleet — ${n} of ${of} sail`));
net.socket.on('kraken-rises', () => hud.toast('Something is coming up under you...'));
net.socket.on('loot', ({ name, reduce }) =>
  hud.toast(`${name} recovered — ${Math.round(reduce * 100)}% off every hit`));
net.socket.on('sunk', ({ id, name, by }) => {
  hud.toast(id === net.id ? `You were sunk by ${by}` : `${name} was sunk by ${by}`);
});
net.socket.on('respawned', ({ x, z, h }) => {
  if (!me) return;
  Object.assign(me, { x, z, heading: h, vx: 0, vz: 0, omega: 0, sunk: false, hp: me.maxHp });
  hud.toast('A fresh hull. Back to sea.');
});
net.socket.on('shot', (m) => {
  if (m.by === net.id && myVisual) recoilGuns(myVisual, m.battery, 1);
  else {
    const r = remotes.get(m.by);
    if (r) recoilGuns(r.vis, m.battery, 1);
  }
});
let me = null;              // locally predicted ship (shared/physics state)
let myVisual = null;
let myWake = null;
const remotes = new Map();  // id -> { vis, wake, label, x, z, h }

function makeVisual(id, name, isMe, cls = 'sailboat', faction = null) {
  const accent = faction && FACTIONS[faction] ? FACTIONS[faction].accent : accentFor(id);
  const vis = buildShip(accent, cls);
  scene.add(vis.group);
  vis.label = makeLabel(name, isMe ? 0xe8b455 : 0xffffff);
  vis.label.position.set(0, vis.rig.mastH + 6, 0);
  vis.group.add(vis.label);
  vis.name = name;
  vis.isMe = isMe;
  vis.faction = faction;
  return vis;
}

/**
 * Trading up is a different ship, not a bigger one, so the whole model is
 * rebuilt when the class changes.
 */
function reclass(vis, id, cls, faction) {
  if (!vis || vis.clsKey === cls) return vis;
  scene.remove(vis.group);
  // Hull geometry and materials are cached and shared between ships of a class,
  // so nothing here is ours to dispose.
  return makeVisual(id, vis.name, vis.isMe, cls, faction ?? vis.faction);
}

// ------------------------------------------------------------------ join flow
let myName = 'Sailor';
let myHome = null;

// Rejoin after a dropped connection or a server restart, rather than sitting
// there watching an empty sea forever.
net.socket.on('connect', () => { if (me || myVisual) net.join(myName); });
// A guest whose host closes their tab has nothing left to reconnect to. Say so
// plainly and leave it said — a toast fades, and a frozen sea with no
// explanation reads as a bug in the game.
net.socket.on('disconnect', () => {
  if (net.socket.mode !== 'guest') return;
  hud.toast('Lost the host — the lobby has closed.');
  const chip = document.getElementById('lobbychip');
  if (chip) {
    chip.classList.add('gone');
    chip.innerHTML = '<span class="lbl">LOBBY</span><b>CLOSED</b><span class="cp">host left</span>';
  }
});

// The lobby owns the join card and decides how we get to sea: this server, a
// lobby hosted in this tab, or a data channel to somebody else's. By the time
// it calls back, net.socket has a wire behind it.
const lobby = new Lobby(net.socket, (name) => {
  myName = name;
  net.join(myName);
  hud.show();
  canvas.focus();
});
lobby.open();

net.onInit = (msg) => {
  const mine = msg.state.ships.find((s) => s.id === msg.id);
  me = createShip(msg.id, mine?.n || myName, 0, mine?.c || 'sailboat');
  if (mine) Object.assign(me, { x: mine.x, z: mine.z, heading: mine.h, throttle: mine.th ?? 0.6 });
  // Start the sail lever showing the canvas she is already carrying, rather
  // than ordering a change the moment you get the helm.
  touch.syncSail(me.throttle);
  myHome = msg.home;
  if (!myVisual) {
    myVisual = makeVisual(msg.id, me.name, true, me.cls);
    myWake = new Wake(scene);
  }
  if (msg.profile) shop.setProfile({ ...msg.profile, result: 'init' });
  cam.yaw = 0;
  hud.toast('You have the helm. Full ahead.');
};
net.onJoined = ({ name }) => hud.toast(`${name} weighed anchor`);
net.onLeft = ({ name }) => hud.toast(`${name} sailed away`);

// ------------------------------------------------------------------ main loop
let acc = 0;
let sendAcc = 0;
let prev = performance.now();

function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now();
  let dt = (nowMs - prev) / 1000;
  prev = nowMs;
  if (dt > 0.2) dt = 0.2;

  const t = net.snapshots.length ? net.serverNow() : nowMs / 1000;

  // Everything that reads the water — buoyancy, wake, camera — goes through
  // this, so the sea the physics feels is the sea the shader draws.
  SEA.scale = net.sea;
  SEA.tsunami = net.tsunami;

  if (me) {
    readInput();

    // Local prediction on exactly the server's fixed step.
    acc += dt;
    let guard = 0;
    while (acc >= TICK_DT && guard++ < 8) {
      stepShip(me, input, TICK_DT, t);
      acc -= TICK_DT;
    }

    sendAcc += dt;
    if (sendAcc > 1 / 20) { sendAcc = 0; net.sendInput(input, ++inputSeq); }

    reconcile(dt);
    me.rudder = input.rudder;
    myWake.setTrail(shop.trail);
    myVisual = reclass(myVisual, net.id, you.cls || me.cls);
    setGuns(myVisual, you.guns);
    drawShip(myVisual, myWake, me.x, me.z, me.heading, me.speed, t, dt, me);
    if (!window.__freezeCamera) updateCamera(dt, t);
  }

  // One interpolation per frame, shared by the roster and the remote ships.
  const others = me ? listOthers() : [];
  if (me) hud.update(me, others, net, waveWarning(t), you);
  syncRemotes(others, t, dt);

  aimSolution = me
    ? aim.update(me, you.guns, you.reload, t, !me.sunk && !shop.open && !talents.open)
    : null;

  fx.update(dt, t);
  fx.faceCamera(camera);
  if (myVisual) updateGuns(myVisual, dt);
  for (const r of remotes.values()) updateGuns(r.vis, dt);
  ocean.update(t, camera.position.x, camera.position.z, net.sea, net.tsunami);
  cargo.sync(net.drops, t, waterHeight);
  safeRings.update(t, camera.position.x, camera.position.z, waterHeight);
  krakenFx.update(net.kraken, t);

  if (me) {
    sun.position.set(me.x, 0, me.z).addScaledVector(sunDir, 110);
    sun.target.position.set(me.x, 0, me.z);
    sun.target.updateMatrixWorld();
  }

  renderer.render(scene, camera);
}

function listOthers() {
  return net.interpolated().filter((o) => o.id !== net.id);
}

/**
 * When the rogue wave reaches *this* ship, not the middle of the chart — the
 * crest is a moving plane, so ships on the near side get hit first.
 */
let warnedFor = null;
function waveWarning(t) {
  const ts = net.tsunami;
  if (!ts || !me) return null;
  const s = me.x * ts.dx + me.z * ts.dz;
  const eta = ts.t0 + s / ts.speed - t;

  if (eta < 40 && eta > 0 && warnedFor !== ts.t0) {
    warnedFor = ts.t0;
    hud.toast('Rogue wave running — turn your bow into it!');
  }
  return { eta, amp: ts.amp, fromAbs: Math.atan2(-ts.dx, -ts.dz) };
}

/** Nudge the prediction back toward the server without visible snapping. */
function reconcile(dt) {
  const auth = net.latest(net.id);
  if (!auth) return;
  const dx = auth.x - me.x;
  const dz = auth.z - me.z;
  const err = Math.hypot(dx, dz);

  if (err > 25) {
    Object.assign(me, {
      x: auth.x, z: auth.z, heading: auth.h, vx: auth.vx, vz: auth.vz,
      omega: auth.om, sheet: auth.sh, hoist: auth.ho,
    });
    return;
  }
  const k = Math.min(1, dt * 3);
  me.x += dx * k;
  me.z += dz * k;
  me.heading = normalizeAngle(me.heading + normalizeAngle(auth.h - me.heading) * k);
  me.vx += (auth.vx - me.vx) * k;
  me.vz += (auth.vz - me.vz) * k;
  me.hp = auth.hp;
  me.maxHp = auth.mhp;
  me.level = auth.lv;
  me.sunk = !!auth.sk;
  me.cls = auth.c || me.cls;
  me.sheet += (auth.sh - me.sheet) * k * 0.5;
  me.hoist += (auth.ho - me.hoist) * k * 0.5;
}

function syncRemotes(others, t, dt) {
  const seen = new Set();
  for (const o of others) {
    seen.add(o.id);
    let r = remotes.get(o.id);
    if (!r) {
      r = { vis: makeVisual(o.id, o.n, false, o.c || 'sailboat', o.fac), wake: new Wake(scene) };
      r.faction = o.fac;
      remotes.set(o.id, r);
    }
    r.wake.setTrail({ id: o.tr, ...trailOf(o.tr) });
    r.vis = reclass(r.vis, o.id, o.c || 'sailboat', o.fac);
    if (o.g) setGuns(r.vis, { port: o.g[0], starboard: o.g[1], bow: o.g[2], stern: o.g[3] });
    // Name tags go quiet with distance instead of shouting across the horizon.
    const far = Math.hypot(o.x - (me?.x ?? 0), o.z - (me?.z ?? 0));
    r.vis.label.material.opacity = clamp(1 - (far - 180) / 170, 0, 1);
    r.vis.label.visible = far < 360;

    drawShip(r.vis, r.wake, o.x, o.z, o.h, o.speed, t, dt, {
      throttle: o.th ?? 0.6, cls: o.c, sunk: !!o.sk, omega: 0,
    });
  }
  for (const [id, r] of remotes) {
    if (seen.has(id)) continue;
    scene.remove(r.vis.group);
    r.wake.dispose();
    remotes.delete(id);
  }
}

/** One ship's visuals: float the hull, swing the boom, shape the canvas. */
function drawShip(vis, wake, x, z, heading, speed, t, dt, s) {
  if (!vis) return;
  // She leans into a turn now rather than to the wind.
  const heelAmt = clamp(-(s.omega ?? 0) * 0.9, -0.35, 0.35);
  floatShip(vis.group, x, z, heading, t, heelAmt, vis.rig);

  // Going down: she settles by the head and rolls over as she goes.
  if (s.sunk) {
    if (vis.sunkSince == null) vis.sunkSince = t;
    const k = Math.min(1, (t - vis.sunkSince) / 6);
    vis.group.position.y -= k * k * 11;
    vis.group.rotateZ(k * 0.9);
    vis.group.rotateX(-k * 0.35);
    if (k > 0.02 && Math.random() < 0.25) {
      fx.smoke(x + (Math.random() - 0.5) * 6, 0.6, z + (Math.random() - 0.5) * 6, 2.2, 1.2, 0xdfe6ea);
    }
    wake.update(x, z, heading, 0, t, dt);
    return;
  }
  vis.sunkSince = null;

  // Sails are set for the run now — no trimming, so they simply draw with speed.
  const fill = clamp(0.25 + (s.throttle ?? 0.6) * 0.75, 0, 1);
  vis.sailPivot.rotation.y = -0.3;
  animateSails(vis, fill, t);
  animatePennant(vis, Math.PI, 0.7, t);
  vis.tiller.rotation.y = -(s.rudder || 0) * 0.4;

  wake.update(x, z, heading, speed, t, dt);
}

function updateCamera(dt, t) {
  const yaw = me.heading + cam.yaw;
  const h = Math.cos(cam.pitch) * cam.dist;
  const y = Math.sin(cam.pitch) * cam.dist;
  const targetX = me.x - Math.sin(yaw) * h;
  const targetZ = me.z - Math.cos(yaw) * h;
  const deck = waterHeight(me.x, me.z, t);
  const targetY = deck + 4.5 + y;

  const k = Math.min(1, dt * 5.5);
  cam.x += (targetX - cam.x) * k;
  cam.y += (targetY - cam.y) * k;
  cam.z += (targetZ - cam.z) * k;

  // Keep the lens above the water where the camera actually is — in a big sea
  // (or on the face of a rogue wave) that is nowhere near the height at the ship.
  const under = waterHeight(cam.x, cam.z, t);
  camera.position.set(cam.x, Math.max(cam.y, under + 2.2, deck - 2), cam.z);
  camera.lookAt(me.x, deck + 4.2, me.z);
}

/**
 * A phone held upright is the one shape this camera was never designed for.
 * Field of view is specified vertically, so a tall screen keeps the vertical
 * angle and throws the horizontal one away: measured on a 390x844 phone, the
 * view spanned 28.7 degrees across, only 14% of the screen could be aimed at,
 * and nothing beyond 26 m of the guns' 180 m range was reachable. You could
 * sail, but you could not fight.
 *
 * So the narrower the screen, the wider the lens and the higher and further
 * back the camera sits — which puts sea, rather than sky, in the space a
 * portrait screen actually has. Same measurement after: 48 degrees across, 37%
 * aimable, 90 m of reach. Landscape and desktop are left exactly as they were.
 */
const PORTRAIT_FROM = 0.85;     // aspect at which the adjustment starts
const PORTRAIT_FULL = 0.45;     // ...and is fully applied
const portraitness = (aspect) =>
  clamp((PORTRAIT_FROM - aspect) / (PORTRAIT_FROM - PORTRAIT_FULL), 0, 1);

let shapedFor = null;
function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  const t = portraitness(camera.aspect);
  camera.fov = 58 + 30 * t;
  // Pitch and distance are the player's to change by dragging and pinching, so
  // only reset them when the shape of the screen has really changed — a rotate
  // or a first layout, not every resize event.
  if (shapedFor === null || Math.abs(t - shapedFor) > 0.1) {
    shapedFor = t;
    cam.pitch = 0.34 + 0.16 * t;
    cam.dist = 36 + 10 * t;
  }
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
frame();

// Handy from the devtools console (and used by tools/smoke.js).
/**
 * Console cheats. These only work while the host has dev hooks enabled — on a
 * Node server that is `PIRATE_DEV != 0` (the default), and in a browser lobby
 * it is the host having opened the page with `?dev=1`. Every one of them is
 * validated and capped by the host, so typing a bigger number does not get you
 * a bigger number, and a client whose host has cheats off is simply ignored.
 */
window.cheat = {
  crowns: (n = 5000) => { net.socket.emit('grant-crowns', n); return `+${Math.min(n, 5000)} crowns`; },
  coins: (n = 50000) => { net.socket.emit('grant-coins', n); return `+${Math.min(n, 50000)} coins`; },
  xp: (n = 4000) => { net.socket.emit('dev-xp', n); return `+${Math.min(n, 100000)} xp`; },
  cargo: (n = 99) => { net.socket.emit('dev-cargo', n); return 'hold filled'; },
  hurt: (n = 50) => { net.socket.emit('dev-hurt', n); return `-${n} hull`; },
  /** Summon a rogue wave `h` metres tall, arriving in `lead` seconds. */
  tsunami: (h = 12, lead = 25) => {
    net.socket.emit('summon-tsunami', { amp: h, lead });
    return `${Math.min(Math.max(h, 1), 200)} m crest in ~${lead}s`;
  },
  /** Jump to a Safe Haven by name or index, or to your own base. */
  goto: async (which = 0) => {
    const w = await import('/shared/world.js');
    const isle = which === 'home'
      ? w.ISLANDS.find((i) => i.id === myHome)
      : typeof which === 'string'
        ? w.ISLANDS.find((i) => i.name.toLowerCase().startsWith(String(which).toLowerCase()))
        : w.HAVENS[which % w.HAVENS.length];
    if (!isle) return 'no such island';
    net.socket.emit('dev-place', { x: isle.x, z: isle.z + isle.radius + 30, h: Math.PI });
    return `alongside ${isle.name}`;
  },
  where: () => (({ x, z }) => `${x.toFixed(0)}, ${z.toFixed(0)}`)(me || { x: 0, z: 0 }),

  /**
   * Bring the Kraken up now instead of waiting out her timer.
   *
   * She will not surface under a Safe Haven — nothing can be hurt inside the
   * ring, so a Kraken in there is an animation flailing at nobody — and she
   * needs a hull afloat to come up beside. If nothing happens, that is why.
   */
  kraken: () => {
    if (!me || me.sunk) return 'you need to be afloat for her to come up under';
    net.socket.emit('dev-kraken');
    return 'something is coming up under you — get out of the ring if you are in one';
  },

  /** Put a squadron over the horizon: armada, dutch, treasure or pirate. */
  fleet: (faction = 'armada') => {
    net.socket.emit('dev-fleet', faction);
    return `${faction} squadron forming up`;
  },

  /** Command a hull outright, skipping the coins. `cheat.ship('flagship')`. */
  ship: (cls = 'flagship') => {
    net.socket.emit('dev-class', cls);
    return `you now command a ${cls}`;
  },

  /**
   * Set talent ranks directly — the fast way to test an armament.
   * `cheat.picks({ broadside: 20, bowchaser: 1, sternchaser: 1, gunnery: 8 })`
   *
   * Keys are checked against the talent table first. The host silently ignores
   * a rank it does not recognise, so a typo — `bow` for `bowchaser`, say —
   * looks exactly like the cheat being broken.
   */
  picks: async (picks = { broadside: 40, bowchaser: 1, sternchaser: 1 }) => {
    const { TALENTS } = await import('/shared/combat.js');
    const bad = Object.keys(picks).filter((k) => !TALENTS[k]);
    if (bad.length) {
      return `no such talent: ${bad.join(', ')}\nvalid: ${Object.keys(TALENTS).join(', ')}`;
    }
    net.socket.emit('dev-picks', picks);
    return JSON.stringify(picks);
  },

  /** Wipe this captain back to a bare sailboat: no coins, crowns, levels or trails. */
  reset: () => { net.socket.emit('reset-profile'); return 'profile wiped'; },

  help: () => console.table({
    'cheat.crowns(n)': 'up to 5000 a call',
    'cheat.coins(n)': 'up to 50000 a call',
    'cheat.xp(n)': 'levels, and so talent cards',
    'cheat.cargo(n)': 'fill the hold',
    'cheat.hurt(n)': 'take hull damage',
    'cheat.tsunami(h,s)': 'rogue wave h metres tall, in s seconds',
    'cheat.kraken()': 'she comes up now (not inside a Safe Haven ring)',
    'cheat.fleet(f)': 'armada | dutch | treasure | pirate',
    'cheat.ship(c)': 'command any hull, e.g. "leviathan"',
    'cheat.picks({..})': 'ranks: broadside, bowchaser, sternchaser, gunnery…',
    'cheat.goto(0)': 'haven by index, name, or "home"',
    'cheat.where()': 'your position',
    'cheat.reset()': 'wipe this captain back to a bare sailboat',
  }),
};

window.__game = {
  scene, renderer, camera, sun, ocean, net, cam, remotes, shop,
  get me() { return me; },
  get myVisual() { return myVisual; },
  get you() { return you; },
  get myWakeRef() { return myWake; },
  talents,
  aim,
  dock,
  islands,
  get home() { return myHome; },
  fx,
  touch,
  get touchRudder() { return touch.rudder; },
  get touchSail() { return touch.sail; },
  myWakeColour: () => myWake?.mesh.material.uniforms.uA.value.getHexString(),
};
