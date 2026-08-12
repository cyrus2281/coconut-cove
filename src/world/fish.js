// Fish schools in the shallows. Each school is an anchor that drifts along
// the coast, sliding in and out so its patch of water stays at a comfortable
// depth as the tide moves. Fish swim little seeded ellipses around the
// anchor, wiggle, and burst away from a wading player, relaxing back to the
// school once the coast is clear. One InstancedMesh per school.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius } from './island.js';

function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 10, 7);
  body.scale(0.075, 0.021, 0.012);
  const tail = new THREE.BufferGeometry();
  // flat caudal fin: two triangles fanning back from the peduncle
  tail.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.070, 0, 0, -0.104, 0.020, 0, -0.096, 0.004, 0,
    -0.070, 0, 0, -0.096, -0.004, 0, -0.104, -0.020, 0,
  ], 3));
  tail.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
  tail.computeVertexNormals();
  return mergeGeometries([body.toNonIndexed(), tail]);
}

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

  const geo = fishGeometry();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x46606b, // dark dorsal slate — schools read as silhouettes from shore
    metalness: 0.35,
    roughness: 0.5,
  });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
    e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();

  const schools = SCHOOLS.map((def) => {
    const rand = mulberry32(def.seed);
    const inst = new THREE.InstancedMesh(geo, mat, def.count);
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
          // beached — hug what water there is and drift offshore
          fy = Math.max(gf + 0.05, tide - 0.1);
          const azF = Math.atan2(fz, fx);
          f.off.x += Math.cos(azF) * dt * 2.5;
          f.off.y += Math.sin(azF) * dt * 2.5;
        } else {
          const swim = avail - 0.3;
          fy = gf + 0.12 + swim * (0.25 + f.depthBias * 0.6)
            + Math.sin(t * 0.9 + f.vph) * 0.05;
          fy = Math.min(fy, tide - 0.15);
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

        e.set(0, f.yaw + Math.sin(t * 9 + i * 1.7) * 0.22, 0);
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
