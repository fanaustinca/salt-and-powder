import { msToKnots, classOf } from '/shared/physics.js';
import { xpForLevel, AMMO, RESOURCES } from '/shared/combat.js';

import { ISLANDS } from '/shared/world.js';

const $ = (id) => document.getElementById(id);
const normalizeAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const RELOAD_FULL = { port: 4.2, starboard: 4.2, bow: 3.0, stern: 3.0 };
const LABELS = { port: 'PORT', starboard: 'STBD', bow: 'BOW', stern: 'STERN' };

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      speed: $('speed'),
      heading: $('heading'),
      shipclass: $('shipclass'),
      cargotext: $('cargotext'),
      thrfill: $('thrfill'),
      thrpct: $('thrpct'),
      coins: $('coins'),
      trimword: $('trimword'),
      roster: $('rosterlist'),
      net: $('net'),
      sea: $('seastate'),
      toasts: $('toasts'),
      alert: $('alert'),
      alertDetail: $('alertdetail'),
      hullbar: $('hullbar'),
      hulltext: $('hulltext'),
      xpbar: $('xpbar'),
      levtext: $('levtext'),
      barreltext: $('barreltext'),
      ammotext: $('ammotext'),
      restext: $('restext'),
      fleettext: $('fleettext'),
      sunkmsg: $('sunkmsg'),
      sunkdetail: $('sunkdetail'),
    };
    this.canvas = $('compass');
    this.ctx = this.canvas.getContext('2d');
    this.rosterKey = '';
    this.guns = {};
    for (const k of ['port', 'starboard', 'bow', 'stern', 'tnt']) {
      const el = $('gun-' + k);
      this.guns[k] = { el, fill: el.querySelector('.bar i') };
    }
  }

  show() { this.el.hud.classList.add('on'); }

  toast(text) {
    const d = document.createElement('div');
    d.className = 'toast panel';
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  update(ship, others, net, wave, you) {
    const e = this.el;
    if (you) this.#battle(you);
    // Signed, so being shoved astern by a sea reads as negative on the log.
    e.speed.textContent = msToKnots(Math.sign(ship.vf ?? 1) * ship.speed).toFixed(1);
    e.heading.textContent = String(bearingOf(ship.heading)).padStart(3, '0') + '°';
    const cls = classOf(you?.cls || ship.cls);
    e.shipclass.textContent = cls.name;
    const cap = you?.cargoCap ?? cls.cargo;
    e.cargotext.textContent = `${you?.cargo ?? 0} / ${cap}`;
    e.coins.textContent = (you?.coins ?? 0).toLocaleString();

    const thr = ship.throttle ?? 0;
    e.thrfill.style.width = Math.abs(thr * 100).toFixed(0) + '%';
    e.thrfill.style.background = thr < 0 ? 'var(--bad)' : 'var(--gold)';
    e.thrpct.textContent = Math.round(thr * 100) + '%';

    let word = 'UNDER WAY';
    let color = 'var(--good)';
    if (you?.docked) { word = `ALONGSIDE ${you.docked.name.toUpperCase()}`; color = 'var(--gold)'; }
    else if (thr <= 0.02 && thr >= -0.02) { word = 'DEAD IN THE WATER'; color = 'var(--bad)'; }
    else if (thr < 0) { word = 'ASTERN'; color = 'var(--gold)'; }
    else if ((you?.cargo ?? 0) >= cap && cap > 0) { word = 'HOLD FULL — MAKE FOR A HAVEN'; color = 'var(--gold)'; }
    e.trimword.textContent = word;
    e.trimword.style.color = color;

    e.sea.textContent = seaWords(net.sea);

    this.#roster(ship, others, net);
    e.net.textContent = net.connected
      ? `${Math.round(net.rtt * 1000)} ms · ${others.length + 1} online`
      : 'reconnecting…';

    this.#alert(wave);
    this.#compass(ship, wave);
  }

  /** Hull, guns, experience — everything about the fight you are in. */
  #battle(you) {
    const e = this.el;
    const frac = Math.max(0, you.hp / you.maxHp);
    e.hullbar.style.width = (frac * 100).toFixed(1) + '%';
    e.hulltext.textContent = `${Math.round(you.hp)} / ${you.maxHp}`;

    const base = xpForLevel(you.level);
    const next = xpForLevel(you.level + 1);
    e.xpbar.style.width = (((you.xp - base) / Math.max(1, next - base)) * 100).toFixed(1) + '%';
    e.levtext.textContent = `LEVEL ${you.level}`;
    e.barreltext.textContent = `${you.barrels} BARREL${you.barrels === 1 ? '' : 'S'}`;

    const a = AMMO[you.ammo] || AMMO.round;
    const stock = you.ammo === 'round' ? '∞' : (you.ammoStock?.[you.ammo] ?? 0);
    e.ammotext.textContent = `${a.short} ${stock}`;
    e.ammotext.style.color = you.ammo === 'round' ? 'var(--ink)' : 'var(--gold)';
    const consorts = you.consorts ?? 0;
    e.fleettext.textContent = consorts > 0
      ? `FLEET ${consorts} SAIL` : '';
    e.fleettext.style.color = 'var(--good)';

    e.restext.textContent = Object.entries(you.res || {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${RESOURCES[k].name[0]}${n}`).join(' ');

    for (const k of ['port', 'starboard', 'bow', 'stern']) {
      const g = this.guns[k];
      const count = you.guns?.[k] ?? 0;
      // A battery you have not bought yet is shown, but plainly empty.
      g.el.style.opacity = count > 0 ? '1' : '0.32';
      g.el.querySelector('.n').textContent =
        count > 0 ? `${LABELS[k]} ×${count}` : LABELS[k];
      const left = you.reload?.[k] ?? 0;
      g.el.classList.toggle('loading', count > 0 && left > 0);
      g.fill.style.width =
        (count <= 0 ? 0 : left > 0 ? (1 - left / RELOAD_FULL[k]) * 100 : 100).toFixed(0) + '%';
    }
    const tnt = this.guns.tnt;
    tnt.el.classList.toggle('loading', you.barrels <= 0);
    tnt.fill.style.width = you.barrels > 0 ? '100%' : '0%';

    e.sunkmsg.classList.toggle('on', !!you.sunk);
  }

  /** Rogue-wave warning: counts down this ship's own arrival, not the world's. */
  #alert(wave) {
    const el = this.el.alert;
    if (!wave || wave.eta > 45 || wave.eta < -7) {
      el.classList.remove('on', 'brace');
      return;
    }
    el.classList.add('on');
    const close = wave.eta < 5;
    el.classList.toggle('brace', close);
    this.el.alertDetail.textContent = close
      ? `BRACE — ${wave.amp.toFixed(0)} m CREST`
      : `${wave.eta.toFixed(0)}s · ${wave.amp.toFixed(0)} m · bearing ${bearingOf(wave.fromAbs)}°`;
  }

  #roster(me, others, net) {
    const rows = [{ n: me.name, s: me.speed, me: true }].concat(
      others.map((o) => ({ n: o.n, s: o.speed || 0, me: false }))
    );
    rows.sort((a, b) => (a.me ? -1 : b.me ? 1 : a.n.localeCompare(b.n)));
    const key = rows.map((r) => r.n + Math.round(msToKnots(r.s) * 10)).join('|');
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    this.el.roster.innerHTML = rows
      .map(
        (r) =>
          `<div class="p${r.me ? ' me' : ''}"><span>${escape(r.n)}</span><span>${msToKnots(
            r.s
          ).toFixed(1)} kn</span></div>`
      )
      .join('');
  }

  /**
   * Ship-up compass: rose, wind, the slow sector, and where the boom is sitting.
   *
   * Everything here works in *physics* relative bearings — positive means
   * toward +X, which is the ship's port side. `toScreenVec` is what maps that
   * to the dial (positive going left), and the rose's ctx.rotate(heading) lands
   * on the same convention. Do not negate on the way in: that was a real bug
   * that mirrored the wind arrow and made it counter-rotate against the rose.
   */
  #compass(ship, wave) {
    const ctx = this.ctx;
    const S = this.canvas.width;
    const c = S / 2;
    const R = S * 0.42;
    ctx.clearRect(0, 0, S, S);

    ctx.save();
    ctx.translate(c, c);
    ctx.fillStyle = 'rgba(14,22,30,0.62)';
    ctx.beginPath();
    ctx.arc(0, 0, R + 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,231,207,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // rose
    ctx.rotate(ship.heading);
    ctx.font = `600 ${Math.round(S * 0.085)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const major = i % 8 === 0;
      const len = major ? 13 : i % 2 === 0 ? 8 : 5;
      ctx.beginPath();
      ctx.strokeStyle = major ? 'rgba(232,180,85,0.9)' : 'rgba(242,231,207,0.35)';
      ctx.lineWidth = major ? 2.5 : 1.5;
      ctx.moveTo(Math.sin(a) * R, -Math.cos(a) * R);
      ctx.lineTo(Math.sin(a) * (R - len), -Math.cos(a) * (R - len));
      ctx.stroke();
    }
    for (const [txt, deg] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
      const a = (deg * Math.PI) / 180;
      ctx.save();
      ctx.translate(Math.sin(a) * (R - 30), -Math.cos(a) * (R - 30));
      ctx.rotate(-ship.heading);
      ctx.fillStyle = txt === 'N' ? '#e8b455' : 'rgba(242,231,207,0.72)';
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // ship silhouette, always bow-up
    ctx.save();
    ctx.translate(c, c);
    ctx.fillStyle = 'rgba(242,231,207,0.85)';
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.42);
    ctx.quadraticCurveTo(R * 0.17, 0, R * 0.11, R * 0.34);
    ctx.lineTo(-R * 0.11, R * 0.34);
    ctx.quadraticCurveTo(-R * 0.17, 0, 0, -R * 0.42);
    ctx.fill();

    // Islands, so you can steer for a haven without a map.
    for (const isle of ISLANDS) {
      const dx = isle.x - ship.x;
      const dz = isle.z - ship.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1500) continue;
      const rel = normalizeAngle(Math.atan2(dx, dz) - ship.heading);
      const rr = R * (0.28 + Math.min(dist / 1500, 1) * 0.6);
      const p = toScreenVec(rel, rr);
      ctx.beginPath();
      ctx.fillStyle = isle.haven ? 'rgba(255,217,138,0.95)'
        : isle.id === ship.home ? 'rgba(127,211,155,0.95)' : 'rgba(190,180,160,0.55)';
      ctx.arc(p.x, p.y, isle.haven ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // and the rogue wave, if one is on its way
    if (wave && wave.eta < 60) {
      const rel = normalizeAngle(wave.fromAbs - ship.heading);
      arrow(ctx, rel, R * 1.0, R * 0.72, '#e07a5f', 6);
    }
    ctx.restore();
  }
}

/** Compass bearing shown to the player (see the note in #compass). */
function bearingOf(heading) {
  return Math.round(((-heading * 180) / Math.PI + 360) % 360) % 360;
}

function seaWords(sea) {
  if (sea < 0.55) return 'CALM';
  if (sea < 0.95) return 'SLIGHT';
  if (sea < 1.35) return 'MODERATE';
  if (sea < 1.85) return 'ROUGH';
  if (sea < 2.3) return 'VERY ROUGH';
  return 'HIGH SEA';
}

// Dial-local position for a relative bearing already flipped to bow-up/right-positive.
const toScreenVec = (t, r) => ({ x: -Math.sin(t) * r, y: -Math.cos(t) * r });
const arcAngle = (t) => -t - Math.PI / 2;

function drawSpoke(ctx, t, r, color, width, inner = 0) {
  const a = toScreenVec(t, inner);
  const b = toScreenVec(t, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function arrow(ctx, t, fromR, toR, color, width) {
  const tail = toScreenVec(t, fromR);
  const tip = toScreenVec(t, toR);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const h = width * 4;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - Math.cos(ang - 0.42) * h, tip.y - Math.sin(ang - 0.42) * h);
  ctx.lineTo(tip.x - Math.cos(ang + 0.42) * h, tip.y - Math.sin(ang + 0.42) * h);
  ctx.closePath();
  ctx.fill();
}

const escape = (s) => String(s).replace(/[&<>"]/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
