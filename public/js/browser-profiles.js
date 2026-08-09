// Crowns, Coins and cosmetics for a lobby hosted in a browser tab.
//
// Same five calls as server-profiles.js, same shape of record, backed by
// localStorage instead of a JSON file. Everyone who sails in this lobby is
// saved in the host's browser — including the guests, keyed by captain name
// exactly as the server does it. Clear the host's site data and the lobby's
// books are gone; that is the honest cost of having no server.
import { TRAILS, DEFAULT_TRAIL } from '/shared/cosmetics.js';

const KEY = 'pirate.profiles';

export class LocalProfiles {
  constructor(key = KEY) {
    this.key = key;
    this.map = new Map();
    this.dirty = false;
    try {
      const raw = JSON.parse(localStorage.getItem(this.key) || '{}');
      for (const [k, v] of Object.entries(raw)) this.map.set(k, v);
    } catch {
      /* first run, or someone hand-edited it into rubble */
    }
    this.timer = setInterval(() => this.flush(), 5000);
  }

  static key(name) {
    return String(name).trim().toLowerCase().slice(0, 16);
  }

  get(name) {
    const k = LocalProfiles.key(name);
    let p = this.map.get(k);
    if (!p) {
      p = { crowns: 0, coins: 0, cls: 'sailboat', armour: 0,
            owned: [DEFAULT_TRAIL], trail: DEFAULT_TRAIL };
      this.map.set(k, p);
      this.dirty = true;
    }
    // Heal anything left over from an older catalogue, same as the server.
    if (!Array.isArray(p.owned)) p.owned = [DEFAULT_TRAIL];
    if (!p.owned.includes(DEFAULT_TRAIL)) p.owned.push(DEFAULT_TRAIL);
    p.owned = p.owned.filter((id) => TRAILS[id]);
    if (!p.owned.includes(p.trail)) p.trail = DEFAULT_TRAIL;
    if (!Number.isFinite(p.crowns)) p.crowns = 0;
    if (!Number.isFinite(p.coins)) p.coins = 0;
    if (!Number.isFinite(p.armour)) p.armour = 0;
    if (!p.cls) p.cls = 'sailboat';
    return p;
  }

  award(name, amount) {
    const p = this.get(name);
    p.crowns += amount;
    this.dirty = true;
    return p;
  }

  /** Returns 'ok' | 'owned' | 'poor' | 'unknown'. */
  buy(name, id) {
    const item = TRAILS[id];
    if (!item) return 'unknown';
    const p = this.get(name);
    if (p.owned.includes(id)) return 'owned';
    if (p.crowns < item.price) return 'poor';
    p.crowns -= item.price;
    p.owned.push(id);
    p.trail = id;
    this.dirty = true;
    return 'ok';
  }

  equip(name, id) {
    const p = this.get(name);
    if (!p.owned.includes(id)) return false;
    p.trail = id;
    this.dirty = true;
    return true;
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      localStorage.setItem(this.key, JSON.stringify(Object.fromEntries(this.map)));
    } catch (err) {
      // Quota, or private browsing. The lobby still plays; it just won't persist.
      console.warn('could not save profiles:', err.message);
    }
  }

  stop() {
    clearInterval(this.timer);
    this.flush();
  }
}
