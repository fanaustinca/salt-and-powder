/**
 * The contract between the game and however its messages happen to travel.
 *
 * `GameHost` only ever talks through one of these, so the same authoritative
 * simulation runs behind socket.io on a Node server or behind WebRTC data
 * channels in a browser tab acting as host. Nothing in `shared/` may import
 * `socket.io`, `express` or anything else environment-specific.
 *
 * A host-side transport must provide:
 *   broadcast(event, data)        send to every connected client
 *   send(clientId, event, data)   send to one
 *
 * and must drive the host by calling:
 *   host.join(clientId, payload)
 *   host.message(clientId, event, data)
 *   host.leave(clientId)
 *
 * A client-side transport must provide:
 *   on(event, handler) / emit(event, data) / id
 */

/** Host-side transport that goes nowhere. Useful for tests and single player. */
export class NullTransport {
  constructor() { this.sent = []; }
  broadcast(event, data) { this.sent.push({ to: '*', event, data }); }
  send(clientId, event, data) { this.sent.push({ to: clientId, event, data }); }
}

/**
 * Profile storage the host needs. Node backs this with a JSON file; a browser
 * host would back it with localStorage. Same five calls either way.
 *
 *   get(name) -> { crowns, owned[], trail }
 *   award(name, amount)
 *   buy(name, id)   -> 'ok' | 'owned' | 'poor' | 'unknown'
 *   equip(name, id) -> boolean
 *   flush()
 */
export class MemoryProfiles {
  constructor(defaultTrail = 'foam') {
    this.map = new Map();
    this.defaultTrail = defaultTrail;
  }
  get(name) {
    const k = String(name).trim().toLowerCase();
    if (!this.map.has(k)) {
      this.map.set(k, {
        crowns: 0, coins: 0, cls: 'sailboat', armour: 0,
        owned: [this.defaultTrail], trail: this.defaultTrail,
      });
    }
    return this.map.get(k);
  }
  award(name, amount) { const p = this.get(name); p.crowns += amount; return p; }
  buy() { return 'unknown'; }
  equip() { return false; }
  flush() {}
}
