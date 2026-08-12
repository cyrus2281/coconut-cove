// Procedural coconut palms. Each tree: a curved, ring-scarred trunk, a crown
// of fronds where every individual leaflet is real geometry, a few dead
// hanging fronds, and a cluster of coconuts. Per-vertex flex/phase attributes
// drive wind sway in the vertex shader. All trees share three merged meshes
// (bark / leaves / husks) so the whole grove costs three draw calls.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { uniforms } from '../core/env.js';
import { subSeed } from '../core/seed.js';
import { islandHeight, shoreRadius, lagoonFreeboard } from './island.js';
import { ZONES } from './swash.js';
import { barkTexture, leafletTexture, huskTexture } from '../core/textures.js';

const UP = new THREE.Vector3(0, 1, 0);

export class MeshData {
  constructor() {
    this.pos = []; this.uv = []; this.col = [];
    this.flex = []; this.phase = []; this.idx = [];
  }
  vert(p, u, v, tint, flex, phase) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    this.col.push(tint.r ?? tint[0], tint.g ?? tint[1], tint.b ?? tint[2]);
    this.flex.push(flex);
    this.phase.push(phase);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) { this.idx.push(a, b, c, b, d, c); }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFlex', new THREE.Float32BufferAttribute(this.flex, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// Adds wind sway driven by aFlex/aPhase to a standard material.
export function windify(mat, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    shader.uniforms.uWindAmp = uniforms.uWindAmp;
    shader.vertexShader = `
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform float uWindAmp;
      attribute float aFlex;
      attribute float aPhase;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float sway = sin(uTime * 1.05 + aPhase) + 0.55 * sin(uTime * 1.93 + aPhase * 1.37);
        vec3 woff = vec3(uWindDir.x, 0.0, uWindDir.y) * sway * 0.5 * aFlex * uWindAmp;
        woff.y -= abs(sway) * 0.1 * aFlex * uWindAmp;
        float flut = sin(uTime * 6.3 + aPhase * 7.3) * 0.02 * aFlex * aFlex * uWindAmp;
        transformed += woff * 0.3 + objectNormal * flut;
      }`
    );
  };
  mat.customProgramCacheKey = () => 'wind-' + key;
  return mat;
}

