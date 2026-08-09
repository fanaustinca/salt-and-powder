// Wake trails you can buy with Crowns. Server validates every purchase against
// this table, so the client can never grant itself one.

export const TRAILS = {
  foam:     { name: 'Sea Foam',     price: 0,    a: '#eef6f9', b: '#c4dae6', glow: 0.0,
              blurb: 'Plain white water. What every hull leaves.' },
  azure:    { name: 'Azure',        price: 45,   a: '#4fb4ff', b: '#0c3d7d', glow: 0.35,
              blurb: 'A cold blue streak, like deep water turned over.' },
  emerald:  { name: 'Emerald',      price: 80,   a: '#4ef0a8', b: '#0a5c46', glow: 0.4,
              blurb: 'Shallow-reef green, dragged out to sea.' },
  ember:    { name: 'Ember',        price: 130,  a: '#ffb347', b: '#c22f16', glow: 0.8,
              blurb: 'Burning water. Nobody asks how.' },
  amethyst: { name: 'Amethyst',     price: 190,  a: '#c98bff', b: '#45197a', glow: 0.55,
              blurb: 'Storm-light purple that lingers after you pass.' },
  doubloon: { name: 'Doubloon',     price: 260,  a: '#ffd76a', b: '#9c6410', glow: 0.65,
              blurb: 'Gold enough to be seen from the horizon.' },
  spectre:  { name: 'Spectre',      price: 380,  a: '#c2ffe9', b: '#1d6b5a', glow: 0.95,
              blurb: 'Cold witchfire. Crews have deserted over less.' },
  ink:      { name: 'Black Powder', price: 520,  a: '#7d8b98', b: '#080c11', glow: 0.1,
              blurb: 'A smear of smoke and soot. Hard to follow at night.' },
};

export const DEFAULT_TRAIL = 'foam';

export const trailOf = (id) => TRAILS[id] || TRAILS[DEFAULT_TRAIL];

// --- how Crowns are earned ---------------------------------------------------
// At a working 5 m/s that is roughly 12 crowns a minute, so the first trail is
// about four minutes out and the last is a good long haul — with rogue waves
// paying a useful shortcut for anyone willing to be caught by one.
export const CROWNS = {
  perMetre: 1 / 25,    // steady pay for sea miles under the keel
  rogueWave: 60,       // for being aboard when a rogue wave rolls through
};
