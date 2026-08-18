// Fish factory. One parametric body builder (a spindle of elliptical ribs
// with a drooping snout, eye-socket bulges and a flared gill plate, nose
// +x), a library of fin planforms (extruded paper-thin), a mirrored-canvas
// skin painter that lays down scale lattices, baked shading, lateral lines
// and detailed eyes — and paints a matching bump map as it goes — plus an
// instanced swim material (physical, with optional clearcoat/iridescence)
// whose vertex shader whips the tail and carries the shared underwater
// caustic light. Every species in species.js is assembled from these parts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uwAttach, UW_WPOS_VERT, UW_FRAG_DECL, UW_CAUSTIC_FRAG } from '../world/underwater.js';

// ------------------------------------------------------------------ body
// Texture layout: u 0.02→0.82 nose→tail along the body, fins sample the
// [0.85, 1.0] strip. v wraps the girth: 0 belly → 0.5 back → 1 belly, and
// the painter mirrors about v = 0.5 so both flanks carry the same pattern.
// (Painter helpers use half-wrap coordinates: 0 belly → 1 back.)
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
    depth: 0.0045, bevelEnabled: false, curveSegments: 8,
  });
  geo.translate(0, 0, -0.00225);
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
  slices = 26, ring = 18,
  snoutDroop = 0.3,                       // nose slopes down toward the mouth
  eyeBulge = { u: 0.1, v: 0.62, k: 0.3 }, // socket swell on both flanks
  gillFlare = { u: 0.21, k: 0.08 },       // operculum bulge + crease behind it
  caudal = { type: 'fork', l: 0.3, h: 0.55 },
  dorsal = { h: 0.55, u0: 0.24, u1: 0.72, sweep: false },
  dorsal2 = null,                         // rear dorsal (sharks)
  anal = { h: 0.32, u0: 0.52, u1: 0.76 },
  pect = { l: 0.2, h: 0.5 },
  pelvic = null,                          // e.g. { l: 0.12, h: 0.4, u: 0.42 }
} = {}) {
  const prof = (u) => {
    const uu = u <= peak ? u / (2 * peak) : 0.5 + (u - peak) / (2 * (1 - peak));
    let f = Math.pow(Math.max(4 * uu * (1 - uu), 0), blunt);
    f = Math.max(f, peduncle
      * THREE.MathUtils.smoothstep(u, 0.55, 0.8)
      * (1 - THREE.MathUtils.smoothstep(u, 0.9, 1.0)));
    return f;
  };
  // operculum: a soft radial swell that falls into a shallow crease
  const gillK = (u) => {
    if (!gillFlare) return 1;
    const g = Math.exp(-Math.pow((u - gillFlare.u) / 0.055, 2));
    const crease = Math.exp(-Math.pow((u - gillFlare.u - 0.075) / 0.04, 2));
    return 1 + gillFlare.k * g - gillFlare.k * 0.75 * crease;
  };
  // eye sockets: gaussian swell of the flank radius on both mirrored sides
  const bulgeK = (u, v) => {
    if (!eyeBulge) return 1;
    const v1 = eyeBulge.v * 0.5, v2 = 1 - eyeBulge.v * 0.5;
    const du = (u - eyeBulge.u) / 0.07;
    const d1 = (v - v1) / 0.1, d2 = (v - v2) / 0.1;
    const g = Math.exp(-(du * du + d1 * d1)) + Math.exp(-(du * du + d2 * d2));
    return 1 + eyeBulge.k * g;
  };

  // ---- the body: rings of ellipses from nose (+x) to tail (-x) ----
  const N = slices, M = ring;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const f = prof(u) * gillK(u);
    const x = len / 2 - u * len;
    // the snout eases down toward the mouth line
    const cy = -snoutDroop * (height * 0.5)
      * Math.pow(Math.max(1 - u / 0.16, 0), 1.7) * 0.5;
    const ry = (height / 2) * f;
    const rz = (width / 2) * Math.pow(Math.max(f, 1e-4), 0.8);
    for (let j = 0; j <= M; j++) {
      const v = j / M;
      const phi = v * Math.PI * 2;
      pos.push(x, cy - Math.cos(phi) * ry, Math.sin(phi) * rz * bulgeK(u, v));
      uv.push(0.02 + u * 0.8, v);
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
  if (dorsal2) {
    const bw = (dorsal2.u1 - dorsal2.u0) * len;
    const g = finGeo(sailShape(bw, dorsal2.h * height, dorsal2.sweep));
    const baseY = (height / 2) * Math.min(prof(dorsal2.u0), prof(dorsal2.u1)) * 0.8;
    g.translate(len / 2 - dorsal2.u1 * len, baseY, 0);
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
      g.rotateX(m * (pect.droop ?? 0.35)); // blade angled off the flank
      g.rotateY(m * -(pect.back ?? 0.55)); // swept back and out
      g.translate(len * (pect.x ?? 0.16), -height * (pect.down ?? 0.04), m * width * 0.42);
      parts.push(g);
    }
  }
  if (pelvic) {
    for (const m of [1, -1]) {
      const g = finGeo(pectShape(pelvic.l * len, pelvic.h * height * m));
      g.rotateX(m * 0.85);   // hanging down-and-out under the keel
      g.rotateY(m * -0.35);
      g.translate(len / 2 - (pelvic.u ?? 0.42) * len,
        -(height / 2) * prof(pelvic.u ?? 0.42) * 0.55, m * width * 0.2);
      parts.push(g);
    }
  }

  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

// -------------------------------------------------------------- textures
// The painter draws HALF the wrap — y = 0 is the belly, y = H2 is the back —
// and the frame mirrors it so both flanks match. Alongside the color canvas
// the helpers quietly paint a bump canvas (scales, gill plate, fin rays), so
// relief follows the skin with no extra species code. Then the fin strip
// fills the right-hand margin of both.
export function fishTexture(painter, {
  W = 512, H = 256, finColor = '#cfd8dc', rayColor = 'rgba(30,40,50,0.35)',
} = {}) {
  const H2 = H / 2;
  const half = document.createElement('canvas');
  half.width = W; half.height = H2;
  const hc = half.getContext('2d');
  const bhalf = document.createElement('canvas');
  bhalf.width = W; bhalf.height = H2;
  const bc = bhalf.getContext('2d');
  bc.fillStyle = '#808080';
  bc.fillRect(0, 0, W, H2);

  const bodyW = Math.floor(W * 0.84);
  const helpers = {
    ctx: hc, bctx: bc, W: bodyW, H: H2,
    // vertical gradient belly (y=0) → back (y=H2)
    base(stops) {
      const g = hc.createLinearGradient(0, 0, 0, H2);
      for (const [at, col] of stops) g.addColorStop(at, col);
      hc.fillStyle = g;
      hc.fillRect(0, 0, W, H2);
    },
    // baked form shading: bright dorsal light, soft belly occlusion, a dark
    // seam right at the keel and a shadow tucked behind the gill plate
    shade(k = 1) {
      const g = hc.createLinearGradient(0, 0, 0, H2);
      g.addColorStop(0, `rgba(8,10,14,${0.30 * k})`);
      g.addColorStop(0.10, `rgba(8,10,14,${0.10 * k})`);
      g.addColorStop(0.32, 'rgba(8,10,14,0)');
      g.addColorStop(0.86, 'rgba(255,250,240,0)');
      g.addColorStop(1, `rgba(255,250,240,${0.14 * k})`);
      hc.fillStyle = g;
      hc.fillRect(0, 0, bodyW, H2);
      // nose-tip and tail-root ambient falloff
      const n = hc.createLinearGradient(0, 0, bodyW, 0);
      n.addColorStop(0, `rgba(10,12,16,${0.22 * k})`);
      n.addColorStop(0.07, 'rgba(10,12,16,0)');
      n.addColorStop(0.93, 'rgba(10,12,16,0)');
      n.addColorStop(1, `rgba(10,12,16,${0.25 * k})`);
      hc.fillStyle = n;
      hc.fillRect(0, 0, bodyW, H2);
    },
    // a lattice of overlapping scale arcs, lit on the crown, dark at the
    // root, fading out toward the belly; echoed into the bump map
    scales({ rows = 11, size = 1.0, from = 0.14, to = 0.97,
      light = 0.10, dark = 0.12, skew = 0.55,
      lightCol = '255,252,244', darkCol = '10,14,18' } = {}) {
      const r = (H2 / rows) * 0.85 * size;
      const x0 = from * bodyW, x1 = to * bodyW;
      for (let row = 0; row <= rows + 1; row++) {
        const y = H2 - (row / rows) * H2 * 1.02;
        const fade = Math.pow(Math.min(row / (rows * 0.45), 1), 1.3); // belly fade
        const off = (row % 2) * r * skew;
        for (let x = x0 + off; x < x1; x += r * 1.12) {
          // color: dark root arc + light crown arc
          hc.strokeStyle = `rgba(${darkCol},${dark * fade})`;
          hc.lineWidth = Math.max(r * 0.16, 0.8);
          hc.beginPath();
          hc.arc(x, y, r, 0.15, Math.PI - 0.15);
          hc.stroke();
          hc.strokeStyle = `rgba(${lightCol},${light * fade})`;
          hc.lineWidth = Math.max(r * 0.12, 0.7);
          hc.beginPath();
          hc.arc(x, y - r * 0.12, r * 0.94, 0.35, Math.PI - 0.35);
          hc.stroke();
          // bump: groove + ridge
          bc.strokeStyle = `rgba(40,40,40,${0.5 * fade})`;
          bc.lineWidth = Math.max(r * 0.16, 0.8);
          bc.beginPath();
          bc.arc(x, y, r, 0.15, Math.PI - 0.15);
          bc.stroke();
          bc.strokeStyle = `rgba(230,230,230,${0.4 * fade})`;
          bc.lineWidth = Math.max(r * 0.12, 0.7);
          bc.beginPath();
          bc.arc(x, y - r * 0.12, r * 0.94, 0.35, Math.PI - 0.35);
          bc.stroke();
        }
      }
    },
    // the lateral line: a faint sensory seam arcing nose→tail
    lateral(v = 0.62, col = 'rgba(20,26,30,0.22)') {
      hc.strokeStyle = col;
      hc.lineWidth = Math.max(H2 * 0.012, 1);
      hc.beginPath();
      hc.moveTo(bodyW * 0.13, H2 * v);
      hc.quadraticCurveTo(bodyW * 0.45, H2 * (v + 0.1), bodyW * 0.98, H2 * (v - 0.06));
      hc.stroke();
      bc.strokeStyle = 'rgba(60,60,60,0.5)';
      bc.lineWidth = Math.max(H2 * 0.01, 1);
      bc.beginPath();
      bc.moveTo(bodyW * 0.13, H2 * v);
      bc.quadraticCurveTo(bodyW * 0.45, H2 * (v + 0.1), bodyW * 0.98, H2 * (v - 0.06));
      bc.stroke();
    },
    // random freckling
    speckle({ n = 120, col = 'rgba(255,255,255,0.08)', r = [0.4, 1.6],
      vMin = 0, vMax = 1, seedFn = Math.random } = {}) {
      for (let i = 0; i < n; i++) {
        const x = seedFn() * bodyW;
        const y = (vMin + seedFn() * (vMax - vMin)) * H2;
        const rr = (r[0] + seedFn() * (r[1] - r[0])) * (H2 / 128);
        hc.fillStyle = col;
        hc.beginPath();
        hc.arc(x, y, rr, 0, Math.PI * 2);
        hc.fill();
      }
    },
    // vertical bar across the flank at body-u, width du (0..1 of body),
    // soft-edged so it hugs the body curve instead of reading as paint
    bar(u, du, col, topBias = 0, soft = 0.25) {
      const x = u * bodyW, w = Math.max(du * bodyW, 1);
      let fill = col;
      if (topBias > 0) {
        const g = hc.createLinearGradient(0, 0, 0, H2);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(topBias, col);
        g.addColorStop(1, col);
        fill = g;
      }
      if (soft > 0) {
        const g2 = hc.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        const c = typeof fill === 'string' ? fill : col;
        g2.addColorStop(0, 'rgba(0,0,0,0)');
        g2.addColorStop(soft, c);
        g2.addColorStop(1 - soft, c);
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        hc.fillStyle = topBias > 0 ? fill : g2;
        // when both effects are wanted, layer them
        if (topBias > 0) {
          hc.save();
          hc.globalCompositeOperation = 'source-over';
          hc.fillRect(x - w / 2, 0, w, H2);
          hc.restore();
          return;
        }
      } else {
        hc.fillStyle = fill;
      }
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
    // the eye: socket shading, a bright ringed iris with radial flecks, a
    // deep pupil and a wet specular gleam (girth v ≈ 0.62 reads right)
    eye(u = 0.075, v = 0.62, r = 0.085, iris = '#c8b06a') {
      const cx = u * bodyW, cy = v * H2, R = r * H2;
      // socket: soft dark orbit ring
      let g = hc.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 2.1);
      g.addColorStop(0, 'rgba(12,14,16,0.5)');
      g.addColorStop(0.55, 'rgba(12,14,16,0.12)');
      g.addColorStop(1, 'rgba(12,14,16,0)');
      hc.fillStyle = g;
      hc.beginPath(); hc.arc(cx, cy, R * 2.1, 0, Math.PI * 2); hc.fill();
      // sclera rim
      hc.fillStyle = 'rgba(240,240,232,0.95)';
      hc.beginPath(); hc.arc(cx, cy, R * 1.5, 0, Math.PI * 2); hc.fill();
      // iris with a darker limbal ring
      g = hc.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.1, cx, cy, R * 1.32);
      g.addColorStop(0, iris);
      g.addColorStop(0.75, iris);
      g.addColorStop(1, 'rgba(20,18,10,0.95)');
      hc.fillStyle = g;
      hc.beginPath(); hc.arc(cx, cy, R * 1.32, 0, Math.PI * 2); hc.fill();
      // radial iris flecks
      hc.strokeStyle = 'rgba(30,24,10,0.4)';
      hc.lineWidth = Math.max(R * 0.07, 0.6);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        hc.beginPath();
        hc.moveTo(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55);
        hc.lineTo(cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2);
        hc.stroke();
      }
      // pupil, slightly forward-set
      hc.fillStyle = '#0a0c0a';
      hc.beginPath(); hc.arc(cx - R * 0.08, cy, R * 0.72, 0, Math.PI * 2); hc.fill();
      // wet gleam
      hc.fillStyle = 'rgba(255,255,255,0.9)';
      hc.beginPath(); hc.arc(cx - R * 0.32, cy - R * 0.34, R * 0.22, 0, Math.PI * 2); hc.fill();
      hc.fillStyle = 'rgba(255,255,255,0.35)';
      hc.beginPath(); hc.arc(cx + R * 0.25, cy + R * 0.3, R * 0.12, 0, Math.PI * 2); hc.fill();
      // bump: the eye sits proud of the socket
      const bg = bc.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
      bg.addColorStop(0, 'rgba(255,255,255,0.85)');
      bg.addColorStop(0.7, 'rgba(200,200,200,0.4)');
      bg.addColorStop(1, 'rgba(90,90,90,0.4)');
      bc.fillStyle = bg;
      bc.beginPath(); bc.arc(cx, cy, R * 1.6, 0, Math.PI * 2); bc.fill();
    },
    // the gill plate: bony operculum edge with a shadow behind it and a
    // pale rim, arced from crown to throat; grooved into the bump map
    gill(u = 0.16, k = 1) {
      const x = u * bodyW;
      const arc = (ctx2, dx, col, w) => {
        ctx2.strokeStyle = col;
        ctx2.lineWidth = w;
        ctx2.beginPath();
        ctx2.moveTo(x + dx + H2 * 0.10, H2 * 0.92);
        ctx2.quadraticCurveTo(x + dx - H2 * 0.16, H2 * 0.5, x + dx + H2 * 0.06, H2 * 0.08);
        ctx2.stroke();
      };
      arc(hc, H2 * 0.05, `rgba(14,18,22,${0.28 * k})`, Math.max(H2 * 0.07, 2)); // shadow behind
      arc(hc, 0, `rgba(16,22,26,${0.5 * k})`, Math.max(H2 * 0.028, 1.4));       // the edge
      arc(hc, -H2 * 0.02, `rgba(255,250,240,${0.28 * k})`, Math.max(H2 * 0.02, 1)); // bony rim light
      arc(bc, 0, 'rgba(50,50,50,0.75)', Math.max(H2 * 0.03, 1.5));
      arc(bc, -H2 * 0.02, 'rgba(220,220,220,0.6)', Math.max(H2 * 0.02, 1));
    },
    // the mouth: a lip seam wrapping the snout at the waterline of the jaw
    mouth(u = 0.045, v = 0.32, len = 0.05) {
      hc.strokeStyle = 'rgba(12,10,10,0.65)';
      hc.lineWidth = Math.max(H2 * 0.02, 1.2);
      hc.lineCap = 'round';
      hc.beginPath();
      hc.moveTo(bodyW * 0.004, v * H2 * 0.92);
      hc.quadraticCurveTo(bodyW * (u * 0.6), v * H2 * 1.06, bodyW * (u + len), v * H2 * 0.98);
      hc.stroke();
      hc.lineCap = 'butt';
      bc.strokeStyle = 'rgba(40,40,40,0.8)';
      bc.lineWidth = Math.max(H2 * 0.016, 1);
      bc.beginPath();
      bc.moveTo(bodyW * 0.004, v * H2 * 0.92);
      bc.quadraticCurveTo(bodyW * (u * 0.6), v * H2 * 1.06, bodyW * (u + len), v * H2 * 0.98);
      bc.stroke();
    },
  };
  painter(helpers);

  const finish = (h2, isBump) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(h2, 0, 0);
    ctx.save();
    ctx.translate(0, H);
    ctx.scale(1, -1);
    ctx.drawImage(h2, 0, 0);
    ctx.restore();

    // fin strip: membrane raked with tapering, slightly waving rays
    const fx = Math.floor(W * 0.84);
    if (!isBump) {
      ctx.fillStyle = finColor;
      ctx.fillRect(fx, 0, W - fx, H);
      // membrane gets thinner (darker shading) toward the outer edge
      const mg = ctx.createLinearGradient(fx, 0, W, 0);
      mg.addColorStop(0, 'rgba(20,26,30,0.18)');
      mg.addColorStop(0.25, 'rgba(20,26,30,0)');
      mg.addColorStop(1, 'rgba(20,26,30,0.1)');
      ctx.fillStyle = mg;
      ctx.fillRect(fx, 0, W - fx, H);
    } else {
      ctx.fillStyle = '#808080';
      ctx.fillRect(fx, 0, W - fx, H);
    }
    ctx.strokeStyle = isBump ? 'rgba(215,215,215,0.85)' : rayColor;
    for (let i = 0; i < 22; i++) {
      const y = (i / 21) * H;
      ctx.lineWidth = isBump ? 1.8 : 1.2 + (i % 3 === 0 ? 0.8 : 0);
      ctx.beginPath();
      ctx.moveTo(fx, y);
      ctx.quadraticCurveTo(fx + (W - fx) * 0.55, y + (i % 2 ? 4 : -4), W, y + (i % 2 ? 6 : -6));
      ctx.stroke();
    }
    return c;
  };

  const map = new THREE.CanvasTexture(finish(half, false));
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(finish(bhalf, true));
  bump.anisotropy = 2;
  return { map, bump };
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
// Instanced swim: aWig = (phase, amplitude, frequency) per fish. Physical
// shading: a wet clearcoat by default, optional iridescence for the silver
// schoolers, and the shared caustic light through the uw patch.
export function fishMaterial({
  map, bump, name, len, freq = 7, rough = 0.5, metal = 0.2,
  clearcoat = 0.45, irid = 0, bumpScale = 0.6,
  headAmp = 0.035, tailPow = 2.0, // stiff swimmers: low headAmp, high tailPow
}) {
  const mat = new THREE.MeshPhysicalMaterial({
    map, roughness: rough, metalness: metal,
    clearcoat, clearcoatRoughness: 0.4,
  });
  if (bump) {
    mat.bumpMap = bump;
    mat.bumpScale = bumpScale * len * 0.004;
  }
  if (irid > 0) {
    mat.iridescence = irid;
    mat.iridescenceIOR = 1.3;
    mat.iridescenceThicknessRange = [120, 480];
  }
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
        float fenv = ${headAmp.toFixed(4)} + pow(fu, ${tailPow.toFixed(2)}) * 0.16;
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
