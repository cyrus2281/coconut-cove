// The coral reef. Seeded clusters grow on the turquoise shelf just offshore:
// boulder bases, brain corals, branching staghorn thickets, table corals,
// swaying gorgonian fans, tube sponges, anemones, urchins, starfish and the
// odd giant clam, with seagrass meadows in the shallower sand between. One
// InstancedMesh per kind keeps the whole garden to a handful of draw calls.
// Everything is placed with the island height function so the reef always
// sits believably on the sea floor, whatever island the seed grew.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, Simplex2 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { islandHeight, shoreRadius, cayCenter } from './island.js';
import { uwPatch } from './underwater.js';

// ---------------------------------------------------------------- helpers
function constColor(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function orientCyl(geo, from, to) {
  // stand a Y-axis cylinder between two points
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geo.applyQuaternion(q);
  geo.translate(
    (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2
  );
  return { len };
}

function canvasTex(w, h, paint, { srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------- geometries
// weathered reef boulder, colored by noise (gray stone, coralline pink
// crusts, a green algae skirt near the base)
function rockGeo(seed) {
  const rand = mulberry32(seed);
  const noise = new Simplex2(seed);
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  const n = p.count;
  const col = new Float32Array(n * 3);
  const ph = rand() * 40;
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const d = 1 + noise.fbm(v.x * 1.3 + ph, v.z * 1.3 + v.y, 3) * 0.38;
    v.multiplyScalar(d);
    v.y *= 0.72;
    p.setXYZ(i, v.x, v.y, v.z);
    const m = noise.fbm(v.x * 2.2 + ph * 2, v.z * 2.2 - v.y * 1.5, 3);
    let r = 0.30, g = 0.28, b = 0.26; // gray stone
    if (m > 0.2) { r = 0.66; g = 0.30; b = 0.40; }        // coralline pink
    else if (m < -0.22) { r = 0.18; g = 0.32; b = 0.16; } // algae film
    const shade = 0.8 + 0.2 * (v.y + 1) * 0.5;
    col[i * 3] = r * shade; col[i * 3 + 1] = g * shade; col[i * 3 + 2] = b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// brain coral: a squashed hemisphere with ridge-wobble, wearing a painted
// maze of meandering grooves
function brainGeo(seed) {
  const noise = new Simplex2(seed);
  const geo = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const d = 1 + noise.fbm(v.x * 2.4, v.z * 2.4 + v.y * 1.8, 3) * 0.12;
    v.multiplyScalar(d);
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function brainTexture() {
  return canvasTex(256, 256, (ctx) => {
    const rand = mulberry32(4021);
    ctx.fillStyle = '#b98d63';
    ctx.fillRect(0, 0, 256, 256);
    // meandering grooves: dark channel with a bright ridge alongside
    for (let i = 0; i < 60; i++) {
      let x = rand() * 256, y = rand() * 256;
      let a = rand() * Math.PI * 2;
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      for (const [col, off] of [['#7a5136', 0], ['#d8b183', 2.6]]) {
        ctx.strokeStyle = col;
        ctx.beginPath();
        let px = x + off, py = y + off, pa = a;
        ctx.moveTo(px, py);
        for (let s = 0; s < 14; s++) {
          pa += (rand() - 0.5) * 1.4;
          px += Math.cos(pa) * 9;
          py += Math.sin(pa) * 9;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.lineWidth = 3;
      }
    }
  });
}

// staghorn coral: a recursive thicket of tapering branches, tips bleaching
// to cream
function stagGeo(seed, baseCol, tipCol) {
  const rand = mulberry32(seed);
  const geos = [];
  const MAXD = 3;
  const _from = new THREE.Vector3(), _to = new THREE.Vector3();
  function branch(px, py, pz, dir, len, rad, depth) {
    _from.set(px, py, pz);
    _to.copy(_from).addScaledVector(dir, len);
    // overshoot the joint a hair so child branches bury into their parent
    const cyl = new THREE.CylinderGeometry(rad * 0.7, rad, len + rad * 1.6, 6, 1);
    orientCyl(cyl, _from, _to);
    const k = depth / MAXD;
    constColor(cyl,
      baseCol.r + (tipCol.r - baseCol.r) * k,
      baseCol.g + (tipCol.g - baseCol.g) * k,
      baseCol.b + (tipCol.b - baseCol.b) * k);
    geos.push(cyl);
    if (depth >= MAXD) return;
    // _to is a shared temp the recursion clobbers: pin this joint down first
    const jx = _to.x, jy = _to.y, jz = _to.z;
    const kids = depth === 0 ? 3 : 2;
    for (let c = 0; c < kids; c++) {
      const ax = new THREE.Vector3(rand() - 0.5, rand() * 0.3, rand() - 0.5).normalize();
      const nd = dir.clone().applyAxisAngle(ax, 0.4 + rand() * 0.55).normalize();
      if (nd.y < 0.12) nd.y = 0.12 + rand() * 0.2;
      nd.normalize();
      branch(jx, jy, jz, nd, len * (0.66 + rand() * 0.14), rad * 0.62, depth + 1);
    }
  }
  for (let tr = 0; tr < 3; tr++) {
    const a = rand() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4).normalize();
    branch(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05, dir, 0.3 + rand() * 0.12, 0.034, 0);
  }
  return mergeGeometries(geos);
}

// table coral: a stubby stem under a wide, bumpy, wobble-edged plate
function tableGeo(seed) {
  const rand = mulberry32(seed);
  const noise = new Simplex2(seed);
  const shape = new THREE.Shape();
  const R = 0.5;
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = R * (0.82 + 0.18 * Math.sin(a * 3 + rand() * 9) * Math.sin(a * 5 + rand() * 7));
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const plate = new THREE.ExtrudeGeometry(shape, {
    depth: 0.055, bevelEnabled: false, curveSegments: 4,
  });
  plate.rotateX(-Math.PI / 2); // slab lies flat, top at y ≈ 0.055
  plate.translate(0, 0.26, 0);
  const p = plate.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y > 0.30) p.setY(i, y + noise.fbm(x * 6, z * 6, 2) * 0.035);
  }
  plate.computeVertexNormals();
  // top face khaki-green, underside and stem shadowed brown
  const n = p.count;
  const col = new Float32Array(n * 3);
  const nrm = plate.attributes.normal;
  for (let i = 0; i < n; i++) {
    if (nrm.getY(i) > 0.45) { col[i * 3] = 0.66; col[i * 3 + 1] = 0.62; col[i * 3 + 2] = 0.42; }
    else { col[i * 3] = 0.34; col[i * 3 + 1] = 0.26; col[i * 3 + 2] = 0.18; }
  }
  plate.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // the extruded plate is non-indexed; the stem must match or the merge nulls
  const stem = new THREE.CylinderGeometry(0.07, 0.11, 0.3, 8).toNonIndexed();
  stem.translate(0, 0.15, 0);
  constColor(stem, 0.34, 0.26, 0.18);
  return mergeGeometries([plate, stem]);
}

// gorgonian sea fan: a painted lace of branching veins on a swaying plane
function fanTexture() {
  return canvasTex(256, 224, (ctx) => {
    const rand = mulberry32(913);
    ctx.clearRect(0, 0, 256, 224);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(238, 232, 244, 0.96)';
    function vein(x, y, ang, w, depth) {
      if (depth > 7 || y < 6) return;
      const len = 14 + rand() * 16;
      const nx = x + Math.sin(ang) * len;
      const ny = y - Math.cos(ang) * len * 0.9;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      const n = depth < 2 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        vein(nx, ny, ang + (rand() - 0.5) * 0.9, Math.max(w * 0.72, 0.7), depth + 1);
      }
    }
    for (let i = -2; i <= 2; i++) vein(128, 220, i * 0.30, 5, 0);
    // fine mesh connecting the lace so it reads solid from a distance
    ctx.strokeStyle = 'rgba(238, 232, 244, 0.30)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 340; i++) {
      const x = rand() * 256, y = rand() * 200;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 16, y + (rand() - 0.5) * 16);
      ctx.stroke();
    }
  });
}

// tube sponge: a leaning cluster of open-mouthed tubes
function spongeGeo(seed) {
  const rand = mulberry32(seed);
  const pts = [];
  for (const [r, y] of [[0.055, 0], [0.075, 0.06], [0.062, 0.2], [0.058, 0.34], [0.07, 0.44], [0.052, 0.47]]) {
    pts.push(new THREE.Vector2(r, y));
  }
  const geos = [];
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const tube = new THREE.LatheGeometry(pts, 10);
    const s = 0.6 + rand() * 0.8;
    tube.scale(s, s * (0.8 + rand() * 0.6), s);
    const a = rand() * Math.PI * 2;
    const lean = rand() * 0.35;
    tube.rotateZ(Math.cos(a) * lean);
    tube.rotateX(Math.sin(a) * lean);
    tube.translate((rand() - 0.5) * 0.22, 0, (rand() - 0.5) * 0.22);
    geos.push(tube);
  }
  return mergeGeometries(geos);
}

