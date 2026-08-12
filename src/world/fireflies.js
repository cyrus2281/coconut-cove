// Fireflies: the land's answer to the glowing surf. A hundred-odd warm
// motes that wake in full darkness, drifting slow loops over the interior
// grass and the lagoon margin (where their light doubles in the water).
// One additive Points mesh; positions and pulse colors are cheap CPU work.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius, lagoonInfo } from './island.js';

const COUNT = 130;

export function buildFireflies() {
  const group = new THREE.Group();
  group.name = 'fireflies';
  const rand = mulberry32(subSeed('fireflies'));
  const L = lagoonInfo();

  const flies = [];
  let guard = 0;
  while (flies.length < COUNT && guard++ < 4000) {
    let x, z;
    if (L && rand() < 0.42) {
      // the lagoon crowd hangs just off the reeds, some right over the water
      const a = rand() * Math.PI * 2;
      const rr = L.rW * (0.55 + rand() * 0.9);
      x = L.x + Math.cos(a) * rr;
      z = L.z + Math.sin(a) * rr;
    } else {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * (shoreRadius(a) - 8);
      x = Math.cos(a) * rr;
      z = Math.sin(a) * rr;
      if (islandHeight(x, z) < 2.3) continue; // grass country only
    }
    const ground = Math.max(islandHeight(x, z), L ? L.level : -99);
    flies.push({
      ax: x, az: z, ay: ground + 0.3 + rand() * 0.9,
      r: 0.3 + rand() * 1.1,
      w1: 0.10 + rand() * 0.22,
      w2: 0.08 + rand() * 0.20,
      wy: 0.3 + rand() * 0.5,
      ph: rand() * Math.PI * 2,
      ph2: rand() * Math.PI * 2,
      rate: 0.55 + rand() * 0.9,
      x, y: ground + 0.8, z,
    });
  }

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(flies.length * 3);
  const col = new Float32Array(flies.length * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.075,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  mesh.frustumCulled = false;
  group.add(mesh);

  let wasDark = false;

  function update(t, dt) {
    const night = uniforms.uNightF.value;
    const dark = night > 0.05;
    if (!dark) {
      if (wasDark) { // douse once at dawn, then sleep through the day
        for (let i = 0; i < flies.length; i++) {
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
        }
        geo.attributes.color.needsUpdate = true;
        wasDark = false;
      }
      return;
    }
    wasDark = true;

    const nf = night * night;
    const storm = uniforms.uStorm.value; // rain sends them into the grass
    const k0 = nf * (1 - storm * 0.85);
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      f.x = f.ax + Math.sin(t * f.w1 + f.ph) * f.r;
      f.z = f.az + Math.cos(t * f.w2 + f.ph2) * f.r;
      f.y = f.ay + Math.sin(t * f.wy + f.ph) * 0.22;
      pos[i * 3] = f.x; pos[i * 3 + 1] = f.y; pos[i * 3 + 2] = f.z;

      // soft pulse with long dark rests, all out of phase
      const gate = Math.sin(t * 0.13 + f.ph2 * 3.1) > -0.35 ? 1 : 0;
      const b = Math.pow(Math.max(Math.sin(t * f.rate + f.ph), 0), 2.6) * gate * k0;
      col[i * 3] = b * 0.72;
      col[i * 3 + 1] = b;
      col[i * 3 + 2] = b * 0.30;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  return { group, update, count: flies.length };
}
