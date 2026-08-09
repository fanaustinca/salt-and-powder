# Salt & Powder

A shared 3D ocean where real players sail against the same weather, fight with
the same guns, and spend what they take at the same ports.

**Play it: https://fanaustinca.github.io/salt-and-powder/** — one of you clicks
**HOST A LOBBY**, reads out the four-character code, everyone else types it in.
No server, no install, no account.

Or run a proper always-on host:

```bash
npm install
npm start          # http://localhost:3000
```

## Two ways to get to sea

The join screen offers whichever routes are actually available:

| | Who is the authority | Needs |
| --- | --- | --- |
| **This server** | a Node process running `server.js` | somewhere to run Node |
| **Host a lobby** | one player's browser tab | nothing |
| **Join a lobby** | somebody else's browser tab | their room code |

The page probes for `/healthz` on load. On GitHub Pages there is no server to
answer, so **SET SAIL** is not offered at all and the peer-to-peer routes are the
whole menu; run it locally and all three appear.

### What peer-to-peer actually means here

The player who hosts is running the *entire game* — weather, AI squadrons, the
Kraken, every shot — in their tab. Everyone else opens a **WebRTC data channel**
straight to them. Game traffic never touches a third party.

The one thing that cannot be done peer-to-peer is the introduction: two browsers
that have never met need somewhere to swap ICE candidates. That runs through the
public **PeerJS broker** — a few kilobytes at the moment you join and nothing
afterwards. `?broker=host:port` points it at your own [PeerServer] instead.

Worth knowing before you rely on it:

- **The host tab is the server.** Close it and the lobby is gone. Guests are told,
  rather than left staring at a frozen sea.
- **Progress lives in the host's browser.** Crowns, Coins, hull and cosmetics are
  saved to *their* `localStorage`, keyed by captain name exactly as the server
  keys `data/profiles.json`. Different host, different books.
- **A backgrounded tab throttles timers to about 1 Hz**, which would make the host
  a slideshow for everyone. The tick runs in a Web Worker to dodge that, but the
  host should still keep the tab open.
- **Some networks block direct connections.** PeerJS ships STUN and TURN relays
  that cover the usual home NAT; a locked-down corporate or campus network may
  still refuse, and the guest is told so rather than left hanging.
- **Snapshots go down a reliable, ordered channel.** Simple and correct, but one
  lost packet briefly holds up the ones behind it. An unreliable channel for
  state would ride out loss better and is the obvious next move.

Open the page twice, or on another machine, and both ships appear in the same
sea either way.

[PeerServer]: https://github.com/peers/peerjs-server

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

## On a phone or tablet

The published link works on mobile. Touch controls appear on their own when the
page is opened on something you touch — `?touch=1` forces them on a desktop
browser for testing.

```
SAIL   left, vertical, absolute — drag it and leave it there
HELM   bottom, horizontal, proportional, springs back amidships
tap the sea    aim and fire, exactly as a click does
drag           look around      ·      pinch      zoom
FIRE KEG SHOT TAL SHOP
```

Two of those deserve explaining, because they are not just the keyboard with
bigger buttons:

**The sail lever is absolute, the keyboard throttle is a rate.** `W` ramps the
canvas up while it is held, which is fine with a finger resting on a key and
miserable on glass. The lever is an order — drag it to two thirds and the ship
chases it and settles there. It emits the same −1/0/+1 the keyboard does, so the
host needs no idea any of this is happening.

**The helm is proportional.** Most of sailing is holding a course, not turning
hard, and a left/right button cannot do that. This meant the host had to stop
quantising the rudder to hard-over — it clamps to ±1 now instead, or the host
and the client's own prediction would be on different rudders every tick and the
ship would feel like it was fighting your thumb.

### A portrait phone needed a different camera

Field of view is specified vertically, so a tall screen keeps the vertical angle
and throws the horizontal one away. Measured on a 390×844 phone with the desktop
camera: **28.7° across, 14% of the screen aimable, nothing beyond 26 m** of the
guns' 180 m reachable. You could sail perfectly well and you could not fight at
all — your own broadside pointed off the edge of the screen.

