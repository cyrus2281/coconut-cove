// Everything that swims. Reef fish schools (sergeant majors, tangs,
// butterflyfish, an emperor angelfish, parrotfish), clownfish keeping to
// their anemones, a shimmering fusilier bait ball, patrolling blacktip reef
// sharks, stingrays gliding over the seagrass, cruising green sea turtles
// that rise to breathe, moon jellies pulsing near the surface, and a moray
// eel leaning out of its den. This file is the brains only — every body
// is built in src/creatures/ (species.js, ray.js, turtle.js, jelly.js,
// eel.js, shark.js) and can be inspected alone on the /components page.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius } from './island.js';
import { wigAttribute } from '../creatures/fishcraft.js';
import { speciesLibrary } from '../creatures/species.js';
import { rayGeometry, rayMaterial } from '../creatures/ray.js';
import { jellyGeometry, jellyMaterial } from '../creatures/jelly.js';
import { buildEel } from '../creatures/eel.js';
import { buildShark } from '../creatures/shark.js';
import { buildSwimTurtleMesh } from '../creatures/turtle.js';

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3(),
  _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion(),
  _up = new THREE.Vector3(0, 1, 0), _zAxis = new THREE.Vector3(0, 0, 1),
  _xAxis = new THREE.Vector3(1, 0, 0);

function composeFish(inst, i, x, y, z, yaw, pitch, roll, size) {
  _q.setFromAxisAngle(_up, yaw);
  _qp.setFromAxisAngle(_zAxis, pitch);
  _q.multiply(_qp);
  if (roll) {
    _qr.setFromAxisAngle(_xAxis, roll);
    _q.multiply(_qr);
  }
  _v.set(x, y, z);
  _s.setScalar(size);
  _m.compose(_v, _q, _s);
  inst.setMatrixAt(i, _m);
}

// the same yaw/pitch/roll order, but onto an object's own transform: for the
// creatures whose bodies are flexed on the CPU instead of in an instanced
// vertex shader (the shark)
function poseCreature(obj, x, y, z, yaw, pitch, roll, size) {
  _q.setFromAxisAngle(_up, yaw);
  _qp.setFromAxisAngle(_zAxis, pitch);
  _q.multiply(_qp);
  if (roll) {
    _qr.setFromAxisAngle(_xAxis, roll);
    _q.multiply(_qr);
  }
  obj.position.set(x, y, z);
  obj.quaternion.copy(_q);
  obj.scale.setScalar(size);
}

