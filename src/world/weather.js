// The weather director. Most of the time the island basks under the trade
// winds — but every couple of day-cycles a squall builds on the horizon,
// grays the sea, lashes the palms, drums rain across the whole island and
// moves on, leaving everything dark, soaked and slowly drying.
//
// One intensity scalar (uStorm) drives the sky, water and wind; a separate
// slow-decaying uRainWet soaks the sand so the island keeps drying long
// after the rain has stopped.

import * as THREE from 'three';
import { uniforms } from '../core/env.js';

const RAIN_COUNT = 700;
const CYL_R = 15;    // rain cylinder radius around the camera
const CYL_H = 13;    // and height
const FALL_SPEED = 15;

export function buildWeather(camera, audio) {
  // rain as line segments: cheap, and exactly how rain reads in motion
  const positions = new Float32Array(RAIN_COUNT * 2 * 3);
  const seeds = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    seeds[i * 3] = (Math.random() * 2 - 1) * CYL_R;
    seeds[i * 3 + 1] = Math.random() * CYL_H;
    seeds[i * 3 + 2] = (Math.random() * 2 - 1) * CYL_R;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xb8c8d4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.visible = false;
  lines.frustumCulled = false;
  lines.renderOrder = 3;

  const W = {
    state: 'clear',            // clear | building | squall | clearing
    stateT: 0,
    nextIn: 500 + Math.random() * 700, // first squall lands mid-first-day-ish
    squallLen: 90,
    wx: 0,                     // eased storm intensity
    groundWet: 0,
    fallPhase: 0,
  };

  function setState(s, dur) {
    W.state = s;
    W.stateT = dur;
  }

  function update(t, dt) {
    // ---- state machine ----
    if (W.state === 'clear') {
      W.nextIn -= dt;
      if (W.nextIn <= 0) setState('building', 55);
    } else {
      W.stateT -= dt;
      if (W.stateT <= 0) {
        if (W.state === 'building') setState('squall', W.squallLen = 75 + Math.random() * 50);
        else if (W.state === 'squall') setState('clearing', 65);
        else if (W.state === 'clearing') {
          W.state = 'clear';
          W.nextIn = (1.2 + Math.random() * 1.6) * 720; // 1.2–2.8 day cycles
        }
      }
    }

    // ---- eased intensity ----
    let target = 0;
    if (W.state === 'building') target = 1 - W.stateT / 55;
    else if (W.state === 'squall') target = 0.92 + 0.08 * Math.sin(t * 0.7);
    else if (W.state === 'clearing') target = W.stateT / 65;
    W.wx += (target - W.wx) * Math.min(dt * 0.8, 1);
    uniforms.uStorm.value = W.wx;

    // ground soaks fast under rain, dries out over ~2 minutes afterwards
    if (W.wx > W.groundWet) W.groundWet += (W.wx - W.groundWet) * Math.min(dt * 0.12, 1);
    else W.groundWet *= Math.exp(-dt / 120);
    uniforms.uRainWet.value = W.groundWet;

    // wind picks up with the squall
    uniforms.uWindAmp.value = 1 + 1.7 * W.wx;

    if (audio) audio.setRain(W.wx);

    // ---- rain streaks around the camera ----
    if (W.wx > 0.03) {
      lines.visible = true;
      mat.opacity = 0.34 * W.wx;
      W.fallPhase += FALL_SPEED * dt;
      const shearX = uniforms.uWindDir.value.x * 2.2 * W.wx;
      const shearZ = uniforms.uWindDir.value.y * 2.2 * W.wx;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < RAIN_COUNT; i++) {
        // wrap each drop into the moving cylinder around the camera
        const fy = (seeds[i * 3 + 1] - W.fallPhase) % CYL_H;
        const y = cy + (fy < 0 ? fy + CYL_H : fy) - CYL_H * 0.45;
        const x = cx + (((seeds[i * 3] - cx) % CYL_R + CYL_R * 1.5) % (CYL_R * 2)) - CYL_R;
        const z = cz + (((seeds[i * 3 + 2] - cz) % CYL_R + CYL_R * 1.5) % (CYL_R * 2)) - CYL_R;
        const j = i * 6;
        positions[j] = x;
        positions[j + 1] = y + 0.62;
        positions[j + 2] = z;
        positions[j + 3] = x + shearX * 0.05;
        positions[j + 4] = y;
        positions[j + 5] = z + shearZ * 0.05;
      }
      geo.attributes.position.needsUpdate = true;
    } else if (lines.visible) {
      lines.visible = false;
    }
  }

  return {
    group: lines,
    update,
    // debug: bring the squall on (or end it) right now
    rain(on = true) {
      if (on) setState('building', 12);
      else if (W.state !== 'clear') setState('clearing', 20);
      return W.state;
    },
    state: () => ({ state: W.state, wx: +W.wx.toFixed(2), wet: +W.groundWet.toFixed(2) }),
  };
}