So the narrower the screen, the wider the lens and the higher and further back
the camera, which spends a portrait screen's height on sea rather than sky:

```
                        aspect   fov   hfov   aimable   reach
desktop 16:9             1.78    58°    89°     —        —
iPad landscape           1.44    58°    77°     67%     91 m
iPhone portrait          0.46    87°    48°     33%     93 m   (was 14%, 26 m)
```

Landscape and desktop are left exactly as they were — the adjustment fades in
below 0.85 aspect and is fully applied by 0.45. `node tools/touch-test.js`
measures the aimable fraction on both devices and fails if it drops below a
quarter of the screen, because that is the number that decides whether the game
is playable in your hand.

## Console cheats

Open devtools and type `cheat.help()`. They only work where the host has dev
hooks on: a Node server has them on by default (`PIRATE_DEV=0` turns them off),
and a browser lobby needs the host to have asked for them once:

```
https://fanaustinca.github.io/salt-and-powder/?dev=1     turn them on, and remember
https://fanaustinca.github.io/salt-and-powder/?dev=0     turn them off again
```

**The flag sticks** in that browser's `localStorage` after the first visit,
because needing the parameter on every load meant the cheats looked broken the
moment you opened the game from a bookmark — and an invite link carries only the
room code. The join card says "Cheats on" when they are, since silently-off dev
hooks are indistinguishable from broken ones. It only ever affects a lobby *you*
host; a guest gets whatever their host allows.

```js
cheat.kraken()          // she comes up now, instead of on her own timer
cheat.fleet('dutch')    // armada | dutch | treasure | pirate
cheat.ship('leviathan') // command any hull without paying for it
cheat.picks({ broadside: 27, bowchaser: 1, sternchaser: 1, gunnery: 8 })
cheat.tsunami(30, 20)   // a 30 m crest, arriving in 20 seconds
cheat.level(75)         // jump to a level — there is no cap
cheat.xp(4000)          // raw XP, the long way round
cheat.coins(50000); cheat.crowns(5000)
cheat.cargo(99); cheat.hurt(50)
cheat.goto('home')      // or a haven by index or name
cheat.reset()           // wipe this captain back to a bare sailboat
```

**The Kraken will not surface inside a Safe Haven ring** — nothing can be hurt
in there, so she would just be an animation flailing at nobody. If
`cheat.kraken()` appears to do nothing, sail out of the white circle first. Same
for being sunk: she needs a hull to come up beside.

Every cheat is validated and capped by the host, so a bigger number does not get
you a bigger number, and a client whose host has cheats off is simply ignored.
`node tools/cheat-test.js` runs all of them and checks both halves of that.

## Handling

`W`/`S` is the throttle, `A`/`D` the helm. **There is no wind mechanic** — every
heading makes the same speed, so you steer and shoot rather than manage a rig.
There is **no astern** either: a sailing ship cannot back up, so she takes a
while to gather way and a while to lose it. Plan your approach to a jetty.

**She turns better with way on, but she always turns.** Rate of turn scales with
speed — measured at about 2.9× flat out versus dead in the water, on every class
— because a rudder needs water moving past it. It does *not* go to zero, though,
and that floor is not realism, it is a rescue: with no steerage at all, a ship
stopped against a beach could not turn away from the beach, and sail only drove
her further on. The only way out was to sink. You can always work her round now,
slowly. `npm run tune` prints the whole table.

