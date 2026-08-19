// The ghost crab as an asset: a sculpted trapezoid carapace with a granular
// painted shell (speckle, gastric groove, rim shading and a matching bump
// map), banded three-segment legs, asymmetric chelipeds whose pincers gape
// on a real hinge, and tall club-tipped eye stalks. crabs.js owns the
// darting/fleeing brain and drives the hips, the claw pivots and the
// pincers; the /components viewer drives them from buttons.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';

function tube(fx, fy, fz, tx, ty, tz, r1, r2, seg = 7) {
  const from = new THREE.Vector3(fx, fy, fz);
  const dir = new THREE.Vector3(tx - fx, ty - fy, tz - fz);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, seg);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  return g;
}

// ---------------------------------------------------------------- skins
function cssColor(c) { return '#' + c.getHexString(); }

// carapace: sand-toned shell over the seeded tint, finely granular, with
// the H-shaped gastric groove and darker rim; bump carries the grain
function carapaceTextures(tint) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const b = document.createElement('canvas');
  b.width = b.height = S;
  const bctx = b.getContext('2d');
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, S, S);
  const rand = mulberry32(1877);

  // base: tint warmed toward dry sand, lighter at the crown (canvas center
  // maps to the carapace top on the sphere's UV)
  const sand = new THREE.Color(0xe2d4b4);
  const base = tint.clone().lerp(sand, 0.45);
  const lightC = base.clone().multiplyScalar(1.12);
  const darkC = base.clone().multiplyScalar(0.78);
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, cssColor(darkC));
  g.addColorStop(0.35, cssColor(lightC));
  g.addColorStop(0.62, cssColor(base));
  g.addColorStop(1, cssColor(darkC));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // mottled patches
  for (let i = 0; i < 46; i++) {
    const x = rand() * S, y = rand() * S, r = 6 + rand() * 16;
    const m = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.5;
    m.addColorStop(0, dark ? 'rgba(90,70,46,0.14)' : 'rgba(255,246,224,0.13)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = m;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fine granules, echoed as bump grain
  for (let i = 0; i < 2600; i++) {
    const x = rand() * S, y = rand() * S;
    const a = 0.05 + rand() * 0.09;
    ctx.fillStyle = rand() < 0.5 ? `rgba(70,52,34,${a})` : `rgba(255,250,235,${a})`;
    ctx.fillRect(x, y, 1.3, 1.3);
    bctx.fillStyle = rand() < 0.5 ? 'rgba(60,60,60,0.5)' : 'rgba(210,210,210,0.5)';
    bctx.fillRect(x, y, 1.5, 1.5);
  }
  // the H-groove across the crown (gastric/cardiac regions)
  const groove = (ctx2, col, w) => {
    ctx2.strokeStyle = col;
    ctx2.lineWidth = w;
    ctx2.lineCap = 'round';
    ctx2.beginPath();
    ctx2.moveTo(S * 0.38, S * 0.3);
    ctx2.quadraticCurveTo(S * 0.42, S * 0.42, S * 0.38, S * 0.52);
    ctx2.moveTo(S * 0.62, S * 0.3);
    ctx2.quadraticCurveTo(S * 0.58, S * 0.42, S * 0.62, S * 0.52);
    ctx2.moveTo(S * 0.4, S * 0.42);
    ctx2.lineTo(S * 0.6, S * 0.42);
    ctx2.stroke();
    ctx2.lineCap = 'butt';
  };
  groove(ctx, 'rgba(80,60,40,0.3)', 4);
  groove(bctx, 'rgba(50,50,50,0.8)', 4);
  // two pale muscle scars
  for (const mx of [0.44, 0.56]) {
    ctx.fillStyle = 'rgba(255,248,230,0.35)';
    ctx.beginPath();
    ctx.ellipse(S * mx, S * 0.36, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(b);
  return { map, bump };
}

// legs and claws: pale shell with darker joint bands and granular grain
function legTextures() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rand = mulberry32(553);
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#ded0b2');
  g.addColorStop(0.5, '#e9ddc2');
  g.addColorStop(1, '#d6c6a6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // joint bands (v runs along each segment)
  ctx.fillStyle = 'rgba(122,96,64,0.5)';
  ctx.fillRect(0, S * 0.02, S, S * 0.09);
  ctx.fillRect(0, S * 0.88, S, S * 0.1);
  ctx.fillStyle = 'rgba(150,120,84,0.28)';
  ctx.fillRect(0, S * 0.46, S, S * 0.08);
  for (let i = 0; i < 240; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(90,70,46,0.12)' : 'rgba(255,250,238,0.12)';
    ctx.fillRect(rand() * S, rand() * S, 1, 1);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

// ------------------------------------------------------------- geometry
// carapace: a sphere sculpted into the ghost crab's box — flat crown,
// squared front with a brow ridge, corner points, tucked rear
function carapaceGeometry() {
  const geo = new THREE.SphereGeometry(0.075, 26, 18);
  const p = geo.attributes.position;
  const R = 0.075;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 1.3, y = p.getY(i) * 0.62, z = p.getZ(i) * 1.02;
    const nx = x / (R * 1.3), nz = z / (R * 1.02); // -1..1 across the shell
    // flatten the crown, keep a slight dome
    if (y > 0) y *= 0.78 + 0.1 * (1 - nx * nx) * (1 - nz * nz);
    // square the front edge into a brow
    if (z > 0) {
      z *= 0.9 + 0.16 * (1 - Math.abs(nx));
      if (y > 0.004) y += 0.006 * Math.pow(Math.max(nz, 0), 3) * (1 - Math.abs(nx) * 0.6);
    }
    // pull the front corners out into small points
    const corner = Math.pow(Math.abs(nx), 3) * Math.pow(Math.max(nz, 0), 2);
    x *= 1 + corner * 0.22;
    // tuck the rear in
    if (z < 0) x *= 1 - 0.16 * Math.pow(-nz, 1.5);
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// three-segment walking leg: merus rising from the hip, high carpus elbow,
// long dactyl tapering to the sand
function buildLegGeometry() {
  return mergeGeometries([
    tube(0, 0, 0, 0.03, 0.014, 0.002, 0.0058, 0.005),
    new THREE.SphereGeometry(0.0054, 7, 6).translate(0.03, 0.014, 0.002), // elbow knuckle
    tube(0.03, 0.014, 0.002, 0.052, 0.006, 0.004, 0.0048, 0.004),
    new THREE.SphereGeometry(0.0044, 7, 6).translate(0.052, 0.006, 0.004),
    tube(0.052, 0.006, 0.004, 0.072, -0.018, 0.006, 0.0038, 0.0024),
    tube(0.072, -0.018, 0.006, 0.084, -0.045, 0.007, 0.0024, 0.0005),
  ]);
}

// ------------------------------------------------------------------- claw
// A cheliped the way a ghost crab wears it: the merus swings out to the
// side, the carpus turns the corner forward, and the propodus — the palm —
// is a laterally flattened egg carrying the fixed finger (the pollex) out
// of its lower edge. The dactyl above it is a separate mesh on its own
// hinge, so the pincer gapes and shuts. Both fingers taper to a hook and
// carry a row of tubercle teeth along the bite. `sign` mirrors the limb
// onto the other side; `k` scales it (one claw is much the bigger).
//
// Stations along the arm, in the claw's own frame: +z runs out along the
// limb, +x is outboard, +y up. Everything is scaled by k and mirrored by
// sign as it is built.
const CLAW = {
  arm: [[0, 0, 0], [0.024, -0.004, 0.010], [0.028, 0.003, 0.032]],
  armR: [0.0085, 0.0072, 0.0085], // shoulder, elbow, wrist
  hinge: [0.029, 0.0135, 0.060],  // where the dactyl swings from
  // pollex: bellied under the gape, hooking back up at the tip
  pollex: [[0.029, -0.0088, 0.058], [0.031, -0.0115, 0.076],
    [0.033, -0.008, 0.090], [0.034, -0.0035, 0.098]],
  pollexR: [0.0068, 0.0045, 0.0026, 0.0006],
  // dactyl, in the hinge's frame: it arcs down to close on the pollex tip
  dactyl: [[0, 0, 0], [0.002, -0.005, 0.016],
    [0.004, -0.013, 0.030], [0.005, -0.0175, 0.038]],
  dactylR: [0.0068, 0.0042, 0.0025, 0.0006],
};

// One run of the limb: tapered tubes between the stations with a knuckle at
// each bend, so the joints read as one shell rather than cut pipe.
function clawLimb(stations, radii, sign, k, seg = 8) {
  const P = stations.map(([x, y, z]) => [x * sign * k, y * k, z * k]);
  const parts = [];
  for (let i = 0; i < P.length - 1; i++) {
    parts.push(tube(...P[i], ...P[i + 1], radii[i] * k, radii[i + 1] * k, seg));
    if (i > 0) parts.push(new THREE.SphereGeometry(radii[i] * k * 0.96, seg, 6).translate(...P[i]));
  }
  return parts;
}

// A row of tubercles walked from a to b: the teeth down a biting edge, or
// the stridulating ridge on the big claw's inner face.
function tubercles(a, b, n, r0, r1, sign, k, shape = [0.55, 0.9, 1.3]) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const r = (r0 + (r1 - r0) * t) * k;
    const g = new THREE.SphereGeometry(r, 6, 5);
    g.scale(...shape);
    g.translate(
      (a[0] + (b[0] - a[0]) * t) * sign * k,
      (a[1] + (b[1] - a[1]) * t) * k,
      (a[2] + (b[2] - a[2]) * t) * k
    );
    out.push(g);
  }
  return out;
}

// The palm: an egg squeezed flat side to side, narrowed where the fingers
// leave it and heeled where it meets the wrist.
function clawPalmGeometry(sign, k) {
  const geo = new THREE.SphereGeometry(1, 16, 12);
  const p = geo.attributes.position;
  const HX = 0.0115, HY = 0.018, HZ = 0.021; // deep and beefy, but narrow
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i);
    const front = Math.max(nz, 0), back = Math.max(-nz, 0);
    const taper = (1 - 0.42 * Math.pow(front, 1.6)) * (1 - 0.14 * back * back);
    // a keel over the top, a flat run underneath into the fixed finger
    const keel = 1 + 0.1 * Math.max(ny, 0) * (1 - front) - 0.12 * Math.max(-ny, 0) * front;
    const sx = HX * taper, sy = HY * taper * keel;
    p.setXYZ(i, nx * sx * k, ny * sy * k, nz * HZ * k);
    // normals off the ellipsoid rather than recomputed: computeVertexNormals
    // would leave a crease down the sphere's UV seam
    const v = new THREE.Vector3(nx / sx, ny / sy, nz / HZ).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  geo.rotateX(-0.06); // the palm rides nose-up out of the wrist
  geo.translate(0.028 * sign * k, 0.001 * k, 0.050 * k);
  return geo;
}

// The leg skin bands every tube at both ends, which is right for an arm and
// wrong for a finger: a finger is one unbroken piece of shell. Drag the run
// into a clean stretch of the texture instead, palest toward the tip.
function unband(geos, z0, z1, k) {
  for (const g of geos) {
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getZ(i) / k - z0) / (z1 - z0), 0, 1);
      uv.setY(i, 0.8 - 0.24 * t);
    }
  }
  return geos;
}

