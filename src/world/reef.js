// The coral reef. Seeded clusters grow on the turquoise shelf just offshore:
// boulder bases, brain corals, branching staghorn thickets, table corals,
// swaying gorgonian fans, tube sponges, anemones, urchins, starfish and the
// odd giant clam, with seagrass meadows in the shallower sand between. One
// InstancedMesh per kind keeps the whole garden to a handful of draw calls.
// Everything is placed with the island height function so the reef always
// sits believably on the sea floor, whatever island the seed grew.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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

const sm = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };
const lerp = THREE.MathUtils.lerp;

// cheap 3D-ish fbm: a 2D slice folded by height, enough for closed surfaces
function n3(noise, x, y, z, oct = 3) {
  return noise.fbm(x + y * 0.71, z - y * 0.71, oct);
}

// height field (Float32Array, [0,1]) -> tangent-space normal map texture
function heightNormalTex(field, w, h, strength = 2.0) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const _UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v3 = new THREE.Vector3();

// A tapered, bendable tube grown up +Y from the origin: k in [0,1] runs
// base -> tip, radius from rFn(k), spine offset from bendFn(k) -> [dx, dz].
function bentCone(len, radial, hSegs, rFn, bendFn, openEnded = false) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, radial, hSegs, openEnded);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = p.getY(i) + 0.5;
    const r = Math.max(rFn(k), 0.0002);
    const b = bendFn ? bendFn(k) : null;
    p.setXYZ(i,
      p.getX(i) * r + (b ? b[0] : 0),
      k * len,
      p.getZ(i) * r + (b ? b[1] : 0));
  }
  geo.computeVertexNormals();
  return geo;
}

// stand a +Y-grown geometry at `from`, pointing along `dir` (unit)
function orientAt(geo, from, dir) {
  _q.setFromUnitVectors(_UP, dir);
  geo.applyQuaternion(_q);
  geo.translate(from.x, from.y, from.z);
  return geo;
}