```
                        top   hull  guns/side  hold      cost   rig
Sailboat              27 kn    100     3        8       free   1 mast, mainsail
Cutter                28 kn    140     4       12        400   1 mast, jib + main
Brigantine            26 kn    200     6       18      1,100   2 masts
Corvette              24 kn    280     8       24      2,400   3 masts, square
Frigate               23 kn    350    10       32      4,400   3 masts, 2 gun decks
Galleon               20 kn    460    12       64      6,400   high stern castle, huge hold
Man-of-War            21 kn    560    15       50      9,800   3 gun decks
Flagship              19 kn    850    20       72     19,000   4 masts, 3 decks
Leviathan             18 kn  1,250    28      104     38,000   4 masts, 4 decks
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
| **Flagship** | full | moderate | 2 steps | **square** | 4 masts, 3 gun decks |
| **Leviathan** | full | high | 3 steps | **square** | 4 masts, 4 gun decks |

`bow` sets how full the entry is, `transom` how slab-sided the stern is, and
`sheer` how far the rail sweeps up at the ends — the bulwark is built as a swept
ribbon from those numbers rather than a constant-height extrusion, because the
sheer line is most of what gives a hull its character.

### The hull is lofted, not extruded

Those numbers are all *plan view*. For a long time the mesh was a single
`ExtrudeGeometry` of that outline pushed straight down — which is a prism:
identical cross-section from rail to keel, vertical sides, the same bevel on
every class. Nine ships, one hull, nine scales. The plan differed and the vessel
did not.

A hull's character is mostly in its **section**, so `hullHalfAt(rig, t, y)` now
gives the breadth at a station *and a height*, and the mesh is lofted from it:

| | tumblehome | flare | bilge | reads as |
|---|---|---|---|---|
| Cutter | none | strong | slack | a dry, flared little boat |
| Frigate | slight | strong | **sharp V** | lean and fast |
| **Galleon** | **enormous** | none | **full and round** | vast at the water, narrow on deck |
| Man-of-War | heavy | slight | full | a wall of gunports leaning inboard |

**The guns are placed against `hullHalfAt`, not `halfBeamAt`.** On a hull with
tumblehome the side at gun height is most of a metre inboard of the waterline
breadth, and placing a barrel from the wrong one puts it in mid-air — the same
class of bug the muzzle test was written for. Deck, wales and the entry-port
steps all follow the surface at their own height for the same reason.

`node tools/hull-test.js` checks each hull's triangles point *outward*. The
lofted hull first shipped inside-out — the material is `FrontSide`, so 2,687 of
2,688 faces were being culled and you looked straight through her side into the
far one. That is invisible in a wireframe and invisible in a vertex count, and
obvious only from exactly the right angle.

### The guns you see are the guns that fire

`muzzle()` spawns each ball from `gunPlacements(rig, gunsYouOwn)[i]`, so the
client must draw the barrels from the same call with the same count. It used to
build the hull's **full** complement and merely hide the surplus, so with three
guns aboard you saw barrels 0–2 of a twenty-eight-gun layout — bunched at one
end — while the host fired from three guns spread down the whole side.

No headless test could catch that, because each half was individually
consistent with `rig.js`. `node tools/gunfit-test.js` reads the world position
of every drawn barrel out of the scene graph and compares it with where the host
says that gun's ball starts, across twelve class-and-armament combinations.

Guns also fill the **lowest deck first** now. Dividing what you own between all
the decks put one on each and stacked them at a single station: a Man-of-War
with three guns showed a vertical column amidships instead of three ports down
her side.

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
masts, twenty guns a side and a lit stern castle.
The whole model is generated from `shared/rig.js`, so adding a hull is a table
entry rather than a modelling job.

**The two biggest are rigged square all the way round.** Every class up to the
Man-of-War carries triangular headsails on the bowsprit and a fore-and-aft sail
on the aftmost mast; the Flagship and the Leviathan carry neither. Four masts,
four tiers of square canvas on each, sixteen sails and nothing else — which is
what makes them read as ships of the line rather than as very large frigates.

Two things fell out of squaring the after mast. Its yards would have been as
wide as the mainyard over the narrowest part of the hull, so yard spread now
tapers abaft the main; and its courses hung straight through the aftercastle,
so a mast stepped well aft starts its lowest yard higher. Both are keyed off the
mast's position, and neither touches a three-masted class — those carry a gaff
aft and never ask for yards there.

`node tools/rig-shots.js` photographs all nine classes from the bow quarter and
prints what each one carries, which is the quickest way to see whether a change
to that table did what it was supposed to.

**`rig.js` is in `shared/` for a reason.** The client places the gun meshes from
`gunPlacements()` and the host spawns cannonballs from the *same* function, so a
shot always leaves the barrel you can see. When those were separate the muzzle
maths was hardcoded to the Sailboat and a Flagship's broadside came out of thin
air amidships. `node tools/muzzle-test.js` checks every gun on every class agrees
to within half a metre.

Sails furl. Below about a third throttle the canvas rolls up to the yards, so a
ship lying stopped has a completely different silhouette from one under way.

Bigger hulls hit harder and carry more, and pay for it in speed and turning.
Islands are solid: run at one and you stop, and it costs you hull. Grounding
kills the way you had on *toward* the land and leaves the rest, so you can sail
off again — scaling the whole velocity meant that even pointed out to sea, every
tick quartered whatever speed you had just built, and you never got away.

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

**There is no level cap.** `levelFromXp` used to stop dead at 60 — you kept
earning XP and never got another talent point, with nothing on screen to say
why. It inverts the curve directly now, so level 400 costs one multiply, same as
level 4, and `pointsAtLevel` was always `level - 1` and needed no change at all.

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

**Their guns scale with you, not with their hull.** This used to be a single
number — every AI ship carried the maximum its class could — so a level-1
captain, who is given exactly *one* gun a side, met cutters firing four. That one
constant was most of the early difficulty curve. Crews are green early too, and
a beginner meets one ship rather than a squadron:

```
level  1    1 x cutter        1 gun a side   crew skill 0.36
level  6    3 x brigantine    3 a side       skill 0.46
level 20    5 x frigate      10 a side       skill 0.75
level 60    6 x leviathan    28 a side       skill 0.85
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
Worth 900 XP and 260 Crowns, and her hull is drawn on screen while she is up —
without that you cannot tell whether your shot is doing anything, which reads
exactly like a monster that takes none.

