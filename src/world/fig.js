// The grandmother fig: one huge old tree at the heart of the island, near
// the lagoon. Buttressed trunk lofted from star-shaped rings, a handful of
// curving limbs, and a broad dome of leaf-cluster cards (alpha-tested quads)
// for the canopy. A rope swing hangs from the lowest limb. Everything merges
// into three draw calls (bark, canopy, swing) and sways via windify.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { islandHeight, islandNormal, lagoonInfo, lagoonFreeboard } from './island.js';
import { figBarkTexture, leafClusterTexture, barkTexture } from '../core/textures.js';
import { MeshData, windify } from './palms.js';

const UP = new THREE.Vector3(0, 1, 0);

// loft a tapering tube along points with a star-shaped (buttressed) base
function loftTrunk(data, pts, radii, buttress, seedRand) {
  const AROUND = 30; // a 5-lobed star needs the sampling
  const rings = [];
  const ph = seedRand() * Math.PI * 2;
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const tangent = (i === 0
      ? pts[1].clone().sub(pts[0])
      : pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[i - 1])).normalize();
    const s1 = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0.3, 0.1, 0.94)).normalize();
    const s2 = new THREE.Vector3().crossVectors(tangent, s1).normalize();
    const ring = [];
    for (let k = 0; k <= AROUND; k++) {
      const a = (k / AROUND) * Math.PI * 2;
      // buttress flanges: radial fins hugging the foot, gone within the
      // first quarter of the trunk (taller reads as a sail, not a root)
      const flange = 1 + buttress * Math.pow(Math.max(Math.cos(5 * a + ph), 0), 2.6) * Math.pow(Math.max(1 - t * 3.4, 0), 1.5);
      const rr = radii[i] * flange;
      const p = pts[i].clone().addScaledVector(s1, Math.cos(a) * rr).addScaledVector(s2, Math.sin(a) * rr);
      ring.push(data.vert(p, k / AROUND * 3, t * 6, [1, 1, 1], t * 0.04, 0));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < AROUND; k++) {
      data.quad(rings[i][k], rings[i][k + 1], rings[i + 1][k], rings[i + 1][k + 1]);
    }
  }
}

// a tapering limb along a quadratic bezier; returns its tip and some
// along-the-way anchor points for foliage
function loftLimb(data, from, ctrl, to, r0, r1, flex0, seedRand) {
  const SEGS = 9, AROUND = 8;
  const rings = [];
  const anchors = [];
  const p = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    pa.copy(from).lerp(ctrl, t);
    pb.copy(ctrl).lerp(to, t);
    p.copy(pa).lerp(pb, t);
    if (t > 0.5) anchors.push(p.clone());
    const tangent = pb.clone().sub(pa).normalize();
    const s1 = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    if (s1.lengthSq() < 0.01) s1.set(1, 0, 0);
    const s2 = new THREE.Vector3().crossVectors(tangent, s1).normalize();
    const rr = r0 + (r1 - r0) * t;
    const flex = flex0 + t * 0.10;
    const ring = [];
    for (let k = 0; k <= AROUND; k++) {
      const a = (k / AROUND) * Math.PI * 2;
      const q = p.clone().addScaledVector(s1, Math.cos(a) * rr).addScaledVector(s2, Math.sin(a) * rr);
      ring.push(data.vert(q, k / AROUND, t * 3, [1, 1, 1], flex, 0));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < AROUND; k++) {
      data.quad(rings[i][k], rings[i][k + 1], rings[i + 1][k], rings[i + 1][k + 1]);
    }
  }
  return { tip: to.clone(), anchors };
}

