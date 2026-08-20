// The island: analytic height field + terrain mesh + sand material.
// One height function is the single source of truth — it shapes the mesh,
// drives player collision, places props, and is baked to a texture that the
// water shader samples for depth (foam, color, wave damping).
//
// World v2: the island is ~5-6x wider than it used to be. The first ~32m
// inland of every sandy shore keeps the original beach profile (so the whole
// shore ecosystem — crabs, shells, palms, wet sand — carries over untouched),
// then the interior climbs into rolling hills and 2-3 real mountains. Seeded
// coast arcs turn stretches of shoreline into sea cliffs; the sandy gaps
// between them are where the beaches (and the swash zones) live.

import * as THREE from 'three';
import { Simplex2, mulberry32 } from '../core/rng.js';
import { uniforms } from '../core/env.js';
import { subSeed } from '../core/seed.js';
import { swashUniforms, SWASH_GLSL } from './swash.js';
import {
  sandTextures, causticTexture, foamTexture, forestFloorTexture, rockTexture,
} from '../core/textures.js';

// Everything that defines this island's shape lives in these lets and is
// regrown from the master seed by reseedIsland().
let noise, BASE_R, LOBES, CAY_POS;
let LAGOONS = []; // 1-2 interior freshwater ponds (sometimes the hunt fails)
let ARCS = [];    // sea-cliff coast sectors: { az, half, cliffH, riseW }
let PEAKS = [];   // mountains, summit first: { x, z, h, rx, rz, cosA, sinA, shelfR, bb }
let GAPS = [];    // sandy coast gaps between cliff arcs: { center, half }
let SHORE_RANGE = { min: 0, max: 0 };
let HMAP_HALF_V = 360; // world half-extent the baked maps cover (per island)

const sstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const angDist = (a, b) => Math.abs(wrapAng(a - b));

// Lobed shoreline: nominal water's-edge radius for a given angle.
export function shoreRadius(theta) {
  let k = 1;
  for (const l of LOBES) k += l.a * Math.sin(l.n * theta + l.ph);
  return BASE_R * k;
}

export function cayCenter() { return { ...CAY_POS }; }

// ------------------------------------------------------------------ coast
// How cliff-y the coast is at an azimuth (0 = sandy beach, 1 = full sea
// cliff). Arcs never overlap (placement keeps them >1.15 rad apart), so the
// dominant arc's face height/width ride along in module scratch.
let _cH = 18, _cW = 12; // dominant arc params, set by cliffK()
function cliffK(theta) {
  let k = 0;
  for (const a of ARCS) {
    const f = 1 - sstep(a.half * 0.62, a.half, angDist(theta, a.az));
    if (f > k) { k = f; _cH = a.cliffH; _cW = a.riseW; }
  }
  return k;
}

export function coastInfo(az) {
  const k = cliffK(az);
  return { cliffK: k, sandy: k < 0.35, cliffH: _cH, riseW: _cW };
}

export function isSandyShore(az) { return cliffK(az) < 0.35; }

// The sandy gaps between cliff arcs, widest first.
function computeGaps() {
  if (!ARCS.length) {
    GAPS = [{ center: 0, half: Math.PI }];
    return;
  }
  const sorted = [...ARCS].sort((a, b) => a.az - b.az);
  GAPS = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    const start = a.az + a.half;
    let span = (b.az - b.half) - start;
    if (i === sorted.length - 1) span += Math.PI * 2;
    if (span <= 0.05) continue;
    GAPS.push({ center: wrapAng(start + span / 2), half: span / 2 });
  }
  GAPS.sort((a, b) => b.half - a.half);
  if (!GAPS.length) GAPS = [{ center: 0, half: Math.PI }]; // can't happen, but never strand callers
}

// Widest sandy stretch of coast — where the spawn beach and swash zones live.
export function primaryGap() { return { ...GAPS[0] }; }

// A seeded azimuth guaranteed (keep-best) to land on sandy coast, as far as
// possible from cliff arcs and from any azimuths the caller wants avoided.
export function beachAz(rand, opts = {}) {
  const { avoid = [], sep = 0, margin = 0.12 } = opts;
  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < 40; i++) {
    const az = rand() * Math.PI * 2;
    let clr = Infinity;
    for (const a of ARCS) clr = Math.min(clr, angDist(az, a.az) - a.half);
    let sepD = Infinity;
    for (const v of avoid) sepD = Math.min(sepD, angDist(az, v));
    const score = Math.min(clr - margin, sepD - sep);
    if (score > bestScore) { bestScore = score; best = az; }
  }
  return best;
}

// ------------------------------------------------------------------ peaks
export function peaks() { return PEAKS.map((p) => ({ ...p })); }

export function summitPos() {
  const P = PEAKS[0];
  return { x: P.x, z: P.z, h: P.h };
}

export function shoreRange() { return { ...SHORE_RANGE }; }
export function hmapHalf() { return HMAP_HALF_V; }

// ------------------------------------------------------------------ trails
// One seeded footpath crosses the island: beach trailhead → forest →
// (pond bank) → clifftop lookout → switchbacks up the mountain flank →
// the summit shelf. The polyline's height profile is grade-relaxed to
// ≤ ~16°, and islandHeight blends the ground onto it inside a ~3.6m
// ribbon — the path is CARVED, so it is walkable by construction.
let TRAILS = { paths: [], lookouts: [], trailheadAz: 0 };
let TRAILGRID = null; // { cell, half, cols, bins, segs } — null while growing
const MAX_GRADE = Math.tan((16 * Math.PI) / 180); // ≈ 0.287
const CARVE_IN = 1.7, CARVE_OUT = 3.6;            // bench half-widths
let _tqD = 0, _tqY = 0;                            // trailQueryFast scratch

function trailQueryFast(x, z) {
  const g = TRAILGRID;
  if (!g) return false;
  const ci = Math.floor((x + g.half) / g.cell);
  const cj = Math.floor((z + g.half) / g.cell);
  if (ci < 0 || cj < 0 || ci >= g.cols || cj >= g.cols) return false;
  const bin = g.bins[cj * g.cols + ci];
  if (!bin) return false;
  let bestD2 = Infinity, bestY = 0;
  for (let k = 0; k < bin.length; k++) {
    const s = g.segs[bin[k]];
    const abx = s.bx - s.ax, abz = s.bz - s.az;
    let t = ((x - s.ax) * abx + (z - s.az) * abz) / s.len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (s.ax + abx * t), dz = z - (s.az + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestY = s.ay + (s.by - s.ay) * t; }
  }
  if (bestD2 > 81) return false; // 9m: the widest a deep cut can flare
  _tqD = Math.sqrt(bestD2);
  _tqY = bestY;
  return true;
}

export function trailInfo() {
  return {
    paths: TRAILS.paths.map((p) => ({ kind: p.kind, pts: p.pts.map((q) => ({ ...q })) })),
    lookouts: TRAILS.lookouts.map((l) => ({ ...l })),
    trailheadAz: TRAILS.trailheadAz,
  };
}

// Distance to the nearest trail centerline + the path height there, or
// null when out of reach. Placement code keeps props off the path with it.
export function trailQuery(x, z) {
  return trailQueryFast(x, z) ? { d: _tqD, y: _tqY } : null;
}

