// The underwater world-feel: the moment the camera slips below the surface,
// the fog turns to sea-water (denser + darker with depth), the sky furniture
// hides, the audio muffles, sun shafts hang from the surface, plankton motes
// drift past the mask, and exhaled bubbles wobble upward. Also owns the two
// DOM pills — the first-swim hint and the "you can't swim further" message.

import * as THREE from 'three';
import { uniforms } from '../core/env.js';
import { causticTexture } from '../core/textures.js';

// ------------------------------------------------------------------ shared
// Material patch bits shared by the reef and every creature: a world-position
// varying and dancing caustic light on anything that sits under the sea.
// Usage inside onBeforeCompile: attach uniforms with uwAttach(shader), inject
// UW_WPOS_VERT after project_vertex, UW_FRAG_DECL at the fragment top and
// UW_CAUSTIC_FRAG after emissivemap_fragment.
let _causticTex = null;
export function uwAttach(shader) {
  if (!_causticTex) _causticTex = causticTexture();
  shader.uniforms.uTime = uniforms.uTime;
  shader.uniforms.uTide = uniforms.uTide;
  shader.uniforms.uSunI = uniforms.uSunI;
  shader.uniforms.uNightF = uniforms.uNightF;
  shader.uniforms.uCausticTex = { value: _causticTex };
}

export const UW_VERT_DECL = /* glsl */ `
varying vec3 vWPos;
`;

// world position that survives instancing (instanceMatrix is auto-declared)
export const UW_WPOS_VERT = /* glsl */ `
{
  vec4 uwp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    uwp = instanceMatrix * uwp;
  #endif
  vWPos = (modelMatrix * uwp).xyz;
}
`;

export const UW_FRAG_DECL = /* glsl */ `
varying vec3 vWPos;
uniform float uTime;
uniform float uTide;
uniform float uSunI;
uniform sampler2D uCausticTex;
`;

export const UW_CAUSTIC_FRAG = /* glsl */ `
{
  float uwSub = uTide - vWPos.y; // metres of sea standing over this point
  float uwMask = smoothstep(0.12, 0.6, uwSub) * (1.0 - smoothstep(5.0, 11.0, uwSub));
  if (uwMask > 0.001) {
    vec2 cuv = vWPos.xz * 0.11;
    float ca = texture2D(uCausticTex, cuv + uTime * vec2(0.015, 0.022)).r;
    float cb = texture2D(uCausticTex, cuv * 1.31 - uTime * vec2(0.02, 0.011)).r;
    totalEmissiveRadiance += diffuseColor.rgb * (ca * cb * 0.85) * uwMask * uSunI;
  }
}
`;

// Convenience: give a MeshStandardMaterial the underwater treatment. `name`
// keys the shader cache; `sway` (0..1) adds a gentle current-rock driven by
// height above each instance's own base.
export function uwPatch(mat, name, { sway = 0, swaySpeed = 1.0 } = {}) {
  mat.onBeforeCompile = (shader) => {
    uwAttach(shader);
    shader.vertexShader = UW_VERT_DECL + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${sway > 0 ? `{
          float uwph = 0.0;
          #ifdef USE_INSTANCING
            uwph = instanceMatrix[3][0] * 7.31 + instanceMatrix[3][2] * 3.77;
          #endif
          float uwk = max(transformed.y, 0.0);
          float uwb = sin(uTime * ${swaySpeed.toFixed(2)} + uwph) +
                      0.5 * sin(uTime * ${(swaySpeed * 2.3).toFixed(2)} + uwph * 1.7 + transformed.y * 2.0);
          transformed.x += uwb * uwk * uwk * ${(sway * 0.1).toFixed(3)};
          transformed.z += (0.6 * sin(uTime * ${(swaySpeed * 0.77).toFixed(2)} + uwph + 2.1))
                           * uwk * uwk * ${(sway * 0.1).toFixed(3)};
        }` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        ${UW_WPOS_VERT}`);
    if (sway > 0) {
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
    }
    shader.fragmentShader = UW_FRAG_DECL + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${UW_CAUSTIC_FRAG}`);
  };
  mat.customProgramCacheKey = () => `uw-${name}-${sway}-${swaySpeed}`;
  return mat;
}

