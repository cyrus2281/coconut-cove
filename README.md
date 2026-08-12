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
| touch | left half = move stick, right half = look |

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
- **Life & air** — gulls that flap and glide, drifting clouds, procedural
  surf + wind audio.

## Debug console

`window.__beach` exposes helpers in DevTools:

```js
__beach.view('overview')        // aerial | beach | waterline | shells | palm | sun
__beach.teleport(x, z, yaw, pitch)
__beach.info()                  // { calls, tris, fps }
```
