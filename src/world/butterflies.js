// Butterflies for the daytime interior: one instanced mesh of two-quad
// wing pairs plus a little crossed-quad body. The flap lives in the vertex
// shader (per-instance phase, rate and rest-fold); the wander lives on the
// CPU — each one loops around a home tuft, darting to a new anchor now and
// then, and sometimes dropping onto the grass to perch with folded wings
// (walk up and it startles back into the air). At dusk they settle and
// fade out as the fireflies wake.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, lagoonFreeboard } from './island.js';
import { butterflyWingTexture } from '../core/textures.js';

const COUNT = 6; // a few is plenty — a swarm reads as gnats, not butterflies
const SPAN = 0.055; // one wing, metres

export function buildButterflies(player) {
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

  // body: two crossed slivers along the wing hinge, sampling the dark
  // strip at the texture's left edge. aSide 0 keeps them out of the flap.
  const bodyQuad = (corners) => {
    const base = pos.length / 3;
    for (const p of corners) { pos.push(...p); sid.push(0); }
    uv.push(0.012, 0.1, 0.012, 0.9, 0.038, 0.9, 0.038, 0.1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  bodyQuad([ // vertical fin: head bump to tapered abdomen
    [0, 0.009, -0.052], [0, 0.009, 0.046],
    [0, -0.015, 0.046], [0, -0.015, -0.052],
  ]);
  bodyQuad([ // horizontal sliver for the top-down view
    [-0.007, -0.003, -0.052], [0.007, -0.003, -0.052],
    [0.007, -0.003, 0.046], [-0.007, -0.003, 0.046],
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(sid, 1));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // per-instance flap phase + rate jitter + rest-fold (eased on the CPU)
  const phases = new Float32Array(COUNT), rates = new Float32Array(COUNT);
  const rests = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) { phases[i] = rand() * Math.PI * 2; rates[i] = rand() * 5; }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geo.setAttribute('aRate', new THREE.InstancedBufferAttribute(rates, 1));
  const restAttr = new THREE.InstancedBufferAttribute(rests, 1);
  restAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aRest', restAttr);

  const mat = new THREE.MeshBasicMaterial({
    map: butterflyWingTexture(),
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.08,   // clip the scalloped edge out of the quad
    depthWrite: false, // so the clear corners never punch holes in water
    opacity: 1,
  });
  const flapUniform = { value: 1 }; // 1 flying, ~0 settled (dusk / squall)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uFlapAmp = flapUniform;
    shader.vertexShader = `
      uniform float uTime;
      uniform float uFlapAmp;
      attribute float aSide;
      attribute float aPhase;
      attribute float aRate;
      attribute float aRest;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        // two continuous oscillators blended by aRest: full flight flap,
        // and the folded-wings-up pose with a slow fan while perched
        float fly = sin(uTime * (11.0 + aRate) + aPhase) * (0.05 + 0.95 * uFlapAmp) + 0.12;
        float perch = 1.22 + sin(uTime * 2.1 + aPhase) * 0.26;
        float flap = mix(fly, perch, aRest);
        transformed.y += abs(transformed.x) * sin(flap);
        transformed.x *= cos(flap);
      }`
    );
  };
  mat.customProgramCacheKey = () => 'butterfly-v2';

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
      scale: 1.9 + rand() * 0.9, // stylized size, with real variety
      mode: 'fly',               // fly | land | perch
      modeT: 0,
      rest: 0,                   // eased 0..1 wing fold
    };
    flies.push(f);
    mesh.setColorAt(flies.length - 1, new THREE.Color(...tints[Math.floor(rand() * tints.length)]));
  }
  mesh.count = flies.length;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
    _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

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
      if (f.retarget <= 0 && !grounded && f.mode === 'fly') {
        f.retarget = 1.6 + Math.random() * 3.4;
        if (Math.random() < 0.18) {
          // drop onto the grass for a rest
          f.mode = 'land';
          f.tx = f.x + (Math.random() - 0.5) * 1.5;
          f.tz = f.z + (Math.random() - 0.5) * 1.5;
        } else {
          // usually loop near home, sometimes drift to a new tuft
          if (Math.random() < 0.22) {
            f.ax += (Math.random() - 0.5) * 7;
            f.az += (Math.random() - 0.5) * 7;
            if (islandHeight(f.ax, f.az) < 2.3) { f.ax = f.x; f.az = f.z; }
          }
          f.tx = f.ax + (Math.random() - 0.5) * 2.4;
          f.tz = f.az + (Math.random() - 0.5) * 2.4;
        }
      }

      const ground = islandHeight(f.x, f.z);
      const perching = f.mode === 'perch';
      const landing = f.mode === 'land';

      // walking up to a perched one startles it back into the air
      const pd = player ? Math.hypot(f.x - player.pos.x, f.z - player.pos.z) : 99;
      if (perching && pd < 1.7) {
        f.mode = 'fly';
        f.retarget = 0;
        f.vy = 0.9; // burst upward
      } else if (landing && Math.hypot(f.tx - f.x, f.tz - f.z) < 0.22
          && f.y - ground < 0.14) {
        f.mode = 'perch';
        f.modeT = 1.4 + Math.random() * 2.8;
      } else if (perching) {
        f.modeT -= dt;
        if (f.modeT <= 0) { f.mode = 'fly'; f.retarget = 0; }
      }

      const targetY = grounded || perching || landing
        ? ground + 0.04
        : ground + 0.45 + Math.sin(t * 1.7 + f.bobPh) * 0.22;
      const spd = grounded || perching ? 0 : landing ? 0.5 : 0.85;
      const dx = f.tx - f.x, dz = f.tz - f.z;
      const d = Math.hypot(dx, dz) || 1;
      f.vx += ((dx / d) * spd - f.vx) * Math.min(dt * 2.2, 1);
      f.vz += ((dz / d) * spd - f.vz) * Math.min(dt * 2.2, 1);
      f.vy += ((targetY - f.y) * 1.6 - f.vy) * Math.min(dt * 3, 1);
      // flutter: butterflies never fly straight
      const flut = grounded || perching || landing ? 0 : 1;
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

      // ease the wing fold in the instanced attribute
      f.rest += ((perching ? 1 : 0) - f.rest) * Math.min(dt * 5, 1);
      rests[i] = f.rest;

      _e.set(0, f.yaw, Math.sin(t * 2.2 + f.bobPh) * 0.14 * flut);
      _q.setFromEuler(_e);
      _v.set(f.x, f.y, f.z);
      _s.setScalar(f.scale);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    restAttr.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { group, update, count: flies.length };
}
