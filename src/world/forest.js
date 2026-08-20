// The tropical forest: kapok giants and pagoda-tiered almonds for a canopy,
// banana clumps, tree ferns and big-leaf shrubs beneath. Every plant is a
// seeded procedural variant instanced in ~84m chunks (one InstancedMesh per
// species part per chunk, frustum-culled with padded bounds — the forest is
// far too big for the reef's cull-nothing trick). Wind rides the shared
// aFlex/aPhase convention; understory melts into the ground with distance
// so phones never draw ten thousand distant ferns. Like the palms, trees
// have no collision — the island stays a place you wander, not a maze.

import * as THREE from 'three';
import { mulberry32, Simplex2 } from '../core/rng.js';
import { uniforms } from '../core/env.js';
import { subSeed } from '../core/seed.js';
import {
  islandHeight, biomeAt, lagoonFreeboard, trailQuery, shoreRange, summitPos,
} from './island.js';
import { MeshData } from './palms.js';
import { figBase } from './fig.js';
import {
  kapokBarkTexture, kapokCanopyTexture, almondBarkTexture, almondCanopyTexture,
  bananaLeafTexture, bananaStemTexture, bigLeafTexture,
  fernFrondTexture, fernTrunkTexture,
} from '../core/textures.js';

const CHUNK = 84;
const UP = new THREE.Vector3(0, 1, 0);

// understory melt band (meters from the camera); retuned per quality tier
const FADE = { value: new THREE.Vector2(120, 155) };

