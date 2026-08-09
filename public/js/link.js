/**
 * A socket-shaped object whose actual wire is decided later.
 *
 * `Net`, the dock, the chandlery, the talent cards and every cheat all talk to
 * `net.socket.on(...)` / `net.socket.emit(...)`. None of them should care
 * whether that is socket.io to a Node server, a WebRTC data channel to another
 * player's browser, or a direct call into a `GameHost` running in this very
 * tab. So they all talk to one of these, and the lobby binds a wire to it once
 * the player has chosen how they want to play.
 *
 * Emits made before a wire is bound are queued rather than lost, which is what
 * lets the whole UI wire itself up at module load, long before anyone has
 * clicked anything.
 */
export class Link {
  constructor() {
    this.handlers = new Map();
    this.pending = [];
    this.wire = null;      // (event, data) => void
    this.mode = null;      // 'server' | 'host' | 'guest', for the HUD
  }

  on(event, fn) {
    let list = this.handlers.get(event);
    if (!list) this.handlers.set(event, (list = []));
    list.push(fn);
    return this;
  }

  off(event, fn) {
    const list = this.handlers.get(event);
    if (!list) return this;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    return this;
  }

  /** Client -> host. */
  emit(event, data) {
    if (this.wire) this.wire(event, data);
    else this.pending.push([event, data]);
    return this;
  }

  /** Host -> client. Transports call this; game code never does. */
  deliver(event, data) {
    const list = this.handlers.get(event);
    if (!list) return;
    // Copy first: a handler is allowed to unsubscribe itself.
    for (const fn of list.slice()) {
      try {
        fn(data);
      } catch (err) {
        console.error(`handler for "${event}" threw:`, err);
      }
    }
  }

  /** Attach a wire and flush anything said while we were still waiting. */
  bind(wire, mode) {
    this.wire = wire;
    if (mode) this.mode = mode;
    const queued = this.pending;
    this.pending = [];
    for (const [event, data] of queued) wire(event, data);
    return this;
  }

  unbind() {
    this.wire = null;
    return this;
  }
}

/**
 * A deep copy, used on the loopback wire so the player hosting a lobby sees
 * exactly what a remote peer sees. Without it the host tab would be handed the
 * host's own live snapshot objects, and a renderer that mutated one would be
 * quietly reaching into the simulation — a class of bug that could never
 * reproduce for anybody else.
 */
export const copy = (v) =>
  v === undefined || v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v));