She is **matched to whoever she comes up under**, and will not surface beside a
captain under level 8 at all. At a flat 95 damage an arm she was doing about 140
a second, which sinks a 1,250-hull Leviathan in nine — every hull in the game
died at the same rate, so buying a bigger one bought you nothing against her. Her
slam is a fraction of the hull it lands on now:

```
              your hull   her bite   seconds to sink you
Sailboat            100          8                  30
Frigate             350         19                  44
Leviathan         1,250         58                  52
```

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
shared/transport.js contract between the game and however messages travel,
                    plus the allowlist of everything a client may say
server.js           thin Node adapter: express + socket.io -> GameHost
server-profiles.js  Crowns and owned trails, persisted to data/profiles.json
public/js/link.js   socket-shaped object whose wire is chosen at runtime
public/js/lobby.js  the join screen: server, host a lobby, or join one
public/js/rtc.js    WebRTC data channels + room codes (host and guest)
public/js/browser-host.js      GameHost running in a tab, ticked from a worker
public/js/browser-profiles.js  the localStorage twin of server-profiles.js
public/js/main.js   scene, sky, lighting, prediction, camera, main loop
public/js/net.js    clock sync and snapshot interpolation over a Link
tools/build-static.js  assembles dist/ for GitHub Pages
public/js/ocean.js  ocean shader (waves, fresnel, sun glitter, foam, haze)
public/js/ship.js   sloop model, sail shaping, buoyancy from the wave field
public/js/wake.js   foam ribbon astern
public/js/hud.js    readouts, warnings and the ship-up compass
```

### The host is not the server

`shared/game-host.js` is the whole authoritative game, and it knows nothing about
sockets, HTTP or the filesystem. It talks to two interfaces defined in
`shared/transport.js` — a transport (`broadcast` / `send`) and a profile store.
That is what makes the peer-to-peer build possible, and it is worth being precise
about what it bought:

```
                    transport            profiles           ticked by
