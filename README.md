# Salt & Powder

A shared 3D ocean where real players sail against the same wind and the same
weather. This is the foundation the rest of the game (combat, bases, crews,
economy) gets built on.

```bash
npm install
npm start          # http://localhost:3000
```

Open the page in two browser windows (or on another machine on your network) and
both ships appear in the same sea.

## Controls

| Key | Does |
| --- | --- |
| `A` / `D` | Put the helm over |
| `W` / `S` | Hoist / furl sail |
| `Q` / `E` | Take the sheet off your crew for a few seconds (optional) |
| **Left click** | **Aim anywhere on the sea and fire** |
| `Z` `X` `F` `V` | Fire a battery straight out its beam (keyboard fallback) |
| `R` | Drop a TNT barrel astern |
| `T` | Talent sheet — spend the point each level gives you |
| `B` | Chandlery — spend Crowns on wake trails |
| drag / wheel | Look around, zoom |
| `Shift`+`T` | Dev: summon a rogue wave instead of waiting for one |

## Handling

`W`/`S` is the throttle, `A`/`D` the helm. **There is no wind mechanic** — every
heading makes the same speed, so you steer and shoot rather than manage a rig.
There is **no astern** either: a sailing ship cannot back up, so she takes a
while to gather way and a while to lose it. Plan your approach to a jetty.

```
                        top   hull  guns/side  hold      cost   rig
Sailboat              25 kn    100     3        8       free   1 mast, mainsail
Cutter                26 kn    140     4       12        400   1 mast, jib + main
Brigantine            24 kn    200     6       18      1,100   2 masts
Corvette              23 kn    280     8       24      2,400   3 masts, square
Frigate               22 kn    350    10       32      4,400   3 masts, 2 gun decks
Galleon               19 kn    460    12       64      6,400   high stern castle, huge hold
Man-of-War            21 kn    560    15       50      9,800   3 gun decks
Flagship              19 kn    850    20       72     19,000   4 masts, 3 decks
Leviathan             17 kn  1,250    28      104     38,000   4 masts, 4 decks
```

The **Cutter** is the quickest hull afloat for her size — a headsail is worth real
speed. The **Galleon** is the odd one out: slow and tubby, but she carries more
than a Man-of-War.

### They are different shapes, not different sizes

Scaling one hull up is what makes a fleet look like one ship at five zoom levels,
so `shared/rig.js` carries shape as well as size:

| | bow | sheer | aftercastle | mizzen | other |
|---|---|---|---|---|---|
| Corvette | fine | flat | 1 step | gaff | — |
| Frigate | finest | flattest | 1 step | gaff | 2 gun decks |
| **Galleon** | bluff | huge | **3 steps** | **lateen** | beakhead, masts raked hard aft |
| Man-of-War | full | moderate | 2 steps | gaff | 3 gun decks |
| Leviathan | full | high | 3 steps | gaff | 4 gun decks, 4 masts |

`bow` sets how full the entry is, `transom` how slab-sided the stern is, and
`sheer` how far the rail sweeps up at the ends — the bulwark is built as a swept
ribbon from those numbers rather than a constant-height extrusion, because the
sheer line is most of what gives a hull its character.

On top of that each class carries a **`features` list** of structures no other
class has:

```
Sailboat    open boat, thwarts, no deck furniture
Cutter      cabin trunk, long bowsprit
Brigantine  cabin trunk, boats slung from davits, hammock netting
Corvette    flush deck, netting, stowed boats
Frigate     quarterdeck, boats, netting, entry port
Galleon     beakhead, three stern galleries, lateen mizzen, stern lantern
Man-of-War  poop deck, QUARTER GALLERIES, entry port, boats, lantern
Flagship    + gilded carved transom, three stern lanterns
Leviathan   + ram beak
```

Quarter galleries — the bay windows on the stern corners — only appear from
Man-of-War up, so a rated warship is recognisable from astern at any distance.

