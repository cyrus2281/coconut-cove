// Fish schools in the shallows. Each school is an anchor that drifts along
// the coast, sliding in and out so its patch of water stays at a comfortable
// depth as the tide moves. Fish swim little seeded ellipses around the
// anchor, wiggle, and burst away from a wading player, relaxing back to the
// school once the coast is clear. One InstancedMesh per school.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius } from './island.js';
import { holdUnder, bodyFromGeometry } from './swim.js';
import { silversideAsset } from '../creatures/shorefish.js';
import { wigAttribute } from '../creatures/fishcraft.js';

// school homes are grown from the island seed inside buildFish

export function buildFish(player) {
  const group = new THREE.Group();
  group.name = 'fish';

  const seedRand = mulberry32(subSeed('fish'));
  const azA = seedRand() * Math.PI * 2;
  const SCHOOLS = [
    { az: azA, count: 22 + Math.floor(seedRand() * 5), depth: 0.7, seed: subSeed('schoolA') },
    { az: azA + 2 + seedRand() * 2, count: 18 + Math.floor(seedRand() * 5), depth: 1.2, seed: subSeed('schoolB') },
  ];

  const asset = silversideAsset();
  // what a silverside takes up over and under its own midline: how much water
  // the clamps have to leave around one (see world/swim.js)
  const body = bodyFromGeometry(asset.geo, 0.08);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
    e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();

  const schools = SCHOOLS.map((def) => {
    const rand = mulberry32(def.seed);
    // per-school geometry clone so each carries its own swim-phase attribute
    const geo = wigAttribute(asset.geo.clone(), def.count, rand);
    const inst = new THREE.InstancedMesh(geo, asset.mat, def.count);
    inst.frustumCulled = false;
    group.add(inst);
    const fish = [];
    for (let i = 0; i < def.count; i++) {
      fish.push({
        a: 0.8 + rand() * 2.4,          // ellipse radii
        b: 0.6 + rand() * 1.8,
        th: rand() * Math.PI * 2,       // ellipse phase
        sp: 0.35 + rand() * 0.4,        // orbit speed (rad/s)
        vph: rand() * Math.PI * 2,      // vertical bob phase
        depthBias: rand(),
        size: 1.1 + rand() * 0.7,
        flee: new THREE.Vector2(),      // burst velocity
        off: new THREE.Vector2(),       // displaced offset (relaxes to 0)
        px: 0, pz: 0, yaw: 0,
      });
    }
    return {
      ...def,
      rand,
      inst,
      fish,
      azC: def.az,
      r: shoreRadius(def.az) + 14,
      wanderPh: rand() * 10,
    };
  });

  function update(t, dt) {
    const tide = uniforms.uTide.value;
    for (const s of schools) {
      // anchor drifts along the coast and breathes with it
      s.azC += Math.sin(t * 0.021 + s.wanderPh) * 0.011 * dt;
      const ax0 = Math.cos(s.azC), az0 = Math.sin(s.azC);
      const g = islandHeight(ax0 * s.r, az0 * s.r);
      const err = g - (tide - s.depth); // + = too shallow, slide offshore
      s.r += THREE.MathUtils.clamp(err * 4, -1, 1) * dt * 2.5;
      s.r = THREE.MathUtils.clamp(
        s.r, shoreRadius(s.azC) + 3, shoreRadius(s.azC) + 42);
      // the mean shoreline is not the waterline: at low tide the sea has drawn
      // several metres down the beach, and that inner bound can then sit on wet
      // sand with the school on it. Walk the anchor out until the water it needs
      // is really there, however far the tide has taken it.
      for (let k = 0; k < 12 && tide - islandHeight(ax0 * s.r, az0 * s.r) < 0.3; k++) {
        s.r += 1.2;
      }
      const sx = ax0 * s.r, sz = az0 * s.r;

      for (let i = 0; i < s.fish.length; i++) {
        const f = s.fish[i];
        f.th += f.sp * dt;

        // burst away from a wading player, then relax home
        const fxw = sx + Math.cos(f.th) * f.a + f.off.x;
        const fzw = sz + Math.sin(f.th) * f.b + f.off.y;
        const pdx = fxw - player.pos.x, pdz = fzw - player.pos.z;
        const pd = Math.hypot(pdx, pdz);
        if (pd < 4.5 && pd > 0.001) {
          const push = 5.0 * (1 - pd / 4.5);
          f.flee.x += (pdx / pd) * push * dt * 8;
          f.flee.y += (pdz / pd) * push * dt * 8;
        }
        const damp = Math.exp(-dt * 1.6);
        f.flee.multiplyScalar(damp);
        f.off.x += f.flee.x * dt;
        f.off.y += f.flee.y * dt;
        f.off.multiplyScalar(Math.exp(-dt * 0.4));

        let fx = sx + Math.cos(f.th) * f.a + f.off.x;
        let fz = sz + Math.sin(f.th) * f.b + f.off.y;

        // stay in water: depth available at this spot
        const gf = islandHeight(fx, fz);
        const avail = tide - gf;
        let fy;
        if (avail < 0.25) {
          // beached — hug what water there is and slide back out. Whatever
          // pushed the fish up here loses its hold: a diver wading into the
          // school may scatter it, but may not herd a fish onto the sand and
          // pin it there while the water it needs is a metre behind it.
          fy = holdUnder(gf + 0.05, fx, fz, gf, body, f.size);
          f.flee.set(0, 0);
          const azF = Math.atan2(fz, fx);
          f.off.x += Math.cos(azF) * dt * 2.5;
          f.off.y += Math.sin(azF) * dt * 2.5;
        } else {
          const swim = avail - 0.3;
          fy = gf + 0.12 + swim * (0.25 + f.depthBias * 0.6)
            + Math.sin(t * 0.9 + f.vph) * 0.05;
          fy = holdUnder(fy, fx, fz, gf, body, f.size);
        }

        // heading from actual motion + wiggle
        const mvx = fx - f.px, mvz = fz - f.pz;
        if (mvx * mvx + mvz * mvz > 1e-8) {
          const targetYaw = Math.atan2(-mvz, mvx); // model +x = nose
          let d = targetYaw - f.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          f.yaw += d * Math.min(dt * 6, 1);
        }
        f.px = fx; f.pz = fz;

        // the tail swims in the shader now; keep only a whisper of body yaw
        e.set(0, f.yaw + Math.sin(t * 9 + i * 1.7) * 0.05, 0);
        q.setFromEuler(e);
        v.set(fx, fy, fz);
        sc.setScalar(f.size);
        m.compose(v, q, sc);
        s.inst.setMatrixAt(i, m);
      }
      s.inst.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, update, schools };
}
