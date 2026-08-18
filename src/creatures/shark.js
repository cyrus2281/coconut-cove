// The blacktip reef shark as an asset. Unlike the reef fish — spindles whose
// tails whip in the vertex shader — this one is lofted from superelliptic
// ribs swept along a travelling-wave spine that is flexed on the CPU, so the
// seven foil fins and the eyes can ride the moving frames instead of being
// welded into the hull. Nose +x, origin at mid-length, like every fish here.
// The hide is painted once and shared; the geometry is per animal, because
// each one carries its own pose. sealife.js drives the patrol; the
// /components page shows one alone.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { uwPatch } from '../world/underwater.js';

export const SHARK_LEN = 1.6;              // nose to tail tip, metres
const L = SHARK_LEN;
const NS = 190, NR = 48, RW = NR + 1;      // spine slices, girth ring
const IC = Math.round(0.855 * NS);         // past here the tail is a rigid block
const TC = IC / NS;

const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0),
  AX_Z = new THREE.Vector3(0, 0, 1);

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

// monotone cubic hermite through [[x,y],...]: profile curves that never
// overshoot between the stations they are given
function curve(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), n = xs.length, m = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) m[i] = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    else if (i === n - 1) m[i] = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    else m[i] = (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1]);
  }
  for (let i = 0; i < n - 1; i++) {
    const d = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    if (d === 0) { m[i] = 0; m[i + 1] = 0; } else {
      const a = m[i] / d, b = m[i + 1] / d, s = Math.hypot(a, b);
      if (s > 3) { m[i] = (3 * a / s) * d; m[i + 1] = (3 * b / s) * d; }
    }
  }
  return function (x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], s = (x - xs[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i]
      + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

// seeded value noise, period 256 on both axes so the girth wrap has no seam
const GN = 256, grid = new Float32Array(GN * GN);
{
  const rnd = mulberry32(7714);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
}
function nz(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const g = (a, b) => grid[((b & 255) << 8) + (a & 255)];
  const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
  const top = a + (b - a) * u;
  return top + ((c + (d - c) * u) - top) * v;
}
const fbm = (x, y) => 0.58 * nz(x, y) + 0.28 * nz(x * 2, y * 2) + 0.14 * nz(x * 4, y * 4);

// ------------------------------------------------------------- body profiles
// every value is a fraction of the total length
const halfW = curve([[0, 0.0006], [0.004, 0.011], [0.02, 0.026], [0.05, 0.047], [0.10, 0.062],
  [0.16, 0.072], [0.24, 0.079], [0.32, 0.080], [0.42, 0.074], [0.52, 0.063], [0.62, 0.050],
  [0.72, 0.038], [0.80, 0.028], [0.86, 0.019], [0.91, 0.011], [0.96, 0.0035], [1, 0.0006]]);
const halfH = curve([[0, 0.0006], [0.004, 0.009], [0.02, 0.020], [0.05, 0.037], [0.10, 0.056],
  [0.16, 0.074], [0.24, 0.089], [0.32, 0.092], [0.42, 0.086], [0.52, 0.075], [0.62, 0.061],
  [0.72, 0.047], [0.80, 0.035], [0.86, 0.026], [0.91, 0.018], [0.96, 0.007], [1, 0.0008]]);
// the spine's resting sag, and the sweep amplitude that grows toward the tail
const ycC = curve([[0, -0.014], [0.05, -0.005], [0.12, 0.001], [0.26, 0.006], [0.5, 0.005],
  [0.72, 0.002], [0.86, 0], [0.91, 0.016], [0.95, 0.040], [1, 0.078]]);
const ampC = curve([[0, 0.010], [0.12, 0.005], [0.28, 0.006], [0.45, 0.015], [0.62, 0.027],
  [0.78, 0.039], [1, 0.050]]);
// superellipse exponents: a keeled back over a rounder belly
const nTopC = curve([[0, 2.85], [0.12, 2.5], [0.3, 2.25], [0.7, 2.2], [1, 2.1]]);
const nBotC = curve([[0, 3.05], [0.12, 2.8], [0.3, 2.6], [0.7, 2.4], [1, 2.2]]);

// countershading boundary, as a circumferential position: 0 is the dorsal
// ridge, 0.5 the belly midline
const bnd = curve([[0, 0.295], [0.08, 0.315], [0.2, 0.355], [0.4, 0.385], [0.6, 0.40],
  [0.8, 0.415], [1, 0.445]]);

// ------------------------------------------------------------------- the hide
// The biggest skin in the cove (the reef fish get 512x256): countershaded
// bronze over cream with the pale flank band, five gill slits, the ampullae
// stippling the snout, and a denticle bump map under it all.
const SKIN_W = 512, SKIN_H = 1024;

function sharkSkin() {
  const W = SKIN_W, H = SKIN_H;
  const SK = W / 1024;                       // features were laid out against 1024
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  const cTop = [0x5f, 0x59, 0x4b], cMid = [0x92, 0x89, 0x74], cLow = [0xab, 0xa2, 0x8d];
  const cBrd = [0xd6, 0xce, 0xbe], cBel = [0xf1, 0xeb, 0xde], cBand = [0xf6, 0xf1, 0xe6];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  let o = 0;
  for (let py = 0; py < H; py++) {
    const v = py / (H - 1), b = bnd(v), bandC = b - 0.030;
    const bandAmp = (0.5 + 0.5 * smoothstep(0.10, 0.30, v)) * (1 - smoothstep(0.86, 1.0, v));
    for (let px = 0; px < W; px++) {
      const u = px / W, a = u <= 0.5 ? u : 1 - u;
      const n = fbm(u * 256, v * 512), nf = nz(u * W, v * H);
      const q = Math.min(1, a / b);
      let col = q < 0.62 ? mix(cTop, cMid, q / 0.62) : mix(cMid, cLow, (q - 0.62) / 0.38);
      const qb = clamp((a - b) / (0.5 - b), 0, 1);
      const ven = mix(cBrd, cBel, smoothstep(0, 0.55, qb));
      const m = smoothstep(b - 0.016, b + 0.010, a);
      col = mix(col, ven, m);
      const bi = Math.exp(-Math.pow((a - bandC) / 0.019, 2)) * bandAmp * 0.8;
      col = mix(col, cBand, clamp(bi, 0, 1));
      // mottle over the flank, denticle speckle everywhere
      const k = (1 + (n - 0.5) * 0.17 * (1 - m * 0.75)) * (1 + (nf - 0.5) * 0.055);
      d[o++] = clamp(col[0] * k, 0, 255);
      d[o++] = clamp(col[1] * k, 0, 255);
      d[o++] = clamp(col[2] * k, 0, 255);
      d[o++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // features are drawn once on the left flank, then mirrored across the girth
  const fx = document.createElement('canvas');
  fx.width = W; fx.height = H;
  const f = fx.getContext('2d');
  const rand = mulberry32(9021);
  f.lineCap = 'round';
  // five gill slits, each with a pale lip below it
  const gv = [0.208, 0.228, 0.247, 0.265, 0.282], gl = [1, 0.98, 0.94, 0.87, 0.79];
  for (let i = 0; i < 5; i++) {
    const y = gv[i] * H, a0 = 0.205, a1 = a0 + 0.088 * gl[i];
    f.beginPath();
    f.moveTo(a0 * W, y - 0.0018 * H);
    f.bezierCurveTo((a0 + 0.03) * W, y + 0.0016 * H, (a1 - 0.025) * W, y + 0.0048 * H, a1 * W, y + 0.0072 * H);
    f.strokeStyle = 'rgba(46,42,36,.8)'; f.lineWidth = 4.5 * SK; f.stroke();
    f.beginPath();
    f.moveTo(a0 * W, y + 0.0022 * H);
    f.bezierCurveTo((a0 + 0.03) * W, y + 0.0056 * H, (a1 - 0.025) * W, y + 0.0088 * H, a1 * W, y + 0.0112 * H);
    f.strokeStyle = 'rgba(226,219,203,.30)'; f.lineWidth = 3 * SK; f.stroke();
  }
  // socket shading under the eye ball
  f.save();
  f.translate(0.192 * W, 0.0755 * H); f.scale(1, 1.25);
  const eg = f.createRadialGradient(0, 0, 2 * SK, 0, 0, 0.019 * W);
  eg.addColorStop(0, 'rgba(38,34,29,.85)');
  eg.addColorStop(0.6, 'rgba(60,55,47,.35)');
  eg.addColorStop(1, 'rgba(60,55,47,0)');
  f.fillStyle = eg;
  f.beginPath(); f.arc(0, 0, 0.019 * W, 0, Math.PI * 2); f.fill();
  f.restore();
  // the mouth: a broad arch with its corners set well back
  f.beginPath();
  f.moveTo(0.500 * W, 0.1075 * H);
  f.bezierCurveTo(0.455 * W, 0.1090 * H, 0.400 * W, 0.1230 * H, 0.362 * W, 0.1425 * H);
  f.lineTo(0.372 * W, 0.1465 * H);
  f.bezierCurveTo(0.412 * W, 0.1290 * H, 0.462 * W, 0.1160 * H, 0.500 * W, 0.1145 * H);
  f.closePath();
  f.fillStyle = 'rgba(38,33,27,.92)'; f.fill();
  f.beginPath();
  f.moveTo(0.500 * W, 0.1062 * H);
  f.bezierCurveTo(0.455 * W, 0.1077 * H, 0.401 * W, 0.1216 * H, 0.364 * W, 0.1410 * H);
  f.strokeStyle = 'rgba(228,222,206,.35)'; f.lineWidth = 2.2 * SK; f.stroke();
  // labial furrow at the corner
  f.beginPath(); f.moveTo(0.366 * W, 0.1440 * H); f.lineTo(0.352 * W, 0.1508 * H);
  f.strokeStyle = 'rgba(70,63,54,.5)'; f.lineWidth = 2.5 * SK; f.stroke();
  // nostril
  f.beginPath();
  f.moveTo(0.418 * W, 0.0605 * H);
  f.quadraticCurveTo(0.437 * W, 0.0640 * H, 0.452 * W, 0.0620 * H);
  f.strokeStyle = 'rgba(44,39,33,.8)'; f.lineWidth = 4 * SK; f.stroke();
  // ampullae of Lorenzini, crowding the snout
  for (let i = 0; i < 520; i++) {
    const v = Math.pow(rand(), 1.35) * 0.19, a = rand() * 0.5;
    const w = Math.max(0.55, (0.6 + rand() * 1.4) * SK);
    f.fillStyle = `rgba(66,59,50,${0.10 + 0.22 * rand()})`;
    f.beginPath(); f.arc(a * W, v * H, w, 0, Math.PI * 2); f.fill();
  }
  // lateral line, riding just below the countershading break
  f.strokeStyle = 'rgba(96,89,77,.28)'; f.lineWidth = 2.2 * SK;
  f.beginPath();
  for (let i = 0; i <= 120; i++) {
    const v = 0.20 + 0.72 * i / 120, x = (bnd(v) - 0.062) * W, y = v * H;
    if (i === 0) f.moveTo(x, y); else f.lineTo(x, y);
  }
  f.stroke();
  // cloaca
  f.fillStyle = 'rgba(60,53,45,.55)';
  f.beginPath(); f.ellipse(0.487 * W, 0.618 * H, 0.006 * W, 0.004 * H, 0, 0, Math.PI * 2); f.fill();

  ctx.drawImage(fx, 0, 0);
  ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(fx, 0, 0); ctx.restore();

  // bump map: denticle grain with the same grooves pressed into it
  const bw = W >> 1, bh = H >> 1;
  const bcv = document.createElement('canvas');
  bcv.width = bw; bcv.height = bh;
  const bx = bcv.getContext('2d');
  const bimg = bx.createImageData(bw, bh), bd = bimg.data;
  let p = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const u = x / bw, v = y / bh;
      const g = 128 + (nz(u * bw * 2, v * bh * 2) - 0.5) * 74 + (fbm(u * 256, v * 512) - 0.5) * 26;
      bd[p++] = g; bd[p++] = g; bd[p++] = g; bd[p++] = 255;
    }
  }
  bx.putImageData(bimg, 0, 0);
  bx.globalAlpha = 0.55;
  bx.drawImage(fx, 0, 0, bw, bh);
  bx.save(); bx.translate(bw, 0); bx.scale(-1, 1); bx.drawImage(fx, 0, 0, bw, bh); bx.restore();

  const mk = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;                        // v runs nose -> tail down the canvas
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: mk(cv, true), bump: mk(bcv, false) };
}

// ---------------------------------------------------------------- materials
// Shared across every shark in the session (and never disposed by the
// components viewer, which is why its entry is marked shared).
let _mats = null;
function sharkMaterials() {
  if (_mats) return _mats;
  const { map, bump } = sharkSkin();
  _mats = {
    body: uwPatch(new THREE.MeshPhysicalMaterial({
      map, bumpMap: bump, bumpScale: 0.004,
      roughness: 0.52, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.55,
    }), 'shark'),
    fin: uwPatch(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0,
      clearcoat: 0.35, clearcoatRoughness: 0.6, side: THREE.DoubleSide,
    }), 'shark-fin'),
    eye: uwPatch(new THREE.MeshPhysicalMaterial({
      color: 0x0b0d10, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    }), 'shark-eye'),
    ring: uwPatch(new THREE.MeshStandardMaterial({ color: 0x9d9686, roughness: 0.65 }), 'shark-eyering'),
  };
  return _mats;
}

