import { TRAILS } from '/shared/cosmetics.js';

/**
 * The Crown chandlery. Buying and equipping are both server calls — this only
 * draws what the last profile said, so a client that lies about its crowns
 * simply gets told no.
 */
export class Shop {
  constructor(net, onToast) {
    this.net = net;
    this.onToast = onToast;
    this.profile = { crowns: 0, owned: ['foam'], trail: 'foam' };
    this.open = false;

    this.el = document.getElementById('shop');
    this.list = document.getElementById('shoplist');
    this.crownsEl = document.getElementById('crowns');
    this.shopCrowns = document.getElementById('shopcrowns');

    document.getElementById('shopclose').addEventListener('click', () => this.toggle(false));
    document.getElementById('crownchip').addEventListener('click', () => this.toggle());

    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      if (this.profile.owned.includes(id)) this.net.socket.emit('equip-trail', id);
      else this.net.socket.emit('buy-trail', id);
    });

    net.socket.on('profile', (p) => this.setProfile(p));
    net.socket.on('earned', ({ amount, why }) =>
      this.onToast?.(`+${amount} crowns — ${why}`));
  }

  setProfile(p) {
    const bought = p.result === 'ok' && p.item && !this.profile.owned.includes(p.item);
    if (p.result === 'poor') this.onToast?.('Not enough crowns for that one.');
    this.profile = { crowns: p.crowns, owned: p.owned, trail: p.trail };
    if (bought) this.onToast?.(`${TRAILS[p.item].name} trail — hoisted.`);
    this.render();
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('on', this.open);
    if (this.open) this.render();
  }

  get trail() {
    return { id: this.profile.trail, ...TRAILS[this.profile.trail] };
  }

  render() {
    const crowns = Math.floor(this.profile.crowns);
    this.crownsEl.textContent = crowns.toLocaleString();
    if (!this.open) return;
    this.shopCrowns.textContent = crowns.toLocaleString();

    this.list.innerHTML = Object.entries(TRAILS)
      .map(([id, t]) => {
        const owned = this.profile.owned.includes(id);
        const worn = this.profile.trail === id;
        const afford = crowns >= t.price;
        const state = worn ? 'WORN' : owned ? 'WEAR' : afford ? `${t.price}` : `${t.price}`;
        return `
          <div class="item${worn ? ' worn' : ''}${!owned && !afford ? ' poor' : ''}" data-id="${id}">
            <span class="sw" style="background:linear-gradient(90deg,${t.a},${t.b});
              box-shadow:0 0 ${8 + t.glow * 14}px ${t.a}${t.glow > 0.4 ? 'aa' : '44'}"></span>
            <span class="txt">
              <b>${t.name}</b>
              <i>${t.blurb}</i>
            </span>
            <span class="buy${owned ? ' owned' : ''}">${state}</span>
          </div>`;
      })
      .join('');
  }
}
