// The green turtle. On most nights, once the stars are properly out, she
// swims in from the dark water, crutches up the beach the way sea turtles
// do — both front flippers together, body lurching between strokes — digs a
// body pit with alternating rear-flipper flicks of sand, rests, and slips
// back into the surf before dawn. She leaves wide flipper-track pairs that
// the tide erases by morning. Walk up too close and she freezes.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, islandNormal, shoreRadius } from './island.js';

function shellTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const rand = mulberry32(77);
  ctx.fillStyle = '#33422b';
  ctx.fillRect(0, 0, 256, 256);
  const scute = (cx, cy, r) => {
    const rot = rand() * Math.PI;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      const rr = r * (0.88 + rand() * 0.18);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 1.12;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgb(${74 + (rand() * 26) | 0},${92 + (rand() * 24) | 0},${56 + (rand() * 18) | 0})`;
    ctx.fill();
    ctx.strokeStyle = '#243318';
    ctx.lineWidth = 5;
    ctx.stroke();
  };
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      scute(24 + col * 52 + (row % 2) * 26 + rand() * 8, 38 + row * 62 + rand() * 8, 27 + rand() * 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildTurtleMesh() {
  const g = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ map: shellTexture(), roughness: 0.55 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x5a6647, roughness: 0.7 });

  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), shellMat);
  shell.scale.set(0.48, 0.17, 0.38);
  shell.position.y = 0.17;
  shell.castShadow = true;
  g.add(shell);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skinMat);
  belly.scale.set(0.42, 0.1, 0.33);
  belly.position.y = 0.09;
  g.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 9), skinMat);
  head.scale.set(1.25, 0.85, 0.9);
  head.position.set(0.56, 0.13, 0);
  head.castShadow = true;
  g.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), eyeMat);
    eye.position.set(0.63, 0.16, 0.07 * s);
    g.add(eye);
  }

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 7), skinMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-0.5, 0.1, 0);
  g.add(tail);

  // Flippers: real swept paddles, not squashed spheres. The outline is a
  // green-turtle planform — long leading edge sweeping to a back-curved
  // tip, rounded trailing edge — drawn in the pivot's local frame (+x out
  // along the limb, +z toward the tail), extruded paper-thin, then given a
  // touch of downward camber so it reads as a paddle pressing the sand.
  const flipperGeo = (len, wid, rear, m) => {
    // m mirrors the planform across the limb axis for the other side of
    // the body (built into the outline — a negative mesh scale would flip
    // the normals instead)
    const s = new THREE.Shape();
    const L = len, W = wid * m;
    s.moveTo(0.02, -W * 0.30);
    if (rear) {
      // rear paddle: short, broad, rounded — a sculling blade
      s.bezierCurveTo(L * 0.35, -W * 0.62, L * 0.85, -W * 0.55, L * 1.0, -W * 0.05);
      s.bezierCurveTo(L * 0.95, W * 0.42, L * 0.45, W * 0.52, 0.02, W * 0.30);
    } else {
      // front foil: swept leading edge out to a raked tip, curved trailing
      // edge easing back into the shoulder
      s.bezierCurveTo(L * 0.30, -W * 0.55, L * 0.72, -W * 0.48, L * 1.0, -W * 0.10);
      s.bezierCurveTo(L * 0.88, W * 0.18, L * 0.60, W * 0.36, L * 0.30, W * 0.44);
      s.bezierCurveTo(L * 0.16, W * 0.47, L * 0.05, W * 0.36, 0.02, W * 0.28);
    }
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: false });
    // shape lies in the XY plane; lay it flat (y-up thickness) and camber
    geo.rotateX(Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i) / len;
      p.setY(i, p.getY(i) - k * k * len * 0.16); // droop toward the tip
    }
    geo.computeVertexNormals();
    return geo;
  };
  const flipMat = new THREE.MeshStandardMaterial({
    color: 0x49543a, roughness: 0.62, side: THREE.DoubleSide,
  });
  const mk = (px, pz, splay, rear, m) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, 0.09, pz);
    const f = new THREE.Mesh(flipperGeo(rear ? 0.24 : 0.46, 0.30, rear, m), flipMat);
    f.castShadow = true;
    pivot.add(f);
    pivot.rotation.y = splay * m; // splay outward on its own side
    g.add(pivot);
    return pivot;
  };
  const frontL = mk(0.30, 0.30, -0.55, false, 1);
  const frontR = mk(0.30, -0.30, -0.55, false, -1);
  const backL = mk(-0.38, 0.22, -2.35, true, 1);
  const backR = mk(-0.38, -0.22, -2.35, true, -1);

  return { group: g, head, frontL, frontR, backL, backR };
}

// sand kicked by the rear flippers while digging
function buildFlickParticles() {
  const N = 40;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xcbbf9e, size: 0.035, transparent: true, opacity: 0.95, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.visible = false;
  pts.frustumCulled = false;
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N).fill(-1);
  return { pts, pos, vel, life, N };
}

export function buildTurtle(player, footprints, tag = '') {
  // each turtle gets her own stream: separate nesting beaches, separate
  // moods about whether tonight is the night
  const rand = mulberry32(subSeed('turtle' + tag));
  const parts = buildTurtleMesh();
  const g = parts.group;
  g.visible = false;

  const flick = buildFlickParticles();
  const root = new THREE.Group();
  root.add(g, flick.pts);
  root.name = 'turtle';

  const T = {
    state: 'idle',        // idle | swimin | crawlup | dig | rest | crawlback | swimout
    stateT: 0,
    az: 1.55,
    gait: 0,
    trailAcc: 0,
    side: 0,
    heading: 0,
    nest: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    wasNight: false,
    frozen: false,
    digFlick: 0,
    crawlK: 0, // live stroke intensity, rocks the shell while crutching
  };

  // a beach with a clear waterline-to-dune run: h reaches +0.9 within ~26m
  function pickNestSite() {
    for (let tries = 0; tries < 20; tries++) {
      const az = rand() * Math.PI * 2;
      let ok = null;
      // above the worst-case high-tide surge reach, below the dune tops
      for (let r = shoreRadius(az) + 2; r > shoreRadius(az) - 26; r -= 0.7) {
        const h = islandHeight(Math.cos(az) * r, Math.sin(az) * r);
        if (h > 1.15 && h < 1.9) { ok = r; break; }
      }
      if (ok !== null) {
        T.az = az;
        T.nest.set(Math.cos(az) * ok, islandHeight(Math.cos(az) * ok, Math.sin(az) * ok), Math.sin(az) * ok);
        return true;
      }
    }
    return false;
  }

  function beginVisit() {
    if (!pickNestSite()) return false;
    const tide = uniforms.uTide.value;
    T.state = 'swimin';
    T.stateT = 0;
    const outR = shoreRadius(T.az) + 34;
    T.pos.set(Math.cos(T.az) * outR, tide - 0.16, Math.sin(T.az) * outR);
    T.heading = Math.atan2(T.nest.z - T.pos.z, T.nest.x - T.pos.x);
    g.visible = true;
    return true;
  }

  function stampTrack(dirX, dirZ) {
    T.trailAcc = 0;
    T.side = 1 - T.side;
    const h = islandHeight(T.pos.x, T.pos.z);
    footprints.stamp(T.pos.x, T.pos.z, h, dirX, dirZ, T.side, 2, 2.3);
  }

  function crawlToward(tx, tz, dt, speed) {
    const dx = tx - T.pos.x, dz = tz - T.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) return true;
    // crutching gait: strokes surge the body forward. The surge never
    // drops to zero — a hard half-wave stop-start read as a limp — it
    // pulses between a slow drag and the stroke's push.
    T.gait += dt * 2.4;
    const stroke = Math.pow(0.5 + 0.5 * Math.sin(T.gait), 1.6);
    const surge = 0.35 + 0.65 * stroke;
    T.crawlK = stroke; // the pose block rocks the shell with the stroke
    const step = Math.min(speed * surge * dt, d);
    T.pos.x += (dx / d) * step;
    T.pos.z += (dz / d) * step;
    T.heading = Math.atan2(dz, dx);
    T.trailAcc += step;
    if (T.trailAcc > 0.55) stampTrack(dx / d, dz / d);
    // flipper stroke: both fronts reach forward together, plant, and sweep
    // back through the push (sweep rate peaks exactly at the surge peak)
    const sw = Math.sin(T.gait), cw = Math.cos(T.gait);
    parts.frontL.rotation.z = 0.14 + Math.max(-sw, 0) * 0.34; // lift on recovery only
    parts.frontR.rotation.z = 0.14 + Math.max(-sw, 0) * 0.34;
    parts.frontL.rotation.y = -0.55 - cw * 0.45;
    parts.frontR.rotation.y = 0.55 + cw * 0.45;
    parts.backL.rotation.z = 0.08 + Math.sin(T.gait + 2.5) * 0.12;
    parts.backR.rotation.z = 0.08 + Math.sin(T.gait + 2.5 + Math.PI) * 0.12;
    return false;
  }

  function spawnFlick(side) {
    const cosH = Math.cos(T.heading), sinH = Math.sin(T.heading);
    // behind the shell, offset to the working flipper
    const bx = T.pos.x - cosH * 0.45 - sinH * 0.25 * side;
    const bz = T.pos.z - sinH * 0.45 + cosH * 0.25 * side;
    const by = islandHeight(bx, bz) + 0.1;
    let spawned = 0;
    for (let i = 0; i < flick.N && spawned < 7; i++) {
      if (flick.life[i] > 0) continue;
      flick.life[i] = 0.55 + rand() * 0.25;
      flick.pos[i * 3] = bx; flick.pos[i * 3 + 1] = by; flick.pos[i * 3 + 2] = bz;
      flick.vel[i * 3] = -cosH * (0.8 + rand() * 0.8) + (rand() - 0.5) * 0.7;
      flick.vel[i * 3 + 1] = 1.1 + rand() * 0.9;
      flick.vel[i * 3 + 2] = -sinH * (0.8 + rand() * 0.8) + (rand() - 0.5) * 0.7;
      spawned++;
    }
    flick.pts.visible = true;
  }

  function updateFlicks(dt) {
    let any = false;
    for (let i = 0; i < flick.N; i++) {
      if (flick.life[i] <= 0) continue;
      flick.life[i] -= dt;
      flick.vel[i * 3 + 1] -= 6.5 * dt;
      flick.pos[i * 3] += flick.vel[i * 3] * dt;
      flick.pos[i * 3 + 1] += flick.vel[i * 3 + 1] * dt;
      flick.pos[i * 3 + 2] += flick.vel[i * 3 + 2] * dt;
      any = true;
    }
    if (any) flick.pts.geometry.attributes.position.needsUpdate = true;
    else flick.pts.visible = false;
  }

  const _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _yawQ = new THREE.Quaternion(),
    _pq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0),
    _nose = new THREE.Vector3(0, 0, 1); // model pitch axis (nose runs +x)

  function update(t, dt) {
    const nightF = uniforms.uNightF.value;
    const tide = uniforms.uTide.value;

    // one chance to visit per night, shortly after full dark
    if (nightF > 0.9 && !T.wasNight) {
      T.wasNight = true;
      if (T.state === 'idle' && rand() < 0.8) beginVisit();
    } else if (nightF < 0.2) {
      T.wasNight = false;
    }
    if (T.state === 'idle') return;

    T.stateT += dt;
    updateFlicks(dt);

    // player nearby? she freezes mid-anything on land
    const pd = Math.hypot(player.pos.x - T.pos.x, player.pos.z - T.pos.z);
    T.frozen = pd < 3.6 && T.state !== 'swimin' && T.state !== 'swimout';
    if (T.frozen) {
      parts.head.position.y = THREE.MathUtils.lerp(parts.head.position.y, 0.09, dt * 3);
    } else {
      parts.head.position.y = THREE.MathUtils.lerp(parts.head.position.y, 0.13, dt * 3);
    }

    // dawn pressure: hurry back once the sky brightens
    const hurry = nightF < 0.4 ? 1.7 : 1;

    if (T.state === 'swimin') {
      const spd = 1.1;
      const dx = T.nest.x - T.pos.x, dz = T.nest.z - T.pos.z;
      const d = Math.hypot(dx, dz);
      T.heading = Math.atan2(dz, dx);
      T.pos.x += (dx / d) * spd * dt;
      T.pos.z += (dz / d) * spd * dt;
      const ground = islandHeight(T.pos.x, T.pos.z);
      T.pos.y = Math.max(tide - 0.16 + Math.sin(t * 1.3) * 0.03, ground + 0.1);
      // front flippers fly like slow wings under water
      T.gait += dt * 3.2;
      parts.frontL.rotation.z = Math.sin(T.gait) * 0.5;
      parts.frontR.rotation.z = Math.sin(T.gait + Math.PI) * 0.5;
      parts.frontL.rotation.y = -0.35;
      parts.frontR.rotation.y = 0.35;
      if (ground - tide > -0.3) { T.state = 'crawlup'; T.stateT = 0; T.gait = 0; }
    } else if (T.state === 'crawlup') {
      if (!T.frozen) {
        const done = crawlToward(T.nest.x, T.nest.z, dt, 0.34 * hurry);
        T.pos.y = islandHeight(T.pos.x, T.pos.z) + 0.055;
        if (done) { T.state = 'dig'; T.stateT = 0; T.digFlick = 0; }
      }
    } else if (T.state === 'dig') {
      T.pos.y = islandHeight(T.pos.x, T.pos.z) + 0.03; // settled into her pit
      if (!T.frozen) {
        T.digFlick -= dt;
        if (T.digFlick <= 0) {
          T.digFlick = 0.9 + rand() * 0.5;
          T.side = 1 - T.side;
          spawnFlick(T.side ? 1 : -1);
        }
        // rear flippers alternate scooping
        const k = Math.sin(T.stateT * 4);
        parts.backL.rotation.z = 0.15 + Math.max(k, 0) * 0.7;
        parts.backR.rotation.z = 0.15 + Math.max(-k, 0) * 0.7;
        parts.frontL.rotation.z = 0.1;
        parts.frontR.rotation.z = 0.1;
      }
      if (T.stateT > 46) { T.state = 'rest'; T.stateT = 0; }
    } else if (T.state === 'rest') {
      // stillness, a slow head lift now and then
      const lift = Math.max(Math.sin(T.stateT * 0.5), 0) * 0.05;
      if (!T.frozen) parts.head.position.y = 0.13 + lift;
      if (T.stateT > 24 || nightF < 0.4) { T.state = 'crawlback'; T.stateT = 0; T.gait = 0; }
    } else if (T.state === 'crawlback') {
      if (!T.frozen) {
        const outR = shoreRadius(T.az) + 6;
        const tx = Math.cos(T.az) * outR, tz = Math.sin(T.az) * outR;
        crawlToward(tx, tz, dt, 0.4 * hurry);
        const ground = islandHeight(T.pos.x, T.pos.z);
        T.pos.y = ground + 0.055;
        if (ground - tide < -0.25) { T.state = 'swimout'; T.stateT = 0; }
      }
    } else if (T.state === 'swimout') {
      const cosA = Math.cos(T.az), sinA = Math.sin(T.az);
      T.heading = Math.atan2(sinA, cosA);
      T.pos.x += cosA * 1.2 * dt;
      T.pos.z += sinA * 1.2 * dt;
      T.pos.y = THREE.MathUtils.lerp(T.pos.y, tide - 0.9, dt * 0.5);
      T.gait += dt * 3.2;
      parts.frontL.rotation.z = Math.sin(T.gait) * 0.5;
      parts.frontR.rotation.z = Math.sin(T.gait + Math.PI) * 0.5;
      parts.frontL.rotation.y = -0.35;
      parts.frontR.rotation.y = 0.35;
      const ground = islandHeight(T.pos.x, T.pos.z);
      if (tide - ground > 1.4 || T.stateT > 40) {
        T.state = 'idle';
        g.visible = false;
      }
    }

    // pose: sit on the terrain, nose along the heading (tilt ∘ yaw), and
    // while crutching the shell heaves up on the stroke and the nose bobs —
    // the lurch reads in the body, not just the flippers
    const crawling = T.state === 'crawlup' || T.state === 'crawlback';
    if (!crawling) T.crawlK += (0 - T.crawlK) * Math.min(dt * 6, 1);
    g.position.copy(T.pos);
    g.position.y += T.crawlK * 0.028;
    const onLand = crawling || T.state === 'dig' || T.state === 'rest';
    if (onLand) _n.copy(islandNormal(T.pos.x, T.pos.z, 0.6));
    else _n.set(0, 1, 0);
    _yawQ.setFromAxisAngle(_up, -T.heading); // model nose = +x
    _pq.setFromAxisAngle(_nose, (T.crawlK - 0.5) * (crawling ? 0.055 : 0));
    _yawQ.multiply(_pq);
    _q.setFromUnitVectors(_up, _n).multiply(_yawQ);
    g.quaternion.slerp(_q, Math.min(dt * 4, 1));
  }

  return {
    group: root,
    update,
    visit: () => beginVisit(),
    state: () => T.state,
    T,
  };
}
