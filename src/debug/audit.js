// World-invariant audit: proves a seed grew a correct island. Runs from the
// console as __beach.audit() (this island) or __beach.auditMany([seeds])
// (regrow, check, restore). Checks the terrain contracts (trail grade, the
// flat summit shelf, the preserved beach apron, the untouched offshore
// profile, walkability from spawn to summit) and every placement promise
// (cairn on the summit, fire beside it, hammock sited, wreck on sand, crabs
// and palms on beaches, forest off the path). Zero fails = a healthy island.

import * as THREE from 'three';
import {
  islandHeight, islandNormal, shoreRadius, summitPos, trailInfo, coastInfo,
  isSandyShore, biomeAt, lagoonInfo, lagoonFreeboard, shoreRange, trailQuery,
} from '../world/island.js';
import { SWIM_MAX } from '../player.js';
import { uniforms } from '../core/env.js';

// The relaxed profile is built at ≤16°; sampling straight chords across
// switchback hairpins cuts corners at up to ~29°. The contract that
// matters: no meter of trail ever needs more than a light scramble — far
// under the 50° grade where the climb rule stalls you outright.
const MAX_TRAIL_DEG = 30;
const MAX_TRAIL_GRADE = Math.tan((MAX_TRAIL_DEG * Math.PI) / 180);
const MAX_WALK_GRADE = Math.tan((28 * Math.PI) / 180); // the climb rule + tolerance

