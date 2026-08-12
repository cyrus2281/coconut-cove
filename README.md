# 🌴 Coconut Cove

A tiny tropical island you can walk around in the browser — **100% procedurally
generated**, no downloaded assets. Built with [Three.js](https://threejs.org)
and Vite.

Created by [Cyrus Mobini](https://github.com/cyrus2281) ·
[github.com/cyrus2281/coconut-cove](https://github.com/cyrus2281/coconut-cove)

![Coconut Cove](https://img.shields.io/badge/three.js-r180-049EF4?style=flat-square) ![vite](https://img.shields.io/badge/vite-6-646CFF?style=flat-square)

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>, click **walk the beach**.

Every island is grown from a seed — shoreline, palms, surge zones, **and the
moment you arrive**: the time of day, the tide that goes with it, and the
weather (some islands greet you mid-squall). The title screen shows the
current one (`island #2281`, a curated golden afternoon, by default). Flip
**use a random island seed** to regrow a brand-new island live — the switch
sticks, so every refresh rolls another island at another hour — or pin a
favorite with `http://localhost:5173/?seed=12345`.

| Input | Action |
| --- | --- |
| `W A S D` / arrows | walk |
| mouse | look (pointer lock, click-drag fallback) |
| `Shift` | run |
| `Space` | jump |
| `M` | toggle ocean sound |
| touch | 📱 button on the title screen: on-screen joystick + JUMP, drag the world to look (auto-enables on first touch) |

## What's inside

Everything is generated at startup from seeded noise — geometry, textures
(painted on `<canvas>`), and audio (Web Audio filtered-noise surf):

- **Island** — analytic height field (lobed shoreline, dunes, turquoise
  shelf, drop-off) shared by the terrain mesh, the player physics, prop
  placement, and a baked heightmap the water shader reads.
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
- **Seeded worlds** — one master seed grows the shoreline, terrain, surge
  zones, cay bearing, palms, scatter and fauna homes. Same seed, same island,
  every time.

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
```