// ------------------------------------------------------------------ the fins
// Each fin is a lofted NACA-ish foil: leading and trailing edge, thickness
// and lateral offset given per span station, painted by vertex colour so the
// blacktip's ink-dipped apices come for free.
const COL = {
  top: new THREE.Color(0x8b8271), bot: new THREE.Color(0xb8b1a2),
  black: new THREE.Color(0x191b1e), white: new THREE.Color(0xefe9db),
  dark: new THREE.Color(0x494539), flank: new THREE.Color(0x9a9281),
};
const rawFoil = (c) => 0.2969 * Math.sqrt(c) - 0.1260 * c - 0.3516 * c * c
  + 0.2843 * c * c * c - 0.1015 * c * c * c * c;
const F1 = rawFoil(1);
let FMAX = 0;
for (let i = 0; i <= 200; i++) { const c = i / 200, v = rawFoil(c) - c * F1; if (v > FMAX) FMAX = v; }
const foil = (c) => (rawFoil(c) - c * F1) / FMAX;

const _tmpCol = new THREE.Color();
function finColor(sf, cf, up, spec) {
  _tmpCol.copy(up ? (spec.top || COL.top) : (spec.bot || COL.bot));
  if (spec.trailDark) _tmpCol.lerp(COL.dark, spec.trailDark * smoothstep(0.70, 1, cf));
  const tb = spec.tipBlack || 0, wb = spec.whiteBand || 0;
  const bl = tb > 0 ? smoothstep(1 - tb - 0.06, 1 - tb + 0.02, sf) : 0;
  if (wb > 0) _tmpCol.lerp(COL.white, smoothstep(1 - tb - wb - 0.07, 1 - tb - wb + 0.02, sf) * (1 - bl) * 0.9);
  if (bl > 0) _tmpCol.lerp(COL.black, bl);
  if (sf < 0.15) _tmpCol.lerp(COL.flank, 1 - smoothstep(0.02, 0.15, sf));
  return _tmpCol;
}

