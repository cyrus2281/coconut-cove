// The shallows fish as an asset: a hardyhead silverside, the little
// chrome-flanked schooler you see from the beach. Built from fishcraft
// so the tail swims in the shader; fish.js owns the school brains.

import { fishGeometry, fishTexture, fishMaterial } from './fishcraft.js';

export function silversideAsset() {
  const len = 0.14;
  const geo = fishGeometry({
    len, height: 0.026, width: 0.014, peak: 0.44, blunt: 0.85,
    slices: 14, ring: 8, snoutDroop: 0.25,
    eyeBulge: { u: 0.09, v: 0.6, k: 0.2 },
    gillFlare: { u: 0.18, k: 0.06 },
    caudal: { type: 'fork', l: 0.24, h: 1.2 },
    dorsal: { h: 0.5, u0: 0.55, u1: 0.68 },
    anal: { h: 0.4, u0: 0.6, u1: 0.72 },
    pect: { l: 0.12, h: 0.5 },
  });
  const { map, bump } = fishTexture((h) => {
    // olive-glass back, and the mirror stripe that names the fish
    h.base([[0, '#e8ecdf'], [0.5, '#cdd8c2'], [0.75, '#94a888'], [1, '#5c7054']]);
    h.scales({ rows: 5, light: 0.09, dark: 0.05, from: 0.1 });
    h.stripe(0.6, 0.1, 'rgba(224,232,238,0.95)');
    h.stripe(0.655, 0.02, 'rgba(90,110,120,0.5)');
    h.shade(0.55);
    h.mouth(0.035, 0.34, 0.03);
    h.eye(0.08, 0.58, 0.15, '#d0d4d2');
  }, { W: 256, H: 128, finColor: '#dfe8d8', rayColor: 'rgba(90,100,80,0.3)' });
  const mat = fishMaterial({
    map, bump, name: 'silverside', len,
    freq: 9, rough: 0.3, metal: 0.45, clearcoat: 0.6, irid: 0.6,
  });
  return { geo, mat, len };
}
