// Gulls. They ride thermals over the bay in flap-burst-and-glide circles,
// and every so often one picks a stretch of dry beach (or the low-tide cay),
// glides down a curved approach, folds its wings and potters about — hopping,
// pecking, facing the breeze — until the player strolls too close or the
// rising tide licks its toes, at which point it flushes back into the sky.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius, cayCenter } from './island.js';

function buildGullMesh(bodyMat, wingMat, beakMat) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), bodyMat);
  body.scale.set(0.9, 0.75, 2.2);
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), bodyMat);
  head.position.set(0, 0.06, 0.22);
  g.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.07, 6), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.05, 0.3);
  g.add(beak);

  const wingGeo = new THREE.PlaneGeometry(0.52, 0.16, 3, 1);
  wingGeo.translate(0.26, 0, 0);
  const wp = wingGeo.attributes.position;
  for (let vi = 0; vi < wp.count; vi++) {
    const x = wp.getX(vi);
    wp.setY(vi, wp.getY(vi) * (1 - x * 0.9));
    wp.setZ(vi, -x * 0.22);
  }
  wingGeo.rotateX(-Math.PI / 2);

  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(0.05, 0.02, 0);
  g.add(wingL);
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.scale.x = -1;
  wingR.position.set(-0.05, 0.02, 0);
  g.add(wingR);

  return { group: g, wingL, wingR };
}

