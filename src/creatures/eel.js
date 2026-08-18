// The moray eel as an asset, built in local space: den mouth at the
// origin, body leaning out along +x. A tapered trunk with a dorsal fin
// ribbon, a browed skull with a toothed, working jaw, and a mottled
// green-moray hide. sealife.js places the group at the den and yaws it
// to the den's heading.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { uwPatch } from '../world/underwater.js';

function eelTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rand = mulberry32(883);
  ctx.fillStyle = '#57662f';
  ctx.fillRect(0, 0, S, S);
  // large dark mottle first, then fine grain over it
  for (let i = 0; i < 60; i++) {
    const x = rand() * S, y = rand() * S, r = 8 + rand() * 20;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(28,38,16,${0.18 + rand() * 0.2})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() < 0.5
      ? `rgba(30,38,18,${0.2 + rand() * 0.3})`
      : `rgba(134,148,84,${0.16 + rand() * 0.26})`;
    ctx.beginPath();
    ctx.arc(rand() * S, rand() * S, 0.8 + rand() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildEel() {
  const group = new THREE.Group();
  group.name = 'moray';
  const mat = uwPatch(new THREE.MeshStandardMaterial({
    map: eelTexture(), roughness: 0.55,
  }), 'moray');
  const finMat = uwPatch(new THREE.MeshStandardMaterial({
    map: mat.map, roughness: 0.7, side: THREE.DoubleSide,
    transparent: true, opacity: 0.85,
  }), 'moray-fin');

  // the trunk: rooted below the den mouth, leaning up and out along +x,
  // thick at the den and narrowing into the neck
  const pts = [
    new THREE.Vector3(-0.55, -0.14, 0),
    new THREE.Vector3(0.08, 0.02, 0.01),
    new THREE.Vector3(0.3, 0.15, -0.005),
    new THREE.Vector3(0.5, 0.34, 0),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = 22, ringN = 10;
  // hand-lofted tube so the radius can taper along the curve
  const posA = [], uvA = [], idxA = [];
  const radiusAt = (k) => 0.068 - 0.026 * k;
  const frames = curve.computeFrenetFrames(segs, false);
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const p = curve.getPointAt(k);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = radiusAt(k);
    for (let j = 0; j <= ringN; j++) {
      const a = (j / ringN) * Math.PI * 2;
      const nx = Math.cos(a), ny = Math.sin(a);
      posA.push(
        p.x + (N.x * nx + B.x * ny) * r,
        p.y + (N.y * nx + B.y * ny) * r,
        p.z + (N.z * nx + B.z * ny) * r);
      uvA.push(k * 2.2, j / ringN);
    }
  }
  const stride = ringN + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < ringN; j++) {
      const a = i * stride + j, b = a + 1, cc = a + stride, d = cc + 1;
      // wound so the normals face outward along the frenet frames
      idxA.push(a, b, cc, b, d, cc);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
  trunk.setIndex(idxA);
  trunk.computeVertexNormals();
  group.add(new THREE.Mesh(trunk, mat));

  // dorsal fin ribbon riding the top of the trunk
  const finPos = [], finUv = [], finIdx = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const p = curve.getPointAt(k);
    const r = radiusAt(k);
    const h = 0.025 * Math.sin(Math.PI * Math.min(k * 1.35, 1)) + 0.004;
    finPos.push(p.x, p.y + r * 0.92, p.z, p.x - h * 0.4, p.y + r * 0.92 + h, p.z);
    finUv.push(k * 2.2, 0.1, k * 2.2, 0.4);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, cc = a + 2, d = a + 3;
    finIdx.push(a, cc, b, b, cc, d);
  }
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute(finPos, 3));
  fin.setAttribute('uv', new THREE.Float32BufferAttribute(finUv, 2));
  fin.setIndex(finIdx);
  fin.computeVertexNormals();
  group.add(new THREE.Mesh(fin, finMat));

  // ---- the head ----
  const head = new THREE.Group();
  const skullGeo = new THREE.SphereGeometry(0.062, 14, 11);
  {
    // lengthen the skull and pinch it into a muzzle toward +x
    const p = skullGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      x *= 1.65;
      const fw = Math.max(x, 0) / 0.1;
      y *= 1 - fw * 0.3;
      z *= 1 - fw * 0.28;
      y -= Math.max(x, 0) * 0.24;
      p.setXYZ(i, x, y, z);
    }
    skullGeo.computeVertexNormals();
  }
  const skull = new THREE.Mesh(skullGeo, mat);
  head.add(skull);
  // brow ridges over the eyes: the moray scowl
  for (const m of [1, -1]) {
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), mat);
    brow.scale.set(1.7, 0.75, 0.9);
    brow.position.set(0.032, 0.038, 0.028 * m);
    head.add(brow);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 8, 7),
      new THREE.MeshStandardMaterial({ color: 0xc8b860, roughness: 0.25 }));
    eye.position.set(0.04, 0.028, 0.034 * m);
    head.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0x0c0a06, roughness: 0.2 }));
    pupil.position.set(0.047, 0.028, 0.0385 * m);
    head.add(pupil);
  }
  // lower jaw: a narrow mandible in the same mottled hide, tucked under
  // the snout (never past it), hinged at the throat
  const jaw = new THREE.Group();
  jaw.position.set(0.0, -0.016, 0);
  const jawGeo = new THREE.SphereGeometry(0.036, 10, 8);
  {
    const p = jawGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      x *= 1.45;
      const fw = Math.max(x, 0) / 0.052;
      z *= (1 - fw * 0.4) * 0.72;
      y *= 0.4;
      p.setXYZ(i, x, y, z);
    }
    jawGeo.computeVertexNormals();
  }
  const jawMesh = new THREE.Mesh(jawGeo, mat);
  jawMesh.position.x = 0.032;
  jaw.add(jawMesh);
  // the dark mouth lining, glimpsed between the jaws when the gape works
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x38181a, roughness: 0.8 }));
  mouth.scale.set(1.5, 0.3, 0.6);
  mouth.position.set(0.035, 0.011, 0);
  jaw.add(mouth);
  head.add(jaw);
  // teeth: tiny ivory needles along both jaws
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xf2ead2, roughness: 0.3 });
  const toothGeo = new THREE.ConeGeometry(0.0022, 0.01, 5);
  for (const m of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const upper = new THREE.Mesh(toothGeo, toothMat);
      upper.position.set(0.05 + i * 0.013, -0.008 - i * 0.003, (0.02 - i * 0.0035) * m);
      upper.rotation.x = Math.PI; // hanging down
      head.add(upper);
      const lower = new THREE.Mesh(toothGeo, toothMat);
      lower.position.set(0.046 + i * 0.013, 0.008, (0.017 - i * 0.0035) * m);
      jaw.add(lower);
    }
  }
  const tip = pts[3];
  head.position.copy(tip);
  group.add(head);

  function update(t) {
    // slow threat-posture sway and that perpetual moray gape. The skull
    // overlaps the trunk tip by a couple of centimetres, so the drift has
    // to stay smaller than that overlap or the neck visibly parts.
    const sway = Math.sin(t * 0.9) * 0.12 + Math.sin(t * 0.37) * 0.08;
    head.position.set(
      tip.x,
      tip.y + Math.sin(t * 0.6) * 0.012,
      tip.z + sway * 0.09
    );
    head.rotation.y = sway;
    jaw.rotation.z = -(0.3 + Math.sin(t * 1.4) * 0.18);
  }
  return { group, update };
}
