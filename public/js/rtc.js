// Peer-to-peer lobbies.
//
// One player's tab runs the authoritative game (see browser-host.js); everyone
// else opens a WebRTC data channel straight to it. Game traffic never touches a
// server — the only thing a third party sees is the handshake.
//
// That handshake is the one piece you cannot do peer-to-peer: two browsers that
// have never met need somewhere to swap ICE candidates. We use the public
// PeerJS broker for it. It carries a few kilobytes at the moment you join and
// nothing afterwards, so a static host like GitHub Pages is enough to run the
// whole game. Point `?broker=` at your own PeerServer if you would rather not
// depend on someone else's.

import { copy } from './link.js';
import { BrowserHost } from './browser-host.js';

const PEERJS_SRC = new URL('vendor/peerjs/peerjs.min.js', document.baseURI).href;
const NAMESPACE = 'saltpowder';
// No 0/O/1/I — these codes get read aloud and typed in by hand.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 4;
const OPEN_TIMEOUT = 20000;

// Closing a browser tab does not reliably close the data channel at the other
// end: there is no graceful shutdown, and ICE can take the better part of a
// minute to admit the peer is gone. Measured here, a guest whose host closed
// their tab was still watching a frozen sea 20 seconds later with no error of
// any kind. So neither side trusts 'close' alone — silence is the signal.
//
// The host talks constantly (15 Hz snapshots) and the guest sends input and a
// clock ping every few seconds, so a gap this long means somebody is gone.
const HOST_SILENCE = 8000;    // guest gives up on the host after this
const GUEST_SILENCE = 20000;  // host drops a guest after this

const peerIdFor = (code) => `${NAMESPACE}-${String(code).trim().toUpperCase()}`;

export const normaliseCode = (raw) =>
  String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * The broker to sign in with. Default is the PeerJS cloud; `?broker=host:port`
 * or `?broker=host:port:/path` switches to your own, and `?broker=` with a bare
 * hostname assumes 443 and TLS.
 */
function brokerOptions() {
  const raw = new URLSearchParams(location.search).get('broker');
  const opts = { debug: 0 };
  if (!raw) return opts;
  const [host, port, path] = raw.split(':');
  opts.host = host;
  if (port) opts.port = Number(port);
  opts.secure = opts.port !== 80 && opts.port !== 9000;
  if (path) opts.path = path.startsWith('/') ? path : `/${path}`;
  return opts;
}

let peerJsLoading = null;
/** Pull in the PeerJS bundle, once, and only if somebody actually plays P2P. */
function loadPeerJs() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerJsLoading) return peerJsLoading;
  peerJsLoading = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = PEERJS_SRC;
    el.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS loaded but exported nothing')));
    el.onerror = () => reject(new Error('could not load the PeerJS bundle'));
    document.head.appendChild(el);
  });
  return peerJsLoading;
}

/**
 * Resolve on `event`, reject on an error or a timeout.
 *
 * `errorsFrom` matters more than it looks: PeerJS reports "there is nobody on
 * that code" as a `peer-unavailable` error on the *Peer*, never on the
 * connection you were trying to open. Watch only the connection and a wrong
 * room code hangs for the full timeout and then blames the network.
 */
function opened(emitter, event, { ms = OPEN_TIMEOUT, errorsFrom = [] } = {}) {
  const sources = [emitter, ...errorsFrom];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out'));
    }, ms);
    const ok = (v) => { cleanup(); resolve(v); };
    const bad = (e) => { cleanup(); reject(e); };
    function cleanup() {
      clearTimeout(timer);
      emitter.off?.(event, ok);
      for (const s of sources) s.off?.('error', bad);
    }
    emitter.on(event, ok);
    for (const s of sources) s.on('error', bad);
  });
}

/** Two-element frames, so a peer cannot send us something shaped like an event. */
const frame = (event, data) => [String(event), data];
const readFrame = (raw) =>
  Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'string' ? raw : null;

/**
 * Open a lobby in this tab. Returns { code, host, peer, close } once the broker
 * has confirmed the room code is ours.
 *
 * @param link     the Link the local player's UI is already wired to
 * @param onStatus (text) => void, for the lobby card
 */
