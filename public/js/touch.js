// Controls for a ship you are holding in your hands.
//
// A phone has no WASD, no hover and no scroll wheel, so the three things the
// desktop build leans on are all missing. This puts back the two that matter —
// a helm and a sail — as controls that suit a thumb rather than a key:
//
//   HELM      spring-centred, and proportional. A rudder you can ease over is
//             worth far more than a left/right button, because most of sailing
//             is holding a course rather than turning hard.
//   SAIL      absolute, and it stays where you leave it. On the keyboard the
//             throttle is a rate — W ramps it up while held — which is fine
//             with a finger resting on a key and miserable on glass. Here you
//             drag it to where you want the canvas set and the ship chases it.
//
// Everything else (aiming, looking around) already works by pointer, so it
// needs no touch-specific code — only the fixes in main.js that a tap has no
// hover to precede it.

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const HELM_DEADZONE = 0.08;   // so a resting thumb is not a standing order
const SAIL_DEADBAND = 0.03;   // stop chasing when close enough, or it hunts

export class TouchControls {
  /**
   * @param actions {onFire, onBarrel, onAmmo, onTalents, onShop}
   */
  constructor(actions = {}) {
    this.actions = actions;
    this.active = false;
    this.rudder = 0;      // -1..1, live
    this.sail = 0.6;      // 0..1, the canvas you have ordered
    this.el = null;
  }

  /**
   * Turn the controls on. Called the first time a real touch arrives rather
   * than from a media query, so a laptop with a touchscreen does not get thumb
   * sticks it never asked for, and an iPad with a keyboard gets them the moment
   * the keyboard is put down.
   */
  enable() {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('touch');
    this.#build();
  }

  /**
   * Fold the touch state into the input the ship is steered by. Each axis is
   * left alone if the keyboard is already driving it, so a tablet with a
   * keyboard attached can use whichever is to hand without the two fighting.
   */
  read(input, shipThrottle = 0) {
    if (!this.active) return;
    if (!input.rudder) {
      input.rudder = Math.abs(this.rudder) < HELM_DEADZONE ? 0 : this.rudder;
    }
    if (!input.throttle) {
      // Chase the ordered sail. The host integrates the same -1/0/+1 the
      // keyboard sends, so this settles on the setting rather than fighting it.
      const err = this.sail - shipThrottle;
      input.throttle = Math.abs(err) < SAIL_DEADBAND ? 0 : Math.sign(err);
    }
  }

  /** Reflect the sail the ship is actually carrying, e.g. on taking the helm. */
  syncSail(throttle) {
    this.sail = clamp(throttle || 0, 0, 1);
    this.#paintSail();
  }

  // ------------------------------------------------------------------ chrome
  #build() {
    const root = document.createElement('div');
    root.id = 'touchui';
    root.innerHTML = `
      <div id="tsail" class="tctl"><div class="track"><i></i><b></b></div><span>SAIL</span></div>
      <div id="thelm" class="tctl"><div class="track"><u></u><b></b></div><span>HELM</span></div>
      <div id="tbtns">
        <button data-act="fire" class="big">FIRE</button>
        <button data-act="barrel">KEG</button>
        <button data-act="ammo">SHOT</button>
        <button data-act="talents">TAL</button>
        <button data-act="shop">SHOP</button>
      </div>`;
    (document.getElementById('ui') || document.body).appendChild(root);
    this.el = root;

    this.sailTrack = root.querySelector('#tsail .track');
    this.sailFill = root.querySelector('#tsail .track i');
    this.sailKnob = root.querySelector('#tsail .track b');
    this.helmTrack = root.querySelector('#thelm .track');
    this.helmKnob = root.querySelector('#thelm .track b');

    this.#drag(this.sailTrack, (e, r) => {
      // Bottom of the track is furled, top is everything she will carry.
      this.sail = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      this.#paintSail();
    });

    this.#drag(this.helmTrack, (e, r) => {
      this.rudder = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      this.#paintHelm();
    }, () => {
      // Let go and she comes back amidships, like a real wheel with way on.
      this.rudder = 0;
      this.#paintHelm();
    });

    const acts = {
      fire: this.actions.onFire, barrel: this.actions.onBarrel,
      ammo: this.actions.onAmmo, talents: this.actions.onTalents,
      shop: this.actions.onShop,
    };
    root.querySelector('#tbtns').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      b.classList.add('lit');
      setTimeout(() => b.classList.remove('lit'), 130);
      acts[b.dataset.act]?.();
    });

    this.#paintSail();
    this.#paintHelm();
  }

  /**
   * Pointer capture on the track itself, so a thumb that slides off the control
   * mid-turn keeps steering instead of silently centring the helm — and never
   * starts dragging the camera underneath.
   */
  #drag(el, onMove, onEnd) {
    let id = null;
    const rect = () => el.getBoundingClientRect();
    el.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      el.setPointerCapture(id);
      e.preventDefault();
      e.stopPropagation();
      onMove(e, rect());
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      e.stopPropagation();
      onMove(e, rect());
    });
    const up = (e) => {
      if (e.pointerId !== id) return;
      el.releasePointerCapture?.(id);
      id = null;
      onEnd?.();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Both are safe to call before the controls exist — syncSail runs on taking
  // the helm, which on a desktop is long before any of this is built.
  #paintSail() {
    if (!this.sailFill) return;
    const pct = `${(this.sail * 100).toFixed(1)}%`;
    this.sailFill.style.height = pct;
    this.sailKnob.style.bottom = pct;
  }

  #paintHelm() {
    if (!this.helmKnob) return;
    this.helmKnob.style.left = `${((this.rudder + 1) / 2 * 100).toFixed(1)}%`;
    this.helmTrack.classList.toggle('over', Math.abs(this.rudder) >= HELM_DEADZONE);
  }
}

/**
 * Was this page opened on something you touch? `?touch=1` forces it on for
 * testing from a desktop browser.
 */
export const wantsTouch = () =>
  /(^|[?&])touch=1/.test(location.search)
  || (matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches);