// An indexed polar grid: one center vertex plus `rings` rings of `segs`
// vertices placed by posFn(u, theta, out), u in (0,1]. Gives surfaces real
// interior vertices to displace (the extrude caps only have rim verts).
// flip=true winds it to face +Y.
function discGrid(rings, segs, posFn, flip = false) {
  const verts = [], uvs = [];
  const _o = new THREE.Vector3();
  const push = (u, th) => {
    posFn(u, th, _o);
    verts.push(_o.x, _o.y, _o.z);
    uvs.push(_o.x + 0.5, _o.z + 0.5);
  };
  push(0, 0);
  for (let r = 1; r <= rings; r++) {
    for (let s = 0; s < segs; s++) push(r / rings, (s / segs) * Math.PI * 2);
  }
  const idx = [];
  const tri = (a, b, c) => { if (flip) idx.push(a, c, b); else idx.push(a, b, c); };
  for (let s = 0; s < segs; s++) tri(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 0; r < rings - 1; r++) {
    const a0 = 1 + r * segs, b0 = 1 + (r + 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      tri(a0 + s, b0 + s, b0 + s1);
      tri(a0 + s, b0 + s1, a0 + s1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// A tube swept through world-space ring centers with per-ring radii and
// colors, using parallel-transported frames so it never twists. Open ends;
// taper the last radius to ~0 to close a tip visually.
function sweepTube(cents, radii, colors, radial) {
  const n = cents.length;
  const verts = [], cols = [], uvs = [], idx = [];
  const t = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  for (let j = 0; j < n; j++) {
    const a = cents[Math.max(j - 1, 0)], b = cents[Math.min(j + 1, n - 1)];
    t.subVectors(b, a).normalize();
    if (j === 0) {
      nrm.set(t.y, -t.x, 0);
      if (nrm.lengthSq() < 1e-6) nrm.set(0, -t.z, t.y);
      nrm.normalize();
    } else {
      nrm.addScaledVector(t, -nrm.dot(t)).normalize(); // parallel transport
    }
    bin.crossVectors(t, nrm);
    const r = radii[j], c = colors[j], cc = cents[j];
    for (let s = 0; s < radial; s++) {
      const a2 = (s / radial) * Math.PI * 2;
      const ca = Math.cos(a2), sa = Math.sin(a2);
      verts.push(
        cc.x + (nrm.x * ca + bin.x * sa) * r,
        cc.y + (nrm.y * ca + bin.y * sa) * r,
        cc.z + (nrm.z * ca + bin.z * sa) * r);
      cols.push(c[0], c[1], c[2]);
      uvs.push(s / radial, j / (n - 1));
    }
  }
  for (let j = 0; j < n - 1; j++) {
    const a0 = j * radial, b0 = (j + 1) * radial;
    for (let s = 0; s < radial; s++) {
      const s1 = (s + 1) % radial;
      idx.push(a0 + s, b0 + s1, b0 + s, a0 + s, a0 + s1, b0 + s1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------- geometries
// weathered reef boulder: fbm lumps over a fine icosphere, sharp -|noise|
// gouges for crevices (darkened like ambient shadow), colored as gray
// limestone under blotches of coralline pink crust, an algae film in the
// hollows and a pale sand dusting across the top
function rockGeo(seed) {
  const rand = mulberry32(seed);
  const noise = new Simplex2(seed);
  // weld the icosphere so the displaced surface shades smooth, not faceted
  // (three's icosahedron detail is linear: 14 -> 20*15^2 = 4500 faces)
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 14));
  const p = geo.attributes.position;
  const n = p.count;
  const col = new Float32Array(n * 3);
  const ph = rand() * 40;
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    const lump = noise.fbm(v.x * 1.3 + ph, v.z * 1.3 + v.y * 1.1, 3) * 0.30;
    // ridged noise folds sharp creases into the faces
    const ridge = (0.55 - Math.abs(n3(noise, v.x * 3.3 + ph, v.y * 3.3, v.z * 3.3, 3))) * 0.17;
    const gouge = -Math.abs(n3(noise, v.x * 7.0 - ph, v.y * 7.0, v.z * 7.0, 2)) * 0.09;
    const fine = n3(noise, v.x * 14, v.y * 14, v.z * 14, 2) * 0.02;
    v.multiplyScalar(1 + lump + ridge + gouge + fine);
    v.y *= 0.7;
    p.setXYZ(i, v.x, v.y, v.z);

    const crust = n3(noise, v.x * 2.1 + ph * 2, v.y * 1.7, v.z * 2.1, 3);
    const grain = n3(noise, v.x * 12 + ph, v.y * 12, v.z * 12, 2);
    let r = 0.28 + grain * 0.09, g = 0.26 + grain * 0.08, b = 0.23 + grain * 0.07;
    if (crust > 0.32) {          // coralline pink crust, in patches only
      const k = sm((crust - 0.32) / 0.12) * 0.8;
      r = lerp(r, 0.44, k); g = lerp(g, 0.22, k); b = lerp(b, 0.28, k);
    } else if (crust < -0.3) {   // olive algae film in the hollows
      const k = sm((-crust - 0.3) / 0.12) * 0.85;
      r = lerp(r, 0.10, k); g = lerp(g, 0.19, k); b = lerp(b, 0.08, k);
    }
    // pale sand/bleach dusting settles on the upward shoulders
    const dust = Math.min(Math.max((v.y - 0.3) * 1.1, 0), 0.3) * (0.5 + 0.5 * grain);
    r = lerp(r, 0.62, dust); g = lerp(g, 0.57, dust); b = lerp(b, 0.45, dust);
    // crevices read as shadow, tops catch the light
    const ao = Math.max(1 + gouge * 9.0 + (ridge < 0 ? ridge * 2.5 : 0), 0.34);
    const shade = (0.72 + 0.28 * Math.min(Math.max(v.y + 0.5, 0), 1)) * ao;
    col[i * 3] = r * shade; col[i * 3 + 1] = g * shade; col[i * 3 + 2] = b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// brain coral: a lumpy dome wearing real meandering ridge-and-valley folds.
// Contour bands of a domain-warped fbm field displace the surface outward
// (fbm contours meander and reconnect exactly like a brain-coral maze) and
// the vertex colors shade the valleys dark so the pattern reads at distance.
function brainGeo(seed) {
  const noise = new Simplex2(seed);
  const noiseB = new Simplex2((seed ^ 0x5f356495) >>> 0);
  const geo = new THREE.SphereGeometry(1, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const dome = 1 + n3(noise, v.x * 1.4, v.y * 1.4, v.z * 1.4, 3) * 0.09;
    // the maze: triangle-wave contour bands of a warped noise field. Kept
    // low-frequency so the folds stay fat and smooth at this mesh density.
    const warp = n3(noiseB, v.x * 1.6, v.y * 1.6, v.z * 1.6, 2) * 0.8;
    const f = n3(noise, v.x * 1.7 + warp, v.y * 1.7, v.z * 1.7 - warp, 3);
    const s = f * 5.0;
    const tri = Math.abs(s - Math.floor(s) - 0.5) * 2;
    const ridge = sm((tri - 0.26) / 0.52);
    const fade = sm((v.y - 0.02) / 0.14);        // grooves die out at the skirt
    const polyp = n3(noiseB, v.x * 16, v.y * 16, v.z * 16, 2) * 0.006;
    v.multiplyScalar(dome + (ridge - 0.5) * 0.09 * fade + polyp);
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y, v.z);

    // valleys dark olive-brown, crests sun-warmed tan drifting greenish
    const tint = n3(noise, v.x * 0.9 + 7.3, v.y * 0.9, v.z * 0.9, 2);
    const rr = lerp(0.22, 0.62, ridge) - Math.max(tint, 0) * 0.12;
    const gg = lerp(0.12, 0.44, ridge) + tint * 0.05;
    const bb = lerp(0.07, 0.24, ridge) - Math.max(tint, 0) * 0.06;
    const spec = 1 + polyp * 10;
    col[i * 3] = rr * spec; col[i * 3 + 1] = gg * spec; col[i * 3 + 2] = bb * spec;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// fine corallite stipple, tiled small over the dome for close-up detail
function brainDetailNormal() {
  const S = 128;
  const rand = mulberry32(4021);
  const field = new Float32Array(S * S).fill(0.5);
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(rand() * S), y = Math.floor(rand() * S);
    const r = 1 + rand() * 2, d = rand() < 0.5 ? -0.3 : 0.3;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const q = Math.hypot(dx, dy) / r;
        if (q > 1) continue;
        const xi = (x + dx + S) % S, yi = (y + dy + S) % S;
        field[yi * S + xi] += d * (1 - q * q);
      }
    }
  }
  const t = heightNormalTex(field, S, S, 1.6);
  t.repeat.set(7, 3.5);
  return t;
}

// staghorn coral: a recursive thicket of curved, knobby, tapering branches.
// Each branch is a bent tube with corallite bulges down its length; the
// first child continues the branch at a shallow angle while the others
// shoot off the side partway up, the way real staghorn antlers fork. Tips
// swell slightly and bleach to cream.
function stagGeo(seed, baseCol, tipCol) {
  const rand = mulberry32(seed);
  const geos = [];
  const MAXD = 3;
  const _v = new THREE.Vector3();
  function branch(px, py, pz, dir, len, rad, depth) {
    const term = depth >= MAXD;
    const full = len + rad * 1.6; // overshoot so children bury into parents
    const ph = rand() * Math.PI * 2;
    const bx = (rand() - 0.5) * len * 0.4, bz = (rand() - 0.5) * len * 0.4;
    const wob = (k) => [
      bx * k * k + Math.sin(k * 5 + ph) * len * 0.015,
      bz * k * k + Math.cos(k * 4 + ph) * len * 0.015,
    ];
    const tube = bentCone(full, 6, 4, (k) => {
      const taper = 1 - 0.48 * k;
      const knob = 1 + 0.055 * Math.sin(k * 12.6 + ph);
      const foot = depth === 0 ? 1 + 0.45 * Math.max(0, 1 - k * 5) : 1;
      const tip = term ? Math.max(1 - (Math.max(k - 0.8, 0) / 0.2) * 0.8, 0.12) : 1;
      return rad * taper * knob * foot * tip;
    }, wob);
    // color while the tube is still axis-aligned: base->tip gradient, pale
    // bleached growth tips, corallite bulges catching a touch of light
    const p = tube.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = Math.min(Math.max(p.getY(i) / full, 0), 1);
      let g = Math.pow((depth + k) / (MAXD + 1), 1.7);
      if (term && k > 0.7) g = Math.min(g + (k - 0.7) * 2.6, 1);
      const kb = Math.max(Math.sin(k * 12.6 + ph), 0) * 0.10 + (rand() - 0.5) * 0.06;
      col[i * 3] = (baseCol.r + (tipCol.r - baseCol.r) * g) * (1 + kb);
      col[i * 3 + 1] = (baseCol.g + (tipCol.g - baseCol.g) * g) * (1 + kb);
      col[i * 3 + 2] = (baseCol.b + (tipCol.b - baseCol.b) * g) * (1 + kb);
    }
    tube.setAttribute('color', new THREE.BufferAttribute(col, 3));
    orientAt(tube, { x: px, y: py, z: pz }, dir);
    geos.push(tube);
    if (term) return;
    const kids = depth === 0 ? 3 : 2 + (rand() < 0.65 ? 1 : 0);
    for (let c = 0; c < kids; c++) {
      const cont = c === 0;
      const kAt = cont ? 1 : 0.55 + rand() * 0.35;
      const [ox, oz] = wob(kAt);
      _v.set(ox, kAt * len, oz)
        .applyQuaternion(_q.setFromUnitVectors(_UP, dir));
      const ax = new THREE.Vector3(rand() - 0.5, rand() * 0.4, rand() - 0.5).normalize();
      const nd = dir.clone()
        .applyAxisAngle(ax, cont ? 0.15 + rand() * 0.3 : 0.35 + rand() * 0.4)
        .normalize();
      if (nd.y < 0.28) { nd.y = 0.28 + rand() * 0.25; nd.normalize(); }
      // child base radius ~ parent radius at the attach point, so joints
      // flow instead of bulging
      const parentR = rad * (1 - 0.48 * kAt);
      branch(px + _v.x, py + _v.y, pz + _v.z, nd,
        len * (cont ? 0.78 : 0.62) * (0.9 + rand() * 0.2),
        parentR * (cont ? 0.92 : 0.78), depth + 1);
    }
  }
  for (let tr = 0; tr < 3; tr++) {
    const a = (tr / 3) * Math.PI * 2 + rand() * 1.2;
    const dir = new THREE.Vector3(
      Math.cos(a) * (0.3 + rand() * 0.25), 1, Math.sin(a) * (0.3 + rand() * 0.25)).normalize();
    branch(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06, dir, 0.33 + rand() * 0.12, 0.036, 0);
  }
  return mergeGeometries(geos);
}

// table coral: a wide wobble-edged acropora plate on a fused-column stem.
// The plate is a polar grid (so its interior really undulates), bristling
// with hundreds of tiny upward branchlets whose tips bleach cream; the
// underside hangs radial ribs and stays in shadow-brown.
function tableGeo(seed) {
  const rand = mulberry32(seed);
  const noise = new Simplex2(seed);
  const geos = [];
  const ph1 = rand() * 9, ph2 = rand() * 7;
  const R = 0.5;
  const outline = (a) => R * (0.82 + 0.18 * Math.sin(a * 3 + ph1) * Math.sin(a * 5 + ph2));
  const topBase = 0.30;
  const topY = (x, z) =>
    topBase + noise.fbm(x * 4.2, z * 4.2, 3) * 0.05
    + noise.fbm(x * 11, z * 11, 2) * 0.012;

  const paintDisc = (geo, colFn) => {
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const th = Math.atan2(z, x);
      const u = Math.min(Math.hypot(x, z) / outline(th), 1);
      const [r, g, b] = colFn(x, z, u, th);
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };

  // top surface: khaki-olive, mottled, with a pale live-growth rim
  const top = paintDisc(
    discGrid(10, 72, (u, th, out) => {
      const r = outline(th) * u;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      out.set(x, topY(x, z), z);
    }, true),
    (x, z, u) => {
      const m = noise.fbm(x * 6 + 3, z * 6, 2);
      const sp = 1 + noise.fbm(x * 34, z * 34, 2) * 0.35; // corallite stipple
      let r = (0.36 + m * 0.13) * sp, g = (0.31 + m * 0.11) * sp, b = (0.15 + m * 0.06) * sp;
      const rim = sm((u - 0.86) / 0.14);
      return [lerp(r, 0.88, rim), lerp(g, 0.80, rim), lerp(b, 0.55, rim)];
    });
  geos.push(top);

  // underside: shadowed brown, ribbed radially, tucked in under the rim so
  // the two surfaces never sit coplanar and catch shadow acne
  const bot = paintDisc(
    discGrid(6, 72, (u, th, out) => {
      const r = outline(th) * u * 0.985;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      const seal = 1 - sm((u - 0.82) / 0.18);
      const thick = 0.10 * Math.pow(1 - u, 1.3) + 0.010 * seal + 0.004;
      out.set(x, topY(x, z) - thick + Math.sin(th * 24) * 0.005 * u * seal, z);
    }, false),
    (x, z, u, th) => {
      const rib = 0.85 + 0.15 * Math.sin(th * 24);
      return [0.30 * rib, 0.235 * rib, 0.165 * rib];
    });
  geos.push(bot);

  // branchlet nubs all over the top, denser than they look from shore
  for (let i = 0; i < 230; i++) {
    const th = rand() * Math.PI * 2;
    const u = Math.sqrt(rand()) * 0.96;
    const r = outline(th) * u;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const h = 0.02 + rand() * 0.035;
    const r0 = 0.008 + rand() * 0.006;
    const nub = bentCone(h, 5, 1, (k) => r0 * (1 - 0.8 * k), null, true);
    const p = nub.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let vi = 0; vi < p.count; vi++) {
      const k = Math.min(Math.max(p.getY(vi) / h, 0), 1);
      col[vi * 3] = lerp(0.34, 0.92, k);
      col[vi * 3 + 1] = lerp(0.29, 0.83, k);
      col[vi * 3 + 2] = lerp(0.13, 0.55, k);
    }
    nub.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const tx = (rand() - 0.5) * 0.5, tz = (rand() - 0.5) * 0.5;
    orientAt(nub, { x, y: topY(x, z) - 0.004, z },
      _v3.set(tx, 1, tz).normalize());
    geos.push(nub);
  }

  // stem: a fused cluster of columns rather than one clean cylinder
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand();
    const off = i === 0 ? 0 : 0.05 + rand() * 0.03;
    const ph = rand() * 6;
    const stem = bentCone(i === 0 ? topBase + 0.02 : 0.16 + rand() * 0.08, 8, 3,
      (k) => (i === 0 ? 0.075 : 0.042) * (1 + 0.5 * Math.pow(1 - k, 1.6))
        * (1 + 0.10 * Math.sin(k * 9 + ph)),
      (k) => [Math.sin(ph) * 0.02 * k, Math.cos(ph) * 0.02 * k]);
    constColor(stem, 0.26, 0.20, 0.14);
    orientAt(stem, { x: Math.cos(a) * off, y: 0, z: Math.sin(a) * off },
      i === 0 ? _UP : _v3.set(-Math.cos(a) * 0.25, 1, -Math.sin(a) * 0.25).normalize());
    geos.push(stem);
  }
  return mergeGeometries(geos);
}

// gorgonian sea fan: a painted lace of branching veins that reconnect the
// way real gorgonian meshes anastomose, drawn twice — once in color, once
// as a height field that becomes the normal map so every vein has relief
function fanTextures() {
  const W = 512, H = 448;
  const rand = mulberry32(913);
  const c1 = document.createElement('canvas'); c1.width = W; c1.height = H;
  const ctx = c1.getContext('2d');
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
  const hx = c2.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);
  hx.fillStyle = '#000';
  hx.fillRect(0, 0, W, H);
  for (const g of [ctx, hx]) { g.lineCap = 'round'; g.lineJoin = 'round'; }

  const pts = [];
  function seg(x0, y0, x1, y1, w, bright, alpha) {
    const v = Math.round(150 + bright * 100);
    ctx.strokeStyle = `rgba(${Math.min(v + 12, 255)}, ${Math.min(v + 4, 255)}, ${v}, ${alpha})`;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    hx.strokeStyle = `rgba(255,255,255,${0.3 + Math.min(w / 9, 0.65)})`;
    hx.lineWidth = w;
    hx.beginPath(); hx.moveTo(x0, y0); hx.lineTo(x1, y1); hx.stroke();
  }
  function vein(x, y, ang, w, depth, bright) {
    if (depth > 8 || y < 8 || x < 6 || x > W - 6) return;
    if (depth > 3 && rand() < 0.12) return; // ragged gaps in the lace
    const len = (26 - depth * 2.2) * (0.8 + rand() * 0.5);
    const nx = x + Math.sin(ang) * len;
    const ny = y - Math.cos(ang) * len * 0.94;
    seg(x, y, nx, ny, w, bright, 0.97);
    if (depth > 2) pts.push(nx, ny);
    const n = depth < 2 ? 3 : (rand() < 0.14 ? 3 : 2);
    for (let i = 0; i < n; i++) {
      vein(nx, ny, ang + (rand() - 0.5) * 0.85, Math.max(w * 0.74, 0.65), depth + 1,
        Math.min(bright * (0.95 + rand() * 0.12), 1));
    }
  }
  // the dark holdfast trunk, short and low, then primaries spreading wide
  // from just above it so the skeleton reads fan, not tree
  seg(W / 2, H - 2, W / 2 + 2, H - 22, 13, 0.1, 1);
  for (let i = -3; i <= 3; i++) {
    vein(W / 2, H - 20, i * 0.30 + (rand() - 0.5) * 0.07, 5.5, 0, 0.85);
  }
  // two low laterals sweeping almost horizontal, filling the fan's shoulders
  // (started at depth 1 so the ragged-gap pruning can't kill them young)
  vein(W / 2, H - 24, -1.1, 3.5, 1, 0.8);
  vein(W / 2, H - 24, 1.1, 3.5, 1, 0.8);
  // anastomosis: thin cross-links between nearby vein tips knit the lace
  const P = pts.length / 2;
  for (let i = 0; i < 2400; i++) {
    const a = Math.floor(rand() * P), b = Math.floor(rand() * P);
    const ax = pts[a * 2], ay = pts[a * 2 + 1];
    const bx = pts[b * 2], by = pts[b * 2 + 1];
    const d = Math.hypot(ax - bx, ay - by);
    if (d < 4 || d > 24) continue;
    seg(ax, ay, bx, by, 1.0, 0.72 + rand() * 0.2, 0.45);
  }

  const img = hx.getImageData(0, 0, W, H).data;
  const field = new Float32Array(W * H);
  for (let i = 0; i < field.length; i++) field[i] = img[i * 4] / 255;
  const map = new THREE.CanvasTexture(c1);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap: heightNormalTex(field, W, H, 2.4) };
}