Node server      socket.io            data/profiles.json    setInterval
Browser lobby    WebRTC data channel  localStorage          a Web Worker
Tests            an array             a Map                 a for loop
```

**There is no second implementation of the rules.** `public/js/browser-host.js`
is 100 lines of plumbing around the same `GameHost` class `server.js` drives. A
bug in the sailing model is a bug in both, which is the entire point of the
split — a fork would have quietly drifted.

The client side is symmetrical. `public/js/link.js` is a socket-shaped object
that queues what you emit until a wire is bound to it, so `Net`, the dock, the
chandlery, the talent cards and every console cheat were written against
socket.io and did not change by a line to run over WebRTC.

```
node tools/host-test.js   the whole game with no transport at all
node tools/rtc-test.js    two browsers, one sea, no game server anywhere
```

The second one serves the built site from a sub-path the way Pages does, opens
two tabs, hosts in one and joins from the other by code, and then checks the
things that can only be true if the channel is genuinely carrying the game:
the guest's helm moves the guest's ship *as measured by the host*, the guest's
broadside takes hull off the host, both captains end up on the host's books, and
closing the host tab tells the guest rather than freezing them.

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
npm run build                # assemble dist/ — the static site Pages serves
npm run test:host            # the whole game, no transport, no browser (fast)
npm run test:rtc             # build, then two browsers over a real data channel
node tools/live-check.js     # drive the PUBLISHED site with the real broker
node tools/cheat-test.js     # every console cheat, and the dev gate that hides them
node tools/touch-test.js     # an emulated iPhone and iPad: helm, sail, tap-to-fire
npm run tune                 # per class: top speed, time to reach it, rate of turn
node tools/aground-test.js   # run her ashore, then get off again
node tools/balance-test.js   # what a beginner meets, and the Kraken's numbers
node tools/hull-test.js      # every hull closed, facing outward, guns in her side
node tools/gunfit-test.js    # balls leave the barrels you can SEE, at any armament
node tools/rig-shots.js      # photograph all nine hulls, and count their sails
node tools/bot.js 3          # 3 headless crew bots so you can test alone
node tools/smoke.js          # headless browser: joins, checks the helm answers
                             # correctly, summons a rogue wave, screenshots ./shots
node tools/combat-test.js    # two browsers, one fight: hits, sinking, respawn
node tools/talent-test.js    # starter armament, locked batteries, talent spending
node tools/host-test.js      # the whole game with no transport at all (fast, no browser)
node tools/shop-test.js      # earns crowns, gets refused, buys, wears, photographs
node tools/diag.js           # overhead plan view for checking the boom's side
```

Anything that drives a browser needs Chrome's system libraries (`libnss3`,
`libnspr4`); `tools/rtc-test.js` also starts a local [PeerServer] so it does not
depend on the public broker. None of them are needed to play.

## Deploying

**GitHub Pages** — `.github/workflows/pages.yml` runs on every push to `main`. It
runs `tools/host-test.js` first (if the rules cannot run headless, the thing
about to be published could not have worked), builds `dist/`, and deploys. Enable
it once under *Settings → Pages → Source: GitHub Actions*.

The trick that makes one set of sources work in both places is the import map in
`index.html`. Every module path in the client is written root-absolute
(`/shared/physics.js`), which is right under Express and wrong on Pages, where
the site lives at `/<repo>/`. Rather than rewrite every import, the map re-points
`/shared/` and `/vendor/` at the document base.

**A real server**, if you want the world to persist and stay up without anyone
holding a tab open: any host that runs Node. It is a stateful WebSocket process
with the world in memory, so the static hosts (Pages, Netlify, Cloudflare Pages)
cannot run it — that is what the peer-to-peer build is for.

> ⚠️ The dev hooks (`grant-crowns`, `grant-coins`, `dev-class`, `dev-picks`,
> `reset-profile`, `summon-tsunami`, …) let any connected client hand itself
> anything. Run a public server with **`PIRATE_DEV=0`**. In a browser lobby they
> are off unless the host opened the page with `?dev=1`.

## Next: Phase 2

The seams are in place — ship classes live in `SHIP_CLASSES`, weather is
server-side and broadcast, and every ship's state is one flat object that is cheap
to extend with hull damage, cargo and crew.
