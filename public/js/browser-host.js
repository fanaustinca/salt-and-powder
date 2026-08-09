// The whole authoritative game, running in a browser tab.
//
// This is the payoff for keeping `shared/` free of anything environment-
// specific: there is no second implementation of the rules here. It is the same
// `GameHost` the Node server drives, given a transport that writes to WebRTC
// data channels instead of sockets and a profile store backed by localStorage.
// tools/host-test.js proves the simulation runs with no transport at all; this
// is that same fact, put to use.
import { GameHost } from '/shared/game-host.js';
import { isClientEvent } from '/shared/transport.js';
import { TICK_HZ } from '/shared/physics.js';
import { LocalProfiles } from './browser-profiles.js';

// A backgrounded tab has its timers throttled to about 1 Hz, which would turn
// the host into a slideshow for everyone connected to it. Timers inside a
// worker are not clamped the same way, so the heartbeat lives there and the
// game stays on the main thread where the peer connections are.
const TICKER_SRC = `
  let h = null;
  onmessage = (e) => {
    if (e.data.stop) { clearInterval(h); return; }
    clearInterval(h);
    h = setInterval(() => postMessage(0), e.data.every);
  };
`;

function startTicker(everyMs, onTick) {
  try {
    const url = URL.createObjectURL(new Blob([TICKER_SRC], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = onTick;
    worker.postMessage({ every: everyMs });
    return () => { worker.postMessage({ stop: true }); worker.terminate(); };
  } catch {
    // No workers (file://, locked-down browser). Play on, just keep the tab up.
    const h = setInterval(onTick, everyMs);
    return () => clearInterval(h);
  }
}

export class BrowserHost {
  /**
   * @param dev  enable the console cheats for everyone in this lobby
   */
  constructor({ dev = false, log = (m) => console.log('[lobby]', m) } = {}) {
    this.sinks = new Map();      // clientId -> (event, data) => void
    this.log = log;
    const startedAt = performance.now();

    this.game = new GameHost({
      transport: {
        broadcast: (event, data) => {
          for (const sink of this.sinks.values()) sink(event, data);
        },
        send: (clientId, event, data) => this.sinks.get(clientId)?.(event, data),
      },
      profiles: new LocalProfiles(),
      now: () => (performance.now() - startedAt) / 1000,
      dev,
      log,
    });

    let last = performance.now();
    this.stopTicker = startTicker(1000 / TICK_HZ, () => {
      const t = performance.now();
      // A tab that was hidden or a laptop that was shut comes back with a huge
      // gap. Cap it: the sea should resume, not fast-forward through a minute
      // of simulation in one frame.
      const frame = Math.min((t - last) / 1000, 0.25);
      last = t;
      try {
        this.game.tick(frame);
      } catch (err) {
        console.error('host tick failed:', err);
      }
    });
  }

  get players() { return this.game.players.size; }

  /** A client has arrived. `sink` carries host -> that client. */
  connect(clientId, sink) {
    this.sinks.set(clientId, sink);
  }

  disconnect(clientId) {
    if (!this.sinks.has(clientId)) return;
    this.sinks.delete(clientId);
    this.game.leave(clientId);
  }

  /**
   * Client -> host. Anything not on the shared allowlist is dropped here, so a
   * peer who opens devtools and starts inventing events reaches nothing. The
   * dev hooks are on the list but `GameHost` itself refuses them unless this
   * lobby was opened with cheats on.
   */
  message(clientId, event, data) {
    if (!this.sinks.has(clientId)) return;
    if (!isClientEvent(event)) return;
    try {
      this.game.message(clientId, event, data);
    } catch (err) {
      console.error(`host rejected "${event}":`, err);
    }
  }

  close() {
    this.stopTicker?.();
    for (const id of [...this.sinks.keys()]) this.disconnect(id);
    // stop() flushes as it goes; flush() is the fallback for a plain store.
    (this.game.profiles.stop ?? this.game.profiles.flush)?.call(this.game.profiles);
  }
}