export function makeAudit(deps) {
  // deps: { getSeed, setSeed, rebuild, getWorld, scene }

  function audit() {
    const fails = [];
    const notes = {};
    const world = deps.getWorld();
    const s = summitPos();

    // ---- pond ----
    const L = lagoonInfo();
    notes.pond = !!L;
    if (!L) fails.push('no pond dug');

    // ---- trail: finite, grade-bounded on the carved ground ----
    const ti = trailInfo();
    const pts = ti.paths[0] ? ti.paths[0].pts : [];
    if (!pts.length) fails.push('no trail');
    let maxGrade = 0, trailLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (![a.x, a.z, a.y].every(Number.isFinite)) { fails.push('trail NaN @' + i); break; }
      const ds = Math.hypot(b.x - a.x, b.z - a.z);
      if (ds < 0.01) continue;
      trailLen += ds;
      const steps = Math.max(Math.ceil(ds), 1);
      let hp = islandHeight(a.x, a.z);
      for (let k = 1; k <= steps; k++) {
        const u = k / steps;
        const h = islandHeight(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u);
        maxGrade = Math.max(maxGrade, Math.abs(h - hp) / (ds / steps));
        hp = h;
      }
    }
    notes.trail = { lengthM: Math.round(trailLen), maxGradeDeg: +(Math.atan(maxGrade) * 180 / Math.PI).toFixed(1) };
    if (maxGrade > MAX_TRAIL_GRADE) fails.push(`trail grade ${notes.trail.maxGradeDeg}° > ${MAX_TRAIL_DEG}°`);

    // ---- summit shelf: flat enough for the camp ----
    let minNy = 1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, rr = 2 + (i % 3) * 2.4;
      minNy = Math.min(minNy, islandNormal(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr).y);
    }
    notes.shelfMinNy = +minNy.toFixed(3);
    if (minNy < 0.97) fails.push('summit shelf not flat');

    // ---- beach apron + offshore regression (sampled on sandy bearings) ----
    let apronBad = 0, offshoreBad = 0;
    for (let i = 0; i < 48; i++) {
      const az = (i / 48) * Math.PI * 2;
      if (!isSandyShore(az)) continue;
      const sr = shoreRadius(az);
      for (const t of [4, 12, 26]) {
        const h = islandHeight(Math.cos(az) * (sr - t), Math.sin(az) * (sr - t));
        if (h < 0.05 || h > 6.6) apronBad++;
      }
      const h15 = islandHeight(Math.cos(az) * (sr + 15), Math.sin(az) * (sr + 15));
      if (Math.abs(h15 - (-15 * 0.055)) > 0.75) offshoreBad++;
    }
    if (apronBad > 3) fails.push(`beach apron off-profile at ${apronBad} samples`);
    if (offshoreBad > 3) fails.push(`offshore shelf drifted at ${offshoreBad} bearings`);

    // ---- a real cliff coast exists ----
    let cliffMax = 0, cliffAz = 0;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const k = coastInfo(a).cliffK;
      if (k > cliffMax) { cliffMax = k; cliffAz = a; }
    }
    notes.cliffMax = +cliffMax.toFixed(2);
    if (cliffMax < 0.9) fails.push('no full cliff sector');
    else {
      const cr = shoreRadius(cliffAz) - 12;
      if (islandHeight(Math.cos(cliffAz) * cr, Math.sin(cliffAz) * cr) < 7) {
        fails.push('cliff sector too low');
      }
    }

    // ---- walkability flood-fill: spawn reaches everything that matters ----
    {
      const R = shoreRange().max;
      const CELL = 3;
      const half = Math.ceil(R / CELL) + 1;
      const W = half * 2 + 1;
      const hMap = new Float32Array(W * W).fill(NaN);
      const tide = uniforms.uTide.value;
      const hAt = (i, j) => {
        const idx = j * W + i;
        if (Number.isNaN(hMap[idx])) hMap[idx] = islandHeight((i - half) * CELL, (j - half) * CELL);
        return hMap[idx];
      };
      const toCell = (x, z) => [Math.round(x / CELL) + half, Math.round(z / CELL) + half];
      const spawnAz = ti.trailheadAz;
      const [si, sj] = toCell(Math.cos(spawnAz) * (shoreRadius(spawnAz) - 10), Math.sin(spawnAz) * (shoreRadius(spawnAz) - 10));
      const seen = new Uint8Array(W * W);
      const queue = [si + sj * W];
      seen[queue[0]] = 1;
      const drain = () => {
        while (queue.length) {
          const cur = queue.pop();
          const ci = cur % W, cj = (cur - ci) / W;
          const h0 = hAt(ci, cj);
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
            const nidx = nj * W + ni;
            if (seen[nidx]) continue;
            const h1 = hAt(ni, nj);
            if (h1 < tide - 0.7) continue;                       // deep water blocks
            if (Math.abs(h1 - h0) > MAX_WALK_GRADE * CELL) continue; // too steep
            seen[nidx] = 1;
            queue.push(nidx);
          }
        }
      };
      drain();
      // stitch the footpath through the grid: the 3m cells alias the ~3.4m
      // switchback benches away, but walking ALONG the path is already
      // proven by the grade check above — so consecutive trail points
      // conduct reachability, and the fill spreads out from wherever the
      // path delivers you
      for (let round = 0; round < 3; round++) {
        let grew = false;
        for (let i = 0; i < pts.length - 1; i++) {
          const [ai, aj] = toCell(pts[i].x, pts[i].z);
          const [bi, bj] = toCell(pts[i + 1].x, pts[i + 1].z);
          const aIdx = aj * W + ai, bIdx = bj * W + bi;
          const aIn = ai >= 0 && aj >= 0 && ai < W && aj < W;
          const bIn = bi >= 0 && bj >= 0 && bi < W && bj < W;
          if (aIn && bIn && seen[aIdx] !== seen[bIdx]) {
            const t = seen[aIdx] ? bIdx : aIdx;
            seen[t] = 1;
            queue.push(t);
            grew = true;
          }
        }
        if (!grew) break;
        drain();
      }
      const reached = (x, z, what) => {
        // a viewpoint counts as reached from anywhere on its patch of ground
        const [i, j] = toCell(x, z);
        let ok = false;
        for (let dj = -2; dj <= 2 && !ok; dj++) {
          for (let di = -2; di <= 2 && !ok; di++) {
            const ni = i + di, nj = j + dj;
            if (ni >= 0 && nj >= 0 && ni < W && nj < W && seen[nj * W + ni]) ok = true;
          }
        }
        if (!ok) fails.push(what + ' unreachable on foot');
        return ok;
      };
      reached(s.x, s.z, 'summit');
      for (const lo of ti.lookouts) reached(lo.x, lo.z, 'lookout ' + lo.name);
      if (L) reached(L.x + L.rOuter + 3, L.z, 'pond bank');
      for (const f of world.campfire.fires) {
        reached(f.pos.x, f.pos.z, f.where + ' campfire');
      }
    }

    // ---- placements ----
    const center = (mesh) => {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      return mesh.geometry.boundingSphere.center;
    };
    const cairn = deps.scene.getObjectByName('cairn');
    if (cairn) {
      const cp = center(cairn);
      notes.cairnToSummit = +Math.hypot(cp.x - s.x, cp.z - s.z).toFixed(1);
      if (notes.cairnToSummit > 15) fails.push('cairn off the summit');
    } else fails.push('no cairn');
    // two fires: one beside the cairn, one on dry beach sand
    const top = world.campfire.fire('summit').pos;
    if (Math.hypot(top.x - s.x, top.z - s.z) > 15) fails.push('summit campfire off the summit');
    const sand = world.campfire.fire('beach').pos;
    if (biomeAt(sand.x, sand.z).w.sand < 0.4) fails.push('beach campfire off the sand');
    // above the highest tide plus the tallest run-up, with room to spare
    if (sand.y < 1.5) fails.push('beach campfire in the swash');
    if (Math.hypot(sand.x - s.x, sand.z - s.z) < 40) fails.push('the two campfires are the same camp');
    for (const f of world.campfire.fires) {
      if (islandNormal(f.pos.x, f.pos.z).y < 0.955) {
        fails.push(f.where + ' campfire on a slope');
      }
    }
    if (!world.hammock.tryToggle) fails.push('hammock is the no-op stub');
    const wreck = deps.scene.getObjectByName('wreck');
    if (wreck) {
      const wc = center(wreck);
      const bio = biomeAt(wc.x, wc.z);
      if (bio.w.sand < 0.3) fails.push('wreck off the beach');
      if (bio.h < 0.5) fails.push('wreck at the waterline');
    } else fails.push('no wreck');
    for (const t of world.palms.trees) {
      const az = Math.atan2(t.base.z, t.base.x);
      const d = shoreRadius(az) - Math.hypot(t.base.x, t.base.z);
      if (!isSandyShore(az) || d < 1 || d > 65) { fails.push('palm off its beach'); break; }
    }
    for (const c of world.crabs.crabs) {
      if (biomeAt(c.pos.x, c.pos.y).w.sand < 0.25) { fails.push('crab off the sand'); break; }
    }
    const fb = world.fig.base;
    if (fb) {
      const bio = biomeAt(fb.x, fb.z);
      const nearPond = L && Math.hypot(fb.x - L.x, fb.z - L.z) < L.rOuter + 8;
      if (!nearPond && bio.w.forest < 0.2 && bio.kind !== 'meadow') fails.push('fig exiled: ' + bio.kind);
    }
    let forestBad = 0;
    for (let i = 0; i < world.forest.plants.length; i += 8) {
      const p = world.forest.plants[i];
      const bio = biomeAt(p.x, p.z);
      const tq = trailQuery(p.x, p.z);
      if (bio.w.sand > 0.55 || (tq && tq.d < 1.1) || lagoonFreeboard(p.x, p.z) < 0.15) forestBad++;
    }
    if (forestBad > 2) fails.push(`${forestBad} sampled forest plants misplaced`);
    notes.forestPlants = world.forest.plants.length;
    for (const cl of world.reef.clusters) {
      if (cl.h > -1 || cl.h < -7.5) { fails.push('reef cluster out of its depth'); break; }
    }
    if (shoreRange().max + SWIM_MAX > 760) fails.push('boat lap too tight');

    return { seed: deps.getSeed(), pass: fails.length === 0, fails, notes };
  }

  function auditMany(seeds = [2281, 7, 12345, 99999, 5150, 31337, 424242, 808]) {
    const original = deps.getSeed();
    const out = [];
    let detGuard = null;
    for (const sd of seeds) {
      deps.setSeed(sd);
      deps.rebuild();
      out.push(audit());
      // determinism tripwire: the first island, rebuilt again after all the
      // others, must regrow the byte-identical trail (a stale-state leak
      // once made the pond — and the whole route — depend on the PREVIOUS
      // island you regrew from)
      if (detGuard === null) detGuard = JSON.stringify(trailInfo());
    }
    deps.setSeed(seeds[0]);
    deps.rebuild();
    const detOk = JSON.stringify(trailInfo()) === detGuard;
    deps.setSeed(original);
    deps.rebuild();
    const failed = out.filter((r) => !r.pass);
    if (!detOk) failed.push({ seed: seeds[0], pass: false, fails: ['NOT DETERMINISTIC across rebuild order'] });
    return { pass: failed.length === 0, islands: out.length, deterministic: detOk, failed };
  }

  return { audit, auditMany };
}
