// Runtime-painted procedural textures. No files are downloaded — every map
// (sand grain, bark, leaflets, husk, shells, foam, water normals, caustics,
// clouds) is generated on <canvas> at startup, seeded and tileable.

import * as THREE from 'three';
import { mulberry32 } from './rng.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

// Tileable value-noise field, arbitrary octaves. Returns Float32Array in [0,1].
function noiseField(size, seed, octaves = 4, baseCells = 4, gain = 0.55) {
  const rand = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const cw = size / cells;
    for (let y = 0; y < size; y++) {
      const gy = y / cw;
      const y0 = Math.floor(gy) % cells;
      const y1 = (y0 + 1) % cells;
      let ty = gy - Math.floor(gy);
      ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const gx = x / cw;
        const x0 = Math.floor(gx) % cells;
        const x1 = (x0 + 1) % cells;
        let tx = gx - Math.floor(gx);
        tx = tx * tx * (3 - 2 * tx);
        const a = grid[y0 * cells + x0], b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0], d = grid[y1 * cells + x1];
        const v = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
        out[y * size + x] += v * amp;
      }
    }
    norm += amp; amp *= gain; cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function fieldToNormalCanvas(field, w, h = w, strength = 2.0) {
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const ym = (y - 1 + h) % h, yp = (y + 1) % h;
      const dx = (field[y * w + xp] - field[y * w + xm]) * strength;
      const dy = (field[yp * w + x] - field[ym * w + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = inv * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const registry = [];
function track(t) { registry.push(t); return t; }
export function applyAnisotropy(renderer) {
  const max = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of registry) { t.anisotropy = max; t.needsUpdate = true; }
}

// ---------------------------------------------------------------- sand
export function sandTextures() {
  const S = 512;
  const rand = mulberry32(41);
  const macro = noiseField(S, 42, 5, 4);
  const [c, ctx] = makeCanvas(S, S);

  // base with large-scale tonal drift
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const m = macro[i];
    img.data[i * 4] = 214 + m * 26 - 13;
    img.data[i * 4 + 1] = 196 + m * 24 - 12;
    img.data[i * 4 + 2] = 158 + m * 22 - 11;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // individual grains: tens of thousands of tinted specks
  const palettes = [
    ['#b3925f', 0.38, 11000], // amber quartz
    ['#8a6f4a', 0.32, 5200],  // darker mineral
    ['#f7ecd4', 0.4, 6800],   // bleached shell/coral
    ['#c9c2b4', 0.3, 3400],   // gray quartz
    ['#4a3c2c', 0.4, 950],    // basalt flecks
    ['#e8b9a0', 0.32, 900],   // coral pink
    ['#ffffff', 0.5, 700],    // bright glints
  ];
  for (const [col, alpha, count] of palettes) {
    ctx.fillStyle = col;
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = alpha * (0.5 + rand() * 0.5);
      const s = rand() < 0.85 ? 1 : 2;
      ctx.fillRect(rand() * S, rand() * S, s, s);
    }
  }
  // a few larger shell-hash fragments
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rand() < 0.5 ? '#f4ead2' : '#d9c39a';
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, 1 + rand() * 1.6, 0.7 + rand(), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // height field for the normal map: micro noise + grain bumps + faint wind ripples
  const h = noiseField(S, 43, 5, 8, 0.6);
  const ripple = noiseField(S, 44, 3, 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const warp = ripple[i] * 78;
      const band = Math.sin(((y + warp) / S) * Math.PI * 2 * 11) * 0.18 + 0.5;
      h[i] = h[i] * 0.76 + band * 0.24;
    }
  }
  const grand = mulberry32(45);
  for (let i = 0; i < 26000; i++) {
    const x = Math.floor(grand() * S), y = Math.floor(grand() * S);
    h[y * S + x] = Math.min(1, h[y * S + x] + 0.35 * grand());
  }

  return {
    map: track(tex(c)),
    normalMap: track(tex(fieldToNormalCanvas(h, S, S, 2.6), { srgb: false })),
  };
}

