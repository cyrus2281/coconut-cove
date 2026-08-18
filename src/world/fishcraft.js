// Fish factory. One parametric body builder (a spindle of elliptical ribs,
// nose +x), a small library of fin planforms (extruded paper-thin, like the
// turtle's flippers), a mirrored-canvas texture painter so both flanks always
// match, and an instanced swim material whose vertex shader whips the tail —
// amplitude growing nose→tail with a slight counter-sway at the head, plus
// the shared underwater caustic light. Every species in sealife.js is
// assembled from these parts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uwAttach, UW_WPOS_VERT, UW_FRAG_DECL, UW_CAUSTIC_FRAG } from './underwater.js';

// ------------------------------------------------------------------ body
// Texture layout: u 0.02→0.82 nose→tail along the body, fins sample the
// [0.85, 1.0] strip. v wraps the girth: 0 belly → 0.5 back → 1 belly, and
// the painter mirrors about v = 0.5 so both sides carry the same pattern.
const FIN_U0 = 0.85, FIN_U1 = 0.995;

function remapUV(geo, u0, u1, v0, v1) {
  const uv = geo.attributes.uv;
  let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    mnU = Math.min(mnU, uv.getX(i)); mxU = Math.max(mxU, uv.getX(i));
    mnV = Math.min(mnV, uv.getY(i)); mxV = Math.max(mxV, uv.getY(i));
  }
  const su = (u1 - u0) / Math.max(mxU - mnU, 1e-6);
  const sv = (v1 - v0) / Math.max(mxV - mnV, 1e-6);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + (uv.getX(i) - mnU) * su, v0 + (uv.getY(i) - mnV) * sv);
  }
  return geo;
}

function finGeo(shape, u0 = FIN_U0, u1 = FIN_U1) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.006, bevelEnabled: false, curveSegments: 5,
  });
  geo.translate(0, 0, -0.003);
  return remapUV(geo, u0, u1, 0.05, 0.95);
}

function caudalShape(type, cl, ch) {
  const s = new THREE.Shape();
  if (type === 'fork') {
    s.moveTo(0.01, ch * 0.14);
    s.quadraticCurveTo(-cl * 0.5, ch * 0.5, -cl, ch);
    s.quadraticCurveTo(-cl * 0.55, ch * 0.2, -cl * 0.45, 0);
    s.quadraticCurveTo(-cl * 0.55, -ch * 0.2, -cl, -ch);
    s.quadraticCurveTo(-cl * 0.5, -ch * 0.5, 0.01, -ch * 0.14);
  } else if (type === 'round') {
    s.moveTo(0.01, ch * 0.42);
    s.quadraticCurveTo(-cl * 0.95, ch * 0.85, -cl * 0.92, 0);
    s.quadraticCurveTo(-cl * 0.95, -ch * 0.85, 0.01, -ch * 0.42);
  } else if (type === 'truncate') {
    s.moveTo(0.01, ch * 0.42);
    s.lineTo(-cl * 0.85, ch * 0.8);
    s.quadraticCurveTo(-cl, 0, -cl * 0.85, -ch * 0.8);
    s.lineTo(0.01, -ch * 0.42);
  } else { // lunate: the shark's crescent, long raked upper lobe
    s.moveTo(0.01, ch * 0.12);
    s.quadraticCurveTo(-cl * 0.35, ch * 0.55, -cl * 1.15, ch * 1.55);
    s.quadraticCurveTo(-cl * 0.5, ch * 0.3, -cl * 0.4, 0);
    s.quadraticCurveTo(-cl * 0.48, -ch * 0.25, -cl * 0.72, -ch * 0.72);
    s.quadraticCurveTo(-cl * 0.28, -ch * 0.3, 0.01, -ch * 0.12);
  }
  s.closePath();
  return s;
}

function sailShape(bw, dh, sweep) {
  // dorsal/anal: straight base along +x, curved crest above (dh < 0 = anal)
  const s = new THREE.Shape();
  s.moveTo(0, -0.001 * Math.sign(dh));
  if (sweep) { // swept triangle (shark)
    s.lineTo(bw * 0.28, dh);
    s.quadraticCurveTo(bw * 0.55, dh * 0.55, bw, -0.001 * Math.sign(dh));
  } else {
    s.quadraticCurveTo(bw * 0.12, dh, bw * 0.42, dh * 0.94);
    s.quadraticCurveTo(bw * 0.78, dh * 0.6, bw, -0.001 * Math.sign(dh));
  }
  s.closePath();
  return s;
}