// 1 at the trodden centerline → 0 at the ribbon edge (dirt for the shader).
export function trailMask(x, z) {
  if (!trailQueryFast(x, z)) return 0;
  const t = Math.min(Math.max((_tqD - 1.1) / (2.4 - 1.1), 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

// Catmull-Rom through the waypoints, resampled to ~6m spacing.
function catmullChain(pts, step = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    const dist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(Math.ceil(dist / step), 1);
    for (let k = 0; k < n; k++) {
      const u = k / n, u2 = u * u, u3 = u2 * u;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u
          + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2
          + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
        z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * u
          + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2
          + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3),
      });
    }
  }
  out.push({ x: pts[pts.length - 1].x, z: pts[pts.length - 1].z });
  return out;
}

// The elliptical radius of a peak's footprint along a world-space bearing.
function peakEdgeRadius(P, worldAng) {
  const ca = Math.cos(worldAng - Math.atan2(P.sinA, P.cosA));
  const sa = Math.sin(worldAng - Math.atan2(P.sinA, P.cosA));
  return 1 / Math.sqrt((ca / P.rx) ** 2 + (sa / P.rz) ** 2);
}

function reseedTrails() {
  TRAILGRID = null; // islandHeight must run un-carved while we route
  TRAILS = { paths: [], lookouts: [], trailheadAz: 0 };
  const tr = mulberry32(subSeed('trail'));
  const P = PEAKS[0];
  const ridge = Math.atan2(P.sinA, P.cosA);

  // --- waypoints across the lowlands ---
  const gap = GAPS[0];
  const thAz = gap.center + (tr() - 0.5) * gap.half * 0.5;
  TRAILS.trailheadAz = thAz;
  const thR = shoreRadius(thAz) - 12;
  const TH = { x: Math.cos(thAz) * thR, z: Math.sin(thAz) * thR };

  // the clifftop lookout sits on the widest cliff arc's headland shelf
  const arc = ARCS.reduce((w, a) => (a.half > w.half ? a : w), ARCS[0]);
  const loR = shoreRadius(arc.az) - (arc.riseW + 8);
  const LO = { x: Math.cos(arc.az) * loR, z: Math.sin(arc.az) * loR };

  // switchbacks start where the mountain faces the lookout side — walked
  // back toward the peak if that ellipse edge pokes past the shoreline
  // (a negative start height would NaN the whole climb schedule)
  const toBase = Math.atan2(LO.z - P.z, LO.x - P.x);
  let baseR = peakEdgeRadius(P, toBase) * 1.06;
  const BASE = { x: P.x + Math.cos(toBase) * baseR, z: P.z + Math.sin(toBase) * baseR };
  for (let i = 0; i < 24 && islandHeight(BASE.x, BASE.z) < 2; i++) {
    baseR -= 4;
    BASE.x = P.x + Math.cos(toBase) * baseR;
    BASE.z = P.z + Math.sin(toBase) * baseR;
  }

  const way = [TH];
  // a forest bend partway in, pushed sideways so the path snakes
  {
    const mx = TH.x + (LO.x - TH.x) * 0.45, mz = TH.z + (LO.z - TH.z) * 0.45;
    const px = -(LO.z - TH.z), pz = LO.x - TH.x;
    const pl = Math.hypot(px, pz) || 1;
    const off = (tr() - 0.5) * 90;
    way.push({ x: mx + (px / pl) * off, z: mz + (pz / pl) * off });
  }
  // the pond bank, when a pond exists and isn't a silly detour
  if (LAGOONS.length) {
    const L = LAGOONS[0];
    const direct = Math.hypot(LO.x - TH.x, LO.z - TH.z);
    const viaPond = Math.hypot(L.x - TH.x, L.z - TH.z) + Math.hypot(LO.x - L.x, LO.z - L.z);
    if (viaPond < direct * 1.75) {
      // the bank on the lookout side, so the path skirts the water
      const away = Math.atan2(L.z - LO.z, L.x - LO.x);
      way.push({
        x: L.x - Math.cos(away) * (L.rOuter + 3.5),
        z: L.z - Math.sin(away) * (L.rOuter + 3.5),
      });
    }
  }
  way.push(LO, BASE);

  const pts = catmullChain(way, 6);
  // never let a lowland bend stray onto the wet sand
  for (const p of pts) {
    const r = Math.hypot(p.x, p.z);
    const sr = shoreRadius(Math.atan2(p.z, p.x));
    if (r > sr - 7) {
      const k = (sr - 7) / r;
      p.x *= k; p.z *= k;
    }
  }
  // paths follow contours: slide each bend sideways toward ground that
  // matches its neighbours' height, so the route curls around hillocks
  // instead of demanding a 10m cutting straight through them
  for (let it = 0; it < 3; it++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1], next = pts[i + 1], p = pts[i];
      const tx = next.x - prev.x, tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl, nz = tx / tl;
      const hMid = (islandHeight(prev.x, prev.z) + islandHeight(next.x, next.z)) / 2;
      let bestOff = 0;
      let bestCost = Math.abs(islandHeight(p.x, p.z) - hMid);
      for (const off of [-8, 8]) {
        const c = Math.abs(islandHeight(p.x + nx * off, p.z + nz * off) - hMid) + 0.35;
        if (c < bestCost) { bestCost = c; bestOff = off; }
      }
      p.x += nx * bestOff;
      p.z += nz * bestOff;
    }
  }

  // --- switchbacks up the flank, grade-true by construction ---
  const climb = [];
  {
    const hBase = Math.max(islandHeight(BASE.x, BASE.z), 2);
    const hTop = P.h - 1.2; // the shelf blend finishes the last step
    const window = 0.55 + tr() * 0.25;   // half-width of the flank we zigzag
    const phiC = toBase - ridge;         // flank center, in ellipse frame
    let phi = phiC + (tr() < 0.5 ? -1 : 1) * window * 0.8;
    let dirPhi = phi > phiC ? -1 : 1;
    let h = hBase;
    let guard = 400;
    let spiral = false; // near the crown the contour is too tight to zigzag
    while (h < hTop && guard-- > 0) {
      // ellipse-frame point at the current height's iso-contour
      const u = Math.sqrt(Math.max(1 - Math.sqrt(h / P.h), 0.02));
      const ex = P.rx * u * Math.cos(phi), ez = P.rz * u * Math.sin(phi);
      climb.push({
        x: P.x + ex * P.cosA - ez * P.sinA,
        z: P.z + ex * P.sinA + ez * P.cosA,
        y: h,
      });
      const rHere = Math.max(Math.hypot(ex, ez), 8);
      if (rHere < 22) spiral = true;
      phi += (6 / rHere) * dirPhi;          // ~6m of arc sideways…
      h += 6 * MAX_GRADE * 0.92;            // …for ~1.6m of climb
      if (!spiral) {
        if (phi > phiC + window) { phi = phiC + window; dirPhi = -1; }
        else if (phi < phiC - window) { phi = phiC - window; dirPhi = 1; }
      }
    }
    climb.push({ x: P.x + P.cosA * 0.01, z: P.z + P.sinA * 0.01, y: P.h });
  }

  // --- one profile over the whole route, relaxed to the grade bound ---
  const all = pts.map((p) => ({ x: p.x, z: p.z, y: islandHeight(p.x, p.z) }));
  for (const c of climb) all.push(c);
  for (let i = 0; i < all.length; i++) {
    if (!Number.isFinite(all[i].x) || !Number.isFinite(all[i].z) || !Number.isFinite(all[i].y)) {
      console.warn('[trail] non-finite route point', i, 'of', all.length, all[i]);
      break;
    }
  }
  const y0 = all[0].y, yN = all[all.length - 1].y;
  for (let pass = 0; pass < 4; pass++) {
    all[0].y = y0;
    for (let i = 1; i < all.length; i++) {
      const ds = Math.hypot(all[i].x - all[i - 1].x, all[i].z - all[i - 1].z);
      const lim = MAX_GRADE * Math.max(ds, 0.5);
      all[i].y = Math.min(Math.max(all[i].y, all[i - 1].y - lim), all[i - 1].y + lim);
    }
    all[all.length - 1].y = yN;
    for (let i = all.length - 2; i >= 0; i--) {
      const ds = Math.hypot(all[i + 1].x - all[i].x, all[i + 1].z - all[i].z);
      const lim = MAX_GRADE * Math.max(ds, 0.5);
      all[i].y = Math.min(Math.max(all[i].y, all[i + 1].y - lim), all[i + 1].y + lim);
    }
  }

  TRAILS.paths.push({ kind: 'summit-track', pts: all });
  TRAILS.lookouts.push(
    { x: LO.x, z: LO.z, y: all.length ? islandHeight(LO.x, LO.z) : 0, name: 'clifftop' },
    { x: P.x, z: P.z, y: P.h, name: 'summit' },
  );

  // --- spatial grid so islandHeight can ask "am I on the path?" cheaply ---
  const cell = 8;
  const half = Math.ceil(SHORE_RANGE.max + 8);
  const cols = Math.ceil((2 * half) / cell);
  const bins = new Array(cols * cols);
  const segs = [];
  for (const path of TRAILS.paths) {
    const p = path.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
      if (len2 < 1e-6) continue;
      const si = segs.length;
      segs.push({ ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, len2 });
      const pad = 9.5; // must reach as far as the widest cut flare
      const i0 = Math.max(Math.floor((Math.min(a.x, b.x) - pad + half) / cell), 0);
      const i1 = Math.min(Math.floor((Math.max(a.x, b.x) + pad + half) / cell), cols - 1);
      const j0 = Math.max(Math.floor((Math.min(a.z, b.z) - pad + half) / cell), 0);
      const j1 = Math.min(Math.floor((Math.max(a.z, b.z) + pad + half) / cell), cols - 1);
      for (let j = j0; j <= j1; j++) {
        for (let ii = i0; ii <= i1; ii++) {
          const bi = j * cols + ii;
          (bins[bi] || (bins[bi] = [])).push(si);
        }
      }
    }
  }
  TRAILGRID = { cell, half, cols, bins, segs };
}

