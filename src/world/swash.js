// Shared swash / surge-wave model.
//
// The run-up line (how high up the beach the water reaches) is an analytic,
// periodic function of time — per surge zone and for the gentle ambient
// swash. Because it is closed-form and invertible, three different systems
// read the SAME model with zero simulation state:
//   - the ocean vertex shader lifts the water surface in surge zones,
//   - the sand shader computes "when was this spot last underwater" for the
//     wet-sand drying gradient,
//   - each footprint computes "when will a wave next cover me" to know when
//     it gets washed away.
//
// Cycle shape (phase u in [0,1)): fast decelerating rush-up on [0, SW_A],
// slower backwash on [SW_A, SW_B], lull on [SW_B, 1).

import * as THREE from 'three';
import { DAY_CYCLE_SECONDS } from '../core/env.js';

// ---- tide ----
// Semidiurnal: two highs and two lows per day cycle. Everything upstream of
// the swash model measures heights relative to the *current* water level
// (mean level y=0 + tide), so the surf, wet sand, footprints and crabs all
// migrate up and down the beach with it.
export const TIDE = { amp: 0.45, cycles: 2, phase: 1.1 };
export const TIDE_OMEGA = (TIDE.cycles * 2 * Math.PI) / DAY_CYCLE_SECONDS; // rad/s

export function tideFromTod(tod) {
  const angle = TIDE.cycles * 2 * Math.PI * tod + TIDE.phase;
  return { level: TIDE.amp * Math.cos(angle), angle };
}

export const ZONES = [
  // azimuth center, angular width (rad), max run-up height (m), period (s), phase (s)
  { az: 1.62, width: 0.60, height: 0.85, period: 13.0, phase: 0.0 }, // spawn beach
  { az: 3.50, width: 0.48, height: 0.62, period: 17.0, phase: 6.5 }, // by the rock outcrop
];

// gentle everywhere-swash (bookkeeping twin of the Gerstner shore lap)
export const AMBIENT = { height: 0.30, period: 7.0 };

export const DRY_SECONDS = 34; // wet sand drying time constant

export const swashUniforms = {
  uZone1: { value: new THREE.Vector4(ZONES[0].az, ZONES[0].width, ZONES[0].height, ZONES[0].period) },
  uZone1Ph: { value: ZONES[0].phase },
  uZone2: { value: new THREE.Vector4(ZONES[1].az, ZONES[1].width, ZONES[1].height, ZONES[1].period) },
  uZone2Ph: { value: ZONES[1].phase },
  uAmbient: { value: new THREE.Vector2(AMBIENT.height, AMBIENT.period) },
  uDrySecs: { value: DRY_SECONDS },
};

// ---- JS mirrors (crab AI, prop logic) ----
const SW_A = 0.30, SW_B = 0.85, SW_RISE_P = 0.6, SW_FALL_P = 1.5;

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

export function angFall(az, center, width) {
  let d = az - center;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return 1 - smoothstep(width * 0.35, width, Math.abs(d));
}

export function swashShape(u) {
  if (u < SW_A) return Math.pow(u / SW_A, SW_RISE_P);
  if (u < SW_B) return 1 - Math.pow((u - SW_A) / (SW_B - SW_A), SW_FALL_P);
  return 0;
}

// current run-up line height (m above waterline) at an azimuth
export function runupNow(az, t) {
  let r = AMBIENT.height * swashShape(((t / AMBIENT.period) % 1 + 1) % 1);
  for (const z of ZONES) {
    const u = (((t - z.phase) / z.period) % 1 + 1) % 1;
    r = Math.max(r, z.height * angFall(az, z.az, z.width) * swashShape(u));
  }
  return r;
}

export const SWASH_GLSL = /* glsl */ `
const float SW_A = 0.30;      // rush-up fraction of the cycle
const float SW_B = 0.85;      // end of backwash
const float SW_RISE_P = 0.6;  // rise easing exponent (fast start, soft landing)
const float SW_FALL_P = 1.5;  // backwash easing exponent
const float TIDE_AMP = ${TIDE.amp.toFixed(4)};
const float TIDE_OMEGA = ${TIDE_OMEGA.toFixed(7)};

// seconds since the slow tide (plus a small wave-lap reach) last covered an
// ABSOLUTE height. 0 while covered; huge if the tide never gets that high.
float sw_tideSince(float hAbs, float reach, float tideAng) {
  float c = (hAbs - reach) / TIDE_AMP;
  if (c <= -1.0) return 0.0;
  if (c >= 1.0) return 1.0e6;
  float thc = acos(c);                    // covered while angle in [-thc, thc]
  float u = mod(tideAng + thc, 6.2831853);
  if (u <= 2.0 * thc) return 0.0;         // covered right now
  return (u - 2.0 * thc) / TIDE_OMEGA;
}

float sw_angFall(float az, float center, float width) {
  float d = az - center;
  d = atan(sin(d), cos(d)); // wrap-aware angular distance
  return 1.0 - smoothstep(width * 0.35, width, abs(d));
}

// normalized run-up line height over one cycle
float sw_shape(float u) {
  if (u < SW_A) return pow(u / SW_A, SW_RISE_P);
  if (u < SW_B) return 1.0 - pow((u - SW_A) / (SW_B - SW_A), SW_FALL_P);
  return 0.0;
}

// d(shape)/du during the rush-up, 0 otherwise (drives bore foam)
float sw_riseVel(float u) {
  if (u >= SW_A) return 0.0;
  return (SW_RISE_P / SW_A) * pow(max(u / SW_A, 1e-4), SW_RISE_P - 1.0);
}

// most recent time <= tNow when the run-up line reached height h (Hmax = H)
float sw_lastCover(float h, float H, float P, float ph, float tNow) {
  if (H < 0.02 || h >= H) return -1e6;
  if (h <= 0.0) return tNow;
  float q = h / H;
  float u1 = SW_A * pow(q, 1.0 / SW_RISE_P);
  float u2 = SW_A + (SW_B - SW_A) * pow(1.0 - q, 1.0 / SW_FALL_P);
  float tp = (tNow - ph) / P;
  float cyc = floor(tp);
  float u = tp - cyc;
  float cu;
  if (u >= u1 && u <= u2) cu = tp;         // covered right now
  else if (u > u2) cu = cyc + u2;          // earlier this cycle
  else cu = cyc - 1.0 + u2;                // last cycle
  return cu * P + ph;
}

// first time >= ts when the run-up line reaches height h
float sw_nextCover(float ts, float h, float H, float P, float ph) {
  if (H < 0.02 || h >= H) return 1e9;
  if (h <= 0.0) return ts;
  float q = h / H;
  float u1 = SW_A * pow(q, 1.0 / SW_RISE_P);
  float u2 = SW_A + (SW_B - SW_A) * pow(1.0 - q, 1.0 / SW_FALL_P);
  float tp = (ts - ph) / P;
  float cyc = floor(tp);
  float u = tp - cyc;
  float cu;
  if (u <= u1) cu = cyc + u1;              // later this cycle
  else if (u <= u2) cu = tp;               // covered at ts already
  else cu = cyc + 1.0 + u1;                // next cycle
  return cu * P + ph;
}
`;
