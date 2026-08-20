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

// Read a grey-painted height canvas back as a field and emit its normal map.
// Painting height with the same feature lists as the albedo keeps every
// groove, vein and thorn in agreement between the two maps.
function canvasToNormal(canvas, strength = 2.0) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const f = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = d[i * 4] / 255;
  return fieldToNormalCanvas(f, w, h, strength);
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

// ---------------------------------------------------------------- forest floor
// Humus and leaf litter for the island interior: dark earth with moss
// blotches, a season's worth of fallen-leaf flecks and a few twigs.
export function forestFloorTexture() {
  const S = 512;
  const rand = mulberry32(61);
  const macro = noiseField(S, 62, 5, 4);
  const moss = noiseField(S, 63, 4, 6);
  const [c, ctx] = makeCanvas(S, S);

  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const m = macro[i];
    const g = Math.max(moss[i] - 0.55, 0) * 2.2; // mossy patches
    img.data[i * 4] = 74 + m * 30 - 15 - g * 22;
    img.data[i * 4 + 1] = 62 + m * 26 - 13 + g * 26;
    img.data[i * 4 + 2] = 44 + m * 20 - 10 - g * 10;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // leaf litter: small tinted ellipses, brown through fresh-fallen green
  const leaves = [
    ['#7a5a32', 0.5, 2600],
    ['#5c4526', 0.5, 2200],
    ['#96703a', 0.42, 1500],
    ['#4f5b28', 0.4, 900],
    ['#77803a', 0.35, 600],
    ['#2e2418', 0.5, 800],
  ];
  for (const [col, alpha, count] of leaves) {
    ctx.fillStyle = col;
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = alpha * (0.5 + rand() * 0.5);
      ctx.beginPath();
      ctx.ellipse(rand() * S, rand() * S, 1.2 + rand() * 2.4, 0.8 + rand() * 1.2, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // twigs
  ctx.strokeStyle = '#3a2c1c';
  ctx.lineWidth = 1;
  for (let i = 0; i < 140; i++) {
    ctx.globalAlpha = 0.35 + rand() * 0.3;
    const x = rand() * S, y = rand() * S, a = rand() * Math.PI, l = 4 + rand() * 10;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return track(tex(c));
}

// ---------------------------------------------------------------- rock
// Cliff and mountain stone: gray-brown strata bands warped by noise, dark
// cracks wandering through, pale lichen freckles.
export function rockTexture() {
  const S = 512;
  const rand = mulberry32(66);
  const macro = noiseField(S, 67, 5, 4);
  const warp = noiseField(S, 68, 3, 4);
  const [c, ctx] = makeCanvas(S, S);

  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const m = macro[i];
      // horizontal strata, wobbled so the bands read as bedding planes
      const band = Math.sin(((y + warp[i] * 150) / S) * Math.PI * 2 * 9);
      const tone = 134 + m * 44 - 22 + band * 7;
      img.data[i * 4] = tone;
      img.data[i * 4 + 1] = tone * 0.94;
      img.data[i * 4 + 2] = tone * 0.86;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // cracks: dark random walks, mostly downhill like joints in the face
  ctx.strokeStyle = '#2c2620';
  for (let i = 0; i < 110; i++) {
    ctx.globalAlpha = 0.28 + rand() * 0.3;
    ctx.lineWidth = 0.7 + rand() * 0.9;
    let x = rand() * S, y = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 4 + Math.floor(rand() * 7);
    for (let sgm = 0; sgm < steps; sgm++) {
      x += (rand() - 0.5) * 26;
      y += 6 + rand() * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // lichen freckles
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = 0.16 + rand() * 0.2;
    ctx.fillStyle = rand() < 0.6 ? '#9aa06a' : '#c9c4a4';
    const s = 1 + rand() * 2;
    ctx.fillRect(rand() * S, rand() * S, s, s);
  }
  ctx.globalAlpha = 1;
  return track(tex(c));
}

// ---------------------------------------------------------------- forest flora
// Kapok bark: pale gray-green, horizontal lenticel dashes, faint thorn studs.
// Kapok (ceiba) bark: smooth grey-green skin over faint vertical muscling,
// horizontal lenticel bands, lichen discs, and the conical thorn studs young
// ceibas wear. One feature list is rendered twice — albedo and height — so
// the normal map agrees with every thorn and groove.
export function kapokBarkTexture() {
  const S = 512;
  const rand = mulberry32(73);
  const macro = noiseField(S, 74, 5, 4);

  const streaks = [];
  for (let i = 0; i < 64; i++) {
    streaks.push({
      x: rand() * S, w: 4 + rand() * 15, light: rand() < 0.45,
      a: 0.05 + rand() * 0.10, d1: rand() * 36 - 18, d2: rand() * 36 - 18,
    });
  }
  const bands = [];
  for (let y = 10 + rand() * 22; y < S; y += 30 + rand() * 46) {
    bands.push({ y, a: 0.06 + rand() * 0.10, amp: 1.5 + rand() * 3, ph: rand() * 7 });
  }
  const lichens = [];
  for (let i = 0; i < 30; i++) {
    lichens.push({
      x: rand() * S, y: rand() * S, rx: 6 + rand() * 24, ry: 4 + rand() * 15,
      rot: rand() * 3.2, a: 0.08 + rand() * 0.13, pale: rand() < 0.72,
    });
  }
  const thorns = [];
  for (let i = 0; i < 42; i++) {
    thorns.push({ x: rand() * S, y: rand() * S, r: 6 + rand() * 9 });
  }

  // ---- albedo ----
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const m = macro[i];
    img.data[i * 4] = 116 + m * 36 - 18;
    img.data[i * 4 + 1] = 121 + m * 36 - 18;
    img.data[i * 4 + 2] = 101 + m * 30 - 15;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (const s of streaks) {
    ctx.strokeStyle = s.light ? `rgba(168,174,150,${s.a})` : `rgba(74,78,62,${s.a})`;
    ctx.lineWidth = s.w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, -12);
    ctx.bezierCurveTo(s.x + s.d1, S * 0.33, s.x + s.d2, S * 0.66, s.x + s.d1 * 0.5, S + 12);
    ctx.stroke();
  }
  for (const b of bands) {
    ctx.strokeStyle = `rgba(62,66,52,${b.a})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let x = 0; x <= S; x += 10) {
      const yy = b.y + Math.sin((x / S) * Math.PI * 2 + b.ph) * b.amp;
      x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  for (const l of lichens) {
    ctx.fillStyle = l.pale
      ? `rgba(${178 + rand() * 30},${186 + rand() * 25},${162 + rand() * 22},${l.a})`
      : `rgba(${96 + rand() * 20},${118 + rand() * 20},${86 + rand() * 16},${l.a})`;
    ctx.beginPath();
    ctx.ellipse(l.x, l.y, l.rx, l.ry, l.rot, 0, 6.3);
    ctx.fill();
  }
  // thorns: sun from top-left — lit flank, dark flank, cast shadow, hot tip
  for (const t of thorns) {
    ctx.fillStyle = 'rgba(40,40,30,0.30)';
    ctx.beginPath();
    ctx.ellipse(t.x + t.r * 0.45, t.y + t.r * 0.5, t.r * 0.9, t.r * 0.5, 0.6, 0, 6.3);
    ctx.fill();
    const base = ctx.createRadialGradient(t.x, t.y, t.r * 0.1, t.x, t.y, t.r);
    base.addColorStop(0, 'rgba(150,146,120,0.95)');
    base.addColorStop(0.75, 'rgba(112,112,92,0.85)');
    base.addColorStop(1, 'rgba(100,104,86,0)');
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 6.3); ctx.fill();
    const lit = ctx.createRadialGradient(
      t.x - t.r * 0.3, t.y - t.r * 0.3, 0, t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.7);
    lit.addColorStop(0, 'rgba(226,220,190,0.9)');
    lit.addColorStop(1, 'rgba(200,196,164,0)');
    ctx.fillStyle = lit;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(58,58,44,0.55)';
    ctx.beginPath();
    ctx.ellipse(t.x + t.r * 0.34, t.y + t.r * 0.34, t.r * 0.42, t.r * 0.3, 0.8, 0, 6.3);
    ctx.fill();
  }

  // ---- height ----
  const [hc, hctx] = makeCanvas(S, S);
  const him = hctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 118 + (macro[i] - 0.5) * 52;
    him.data[i * 4] = v; him.data[i * 4 + 1] = v; him.data[i * 4 + 2] = v;
    him.data[i * 4 + 3] = 255;
  }
  hctx.putImageData(him, 0, 0);
  hctx.lineCap = 'round';
  for (const s of streaks) {
    hctx.strokeStyle = s.light ? `rgba(190,190,190,${s.a * 2})` : `rgba(60,60,60,${s.a * 2})`;
    hctx.lineWidth = s.w;
    hctx.beginPath();
    hctx.moveTo(s.x, -12);
    hctx.bezierCurveTo(s.x + s.d1, S * 0.33, s.x + s.d2, S * 0.66, s.x + s.d1 * 0.5, S + 12);
    hctx.stroke();
  }
  for (const b of bands) {
    hctx.strokeStyle = `rgba(70,70,70,${b.a * 2.4})`;
    hctx.lineWidth = 2;
    hctx.beginPath();
    for (let x = 0; x <= S; x += 10) {
      const yy = b.y + Math.sin((x / S) * Math.PI * 2 + b.ph) * b.amp;
      x === 0 ? hctx.moveTo(x, yy) : hctx.lineTo(x, yy);
    }
    hctx.stroke();
  }
  for (const l of lichens) {
    hctx.fillStyle = `rgba(170,170,170,${l.a * 1.4})`;
    hctx.beginPath();
    hctx.ellipse(l.x, l.y, l.rx, l.ry, l.rot, 0, 6.3);
    hctx.fill();
  }
  for (const t of thorns) {
    const g = hctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(200,200,200,0.7)');
    g.addColorStop(1, 'rgba(118,118,118,0)');
    hctx.fillStyle = g;
    hctx.beginPath(); hctx.arc(t.x, t.y, t.r, 0, 6.3); hctx.fill();
  }

  return {
    map: track(tex(c)),
    normalMap: track(tex(canvasToNormal(hc, 3.0), { srgb: false })),
  };
}

// Tropical-almond bark: grey-brown, shallowly fissured into flat vertical
// plates — flakier and drier than the kapok's smooth skin.
export function almondBarkTexture() {
  const S = 256;
  const rand = mulberry32(91);
  const macro = noiseField(S, 92, 5, 5);

  const fissures = [];
  for (let i = 0; i < 22; i++) {
    fissures.push({
      x: rand() * S, w: 1.6 + rand() * 3.4, a: 0.28 + rand() * 0.3,
      d1: rand() * 26 - 13, d2: rand() * 26 - 13,
    });
  }
  const cracks = [];
  for (let i = 0; i < 16; i++) {
    cracks.push({
      x: rand() * S, y: rand() * S, len: 10 + rand() * 30,
      ang: (rand() - 0.5) * 0.8, a: 0.2 + rand() * 0.25,
    });
  }
  const plates = [];
  for (let i = 0; i < 26; i++) {
    plates.push({
      x: rand() * S, y: rand() * S, rx: 8 + rand() * 20, ry: 14 + rand() * 34,
      a: 0.06 + rand() * 0.09, light: rand() < 0.6,
    });
  }

  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const m = macro[i];
    img.data[i * 4] = 128 + m * 40 - 20;
    img.data[i * 4 + 1] = 118 + m * 38 - 19;
    img.data[i * 4 + 2] = 104 + m * 34 - 17;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (const p of plates) {
    ctx.fillStyle = p.light ? `rgba(168,158,142,${p.a})` : `rgba(82,74,64,${p.a})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, 6.3);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  for (const f of fissures) {
    // groove, with a lit right lip
    ctx.strokeStyle = `rgba(48,42,36,${f.a})`;
    ctx.lineWidth = f.w;
    ctx.beginPath();
    ctx.moveTo(f.x, -10);
    ctx.bezierCurveTo(f.x + f.d1, S * 0.33, f.x + f.d2, S * 0.66, f.x + f.d1 * 0.4, S + 10);
    ctx.stroke();
    ctx.strokeStyle = `rgba(178,168,150,${f.a * 0.5})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(f.x + f.w * 0.8, -10);
    ctx.bezierCurveTo(f.x + f.d1 + f.w * 0.8, S * 0.33, f.x + f.d2 + f.w * 0.8, S * 0.66,
      f.x + f.d1 * 0.4 + f.w * 0.8, S + 10);
    ctx.stroke();
  }
  for (const k of cracks) {
    ctx.strokeStyle = `rgba(52,46,40,${k.a})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(k.x - Math.cos(k.ang) * k.len / 2, k.y - Math.sin(k.ang) * k.len / 2);
    ctx.lineTo(k.x + Math.cos(k.ang) * k.len / 2, k.y + Math.sin(k.ang) * k.len / 2);
    ctx.stroke();
  }

  const [hc, hctx] = makeCanvas(S, S);
  const him = hctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 128 + (macro[i] - 0.5) * 60;
    him.data[i * 4] = v; him.data[i * 4 + 1] = v; him.data[i * 4 + 2] = v;
    him.data[i * 4 + 3] = 255;
  }
  hctx.putImageData(him, 0, 0);
  hctx.lineCap = 'round';
  for (const p of plates) {
    hctx.fillStyle = p.light ? `rgba(178,178,178,${p.a * 1.6})` : `rgba(84,84,84,${p.a * 1.6})`;
    hctx.beginPath();
    hctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, 6.3);
    hctx.fill();
  }
  for (const f of fissures) {
    hctx.strokeStyle = `rgba(30,30,30,${Math.min(f.a * 1.9, 1)})`;
    hctx.lineWidth = f.w + 1;
    hctx.beginPath();
    hctx.moveTo(f.x, -10);
    hctx.bezierCurveTo(f.x + f.d1, S * 0.33, f.x + f.d2, S * 0.66, f.x + f.d1 * 0.4, S + 10);
    hctx.stroke();
  }
  for (const k of cracks) {
    hctx.strokeStyle = `rgba(40,40,40,${k.a * 1.6})`;
    hctx.lineWidth = 1.6;
    hctx.beginPath();
    hctx.moveTo(k.x - Math.cos(k.ang) * k.len / 2, k.y - Math.sin(k.ang) * k.len / 2);
    hctx.lineTo(k.x + Math.cos(k.ang) * k.len / 2, k.y + Math.sin(k.ang) * k.len / 2);
    hctx.stroke();
  }

  return {
    map: track(tex(c)),
    normalMap: track(tex(canvasToNormal(hc, 2.6), { srgb: false })),
  };
}

// Kapok crown cards: a 2×2 atlas of foliage clusters, each a mass of the
// ceiba's palmately-compound leaves (5–7 lanceolate leaflets fanned from a
// stalk point). Painted in depth layers — shadowed interior first, then lit
// mid leaves, then bright fringe with a sun glaze — so a flat card reads as
// a metre of canopy.
export function kapokCanopyTexture() {
  const S = 512, CELL = 256;
  const rand = mulberry32(76);
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  const leaflet = (len, wid, r, g, b, veinA) => {
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, `rgb(${Math.round(r * 0.62)},${Math.round(g * 0.62)},${Math.round(b * 0.62)})`);
    grad.addColorStop(1, `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(wid, -len * 0.3, wid * 0.72, -len * 0.75, 0, -len);
    ctx.bezierCurveTo(-wid * 0.72, -len * 0.75, -wid, -len * 0.3, 0, 0);
    ctx.fill();
    ctx.strokeStyle = `rgba(${Math.round(r * 1.5 + 40)},${Math.round(g * 1.35 + 40)},${Math.round(b + 30)},${veinA})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -len + 3); ctx.stroke();
  };

  // one palmate leaf: 5–7 leaflets fanned around the petiole point
  const palmate = (x, y, size, ang, shade, warm) => {
    const nL = 5 + Math.floor(rand() * 3);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    for (let j = 0; j < nL; j++) {
      const f = nL === 1 ? 0.5 : j / (nL - 1);
      const spread = (f - 0.5) * 2.6 + (rand() - 0.5) * 0.16;
      const len = size * (0.7 + 0.4 * Math.sin(f * Math.PI)) * (0.92 + rand() * 0.16);
      ctx.save();
      ctx.rotate(spread);
      const r = (38 + warm * 26) * shade, g = (88 + warm * 20) * shade, b = (32 + warm * 6) * shade;
      leaflet(len, size * 0.24, r, g, b, 0.3 * shade);
      ctx.restore();
    }
    ctx.restore();
  };

  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx * CELL, cy * CELL, CELL, CELL);
      ctx.clip();
      ctx.translate(cx * CELL + CELL / 2, cy * CELL + CELL / 2);

      // back / mid / front leaf passes, dark to bright; the reach keeps
      // every leaflet tip inside the cell so no cluster gets clipped into a
      // straight hedge-trimmed edge
      for (const [count, rMax, shade0, shade1] of [
        [14, 0.26, 0.45, 0.66], [16, 0.30, 0.74, 1.0], [13, 0.32, 1.02, 1.32],
      ]) {
        for (let i = 0; i < count; i++) {
          const a = rand() * Math.PI * 2;
          const rr = Math.pow(rand(), 0.58) * CELL * rMax;
          const shade = shade0 + rand() * (shade1 - shade0);
          palmate(Math.cos(a) * rr, Math.sin(a) * rr,
            22 + rand() * 16, a + Math.PI / 2 + (rand() - 0.5) * 1.4,
            shade, rand() * 0.7);
        }
      }

      // shade + sun, painted onto the leaves only so no halo survives the
      // alpha test: ambient darkening toward the cluster's heart, then a
      // glaze from the upper left
      ctx.globalCompositeOperation = 'source-atop';
      const ao = ctx.createRadialGradient(0, 6, 0, 0, 6, CELL * 0.46);
      ao.addColorStop(0, 'rgba(8,18,6,0.5)');
      ao.addColorStop(0.55, 'rgba(8,18,6,0.22)');
      ao.addColorStop(1, 'rgba(8,18,6,0)');
      ctx.fillStyle = ao;
      ctx.fillRect(-CELL / 2, -CELL / 2, CELL, CELL);
      const sun = ctx.createRadialGradient(-CELL * 0.2, -CELL * 0.24, 0, -CELL * 0.2, -CELL * 0.24, CELL * 0.6);
      sun.addColorStop(0, 'rgba(255,250,205,0.18)');
      sun.addColorStop(1, 'rgba(255,250,205,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(-CELL / 2, -CELL / 2, CELL, CELL);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
  }
  return track(tex(c, { repeat: false }));
}

