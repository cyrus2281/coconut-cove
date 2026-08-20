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
  kapokBarkTexture, canopyClusterTexture, bananaLeafTexture, bigLeafTexture, barkTexture,
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

// one textured quad written into a MeshData: center c, half-axes va/vb
function addQuad(data, c, va, vb, tint, flex, ph = 0) {
  const p = new THREE.Vector3();
  const i00 = data.vert(p.copy(c).sub(va).sub(vb), 0, 0, tint, flex, ph);
  const i10 = data.vert(p.copy(c).add(va).sub(vb), 1, 0, tint, flex, ph);
  const i01 = data.vert(p.copy(c).sub(va).add(vb), 0, 1, tint, flex, ph);
  const i11 = data.vert(p.copy(c).add(va).add(vb), 1, 1, tint, flex, ph);
  data.quad(i00, i10, i01, i11);
}

// a tapering tube along axis points; returns the ring rows it wrote
function loftTube(data, pts, radii, around, flexes, uWrap = 2) {
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
      row.push(data.vert(q, (k / around) * uWrap, t * 3, [1, 1, 1], flexes[i], 0));
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

// ------------------------------------------------------------- species
// Each variant builds in LOCAL space, base at the origin; instances carry
// position/yaw/scale. Canopy species return {bark, leaf}; understory one geo.

function kapokVariant(rand) {
  const bark = new MeshData(), leaf = new MeshData();
  const H = 10 + rand() * 6;
  const K = H / 12; // proportion scale

  // trunk: gently leaning, buttress-flanged at the foot
  const leanA = rand() * Math.PI * 2;
  const lean = (rand() - 0.5) * 0.14;
  const ph = rand() * Math.PI * 2;
  const AR = 9;
  const pts = [], radii = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = H * 0.62 * t;
    pts.push(new THREE.Vector3(Math.cos(leanA) * lean * y, y, Math.sin(leanA) * lean * y));
    radii.push(0.36 * K * (1 - t * 0.5));
  }
  // hand-lofted so the base ring can wear its flanges
  {
    const rows = [];
    const q = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const row = [];
      for (let k = 0; k <= AR; k++) {
        const a = (k / AR) * Math.PI * 2;
        const flange = 1 + 1.1 * Math.pow(Math.max(Math.cos(5 * a + ph), 0), 2.4)
          * Math.pow(Math.max(1 - t * 3.2, 0), 1.4);
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

  // limbs reaching out of the trunk top toward the crown
  const top = pts[N];
  const anchors = [top.clone().add(new THREE.Vector3(0, H * 0.16, 0))];
  const nLimbs = 3 + (rand() < 0.5 ? 1 : 0);
  for (let l = 0; l < nLimbs; l++) {
    const a = (l / nLimbs) * Math.PI * 2 + rand() * 0.8;
    const reach = H * (0.22 + rand() * 0.14);
    const tip = new THREE.Vector3(
      top.x + Math.cos(a) * reach,
      top.y + H * (0.12 + rand() * 0.12),
      top.z + Math.sin(a) * reach
    );
    const mid = top.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, H * 0.05, 0));
    loftTube(bark, [top.clone(), mid, tip], [0.13 * K, 0.09 * K, 0.045 * K], 5, [0.03, 0.06, 0.1]);
    anchors.push(tip);
  }

  // the crown: leaf-cluster cards domed over the limb tips
  const cards = 26 + Math.floor(rand() * 10);
  const cUp = new THREE.Vector3(), va = new THREE.Vector3(), vb = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < cards; i++) {
    const an = anchors[Math.floor(rand() * anchors.length)];
    const a = rand() * Math.PI * 2;
    const rr = H * 0.30 * Math.pow(rand(), 0.5);
    const yj = (rand() - 0.35) * H * 0.16;
    c.set(an.x + Math.cos(a) * rr, an.y + yj, an.z + Math.sin(a) * rr);
    const s = (1.5 + rand() * 1.3) * K;
    cUp.set(rand() - 0.5, 0.6 + rand() * 0.8, rand() - 0.5).normalize();
    va.crossVectors(cUp, UP);
    if (va.lengthSq() < 0.01) va.set(1, 0, 0);
    va.normalize().multiplyScalar(s);
    vb.crossVectors(cUp, va).normalize().multiplyScalar(s);
    const g = 0.8 + rand() * 0.4;
    addQuad(leaf, c, va, vb, [g, g * (0.92 + rand() * 0.16), g * 0.9],
      0.10 + rand() * 0.1 + (c.y / H) * 0.06);
  }

  return { bark: bark.build(), leaf: leaf.build() };
}