// the blade itself: cupped, ruffled, never a flat rectangle — plus a real
// little stem whose UVs sit on the solid patch of the lace texture
function fanGeo() {
  const g = new THREE.PlaneGeometry(1.3, 1.1, 20, 16);
  g.translate(0, 0.55, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const ky = y / 1.1;
    let z = -(x * x) * 0.22 - Math.pow(Math.max(ky - 0.15, 0), 2) * 0.10;
    z += Math.sin(x * 7.5 + ky * 4) * 0.03 * ky + Math.sin(x * 15 - ky * 9) * 0.012 * ky;
    p.setZ(i, z * sm(ky * 2.5));
  }
  g.computeVertexNormals();
  const stem = bentCone(0.13, 6, 2, (k) => 0.035 * (1 - 0.5 * k), (k) => [0.01 * k * k, 0]);
  // park the stem UVs on the painted trunk, which is solid dark there
  const uv = stem.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.02);
  return mergeGeometries([g, stem]);
}

// tube sponge: a leaning cluster of open-mouthed tubes. The profile now
// rolls over the lip and down inside, so each tube has a real dark throat;
// the outside gets lumpy, rib-streaked fibrous displacement per tube.
function spongeGeo(seed) {
  const rand = mulberry32(seed);
  const noise = new Simplex2(seed);
  const prof = [
    [0.055, 0], [0.085, 0.045], [0.078, 0.14], [0.066, 0.26], [0.063, 0.36],
    [0.075, 0.44], [0.072, 0.475],           // up the outside to the lip
    [0.052, 0.482], [0.044, 0.45],           // roll over and inside
    [0.038, 0.37], [0.030, 0.31], [0.003, 0.295], // throat and floor
  ];
  const geos = [];
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
    const tube = new THREE.LatheGeometry(pts, 18);
    const ph = rand() * 40;
    const ribs = 7 + Math.floor(rand() * 4);
    const p = tube.attributes.position;
    for (let vi = 0; vi < p.count; vi++) {
      const x = p.getX(vi), y = p.getY(vi), z = p.getZ(vi);
      const rr = Math.hypot(x, z);
      const outer = sm((rr - 0.032) / 0.03); // leave the throat smooth
      const ca = rr > 1e-5 ? x / rr : 1, sa = rr > 1e-5 ? z / rr : 0;
      const lump = noise.fbm(ca * 2.2 + ph, sa * 2.2 + y * 4.5, 3) * 0.20
        + 0.055 * Math.sin(Math.atan2(z, x) * ribs + y * 2.5 + ph);
      const sc = 1 + outer * lump;
      p.setXYZ(vi, x * sc, y * (1 + outer * lump * 0.25), z * sc);
    }
    tube.computeVertexNormals();
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

// near-white violet fibre + pores (instance color paints the species); the
// same marks drawn into a height field give the skin its pitted relief
function spongeTextures() {
  const S = 256;
  const rand = mulberry32(577);
  const c1 = document.createElement('canvas'); c1.width = S; c1.height = S;
  const ctx = c1.getContext('2d');
  const field = new Float32Array(S * S).fill(0.5);
  const stamp = (x, y, r, d) => {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const q = Math.hypot(dx, dy) / r;
        if (q > 1) continue;
        const xi = (Math.round(x) + dx + S) % S, yi = (Math.round(y) + dy + S) % S;
        field[yi * S + xi] += d * (1 - q * q);
      }
    }
  };
  ctx.fillStyle = '#cabfd8';
  ctx.fillRect(0, 0, S, S);
  // vertical fibrous streaks
  for (let i = 0; i < 130; i++) {
    let x = rand() * S;
    const dark = rand() < 0.55;
    ctx.strokeStyle = dark ? 'rgba(74,58,96,0.16)' : 'rgba(255,250,255,0.14)';
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(x, -4);
    for (let y = 0; y < S + 8; y += 14) {
      x += (rand() - 0.5) * 7;
      ctx.lineTo(x, y);
      if (!dark) stamp(x, y, 2.2, 0.10);
    }
    ctx.stroke();
  }
  // pores: little dark pits with a bright upper rim
  for (let i = 0; i < 380; i++) {
    const x = rand() * S, y = S * (0.42 + rand() * 0.58); // outside skin only
    const r = 1 + rand() * 2.4;
    ctx.fillStyle = 'rgba(52,40,70,0.55)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,252,255,0.30)';
    ctx.beginPath(); ctx.arc(x, y - r * 0.7, r * 0.5, 0, Math.PI * 2); ctx.fill();
    stamp(x, y, r * 1.6, -0.5);
  }
  // the throat: dark from the lip down (lathe v>0.62 is over the rim)
  const g = ctx.createLinearGradient(0, S * 0.38, 0, 0);
  g.addColorStop(0, 'rgba(20,12,28,0)');
  g.addColorStop(0.35, 'rgba(16,10,24,0.9)');
  g.addColorStop(1, 'rgba(10,6,16,0.98)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S * 0.38);
  const map = new THREE.CanvasTexture(c1);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const normalMap = heightNormalTex(field, S, S, 2.6);
  return { map, normalMap };
}

