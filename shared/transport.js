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

/**
 * Everything a client is allowed to say. Both adapters route through this, so a
 * peer on a WebRTC channel cannot reach a handler the socket.io server refuses
 * to expose. The dev hooks are listed here too but `GameHost` drops them unless
 * it was built with `dev: true` — the allowlist decides what is *addressable*,
 * the host decides what is *permitted*.
 */
export const CLIENT_EVENTS = [
  'join', 'input', 'ping-t', 'fire', 'drop-tnt', 'spend-talent',
  'buy-trail', 'equip-trail', 'sell-cargo', 'buy-ship', 'buy-armour',
  'set-ammo', 'craft',
  // dev hooks
  'summon-tsunami', 'grant-crowns', 'dev-xp', 'dev-place', 'dev-cargo',
  'grant-coins', 'dev-hurt', 'dev-class', 'dev-picks', 'reset-profile',
  'dev-fleet', 'dev-kraken',
];

const CLIENT_EVENT_SET = new Set(CLIENT_EVENTS);
export const isClientEvent = (event) => CLIENT_EVENT_SET.has(event);

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
        xp: 0, level: 1, picks: {},
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