// ------------------------------------------------------------------ frond
function buildFrond(leaf, opts) {
  const {
    origin, crownUp, azimuth, pitch, length, rand, tint,
    droopRate = 1.0, flexBase = 0.35, phase = 0, dead = false,
  } = opts;

  // frame around the crown axis
  const s1 = new THREE.Vector3().crossVectors(crownUp, new THREE.Vector3(0.31, 0.05, 0.95).normalize()).normalize();
  const s2 = new THREE.Vector3().crossVectors(crownUp, s1).normalize();
  const radial = s1.clone().multiplyScalar(Math.cos(azimuth)).addScaledVector(s2, Math.sin(azimuth));

  let dir = crownUp.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(radial, Math.sin(pitch)).normalize();

  const STEPS = 14;
  const stepLen = length / STEPS;
  const pts = [origin.clone()];
  const dirs = [dir.clone()];
  const p = origin.clone();
  for (let i = 0; i < STEPS; i++) {
    const t = i / STEPS;
    // gravity droop accelerates toward the tip
    dir = dir.clone().addScaledVector(UP, -droopRate * (0.055 + 0.34 * t * t)).normalize();
    p.addScaledVector(dir, stepLen);
    pts.push(p.clone());
    dirs.push(dir.clone());
  }

  // rachis: tapered strip using the rib zone of the leaflet texture
  const rachisIdx = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const T = dirs[i];
    const side = new THREE.Vector3().crossVectors(T, UP).normalize();
    if (side.lengthSq() < 0.1) side.set(1, 0, 0);
    const w = 0.055 * (1 - t * 0.8);
    const fl = flexBase * (0.45 + 0.85 * t);
    const a = leaf.vert(pts[i].clone().addScaledVector(side, -w), 0.46, t * 3, tint, fl, phase);
    const b = leaf.vert(pts[i].clone().addScaledVector(side, w), 0.54, t * 3, tint, fl, phase);
    rachisIdx.push([a, b]);
  }
  for (let i = 0; i < STEPS; i++) {
    leaf.quad(rachisIdx[i][0], rachisIdx[i][1], rachisIdx[i + 1][0], rachisIdx[i + 1][1]);
  }

  // leaflets: two rows of individually modeled leaves
  const N_LEAF = 30;
  for (let li = 2; li <= N_LEAF; li++) {
    const t = li / N_LEAF;
    const station = Math.min(Math.floor(t * STEPS), STEPS - 1);
    const frac = t * STEPS - station;
    const base = pts[station].clone().lerp(pts[station + 1], frac);
    const T = dirs[station].clone().lerp(dirs[station + 1], frac).normalize();
    const S = new THREE.Vector3().crossVectors(T, UP).normalize();
    if (S.lengthSq() < 0.1) S.set(1, 0, 0);
    const U = new THREE.Vector3().crossVectors(S, T).normalize();

    for (const sgn of [-1, 1]) {
      const spread = (1.18 - 0.42 * t) + (rand() - 0.5) * 0.24; // angle off the rachis
      const vFold = (dead ? 0.9 : 0.52) + (rand() - 0.5) * 0.2 + t * 0.25;
      let ldir = T.clone().multiplyScalar(Math.cos(spread)).addScaledVector(S, Math.sin(spread) * sgn);
      ldir = ldir.multiplyScalar(Math.cos(vFold)).addScaledVector(U, -Math.sin(vFold)).normalize();

      const llen = (0.34 + 0.66 * Math.sin(Math.PI * (0.10 + 0.82 * t))) * length * 0.30
        * (0.9 + rand() * 0.2);
      const lw = 0.043 * (0.75 + 0.5 * Math.sin(Math.PI * t)) * (dead ? 0.7 : 1);
      const droopLeaf = (dead ? 1.5 : 0.65) + rand() * 0.45;
      const lphase = phase + rand() * 2.4;

      // 4 cross-sections x 3 verts (edge / raised rib / edge) => creased blade
      const rows = [];
      const lp = base.clone();
      let ld = ldir.clone();
      const SEG = [0, 0.38, 0.72, 1.0];
      for (let si = 0; si < SEG.length; si++) {
        const s = SEG[si];
        if (si > 0) {
          const ds = SEG[si] - SEG[si - 1];
          ld = ld.clone().addScaledVector(UP, -droopLeaf * s * ds * 1.6).normalize();
          lp.addScaledVector(ld, llen * ds);
        }
        const wS = lw * Math.pow(1 - s, 0.55);
        const eS = new THREE.Vector3().crossVectors(ld, U).normalize();
        const fl = flexBase * (0.5 + 0.9 * t) + s * 0.4;
        const dip = wS * 0.5; // edges fold down from the rib
        const va = leaf.vert(lp.clone().addScaledVector(eS, -wS).addScaledVector(U, -dip), 0.02, s, tint, fl, lphase);
        const vb = leaf.vert(lp.clone().addScaledVector(U, dip * 0.4), 0.5, s, tint, fl, lphase);
        const vc = leaf.vert(lp.clone().addScaledVector(eS, wS).addScaledVector(U, -dip), 0.98, s, tint, fl, lphase);
        rows.push([va, vb, vc]);
      }
      for (let si = 0; si < rows.length - 1; si++) {
        leaf.quad(rows[si][0], rows[si][1], rows[si + 1][0], rows[si + 1][1]);
        leaf.quad(rows[si][1], rows[si][2], rows[si + 1][1], rows[si + 1][2]);
      }
    }
  }
}