function buildClawGeometry(sign, k) {
  const parts = [
    ...clawLimb(CLAW.arm, CLAW.armR, sign, k),
    clawPalmGeometry(sign, k),
    ...unband([
      ...clawLimb(CLAW.pollex, CLAW.pollexR, sign, k, 7),
      // teeth up the biting edge, coarse at the base, fine at the tip
      ...tubercles([0.0305, -0.0060, 0.072], [0.0335, -0.0045, 0.093], 6,
        0.0015, 0.0008, sign, k),
    ], 0.060, 0.098, k),
  ];
  if (k > 1) {
    // the major claw's stridulating ridge, on the face turned inboard
    parts.push(...tubercles([0.0182, -0.006, 0.038], [0.0192, 0.006, 0.058], 7,
      0.0022, 0.0018, sign, k, [0.3, 1.1, 0.6]));
  }
  return mergeGeometries(parts);
}

// The movable finger, built around its hinge so the whole mesh swings on it.
function buildDactylGeometry(sign, k) {
  return mergeGeometries([
    new THREE.SphereGeometry(0.0074 * k, 9, 7), // the hinge knuckle itself
    ...unband([
      ...clawLimb(CLAW.dactyl, CLAW.dactylR, sign, k, 7),
      ...tubercles([0.0022, -0.0083, 0.010], [0.0045, -0.0157, 0.031], 5,
        0.0015, 0.0008, sign, k),
    ], 0, 0.038, k),
  ]);
}