// anemone: a fleshy striped column under an oral disc crowded with rings of
// drooping, bubble-tipped tentacles — outer rings long and splayed, inner
// rings short and upright, every one swept along its own curling spine
function anemoneGeo(seed) {
  const rand = mulberry32(seed);
  const geos = [];

  // the column: a fleshy dome-sided barrel, softly lumpy, vertically striped
  const noiseC = new Simplex2((seed ^ 0x2b11) >>> 0);
  const colProf = [
    [0.001, 0.0], [0.135, 0.006], [0.122, 0.045], [0.104, 0.09],
    [0.098, 0.125], [0.088, 0.152], [0.078, 0.164],
  ];
  const column = new THREE.LatheGeometry(
    colProf.map(([r, y]) => new THREE.Vector2(r, y)), 24);
  {
    const p = column.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = Math.min(p.getY(i) / 0.164, 1);
      // gentle fleshy lumps so the flank never reads as a lathe
      const lump = 1 + noiseC.fbm(Math.cos(a) * 1.8, Math.sin(a) * 1.8 + k * 2.2, 2) * 0.10;
      p.setXYZ(i, x * lump, p.getY(i), z * lump);
      const stripe = 0.86 + 0.16 * Math.sin(a * 22) * sm(k * 3);
      const warty = 0.95 + 0.08 * Math.sin(a * 41 + k * 28);
      col[i * 3] = lerp(0.40, 0.58, k) * stripe * warty;
      col[i * 3 + 1] = lerp(0.19, 0.30, k) * stripe * warty;
      col[i * 3 + 2] = lerp(0.26, 0.42, k) * stripe * warty;
    }
    column.computeVertexNormals();
    column.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(column);
  }

  // the oral disc, slightly domed, mouth dark at the centre
  const disc = discGrid(4, 22, (u, th, out) => {
    out.set(Math.cos(th) * 0.08 * u, 0.164 + (1 - u * u) * 0.007, Math.sin(th) * 0.08 * u);
  }, true);
  {
    const p = disc.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const u = Math.hypot(x, z) / 0.088;
      const th = Math.atan2(z, x);
      const mouth = sm((0.25 - u) / 0.25);
      const streak = 1 + 0.08 * Math.sin(th * 22);
      col[i * 3] = lerp(0.64, 0.26, mouth) * streak;
      col[i * 3 + 1] = lerp(0.42, 0.13, mouth) * streak;
      col[i * 3 + 2] = lerp(0.50, 0.19, mouth) * streak;
    }
    disc.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(disc);
  }

  // tentacles, ring by ring: [ring radius, count, length, droop]
  const RINGS = [
    [0.100, 30, 0.17, 0.55],
    [0.083, 24, 0.15, 0.42],
    [0.066, 19, 0.13, 0.28],
    [0.048, 13, 0.11, 0.15],
    [0.028, 8, 0.085, 0.05],
  ];
  const K = 8;
  for (const [ringR, count, L0, droop0] of RINGS) {
    for (let i = 0; i < count; i++) {
      const aa = ((i + rand() * 0.6) / count) * Math.PI * 2;
      const L = L0 * (0.7 + rand() * 0.6);
      const droop = droop0 * (0.4 + rand() * 1.2); // upright and lolling mixed
      const bx = Math.cos(aa) * ringR * 0.92, bz = Math.sin(aa) * ringR * 0.92;
      const by = 0.164 - Math.pow(ringR / 0.115, 2) * 0.018;
      const outx = Math.cos(aa), outz = Math.sin(aa);
      const px = -outz, pz = outx; // sideways, for the wiggle
      const ph = rand() * 6;
      const wig = 0.03 + rand() * 0.04;
      const r0 = 0.0075 * (0.85 + rand() * 0.3);
      const spread = 0.22 + droop * 0.5;
      const din = 1 / Math.hypot(spread, 1);
      const cents = [], radii = [], cols = [];
      for (let j = 0; j <= K; j++) {
        const k = j / K;
        const arc = droop * k * k * 0.7;
        // an S-bend plus sideways sway keeps every tentacle its own curve
        const wob = Math.sin(k * 4.5 + ph) * wig * k;
        const sway = Math.sin(k * 2.2 + ph * 1.7) * wig * 0.7;
        cents.push(new THREE.Vector3(
          bx + (outx * (spread * din * k + arc + sway) + px * wob) * L,
          by + (din * k - droop * 0.55 * k * k * k) * L,
          bz + (outz * (spread * din * k + arc + sway) + pz * wob) * L));
        const bulb = Math.exp(-Math.pow((k - 0.82) / 0.13, 2));
        radii.push(j === K ? r0 * 0.45 : r0 * (1 - 0.38 * k) * (1 + 0.55 * bulb));
        const t1 = sm(k / 0.6), t2 = sm((k - 0.6) / 0.3);
        cols.push([
          lerp(lerp(0.48, 0.70, t1), 1.0, t2),
          lerp(lerp(0.24, 0.46, t1), 0.96, t2),
          lerp(lerp(0.36, 0.60, t1), 1.0, t2),
        ]);
      }
      geos.push(sweepTube(cents, radii, cols, 7));
    }
  }
  return mergeGeometries(geos);
}