// Regrow shoreline lobes, coast sectors, mountains, terrain noise and the
// offshore cay. The cay is a bare dome ~38m past the shoreline whose crown
// pokes ~0.35m above mean sea level: low tide bares a walkable islet, high
// tide drowns it back to a shimmer of shallows.
export function reseedIsland() {
  noise = new Simplex2(subSeed('terrain'));
  const r = mulberry32(subSeed('shore'));
  BASE_R = 240 + r() * 40;
  LOBES = [
    { n: 2, a: 0.10 + r() * 0.06, ph: r() * Math.PI * 2 },
    { n: 3, a: 0.05 + r() * 0.04, ph: r() * Math.PI * 2 },
    { n: 5, a: 0.025 + r() * 0.025, ph: r() * Math.PI * 2 },
    { n: 7, a: 0.012 + r() * 0.013, ph: r() * Math.PI * 2 },
  ];

  // sea-cliff coast arcs: 1-3, kept far enough apart that at least two wide
  // sandy gaps always survive between them
  {
    const cr = mulberry32(subSeed('coast'));
    ARCS = [];
    const nArc = 1 + (cr() < 0.55 ? 1 : 0) + (cr() < 0.2 ? 1 : 0);
    for (let a = 0; a < nArc; a++) {
      const half = 0.35 + cr() * 0.5;
      const cliffH = 15 + cr() * 14;
      const riseW = 9 + cr() * 6;
      if (!ARCS.length) {
        ARCS.push({ az: cr() * Math.PI * 2, half, cliffH, riseW });
        continue;
      }
      let bAz = 0, bGap = -Infinity;
      for (let i = 0; i < 40; i++) {
        const az = cr() * Math.PI * 2;
        let gap = Infinity;
        for (const arc of ARCS) gap = Math.min(gap, angDist(az, arc.az) - half - arc.half);
        if (gap > bGap) { bGap = gap; bAz = az; }
      }
      // an arc that can't keep a real beach between itself and its
      // neighbours simply doesn't grow on this island
      if (bGap >= 1.15) ARCS.push({ az: bAz, half, cliffH, riseW });
    }
    computeGaps();
  }

  // the cay prefers water off a sandy shore (its reef gardens follow it)
  let cayAz = 0, cayScore = -Infinity;
  for (let i = 0; i < 30; i++) {
    const a = r() * Math.PI * 2;
    const s = -cliffK(a);
    if (s > cayScore) { cayScore = s; cayAz = a; }
  }
  const cayR = shoreRadius(cayAz) + 35 + r() * 6;
  CAY_POS = { x: Math.cos(cayAz) * cayR, z: Math.sin(cayAz) * cayR };

  reseedPeaks();

  // world extents for the baked maps + ocean bands
  let mn = Infinity, mx = 0;
  for (let i = 0; i < 720; i++) {
    const s = shoreRadius((i / 720) * Math.PI * 2);
    if (s < mn) mn = s;
    if (s > mx) mx = s;
  }
  SHORE_RANGE = { min: mn, max: mx };
  HMAP_HALF_V = Math.ceil(mx + 100);

  reseedLagoons();
  reseedTrails(); // after the ponds: the route reads their banks
}

