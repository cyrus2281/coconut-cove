# 🌴 Coconut Cove

A tiny tropical island you can walk around in the browser — **100% procedurally
generated**, no downloaded assets. Built with [Three.js](https://threejs.org)
and Vite.

![Coconut Cove](https://img.shields.io/badge/three.js-r180-049EF4?style=flat-square) ![vite](https://img.shields.io/badge/vite-6-646CFF?style=flat-square)

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>, click **walk the beach**.

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
- **Day/night cycle** — a 12-minute day: golden afternoon, sunset palette,
  starfield + moonlit night (one light plays sun and moon), dawn. The
  ambient light is rebaked live from the sky as it changes.
- **Life & air** — gulls that flap and glide, ghost crabs that scuttle
  sideways, dodge you, and sprint uphill ahead of incoming surges, drifting
  clouds, procedural surf + wind audio synced to the surge periods.

## Debug console

`window.__beach` exposes helpers in DevTools:

```js
__beach.view('overview')        // aerial | beach | waterline | shells | palm | sun
__beach.teleport(x, z, yaw, pitch)
__beach.info()                  // { calls, tris, fps }
__beach.setTod(0.86)            // time of day: 0.60 afternoon, 0.705 sunset, 0.86 night
__beach.warp(30)                // fast-forward the world clock (30s)
__beach.stampLine()             // lay a test track of footprints into the surge zone
```