// ------------------------------------------------------------ school brain
// One instanced mesh + simple 3D flocking-lite: seeded ellipse orbits around
// an anchor, height held between the sea floor and the surface, burst-and-
// relax flight from the player. (A 3D cousin of the shorefish in fish.js.)
function makeSchool({
  geo, mat, count, rand, anchor, spread = 2.2, hover = [0.3, 0.75],
  speed = [0.4, 0.8], sizeRange = [0.85, 1.25], fleeR = 4.2, name,
}) {
  // clone: two schools of one species must not share an aWig attribute
  geo = geo.clone();
  wigAttribute(geo, count, rand);
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.frustumCulled = false;
  inst.name = name;
  const fish = [];
  for (let i = 0; i < count; i++) {
    fish.push({
      a: spread * (0.35 + rand() * 0.65),
      b: spread * (0.3 + rand() * 0.6),
      th: rand() * Math.PI * 2,
      sp: speed[0] + rand() * (speed[1] - speed[0]),
      vph: rand() * Math.PI * 2,
      hb: hover[0] + rand() * (hover[1] - hover[0]),
      size: sizeRange[0] + rand() * (sizeRange[1] - sizeRange[0]),
      flee: new THREE.Vector2(),
      off: new THREE.Vector2(),
      px: anchor.x, py: 0, pz: anchor.z, yaw: rand() * Math.PI * 2, pitch: 0,
    });
  }
  function update(t, dt, player) {
    const tide = uniforms.uTide.value;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      f.th += f.sp * dt;
      let fx = anchor.x + Math.cos(f.th) * f.a + f.off.x;
      let fz = anchor.z + Math.sin(f.th) * f.b + f.off.y;

      // burst away from the diver, then relax home
      const pdx = fx - player.pos.x, pdz = fz - player.pos.z;
      const pdy = f.py - player.pos.y;
      const pd = Math.sqrt(pdx * pdx + pdz * pdz + pdy * pdy);
      if (pd < fleeR && pd > 0.001) {
        const push = 5.5 * (1 - pd / fleeR);
        const ph = Math.hypot(pdx, pdz) || 1e-4;
        f.flee.x += (pdx / ph) * push * dt * 8;
        f.flee.y += (pdz / ph) * push * dt * 8;
      }
      f.flee.multiplyScalar(Math.exp(-dt * 1.6));
      f.off.x += f.flee.x * dt;
      f.off.y += f.flee.y * dt;
      f.off.multiplyScalar(Math.exp(-dt * 0.4));
      fx = anchor.x + Math.cos(f.th) * f.a + f.off.x;
      fz = anchor.z + Math.sin(f.th) * f.b + f.off.y;

      const g = islandHeight(fx, fz);
      const avail = tide - g;
      let fy = g + 0.3 + Math.max(avail - 0.8, 0) * f.hb
        + Math.sin(t * 0.9 + f.vph) * 0.09;
      fy = THREE.MathUtils.clamp(fy, g + 0.22, tide - 0.35);

      const mvx = fx - f.px, mvy = fy - f.py, mvz = fz - f.pz;
      if (mvx * mvx + mvz * mvz > 1e-9) {
        const targetYaw = Math.atan2(-mvz, mvx);
        let d = targetYaw - f.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        f.yaw += d * Math.min(dt * 5, 1);
        const targetPitch = THREE.MathUtils.clamp(
          Math.atan2(mvy, Math.hypot(mvx, mvz)), -0.5, 0.5);
        f.pitch += (targetPitch - f.pitch) * Math.min(dt * 4, 1);
      }
      f.px = fx; f.py = fy; f.pz = fz;
      composeFish(inst, i, fx, fy, fz, f.yaw, f.pitch, 0, f.size);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
  return { inst, update };
}

// clownfish never leave their anemone; when the diver looms they tuck in
function makeClownfish(lib, anemones, rand) {
  const geo = lib.clownfish.geo.clone();
  const mat = lib.clownfish.mat;
  const homes = anemones.slice(0, 6);
  const per = 2;
  const count = homes.length * per;
  if (!count) return null;
  const rand2 = rand;
  wigAttribute(geo, count, rand2);
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.frustumCulled = false;
  inst.name = 'clownfish';
  const fish = [];
  for (let hI = 0; hI < homes.length; hI++) {
    for (let j = 0; j < per; j++) {
      fish.push({
        home: homes[hI],
        r: 0.22 + rand2() * 0.3,
        th: rand2() * Math.PI * 2,
        sp: (1.4 + rand2() * 1.2) * (rand2() < 0.5 ? 1 : -1),
        vph: rand2() * Math.PI * 2,
        size: 0.8 + rand2() * 0.5,
        yaw: 0, hide: 0,
      });
    }
  }
  function update(t, dt, player) {
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      const pd = Math.hypot(
        f.home.x - player.pos.x, f.home.y - player.pos.y, f.home.z - player.pos.z);
      const hideT = pd < 2.4 ? 1 : 0; // tuck into the tentacles
      f.hide += (hideT - f.hide) * Math.min(dt * 2.5, 1);
      f.th += f.sp * (1 + f.hide * 1.5) * dt;
      const r = f.r * (1 - f.hide * 0.7);
      const x = f.home.x + Math.cos(f.th) * r;
      const z = f.home.z + Math.sin(f.th) * r;
      const y = f.home.y + 0.1 + Math.sin(t * 1.7 + f.vph) * 0.07 * (1 - f.hide)
        - f.hide * 0.08;
      const targetYaw = Math.atan2(
        -(Math.cos(f.th) * Math.sign(f.sp)), -Math.sin(f.th) * Math.sign(f.sp));
      let d = targetYaw - f.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.yaw += d * Math.min(dt * 6, 1);
      composeFish(inst, i, x, y, z, f.yaw, 0, 0, f.size);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
  return { inst, update };
}

// the fusilier bait ball: a swirling silver torus that parts around anything
// that swims into it
function makeBaitBall(lib, rand, sharkPos) {
  const count = 130;
  const geo = lib.fusilier.geo;
  wigAttribute(geo, count, rand);
  const inst = new THREE.InstancedMesh(geo, lib.fusilier.mat, count);
  inst.frustumCulled = false;
  inst.name = 'baitball';

  // home: the deepest mid-water column the probe can find offshore
  let hx = 0, hz = 0, hBest = 1;
  for (let i = 0; i < 60; i++) {
    const az = rand() * Math.PI * 2;
    const rr = shoreRadius(az) + 16 + rand() * 22;
    const x = Math.cos(az) * rr, z = Math.sin(az) * rr;
    const h = islandHeight(x, z);
    if (h < hBest) { hBest = h; hx = x; hz = z; }
    if (h < -3.2) break;
  }
  const fish = [];
  for (let i = 0; i < count; i++) {
    fish.push({
      th: rand() * Math.PI * 2,
      sp: (1.1 + rand() * 0.9) * (rand() < 0.85 ? 1 : -1),
      r: 0.6 + Math.pow(rand(), 0.6) * 1.9,
      tilt: (rand() - 0.5) * 0.5,
      yph: rand() * Math.PI * 2,
      size: 0.8 + rand() * 0.5,
      ox: 0, oz: 0, oy: 0,
      px: hx, py: 0, pz: hz, yaw: 0, pitch: 0,
    });
  }
  function update(t, dt, player) {
    const tide = uniforms.uTide.value;
    const ground = islandHeight(hx, hz);
    const cy = THREE.MathUtils.clamp(
      (ground + tide) / 2 + Math.sin(t * 0.11) * 0.8, ground + 1.6, tide - 1.4);
    const cx = hx + Math.sin(t * 0.05) * 2.5;
    const cz = hz + Math.cos(t * 0.043) * 2.5;
    const breathe = 1 + 0.16 * Math.sin(t * 0.45);
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      f.th += f.sp * dt;
      const r = f.r * breathe;
      let x = cx + Math.cos(f.th) * r;
      let z = cz + Math.sin(f.th) * r;
      let y = cy + Math.sin(f.th * 2 + f.yph) * r * 0.28 + f.tilt * Math.cos(f.th) * r;

      // part around intruders (the diver, or a shark barreling through)
      for (const ip of [player.pos, sharkPos()]) {
        if (!ip) continue;
        const dx = x - ip.x, dy = y - ip.y, dz = z - ip.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 3.2 && d > 0.001) {
          const k = (1 - d / 3.2) * 5 * dt;
          f.ox += (dx / d) * k; f.oy += (dy / d) * k; f.oz += (dz / d) * k;
        }
      }
      const relax = Math.exp(-dt * 0.9);
      f.ox *= relax; f.oy *= relax; f.oz *= relax;
      x += f.ox; y += f.oy; z += f.oz;
      y = THREE.MathUtils.clamp(y, ground + 0.6, tide - 0.5);

      const mvx = x - f.px, mvy = y - f.py, mvz = z - f.pz;
      if (mvx * mvx + mvz * mvz > 1e-9) {
        const targetYaw = Math.atan2(-mvz, mvx);
        let d = targetYaw - f.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        f.yaw += d * Math.min(dt * 7, 1);
        f.pitch += (THREE.MathUtils.clamp(Math.atan2(mvy, Math.hypot(mvx, mvz)), -0.6, 0.6)
          - f.pitch) * Math.min(dt * 5, 1);
      }
      f.px = x; f.py = y; f.pz = z;
      composeFish(inst, i, x, y, z, f.yaw, f.pitch, 0, f.size);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
  return { inst, update, center: () => ({ x: hx, z: hz }) };
}

// --------------------------------------------------------------- sharks
// One or two blacktips patrolling the reef band. Their spines flex on the CPU
// (shark.js) rather than in a vertex shader, which a pair can afford and a
// school could not, so the flex drops to a quarter rate once they are too far
// off for the tail beat to read.
function makeSharks(rand) {
  const n = 1 + (rand() < 0.4 ? 1 : 0);
  const group = new THREE.Group();
  group.name = 'sharks';
  const sharks = [];
  for (let i = 0; i < n; i++) {
    const rig = buildShark();
    group.add(rig.group);
    sharks.push({
      rig,
      az: rand() * Math.PI * 2,
      rOff: 24 + rand() * 12,
      dir: rand() < 0.5 ? 1 : -1,
      ph: rand() * 10,
      y: null, // snapped to the cruise height on the first update
      yaw: 0, pitch: 0, roll: 0,
      px: 0, py: -3, pz: 0,
      ox: 0, oz: 0,
      size: 0.98 + rand() * 0.38, // 1.6 to 2.2 m of shark
      beat: rand(), // tail-beat phase, in cycles
      rate: 0.9 + rand() * 0.25,
      frame: 0,
    });
  }
  const pos0 = new THREE.Vector3();
  function update(t, dt, player) {
    const tide = uniforms.uTide.value;
    for (let i = 0; i < sharks.length; i++) {
      const s = sharks[i];
      // patrol: sweep the reef band, breathing in and out of it
      const speed = 1.35;
      const rBase = shoreRadius(s.az) + s.rOff + Math.sin(t * 0.07 + s.ph) * 7;
      s.az += (s.dir * speed / Math.max(rBase, 10)) * dt;
      let x = Math.cos(s.az) * rBase;
      let z = Math.sin(s.az) * rBase;

      // a shy fish: sheer away from the diver, never circle in
      const pdx = x + s.ox - player.pos.x, pdz = z + s.oz - player.pos.z;
      const pd = Math.hypot(pdx, pdz);
      if (pd < 9 && pd > 0.001) {
        const k = (1 - pd / 9) * 4.5 * dt;
        s.ox += (pdx / pd) * k * 3;
        s.oz += (pdz / pd) * k * 3;
      }
      const relax = Math.exp(-dt * 0.5);
      s.ox *= relax; s.oz *= relax;
      x += s.ox; z += s.oz;

      const g = islandHeight(x, z);
      let y = g + 1.1 + Math.max(tide - g - 2.2, 0) * (0.3 + 0.25 * Math.sin(t * 0.13 + s.ph * 2));
      y = THREE.MathUtils.clamp(y, g + 0.7, tide - 0.9);
      if (s.y === null) { s.y = y; s.py = y; }
      s.y += (y - s.y) * Math.min(dt * 0.8, 1);

      const mvx = x - s.px, mvy = s.y - s.py, mvz = z - s.pz;
      let dYaw = 0;
      if (mvx * mvx + mvz * mvz > 1e-9) {
        const targetYaw = Math.atan2(-mvz, mvx);
        let d = targetYaw - s.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        dYaw = d;
        s.yaw += d * Math.min(dt * 2.2, 1);
        s.pitch += (THREE.MathUtils.clamp(Math.atan2(mvy, Math.hypot(mvx, mvz)), -0.35, 0.35)
          - s.pitch) * Math.min(dt * 2, 1);
      }
      // bank into the turn
      s.roll += (THREE.MathUtils.clamp(dYaw * 6, -0.45, 0.45) - s.roll) * Math.min(dt * 2, 1);
      s.px = x; s.py = s.y; s.pz = z;
      poseCreature(s.rig.group, x, s.y, z, s.yaw, s.pitch, s.roll, s.size);

      // the tail beats at whatever pace it is actually making ground at, so
      // the shove away from the diver reads as a burst
      const gait = THREE.MathUtils.clamp(
        Math.hypot(mvx, mvz) / Math.max(dt, 1e-4) / speed, 0.45, 2.2);
      s.beat += dt * 0.62 * gait * s.rate;
      if (pd < 26 || (s.frame++ & 3) === 0) s.rig.update(s.beat, 0.82 + 0.22 * gait);
    }
  }
  return {
    group, update,
    pos: (i = 0) => {
      const s = sharks[i];
      return pos0.set(s.px, s.py, s.pz);
    },
  };
}

// ----------------------------------------------------------------- rays
function makeRays(rand, meadows) {
  const n = 2 + (rand() < 0.5 ? 1 : 0);
  const geo = rayGeometry();
  wigAttribute(geo, n, rand);
  const wig = geo.getAttribute('aWig');
  const inst = new THREE.InstancedMesh(geo, rayMaterial(), n);
  inst.frustumCulled = false;
  inst.name = 'stingrays';

  const pickSpot = () => {
    for (let i = 0; i < 30; i++) {
      let x, z;
      if (meadows.length && rand() < 0.45) {
        const m = meadows[Math.floor(rand() * meadows.length)];
        const a = rand() * Math.PI * 2;
        x = m.x + Math.cos(a) * m.r * 0.8;
        z = m.z + Math.sin(a) * m.r * 0.8;
      } else {
        const az = rand() * Math.PI * 2;
        const rr = shoreRadius(az) + 5 + rand() * 26;
        x = Math.cos(az) * rr; z = Math.sin(az) * rr;
      }
      const h = islandHeight(x, z);
      if (h < -0.9 && h > -5) return { x, z };
    }
    return { x: meadows[0]?.x ?? 40, z: meadows[0]?.z ?? 0 };
  };

  const rays = [];
  for (let i = 0; i < n; i++) {
    const s = pickSpot();
    rays.push({
      x: s.x, z: s.z, y: islandHeight(s.x, s.z) + 0.3,
      target: pickSpot(),
      mode: 'glide', modeT: 4 + rand() * 8,
      yaw: rand() * Math.PI * 2, pitch: 0,
      size: 0.7 + rand() * 0.5,
      burst: 0,
    });
  }
  function update(t, dt, player) {
    for (let i = 0; i < n; i++) {
      const r = rays[i];
      r.modeT -= dt;
      const pd = Math.hypot(r.x - player.pos.x, r.z - player.pos.z);
      if (pd < 2.4 && r.burst <= 0) {
        r.burst = 2.2; // spooked: lift off the sand and shoot away
        r.mode = 'glide';
        const away = Math.atan2(r.z - player.pos.z, r.x - player.pos.x);
        r.target = { x: r.x + Math.cos(away) * 14, z: r.z + Math.sin(away) * 14 };
      }
      r.burst = Math.max(r.burst - dt, 0);

      const g = islandHeight(r.x, r.z);
      if (r.mode === 'settle') {
        // buried in the sand but for the eyes, wings barely stirring
        wig.setY(i, 0.12);
        r.y += ((g + 0.06) - r.y) * Math.min(dt * 2, 1);
        if (r.modeT <= 0) {
          r.mode = 'glide';
          r.modeT = 10 + rand() * 14;
          r.target = pickSpot();
        }
      } else {
        wig.setY(i, r.burst > 0 ? 1.6 : 0.9);
        const dx = r.target.x - r.x, dz = r.target.z - r.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.8) {
          if (rand() < 0.6) { r.mode = 'settle'; r.modeT = 9 + rand() * 12; }
          else { r.target = pickSpot(); r.modeT = 10 + rand() * 14; }
        } else {
          // rays bank into their turns and only ever move nose-first
          const targetYaw = Math.atan2(-dz, dx);
          let dy2 = targetYaw - r.yaw;
          dy2 = Math.atan2(Math.sin(dy2), Math.cos(dy2));
          r.yaw += dy2 * Math.min(dt * (r.burst > 0 ? 3 : 1.2), 1);
          const spd = r.burst > 0 ? 2.6 : 0.55;
          r.x += Math.cos(r.yaw) * spd * dt;
          r.z += -Math.sin(r.yaw) * spd * dt;
          if (r.modeT <= 0) { r.target = pickSpot(); r.modeT = 10 + rand() * 14; }
        }
        const wantY = g + 0.32 + Math.sin(t * 0.7 + i * 2.6) * 0.08 + r.burst * 0.3;
        r.y += (Math.min(wantY, uniforms.uTide.value - 0.5) - r.y) * Math.min(dt * 1.5, 1);
      }
      composeFish(inst, i, r.x, r.y, r.z, r.yaw, r.pitch, 0, r.size);
    }
    wig.needsUpdate = true;
    inst.instanceMatrix.needsUpdate = true;
  }
  return { inst, update };
}

// -------------------------------------------------------------- turtles
function makeTurtles(rand) {
  const n = 1 + (rand() < 0.4 ? 1 : 0);
  const group = new THREE.Group();
  group.name = 'sea-turtles';
  const turtles = [];

  const pickTarget = () => {
    for (let i = 0; i < 30; i++) {
      const az = rand() * Math.PI * 2;
      const rr = shoreRadius(az) + 8 + rand() * 30;
      const x = Math.cos(az) * rr, z = Math.sin(az) * rr;
      const h = islandHeight(x, z);
      if (h < -1.4 && h > -7.5) return { x, z };
    }
    return { x: 60, z: 0 };
  };

  for (let i = 0; i < n; i++) {
    const parts = buildSwimTurtleMesh(subSeed('swimTurtle' + i));
    const s = pickTarget();
    parts.group.position.set(s.x, islandHeight(s.x, s.z) + 1.5, s.z);
    parts.group.scale.setScalar(1.05 + rand() * 0.3);
    group.add(parts.group);
    turtles.push({
      parts,
      target: pickTarget(),
      mode: 'cruise',
      breatheIn: 40 + rand() * 60,
      modeT: 0,
      gait: rand() * 10,
      yaw: rand() * Math.PI * 2,
      pitch: 0,
      scared: 0,
      vy: 0,
    });
  }

  const _quat = new THREE.Quaternion(), _qp2 = new THREE.Quaternion();
  function update(t, dt, player) {
    const tide = uniforms.uTide.value;
    for (const tu of turtles) {
      const g = tu.parts.group;
      const p = g.position;
      tu.breatheIn -= dt;
      tu.modeT += dt;

      const pd = Math.hypot(p.x - player.pos.x, p.y - player.pos.y, p.z - player.pos.z);
      tu.scared = Math.max(tu.scared - dt, pd < 2 ? 3 : 0);

      let wantY;
      const ground = islandHeight(p.x, p.z);
      if (tu.mode === 'breathe') {
        wantY = tide - 0.12 + Math.sin(t * 1.1) * 0.05;
        if (tu.modeT > 4) {
          tu.mode = 'cruise';
          tu.modeT = 0;
          tu.breatheIn = 50 + rand() * 60;
          tu.target = pickTarget();
        }
      } else if (tu.breatheIn <= 0) {
        wantY = tide - 0.12;
        if (p.y > tide - 0.3) { tu.mode = 'breathe'; tu.modeT = 0; }
      } else {
        wantY = THREE.MathUtils.clamp(
          ground + 0.9 + Math.sin(t * 0.2 + tu.gait) * 0.5, ground + 0.6, tide - 0.7);
      }

      const dx = tu.target.x - p.x, dz = tu.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2 && tu.mode === 'cruise') tu.target = pickTarget();
      const spd = (tu.scared > 0 ? 1.5 : 0.55) * (tu.mode === 'breathe' ? 0.15 : 1);
      const targetYaw = Math.atan2(dz, dx);
      let dyaw = targetYaw - tu.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      tu.yaw += dyaw * Math.min(dt * 0.8, 1);
      p.x += Math.cos(tu.yaw) * spd * dt;
      p.z += Math.sin(tu.yaw) * spd * dt;
      tu.vy = (wantY - p.y) * Math.min(dt * 0.7, 1);
      p.y += tu.vy;

      // flippers fly like slow wings; harder when scared
      tu.gait += dt * (tu.mode === 'breathe' ? 1.1 : tu.scared > 0 ? 4.4 : 2.4);
      const fl = Math.sin(tu.gait) * 0.55;
      tu.parts.frontL.rotation.z = fl;
      tu.parts.frontR.rotation.z = -fl;
      tu.parts.frontL.rotation.y = -0.35;
      tu.parts.frontR.rotation.y = 0.35;
      tu.parts.backL.rotation.z = 0.1 + Math.sin(tu.gait * 0.5 + 1.2) * 0.15;
      tu.parts.backR.rotation.z = -0.1 - Math.sin(tu.gait * 0.5 + 1.2) * 0.15;
      tu.parts.head.position.y = 0.02 + (tu.mode === 'breathe' ? 0.08 : 0);

      // nose along the heading (model nose = +x), pitch with the climb
      const pitch = THREE.MathUtils.clamp(tu.vy / Math.max(dt, 1e-4) / 1.2, -0.45, 0.45);
      tu.pitch += (pitch - tu.pitch) * Math.min(dt * 2, 1);
      _quat.setFromAxisAngle(_up, -tu.yaw);
      _qp2.setFromAxisAngle(_zAxis, tu.pitch);
      _quat.multiply(_qp2);
      g.quaternion.slerp(_quat, Math.min(dt * 3, 1));
    }
  }
  return { group, update };
}