// Mountains. The primary peak leans into the widest cliff arc so the range
// meets the sea in rock; every candidate is scored by how much sandy-shore
// clearance it leaves (keep-best, never unplaced), so the beaches and their
// forest fringe always fit between mountain foot and sand.
function reseedPeaks() {
  const pr = mulberry32(subSeed('peaks'));
  PEAKS = [];
  const n = 2 + (pr() < 0.5 ? 1 : 0);

  const sandyClearance = (px, pz) => {
    let clear = Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      if (cliffK(a) > 0.3) continue;
      const sr = shoreRadius(a);
      const dx = px - Math.cos(a) * sr, dz = pz - Math.sin(a) * sr;
      const dd = Math.hypot(dx, dz);
      if (dd < clear) clear = dd;
    }
    return clear;
  };

  const finishPeak = (x, z, h, rx, rz, ang, shelfR) => ({
    x, z, h, rx, rz,
    ridgeAng: ang,
    cosA: Math.cos(ang), sinA: Math.sin(ang),
    shelfR,
    bb: Math.max(rx, rz) * 1.02,
  });

  // primary: tallest, aimed at the widest cliff arc
  const hP = 55 + pr() * 20;
  const rxP = (1.35 + pr() * 0.65) * hP;
  const rzP = (0.70 + pr() * 0.25) * rxP;
  const arc = ARCS.reduce((w, a) => (a.half > w.half ? a : w), ARCS[0]);
  let bx = 0, bz = 0, bAng = arc.az, bScore = -Infinity;
  for (let i = 0; i < 40; i++) {
    const azC = arc.az + (pr() - 0.5) * arc.half * 1.2;
    const rr = shoreRadius(azC) - (0.55 + pr() * 0.35) * rxP;
    const px = Math.cos(azC) * rr, pz = Math.sin(azC) * rr;
    const score = Math.min(
      sandyClearance(px, pz) - (rxP * 0.75 + 35), // room for beach + forest fringe
      rr - rxP * 0.2                              // don't drift past the far shore
    );
    if (score > bScore) { bScore = score; bx = px; bz = pz; bAng = azC; }
  }
  const ridgeAng = bAng + (pr() - 0.5) * 0.6;
  PEAKS.push(finishPeak(bx, bz, hP, rxP, rzP, ridgeAng, 7));

  // secondary: shoulders off along the ridge, toward the interior
  {
    const h2 = hP * (0.55 + pr() * 0.2);
    const rx2 = (1.4 + pr() * 0.5) * h2;
    const rz2 = (0.7 + pr() * 0.25) * rx2;
    const dist = (rxP + rx2) * 0.55;
    // walk the ridge in whichever direction heads inland
    const ca = Math.cos(ridgeAng), sa = Math.sin(ridgeAng);
    const sgn = Math.hypot(bx + ca * dist, bz + sa * dist)
      < Math.hypot(bx - ca * dist, bz - sa * dist) ? 1 : -1;
    PEAKS.push(finishPeak(
      bx + ca * dist * sgn, bz + sa * dist * sgn,
      h2, rx2, rz2, ridgeAng + (pr() - 0.5) * 0.5, 0
    ));
  }

  // an optional third hill-mountain, free-placed where it crowds nothing
  if (n > 2) {
    const h3 = hP * (0.35 + pr() * 0.15);
    const rx3 = (1.4 + pr() * 0.5) * h3;
    const rz3 = (0.75 + pr() * 0.2) * rx3;
    let tx = 0, tz = 0, tAng = 0, tScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const a = pr() * Math.PI * 2;
      const rr = (0.30 + pr() * 0.35) * BASE_R;
      const px = Math.cos(a) * rr, pz = Math.sin(a) * rr;
      let crowd = Infinity;
      for (const P of PEAKS) {
        crowd = Math.min(crowd, Math.hypot(px - P.x, pz - P.z) - (P.rx + rx3) * 0.55);
      }
      const score = Math.min(crowd, sandyClearance(px, pz) - (rx3 * 0.75 + 30));
      if (score > tScore) { tScore = score; tx = px; tz = pz; tAng = a; }
    }
    PEAKS.push(finishPeak(tx, tz, h3, rx3, rz3, tAng + Math.PI / 2, 0));
  }
}

// Freshwater ponds in the island's interior valleys: each one a dish scooped
// out of a low hollow, ringed by a low berm. The hunt samples the whole
// interior and keeps the lowest qualifying spot — never a mountain flank,
// never inside a peak's footprint.
function reseedLagoons() {
  LAGOONS = []; // islandHeight() must run un-carved while we scout for sites
  const lr = mulberry32(subSeed('lagoon'));

  const hunt = (rOuter) => {
    let best = null;
    for (let i = 0; i < 420; i++) {
      const az = lr() * Math.PI * 2;
      const rr = Math.sqrt(lr()) * Math.max(shoreRadius(az) - 45, 20);
      const x = Math.cos(az) * rr, z = Math.sin(az) * rr;
      const inland = shoreRadius(Math.atan2(z, x)) - Math.hypot(x, z);
      if (inland < rOuter + 10) continue;
      if (LAGOONS.some((P) => Math.hypot(x - P.x, z - P.z) < P.rOuter + rOuter + 7)) continue;
      let nearPeak = false;
      for (const P of PEAKS) {
        if (Math.hypot(x - P.x, z - P.z) < Math.max(P.rx, P.rz) * 1.05) { nearPeak = true; break; }
      }
      if (nearPeak) continue;
      const h = islandHeight(x, z);
      if (h < 2.6) continue;  // needs elevation to hold water above the sea
      if (h > 14) continue;   // a pond lives in a valley, not on a shoulder
      if (!best || h < best.h) best = { x, z, h };
    }
    return best;
  };

  const dig = (rW, depth, w1, w2) => {
    const rOuter = rW * 1.75;         // dish + berm footprint
    const best = hunt(rOuter);
    if (!best) return false;
    LAGOONS.push({
      x: best.x, z: best.z, rW, rOuter,
      level: best.h - 0.05,
      depth, w1, w2,
      rBerm: rW * 1.35,
      wBerm: rW * 0.7,
      hBerm: 0.55 + lr() * 0.3,
    });
    return true;
  };

  // the main pond (draw order preserved from v1)
  dig(6.4 + lr() * 2.4, 0.8 + lr() * 0.28, lr() * Math.PI * 2, lr() * Math.PI * 2);
  // a smaller sister pond, some islands only
  if (lr() < 0.45) {
    dig(4.0 + lr() * 1.8, 0.55 + lr() * 0.25, lr() * Math.PI * 2, lr() * Math.PI * 2);
  }

  const A = LAGOONS[0], B = LAGOONS[1];
  uniforms.uLagoon.value.set(A ? A.x : 0, A ? A.z : 0, A ? A.rOuter : 0, A ? A.level : 0);
  uniforms.uLagoon2.value.set(B ? B.x : 0, B ? B.z : 0, B ? B.rOuter : 0, B ? B.level : 0);
}
reseedIsland();

// The primary pond — { x, z, rW, rOuter, level, depth } or null. The fig
// and the debug pondside view anchor to this one.
export function lagoonInfo() {
  return LAGOONS.length ? { ...LAGOONS[0] } : null;
}

// Every pond on this island (possibly empty).
export function lagoonsInfo() {
  return LAGOONS.map((L) => ({ ...L }));
}

// Depth of standing fresh water at (x, z) — 0 outside every pond.
export function lagoonDepth(x, z) {
  let d = 0;
  for (const L of LAGOONS) {
    if (Math.hypot(x - L.x, z - L.z) > L.rOuter) continue;
    d = Math.max(d, L.level - islandHeight(x, z));
  }
  return d;
}

// How far (x, z) stands above the nearest pond surface — negative under
// water, +Infinity outside every basin. Prop placement uses this to stay
// out of the ponds (or, for reeds, to hug their margins).
export function lagoonFreeboard(x, z) {
  let fb = Infinity;
  for (const L of LAGOONS) {
    if (Math.hypot(x - L.x, z - L.z) > L.rOuter) continue;
    fb = Math.min(fb, islandHeight(x, z) - L.level);
  }
  return fb;
}

// Height of whatever water surface stands over (x, z): the tidal sea, or a
// pond where it sits higher. Player physics and footprints use this so the
// ponds wade and block exactly like the sea does.
export function waterLevelAt(x, z) {
  let level = uniforms.uTide.value;
  for (const L of LAGOONS) {
    if (Math.hypot(x - L.x, z - L.z) > L.rOuter) continue;
    level = Math.max(level, L.level);
  }
  return level;
}

// polynomial smooth-max (mirror of the usual smin)
function smax(a, b, k) {
  const t = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return a * (1 - t) + b * t + k * t * (1 - t);
}
// hoisted like smax: reseedIsland() runs at module load, and the lagoon
// hunt + trail routing sample islandHeight before this line would run
function smin(a, b, k) { return -smax(-a, -b, k); }