function pectShape(pl, ph) {
  const s = new THREE.Shape();
  s.moveTo(0.001, ph * 0.1);
  s.quadraticCurveTo(-pl * 0.45, ph * 0.9, -pl, ph * 0.28);
  s.quadraticCurveTo(-pl * 0.6, -ph * 0.22, 0.001, -ph * 0.1);
  s.closePath();
  return s;
}

export function fishGeometry({
  len = 0.2, height = 0.08, width = 0.032,
  peak = 0.42, blunt = 0.62, peduncle = 0.10,
  slices = 22, ring = 14,
  caudal = { type: 'fork', l: 0.3, h: 0.55 },
  dorsal = { h: 0.55, u0: 0.24, u1: 0.72, sweep: false },
  anal = { h: 0.32, u0: 0.52, u1: 0.76 },
  pect = { l: 0.2, h: 0.5 },
} = {}) {
  const prof = (u) => {
    const uu = u <= peak ? u / (2 * peak) : 0.5 + (u - peak) / (2 * (1 - peak));
    let f = Math.pow(Math.max(4 * uu * (1 - uu), 0), blunt);
    f = Math.max(f, peduncle
      * THREE.MathUtils.smoothstep(u, 0.55, 0.8)
      * (1 - THREE.MathUtils.smoothstep(u, 0.9, 1.0)));
    return f;
  };

  // ---- the body: rings of ellipses from nose (+x) to tail (-x) ----
  const N = slices, M = ring;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const f = prof(u);
    const x = len / 2 - u * len;
    const ry = (height / 2) * f;
    const rz = (width / 2) * Math.pow(Math.max(f, 1e-4), 0.8);
    for (let j = 0; j <= M; j++) {
      const phi = (j / M) * Math.PI * 2;
      pos.push(x, -Math.cos(phi) * ry, Math.sin(phi) * rz);
      uv.push(0.02 + u * 0.8, j / M);
    }
  }
  const stride = M + 1;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * stride + j, b = a + 1, c = a + stride, d = c + 1;
      // wound so the normals face outward (+x nose, φ sweeps belly→back)
      idx.push(a, b, c, b, d, c);
    }
  }
  let body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  body.setIndex(idx);
  body.computeVertexNormals();
  body = body.toNonIndexed(); // the fins are extrudes: everything non-indexed

  const parts = [body];

  // ---- fins ----
  if (caudal) {
    const g = finGeo(caudalShape(caudal.type, caudal.l * len, caudal.h * height));
    g.translate(-len / 2 + len * 0.03, 0, 0);
    parts.push(g);
  }
  if (dorsal) {
    const bw = (dorsal.u1 - dorsal.u0) * len;
    const g = finGeo(sailShape(bw, dorsal.h * height, dorsal.sweep));
    const baseY = (height / 2) * Math.min(prof(dorsal.u0), prof(dorsal.u1)) * 0.8;
    g.translate(len / 2 - dorsal.u1 * len, baseY, 0);
    parts.push(g);
  }
  if (anal) {
    const bw = (anal.u1 - anal.u0) * len;
    const g = finGeo(sailShape(bw, -anal.h * height, false));
    const baseY = (height / 2) * Math.min(prof(anal.u0), prof(anal.u1)) * 0.8;
    g.translate(len / 2 - anal.u1 * len, -baseY, 0);
    parts.push(g);
  }
  if (pect) {
    for (const m of [1, -1]) {
      const g = finGeo(pectShape(pect.l * len, pect.h * height * m));
      g.rotateX(m * 0.35);   // blade angled off the flank
      g.rotateY(m * -0.55);  // swept back and out
      g.translate(len * 0.16, -height * 0.04, m * width * 0.42);
      parts.push(g);
    }
  }

  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

