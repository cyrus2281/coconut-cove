// Gulls. They ride thermals over the bay in flap-burst-and-glide circles,
// and every so often one picks a stretch of dry beach (or the low-tide cay),
// glides down a curved approach on reaching legs, shuts its wings and potters
// about — pivoting, walking, pecking — until the player strolls too close or
// the rising tide licks its toes, at which point it flushes back into the sky.
// The gull asset owns the animation set; this file only decides which clip
// each behaviour calls for.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius, cayCenter, isSandyShore, shoreRange } from './island.js';
import { buildGull, gullAssets } from '../creatures/gull.js';

const WALK_SPEED = 0.30;   // m/s: an unhurried potter along the sand
const TURN_RATE = 2.2;     // rad/s: how fast a standing gull pivots

export function buildBirds(player, audio) {
  const group = new THREE.Group();
  group.name = 'gulls';
  const rand = mulberry32(subSeed('gulls'));

  const gulls = [];
  const kit = gullAssets();   // textures and geometry, shared by the flock
  const N = 2 + Math.floor(rand() * 4); // 2-5 gulls, the seed decides
  const meanShore = (shoreRange().min + shoreRange().max) / 2;
  for (let i = 0; i < N; i++) {
    const parts = buildGull(kit, rand);
    group.add(parts.group);
    gulls.push({
      ...parts,
      r: (0.35 + rand() * 0.75) * meanShore,
      h: 24 + rand() * 26,
      speed: (0.05 + rand() * 0.035) * (rand() < 0.5 ? 1 : -1),
      a: rand() * Math.PI * 2,
      glideSeed: rand() * 100,
      state: 'soar',
      stateT: 14 + rand() * 30 + i * 12,
      shy: 7, // flush when the player gets this close
      cryT: 8 + rand() * 25,
      pos: new THREE.Vector3(),
      from: new THREE.Vector3(),
      ctrl: new THREE.Vector3(),
      target: new THREE.Vector3(),
      dur: 1,
      yaw: 0,
      bank: 0,
      pitch: 0,
      walking: false,
      walkTo: new THREE.Vector2(),
      walkT: 1 + rand() * 3,
    });
  }

  // a dry-enough landing patch: mostly the main beach, sometimes the cay
  function landingSpot() {
    const tide = uniforms.uTide.value;
    for (let tries = 0; tries < 14; tries++) {
      let x, z;
      if (tries % 4 === 3) {
        const c = cayCenter();
        const a = rand() * Math.PI * 2, rr = rand() * 5;
        x = c.x + Math.cos(a) * rr; z = c.z + Math.sin(a) * rr;
      } else {
        const az = rand() * Math.PI * 2;
        if (!isSandyShore(az)) continue; // gulls loaf on sand, not cliff toes
        const r = shoreRadius(az) - 1 - rand() * 7;
        x = Math.cos(az) * r; z = Math.sin(az) * r;
      }
      const h = islandHeight(x, z);
      if (h - tide > 0.35 && h - tide < 1.4) return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  // ease the heading the short way round, so a gull pivots on the spot
  // instead of snapping to face its next few steps
  function turnTo(b, heading, dt, rate) {
    const d = Math.atan2(Math.sin(heading - b.yaw), Math.cos(heading - b.yaw));
    b.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
  }

  const _v2 = new THREE.Vector2();

  function update(t, dt) {
    const tide = uniforms.uTide.value;
    for (const b of gulls) {
      b.stateT -= dt;

      if (b.state === 'soar') {
        b.a += b.speed * dt;
        const x = Math.cos(b.a) * b.r;
        const z = Math.sin(b.a) * b.r;
        const y = b.h + Math.sin(t * 0.3 + b.glideSeed) * 3;
        // an orbit that crosses the mountains rides up over them
        b.pos.set(x, Math.max(y, islandHeight(x, z) + 10), z);
        b.cryT -= dt;
        if (b.cryT <= 0) {
          b.cryT = 16 + rand() * 32;
          if (audio) audio.gullCry(x, z);
        }
        b.yaw = -b.a - (b.speed > 0 ? 0 : Math.PI);
        b.bank = 0.22 * Math.sign(b.speed);
        b.pitch = 0;
        b.play('fly');
        b.update(dt);

        if (b.stateT <= 0) {
          const spot = landingSpot();
          if (spot) {
            b.state = 'descend';
            b.from.copy(b.pos);
            b.target.copy(spot);
            // curved approach: overshoot control point out over the water
            const azT = Math.atan2(spot.z, spot.x);
            b.ctrl.set(
              (b.from.x + spot.x) / 2 + Math.cos(azT) * 14,
              (b.from.y + spot.y) / 2 + 2,
              (b.from.z + spot.z) / 2 + Math.sin(azT) * 14
            );
            b.dur = Math.max(b.from.distanceTo(spot) / 7.5, 2.5);
            b.stateT = b.dur;
          } else {
            b.stateT = 8;
          }
        }
      } else if (b.state === 'descend') {
        const k = 1 - Math.max(b.stateT, 0) / b.dur;
        const s = k * k * (3 - 2 * k);
        // quadratic bezier glide
        const a1x = THREE.MathUtils.lerp(b.from.x, b.ctrl.x, s);
        const a1y = THREE.MathUtils.lerp(b.from.y, b.ctrl.y, s);
        const a1z = THREE.MathUtils.lerp(b.from.z, b.ctrl.z, s);
        const a2x = THREE.MathUtils.lerp(b.ctrl.x, b.target.x, s);
        const a2y = THREE.MathUtils.lerp(b.ctrl.y, b.target.y + b.standY, s);
        const a2z = THREE.MathUtils.lerp(b.ctrl.z, b.target.z, s);
        const nx = THREE.MathUtils.lerp(a1x, a2x, s);
        // the glide path never clips a dune or ridge on the way in
        const ny = Math.max(THREE.MathUtils.lerp(a1y, a2y, s), islandHeight(nx, THREE.MathUtils.lerp(a1z, a2z, s)) + 0.2);
        const nz = THREE.MathUtils.lerp(a1z, a2z, s);
        const dx = nx - b.pos.x, dz = nz - b.pos.z;
        if (dx * dx + dz * dz > 1e-8) b.yaw = Math.atan2(dx, dz);
        b.pos.set(nx, ny, nz);
        b.bank *= 0.95;
        // long glide in, legs reaching, then a braking flurry at the flare
        b.pitch += ((s > 0.82 ? 0.20 : -0.06) - b.pitch) * Math.min(dt * 3, 1);
        b.play(s > 0.82 ? 'flap' : 'glide');
        b.update(dt, { gear: THREE.MathUtils.smoothstep(s, 0.5, 0.95), rate: 1.35 });
        if (b.stateT <= 0) {
          b.state = 'ground';
          b.stateT = 16 + rand() * 26;
          b.pos.set(b.target.x, b.target.y + b.standY, b.target.z);
          b.walking = false;
          b.walkT = 0.8 + rand() * 1.6;
        }
      } else if (b.state === 'ground') {
        b.bank *= 0.9;
        b.pitch *= 0.88;
        if (b.walking) {
          const dx = b.walkTo.x - b.pos.x, dz = b.walkTo.y - b.pos.z;
          const dist = Math.hypot(dx, dz);
          const heading = Math.atan2(dx, dz);
          turnTo(b, heading, dt, TURN_RATE);
          // only make ground once it is roughly pointed the right way
          const aligned = Math.abs(Math.atan2(Math.sin(heading - b.yaw),
            Math.cos(heading - b.yaw))) < 0.35;
          const step = aligned ? WALK_SPEED * dt : 0;
          if (dist <= step || dist < 0.04) {
            b.walking = false;
            b.walkT = 1.6 + rand() * 3.4;
          } else if (step > 0) {
            const nx = b.pos.x + (dx / dist) * step, nz = b.pos.z + (dz / dist) * step;
            b.pos.set(nx, islandHeight(nx, nz) + b.standY, nz);
          }
          b.play('walk');
          b.update(dt, { speed: WALK_SPEED });
        } else {
          b.walkT -= dt;
          if (b.walkT <= 0) {
            _v2.set(b.pos.x + (rand() - 0.5) * 3.2, b.pos.z + (rand() - 0.5) * 3.2);
            const hh = islandHeight(_v2.x, _v2.y);
            if (hh - tide > 0.3 && hh - tide < 1.5) {
              b.walkTo.copy(_v2);
              b.walking = true;
            }
            b.walkT = 1.4 + rand() * 2.6;
          }
          b.play('ground');
          b.update(dt);
        }

        const pd = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
        const soaked = islandHeight(b.pos.x, b.pos.z) - tide < 0.15;
        if (pd < b.shy || soaked || b.stateT <= 0) {
          b.state = 'flush';
          b.stateT = 4.5;
          if (audio) audio.gullCry(b.pos.x, b.pos.z); // indignant departure
          b.from.copy(b.pos);
          b.walking = false;
          const away = Math.atan2(b.pos.z - player.pos.z, b.pos.x - player.pos.x);
          b.target.set(
            b.pos.x + Math.cos(away) * 30,
            b.pos.y + 16,
            b.pos.z + Math.sin(away) * 30
          );
          b.ctrl.set(
            (b.from.x + b.target.x) / 2,
            b.from.y + 5,
            (b.from.z + b.target.z) / 2
          );
          b.dur = 4.5;
        }
      } else if (b.state === 'flush') {
        const k = 1 - Math.max(b.stateT, 0) / b.dur;
        const a1x = THREE.MathUtils.lerp(b.from.x, b.ctrl.x, k);
        const a1y = THREE.MathUtils.lerp(b.from.y, b.ctrl.y, k);
        const a1z = THREE.MathUtils.lerp(b.from.z, b.ctrl.z, k);
        const a2x = THREE.MathUtils.lerp(b.ctrl.x, b.target.x, k);
        const a2y = THREE.MathUtils.lerp(b.ctrl.y, b.target.y, k);
        const a2z = THREE.MathUtils.lerp(b.ctrl.z, b.target.z, k);
        const nx = THREE.MathUtils.lerp(a1x, a2x, k);
        const nz = THREE.MathUtils.lerp(a1z, a2z, k);
        const ny = Math.max(THREE.MathUtils.lerp(a1y, a2y, k), islandHeight(nx, nz) + 0.4);
        const dx = nx - b.pos.x, dz = nz - b.pos.z;
        if (dx * dx + dz * dz > 1e-8) b.yaw = Math.atan2(dx, dz);
        b.pos.set(nx, ny, nz);
        // panicked beats, nose up out of the takeoff, easing level again
        b.pitch += ((k < 0.5 ? 0.26 : 0) - b.pitch) * Math.min(dt * 2.5, 1);
        b.play('flap');
        b.update(dt, { rate: 1.5 });
        if (b.stateT <= 0) {
          b.state = 'soar';
          b.a = Math.atan2(b.pos.z, b.pos.x);
          b.r = THREE.MathUtils.clamp(Math.hypot(b.pos.x, b.pos.z), meanShore * 0.3, meanShore * 1.1);
          b.h = Math.max(b.pos.y, 24);
          b.stateT = 20 + rand() * 40;
        }
      }

      b.group.position.copy(b.pos);
      b.group.rotation.set(b.pitch, b.yaw, b.bank);
    }
  }

  return { group, update, gulls };
}