function spongeTexture() {
  return canvasTex(128, 128, (ctx) => {
    const rand = mulberry32(577);
    ctx.fillStyle = '#cabfd8'; // near-white violet; instance color tints it
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const a = 0.12 + rand() * 0.3;
      ctx.fillStyle = rand() < 0.5 ? `rgba(60,44,80,${a})` : `rgba(255,250,255,${a * 0.7})`;
      ctx.fillRect(rand() * 128, rand() * 128, 1.5, 2.5);
    }
    // the dark mouth of the tube (lathe v≈1 at the lip)
    const g = ctx.createLinearGradient(0, 118, 0, 128);
    g.addColorStop(0, 'rgba(20,12,28,0)');
    g.addColorStop(1, 'rgba(12,8,18,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 118, 128, 10);
  });
}

// anemone: a mauve cushion crowded with bright-tipped tentacles
function anemoneGeo(seed) {
  const rand = mulberry32(seed);
  const geos = [];
  const dome = new THREE.SphereGeometry(0.16, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.5, 1);
  constColor(dome, 0.55, 0.32, 0.42);
  geos.push(dome);
  const N = 46;
  for (let i = 0; i < N; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * 0.13;
    const len = 0.14 + rand() * 0.12;
    const t = new THREE.CylinderGeometry(0.004, 0.012, len, 5, 3);
    // per-vertex gradient: dusky base to glowing tip
    const p = t.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let vi = 0; vi < p.count; vi++) {
      const k = THREE.MathUtils.clamp(p.getY(vi) / len + 0.5, 0, 1);
      col[vi * 3] = 0.5 + 0.5 * k;
      col[vi * 3 + 1] = 0.36 + 0.58 * k;
      col[vi * 3 + 2] = 0.5 + 0.5 * k;
    }
    t.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const out = new THREE.Vector3(Math.cos(a) * rr * 4, 1, Math.sin(a) * rr * 4).normalize();
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out));
    t.translate(Math.cos(a) * rr, 0.07 + len * 0.4, Math.sin(a) * rr);
    geos.push(t);
  }
  return mergeGeometries(geos);
}