// ---------------------------------------------------------------- footprints
// Track decal atlas, three cells side by side: bare foot | crab stitches |
// turtle crawl. R-channel mask + a normal map with pressed-in marks and a
// slightly raised rim of displaced sand. Marks are painted toward canvas
// bottom = the direction of travel after the decal quad's rotateX.
export function footprintTextures() {
  const CW = 128, CH = 192, CELLS = 3;
  const W = CW * CELLS, H = CH;

  const painters = [
    (ctx, ell) => { // bare foot (right; the left is a mirrored instance)
      ell(64, 46, 19, 24);          // heel
      ell(59, 92, 15, 27, 0.08);    // arch (narrow, shifted inward)
      ell(66, 133, 26, 23, -0.06);  // ball
      ell(41, 165, 9, 10);          // toes, big toe inboard
      ell(58, 171, 6.6, 7);
      ell(73, 172, 5.6, 6);
      ell(86, 170, 5, 5.4);
      ell(98, 166, 4.4, 4.8);
    },
    (ctx, ell) => { // crab: rows of leg pricks flanking the travel axis
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const y = 40 + i * 34;
          ell(64 + side * (26 + (i % 2) * 12), y, 8.5, 12, side * 0.5);
        }
      }
      ell(48, 20, 7, 15, 0.15);    // claw ticks out front
      ell(80, 20, 7, 15, -0.15);
    },
    (ctx, ell) => { // turtle: paired flipper gouges + broad body drag
      ell(26, 58, 15, 25, 0.5);
      ell(102, 58, 15, 25, -0.5);
      ell(22, 142, 12, 21, 0.62);
      ell(106, 142, 12, 21, -0.62);
      ctx.globalAlpha = 0.45;
      ell(64, 96, 22, 86);
      ctx.globalAlpha = 1;
    },
  ];

  const renderField = (scale, blur) => {
    const [c, ctx] = makeCanvas(W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.filter = `blur(${blur}px)`;
    const ell = (x, y, rx, ry, rot = 0) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let cell = 0; cell < CELLS; cell++) {
      ctx.save();
      ctx.translate(cell * CW + CW / 2, CH / 2);
      ctx.scale(scale, scale);
      ctx.translate(-CW / 2, -CH / 2);
      ctx.fillStyle = '#fff';
      painters[cell](ctx, ell);
      ctx.restore();
    }
    ctx.filter = 'none';
    const data = ctx.getImageData(0, 0, W, H).data;
    const f = new Float32Array(W * H);
    for (let i = 0; i < f.length; i++) f[i] = data[i * 4] / 255;
    return { canvas: c, field: f };
  };

  const inner = renderField(1.0, 2.5);
  const outer = renderField(1.24, 5);

  // height: pressed-down marks + pushed-up rim of sand around them
  const height = new Float32Array(W * H);
  for (let i = 0; i < height.length; i++) {
    const rim = Math.max(outer.field[i] - inner.field[i], 0);
    height[i] = 0.5 - inner.field[i] * 0.42 + rim * 0.3;
  }

  // mask: marks plus a faint rim presence so the bump reads at grazing light
  const [mc, mctx] = makeCanvas(W, H);
  const img = mctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const m = Math.min(1, inner.field[i] + Math.max(outer.field[i] - inner.field[i], 0) * 0.45);
    img.data[i * 4] = inner.field[i] * 255;
    img.data[i * 4 + 1] = m * 255;
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(img, 0, 0);

  const clampTex = (canvas) => {
    const t = tex(canvas, { srgb: false, repeat: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  return {
    mask: clampTex(mc),
    normal: clampTex(fieldToNormalCanvas(height, W, H, 3.2)),
  };
}

// ---------------------------------------------------------------- palm bark
export function barkTexture(desaturated = false) {
  const W = 256, H = 512;
  const rand = mulberry32(desaturated ? 77 : 7);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = desaturated ? '#9b948a' : '#9d8b72';
  ctx.fillRect(0, 0, W, H);

  // vertical fiber streaks
  for (let i = 0; i < 520; i++) {
    const x = rand() * W;
    const grey = 110 + rand() * 90;
    ctx.strokeStyle = desaturated
      ? `rgba(${grey},${grey},${grey - 6},${0.05 + rand() * 0.07})`
      : `rgba(${grey},${grey * 0.88},${grey * 0.66},${0.05 + rand() * 0.08})`;
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + rand() * 8 - 4, H * 0.33, x + rand() * 8 - 4, H * 0.66, x + rand() * 6 - 3, H);
    ctx.stroke();
  }
  // leaf-scar rings (coconut trunks keep ridged ring scars)
  let y = 6 + rand() * 10;
  while (y < H) {
    const hgt = 3 + rand() * 6;
    const dark = rand() < 0.75;
    ctx.fillStyle = dark
      ? (desaturated ? 'rgba(70,66,60,0.42)' : 'rgba(84,70,52,0.45)')
      : (desaturated ? 'rgba(210,205,196,0.30)' : 'rgba(214,198,170,0.32)');
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const yy = y + Math.sin((x / W) * Math.PI * 2 + rand() * 6) * 1.5 + rand() * 1.2;
      x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
    }
    for (let x = W; x >= 0; x -= 8) ctx.lineTo(x, y + hgt + rand() * 1.5);
    ctx.fill();
    y += 16 + rand() * 14;
  }
  // mottle
  for (let i = 0; i < 900; i++) {
    const g = 60 + rand() * 140;
    ctx.fillStyle = `rgba(${g},${g * 0.9},${g * 0.72},${0.05 + rand() * 0.05})`;
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 3, 1 + rand() * 2);
  }
  return track(tex(c));
}