// ------------------------------------------------------------------ tree
function buildPalm(bark, leaf, husk, opts) {
  const { x, z, height, leanDir, leanAmount, seed } = opts;
  const rand = mulberry32(seed);
  const baseY = islandHeight(x, z) - 0.22;
  const base = new THREE.Vector3(x, baseY, z);
  const treePhase = rand() * Math.PI * 2;

  // --- trunk centerline ---
  const SEGS = 20, RADIAL = 9;
  const lean = new THREE.Vector3(leanDir.x, 0, leanDir.y).normalize();
  const pts = [], tangents = [];
  const wob = rand() * Math.PI * 2;
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const wiggle = Math.sin(t * Math.PI * 1.7 + wob) * 0.10 * (1 - t * 0.4);
    const side = new THREE.Vector3().crossVectors(lean, UP);
    pts.push(base.clone()
      .addScaledVector(UP, height * t)
      .addScaledVector(lean, leanAmount * Math.pow(t, 1.7))
      .addScaledVector(side, wiggle));
  }
  for (let i = 0; i <= SEGS; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, SEGS)];
    tangents.push(b.clone().sub(a).normalize());
  }

  const rings = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const T = tangents[i];
    const s1 = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0.2, 0.1, 0.97).normalize()).normalize();
    const s2 = new THREE.Vector3().crossVectors(T, s1).normalize();
    let r = 0.145 + 0.09 * Math.pow(1 - t, 2.4);
    if (t < 0.08) r += 0.09 * Math.pow((0.08 - t) / 0.08, 1.6); // root flare
    r *= 0.96 + rand() * 0.08;
    const fl = 0.16 * t * t;
    const row = [];
    for (let k = 0; k <= RADIAL; k++) {
      const a = (k / RADIAL) * Math.PI * 2;
      const pnt = pts[i].clone()
        .addScaledVector(s1, Math.cos(a) * r)
        .addScaledVector(s2, Math.sin(a) * r);
      row.push(bark.vert(pnt, k / RADIAL, (height * t) / 5.8, [1, 1, 1], fl, treePhase));
    }
    rings.push(row);
  }
  for (let i = 0; i < SEGS; i++) {
    for (let k = 0; k < RADIAL; k++) {
      bark.quad(rings[i][k], rings[i][k + 1], rings[i + 1][k], rings[i + 1][k + 1]);
    }
  }

  // --- crown ---
  const crown = pts[SEGS].clone();
  const crownUp = tangents[SEGS].clone().lerp(UP, 0.35).normalize();
  const frondCount = 14 + Math.floor(rand() * 3);
  const scale = height / 8;

  for (let j = 0; j < frondCount; j++) {
    const az = j * 2.399963 + rand() * 0.5;
    const pitchMix = (j * 0.618034 + rand() * 0.15) % 1;
    const pitch = 0.42 + 1.25 * pitchMix;
    const g = 0.85 + rand() * 0.3;
    const tint = [0.75 * g + pitchMix * 0.4, 0.95 * g, 0.55 * g];
    buildFrond(leaf, {
      origin: crown.clone().addScaledVector(crownUp, 0.05),
      crownUp, azimuth: az, pitch,
      length: (2.5 + rand() * 0.7) * scale,
      rand, tint,
      droopRate: 0.75 + pitchMix * 0.8 + rand() * 0.3,
      flexBase: 0.4, phase: treePhase + j * 0.7,
    });
  }
  // dead hanging fronds
  for (let j = 0; j < 2; j++) {
    buildFrond(leaf, {
      origin: crown.clone().addScaledVector(crownUp, -0.06),
      crownUp, azimuth: rand() * Math.PI * 2, pitch: 2.35 + rand() * 0.3,
      length: 2.0 * scale, rand,
      tint: [0.62, 0.45, 0.24],
      droopRate: 1.3, flexBase: 0.22, phase: treePhase + 9, dead: true,
    });
  }

  // --- coconuts ---
  const nutCount = 4 + Math.floor(rand() * 3);
  for (let j = 0; j < nutCount; j++) {
    const a = rand() * Math.PI * 2;
    const off = 0.16 + rand() * 0.16;
    const c = crown.clone()
      .addScaledVector(crownUp, -0.26 - rand() * 0.16)
      .add(new THREE.Vector3(Math.cos(a) * off, 0, Math.sin(a) * off));
    const tints = [[0.62, 0.66, 0.34], [0.72, 0.58, 0.34], [1.0, 0.92, 0.8]];
    addCoconut(husk, c, 0.15 + rand() * 0.04, tints[Math.floor(rand() * 3)], 0.3, treePhase, rand);
  }

  return { crown, base, height };
}

function addCoconut(husk, center, radius, tint, flex, phase, rand) {
  const sph = new THREE.SphereGeometry(radius, 12, 9);
  sph.scale(1, 0.94, 1);
  sph.rotateX(rand() * 0.8 - 0.4);
  sph.rotateZ(rand() * 0.8 - 0.4);
  const posA = sph.attributes.position, uvA = sph.attributes.uv;
  const map = [];
  for (let i = 0; i < posA.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(posA, i).add(center);
    map.push(husk.vert(p, uvA.getX(i), uvA.getY(i), tint, flex, phase));
  }
  const index = sph.index.array;
  for (let i = 0; i < index.length; i += 3) {
    husk.tri(map[index[i]], map[index[i + 1]], map[index[i + 2]]);
  }
  sph.dispose();
}