// urchin: a dark little mine of needles
function urchinGeo(seed) {
  const rand = mulberry32(seed);
  const geos = [];
  const body = new THREE.SphereGeometry(0.045, 10, 8);
  constColor(body, 0.09, 0.05, 0.12);
  geos.push(body);
  for (let i = 0; i < 60; i++) {
    const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    if (dir.y < -0.35) dir.y = -0.35;
    const len = 0.07 + rand() * 0.08;
    const sp = new THREE.CylinderGeometry(0.0012, 0.0042, len, 4, 1);
    const p = sp.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let vi = 0; vi < p.count; vi++) {
      const k = THREE.MathUtils.clamp(p.getY(vi) / len + 0.5, 0, 1);
      col[vi * 3] = 0.1 + 0.25 * k;
      col[vi * 3 + 1] = 0.05 + 0.1 * k;
      col[vi * 3 + 2] = 0.14 + 0.3 * k;
    }
    sp.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sp.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    sp.translate(dir.x * (0.04 + len * 0.4), dir.y * (0.04 + len * 0.4), dir.z * (0.04 + len * 0.4));
    geos.push(sp);
  }
  return mergeGeometries(geos);
}

// starfish: five plump arms, knobbed down the midlines
function starGeo() {
  const shape = new THREE.Shape();
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const lobe = Math.pow(Math.abs(Math.cos(a * 2.5)), 0.72);
    const r = 0.045 + 0.115 * lobe;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2,
    curveSegments: 4,
  });
  geo.rotateX(-Math.PI / 2);
  // dome the middle up a little
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.hypot(x, z);
    p.setY(i, p.getY(i) + Math.max(0, 1 - d / 0.16) * 0.022);
  }
  geo.computeVertexNormals();
  return geo;
}

