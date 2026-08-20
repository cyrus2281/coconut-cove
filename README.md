# 🌴 Coconut Cove

A tropical island you can walk around in the browser — **100% procedurally
generated**, no downloaded assets. Built with [Three.js](https://threejs.org)
and Vite. Sandy coves give way to a dense jungle interior, rolling hills,
sea-cliff headlands and real mountains, with a ~1 km seeded footpath
switchbacking to a summit campsite.

Created by [Cyrus Mobini](https://github.com/cyrus2281) ·
[github.com/cyrus2281/coconut-cove](https://github.com/cyrus2281/coconut-cove)

![Coconut Cove](https://img.shields.io/badge/three.js-r180-049EF4?style=flat-square) ![vite](https://img.shields.io/badge/vite-6-646CFF?style=flat-square)

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>, click **walk the beach**.

Every island is grown from a seed — shoreline, palms, surge zones, reefs,
**and the moment you arrive**: the time of day, the tide that goes with it,
and the weather (some islands greet you mid-squall). The title screen shows
the current one (`island #2281`, a curated golden afternoon, by default).
Hit the ⟳ button (or `R`) to regrow a brand-new island live, or pin a
favorite with `http://localhost:5173/?seed=12345`.

| Input | Action |
| --- | --- |
| `W A S D` / arrows | walk · swim (wade past chest depth and the water takes you) |
| mouse | look (pointer lock, click-drag fallback) — underwater, you swim where you look |
| `Shift` | run · swim faster |
| `Space` | jump · float up |
| `C` | sink down / dive |
| `E` | lie back in the hammock, again to sleep (any move key gets you up) |
| `R` | grow a brand-new island (same as the ⟳ button, seed lands in the URL) |
| `M` | toggle ocean sound |
| touch | 📱 on-screen joystick + JUMP + a latching RUN toggle, drag the world to look (auto-enables on first touch) |

## What's inside

Everything is generated at startup from seeded noise — geometry, textures
(painted on `<canvas>`), and audio (Web Audio filtered-noise surf):

- **Island** — one analytic height field (lobed ~250 m shoreline, sandy
  beach aprons, rolling hills, 2-3 seeded mountains with a flat summit
  shelf, sea-cliff coast arcs, turquoise shelf, drop-off) shared by the
  chunked terrain mesh, the player physics, prop placement, and baked
  height + biome maps the water and ground shaders read.
- **Forest** — ~2100 instanced plants: kapok giants and pagoda-tiered
  tropical almonds over banana clumps, tree ferns and big-leaf shrubs,
  placed by biome with seeded clearings; the understory melts away with
  distance so phones stay afloat.
- **Trail** — a seeded, grade-relaxed footpath (≤16° profile) from the
  spawn beach through the forest, past the pond, up onto a clifftop
  lookout and switchbacking to the summit, carved into the terrain and
  painted as a dirt ribbon. Every island's route is audited walkable
  (`__beach.audit()`).
- **Mountains & slopes** — climbing slows past 20° and stalls past 50°;
  near-vertical ground sheds you downhill, so cliffs are real barriers
  and the trail is the way up.
- **Ocean** — custom shader: 4 Gerstner swell components that flatten in the
  shallows, depth-based turquoise→navy color, shoreline foam collar, rolling
  wave-front foam, rare whitecaps, sun glitter, analytic sky reflection,
  aerial haze.
- **Sand** — grain-speckle albedo + micro normal map, macro tone variation,
  animated wet swash line synced to the water, glinting grains, and fake
  caustics dancing on the submerged shelf.
- **Palms** — every tree grown from a seed: curved ring-scarred trunk, ~15
  fronds with **individually modeled leaflets**, coconut clusters, dead
  hanging fronds, fallen nuts. Vertex-attribute wind sway. The whole grove is
  3 draw calls.
- **Beach dressing** — instanced sea shells (spiral whelks, augers, scallops,
  clams), starfish, a pebble/shell-hash drift line, weathered boulders,
  driftwood, dune grass, seaweed wrack.
- **Footprints** — walking stamps alternating bare feet (instanced decals
  with pressed-sole normal maps). They fade out over ~90 s, melt fast near
  the waterline, and get washed away when a wave rolls over them.
- **Surge zones** — two stretches of coast get long-period swash bores that
  rush a few feet up the beach and drain back. One shared analytic run-up
  model drives the water surface, the bore foam, the wet-sand line, and
  footprint washout — no simulation state anywhere.
- **Wet & dry sand** — sand darkens hard where water has recently been,
  turns glossy, then dries back over ~35 s in a visible gradient, with
  fizzing foam residue left behind each retreating wave.
- **Tides** — the sea level breathes ±0.45 m twice per day. Low tide bares
  wide, slow-drying wet flats (and the offshore sandbar); high tide narrows
  the beach, erases low-tide footprints and cuts the cay off.
- **Offshore cay** — a bare sandbar islet past the shelf, ringed by its own
  swash: wade across the channel at low tide, watch it drown at high.
- **Wave push** — standing in a surge, the bore physically carries you up
  the beach and the backwash tugs you back out. Jump to escape.
- **Day/night cycle** — a 12-minute day: golden afternoon, sunset palette,
  starfield + moonlit night (one light plays sun and moon), dawn. The
  ambient light is rebaked live from the sky as it changes.
- **Nights worth staying for** — bioluminescent plankton set the breaking
  surf glowing electric blue-green and trace the retreating swash line on
  the sand; shooting stars streak the dome; a masthead light rounds the
  horizon.
- **Weather** — every couple of days a squall builds: the sky goes leaden,
  the sea grays and chops up, rain streaks lash the camera, the whole island
  soaks dark and then dries back out. Palms thrash, audio pours.
- **Life & air** — gulls that soar, glide down, land, hop about and flush
  (crying off indignantly) when you walk up; ghost crabs that scuttle
  sideways, dodge surges and stitch tiny wave-washed tracks; fish schools
  patrolling the shallows that scatter when you wade in; a green sea turtle
  that hauls out on random nights to dig a nest and slip away before dawn;
  a sloop forever rounding the island; drifting clouds.
- **Positional audio** — procedural surf panned to its beaches and louder at
  the waterline, wind that picks up on the dunes and in storms, palm rustle
  under the crowns, synthesized gull cries from where the gulls actually
  are, rain overhead. No audio files.
- **The interior** — every island's heart holds a reed-ringed freshwater
  lagoon (wade in, watch it dimple in the rain), a huge buttress-rooted
  fig with a rope swing, a shipwreck's ribs cresting a dune, and a walker's
  cairn on the summit. Two driftwood campfires burn — one on the dry sand a
  short walk down the arrival beach, one beside the cairn at the top of the
  climb — crackling, throwing embers downwind, beaten down to smoke by every
  squall. The one you stand at is the one you hear.
- **Small joys** — butterflies over the day grass and fireflies over the
  night grass; loose coconuts you can punt down the beach and watch the
  surf strand back on the wet sand; a striped hammock between two palms
  (`E` to lie back and watch the fronds, clouds and shooting stars, `E`
  again to sleep: the screen fades out and you wake at midnight, or at
  sunrise if you turned in after dark).
- **Snorkeling** — wade past chest depth and you're swimming: float at the
  surface riding the swell, look down and kick to dive. Below, the world
  changes — sea-water fog that darkens with depth, the sky visible only
  through a shimmering Snell's window overhead (mirror beyond it), hanging
  sun shafts, drifting plankton motes (some glow at night), your own exhaled
  bubbles wobbling up, and every sound muffled to a deep wash.
- **Coral reefs** — seeded gardens on the offshore shelf: boulder mounds
  crusted pink with coralline algae, brain corals wearing painted maze
  grooves, staghorn thickets, table corals, swaying gorgonian sea fans, tube
  sponges, anemones with glowing tentacle tips, urchins, starfish, seagrass
  meadows — and giant clams that snap shut if you loom over them.
- **Life below** — sergeant majors, blue tangs, yellow tangs, butterflyfish
  pairs, an emperor angelfish, parrotfish, clownfish that tuck into their
  anemones when you get close, a shimmering fusilier bait ball that parts
  around you, stingrays gliding over the meadows (they bury themselves in
  the sand to rest), cruising green sea turtles that rise to breathe,
  shy blacktip reef sharks patrolling the deeper water, moon jellies pulsing
  near the surface (they glow at night), and a moray eel gaping from its
  den. Everything swims — tails whip, wings ripple, flippers fly.
- **The edge of the cove** — you can snorkel the whole reef, but past it a
  firm current turns you back ("you can't swim any further").
- **Seeded worlds** — one master seed grows the shoreline, terrain, surge
  zones, cay bearing, lagoon, big fig, landmarks, palms, scatter and fauna
  homes. Same seed, same island, every time — and the ⟳ / `R` button pins
  each new island's seed in the URL so you can share it.

## Component viewer

Open <http://localhost:5173/components> for a debug gallery of every piece of
the island in isolation, each on a lit stage:

- **Animals** — gull, ghost crab, turtles, butterflies, all the reef fish,
  the shark, the ray, the moon jelly and the moray, with their poses on
  buttons (fly / fold / crawl / dig / burst…).
- **Palms & trees** — a coconut palm, a single frond green or dead, and the
  grandmother fig with her rope swing. Wind is the pose: still air, breeze,
  gale, driven through the same `uWindAmp` the grove sways on.
- **Undergrowth** — dune grass, pond reeds, seaweed wrack.
- **Beach** — a kickable coconut (at rest, rolling, afloat), the four shell
  species, a starfish, a drift of pebbles, driftwood, a shore boulder.
- **Camp** — the walker's cairn, the wrecked hull dug out of its dune, the
  campfire (blazing / squall / after the rain), the hammock slung between
  two palms, and footprint decals for a walker, a crab and a turtle.
- **Coral garden** — brain, staghorn in both morphs, table coral, sea fan,
  barrel sponge, anemone, urchin, sea star, seagrass, reef boulder, and a
  giant clam that slams shut on cue.
- **Water & horizon** — the freshwater pond in its own basin (calm or in the
  rain), the volcano with its smoke column and night-lit crater (five
  kilometres out, and big enough to look it), a sister island, and the
  sloop.
- **Audio** — the one section with nothing to look at: every track the island
  synthesizes, on its own. Nine looping beds (both surf beaches, the shore
  lap, wind, palm rustle, the two halves of the rain, the campfire and the
  underwater wash) and five one-shots (fire crackle, gull cry, coconut thock,
  splash, bubble), each with a live spectrum, a level meter, and the filter,
  swell and gain numbers read straight off the running node graph. Here the
  poses are **where you hear it from**: at the waterline or up the dune, under
  the crown or a few steps off, blazing or dying down, drizzle or downpour.
  The layer soloed is the island's own, stood on island #2281 with a stub
  listener, so a track sounds exactly as it does out there.

Every entry is built by the island's own code, so what you judge here is
what grows out there; the props that hunt for a site (fig, campfire, pond)
bring a patch of real terrain with them, and **reroll** regrows the island
under them. Plus beach and underwater lighting, night mode, turntable,
wireframe, and live triangle/fps stats. (`window.__viewer` offers
`load(id)`, `pose(id)` and `orbit(azimuth, polar, dist)` for scripted
screenshots, plus `play()`, `stop()` and `track()` for the audio section.)

## Debug console

`window.__beach` exposes helpers in DevTools:

```js
__beach.view('overview')        // aerial | beach | waterline | shells | palm | sun
__beach.teleport(x, z, yaw, pitch)
__beach.info()                  // { calls, tris, fps }
__beach.setTod(0.86)            // time of day: 0.60 afternoon, 0.705 sunset, 0.86 night
__beach.warp(30)                // fast-forward the world clock (30s)
__beach.tide()                  // { level, rising }
__beach.rain()                  // summon a squall (rain(false) clears it)
__beach.reseed()                // regrow a random island (reseed(1234) for a specific one)
__beach.sky.meteor(2)           // force a shooting star (at night)
__beach.turtle.visit()          // invite the sea turtle ashore right now
__beach.stampLine()             // lay a test track of footprints into the surge zone
__beach.pondside()              // stand on the lagoon bank
__beach.figview()               // face the grandmother fig
__beach.campview('summit')      // stand by a campfire ('beach' is the default)
__beach.snorkel()               // float at the surface over a coral garden
__beach.dive(2)                 // hang mid-water inside the 3rd coral garden
```
