// The herring gull as an asset: a swept superelliptical body loft under a
// painted mantle, a yellow bill with the red gonys spot, ten primaries and
// sixteen secondaries grown feather by feather with banded vanes, twelve
// rectrices, two-bone wings that morph between spread and folded, a spine of
// bones so the neck can nod and bob, and articulated webbed legs that stand,
// stride and tuck. gull.js owns the animation set — fly, glide, flap, ground
// and walk; birds.js picks the clip that fits the behaviour and the
// /components viewer picks it from buttons.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

// --------------------------------------------------------------- helpers
const D = Math.PI / 180;
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const clamp = THREE.MathUtils.clamp;
const sstep = THREE.MathUtils.smoothstep;   // (x, min, max)
const lerp = THREE.MathUtils.lerp;

// monotone cubic through the control points: profiles that never overshoot
// between the numbers they were given, so a width curve can never go negative
function curve(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const n = xs.length, m = new Array(n);
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

// value noise on a seeded 256x256 lattice — the same grain every session
const GRID = new Float32Array(65536);
{
  const r = mulberry32(0x9e3779b1);
  for (let i = 0; i < GRID.length; i++) GRID[i] = r();
}
function nz(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const g = (a, b) => GRID[((b & 255) << 8) + (a & 255)];
  const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
  const t1 = a + (b - a) * u, t2 = c + (d - c) * u;
  return t1 + (t2 - t1) * v;
}
const fbm = (x, y) => 0.55 * nz(x, y) + 0.28 * nz(x * 2, y * 2) + 0.17 * nz(x * 4, y * 4);

// plumage palette (colour management linearises these on construction, so
// they drop straight into vertex colours)
const PAL = {
  grey: new THREE.Color(0xa7b2bb), greyDk: new THREE.Color(0x93a0aa),
  white: new THREE.Color(0xf7f8f6), offWhite: new THREE.Color(0xe9edec),
  black: new THREE.Color(0x24272b), coalDk: new THREE.Color(0x35393e),
  bill: new THREE.Color(0xe9b422), billHot: new THREE.Color(0xf2c93c),
  billDark: new THREE.Color(0xa07d10), red: new THREE.Color(0xd2381a),
  leg: new THREE.Color(0xe9a9a4), legDk: new THREE.Color(0xc98c88),
};

// sample a [position, colour] ramp along a feather
function bandColor(stops, s, out) {
  if (s <= stops[0][0]) return out.copy(stops[0][1]);
  const n = stops.length;
  if (s >= stops[n - 1][0]) return out.copy(stops[n - 1][1]);
  let i = 0;
  while (i < n - 2 && s > stops[i + 1][0]) i++;
  const k = (s - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
  return out.copy(stops[i][1]).lerp(stops[i + 1][1], k);
}

// ---------------------------------------------------------------- skins
// one vane: barbs running out from a pale shaft, with the odd split where
// the barbs part. Greyscale — the band colours come from vertex colour.
function featherTexture() {
  const W = 160, H = 384;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  let o = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H, dd = Math.abs(u - 0.5) * 2;
      let val = 0.945 + 0.055 * Math.cos(Math.PI * 2 * (v * 62 + dd * 9.5));
      val *= 1 - 0.09 * Math.pow(dd, 3);
      const split = Math.pow(Math.max(0, Math.sin(Math.PI * 2 * (v * 6.3 + 0.21))), 14);
      val *= 1 - 0.13 * split * dd;
      if (dd < 0.05) val = val * 1.05 + 0.03;
      val *= 0.985 + 0.03 * nz(u * 160, v * 384);
      const g = clamp(val * 255, 0, 255);
      d[o++] = g; d[o++] = g; d[o++] = g; d[o++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.flipY = false;
  return t;
}

// the body: snow-white below, the silver mantle saddle across the back, rows
// of scalloped contour feathering over it, and a soft eye shadow. u wraps the
// girth (0 = spine), v runs bill (0) to tail (1).
function bodyTexture() {
  const W = 384, H = 576;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  const mantle = curve([[0, 0], [0.36, 0], [0.44, 0.10], [0.54, 0.22], [0.66, 0.26],
    [0.82, 0.23], [0.92, 0.10], [1, 0]]);
  const wh = [246, 247, 244], gy = [168, 178, 187];
  let o = 0;
  let n = 0, nf = 0;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1), mb = mantle(v);
    for (let x = 0; x < W; x++) {
      const u = x / W, a = u <= 0.5 ? u : 1 - u;
      // the grain is a few percent either way, so one sample per 2x2 block
      // is indistinguishable and halves the cost of painting the skin
      if ((x & 1) === 0) { n = fbm(u * 256, v * 512); nf = nz(u * 512, v * 768); }
      const m = mb > 0 ? 1 - sstep(a, mb - 0.055, mb + 0.02) : 0;
      const k = (1 + (n - 0.5) * 0.055) * (1 + (nf - 0.5) * 0.05);
      d[o++] = clamp((wh[0] + (gy[0] - wh[0]) * m) * k, 0, 255);
      d[o++] = clamp((wh[1] + (gy[1] - wh[1]) * m) * k, 0, 255);
      d[o++] = clamp((wh[2] + (gy[2] - wh[2]) * m) * k, 0, 255);
      d[o++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // contour-feather scalloping over the mantle
  ctx.lineWidth = 1.2;
  for (let row = 0; row < 40; row++) {
    const v = 0.30 + row * 0.0165, off = (row % 2) * 0.5;
    ctx.strokeStyle = 'rgba(40,60,72,' + (0.030 + 0.030 * sstep(v, 0.3, 0.7)) + ')';
    for (let k = 0; k < 24; k++) {
      const u = (k + off) / 24;
      ctx.beginPath();
      ctx.arc(u * W, v * H - 0.010 * H, 0.019 * W, 0.30 * Math.PI, 0.70 * Math.PI);
      ctx.stroke();
    }
  }
  // head detail painted on one flank, then mirrored across the girth seam
  const fx = document.createElement('canvas');
  fx.width = W; fx.height = H;
  const f = fx.getContext('2d');
  f.save();
  f.translate(0.203 * W, 0.112 * H);
  f.scale(1, 1.15);
  const eg = f.createRadialGradient(0, 0, 1, 0, 0, 0.030 * W);
  eg.addColorStop(0, 'rgba(70,86,96,.35)');
  eg.addColorStop(0.55, 'rgba(70,86,96,.10)');
  eg.addColorStop(1, 'rgba(70,86,96,0)');
  f.fillStyle = eg;
  f.beginPath();
  f.arc(0, 0, 0.030 * W, 0, Math.PI * 2);
  f.fill();
  f.restore();
  f.beginPath();
  f.moveTo(0.298 * W, 0.030 * H);
  f.quadraticCurveTo(0.315 * W, 0.044 * H, 0.322 * W, 0.062 * H);
  f.strokeStyle = 'rgba(60,72,80,.30)';
  f.lineWidth = 2.0;
  f.stroke();
  ctx.drawImage(fx, 0, 0);
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(fx, 0, 0);
  ctx.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

// -------------------------------------------------------------- body loft
// sweep a superelliptical rib along a plane spine curve. nT/nB are the
// squareness exponents above and below the spine, so the back can be rounder
// than the keel.
function sweptBody(o) {
  const NS = o.NS, NR = o.NR, RW = NR + 1;
  const pos = [], uvs = [], cols = [], idx = [], frames = [], P = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    P.push(new THREE.Vector3(o.px(t), o.py(t), 0));
  }
  for (let i = 0; i <= NS; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(NS, i + 1)];
    // the spine runs nose-first, so the frame's forward axis looks aft
    const F = new THREE.Vector3().subVectors(b, a).multiplyScalar(-1).normalize();
    const S = new THREE.Vector3().crossVectors(F, AX_Y).normalize();
    const U = new THREE.Vector3().crossVectors(S, F).normalize();
    frames.push({ p: P[i], F, U, S });
  }
  const tc = new THREE.Color();
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, fr = frames[i];
    const w = o.hw(t), hu = o.hUp(t), hl = o.hLo ? o.hLo(t) : hu;
    const nT = o.nT(t), nB = o.nB(t);
    for (let j = 0; j < RW; j++) {
      const th = (j / NR) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const e = 2 / (c >= 0 ? nT : nB), h = c >= 0 ? hu : hl;
      const ly = h * Math.sign(c) * Math.pow(Math.abs(c), e);
      const lz = w * Math.sign(s) * Math.pow(Math.abs(s), e);
      pos.push(fr.p.x + fr.U.x * ly + fr.S.x * lz,
        fr.p.y + fr.U.y * ly + fr.S.y * lz,
        fr.p.z + fr.U.z * ly + fr.S.z * lz);
      if (o.uv) uvs.push(j / NR, t);
      if (o.color) { o.color(t, th, tc); cols.push(tc.r, tc.g, tc.b); }
    }
  }
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * RW + j, b = (i + 1) * RW + j, c = (i + 1) * RW + j + 1, dd = i * RW + j + 1;
      idx.push(a, b, c, a, c, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (o.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (o.color) g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geom: g, frames };
}

// body spine and girth. t0 = bill base, t1 = tail root.
const NS_BODY = 110, NR_BODY = 28;
const bodyX = curve([[0, 0.250], [0.05, 0.240], [0.12, 0.222], [0.20, 0.200], [0.30, 0.172],
  [0.40, 0.135], [0.52, 0.078], [0.64, 0.010], [0.76, -0.060], [0.88, -0.125], [1, -0.180]]);
const bodyY = curve([[0, 0.088], [0.05, 0.090], [0.12, 0.086], [0.20, 0.073], [0.30, 0.052],
  [0.40, 0.032], [0.52, 0.014], [0.64, 0.004], [0.76, 0.002], [0.88, 0.008], [1, 0.020]]);
const bodyW = curve([[0, 0.010], [0.03, 0.017], [0.08, 0.026], [0.14, 0.032], [0.20, 0.032],
  [0.27, 0.028], [0.34, 0.030], [0.42, 0.038], [0.52, 0.050], [0.62, 0.058], [0.72, 0.056],
  [0.82, 0.046], [0.90, 0.034], [0.96, 0.020], [1, 0.009]]);
const bodyH = curve([[0, 0.011], [0.03, 0.018], [0.08, 0.028], [0.14, 0.034], [0.20, 0.034],
  [0.27, 0.032], [0.34, 0.036], [0.42, 0.046], [0.52, 0.058], [0.62, 0.066], [0.72, 0.062],
  [0.82, 0.052], [0.90, 0.040], [0.96, 0.026], [1, 0.013]]);
const bodyNT = curve([[0, 2.0], [0.2, 2.05], [0.5, 2.15], [1, 2.2]]);
const bodyNB = curve([[0, 2.0], [0.2, 2.1], [0.5, 2.25], [1, 2.3]]);

// where along the spine a given nose-tail station sits (bodyX is monotone)
function tAtX(x) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (bodyX(m) > x) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
// the flank's half-width at a station and height — solves the superellipse,
// so folded feathers can be laid just clear of the body instead of inside it
function flankZ(x, y) {
  if (x > bodyX(0) || x < bodyX(1)) return 0;
  const t = tAtX(x);
  const py = bodyY(t), hw = bodyW(t), h = bodyH(t);
  const n = y >= py ? bodyNT(t) : bodyNB(t);
  const c = Math.min(Math.abs(y - py) / Math.max(h, 1e-5), 1);
  return hw * Math.pow(Math.max(0, 1 - Math.pow(c, n)), 1 / n);
}
// the clearance a feather needs: the widest the flank gets under its length
function clearZ(x0, y0, dx, dy, len, clear) {
  let z = 0;
  for (let i = 0; i <= 6; i++) {
    const s = (i / 6) * len;
    z = Math.max(z, flankZ(x0 + dx * s, y0 + dy * s));
  }
  return z + clear;
}

// ---------------------------------------------------------------- vanes
const rawFoil = (c) => 0.2969 * Math.sqrt(c) - 0.1260 * c - 0.3516 * c * c
  + 0.2843 * c * c * c - 0.1015 * c * c * c * c;
const FO1 = rawFoil(1);
let FOMAX = 0;
for (let i = 0; i <= 200; i++) {
  const v = rawFoil(i / 200) - (i / 200) * FO1;
  if (v > FOMAX) FOMAX = v;
}
const foil = (c) => (rawFoil(c) - c * FO1) / FOMAX;

function Acc() { return { p: [], c: [], u: [], i: [], n: 0 }; }
function accToGeom(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.c, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.u, 2));
  g.setIndex(a.i);
  g.computeVertexNormals();
  return g;
}

const _v = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const NC = 5, MID = 2;           // columns across a vane; MID is the shaft
// one feather: a cambered blade with a leading and trailing vane width
// profile, drooped and bent along its length, skinned top and bottom so the
// underside can be paler. f: {len, wl, wt, droop, bend, camber, stops, pale, seg}
function emitFeather(acc, f, mat) {
  const SG = f.seg || 8;
  const start = acc.n;
  for (let skin = 0; skin < 2; skin++) {
    const sgn = skin === 0 ? 1 : -1;
    for (let i = 0; i <= SG; i++) {
      const s = i / SG;
      const wl = f.wl(s) * f.len, wt = f.wt(s) * f.len;
      const rx = f.len * s;
      const ry = f.len * (f.droop || 0) * Math.pow(s, 1.6);
      const rz = f.len * (f.bend || 0) * s * s;
      bandColor(f.stops, s, _c);
      _c2.copy(_c).lerp(PAL.white, f.pale ?? 0.5);
      for (let k = 0; k < NC; k++) {
        let across, fr;
        if (k <= MID) { fr = (MID - k) / MID; across = -wl * fr; } else { fr = (k - MID) / MID; across = wt * fr; }
        const cy = -(f.camber ?? 0.10) * Math.abs(across) * fr;
        _v.set(rx, ry + cy + sgn * 0.00035, rz + across);
        _v.applyMatrix4(mat);
        acc.p.push(_v.x, _v.y, _v.z);
        acc.u.push(k / (NC - 1), s);
        const cc = skin === 0 ? _c : _c2;
        acc.c.push(cc.r, cc.g, cc.b);
      }
    }
  }
  const per = (SG + 1) * NC;
  for (let skin = 0; skin < 2; skin++) {
    const b0 = start + skin * per;
    for (let i = 0; i < SG; i++) {
      for (let k = 0; k < NC - 1; k++) {
        const a = b0 + i * NC + k, b = b0 + (i + 1) * NC + k;
        const c = b0 + (i + 1) * NC + k + 1, d = b0 + i * NC + k + 1;
        if (skin === 0) acc.i.push(a, c, b, a, d, c); else acc.i.push(a, b, c, a, c, d);
      }
    }
  }
  acc.n += per * 2;
}

// the wing's arm and hand as a thin aerofoil spar: span along +x, chord along
// z. The barb texture is sampled off-shaft so the skin reads as feathered.
const LOFT_CH = 8, LOFT_N = 12;
function emitLoft(acc, stations, cTop, cBot) {
  const ring = LOFT_CH * 2, start = acc.n;
  const cle = curve(stations.map((s) => [s.x, s.le]));
  const cte = curve(stations.map((s) => [s.x, s.te]));
  const cth = curve(stations.map((s) => [s.x, s.th]));
  const cy = curve(stations.map((s) => [s.x, s.y || 0]));
  const x0 = stations[0].x, x1 = stations[stations.length - 1].x;
  const tc = new THREE.Color();
  for (let i = 0; i <= LOFT_N; i++) {
    const x = x0 + (x1 - x0) * (i / LOFT_N);
    const le = cle(x), te = cte(x), th = cth(x), yo = cy(x);
    for (let k = 0; k < ring; k++) {
      const kk = k <= LOFT_CH ? k : ring - k, c = kk / LOFT_CH, sg = k <= LOFT_CH ? 1 : -1;
      acc.p.push(x, yo + (sg > 0 ? 0.62 : -0.38) * th * foil(c), le + (te - le) * c);
      acc.u.push(0.86 + 0.06 * c, (x - x0) / (x1 - x0));
      tc.copy(sg > 0 ? cTop : cBot);
      if (c < 0.16) tc.lerp(sg > 0 ? cBot : cTop, (1 - c / 0.16) * 0.35);
      acc.c.push(tc.r, tc.g, tc.b);
    }
  }
  for (let i = 0; i < LOFT_N; i++) {
    for (let k = 0; k < ring; k++) {
      const k2 = (k + 1) % ring;
      const a = start + i * ring + k, b = start + (i + 1) * ring + k;
      const c = start + (i + 1) * ring + k2, d = start + i * ring + k2;
      acc.i.push(a, b, c, a, c, d);
    }
  }
  acc.n += (LOFT_N + 1) * ring;
}

// vane width profiles: leading web, trailing web
const W_PRIM_L = curve([[0, 0], [0.10, 0.026], [0.25, 0.032], [0.58, 0.032], [0.70, 0.021], [0.88, 0.014], [1, 0]]);
const W_PRIM_T = curve([[0, 0], [0.10, 0.055], [0.35, 0.080], [0.62, 0.074], [0.85, 0.046], [1, 0]]);
const W_SEC_L = curve([[0, 0], [0.12, 0.10], [0.35, 0.135], [0.75, 0.125], [0.92, 0.07], [1, 0]]);
const W_SEC_T = curve([[0, 0], [0.12, 0.14], [0.38, 0.195], [0.78, 0.175], [0.93, 0.09], [1, 0]]);
const W_COV_L = curve([[0, 0], [0.18, 0.16], [0.5, 0.20], [0.85, 0.14], [1, 0]]);
const W_COV_T = curve([[0, 0], [0.18, 0.20], [0.5, 0.25], [0.85, 0.17], [1, 0]]);
const W_TAIL_L = curve([[0, 0], [0.12, 0.075], [0.4, 0.095], [0.85, 0.092], [1, 0]]);
const W_TAIL_T = curve([[0, 0], [0.12, 0.085], [0.4, 0.105], [0.85, 0.10], [1, 0]]);

// band patterns. G grey, B black, W white, OW off-white.
const G = PAL.grey, GD = PAL.greyDk, B = PAL.black, W = PAL.white, OW = PAL.offWhite;
// i: 0 = P1 innermost .. 9 = P10 outermost. The outer two carry white mirrors
// inside the black tip, the inner ones only a pale fringe.
function primStops(i) {
  if (i === 9) return [[0, G], [0.24, G], [0.34, B], [0.79, B], [0.815, W], [0.90, W], [0.925, B], [0.965, B], [0.982, W], [1, W]];
  if (i === 8) return [[0, G], [0.30, G], [0.40, B], [0.855, B], [0.875, W], [0.915, W], [0.935, B], [0.972, B], [0.986, W], [1, W]];
  if (i >= 5) return [[0, G], [0.36 + 0.03 * (8 - i), G], [0.48 + 0.03 * (8 - i), B], [0.955, B], [0.972, W], [1, W]];
  return [[0, G], [0.62 + 0.04 * (4 - i), G], [0.74 + 0.04 * (4 - i), B], [0.93, B], [0.955, W], [1, W]];
}
const SEC_ST = [[0, G], [0.88, G], [0.945, OW], [0.975, W], [1, W]];
const TER_ST = [[0, G], [0.80, G], [0.90, OW], [0.94, W], [1, W]];
const GC_ST = [[0, G], [0.90, G], [0.97, OW], [1, W]];
const MC_ST = [[0, GD], [0.93, GD], [0.99, G], [1, G]];
const PC_ST = [[0, GD], [0.55, GD], [0.75, PAL.coalDk], [0.94, PAL.coalDk], [0.98, OW], [1, W]];
const AL_ST = [[0, GD], [0.7, PAL.coalDk], [0.95, PAL.coalDk], [1, OW]];
const TAIL_ST = [[0, OW], [0.16, W], [1, W]];
const SCAP_ST = [[0, G], [0.86, G], [0.95, OW], [1, W]];

// ----------------------------------------------------------------- wings
const WING_ROOT = new THREE.Vector3(0.055, 0.036, 0.047);
const ARM_LEN = 0.220;
// the pose the bones hold when the wing is shut. The arm telescopes as it
// folds (one rigid bone standing in for humerus plus forearm), which lands
// the wrist just behind the flank where the primary bundle starts.
const FOLD_SH = { flap: -0.05, sweep: -1.50, twist: -0.12 };
const FOLD_WR = { flap: 0.00, sweep: -0.06, twist: -0.06 };
const FOLD_WRIST_K = 0.52;

const ARM_ST = [{ x: -0.030, le: -0.028, te: 0.062, th: 0.032, y: -0.002 },
  { x: 0.020, le: -0.032, te: 0.048, th: 0.028, y: 0.002 },
  { x: 0.080, le: -0.030, te: 0.033, th: 0.021, y: 0.003 },
  { x: 0.150, le: -0.026, te: 0.026, th: 0.015, y: 0.002 },
  { x: 0.220, le: -0.019, te: 0.019, th: 0.0095, y: 0 }];
const HAND_ST = [{ x: -0.018, le: -0.021, te: 0.021, th: 0.011, y: 0 },
  { x: 0.045, le: -0.020, te: 0.017, th: 0.0088, y: 0.001 },
  { x: 0.105, le: -0.015, te: 0.012, th: 0.0062, y: 0.001 },
  { x: 0.150, le: -0.009, te: 0.006, th: 0.0038, y: 0 },
  { x: 0.168, le: -0.004, te: 0.002, th: 0.0016, y: 0 }];
// shut, the spars shrink to slivers and pull in against the ribs, where the
// covert stack and the flank hide them completely
const ARM_ST_FOLD = [{ x: 0.000, le: 0.030, te: 0.042, th: 0.009, y: 0.000 },
  { x: 0.030, le: 0.030, te: 0.041, th: 0.008, y: -0.003 },
  { x: 0.060, le: 0.031, te: 0.040, th: 0.007, y: -0.006 },
  { x: 0.090, le: 0.032, te: 0.039, th: 0.006, y: -0.008 },
  { x: 0.110, le: 0.033, te: 0.038, th: 0.005, y: -0.010 }];
const HAND_ST_FOLD = [{ x: -0.006, le: 0.030, te: 0.042, th: 0.008, y: 0.000 },
  { x: 0.014, le: 0.030, te: 0.041, th: 0.007, y: -0.002 },
  { x: 0.030, le: 0.031, te: 0.040, th: 0.006, y: -0.004 },
  { x: 0.046, le: 0.032, te: 0.039, th: 0.004, y: -0.006 },
  { x: 0.058, le: 0.033, te: 0.038, th: 0.003, y: -0.008 }];

// P1 sits on the wrist pivot itself: any gap between the last secondary and
// the first primary would open and shut as the hand flexed
const P_X = [0.000, 0.017, 0.035, 0.052, 0.069, 0.086, 0.104, 0.121, 0.139, 0.156];
const P_SW = [76, 72, 68, 63, 58, 52, 46, 41, 36, 32];
const P_LEN = [0.170, 0.176, 0.183, 0.192, 0.203, 0.217, 0.236, 0.256, 0.274, 0.286];

// spread: place a feather in the wing group's own frame, swept back from the
// spar and rolled a few degrees out of the wing plane
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
function spread(x, y, z, sweep, roll) {
  _e.set(roll * D, -sweep * D, 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  return _m.compose(_p, _q, ONE);
}
// shut: place a feather in body space — aft at yaw 0, tip lifted by pitch,
// vane rolled toward vertical — then pull it back into the group's frame.
// z comes from the flank profile so the stack lies just clear of the body.
const _mb = new THREE.Matrix4();
function shut(inv, x, y, len, yaw, pitch, roll, clear) {
  const dx = -Math.cos(pitch * D) * Math.cos(yaw * D), dy = Math.sin(pitch * D);
  const z = clearZ(x, y, dx, dy, len, clear);
  _e.set(roll * D, Math.PI + yaw * D, pitch * D, 'YZX');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _mb.compose(_p, _q, ONE);
  return _m.multiplyMatrices(inv, _mb);
}

function boneQuat(flap, sweep, twist, ms, out) {
  const a = new THREE.Quaternion().setFromAxisAngle(AX_Z, flap);
  const b = new THREE.Quaternion().setFromAxisAngle(AX_Y, sweep * ms);
  const c = new THREE.Quaternion().setFromAxisAngle(AX_X, twist * ms);
  return (out || new THREE.Quaternion()).copy(a).multiply(b).multiply(c);
}

// arm group: secondaries, tertials, greater and median coverts over the spar
function emitArm(acc, shutMode, inv) {
  emitLoft(acc, shutMode ? ARM_ST_FOLD : ARM_ST, PAL.grey, PAL.white);
  for (let j = 0; j < 16; j++) {              // secondaries, j0 nearest wrist
    const len = 0.126 + j * 0.0021;
    emitFeather(acc, { len, wl: W_SEC_L, wt: W_SEC_T, droop: -0.045, bend: 0.03,
      camber: 0.12, stops: SEC_ST, pale: 0.62, seg: 6 },
    shutMode ? shut(inv, -0.012 + 0.0036 * j, 0.038 + 0.0007 * j, len,
      -1 - 0.04 * j, -13 + 0.25 * j, -68 + 0.3 * j, 0.008 - 0.00025 * j)
      : spread(0.206 - j * 0.0088, -0.0015, 0.017, 81 + j * 0.55, -3 - 0.2 * j));
  }
  for (let j = 0; j < 3; j++) {               // tertials
    const len = 0.162 - 0.008 * j;
    emitFeather(acc, { len, wl: W_SEC_L, wt: W_SEC_T, droop: -0.05, bend: 0.04,
      camber: 0.12, stops: TER_ST, pale: 0.55, seg: 7 },
    shutMode ? shut(inv, 0.030 - 0.014 * j, 0.053 - 0.002 * j, len, -1.5, -9 - j, -52 - 3 * j, 0.010)
      : spread(0.055 - 0.017 * j, 0.001, 0.014, 93 + 4 * j, -4));
  }
  for (let j = 0; j < 14; j++) {              // greater coverts
    emitFeather(acc, { len: 0.060, wl: W_COV_L, wt: W_COV_T, droop: -0.05, bend: 0.02,
      camber: 0.14, stops: GC_ST, pale: 0.55, seg: 5 },
    shutMode ? shut(inv, -0.012 + 0.0046 * j, 0.049 + 0.0005 * j, 0.060, -1, -13, -60, 0.012)
      : spread(0.210 - j * 0.0088, 0.0065, 0.005, 79 + j * 0.4, -5));
  }
  for (let j = 0; j < 12; j++) {              // median coverts
    emitFeather(acc, { len: 0.043, wl: W_COV_L, wt: W_COV_T, droop: -0.05, bend: 0.02,
      camber: 0.14, stops: MC_ST, pale: 0.55, seg: 5 },
    shutMode ? shut(inv, 0.002 + 0.0044 * j, 0.055 + 0.0004 * j, 0.043, -1, -14, -50, 0.013)
      : spread(0.190 - j * 0.0098, 0.0112, -0.006, 77 + j * 0.4, -6));
  }
  return acc;
}

// hand group: primaries, their coverts and the alula
function emitHand(acc, shutMode, inv) {
  emitLoft(acc, shutMode ? HAND_ST_FOLD : HAND_ST, PAL.greyDk, PAL.offWhite);
  for (let i = 0; i < 10; i++) {
    emitFeather(acc, { len: P_LEN[i], wl: W_PRIM_L, wt: W_PRIM_T,
      droop: 0.052 + 0.0125 * i, bend: 0.035, camber: 0.085,
      stops: primStops(i), pale: 0.42, seg: 10 },
    shutMode ? shut(inv, -0.050 - 0.0042 * i, 0.041 - 0.0016 * i, P_LEN[i],
      -(0.6 + 0.22 * i), -3.5 - 0.45 * i, -78 - 0.4 * i, 0.010 + 0.0006 * i)
      : spread(P_X[i], 0.0012 + 0.0013 * i, 0.012 - 0.0045 * (i / 9), P_SW[i], -(3 + 0.9 * i)));
  }
  for (let j = 0; j < 9; j++) {               // primary coverts
    const len = 0.058 + 0.0022 * j;
    emitFeather(acc, { len, wl: W_COV_L, wt: W_COV_T, droop: 0.02, bend: 0.02,
      camber: 0.13, stops: PC_ST, pale: 0.5, seg: 5 },
    shutMode ? shut(inv, -0.050 - 0.005 * j, 0.042 - 0.001 * j, len,
      -1, -12, -66, 0.011)
      : spread(-0.004 + j * 0.0152, 0.0058 + 0.0006 * j, 0.004, 74 - 3.4 * j, -5));
  }
  for (let j = 0; j < 3; j++) {               // alula
    const len = 0.046 - 0.005 * j;
    emitFeather(acc, { len, wl: W_COV_L, wt: W_COV_T, droop: 0.02, bend: 0.03,
      camber: 0.12, stops: AL_ST, pale: 0.5, seg: 5 },
    shutMode ? shut(inv, -0.030 + 0.005 * j, 0.038, len, -1, -14, -68, 0.008)
      : spread(0.006 + j * 0.005, 0.0055, -0.016 + j * 0.002, 56 + j * 4, -8));
  }
  return acc;
}

// twelve rectrices from the rump. fan 1 = spread for braking and soaring,
// fan 0.28 = shut to the narrow wedge a standing gull carries.
function emitTail(acc, fan) {
  for (let k = 0; k < 12; k++) {
    const side = k < 6 ? 1 : -1, j = k < 6 ? k : 11 - k;   // j0 = central pair
    const phi = (2.2 + j * 4.6) * D * side * fan;
    const len = 0.158 - 0.0022 * j;
    _e.set((-1.5 - 2.2 * j) * D * side * (0.35 + 0.65 * fan), phi - Math.PI, 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(0.004, 0.004 - 0.0012 * j, side * 0.004 * fan);
    emitFeather(acc, { len, wl: W_TAIL_L, wt: W_TAIL_T, droop: -0.030, bend: 0.02,
      camber: 0.09, stops: TAIL_ST, pale: 0.25, seg: 7 }, _m.compose(_p, _q, ONE));
  }
  return acc;
}

// scapulars: five per side lying over the shoulder joint, hiding the seam
// where the wing meets the mantle whether it is open or shut
function emitScapulars(acc) {
  for (const sd of [1, -1]) {
    for (let k = 0; k < 5; k++) {
      const len = 0.125 - 0.010 * k;
      _e.set(sd * (14 + 4 * k) * D, (Math.PI - (19 + 7 * k) * D) * (sd > 0 ? 1 : -1), 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(0.075 - 0.016 * k, 0.043 - 0.004 * k, sd * (0.030 + 0.004 * k));
      emitFeather(acc, { len, wl: W_SEC_L, wt: W_SEC_T, droop: -0.05, bend: 0.03,
        camber: 0.11, stops: SCAP_ST, pale: 0.4, seg: 6 }, _m.compose(_p, _q, ONE));
    }
  }
  return acc;
}

// ------------------------------------------------------------------ legs
// hip inside the belly, a short tibia to the heel, the bare tarsus below it,
// and the webbed foot on the end. Angles are about z: negative swings aft.
const LEG = {
  hip: new THREE.Vector3(-0.008, -0.018, 0.024),
  tibia: 0.046, tarsus: 0.062,
  stand: { hip: -0.30, ankle: 0.46 },
  tuck: { hip: -1.42, ankle: 0.16, toe: -1.72 },
};
// how far the body rides above the sand when the gull is on its feet
const STAND_Y = 0.126;

function webGeometry() {
  const p = [0, 0, 0], col = [], idx = [];
  col.push(PAL.leg.r, PAL.leg.g, PAL.leg.b);
  const angs = [-26, -13, 0, 13, 26], rad = [0.049, 0.040, 0.052, 0.040, 0.049];
  for (let k = 0; k < 5; k++) {
    const a = angs[k] * D;
    p.push(Math.cos(a) * rad[k], 0, Math.sin(a) * rad[k]);
    const c = k % 2 === 0 ? PAL.leg : PAL.legDk;   // toes, then the web between
    col.push(c.r, c.g, c.b);
  }
  for (let k = 1; k < 5; k++) idx.push(0, k, k + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------- the kit
// Textures, geometry and materials for one gull, shared by a whole flock:
// buildGull() only ever adds groups and bones on top. The /components viewer
// builds its own kit per view so it can dispose it on the way out.
const SPINE_T = { head: 0.13, neck: 0.30, torso: 0.50, tail: 0.86 };

function spineWeight(t) {
  if (t <= 0.14) return [0, 0, 1, 0];
  if (t < 0.30) { const k = sstep(t, 0.14, 0.30); return [0, 1, 1 - k, k]; }
  if (t < 0.46) { const k = sstep(t, 0.30, 0.46); return [1, 2, 1 - k, k]; }
  if (t < 0.74) return [2, 2, 1, 0];
  const k = sstep(t, 0.74, 0.94);
  return [2, 3, 1 - k, k];
}

export function gullAssets() {
  // ---- body, skinned to a four-bone spine (head, neck, torso, tail)
  const B = sweptBody({ NS: NS_BODY, NR: NR_BODY, px: bodyX, py: bodyY,
    hw: bodyW, hUp: bodyH, nT: bodyNT, nB: bodyNB, uv: true });
  const RW = NR_BODY + 1;
  const si = [], sw = [];
  for (let i = 0; i <= NS_BODY; i++) {
    const [a, b, wa, wb] = spineWeight(i / NS_BODY);
    for (let j = 0; j < RW; j++) { si.push(a, b, 0, 0); sw.push(wa, wb, 0, 0); }
  }
  B.geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  B.geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const bframe = (t) => B.frames[Math.round(clamp(t, 0, 1) * NS_BODY)];
  const spine = {};
  for (const k in SPINE_T) spine[k] = new THREE.Vector3(bodyX(SPINE_T[k]), bodyY(SPINE_T[k]), 0);

  // ---- bill: a stubby loft off the feather line, yellow with the red gonys
  // spot under the angle and a dark smudge at the nostril
  const billLen = 0.054;
  const billFr = bframe(0.022);
  const billQuat = new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(billFr.F, billFr.U, billFr.S));
  billQuat.multiply(new THREE.Quaternion().setFromAxisAngle(AX_Z, -5 * D));
  const bhw = curve([[0, 0.0016], [0.1, 0.0035], [0.25, 0.0055], [0.5, 0.0080], [0.75, 0.0098], [1, 0.0110]]);
  const bhu = curve([[0, 0.0022], [0.12, 0.0042], [0.30, 0.0058], [0.55, 0.0072], [0.80, 0.0092], [1, 0.0112]]);
  const bhl = curve([[0, 0.0020], [0.10, 0.0048], [0.22, 0.0079], [0.35, 0.0071], [0.60, 0.0072], [0.80, 0.0090], [1, 0.0114]]);
  const billGeo = sweptBody({ NS: 26, NR: 18,
    px: (t) => billLen * (1 - t),
    py: (t) => -0.0060 * Math.pow(clamp((0.34 - t) / 0.34, 0, 1), 1.7),
    hw: bhw, hUp: bhu, hLo: bhl, nT: () => 2.5, nB: () => 2.25,
    color: (t, th, out) => {
      out.copy(PAL.bill).lerp(PAL.billHot, sstep(t, 0.45, 0.05));
      const gon = Math.exp(-Math.pow((t - 0.205) / 0.075, 2))
        * Math.exp(-Math.pow((th - Math.PI) / 0.85, 2));
      out.lerp(PAL.red, clamp(gon * 1.25, 0, 1));
      const gp = Math.min(Math.abs(th - 1.88), Math.abs(th - (Math.PI * 2 - 1.88)));
      out.lerp(PAL.billDark, Math.exp(-Math.pow(gp / 0.10, 2)) * 0.75 * sstep(t, 0.02, 0.10));
      const nos = Math.exp(-Math.pow((t - 0.54) / 0.075, 2))
        * Math.exp(-Math.pow(Math.min(Math.abs(th - 1.30), Math.abs(th - (Math.PI * 2 - 1.30))) / 0.20, 2));
      out.lerp(PAL.billDark, clamp(nos * 0.85, 0, 1));
    } }).geom;

  // ---- eyes: pale iris, black pupil, orange orbital ring, both sides baked
  // into one geometry in head-bone space
  const eyeFr = bframe(0.112);
  const eyeQ = new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(eyeFr.F, eyeFr.U, eyeFr.S));
  const eyeParts = { iris: [], pupil: [], ring: [] };
  for (const sd of [1, -1]) {
    const at = new THREE.Vector3().copy(eyeFr.p)
      .addScaledVector(eyeFr.U, 0.30 * bodyH(0.112))
      .addScaledVector(eyeFr.S, sd * 0.93 * bodyW(0.112))
      .sub(spine.head);
    const base = new THREE.Matrix4().compose(at, eyeQ, ONE);
    const iris = new THREE.SphereGeometry(0.0068, 12, 9);
    iris.scale(1, 1, 0.9);
    eyeParts.iris.push(iris.applyMatrix4(base));
    const pup = new THREE.SphereGeometry(0.0038, 10, 7);
    pup.translate(0, 0, sd * 0.0033);
    eyeParts.pupil.push(pup.applyMatrix4(base));
    const ring = new THREE.TorusGeometry(0.0073, 0.0009, 5, 16);
    ring.translate(0, 0, sd * 0.0008);
    eyeParts.ring.push(ring.applyMatrix4(base));
  }
  const weld = (list) => {
    const pos = [], nor = [], idx = [];
    let off = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, ix = g.index;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
      }
      for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
      off += p.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setIndex(idx);
    return out;
  };

  // ---- wings: one geometry per group, spread as the base shape and shut as
  // a morph target, so the fold is a continuous blend with no popping
  const rootQ = new THREE.Quaternion().setFromAxisAngle(AX_Y, -90 * D);
  const mRoot = new THREE.Matrix4().compose(WING_ROOT, rootQ, ONE);
  const mSh = mRoot.clone().multiply(new THREE.Matrix4()
    .makeRotationFromQuaternion(boneQuat(FOLD_SH.flap, FOLD_SH.sweep, FOLD_SH.twist, 1)));
  const mWr = mSh.clone()
    .multiply(new THREE.Matrix4().makeTranslation(ARM_LEN * FOLD_WRIST_K, 0, 0))
    .multiply(new THREE.Matrix4()
      .makeRotationFromQuaternion(boneQuat(FOLD_WR.flap, FOLD_WR.sweep, FOLD_WR.twist, 1)));
  const invSh = mSh.clone().invert(), invWr = mWr.clone().invert();

  const morphed = (openAcc, shutAcc) => {
    const g = accToGeom(openAcc), s = accToGeom(shutAcc);
    g.morphAttributes.position = [s.attributes.position];
    g.morphAttributes.normal = [s.attributes.normal];
    return g;
  };
  const armGeo = morphed(emitArm(Acc(), false, null), emitArm(Acc(), true, invSh));
  const handGeo = morphed(emitHand(Acc(), false, null), emitHand(Acc(), true, invWr));
  const tailGeo = morphed(emitTail(Acc(), 1), emitTail(Acc(), 0.28));
  const scapGeo = accToGeom(emitScapulars(Acc()));

  // ---- materials
  const featherMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: featherTexture(),
    side: THREE.DoubleSide, roughness: 0.74, metalness: 0 });
  const bodyMat = new THREE.MeshStandardMaterial({ map: bodyTexture(), roughness: 0.82, metalness: 0 });
  const billMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.02 });
  const irisMat = new THREE.MeshPhysicalMaterial({ color: 0xe7dda2, roughness: 0.18,
    clearcoat: 1, clearcoatRoughness: 0.04 });
  const pupilMat = new THREE.MeshPhysicalMaterial({ color: 0x0c0d10, roughness: 0.05, clearcoat: 1 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xdd8a26, roughness: 0.45 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xe9a9a4, roughness: 0.5 });
  const webMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45,
    side: THREE.DoubleSide });

  const tibiaGeo = new THREE.CylinderGeometry(0.0062, 0.0050, LEG.tibia, 7);
  tibiaGeo.translate(0, -LEG.tibia / 2, 0);
  const tarsusGeo = new THREE.CylinderGeometry(0.0048, 0.0040, LEG.tarsus, 8);
  tarsusGeo.translate(0, -LEG.tarsus / 2, 0);

  return {
    bodyGeo: B.geom, billGeo, armGeo, handGeo, tailGeo, scapGeo,
    irisGeo: weld(eyeParts.iris), pupilGeo: weld(eyeParts.pupil), ringGeo: weld(eyeParts.ring),
    tibiaGeo, tarsusGeo, webGeo: webGeometry(),
    mats: { body: bodyMat, feather: featherMat, bill: billMat, iris: irisMat,
      pupil: pupilMat, ring: ringMat, leg: legMat, web: webMat },
    spine,
    bill: { pos: billFr.p.clone().sub(spine.head), quat: billQuat },
    tailRoot: bframe(0.985).p.clone().sub(spine.tail),
  };
}