function finGeometry(spec, mirror) {
  const S = spec.stations;
  const cLe = curve(S.map((s) => [s.y, s.le])), cTe = curve(S.map((s) => [s.y, s.te]));
  const cTh = curve(S.map((s) => [s.y, s.th])), cOf = curve(S.map((s) => [s.y, s.off || 0]));
  const SP = spec.spanSeg || 26, CH = spec.chordSeg || 20, ring = CH * 2, ms = mirror ? -1 : 1;
  const ymax = S[S.length - 1].y;
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= SP; i++) {
    const sf = i / SP, y = ymax * sf;
    const le = cLe(y), te = cTe(y), th = Math.max(0, cTh(y)), of = cOf(y);
    for (let k = 0; k < ring; k++) {
      const kk = k <= CH ? k : ring - k, c = kk / CH, sg = k <= CH ? 1 : -1;
      const x = le + (te - le) * c, z = sg * th * foil(c) + of;
      pos.push(-x * L, y * L, ms * z * L);
      const cc = finColor(sf, c, sg > 0, spec);
      col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let i = 0; i < SP; i++) {
    for (let k = 0; k < ring; k++) {
      const k2 = (k + 1) % ring;
      const a = i * ring + k, b = (i + 1) * ring + k, c = (i + 1) * ring + k2, d = i * ring + k2;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// t is the spine station the fin roots at; ay/az lift it off the spine in
// fractions of the local half-height/half-width; roll/pitch/yaw are degrees
const FINS = [
  { name: 'dorsal1', t: 0.355, ay: 0.72, az: 0, tipBlack: 0.20, whiteBand: 0.13,
    stations: [{ y: 0, le: 0, te: 0.180, th: 0.017 }, { y: 0.020, le: 0.007, te: 0.166, th: 0.016 },
      { y: 0.050, le: 0.024, te: 0.146, th: 0.013 }, { y: 0.080, le: 0.047, te: 0.132, th: 0.0095 },
      { y: 0.110, le: 0.075, te: 0.124, th: 0.006 }, { y: 0.130, le: 0.098, te: 0.121, th: 0.0035 },
      { y: 0.145, le: 0.116, te: 0.119, th: 0 }] },
  { name: 'dorsal2', t: 0.715, ay: 0.75, az: 0, tipBlack: 0.26,
    stations: [{ y: 0, le: 0, te: 0.082, th: 0.010 }, { y: 0.018, le: 0.005, te: 0.074, th: 0.009 },
      { y: 0.038, le: 0.017, te: 0.064, th: 0.0065 }, { y: 0.058, le: 0.034, te: 0.058, th: 0.0035 },
      { y: 0.075, le: 0.052, te: 0.058, th: 0 }] },
  { name: 'pectoral', t: 0.245, ay: -0.42, az: 0.80, pair: true, roll: 104, yaw: -5, flutter: 0.045,
    tipBlack: 0.24, bot: new THREE.Color(0xcdc6b6),
    stations: [{ y: 0, le: 0, te: 0.125, th: 0.013, off: 0 }, { y: 0.040, le: 0.010, te: 0.104, th: 0.010, off: 0.001 },
      { y: 0.080, le: 0.026, te: 0.085, th: 0.0075, off: 0.003 }, { y: 0.120, le: 0.048, te: 0.073, th: 0.005, off: 0.007 },
      { y: 0.155, le: 0.076, te: 0.080, th: 0.003, off: 0.012 }, { y: 0.180, le: 0.102, te: 0.104, th: 0, off: 0.018 }] },
  { name: 'pelvic', t: 0.585, ay: -0.72, az: 0.42, pair: true, roll: 145, tipBlack: 0.28,
    bot: new THREE.Color(0xc9c2b2),
    stations: [{ y: 0, le: 0, te: 0.070, th: 0.008 }, { y: 0.020, le: 0.006, te: 0.062, th: 0.0065 },
      { y: 0.045, le: 0.020, te: 0.050, th: 0.004 }, { y: 0.062, le: 0.034, te: 0.044, th: 0.002 },
      { y: 0.072, le: 0.042, te: 0.044, th: 0 }] },
  { name: 'anal', t: 0.735, ay: -0.78, az: 0, roll: 180, tipBlack: 0.30,
    bot: new THREE.Color(0xc9c2b2),
    stations: [{ y: 0, le: 0, te: 0.075, th: 0.008 }, { y: 0.018, le: 0.006, te: 0.066, th: 0.0065 },
      { y: 0.038, le: 0.018, te: 0.052, th: 0.004 }, { y: 0.055, le: 0.032, te: 0.044, th: 0.002 },
      { y: 0.065, le: 0.040, te: 0.043, th: 0 }] },
  { name: 'caudalUpper', t: TC, ay: 0, az: 0, pitch: 27, tipBlack: 0.15, trailDark: 0.55, spanSeg: 30,
    stations: [{ y: 0, le: -0.022, te: 0.080, th: 0.016 }, { y: 0.030, le: -0.020, te: 0.078, th: 0.013 },
      { y: 0.065, le: -0.017, te: 0.072, th: 0.010 }, { y: 0.100, le: -0.013, te: 0.060, th: 0.0075 },
      { y: 0.130, le: -0.009, te: 0.040, th: 0.005 }, { y: 0.152, le: -0.005, te: 0.022, th: 0.0025 },
      { y: 0.165, le: 0, te: 0.006, th: 0 }] },
  { name: 'caudalLower', t: TC, ay: 0, az: 0, roll: 180, pitch: -33, tipBlack: 0.22, trailDark: 0.35,
    stations: [{ y: 0, le: 0, te: 0.062, th: 0.012 }, { y: 0.025, le: 0.005, te: 0.052, th: 0.009 },
      { y: 0.050, le: 0.013, te: 0.038, th: 0.006 }, { y: 0.072, le: 0.024, te: 0.028, th: 0.003 },
      { y: 0.088, le: 0.033, te: 0.030, th: 0 }] },
];

// ------------------------------------------------------------- shared arrays
// Cross-sections, uv/index layout, rest-pose normals and the rigid-tail
// bindings depend only on the profiles, so they are computed once. The
// position and normal buffers are not: those are per animal.
let _shared = null;

const _tmpV = new THREE.Vector3();
const TS = new Float32Array(NS + 1);
for (let i = 0; i <= NS; i++) TS[i] = i / NS;

function spineEval(t, ph, amp, out) {
  return out.set((0.5 - t) * L, ycC(t) * L,
    ampC(t) * L * amp * Math.sin(Math.PI * 2 * (1.05 * t - ph)));
}

// forward/up/side frames along the swimming spine (F points tailward)
function buildFrames(P, F, U, S, ph, amp) {
  for (let i = 0; i <= NS; i++) spineEval(TS[i], ph, amp, P[i]);
  for (let i = 0; i <= NS; i++) {
    _tmpV.copy(P[Math.min(NS, i + 1)]).sub(P[Math.max(0, i - 1)]);
    F[i].copy(_tmpV).multiplyScalar(-1).normalize();
    S[i].crossVectors(F[i], AX_Y);
    if (S[i].lengthSq() < 1e-9) S[i].set(0, 0, 1);
    S[i].normalize();
    U[i].crossVectors(S[i], F[i]).normalize();
  }
}

function writeBody(pa, na, P, F, U, S, secY, secZ, nLoc) {
  let o = 0;
  for (let i = 0; i <= NS; i++) {
    const p = P[i], u = U[i], s = S[i];
    for (let j = 0; j < RW; j++) {
      const k = i * RW + j, y = secY[k], z = secZ[k];
      pa[o] = p.x + u.x * y + s.x * z;
      pa[o + 1] = p.y + u.y * y + s.y * z;
      pa[o + 2] = p.z + u.z * y + s.z * z;
      if (na) {
        const f = F[i], a = nLoc[o], b = nLoc[o + 1], c = nLoc[o + 2];
        na[o] = f.x * a + u.x * b + s.x * c;
        na[o + 1] = f.y * a + u.y * b + s.y * c;
        na[o + 2] = f.z * a + u.z * b + s.z * c;
      }
      o += 3;
    }
  }
}

function sharedParts() {
  if (_shared) return _shared;
  const V = (NS + 1) * RW;

  // superelliptic ribs in local (up, side) coordinates
  const secY = new Float32Array(V), secZ = new Float32Array(V);
  for (let i = 0; i <= NS; i++) {
    const t = TS[i], w = halfW(t) * L, h = halfH(t) * L, nT = nTopC(t), nB = nBotC(t);
    for (let j = 0; j < RW; j++) {
      const th = (j / NR) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const e = 2 / (c >= 0 ? nT : nB), k = i * RW + j;
      secY[k] = h * Math.sign(c) * Math.pow(Math.abs(c), e);
      secZ[k] = w * Math.sign(s) * Math.pow(Math.abs(s), e);
    }
  }

  // u wraps the girth (0 = dorsal ridge), v runs nose to tail
  const uv = new Float32Array(V * 2);
  for (let i = 0; i <= NS; i++) {
    for (let j = 0; j < RW; j++) { const k = (i * RW + j) * 2; uv[k] = j / NR; uv[k + 1] = TS[i]; }
  }
  const index = new Uint32Array(NS * NR * 6);
  let ii = 0;
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * RW + j, b = (i + 1) * RW + j, c = (i + 1) * RW + j + 1, d = i * RW + j + 1;
      index[ii++] = a; index[ii++] = b; index[ii++] = c;
      index[ii++] = a; index[ii++] = c; index[ii++] = d;
    }
  }

  // the straight rest pose, once: its smooth normals are then decomposed into
  // each rib's own frame, so a flexed spine can rebuild them by hand
  const restP = [], restF = [], restU = [], restS = [];
  for (let i = 0; i <= NS; i++) {
    restP.push(new THREE.Vector3()); restF.push(new THREE.Vector3());
    restU.push(new THREE.Vector3()); restS.push(new THREE.Vector3());
  }
  buildFrames(restP, restF, restU, restS, 0, 0);
  const restPos = new Float32Array(V * 3);
  writeBody(restPos, null, restP, restF, restU, restS, secY, secZ, null);
  const probe = new THREE.BufferGeometry();
  probe.setAttribute('position', new THREE.BufferAttribute(restPos, 3));
  probe.setIndex(new THREE.BufferAttribute(index.slice(), 1));
  probe.computeVertexNormals();
  const nSmooth = probe.attributes.normal.array;
  const nLoc = new Float32Array(V * 3);
  for (let i = 0; i <= NS; i++) {
    const F = restF[i], U = restU[i], S = restS[i];
    for (let j = 0; j < RW; j++) {
      const o = (i * RW + j) * 3, x = nSmooth[o], y = nSmooth[o + 1], z = nSmooth[o + 2];
      nLoc[o] = x * F.x + y * F.y + z * F.z;
      nLoc[o + 1] = x * U.x + y * U.y + z * U.z;
      nLoc[o + 2] = x * S.x + y * S.y + z * S.z;
    }
  }

  // the tail block past IC keeps its shape and swings on that one frame
  const rel = new Array(NS + 1).fill(null);
  {
    const F = restF[IC], U = restU[IC], S = restS[IC], org = restP[IC];
    const dec = (v) => ({ a: v.dot(F), b: v.dot(U), c: v.dot(S) });
    for (let i = IC + 1; i <= NS; i++) {
      const d = new THREE.Vector3().subVectors(restP[i], org);
      rel[i] = { p: dec(d), f: dec(restF[i]), u: dec(restU[i]), s: dec(restS[i]) };
    }
  }

  _shared = { V, secY, secZ, uv, index, nLoc, rel };
  return _shared;
}

// ------------------------------------------------------------------- the rig
// Returns the shark in its own space (nose +x, mid-length at the origin) plus
// the flex driver. `beat` is the tail-beat phase in cycles; `amp` scales the
// sweep, so a gliding shark barely moves and a bursting one throws its tail.
export function buildShark() {
  const { V, secY, secZ, uv, index, nLoc, rel } = sharedParts();
  const mats = sharkMaterials();
  const group = new THREE.Group();
  group.name = 'blacktip';

  const posArr = new Float32Array(V * 3), nrmArr = new Float32Array(V * 3);
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  bodyGeo.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3));
  bodyGeo.setAttribute('uv', new THREE.BufferAttribute(uv.slice(), 2));
  bodyGeo.setIndex(new THREE.BufferAttribute(index.slice(), 1));
  // the hull is rewritten every frame, so pin a bound generous enough to
  // cover any pose instead of letting three recompute one from stale vertices
  bodyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), L * 0.62);
  const bodyMesh = new THREE.Mesh(bodyGeo, mats.body);
  group.add(bodyMesh);

  const P = [], F = [], U = [], S = [];
  for (let i = 0; i <= NS; i++) {
    P.push(new THREE.Vector3()); F.push(new THREE.Vector3());
    U.push(new THREE.Vector3()); S.push(new THREE.Vector3());
  }

  const finObjs = [];
  for (const spec of FINS) {
    for (const sd of spec.pair ? [1, -1] : [0]) {
      const mesh = new THREE.Mesh(finGeometry(spec, sd < 0), mats.fin);
      group.add(mesh);
      const sgn = sd < 0 ? -1 : 1, rad = Math.PI / 180;
      const q = new THREE.Quaternion()
        .setFromAxisAngle(AX_Y, (spec.yaw || 0) * rad * sgn)
        .multiply(new THREE.Quaternion().setFromAxisAngle(AX_Z, (spec.pitch || 0) * rad))
        .multiply(new THREE.Quaternion().setFromAxisAngle(AX_X, (spec.roll || 0) * rad * sgn));
      finObjs.push({
        mesh, i: Math.round(spec.t * NS), q,
        ay: (spec.ay || 0) * halfH(spec.t) * L,
        az: (spec.az || 0) * (sd === 0 ? 1 : sgn) * halfW(spec.t) * L,
        flutter: spec.flutter || 0, ph: sd < 0 ? Math.PI * 0.15 : 0,
      });
    }
  }

  // the eyes: a lacquered ball behind a pale iris ring, set on the cheek
  const eyeObjs = [];
  {
    const et = 0.075, ei = Math.round(et * NS);
    const ballGeo = new THREE.SphereGeometry(0.0105 * L, 24, 18);
    const ringGeo = new THREE.TorusGeometry(0.0122 * L, 0.0022 * L, 10, 28);
    for (const sd of [1, -1]) {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(sd > 0 ? ballGeo : ballGeo.clone(), mats.eye);
      ball.scale.set(1, 1.06, 0.82);
      g.add(ball);
      const ring = new THREE.Mesh(sd > 0 ? ringGeo : ringGeo.clone(), mats.ring);
      ring.position.z = sd * 0.0016 * L;
      g.add(ring);
      group.add(g);
      eyeObjs.push({
        g, i: ei,
        ay: 0.34 * halfH(et) * L,
        az: sd * 0.95 * halfW(et) * L,
      });
    }
  }

  const mB = new THREE.Matrix4(), qB = new THREE.Quaternion(),
    qX = new THREE.Quaternion(), vP = new THREE.Vector3();

  function update(beat, amp = 1) {
    buildFrames(P, F, U, S, beat, amp);
    // swing the rigid tail block off the peduncle frame
    const f0 = F[IC], u0 = U[IC], s0 = S[IC], p0 = P[IC];
    for (let i = IC + 1; i <= NS; i++) {
      const r = rel[i];
      P[i].copy(p0).addScaledVector(f0, r.p.a).addScaledVector(u0, r.p.b).addScaledVector(s0, r.p.c);
      F[i].set(0, 0, 0).addScaledVector(f0, r.f.a).addScaledVector(u0, r.f.b).addScaledVector(s0, r.f.c);
      U[i].set(0, 0, 0).addScaledVector(f0, r.u.a).addScaledVector(u0, r.u.b).addScaledVector(s0, r.u.c);
      S[i].set(0, 0, 0).addScaledVector(f0, r.s.a).addScaledVector(u0, r.s.b).addScaledVector(s0, r.s.c);
    }
    writeBody(posArr, nrmArr, P, F, U, S, secY, secZ, nLoc);
    bodyGeo.attributes.position.needsUpdate = true;
    bodyGeo.attributes.normal.needsUpdate = true;

    for (const fo of finObjs) {
      const i = fo.i;
      vP.copy(P[i]).addScaledVector(U[i], fo.ay).addScaledVector(S[i], fo.az);
      fo.mesh.position.copy(vP);
      mB.makeBasis(F[i], U[i], S[i]);
      qB.setFromRotationMatrix(mB);
      fo.mesh.quaternion.copy(qB).multiply(fo.q);
      if (fo.flutter) {
        qX.setFromAxisAngle(AX_X, Math.sin(beat * Math.PI * 2 + fo.ph) * fo.flutter);
        fo.mesh.quaternion.multiply(qX);
      }
    }
    for (const eo of eyeObjs) {
      const i = eo.i;
      vP.copy(P[i]).addScaledVector(U[i], eo.ay).addScaledVector(S[i], eo.az);
      eo.g.position.copy(vP);
      mB.makeBasis(F[i], U[i], S[i]);
      eo.g.quaternion.setFromRotationMatrix(mB);
    }
  }

  update(0, 1);
  // How far the animal reaches above and below its spine in the rest pose, in
  // metres at scale 1. The brains hold their swimming height between the sea
  // surface and the sand (see world/swim.js), and a shark's position is its
  // spine, not its back or its belly, so they need this to know what to spare.
  // Measured, not written down, so it follows the fins if the profiles change.
  const box = new THREE.Box3().setFromObject(group);
  const extent = { up: box.max.y, down: -box.min.y };
  bodyGeo.boundingBox = null; // measured off the rest pose: do not let it cache
  return { group, update, extent };
}