function starTexture() {
  return canvasTex(128, 128, (ctx) => {
    const rand = mulberry32(311);
    ctx.fillStyle = '#e8e2da'; // near-white; instance color paints the species
    ctx.fillRect(0, 0, 128, 128);
    // knobby ossicles marching out along each arm
    for (let arm = 0; arm < 5; arm++) {
      const a = (arm / 5) * Math.PI * 2 + Math.PI / 2;
      for (let s = 0; s < 9; s++) {
        const r = 8 + s * 6;
        const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
        ctx.fillStyle = `rgba(90, 70, 60, ${0.5 - s * 0.04})`;
        ctx.beginPath();
        ctx.arc(x + (rand() - 0.5) * 3, y + (rand() - 0.5) * 3, 2.6 - s * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(120, 96, 82, ${0.1 + rand() * 0.2})`;
      ctx.fillRect(rand() * 128, rand() * 128, 1.5, 1.5);
    }
  });
}

// seagrass tuft: three curved blades
function grassGeo(seed) {
  const rand = mulberry32(seed);
  const geos = [];
  for (let b = 0; b < 3; b++) {
    const H = 0.34 + rand() * 0.3;
    const blade = new THREE.PlaneGeometry(0.042, H, 1, 4);
    blade.translate(0, H / 2, 0);
    const p = blade.attributes.position;
    const col = new Float32Array(p.count * 3);
    const lean = (rand() - 0.5) * 0.24;
    for (let i = 0; i < p.count; i++) {
      const k = p.getY(i) / H;
      p.setX(i, p.getX(i) + k * k * lean);
      col[i * 3] = 0.10 + 0.22 * k;
      col[i * 3 + 1] = 0.30 + 0.42 * k;
      col[i * 3 + 2] = 0.10 + 0.14 * k;
    }
    blade.setAttribute('color', new THREE.BufferAttribute(col, 3));
    blade.rotateY(rand() * Math.PI * 2);
    blade.translate((rand() - 0.5) * 0.06, 0, (rand() - 0.5) * 0.06);
    geos.push(blade);
  }
  return mergeGeometries(geos);
}

// giant clam shells (built per-clam, not instanced — there are only a few)
function clamShellGeo() {
  const geo = new THREE.SphereGeometry(1, 26, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const flute = 1 + 0.07 * Math.sin(a * 7);
    p.setXYZ(i, x * flute, y * 0.45, z * flute);
  }
  geo.computeVertexNormals();
  return geo;
}

function clamShellTexture() {
  return canvasTex(256, 64, (ctx) => {
    ctx.fillStyle = '#cfc4ae';
    ctx.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 14; i++) {
      const x = (i / 14) * 256;
      const g = ctx.createLinearGradient(x, 0, x + 18, 0);
      g.addColorStop(0, 'rgba(120,104,84,0.5)');
      g.addColorStop(0.5, 'rgba(255,250,238,0.35)');
      g.addColorStop(1, 'rgba(120,104,84,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 18, 64);
    }
  });
}

function clamMantleTexture() {
  return canvasTex(256, 64, (ctx) => {
    const rand = mulberry32(742);
    ctx.fillStyle = '#0d6f78';
    ctx.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = rand() < 0.6 ? '#15c4c9' : '#0a2c50';
      ctx.beginPath();
      ctx.arc(rand() * 256, rand() * 64, 1.5 + rand() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ------------------------------------------------------------------ build
export const FAN_TINTS = [[0.85, 0.3, 0.45], [0.9, 0.5, 0.2], [0.6, 0.35, 0.8], [0.92, 0.75, 0.3]];
export const SPONGE_TINTS = [[0.62, 0.5, 0.95], [0.95, 0.75, 0.35], [0.9, 0.45, 0.4]];
export const STAR_TINTS = [[0.95, 0.42, 0.2], [0.35, 0.5, 0.95], [0.9, 0.3, 0.5]];
export const ANEM_TINTS = [[1.0, 0.85, 1.0], [0.75, 1.0, 0.85], [1.0, 0.95, 0.7]];

// Everything the beds plant, by name. buildReef() instances the whole set;
// the /components viewer asks for one kind at a time.
export const REEF_KINDS = [
  'rock', 'brain', 'stagA', 'stagB', 'table', 'fan',
  'sponge', 'anemone', 'urchin', 'star', 'grass',
];

export function reefGeometry(kind) {
  switch (kind) {
    case 'rock': return rockGeo(subSeed('reefRock'));
    case 'brain': return brainGeo(subSeed('reefBrain'));
    case 'stagA': return stagGeo(subSeed('reefStagA'),
      new THREE.Color(0.62, 0.4, 0.26), new THREE.Color(0.88, 0.72, 0.5));
    case 'stagB': return stagGeo(subSeed('reefStagB'),
      new THREE.Color(0.34, 0.22, 0.48), new THREE.Color(0.72, 0.5, 0.88));
    case 'table': return tableGeo(subSeed('reefTable'));
    case 'fan': {
      const g = new THREE.PlaneGeometry(1.3, 1.1, 8, 6);
      g.translate(0, 0.55, 0);
      return g;
    }
    case 'sponge': return spongeGeo(subSeed('reefSponge'));
    case 'anemone': return anemoneGeo(subSeed('reefAnem'));
    case 'urchin': return urchinGeo(subSeed('reefUrchin'));
    case 'star': return starGeo();
    case 'grass': return grassGeo(subSeed('reefGrass'));
    default: throw new Error('unknown reef kind: ' + kind);
  }
}

// Every reef material wears the underwater treatment; the fan, the anemone
// and the seagrass also rock in the current.
export function reefMaterial(kind) {
  const vertexMat = (name, opts = {}, patch = {}) => uwPatch(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, metalness: 0.0, ...opts,
  }), name, patch);

  switch (kind) {
    case 'rock': return vertexMat('rock');
    case 'brain': return uwPatch(new THREE.MeshStandardMaterial({
      map: brainTexture(), roughness: 0.9,
    }), 'brain');
    case 'stagA': return vertexMat('stagA');
    case 'stagB': return vertexMat('stagB');
    case 'table': return vertexMat('table');
    case 'fan': return uwPatch(new THREE.MeshStandardMaterial({
      map: fanTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8,
    }), 'fan', { sway: 0.5, swaySpeed: 0.8 });
    case 'sponge': return uwPatch(new THREE.MeshStandardMaterial({
      map: spongeTexture(), roughness: 0.92,
    }), 'sponge');
    case 'anemone': return vertexMat('anemone', { roughness: 0.6 }, { sway: 3.2, swaySpeed: 1.6 });
    case 'urchin': return vertexMat('urchin', { roughness: 0.5 });
    case 'star': return uwPatch(new THREE.MeshStandardMaterial({
      map: starTexture(), roughness: 0.8,
    }), 'star');
    case 'grass': return vertexMat('grass', { side: THREE.DoubleSide }, { sway: 1.4, swaySpeed: 1.1 });
    default: throw new Error('unknown reef kind: ' + kind);
  }
}

const byKind = (fn) => Object.fromEntries(REEF_KINDS.map((k) => [k, fn(k)]));

// A giant clam of half-width `s`: a cupped bottom shell, a hinged lid, and
// the iridescent mantle between them. update() in buildReef swings the lid.
export function clamAssets() {
  return {
    shellGeo: clamShellGeo(),
    shellMat: uwPatch(new THREE.MeshStandardMaterial({
      map: clamShellTexture(), roughness: 0.8,
    }), 'clamshell'),
    mantleMat: uwPatch(new THREE.MeshStandardMaterial({
      map: clamMantleTexture(), roughness: 0.4,
      emissive: new THREE.Color(0.04, 0.22, 0.24),
    }), 'clammantle'),
  };
}

export function clamRig(s, { shellGeo, shellMat, mantleMat }) {
  const g = new THREE.Group();
  const bottom = new THREE.Mesh(shellGeo, shellMat);
  bottom.scale.set(s, s, s * 0.9);
  bottom.rotation.x = Math.PI; // cupped upward
  bottom.position.y = s * 0.45;
  g.add(bottom);
  const lid = new THREE.Group();
  lid.position.set(-s, s * 0.45, 0); // hinge at the back lip
  const top = new THREE.Mesh(shellGeo, shellMat);
  top.scale.set(s, s, s * 0.9);
  top.position.x = s;
  lid.add(top);
  g.add(lid);
  const mantle = new THREE.Mesh(
    new THREE.TorusGeometry(s * 0.72, s * 0.17, 7, 22),
    mantleMat
  );
  mantle.rotation.x = -Math.PI / 2;
  mantle.position.y = s * 0.5;
  mantle.scale.z = 0.55;
  g.add(mantle);
  return { g, lid, mantle };
}

export function buildReef() {
  const group = new THREE.Group();
  group.name = 'reef';
  const rand = mulberry32(subSeed('reef'));

  // ---- find the cluster sites ----
  const clusters = [];
  const want = 7 + Math.floor(rand() * 3);
  const trySite = (x, z) => {
    const h = islandHeight(x, z);
    if (h > -1.5 || h < -6.5) return false;
    const r = 3.5 + rand() * 4;
    for (const c of clusters) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + r + 7) return false;
    }
    clusters.push({ x, z, r, h });
    return true;
  };
  for (let i = 0; i < 300 && clusters.length < want; i++) {
    const az = rand() * Math.PI * 2;
    const d = 9 + rand() * 34;
    const rr = shoreRadius(az) + d;
    trySite(Math.cos(az) * rr, Math.sin(az) * rr);
  }
  // a couple of gardens ring the offshore cay too
  const cay = cayCenter();
  for (let i = 0, got = 0; i < 40 && got < 2; i++) {
    const a = rand() * Math.PI * 2;
    const d = 12 + rand() * 12;
    if (trySite(cay.x + Math.cos(a) * d, cay.z + Math.sin(a) * d)) got++;
  }

  // ---- gather instance transforms per kind ----
  const kinds = {
    rock: [], brain: [], stagA: [], stagB: [], table: [], fan: [],
    sponge: [], anemone: [], urchin: [], star: [], grass: [],
  };
  const anemones = []; // world positions, for the clownfish
  const meadows = [];  // seagrass patch centers, for the rays

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
    _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  function put(list, x, y, z, scale, yScale = scale, tint = null, tilt = 0.06) {
    _e.set((rand() - 0.5) * tilt * 2, rand() * Math.PI * 2, (rand() - 0.5) * tilt * 2);
    _q.setFromEuler(_e);
    _v.set(x, y, z);
    _s.set(scale, yScale, scale);
    _m.compose(_v, _q, _s);
    list.push({ m: _m.clone(), tint });
  }
  const scatter = (cl, n, fn, frac = 1) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * cl.r * frac;
      const x = cl.x + Math.cos(a) * rr;
      const z = cl.z + Math.sin(a) * rr;
      fn(x, islandHeight(x, z), z);
    }
  };

  for (const cl of clusters) {
    // a mounded core of boulders the corals colonize…
    scatter(cl, 4 + Math.floor(rand() * 3), (x, y, z) =>
      put(kinds.rock, x, y - 0.2, z, 0.9 + rand() * 1.3, 0.55 + rand() * 0.6), 0.45);
    scatter(cl, 2 + Math.floor(rand() * 3), (x, y, z) =>
      put(kinds.brain, x, y - 0.06 + rand() * 0.3, z, 0.45 + rand() * 0.75), 0.6);
    // …with the branching thickets around the shoulders. Tall kinds are
    // height-capped by the local depth so nothing pokes out of the sea.
    const capY = (y, tall, s) => Math.min(s, Math.max((-y - 0.5) / tall, 0.35));
    scatter(cl, 3 + Math.floor(rand() * 4), (x, y, z) => {
      const s = 0.9 + rand() * 1.0;
      put(kinds.stagA, x, y - 0.02, z, s, capY(y, 1.3, s));
    }, 0.8);
    scatter(cl, 2 + Math.floor(rand() * 3), (x, y, z) => {
      const s = 0.9 + rand() * 1.0;
      put(kinds.stagB, x, y - 0.02, z, s, capY(y, 1.3, s));
    }, 0.8);
    scatter(cl, 1 + Math.floor(rand() * 2), (x, y, z) =>
      put(kinds.table, x, y - 0.02, z, 0.9 + rand() * 1.2));
    scatter(cl, 3 + Math.floor(rand() * 3), (x, y, z) => {
      const s = 0.7 + rand() * 0.9;
      put(kinds.fan, x, y - 0.02, z, s, capY(y, 1.15, s),
        FAN_TINTS[Math.floor(rand() * FAN_TINTS.length)]);
    });
    scatter(cl, 2 + Math.floor(rand() * 3), (x, y, z) =>
      put(kinds.sponge, x, y - 0.02, z, 0.7 + rand() * 0.8, undefined,
        SPONGE_TINTS[Math.floor(rand() * SPONGE_TINTS.length)]));
    scatter(cl, 2 + Math.floor(rand() * 4), (x, y, z) =>
      put(kinds.urchin, x, y + 0.01, z, 0.8 + rand() * 0.9));
    scatter(cl, 1 + Math.floor(rand() * 2), (x, y, z) =>
      put(kinds.star, x, y + 0.005, z, 0.8 + rand() * 0.7, undefined,
        STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)]));
    if (rand() < 0.65) {
      scatter(cl, 1 + (rand() < 0.3 ? 1 : 0), (x, y, z) => {
        put(kinds.anemone, x, y - 0.01, z, 0.9 + rand() * 0.8, undefined,
          ANEM_TINTS[Math.floor(rand() * ANEM_TINTS.length)]);
        anemones.push({ x, y: y + 0.12, z });
      });
    }
  }

  // lone corals sprinkled between the gardens
  for (let i = 0; i < 30; i++) {
    const az = rand() * Math.PI * 2;
    const d = 6 + rand() * 40;
    const rr = shoreRadius(az) + d;
    const x = Math.cos(az) * rr, z = Math.sin(az) * rr;
    const h = islandHeight(x, z);
    if (h > -1.1 || h < -7.5) continue;
    const pick = rand();
    if (pick < 0.3) put(kinds.rock, x, h - 0.2, z, 0.4 + rand() * 0.7, 0.35 + rand() * 0.4);
    else if (pick < 0.55) put(kinds.brain, x, h - 0.04, z, 0.22 + rand() * 0.3);
    else if (pick < 0.8) {
      const s = 0.6 + rand() * 0.6;
      put(kinds.stagA, x, h - 0.02, z, s, Math.min(s, Math.max((-h - 0.5) / 1.3, 0.35)));
    } else put(kinds.urchin, x, h + 0.01, z, 0.8 + rand() * 0.6);
  }

  // seagrass meadows in the sandy shallows
  const nMeadows = 3 + Math.floor(rand() * 3);
  for (let mI = 0; mI < nMeadows; mI++) {
    let placed = false;
    for (let tries = 0; tries < 30 && !placed; tries++) {
      const az = rand() * Math.PI * 2;
      const d = 4 + rand() * 12;
      const rr = shoreRadius(az) + d;
      const cx = Math.cos(az) * rr, cz = Math.sin(az) * rr;
      const h = islandHeight(cx, cz);
      if (h > -0.75 || h < -2.6) continue;
      if (clusters.some((c) => Math.hypot(cx - c.x, cz - c.z) < c.r + 6)) continue;
      const mr = 4 + rand() * 4;
      meadows.push({ x: cx, z: cz, r: mr });
      const nT = 120 + Math.floor(rand() * 80);
      for (let i = 0; i < nT; i++) {
        const a = rand() * Math.PI * 2;
        const rrr = Math.sqrt(rand()) * mr;
        const x = cx + Math.cos(a) * rrr, z = cz + Math.sin(a) * rrr;
        const y = islandHeight(x, z);
        if (y > -0.3) continue;
        put(kinds.grass, x, y - 0.01, z, 0.8 + rand() * 0.6, 0.7 + rand() * 0.8,
          [0.8 + rand() * 0.3, 0.85 + rand() * 0.3, 0.7 + rand() * 0.3], 0.02);
      }
      placed = true;
    }
  }

  // ---- materials ----
  const mats = byKind(reefMaterial);
  const geos = byKind(reefGeometry);

  const _c = new THREE.Color();
  for (const [kind, list] of Object.entries(kinds)) {
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(geos[kind], mats[kind], list.length);
    inst.frustumCulled = false;
    inst.name = 'reef-' + kind;
    for (let i = 0; i < list.length; i++) {
      inst.setMatrixAt(i, list[i].m);
      const t = list[i].tint;
      inst.setColorAt(i, t ? _c.setRGB(t[0], t[1], t[2]) : _c.setRGB(1, 1, 1));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // ---- giant clams: individual, so they can snap shut when you loom ----
  const clams = [];
  {
    const assets = clamAssets();
    let placedClams = 0;
    for (let i = 0; i < 30 && placedClams < 3; i++) {
      const cl = clusters[Math.floor(rand() * clusters.length)];
      if (!cl) break;
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * cl.r * 0.7;
      const x = cl.x + Math.cos(a) * rr, z = cl.z + Math.sin(a) * rr;
      const y = islandHeight(x, z);
      const s = 0.35 + rand() * 0.25;
      const { g, lid, mantle } = clamRig(s, assets);
      g.position.set(x, y - 0.03, z);
      g.rotation.y = rand() * Math.PI * 2;
      group.add(g);
      clams.push({ g, lid, mantle, open: 0.5, x, z, s });
      placedClams++;
    }
  }

  // the moray's den: one extra boulder on the biggest cluster, with a dark
  // gap the eel leans out of (sealife.js grows the eel here)
  let eelDen = null;
  if (clusters.length) {
    const big = clusters.reduce((a, b) => (b.r > a.r ? b : a));
    const a = rand() * Math.PI * 2;
    const x = big.x + Math.cos(a) * big.r * 0.5;
    const z = big.z + Math.sin(a) * big.r * 0.5;
    const y = islandHeight(x, z);
    const den = new THREE.Mesh(rockGeo(subSeed('eelRock')), mats.rock);
    den.scale.set(1.3, 0.9, 1.1);
    den.position.set(x, y - 0.15, z);
    den.rotation.y = rand() * Math.PI * 2;
    group.add(den);
    const heading = a + Math.PI * (0.7 + rand() * 0.6);
    eelDen = {
      x: x + Math.cos(heading) * 0.9,
      y: y + 0.28,
      z: z + Math.sin(heading) * 0.9,
      heading,
    };
  }

  function update(t, dt, player) {
    for (const c of clams) {
      const d = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
      const target = d < 1.7 ? 0.04 : 0.5; // slam shut, creak back open
      const rate = target < c.open ? 6 : 0.5;
      c.open += (target - c.open) * Math.min(dt * rate, 1);
      c.lid.rotation.z = c.open; // hinge at the back lip: + lifts the front
      c.mantle.scale.setScalar(Math.max(c.open * 1.6, 0.05));
      c.mantle.scale.z = 0.55 * Math.max(c.open * 1.6, 0.05);
      c.mantle.visible = c.open > 0.1;
    }
  }

  return { group, update, clusters, anemones, meadows, eelDen };
}