// Rolling hills + mountains — the island interior, past the beach apron.
function interiorField(x, z) {
  const H01 = 0.5 + 0.5 * noise.fbm(x * 0.010, z * 0.010, 4);
  let h = 3.2 + 12.5 * Math.pow(Math.max(H01, 0), 1.35)
    + 1.6 * noise.fbm(x * 0.045, z * 0.045, 3);
  for (let i = 0; i < PEAKS.length; i++) {
    const P = PEAKS[i];
    const dx = x - P.x, dz = z - P.z;
    if (Math.abs(dx) > P.bb || Math.abs(dz) > P.bb) continue;
    const xr = (dx * P.cosA + dz * P.sinA) / P.rx;
    const zr = (-dx * P.sinA + dz * P.cosA) / P.rz;
    const u2 = xr * xr + zr * zr;
    if (u2 >= 1) continue;
    const s = 1 - u2;
    // the fbm wobble scales with u so the apex is exactly P.h — the summit
    // shelf blend below then has nothing steep to fight
    const m = P.h * s * s * (1 + 0.22 * Math.sqrt(u2) * noise.fbm(x * 0.02, z * 0.02, 3));
    h = smax(h, m, 10);
  }
  return h;
}

// World-space terrain height (y) at (x, z). Water level is y = 0.
export function islandHeight(x, z) {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const d = r - shoreRadius(theta); // signed dist to shoreline: - inland, + offshore

  let h;
  let fineK = 1; // fine-detail gain (the summit shelf and trails calm it)
  if (d >= 0) {
    // offshore stays byte-identical to v1: gentle turquoise shelf, then a
    // drop-off to the sea floor — every reef/sealife depth gate depends on it
    const shelf = Math.min(d, 80) * 0.055;
    const drop = 10.0 * THREE.MathUtils.smoothstep(d, 30, 78);
    h = -(shelf + drop);
    // subtle offshore sand bars
    h += Math.exp(-((d - 13) ** 2) / 90) * 0.28 * Math.sin(d * 0.7 + theta * 3.0);
  } else {
    const t = -d; // meters inland
    const cK = cliffK(theta); // sets _cH/_cW for the dominant arc

    // sandy profile: the original beach apron, blending into the interior
    const wIn = t <= 32 ? 0 : t >= 70 ? 1 : sstep(32, 70, t);
    let hBeach = 0;
    if (wIn < 1) {
      // beach climbing into a low dune plateau — EXACT v1 formula
      hBeach = 4.6 * Math.tanh((t * 0.085) / 4.6 * 3.2);
      const duneAmp = Math.min(t / 16, 1) * 1.35;
      hBeach += duneAmp * noise.fbm(x * 0.045, z * 0.045, 4);
    }
    let hInt = 0;
    let hasInt = false;
    if (wIn > 0) { hInt = interiorField(x, z); hasInt = true; }
    h = hBeach + (hInt - hBeach) * wIn;

    // cliff profile: no apron — rock climbs straight out of the sea onto a
    // headland shelf that hands over to the interior
    if (cK > 0.002) {
      if (!hasInt) hInt = interiorField(x, z);
      const face = _cH * Math.pow(sstep(0, _cW, t + 1.5), 0.8)
        + 0.9 * noise.fbm(x * 0.11, z * 0.11, 3) * sstep(2, _cW, t);
      const top = smax(hInt, _cH * (1 - sstep(_cW, _cW + 60, t)), 5);
      const hCliff = face + (top - face) * sstep(_cW * 0.8, _cW + 8, t);
      h += (hCliff - h) * cK;
    }
  }

  // the sandbar cay rises smoothly out of the shelf
  const dc = Math.hypot(x - CAY_POS.x, z - CAY_POS.z);
  if (dc < 26) {
    const p = 0.38 - 3.0 * (dc / 20) * (dc / 20);
    h = smax(h, p, 0.5);
  }

  // the interior ponds: dishes scooped out with smooth-min so their banks
  // blend into the ground instead of cutting crater lips
  for (let li = 0; li < LAGOONS.length; li++) {
    const L = LAGOONS[li];
    const dx = x - L.x, dz = z - L.z;
    const dl = Math.hypot(dx, dz);
    if (dl < L.rOuter * 1.8) {
      const ang = Math.atan2(dz, dx);
      // wobble the radius so the pond is kidney-shaped, not a bullseye
      const rW = L.rW
        * (1 + 0.15 * Math.sin(3 * ang + L.w1) + 0.08 * Math.sin(5 * ang + L.w2));
      const u = dl / rW;
      const out = Math.max(0, u - 1);
      const bowl = L.level - L.depth + L.depth * u * u + 2.6 * out * out;
      h = smin(h, bowl, 1.1);

      // low berm just outside the waterline, wobbled so it isn't a donut.
      // smax means it only shows up where the ground is already too low.
      const t = (dl - L.rBerm) / L.wBerm;
      const berm = L.level + L.hBerm * (1 + 0.4 * Math.sin(3 * ang + L.w2))
        - 1.8 * t * t;
      h = smax(h, berm, 0.9);
    }
  }

  // the summit shelf: a guaranteed-flat crown on the tallest peak, so the
  // cairn and campfire always have level ground with a view
  if (PEAKS.length) {
    const P = PEAKS[0];
    const dx = x - P.x, dz = z - P.z;
    const d2 = dx * dx + dz * dz;
    const rOut = P.shelfR + 6;
    if (d2 < rOut * rOut) {
      const sM = 1 - sstep(P.shelfR, rOut, Math.sqrt(d2));
      h += (P.h - h) * sM;
      fineK *= 1 - 0.85 * sM;
    }
  }

  // the footpath: blend the ground onto the grade-relaxed trail profile —
  // a bench cut into slopes, a causeway over dips, walkable end to end.
  // Deep cuts widen their mouth so a crossing reads as a ravine with
  // shouldered sides, never a vertical slot.
  if (TRAILGRID && trailQueryFast(x, z)) {
    const cut = Math.abs(_tqY - h);
    const out = Math.min(Math.max(CARVE_OUT, cut * 0.85), 9);
    const m = 1 - sstep(CARVE_IN, out, _tqD);
    if (m > 0) {
      h += (_tqY - h) * m;
      fineK *= 1 - 0.7 * m;
    }
  }

  // fine surface detail everywhere (fades in deep water)
  const fine = noise.fbm(x * 0.35, z * 0.35, 3) * 0.11
    + noise.fbm(x * 0.09, z * 0.09, 3) * 0.22;
  h += fine * THREE.MathUtils.clamp(1 - (-h - 4) / 6, 0.25, 1) * fineK;

  return h;
}

export function islandNormal(x, z, eps = 0.35) {
  const hx = islandHeight(x + eps, z) - islandHeight(x - eps, z);
  const hz = islandHeight(x, z + eps) - islandHeight(x, z - eps);
  return new THREE.Vector3(-hx / (2 * eps), 1, -hz / (2 * eps)).normalize();
}

// Allocation-free normal.y — the gate hot placement loops and the player's
// slope rule actually need (1 = flat, 0 = vertical).
export function islandSlopeY(x, z, eps = 0.6) {
  const gx = (islandHeight(x + eps, z) - islandHeight(x - eps, z)) / (2 * eps);
  const gz = (islandHeight(x, z + eps) - islandHeight(x, z - eps)) / (2 * eps);
  return 1 / Math.sqrt(gx * gx + gz * gz + 1);
}