// Tropical-almond crown cards: a 2×2 atlas of the tree's big obovate leaves
// in the flat rosette whorls it holds at branch tips. The fourth cell is the
// turning cluster — scarlet and copper leaves an almond sheds year-round.
export function almondCanopyTexture() {
  const S = 512, CELL = 256;
  const rand = mulberry32(83);
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  // one obovate leaf drawn base-at-origin, tip up
  const leaf = (x, y, len, wid, ang, rgb, shade, veinA) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const [r, g, b] = rgb;
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, `rgb(${Math.round(r * 0.55 * shade)},${Math.round(g * 0.55 * shade)},${Math.round(b * 0.55 * shade)})`);
    grad.addColorStop(0.75, `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)})`);
    grad.addColorStop(1, `rgb(${Math.round(r * 1.08 * shade)},${Math.round(g * 1.06 * shade)},${Math.round(b * shade)})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    // obovate: broadest past the middle, rounded tip, tapered base
    ctx.bezierCurveTo(wid * 0.4, -len * 0.3, wid, -len * 0.72, wid * 0.42, -len * 0.94);
    ctx.quadraticCurveTo(0, -len * 1.04, -wid * 0.42, -len * 0.94);
    ctx.bezierCurveTo(-wid, -len * 0.72, -wid * 0.4, -len * 0.3, 0, 0);
    ctx.fill();
    // midrib + pinnate veins
    ctx.strokeStyle = `rgba(${Math.round(r * 0.8 + 90)},${Math.round(g * 0.75 + 80)},${Math.round(b * 0.6 + 50)},${veinA})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -len * 0.97); ctx.stroke();
    ctx.lineWidth = 0.7;
    for (let v = 1; v <= 5; v++) {
      const t = v / 6;
      ctx.beginPath();
      ctx.moveTo(0, -len * t);
      ctx.quadraticCurveTo(wid * 0.5, -len * (t + 0.1), wid * 0.72, -len * (t + 0.16));
      ctx.moveTo(0, -len * t);
      ctx.quadraticCurveTo(-wid * 0.5, -len * (t + 0.1), -wid * 0.72, -len * (t + 0.16));
      ctx.stroke();
    }
    ctx.restore();
  };

  const GREEN = [66, 104, 38], RED = [168, 62, 26], COPPER = [178, 110, 34];
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const turning = cx === 1 && cy === 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx * CELL, cy * CELL, CELL, CELL);
      ctx.clip();
      ctx.translate(cx * CELL + CELL / 2, cy * CELL + CELL / 2);

      // two rosette rings: a shadowed lower whorl, then the lit crown; leaf
      // tips stay inside the cell so no rosette is clipped square
      for (const [count, r0, r1, shade0, shade1] of [
        [12, 0.07, 0.13, 0.56, 0.82], [15, 0.02, 0.09, 0.95, 1.3],
      ]) {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + rand() * 0.8;
          const rr = CELL * (r0 + rand() * (r1 - r0));
          const redRoll = rand();
          const rgb = turning
            ? (redRoll < 0.55 ? RED : redRoll < 0.8 ? COPPER : GREEN)
            : (redRoll < 0.07 ? COPPER : GREEN);
          leaf(Math.cos(a) * rr, Math.sin(a) * rr,
            CELL * (0.24 + rand() * 0.10), CELL * (0.095 + rand() * 0.035),
            a + Math.PI / 2 + (rand() - 0.5) * 0.5,
            rgb, shade0 + rand() * (shade1 - shade0), 0.4);
        }
      }

      ctx.globalCompositeOperation = 'source-atop';
      const ao = ctx.createRadialGradient(0, 0, 0, 0, 0, CELL * 0.4);
      ao.addColorStop(0, 'rgba(12,18,6,0.45)');
      ao.addColorStop(1, 'rgba(12,18,6,0)');
      ctx.fillStyle = ao;
      ctx.fillRect(-CELL / 2, -CELL / 2, CELL, CELL);
      const sun = ctx.createRadialGradient(-CELL * 0.18, -CELL * 0.2, 0, -CELL * 0.18, -CELL * 0.2, CELL * 0.55);
      sun.addColorStop(0, 'rgba(255,246,200,0.17)');
      sun.addColorStop(1, 'rgba(255,246,200,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(-CELL / 2, -CELL / 2, CELL, CELL);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
  }
  return track(tex(c, { repeat: false }));
}

