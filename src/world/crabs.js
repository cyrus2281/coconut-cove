// Ghost crabs. Each one is a little procedural puppet (shell, eye stalks,
// claws, eight hip-pivoted legs) with a state machine: it wanders its home
// stretch of beach in darting bursts, freezes, flees the player, and — since
// it shares the swash-wave model — sprints uphill when a surge is about to
// roll over it. Crabs scuttle sideways, as crabs do.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius, beachAz } from './island.js';
import { runupNow, ZONES } from './swash.js';
import { subSeed } from '../core/seed.js';
import { buildCrab } from '../creatures/crab.js';

// find a spot on the beach band near an azimuth
// (the band is measured above the live waterline, so it rides the tide)
function beachPoint(homeAz, spread, rand, hMin = 0.12, hMax = 0.95) {
  const tide = uniforms.uTide.value;
  for (let tries = 0; tries < 12; tries++) {
    const az = homeAz + (rand() - 0.5) * spread;
    for (let r = shoreRadius(az) + 1.5; r > shoreRadius(az) - 10; r -= 0.6) {
      const x = Math.cos(az) * r, z = Math.sin(az) * r;
      const h = islandHeight(x, z);
      if (h - tide >= hMin && h - tide <= hMax) return { x, z, h };
    }
  }
  return null;
}