function almondVariant(rand) {
  const bark = new MeshData(), leaf = new MeshData();
  const H = 7 + rand() * 4;
  const K = H / 9;

  const pts = [], radii = [], flexes = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3((rand() - 0.5) * 0.14 * t, H * t, (rand() - 0.5) * 0.14 * t));
    radii.push(0.17 * K * (1 - t * 0.62));
    flexes.push(0.02 + t * 0.06);
  }
  loftTube(bark, pts, radii, 7, flexes);

  // pagoda tiers: near-horizontal rings of cards, narrowing upward
  const tiers = 3 + (rand() < 0.5 ? 1 : 0);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), c = new THREE.Vector3();
  for (let ti = 0; ti < tiers; ti++) {
    const t = ti / Math.max(tiers - 1, 1);
    const y = H * (0.44 + 0.52 * t);
    const tierR = H * 0.30 * (1 - t * 0.42);
    const nC = 7 + Math.floor(rand() * 3);
    for (let i = 0; i < nC; i++) {
      const a = (i / nC) * Math.PI * 2 + rand() * 0.5;
      const rr = tierR * (0.55 + rand() * 0.5);
      c.set(Math.cos(a) * rr, y + (rand() - 0.4) * 0.5, Math.sin(a) * rr);
      const s = (1.0 + rand() * 0.8) * K;
      // lying nearly flat — the almond's tiered silhouette
      va.set(Math.cos(a + Math.PI / 2), (rand() - 0.5) * 0.24, Math.sin(a + Math.PI / 2)).normalize().multiplyScalar(s);
      vb.set(Math.cos(a), 0.22 + rand() * 0.2, Math.sin(a)).normalize().multiplyScalar(s);
      const g = 0.82 + rand() * 0.42;
      addQuad(leaf, c, va, vb, [g * 1.02, g, g * 0.82], 0.10 + t * 0.08);
    }
  }
  return { bark: bark.build(), leaf: leaf.build() };
}

function bananaVariant(rand) {
  const data = new MeshData();
  const H = 1.3 + rand() * 0.8;

  // pseudostem
  loftTube(data,
    [new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, H * 0.6, 0), new THREE.Vector3(0, H, 0)],
    [0.14, 0.11, 0.07], 5, [0, 0.02, 0.05]);

  // huge arching paddles
  const leaves = 6 + Math.floor(rand() * 3);
  const p = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3();
  for (let l = 0; l < leaves; l++) {
    const a = (l / leaves) * Math.PI * 2 + rand() * 0.7;
    const len = 1.7 + rand() * 1.1;
    const w0 = 0.26 + rand() * 0.1;
    const pitch0 = 0.62 - rand() * 0.28;    // launch angle up from the stem top
    const droop = 0.5 + rand() * 0.45;      // arcing over, not plunging
    fwd.set(Math.cos(a), 0, Math.sin(a));
    side.set(-Math.sin(a), 0, Math.cos(a));
    const g = 0.8 + rand() * 0.4;
    const tint = [g * 0.9, g, g * 0.85];
    const rows = [];
    const SEG = 4;
    for (let sI = 0; sI <= SEG; sI++) {
      const t = sI / SEG;
      const along = len * t;
      const rise = Math.sin(pitch0) * along - droop * t * t * len * 0.45;
      p.set(fwd.x * Math.cos(pitch0) * along, H + rise, fwd.z * Math.cos(pitch0) * along);
      const w = w0 * Math.sin(Math.min(t * 1.35, 1) * Math.PI) + 0.02;
      const fl = 0.06 + t * t * 0.3;
      rows.push([
        data.vert(new THREE.Vector3(p.x - side.x * w, p.y, p.z - side.z * w), 0, t, tint, fl, 0),
        data.vert(new THREE.Vector3(p.x + side.x * w, p.y, p.z + side.z * w), 1, t, tint, fl, 0),
      ]);
    }
    for (let sI = 0; sI < SEG; sI++) {
      data.quad(rows[sI][0], rows[sI][1], rows[sI + 1][0], rows[sI + 1][1]);
    }
  }
  return { leaf: data.build() };
}