// ---------------------------------------------------------------- jellies
function makeJellies(rand) {
  const geo = jellyGeometry();
  const N = 9;
  const ph = new Float32Array(N);
  for (let i = 0; i < N; i++) ph[i] = rand() * Math.PI * 2;
  geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
  const mat = jellyMaterial();
  const inst = new THREE.InstancedMesh(geo, mat, N);
  inst.frustumCulled = false;
  inst.renderOrder = 1;
  inst.name = 'jellies';

  const jellies = [];
  for (let i = 0; i < N; i++) {
    let jx = 0, jz = 0;
    for (let tries = 0; tries < 20; tries++) {
      const az = rand() * Math.PI * 2;
      const rr = shoreRadius(az) + 8 + rand() * 30;
      jx = Math.cos(az) * rr; jz = Math.sin(az) * rr;
      if (islandHeight(jx, jz) < -2.0) break;
    }
    jellies.push({
      x: jx,
      z: jz,
      y: -1 - rand() * 2,
      ph: ph[i],
      drift: 0.03 + rand() * 0.05,
      da: rand() * Math.PI * 2,
      size: 1.0 + rand() * 0.9,
    });
  }
  function update(t, dt) {
    const tide = uniforms.uTide.value;
    for (let i = 0; i < N; i++) {
      const j = jellies[i];
      const pulse = Math.sin(t * 1.7 + j.ph);
      j.y += (Math.max(pulse, 0) * 0.11 - 0.045) * dt * 2;
      j.x += Math.cos(j.da) * j.drift * dt;
      j.z += Math.sin(j.da) * j.drift * dt;
      const g = islandHeight(j.x, j.z);
      // in the shallows the ceiling wins: better a jelly brushing the sand
      // than a bell poking out of the sea
      j.y = THREE.MathUtils.clamp(j.y, Math.min(g + 0.8, tide - 0.5), tide - 0.45);
      if (g > -1.2) { // drifted into the surf line: let the current carry it out
        const az = Math.atan2(j.z, j.x);
        j.x += Math.cos(az) * dt * 0.5;
        j.z += Math.sin(az) * dt * 0.5;
      }
      _v.set(j.x, j.y, j.z);
      _q.setFromAxisAngle(_up, j.da);
      _s.setScalar(j.size);
      _m.compose(_v, _q, _s);
      inst.setMatrixAt(i, _m);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
  return { inst, update };
}

// ------------------------------------------------------------------ moray
function makeEel(den) {
  if (!den) return null;
  const eel = buildEel();
  eel.group.position.set(den.x, den.y, den.z);
  eel.group.rotation.y = -den.heading;
  return eel;
}

// ------------------------------------------------------------------ build
export function buildSealife(player, reef) {
  const group = new THREE.Group();
  group.name = 'sealife';
  const rand = mulberry32(subSeed('sealife'));
  const lib = speciesLibrary();
  const systems = [];

  const clusters = reef.clusters.length
    ? reef.clusters
    : [{ x: shoreRadius(0) + 20, z: 0, r: 4, h: -3 }];
  const cluster = (i) => clusters[i % clusters.length];

  // reef fish schools, parceled out across the coral gardens
  const defs = [
    { sp: 'sergeant', count: 15, spread: 2.4, hover: [0.35, 0.8], speed: [0.5, 0.9], fleeR: 4.5 },
    { sp: 'sergeant', count: 12, spread: 2.0, hover: [0.3, 0.7], speed: [0.5, 0.9], fleeR: 4.5 },
    { sp: 'blueTang', count: 6, spread: 2.8, hover: [0.4, 0.85], speed: [0.35, 0.6], fleeR: 5 },
    { sp: 'yellowTang', count: 5, spread: 2.0, hover: [0.15, 0.45], speed: [0.3, 0.55], fleeR: 4 },
    { sp: 'butterfly', count: 2, spread: 1.8, hover: [0.2, 0.5], speed: [0.25, 0.4], fleeR: 4 },
    { sp: 'butterfly', count: 2, spread: 1.8, hover: [0.2, 0.5], speed: [0.25, 0.4], fleeR: 4 },
    { sp: 'angelfish', count: 2, spread: 2.6, hover: [0.2, 0.55], speed: [0.2, 0.35], fleeR: 5 },
    { sp: 'parrotfish', count: 2, spread: 3.4, hover: [0.1, 0.35], speed: [0.25, 0.45], fleeR: 5 },
  ];
  defs.forEach((d, i) => {
    const cl = cluster(i);
    const school = makeSchool({
      geo: lib[d.sp].geo, mat: lib[d.sp].mat, count: d.count, rand,
      anchor: { x: cl.x, z: cl.z }, spread: Math.min(d.spread, cl.r),
      hover: d.hover, speed: d.speed, fleeR: d.fleeR, name: d.sp + i,
    });
    group.add(school.inst);
    systems.push(school);
  });

  // the shy patrol
  const sharks = makeSharks(rand);
  group.add(sharks.group);
  systems.push(sharks);

  // silver weather around the deep cluster
  const bait = makeBaitBall(lib, rand, () => sharks.pos(0));
  group.add(bait.inst);
  systems.push(bait);

  const clown = makeClownfish(lib, reef.anemones, rand);
  if (clown) { group.add(clown.inst); systems.push(clown); }

  const rays = makeRays(rand, reef.meadows);
  group.add(rays.inst);
  systems.push(rays);

  const turtles = makeTurtles(rand);
  group.add(turtles.group);
  systems.push(turtles);

  const jellies = makeJellies(rand);
  group.add(jellies.inst);
  systems.push(jellies);

  const eel = makeEel(reef.eelDen);
  if (eel) {
    group.add(eel.group);
    systems.push({ update: (t) => eel.update(t) });
  }

  function update(t, dt) {
    for (const s of systems) s.update(t, dt, player);
  }

  return { group, update };
}