export function buildFig() {
  const group = new THREE.Group();
  group.name = 'fig';
  const rand = mulberry32(subSeed('fig'));

  // ---- site: on the lagoon's bank, dry, reasonably level ----
  const L = lagoonInfo();
  let base = null;
  if (L) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = rand() * Math.PI * 2;
      const d = L.rOuter + 2.5 + rand() * 3;
      const x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d;
      const h = islandHeight(x, z);
      if (h < 2.7) continue;
      if (lagoonFreeboard(x, z) < 0.55) continue;
      if (islandNormal(x, z).y < 0.94) continue; // no steep bank
      base = new THREE.Vector3(x, h - 0.12, z);   // roots just bedded
      break;
    }
  }
  if (!base) {
    // no lagoon bank worked — take the island's summit area instead
    let bx = 0, bz = 6, bh = -1;
    for (let i = 0; i < 160; i++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 12;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = islandHeight(x, z);
      if (h > bh) { bh = h; bx = x; bz = z; }
    }
    base = new THREE.Vector3(bx, bh - 0.25, bz);
  }

  const bark = new MeshData();
  const canopy = new MeshData();

  // ---- trunk ----
  const height = 4.6 + rand() * 1.1;
  const leanA = rand() * Math.PI * 2;
  const lean = 0.5 + rand() * 0.5;
  const pts = [], radii = [];
  const N = 7;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    pts.push(new THREE.Vector3(
      base.x + Math.cos(leanA) * lean * t * t,
      base.y + height * t,
      base.z + Math.sin(leanA) * lean * t * t
    ));
    radii.push(0.62 * Math.pow(1 - t, 0.72) + 0.16);
  }
  loftTrunk(bark, pts, radii, 1.15, rand);
  const crown = pts[N - 1].clone();

  // ---- limbs + canopy blobs ----
  const limbs = 4 + Math.floor(rand() * 2);
  const cards = [];
  const canopyR = 5.2 + rand() * 1.3;
  let lowLimbTip = null;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rand() * 0.7;
    const spread = canopyR * (0.62 + rand() * 0.3);
    const rise = 1.1 + rand() * 1.1;
    const droop = i === 0 ? -0.4 : 0; // the swing limb runs low and flat
    const to = crown.clone().add(new THREE.Vector3(
      Math.cos(a) * spread, rise + droop, Math.sin(a) * spread));
    const ctrl = crown.clone().add(new THREE.Vector3(
      Math.cos(a) * spread * 0.35, rise * 0.9 + 0.5, Math.sin(a) * spread * 0.35));
    const limb = loftLimb(bark, crown.clone(), ctrl, to, 0.26, 0.07, 0.05, rand);
    if (i === 0) lowLimbTip = { tip: limb.tip.clone(), dir: new THREE.Vector2(Math.cos(a), Math.sin(a)) };

    // foliage blob at the limb end (plus a little along the limb). Cards
    // spread well below the anchors too — a canopy with a bare underside
    // reads as a pancake on a stick from anywhere beneath it.
    for (const anchor of [limb.tip, ...limb.anchors]) {
      const blobR = anchor === limb.tip ? 2.6 + rand() * 0.7 : 1.5;
      const n = anchor === limb.tip ? 30 : 10;
      for (let cItr = 0; cItr < n; cItr++) {
        const ca = rand() * Math.PI * 2;
        const cr = Math.pow(rand(), 0.5) * blobR;
        const cy = (rand() - 0.5) * blobR * 0.9;
        cards.push({
          pos: new THREE.Vector3(
            anchor.x + Math.cos(ca) * cr,
            anchor.y + cy + 0.35,
            anchor.z + Math.sin(ca) * cr),
          rim: Math.min(1, (cr / blobR) * 0.7 + Math.max(0, cy) / (blobR * 0.45) * 0.5),
        });
      }
    }
  }
  // crown fill + a drooping skirt under the dome's middle
  for (let cItr = 0; cItr < 42; cItr++) {
    const ca = rand() * Math.PI * 2;
    const cr = Math.pow(rand(), 0.55) * canopyR * 0.8;
    const skirt = rand() < 0.3;
    cards.push({
      pos: new THREE.Vector3(
        crown.x + Math.cos(ca) * cr,
        crown.y + (skirt ? 0.2 + rand() * 0.8 : 1.5 + (rand() - 0.3) * 1.6 + Math.max(0, 1 - cr / canopyR) * 0.8),
        crown.z + Math.sin(ca) * cr),
      rim: skirt ? 0.15 + rand() * 0.2 : Math.min(1, cr / (canopyR * 0.8)),
    });
  }

  // build the canopy cards: single quads, mostly face-up, wind-flexed
  const _r = new THREE.Vector3(), _f = new THREE.Vector3();
  for (const card of cards) {
    const s = 0.95 + rand() * 1.25;
    const yaw = rand() * Math.PI * 2;
    const tilt = (rand() - 0.5) * 1.1;
    _r.set(Math.cos(yaw), Math.sin(tilt) * 0.6, Math.sin(yaw)).normalize().multiplyScalar(s / 2);
    _f.set(-Math.sin(yaw), Math.cos(tilt) * 0.28 - 0.1, Math.cos(yaw)).normalize().multiplyScalar(s / 2);
    // interior cards run darker; rim cards catch the sun, a touch warmer
    const tone = 0.55 + card.rim * 0.8;
    const col = [tone * 0.96, tone, tone * 0.85];
    const flex = 0.16 + rand() * 0.22;
    const phase = rand() * Math.PI * 2;
    const p = card.pos;
    const v0 = canopy.vert(new THREE.Vector3(p.x - _r.x - _f.x, p.y - _r.y - _f.y, p.z - _r.z - _f.z), 0, 0, col, flex, phase);
    const v1 = canopy.vert(new THREE.Vector3(p.x + _r.x - _f.x, p.y + _r.y - _f.y, p.z + _r.z - _f.z), 1, 0, col, flex, phase);
    const v2 = canopy.vert(new THREE.Vector3(p.x - _r.x + _f.x, p.y - _r.y + _f.y, p.z - _r.z + _f.z), 0, 1, col, flex, phase);
    const v3 = canopy.vert(new THREE.Vector3(p.x + _r.x + _f.x, p.y + _r.y + _f.y, p.z + _r.z + _f.z), 1, 1, col, flex, phase);
    canopy.quad(v0, v1, v2, v3);
  }

  // ---- rope swing from the low limb ----
  const swing = new MeshData();
  if (lowLimbTip) {
    const hang = lowLimbTip.tip.clone().addScaledVector(
      new THREE.Vector3(lowLimbTip.dir.x, 0, lowLimbTip.dir.y), -0.7);
    const gy = islandHeight(hang.x, hang.z);
    const seatY = gy + 0.55;
    const dropTotal = hang.y - seatY;
    if (dropTotal > 1.2) {
      const sideways = new THREE.Vector3(-lowLimbTip.dir.y, 0, lowLimbTip.dir.x).multiplyScalar(0.28);
      const ROPE_SEGS = 6;
      for (const side of [-1, 1]) {
        const top = hang.clone().addScaledVector(sideways, side);
        const bot = top.clone(); bot.y = seatY + 0.02;
        let prev = null;
        for (let i = 0; i <= ROPE_SEGS; i++) {
          const t = i / ROPE_SEGS;
          const p = top.clone().lerp(bot, t);
          const ring = [];
          const flex = 0.06 + t * 0.30; // ropes swing more toward the seat
          for (let k = 0; k <= 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            ring.push(swing.vert(
              new THREE.Vector3(p.x + Math.cos(a) * 0.016, p.y, p.z + Math.sin(a) * 0.016),
              k / 5, t * 4, [0.72, 0.62, 0.45], flex, 1.7));
          }
          if (prev) for (let k = 0; k < 5; k++) swing.quad(prev[k], prev[k + 1], ring[k], ring[k + 1]);
          prev = ring;
        }
      }
      // plank seat
      const c = hang.clone(); c.y = seatY;
      const ax = sideways.clone().normalize().multiplyScalar(0.42);
      const az = new THREE.Vector3(lowLimbTip.dir.x, 0, lowLimbTip.dir.y).multiplyScalar(0.15);
      const corners = [
        c.clone().sub(ax).sub(az), c.clone().add(ax).sub(az),
        c.clone().sub(ax).add(az), c.clone().add(ax).add(az),
      ];
      const cv = corners.map((p, i) =>
        swing.vert(p, i % 2, Math.floor(i / 2), [0.65, 0.5, 0.34], 0.34, 1.7));
      swing.quad(cv[0], cv[1], cv[2], cv[3]);
      const cvB = corners.map((p, i) =>
        swing.vert(new THREE.Vector3(p.x, p.y - 0.05, p.z), i % 2, Math.floor(i / 2), [0.5, 0.38, 0.26], 0.34, 1.7));
      swing.quad(cvB[1], cvB[0], cvB[3], cvB[2]);
    }
  }

  // ---- materials + meshes ----
  const barkMat = windify(new THREE.MeshStandardMaterial({
    map: figBarkTexture(),
    bumpMap: figBarkTexture(),
    bumpScale: 0.22,
    roughness: 0.9,
  }), 'figbark');
  const leafMat = windify(new THREE.MeshStandardMaterial({
    map: leafClusterTexture(),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.62,
    vertexColors: true,
  }), 'figleaf');
  const swingMat = windify(new THREE.MeshStandardMaterial({
    map: barkTexture(true),
    roughness: 0.95,
    vertexColors: true,
  }), 'swing');

  for (const [data, mat] of [[bark, barkMat], [canopy, leafMat], [swing, swingMat]]) {
    if (!data.pos.length) continue;
    const mesh = new THREE.Mesh(data.build(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return { group, base: base.clone(), crown, canopyR };
}
