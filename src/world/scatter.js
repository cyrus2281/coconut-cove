// Beach dressing: sea shells (three species, instanced), starfish, rocks,
// driftwood, dune grass, seaweed wrack, and a drift-line of tiny pebbles &
// shell fragments. Everything is placed with the island height function so
// it hugs the terrain, and heavier concentrations follow the high-tide line.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, Simplex2 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { islandHeight, islandNormal, shoreRadius, cayCenter, lagoonInfo, lagoonFreeboard } from './island.js';
import { shellTexture, barkTexture } from '../core/textures.js';
import { MeshData, windify } from './palms.js';
import { figBase } from './fig.js';

let scatterNoise = null; // recreated per island inside buildScatter

// where this island's cairn stands — the campfire pitches camp beside it
let CAIRN_POS = null;
export function cairnPos() { return CAIRN_POS ? { ...CAIRN_POS } : null; }

// Find a point whose terrain height falls in [hMin, hMax]. A tenth of
// everything washes up on the offshore cay instead of the main shoreline.
function shorePoint(rand, hMin, hMax, rMin = -12, rMax = 8) {
  for (let i = 0; i < 60; i++) {
    let x, z;
    if (rand() < 0.1) {
      const c = cayCenter();
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * 8.5;
      x = c.x + Math.cos(a) * rr;
      z = c.z + Math.sin(a) * rr;
    } else {
      const az = rand() * Math.PI * 2;
      const r = shoreRadius(az) + rMin + rand() * (rMax - rMin);
      x = Math.cos(az) * r;
      z = Math.sin(az) * r;
    }
    const h = islandHeight(x, z);
    if (h >= hMin && h <= hMax) return { x, z, h, az: Math.atan2(z, x) };
  }
  return null;
}

// ------------------------------------------------------------- shell shapes
function spiralShellGeometry(whorls = 2.6, elongation = 1.35) {
  const ALONG = 42, AROUND = 10;
  const g = new MeshData();
  const rows = [];
  for (let i = 0; i <= ALONG; i++) {
    const t = i / ALONG;
    const a = t * whorls * Math.PI * 2;
    const wr = 0.02 + 0.42 * Math.pow(t, 1.25);       // whorl radius grows
    const tube = 0.03 + 0.30 * Math.pow(t, 1.15);     // tube thickens
    const cy = (1 - Math.pow(t, 0.8)) * elongation;   // descends from apex
    const c = new THREE.Vector3(Math.cos(a) * wr, cy, Math.sin(a) * wr);
    const T = new THREE.Vector3(-Math.sin(a), -0.35, Math.cos(a)).normalize();
    const s1 = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const s2 = new THREE.Vector3().crossVectors(T, s1).normalize();
    const row = [];
    for (let k = 0; k <= AROUND; k++) {
      const b = (k / AROUND) * Math.PI * 2;
      // slight ridge bumps along the whorl
      const ridge = 1 + 0.05 * Math.sin(b * 2 + a * 8);
      const p = c.clone()
        .addScaledVector(s1, Math.cos(b) * tube * ridge)
        .addScaledVector(s2, Math.sin(b) * tube * ridge);
      row.push(g.vert(p, k / AROUND, t * 3.4, [1, 1, 1], 0, 0));
    }
    rows.push(row);
  }
  for (let i = 0; i < ALONG; i++) {
    for (let k = 0; k < AROUND; k++) {
      g.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k], rows[i + 1][k + 1]);
    }
  }
  const geo = g.build();
  geo.scale(0.5, 0.5, 0.5);
  return geo;
}

function scallopGeometry() {
  const RAD = 8, ANG = 26;
  const g = new MeshData();
  const rows = [];
  for (let i = 0; i <= RAD; i++) {
    const rr = i / RAD;
    const row = [];
    for (let k = 0; k <= ANG; k++) {
      const a = -1.15 + (k / ANG) * 2.3;
      const rib = 1 + 0.075 * Math.sin(a * 14);
      const r = rr * rib;
      const dome = Math.sin(rr * Math.PI) * 0.16 + 0.06 * Math.sin(a * 14) * rr;
      const p = new THREE.Vector3(Math.sin(a) * r, dome * (1 - rr * 0.3), Math.cos(a) * r * 0.92);
      row.push(g.vert(p, k / ANG, rr, [1, 1, 1], 0, 0));
    }
    rows.push(row);
  }
  for (let i = 0; i < RAD; i++) {
    for (let k = 0; k < ANG; k++) {
      g.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k], rows[i + 1][k + 1]);
    }
  }
  return g.build();
}