export function buildBirds(player, audio) {
  const group = new THREE.Group();
  group.name = 'gulls';
  const rand = mulberry32(subSeed('gulls'));
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.8 });
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xd8dadc, roughness: 0.8, side: THREE.DoubleSide,
  });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xd98a2b, roughness: 0.7 });

  const gulls = [];
  const N = 2 + Math.floor(rand() * 4); // 2-5 gulls, the seed decides
  for (let i = 0; i < N; i++) {
    const parts = buildGullMesh(bodyMat, wingMat, beakMat);
    group.add(parts.group);
    gulls.push({
      ...parts,
      r: 34 + rand() * 55,
      h: 22 + rand() * 22,
      speed: (0.05 + rand() * 0.035) * (rand() < 0.5 ? 1 : -1),
      a: rand() * Math.PI * 2,
      flapPhase: rand() * 10,
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
      fold: 0,       // 0 spread → 1 tucked
      hopT: 1,
      hopFrom: new THREE.Vector2(),
      hopTo: new THREE.Vector2(),
      hopK: 1,
      peck: 0,
    });
  }

  // a dry-enough landing patch: mostly the main beach, sometimes the cay
  function landingSpot(g) {
    const tide = uniforms.uTide.value;
    for (let tries = 0; tries < 14; tries++) {
      let x, z;
      if (tries % 4 === 3) {
        const c = cayCenter();
        const a = rand() * Math.PI * 2, rr = rand() * 5;
        x = c.x + Math.cos(a) * rr; z = c.z + Math.sin(a) * rr;
      } else {
        const az = rand() * Math.PI * 2;
        const r = shoreRadius(az) - 1 - rand() * 7;
        x = Math.cos(az) * r; z = Math.sin(az) * r;
      }
      const h = islandHeight(x, z);
      if (h - tide > 0.35 && h - tide < 1.4) return new THREE.Vector3(x, h, z);
    }
    return null;
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
        b.pos.set(x, y, z);
        b.cryT -= dt;
        if (b.cryT <= 0) {
          b.cryT = 16 + rand() * 32;
          if (audio) audio.gullCry(x, z);
        }
        b.yaw = -b.a - (b.speed > 0 ? 0 : Math.PI);
        b.group.rotation.z = 0.22 * Math.sign(b.speed);
        b.fold = Math.max(b.fold - dt * 2, 0);
        const gate = THREE.MathUtils.smoothstep(Math.sin(t * 0.43 + b.glideSeed), -0.2, 0.35);
        this._flap(b, Math.sin(t * 9 + b.flapPhase) * 0.85 * gate - 0.12);

        if (b.stateT <= 0) {
          const spot = landingSpot(b);
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
        const a2y = THREE.MathUtils.lerp(b.ctrl.y, b.target.y + 0.055, s);
        const a2z = THREE.MathUtils.lerp(b.ctrl.z, b.target.z, s);
        const nx = THREE.MathUtils.lerp(a1x, a2x, s);
        const ny = THREE.MathUtils.lerp(a1y, a2y, s);
        const nz = THREE.MathUtils.lerp(a1z, a2z, s);
        const dx = nx - b.pos.x, dz = nz - b.pos.z;
        if (dx * dx + dz * dz > 1e-8) b.yaw = Math.atan2(dx, dz);
        b.pos.set(nx, ny, nz);
        b.group.rotation.z *= 0.95;
        // glide in, flare with quick flaps at the very end
        const flare = s > 0.82 ? Math.sin(t * 16) * 0.7 : Math.sin(t * 2) * 0.06 - 0.05;
        this._flap(b, flare);
        if (b.stateT <= 0) {
          b.state = 'ground';
          b.stateT = 16 + rand() * 26;
          b.pos.set(b.target.x, b.target.y + 0.055, b.target.z);
          b.hopK = 1; b.hopT = 0.8 + rand() * 1.6;
        }
      } else if (b.state === 'ground') {
        b.fold = Math.min(b.fold + dt * 2.5, 1);
        this._flap(b, -0.58 * b.fold); // wings settle against the flanks
        b.group.rotation.z *= 0.9;

        // hop-walks to nearby spots
        b.hopT -= dt;
        if (b.hopK < 1) {
          b.hopK = Math.min(b.hopK + dt / 0.9, 1);
          const hx = THREE.MathUtils.lerp(b.hopFrom.x, b.hopTo.x, b.hopK);
          const hz = THREE.MathUtils.lerp(b.hopFrom.y, b.hopTo.y, b.hopK);
          const hh = islandHeight(hx, hz);
          b.pos.set(hx, hh + 0.055 + Math.abs(Math.sin(b.hopK * Math.PI * 3)) * 0.05, hz);
          const dx = b.hopTo.x - b.hopFrom.x, dz = b.hopTo.y - b.hopFrom.y;
          if (dx * dx + dz * dz > 1e-8) b.yaw = Math.atan2(dx, dz);
        } else if (b.hopT <= 0) {
          _v2.set(b.pos.x + (rand() - 0.5) * 3.2, b.pos.z + (rand() - 0.5) * 3.2);
          const hh = islandHeight(_v2.x, _v2.y);
          if (hh - tide > 0.3 && hh - tide < 1.5) {
            b.hopFrom.set(b.pos.x, b.pos.z);
            b.hopTo.copy(_v2);
            b.hopK = 0;
          }
          b.hopT = 1.4 + rand() * 2.6;
          if (rand() < 0.5) b.peck = Math.PI; // queue a peck
        }
        // peck nod
        if (b.peck > 0) {
          b.peck = Math.max(b.peck - dt * 7, 0);
          b.group.rotation.x = Math.sin(b.peck) * 0.5;
        } else {
          b.group.rotation.x *= 0.9;
        }

        const pd = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
        const soaked = islandHeight(b.pos.x, b.pos.z) - tide < 0.15;
        if (pd < b.shy || soaked || b.stateT <= 0) {
          b.state = 'flush';
          b.stateT = 4.5;
          if (audio) audio.gullCry(b.pos.x, b.pos.z); // indignant departure
          b.from.copy(b.pos);
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
          b.group.rotation.x = 0;
        }
      } else if (b.state === 'flush') {
        b.fold = Math.max(b.fold - dt * 4, 0);
        const k = 1 - Math.max(b.stateT, 0) / b.dur;
        const a1x = THREE.MathUtils.lerp(b.from.x, b.ctrl.x, k);
        const a1y = THREE.MathUtils.lerp(b.from.y, b.ctrl.y, k);
        const a1z = THREE.MathUtils.lerp(b.from.z, b.ctrl.z, k);
        const a2x = THREE.MathUtils.lerp(b.ctrl.x, b.target.x, k);
        const a2y = THREE.MathUtils.lerp(b.ctrl.y, b.target.y, k);
        const a2z = THREE.MathUtils.lerp(b.ctrl.z, b.target.z, k);
        const nx = THREE.MathUtils.lerp(a1x, a2x, k);
        const ny = THREE.MathUtils.lerp(a1y, a2y, k);
        const nz = THREE.MathUtils.lerp(a1z, a2z, k);
        const dx = nx - b.pos.x, dz = nz - b.pos.z;
        if (dx * dx + dz * dz > 1e-8) b.yaw = Math.atan2(dx, dz);
        b.pos.set(nx, ny, nz);
        this._flap(b, Math.sin(t * 15 + b.flapPhase) * 0.95); // panicked beats
        if (b.stateT <= 0) {
          b.state = 'soar';
          b.a = Math.atan2(b.pos.z, b.pos.x);
          b.r = THREE.MathUtils.clamp(Math.hypot(b.pos.x, b.pos.z), 34, 89);
          b.h = Math.max(b.pos.y, 20);
          b.stateT = 20 + rand() * 40;
        }
      }

      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
    }
  }

  const api = {
    group,
    update: (t, dt) => update.call(api, t, dt),
    gulls,
    _flap(b, angle) {
      b.wingL.rotation.z = angle;
      b.wingR.rotation.z = -angle;
    },
  };
  return api;
}