// ------------------------------------------------------------- sun shafts
function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    const v = y / 255;
    const fadeTop = Math.min(v / 0.08, 1);          // hard birth at the surface
    const fadeBot = 1 - Math.pow(v, 1.6);           // long dissolve downward
    for (let x = 0; x < 64; x++) {
      const u = x / 63 - 0.5;
      const core = Math.exp(-u * u * 26);
      const a = core * fadeTop * fadeBot;
      const i = (y * 64 + x) * 4;
      img.data[i] = 210; img.data[i + 1] = 240; img.data[i + 2] = 250;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ motes
function buildMotes() {
  const N = 420, HALF = 11.0;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * HALF * 2;
    pos[i * 3 + 1] = (Math.random() - 0.5) * HALF * 2;
    pos[i * 3 + 2] = (Math.random() - 0.5) * HALF * 2;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: uniforms.uTime,
      uTide: uniforms.uTide,
      uSunI: uniforms.uSunI,
      uNightF: uniforms.uNightF,
      uCam: { value: new THREE.Vector3() },
      uK: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uTide;
      uniform vec3 uCam;
      attribute float aSeed;
      varying float vA;
      varying float vGlow;
      void main() {
        vec3 p = position;
        // each mote drifts on its own slow loop, and the whole field wraps
        // around the camera so it never runs out
        p.x += sin(uTime * 0.11 + aSeed * 39.0) * 0.8 + uTime * 0.05;
        p.y += sin(uTime * 0.07 + aSeed * 61.0) * 0.5 - uTime * 0.014;
        p.z += cos(uTime * 0.09 + aSeed * 23.0) * 0.7;
        p = mod(p - uCam + 11.0, 22.0) - 11.0 + uCam;
        // never above the waterline
        float below = smoothstep(0.0, 0.4, uTide - 0.15 - p.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vA = below * (1.0 - smoothstep(7.0, 11.0, d)) * smoothstep(0.3, 1.2, d);
        vGlow = step(0.86, aSeed); // a few motes are plankton that glow at night
        gl_PointSize = (1.4 + fract(aSeed * 7.31) * 2.6) * (140.0 / max(d, 0.1));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uK;
      uniform float uSunI;
      uniform float uNightF;
      varying float vA;
      varying float vGlow;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float r = smoothstep(0.5, 0.12, length(q));
        vec3 day = vec3(0.62, 0.78, 0.80) * (0.25 + 0.75 * uSunI);
        vec3 glow = vec3(0.15, 1.3, 1.1) * vGlow * uNightF * 2.0;
        float a = r * vA * uK * (0.34 + vGlow * uNightF);
        gl_FragColor = vec4(day + glow, a);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  pts.renderOrder = 3;
  return { pts, mat };
}

// ---------------------------------------------------------------- bubbles
function buildBubbles() {
  const N = 90;
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uK: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying float vOn;
      void main() {
        vOn = step(0.001, aSize);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (240.0 / max(-mv.z, 0.1));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uK;
      varying float vOn;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        // a ring with a bright off-centre glint reads as glass
        float ring = smoothstep(0.5, 0.42, d) * (0.35 + 0.65 * smoothstep(0.18, 0.42, d));
        float glint = smoothstep(0.16, 0.0, length(q - vec2(-0.13, -0.15)));
        float a = (ring * 0.6 + glint * 0.9) * vOn * uK;
        gl_FragColor = vec4(vec3(0.85, 0.97, 1.0), a);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  pts.renderOrder = 3;
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N).fill(-1);
  return { pts, mat, pos, size, vel, life, N, geo };
}

// ------------------------------------------------------------------- main
export function buildUnderwater(player, camera, scene, sky, audio) {
  const group = new THREE.Group();
  group.name = 'underwater';

  // sun shafts: tall additive planes hung from the surface, billboarded on Y
  const shafts = [];
  {
    const tex = shaftTexture();
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1 + Math.random() * 1.6, 13),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
        })
      );
      m.visible = false;
      m.renderOrder = 3;
      group.add(m);
      shafts.push({
        mesh: m,
        r: 3.5 + Math.random() * 10,
        a: Math.random() * Math.PI * 2,
        ph: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.05,
      });
    }
  }

  const motes = buildMotes();
  group.add(motes.pts);
  const bub = buildBubbles();
  group.add(bub.pts);

  // ---- DOM: tint overlay + pills ----
  const uwEl = document.getElementById('uw');
  const boundPill = document.getElementById('boundPill');
  const swimHint = document.getElementById('swimHint');
  let boundTimer = 0;
  let hintTimer = 0;
  let hintShown = false;

  let wasSub = false;
  let weatherGroup = null;
  let exhaleIn = 2.2;
  let kickAcc = 0;
  const bgColor = new THREE.Color();
  const fogC = new THREE.Color();

  function spawnBubble(x, y, z, s) {
    for (let i = 0; i < bub.N; i++) {
      if (bub.life[i] > 0) continue;
      bub.life[i] = 8; // killed at the surface; this is just a safety net
      bub.pos[i * 3] = x; bub.pos[i * 3 + 1] = y; bub.pos[i * 3 + 2] = z;
      bub.size[i] = s;
      bub.vel[i * 3] = (Math.random() - 0.5) * 0.14;
      bub.vel[i * 3 + 1] = 0.45 + Math.random() * 0.4 + s * 1.5;
      bub.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.14;
      return;
    }
  }

  function update(t, dt) {
    const sub = player.submerged;
    const subK = player.subK;
    uniforms.uUW.value = subK;

    if (sub !== wasSub) {
      wasSub = sub;
      sky.setSubmerged(sub);
      if (weatherGroup) weatherGroup.visible = !sub;
      uwEl.classList.toggle('on', sub);
      audio.splash(sub ? 0.3 : 0.18); // the blub of the eye-line crossing
      if (!sub) scene.background = null;
    }

    audio.setUnderwater(subK);

    if (sub) {
      // sea-water fog: turquoise near the light, bluer + blacker with depth
      const depthCam = Math.max(player.surfaceY - camera.position.y, 0);
      const sunK = THREE.MathUtils.clamp(uniforms.uSunI.value, 0, 1);
      const storm = uniforms.uStorm.value;
      const light = 0.06 + 0.94 * sunK;
      const dk = Math.exp(-depthCam * 0.07);
      fogC.setRGB(
        0.05 * dk,
        0.34 * Math.pow(dk, 0.72),
        0.42 * Math.pow(dk, 0.45)
      ).multiplyScalar(light * (1 - 0.4 * storm));
      scene.fog.color.copy(fogC);
      scene.fog.density = 0.047 + depthCam * 0.0015 + storm * 0.012;
      uniforms.uFogColor.value.copy(fogC);
      uniforms.uFogDensity.value = scene.fog.density;
      scene.background = bgColor.copy(fogC);
      scene.environmentIntensity *= 0.5; // sky ambient barely reaches down here
    }

    // ---- sun shafts ----
    const showShafts = subK > 0.02 && uniforms.uSunI.value > 0.08;
    const tide = uniforms.uTide.value;
    for (let i = 0; i < shafts.length; i++) {
      const s = shafts[i];
      s.mesh.visible = showShafts;
      if (!showShafts) continue;
      s.a += s.spin * dt;
      const x = player.pos.x + Math.cos(s.a) * s.r;
      const z = player.pos.z + Math.sin(s.a) * s.r;
      s.mesh.position.set(x, tide - 6.2, z);
      s.mesh.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
      const shimmer = 0.45 + 0.55 * Math.sin(t * 0.6 + s.ph) * Math.sin(t * 0.23 + s.ph * 2.7);
      const deepFade = 1 - THREE.MathUtils.clamp((player.surfaceY - camera.position.y - 9) / 6, 0, 1);
      s.mesh.material.opacity =
        0.16 * subK * shimmer * THREE.MathUtils.clamp(uniforms.uSunI.value, 0, 1) * deepFade;
    }

    // ---- motes ----
    motes.pts.visible = subK > 0.01;
    motes.mat.uniforms.uCam.value.copy(camera.position);
    motes.mat.uniforms.uK.value = subK;

    // ---- bubbles ----
    bub.pts.visible = subK > 0.01 || bub.life.some((l) => l > 0);
    bub.mat.uniforms.uK.value = Math.max(subK, 0.4);
    if (sub) {
      // a slow exhale every few seconds, plus a fizz when kicking hard
      exhaleIn -= dt;
      if (exhaleIn <= 0) {
        exhaleIn = 3.2 + Math.random() * 2.4;
        const n = 5 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) {
          spawnBubble(
            camera.position.x + (Math.random() - 0.5) * 0.2,
            camera.position.y - 0.15 - Math.random() * 0.1,
            camera.position.z + (Math.random() - 0.5) * 0.2,
            0.02 + Math.random() * 0.045
          );
        }
        audio.bubble();
      }
      const spd = player.vel.length();
      if (spd > 2.2) {
        kickAcc += dt * spd;
        if (kickAcc > 0.9) {
          kickAcc = 0;
          spawnBubble(
            camera.position.x + (Math.random() - 0.5) * 0.5,
            camera.position.y - 0.4,
            camera.position.z + (Math.random() - 0.5) * 0.5,
            0.012 + Math.random() * 0.02
          );
        }
      }
    }
    let anyB = false;
    for (let i = 0; i < bub.N; i++) {
      if (bub.life[i] <= 0) continue;
      bub.life[i] -= dt;
      const iy = i * 3 + 1;
      bub.vel[i * 3] += Math.sin(t * 7 + i * 2.3) * 0.25 * dt; // wobble
      bub.pos[i * 3] += bub.vel[i * 3] * dt;
      bub.pos[iy] += bub.vel[iy] * dt;
      bub.pos[i * 3 + 2] += bub.vel[i * 3 + 2] * dt;
      if (bub.pos[iy] > tide - 0.04 || bub.life[i] <= 0) {
        bub.life[i] = -1;
        bub.size[i] = 0;
      }
      anyB = true;
    }
    if (anyB) {
      bub.geo.attributes.position.needsUpdate = true;
      bub.geo.attributes.aSize.needsUpdate = true;
    }

    // ---- pills ----
    if (player.boundaryK > 0.55) boundTimer = 2.8;
    if (boundTimer > 0) {
      boundTimer -= dt;
      boundPill.classList.add('show');
    } else {
      boundPill.classList.remove('show');
    }
    if (player.swimming && !hintShown) {
      hintShown = true;
      hintTimer = 8;
    }
    if (hintTimer > 0) {
      hintTimer -= dt;
      // the hint has done its job once you dive
      if (player.submerged && player.swimTime > 3) hintTimer = Math.min(hintTimer, 1);
      swimHint.classList.toggle('show', hintTimer > 0);
    }
  }

  return {
    group,
    update,
    attachWeather(g) { weatherGroup = g; },
  };
}