export async function hostLobby(link, { dev = false, onStatus = () => {}, attempts = 5 } = {}) {
  const Peer = await loadPeerJs();
  onStatus('Reserving a room code…');

  // Codes are short enough to collide on a shared broker. If ours is taken,
  // roll another rather than handing the player an error they cannot act on.
  let peer = null;
  let code = null;
  for (let i = 0; i < attempts; i++) {
    code = newCode();
    const candidate = new Peer(peerIdFor(code), brokerOptions());
    try {
      await opened(candidate, 'open');
      peer = candidate;
      break;
    } catch (err) {
      candidate.destroy();
      if (err?.type !== 'unavailable-id') {
        throw new Error(brokerFailure(err));
      }
    }
  }
  if (!peer) throw new Error('every room code we tried was taken — try again');

  const host = new BrowserHost({ dev });
  const heard = new Map();      // clientId -> when we last got a frame

  const drop = (id, conn) => {
    if (!heard.has(id)) return;
    heard.delete(id);
    host.disconnect(id);
    try { conn.close(); } catch { /* already gone */ }
    onStatus(`${host.players} aboard`);
  };

  peer.on('connection', (conn) => {
    // conn.peer is the guest's broker id: unique, and never chosen by them.
    const id = conn.peer;
    conn.on('open', () => {
      heard.set(id, performance.now());
      host.connect(id, (event, data) => {
        try {
          conn.send(frame(event, data));
        } catch {
          drop(id, conn);
        }
      });
      onStatus(`${host.players} aboard`);
    });
    conn.on('data', (raw) => {
      heard.set(id, performance.now());
      const f = readFrame(raw);
      if (f) host.message(id, f[0], f[1]);
    });
    conn.on('close', () => drop(id, conn));
    conn.on('error', () => drop(id, conn));
  });

  // Sweep for guests who stopped talking without ever saying goodbye. Without
  // this their ship sits on the water for everyone else, and the lobby count
  // never comes back down.
  const sweep = setInterval(() => {
    const now = performance.now();
    for (const [id, at] of heard) {
      if (now - at > GUEST_SILENCE) {
        heard.delete(id);
        host.disconnect(id);
        onStatus(`${host.players} aboard`);
      }
    }
  }, 2000);

  // The player hosting is a client too — same events, same allowlist, just with
  // no network in between. Deep-copied both ways so hosting behaves exactly
  // like guesting and neither side can reach into the other's objects.
  const LOCAL = 'local';
  host.connect(LOCAL, (event, data) => link.deliver(event, copy(data)));
  link.bind((event, data) => host.message(LOCAL, event, copy(data)), 'host');

  // The broker drops idle connections; without this a lobby stops accepting new
  // guests after a few minutes even though everyone already aboard is fine.
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });

  link.deliver('connect');
  onStatus('Lobby open');

  return {
    code,
    host,
    peer,
    close() {
      clearInterval(sweep);
      link.unbind();
      host.close();
      peer.destroy();
    },
  };
}

/** Join somebody else's lobby by room code. */
export async function joinLobby(link, code, { onStatus = () => {} } = {}) {
  const Peer = await loadPeerJs();
  const room = normaliseCode(code);
  if (room.length !== CODE_LEN) throw new Error(`a room code is ${CODE_LEN} characters`);

  onStatus('Signing in…');
  const peer = new Peer(undefined, brokerOptions());
  try {
    await opened(peer, 'open');
  } catch (err) {
    peer.destroy();
    throw new Error(brokerFailure(err));
  }

  onStatus(`Hailing ${room}…`);
  const conn = peer.connect(peerIdFor(room), { reliable: true });
  try {
    await opened(conn, 'open', { errorsFrom: [peer] });
  } catch (err) {
    peer.destroy();
    if (err?.type === 'peer-unavailable') throw new Error(`no lobby is open on ${room}`);
    throw new Error(err?.message === 'timed out'
      ? 'the host did not answer — they may be behind a network that blocks direct connections'
      : brokerFailure(err));
  }

  let lastHeard = performance.now();
  conn.on('data', (raw) => {
    lastHeard = performance.now();
    const f = readFrame(raw);
    if (f) link.deliver(f[0], f[1]);
  });

  // When the host closes their tab the lobby is simply gone — there is nothing
  // to reconnect to. Drop the wire first so anything still trying to talk (the
  // input loop runs every frame) queues quietly instead of throwing into a dead
  // channel, then tell the game so it can tell the player.
  let ended = false;
  const lost = () => {
    if (ended) return;
    ended = true;
    clearInterval(watchdog);
    link.unbind();
    link.deliver('disconnect');
  };
  const watchdog = setInterval(() => {
    if (performance.now() - lastHeard > HOST_SILENCE) lost();
  }, 1000);
  conn.on('close', lost);
  conn.on('error', lost);
  peer.on('close', lost);
  peer.on('error', (err) => { if (err?.type === 'peer-unavailable') lost(); });
  peer.on('disconnected', () => { if (!peer.destroyed && !ended) peer.reconnect(); });

  link.bind((event, data) => {
    try {
      conn.send(frame(event, data));
    } catch {
      /* channel is going away; 'close' will follow */
    }
  }, 'guest');

  link.deliver('connect');
  onStatus('Aboard');

  return { code: room, peer, conn, close() { lost(); peer.destroy(); } };
}

function brokerFailure(err) {
  if (err?.type === 'browser-incompatible') return 'this browser has no WebRTC support';
  if (err?.type === 'network' || err?.message === 'timed out') {
    return 'could not reach the matchmaking broker';
  }
  return err?.message || 'the connection failed';
}
