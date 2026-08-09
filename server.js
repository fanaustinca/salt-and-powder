// Node adapter. All this does is serve files, speak socket.io, and drive a
// GameHost — the actual game lives in shared/game-host.js so the same
// simulation can be hosted from a browser over WebRTC instead.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import compression from 'compression';
import { Server } from 'socket.io';
import { TICK_HZ } from './shared/physics.js';
import { GameHost } from './shared/game-host.js';
import { Profiles } from './server-profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// Dev hooks let any client summon a rogue wave, teleport, or hand itself Crowns.
// Fine on a laptop, not fine anywhere public — PIRATE_DEV=0 turns them off.
const DEV = process.env.PIRATE_DEV !== '0';
const ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/three/addons', express.static(path.join(__dirname, 'node_modules/three/examples/jsm')));
app.get('/healthz', (_req, res) => res.json({ ok: true, players: host.players.size }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });

/** Host-side transport over socket.io. */
class SocketTransport {
  constructor(io) {
    this.io = io;
    this.sockets = new Map();
  }
  add(socket) { this.sockets.set(socket.id, socket); }
  remove(id) { this.sockets.delete(id); }
  broadcast(event, data) { this.io.emit(event, data); }
  send(clientId, event, data) { this.sockets.get(clientId)?.emit(event, data); }
}

const startedAt = Date.now();
const now = () => (Date.now() - startedAt) / 1000; // shared clock, seconds

const transport = new SocketTransport(io);
const profiles = new Profiles(process.env.DATA_DIR || path.join(__dirname, 'data'));
const host = new GameHost({
  transport, profiles, now, dev: DEV, log: (m) => console.log(m),
});

// Every client message routes through the host; the adapter adds no game rules.
const CLIENT_EVENTS = [
  'join', 'input', 'ping-t', 'fire', 'drop-tnt', 'spend-talent',
  'buy-trail', 'equip-trail', 'sell-cargo', 'buy-ship', 'buy-armour', 'set-ammo', 'craft',
  'summon-tsunami', 'grant-crowns', 'dev-xp', 'dev-place', 'dev-cargo', 'grant-coins', 'dev-hurt', 'dev-class', 'dev-picks', 'reset-profile', 'dev-fleet', 'dev-kraken',
];

io.on('connection', (socket) => {
  transport.add(socket);
  for (const event of CLIENT_EVENTS) {
    socket.on(event, (data) => host.message(socket.id, event, data));
  }
  socket.on('disconnect', () => {
    host.leave(socket.id);
    transport.remove(socket.id);
  });
});

let last = Date.now();
setInterval(() => {
  const t = Date.now();
  const frame = (t - last) / 1000;
  last = t;
  host.tick(frame);
}, 1000 / TICK_HZ);

server.listen(PORT, () => {
  console.log(`\n  Pirate seas open at http://localhost:${PORT}`);
  console.log(`  dev hooks: ${DEV ? 'ON (set PIRATE_DEV=0 to disable)' : 'off'}\n`);
});
