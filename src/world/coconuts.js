// Loose coconuts you can boot around the island. Walk into one and it
// takes the kick: it arcs, bounces, rolls downhill on the analytic height
// field, and if it lands in water it floats — bobbing on the swell, shoved
// up the beach by the bore and dragged back by the backwash through the
// same swash model that moves everything else. Nuts that drift past the
// shelf get quietly washed back ashore beside a palm.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, islandNormal, shoreRadius, waterLevelAt } from './island.js';
import { runupNow, runupVel } from './swash.js';
import { huskTexture } from '../core/textures.js';

const GRAV = 16;
const N_NUTS = 7;

export function buildCoconuts(player, trees, audio) {
  const group = new THREE.Group();
  group.name = 'coconuts';
  const rand = mulberry32(subSeed('nuts'));

  const geo = new THREE.SphereGeometry(1, 12, 9);
  const tex = huskTexture();
  const nuts = [];

  for (let i = 0; i < N_NUTS && trees.length; i++) {
    const t = trees[Math.floor(rand() * trees.length)];
    const a = rand() * Math.PI * 2;
    const d = 1.2 + rand() * 3.2;
    const x = t.base.x + Math.cos(a) * d;
    const z = t.base.z + Math.sin(a) * d;
    const r = 0.115 + rand() * 0.03;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.9,
      color: new THREE.Color().setHSL(0.09 + rand() * 0.03, 0.35 + rand() * 0.2, 0.32 + rand() * 0.1),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(r).multiply(new THREE.Vector3(1, 0.86, 1));
    mesh.castShadow = true;
    mesh.position.set(x, islandHeight(x, z) + r * 0.8, z);
    mesh.rotation.set(rand() * 6.3, rand() * 6.3, 0);
    group.add(mesh);
    nuts.push({
      mesh, r,
      vel: new THREE.Vector3(),
      cooldown: 0,
      lostT: 0, // time spent far out at sea
      home: t.base.clone(),
    });
  }

  const _n = new THREE.Vector3(), _axis = new THREE.Vector3(), _flat = new THREE.Vector3();

  function update(t, dt) {
    const tide = uniforms.uTide.value;
    for (const nut of nuts) {
      const m = nut.mesh;
      const p = m.position;
      nut.cooldown -= dt;

      // ---- the kick: walk into a nut and it flies ----
      const pdx = p.x - player.pos.x, pdz = p.z - player.pos.z;
      const pd = Math.hypot(pdx, pdz);
      const pSpeed = Math.hypot(player.vel.x, player.vel.z);
      if (pd < 0.55 && nut.cooldown <= 0 && pSpeed > 0.6 &&
          player.pos.y - 1.66 < p.y + 0.5) {
        nut.cooldown = 0.35;
        // a bump at walking pace, a real punt at a sprint
        const kick = 1.3 + pSpeed * 0.72;
        nut.vel.set(
          (pdx / pd) * kick + player.vel.x * 0.18,
          0.9 + pSpeed * 0.26,
          (pdz / pd) * kick + player.vel.z * 0.18
        );
        if (audio && audio.thock) audio.thock(p.x, p.z);
      }

      const ground = islandHeight(p.x, p.z);
      const water = waterLevelAt(p.x, p.z);
      const floating = water - ground > nut.r * 1.6 && p.y - nut.r < water + 0.05;

      // swash force, shared by floaters and shallow-grounded nuts: the bore
      // shoves inland harder than the backwash pulls out, so loose nuts end
      // up stranded on the wet apron like real flotsam
      const az = Math.atan2(p.z, p.x);
      const rel = ground - tide;
      const ru = runupNow(az, t);
      let swx = 0, swz = 0;
      if (rel > -0.6 && rel < ru) {
        const rv = runupVel(az, t);
        const s = THREE.MathUtils.clamp(rv * 6.5, -1.7, 3.2) * (rv > 0 ? 1.0 : 0.45);
        swx = -Math.cos(az) * s;
        swz = -Math.sin(az) * s;
      }

      if (floating) {
        // ---- afloat: bob, and let the swash work it over ----
        p.y += ((water + Math.sin(t * 1.7 + p.x * 0.7 + p.z * 0.5) * 0.05 - nut.r * 0.25) - p.y)
          * Math.min(dt * 4, 1);
        nut.vel.x += swx * dt * 3;
        nut.vel.z += swz * dt * 3;
        if (!swx && water - ground > 0.5 && Math.hypot(p.x, p.z) > shoreRadius(az) - 2) {
          // open sea: a slow set carries flotsam along and out
          nut.vel.x += Math.cos(az + 2.2) * dt * 0.5;
          nut.vel.z += Math.sin(az + 2.2) * dt * 0.5;
        }
        nut.vel.multiplyScalar(Math.max(1 - dt * 1.6, 0)); // water drag
        nut.vel.y = 0;
        p.x += nut.vel.x * dt;
        p.z += nut.vel.z * dt;

        // long gone? wash it back up beside its palm
        const azNow = Math.atan2(p.z, p.x);
        if (Math.hypot(p.x, p.z) > shoreRadius(azNow) + 22) nut.lostT += dt;
        else nut.lostT = 0;
        if (nut.lostT > 4) {
          nut.lostT = 0;
          const a2 = Math.random() * Math.PI * 2;
          p.set(nut.home.x + Math.cos(a2) * 2, 0, nut.home.z + Math.sin(a2) * 2);
          p.y = islandHeight(p.x, p.z) + nut.r * 0.8;
          nut.vel.set(0, 0, 0);
        }
        continue;
      }

      // ---- airborne / rolling on sand ----
      nut.vel.y -= GRAV * dt;
      p.addScaledVector(nut.vel, dt);

      const g2 = islandHeight(p.x, p.z);
      if (p.y - nut.r * 0.8 <= g2) {
        p.y = g2 + nut.r * 0.8;
        _n.copy(islandNormal(p.x, p.z, 0.3));
        const vn = nut.vel.dot(_n);
        if (vn < -0.9) {
          // bounce, losing most of it to the sand
          nut.vel.addScaledVector(_n, -vn * 1.35);
          nut.vel.multiplyScalar(0.42);
        } else {
          // rolling: kill the normal component, slide downhill, rub off speed
          nut.vel.addScaledVector(_n, -vn);
          nut.vel.x += _n.x * GRAV * 0.55 * dt;
          nut.vel.z += _n.z * GRAV * 0.55 * dt;
          // ankle-deep in the swash sheet, the waves still push it around
          if (water > ground && (swx || swz)) {
            nut.vel.x += swx * dt * 2.4;
            nut.vel.z += swz * dt * 2.4;
          }
          const wetDrag = water > ground ? 3.1 : 1.9;
          const drag = Math.max(1 - dt * wetDrag, 0);
          nut.vel.x *= drag;
          nut.vel.z *= drag;
          if (nut.vel.lengthSq() < 0.006) nut.vel.set(0, 0, 0);
        }
      }

      // visual roll about the axis perpendicular to travel
      _flat.set(nut.vel.x, 0, nut.vel.z);
      const sp = _flat.length();
      if (sp > 0.02) {
        _axis.set(_flat.z / sp, 0, -_flat.x / sp);
        m.rotateOnWorldAxis(_axis, (sp * dt) / (nut.r * 0.9));
      }
    }
  }

  return { group, update, nuts };
}
