// Footprint decals: a ring buffer of instanced quads stamped by the player's
// stride. No per-frame CPU work — each instance carries its stamp time and
// terrain height, and the shader derives everything else analytically:
//   - gradual fading over ~90s (much faster right at the waterline),
//   - erasure by surge waves: sw_nextCover() says when a wave will next roll
//     over the print after it was stamped; once that moment passes, the print
//     dissolves as if washed out.

import * as THREE from 'three';
import { uniforms } from '../core/env.js';
import { swashUniforms, SWASH_GLSL } from './swash.js';
import { footprintTextures } from '../core/textures.js';
import { islandNormal } from './island.js';

const MAX_PRINTS = 512;
const LIFE_SECONDS = 90;

const VERT = /* glsl */ `
// (instanceMatrix is declared automatically for InstancedMesh)
attribute float aStamp;
attribute float aH;
attribute float aSide;

uniform float uTime;
uniform float uLife;
uniform vec4 uZone1;
uniform float uZone1Ph;
uniform vec4 uZone2;
uniform float uZone2Ph;
uniform vec2 uAmbient;

${SWASH_GLSL}

varying vec2 vUv;
varying float vFade;
varying vec4 vRotF; // instance right.xz, forward.xz (for normal mapping)

void main() {
  vUv = vec2(mix(uv.x, 1.0 - uv.x, aSide), uv.y);

  vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float az = atan(ip.z, ip.x);
  float H1 = uZone1.z * sw_angFall(az, uZone1.x, uZone1.y);
  float H2 = uZone2.z * sw_angFall(az, uZone2.x, uZone2.y);

  // when does the next wave roll over this spot after the stamp?
  float nc = sw_nextCover(aStamp, aH, H1, uZone1.w, uZone1Ph);
  nc = min(nc, sw_nextCover(aStamp, aH, H2, uZone2.w, uZone2Ph));
  nc = min(nc, sw_nextCover(aStamp, aH, uAmbient.x, uAmbient.y, 0.0));
  float wash = 1.0 - smoothstep(0.0, 1.6, uTime - nc);

  // gradual ageing; prints in the saturated fringe melt quickly
  float age = max(uTime - aStamp, 0.0);
  float life = uLife * (aH < 0.24 ? 0.15 : 1.0);
  float fade = 1.0 - smoothstep(life * 0.5, life, age);

  vFade = fade * wash;

  vRotF = vec4(
    normalize(vec2(instanceMatrix[0].x, instanceMatrix[0].z)),
    normalize(vec2(instanceMatrix[2].x, instanceMatrix[2].z))
  );

  gl_Position = projectionMatrix * modelViewMatrix * (instanceMatrix * vec4(position, 1.0));
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform sampler2D uNrm;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunI;

varying vec2 vUv;
varying float vFade;
varying vec4 vRotF;

void main() {
  if (vFade < 0.004) discard;
  vec4 mk = texture2D(uMask, vUv);
  float sole = mk.r;              // pressed-in sole
  float presence = mk.g;          // sole + displaced rim
  if (presence * vFade < 0.01) discard;

  // tangent-space normal rotated by the instance heading (ground plane)
  vec3 tn = texture2D(uNrm, vUv).rgb * 2.0 - 1.0;
  vec2 r = vRotF.xy;
  vec2 f = vRotF.zw;
  vec3 N = normalize(vec3(
    tn.x * r.x + tn.y * f.x,
    tn.z * 1.1,
    tn.x * r.y + tn.y * f.y
  ));

  float ndl = max(dot(N, uSunDir), 0.0);
  // compressed, slightly damp sand inside the print
  vec3 base = vec3(0.44, 0.385, 0.315);
  vec3 col = base * (0.35 + 1.05 * ndl) * mix(vec3(1.0), uSunColor, 0.55) * max(uSunI, 0.12);

  // sole darkens fully; the rim mostly just catches the relit normal
  float alpha = (sole * 0.72 + (presence - sole) * 0.38) * vFade;
  gl_FragColor = vec4(col, alpha);
}
`;

export function buildFootprints() {
  const geo = new THREE.PlaneGeometry(0.3, 0.3);
  geo.rotateX(-Math.PI / 2);

  const stamps = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS).fill(-1e6), 1);
  const heights = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS), 1);
  const sides = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS), 1);
  geo.setAttribute('aStamp', stamps);
  geo.setAttribute('aH', heights);
  geo.setAttribute('aSide', sides);

  const { mask, normal } = footprintTextures();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    uniforms: {
      uTime: uniforms.uTime,
      uSunDir: uniforms.uSunDir,
      uSunColor: uniforms.uSunColor,
      uSunI: uniforms.uSunI,
      uLife: { value: LIFE_SECONDS },
      uMask: { value: mask },
      uNrm: { value: normal },
      ...swashUniforms,
    },
  });

  const mesh = new THREE.InstancedMesh(geo, mat, MAX_PRINTS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1; // above sand, below the water surface
  mesh.name = 'footprints';

  // zero-scale unused slots so they never rasterize
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_PRINTS; i++) mesh.setMatrixAt(i, zero);
  mesh.instanceMatrix.needsUpdate = true;

  let cursor = 0;
  const m = new THREE.Matrix4();
  const right = new THREE.Vector3(), fwd = new THREE.Vector3();

  function stamp(x, z, h, dirX, dirZ, side) {
    const up = islandNormal(x, z);
    fwd.set(dirX, 0, dirZ).addScaledVector(up, -(dirX * up.x + dirZ * up.z)).normalize();
    right.crossVectors(up, fwd).normalize();
    m.makeBasis(right, up, fwd);
    m.setPosition(x, h + 0.013, z);
    mesh.setMatrixAt(cursor, m);
    stamps.setX(cursor, uniforms.uTime.value);
    heights.setX(cursor, h);
    sides.setX(cursor, side);
    mesh.instanceMatrix.needsUpdate = true;
    stamps.needsUpdate = true;
    heights.needsUpdate = true;
    sides.needsUpdate = true;
    cursor = (cursor + 1) % MAX_PRINTS;
  }

  return { mesh, stamp };
}