**Each class is a different ship, not a bigger one.** A Sailboat is a single-masted
cutter with a gaff main. A Brigantine adds a second mast with square topsails
forward. A Frigate is fully square-rigged on three masts with two gun decks. A
Man-of-War puts three decks of guns under the same rig. A Flagship carries four
masts, sixteen sails on three levels, twelve guns a side and a lit stern castle.
The whole model is generated from `shared/rig.js`, so adding a hull is a table
entry rather than a modelling job.

**`rig.js` is in `shared/` for a reason.** The client places the gun meshes from
`gunPlacements()` and the host spawns cannonballs from the *same* function, so a
shot always leaves the barrel you can see. When those were separate the muzzle
maths was hardcoded to the Sailboat and a Flagship's broadside came out of thin
air amidships. `node tools/muzzle-test.js` checks every gun on every class agrees
to within half a metre.

Sails furl. Below about a third throttle the canvas rolls up to the yards, so a
ship lying stopped has a completely different silhouette from one under way.

Bigger hulls hit harder and carry more, and pay for it in speed and turning.
Islands are solid: run at one and you stop, and it costs you hull.

## Trade

Sink a ship and its hold spills into the water. Sail over the crates to take
them aboard — **anyone** can, so finishing someone off next to a rival is a real
risk. Carry the loot to a **Safe Haven** (the islands with lighthouses, marked
gold on the compass) and sell it for **Coins**, which is how you buy a bigger
hull.

Your **home base** is a fixed island — green on the compass, the same one every
session. Only there can you spend Crowns on armour.

Each Safe Haven sits inside a **white ring** drawn on the water. Inside it no gun
will fire, no shot or powder can hurt you, and the carpenters repair your hull at
about 9% a second. Outside it you are fair game. Islets are just rocks — no trade,
no protection, and they will still stop you dead.

## Weather

The wind veers, backs and gusts on its own, between a light air and a hard blow.
**The sea follows it**, but slowly — swell takes minutes to build and minutes to
lie down again, so a sudden gust does not instantly raise a sea. The state is on
the HUD: CALM through to HIGH SEA.

Every few minutes a **rogue wave** runs across the whole chart: a deep trough
first, then a single crest of six to twelve metres. It is broadcast the moment it
starts its run from off the edge of the map, and **each client counts down its own
arrival** — the crest is a moving plane, so ships on the near side are warned, and
hit, first. Turn your bow into it. The face is steep enough to surf off.

## Gunnery and talents

**You start with one gun a side and nothing else.** No bow chaser, no stern
chaser, one barrel of powder, 100 hull. Every other gun on the ship is bought
with a talent point, and you get one point per level:

```
GUNS   Run Out the Guns  +1 gun each side, up to the hull's limit
       Bow Chaser        a gun that fires ahead
       Stern Chaser      a gun to cover your wake
CREW   Gunnery           +9% damage
       Powder Monkeys    -8% reload
       Seamanship        +7% helm, +3% speed
SHIP   Oak & Tar         +18 hull
       Powder Store      +1 TNT barrel
```

**You do not shop the tree.** Each level deals you exactly three cards — one
rolled at random from each section — and you take one. The host rolls the hand
and only accepts a pick that was actually on the table, so a client cannot
reroll for something better. A build is partly dealt and partly chosen.

### Aiming

Point at the sea and left-click. The guns that can bear train round onto that
bearing and the elevation is solved so the ball lands where you clicked, out to
180 m. Firing arcs are drawn on the water — green when that battery is loaded,
red while it reloads, and only for batteries you actually own. Dragging the
mouse still orbits the camera; a click only fires if the pointer barely moved.

**The host picks the gun, not the client.** You send a bearing and a range; the
host decides which battery covers that bearing, whether you own it, whether it
is loaded, and clamps the aim into the arc. A client cannot ask to fire a gun it
has not bought or reach further than the guns allow.

Shot flies flat and fast because guns lobbed at a realistic elevation sail clean
over anything you are actually fighting. Closing to pistol shot is the point.

