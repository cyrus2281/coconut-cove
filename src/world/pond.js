// The interior lagoon's surface. Fresh water just sits there: no swash, no
// tide, no whitecaps — a still murky-green sheet that mirrors the sky, ripples
// on the wind, dimples in the rain, and fades out exactly where the basin
// floor rises through it. Depth is baked per vertex from the height function,
// so the waterline needs no guessing in the shader.

import * as THREE from 'three';
import { uniforms } from '../core/env.js';
import { islandHeight, lagoonInfo } from './island.js';
import { foamTexture } from '../core/textures.js';

const VERT = /* glsl */`
uniform float uRainWet;
attribute float aDepth;
varying float vDepth;
varying vec3 vWPos;
void main() {
  vDepth = aDepth;
  vec3 p = position;
  p.y += uRainWet * 0.05;              // the pond swells a little in a squall
  vWPos = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWPos, 1.0);
}
`;

const FRAG = /* glsl */`
uniform float uTime;
uniform float uSunI;
uniform float uNightF;
uniform float uStorm;
uniform float uRainWet;
uniform float uFogDensity;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform sampler2D uRipple;
varying float vDepth;
varying vec3 vWPos;

// summed slow scrolls of the noise texture, plus fast rain dimples. Keep the
// wavelengths short: broad slow blobs read as a dirty puddle, not still water.
float rip(vec2 p) {
  float a = texture2D(uRipple, p * 0.62 + vec2(uTime * 0.018, uTime * 0.012)).r;
  float b = texture2D(uRipple, p * 1.05 - vec2(uTime * 0.015, uTime * 0.022)).r;
  float d = texture2D(uRipple, p * 5.5 + vec2(uTime * 1.3, uTime * 1.6)).r;
  return a + b + d * uStorm * 1.1;
}

void main() {
  float depth = vDepth + uRainWet * 0.05;
  if (depth <= 0.004) discard;

  // ripple normal by finite differences on the summed noise
  float e = 0.4;
  float h0 = rip(vWPos.xz);
  float hx = rip(vWPos.xz + vec2(e, 0.0));
  float hz = rip(vWPos.xz + vec2(0.0, e));
  float amp = 0.05 * (1.0 + 2.6 * uStorm);
  vec3 N = normalize(vec3(-(hx - h0) * amp, e, -(hz - h0) * amp));

  vec3 V = normalize(cameraPosition - vWPos);
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - NdV, 5.0);

  vec3 R = reflect(-V, N);
  // lean toward the zenith: a pure horizon reflection is hazy grey and the
  // pond ends up looking like wet sand rather than water
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.32));

  // barely a metre deep, so the tint stays thin and the lit sand bed below
  // (wet, with its own caustics) carries most of the colour
  vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.85));
  body *= mix(0.78, 1.0, smoothstep(0.0, 0.32, depth));   // muddy shallows
  // drifting algae blush so the sheet isn't a flat colour
  body *= 0.9 + 0.22 * texture2D(uRipple, vWPos.xz * 0.06 + uTime * 0.002).r;
  body *= mix(1.0, 0.26, uNightF);

  float spec = pow(max(dot(R, normalize(uSunDir)), 0.0), 150.0) * uSunI;
  vec3 col = mix(body, sky, fres * 0.85) + uSunColor * spec * 0.65;

  // a soft alpha ramp hides the 1 m terrain facets under the waterline
  float alpha = clamp(0.36 + fres * 0.5 + depth * 0.3, 0.0, 0.93)
    * smoothstep(0.0, 0.16, depth);

  float fd = length(cameraPosition - vWPos) * uFogDensity;
  float fog = clamp(1.0 - exp2(-fd * fd * 1.442695), 0.0, 1.0);
  col = mix(col, uFogColor, fog);

  gl_FragColor = vec4(col, alpha);
}
`;

export function buildPond() {
  const group = new THREE.Group();
  group.name = 'pond';
  const L = lagoonInfo();
  if (!L) return { group, material: null };

  // concentric rings, denser toward the rim where the waterline lives
  const RINGS = 30, SEGS = 84;
  const pos = [], depth = [], idx = [];
  for (let i = 0; i <= RINGS; i++) {
    const rr = L.rOuter * Math.pow(i / RINGS, 0.85);
    for (let j = 0; j <= SEGS; j++) {
      const a = (j / SEGS) * Math.PI * 2;
      const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      pos.push(x, L.level, z);
      depth.push(L.level - islandHeight(x, z));
    }
  }
  // wind for +Y: (inner j, inner j+1, outer j) — the mirror of this order once
  // made the whole ocean disk invisible to backface culling
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGS; j++) {
      const a = i * (SEGS + 1) + j, b = a + SEGS + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const ripple = foamTexture();
  ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: uniforms.uTime,
      uSunI: uniforms.uSunI,
      uNightF: uniforms.uNightF,
      uStorm: uniforms.uStorm,
      uRainWet: uniforms.uRainWet,
      uFogDensity: uniforms.uFogDensity,
      uSunDir: uniforms.uSunDir,
      uSunColor: uniforms.uSunColor,
      uFogColor: uniforms.uFogColor,
      uSkyZenith: { value: new THREE.Color(0.16, 0.36, 0.72) },
      uSkyHorizon: { value: new THREE.Color(0.42, 0.60, 0.82) },
      uShallow: { value: new THREE.Color(0.30, 0.44, 0.31) },
      uDeep: { value: new THREE.Color(0.07, 0.23, 0.19) },
      uRipple: { value: ripple },
    },
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'pondSurface';
  mesh.renderOrder = 1;
  group.add(mesh);
  return { group, material };
}
