// The moon jelly as an asset: a double-walled bell with a streaming fringe
// and four frilled oral arms, and the translucent pulse shader (layered
// fresnel, the four horseshoe gonads, faint radial canals, night
// bioluminescence). sealife.js instances it and owns the drift.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uniforms } from '../core/env.js';

export function jellyGeometry() {
  const dome = new THREE.SphereGeometry(0.16, 26, 13, 0, Math.PI * 2, 0, 1.9);
  // inner wall: a slightly smaller dome; backface adds visual thickness
  const inner = new THREE.SphereGeometry(0.145, 20, 10, 0, Math.PI * 2, 0, 1.85);
  inner.translate(0, -0.004, 0);
  const parts = [dome, inner];
  // fringe tentacles around the rim: long fine streamers
  const rimY = 0.16 * Math.cos(1.9);
  const rimR = 0.16 * Math.sin(1.9);
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const len = 0.26 + Math.sin(i * 2.7) * 0.05;
    const strip = new THREE.PlaneGeometry(0.008, len, 1, 8);
    strip.translate(0, -len / 2, 0);
    strip.rotateY(a + Math.PI / 2);
    strip.translate(Math.cos(a) * rimR * 0.97, rimY + 0.004, Math.sin(a) * rimR * 0.97);
    parts.push(strip);
  }
  // four frilly oral arms trailing under the mouth
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const arm = new THREE.PlaneGeometry(0.055, 0.34, 2, 8);
    // ruffle the arm edges
    const p = arm.attributes.position;
    for (let vi = 0; vi < p.count; vi++) {
      const x = p.getX(vi), y = p.getY(vi);
      p.setX(vi, x * (1 + Math.sin(y * 40) * 0.25));
    }
    arm.translate(0, -0.15, 0);
    arm.rotateY(a);
    arm.translate(Math.cos(a) * 0.03, 0.02, Math.sin(a) * 0.03);
    parts.push(arm);
  }
  return mergeGeometries(parts);
}

export function jellyMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: uniforms.uTime,
      uNightF: uniforms.uNightF,
      uSunI: uniforms.uSunI,
      uFogColor: uniforms.uFogColor,
      uFogDensity: uniforms.uFogDensity,
    },
    vertexShader: /* glsl */ `
      attribute float aPh;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUvA;
      varying float vPulse;
      varying float vDist;
      varying float vBell;
      void main() {
        vUvA = uv;
        float pulse = sin(uTime * 1.7 + aPh);
        vPulse = pulse;
        vec3 p = position;
        vBell = step(-0.01, p.y);
        if (p.y > -0.01) {
          // the bell: rim flares on the power stroke, crown stays firm
          float rimK = clamp((0.1 - p.y) / 0.16, 0.0, 1.0);
          float s = 1.0 + 0.13 * pulse * rimK;
          p.x *= s; p.z *= s;
          p.y *= 1.0 - 0.08 * pulse * (1.0 - rimK);
        } else {
          // fringe and arms stream behind the pulse, more the deeper they hang
          float hang = -p.y / 0.34;
          p.x += sin(uTime * 1.3 + aPh + p.y * 9.0) * 0.028 * hang;
          p.z += cos(uTime * 1.1 + aPh * 1.3 + p.y * 7.0) * 0.028 * hang;
          p.y += sin(uTime * 0.9 + aPh + p.x * 5.0) * 0.012 * hang;
        }
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNightF;
      uniform float uSunI;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUvA;
      varying float vPulse;
      varying float vDist;
      varying float vBell;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - ndv, 2.2);
        float core = pow(ndv, 3.0) * 0.16; // faint glassy core gleam
        vec3 col = vec3(0.74, 0.84, 0.92) * (0.35 + 0.65 * uSunI);
        // the four horseshoe gonads glowing through the bell
        float go = smoothstep(0.55, 0.95, sin(vUvA.x * 25.13))
          * exp(-pow((vUvA.y - 0.42) * 4.5, 2.0)) * vBell;
        col = mix(col, vec3(0.92, 0.6, 0.74), go * 0.75);
        // faint radial canals from crown to rim
        float canal = smoothstep(0.86, 1.0, sin(vUvA.x * 100.5))
          * smoothstep(0.1, 0.5, vUvA.y) * vBell;
        col += vec3(0.2, 0.26, 0.3) * canal * 0.5;
        // moon jellies come alive at night
        col += vec3(0.15, 0.85, 0.8) * uNightF * (0.35 + 0.25 * vPulse);
        float a = 0.085 + rim * 0.55 + core + go * 0.24 + canal * 0.06;
        // the hanging fringe fades toward the tips (strip uv v: 0 at tip)
        a *= mix(smoothstep(0.0, 0.55, vUvA.y), 1.0, vBell);
        a *= 0.55 + 0.45 * uSunI + uNightF * 0.4;
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        col = mix(col, uFogColor, fogF);
        gl_FragColor = vec4(col, a * (1.0 - fogF * 0.7));
      }
    `,
  });
}
