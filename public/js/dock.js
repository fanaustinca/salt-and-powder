import { classOf, nextClass } from '/shared/physics.js';
import { TRADE } from '/shared/world.js';
import { AMMO, RESOURCES, CRAFT_BATCH } from '/shared/combat.js';

/**
 * What you can do while alongside. Safe Havens buy cargo and sell hulls; your
 * own base fits armour for Crowns. Every button is a request — the host checks
 * you are really alongside before it does anything.
 */
export class Dock {
  constructor(net, onToast) {
    this.net = net;
    this.onToast = onToast;
    this.el = document.getElementById('dock');
    this.name = document.getElementById('dockname');
    this.kind = document.getElementById('dockkind');
    this.body = document.getElementById('dockbody');
    this.msg = document.getElementById('dockmsg');
    this.key = '';

    this.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-do]');
      if (b && !b.disabled) net.socket.emit(b.dataset.do, b.dataset.arg);
    });

    net.socket.on('trade', (m) => {
      this.msg.textContent = m.why;
      this.msg.style.color = m.ok ? 'var(--good)' : 'var(--bad)';
      if (m.ok) onToast?.(m.why);
      this.key = ''; // force a redraw with the new balances
    });
    net.socket.on('newship', (m) => {
      if (m.id === net.id) onToast?.(`You now command a ${classOf(m.cls).name}`);
    });
    net.socket.on('picked', (m) => {
      if (m.cargo >= m.cap) onToast?.('Hold full — make for a Safe Haven');
    });
    net.socket.on('aground', (m) => onToast?.(`Aground on ${m.name}!`));
  }

  update(you, home) {
    const d = you?.docked;
    this.el.classList.toggle('on', !!d && !you.sunk);
    if (!d) return;

    const isHome = d.id === home;
    // Only redraw when something actually changed, or the buttons flicker.
    const key = `${d.id}|${you.cargo}|${you.coins}|${you.cls}|${Math.floor(you.crowns || 0)}` +
      `|${JSON.stringify(you.res || {})}|${JSON.stringify(you.ammoStock || {})}`;
    if (key === this.key) return;
    this.key = key;

    this.name.textContent = d.name.toUpperCase();
    this.kind.textContent = isHome ? 'YOUR BASE' : d.haven ? 'SAFE HAVEN' : 'ANCHORAGE';

    const rows = [];
    if (d.haven) {
      const worth = (you.cargo || 0) * TRADE.coinsPerCargo;
      rows.push(btn('sell-cargo', `Sell ${you.cargo || 0} cargo`, `${worth} coins`, you.cargo > 0));

      const next = nextClass(you.cls);
      if (next) {
        const c = classOf(next);
        rows.push(btn('buy-ship', `Buy a ${c.name}`, `${c.cost} coins`, (you.coins || 0) >= c.cost));
        rows.push(`<div style="font-size:11px;opacity:.5;margin:-2px 0 8px">
          ${c.hp} hull · ${c.maxBroadside} guns a side · ${c.cargo} hold ·
          ${(c.maxSpeed * 1.94384).toFixed(0)} kn</div>`);
      } else {
        rows.push(`<div style="font-size:12px;opacity:.6;margin-bottom:8px">
          Nothing bigger afloat.</div>`);
      }
    }
    if (isHome) {
      const rank = Math.round((you.armour || 0) / 0.06);
      const cost = 120 + rank * 90;
      rows.push(btn('buy-armour', `Armour ${rank}/8`, rank >= 8 ? '—' : `${cost} crowns`, rank < 8));
    }
    if (!d.haven && !isHome) {
      rows.push(`<div style="font-size:12px;opacity:.6">A quiet anchorage — but a fire and an
        anvil are all you need to make shot.</div>`);
    }

    // The gunner's bench: salvage in, shot out. Works alongside any island.
    const res = you.res || {};
    const have = Object.entries(res).filter(([, n]) => n > 0)
      .map(([k, n]) => `${RESOURCES[k].name} ${n}`).join(' · ');
    rows.push(`<div class="grpline">GUNNER'S BENCH</div>
      <div style="font-size:11px;opacity:.55;margin-bottom:6px">${have || 'No salvage aboard'}</div>`);
    for (const [id, a] of Object.entries(AMMO)) {
      if (!a.cost) continue;
      const afford = Object.entries(a.cost).every(([k, n]) => (res[k] || 0) >= n);
      const price = Object.entries(a.cost)
        .map(([k, n]) => `${n}${RESOURCES[k].name[0]}`).join(' ');
      const held = you.ammoStock?.[id] ?? 0;
      rows.push(`<button data-do="craft" data-arg="${id}" ${afford ? '' : 'disabled'}
        title="${a.blurb}">${a.name} <i style="opacity:.5;font-style:normal">×${held}</i>
        <b>+${CRAFT_BATCH} · ${price}</b></button>`);
    }
    this.body.innerHTML = rows.join('');
  }
}

const btn = (action, label, price, enabled) =>
  `<button data-do="${action}" ${enabled ? '' : 'disabled'}>${label}<b>${price}</b></button>`;