// urchin: a squat test wearing rows of pale tubercles, under a double coat
// of spines — long banded primaries that curve a little, and a fuzz of
// short dark secondaries filling the gaps between them
function urchinGeo(seed) {
  const rand = mulberry32(seed);
  const geos = [];
  const body = new THREE.SphereGeometry(0.054, 22, 16);
  body.scale(1, 0.82, 1);
  body.translate(0, 0.006, 0);
  {
    const p = body.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const band = Math.pow(Math.abs(Math.sin(a * 5 + 0.4)), 6);
      const dot = Math.pow(Math.abs(Math.sin(p.getY(i) * 260)), 8) * band;
      col[i * 3] = 0.075 + band * 0.06 + dot * 0.22;
      col[i * 3 + 1] = 0.045 + band * 0.03 + dot * 0.14;
      col[i * 3 + 2] = 0.10 + band * 0.08 + dot * 0.26;
    }
    body.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(body);
  }
  const dir = new THREE.Vector3();
  for (let i = 0; i < 70; i++) {
    dir.set(rand() - 0.5, rand() - 0.38, rand() - 0.5).normalize();
    if (dir.y < -0.12) { dir.y = -0.12 + rand() * 0.1; dir.normalize(); }
    const len = 0.08 + rand() * 0.09;
    const ph = rand() * 6;
    const bx = (rand() - 0.5) * len * 0.25, bz = (rand() - 0.5) * len * 0.25;
    const sp = bentCone(len, 5, 3,
      (k) => 0.0050 * (1 - 0.85 * k) + 0.0004,
      (k) => [bx * k * k, bz * k * k], true);
    const p = sp.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let vi = 0; vi < p.count; vi++) {
      const k = Math.min(Math.max(p.getY(vi) / len, 0), 1);
      const band = 0.75 + 0.25 * Math.sin(k * 22 + ph);
      col[vi * 3] = lerp(0.10, 0.46, k * k) * band + k * 0.06;
      col[vi * 3 + 1] = lerp(0.06, 0.30, k * k) * band + k * 0.04;
      col[vi * 3 + 2] = lerp(0.14, 0.52, k * k) * band + k * 0.07;
    }
    sp.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const base = 0.045;
    orientAt(sp, { x: dir.x * base, y: dir.y * base * 0.82 + 0.006, z: dir.z * base }, dir);
    geos.push(sp);
  }
  // the short secondary fuzz
  for (let i = 0; i < 85; i++) {
    dir.set(rand() - 0.5, rand() - 0.38, rand() - 0.5).normalize();
    if (dir.y < -0.1) { dir.y = -0.1 + rand() * 0.1; dir.normalize(); }
    const len = 0.022 + rand() * 0.022;
    const sp = bentCone(len, 4, 1, (k) => 0.0024 * (1 - 0.8 * k), null, true);
    constColor(sp, 0.16, 0.08, 0.11);
    const base = 0.050;
    orientAt(sp, { x: dir.x * base, y: dir.y * base * 0.82 + 0.006, z: dir.z * base }, dir);
    geos.push(sp);
  }
  return mergeGeometries(geos);
}

