// Crew bots: headless clients that join the server and sail a course, so you
// can test multiplayer on your own.
//
//   node tools/bot.js            # one bot
//   node tools/bot.js 3          # three bots
//   node tools/bot.js 2 http://192.168.1.20:3000
import { io } from 'socket.io-client';
import { normalizeAngle } from '../shared/physics.js';

const COUNT = Number(process.argv[2] || 1);
const URL = process.argv[3] || 'http://localhost:3000';
const NAMES = ['Blackjack', 'Morgan', 'Redbeard', 'Kestrel', 'Anne Bonny', 'Silver', 'Rackham', 'Teach'];

for (let i = 0; i < COUNT; i++) setTimeout(() => spawn(i), i * 400);

function spawn(i) {
  const name = NAMES[i % NAMES.length];
  const socket = io(URL, { transports: ['websocket'] });
  let id = null;
  let wind = { dir: 0, speed: 10 };
  let self = null;
  let course = Math.random() * Math.PI * 2;
  let seq = 0;

  socket.on('connect', () => socket.emit('join', { name }));
  socket.on('init', (msg) => { id = msg.id; console.log(`${name} joined as ${id}`); });
  socket.on('state', (s) => {
    wind = { dir: s.w.d, speed: s.w.s };
    self = s.ships.find((sh) => sh.id === id) || self;
  });

  // Sail a slow circuit, tacking away from the no-go zone and trimming to suit.
  setInterval(() => {
    if (!self) return;
    course = normalizeAngle(course + 0.005); // long, lazy circuits

    // Every heading is sailable now, so just hold the course. The crew aboard
    // handles the sheet, so the bot never touches it.
    const off = normalizeAngle(course - self.h);
    socket.emit('input', {
      r: Math.abs(off) < 0.05 ? 0 : -Math.sign(off), // +1 rudder = starboard = lower heading
      s: 0,
      h: self.ho < 0.99 ? 1 : 0,
      seq: ++seq,
    });
  }, 100);

  setInterval(() => {
    if (self) {
      const kn = Math.hypot(self.vx, self.vz) * 1.94384;
      console.log(`  ${name}: ${kn.toFixed(1)} kn  hdg ${((self.h * 180 / Math.PI + 360) % 360).toFixed(0)}°  sheet ${self.sh.toFixed(2)}`);
    }
  }, 5000);
}