// ------------------------------------------------------------------ biomes
// One classification shared by the CPU (placement, footprints, audio) and
// the baked mask the ground shader samples — they can never disagree.
function classifyWeights(x, z, h, slopeY, out) {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const t = shoreRadius(theta) - r; // + inland
  const cK = cliffK(theta);

  let sand;
  if (t <= 0) {
    sand = 1; // seafloor and the water's edge are always sand
  } else {
    sand = (1 - sstep(28, 55, t)) * (1 - cK * 0.85);
  }
  for (const L of LAGOONS) {
    const dl = Math.hypot(x - L.x, z - L.z);
    if (dl < L.rOuter * 1.35) {
      sand = Math.max(sand, 1 - sstep(L.rOuter * 0.95, L.rOuter * 1.35, dl));
    }
  }
  const dc = Math.hypot(x - CAY_POS.x, z - CAY_POS.z);
  if (dc < 26) sand = Math.max(sand, 1 - sstep(14, 24, dc));

  // the dirt ribbon paints the walkable bench, not its cut walls
  const trail = trailMask(x, z) * (1 - sstep(0.35, 0.55, 1 - slopeY));
  const steep = sstep(0.13, 0.34, 1 - slopeY);                 // rock from ~30°
  // the cliff-face band goes full rock only where the ground actually
  // tilts — the flat headland shelf keeps a heathy mix
  const face = cK * sstep(2, 8, t) * (1 - sstep(_cW + 20, _cW + 60, t))
    * (0.4 + 0.6 * sstep(0.05, 0.18, 1 - slopeY));
  const alt = sstep(26, 34, h) * (0.55 + 0.45 * sstep(0.04, 0.15, 1 - slopeY));
  const rock = Math.min(Math.max(steep, Math.max(face, alt)), 1) * (1 - trail);

  const forest = sstep(38, 58, t)
    * sstep(3.0, 5.0, h) * (1 - sstep(22, 28, h))
    * (1 - sstep(0.10, 0.20, 1 - slopeY))
    * (1 - rock) * (1 - Math.min(sand, 1)) * (1 - trail);

  out.sand = Math.max(sand * (1 - rock) * (1 - trail), 0);
  out.trail = trail;
  out.rock = rock;
  out.forest = Math.max(forest, 0);
  out.t = t;
  out.cliffK = cK;
  return out;
}

// Cheap biome classification at a point. Pass pre.h / pre.slopeY when the
// caller already knows them (the bake does) to skip the height samples.
export function biomeAt(x, z, pre) {
  const h = pre && pre.h !== undefined ? pre.h : islandHeight(x, z);
  const slopeY = pre && pre.slopeY !== undefined ? pre.slopeY : islandSlopeY(x, z);
  const w = classifyWeights(x, z, h, slopeY, {
    sand: 0, trail: 0, rock: 0, forest: 0, t: 0, cliffK: 0,
  });
  let kind = 'meadow';
  if (w.t <= 0) kind = 'seafloor';
  else if (w.trail > 0.5) kind = 'trail';
  else if (w.rock >= Math.max(w.sand, w.forest, 0.45)) kind = 'rock';
  else if (w.sand >= Math.max(w.forest, 0.45)) kind = 'beach';
  else if (w.forest > 0.35) kind = 'forest';
  return {
    kind,
    w: { sand: w.sand, trail: w.trail, rock: w.rock, forest: w.forest },
    t: w.t, cliffK: w.cliffK, slopeY, h,
  };
}

// ------------------------------------------------------------------ baked maps
// One pass of islandHeight feeds two textures: the half-float heightmap the
// water shader samples for depth, and an RGBA biome mask (R sand, G trail,
// B rock, A forest) the ground shader blends by. Both cover ±hmapHalf().
export function bakeMaps(size = 1024) {
  const HH = HMAP_HALF_V;
  const hs = new Float32Array(size * size);
  const hdata = new Uint16Array(size * size);
  for (let j = 0; j < size; j++) {
    const z = (j / (size - 1) - 0.5) * 2 * HH;
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1) - 0.5) * 2 * HH;
      const h = islandHeight(x, z);
      hs[j * size + i] = h;
      hdata[j * size + i] = THREE.DataUtils.toHalfFloat(h);
    }
  }
  const heightTex = new THREE.DataTexture(hdata, size, size, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.generateMipmaps = false;
  heightTex.needsUpdate = true;

  // biome mask from the heights already in hand — zero extra islandHeight calls
  const bdata = new Uint8Array(size * size * 4);
  const texel = (2 * HH) / (size - 1);
  const W = { sand: 0, trail: 0, rock: 0, forest: 0, t: 0, cliffK: 0 };
  for (let j = 0; j < size; j++) {
    const z = (j / (size - 1) - 0.5) * 2 * HH;
    const j0 = Math.max(j - 1, 0) * size, j1 = Math.min(j + 1, size - 1) * size;
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1) - 0.5) * 2 * HH;
      const idx = j * size + i;
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, size - 1);
      const gx = (hs[j * size + i1] - hs[j * size + i0]) / ((i1 - i0) * texel);
      const gz = (hs[j1 + i] - hs[j0 + i]) / (((j1 - j0) / size) * texel);
      const slopeY = 1 / Math.sqrt(gx * gx + gz * gz + 1);
      classifyWeights(x, z, hs[idx], slopeY, W);
      const k = idx * 4;
      bdata[k] = Math.round(W.sand * 255);
      bdata[k + 1] = Math.round(W.trail * 255);
      bdata[k + 2] = Math.round(W.rock * 255);
      bdata[k + 3] = Math.round(W.forest * 255);
    }
  }
  const biomeTex = new THREE.DataTexture(bdata, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  biomeTex.magFilter = biomeTex.minFilter = THREE.LinearFilter;
  biomeTex.wrapS = biomeTex.wrapT = THREE.ClampToEdgeWrapping;
  biomeTex.generateMipmaps = false;
  biomeTex.needsUpdate = true;

  return { heightTex, biomeTex, half: HH };
}

// ------------------------------------------------------------------ terrain mesh
// The ground is a grid of world-space chunk meshes sharing one material:
// fine (1.5m) over the island and its nearshore, coarse (6m) across the
// outer seabed, skipped entirely once the deep floor flattens out. Chunks
// frustum-cull individually — a mountain island can't be one giant mesh.
const CHUNK = 48;