// starfish: five plump domed arms built on a polar grid so the surface has
// real interior vertices — rows of ossicle knobs march down each arm as
// geometry, tips curl gently upward, valleys shade darker between knobs.
// Near-white vertex colors; the instance tint paints the species.
function starGeo() {
  const noise = new Simplex2(9182);
  const lobe = (a) => Math.pow(Math.abs(Math.cos(a * 2.5)), 0.85);
  const shapeR = (a) => 0.048 + 0.118 * lobe(a);
  // knob field: a centre row and two flanks of ossicles down each arm axis
  function knob(x, z) {
    let g = 0;
    for (let arm = 0; arm < 5; arm++) {
      const aa = arm * (Math.PI * 2 / 5);
      const ca = Math.cos(aa), sa = Math.sin(aa);
      const along = x * ca + z * sa;
      if (along < 0.012) continue;
      const across = -x * sa + z * ca;
      for (const [off, w, amp] of [[0, 0.011, 1], [0.019, 0.008, 0.65], [-0.019, 0.008, 0.65]]) {
        const lat = Math.exp(-Math.pow((across - off) / w, 2));
        const rip = 0.5 + 0.5 * Math.cos((along / 0.019) * Math.PI * 2 + arm * 1.7);
        g = Math.max(g, lat * rip * amp * sm((along - 0.014) / 0.02));
      }
    }
    g += Math.max(noise.fbm(x * 52, z * 52, 2), 0) * 0.55; // scattered granules
    return Math.min(g, 1.15);
  }
  const curl = (u, th) => 0.016 * sm((u - 0.78) / 0.22) * lobe(th);
  const top = discGrid(14, 110, (u, th, out) => {
    const R = shapeR(th);
    const x = Math.cos(th) * R * u, z = Math.sin(th) * R * u;
    let y = 0.060 * Math.pow(Math.max(1 - u * u, 0), 0.72) + 0.004;
    y += knob(x, z) * 0.013 * sm((0.97 - u) / 0.15);
    out.set(x, y + curl(u, th), z);
  }, true);
  {
    const p = top.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const k = Math.min(knob(x, z), 1);
      const u = Math.min(Math.hypot(x, z) / shapeR(Math.atan2(z, x)), 1);
      const edge = 1 - sm((u - 0.82) / 0.18) * 0.15;
      col[i * 3] = 0.96 * (0.58 + 0.47 * k) * edge;
      col[i * 3 + 1] = 0.90 * (0.56 + 0.48 * k) * edge;
      col[i * 3 + 2] = 0.83 * (0.55 + 0.46 * k) * edge;
    }
    top.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const bot = discGrid(5, 110, (u, th, out) => {
    const R = shapeR(th);
    // the rim must land exactly on the top surface's edge or light leaks in
    out.set(Math.cos(th) * R * u, 0.004 - 0.004 * (1 - u) + curl(u, th), Math.sin(th) * R * u);
  }, false);
  {
    const p = bot.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const u = Math.min(Math.hypot(p.getX(i), p.getZ(i)) / 0.16, 1);
      const mouth = sm((0.18 - u) / 0.18);
      // stay close to the top's edge tone so no pale stripe rings the rim
      col[i * 3] = lerp(0.62, 0.42, mouth);
      col[i * 3 + 1] = lerp(0.57, 0.35, mouth);
      col[i * 3 + 2] = lerp(0.50, 0.30, mouth);
    }
    bot.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return mergeGeometries([top, bot]);
}