> Worth knowing if you touch `solveElevation`: the textbook `v² sin(2θ)/g` range
> formula assumes you launch and land at the same height. Guns sit 2.4 m above
> the water, and ignoring that threw a shot aimed at 40 m a full 97 m. It solves
> the real quadratic now, which at short range means aiming slightly *down*.

TNT barrels (`R`) drop astern, burn a 4-second fuse and take 85 off anything
within 24 m — **including you**, once they arm 0.8 s after the splash. The hold
makes a new keg every 40 seconds.

Damage dealt is XP. Sink someone and you take 120 XP and 40 Crowns off them. Sunk hulls settle by the head, roll over
and go down; you are refitted and back at sea seven seconds later, keeping every
level, pick and trail you had earned.

**The server owns every shot.** Clients replay the same ballistics from the
launch data they are sent, so what you watch is what the server already scored —
a client cannot invent a hit.

## Phase 4 — what else is out there

**AI fleets.** Squadrons of the Spanish Armada, Dutch Navy, Freebooters and
Treasure Fleets form up in open water and patrol. **They are matched to the
captain they turn up for** — a new hand in a Sailboat meets cutters, not a
three-decker — and they appear 700–1400 m off, over the horizon but close enough
to actually meet:

```
level  1   cutter, cutter, sailboat        crews raw
level  8   brigantines                     crews green
level 22   frigates and a corvette         gunnery 4, reload 3
level 48   leviathans and flagships        crews fully worked up
```

The Armada takes the heaviest hull the band allows, the Dutch the middle,
freebooters the lightest but more of them, and a Treasure Fleet picks whatever
in the band has the biggest hold — which is exactly why it is worth taking. They sail the same hulls under
the same physics with the same guns as you — there is no cheating layer. What
makes them dangerous is that they fight like captains:

- they **work for the broadside**, steering to put you abeam rather than at you
- they **hold a firing range** instead of ramming (measured: never inside 40 m)
- they **shoot where you are going**, leading the target by the ball's flight
  time — and a better crew leads better and scatters less
- they **run** once their hull is under 28%
- consorts **keep station** on the flag in line ahead
- they fight **each other**, not just you

They also refuse to fight inside a Safe Haven's ring, and steer out of one if
they drift in, because no gun works in there.

**The Kraken.** Eight arms, each one telegraphing before it lands. She surfaces
near whoever is in open water, drags herself toward the nearest hull and slams.
2,600 hull, and she is worth 900 XP and 260 Crowns.

**Salvage, crafting and shot.** Wrecks spill timber, iron, powder and sulphur.
Sail over it to take it aboard, then use the gunner's bench alongside any island:

```
Chainshot        2 iron              cuts rigging — halves their speed
Grapeshot        1 iron 1 powder     four balls a gun
Heated shot      2 powder 1 sulphur  sets fires that keep burning
Explosive shot   2 powder 2 sulphur 1 iron   bursts on impact
```

Twelve rounds a batch, and `1`–`5` switches what is in the guns.

**Armour sets** — Iron, Bronze and Platinum plate drop from rated warships and
treasure hulls, worth 10%, 18% and 28% off every hit.

## Crowns and trails

You earn **Crowns** for sea miles under the keel — about 12 a minute at a working
pace — plus 60 for still being aboard when a rogue wave rolls through you. Spend
them in the chandlery (`B`) on **wake trails**: Azure, Emerald, Ember, Amethyst,
Doubloon, Spectre and Black Powder, from 45 up to 520. The bright ones glow and
burn additively over the water; a bought trail also streams roughly twice as far
astern as plain foam, so other players can see what you are wearing from a way
off. Trails ride on every ship in the world, not just your own.

The catalogue is `shared/cosmetics.js` — adding a trail is one entry. **Every
purchase is validated server-side** against that table, so a client cannot grant
itself anything, and balances live in `data/profiles.json` keyed by captain name.
That name is the only identity there is for now, which is the seam to replace
when real logins arrive.

> Two socket hooks (`summon-tsunami`, `grant-crowns`) exist for testing and will
> hand any client a rogue wave or free Crowns. Run with `PIRATE_DEV=0` to turn
> them off before this server faces anyone you don't know.