// -------------------------------------------------------------------- rig
export function buildCrab(tint) {
  const { map, bump } = carapaceTextures(tint);
  const shellMat = new THREE.MeshStandardMaterial({
    map, bumpMap: bump, bumpScale: 0.0016, roughness: 0.58,
  });
  const legMap = legTextures();
  const legTint = tint.clone().lerp(new THREE.Color(0xf2e6cc), 0.55);
  const legMat = new THREE.MeshStandardMaterial({
    map: legMap, color: legTint, roughness: 0.68,
  });
  const clawMat = new THREE.MeshStandardMaterial({
    map: legMap, color: legTint.clone().multiplyScalar(1.06), roughness: 0.5,
  });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x181008, roughness: 0.18 });
  const stalkMat = new THREE.MeshStandardMaterial({
    color: legTint.clone().multiplyScalar(0.9), roughness: 0.6,
  });

  const g = new THREE.Group();

  const body = new THREE.Mesh(carapaceGeometry(), shellMat);
  body.position.y = 0.014;
  body.castShadow = true;
  g.add(body);

  // underside plate, tucked and plain
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), legMat);
  belly.scale.set(1.25, 0.32, 0.9);
  belly.position.y = -0.002;
  g.add(belly);

  // periscope eyes: stout stalks with club corneas, splayed a little
  for (const s of [-1, 1]) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0026, 0.0034, 0.02, 7), stalkMat);
    stalk.position.set(0.02 * s, 0.032, 0.062);
    stalk.rotation.z = -s * 0.16;
    g.add(stalk);
    const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.0058, 0.009, 3, 8), eyeMat);
    eye.position.set(0.0235 * s, 0.047, 0.063);
    eye.rotation.z = -s * 0.12;
    g.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0015, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xfff8e8 }));
    glint.position.set(0.025 * s, 0.052, 0.0675);
    g.add(glint);
  }

  // claws: the major and the minor, each held out on a shoulder pivot with
  // its dactyl on a hinge of its own. crabs.js swings the shoulder to throw
  // the claws up and works the hinge to gape the pincer; the pivot carries
  // the hinge on userData so both drivers can find it.
  const claws = [];
  const clawScale = [1.18, 0.85]; // left big, right small
  for (const [i, sign] of [-1, 1].entries()) {
    const k = clawScale[i];
    const pivot = new THREE.Group();
    pivot.position.set(0.052 * sign, 0.006, 0.055);
    pivot.rotation.y = -0.35 * sign;
    const claw = new THREE.Mesh(buildClawGeometry(sign, k), clawMat);
    claw.castShadow = true;
    pivot.add(claw);
    const jaw = new THREE.Group();
    jaw.position.set(CLAW.hinge[0] * sign * k, CLAW.hinge[1] * k, CLAW.hinge[2] * k);
    jaw.rotation.x = -0.06; // resting gape
    const dactyl = new THREE.Mesh(buildDactylGeometry(sign, k), clawMat);
    dactyl.castShadow = true;
    jaw.add(dactyl);
    pivot.add(jaw);
    pivot.userData.jaw = jaw;
    g.add(pivot);
    claws.push(pivot);
  }

  const legGeo = buildLegGeometry();
  const legs = [];
  const zPos = [0.048, 0.018, -0.014, -0.046];
  const fan = [0.55, 0.2, -0.18, -0.55];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const hip = new THREE.Group();
      hip.position.set(0.058 * side, 0.004, zPos[i]);
      hip.rotation.y = (side > 0 ? 0 : Math.PI) + fan[i] * side;
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.castShadow = true;
      hip.add(leg);
      g.add(hip);
      legs.push({ hip, phase: i * 2.4 + (side > 0 ? 0 : Math.PI) });
    }
  }

  return { group: g, claws, legs };
}