// ---------------------------------------------------------------- palm leaflet
export function leafletTexture() {
  const W = 128, H = 256;
  const rand = mulberry32(9);
  const [c, ctx] = makeCanvas(W, H);

  // blade gradient: darker at base, brighter toward tip
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3f6120');
  g.addColorStop(0.55, '#4d7526');
  g.addColorStop(1, '#688c33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // per-pixel chlorophyll noise
  const n = noiseField(W, 10, 4, 4);
  const img = ctx.getImageData(0, 0, W, H);
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      const v = (n[(yy % W) * W + xx] - 0.5) * 34;
      img.data[i] += v * 0.7;
      img.data[i + 1] += v;
      img.data[i + 2] += v * 0.4;
    }
  }
  ctx.putImageData(img, 0, 0);

  // lengthwise veins
  for (let i = 0; i < 46; i++) {
    const x = rand() * W;
    ctx.strokeStyle = `rgba(${30 + rand() * 40},${70 + rand() * 50},${20 + rand() * 20},${0.10 + rand() * 0.10})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + rand() * 6 - 3, H);
    ctx.stroke();
  }
  // central rib: shadow + highlight (leaflet UV puts the fold at u=0.5)
  ctx.fillStyle = 'rgba(28,46,12,0.85)';
  ctx.fillRect(W / 2 - 2.5, 0, 5, H);
  ctx.fillStyle = 'rgba(196,214,120,0.75)';
  ctx.fillRect(W / 2 - 0.8, 0, 1.6, H);

  // dried tip
  const tipG = ctx.createLinearGradient(0, H * 0.82, 0, H);
  tipG.addColorStop(0, 'rgba(140,120,58,0)');
  tipG.addColorStop(1, 'rgba(150,118,52,0.85)');
  ctx.fillStyle = tipG;
  ctx.fillRect(0, H * 0.8, W, H * 0.2);

  return track(tex(c));
}

// ---------------------------------------------------------------- fig bark
// Smooth pale-gray banyan/fig bark: soft vertical streaks and faint mottle,
// nothing like the palm's ring scars.
export function figBarkTexture() {
  const W = 256, H = 512;
  const rand = mulberry32(41);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#918a7c';
  ctx.fillRect(0, 0, W, H);

  const n = noiseField(W, 8, 4, 4);
  const img = ctx.getImageData(0, 0, W, H);
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      const v = (n[(yy % W) * W + xx] - 0.5) * 26;
      img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v * 0.92;
    }
  }
  ctx.putImageData(img, 0, 0);

  // long smooth streaks where the trunk muscles
  for (let i = 0; i < 42; i++) {
    const x = rand() * W;
    const light = rand() < 0.5;
    ctx.strokeStyle = light
      ? `rgba(178,172,158,${0.08 + rand() * 0.10})`
      : `rgba(96,90,80,${0.08 + rand() * 0.12})`;
    ctx.lineWidth = 2 + rand() * 7;
    ctx.beginPath();
    ctx.moveTo(x, -10);
    ctx.bezierCurveTo(x + rand() * 14 - 7, H * 0.33, x + rand() * 14 - 7, H * 0.66, x + rand() * 20 - 10, H + 10);
    ctx.stroke();
  }
  // lichen blotches
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(${150 + rand() * 30},${160 + rand() * 25},${130 + rand() * 25},${0.05 + rand() * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(rand() * W, rand() * H, 4 + rand() * 16, 3 + rand() * 10, rand() * 3, 0, 6.3);
    ctx.fill();
  }
  return track(tex(c));
}

// ---------------------------------------------------------------- fig foliage
// A cluster-card of overlapping glossy leaves on transparent ground; canopy
// quads sample it with alphaTest so a few hundred cards read as dense foliage.
export function leafClusterTexture() {
  const S = 256;
  const rand = mulberry32(43);
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  const leaf = (cx, cy, len, wid, ang, shade) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, -len / 2, 0, len / 2);
    g.addColorStop(0, `rgb(${26 + shade * 14},${52 + shade * 26},${20 + shade * 10})`);
    g.addColorStop(1, `rgb(${40 + shade * 18},${78 + shade * 30},${28 + shade * 12})`);
    ctx.fillStyle = g;
    // pointed oval
    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.bezierCurveTo(wid, -len * 0.18, wid, len * 0.22, 0, len / 2);
    ctx.bezierCurveTo(-wid, len * 0.22, -wid, -len * 0.18, 0, -len / 2);
    ctx.fill();
    // midrib
    ctx.strokeStyle = `rgba(190,210,130,${0.35 + shade * 0.25})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, -len / 2 + 2);
    ctx.lineTo(0, len / 2 - 2);
    ctx.stroke();
    ctx.restore();
  };

  // leaves radiate loosely from the card centre, denser in the middle
  for (let i = 0; i < 58; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.6) * S * 0.36;
    const cx = S / 2 + Math.cos(a) * r, cy = S / 2 + Math.sin(a) * r;
    const ang = a + Math.PI / 2 + (rand() - 0.5) * 1.1;
    leaf(cx, cy, 34 + rand() * 40, 9 + rand() * 7, ang, rand());
  }
  return track(tex(c));
}

