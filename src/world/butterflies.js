// Butterflies for the daytime interior: one instanced mesh of two-quad
// wing pairs. The flap lives in the vertex shader (per-instance phase and
// rate, wings rotating about the body line); the wander lives on the CPU —
// each one loops around a home tuft, darting to a new anchor now and then.
// At dusk they settle into the grass and fade out as the fireflies wake.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, lagoonFreeboard } from './island.js';

const COUNT = 16;
const SPAN = 0.055; // one wing, metres

export function buildButterflies() {
  const group = new THREE.Group();
  group.name = 'butterflies';
  const rand = mulberry32(subSeed('butterflies'));

  // ---- wing-pair geometry: two trapezoid quads meeting at the body ----
  const pos = [], sid = [], uv = [], idx = [];
  const wing = (side) => {
    const base = pos.length / 3;
    // body-edge front, tip front, tip back, body-edge back
    const pts = [
      [0.004 * side, 0, -0.030],
      [SPAN * side, 0.004, -0.048],
      [SPAN * side, 0.004, 0.028],
      [0.004 * side, 0, 0.034],
    ];
    for (const p of pts) { pos.push(...p); sid.push(side); }
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  wing(1); wing(-1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(sid, 1));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // per-instance flap phase + rate jitter
  const phases = new Float32Array(COUNT), rates = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) { phases[i] = rand() * Math.PI * 2; rates[i] = rand() * 5; }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geo.setAttribute('aRate', new THREE.InstancedBufferAttribute(rates, 1));

  const mat = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
  });
  const flapUniform = { value: 1 }; // 1 flying, ~0 settled
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uFlapAmp = flapUniform;
    shader.vertexShader = `
      uniform float uTime;
      uniform float uFlapAmp;
      attribute float aSide;
      attribute float aPhase;
      attribute float aRate;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float flap = sin(uTime * (11.0 + aRate) + aPhase) * (0.05 + 0.95 * uFlapAmp) + 0.12;
        transformed.y += abs(transformed.x) * sin(flap);
        transformed.x *= cos(flap);
      }`
    );
  };
  mat.customProgramCacheKey = () => 'butterfly';

  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;
  group.add(mesh);

  // wing tints: sulphur yellows, oranges, a morpho blue — nothing white,
  // white vanishes against the sand
  const tints = [
    [1.0, 0.88, 0.30], [1.0, 0.62, 0.16], [0.45, 0.66, 1.0],
    [1.0, 0.94, 0.55], [0.95, 0.45, 0.28],
  ];

  // ---- the flies ----
  const flies = [];
  let guard = 0;
  while (flies.length < COUNT && guard++ < 2000) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * 22;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (islandHeight(x, z) < 2.3) continue;
    if (lagoonFreeboard(x, z) < 0.15) continue;
    const f = {
      ax: x, az: z,
      x, z, y: islandHeight(x, z) + 0.5,
      vx: 0, vz: 0, vy: 0,
      yaw: rand() * Math.PI * 2,
      retarget: 0,
      tx: x, tz: z,
      bobPh: rand() * Math.PI * 2,
    };
    flies.push(f);
    mesh.setColorAt(flies.length - 1, new THREE.Color(...tints[Math.floor(rand() * tints.length)]));
  }
  mesh.count = flies.length;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // stylized scale: real 5cm wings are invisible specks at walking distance
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
    _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(2.3, 2.3, 2.3);

  function update(t, dt) {
    const night = uniforms.uNightF.value;
    const storm = uniforms.uStorm.value;
    const grounded = night > 0.25 || storm > 0.5; // dusk or squall: settle
    const gone = night > 0.65;                    // full dark: slip away
    mat.opacity += ((gone ? 0 : 1) - mat.opacity) * Math.min(dt * 1.2, 1);
    flapUniform.value += ((grounded ? 0.06 : 1) - flapUniform.value) * Math.min(dt * 1.6, 1);
    if (mat.opacity < 0.02) { mesh.visible = false; return; }
    mesh.visible = true;

    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      f.retarget -= dt;
      if (f.retarget <= 0 && !grounded) {
        f.retarget = 1.6 + Math.random() * 3.4;
        // usually loop near home, sometimes drift to a new tuft
        if (Math.random() < 0.22) {
          f.ax += (Math.random() - 0.5) * 7;
          f.az += (Math.random() - 0.5) * 7;
          if (islandHeight(f.ax, f.az) < 2.3) { f.ax = f.x; f.az = f.z; }
        }
        f.tx = f.ax + (Math.random() - 0.5) * 2.4;
        f.tz = f.az + (Math.random() - 0.5) * 2.4;
      }
      const ground = islandHeight(f.x, f.z);
      const targetY = grounded
        ? ground + 0.05
        : ground + 0.45 + Math.sin(t * 1.7 + f.bobPh) * 0.22;
      const spd = grounded ? 0.3 : 0.85;
      const dx = f.tx - f.x, dz = f.tz - f.z;
      const d = Math.hypot(dx, dz) || 1;
      f.vx += ((dx / d) * spd - f.vx) * Math.min(dt * 2.2, 1);
      f.vz += ((dz / d) * spd - f.vz) * Math.min(dt * 2.2, 1);
      f.vy += ((targetY - f.y) * 1.6 - f.vy) * Math.min(dt * 3, 1);
      // flutter: butterflies never fly straight
      const flut = grounded ? 0 : 1;
      f.x += (f.vx + Math.sin(t * 6.3 + f.bobPh * 3.7) * 0.24 * flut) * dt;
      f.z += (f.vz + Math.cos(t * 5.1 + f.bobPh * 2.9) * 0.24 * flut) * dt;
      f.y += f.vy * dt;
      const sp = Math.hypot(f.vx, f.vz);
      if (sp > 0.05) {
        const targetYaw = Math.atan2(f.vx, f.vz);
        let dy = targetYaw - f.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        f.yaw += dy * Math.min(dt * 4, 1);
      }
      _e.set(0, f.yaw, Math.sin(t * 2.2 + f.bobPh) * 0.14 * flut);
      _q.setFromEuler(_e);
      _v.set(f.x, f.y, f.z);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { group, update, count: flies.length };
}