// wind sway + (optionally) the distance melt, sharing palms.js's attribute
// convention: per-vertex aFlex, per-INSTANCE aPhase (the divisor lives on
// the buffer, so the GLSL is identical either way). Never declare
// instanceMatrix — three does.
function windMelt(mat, key, melt) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    shader.uniforms.uWindAmp = uniforms.uWindAmp;
    if (melt) shader.uniforms.uFade = FADE;
    shader.vertexShader = `
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform float uWindAmp;
      ${melt ? 'uniform vec2 uFade;' : ''}
      attribute float aFlex;
      attribute float aPhase;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float sway = sin(uTime * 1.05 + aPhase) + 0.55 * sin(uTime * 1.93 + aPhase * 1.37);
        vec3 woff = vec3(uWindDir.x, 0.0, uWindDir.y) * sway * 0.5 * aFlex * uWindAmp;
        woff.y -= abs(sway) * 0.1 * aFlex * uWindAmp;
        float flut = sin(uTime * 6.3 + aPhase * 7.3) * 0.02 * aFlex * aFlex * uWindAmp;
        transformed += woff * 0.3 + objectNormal * flut;
        ${melt ? `
        #ifdef USE_INSTANCING
          vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          transformed *= 1.0 - smoothstep(uFade.x, uFade.y, distance(iw, cameraPosition));
        #endif` : ''}
      }`);
  };
  mat.customProgramCacheKey = () => 'forest-' + key;
  return mat;
}

// one textured quad written into a MeshData: center c, half-axes va/vb.
// uvw picks a window of the texture ([u0, v0, u1, v1]) so cards can pull one
// cell of an atlas; default is the whole map.
function addQuad(data, c, va, vb, tint, flex, ph = 0, uvw = [0, 0, 1, 1]) {
  const p = new THREE.Vector3();
  const [u0, v0, u1, v1] = uvw;
  const i00 = data.vert(p.copy(c).sub(va).sub(vb), u0, v0, tint, flex, ph);
  const i10 = data.vert(p.copy(c).add(va).sub(vb), u1, v0, tint, flex, ph);
  const i01 = data.vert(p.copy(c).sub(va).add(vb), u0, v1, tint, flex, ph);
  const i11 = data.vert(p.copy(c).add(va).add(vb), u1, v1, tint, flex, ph);
  data.quad(i00, i10, i01, i11);
}

// a tapering tube along axis points; returns the ring rows it wrote
function loftTube(data, pts, radii, around, flexes, uWrap = 2, vWrap = 3, tint = [1, 1, 1]) {
  const rows = [];
  const tangent = new THREE.Vector3(), s1 = new THREE.Vector3(), s2 = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    tangent.copy(pts[Math.min(i + 1, pts.length - 1)]).sub(pts[Math.max(i - 1, 0)]).normalize();
    s1.crossVectors(tangent, UP);
    if (s1.lengthSq() < 0.01) s1.set(1, 0, 0);
    s1.normalize();
    s2.crossVectors(tangent, s1).normalize();
    const row = [];
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2;
      q.copy(pts[i]).addScaledVector(s1, Math.cos(a) * radii[i]).addScaledVector(s2, Math.sin(a) * radii[i]);
      row.push(data.vert(q, (k / around) * uWrap, t * vWrap, tint, flexes[i], 0));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    for (let k = 0; k < around; k++) {
      data.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k], rows[i + 1][k + 1]);
    }
  }
  return rows;
}

// a random 2×2-atlas cell as an addQuad uv window
function atlasCell(rand) {
  const qx = rand() < 0.5 ? 0 : 0.5, qy = rand() < 0.5 ? 0 : 0.5;
  return [qx, qy, qx + 0.5, qy + 0.5];
}

// ------------------------------------------------------------- species
// Each variant builds in LOCAL space, base at the origin; instances carry
// position/yaw/scale. Canopy species return {bark, leaf}; understory one geo.

function kapokVariant(rand) {
  const bark = new MeshData(), leaf = new MeshData();
  const H = 11 + rand() * 6;
  const K = H / 12; // proportion scale

  // trunk: gently leaning, buttress-flanged at the foot
  const leanA = rand() * Math.PI * 2;
  const lean = (rand() - 0.5) * 0.14;
  const ph = rand() * Math.PI * 2;
  const ph2 = rand() * Math.PI * 2;
  const AR = 12;
  const pts = [], radii = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = H * 0.62 * t;
    pts.push(new THREE.Vector3(Math.cos(leanA) * lean * y, y, Math.sin(leanA) * lean * y));
    radii.push(0.38 * K * (1 - t * 0.48));
  }
  // hand-lofted so the base rings can wear the buttresses: five sharp root
  // fins, a softer secondary swell, and a slow muscle wave up the bole
  {
    const rows = [];
    const q = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const row = [];
      for (let k = 0; k <= AR; k++) {
        const a = (k / AR) * Math.PI * 2;
        const flange = 1
          + 1.5 * Math.pow(Math.max(Math.cos(5 * a + ph), 0), 3.0) * Math.pow(Math.max(1 - t * 3.4, 0), 1.5)
          + 0.14 * Math.cos(9 * a + ph2) * Math.max(1 - t * 1.8, 0)
          + 0.05 * Math.sin(3 * a + t * 9 + ph);
        q.set(
          pts[i].x + Math.cos(a) * radii[i] * flange,
          pts[i].y,
          pts[i].z + Math.sin(a) * radii[i] * flange
        );
        row.push(bark.vert(q, (k / AR) * 3, t * 6, [1, 1, 1], 0.02 * t, 0));
      }
      rows.push(row);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      for (let k = 0; k < AR; k++) {
        bark.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k], rows[i + 1][k + 1]);
      }
    }
  }

  // limbs reaching out of the trunk top toward the crown, most forking once
  const top = pts[N];
  const crownC = top.clone().add(new THREE.Vector3(0, H * 0.15, 0));
  const anchors = [crownC.clone()];
  const nLimbs = 4 + (rand() < 0.5 ? 1 : 0);
  for (let l = 0; l < nLimbs; l++) {
    const a = (l / nLimbs) * Math.PI * 2 + rand() * 0.9;
    const reach = H * (0.24 + rand() * 0.15);
    const tip = new THREE.Vector3(
      top.x + Math.cos(a) * reach,
      top.y + H * (0.10 + rand() * 0.14),
      top.z + Math.sin(a) * reach
    );
    const mid = top.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, H * 0.05, 0));
    loftTube(bark, [top.clone(), mid, tip], [0.15 * K, 0.10 * K, 0.05 * K], 6, [0.03, 0.06, 0.1], 2, 2);
    anchors.push(mid.clone(), tip);
    if (rand() < 0.8) {
      const fa = a + (rand() - 0.5) * 1.6;
      const ftip = new THREE.Vector3(
        mid.x + Math.cos(fa) * reach * 0.55,
        mid.y + H * (0.05 + rand() * 0.08),
        mid.z + Math.sin(fa) * reach * 0.55
      );
      loftTube(bark, [mid.clone(), ftip], [0.06 * K, 0.025 * K], 4, [0.06, 0.12], 2, 1);
      anchors.push(ftip);
    }
  }

  // the crown: atlas cluster cards shingled over a dome, facing out of the
  // canopy so the sun rakes them the way it rakes a real crown; interior
  // cards run darker to keep the shadowed heart. Most cards ride the dome
  // shell, the rest thicken the limbs so the mass hangs off real wood.
  const cards = 52 + Math.floor(rand() * 12);
  const nrm = new THREE.Vector3(), va = new THREE.Vector3(), vb = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < cards; i++) {
    if (rand() < 0.6) {
      // on the dome shell around the crown centre — the very top is left
      // out so no ring of coplanar cards forms a lid
      const a = rand() * Math.PI * 2;
      const pol = Math.acos(0.82 - rand() * 1.32);
      const rr = H * (0.24 + rand() * 0.08);
      c.set(
        crownC.x + Math.sin(pol) * Math.cos(a) * rr,
        crownC.y + Math.cos(pol) * rr * 0.7,
        crownC.z + Math.sin(pol) * Math.sin(a) * rr
      );
    } else {
      // packed close around a limb anchor, reeled in under the dome so no
      // clump juts out of the silhouette
      const an = anchors[Math.floor(rand() * anchors.length)];
      const a = rand() * Math.PI * 2;
      const rr = H * 0.10 * Math.pow(rand(), 0.5);
      c.set(an.x + Math.cos(a) * rr, an.y + (rand() - 0.35) * H * 0.08, an.z + Math.sin(a) * rr);
      const dx = c.x - crownC.x, dz = c.z - crownC.z;
      const dh = Math.hypot(dx, dz), dMax = H * 0.28;
      if (dh > dMax) {
        c.x = crownC.x + (dx / dh) * dMax;
        c.z = crownC.z + (dz / dh) * dMax;
      }
    }
    const s = (1.35 + rand() * 0.9) * K;
    nrm.copy(c).sub(crownC);
    nrm.y = Math.abs(nrm.y) + H * 0.12;
    nrm.x += (rand() - 0.5) * H * 0.2;
    nrm.y += (rand() - 0.5) * H * 0.12;
    nrm.z += (rand() - 0.5) * H * 0.2;
    nrm.normalize();
    va.crossVectors(nrm, UP);
    if (va.lengthSq() < 0.01) va.set(1, 0, 0);
    va.normalize().multiplyScalar(s);
    vb.crossVectors(nrm, va).normalize().multiplyScalar(s * (0.8 + rand() * 0.3));
    const depth = Math.min(c.distanceTo(crownC) / (H * 0.34), 1);
    const g = (0.62 + 0.52 * depth) * (0.88 + rand() * 0.3);
    addQuad(leaf, c, va, vb, [g, g * (0.94 + rand() * 0.12), g * 0.9],
      0.10 + rand() * 0.1 + (c.y / H) * 0.06, 0, atlasCell(rand));
  }

  return { bark: bark.build(), leaf: leaf.build() };
}

function almondVariant(rand) {
  const bark = new MeshData(), leaf = new MeshData();
  const H = 7.5 + rand() * 4;
  const K = H / 9;

  const pts = [], radii = [], flexes = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(new THREE.Vector3((rand() - 0.5) * 0.16 * t, H * t, (rand() - 0.5) * 0.16 * t));
    radii.push(0.20 * K * (1 - t * 0.68));
    flexes.push(0.02 + t * 0.06);
  }
  loftTube(bark, pts, radii, 9, flexes, 2, 8);
  const trunkAt = (y) => {
    const t = THREE.MathUtils.clamp(y / H, 0, 1) * 5;
    const i = Math.min(Math.floor(t), 4);
    return pts[i].clone().lerp(pts[i + 1], t - i);
  };

  // pagoda tiers of true whorled branches, each carrying flat leaf rosettes
  // along its outer half — the almond's stacked silhouette, made of parts
  const tiers = 3 + (rand() < 0.6 ? 1 : 0);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), c = new THREE.Vector3();
  const along = new THREE.Vector3(), perp = new THREE.Vector3();
  // the turning cell of the atlas shows up rarely, more often up top where
  // the oldest leaves go scarlet first
  const cellFor = (redChance) => {
    if (rand() < redChance) return [0.5, 0, 1, 0.5];
    const cells = [[0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1], [0, 0, 0.5, 0.5]];
    return cells[Math.floor(rand() * 3)];
  };
  for (let ti = 0; ti < tiers; ti++) {
    const t = ti / Math.max(tiers - 1, 1);
    const y = H * (0.42 + 0.55 * t);
    const tierR = H * 0.34 * (1 - t * 0.45);
    const o = trunkAt(y);
    const nB = 4 + Math.floor(rand() * 3);
    for (let b = 0; b < nB; b++) {
      const a = (b / nB) * Math.PI * 2 + rand() * 0.7;
      const reach = tierR * (0.75 + rand() * 0.4);
      const tip = new THREE.Vector3(
        o.x + Math.cos(a) * reach,
        y + reach * (0.10 + rand() * 0.12),
        o.z + Math.sin(a) * reach
      );
      const mid = o.clone().lerp(tip, 0.55);
      mid.y += reach * 0.03;
      loftTube(bark, [o.clone(), mid, tip],
        [0.05 * K, 0.032 * K, 0.014 * K], 4,
        [0.04 + t * 0.02, 0.08, 0.14], 2, 1);
      along.copy(tip).sub(o).normalize();
      perp.crossVectors(along, UP).normalize();
      const nC = 2 + (rand() < 0.5 ? 1 : 0);
      for (let ci = 0; ci <= nC; ci++) {
        const tt = 0.5 + 0.5 * (ci / nC) * (0.85 + rand() * 0.15);
        c.copy(o).lerp(tip, tt);
        c.y += 0.11 * K;
        const s = (0.8 + rand() * 0.5) * K;
        // rosettes lie almost flat, tipped a touch toward the branch tip
        // and rocked sideways so the tier never reads as one plane
        va.copy(perp).multiplyScalar(s);
        va.y += s * (rand() - 0.5) * 0.3;
        vb.copy(along).multiplyScalar(s);
        vb.y += s * (0.18 + rand() * 0.28);
        const g = 0.95 + rand() * 0.35;
        addQuad(leaf, c, va, vb, [g, g, g],
          0.10 + t * 0.08 + tt * 0.04, 0, cellFor(0.06 + 0.10 * t));
      }
    }
  }
  // the crowning rosette on the leader
  {
    const o = pts[5];
    const s = 0.9 * K;
    va.set(s, 0, 0);
    vb.set(0, s * 0.3, s);
    addQuad(leaf, c.copy(o).add(new THREE.Vector3(0, 0.1 * K, 0)), va, vb,
      [1, 1, 1], 0.16, 0, cellFor(0.08));
  }
  return { bark: bark.build(), leaf: leaf.build() };
}

function bananaVariant(rand) {
  const stem = new MeshData(), leafD = new MeshData();
  const H = 1.6 + rand() * 0.9;

  // pseudostem: rolled sheaths with a slight lean, fattest at the foot
  const leanA = rand() * Math.PI * 2;
  const lean = 0.04 + rand() * 0.10;
  const lx = Math.cos(leanA) * lean, lz = Math.sin(leanA) * lean;
  const r0 = 0.09 + H * 0.045;
  loftTube(stem,
    [new THREE.Vector3(0, -0.06, 0), new THREE.Vector3(lx * H * 0.5, H * 0.5, lz * H * 0.5),
      new THREE.Vector3(lx * H * 0.85, H * 0.85, lz * H * 0.85), new THREE.Vector3(lx * H, H, lz * H)],
    [r0, r0 * 0.9, r0 * 0.7, r0 * 0.42], 7, [0, 0.01, 0.04, 0.08], 2, Math.max(2, Math.round(H * 1.5)));
  const topX = lx * H, topZ = lz * H;

  // the blades: three verts across so each folds into the banana's V,
  // twisting and drooping over; the last one or two hang dead against
  // the stem
  const leaves = 8 + Math.floor(rand() * 3);
  const nDead = rand() < 0.7 ? 1 : 2;
  const p = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3();
  for (let l = 0; l < leaves; l++) {
    const dead = l >= leaves - nDead;
    const a = (l / leaves) * Math.PI * 2 + rand() * 0.7;
    let len = H * (1.05 + rand() * 0.55);
    const w0 = len * (0.155 + rand() * 0.03);
    let pitch0 = 0.95 - rand() * 0.55;
    let droop = 0.55 + rand() * 0.5;
    let tint;
    if (dead) {
      // a spent blade folded down the stem
      pitch0 = -0.75 - rand() * 0.35;
      droop = 0.25;
      len *= 0.7;
      // the map is green; pushing red up and green down in the vertex tint
      // is what turns a blade paper-brown
      const d = 0.9 + rand() * 0.25;
      tint = [d * 1.7, d * 0.62, d * 0.3];
    } else {
      const g = 0.82 + rand() * 0.38;
      tint = [g * 0.94, g, g * 0.9];
    }
    const fold = 0.5 + rand() * 0.3;    // how hard the halves dip off the rib
    const roll = (rand() - 0.5) * 0.7;  // the tip's slow twist
    // blades unroll from the throat at staggered heights, not one point
    const launch = H * (dead ? 0.82 : 0.86 + rand() * 0.13);
    fwd.set(Math.cos(a), 0, Math.sin(a));
    side.set(-Math.sin(a), 0, Math.cos(a));
    const rows = [];
    const SEG = 5;
    for (let sI = 0; sI <= SEG; sI++) {
      const t = sI / SEG;
      const along = len * t;
      const rise = Math.sin(pitch0) * along - droop * t * t * len * 0.5;
      p.set(topX + fwd.x * Math.cos(pitch0) * along, launch + rise, topZ + fwd.z * Math.cos(pitch0) * along);
      const w = w0 * (Math.pow(Math.sin(Math.min(t * 1.3, 1) * Math.PI), 0.6) * 0.96 + 0.04);
      const dip = fold * w * (0.55 + 0.45 * t) * (dead ? 1.6 : 1);
      const tw = roll * t;
      const fl = (0.06 + t * t * 0.34) * (dead ? 1.3 : 1);
      const sx = side.x * Math.cos(tw), sz = side.z * Math.cos(tw);
      const sy = Math.sin(tw);
      rows.push([
        leafD.vert(new THREE.Vector3(p.x - sx * w, p.y - dip - sy * w, p.z - sz * w), 0, t, tint, fl, 0),
        leafD.vert(new THREE.Vector3(p.x, p.y + 0.015, p.z), 0.5, t, tint, fl * 0.85, 0),
        leafD.vert(new THREE.Vector3(p.x + sx * w, p.y - dip + sy * w, p.z + sz * w), 1, t, tint, fl, 0),
      ]);
    }
    for (let sI = 0; sI < SEG; sI++) {
      leafD.quad(rows[sI][0], rows[sI][1], rows[sI + 1][0], rows[sI + 1][1]);
      leafD.quad(rows[sI][1], rows[sI][2], rows[sI + 1][1], rows[sI + 1][2]);
    }
  }

  // half the clumps hang a flowering stalk: a maroon teardrop bud nodding
  // off the crown on its own curved stalk
  if (rand() < 0.5) {
    const a = rand() * Math.PI * 2;
    const bx = Math.cos(a), bz = Math.sin(a);
    const stalk = [
      new THREE.Vector3(topX, H - 0.02, topZ),
      new THREE.Vector3(topX + bx * 0.22, H + 0.02, topZ + bz * 0.22),
      new THREE.Vector3(topX + bx * 0.38, H - 0.16, topZ + bz * 0.38),
    ];
    loftTube(stem, stalk, [0.028, 0.024, 0.02], 4, [0.06, 0.1, 0.14], 2, 1, [0.55, 0.62, 0.4]);
    const tip = stalk[2];
    loftTube(stem, [
      tip.clone(), tip.clone().add(new THREE.Vector3(bx * 0.03, -0.09, bz * 0.03)),
      tip.clone().add(new THREE.Vector3(bx * 0.05, -0.2, bz * 0.05)),
      tip.clone().add(new THREE.Vector3(bx * 0.06, -0.27, bz * 0.06)),
    ], [0.022, 0.062, 0.045, 0.004], 5, [0.14, 0.15, 0.16, 0.17], 2, 1, [0.48, 0.2, 0.26]);
  }
  return { stem: stem.build(), leaf: leafD.build() };
}

function fernVariant(rand) {
  const barkD = new MeshData(), leafD = new MeshData();

  // the fibrous trunk every tree fern stands on — slender next to the
  // two-metre fronds it carries
  const T = 0.35 + rand() * 0.6;
  const leanA = rand() * Math.PI * 2;
  const lean = (rand() - 0.5) * 0.16;
  const lx = Math.cos(leanA) * lean, lz = Math.sin(leanA) * lean;
  loftTube(barkD,
    [new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(lx * T * 0.6, T * 0.6, lz * T * 0.6),
      new THREE.Vector3(lx * T, T, lz * T)],
    [0.085, 0.072, 0.062], 8, [0, 0.02, 0.05], 2, Math.max(1, Math.round(T * 2.2)));
  const cx = lx * T, cz = lz * T;

  // green fronds arch from the crown; the texture carries the pinnae, so a
  // frond is just a ten-triangle ribbon
  const fronds = 10 + Math.floor(rand() * 4);
  const p = new THREE.Vector3(), side = new THREE.Vector3();
  const ribbon = (a, len, pitch, droop, tint, flexK, colU) => {
    side.set(-Math.sin(a), 0, Math.cos(a));
    const w = len * 0.145;
    const rows = [];
    const SEG = 5;
    for (let sI = 0; sI <= SEG; sI++) {
      const t = sI / SEG;
      const along = len * t;
      const rise = Math.sin(pitch) * along - droop * t * t * len * 0.55;
      p.set(cx + Math.cos(a) * Math.cos(pitch) * along, T + rise, cz + Math.sin(a) * Math.cos(pitch) * along);
      const fl = (0.05 + t * t * 0.3) * flexK;
      rows.push([
        leafD.vert(new THREE.Vector3(p.x - side.x * w, p.y, p.z - side.z * w), colU, t, tint, fl, 0),
        leafD.vert(new THREE.Vector3(p.x + side.x * w, p.y, p.z + side.z * w), colU + 0.5, t, tint, fl, 0),
      ]);
    }
    for (let sI = 0; sI < SEG; sI++) {
      leafD.quad(rows[sI][0], rows[sI][1], rows[sI + 1][0], rows[sI + 1][1]);
    }
  };
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rand() * 0.5;
    const len = 1.15 + rand() * 0.65;
    const pitch = 1.15 - rand() * 0.55;
    const droop = 0.8 + rand() * 0.5;
    const g = 0.95 + rand() * 0.35;
    ribbon(a, len, pitch, droop, [g * 0.95, g, g * 0.88], 1, rand() < 0.5 ? 0 : 0.5);
  }
  // and the dead skirt hanging below the living crown
  const skirt = 2 + Math.floor(rand() * 2);
  for (let f = 0; f < skirt; f++) {
    const a = rand() * Math.PI * 2;
    const d = 0.85 + rand() * 0.2;
    ribbon(a, 0.7 + rand() * 0.35, -1.05 - rand() * 0.3, 0.15,
      [d * 1.6, d * 0.66, d * 0.32], 0.5, rand() < 0.5 ? 0 : 0.5);
  }
  return { bark: barkD.build(), leaf: leafD.build() };
}

function shrubVariant(rand) {
  const data = new MeshData();
  const leaves = 5 + Math.floor(rand() * 4);
  const p = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.9;
    const lift = 0.26 + rand() * 0.3;   // stalk height
    const tilt = 0.75 + rand() * 0.45;  // blades held up like shallow bowls
    const s = 0.28 + rand() * 0.20;     // blade half-width
    const dBase = 0.05 + rand() * 0.1;
    const g = 0.8 + rand() * 0.42;
    const tint = [g * 0.94, g, g * 0.88];
    side.set(-Math.sin(a), 0, Math.cos(a));
    dir.set(Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt));

    // the petiole: a two-triangle ribbon sampling the texture's stalk strip
    const bx = Math.cos(a) * dBase, bz = Math.sin(a) * dBase;
    const tipX = bx + dir.x * lift * 0.4, tipY = lift, tipZ = bz + dir.z * lift * 0.4;
    const sw = 0.014;
    const s0 = data.vert(new THREE.Vector3(bx - side.x * sw, 0, bz - side.z * sw), 0.47, 0.0, tint, 0.02, 0);
    const s1 = data.vert(new THREE.Vector3(bx + side.x * sw, 0, bz + side.z * sw), 0.53, 0.0, tint, 0.02, 0);
    const s2 = data.vert(new THREE.Vector3(tipX - side.x * sw, tipY, tipZ - side.z * sw), 0.47, 0.2, tint, 0.07, 0);
    const s3 = data.vert(new THREE.Vector3(tipX + side.x * sw, tipY, tipZ + side.z * sw), 0.53, 0.2, tint, 0.07, 0);
    data.quad(s0, s1, s2, s3);

    // the blade: a bent card arcing up and over, cupped along the midrib so
    // it never reads as a flat plate edge-on
    const len = s * 2.1;
    const rows = [];
    for (let sI = 0; sI <= 2; sI++) {
      const t = sI / 2;
      const sag = t * t * len * 0.26;
      p.set(tipX + dir.x * len * t, tipY + dir.y * len * t * 0.8 - sag, tipZ + dir.z * len * t);
      const cup = s * (0.16 + t * 0.10); // edges fold down off the rib
      const fl = 0.08 + t * 0.08;
      rows.push([
        data.vert(new THREE.Vector3(p.x - side.x * s, p.y - cup, p.z - side.z * s), 0, 0.2 + t * 0.8, tint, fl, 0),
        data.vert(new THREE.Vector3(p.x, p.y, p.z), 0.5, 0.2 + t * 0.8, tint, fl * 0.9, 0),
        data.vert(new THREE.Vector3(p.x + side.x * s, p.y - cup, p.z + side.z * s), 1, 0.2 + t * 0.8, tint, fl, 0),
      ]);
    }
    for (let sI = 0; sI < 2; sI++) {
      data.quad(rows[sI][0], rows[sI][1], rows[sI + 1][0], rows[sI + 1][1]);
      data.quad(rows[sI][1], rows[sI][2], rows[sI + 1][1], rows[sI + 1][2]);
    }
  }
  return { leaf: data.build() };
}

// the forest's nine materials — shared across every chunk of a build
function forestMaterials() {
  const kapokBark = kapokBarkTexture();
  const almondBark = almondBarkTexture();
  const banana = bananaLeafTexture();
  const bigLeaf = bigLeafTexture();
  const fernTrunk = fernTrunkTexture();
  return {
    kapokBark: windMelt(new THREE.MeshStandardMaterial({
      map: kapokBark.map, normalMap: kapokBark.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.85,
    }), 'kapokbark', false),
    kapokLeaf: windMelt(new THREE.MeshStandardMaterial({
      map: kapokCanopyTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.58, vertexColors: true,
    }), 'kapokleaf', false),
    almondBark: windMelt(new THREE.MeshStandardMaterial({
      map: almondBark.map, normalMap: almondBark.normalMap,
      normalScale: new THREE.Vector2(1, 1), roughness: 0.9,
    }), 'almondbark', false),
    almondLeaf: windMelt(new THREE.MeshStandardMaterial({
      map: almondCanopyTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.55, vertexColors: true,
    }), 'almondleaf', false),
    bananaStem: windMelt(new THREE.MeshStandardMaterial({
      map: bananaStemTexture(), roughness: 0.6, vertexColors: true,
    }), 'bananastem', true),
    banana: windMelt(new THREE.MeshStandardMaterial({
      map: banana.map, normalMap: banana.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 0.42, vertexColors: true,
    }), 'banana', true),
    fernTrunk: windMelt(new THREE.MeshStandardMaterial({
      map: fernTrunk.map, normalMap: fernTrunk.normalMap,
      normalScale: new THREE.Vector2(1, 1), roughness: 0.95,
    }), 'ferntrunk', true),
    fern: windMelt(new THREE.MeshStandardMaterial({
      map: fernFrondTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.7, vertexColors: true,
    }), 'fern', true),
    shrub: windMelt(new THREE.MeshStandardMaterial({
      map: bigLeaf.map, normalMap: bigLeaf.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 0.5, vertexColors: true,
    }), 'shrub', true),
  };
}

const SPECIES_BUILDERS = {
  kapok: kapokVariant, almond: almondVariant,
  banana: bananaVariant, fern: fernVariant, shrub: shrubVariant,
};

// thin understory blades read translucent, so canopy shade would paint them
// near-black; they cast their look with baked tints instead of received shadow
const NO_SHADOW_RECEIVE = new Set(['banana:leaf', 'fern:leaf', 'shrub:leaf']);

// one plant standing at the origin — the /components studio uses this
// (a plain Mesh works against the instanced shader: aPhase is a per-vertex
// zero there, and the melt hides behind USE_INSTANCING)
export function buildForestPlant(species, rand) {
  const v = SPECIES_BUILDERS[species](rand);
  const mats = forestMaterials();
  const matFor = {
    kapok: { bark: 'kapokBark', leaf: 'kapokLeaf' },
    almond: { bark: 'almondBark', leaf: 'almondLeaf' },
    banana: { stem: 'bananaStem', leaf: 'banana' },
    fern: { bark: 'fernTrunk', leaf: 'fern' },
    shrub: { leaf: 'shrub' },
  }[species];
  const g = new THREE.Group();
  for (const part of Object.keys(matFor)) {
    if (!v[part]) continue;
    const mesh = new THREE.Mesh(v[part], mats[matFor[part]]);
    mesh.castShadow = true;
    mesh.receiveShadow = !NO_SHADOW_RECEIVE.has(`${species}:${part}`);
    g.add(mesh);
  }
  return g;
}

// share one variant's vertex data across chunks, each chunk carrying its
// own per-instance aPhase (instanced attributes live on the geometry, so
// chunks can't share one geometry object — but they CAN share the buffers)
function shareGeo(canon, count) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color', 'aFlex']) {
    g.setAttribute(name, canon.getAttribute(name));
  }
  g.setIndex(canon.getIndex());
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  if (!canon.boundingSphere) canon.computeBoundingSphere();
  g.boundingSphere = canon.boundingSphere.clone();
  return g;
}

// ------------------------------------------------------------- the forest
export function buildForest() {
  const group = new THREE.Group();
  group.name = 'forest';

  const COARSE = typeof matchMedia !== 'undefined'
    && matchMedia('(pointer: coarse)').matches;
  const K = COARSE ? 0.55 : 1;
  FADE.value.set(COARSE ? 55 : 120, COARSE ? 80 : 155);

  const geoRand = mulberry32(subSeed('forestGeo'));
  const variants = {
    kapok: [kapokVariant(geoRand), kapokVariant(geoRand), kapokVariant(geoRand)],
    almond: [almondVariant(geoRand), almondVariant(geoRand), almondVariant(geoRand)],
    banana: [bananaVariant(geoRand), bananaVariant(geoRand), bananaVariant(geoRand)],
    fern: [fernVariant(geoRand), fernVariant(geoRand), fernVariant(geoRand)],
    shrub: [shrubVariant(geoRand), shrubVariant(geoRand), shrubVariant(geoRand)],
  };

  const mats = forestMaterials();

  const clearNoise = new Simplex2(subSeed('forestMask'));
  const R = shoreRange().max;
  const fig = figBase();
  const s = summitPos();

  // occupancy grids keep tiers from stacking on themselves
  const taken = { canopy: new Set(), under: new Set() };
  const cellOf = (x, z, size) => `${Math.floor(x / size)},${Math.floor(z / size)}`;

  const plants = [];
  const chunks = new Map(); // key -> { per-species arrays of instances }

  const place = (rand, species, tier, spacing, gates) => {
    const az = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * (R - 40);
    const roll = rand();
    const yaw = rand() * Math.PI * 2;
    const scale = 0.82 + rand() * 0.45;
    const phase = rand() * Math.PI * 2;
    const x = Math.cos(az) * rr, z = Math.sin(az) * rr;

    const bio = biomeAt(x, z);
    const clearing = 0.5 + 0.5 * clearNoise.fbm(x * 0.02, z * 0.02, 3);
    if (bio.w.forest * THREE.MathUtils.smoothstep(clearing, 0.28, 0.62) < roll * 0.85 + gates.need) return false;
    if (bio.slopeY < gates.slopeY) return false;
    if (lagoonFreeboard(x, z) < gates.freeboard) return false;
    const tq = trailQuery(x, z);
    if (tq && tq.d < gates.trail) return false;
    if (fig && Math.hypot(x - fig.x, z - fig.z) < gates.fig) return false;
    if (Math.hypot(x - s.x, z - s.z) < 14) return false; // the campsite glade
    const cell = cellOf(x, z, spacing);
    if (taken[tier].has(cell)) return false;
    taken[tier].add(cell);

    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let ch = chunks.get(key);
    if (!ch) { ch = { cx: 0, cz: 0, n: 0 }; chunks.set(key, ch); }
    (ch[species] || (ch[species] = [])).push({
      x, y: islandHeight(x, z) - 0.06, z, yaw, scale, phase,
    });
    ch.cx += x; ch.cz += z; ch.n++;
    plants.push({ x, z, species });
    return true;
  };

  // canopy first (its clearings shape the light), then the understory
  {
    const cr = mulberry32(subSeed('forestCanopy'));
    const gates = { need: 0.06, slopeY: 0.72, freeboard: 0.6, trail: 4, fig: 10 };
    let kapok = 0, almond = 0;
    const wantK = Math.round(420 * K), wantA = Math.round(320 * K);
    for (let i = 0; i < 11000 && (kapok < wantK || almond < wantA); i++) {
      const pickKapok = kapok / wantK <= almond / wantA;
      if (place(cr, pickKapok ? 'kapok' : 'almond', 'canopy', 4.5, gates)) {
        if (pickKapok) kapok++; else almond++;
      }
    }
  }
  {
    const ur = mulberry32(subSeed('forestUnder'));
    const kinds = [
      { sp: 'banana', want: Math.round(300 * K), gates: { need: 0.03, slopeY: 0.62, freeboard: 0.3, trail: 1.9, fig: 7 } },
      { sp: 'fern', want: Math.round(500 * K), gates: { need: 0.0, slopeY: 0.58, freeboard: 0.25, trail: 1.2, fig: 5 } },
      { sp: 'shrub', want: Math.round(560 * K), gates: { need: 0.02, slopeY: 0.6, freeboard: 0.25, trail: 1.6, fig: 6 } },
    ];
    for (const k of kinds) {
      let got = 0;
      for (let i = 0; i < k.want * 14 && got < k.want; i++) {
        if (place(ur, k.sp, 'under', 1.7, k.gates)) got++;
      }
    }
  }

  // ---- chunks → InstancedMeshes ----
  const PARTS = {
    kapok: [['bark', 'kapokBark', true], ['leaf', 'kapokLeaf', true]],
    almond: [['bark', 'almondBark', true], ['leaf', 'almondLeaf', true]],
    banana: [['stem', 'bananaStem', false], ['leaf', 'banana', false]],
    fern: [['bark', 'fernTrunk', false], ['leaf', 'fern', false]],
    shrub: [['leaf', 'shrub', false]],
  };
  const underMeshes = [];
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3();
  let ci = 0;
  for (const [key, ch] of chunks) {
    ci++;
    for (const species of Object.keys(PARTS)) {
      const list = ch[species];
      if (!list || !list.length) continue;
      const variant = variants[species][(ci + species.length) % 3];
      for (const [part, matName, canopy] of PARTS[species]) {
        const canonical = variant[part];
        if (!canonical) continue;
        const geo = shareGeo(canonical, list.length);
        const inst = new THREE.InstancedMesh(geo, mats[matName], list.length);
        const phases = geo.getAttribute('aPhase');
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          v4.set(p.x, p.y, p.z);
          q4.setFromAxisAngle(UP, p.yaw);
          s4.setScalar(p.scale);
          m4.compose(v4, q4, s4);
          inst.setMatrixAt(i, m4);
          phases.setX(i, p.phase);
        }
        inst.computeBoundingSphere();
        inst.boundingSphere.radius += 2.5; // wind sway never pops at the frustum edge
        inst.castShadow = canopy; // ferns don't need a shadow pass
        inst.receiveShadow = !NO_SHADOW_RECEIVE.has(`${species}:${part}`);
        group.add(inst);
        if (!canopy) {
          underMeshes.push({
            mesh: inst,
            cx: ch.cx / ch.n, cz: ch.cz / ch.n,
            r: CHUNK * 0.75,
          });
        }
      }
    }
  }

  // distant understory chunks stop drawing entirely (the melt has already
  // shrunk them to nothing before this radius)
  let tick = 0;
  function update(player) {
    if ((tick++ & 15) !== 0 || !player) return;
    const px = player.pos.x, pz = player.pos.z;
    const reach = FADE.value.y + 10;
    for (const u of underMeshes) {
      u.mesh.visible = Math.hypot(u.cx - px, u.cz - pz) < reach + u.r;
    }
  }

  return { group, update, plants };
}
