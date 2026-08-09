import { Link } from './link.js';

/**
 * Snapshot buffer and clock sync. It talks to a `Link` rather than a socket, so
 * the same code runs whether the authority is a Node server across the internet
 * or a `GameHost` in the tab next door — see link.js and lobby.js. The lobby
 * binds the actual wire; everything here works the moment it does.
 */
export class Net {
  constructor(socket = new Link()) {
    this.socket = socket;
    this.id = null;
    this.sea = 1;
    this.drops = [];
    this.kraken = null;
    this.tsunami = null;
    this.snapshots = []; // { t, ships:Map }
    this.offset = 0;     // serverTime - clientTime (seconds)
    this.rtt = 0;
    this.connected = false;
    this.onJoined = null;
    this.onLeft = null;
    this.onInit = null;

    this.socket.on('connect', () => { this.connected = true; });
    this.socket.on('disconnect', () => { this.connected = false; });

    this.socket.on('init', (msg) => {
      this.id = msg.id;
      this.offset = msg.t - performance.now() / 1000;
      this.world = msg.world;
      this.#absorb(msg.state);
      this.onInit?.(msg);
      this.#syncClock();
      setInterval(() => this.#syncClock(), 4000);
    });

    this.socket.on('state', (s) => this.#absorb(s));
    this.socket.on('tsunami', (ts) => { this.tsunami = ts; });
    this.socket.on('joined', (m) => this.onJoined?.(m));
    this.socket.on('left', (m) => this.onLeft?.(m));
    this.socket.on('pong-t', ({ c, s }) => {
      const nowC = performance.now() / 1000;
      this.rtt = nowC - c;
      // Server timestamp refers to a moment ~half an RTT ago.
      const est = s + this.rtt / 2 - nowC;
      this.offset = this.offset === 0 ? est : this.offset * 0.8 + est * 0.2;
    });
  }

  join(name) { this.socket.emit('join', { name }); }

  #syncClock() { this.socket.emit('ping-t', performance.now() / 1000); }

  #absorb(s) {
    if (!s) return;
    if (typeof s.sea === 'number') this.sea = s.sea;
    if (s.drops) this.drops = s.drops;
    this.kraken = s.kraken ?? null;
    this.tsunami = s.ts ?? null;
    const ships = new Map();
    for (const sh of s.ships) ships.set(sh.id, sh);
    this.snapshots.push({ t: s.t, ships });
    if (this.snapshots.length > 24) this.snapshots.shift();
  }

  /** Server clock, in seconds, as best we can tell. */
  serverNow() { return performance.now() / 1000 + this.offset; }

  sendInput(input, seq) {
    this.socket.emit('input', { r: input.rudder, t: input.throttle, seq });
  }

  /** Latest authoritative state for one ship (no interpolation). */
  latest(id) {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const sh = this.snapshots[i].ships.get(id);
      if (sh) return sh;
    }
    return null;
  }

  /**
   * Other players, interpolated `delay` seconds in the past so packet jitter
   * never turns into stutter.
   */
  interpolated(delay = 0.12) {
    const target = this.serverNow() - delay;
    const snaps = this.snapshots;
    const out = [];
    if (snaps.length === 0) return out;

    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].t <= target && snaps[i + 1].t >= target) { a = snaps[i]; b = snaps[i + 1]; break; }
      if (snaps[i + 1].t < target) { a = snaps[i]; b = snaps[i + 1]; }
    }
    const span = b.t - a.t;
    const f = span > 1e-4 ? Math.min(Math.max((target - a.t) / span, 0), 1.6) : 1;

    for (const [id, sb] of b.ships) {
      const sa = a.ships.get(id) || sb;
      // Carry the WHOLE row and interpolate only what moves. Hand-listing the
      // fields silently dropped class, faction, trail, guns and the sunk flag,
      // so every remote hull drew as a bare sailboat with a foam wake.
      out.push({
        ...sb,
        x: sa.x + (sb.x - sa.x) * f,
        z: sa.z + (sb.z - sa.z) * f,
        h: sa.h + shortAngle(sa.h, sb.h) * f,
        speed: Math.hypot(sb.vx, sb.vz),
      });
    }
    return out;
  }
}

function shortAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
