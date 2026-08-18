// The stingray as an asset: a lofted wing disc with a whip tail and eye
// bumps, a reticulated sand-colored skin, and the instanced material whose
// vertex shader ripples the wings root to tip. sealife.js drives the
// glide/settle brain.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { uwAttach, UW_WPOS_VERT, UW_FRAG_DECL, UW_CAUSTIC_FRAG } from '../world/underwater.js';

export function rayGeometry() {
  const L = 1.0, S = 1.6;
  const NX = 18, NZ = 16;
  const pos = [], uv = [], idx = [];
  for (let ix = 0; ix <= NX; ix++) {
    const u = ix / NX;
    const x = (u - 0.42) * L;
    const wing = Math.pow(Math.sin(Math.PI * THREE.MathUtils.clamp(u, 0.02, 0.98)), 0.72);
    for (let iz = 0; iz <= NZ; iz++) {
      const w = (iz / NZ) * 2 - 1;
      const z = w * (S / 2) * wing;
      const dome = 0.105 * Math.pow(1 - Math.abs(w), 1.35)
        * Math.pow(Math.max(Math.sin(Math.PI * u), 0), 0.7);
      pos.push(x, dome - Math.pow(Math.abs(w), 3) * 0.015, z);
      uv.push(0.04 + u * 0.92, iz / NZ);
    }
  }
  const stride = NZ + 1;
  for (let ix = 0; ix < NX; ix++) {
    for (let iz = 0; iz < NZ; iz++) {
      const a = ix * stride + iz, b = a + 1, c = a + stride, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  let disc = new THREE.BufferGeometry();
  disc.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  disc.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  disc.setIndex(idx);
  disc.computeVertexNormals();

  // whip tail: a narrow tapering strip trailing off the back
  const tp = [], tuv = [], tidx = [];
  const TN = 7;
  for (let i = 0; i <= TN; i++) {
    const k = i / TN;
    const x = -0.42 * L - k * 0.95;
    const hw = 0.024 * (1 - k * 0.85);
    tp.push(x, 0.012 - k * 0.03, -hw, x, 0.012 - k * 0.03, hw);
    tuv.push(0.01, 0.48, 0.01, 0.52);
  }
  for (let i = 0; i < TN; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    tidx.push(a, b, c, b, d, c);
  }
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  tail.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  tail.setIndex(tidx);
  tail.computeVertexNormals();

  // eye bumps on the crown
  const eyes = [];
  for (const m of [1, -1]) {
    const e = new THREE.SphereGeometry(0.02, 6, 5);
    e.translate(0.13, 0.075, m * 0.1);
    eyes.push(e);
  }
  const geo = mergeGeometries([disc, tail, ...eyes]);
  geo.computeBoundingSphere();
  return geo;
}

// the bluespotted ribbontail's dress: olive-sand disc, electric blue
// drops ringed in ink, a fine speckle field, and pale disc margins
function rayTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rand = mulberry32(662);
  // olive base, warmer toward the crown (mid v)
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#8a8058');
  g.addColorStop(0.5, '#9c9066');
  g.addColorStop(1, '#8a8058');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // fine dark speckle field
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(52,46,28,${0.08 + rand() * 0.12})`;
    ctx.fillRect(rand() * S, rand() * S, 1.6, 1.6);
  }
  // mottle patches
  for (let i = 0; i < 40; i++) {
    const x = rand() * S, y = rand() * S, r = 8 + rand() * 22;
    const m = ctx.createRadialGradient(x, y, 0, x, y, r);
    m.addColorStop(0, 'rgba(70,62,38,0.14)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = m;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // the blue drops: bright cores with dark halos, denser mid-disc
  for (let i = 0; i < 90; i++) {
    const x = S * (0.12 + rand() * 0.8);
    const y = S * (0.1 + rand() * 0.8);
    const r = 4 + rand() * 7;
    ctx.fillStyle = 'rgba(24,32,30,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    const bg = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r);
    bg.addColorStop(0, '#9be8ff');
    bg.addColorStop(0.55, '#3fb8e8');
    bg.addColorStop(1, '#1878b8');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // spiracles: dark crescents tucked behind the eye bumps (the geometry
  // puts the eyes near u 0.55, v 0.44 and 0.56)
  for (const vy of [0.415, 0.585]) {
    ctx.strokeStyle = 'rgba(20,18,10,0.85)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(S * 0.525, S * vy, 13, -0.7, 0.9);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  // pale disc rim (v edges) and the banded ribbon tail (u ≈ 0)
  const rim = ctx.createLinearGradient(0, 0, 0, S);
  rim.addColorStop(0, 'rgba(222,214,182,0.8)');
  rim.addColorStop(0.06, 'rgba(222,214,182,0)');
  rim.addColorStop(0.94, 'rgba(222,214,182,0)');
  rim.addColorStop(1, 'rgba(222,214,182,0.8)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, S, S);
  // tail: blue side-stripes over olive
  ctx.fillStyle = '#6a6244';
  ctx.fillRect(0, 0, 18, S);
  ctx.fillStyle = 'rgba(60,170,220,0.9)';
  ctx.fillRect(4, 0, 4, S);
  ctx.fillRect(12, 0, 4, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function rayMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    map: rayTexture(), roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide,
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
        float span = min(abs(transformed.z) / 0.8, 1.0);
        float ph = uTime * 2.1 * aWig.z + aWig.x;
        // wings ripple root→tip; the tail traces the wake
        transformed.y += sin(ph - span * 2.8) * pow(span, 1.6) * 0.22 * aWig.y;
        if (transformed.x < -0.44) {
          float tk = -(transformed.x + 0.44);
          transformed.z += sin(ph * 0.9 + tk * 3.0) * 0.07 * tk * aWig.y;
        }
      }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      ${UW_WPOS_VERT}`);
    shader.fragmentShader = UW_FRAG_DECL + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${UW_CAUSTIC_FRAG}`);
  };
  mat.customProgramCacheKey = () => 'uw-ray';
  return mat;
}
