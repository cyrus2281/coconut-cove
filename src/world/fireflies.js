// Fireflies: the land's answer to the glowing surf. A few dozen warm motes
// that wake in full darkness, drifting slow loops over the interior grass
// and the lagoon margin (where their light doubles in the water). Some
// blink in double flashes; their lantern hues run amber to green. Walk
// through a knot of them and they douse and scatter, re-lighting once
// you've passed. One additive Points mesh; positions and pulse colors are
// cheap CPU work.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius, lagoonsInfo } from './island.js';
import { glowDotTexture } from '../core/textures.js';

const COUNT = 40;

export function buildFireflies(player) {
  const group = new THREE.Group();
  group.name = 'fireflies';
  const rand = mulberry32(subSeed('fireflies'));
  const lagoons = lagoonsInfo();

  const flies = [];
  let guard = 0;
  while (flies.length < COUNT && guard++ < 4000) {
    let x, z, L = null;
    if (lagoons.length && rand() < 0.42) {
      // the pond crowds hang just off the reeds, some right over the water
      L = lagoons[Math.floor(rand() * lagoons.length)];
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
    const ground = Math.max(islandHeight(x, z), L ? L.level : -99); // hover over pond water, not its bed
    // lantern hue: amber through yellow-green, one fly one color
    const hue = rand();
    flies.push({
      ax: x, az: z, ay: ground + 0.3 + rand() * 0.9,
      r: 0.3 + rand() * 1.1,
      w1: 0.10 + rand() * 0.22,
      w2: 0.08 + rand() * 0.20,
      wy: 0.3 + rand() * 0.5,
      ph: rand() * Math.PI * 2,
      ph2: rand() * Math.PI * 2,
      rate: 0.55 + rand() * 0.9,
      dbl: rand() < 0.4,       // some species double-flash
      cr: 0.55 + hue * 0.45,   // amber (1.0, 0.85, 0.2) → green (0.55, 1.0, 0.3)
      cg: 0.85 + hue * 0.15,
      cb: 0.20 + hue * 0.10,
      ox: 0, oz: 0,            // scatter offset away from the player
      fright: 0,
      x, y: ground + 0.8, z,
    });
  }

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(flies.length * 3);
  const col = new Float32Array(flies.length * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Points(geo, new THREE.PointsMaterial({
    map: glowDotTexture(), // soft round lantern, not a hard square point
    size: 0.16,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  mesh.frustumCulled = false;
  group.add(mesh);

  let wasDark = false;
  const pulse = (a) => Math.pow(Math.max(Math.sin(a), 0), 2.6);

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
    const px = player ? player.pos.x : 1e9, pz = player ? player.pos.z : 1e9;
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      f.x = f.ax + Math.sin(t * f.w1 + f.ph) * f.r + f.ox;
      f.z = f.az + Math.cos(t * f.w2 + f.ph2) * f.r + f.oz;
      f.y = f.ay + Math.sin(t * f.wy + f.ph) * 0.22;

      // wade through the swarm and it douses and darts aside
      const dx = f.x - px, dz = f.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < 1.6) {
        const push = (1.6 - d) / 1.6;
        f.ox += (dx / (d || 1)) * push * dt * 3.4;
        f.oz += (dz / (d || 1)) * push * dt * 3.4;
        f.fright = Math.min(f.fright + dt * 4, 1);
      } else {
        f.fright *= Math.exp(-dt * 0.9);
      }
      const settle = Math.exp(-dt * 0.5); // drift home once it's calm again
      f.ox *= settle;
      f.oz *= settle;

      pos[i * 3] = f.x; pos[i * 3 + 1] = f.y; pos[i * 3 + 2] = f.z;

      // soft pulse with long dark rests, all out of phase; the double
      // flashers add a second, dimmer blink close behind the first
      const gate = Math.sin(t * 0.13 + f.ph2 * 3.1) > -0.35 ? 1 : 0;
      const a = t * f.rate + f.ph;
      let b = pulse(a);
      if (f.dbl) b = Math.max(b, pulse(a - 0.62) * 0.7);
      b *= gate * k0 * (1 - f.fright * 0.85);
      col[i * 3] = b * f.cr;
      col[i * 3 + 1] = b * f.cg;
      col[i * 3 + 2] = b * f.cb;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  return { group, update, count: flies.length };
}
