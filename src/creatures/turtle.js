// The green turtle as an asset, in two builds: the beach nester (turtle.js
// drives her crutching crawl) and the open-water swimmer (sealife.js drives
// the cruising). One shared anatomy: a carapace whose scutes are real
// geometry ridges aligned with the painted shell (growth rings, seams, a
// matching bump map), a seamed plastron, a reticulated head with lidded
// eyes, and swept flipper paddles skinned with leading-edge plates.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { uwPatch } from '../world/underwater.js';

const COLS = 5, ROWS = 4; // the scute grid, shared by paint and geometry

// smooth per-cell plateau: 1 mid-scute, 0 in the seams
function scuteMask(u, v) {
  const cu = (u * COLS) % 1, cv = (v * ROWS) % 1;
  const du = Math.min(cu, 1 - cu) * 2, dv = Math.min(cv, 1 - cv) * 2;
  const s = (x) => THREE.MathUtils.smoothstep(x, 0.14, 0.5);
  return s(du) * s(dv);
}

// ---------------------------------------------------------------- skins
function shellTextures(seed) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const b = document.createElement('canvas');
  b.width = b.height = S;
  const bctx = b.getContext('2d');
  const rand = mulberry32(seed);

  // seam bed: dark olive under everything
  ctx.fillStyle = '#2a3a20';
  ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#585858';
  bctx.fillRect(0, 0, S, S);

  const cw = S / COLS, ch = S / ROWS;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = (col + 0.5) * cw, cy = (row + 0.5) * ch;
      const rx = cw * 0.46, ry = ch * 0.46;
      // each scute: an octagon filling its cell (seams stay on the grid,
      // so the geometry ridges line up), radial olive gradient
      const base = 74 + rand() * 30, gr = 92 + rand() * 26, bl = 50 + rand() * 18;
      const g = ctx.createRadialGradient(cx - rx * 0.2, cy - ry * 0.25, 2, cx, cy, Math.max(rx, ry) * 1.2);
      g.addColorStop(0, `rgb(${(base * 1.25) | 0},${(gr * 1.2) | 0},${(bl * 1.15) | 0})`);
      g.addColorStop(0.7, `rgb(${base | 0},${gr | 0},${bl | 0})`);
      g.addColorStop(1, `rgb(${(base * 0.62) | 0},${(gr * 0.66) | 0},${(bl * 0.6) | 0})`);
      const poly = (ctx2, k) => {
        ctx2.beginPath();
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          const wob = 0.92 + 0.08 * Math.cos(a * 2);
          const x = cx + Math.cos(a) * rx * k * wob;
          const y = cy + Math.sin(a) * ry * k * wob;
          if (i) ctx2.lineTo(x, y); else ctx2.moveTo(x, y);
        }
        ctx2.closePath();
      };
      ctx.fillStyle = g;
      poly(ctx, 1);
      ctx.fill();
      // growth rings
      ctx.lineWidth = 1.6;
      for (let ring = 0.82; ring > 0.2; ring -= 0.17) {
        ctx.strokeStyle = `rgba(20,30,14,${0.16 + (0.82 - ring) * 0.1})`;
        poly(ctx, ring);
        ctx.stroke();
      }
      // radiating streaks (green turtles carry a sunburst per scute)
      ctx.strokeStyle = 'rgba(210,190,120,0.14)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const a = rand() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rx * 0.15, cy + Math.sin(a) * ry * 0.15);
        ctx.lineTo(cx + Math.cos(a) * rx * 0.85, cy + Math.sin(a) * ry * 0.85);
        ctx.stroke();
      }
      // bump plateau
      const bg = bctx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(rx, ry) * 1.15);
      bg.addColorStop(0, '#e8e8e8');
      bg.addColorStop(0.75, '#c8c8c8');
      bg.addColorStop(1, '#3a3a3a');
      bctx.fillStyle = bg;
      poly(bctx, 1);
      bctx.fill();
    }
  }
  // ambient rim darkening toward the shell edge (the UVs are a plan
  // projection, so the edge is the circle inscribed in the canvas)
  const rim = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.52);
  rim.addColorStop(0, 'rgba(14,20,10,0)');
  rim.addColorStop(0.72, 'rgba(14,20,10,0.12)');
  rim.addColorStop(1, 'rgba(14,20,10,0.6)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, S, S);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(b);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

// skin: olive field broken into plated scales by pale seams
function skinTexture(seed, tone = [95, 108, 72]) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rand = mulberry32(seed);
  ctx.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`;
  ctx.fillRect(0, 0, S, S);
  // plated scales: jittered rounded tiles with cream seams
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cx = (x + 0.5 + (rand() - 0.5) * 0.3) * S / 8;
      const cy = (y + 0.5 + (rand() - 0.5) * 0.3) * S / 8;
      const r = S / 8 * (0.38 + rand() * 0.14);
      const k = 0.82 + rand() * 0.35;
      ctx.fillStyle = `rgba(${(tone[0] * k) | 0},${(tone[1] * k) | 0},${(tone[2] * k) | 0},0.9)`;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (x + y) * 0.5;
        if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9);
        else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(214,206,160,0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// plastron: pale cream with the transverse seam pairs
function plastronTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#e8dfb8');
  g.addColorStop(0.5, '#efe7c6');
  g.addColorStop(1, '#dfd4ac');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(120,104,64,0.4)';
  ctx.lineWidth = 2;
  for (const y of [0.2, 0.38, 0.56, 0.74]) {
    ctx.beginPath();
    ctx.moveTo(0, S * y);
    ctx.quadraticCurveTo(S * 0.5, S * (y + 0.05), S, S * y);
    ctx.stroke();
  }
  ctx.beginPath(); // midline seam
  ctx.moveTo(S * 0.5, 0);
  ctx.lineTo(S * 0.5, S);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// flipper: reticulated field with a row of big plates on the leading edge
function flipperTexture(seed, tone = [82, 96, 62]) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rand = mulberry32(seed);
  ctx.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`;
  ctx.fillRect(0, 0, S, S);
  // fine reticulation
  for (let i = 0; i < 90; i++) {
    const x = rand() * S, y = rand() * S, r = 3 + rand() * 6;
    ctx.strokeStyle = 'rgba(206,198,150,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // large plates along the leading edge (v = 0 edge)
  for (let i = 0; i < 6; i++) {
    const x = (i + 0.5) * S / 6;
    ctx.fillStyle = `rgba(${tone[0] * 1.2 | 0},${tone[1] * 1.15 | 0},${tone[2] * 1.1 | 0},0.85)`;
    ctx.strokeStyle = 'rgba(214,206,160,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(x, S * 0.12, S / 6 * 0.42, S * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // darker trailing edge
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(20,26,12,0)');
  g.addColorStop(0.75, 'rgba(20,26,12,0)');
  g.addColorStop(1, 'rgba(20,26,12,0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------- geometry
// carapace: a dome seen in plan — the UVs project straight down, so the
// painted scute grid never pinches at the pole and the displaced plateaus
// line up exactly (central scutes run the spine, costals flank them)
function carapaceGeometry() {
  const geo = new THREE.SphereGeometry(1, 44, 26);
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = x * 0.5 + 0.5, v = z * 0.5 + 0.5; // plan projection
    const mask = y > -0.05 ? scuteMask(u, v) : 0; // only the dome is scuted
    const r = 1 + mask * 0.055;
    x *= r; y *= r; z *= r;
    // flare the rim just above the equator, tuck below
    const flare = Math.exp(-Math.pow((y - 0.06) / 0.16, 2)) * 0.05;
    x *= 1 + flare; z *= 1 + flare;
    p.setXYZ(i, x, y, z);
    uv.setXY(i, u, v);
  }
  geo.computeVertexNormals();
  return geo;
}

// head: a sphere pulled into a snout with a beak line
function headGeometry() {
  const geo = new THREE.SphereGeometry(1, 18, 14);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // +x is forward: taper the snout and drop it into a beak
    const fw = Math.max(x, 0);
    y *= 1 - fw * 0.28;
    z *= 1 - fw * 0.34;
    y -= fw * fw * 0.14;
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// flipper planform (shared): swept paddle, cambered toward the tip.
// m mirrors for the other side; camber differs beach vs sea.
function flipperGeo(len, wid, rear, m, camber) {
  const s = new THREE.Shape();
  const L = len, W = wid * m;
  s.moveTo(0.02, -W * 0.30);
  if (rear) {
    s.bezierCurveTo(L * 0.35, -W * 0.62, L * 0.85, -W * 0.55, L * 1.0, -W * 0.05);
    s.bezierCurveTo(L * 0.95, W * 0.42, L * 0.45, W * 0.52, 0.02, W * 0.30);
  } else {
    s.bezierCurveTo(L * 0.30, -W * 0.55, L * 0.72, -W * 0.48, L * 1.0, -W * 0.10);
    s.bezierCurveTo(L * 0.88, W * 0.18, L * 0.60, W * 0.36, L * 0.30, W * 0.44);
    s.bezierCurveTo(L * 0.16, W * 0.47, L * 0.05, W * 0.36, 0.02, W * 0.28);
  }
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: false, curveSegments: 7 });
  // remap the shape's UVs to 0..1 so the flipper skin lands right:
  // u along the limb, v leading edge (0) → trailing edge (1)
  const uvA = geo.attributes.uv;
  let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
  for (let i = 0; i < uvA.count; i++) {
    mnU = Math.min(mnU, uvA.getX(i)); mxU = Math.max(mxU, uvA.getX(i));
    mnV = Math.min(mnV, uvA.getY(i)); mxV = Math.max(mxV, uvA.getY(i));
  }
  for (let i = 0; i < uvA.count; i++) {
    uvA.setXY(i,
      (uvA.getX(i) - mnU) / Math.max(mxU - mnU, 1e-6),
      (uvA.getY(i) - mnV) / Math.max(mxV - mnV, 1e-6));
  }
  geo.rotateX(Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i) / len;
    p.setY(i, p.getY(i) - k * k * len * camber);
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------ assembly
// One anatomy, two dress codes: the swimmer's materials take the
// underwater caustic patch, the nester's cast shadows on the sand.
function buildTurtleCore({ seed, swim }) {
  // one shader program per part across all turtles: the seed only changes
  // textures (uniforms), never the shader code, so the cache key stays flat
  const patch = swim
    ? (mat, name) => uwPatch(mat, name)
    : (mat) => mat;
  const shadows = !swim;

  const { map: shellMap, bump: shellBump } = shellTextures(seed);
  const shellMat = patch(new THREE.MeshStandardMaterial({
    map: shellMap, bumpMap: shellBump, bumpScale: 0.02, roughness: 0.46,
  }), 'seaturtle-shell');
  const skinMat = patch(new THREE.MeshStandardMaterial({
    map: skinTexture(seed + 7), roughness: 0.72,
  }), 'seaturtle-skin');
  const plastronMat = patch(new THREE.MeshStandardMaterial({
    map: plastronTexture(), roughness: 0.6,
  }), 'seaturtle-plastron');
  const flipMat = patch(new THREE.MeshStandardMaterial({
    map: flipperTexture(seed + 13), roughness: 0.62, side: THREE.DoubleSide,
  }), 'seaturtle-flip');
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.2 });

  const g = new THREE.Group();
  const shellY = swim ? 0.05 : 0.17;
  const beltY = swim ? -0.03 : 0.09;

  const shell = new THREE.Mesh(carapaceGeometry(), shellMat);
  shell.scale.set(swim ? 0.5 : 0.48, swim ? 0.18 : 0.17, swim ? 0.4 : 0.38);
  shell.position.y = shellY;
  shell.castShadow = shadows;
  g.add(shell);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), plastronMat);
  belly.scale.set(swim ? 0.44 : 0.42, swim ? 0.11 : 0.1, swim ? 0.35 : 0.33);
  belly.position.y = beltY;
  g.add(belly);

  const headY = swim ? 0.02 : 0.13;
  // the head is a group so the eyes and lids duck with it when the brains
  // lower it (freeze, breathe)
  const head = new THREE.Group();
  head.position.set(swim ? 0.58 : 0.56, headY, 0);
  g.add(head);
  const skull = new THREE.Mesh(headGeometry(), skinMat);
  skull.scale.set((swim ? 0.115 : 0.11) * 1.35, swim ? 0.115 : 0.11, swim ? 0.115 : 0.11);
  skull.castShadow = shadows;
  head.add(skull);

  // neck: a short skin sleeve from the shell mouth to the skull
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.16, 12), skinMat);
  neck.rotation.z = Math.PI / 2 - 0.12;
  neck.position.set(swim ? -0.12 : -0.12, -0.005, 0);
  head.add(neck);

  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 7), eyeMat);
    eye.position.set(0.075, 0.028, 0.077 * s);
    head.add(eye);
    // lid ridge over each eye
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 5, 8, Math.PI), skinMat);
    lid.position.set(0.075, 0.032, 0.077 * s);
    lid.rotation.set(Math.PI / 2 + s * 0.5, 0, 0.2);
    head.add(lid);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.004, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xfff4dc }));
    glint.position.set(0.083, 0.034, 0.083 * s);
    head.add(glint);
  }

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 8), skinMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(swim ? -0.52 : -0.5, swim ? -0.01 : 0.1, 0);
  g.add(tail);

  const flipY = swim ? -0.02 : 0.09;
  const camber = swim ? 0.1 : 0.16;
  const mk = (px, pz, splay, rear, m) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, flipY, pz);
    const f = new THREE.Mesh(
      flipperGeo(rear ? (swim ? 0.26 : 0.24) : (swim ? 0.52 : 0.46), swim ? 0.32 : 0.30, rear, m, camber),
      flipMat);
    f.castShadow = shadows;
    pivot.add(f);
    pivot.rotation.y = splay * m;
    g.add(pivot);
    return pivot;
  };
  const frontX = swim ? 0.3 : 0.30, frontZ = swim ? 0.32 : 0.30;
  const backX = swim ? -0.4 : -0.38, backZ = swim ? 0.24 : 0.22;
  const frontL = mk(frontX, frontZ, swim ? -0.5 : -0.55, false, 1);
  const frontR = mk(frontX, -frontZ, swim ? -0.5 : -0.55, false, -1);
  const backL = mk(backX, backZ, -2.35, true, 1);
  const backR = mk(backX, -backZ, -2.35, true, -1);

  return { group: g, head, frontL, frontR, backL, backR };
}

// The beach nester. Casts shadows; sits tall on her plastron for the crawl.
export function buildTurtleMesh() {
  return buildTurtleCore({ seed: 77, swim: false });
}

// The open-water swimmer. Materials carry the underwater caustic patch.
export function buildSwimTurtleMesh(seed) {
  return buildTurtleCore({ seed, swim: true });
}
