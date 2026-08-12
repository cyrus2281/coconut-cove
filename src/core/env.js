// Shared constants + uniforms referenced by every material in the world.
// One object, updated once per frame, ticks all shaders together
// (waves, wet-sand line, palm sway, caustics all share the same clock).

import * as THREE from 'three';

export const WATER_LEVEL = 0;

// Sun: azimuth in radians (world XZ, x=cos, z=sin), elevation in radians.
export const SUN_AZIMUTH = 2.35;
export const SUN_ELEVATION = THREE.MathUtils.degToRad(21);

export const sunDir = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH)
).normalize();

export const FOG_COLOR = new THREE.Color(0.70, 0.80, 0.89);
export const FOG_DENSITY = 0.00042;

export const uniforms = {
  uTime: { value: 0 },
  uSunDir: { value: sunDir.clone() },
  uSunColor: { value: new THREE.Color(1.0, 0.9, 0.72) },
  uSunI: { value: 1.0 },
  uWindDir: { value: new THREE.Vector2(0.85, 0.53).normalize() },
  uWindAmp: { value: 1.0 },
  uFogColor: { value: FOG_COLOR.clone() },
  uFogDensity: { value: FOG_DENSITY },
};
