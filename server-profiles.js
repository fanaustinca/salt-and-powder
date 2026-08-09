// Crowns and owned cosmetics, keyed by captain name and kept in a small JSON
// file so a server restart doesn't wipe what people bought. There are no
// accounts yet — the name is the key, which is fine for a friendly server and
// is the seam to replace when real logins arrive.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { TRAILS, DEFAULT_TRAIL } from './shared/cosmetics.js';

export class Profiles {
  constructor(dir) {
    this.file = path.join(dir, 'profiles.json');
    this.map = new Map();
    this.dirty = false;
    mkdirSync(dir, { recursive: true });
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw)) this.map.set(k, v);
      console.log(`    loaded ${this.map.size} captain${this.map.size === 1 ? '' : 's'}`);
    } catch {
      /* first run */
    }
    setInterval(() => this.flush(), 10000).unref?.();
  }

  static key(name) {
    return String(name).trim().toLowerCase().slice(0, 16);
  }

  get(name) {
    const k = Profiles.key(name);
    let p = this.map.get(k);
    if (!p) {
      p = { crowns: 0, coins: 0, cls: 'sailboat', armour: 0,
            xp: 0, level: 1, picks: {},
            owned: [DEFAULT_TRAIL], trail: DEFAULT_TRAIL };
      this.map.set(k, p);
      this.dirty = true;
    }
    // Heal anything hand-edited or left over from an older catalogue.
    if (!Array.isArray(p.owned)) p.owned = [DEFAULT_TRAIL];
    if (!p.owned.includes(DEFAULT_TRAIL)) p.owned.push(DEFAULT_TRAIL);
    p.owned = p.owned.filter((id) => TRAILS[id]);
    if (!p.owned.includes(p.trail)) p.trail = DEFAULT_TRAIL;
    if (!Number.isFinite(p.crowns)) p.crowns = 0;
    if (!Number.isFinite(p.coins)) p.coins = 0;
    if (!Number.isFinite(p.armour)) p.armour = 0;
    // Levels and talents are earned, so they are saved too — see
    // GameHost.saveProgress(). Heal anything hand-edited or pre-dating them.
    if (!Number.isFinite(p.xp)) p.xp = 0;
    if (!Number.isFinite(p.level)) p.level = 1;
    if (!p.picks || typeof p.picks !== 'object') p.picks = {};
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
    p.trail = id; // wear it straight away — that is what you bought it for
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
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map), null, 1));
    } catch (err) {
      console.warn('could not save profiles:', err.message);
    }
  }
}