function clamGeometry() {
  const geo = new THREE.SphereGeometry(0.5, 14, 10);
  geo.scale(1, 0.42, 0.82);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // growth-band ripples
    const r = Math.hypot(x, z);
    pos.setY(i, pos.getY(i) * (1 + 0.06 * Math.sin(r * 26)));
  }
  geo.computeVertexNormals();
  return geo;
}

function starfishGeometry() {
  const RAD = 9, ANG = 60;
  const g = new MeshData();
  const rows = [];
  for (let i = 0; i <= RAD; i++) {
    const rr = i / RAD;
    const row = [];
    for (let k = 0; k <= ANG; k++) {
      const a = (k / ANG) * Math.PI * 2;
      const star = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.cos(a * 5), 0.72);
      const r = rr * star;
      const bump = 0.04 * Math.sin(rr * 40) * rr + 0.03 * Math.sin(a * 25);
      const y = 0.30 * Math.pow(1 - rr, 1.35) * star + bump * rr;
      const p = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const shade = 0.85 + 0.15 * Math.sin(a * 5 + rr * 6);
      row.push(g.vert(p, k / ANG, rr, [shade, shade * 0.55, shade * 0.28], 0, 0));
    }
    rows.push(row);
  }
  for (let i = 0; i < RAD; i++) {
    for (let k = 0; k < ANG; k++) {
      g.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k], rows[i + 1][k + 1]);
    }
  }
  return g.build();
}