// seagrass tuft: six ribbon blades that taper to a point, curl over at the
// top and carry a darker midrib — a few older blades browning at the tip
function grassGeo(seed) {
  const rand = mulberry32(seed);
  const geos = [];
  for (let b = 0; b < 8; b++) {
    const H = 0.24 + rand() * 0.42;
    const blade = new THREE.PlaneGeometry(0.05, H, 2, 6);
    blade.translate(0, H / 2, 0);
    const p = blade.attributes.position;
    const col = new Float32Array(p.count * 3);
    const lean = (rand() - 0.5) * 0.8;
    const curlB = (rand() - 0.5) * 0.6;
    const ph = rand() * 6;
    const hue = rand();
    const old = rand() < 0.3;
    for (let i = 0; i < p.count; i++) {
      const k = Math.max(p.getY(i) / H, 0); // float error must not go negative
      const x0 = p.getX(i);
      const taper = 1 - 0.82 * Math.pow(k, 1.6);
      p.setXYZ(i,
        x0 * taper + k * k * lean * H + k * k * k * curlB * H + Math.sin(k * 2.6 + ph) * 0.012,
        p.getY(i),
        Math.sin(k * 3.1 + ph) * 0.012);
      const mid = 1 - Math.min(Math.abs(x0) / 0.025, 1); // centre column
      let r = 0.08 + 0.28 * k + hue * 0.10;
      let g = 0.26 + 0.44 * k + hue * 0.07;
      let bl = 0.10 + 0.09 * k;
      if (old && k > 0.65) {
        const w = (k - 0.65) / 0.35 * 0.75;
        r = lerp(r, 0.46, w); g = lerp(g, 0.40, w); bl = lerp(bl, 0.16, w);
      }
      const rib = 1 - mid * 0.24;
      col[i * 3] = r * rib; col[i * 3 + 1] = g * rib; col[i * 3 + 2] = bl * rib;
    }
    blade.setAttribute('color', new THREE.BufferAttribute(col, 3));
    blade.rotateY(rand() * Math.PI * 2);
    blade.translate((rand() - 0.5) * 0.07, 0, (rand() - 0.5) * 0.07);
    geos.push(blade);
  }
  return mergeGeometries(geos);
}

