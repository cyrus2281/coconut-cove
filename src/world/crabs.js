// Ghost crabs. Each one is a little procedural puppet (shell, eye stalks,
// claws, eight hip-pivoted legs) with a state machine: it wanders its home
// stretch of beach in darting bursts, freezes, flees the player, and — since
// it shares the swash-wave model — sprints uphill when a surge is about to
// roll over it. Crabs scuttle sideways, as crabs do.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius } from './island.js';
import { runupNow } from './swash.js';

const _v = new THREE.Vector3();

function tube(fx, fy, fz, tx, ty, tz, r1, r2) {
  const from = new THREE.Vector3(fx, fy, fz);
  const dir = new THREE.Vector3(tx - fx, ty - fy, tz - fz);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, 6);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(fx, fy, fz);
  return g;
}

function buildLegGeometry() {
  return mergeGeometries([
    tube(0, 0, 0, 0.046, -0.02, 0.004, 0.0042, 0.0034),
    tube(0.046, -0.02, 0.004, 0.08, -0.066, 0.007, 0.0032, 0.0008),
  ]);
}

function buildClawGeometry(sign) {
  const palm = new THREE.SphereGeometry(0.019, 10, 8);
  palm.scale(1.3, 0.85, 1.15);
  palm.translate(0.015 * sign, -0.002, 0.05);
  return mergeGeometries([
    tube(0, 0, 0, 0.012 * sign, -0.004, 0.032, 0.006, 0.0075),
    palm,
    tube(0.02 * sign, 0.004, 0.062, 0.026 * sign, 0.014, 0.078, 0.0048, 0.001),
  ]);
}

function buildCrab(tint) {
  const shellMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.62 });
  const legMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tint).multiplyScalar(0.72), roughness: 0.7,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.35 });

  const g = new THREE.Group();

  const shellGeo = new THREE.SphereGeometry(0.075, 18, 12);
  shellGeo.scale(1.28, 0.55, 0.95);
  const body = new THREE.Mesh(shellGeo, shellMat);
  body.position.y = 0.012;
  body.castShadow = true;
  g.add(body);

  const eyeGeo = mergeGeometries([
    tube(-0.02, 0.02, 0.06, -0.025, 0.05, 0.068, 0.0028, 0.0022),
    tube(0.02, 0.02, 0.06, 0.025, 0.05, 0.068, 0.0028, 0.0022),
    new THREE.SphereGeometry(0.0075, 8, 6).translate(-0.025, 0.054, 0.069),
    new THREE.SphereGeometry(0.0075, 8, 6).translate(0.025, 0.054, 0.069),
  ]);
  g.add(new THREE.Mesh(eyeGeo, darkMat));

  const claws = [];
  for (const sign of [-1, 1]) {
    const claw = new THREE.Mesh(buildClawGeometry(sign), shellMat);
    const pivot = new THREE.Group();
    pivot.position.set(0.05 * sign, 0.008, 0.055);
    pivot.rotation.y = -0.35 * sign;
    pivot.add(claw);
    claw.castShadow = true;
    g.add(pivot);
    claws.push(pivot);
  }

  const legGeo = buildLegGeometry();
  const legs = [];
  const zPos = [0.046, 0.017, -0.014, -0.046];
  const fan = [0.55, 0.2, -0.18, -0.55];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const hip = new THREE.Group();
      hip.position.set(0.055 * side, 0.004, zPos[i]);
      hip.rotation.y = (side > 0 ? 0 : Math.PI) + fan[i] * side;
      const leg = new THREE.Mesh(legGeo, legMat);
      hip.add(leg);
      g.add(hip);
      legs.push({ hip, phase: i * 2.4 + (side > 0 ? 0 : Math.PI) });
    }
  }

  return { group: g, claws, legs };
}

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

export function buildCrabs(player) {
  const group = new THREE.Group();
  group.name = 'crabs';

  const crabs = [];
  const defs = [
    { az: 1.50, tint: 0xb55c32, chir: 1 },   // surge-zone beach, near spawn
    { az: 3.42, tint: 0xc98a52, chir: -1 },  // by the rocks
  ];
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const rand = mulberry32(7000 + i * 131);
    const parts = buildCrab(def.tint);
    const start = beachPoint(def.az, 0.1, rand) || { x: 0, z: 0, h: 1 };
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
        const inland = beachPoint(az, 0.06, c.rand, runup + 0.25, runup + 0.6);
        if (inland) {
          steer(c, inland.x, inland.z, 1.55);
          c.state = 'dash';
          c.timer = 2.5;
        }
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

      // integrate, staying on the beach band
      if (c.speed > 0) {
        const nx = c.pos.x + c.dir.x * c.speed * dt;
        const nz = c.pos.y + c.dir.y * c.speed * dt;
        const nh = islandHeight(nx, nz);
        if (nh - tide > -0.02 && nh - tide < 1.5) {
          c.pos.set(nx, nz);
          c.h = nh;
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
