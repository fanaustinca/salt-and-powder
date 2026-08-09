import { TALENTS, groupsFor, pointsFree, FLEET_LEVEL } from '/shared/combat.js';

const GROUP_LABEL = { guns: 'GUNS', crew: 'CREW', ship: 'SHIP', fleet: 'FLEET' };

/**
 * The talent draft. You are dealt one card per section and take one of the
 * three — the host rolls the hand, so a client cannot reroll for a better one.
 */
export class Talents {
  constructor(net, onToast) {
    this.net = net;
    this.onToast = onToast;
    this.open = false;
    this.level = 1;
    this.picks = {};
    this.offer = {};
    this.free = 0;

    this.el = document.getElementById('talents');
    this.list = document.getElementById('tallist');
    this.freeEl = document.getElementById('freepts');
    this.alert = document.getElementById('talalert');

    document.getElementById('talclose').addEventListener('click', () => this.toggle(false));
    this.alert.addEventListener('click', () => this.toggle(true));
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-talent]');
      if (row && !row.classList.contains('taken')) {
        net.socket.emit('spend-talent', row.dataset.talent);
      }
    });

    net.socket.on('talents', (m) => {
      this.picks = m.picks;
      this.level = m.level;
      this.offer = m.offer || {};
      this.render();
    });
    net.socket.on('levelled', (m) => {
      this.level = m.level;
      if (m.offer) this.offer = m.offer;
      onToast?.(`Level ${m.level} — a talent to choose (T)`);
      this.render();
    });
  }

  /** Fed from the `you` packet every snapshot. */
  sync(you) {
    if (!you) return;
    this.level = you.level;
    this.picks = you.picks || {};
    this.offer = you.offer || {};
    this.free = you.free ?? pointsFree(this.level, this.picks);
    this.alert.classList.toggle('on', this.free > 0 && !this.open);
    if (this.freeEl.textContent !== String(this.free)) {
      this.freeEl.textContent = this.free;
      if (this.open) this.render();
    }
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('on', this.open);
    if (this.open) { this.alert.classList.remove('on'); this.render(); }
  }

  render() {
    const free = pointsFree(this.level, this.picks);
    this.freeEl.textContent = free;

    if (free <= 0) {
      this.list.innerHTML = `<div class="nooffer">Nothing to choose just now.
        Every level deals you a fresh hand.</div>` + this.ranksHtml();
      return;
    }

    let html = '<div class="drawn">Take one:</div>';
    // Fleet command opens at level 40, so a fourth card appears from there on.
    for (const group of groupsFor(this.level)) {
      const id = this.offer[group];
      if (!id) {
        html += `<div class="tal empty"><span class="txt">
          <b>${GROUP_LABEL[group]}</b><i>nothing left to learn here</i></span></div>`;
        continue;
      }
      const t = TALENTS[id];
      const rank = this.picks[id] || 0;
      html += `
        <div class="tal card" data-talent="${id}">
          <span class="grp">${GROUP_LABEL[group]}</span>
          <span class="txt"><b>${t.name}</b><i>${t.blurb}</i></span>
          <span class="rank">${rank}/${t.max}</span>
        </div>`;
    }
    if (this.level < FLEET_LEVEL) {
      html += `<div class="locked">FLEET command opens at level ${FLEET_LEVEL}
        — consorts of your own, up to fifteen sail.</div>`;
    }
    this.list.innerHTML = html + this.ranksHtml();
  }

  /** What you have already taken, for reference under the cards. */
  ranksHtml() {
    const taken = Object.entries(this.picks).filter(([, r]) => r > 0);
    if (!taken.length) return '';
    return '<div class="grpline">ALREADY TAKEN</div>' + taken
      .map(([id, r]) => `<div class="tal taken"><span class="txt">
        <b>${TALENTS[id].name}</b></span><span class="rank">${r}/${TALENTS[id].max}</span></div>`)
      .join('');
  }
}
