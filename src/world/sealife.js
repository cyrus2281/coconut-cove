// Everything that swims. Reef fish schools (sergeant majors, tangs,
// butterflyfish, an emperor angelfish, parrotfish), clownfish keeping to
// their anemones, a shimmering fusilier bait ball, patrolling blacktip reef
// sharks, stingrays gliding over the seagrass, cruising green sea turtles
// that rise to breathe, moon jellies pulsing near the surface, and a moray
// eel leaning out of its den. Bodies come from fishcraft.js; the big
// characters (ray, turtle, jelly, eel) are built here.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, shoreRadius } from './island.js';
import {
  fishGeometry, fishTexture, tintFinStrip, fishMaterial, wigAttribute,
} from './fishcraft.js';
import { uwPatch, uwAttach, UW_WPOS_VERT, UW_FRAG_DECL, UW_CAUSTIC_FRAG } from './underwater.js';

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

// ------------------------------------------------------------ species art
function speciesLibrary() {
  const mk = (name, geoOpts, painter, texOpts, matOpts = {}) => {
    const geo = fishGeometry(geoOpts);
    const tex = fishTexture(painter, texOpts);
    if (texOpts && texOpts.finTint) {
      tintFinStrip(tex, texOpts.finTint);
    }
    const mat = fishMaterial({ map: tex, name, len: geoOpts.len, ...matOpts });
    return { geo, mat, len: geoOpts.len };
  };

  return {
    sergeant: mk('sergeant',
      { len: 0.17, height: 0.088, width: 0.03, blunt: 0.75, caudal: { type: 'fork', l: 0.3, h: 0.55 } },
      (h) => {
        h.base([[0, '#dfe6e2'], [0.45, '#cfd8c8'], [0.8, '#e8d44a'], [1, '#d4b83a']]);
        for (let i = 0; i < 5; i++) h.bar(0.17 + i * 0.14, 0.05, 'rgba(16,20,24,0.92)', 0.15);
        h.eye(); h.gill();
      },
      { finColor: '#e6e0b8' }),

    fusilier: mk('fusilier',
      {
        len: 0.1, height: 0.024, width: 0.015, peak: 0.45, blunt: 0.85,
        slices: 10, ring: 8,
        caudal: { type: 'fork', l: 0.3, h: 1.4 }, dorsal: null, anal: null, pect: null,
      },
      (h) => {
        h.base([[0, '#e8eef2'], [0.55, '#b9c8d4'], [1, '#5a7fa8']]);
        h.stripe(0.62, 0.16, 'rgba(240,210,80,0.85)');
        h.eye(0.09, 0.6, 0.16);
      },
      { W: 128, H: 64, finColor: '#f0dc8c' }, { metal: 0.55, rough: 0.35, freq: 9 }),

    blueTang: mk('blueTang',
      {
        len: 0.26, height: 0.14, width: 0.035, peak: 0.45, blunt: 0.85,
        caudal: { type: 'truncate', l: 0.22, h: 0.5 },
        dorsal: { h: 0.34, u0: 0.18, u1: 0.8 }, anal: { h: 0.34, u0: 0.3, u1: 0.8 },
      },
      (h) => {
        h.base([[0, '#2a5fd8'], [0.6, '#1b4cc4'], [1, '#0e2f96']]);
        // the "palette" swoosh: a dark sweep from the eye back to the tail
        h.ctx.fillStyle = 'rgba(8,12,40,0.9)';
        h.ctx.beginPath();
        h.ctx.ellipse(h.W * 0.45, h.H * 0.78, h.W * 0.34, h.H * 0.17, -0.06, 0, Math.PI * 2);
        h.ctx.fill();
        h.ctx.fillStyle = '#1b4cc4';
        h.ctx.beginPath();
        h.ctx.ellipse(h.W * 0.4, h.H * 0.74, h.W * 0.25, h.H * 0.09, -0.06, 0, Math.PI * 2);
        h.ctx.fill();
        h.bar(0.9, 0.2, 'rgba(244,214,26,0.95)'); // yellow caudal wedge
        h.eye(0.07, 0.66); h.gill();
      },
      { finColor: '#f4d61a', rayColor: 'rgba(80,60,0,0.3)' }),

    yellowTang: mk('yellowTang',
      {
        len: 0.19, height: 0.125, width: 0.028, peak: 0.42, blunt: 0.9,
        caudal: { type: 'truncate', l: 0.2, h: 0.42 },
        dorsal: { h: 0.5, u0: 0.2, u1: 0.78 }, anal: { h: 0.42, u0: 0.34, u1: 0.78 },
      },
      (h) => {
        h.base([[0, '#f6d90e'], [0.7, '#f2ce0c'], [1, '#e8ba14']]);
        h.stripe(0.55, 0.05, 'rgba(255,246,200,0.5)'); // pale lateral streak
        h.ctx.fillStyle = 'rgba(214,160,20,0.5)';
        h.ctx.fillRect(0, 0, h.W * 0.16, h.H); // warm shading at the head
        h.eye(0.08, 0.64); h.gill(0.18);
      },
      { finColor: '#f6d90e', rayColor: 'rgba(150,110,10,0.4)' }),

    butterfly: mk('butterfly',
      {
        len: 0.15, height: 0.088, width: 0.024, blunt: 0.8,
        caudal: { type: 'truncate', l: 0.22, h: 0.42 },
        dorsal: { h: 0.4, u0: 0.24, u1: 0.78 }, anal: { h: 0.34, u0: 0.4, u1: 0.78 },
      },
      (h) => {
        h.base([[0, '#f4f2e8'], [0.55, '#f0ead2'], [1, '#f2d258']]);
        h.bar(0.075, 0.075, 'rgba(14,16,20,0.95)'); // eye-band
        for (let i = 0; i < 7; i++) {
          h.bar(0.2 + i * 0.09, 0.014, 'rgba(120,110,70,0.35)');
        }
        h.spot(0.74, 0.82, 0.16, 'rgba(250,248,240,0.95)'); // false eyespot
        h.spot(0.74, 0.82, 0.11, '#101216');
        h.eye(0.075, 0.62, 0.07);
      },
      { finColor: '#f2d258', rayColor: 'rgba(60,50,10,0.35)' }),

    angelfish: mk('angelfish',
      {
        len: 0.3, height: 0.16, width: 0.045, peak: 0.44, blunt: 0.8,
        caudal: { type: 'truncate', l: 0.2, h: 0.44 },
        dorsal: { h: 0.32, u0: 0.2, u1: 0.82 }, anal: { h: 0.32, u0: 0.34, u1: 0.82 },
      },
      (h) => {
        h.base([[0, '#152a6e'], [1, '#0e1e52']]);
        // the emperor's yellow pinstripes, rising slightly toward the tail
        h.ctx.strokeStyle = 'rgba(240,200,40,0.95)';
        h.ctx.lineWidth = 3;
        for (let i = 0; i < 9; i++) {
          const y = h.H * (0.12 + i * 0.1);
          h.ctx.beginPath();
          h.ctx.moveTo(h.W * 0.14, y);
          h.ctx.lineTo(h.W * 0.9, y + h.H * 0.06);
          h.ctx.stroke();
        }
        h.bar(0.93, 0.14, 'rgba(244,206,30,0.95)');
        h.bar(0.1, 0.1, 'rgba(10,14,30,0.95)'); // eye mask
        h.bar(0.17, 0.035, 'rgba(220,230,240,0.8)');
        h.eye(0.08, 0.6, 0.075);
      },
      { finColor: '#f0c828', rayColor: 'rgba(90,60,0,0.35)' }),

    parrotfish: mk('parrotfish',
      {
        len: 0.44, height: 0.15, width: 0.07, peak: 0.4, blunt: 0.62,
        caudal: { type: 'truncate', l: 0.2, h: 0.5 },
        dorsal: { h: 0.22, u0: 0.18, u1: 0.8 }, anal: { h: 0.2, u0: 0.36, u1: 0.8 },
      },
      (h) => {
        h.base([[0, '#5fc4a8'], [0.55, '#2ba088'], [1, '#1a7f86']]);
        // scale mottle: rows of overlapping arcs
        const rand = mulberry32(5150);
        for (let i = 0; i < 240; i++) {
          const x = rand() * h.W, y = rand() * h.H;
          h.ctx.strokeStyle = rand() < 0.6
            ? 'rgba(20,110,120,0.35)' : 'rgba(240,150,170,0.28)';
          h.ctx.lineWidth = 1.6;
          h.ctx.beginPath();
          h.ctx.arc(x, y, 4 + rand() * 4, 0.2, Math.PI - 0.2);
          h.ctx.stroke();
        }
        h.ctx.fillStyle = 'rgba(238,170,190,0.5)'; // pink cheek wash
        h.ctx.fillRect(0, 0, h.W * 0.2, h.H * 0.6);
        h.ctx.fillStyle = '#dfe8e2'; // the beak
        h.ctx.fillRect(0, h.H * 0.35, h.W * 0.045, h.H * 0.3);
        h.eye(0.09, 0.68, 0.06); h.gill(0.2);
      },
      { finColor: '#37b09a', rayColor: 'rgba(240,150,170,0.5)' }),

    shark: mk('shark',
      {
        len: 1.7, height: 0.36, width: 0.27, peak: 0.34, blunt: 0.55, peduncle: 0.05,
        slices: 26, ring: 16,
        caudal: { type: 'lunate', l: 0.22, h: 0.8 },
        dorsal: { h: 0.85, u0: 0.34, u1: 0.52, sweep: true },
        anal: { h: 0.28, u0: 0.62, u1: 0.72 },
        pect: { l: 0.28, h: 0.85 },
      },
      (h) => {
        // countershading: white belly, bronze-gray back, crisp mid-line
        h.base([[0, '#e8e9e4'], [0.34, '#dcddd6'], [0.42, '#9aa4a8'], [0.75, '#6a767e'], [1, '#525d66']]);
        h.stripe(0.38, 0.03, 'rgba(70,80,86,0.35)');
        const rand = mulberry32(441);
        for (let i = 0; i < 120; i++) { // faint dermal speckle
          h.ctx.fillStyle = `rgba(255,255,255,${0.03 + rand() * 0.05})`;
          h.ctx.fillRect(rand() * h.W, h.H * (0.4 + rand() * 0.6), 2, 2);
        }
        h.eye(0.055, 0.66, 0.045);
        // gill slits
        h.ctx.strokeStyle = 'rgba(40,48,54,0.6)';
        h.ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const x = h.W * (0.16 + i * 0.022);
          h.ctx.beginPath();
          h.ctx.moveTo(x, h.H * 0.42);
          h.ctx.lineTo(x + h.W * 0.008, h.H * 0.66);
          h.ctx.stroke();
        }
      },
      {
        finColor: '#77828a',
        rayColor: 'rgba(50,58,64,0.25)',
        // the blacktip's signature: ink-dipped fin tips
        finTint: (ctx, x, y, w, hh) => {
          const g = ctx.createLinearGradient(0, 0, 0, hh);
          g.addColorStop(0, 'rgba(10,12,14,0)');
          g.addColorStop(0.78, 'rgba(10,12,14,0)');
          g.addColorStop(0.92, 'rgba(10,12,14,0.9)');
          g.addColorStop(1, 'rgba(6,8,10,0.95)');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, w, hh);
        },
      },
      { rough: 0.55, metal: 0.1, freq: 2.3 }),
  };
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
function makeClownfish(anemones, rand) {
  const geo = fishGeometry({
    len: 0.105, height: 0.055, width: 0.022, blunt: 0.8,
    caudal: { type: 'round', l: 0.26, h: 0.55 },
    dorsal: { h: 0.4, u0: 0.26, u1: 0.72 }, anal: { h: 0.3, u0: 0.45, u1: 0.72 },
  });
  const tex = fishTexture((h) => {
    h.base([[0, '#f8892c'], [0.7, '#f07822'], [1, '#d85c14']]);
    for (const [u, w] of [[0.16, 0.085], [0.47, 0.1], [0.8, 0.07]]) {
      h.bar(u, w + 0.03, 'rgba(20,16,12,0.9)');
      h.bar(u, w, '#f4f2ec');
    }
    h.eye(0.075, 0.6, 0.09);
  }, { W: 128, H: 64, finColor: '#f07822', rayColor: 'rgba(30,15,5,0.5)' });
  const mat = fishMaterial({ map: tex, name: 'clown', len: 0.105, freq: 10 });
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
function makeSharks(lib, rand) {
  const n = 1 + (rand() < 0.4 ? 1 : 0);
  const geo = lib.shark.geo;
  wigAttribute(geo, n, rand);
  const inst = new THREE.InstancedMesh(geo, lib.shark.mat, n);
  inst.frustumCulled = false;
  inst.name = 'sharks';
  const sharks = [];
  for (let i = 0; i < n; i++) {
    sharks.push({
      az: rand() * Math.PI * 2,
      rOff: 24 + rand() * 12,
      dir: rand() < 0.5 ? 1 : -1,
      ph: rand() * 10,
      y: null, // snapped to the cruise height on the first update
      yaw: 0, pitch: 0, roll: 0,
      px: 0, py: -3, pz: 0,
      ox: 0, oz: 0,
      size: 0.9 + rand() * 0.25,
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
      composeFish(inst, i, x, s.y, z, s.yaw, s.pitch, s.roll, s.size);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
  return {
    inst, update,
    pos: (i = 0) => {
      const s = sharks[i];
      return pos0.set(s.px, s.py, s.pz);
    },
  };
}

// ----------------------------------------------------------------- rays
function rayGeometry() {
  const L = 1.0, S = 1.6;
  const NX = 18, NZ = 16;
  const pos = [], uv = [], idx = [];
  for (let ix = 0; ix <= NX; ix++) {
    const u = ix / NX;
    const x = (u - 0.42) * L;
    const wing = Math.pow(Math.sin(Math.PI * THREE.MathUtils.clamp(u, 0.02, 0.98)), 0.72);
    for (let iz = 0; iz <= NZ; iz++) {
      const w = (iz / NZ) * 2 - 1;
      const z = w * (S / 2) * wing;
      const dome = 0.105 * Math.pow(1 - Math.abs(w), 1.35)
        * Math.pow(Math.max(Math.sin(Math.PI * u), 0), 0.7);
      pos.push(x, dome - Math.pow(Math.abs(w), 3) * 0.015, z);
      uv.push(0.04 + u * 0.92, iz / NZ);
    }
  }
  const stride = NZ + 1;
  for (let ix = 0; ix < NX; ix++) {
    for (let iz = 0; iz < NZ; iz++) {
      const a = ix * stride + iz, b = a + 1, c = a + stride, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  let disc = new THREE.BufferGeometry();
  disc.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  disc.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  disc.setIndex(idx);
  disc.computeVertexNormals();

  // whip tail: a narrow tapering strip trailing off the back
  const tp = [], tuv = [], tidx = [];
  const TN = 7;
  for (let i = 0; i <= TN; i++) {
    const k = i / TN;
    const x = -0.42 * L - k * 0.95;
    const hw = 0.024 * (1 - k * 0.85);
    tp.push(x, 0.012 - k * 0.03, -hw, x, 0.012 - k * 0.03, hw);
    tuv.push(0.01, 0.48, 0.01, 0.52);
  }
  for (let i = 0; i < TN; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    tidx.push(a, b, c, b, d, c);
  }
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  tail.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  tail.setIndex(tidx);
  tail.computeVertexNormals();

  // eye bumps on the crown
  const eyes = [];
  for (const m of [1, -1]) {
    const e = new THREE.SphereGeometry(0.02, 6, 5);
    e.translate(0.13, 0.075, m * 0.1);
    eyes.push(e);
  }
  const geo = mergeGeometries([disc, tail, ...eyes]);
  geo.computeBoundingSphere();
  return geo;
}

function rayTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const rand = mulberry32(662);
  ctx.fillStyle = '#79704e';
  ctx.fillRect(0, 0, 256, 256);
  // reticulated rings and pale freckles
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(52,46,28,${0.25 + rand() * 0.3})`;
    ctx.lineWidth = 1.6 + rand() * 1.4;
    ctx.beginPath();
    ctx.arc(rand() * 256, rand() * 256, 3 + rand() * 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(212,200,160,${0.2 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.arc(rand() * 256, rand() * 256, 1 + rand() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // pale disc rim (v edges) and a dark tail margin (u ≈ 0)
  const rim = ctx.createLinearGradient(0, 0, 0, 256);
  rim.addColorStop(0, 'rgba(214,206,178,0.7)');
  rim.addColorStop(0.08, 'rgba(214,206,178,0)');
  rim.addColorStop(0.92, 'rgba(214,206,178,0)');
  rim.addColorStop(1, 'rgba(214,206,178,0.7)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#453f2c';
  ctx.fillRect(0, 0, 10, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rayMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    map: rayTexture(), roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    uwAttach(shader);
    shader.vertexShader = `
      attribute vec3 aWig;
      uniform float uTime;
      varying vec3 vWPos;
    ` + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float span = min(abs(transformed.z) / 0.8, 1.0);
        float ph = uTime * 2.1 * aWig.z + aWig.x;
        // wings ripple root→tip; the tail traces the wake
        transformed.y += sin(ph - span * 2.8) * pow(span, 1.6) * 0.22 * aWig.y;
        if (transformed.x < -0.44) {
          float tk = -(transformed.x + 0.44);
          transformed.z += sin(ph * 0.9 + tk * 3.0) * 0.07 * tk * aWig.y;
        }
      }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      ${UW_WPOS_VERT}`);
    shader.fragmentShader = UW_FRAG_DECL + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${UW_CAUSTIC_FRAG}`);
  };
  mat.customProgramCacheKey = () => 'uw-ray';
  return mat;
}

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
function turtleShellTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const rand = mulberry32(seed);
  ctx.fillStyle = '#31441f';
  ctx.fillRect(0, 0, 256, 256);
  const scute = (cx, cy, r) => {
    const rot = rand() * Math.PI;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      const rr = r * (0.88 + rand() * 0.18);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 1.1;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    g.addColorStop(0, `rgb(${96 + (rand() * 30) | 0},${112 + (rand() * 26) | 0},${62 + (rand() * 20) | 0})`);
    g.addColorStop(1, `rgb(${56 + (rand() * 20) | 0},${74 + (rand() * 18) | 0},${40 + (rand() * 14) | 0})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#20301a';
    ctx.lineWidth = 5;
    ctx.stroke();
  };
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      scute(24 + col * 52 + (row % 2) * 26 + rand() * 8, 38 + row * 62 + rand() * 8, 28 + rand() * 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildSwimTurtleMesh(seed) {
  const g = new THREE.Group();
  const shellMat = uwPatch(new THREE.MeshStandardMaterial({
    map: turtleShellTexture(seed), roughness: 0.55,
  }), 'seaturtle-shell');
  const skinMat = uwPatch(new THREE.MeshStandardMaterial({
    color: 0x5f7048, roughness: 0.7,
  }), 'seaturtle-skin');

  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), shellMat);
  shell.scale.set(0.5, 0.18, 0.4);
  shell.position.y = 0.05;
  g.add(shell);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skinMat);
  belly.scale.set(0.44, 0.11, 0.35);
  belly.position.y = -0.03;
  g.add(belly);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 9), skinMat);
  head.scale.set(1.3, 0.85, 0.9);
  head.position.set(0.58, 0.02, 0);
  g.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 6, 5), eyeMat);
    eye.position.set(0.66, 0.05, 0.075 * s);
    g.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 7), skinMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-0.52, -0.01, 0);
  g.add(tail);

  // flippers: the same swept planforms as the nesting turtle on the beach
  const flipperGeo = (len, wid, rear, m) => {
    const s = new THREE.Shape();
    const L = len, W = wid * m;
    s.moveTo(0.02, -W * 0.30);
    if (rear) {
      s.bezierCurveTo(L * 0.35, -W * 0.62, L * 0.85, -W * 0.55, L * 1.0, -W * 0.05);
      s.bezierCurveTo(L * 0.95, W * 0.42, L * 0.45, W * 0.52, 0.02, W * 0.30);
    } else {
      s.bezierCurveTo(L * 0.30, -W * 0.55, L * 0.72, -W * 0.48, L * 1.0, -W * 0.10);
      s.bezierCurveTo(L * 0.88, W * 0.18, L * 0.60, W * 0.36, L * 0.30, W * 0.44);
      s.bezierCurveTo(L * 0.16, W * 0.47, L * 0.05, W * 0.36, 0.02, W * 0.28);
    }
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i) / len;
      p.setY(i, p.getY(i) - k * k * len * 0.1);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const flipMat = uwPatch(new THREE.MeshStandardMaterial({
    color: 0x4d5c3c, roughness: 0.62, side: THREE.DoubleSide,
  }), 'seaturtle-flip');
  const mk = (px, pz, splay, rear, m) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, -0.02, pz);
    const f = new THREE.Mesh(flipperGeo(rear ? 0.26 : 0.52, 0.32, rear, m), flipMat);
    pivot.add(f);
    pivot.rotation.y = splay * m;
    g.add(pivot);
    return pivot;
  };
  const frontL = mk(0.3, 0.32, -0.5, false, 1);
  const frontR = mk(0.3, -0.32, -0.5, false, -1);
  const backL = mk(-0.4, 0.24, -2.35, true, 1);
  const backR = mk(-0.4, -0.24, -2.35, true, -1);
  return { group: g, head, frontL, frontR, backL, backR };
}

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
  const dome = new THREE.SphereGeometry(0.16, 18, 9, 0, Math.PI * 2, 0, 1.9);
  const parts = [dome];
  // fringe tentacles around the rim + four frilly oral arms
  const rimY = 0.16 * Math.cos(1.9);
  const rimR = 0.16 * Math.sin(1.9);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const strip = new THREE.PlaneGeometry(0.012, 0.2, 1, 4);
    strip.translate(0, -0.1, 0);
    strip.rotateY(a + Math.PI / 2);
    strip.translate(Math.cos(a) * rimR * 0.96, rimY + 0.005, Math.sin(a) * rimR * 0.96);
    parts.push(strip);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const arm = new THREE.PlaneGeometry(0.05, 0.3, 1, 5);
    arm.translate(0, -0.13, 0);
    arm.rotateY(a);
    arm.translate(Math.cos(a) * 0.03, 0.02, Math.sin(a) * 0.03);
    parts.push(arm);
  }
  const geo = mergeGeometries(parts);

  const N = 9;
  const ph = new Float32Array(N);
  for (let i = 0; i < N; i++) ph[i] = rand() * Math.PI * 2;
  geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: uniforms.uTime,
      uNightF: uniforms.uNightF,
      uSunI: uniforms.uSunI,
      uFogColor: uniforms.uFogColor,
      uFogDensity: uniforms.uFogDensity,
    },
    vertexShader: /* glsl */ `
      attribute float aPh;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUvA;
      varying float vPulse;
      varying float vDist;
      void main() {
        vUvA = uv;
        float pulse = sin(uTime * 1.7 + aPh);
        vPulse = pulse;
        vec3 p = position;
        if (p.y > -0.01) {
          // the bell: rim flares on the power stroke, crown stays firm
          float rimK = clamp((0.1 - p.y) / 0.16, 0.0, 1.0);
          float s = 1.0 + 0.13 * pulse * rimK;
          p.x *= s; p.z *= s;
          p.y *= 1.0 - 0.08 * pulse * (1.0 - rimK);
        } else {
          // fringe streams behind the pulse
          p.x += sin(uTime * 1.3 + aPh + p.y * 7.0) * 0.02 * (-p.y / 0.3);
          p.z += cos(uTime * 1.1 + aPh * 1.3 + p.y * 6.0) * 0.02 * (-p.y / 0.3);
        }
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNightF;
      uniform float uSunI;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUvA;
      varying float vPulse;
      varying float vDist;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - ndv, 2.0);
        vec3 col = vec3(0.72, 0.82, 0.9) * (0.35 + 0.65 * uSunI);
        // the four horseshoe gonads glowing through the bell
        float go = smoothstep(0.55, 0.95, sin(vUvA.x * 25.13))
          * exp(-pow((vUvA.y - 0.42) * 4.5, 2.0));
        col = mix(col, vec3(0.9, 0.55, 0.72), go * 0.7);
        // moon jellies come alive at night
        col += vec3(0.15, 0.85, 0.8) * uNightF * (0.35 + 0.25 * vPulse);
        float a = 0.10 + rim * 0.5 + go * 0.22;
        a *= 0.55 + 0.45 * uSunI + uNightF * 0.4;
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        col = mix(col, uFogColor, fogF);
        gl_FragColor = vec4(col, a * (1.0 - fogF * 0.7));
      }
    `,
  });

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
function eelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const rand = mulberry32(883);
  ctx.fillStyle = '#4a5a2e';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = rand() < 0.5
      ? `rgba(30,38,18,${0.25 + rand() * 0.35})`
      : `rgba(120,132,72,${0.2 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.arc(rand() * 128, rand() * 128, 1 + rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeEel(den, rand) {
  if (!den) return null;
  const group = new THREE.Group();
  group.name = 'moray';
  const mat = uwPatch(new THREE.MeshStandardMaterial({
    map: eelTexture(), roughness: 0.65,
  }), 'moray');

  const dir = new THREE.Vector3(Math.cos(den.heading), 0, Math.sin(den.heading));
  const p0 = new THREE.Vector3(den.x - dir.x * 0.5, den.y - 0.12, den.z - dir.z * 0.5);
  const pts = [
    p0,
    new THREE.Vector3(den.x + dir.x * 0.1, den.y + 0.02, den.z + dir.z * 0.1),
    new THREE.Vector3(den.x + dir.x * 0.32, den.y + 0.16, den.z + dir.z * 0.32),
    new THREE.Vector3(den.x + dir.x * 0.5, den.y + 0.34, den.z + dir.z * 0.5),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const neck = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.052, 8), mat);
  group.add(neck);

  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), mat);
  skull.scale.set(1.5, 0.85, 0.8);
  head.add(skull);
  const jawMat = uwPatch(new THREE.MeshStandardMaterial({
    color: 0x9aa87a, roughness: 0.6,
  }), 'moray-jaw');
  const lower = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 7), jawMat);
  lower.rotation.z = -Math.PI / 2;
  lower.position.set(0.08, -0.025, 0);
  head.add(lower);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101008, roughness: 0.25 });
  for (const m of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 5), eyeMat);
    eye.position.set(0.045, 0.03, 0.035 * m);
    head.add(eye);
  }
  const tip = pts[3];
  head.position.copy(tip);
  group.add(head);

  function update(t) {
    // slow threat-posture sway and that perpetual moray gape
    const sway = Math.sin(t * 0.9) * 0.12 + Math.sin(t * 0.37) * 0.08;
    head.position.set(
      tip.x + Math.cos(den.heading + Math.PI / 2) * sway * 0.3,
      tip.y + Math.sin(t * 0.6) * 0.03,
      tip.z + Math.sin(den.heading + Math.PI / 2) * sway * 0.3
    );
    head.rotation.y = -den.heading + sway;
    lower.rotation.z = -Math.PI / 2 - (0.3 + Math.sin(t * 1.4) * 0.22);
  }
  return { group, update };
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
  const sharks = makeSharks(lib, rand);
  group.add(sharks.inst);
  systems.push(sharks);

  // silver weather around the deep cluster
  const bait = makeBaitBall(lib, rand, () => sharks.pos(0));
  group.add(bait.inst);
  systems.push(bait);

  const clown = makeClownfish(reef.anemones, rand);
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

  const eel = makeEel(reef.eelDen, rand);
  if (eel) {
    group.add(eel.group);
    systems.push({ update: (t) => eel.update(t) });
  }

  function update(t, dt) {
    for (const s of systems) s.update(t, dt, player);
  }

  return { group, update };
}