// ------------------------------------------------------------- scatter passes
function placeShells(group) {
  const rand = mulberry32(subSeed('shells'));
  const shellMat = new THREE.MeshStandardMaterial({
    map: shellTexture(), roughness: 0.42, metalness: 0.0,
  });
  const tints = [
    new THREE.Color(1.0, 0.98, 0.94), new THREE.Color(1.0, 0.9, 0.82),
    new THREE.Color(0.98, 0.8, 0.72), new THREE.Color(0.92, 0.88, 0.8),
    new THREE.Color(1.0, 0.82, 0.6), new THREE.Color(0.85, 0.82, 0.78),
  ];

  const kinds = [
    { geo: spiralShellGeometry(2.6, 1.35), count: 70, s: [0.045, 0.11], lay: true },
    { geo: spiralShellGeometry(3.4, 2.3), count: 44, s: [0.04, 0.08], lay: true }, // auger
    { geo: scallopGeometry(), count: 95, s: [0.05, 0.12], lay: false },
    { geo: clamGeometry(), count: 75, s: [0.05, 0.1], lay: false },
  ];

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
    e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();

  for (const kind of kinds) {
    const inst = new THREE.InstancedMesh(kind.geo, shellMat, kind.count);
    let placed = 0;
    for (let i = 0; i < kind.count; i++) {
      // most shells collect on the wrack line, some wander, a few underwater
      const roll = rand();
      const band = roll < 0.55 ? [0.15, 0.55] : roll < 0.85 ? [-0.1, 1.1] : [-1.1, -0.15];
      const p = shorePoint(rand, band[0], band[1]);
      if (!p) continue;
      const s = kind.s[0] + rand() * (kind.s[1] - kind.s[0]);
      e.set(
        kind.lay ? Math.PI / 2 + (rand() - 0.5) * 0.5 : (rand() - 0.5) * 0.24,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.3
      );
      q.setFromEuler(e);
      v.set(p.x, p.h - s * 0.3, p.z); // partly bedded into the sand
      sc.setScalar(s / 0.5);
      m.compose(v, q, sc);
      inst.setMatrixAt(placed, m);
      inst.setColorAt(placed, tints[Math.floor(rand() * tints.length)]);
      placed++;
    }
    inst.count = placed;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }

  // starfish
  const starMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const starGeo = starfishGeometry();
  for (let i = 0; i < 3; i++) {
    const p = shorePoint(rand, -0.6, 0.25);
    if (!p) continue;
    const mesh = new THREE.Mesh(starGeo, starMat);
    const s = 0.09 + rand() * 0.06;
    mesh.scale.setScalar(s);
    mesh.position.set(p.x, p.h - 0.004, p.z);
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function placePebbles(group) {
  const rand = mulberry32(subSeed('pebbles'));
  const COUNT = 1700;
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const inst = new THREE.InstancedMesh(geo, mat, COUNT);
  const shades = [
    new THREE.Color(0.95, 0.92, 0.85), new THREE.Color(0.82, 0.72, 0.58),
    new THREE.Color(0.66, 0.6, 0.52), new THREE.Color(0.35, 0.3, 0.26),
    new THREE.Color(0.98, 0.85, 0.78), new THREE.Color(0.9, 0.88, 0.86),
  ];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
    e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  let placed = 0;
  for (let i = 0; i < COUNT; i++) {
    const p = shorePoint(rand, rand() < 0.7 ? 0.1 : -0.4, 1.1);
    if (!p) continue;
    // cluster pebbles into drifts using noise
    if (scatterNoise.noise(p.x * 0.12, p.z * 0.12) < -0.05 && rand() < 0.75) continue;
    const s = (0.006 + rand() * 0.012) / 0.5;
    e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
    q.setFromEuler(e);
    v.set(p.x, p.h - 0.002, p.z);
    sc.set(s * (0.7 + rand() * 0.6), s * (0.45 + rand() * 0.3), s * (0.7 + rand() * 0.6));
    m.compose(v, q, sc);
    inst.setMatrixAt(placed, m);
    inst.setColorAt(placed, shades[Math.floor(rand() * shades.length)]);
    placed++;
  }
  inst.count = placed;
  inst.receiveShadow = true;
  group.add(inst);
}

function placeRocks(group) {
  const rand = mulberry32(subSeed('rocks'));
  const noise = new Simplex2(subSeed('rockShape'));
  const rockMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95,
  });

  const clusters = [
    { az: 3.55, d: 0.5, sizes: [2.0, 1.3, 0.85, 0.5] },  // outcrop wading into the sea
    { az: 5.3, d: -14, sizes: [1.1, 0.65] },              // inland pair
    { az: 1.95, d: -5, sizes: [0.7] },                    // half-buried loner on the beach
  ];

  for (const cl of clusters) {
    let r0 = shoreRadius(cl.az) + cl.d;
    // boulders don't stand in the lagoon — walk them back toward the beach
    for (let g = 0; g < 10; g++) {
      if (lagoonFreeboard(Math.cos(cl.az) * r0, Math.sin(cl.az) * r0) >= 0.6) break;
      r0 += 2.2;
    }
    let cx = Math.cos(cl.az) * r0, cz = Math.sin(cl.az) * r0;
    for (const size of cl.sizes) {
      // indexed sphere → shared vertices → smooth weathered normals
      const geo = new THREE.SphereGeometry(size, 26, 18);
      const pos = geo.attributes.position;
      const p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i);
        const n = p.clone().normalize();
        const disp = 1
          + 0.30 * noise.fbm(n.x * 1.6 + cx, (n.y + n.z) * 1.6 + cz, 3)
          + 0.17 * noise.fbm(n.x * 5.5 + cz, (n.z - n.y) * 5.5 + cx, 3);
        pos.setXYZ(i, p.x * disp, p.y * disp * 0.70, p.z * disp);
      }
      geo.computeVertexNormals();
      // weathered gray basalt, wet-dark toward the base
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const wet = 1 - THREE.MathUtils.smoothstep(y, -size * 0.1, size * 0.4);
        const strata = 0.78 + 0.42 * noise.fbm(pos.getX(i) * 7.5 / size, (pos.getY(i) + pos.getZ(i)) * 7.5 / size, 3);
        const g = (0.30 - wet * 0.15) * strata;
        colors[i * 3] = g * 1.05; colors[i * 3 + 1] = g * 0.98; colors[i * 3 + 2] = g * 0.9;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mesh = new THREE.Mesh(geo, rockMat);
      const h = islandHeight(cx, cz);
      mesh.position.set(cx, h + size * 0.10, cz);
      mesh.rotation.y = rand() * Math.PI * 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      cx += (rand() - 0.3) * size * 2.4;
      cz += (rand() - 0.5) * size * 2.4;
    }
  }
}