export function buildCrabs(player, footprints) {
  const group = new THREE.Group();
  group.name = 'crabs';

  const crabs = [];
  // one crab per surge beach, tinted by the seed...
  const tintRand = mulberry32(subSeed('crabTints'));
  const tint = () => new THREE.Color().setHSL(0.05 + tintRand() * 0.06, 0.5 + tintRand() * 0.2, 0.42 + tintRand() * 0.12);
  const defs = [
    { az: ZONES[0].az - 0.12, tint: tint(), chir: 1 },
    { az: ZONES[1].az + 0.08, tint: tint(), chir: -1 },
  ];
  // ...and some islands are simply crabbier: up to two more on their own
  // stretches of beach, so the population runs 2-4 with the seed
  const nRand = mulberry32(subSeed('crabCount'));
  const extras = nRand() < 0.55 ? 1 + (nRand() < 0.4 ? 1 : 0) : 0;
  for (let e = 0; e < extras; e++) {
    defs.push({
      az: beachAz(nRand, { avoid: defs.map((d) => d.az), sep: 0.35, margin: 0.1 }),
      tint: tint(),
      chir: nRand() < 0.5 ? 1 : -1,
    });
  }
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const rand = mulberry32(subSeed('crab' + i));
    const parts = buildCrab(def.tint);
    // fallback: partway down its own home beach ({0,0} is a mountain now)
    const fbR = shoreRadius(def.az) - 3;
    const start = beachPoint(def.az, 0.1, rand) || {
      x: Math.cos(def.az) * fbR,
      z: Math.sin(def.az) * fbR,
      h: islandHeight(Math.cos(def.az) * fbR, Math.sin(def.az) * fbR),
    };
    parts.group.position.set(start.x, start.h + 0.034, start.z);
    group.add(parts.group);
    crabs.push({
      ...parts,
      rand,
      homeAz: def.az,
      chir: def.chir,
      pos: new THREE.Vector2(start.x, start.z),
      h: start.h,
      target: null,
      dir: new THREE.Vector2(1, 0),
      speed: 0,
      state: 'pause',
      timer: 1 + rand() * 2,
      yaw: 0,
      gait: 0,
      bob: 0,
      trailAcc: 0,
      trailSide: 0,
    });
  }

  function steer(c, tx, tz, speed) {
    c.dir.set(tx - c.pos.x, tz - c.pos.y).normalize();
    c.speed = speed;
  }

  function update(t, dt) {
    for (const c of crabs) {
      const az = Math.atan2(c.pos.y, c.pos.x);
      c.timer -= dt;

      // 1) incoming surge? sprint inland (uses the shared swash model)
      const tide = uniforms.uTide.value;
      const runup = Math.max(runupNow(az, t), runupNow(az, t + 0.6));
      const threatened = c.h - tide < runup + 0.05;

      // 2) player too close?
      const pd = Math.hypot(player.pos.x - c.pos.x, player.pos.z - c.pos.y);

      if (threatened && c.state !== 'dash') {
        const inland = beachPoint(az, 0.06, c.rand, runup + 0.2, runup + 0.9);
        if (inland) {
          steer(c, inland.x, inland.z, 1.55);
        } else {
          // no dry spot found — just bolt straight up the beach
          c.dir.set(-Math.cos(az), -Math.sin(az));
          c.speed = 1.55;
        }
        c.state = 'dash';
        c.timer = 2.5;
      } else if (pd < 2.2 && c.state !== 'flee' && c.state !== 'dash') {
        // run away, mostly along the shore
        const awayX = (c.pos.x - player.pos.x) / pd, awayZ = (c.pos.y - player.pos.z) / pd;
        const tanX = -Math.sin(az) * Math.sign(awayX * -Math.sin(az) + awayZ * Math.cos(az) || 1);
        const tanZ = Math.cos(az) * Math.sign(awayX * -Math.sin(az) + awayZ * Math.cos(az) || 1);
        c.dir.set(awayX * 0.5 + tanX * 0.5, awayZ * 0.5 + tanZ * 0.5).normalize();
        c.speed = 1.6;
        c.state = 'flee';
        c.timer = 1.1;
      }

      if (c.timer <= 0) {
        if (c.state === 'walk' || c.state === 'flee' || c.state === 'dash') {
          c.state = 'pause';
          c.speed = 0;
          c.timer = 0.6 + c.rand() * 2.2;
        } else {
          const p = beachPoint(c.homeAz, 0.34, c.rand);
          if (p) {
            steer(c, p.x, p.z, 0.5 + c.rand() * 0.2);
            c.state = 'walk';
            c.timer = 1.2 + c.rand() * 1.6;
          } else {
            c.timer = 1;
          }
        }
      }

      // integrate, staying on the beach band — but never wall a crab in:
      // when the tide has swamped it (or left it stranded high), any step
      // that improves matters is allowed, so it can always climb back out
      if (c.speed > 0) {
        const nx = c.pos.x + c.dir.x * c.speed * dt;
        const nz = c.pos.y + c.dir.y * c.speed * dt;
        const nh = islandHeight(nx, nz);
        const relNext = nh - tide, relCur = c.h - tide;
        const inBand = relNext > -0.02 && relNext < 1.5;
        // a swamped crab may cross small submerged dips (else it gets
        // king-of-the-drowned-hill locked on a local crest), but never
        // deeper water; a stranded-high crab may step back down
        const escaping =
          (relCur <= -0.02 && relNext > Math.max(relCur - 0.05, -0.95)) ||
          (relCur >= 1.5 && relNext < relCur);
        if (inBand || escaping) {
          c.pos.set(nx, nz);
          c.h = nh;
          // tiny stitch tracks in the crab's wake
          c.trailAcc += c.speed * dt;
          if (footprints && c.trailAcc > 0.14) {
            c.trailAcc = 0;
            c.trailSide = 1 - c.trailSide;
            footprints.stamp(nx, nz, nh, c.dir.x, c.dir.y, c.trailSide, 1, 0.5);
          }
        } else {
          c.timer = 0; // walked off the band — pick a new plan
        }
      }

      // sideways facing with smooth turn
      if (c.speed > 0.01) {
        const targetYaw = Math.atan2(c.dir.x, c.dir.y) + c.chir * Math.PI / 2;
        let d = targetYaw - c.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        c.yaw += d * Math.min(dt * 7, 1);
      }

      // gait
      const stride = c.speed > 0.01 ? 1 : 0;
      c.gait += dt * (8 + c.speed * 26) * stride;
      c.bob = THREE.MathUtils.lerp(c.bob, stride, dt * 6);
      for (let i = 0; i < c.legs.length; i++) {
        const l = c.legs[i];
        l.hip.rotation.z = Math.sin(c.gait + l.phase) * 0.3 * c.bob;
      }
      const alarmed = c.state === 'flee' || c.state === 'dash';
      for (let i = 0; i < c.claws.length; i++) {
        const raise = alarmed ? -0.55 : -0.12 + Math.sin(t * 1.3 + i * 2.1) * 0.1;
        c.claws[i].rotation.x = THREE.MathUtils.lerp(c.claws[i].rotation.x, raise, dt * 5);
        // a spooked crab throws the claws up and gapes the pincers with them
        const jaw = c.claws[i].userData.jaw;
        const gape = alarmed ? -0.42 : -0.06 + Math.sin(t * 0.9 + i * 3.7) * 0.03;
        jaw.rotation.x = THREE.MathUtils.lerp(jaw.rotation.x, gape, dt * 5);
      }

      c.group.position.set(
        c.pos.x,
        c.h + 0.034 + Math.abs(Math.sin(c.gait * 0.5)) * 0.005 * c.bob,
        c.pos.y
      );
      c.group.rotation.y = c.yaw;
      c.group.rotation.z = Math.sin(c.gait * 0.5) * 0.03 * c.bob;
    }
  }

  return { group, update, crabs };
}
