// The join screen: pick a name, pick how you are getting to sea.
//
// Three routes, all ending at the same `Link`:
//   server  — socket.io to a Node host (only offered when one is actually there)
//   host    — run the game in this tab, hand out a room code
//   guest   — WebRTC data channel to whoever is hosting that code
//
// Nothing downstream of the Link knows or cares which of the three happened.

import { hostLobby, joinLobby, normaliseCode } from './rtc.js';

const $ = (id) => document.getElementById(id);

/** Is there a Node server behind this page, or are we on a static host? */
async function serverPresent() {
  try {
    const res = await fetch(new URL('healthz', document.baseURI), {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** socket.io, imported only if we are actually going to use it. */
async function connectServer(link) {
  const url = new URL('socket.io/socket.io.esm.min.js', document.baseURI).href;
  const { io } = await import(url);
  const socket = io({ transports: ['websocket', 'polling'] });

  // onAny skips socket.io's own reserved events, so those are wired by hand.
  socket.onAny((event, data) => link.deliver(event, data));
  socket.on('connect', () => link.deliver('connect'));
  socket.on('disconnect', () => link.deliver('disconnect'));
  link.bind((event, data) => socket.emit(event, data), 'server');
  return socket;
}

export class Lobby {
  /**
   * @param link    the Link every panel is already bound to
   * @param onEnter (mode) => void — called once we are connected and the player
   *                should be put on the water
   */
  constructor(link, onEnter) {
    this.link = link;
    this.onEnter = onEnter;
    this.busy = false;
    this.session = null;      // { close() } for a P2P lobby

    this.el = $('join');
    this.name = $('name');
    this.status = $('joinstatus');
    this.routes = $('routes');
    this.codebox = $('codebox');
    this.code = $('code');
    this.dev = /(^|[?&])dev=1/.test(location.search);

    this.name.value = localStorage.getItem('pirate.name') || '';

    $('sail').addEventListener('click', () => this.go('server'));
    $('hostlobby').addEventListener('click', () => this.go('host'));
    $('joinlobby').addEventListener('click', () => this.showCodeBox());
    $('codego').addEventListener('click', () => this.go('guest'));
    this.code.addEventListener('input', () => {
      this.code.value = normaliseCode(this.code.value);
    });
    this.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.go('guest'); });
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.go($('sail').hidden ? 'host' : 'server');
    });
  }

  /** Work out which routes to offer, and honour an invite link. */
  async open() {
    const invite = new URLSearchParams(location.search).get('join');
    const hasServer = await serverPresent();
    $('sail').hidden = !hasServer;
    $('orline').hidden = !hasServer;
    this.say(hasServer
      ? 'Sail on this server, or open a lobby your friends join by code.'
      : 'No server here — one of you hosts the sea, the rest join by code.');

    if (invite) {
      this.code.value = normaliseCode(invite);
      this.showCodeBox();
      this.say(`Invited to lobby ${this.code.value}. Enter a name and join.`);
    }
    this.name.focus();
  }

  showCodeBox() {
    this.codebox.hidden = false;
    this.code.focus();
  }

  say(text, bad = false) {
    this.status.textContent = text;
    this.status.style.color = bad ? 'var(--bad)' : '';
  }

  captainName() {
    const n = (this.name.value || '').trim().slice(0, 16) || 'Sailor';
    localStorage.setItem('pirate.name', n);
    return n;
  }

  async go(mode) {
    if (this.busy) return;
    this.busy = true;
    this.routes.classList.add('working');
    const name = this.captainName();

    try {
      if (mode === 'server') {
        this.say('Signalling the harbour…');
        await connectServer(this.link);
      } else if (mode === 'host') {
        this.say('Opening a lobby…');
        this.session = await hostLobby(this.link, {
          dev: this.dev,
          onStatus: (s) => this.say(s),
        });
        showLobbyChip(this.session.code);
      } else {
        const room = normaliseCode(this.code.value);
        if (!room) throw new Error('enter the four-character room code');
        this.session = await joinLobby(this.link, room, { onStatus: (s) => this.say(s) });
        showLobbyChip(this.session.code, false);
      }
      this.el.style.display = 'none';
      this.onEnter(name, mode);
    } catch (err) {
      this.say(err.message || String(err), true);
      this.busy = false;
      this.routes.classList.remove('working');
    }
  }
}

/**
 * The room code, parked where the player can read it out or copy an invite
 * link. It is the only thing a guest needs, so it should never be more than a
 * glance away.
 */
function showLobbyChip(code, isHost = true) {
  const chip = $('lobbychip');
  if (!chip) return;
  const invite = new URL(location.href);
  invite.search = `?join=${code}`;
  chip.hidden = false;
  chip.innerHTML = `<span class="lbl">${isHost ? 'HOSTING' : 'LOBBY'}</span>
    <b>${code}</b><span class="cp">copy invite</span>`;
  chip.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(invite.href);
      chip.querySelector('.cp').textContent = 'copied';
      setTimeout(() => { chip.querySelector('.cp').textContent = 'copy invite'; }, 1600);
    } catch {
      chip.querySelector('.cp').textContent = invite.href;
    }
  });
}