function fernVariant(rand) {
  const data = new MeshData();
  const fronds = 7 + Math.floor(rand() * 3);
  const p = new THREE.Vector3(), side = new THREE.Vector3();
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rand() * 0.6;
    const len = 1.0 + rand() * 0.5;
    const pitch = 0.95 - rand() * 0.4;
    side.set(-Math.sin(a), 0, Math.cos(a));
    const rows = [];
    const SEG = 4;
    for (let sI = 0; sI <= SEG; sI++) {
      const t = sI / SEG;
      const along = len * t;
      const rise = Math.sin(pitch) * along - 0.9 * t * t * len * 0.5;
      p.set(Math.cos(a) * Math.cos(pitch) * along, 0.06 + rise, Math.sin(a) * Math.cos(pitch) * along);
      const w = (0.14 * (1 - t * 0.8) + 0.02);
      const g = 0.5 + t * 0.6;
      const tint = [0.16 * g, 0.34 * g, 0.12 * g];
      const fl = 0.05 + t * t * 0.28;
      rows.push([
        data.vert(new THREE.Vector3(p.x - side.x * w, p.y, p.z - side.z * w), 0, t, tint, fl, 0),
        data.vert(new THREE.Vector3(p.x + side.x * w, p.y, p.z + side.z * w), 1, t, tint, fl, 0),
      ]);
    }
    for (let sI = 0; sI < SEG; sI++) {
      data.quad(rows[sI][0], rows[sI][1], rows[sI + 1][0], rows[sI + 1][1]);
    }
  }
  return { leaf: data.build() };
}

function shrubVariant(rand) {
  const data = new MeshData();
  const cards = 4 + Math.floor(rand() * 3);
  const c = new THREE.Vector3(), va = new THREE.Vector3(), vb = new THREE.Vector3();
  for (let i = 0; i < cards; i++) {
    const a = (i / cards) * Math.PI * 2 + rand() * 0.8;
    const tilt = 0.5 + rand() * 0.5; // leaning up-and-out on its stalk
    const s = 0.3 + rand() * 0.18;
    const d = 0.12 + rand() * 0.2;
    c.set(Math.cos(a) * d, 0.34 + rand() * 0.3, Math.sin(a) * d);
    va.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(s);
    vb.set(Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt)).multiplyScalar(s * 1.35);
    const g = 0.78 + rand() * 0.44;
    addQuad(data, c, va, vb, [g * 0.92, g, g * 0.85], 0.10 + rand() * 0.08);
  }
  return { leaf: data.build() };
}

// the forest's seven materials — shared across every chunk of a build
function forestMaterials() {
  return {
    kapokBark: windMelt(new THREE.MeshStandardMaterial({
      map: kapokBarkTexture(), roughness: 0.9,
    }), 'kapokbark', false),
    kapokLeaf: windMelt(new THREE.MeshStandardMaterial({
      map: canopyClusterTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.6, vertexColors: true,
    }), 'kapokleaf', false),
    almondBark: windMelt(new THREE.MeshStandardMaterial({
      map: barkTexture(true), roughness: 0.92,
    }), 'almondbark', false),
    almondLeaf: windMelt(new THREE.MeshStandardMaterial({
      map: canopyClusterTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.62, vertexColors: true,
    }), 'almondleaf', false),
    banana: windMelt(new THREE.MeshStandardMaterial({
      map: bananaLeafTexture(), alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 0.55, vertexColors: true,
    }), 'banana', true),
    fern: windMelt(new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide, roughness: 0.7,
    }), 'fern', true),
    shrub: windMelt(new THREE.MeshStandardMaterial({
      map: bigLeafTexture(), alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 0.6, vertexColors: true,
    }), 'shrub', true),
  };
}

const SPECIES_BUILDERS = {
  kapok: kapokVariant, almond: almondVariant,
  banana: bananaVariant, fern: fernVariant, shrub: shrubVariant,
};

// one plant standing at the origin — the /components studio uses this
// (a plain Mesh works against the instanced shader: aPhase is a per-vertex
// zero there, and the melt hides behind USE_INSTANCING)
export function buildForestPlant(species, rand) {
  const v = SPECIES_BUILDERS[species](rand);
  const mats = forestMaterials();
  const matFor = {
    kapok: ['kapokBark', 'kapokLeaf'], almond: ['almondBark', 'almondLeaf'],
    banana: ['banana', 'banana'], fern: ['fern', 'fern'], shrub: ['shrub', 'shrub'],
  }[species];
  const g = new THREE.Group();
  if (v.bark) {
    const bark = new THREE.Mesh(v.bark, mats[matFor[0]]);
    bark.castShadow = true; bark.receiveShadow = true;
    g.add(bark);
  }
  const leaf = new THREE.Mesh(v.leaf, mats[matFor[1]]);
  leaf.castShadow = true; leaf.receiveShadow = true;
  g.add(leaf);
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
    banana: [['leaf', 'banana', false]],
    fern: [['leaf', 'fern', false]],
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
        inst.receiveShadow = true;
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