function placeDriftwood(group) {
  const rand = mulberry32(subSeed('driftwood'));
  const mat = new THREE.MeshStandardMaterial({
    map: barkTexture(true), roughness: 0.9, bumpMap: barkTexture(true), bumpScale: 0.3,
  });
  const logs = [
    { az: 2.2, d: -4.5, len: 3.4, r: 0.16 },
    { az: 0.55, d: -3.8, len: 2.3, r: 0.12 },
  ];
  for (const l of logs) {
    const shore = shoreRadius(l.az) + l.d;
    const x = Math.cos(l.az) * shore, z = Math.sin(l.az) * shore;
    const geo = new THREE.CylinderGeometry(l.r * 0.55, l.r, l.len, 9, 8);
    geo.rotateZ(Math.PI / 2); // lay along X
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const bend = Math.sin((lx / l.len + 0.5) * Math.PI) * 0.08;
      pos.setY(i, pos.getY(i) + bend);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    // settle the log into the sand at both ends
    const yaw = rand() * Math.PI * 2;
    const ex = Math.cos(yaw) * l.len * 0.42, ez = -Math.sin(yaw) * l.len * 0.42;
    const hMid = islandHeight(x, z);
    const hA = islandHeight(x - ex, z - ez), hB = islandHeight(x + ex, z + ez);
    mesh.position.set(x, Math.min(hMid, hA, hB) + l.r * 0.55, z);
    mesh.rotation.y = yaw;
    mesh.rotation.z = Math.atan2(hB - hA, l.len * 0.84) * 0.8;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function placeGrass(group) {
  const rand = mulberry32(subSeed('grass'));
  const data = new MeshData();
  let tufts = 0;
  for (let attempt = 0; attempt < 6000 && tufts < 400; attempt++) {
    const az = rand() * Math.PI * 2;
    const r = rand() * (shoreRadius(az) - 6);
    const x = Math.cos(az) * r, z = Math.sin(az) * r;
    const h = islandHeight(x, z);
    if (h < 2.2) continue;
    if (lagoonFreeboard(x, z) < 0.1) continue; // not in the pond — reeds go there
    if (scatterNoise.noise(x * 0.055, z * 0.055) < 0.02) continue;
    tufts++;
    const blades = 14 + Math.floor(rand() * 9);
    const phase = rand() * Math.PI * 2;
    for (let b = 0; b < blades; b++) {
      const a = rand() * Math.PI * 2;
      const off = rand() * 0.16;
      const bx = x + Math.cos(a) * off, bz = z + Math.sin(a) * off;
      const by = islandHeight(bx, bz) - 0.02;
      const hgt = 0.22 + rand() * 0.45;
      const lean = 0.15 + rand() * 0.35;
      const la = rand() * Math.PI * 2;
      const dirx = Math.cos(la) * lean, dirz = Math.sin(la) * lean;
      const w0 = 0.006 + rand() * 0.004;
      const g0 = 0.75 + rand() * 0.4;
      const rows = [];
      for (let s = 0; s <= 2; s++) {
        const t = s / 2;
        const px = bx + dirx * t * t * hgt, pz = bz + dirz * t * t * hgt;
        const py = by + hgt * t * (1 - lean * 0.35 * t);
        const w = w0 * (1 - t * 0.95);
        const col = [0.34 * g0 + t * 0.2, 0.36 * g0 + t * 0.16, 0.14 * g0 + t * 0.08];
        const fl = t * t * 0.55;
        const sideA = Math.cos(la + Math.PI / 2) * w, sideB = Math.sin(la + Math.PI / 2) * w;
        rows.push([
          data.vert(new THREE.Vector3(px - sideA, py, pz - sideB), 0, t, col, fl, phase),
          data.vert(new THREE.Vector3(px + sideA, py, pz + sideB), 1, t, col, fl, phase),
        ]);
      }
      data.quad(rows[0][0], rows[0][1], rows[1][0], rows[1][1]);
      data.quad(rows[1][0], rows[1][1], rows[2][0], rows[2][1]);
    }
  }
  const mat = windify(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7, side: THREE.DoubleSide,
  }), 'grass');
  const mesh = new THREE.Mesh(data.build(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// An old hull swallowed by the dunes: a curved keel line with pairs of
// broken ribs arcing out of the sand, and a leaning stem post. Storm-cast,
// long dead — the island's one hint of a "before".
function placeWreck(group) {
  const rand = mulberry32(subSeed('wreck'));
  const L = lagoonInfo();
  const fb = figBase();

  // a dune saddle: inland, dry, clear of the pond and the big tree
  let site = null;
  for (let tries = 0; tries < 80; tries++) {
    const az = rand() * Math.PI * 2;
    const d = 9 + rand() * 8;
    const r = shoreRadius(az) - d;
    const x = Math.cos(az) * r, z = Math.sin(az) * r;
    const h = islandHeight(x, z);
    if (h < 2.4 || h > 4.6) continue;
    if (lagoonFreeboard(x, z) < 1.0) continue;
    if (fb && Math.hypot(x - fb.x, z - fb.z) < 12) continue;
    site = { x, z, h };
    break;
  }
  if (!site) return;

  const keelYaw = rand() * Math.PI * 2;
  const LEN = 10 + rand() * 2.5;
  const parts = [];

  // keel: a long half-buried beam, bowing up toward the stem
  const keel = new THREE.CylinderGeometry(0.12, 0.15, LEN, 7, 10);
  keel.rotateZ(Math.PI / 2);
  {
    const p = keel.attributes.position;
    for (let i = 0; i < p.count; i++) {
      // clamp: float error puts cap-ring verts a hair past ±LEN/2, and a
      // negative base under a fractional pow is NaN
      const t = Math.min(Math.max(p.getX(i) / LEN + 0.5, 0), 1);
      p.setY(i, p.getY(i) + Math.pow(t, 2.2) * 1.1 - 0.1);
    }
    keel.computeVertexNormals();
  }
  parts.push(keel);

  // rib pairs: partial torus arcs standing on the keel, most snapped short.
  // They have to clear the dune noise around the site, so they run tall.
  const RIBS = 8 + Math.floor(rand() * 2);
  for (let i = 0; i < RIBS; i++) {
    const t = i / (RIBS - 1);
    const along = (t - 0.42) * LEN * 0.78;
    const beam = 1.7 * Math.sin(Math.PI * (0.25 + t * 0.62)) + 0.5; // hull width curve
    for (const side of [-1, 1]) {
      const broken = rand();
      const arc = (0.6 + broken * 0.7) * Math.PI * 0.46;
      const g = new THREE.TorusGeometry(beam, 0.055 + rand() * 0.025, 6, 16, arc);
      // stand the arc upright, opening upward, hugging the hull line
      g.rotateZ(side > 0 ? Math.PI - arc : 0);
      g.rotateY(Math.PI / 2);
      g.translate(along, 0.05, 0);
      parts.push(g);
    }
  }

  // stem post leaning at the bow
  const stem = new THREE.CylinderGeometry(0.06, 0.12, 3.4, 7);
  stem.translate(0, 1.5, 0);
  stem.rotateZ(-0.5 - rand() * 0.25);
  stem.translate(LEN * 0.52, 0.15, 0);
  parts.push(stem);

  const geo = mergeGeometries(parts);
  geo.rotateY(-keelYaw);
  geo.translate(site.x, site.h + 0.1, site.z);

  const mat = new THREE.MeshStandardMaterial({
    map: barkTexture(true),
    bumpMap: barkTexture(true),
    bumpScale: 0.4,
    roughness: 0.95,
    color: 0xcfc6b6, // bleached silver-gray over the driftwood grain
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wreck';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// A walker's cairn on the summit, ringed by a little circle of pale pebbles.
function placeCairn(group) {
  const rand = mulberry32(subSeed('cairn'));
  const noise = new Simplex2(subSeed('cairnShape'));
  const fb = figBase();

  // highest dry interior point, nudged off the fig's toes
  let best = null;
  for (let i = 0; i < 240; i++) {
    const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 14;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = islandHeight(x, z);
    if (lagoonFreeboard(x, z) < 0.8) continue;
    if (fb && Math.hypot(x - fb.x, z - fb.z) < 6.5) continue;
    if (!best || h > best.h) best = { x, z, h };
  }
  CAIRN_POS = best ? { x: best.x, z: best.z, h: best.h } : null;
  if (!best) return;

  const stones = [];
  const N = 5 + Math.floor(rand() * 2);
  let y = best.h - 0.1;
  let px = best.x, pz = best.z;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const r0 = 0.34 * (1 - t * 0.66) + 0.04;
    const g = new THREE.SphereGeometry(r0, 14, 10);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const n = v.clone().normalize();
      const disp = 1 + 0.24 * noise.fbm(n.x * 2.2 + i * 3.1, (n.y + n.z) * 2.2 - i * 1.7, 3);
      p.setXYZ(k, v.x * disp, v.y * disp * 0.62, v.z * disp);
    }
    g.computeVertexNormals();
    g.rotateY(rand() * Math.PI * 2);
    // flattened stones nesting into each other, knee-high in all
    y += r0 * 0.5;
    px += (rand() - 0.5) * 0.07;
    pz += (rand() - 0.5) * 0.07;
    g.translate(px, y, pz);
    y += r0 * 0.34;
    stones.push(g);
  }
  const geo = mergeGeometries(stones);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.96 });
  const cairn = new THREE.Mesh(geo, mat);
  cairn.name = 'cairn';
  cairn.castShadow = true;
  cairn.receiveShadow = true;
  group.add(cairn);

  // pebble ring with four compass spokes
  const ringGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const ringMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const RING_N = 20, SPOKE_N = 3 * 4;
  const inst = new THREE.InstancedMesh(ringGeo, ringMat, RING_N + SPOKE_N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
    e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const pale = new THREE.Color(0.94, 0.9, 0.82);
  const dark = new THREE.Color(0.55, 0.5, 0.44);
  let placed = 0;
  const put = (x, z, s, col) => {
    e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
    q.setFromEuler(e);
    v.set(x, islandHeight(x, z) + 0.01, z);
    sc.setScalar(s / 0.5);
    m.compose(v, q, sc);
    inst.setMatrixAt(placed, m);
    inst.setColorAt(placed, col);
    placed++;
  };
  for (let i = 0; i < RING_N; i++) {
    const a = (i / RING_N) * Math.PI * 2;
    put(best.x + Math.cos(a) * 1.15, best.z + Math.sin(a) * 1.15, 0.028 + rand() * 0.014, pale);
  }
  for (let s = 0; s < 4; s++) {
    const a = (s / 4) * Math.PI * 2; // world-axis spokes: a compass rose
    for (let i = 0; i < 3; i++) {
      const rr = 1.35 + i * 0.22;
      put(best.x + Math.cos(a) * rr, best.z + Math.sin(a) * rr, 0.05 - i * 0.008, s === 0 ? dark : pale);
    }
  }
  inst.count = placed;
  inst.receiveShadow = true;
  group.add(inst);
}

// Reeds crowding the lagoon's wet margin: taller, stiffer and greener than
// dune grass, standing with their feet in the shallows.
function placeReeds(group) {
  const L = lagoonInfo();
  if (!L) return;
  const rand = mulberry32(subSeed('reeds'));
  const data = new MeshData();
  let clumps = 0;
  for (let attempt = 0; attempt < 5000 && clumps < 75; attempt++) {
    const a = rand() * Math.PI * 2;
    const rr = L.rW * (0.76 + rand() * 0.42);
    const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
    const fb = lagoonFreeboard(x, z);
    if (fb > 0.14 || fb < -0.45) continue;   // the wet margin only
    clumps++;
    const blades = 6 + Math.floor(rand() * 7);
    const phase = rand() * Math.PI * 2;
    for (let b = 0; b < blades; b++) {
      const ba = rand() * Math.PI * 2;
      const off = rand() * 0.22;
      const bx = x + Math.cos(ba) * off, bz = z + Math.sin(ba) * off;
      const by = islandHeight(bx, bz) - 0.02;
      const hgt = 0.55 + rand() * 0.75;
      const lean = 0.1 + rand() * 0.28;
      const la = rand() * Math.PI * 2;
      const dirx = Math.cos(la) * lean, dirz = Math.sin(la) * lean;
      const w0 = 0.009 + rand() * 0.006;
      const g0 = 0.7 + rand() * 0.45;
      const rows = [];
      const SEGS = 3;
      for (let s = 0; s <= SEGS; s++) {
        const t = s / SEGS;
        const px = bx + dirx * t * t * hgt, pz = bz + dirz * t * t * hgt;
        const py = by + hgt * t * (1 - lean * 0.3 * t);
        const w = w0 * (1 - t * 0.9);
        // green at the base, sun-bleached toward the tip
        const col = [0.16 * g0 + t * 0.26, 0.30 * g0 + t * 0.22, 0.11 * g0 + t * 0.07];
        const fl = t * t * 0.5;
        const sideA = Math.cos(la + Math.PI / 2) * w, sideB = Math.sin(la + Math.PI / 2) * w;
        rows.push([
          data.vert(new THREE.Vector3(px - sideA, py, pz - sideB), 0, t, col, fl, phase),
          data.vert(new THREE.Vector3(px + sideA, py, pz + sideB), 1, t, col, fl, phase),
        ]);
      }
      for (let s = 0; s < SEGS; s++) {
        data.quad(rows[s][0], rows[s][1], rows[s + 1][0], rows[s + 1][1]);
      }
    }
  }
  if (!clumps) return;
  const mat = windify(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.62, side: THREE.DoubleSide,
  }), 'reed');
  const mesh = new THREE.Mesh(data.build(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function placeSeaweed(group) {
  const rand = mulberry32(subSeed('seaweed'));
  const data = new MeshData();
  for (let c = 0; c < 14; c++) {
    const p = shorePoint(rand, -0.15, 0.5);
    if (!p) continue;
    const ribbons = 2 + Math.floor(rand() * 4);
    for (let rb = 0; rb < ribbons; rb++) {
      const a = rand() * Math.PI * 2;
      const len = 0.35 + rand() * 0.6;
      const w = 0.02 + rand() * 0.02;
      const g0 = 0.7 + rand() * 0.5;
      const col = [0.13 * g0, 0.17 * g0, 0.08 * g0];
      const sx = p.x + (rand() - 0.5) * 0.5, sz = p.z + (rand() - 0.5) * 0.5;
      const rows = [];
      const SEGS = 4;
      for (let s = 0; s <= SEGS; s++) {
        const t = s / SEGS;
        const wob = Math.sin(t * 9 + rb * 3) * 0.06;
        const px = sx + Math.cos(a) * len * t + Math.cos(a + Math.PI / 2) * wob;
        const pz = sz + Math.sin(a) * len * t + Math.sin(a + Math.PI / 2) * wob;
        const py = islandHeight(px, pz) + 0.012 + Math.sin(t * Math.PI) * 0.015;
        const sideA = Math.cos(a + Math.PI / 2) * w * (1 - t * 0.5);
        const sideB = Math.sin(a + Math.PI / 2) * w * (1 - t * 0.5);
        rows.push([
          data.vert(new THREE.Vector3(px - sideA, py, pz - sideB), 0, t, col, 0, 0),
          data.vert(new THREE.Vector3(px + sideA, py, pz + sideB), 1, t, col, 0, 0),
        ]);
      }
      for (let s = 0; s < SEGS; s++) {
        data.quad(rows[s][0], rows[s][1], rows[s + 1][0], rows[s + 1][1]);
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.32, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(data.build(), mat);
  mesh.receiveShadow = true;
  group.add(mesh);
}

export function buildScatter() {
  scatterNoise = new Simplex2(subSeed('drift'));
  const group = new THREE.Group();
  group.name = 'scatter';
  placeShells(group);
  placePebbles(group);
  placeRocks(group);
  placeDriftwood(group);
  placeWreck(group);
  placeCairn(group);
  placeGrass(group);
  placeReeds(group);
  placeSeaweed(group);
  return group;
}
