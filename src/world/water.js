// Ocean surface: concentric high-detail disk around the island plus a far
// ring out to the horizon, one custom shader. Gerstner swell displaces the
// vertices; the fragment stage does depth-based color/transparency, shoreline
// foam fronts, whitecaps, sun glitter and an analytic sky reflection.

import * as THREE from 'three';
import { uniforms } from '../core/env.js';
import { swashUniforms, SWASH_GLSL } from './swash.js';
import { HMAP_HALF } from './island.js';
import { waterNormalTexture, foamTexture } from '../core/textures.js';

// Concentric grid: dense rings near the island, sparser further out.
function buildDiskGeometry() {
  const THETA = 360;
  const radii = [0.5];
  let r = 0.5;
  while (r < 100) { r += 1.15; radii.push(r); }
  while (r < 152) { r += 2.6; radii.push(r); }
  while (r < 232) { r += 5.5; radii.push(r); }

  const rings = radii.length;
  const verts = new Float32Array(rings * (THETA + 1) * 3);
  let vi = 0;
  for (let ri = 0; ri < rings; ri++) {
    for (let ti = 0; ti <= THETA; ti++) {
      const a = (ti / THETA) * Math.PI * 2;
      verts[vi++] = Math.cos(a) * radii[ri];
      verts[vi++] = 0;
      verts[vi++] = Math.sin(a) * radii[ri];
    }
  }
  const idx = [];
  const stride = THETA + 1;
  for (let ri = 0; ri < rings - 1; ri++) {
    for (let ti = 0; ti < THETA; ti++) {
      const a = ri * stride + ti;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // wound to face +Y (x=cos/z=sin sweeps clockwise seen from above)
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.userData.outerRadius = radii[radii.length - 1];
  return geo;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform sampler2D uHeight;
uniform float uHmapHalf;
uniform vec4 uZone1;
uniform float uZone1Ph;
uniform vec4 uZone2;
uniform float uZone2Ph;

${SWASH_GLSL}

varying vec3 vWPos;
varying vec3 vNormalGeo;
varying float vWaveH;

float terrainH(vec2 p) {
  if (abs(p.x) > uHmapHalf - 2.0 || abs(p.y) > uHmapHalf - 2.0) return -14.0;
  return texture2D(uHeight, p / (2.0 * uHmapHalf) + 0.5).r;
}

// direction (xy), amplitude, wavelength
const vec4 W0 = vec4(1.0, 0.25, 0.25, 33.0);
const vec4 W1 = vec4(0.72, 0.62, 0.14, 17.0);
const vec4 W2 = vec4(-0.28, 0.94, 0.08, 8.5);
const vec4 W3 = vec4(0.55, -0.80, 0.045, 4.7);
const float STEEP = 0.62;

void gerstner(vec4 w, vec2 p, float t, float ampScale, inout vec3 disp, inout vec3 nrm) {
  vec2 dir = normalize(w.xy);
  float amp = w.z * ampScale;
  float k = 6.28318 / w.w;
  float c = sqrt(9.8 / k); // deep-water dispersion
  float f = k * (dot(dir, p) - c * t);
  float q = STEEP / (k * amp * 4.0 + 1.0);
  float ca = cos(f), sa = sin(f);
  disp.x += q * amp * dir.x * ca;
  disp.z += q * amp * dir.y * ca;
  disp.y += amp * sa;
  nrm.x -= dir.x * k * amp * ca;
  nrm.z -= dir.y * k * amp * ca;
  nrm.y -= q * k * amp * sa;
}

void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float hTerr = terrainH(wp.xz);
  float depth0 = -hTerr;

  // waves flatten as the water shallows, and fade out before the mesh
  // becomes too sparse to resolve them (the far ring stays flat)
  float shallow = clamp(depth0 / 1.8, 0.1, 1.0);
  float distFade = 1.0 - smoothstep(150.0, 220.0, length(wp.xz));
  float ampScale = shallow * distFade;

  vec3 disp = vec3(0.0);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  gerstner(W0, wp.xz, uTime, ampScale, disp, nrm);
  gerstner(W1, wp.xz, uTime, ampScale, disp, nrm);
  gerstner(W2, wp.xz, uTime, ampScale, disp, nrm);
  gerstner(W3, wp.xz, uTime, ampScale * 0.8, disp, nrm);

  wp += disp;

  // surge zones: long-period swash bores lift the nearshore surface, driving
  // the waterline a few feet up the beach and back
  float az = atan(wp.z, wp.x);
  float H1 = uZone1.z * sw_angFall(az, uZone1.x, uZone1.y);
  float H2 = uZone2.z * sw_angFall(az, uZone2.x, uZone2.y);
  float lift = H1 * sw_shape(fract((uTime - uZone1Ph) / uZone1.w))
             + H2 * sw_shape(fract((uTime - uZone2Ph) / uZone2.w));
  wp.y += lift * (1.0 - smoothstep(0.4, 2.2, depth0));

  vWPos = wp;
  vNormalGeo = normalize(nrm);
  vWaveH = disp.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform sampler2D uHeight;
uniform float uHmapHalf;
uniform sampler2D uNormalTex;
uniform sampler2D uFoamTex;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uNightF;
uniform int uDebug;
uniform vec4 uZone1;
uniform float uZone1Ph;
uniform vec4 uZone2;
uniform float uZone2Ph;

${SWASH_GLSL}

varying vec3 vWPos;
varying vec3 vNormalGeo;
varying float vWaveH;

float terrainH(vec2 p) {
  if (abs(p.x) > uHmapHalf - 2.0 || abs(p.y) > uHmapHalf - 2.0) return -14.0;
  return texture2D(uHeight, p / (2.0 * uHmapHalf) + 0.5).r;
}

vec3 sampleDetailNormal(vec2 p) {
  vec3 n1 = texture2D(uNormalTex, p * 0.13 + uTime * vec2(0.021, 0.013)).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalTex, p * 0.041 - uTime * vec2(0.011, 0.017)).rgb * 2.0 - 1.0;
  vec3 n3 = texture2D(uNormalTex, p * 0.35 + uTime * vec2(-0.04, 0.05)).rgb * 2.0 - 1.0;
  return normalize(vec3(n1.xy + n2.xy * 1.4 + n3.xy * 0.5, n1.z * 3.0));
}

vec3 skyColor(vec3 rd) {
  float t = clamp(rd.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(t, 0.42));
  float s = max(dot(rd, uSunDir), 0.0);
  c += uSunColor * (pow(s, 800.0) * 10.0 + pow(s, 10.0) * 0.07);
  return c;
}

void main() {
  float hTerr = terrainH(vWPos.xz);
  float depth = max(vWPos.y - hTerr, 0.0);

  vec3 V = normalize(cameraPosition - vWPos);
  float viewDist = length(cameraPosition - vWPos);
  float detailFade = 1.0 - smoothstep(60.0, 700.0, viewDist);

  // normal: geometric swell + scrolling ripple detail (tangent ~ world axes on a
  // plane). Both flatten with distance so the horizon reads as a calm gradient
  // instead of high-contrast reflection banding.
  float geoFade = 1.0 - 0.85 * smoothstep(180.0, 500.0, viewDist);
  vec3 dn = sampleDetailNormal(vWPos.xz);
  vec3 N = normalize(vec3(
    vNormalGeo.x * geoFade + dn.x * (0.30 * detailFade + 0.045),
    1.0,
    vNormalGeo.z * geoFade + dn.y * (0.30 * detailFade + 0.045)
  ));

  float NdV = max(dot(N, V), 0.0);
  float fresnel = 0.021 + 0.979 * pow(1.0 - NdV, 5.0);
  // let the lagoon's own color win over sky reflection in the shallows
  fresnel *= mix(0.5, 1.0, smoothstep(0.4, 6.0, depth));

  // opacity from the view path through the column; hue from vertical depth
  // (scattered light climbs back up, so a lagoon stays turquoise even at
  // grazing angles — only true deep water goes navy)
  float pathLen = depth / max(abs(V.y), 0.12);
  float absorb = 1.0 - exp(-pathLen * 0.34);
  vec3 body = mix(uShallowColor, uDeepColor, 1.0 - exp(-depth * 0.30));
  body *= 0.45 + 0.55 * max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0);

  // sun-through-the-wave scatter when looking toward the light
  float scatter = pow(max(dot(V, -uSunDir + vec3(0.0, 0.35, 0.0)), 0.0), 3.0)
    * clamp(vWaveH * 1.6 + 0.4, 0.0, 1.0)
    * (1.0 - smoothstep(4.0, 14.0, depth));
  body += vec3(0.02, 0.36, 0.32) * scatter * 0.7;

  // reflection
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.02);
  vec3 refl = skyColor(R) * 0.88;

  // sun glitter: tight spec that broadens with distance, then hands the
  // far field over to the sky-reflection sun glow (kills shimmer aliasing)
  vec3 H = normalize(uSunDir + V);
  float specFar = smoothstep(30.0, 400.0, viewDist);
  float specPow = mix(760.0, 120.0, specFar);
  float spec = pow(max(dot(N, H), 0.0), specPow) * mix(3.4, 0.8, specFar);
  spec += pow(max(dot(N, H), 0.0), 48.0) * 0.08;
  spec *= 1.0 - smoothstep(300.0, 900.0, viewDist);

  // ---- foam ----
  float m = texture2D(uFoamTex, vWPos.xz * 0.115 + vec2(uTime * 0.012, 0.0)).r;
  float m2 = texture2D(uFoamTex, vWPos.xz * 0.045 - vec2(0.0, uTime * 0.009)).r;
  float mottle = m * 0.65 + m2 * 0.35;

  // frothy collar right at the sand line
  float edge = 1.0 - smoothstep(0.02, 0.34, depth);
  float edgeFoam = edge * smoothstep(0.34, 0.66, mottle + edge * 0.22);

  // discrete wave fronts rolling in over the shallows
  float ph = fract(depth * 0.42 - uTime * 0.1 + m2 * 0.18);
  float front = smoothstep(0.80, 0.90, ph) * (1.0 - smoothstep(0.94, 1.0, ph));
  float frontFoam = front * (1.0 - smoothstep(0.3, 3.0, depth)) * smoothstep(0.42, 0.75, mottle);

  // rare whitecaps on open-water crests (not in the far fade-out zone)
  float cap = smoothstep(0.5, 0.68, vWaveH) * smoothstep(0.8, 0.97, m) * 0.22
    * smoothstep(2.0, 5.0, depth) * (1.0 - smoothstep(110.0, 190.0, viewDist));

  // churning white bore front while a surge rushes up the beach
  float azF = atan(vWPos.z, vWPos.x);
  float H1f = uZone1.z * sw_angFall(azF, uZone1.x, uZone1.y);
  float H2f = uZone2.z * sw_angFall(azF, uZone2.x, uZone2.y);
  float bore =
      (H1f / max(uZone1.z, 1e-3)) * clamp(sw_riseVel(fract((uTime - uZone1Ph) / uZone1.w)) * 0.5, 0.0, 1.5)
    + (H2f / max(uZone2.z, 1e-3)) * clamp(sw_riseVel(fract((uTime - uZone2Ph) / uZone2.w)) * 0.5, 0.0, 1.5);
  float boreFoam = bore * (1.0 - smoothstep(0.12, 0.9, depth)) * smoothstep(0.28, 0.6, mottle);

  float foam = clamp(edgeFoam + frontFoam * 0.85 + cap + boreFoam * 0.85, 0.0, 1.0);
  vec3 foamCol = vec3(0.92, 0.95, 0.96) * (0.55 + 0.45 * max(dot(vec3(0, 1, 0), uSunDir), 0.0));

  // ---- compose ----
  vec3 col = mix(body, refl, fresnel) + uSunColor * spec;
  col = mix(col, foamCol, foam * 0.92);

  // bioluminescent plankton: churned water glows electric blue-green at night.
  // Agitation ~ how hard the water is breaking, so the bore front blazes,
  // rolling fronts trace arcs and whitecaps twinkle far out.
  float agit = clamp(edgeFoam * 0.7 + frontFoam + boreFoam * 1.5 + cap * 2.2, 0.0, 1.15);
  col += vec3(0.10, 1.45, 1.20) * pow(agit, 1.5)
    * (0.30 + 0.70 * smoothstep(0.35, 0.85, m)) * uNightF;

  float alpha = clamp(0.16 + absorb * 0.9 + fresnel * 0.8, 0.0, 1.0);
  alpha = max(alpha, foam * 0.95);
  alpha = max(alpha, min(agit, 1.0) * uNightF * 0.85);
  // ragged, noise-broken feather at the exact waterline
  alpha *= smoothstep(0.0, 0.035 + mottle * 0.05, depth);

  // manual exp2 fog + extra aerial haze right at the horizon line
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * viewDist * viewDist);
  fogFactor = max(fogFactor, smoothstep(500.0, 8000.0, viewDist) * 0.62);
  col = mix(col, uFogColor, fogFactor);

  gl_FragColor = vec4(col, alpha);

  #ifdef WATER_DEBUG
  if (uDebug == 1) gl_FragColor = vec4(vec3(depth / 16.0), 1.0);
  if (uDebug == 2) gl_FragColor = vec4(vec3(alpha), 1.0);
  if (uDebug == 3) gl_FragColor = vec4(vec3(foam), 1.0);
  if (uDebug == 4) gl_FragColor = vec4(refl, 1.0);
  if (uDebug == 5) gl_FragColor = vec4(vec3(fogFactor), 1.0);
  if (uDebug == 6) gl_FragColor = vec4(vec3(fresnel), 1.0);
  if (uDebug == 7) gl_FragColor = vec4(body, 1.0);
  #endif
}
`;

export function buildOcean(heightTex) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    defines: { WATER_DEBUG: 1 },
    uniforms: {
      uDebug: { value: 0 },
      ...swashUniforms,
      uTime: uniforms.uTime,
      uSunDir: uniforms.uSunDir,
      uSunColor: { value: new THREE.Color(1.0, 0.86, 0.62) },
      uHeight: { value: heightTex },
      uHmapHalf: { value: HMAP_HALF },
      uNormalTex: { value: waterNormalTexture() },
      uFoamTex: { value: foamTexture() },
      uDeepColor: { value: new THREE.Color(0.02, 0.16, 0.29) },
      uShallowColor: { value: new THREE.Color(0.05, 0.5, 0.46) },
      uSkyZenith: { value: new THREE.Color(0.16, 0.36, 0.72) },
      uSkyHorizon: { value: new THREE.Color(0.42, 0.60, 0.82) },
      uFogColor: uniforms.uFogColor,
      uFogDensity: uniforms.uFogDensity,
      uNightF: uniforms.uNightF,
    },
  });

  const group = new THREE.Group();
  group.name = 'ocean';

  const diskGeo = buildDiskGeometry();
  const inner = new THREE.Mesh(diskGeo, mat);
  inner.frustumCulled = false;
  inner.renderOrder = 2; // after footprint decals so floods tint them
  group.add(inner);

  const outerGeo = new THREE.RingGeometry(diskGeo.userData.outerRadius, 30000, 128, 12);
  outerGeo.rotateX(-Math.PI / 2);
  const outer = new THREE.Mesh(outerGeo, mat);
  outer.frustumCulled = false;
  outer.renderOrder = 2;
  group.add(outer);

  return { group, material: mat };
}