// ------------------------------------------------------------------- rig
const _b1 = new THREE.Quaternion(), _b2 = new THREE.Quaternion(), _b3 = new THREE.Quaternion();
function setBone(gr, flap, sweep, twist, ms) {
  _b1.setFromAxisAngle(AX_Z, flap);
  _b2.setFromAxisAngle(AX_Y, sweep * ms);
  _b3.setFromAxisAngle(AX_X, twist * ms);
  gr.quaternion.copy(_b1).multiply(_b2).multiply(_b3);
}

const ANIMS = [
  { id: 'fly', label: 'fly' },
  { id: 'glide', label: 'glide' },
  { id: 'flap', label: 'flap hard' },
  { id: 'ground', label: 'grounded' },
  { id: 'walk', label: 'walk' },
];
const ANIM_IDS = new Set(ANIMS.map((a) => a.id));

// One gull on the shared kit: groups, bones and the animation state. The
// model noses along +x, so a rotation puts it nose-first down +z, which is
// the heading convention the world's brains use.
export function buildGull(kit = gullAssets(), rand = Math.random) {
  const g = new THREE.Group();
  // yaw, then pitch, then roll: a heading can be set without the bank and
  // the climb angle fighting each other
  g.rotation.order = 'YXZ';
  const forward = new THREE.Group();
  forward.rotation.y = -Math.PI / 2;
  g.add(forward);
  const carriage = new THREE.Group();   // everything the legs do not carry
  forward.add(carriage);

  // ---- spine: head and neck for nods and the walking head-bob, a tail bone
  // for the rump. Bind pose is all-identity, so attachments are pure offsets.
  const head = new THREE.Bone(), neck = new THREE.Bone();
  const torso = new THREE.Bone(), tailB = new THREE.Bone();
  torso.position.copy(kit.spine.torso);
  neck.position.copy(kit.spine.neck).sub(kit.spine.torso);
  head.position.copy(kit.spine.head).sub(kit.spine.neck);
  tailB.position.copy(kit.spine.tail).sub(kit.spine.torso);
  torso.add(neck, tailB);
  neck.add(head);
  const headHome = head.position.clone();

  const body = new THREE.SkinnedMesh(kit.bodyGeo, kit.mats.body);
  body.castShadow = true;
  body.add(torso);
  body.bind(new THREE.Skeleton([head, neck, torso, tailB]));
  carriage.add(body);

  const bill = new THREE.Mesh(kit.billGeo, kit.mats.bill);
  bill.position.copy(kit.bill.pos);
  bill.quaternion.copy(kit.bill.quat);
  head.add(bill);
  head.add(new THREE.Mesh(kit.irisGeo, kit.mats.iris));
  head.add(new THREE.Mesh(kit.pupilGeo, kit.mats.pupil));
  head.add(new THREE.Mesh(kit.ringGeo, kit.mats.ring));

  const scap = new THREE.Mesh(kit.scapGeo, kit.mats.feather);
  scap.castShadow = true;
  carriage.add(scap);

  const tailGrp = new THREE.Group();
  tailGrp.position.copy(kit.tailRoot);
  tailB.add(tailGrp);
  const tailMesh = new THREE.Mesh(kit.tailGeo, kit.mats.feather);
  tailMesh.castShadow = true;
  tailGrp.add(tailMesh);

  // ---- wings. One geometry serves both sides: the far side is the same
  // buffer mirrored, which is exactly what the root frame expects.
  const wings = [];
  for (const sd of [1, -1]) {
    const root = new THREE.Group();
    root.position.set(WING_ROOT.x, WING_ROOT.y, sd * WING_ROOT.z);
    root.quaternion.setFromAxisAngle(AX_Y, (sd < 0 ? 90 : -90) * D);
    carriage.add(root);
    const shoulder = new THREE.Group();
    root.add(shoulder);
    const wrist = new THREE.Group();
    wrist.position.x = ARM_LEN;
    shoulder.add(wrist);
    const armMesh = new THREE.Mesh(kit.armGeo, kit.mats.feather);
    const handMesh = new THREE.Mesh(kit.handGeo, kit.mats.feather);
    if (sd < 0) { armMesh.scale.z = -1; handMesh.scale.z = -1; }
    armMesh.castShadow = handMesh.castShadow = true;
    shoulder.add(armMesh);
    wrist.add(handMesh);
    wings.push({ ms: sd, shoulder, wrist, armMesh, handMesh });
  }

  // ---- legs, hung off the unpitched frame so a chest-up stance cannot lift
  // the feet off the sand
  const legs = [];
  for (const sd of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(LEG.hip.x, LEG.hip.y, sd * LEG.hip.z);
    forward.add(hip);
    hip.add(new THREE.Mesh(kit.tibiaGeo, kit.mats.leg));
    const ankle = new THREE.Group();
    ankle.position.y = -LEG.tibia;
    hip.add(ankle);
    ankle.add(new THREE.Mesh(kit.tarsusGeo, kit.mats.leg));
    const toe = new THREE.Group();
    toe.position.y = -LEG.tarsus;
    ankle.add(toe);
    toe.add(new THREE.Mesh(kit.webGeo, kit.mats.web));
    legs.push({ sd, hip, ankle, toe, phase: sd > 0 ? 0 : 0.5 });
  }

  // ------------------------------------------------------------ animation
  const st = {
    clip: 'fly', amb: rand() * 40, beat: rand(), beatAmp: 0,
    fold: 0, gear: 0, fan: 0.35, stride: rand(), strideAmt: 0,
    look: 0, lookTo: 0, lookT: 2 + rand() * 3,
    peck: 0, peckT: 3 + rand() * 5,
  };

  // standing about: the odd peck at the sand, the odd glance around
  function idle(dt) {
    if (st.peck <= 0) {
      st.peckT -= dt;
      if (st.peckT <= 0) { st.peck = Math.PI; st.peckT = 3 + rand() * 7; }
    }
    st.lookT -= dt;
    if (st.lookT <= 0) { st.lookTo = (rand() - 0.5) * 1.4; st.lookT = 2.5 + rand() * 4; }
    st.look += (st.lookTo - st.look) * Math.min(dt * 2.2, 1);
  }

  // a pace is one stride length of ground, so the feet keep up with the walk
  const STRIDE_LEN = 0.089;
  function walking(dt, speed) {
    st.stride += dt * (Math.max(speed, 0.02) / STRIDE_LEN);
  }

  function pose() {
    const fold = st.fold, amp = st.beatAmp, a = st.beat * Math.PI * 2;
    // wings held out on a glide, with a slow ambient breathe
    const d = Math.sin(st.amb * 0.6) * 0.03;
    let sF = 0.15 + d, sS = -0.03, sT = -0.055;
    let wF = -0.07 - d * 0.5, wS = -0.11, wT = 0.035;
    let bob = 0.004 * Math.sin(st.amb * 0.6), pitch = 0.01, tailP = -0.02;
    if (amp > 0.002) {                       // ...blended toward the wingbeat
      const up = Math.max(0, Math.cos(a - 0.25));
      sF = lerp(sF, 0.06 + 0.70 * Math.sin(a), amp);
      sS = lerp(sS, -0.05 + 0.10 * Math.sin(a + 1.35), amp);
      sT = lerp(sT, -0.03 + 0.20 * Math.cos(a - 0.40), amp);
      wF = lerp(wF, -0.05 + 0.34 * up, amp);
      wS = lerp(wS, -0.08 - 0.40 * up, amp);
      wT = lerp(wT, 0.05 + 0.32 * Math.cos(a - 0.75), amp);
      bob = lerp(bob, 0.016 * Math.sin(a + 0.55), amp);
      pitch = lerp(pitch, 0.05 * Math.sin(a - 0.35), amp);
      tailP = lerp(tailP, -0.05 + 0.05 * Math.sin(a - 0.5), amp);
    }
    // ...and then toward the shut wing, chest up over the feet
    sF = lerp(sF, FOLD_SH.flap, fold);
    sS = lerp(sS, FOLD_SH.sweep, fold);
    sT = lerp(sT, FOLD_SH.twist, fold);
    wF = lerp(wF, FOLD_WR.flap, fold);
    wS = lerp(wS, FOLD_WR.sweep, fold);
    wT = lerp(wT, FOLD_WR.twist, fold);
    pitch = lerp(pitch, 0.11, fold);
    tailP = lerp(tailP, 0.07, fold);
    bob = lerp(bob, 0, fold);

    for (const w of wings) {
      setBone(w.shoulder, sF, sS, sT, w.ms);
      setBone(w.wrist, wF, wS, wT, w.ms);
      w.wrist.position.x = ARM_LEN * (1 - (1 - FOLD_WRIST_K) * fold);
      w.armMesh.morphTargetInfluences[0] = fold;
      w.handMesh.morphTargetInfluences[0] = fold;
    }
    tailMesh.morphTargetInfluences[0] = 1 - st.fan;
    tailB.rotation.z = tailP * 0.35;
    tailGrp.rotation.z = tailP * 0.65;

    // waddle: the body rocks onto each foot and dips twice a pace
    const sw = Math.sin(st.stride * Math.PI * 2) * st.strideAmt;
    carriage.position.y = bob - 0.003 * st.strideAmt * Math.abs(Math.cos(st.stride * Math.PI * 2));
    carriage.rotation.z = pitch;
    carriage.rotation.x = 0.055 * sw;

    // neck: the peck arc, the pace-timed head thrust, an idle glance
    const peckK = Math.sin(st.peck);
    neck.rotation.z = 0.30 * fold - 0.95 * peckK - 0.13 * sw;
    head.rotation.z = -0.21 * fold - 0.55 * peckK + 0.15 * sw;
    head.rotation.y = st.look;
    head.position.x = headHome.x + 0.006 * sw;

    const gear = st.gear;
    for (const L of legs) {
      const ph = (st.stride + L.phase) * Math.PI * 2;
      const swing = Math.sin(ph) * st.strideAmt;
      const lift = Math.max(0, Math.sin(ph - 0.5)) * st.strideAmt;
      const hipA = LEG.stand.hip - 0.48 * swing;
      const ankA = LEG.stand.ankle + 0.80 * lift;
      L.hip.rotation.z = lerp(LEG.tuck.hip, hipA, gear);
      L.ankle.rotation.z = lerp(LEG.tuck.ankle, ankA, gear);
      L.toe.rotation.z = lerp(LEG.tuck.toe, -(hipA + ankA) - 0.35 * lift, gear);
      L.hip.rotation.x = 0.10 * L.sd * gear;
    }
  }

  // dt seconds. opts.gear forces the legs down (a landing reach), opts.speed
  // sets the walking pace, opts.rate scales the wingbeat.
  function update(dt, opts = {}) {
    st.amb += dt;
    // a peck runs its arc out and a glance straightens whatever happens next,
    // so a gull flushed mid-nod does not fly off with its neck still bent
    if (st.peck > 0) st.peck = Math.max(st.peck - dt * 5.5, 0);
    let foldT = 0, gearT = 0, fanT = 0.35, beatT = 0, strideT = 0;
    let hz = 2.35 * (opts.rate ?? 1);
    switch (st.clip) {
      case 'glide':
        fanT = 0.55;
        break;
      case 'flap':
        beatT = 1; fanT = 0.70; hz = 2.45 * (opts.rate ?? 1);
        break;
      case 'ground':
        foldT = 1; gearT = 1; fanT = 0;
        idle(dt);
        break;
      case 'walk':
        foldT = 1; gearT = 1; fanT = 0.04; strideT = 1;
        walking(dt, opts.speed ?? 0.28);
        break;
      default:  // fly: bursts of beats gated into long glides
        beatT = sstep(Math.sin(st.amb * 0.43), -0.2, 0.35);
    }
    if (st.clip !== 'ground') st.look += (0 - st.look) * Math.min(dt * 2.2, 1);
    if (opts.gear != null) gearT = Math.max(gearT, opts.gear);
    st.beat += dt * hz;
    st.fold += (foldT - st.fold) * Math.min(dt * 3.2, 1);
    st.gear += (gearT - st.gear) * Math.min(dt * 4.5, 1);
    st.fan += (fanT - st.fan) * Math.min(dt * 2.5, 1);
    st.beatAmp += (beatT - st.beatAmp) * Math.min(dt * 4, 1);
    st.strideAmt += (strideT - st.strideAmt) * Math.min(dt * 6, 1);
    pose();
  }

  update(0);
  return {
    group: g,
    standY: STAND_Y,
    anims: ANIMS,
    anim() { return st.clip; },
    play(name) { if (ANIM_IDS.has(name)) st.clip = name; },
    update,
  };
}