// -------------------------------------------------------------- textures
// The painter draws HALF the wrap — y = 0 is the belly, y = H2 is the back —
// and the frame mirrors it so both flanks match. Then the fin strip fills
// the right-hand margin.
export function fishTexture(painter, {
  W = 256, H = 128, finColor = '#cfd8dc', rayColor = 'rgba(30,40,50,0.35)',
} = {}) {
  const H2 = H / 2;
  const half = document.createElement('canvas');
  half.width = W; half.height = H2;
  const hc = half.getContext('2d');

  const bodyW = Math.floor(W * 0.84);
  const helpers = {
    ctx: hc, W: bodyW, H: H2,
    // vertical gradient belly (y=0) → back (y=H2)
    base(stops) {
      const g = hc.createLinearGradient(0, 0, 0, H2);
      for (const [at, col] of stops) g.addColorStop(at, col);
      hc.fillStyle = g;
      hc.fillRect(0, 0, W, H2);
    },
    // vertical bar across the flank at body-u, width du (0..1 of body)
    bar(u, du, col, topBias = 0) {
      const x = u * bodyW, w = Math.max(du * bodyW, 1);
      if (topBias > 0) {
        const g = hc.createLinearGradient(0, 0, 0, H2);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(topBias, col);
        g.addColorStop(1, col);
        hc.fillStyle = g;
      } else hc.fillStyle = col;
      hc.fillRect(x - w / 2, 0, w, H2);
    },
    // horizontal stripe at girth v (0 belly → 1 back), thickness dv
    stripe(v, dv, col) {
      hc.fillStyle = col;
      hc.fillRect(0, (v - dv / 2) * H2, bodyW, Math.max(dv * H2, 1));
    },
    spot(u, v, r, col) {
      hc.fillStyle = col;
      hc.beginPath();
      hc.arc(u * bodyW, v * H2, r * H2, 0, Math.PI * 2);
      hc.fill();
    },
    // the eye: dark pupil in a pale ring at girth v (≈0.62 reads right)
    eye(u = 0.075, v = 0.62, r = 0.085) {
      helpers.spot(u, v, r * 1.55, 'rgba(238,240,235,0.95)');
      helpers.spot(u, v, r, '#10130f');
      helpers.spot(u - r * 0.25, v + r * 0.3, r * 0.3, 'rgba(255,255,255,0.85)');
    },
    gill(u = 0.16) {
      hc.strokeStyle = 'rgba(20,26,30,0.35)';
      hc.lineWidth = 2;
      hc.beginPath();
      hc.arc(u * bodyW - 14, H2 * 0.55, 20, -0.9, 0.9);
      hc.stroke();
    },
  };
  painter(helpers);

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(half, 0, 0);
  ctx.save();
  ctx.translate(0, H);
  ctx.scale(1, -1);
  ctx.drawImage(half, 0, 0);
  ctx.restore();

  // fin strip: membrane color raked with fine rays
  const fx = Math.floor(W * 0.84);
  ctx.fillStyle = finColor;
  ctx.fillRect(fx, 0, W - fx, H);
  ctx.strokeStyle = rayColor;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 14; i++) {
    const y = (i / 13) * H;
    ctx.beginPath();
    ctx.moveTo(fx, y);
    ctx.lineTo(W, y + (i % 2 ? 3 : -3));
    ctx.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// paint into the fin strip after the fact (black shark tips, accents)
export function tintFinStrip(tex, paint) {
  const c = tex.image;
  const ctx = c.getContext('2d');
  const fx = Math.floor(c.width * 0.84);
  paint(ctx, fx, 0, c.width - fx, c.height);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- material
// Instanced swim: aWig = (phase, amplitude, frequency) per fish.
export function fishMaterial({ map, name, len, freq = 7, rough = 0.5, metal = 0.2 }) {
  const mat = new THREE.MeshStandardMaterial({
    map, roughness: rough, metalness: metal,
  });
  mat.onBeforeCompile = (shader) => {
    uwAttach(shader);
    shader.vertexShader = `
      attribute vec3 aWig;
      uniform float uTime;
      varying vec3 vWPos;
    ` + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float fu = clamp((${(len / 2).toFixed(4)} - transformed.x) / ${len.toFixed(4)}, 0.0, 1.0);
        float fph = uTime * ${freq.toFixed(2)} * aWig.z + aWig.x;
        float fenv = 0.035 + pow(fu, 2.0) * 0.16;
        transformed.z += (sin(fph - fu * 4.2) - sin(fph) * 0.35 * (1.0 - fu))
          * fenv * ${len.toFixed(4)} * aWig.y;
      }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      ${UW_WPOS_VERT}`);
    shader.fragmentShader = UW_FRAG_DECL + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${UW_CAUSTIC_FRAG}`);
  };
  mat.customProgramCacheKey = () => 'fish-' + name;
  return mat;
}

// per-instance wiggle attribute for a school of `count`
export function wigAttribute(geo, count, rand) {
  const a = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    a[i * 3] = rand() * Math.PI * 2;
    a[i * 3 + 1] = 0.75 + rand() * 0.5;
    a[i * 3 + 2] = 0.8 + rand() * 0.45;
  }
  geo.setAttribute('aWig', new THREE.InstancedBufferAttribute(a, 3));
  return geo;
}
