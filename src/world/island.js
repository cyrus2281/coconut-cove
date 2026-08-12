// The island: analytic height field + terrain mesh + sand material.
// One height function is the single source of truth — it shapes the mesh,
// drives player collision, places props, and is baked to a texture that the
// water shader samples for depth (foam, color, wave damping).

import * as THREE from 'three';
import { Simplex2, mulberry32 } from '../core/rng.js';
import { uniforms } from '../core/env.js';
import { subSeed } from '../core/seed.js';
import { swashUniforms, SWASH_GLSL } from './swash.js';
import { sandTextures, causticTexture, foamTexture } from '../core/textures.js';

// Everything that defines this island's shape lives in these lets and is
// regrown from the master seed by reseedIsland().
let noise, BASE_R, LOBES, CAY_POS;

// Lobed shoreline: nominal water's-edge radius for a given angle.
export function shoreRadius(theta) {
  let k = 1;
  for (const l of LOBES) k += l.a * Math.sin(l.n * theta + l.ph);
  return BASE_R * k;
}

export function cayCenter() { return { ...CAY_POS }; }

// Regrow shoreline lobes, terrain noise and the offshore cay's bearing.
// The cay is a bare dome ~38m past the shoreline whose crown pokes ~0.35m
// above mean sea level: low tide bares a walkable islet, high tide drowns
// it back to a shimmer of shallows.
export function reseedIsland() {
  noise = new Simplex2(subSeed('terrain'));
  const r = mulberry32(subSeed('shore'));
  BASE_R = 43 + r() * 7;
  LOBES = [
    { n: 2, a: 0.11 + r() * 0.11, ph: r() * Math.PI * 2 },
    { n: 3, a: 0.05 + r() * 0.07, ph: r() * Math.PI * 2 },
    { n: 5, a: 0.03 + r() * 0.04, ph: r() * Math.PI * 2 },
  ];
  const cayAz = r() * Math.PI * 2;
  const cayR = shoreRadius(cayAz) + 35 + r() * 6;
  CAY_POS = { x: Math.cos(cayAz) * cayR, z: Math.sin(cayAz) * cayR };
}
reseedIsland();

// polynomial smooth-max (mirror of the usual smin)
function smax(a, b, k) {
  const t = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return a * (1 - t) + b * t + k * t * (1 - t);
}

// World-space terrain height (y) at (x, z). Water level is y = 0.
export function islandHeight(x, z) {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const d = r - shoreRadius(theta); // signed dist to shoreline: - inland, + offshore

  let h;
  if (d < 0) {
    const t = -d; // meters inland
    // beach climbing into a low dune plateau
    h = 4.6 * Math.tanh((t * 0.085) / 4.6 * 3.2);
    // rolling dunes grow with distance from the water
    const duneAmp = Math.min(t / 16, 1) * 1.35;
    h += duneAmp * noise.fbm(x * 0.045, z * 0.045, 4);
  } else {
    // gentle turquoise shelf, then a drop-off to the sea floor
    const shelf = Math.min(d, 80) * 0.055;
    const drop = 10.0 * THREE.MathUtils.smoothstep(d, 30, 78);
    h = -(shelf + drop);
    // subtle offshore sand bars
    h += Math.exp(-((d - 13) ** 2) / 90) * 0.28 * Math.sin(d * 0.7 + theta * 3.0);
  }

  // the sandbar cay rises smoothly out of the shelf
  const dc = Math.hypot(x - CAY_POS.x, z - CAY_POS.z);
  if (dc < 26) {
    const p = 0.38 - 3.0 * (dc / 20) * (dc / 20);
    h = smax(h, p, 0.5);
  }

  // fine surface detail everywhere (fades in deep water)
  const fine = noise.fbm(x * 0.35, z * 0.35, 3) * 0.11
    + noise.fbm(x * 0.09, z * 0.09, 3) * 0.22;
  h += fine * THREE.MathUtils.clamp(1 - (-h - 4) / 6, 0.25, 1);

  return h;
}

export function islandNormal(x, z, eps = 0.35) {
  const hx = islandHeight(x + eps, z) - islandHeight(x - eps, z);
  const hz = islandHeight(x, z + eps) - islandHeight(x, z - eps);
  return new THREE.Vector3(-hx / (2 * eps), 1, -hz / (2 * eps)).normalize();
}

// ------------------------------------------------------------------ heightmap
// Baked height texture for the water shader (half-float, R channel).
export const HMAP_HALF = 160; // texture covers [-160, 160] on x and z