// One banana blade, base at the canvas bottom: rounded paddle, glossy
// alternating vein bands sweeping toward the tip, wind splits torn to the
// midrib with dried brown edges, and a pale channelled midrib. The height
// pass bakes the rib and vein corrugation into a normal map.
export function bananaLeafTexture() {
  const W = 256, H = 512;
  const rand = mulberry32(79);
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  const Y0 = 6, Y1 = H - 6;
  // s runs 0 at the tip (canvas top) → 1 at the base
  const half = (s) => W * 0.47
    * Math.pow(Math.sin(Math.PI / 2 * Math.min((1 - s) * 2.4, 1)), 0.75)
    * Math.pow(Math.sin(Math.PI / 2 * Math.min(s * 2.1, 1)), 0.55);

  // silhouette
  ctx.beginPath();
  ctx.moveTo(W / 2, Y0);
  for (let i = 0; i <= 40; i++) {
    const s = i / 40;
    const y = Y0 + s * (Y1 - Y0);
    ctx.lineTo(W / 2 + half(s) + Math.sin(s * 40 + 1.7) * 1.5, y);
  }
  for (let i = 40; i >= 0; i--) {
    const s = i / 40;
    const y = Y0 + s * (Y1 - Y0);
    ctx.lineTo(W / 2 - half(s) - Math.sin(s * 43) * 1.5, y);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, Y0, 0, Y1);
  g.addColorStop(0, '#3c7524');
  g.addColorStop(0.5, '#356b20');
  g.addColorStop(1, '#2b5a1c');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();
  // vein bands: glossy corrugation sweeping up toward the tip
  const VSLOPE = 58; // px of rise across the half-blade
  for (let y = Y0 - VSLOPE; y < Y1 + 20; y += 7) {
    const lightBand = ((y / 7) | 0) % 2 === 0;
    for (const side of [1, -1]) {
      ctx.strokeStyle = lightBand
        ? `rgba(190,220,120,${0.10 + rand() * 0.06})`
        : `rgba(14,36,10,${0.12 + rand() * 0.06})`;
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      ctx.lineTo(W / 2 + side * W * 0.55, y - VSLOPE);
      ctx.stroke();
    }
  }
  // sharper vein lines every few bands
  for (let y = Y0; y < Y1 + 20; y += 21) {
    for (const side of [1, -1]) {
      ctx.strokeStyle = `rgba(210,235,150,${0.16 + rand() * 0.10})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      ctx.lineTo(W / 2 + side * W * 0.55, y - VSLOPE);
      ctx.stroke();
    }
  }
  // broad sheen along the left blade
  const sheen = ctx.createLinearGradient(0, 0, W, H * 0.4);
  sheen.addColorStop(0.15, 'rgba(235,255,190,0.12)');
  sheen.addColorStop(0.45, 'rgba(235,255,190,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // wind splits: torn along the vein angle, then edged in dried brown
  const splits = [];
  for (let i = 0; i < 9; i++) {
    const s = 0.12 + rand() * 0.66;
    const side = rand() < 0.5 ? 1 : -1;
    splits.push({ s, side, depth: 0.35 + rand() * 0.6, w: 1.6 + rand() * 2.6 });
  }
  for (const sp of splits) {
    const y = Y0 + sp.s * (Y1 - Y0);
    const hx = half(sp.s);
    const x0 = W / 2 + sp.side * (hx + 4);
    const x1 = W / 2 + sp.side * hx * (1 - sp.depth);
    const y1 = y + (hx * sp.depth / (W * 0.55)) * VSLOPE;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = sp.w;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y - 4); ctx.lineTo(x1, y1 - 4); ctx.stroke();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = 'rgba(122,96,44,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y - 4 - sp.w * 0.8); ctx.lineTo(x1, y1 - 4 - sp.w * 0.8);
    ctx.moveTo(x0, y - 4 + sp.w * 0.8); ctx.lineTo(x1, y1 - 4 + sp.w * 0.8);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // dried margins: tip scorch and a few edge patches
  ctx.globalCompositeOperation = 'source-atop';
  const tipDry = ctx.createLinearGradient(0, Y0, 0, Y0 + 40);
  tipDry.addColorStop(0, 'rgba(150,118,52,0.7)');
  tipDry.addColorStop(1, 'rgba(150,118,52,0)');
  ctx.fillStyle = tipDry;
  ctx.fillRect(0, Y0, W, 44);
  for (let i = 0; i < 6; i++) {
    const s = 0.15 + rand() * 0.7;
    const side = rand() < 0.5 ? 1 : -1;
    const x = W / 2 + side * half(s);
    const y = Y0 + s * (Y1 - Y0);
    const r = 6 + rand() * 14;
    const dry = ctx.createRadialGradient(x, y, 0, x, y, r);
    dry.addColorStop(0, `rgba(${140 + rand() * 30},${108 + rand() * 20},48,0.55)`);
    dry.addColorStop(1, 'rgba(140,108,48,0)');
    ctx.fillStyle = dry;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // midrib: dark seams flanking a pale channelled rib, tapering to the tip
  for (const [wScale, style] of [
    [1.9, 'rgba(20,44,12,0.9)'], [1.0, 'rgba(196,214,120,0.95)'], [0.32, 'rgba(240,248,190,0.9)'],
  ]) {
    ctx.beginPath();
    ctx.moveTo(W / 2 - 4.5 * wScale, Y1);
    ctx.lineTo(W / 2 - 0.7 * wScale, Y0 + 3);
    ctx.lineTo(W / 2 + 0.7 * wScale, Y0 + 3);
    ctx.lineTo(W / 2 + 4.5 * wScale, Y1);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }

  // ---- height: midrib ridge + vein corrugation ----
  const [hc, hctx] = makeCanvas(W, H);
  hctx.fillStyle = 'rgb(128,128,128)';
  hctx.fillRect(0, 0, W, H);
  for (let y = Y0 - VSLOPE; y < Y1 + 20; y += 7) {
    const lightBand = ((y / 7) | 0) % 2 === 0;
    for (const side of [1, -1]) {
      hctx.strokeStyle = lightBand ? 'rgba(180,180,180,0.5)' : 'rgba(76,76,76,0.5)';
      hctx.lineWidth = 4.6;
      hctx.beginPath();
      hctx.moveTo(W / 2, y);
      hctx.lineTo(W / 2 + side * W * 0.55, y - VSLOPE);
      hctx.stroke();
    }
  }
  hctx.fillStyle = 'rgb(230,230,230)';
  hctx.beginPath();
  hctx.moveTo(W / 2 - 8, Y1); hctx.lineTo(W / 2 - 1.2, Y0 + 3);
  hctx.lineTo(W / 2 + 1.2, Y0 + 3); hctx.lineTo(W / 2 + 8, Y1);
  hctx.closePath(); hctx.fill();

  return {
    map: track(tex(c, { repeat: false })),
    normalMap: track(tex(canvasToNormal(hc, 1.6), { repeat: false, srgb: false })),
  };
}

// Banana pseudostem: tightly rolled leaf sheaths — waxy pale green wraps
// crossing at shallow angles, cream where a sheath edge catches light and
// papery brown where the outer ones have dried.
export function bananaStemTexture() {
  const W = 128, H = 256;
  const rand = mulberry32(85);
  const [c, ctx] = makeCanvas(W, H);

  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#8fae74');
  g.addColorStop(0.45, '#a9c48b');
  g.addColorStop(1, '#87a56c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // sheath wraps: shallow diagonal bands, each with a shadowed edge and a
  // cream lit lip above it
  let y = -20;
  while (y < H + 20) {
    const drop = 14 + rand() * 26;
    const slope = (rand() - 0.35) * 30;
    const tone = rand();
    ctx.fillStyle = tone < 0.6
      ? `rgba(${142 + rand() * 30},${168 + rand() * 26},${112 + rand() * 22},0.5)`
      : `rgba(${196 + rand() * 30},${198 + rand() * 26},${150 + rand() * 20},0.42)`;
    ctx.beginPath();
    ctx.moveTo(-4, y);
    ctx.lineTo(W + 4, y + slope);
    ctx.lineTo(W + 4, y + slope + drop);
    ctx.lineTo(-4, y + drop);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(52,66,38,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-4, y + drop); ctx.lineTo(W + 4, y + slope + drop); ctx.stroke();
    ctx.strokeStyle = 'rgba(228,238,196,0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-4, y + drop + 1.6); ctx.lineTo(W + 4, y + slope + drop + 1.6); ctx.stroke();
    // a dried papery patch riding some wraps
    if (rand() < 0.4) {
      const px = rand() * W;
      const dry = ctx.createRadialGradient(px, y + drop * 0.5, 0, px, y + drop * 0.5, 12 + rand() * 18);
      dry.addColorStop(0, `rgba(${150 + rand() * 30},${120 + rand() * 24},70,0.5)`);
      dry.addColorStop(1, 'rgba(150,120,70,0)');
      ctx.fillStyle = dry;
      ctx.fillRect(0, 0, W, H);
    }
    y += drop;
  }
  // fine vertical fibre streaks
  for (let i = 0; i < 90; i++) {
    const x = rand() * W;
    const light = rand() < 0.5;
    ctx.strokeStyle = light ? 'rgba(220,236,180,0.10)' : 'rgba(64,84,48,0.10)';
    ctx.lineWidth = 0.7 + rand();
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + rand() * 4 - 2, H);
    ctx.stroke();
  }
  return track(tex(c));
}

// A taro/elephant-ear blade for the big-leaf shrub: heart lobes at the base,
// drip tip above, radiating pale veins off a peltate junction, waxy sheen.
// Drawn base-at-bottom so a bent card strip maps straight onto it; a green
// petiole stub under the base gives stalk ribbons an opaque strip to sample.
export function bigLeafTexture() {
  const S = 256;
  const rand = mulberry32(82);
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  // blade silhouette: tip at top, two rounded lobes at the bottom, margins
  // gently scalloped
  ctx.beginPath();
  ctx.moveTo(S / 2, S * 0.04); // drip tip
  ctx.bezierCurveTo(S * 0.86, S * 0.18, S * 0.97, S * 0.52, S * 0.78, S * 0.76);
  ctx.bezierCurveTo(S * 0.66, S * 0.90, S * 0.56, S * 0.88, S * 0.53, S * 0.80);
  ctx.quadraticCurveTo(S * 0.5, S * 0.74, S * 0.47, S * 0.80);
  ctx.bezierCurveTo(S * 0.44, S * 0.88, S * 0.34, S * 0.90, S * 0.22, S * 0.76);
  ctx.bezierCurveTo(S * 0.03, S * 0.52, S * 0.14, S * 0.18, S / 2, S * 0.04);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, S * 0.3, S);
  g.addColorStop(0, '#356e26');
  g.addColorStop(0.55, '#2a5c1f');
  g.addColorStop(1, '#1f4a1a');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();
  // per-pixel chlorophyll mottle
  const n = noiseField(S, 84, 4, 5);
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    if (img.data[i * 4 + 3] === 0) continue;
    const v = (n[i] - 0.5) * 26;
    img.data[i * 4] += v * 0.6;
    img.data[i * 4 + 1] += v;
    img.data[i * 4 + 2] += v * 0.4;
  }
  ctx.putImageData(img, 0, 0);

  // veins radiate from the peltate junction a third of the way down
  const jx = S / 2, jy = S * 0.62;
  ctx.strokeStyle = 'rgba(178,214,140,0.6)';
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(jx, jy + S * 0.16); ctx.lineTo(S / 2, S * 0.06); ctx.stroke();
  const spokes = [
    [0.13, 0.16], [0.30, 0.20], [0.52, 0.30], [0.74, 0.52],
  ];
  for (const side of [1, -1]) {
    for (const [fx, fy] of spokes) {
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(jx, jy);
      ctx.quadraticCurveTo(
        jx + side * S * fx * 0.6, jy - S * (0.62 - fy) * 0.75,
        jx + side * S * fx * 0.62 + side * S * 0.16, S * fy);
      ctx.stroke();
    }
    // the lobe veins run downward
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(jx, jy);
    ctx.quadraticCurveTo(jx + side * S * 0.14, jy + S * 0.10, jx + side * S * 0.22, S * 0.82);
    ctx.stroke();
  }
  // secondary net, faint
  ctx.strokeStyle = 'rgba(150,190,120,0.16)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = S * (0.08 + rand() * 0.16), r1 = r0 + S * (0.1 + rand() * 0.14);
    ctx.beginPath();
    ctx.moveTo(jx + Math.cos(a) * r0, jy - S * 0.1 + Math.sin(a) * r0 * 0.9);
    ctx.lineTo(jx + Math.cos(a) * r1, jy - S * 0.1 + Math.sin(a) * r1 * 0.9);
    ctx.stroke();
  }
  // waxy sheen band
  const sheen = ctx.createLinearGradient(S * 0.1, 0, S * 0.7, S * 0.8);
  sheen.addColorStop(0.25, 'rgba(226,246,200,0)');
  sheen.addColorStop(0.42, 'rgba(226,246,200,0.14)');
  sheen.addColorStop(0.6, 'rgba(226,246,200,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, S, S);
  // pale rim
  ctx.strokeStyle = 'rgba(190,220,150,0.35)';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();

  // petiole stub under the notch: stalk ribbons sample this strip
  ctx.fillStyle = '#4e7a34';
  ctx.fillRect(S * 0.47, S * 0.78, S * 0.06, S * 0.22);
  ctx.strokeStyle = 'rgba(30,52,20,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(S * 0.485, S * 0.8); ctx.lineTo(S * 0.485, S);
  ctx.moveTo(S * 0.515, S * 0.8); ctx.lineTo(S * 0.515, S);
  ctx.stroke();

  // ---- height: recessed veins on a domed blade ----
  const [hc, hctx] = makeCanvas(S, S);
  hctx.fillStyle = 'rgb(128,128,128)';
  hctx.fillRect(0, 0, S, S);
  const dome = hctx.createRadialGradient(jx, jy - S * 0.14, 0, jx, jy - S * 0.14, S * 0.45);
  dome.addColorStop(0, 'rgba(185,185,185,0.9)');
  dome.addColorStop(1, 'rgba(110,110,110,0.9)');
  hctx.fillStyle = dome;
  hctx.fillRect(0, 0, S, S);
  hctx.strokeStyle = 'rgba(60,60,60,0.85)';
  hctx.lineWidth = 3;
  hctx.beginPath(); hctx.moveTo(jx, jy + S * 0.16); hctx.lineTo(S / 2, S * 0.06); hctx.stroke();
  for (const side of [1, -1]) {
    for (const [fx, fy] of spokes) {
      hctx.lineWidth = 2.2;
      hctx.beginPath();
      hctx.moveTo(jx, jy);
      hctx.quadraticCurveTo(
        jx + side * S * fx * 0.6, jy - S * (0.62 - fy) * 0.75,
        jx + side * S * fx * 0.62 + side * S * 0.16, S * fy);
      hctx.stroke();
    }
  }
  return {
    map: track(tex(c, { repeat: false })),
    normalMap: track(tex(canvasToNormal(hc, 2.2), { repeat: false, srgb: false })),
  };
}

// Two tree-fern fronds side by side (a 2-column atlas): a curving rachis
// with ~18 pinna pairs, each pinna a run of tiny serrate leaflets, olive at
// the base brightening to yellow-green at the tip. Alpha does the shaping —
// a 10-triangle ribbon wears this and reads as a metre-long frond.
export function fernFrondTexture() {
  const W = 256, H = 512, COL = 128;
  const rand = mulberry32(88);
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  const frond = (x0, sway) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, COL, H);
    ctx.clip();
    const cx = (t) => x0 + COL / 2 + Math.sin(t * Math.PI) * sway; // rachis curve
    const cy = (t) => (H - 8) - t * (H - 20);                      // base at bottom

    // rachis
    ctx.strokeStyle = '#5a4a2c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx(0), cy(0));
    for (let i = 1; i <= 24; i++) ctx.lineTo(cx(i / 24), cy(i / 24));
    ctx.stroke();

    const PAIRS = 23;
    for (let p = 0; p < PAIRS; p++) {
      const t = 0.05 + (p / (PAIRS - 1)) * 0.93;
      // fronds taper toward both ends, longest a third of the way up
      const lenK = Math.pow(Math.sin(Math.pow(t, 0.72) * Math.PI), 0.8);
      const pLen = (COL * 0.48) * (0.28 + 0.72 * lenK);
      const px = cx(t), py = cy(t);
      for (const side of [1, -1]) {
        // one solid pinna blade: a tapered strip whose edges are cut into
        // leaflet teeth, brightening base to tip. Wide enough that
        // neighbouring pinnae almost touch — a frond is a surface, not a
        // fishbone.
        const ex = side * pLen, ey = -pLen * (0.34 + t * 0.12);
        const nx = -ey / pLen, ny = ex / pLen; // unit normal to the pinna axis
        const w0 = (6.5 + lenK * 5.5);
        const TEETH = 9 + Math.floor(lenK * 4);
        const bright = 0.62 + t * 0.3;
        const grad = ctx.createLinearGradient(px, py, px + ex, py + ey);
        grad.addColorStop(0, `rgb(${Math.round(40 * bright)},${Math.round(82 * bright)},${Math.round(26 * bright)})`);
        grad.addColorStop(1, `rgb(${Math.round(66 * bright)},${Math.round(126 * bright)},${Math.round(42 * bright)})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(px, py);
        for (let sI = 0; sI <= TEETH; sI++) {
          const st = sI / TEETH;
          const w = w0 * (1 - st * 0.82);
          const jag = (sI % 2 ? 1.0 : 0.45) + (rand() - 0.5) * 0.2;
          ctx.lineTo(px + ex * st + nx * w * jag, py + ey * st + ny * w * jag);
        }
        for (let sI = TEETH; sI >= 0; sI--) {
          const st = sI / TEETH;
          const w = w0 * (1 - st * 0.82);
          const jag = (sI % 2 ? 1.0 : 0.45) + (rand() - 0.5) * 0.2;
          ctx.lineTo(px + ex * st - nx * w * jag, py + ey * st - ny * w * jag);
        }
        ctx.closePath();
        ctx.fill();
        // pinna midrib
        ctx.strokeStyle = `rgba(${Math.round(120 * bright)},${Math.round(150 * bright)},${Math.round(70 * bright)},0.55)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + ex * 0.96, py + ey * 0.96);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  frond(0, 7);
  frond(COL, -9);
  return track(tex(c, { repeat: false }));
}

// Tree-fern trunk: the dark fibrous mat of old leaf bases — dense red-brown
// hair streaks studded with oval frond scars in a loose spiral.
export function fernTrunkTexture() {
  const W = 128, H = 256;
  const rand = mulberry32(94);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#4d3a2b';
  ctx.fillRect(0, 0, W, H);

  const scars = [];
  for (let i = 0; i < 7; i++) {
    scars.push({ x: rand() * W, y: rand() * H, rx: 7 + rand() * 6, ry: 5 + rand() * 4 });
  }

  // fibre streaks, dark and light
  for (let i = 0; i < 420; i++) {
    const x = rand() * W;
    const warm = rand();
    ctx.strokeStyle = warm < 0.5
      ? `rgba(${30 + rand() * 22},${20 + rand() * 14},${13 + rand() * 9},${0.18 + rand() * 0.22})`
      : `rgba(${128 + rand() * 62},${90 + rand() * 38},${54 + rand() * 22},${0.12 + rand() * 0.18})`;
    ctx.lineWidth = 0.6 + rand() * 1.1;
    const y0 = rand() * H - 30;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.bezierCurveTo(x + rand() * 5 - 2.5, y0 + 30, x + rand() * 5 - 2.5, y0 + 60, x + rand() * 4 - 2, y0 + 90);
    ctx.stroke();
  }
  // frond scars: raised oval rim, sunken dark centre
  for (const s of scars) {
    ctx.fillStyle = 'rgba(140,104,64,0.75)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(20,12,8,0.9)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, s.rx * 0.6, s.ry * 0.55, 0, 0, 6.3); ctx.fill();
  }

  // height: fibre ridges + scar bosses
  const [hc, hctx] = makeCanvas(W, H);
  hctx.fillStyle = 'rgb(128,128,128)';
  hctx.fillRect(0, 0, W, H);
  const rand2 = mulberry32(95);
  for (let i = 0; i < 300; i++) {
    const x = rand2() * W;
    const y0 = rand2() * H - 30;
    hctx.strokeStyle = rand2() < 0.5 ? 'rgba(80,80,80,0.35)' : 'rgba(180,180,180,0.3)';
    hctx.lineWidth = 0.8 + rand2() * 1.2;
    hctx.beginPath();
    hctx.moveTo(x, y0);
    hctx.lineTo(x + rand2() * 4 - 2, y0 + 80);
    hctx.stroke();
  }
  for (const s of scars) {
    hctx.fillStyle = 'rgba(210,210,210,0.9)';
    hctx.beginPath(); hctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, 6.3); hctx.fill();
    hctx.fillStyle = 'rgba(70,70,70,0.9)';
    hctx.beginPath(); hctx.ellipse(s.x, s.y, s.rx * 0.6, s.ry * 0.55, 0, 0, 6.3); hctx.fill();
  }
  return {
    map: track(tex(c)),
    normalMap: track(tex(canvasToNormal(hc, 2.4), { srgb: false })),
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
  // The three germination pores — the coconut's face. A real nut wears them
  // in a tight triangle on one end, so they are drawn as one cluster rather
  // than spread evenly around the pole. Off the pole the sphere's UVs barely
  // pinch, so each pore stays round instead of smearing the way one drawn
  // over the pole does. Radii are angles on the nut turned into pixels: the
  // sheet spans 2*pi across u and only pi down v, so a pore is half as wide
  // as it is tall, divided again by its latitude's foreshortening.
  const EYES = [
    { u: 0.5, v: 0.25, a: 0.082 },    // the soft eye, the one that sprouts
    { u: 0.4715, v: 0.33, a: 0.072 },
    { u: 0.5285, v: 0.33, a: 0.072 },
  ];

  // the face is balder and a shade darker than the rest of the husk
  ctx.save();
  ctx.translate(0.5 * S, 0.3 * S);
  ctx.scale(0.6, 1); // the same u squeeze the pores get
  const face = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.15 * S);
  face.addColorStop(0, 'rgba(46,31,18,0.42)');
  face.addColorStop(1, 'rgba(46,31,18,0)');
  ctx.fillStyle = face;
  ctx.fillRect(-0.2 * S, -0.2 * S, 0.4 * S, 0.4 * S);
  ctx.restore();

  for (const { u, v, a } of EYES) {
    const x = u * S, y = v * S;
    const ry = (a / Math.PI) * S;
    const rx = ry / (2 * Math.sin(Math.PI * v));
    const pore = (k, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx * k, ry * k, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    pore(1.55, 'rgba(126,96,60,0.5)');   // callused ring around the pit
    pore(1.18, 'rgba(166,132,86,0.55)'); // raised pale lip
    pore(1.0, 'rgba(30,20,11,0.95)');    // the pit itself
    pore(0.55, 'rgba(12,8,4,0.95)');     // and its dark floor
    // a sliver of light on the lip's upper edge
    ctx.strokeStyle = 'rgba(214,182,132,0.4)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 1.1, ry * 1.1, 0, Math.PI * 0.9, Math.PI * 1.9);
    ctx.stroke();
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

// ---------------------------------------------------------------- rainbow arc
// A half-annulus of soft spectral bands on a transparent sheet, violet in,
// red out. One radial gradient draws the whole arc, so every edge stays soft;
// the canvas bottom cuts the feet off, which is where the sea will sit.
export function rainbowTexture() {
  const W = 512, H = 256;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H;
  const R = H * 0.88;
  const g = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
  g.addColorStop(0.00, 'rgba(255,255,255,0)');
  g.addColorStop(0.30, 'rgba(150,110,240,0.26)');
  g.addColorStop(0.42, 'rgba(90,150,250,0.4)');
  g.addColorStop(0.54, 'rgba(90,215,140,0.48)');
  g.addColorStop(0.66, 'rgba(250,235,110,0.55)');
  g.addColorStop(0.78, 'rgba(255,170,70,0.5)');
  g.addColorStop(0.90, 'rgba(255,90,80,0.42)');
  g.addColorStop(1.00, 'rgba(255,90,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const t = tex(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return track(t);
}