function chunkGeometry(x0, z0, segs, skirt) {
  const pitch = CHUNK / segs;
  const n = segs + 1;
  // sample a lattice one ring wider than the chunk for seam-exact normals
  const ln = segs + 3;
  const lat = new Float32Array(ln * ln);
  for (let j = 0; j < ln; j++) {
    const z = z0 + (j - 1) * pitch;
    for (let i = 0; i < ln; i++) {
      lat[j * ln + i] = islandHeight(x0 + (i - 1) * pitch, z);
    }
  }

  const skirtVerts = skirt ? 4 * n : 0;
  const pos = new Float32Array((n * n + skirtVerts) * 3);
  const nrm = new Float32Array((n * n + skirtVerts) * 3);
  const uv = new Float32Array((n * n + skirtVerts) * 2);
  const idx = [];
  const TILE = 5.2;

  for (let j = 0; j < n; j++) {
    const z = z0 + j * pitch;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch;
      const v = j * n + i;
      const li = (j + 1) * ln + (i + 1);
      pos[v * 3] = x;
      pos[v * 3 + 1] = lat[li];
      pos[v * 3 + 2] = z;
      const hx = (lat[li + 1] - lat[li - 1]) / (2 * pitch);
      const hz = (lat[li + ln] - lat[li - ln]) / (2 * pitch);
      const inv = 1 / Math.sqrt(hx * hx + hz * hz + 1);
      nrm[v * 3] = -hx * inv;
      nrm[v * 3 + 1] = inv;
      nrm[v * 3 + 2] = -hz * inv;
      uv[v * 2] = x / TILE;
      uv[v * 2 + 1] = z / TILE;
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i, b = a + 1, c = a + n, dd = c + 1;
      idx.push(a, c, b, b, c, dd); // wound to face +Y
    }
  }

  // skirt: the rim ring extruded 1.2m down, hiding fine/coarse T-junction
  // cracks along the deep-water band
  if (skirt) {
    const edges = [
      { walk: (k) => k, out: [0, -1] },                    // -z edge, left→right
      { walk: (k) => (n - 1) * n + (n - 1 - k), out: [0, 1] }, // +z edge, right→left
      { walk: (k) => (n - 1 - k) * n, out: [-1, 0] },      // -x edge, far→near
      { walk: (k) => k * n + (n - 1), out: [1, 0] },       // +x edge, near→far
    ];
    let sv = n * n;
    for (const e of edges) {
      const base = sv;
      for (let k = 0; k < n; k++) {
        const rim = e.walk(k);
        pos[sv * 3] = pos[rim * 3];
        pos[sv * 3 + 1] = pos[rim * 3 + 1] - 1.2;
        pos[sv * 3 + 2] = pos[rim * 3 + 2];
        nrm[sv * 3] = e.out[0];
        nrm[sv * 3 + 1] = 0;
        nrm[sv * 3 + 2] = e.out[1];
        uv[sv * 2] = pos[rim * 3] / TILE;
        uv[sv * 2 + 1] = pos[rim * 3 + 2] / TILE;
        sv++;
      }
      for (let k = 0; k < n - 1; k++) {
        const r0 = e.walk(k), r1 = e.walk(k + 1);
        const s0 = base + k, s1 = base + k + 1;
        // each edge walks with the chunk on its LEFT, so rim→skirt quads
        // wound this way face outward
        idx.push(r0, r1, s0, r1, s1, s0);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

export function buildTerrain(maps) {
  const mat = buildTerrainMaterial(maps);
  const group = new THREE.Group();
  group.name = 'terrain';

  const reach = SHORE_RANGE.max + 90; // last chunk ring: seabed flattening out
  const half = Math.ceil(reach / CHUNK);
  for (let cj = -half; cj < half; cj++) {
    for (let ci = -half; ci < half; ci++) {
      const x0 = ci * CHUNK, z0 = cj * CHUNK;
      // classify from a coarse lattice of signed shore distances
      let dMin = Infinity;
      for (let j = 0; j <= 4; j++) {
        for (let i = 0; i <= 4; i++) {
          const x = x0 + (i / 4) * CHUNK, z = z0 + (j / 4) * CHUNK;
          const d = Math.hypot(x, z) - shoreRadius(Math.atan2(z, x));
          if (d < dMin) dMin = d;
        }
      }
      if (dMin > 90) continue; // flat deep floor: the ocean covers it
      // the cay is a walkable islet — keep it on the fine grid
      const ccx = x0 + CHUNK / 2 - CAY_POS.x, ccz = z0 + CHUNK / 2 - CAY_POS.z;
      const nearCay = Math.hypot(ccx, ccz) < 26 + CHUNK * 0.75;
      const fine = dMin < 35 || nearCay;

      const geo = chunkGeometry(x0, z0, fine ? 32 : 8, !fine);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      // only ground that can throw a real shadow (hills, mountains) joins
      // the shadow pass — beach chunks would just burn fill rate
      let maxH = -Infinity;
      const p = geo.attributes.position;
      for (let i = 1; i < p.count * 3; i += 3) if (p.array[i] > maxH) maxH = p.array[i];
      mesh.castShadow = maxH > 12;
      group.add(mesh);
    }
  }
  return group;
}

function buildTerrainMaterial(maps) {
  const { map, normalMap } = sandTextures();
  const TILE = 5.2; // meters per texture repeat
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 1); // chunk UVs are world-space (x/TILE, z/TILE) already
  normalMap.repeat.set(1, 1);

  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.88,
    metalness: 0.0,
  });

  const caustics = causticTexture();
  const breakup = foamTexture(); // reused as a generic tileable noise mask
  const grassMap = forestFloorTexture();
  const rockMap = rockTexture();

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSunI = uniforms.uSunI;
    shader.uniforms.uNightF = uniforms.uNightF;
    shader.uniforms.uTide = uniforms.uTide;
    shader.uniforms.uTideAng = uniforms.uTideAng;
    shader.uniforms.uRainWet = uniforms.uRainWet;
    shader.uniforms.uLagoon = uniforms.uLagoon;
    shader.uniforms.uLagoon2 = uniforms.uLagoon2;
    shader.uniforms.uCaustic = { value: caustics };
    shader.uniforms.uBreakup = { value: breakup };
    shader.uniforms.uGrassMap = { value: grassMap };
    shader.uniforms.uRockMap = { value: rockMap };
    shader.uniforms.uBiome = { value: maps.biomeTex };
    shader.uniforms.uBiomeHalf = { value: maps.half };
    Object.assign(shader.uniforms, swashUniforms);

    shader.vertexShader = `
      varying vec3 vWPos;
      varying vec3 vNrmW;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vNrmW = normalize(mat3(modelMatrix) * objectNormal);`
    );

    shader.fragmentShader = `
      uniform float uTime;
      uniform float uSunI;
      uniform float uNightF;
      uniform float uTide;
      uniform float uTideAng;
      uniform float uRainWet;
      uniform vec4 uLagoon;
      uniform vec4 uLagoon2;
      uniform sampler2D uCaustic;
      uniform sampler2D uBreakup;
      uniform sampler2D uGrassMap;
      uniform sampler2D uRockMap;
      uniform sampler2D uBiome;
      uniform float uBiomeHalf;
      uniform vec4 uZone1;
      uniform float uZone1Ph;
      uniform vec4 uZone2;
      uniform float uZone2Ph;
      uniform vec2 uAmbient;
      uniform float uDrySecs;
      varying vec3 vWPos;
      varying vec3 vNrmW;
      float bhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      ${SWASH_GLSL}
    ` + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // large-scale tonal variation to break texture tiling
          float macro = texture2D(uBreakup, vWPos.xz * 0.012).r;
          float macro2 = texture2D(uBreakup, vWPos.xz * 0.05 + 17.3).r;
          diffuseColor.rgb *= mix(vec3(0.90, 0.87, 0.80), vec3(1.10, 1.06, 0.99), macro);
          diffuseColor.rgb *= mix(1.0, 0.90, smoothstep(0.62, 0.9, macro2));

          // --- biome blend: sand → forest floor → rock → trail dirt ---
          // weights come from the baked mask (R sand, G trail, B rock,
          // A forest); slope-rock is sharpened per-fragment off the real
          // normal so cliff faces stay crisp between mask texels.
          vec2 buv = (vWPos.xz + uBiomeHalf) / (2.0 * uBiomeHalf);
          vec4 bio = texture2D(uBiome, buv);
          vec3 nrmW = normalize(vNrmW);
          float slopeRock = smoothstep(0.16, 0.34, 1.0 - nrmW.y);
          float rockW = min(max(bio.b, slopeRock) * (1.0 - bio.g), 1.0);
          float trailW = bio.g;
          float forestW = bio.a * (1.0 - rockW) * (1.0 - trailW);
          float sandW = clamp(bio.r * (1.0 - rockW) * (1.0 - trailW), 0.0, 1.0);
          // whatever's left inland reads as dry meadow grass
          float meadowW = clamp(1.0 - sandW - rockW - trailW - forestW, 0.0, 1.0);

          vec3 grassC = texture2D(uGrassMap, vWPos.xz / 7.5).rgb;
          // rock: strata band in a vertical plane on faces, flat map on tops
          // (a pure vertical projection smears one texel row across level
          // ground as streaks)
          vec2 ruv = (abs(nrmW.x) > abs(nrmW.z) ? vWPos.zy : vWPos.xy) / 9.0;
          vec3 rockV = texture2D(uRockMap, ruv).rgb;
          vec3 rockH = texture2D(uRockMap, vWPos.xz / 9.0).rgb;
          vec3 rockC = mix(rockV, rockH, smoothstep(0.5, 0.8, nrmW.y));
          vec3 meadowC = mix(grassC, vec3(0.62, 0.58, 0.34), 0.45); // sun-dried grass

          vec3 ground = diffuseColor.rgb;
          ground = mix(ground, meadowC * (0.8 + 0.4 * macro), meadowW);
          ground = mix(ground, grassC * (0.82 + 0.36 * macro), forestW);
          ground = mix(ground, rockC * (0.88 + 0.24 * macro), rockW);
          ground = mix(ground, diffuseColor.rgb * vec3(0.72, 0.60, 0.48), trailW);
          diffuseColor.rgb = ground;
          vSandW = sandW;

          // --- wet sand from the shared swash model ---
          // ragged wet line: jitter the effective height with noise.
          // hAbs is absolute; hEff is height above the *current* waterline.
          float hAbs = vWPos.y + (macro2 - 0.5) * 0.16;
          float hEff = hAbs - uTide;
          float az = atan(vWPos.z, vWPos.x);
          float H1 = uZone1.z * sw_angFall(az, uZone1.x, uZone1.y);
          float H2 = uZone2.z * sw_angFall(az, uZone2.x, uZone2.y);
          float lc = sw_lastCover(hEff, uAmbient.x, uAmbient.y, 0.0, uTime);
          lc = max(lc, sw_lastCover(hEff, H1, uZone1.w, uZone1Ph, uTime));
          lc = max(lc, sw_lastCover(hEff, H2, uZone2.w, uZone2Ph, uTime));
          float since = max(uTime - lc, 0.0);
          float wet = pow(exp(-since / uDrySecs), 0.72); // stays dark, then lets go
          // the ebbing tide leaves broad flats that dry much more slowly
          float sinceTide = sw_tideSince(hAbs, uAmbient.x * 0.7, uTideAng);
          wet = max(wet, pow(exp(-sinceTide / (uDrySecs * 3.2)), 0.72));
          wet = max(wet, 1.0 - smoothstep(0.0, 0.15, hEff)); // saturated fringe
          // rain soaks the whole island; uRainWet decays slowly after a squall
          wet = max(wet, uRainWet * (0.72 + 0.28 * macro));

          // the interior ponds have their own, permanently wet shorelines
          float lmask = 0.0, lsub = 0.0;
          for (int li = 0; li < 2; li++) {
            vec4 L = li == 0 ? uLagoon : uLagoon2;
            if (L.z <= 0.0) continue;
            float dl = length(vWPos.xz - L.xy);
            float m = 1.0 - smoothstep(L.z * 0.95, L.z * 1.3, dl);
            float ls = L.w - hAbs;             // + = under fresh water
            wet = max(wet, m * smoothstep(-0.25, 0.0, ls));
            lmask = max(lmask, m);
            lsub = max(lsub, m * max(0.0, ls));
          }
          wet = clamp(wet, 0.0, 1.0);

          // wet sand: much darker, slightly warm, water-saturated
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.44, 0.415, 0.39), wet);

          // fizzing foam residue left just behind a retreating wave
          float fpB = texture2D(uBreakup, vWPos.xz * 0.55).r;
          float resid = exp(-since / 2.4) * (1.0 - step(hEff, 0.02));
          if (resid > 0.01) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.91, 0.94, 0.93),
              smoothstep(0.55, 0.85, fpB) * resid * 0.55);
          }
          // bioluminescent film: a glowing strip chasing the retreating swash
          // (rises just after a spot is uncovered, gone ~2s later)
          vBio = smoothstep(0.03, 0.35, since) * exp(-since / 1.1)
            * (1.0 - step(hEff, 0.01))
            * (0.25 + 0.75 * smoothstep(0.45, 0.85, fpB));

          // underwater absorption tint (sea, or a pond standing over it);
          // lsub already carries its pond's margin mask
          float sub = max(max(0.0, uTide - vWPos.y), lsub);
          diffuseColor.rgb *= pow(vec3(0.66, 0.80, 0.84), vec3(min(sub * 0.55, 4.0)));
          vWetness = wet;
          vSub = sub;
          vLagMask = lmask;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.10, vWetness);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // fake caustics dancing on the submerged sand (sea floor or pond bed)
          float sub = vSub;
          float cmask = smoothstep(0.05, 0.5, sub) * (1.0 - smoothstep(1.5, 7.0, sub));
          if (cmask > 0.001) {
            // sea-scale cells are metres wide and read as debris in a pond,
            // so fresh water gets a much finer, gentler pattern
            vec2 cuv = vWPos.xz * mix(0.09, 0.36, vLagMask);
            float ca = texture2D(uCaustic, cuv + uTime * vec2(0.014, 0.021)).r;
            float cb = texture2D(uCaustic, cuv * 1.37 - uTime * vec2(0.019, 0.012)).r;
            float cstr = mix(1.9, 0.8, vLagMask);
            totalEmissiveRadiance += vec3(1.0, 0.97, 0.86) * (ca * cb * cstr) * cmask * uSunI;
          }
          // sand sparkle: sparse micro-facets that glint as the view moves
          // (humus and rock barely glint — the beach keeps the glitter)
          vec3 vdir = normalize(vViewPosition);
          vec2 cell = floor(vWPos.xz * 240.0);
          float g = bhash(cell + floor(vdir.xy * 7.0));
          float glint = smoothstep(0.9975, 1.0, g) * (0.15 + 0.85 * vSandW);
          totalEmissiveRadiance += vec3(1.0, 0.98, 0.9) * glint * (0.22 + vWetness * 0.5) * uSunI;
          // night bioluminescence traces the retreating swash line
          totalEmissiveRadiance += vec3(0.10, 1.55, 1.28) * vBio * uNightF;
        }`
      );

    // declare the bridge variables once, at the top of main()
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      'float vWetness = 0.0;\nfloat vBio = 0.0;\nfloat vSub = 0.0;\nfloat vLagMask = 0.0;\nfloat vSandW = 1.0;\nvoid main() {'
    );
  };
  mat.customProgramCacheKey = () => 'cove-terrain-v8';

  return mat;
}