export function bakeHeightmap(size = 512) {
  const data = new Uint16Array(size * size);
  for (let j = 0; j < size; j++) {
    const z = (j / (size - 1) - 0.5) * 2 * HMAP_HALF;
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1) - 0.5) * 2 * HMAP_HALF;
      data[j * size + i] = THREE.DataUtils.toHalfFloat(islandHeight(x, z));
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ terrain mesh
export function buildTerrain() {
  const SIZE = 300, SEGS = 300;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, islandHeight(x, z));
    const n = islandNormal(x, z);
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingSphere();

  const { map, normalMap } = sandTextures();
  const TILE = 5.2; // meters per texture repeat
  map.repeat.set(SIZE / TILE, SIZE / TILE);
  normalMap.repeat.set(SIZE / TILE, SIZE / TILE);

  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.88,
    metalness: 0.0,
  });

  const caustics = causticTexture();
  const breakup = foamTexture(); // reused as a generic tileable noise mask

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSunI = uniforms.uSunI;
    shader.uniforms.uNightF = uniforms.uNightF;
    shader.uniforms.uTide = uniforms.uTide;
    shader.uniforms.uTideAng = uniforms.uTideAng;
    shader.uniforms.uRainWet = uniforms.uRainWet;
    shader.uniforms.uCaustic = { value: caustics };
    shader.uniforms.uBreakup = { value: breakup };
    Object.assign(shader.uniforms, swashUniforms);

    shader.vertexShader = `
      varying vec3 vWPos;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );

    shader.fragmentShader = `
      uniform float uTime;
      uniform float uSunI;
      uniform float uNightF;
      uniform float uTide;
      uniform float uTideAng;
      uniform float uRainWet;
      uniform sampler2D uCaustic;
      uniform sampler2D uBreakup;
      uniform vec4 uZone1;
      uniform float uZone1Ph;
      uniform vec4 uZone2;
      uniform float uZone2Ph;
      uniform vec2 uAmbient;
      uniform float uDrySecs;
      varying vec3 vWPos;
      float bhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      ${SWASH_GLSL}
    ` + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // large-scale tonal variation to break texture tiling
          float macro = texture2D(uBreakup, vWPos.xz * 0.012).r;
          float macro2 = texture2D(uBreakup, vWPos.xz * 0.05 + 17.3).r;
          diffuseColor.rgb *= mix(vec3(0.90, 0.87, 0.80), vec3(1.10, 1.06, 0.99), macro);
          diffuseColor.rgb *= mix(1.0, 0.90, smoothstep(0.62, 0.9, macro2));

          // --- wet sand from the shared swash model ---
          // ragged wet line: jitter the effective height with noise.
          // hAbs is absolute; hEff is height above the *current* waterline.
          float hAbs = vWPos.y + (macro2 - 0.5) * 0.16;
          float hEff = hAbs - uTide;
          float az = atan(vWPos.z, vWPos.x);
          float H1 = uZone1.z * sw_angFall(az, uZone1.x, uZone1.y);
          float H2 = uZone2.z * sw_angFall(az, uZone2.x, uZone2.y);
          float lc = sw_lastCover(hEff, uAmbient.x, uAmbient.y, 0.0, uTime);
          lc = max(lc, sw_lastCover(hEff, H1, uZone1.w, uZone1Ph, uTime));
          lc = max(lc, sw_lastCover(hEff, H2, uZone2.w, uZone2Ph, uTime));
          float since = max(uTime - lc, 0.0);
          float wet = pow(exp(-since / uDrySecs), 0.72); // stays dark, then lets go
          // the ebbing tide leaves broad flats that dry much more slowly
          float sinceTide = sw_tideSince(hAbs, uAmbient.x * 0.7, uTideAng);
          wet = max(wet, pow(exp(-sinceTide / (uDrySecs * 3.2)), 0.72));
          wet = max(wet, 1.0 - smoothstep(0.0, 0.15, hEff)); // saturated fringe
          // rain soaks the whole island; uRainWet decays slowly after a squall
          wet = max(wet, uRainWet * (0.72 + 0.28 * macro));
          wet = clamp(wet, 0.0, 1.0);

          // wet sand: much darker, slightly warm, water-saturated
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.44, 0.415, 0.39), wet);

          // fizzing foam residue left just behind a retreating wave
          float fpB = texture2D(uBreakup, vWPos.xz * 0.55).r;
          float resid = exp(-since / 2.4) * (1.0 - step(hEff, 0.02));
          if (resid > 0.01) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.91, 0.94, 0.93),
              smoothstep(0.55, 0.85, fpB) * resid * 0.55);
          }
          // bioluminescent film: a glowing strip chasing the retreating swash
          // (rises just after a spot is uncovered, gone ~2s later)
          vBio = smoothstep(0.03, 0.35, since) * exp(-since / 1.1)
            * (1.0 - step(hEff, 0.01))
            * (0.25 + 0.75 * smoothstep(0.45, 0.85, fpB));

          // underwater absorption tint
          float sub = max(0.0, uTide - vWPos.y);
          diffuseColor.rgb *= pow(vec3(0.66, 0.80, 0.84), vec3(min(sub * 0.55, 4.0)));
          vWetness = wet;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.10, vWetness);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // fake caustics dancing on the submerged sand
          float sub = max(0.0, uTide - vWPos.y);
          float cmask = smoothstep(0.05, 0.5, sub) * (1.0 - smoothstep(1.5, 7.0, sub));
          if (cmask > 0.001) {
            vec2 cuv = vWPos.xz * 0.09;
            float ca = texture2D(uCaustic, cuv + uTime * vec2(0.014, 0.021)).r;
            float cb = texture2D(uCaustic, cuv * 1.37 - uTime * vec2(0.019, 0.012)).r;
            totalEmissiveRadiance += vec3(1.0, 0.97, 0.86) * (ca * cb * 1.9) * cmask * uSunI;
          }
          // sand sparkle: sparse micro-facets that glint as the view moves
          vec3 vdir = normalize(vViewPosition);
          vec2 cell = floor(vWPos.xz * 240.0);
          float g = bhash(cell + floor(vdir.xy * 7.0));
          float glint = smoothstep(0.9975, 1.0, g);
          totalEmissiveRadiance += vec3(1.0, 0.98, 0.9) * glint * (0.22 + vWetness * 0.5) * uSunI;
          // night bioluminescence traces the retreating swash line
          totalEmissiveRadiance += vec3(0.10, 1.55, 1.28) * vBio * uNightF;
        }`
      );

    // declare the bridge variables once, at the top of main()
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      'float vWetness = 0.0;\nfloat vBio = 0.0;\nvoid main() {'
    );
  };
  mat.customProgramCacheKey = () => 'cove-sand-v4';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  return mesh;
}
