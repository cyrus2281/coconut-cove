// The butterfly as an asset: an instanced wing-pair geometry (two quads
// meeting at the hinge, painted roots reading as the body) and the flap
// material whose vertex shader blends a flight flap with the folded
// perch pose per instance. butterflies.js owns the wander/perch brain.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uniforms } from '../core/env.js';
import { butterflyWingTexture } from '../core/textures.js';

export const BUTTERFLY_SPAN = 0.055; // one wing, metres

// wing tints: sulphur yellows, oranges, a morpho blue — nothing white,
// white vanishes against the sand
export const BUTTERFLY_TINTS = [
  [1.0, 0.88, 0.30], [1.0, 0.62, 0.16], [0.45, 0.66, 1.0],
  [1.0, 0.94, 0.55], [0.95, 0.45, 0.28],
];

export function buildButterflyWings(count, rand) {
  const SPAN = BUTTERFLY_SPAN;
  // ---- wing-pair geometry: two trapezoid quads meeting in the middle ----
  const pos = [], uv = [], idx = [];
  const wing = (side) => {
    const base = pos.length / 3;
    // centerline front, tip front, tip back, centerline back — both wings
    // share the x=0 hinge, so their painted roots meet with no gap
    const pts = [
      [0, 0, -0.030],
      [SPAN * side, 0.004, -0.048],
      [SPAN * side, 0.004, 0.028],
      [0, 0, 0.034],
    ];
    for (const p of pts) pos.push(...p);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  wing(1); wing(-1);

  const wingsGeo = new THREE.BufferGeometry();
  wingsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wingsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  wingsGeo.setIndex(idx);
  wingsGeo.computeVertexNormals();

  // the body: a slim capsule on the hinge line, its UVs parked in the
  // dark wing-root corner of the texture so it shades as the thorax
  const body = new THREE.CapsuleGeometry(0.0026, 0.03, 3, 8);
  body.scale(1, 1, 1.15);
  body.rotateX(Math.PI / 2);
  body.translate(0, -0.0035, -0.004);
  const bUv = body.attributes.uv;
  for (let i = 0; i < bUv.count; i++) bUv.setXY(i, 0.04, 0.5);
  const geo = mergeGeometries([wingsGeo.toNonIndexed(), body.toNonIndexed()]);

  // per-instance flap phase + rate jitter + rest-fold (eased on the CPU)
  const phases = new Float32Array(count), rates = new Float32Array(count);
  const rests = new Float32Array(count);
  for (let i = 0; i < count; i++) { phases[i] = rand() * Math.PI * 2; rates[i] = rand() * 5; }
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
        // the hindwing trails the beat a little, so the pair twists alive
        float hind = 1.0 - 0.16 * smoothstep(0.0, 0.03, transformed.z) * (1.0 - aRest);
        transformed.y += abs(transformed.x) * sin(flap * hind);
        transformed.x *= cos(flap * hind);
      }`
    );
  };
  mat.customProgramCacheKey = () => 'butterfly-v4';

  return { geo, mat, rests, restAttr, flapUniform };
}