// ---------------------------------------------------------------- hammock cloth
// Sun-faded woven stripes for the hammock: teal / cream / coral bands with
// a touch of thread noise.
export function hammockTexture() {
  const W = 128, H = 256;
  const rand = mulberry32(29);
  const [c, ctx] = makeCanvas(W, H);
  const bands = ['#7fb2a6', '#e8dfc8', '#cf8570', '#e8dfc8', '#5f8f96', '#e0d3b8'];
  const bh = H / 14;
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = bands[i % bands.length];
    ctx.fillRect(0, i * bh, W, bh + 1);
  }
  // weave: fine alternating warp lines + wear speckle
  for (let x = 0; x < W; x += 2) {
    ctx.fillStyle = `rgba(60,50,40,${0.05 + (x % 4 === 0 ? 0.05 : 0)})`;
    ctx.fillRect(x, 0, 1, H);
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(255,250,235,${0.04 + rand() * 0.09})`;
    ctx.fillRect(rand() * W, rand() * H, 1.5, 1.5);
  }
  return track(tex(c));
}

// ---------------------------------------------------------------- coconut husk
export function huskTexture() {
  const S = 256;
  const rand = mulberry32(13);
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#6f5233';
  ctx.fillRect(0, 0, S, S);

  const blotch = noiseField(S, 14, 4, 4);
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const v = (blotch[i] - 0.5) * 46;
    img.data[i * 4] += v;
    img.data[i * 4 + 1] += v * 0.85;
    img.data[i * 4 + 2] += v * 0.6;
  }
  ctx.putImageData(img, 0, 0);

  // coir fibers
  for (let i = 0; i < 1400; i++) {
    const x = rand() * S, y = rand() * S;
    const len = 6 + rand() * 22;
    const a = -0.4 + rand() * 0.8; // mostly "vertical" fibers
    const bright = rand() < 0.5;
    ctx.strokeStyle = bright
      ? `rgba(168,130,86,${0.10 + rand() * 0.12})`
      : `rgba(58,40,24,${0.12 + rand() * 0.14})`;
    ctx.lineWidth = 0.6 + rand() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.sin(a) * len * 0.5 + rand() * 3 - 1.5, y + len * 0.5, x + Math.sin(a) * len, y + len);
    ctx.stroke();
  }
  // germination eyes near the top pole (v ~ 0.06)
  ctx.fillStyle = 'rgba(38,26,15,0.9)';
  for (const u of [0.3, 0.5, 0.7]) {
    ctx.beginPath();
    ctx.ellipse(u * S, 0.07 * S, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return track(tex(c));
}

// ---------------------------------------------------------------- sea shell
export function shellTexture() {
  const S = 256;
  const rand = mulberry32(21);
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#efe4cf';
  ctx.fillRect(0, 0, S, S);

  // growth bands sweeping across V
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * S + rand() * 6;
    ctx.fillStyle = `rgba(${150 + rand() * 60},${105 + rand() * 45},${62 + rand() * 30},${0.10 + rand() * 0.16})`;
    ctx.fillRect(0, y, S, 2 + rand() * 7);
  }
  // mottled blotches
  for (let i = 0; i < 150; i++) {
    ctx.fillStyle = `rgba(${140 + rand() * 50},${90 + rand() * 40},${55 + rand() * 25},${0.14 + rand() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, 2 + rand() * 9, 1.5 + rand() * 5, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // fine radial ridge lines along U
  for (let x = 0; x < S; x += 3) {
    ctx.strokeStyle = `rgba(120,95,70,${0.05 + rand() * 0.06})`;
    ctx.beginPath();
    ctx.moveTo(x + rand() * 2, 0);
    ctx.lineTo(x + rand() * 2, S);
    ctx.stroke();
  }
  return track(tex(c));
}

// ---------------------------------------------------------------- foam mask
export function foamTexture() {
  const S = 256;
  const n = noiseField(S, 31, 5, 6, 0.62);
  const n2 = noiseField(S, 32, 4, 12, 0.5);
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = n[i] * 0.68 + n2[i] * 0.32;
    const holes = Math.max(0, Math.min(1, (v - 0.42) * 3.4));
    const g = Math.pow(holes, 1.25) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return track(tex(c, { srgb: false }));
}

// ---------------------------------------------------------------- water detail normals
export function waterNormalTexture() {
  const S = 256;
  const f = noiseField(S, 51, 5, 5, 0.58);
  return track(tex(fieldToNormalCanvas(f, S, S, 3.2), { srgb: false }));
}

// ---------------------------------------------------------------- caustics (tileable voronoi web)
export function causticTexture() {
  const S = 256, N = 26;
  const rand = mulberry32(61);
  const pts = [];
  for (let i = 0; i < N; i++) pts.push([rand() * S, rand() * S]);
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9;
      for (const [px, py] of pts) {
        // torus distance for tileability
        let dx = Math.abs(x - px); if (dx > S / 2) dx = S - dx;
        let dy = Math.abs(y - py); if (dy > S / 2) dy = S - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const v = Math.pow(Math.max(0, 1 - edge / 9), 2.6);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return track(tex(c, { srgb: false }));
}

// ---------------------------------------------------------------- butterfly wing
// One wing pair (fore + hind) of one side, drawn body→tip along U. The
// membrane is near-white so per-instance tints stay saturated; the alpha
// channel carves the scalloped silhouette out of the trapezoid quad.
// There is no body geometry and no painted body strip (a full-height bar
// at the quad root reads as a harsh stick when the wings fold) — the
// silhouette runs to the quad's inner edge and its dark basal shading is
// all the "body" a butterfly this size needs.
export function butterflyWingTexture() {
  const S = 256;
  const rand = mulberry32(83);
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  // wing silhouette: forewing sweep, a notch, then the hindwing lobe
  const P = [
    [0.008, 0.28], [0.45, 0.13], [0.82, 0.05], [0.965, 0.10], // leading edge
    [0.90, 0.30], [0.86, 0.44],                               // forewing tip edge
    [0.66, 0.50], [0.58, 0.53],                               // notch
    [0.74, 0.66], [0.70, 0.82],                               // hindwing bulge
    [0.52, 0.93], [0.34, 0.97], [0.20, 0.90],                 // scalloped trail
    [0.008, 0.80],
  ];
  const path = new Path2D();
  path.moveTo(P[0][0] * S, P[0][1] * S);
  for (let i = 1; i < P.length; i++) {
    const [x0, y0] = P[i - 1], [x1, y1] = P[i];
    // soft scallops: bow each segment outward a touch
    const mx = ((x0 + x1) / 2 + (y1 - y0) * 0.10) * S;
    const my = ((y0 + y1) / 2 - (x1 - x0) * 0.10) * S;
    path.quadraticCurveTo(mx, my, x1 * S, y1 * S);
  }
  path.closePath();

  // membrane: warm near-white, dimming a little toward the outer edge
  const mg = ctx.createRadialGradient(S * 0.08, S * 0.5, S * 0.05, S * 0.08, S * 0.5, S * 1.05);
  mg.addColorStop(0, '#fdf6e6');
  mg.addColorStop(0.55, '#f4ecd8');
  mg.addColorStop(1, '#ddd2ba');
  ctx.fillStyle = mg;
  ctx.fill(path);

  ctx.save();
  ctx.clip(path);

  // dark basal region where the wing roots meet in the middle
  const base = ctx.createRadialGradient(S * 0.008, S * 0.5, 0, S * 0.008, S * 0.5, S * 0.34);
  base.addColorStop(0, 'rgba(46,32,22,0.95)');
  base.addColorStop(0.45, 'rgba(46,32,22,0.4)');
  base.addColorStop(1, 'rgba(46,32,22,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  // veins fanning from the base, with a slight arc
  ctx.strokeStyle = 'rgba(52,38,26,0.5)';
  ctx.lineWidth = 2.2;
  for (const [tx, ty] of [
    [0.94, 0.12], [0.90, 0.26], [0.86, 0.40], [0.62, 0.51],
    [0.72, 0.64], [0.68, 0.79], [0.50, 0.91], [0.32, 0.95],
  ]) {
    ctx.beginPath();
    ctx.moveTo(S * 0.06, S * 0.5);
    ctx.quadraticCurveTo(S * (tx * 0.5 + 0.06), S * (ty * 0.62 + 0.17), S * tx, S * ty);
    ctx.stroke();
  }
  // fine cross-veins near the margin
  ctx.strokeStyle = 'rgba(52,38,26,0.28)';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 9; i++) {
    const a0 = 0.12 + i * 0.095 + rand() * 0.03;
    ctx.beginPath();
    ctx.moveTo(S * (0.60 + rand() * 0.12), S * a0);
    ctx.lineTo(S * (0.74 + rand() * 0.16), S * (a0 + 0.05));
    ctx.stroke();
  }

  // eyespots: one bold on the hindwing, one small on the forewing
  const spot = (x, y, r) => {
    ctx.fillStyle = 'rgba(40,28,20,0.92)';
    ctx.beginPath(); ctx.arc(S * x, S * y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(228,206,150,0.9)';
    ctx.beginPath(); ctx.arc(S * x, S * y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(35,25,18,0.95)';
    ctx.beginPath(); ctx.arc(S * x, S * y, r * 0.30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,252,240,0.95)';
    ctx.beginPath(); ctx.arc(S * (x - 0.012), S * (y - 0.014), r * 0.13, 0, Math.PI * 2); ctx.fill();
  };
  spot(0.60, 0.70, S * 0.062);
  spot(0.78, 0.24, S * 0.034);

  // dark margin band just inside the edge, with pale accent dots
  ctx.strokeStyle = 'rgba(38,28,22,0.85)';
  ctx.lineWidth = S * 0.055;
  ctx.stroke(path);
  ctx.fillStyle = 'rgba(250,244,226,0.85)';
  for (const [dx, dy] of [[0.90, 0.145], [0.865, 0.315], [0.71, 0.60], [0.63, 0.855], [0.43, 0.935]]) {
    ctx.beginPath();
    ctx.arc(S * dx, S * dy, S * 0.011, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // crisp dark rim (drawn unclipped so it plumps the silhouette slightly)
  ctx.strokeStyle = 'rgba(30,22,17,0.9)';
  ctx.lineWidth = 2.5;
  ctx.stroke(path);

  const t = tex(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return track(t);
}

// ---------------------------------------------------------------- soft glow dot
// Round radial glow for point sprites: firefly lanterns, the volcano's
// crater ember. White core so material/vertex colors do the tinting.
export function glowDotTexture() {
  const S = 64;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.13)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = tex(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return track(t);
}

// ---------------------------------------------------------------- cloud puff sprite
export function cloudTexture(seed = 71) {
  const S = 256;
  const rand = mulberry32(seed);
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const blobs = 12 + Math.floor(rand() * 8);
  for (let i = 0; i < blobs; i++) {
    const cx = S * 0.5 + (rand() - 0.5) * S * 0.55;
    const cy = S * 0.52 + (rand() - 0.5) * S * 0.26;
    const r = S * (0.10 + rand() * 0.15);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const warm = 244 + rand() * 11;
    g.addColorStop(0, `rgba(255,${warm},${warm - 8},${0.5 + rand() * 0.3})`);
    g.addColorStop(1, 'rgba(255,250,244,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  const t = tex(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return track(t);
}
