// Assemble the static site GitHub Pages serves.
//
// Pages has no Node process, so there is no Express to map /shared and /vendor
// onto directories outside public/. This lays those out for real, flattened
// into one folder, and vendors the two libraries the browser needs. Nothing is
// rewritten or bundled — the files that ship are the files in the repo, which
// is the point: what you debug on localhost is what runs in production.
//
//   node tools/build-static.js [outDir]     (default: dist)

import { cp, mkdir, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.resolve(process.argv[2] || path.join(root, 'dist'));
const from = (...p) => path.join(root, ...p);
const to = (...p) => path.join(out, ...p);

async function bytes(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await bytes(p) : (await stat(p)).size;
  }
  return total;
}

/**
 * Which three addons the client actually imports. examples/jsm is tens of
 * megabytes and almost all of it is dead weight here, but hard-coding a list
 * would rot the first time someone reaches for OrbitControls — so read it off
 * the source instead.
 */
async function addonsInUse() {
  const dir = from('public', 'js');
  const found = new Set();
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.js')) continue;
    const src = await readFile(path.join(dir, name), 'utf8');
    for (const m of src.matchAll(/['"]three\/addons\/([^'"]+)['"]/g)) found.add(m[1]);
  }
  return [...found];
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// The client, at the site root.
await cp(from('public'), out, { recursive: true });

// The rules the client shares with whatever is hosting it. On Pages the
// visiting browser may BE the host, so these are not optional extras.
await cp(from('shared'), to('shared'), { recursive: true });

// three, plus exactly the addons the client asks for. three.module.js is only
// the front half of the library — it re-exports most of itself from a sibling
// three.core.js, and shipping the one without the other yields a 404 that takes
// the whole module graph down with it. Follow the relative edges rather than
// naming files by hand.
await mkdir(to('vendor', 'three'), { recursive: true });
const threeBuild = from('node_modules/three/build');
const copiedThree = [];
for (const queue = ['three.module.js']; queue.length;) {
  const name = queue.shift();
  if (copiedThree.includes(name)) continue;
  copiedThree.push(name);
  const src = await readFile(path.join(threeBuild, name), 'utf8');
  await cp(path.join(threeBuild, name), to('vendor/three', name));
  for (const m of src.matchAll(/from\s*['"]\.\/([\w.-]+\.js)['"]/g)) queue.push(m[1]);
}
const addons = await addonsInUse();
for (const rel of addons) {
  await mkdir(path.dirname(to('vendor/three/addons', rel)), { recursive: true });
  await cp(from('node_modules/three/examples/jsm', rel), to('vendor/three/addons', rel));
}

// PeerJS: WebRTC signalling for the peer-to-peer lobbies.
await mkdir(to('vendor', 'peerjs'), { recursive: true });
await cp(from('node_modules/peerjs/dist/peerjs.min.js'), to('vendor/peerjs/peerjs.min.js'));

// Pages runs everything through Jekyll unless told not to, and Jekyll silently
// drops files and folders beginning with an underscore.
await writeFile(to('.nojekyll'), '');

const kb = Math.round((await bytes(out)) / 1024);
console.log(`built ${path.relative(process.cwd(), out) || '.'} — ${kb} kB`);
console.log(`  three: ${copiedThree.join(', ')}`);
console.log(`  three addons: ${addons.join(', ') || 'none'}`);