## Layout

```
shared/physics.js   sailing model — imported unchanged by BOTH server and client
shared/waves.js     Gerstner field, sea state and the rogue wave; emits the
                    matching GLSL so the water you float on is the water you see
shared/combat.js    ballistics, batteries, ammo, damage, XP curve, talent tree
shared/cosmetics.js trail catalogue and Crown rates, shared by shop and host
shared/game-host.js THE GAME: weather, players, crowns, the fixed-step tick
shared/combat-host.js  shots, hits, sinking, respawn — the host judges every hit
shared/transport.js contract between the game and however messages travel
server.js           thin Node adapter: express + socket.io -> GameHost
server-profiles.js  Crowns and owned trails, persisted to data/profiles.json
public/js/main.js   scene, sky, lighting, prediction, camera, main loop
public/js/net.js    socket wrapper, clock sync, snapshot interpolation
public/js/ocean.js  ocean shader (waves, fresnel, sun glitter, foam, haze)
public/js/ship.js   sloop model, sail shaping, buoyancy from the wave field
public/js/wake.js   foam ribbon astern
public/js/hud.js    readouts, warnings and the ship-up compass
```

### The host is not the server

`shared/game-host.js` is the whole authoritative game, and it knows nothing about
sockets, HTTP or the filesystem. It talks to two interfaces defined in
`shared/transport.js` — a transport (`broadcast` / `send`) and a profile store —
so the identical simulation can run behind socket.io on Node **or inside a
browser tab hosting a peer-to-peer lobby over WebRTC data channels**. `server.js`
is a ~80-line adapter that adds no game rules of its own.

`node tools/host-test.js` runs the entire game — sailing, weather, gunnery,
sinking, XP, talents, crowns — with no server, no sockets and no browser. If that
passes, the abstraction is real.

**Nothing in `shared/` may import anything environment-specific.**

**The host is the authority.** Clients send key state, the host runs
`stepShip` at a fixed 30 Hz and broadcasts snapshots at 15 Hz. The client predicts
its own ship with the same code and eases any error out over ~300 ms, and draws
other players ~120 ms in the past so jitter never becomes stutter. Because both
sides import `shared/physics.js` and `shared/waves.js` there is only one sailing
model and one sea to keep honest.

### Two conventions worth knowing before you touch this

- `heading` is a maths angle about `+Y`. In three's right-handed frame with the
  bow on `+Z`, that runs *anticlockwise* from the helmsman's point of view, so a
  starboard turn lowers it. `stepShip` negates the rudder for exactly this
  reason, the HUD shows `-heading` as the compass bearing, and the compass dial
  flips every relative bearing on the way in. Get any one of them wrong on its
  own and the controls or the dial come out mirrored.
- Do not bake an environment map straight off the `Sky` shader. Its values near
  the sun overflow a half-float target, and the NaNs that come back render every
  lit material pure black — including its emissive term, which makes it a
  confusing thing to debug. `main.js` bakes a hand-drawn LDR sky instead.

## Dev tools

```bash
npm run tune                 # speed polar + what mistrimming costs
node tools/bot.js 3          # 3 headless crew bots so you can test alone
node tools/smoke.js          # headless browser: joins, checks the helm answers
                             # correctly, summons a rogue wave, screenshots ./shots
node tools/combat-test.js    # two browsers, one fight: hits, sinking, respawn
node tools/talent-test.js    # starter armament, locked batteries, talent spending
node tools/host-test.js      # the whole game with no transport at all (fast, no browser)
node tools/shop-test.js      # earns crowns, gets refused, buys, wears, photographs
node tools/diag.js           # overhead plan view for checking the boom's side
```

`tools/smoke.js` and `tools/diag.js` need Chrome's system libraries
(`libnss3`, `libnspr4`). They are not needed to play.

## Next: Phase 2

The seams are in place — ship classes live in `SHIP_CLASSES`, weather is
server-side and broadcast, and every ship's state is one flat object that is cheap
to extend with hull damage, cargo and crew.