// giant clam shells (built per-clam, not instanced — there are only a few).
// Deep scalloped flutes swell toward the rim (the mirrored valves interlock
// on their own), fine growth corrugations ring the meridians, and the lip
// itself waves up and down like real tridacna.
function clamShellGeo() {
  const noise = new Simplex2(4477);
  const geo = new THREE.SphereGeometry(1, 56, 22, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rim = 1 - Math.min(Math.max(y, 0), 1);
    const flute = Math.sin(a * 6 + Math.sin(a * 2 + 1.3) * 0.7);
    const amp = 0.15 * Math.pow(rim, 1.7) + 0.012;
    const growth = 1 + 0.012 * Math.sin(Math.acos(Math.min(Math.max(y, 0), 1)) * 30)
      + noise.fbm(a * 1.7, y * 3.1, 2) * 0.02;
    const s = (1 + flute * amp) * growth;
    const lip = y < 0.06 ? (1 - y / 0.06) * flute * 0.028 : 0;
    p.setXYZ(i, x * s, y * 0.45 - lip, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

function clamShellTextures() {
  const W = 512, H = 128;
  const rand = mulberry32(4478);
  const c1 = document.createElement('canvas'); c1.width = W; c1.height = H;
  const ctx = c1.getContext('2d');
  ctx.fillStyle = '#d6cbb2';
  ctx.fillRect(0, 0, W, H);
  // flute shading: six soft vertical bands matching the geometry frequency
  for (let x = 0; x < W; x++) {
    const v = Math.cos((x / W) * Math.PI * 2 * 6);
    ctx.fillStyle = `rgba(110,94,74,${Math.max(-v, 0) * 0.24})`;
    ctx.fillRect(x, 0, 1, H);
    ctx.fillStyle = `rgba(255,250,240,${Math.max(v, 0) * 0.14})`;
    ctx.fillRect(x, 0, 1, H);
  }
  // growth bands: dozens of fine arcs, crowding toward the rim (canvas
  // bottom = uv v 0 = the lip), a few of them blushing pink or tan
  const field = new Float32Array(W * H).fill(0.5);
  let y = H - 2;
  while (y > 4) {
    const wgt = 0.35 + rand() * 0.65;
    const tint = rand();
    ctx.fillStyle = tint < 0.16 ? `rgba(196,142,124,${0.22 * wgt})`
      : tint < 0.3 ? `rgba(170,144,96,${0.2 * wgt})`
        : `rgba(96,82,64,${0.22 * wgt})`;
    ctx.fillRect(0, y, W, 1.5);
    for (let x = 0; x < W; x++) field[Math.round(y) * W + x] -= 0.22 * wgt;
    y -= (1.5 + rand() * 5) * (0.4 + (y / H) * 0.9); // denser near the rim
  }
  // weathering: gray-green algal stains and bleached patches
  for (let i = 0; i < 60; i++) {
    const px = rand() * W, py = rand() * H;
    const r = 4 + rand() * 16;
    ctx.fillStyle = rand() < 0.55
      ? `rgba(96,112,84,${0.05 + rand() * 0.12})`
      : `rgba(244,240,228,${0.05 + rand() * 0.1})`;
    ctx.beginPath(); ctx.ellipse(px, py, r, r * (0.4 + rand() * 0.5), rand() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // fine radial striae in the height field
  for (let i = 0; i < 220; i++) {
    const x = Math.floor(rand() * W);
    const d = (rand() - 0.5) * 0.25;
    for (let yy = 0; yy < H; yy++) field[yy * W + x] += d;
  }
  const map = new THREE.CanvasTexture(c1);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return { map, normalMap: heightNormalTex(field, W, H, 2.0) };
}

function clamMantleTextures() {
  const W = 512, H = 64;
  const rand = mulberry32(742);
  const c1 = document.createElement('canvas'); c1.width = W; c1.height = H;
  const ctx = c1.getContext('2d');
  const field = new Float32Array(W * H).fill(0.5);
  ctx.fillStyle = '#0a555e';
  ctx.fillRect(0, 0, W, H);
  // wavy dark olive bands running along the mantle
  for (let b = 0; b < 4; b++) {
    ctx.strokeStyle = 'rgba(26,42,22,0.55)';
    ctx.lineWidth = 5 + rand() * 5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const yy = H * (0.2 + b * 0.2) + Math.sin(x * 0.05 + b * 2.2) * 6;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // electric-blue blobs ringed in near-black, the tridacna signature
  for (let i = 0; i < 150; i++) {
    const x = rand() * W, yy = rand() * H;
    const r = 1.4 + rand() * 3.2;
    ctx.fillStyle = 'rgba(6,14,20,0.85)';
    ctx.beginPath(); ctx.arc(x, yy, r * 1.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rand() < 0.75 ? '#19d9de' : '#48b5ff';
    ctx.beginPath(); ctx.arc(x, yy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(240,255,255,0.5)';
    ctx.beginPath(); ctx.arc(x - r * 0.3, yy - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
    const xi = Math.round(x), yi = Math.round(yy), ri = Math.ceil(r * 1.2);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const q = Math.hypot(dx, dy) / (r * 1.2);
        if (q > 1) continue;
        field[((yi + dy + H) % H) * W + ((xi + dx + W) % W)] += 0.35 * (1 - q * q);
      }
    }
  }
  // iridocyte glitter
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(${140 + rand() * 100},${220 + rand() * 35},${230 + rand() * 25},${0.12 + rand() * 0.22})`;
    ctx.fillRect(rand() * W, rand() * H, 1.5, 1.5);
  }
  const map = new THREE.CanvasTexture(c1);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return { map, normalMap: heightNormalTex(field, W, H, 1.4) };
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
      new THREE.Color(0.48, 0.29, 0.16), new THREE.Color(0.95, 0.85, 0.65));
    case 'stagB': return stagGeo(subSeed('reefStagB'),
      new THREE.Color(0.26, 0.16, 0.40), new THREE.Color(0.82, 0.64, 0.95));
    case 'table': return tableGeo(subSeed('reefTable'));
    case 'fan': return fanGeo();
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
    case 'rock': return vertexMat('rock', { roughness: 0.94 });
    case 'brain': return vertexMat('brain', {
      roughness: 0.88, normalMap: brainDetailNormal(),
      normalScale: new THREE.Vector2(0.7, 0.7),
    });
    case 'stagA': return vertexMat('stagA');
    case 'stagB': return vertexMat('stagB');
    case 'table': return vertexMat('table');
    case 'fan': {
      const { map, normalMap } = fanTextures();
      return uwPatch(new THREE.MeshStandardMaterial({
        map, normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
        alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.78,
      }), 'fan', { sway: 0.5, swaySpeed: 0.8 });
    }
    case 'sponge': {
      const { map, normalMap } = spongeTextures();
      return uwPatch(new THREE.MeshStandardMaterial({
        map, normalMap, normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.95,
      }), 'sponge');
    }
    case 'anemone': return vertexMat('anemone', { roughness: 0.55 }, { sway: 3.2, swaySpeed: 1.6 });
    case 'urchin': return vertexMat('urchin', { roughness: 0.45 });
    case 'star': return vertexMat('star', { roughness: 0.72 });
    case 'grass': return vertexMat('grass', { side: THREE.DoubleSide }, { sway: 1.4, swaySpeed: 1.1 });
    default: throw new Error('unknown reef kind: ' + kind);
  }
}

const byKind = (fn) => Object.fromEntries(REEF_KINDS.map((k) => [k, fn(k)]));

// A giant clam of half-width `s`: a cupped bottom shell, a hinged lid, and
// the iridescent mantle between them. update() in buildReef swings the lid.
export function clamAssets() {
  const shell = clamShellTextures();
  const mant = clamMantleTextures();
  return {
    shellGeo: clamShellGeo(),
    // both valves are open hemispheres, so the inner face has to render:
    // without DoubleSide you can see straight through a gaping clam
    shellMat: uwPatch(new THREE.MeshStandardMaterial({
      map: shell.map, normalMap: shell.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.74, side: THREE.DoubleSide,
    }), 'clamshell'),
    mantleMat: uwPatch(new THREE.MeshStandardMaterial({
      map: mant.map, normalMap: mant.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.35, side: THREE.DoubleSide,
      emissive: new THREE.Color(0.5, 1.0, 1.0), emissiveMap: mant.map,
      emissiveIntensity: 0.13,
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
  // the mantle: a torus reshaped into a sinuous pillow ring — its radius
  // follows the shell scallops and its surface ripples up and down, so the
  // flesh looks squeezed between the fluted lips instead of a swim ring
  const mantleGeo = new THREE.TorusGeometry(s * 0.72, s * 0.16, 12, 64);
  {
    const p = mantleGeo.attributes.position;
    const R0 = s * 0.72;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const u = Math.atan2(y, x);
      const scal = 1 + 0.07 * Math.sin(u * 6 + 0.9) + 0.02 * Math.sin(u * 17 + 2.1);
      const cx = Math.cos(u) * R0, cy = Math.sin(u) * R0;
      p.setXYZ(i,
        cx * scal + (x - cx),
        cy * scal + (y - cy),
        z + s * (0.06 * Math.sin(u * 11 + 1.0) + 0.03 * Math.sin(u * 19)));
    }
    mantleGeo.computeVertexNormals();
  }
  const mantle = new THREE.Mesh(mantleGeo, mantleMat);
  mantle.rotation.x = -Math.PI / 2;
  mantle.position.y = s * 0.47;
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