// ------------------------------------------------------------------ grove
export function buildPalms() {
  const bark = new MeshData(), leaf = new MeshData(), husk = new MeshData();
  const rand = mulberry32(subSeed('palms'));

  // grow the grove from the seed: a hero palm leaning out over the water by
  // the spawn (surge) beach, a cluster beside it, a pair across the island,
  // and a loner on the dunes
  const heroAz = ZONES[0].az + 0.08;
  const spots = [
    { az: heroAz, d: -3.2, height: 6.8 + rand() * 1.6, lean: 2.9 + rand() * 0.8, leanOut: true },
  ];
  const clusterAz = heroAz - 0.35 - rand() * 0.35;
  const nCluster = 3 + (rand() < 0.4 ? 1 : 0);
  for (let i = 0; i < nCluster; i++) {
    spots.push({
      az: clusterAz + (rand() - 0.5) * 0.45,
      d: -(8 + rand() * 9),
      height: 5.6 + rand() * 3.2,
      lean: 0.5 + rand() * 0.9,
    });
  }
  const pairAz = heroAz + 0.9 + rand() * 1.6;
  for (let i = 0; i < 2; i++) {
    spots.push({
      az: pairAz + i * (0.2 + rand() * 0.12),
      d: -(9 + rand() * 6),
      height: 5.8 + rand() * 3.1,
      lean: 0.9 + rand() * 0.7,
    });
  }
  spots.push({
    az: pairAz + 1.5 + rand() * 1.2,
    d: -(16 + rand() * 5),
    height: 6.4 + rand() * 1.4,
    lean: 0.4 + rand() * 0.4,
  });

  // a matched pair ~4.2m apart on its own stretch of beach: every island
  // gets somewhere to sling the hammock
  {
    const hamAz = pairAz + 2.3 + rand() * 1.1;
    const hamD = -(5.5 + rand() * 2);
    const hamR = Math.max(shoreRadius(hamAz) + hamD, 18);
    const half = 2.1 / hamR; // ~4.2m along the shore between the two trunks
    for (const s of [-1, 1]) {
      spots.push({
        az: hamAz + half * s,
        d: hamD,
        height: 5.9 + rand() * 1.6,
        lean: 0.45 + rand() * 0.5,
      });
    }
  }

  const trees = [];
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    let r = shoreRadius(s.az) + s.d;
    // an inland spot can land in the lagoon — walk it back toward the beach
    // until the trunk stands on dry ground
    for (let g = 0; g < 12; g++) {
      if (lagoonFreeboard(Math.cos(s.az) * r, Math.sin(s.az) * r) >= 0.7) break;
      r += 2.0;
    }
    const x = Math.cos(s.az) * r, z = Math.sin(s.az) * r;
    const leanA = s.leanOut
      ? Math.atan2(Math.sin(s.az), Math.cos(s.az))
      : rand() * Math.PI * 2;
    const leanDir = new THREE.Vector2(Math.cos(leanA), Math.sin(leanA));
    if (s.leanOut) leanDir.set(Math.cos(s.az), Math.sin(s.az)); // out toward the sea
    trees.push(buildPalm(bark, leaf, husk, {
      x, z, height: s.height, leanDir, leanAmount: s.lean, seed: subSeed('palm' + i),
    }));
  }

  // fallen dead fronds on the sand
  for (let i = 0; i < 3; i++) {
    const t = trees[[1, 4, 3][i]];
    const a = rand() * Math.PI * 2;
    const gp = t.base.clone().add(new THREE.Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 3));
    gp.y = islandHeight(gp.x, gp.z) + 0.1;
    buildFrond(leaf, {
      origin: gp,
      crownUp: new THREE.Vector3(Math.cos(a + 1), 2.2, Math.sin(a + 1)).normalize(),
      azimuth: rand() * 6.28, pitch: 1.45,
      length: 2.2, rand,
      tint: [0.55, 0.4, 0.22],
      droopRate: 0.5, flexBase: 0.02, phase: 0, dead: true,
    });
  }

  // (No baked fallen coconuts here: every nut on the ground is a live
  // physics nut from coconuts.js, so they're all kickable. Only the
  // clusters up in the crowns stay merged into the static husk mesh.)

  const barkMat = windify(new THREE.MeshStandardMaterial({
    map: barkTexture(), roughness: 0.92, bumpMap: barkTexture(), bumpScale: 0.35,
  }), 'bark');
  const leafMat = windify(new THREE.MeshStandardMaterial({
    map: leafletTexture(), roughness: 0.55, side: THREE.DoubleSide, vertexColors: true,
  }), 'leaf');
  const huskMat = windify(new THREE.MeshStandardMaterial({
    map: huskTexture(), roughness: 0.85, vertexColors: true,
  }), 'husk');

  const group = new THREE.Group();
  group.name = 'palms';
  for (const [data, mat] of [[bark, barkMat], [leaf, leafMat], [husk, huskMat]]) {
    const mesh = new THREE.Mesh(data.build(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, trees };
}
