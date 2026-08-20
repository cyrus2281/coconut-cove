// Far scenery: a smoking volcano and a few sister islands hull-down on the
// horizon. Pure set dressing — they stand kilometres beyond the sloop's lap,
// unreachable by design (the deep water turns a wader back long before),
// and exist to give the empty sea an edge. They are big and far rather than
// small and near: from the summit, 75m up, anything closer than ~3km sits
// visibly below the horizon line and reads as a place you could swim to.
// Landforms are wobbled lathe cones with height-banded vertex colors; the
// exp2 fog paints the aerial haze by day and a squall swallows them whole.
// At night the volcano's crater backlights the bottom of its own smoke
// column.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { cloudTexture, glowDotTexture } from '../core/textures.js';

const SKIRT = -10; // island bases start below the swell

// How much bigger the far scenery is than it used to be, back when it stood
// at half this range. Distance is what sells "far away", but distance alone
// shrinks the skyline to nothing, so the landforms grow with it and the
// apparent size lands a little under where it was.
const FAR = 2;

// smoke column: puff lifetime (s), rise rate and downwind drift (m/s)
const LIFE = 30, RISE = 13, DRIFT = 8;

const sstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Revolve a radius/height profile, then rough it up: low-order radial lobes
// so nothing is a perfect cone, plus an optional blown-out notch in a
// volcano's rim. Colors are painted per vertex from the final heights.
export function landform(profile, x, z, wobbles, colorOf, notch) {
  const geo = new THREE.LatheGeometry(profile, 56);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const _c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ang = Math.atan2(vz, vx);
    let w = 1;
    for (const [n, a, ph] of wobbles) w += a * Math.sin(n * ang + ph);
    let y = vy;
    if (notch) {
      // one ragged bite out of the rim, old-eruption style
      const da = Math.atan2(Math.sin(ang - notch.az), Math.cos(ang - notch.az));
      y -= notch.depth * Math.exp(-(da * da) / 0.32) * sstep(notch.from, notch.to, vy);
    }
    pos.setXYZ(i, vx * w, y, vz * w);
    colorOf(y, ang, _c);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.translate(x, 0, z);
  return geo;
}

// The scene's exp2 fog is tuned so the open sea fades into the sky within a
// couple of kilometres. Applied at face value it dissolves everything out
// here into flat white cutouts, which is not how distance looks: real haze
// over water leaves far land as a pale but legible silhouette long after the
// sea itself has gone. So the far scenery walks through a thinner slice of
// the same fog — same color, same weather response, just less of it.
// Landforms take 0.55 of it. Smoke takes less: ash gray is already almost
// the color of haze, so where a cone survives at 45% of its own color the
// plume at that strength is simply gone, and the plume is the whole point of
// having a volcano out there.
const HAZE_LAND = 0.55, HAZE_SMOKE = 0.4;
function farHaze(mat, k) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <fog_vertex>',
      `#include <fog_vertex>
      #ifdef USE_FOG
        vFogDepth *= ${k};
      #endif`
    );
  };
  // onBeforeCompile's source is the program cache key, and the source is the
  // same for every k — say the k out loud or the first-compiled slice would
  // be handed to every material sharing a shader type
  mat.customProgramCacheKey = () => `farHaze${k}`;
  return mat;
}

// The far scenery all shares one vertex-colored, matte material.
export function landformMaterial() {
  return farHaze(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), HAZE_LAND);
}

// One stratovolcano: a concave flank up to a cratered summit, wobbled off
// round, with a bite blown out of the rim. Painted in bands — sand skirt,
// forest flank, bare basalt, pale ash gullies, dark throat.
export function volcanoCone(rand, { x = 0, z = 0, scale = 1 } = {}) {
  const R = (350 + rand() * 80) * scale;
  const H = (210 + rand() * 55) * scale;
  const rCr = R * 0.16;
  const dep = H * 0.10;
  const pts = [new THREE.Vector2(R, SKIRT)];
  for (let k = 1; k <= 10; k++) {
    const tt = k / 10; // concave stratovolcano flank
    pts.push(new THREE.Vector2(rCr + (R - rCr) * Math.pow(1 - tt, 1.65), SKIRT + (H - SKIRT) * tt));
  }
  pts.push(new THREE.Vector2(rCr * 0.55, H - dep * 0.7));
  pts.push(new THREE.Vector2(rCr * 0.2, H - dep));
  pts.push(new THREE.Vector2(0.01, H - dep));
  const grnP = rand() * 6.3, ashP = rand() * 6.3;
  const _v = new THREE.Color();
  const geo = landform(
    pts, x, z,
    [[2, 0.05 + rand() * 0.03, rand() * 6.3], [5, 0.03 + rand() * 0.02, rand() * 6.3]],
    (y, ang, c) => {
      if (y > H - dep * 1.4 && Math.abs(y - H) < dep * 1.6) {
        // near the rim
        c.setRGB(0.20, 0.18, 0.175);
      } else {
        c.setRGB(0.74, 0.68, 0.52); // sand skirt
        _v.setRGB(0.17, 0.29, 0.17).multiplyScalar(0.85 + 0.3 * (0.5 + 0.5 * Math.sin(ang * 3.1 + grnP)));
        c.lerp(_v, sstep(0.8, 8, y));                    // forest flank
        _v.setRGB(0.30, 0.27, 0.255);
        c.lerp(_v, sstep(H * 0.22, H * 0.45, y));        // bare basalt
        const streak = Math.pow(Math.max(Math.sin(ang * 9 + ashP), 0), 3) * sstep(H * 0.4, H * 0.85, y);
        _v.setRGB(0.45, 0.43, 0.415);
        c.lerp(_v, streak * 0.5);                        // pale ash gullies
      }
      if (y < H - dep * 0.5 && y > H - dep * 1.2) c.setRGB(0.10, 0.075, 0.06); // crater throat
    },
    { az: rand() * Math.PI * 2, depth: H * 0.055, from: H * 0.8, to: H * 0.97 }
  );
  return { geo, x, z, R, H, rCr };
}

// A low sister island: a rounded dome with a beach ring and a jungle crown.
export function sisterDome(rand, { x = 0, z = 0, R, H }) {
  const pts = [new THREE.Vector2(R, SKIRT)];
  for (let k = 1; k <= 9; k++) {
    const tt = k / 9; // rounded dome
    pts.push(new THREE.Vector2(
      Math.max(R * Math.pow(Math.cos(tt * Math.PI / 2), 0.78), 0.01),
      SKIRT + (H - SKIRT) * Math.pow(Math.sin(tt * Math.PI / 2), 1.15)
    ));
  }
  const grnP = rand() * 6.3;
  const _v = new THREE.Color();
  return landform(
    pts, x, z,
    [[2, 0.10 + rand() * 0.08, rand() * 6.3], [3, 0.07 + rand() * 0.06, rand() * 6.3],
      [6, 0.04 + rand() * 0.03, rand() * 6.3]],
    (y, ang, c) => {
      c.setRGB(0.74, 0.68, 0.52); // beach ring
      _v.setRGB(0.19, 0.32, 0.19).multiplyScalar(0.85 + 0.3 * (0.5 + 0.5 * Math.sin(ang * 2.7 + grnP)));
      c.lerp(_v, sstep(0.7, 5, y)); // jungle crown
    },
    null
  );
}

export function smokeTextures() {
  return { smokeTexA: cloudTexture(73), smokeTexB: cloudTexture(74) };
}

// The smoke column and crater glow standing over one cone. Fills in v.puffs
// and v.glow, and hands back the sprites for the caller to add.
export function volcanoPlume(rand, v, { count = 6, textures = null } = {}) {
  const { smokeTexA, smokeTexB } = textures ?? smokeTextures();
  const sprites = [];
  v.puffs = [];
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(farHaze(new THREE.SpriteMaterial({
      map: i % 2 ? smokeTexA : smokeTexB,
      color: new THREE.Color(0.6, 0.58, 0.57),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    }), HAZE_SMOKE));
    sprites.push(s);
    v.puffs.push({ s, off: i / count, wig: rand() * 6.3 });
  }
  // crater sky-glow: from sea level you can't see into the throat, so the
  // ember light reads as a warm halo hanging just above the rim at night
  v.glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowDotTexture(),
    color: new THREE.Color(1.0, 0.42, 0.18),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  }));
  v.glow.scale.set(v.rCr * 3.2, v.rCr * 1.4, 1);
  v.glow.position.set(v.x, v.H + v.rCr * 0.3, v.z);
  sprites.push(v.glow);
  return sprites;
}

const _smoke = new THREE.Color(), _ember = new THREE.Color();

// Cycle one cone's puffs up and downwind, and light the throat after dark.
export function updatePlume(v, t) {
  const night = uniforms.uNightF.value;
  const storm = uniforms.uStorm.value;
  const wind = uniforms.uWindDir.value;

  const flick = 0.72 + 0.28
    * (0.6 * Math.sin(t * 1.9 + v.phase) + 0.4 * Math.sin(t * 4.7 + 1.3 + v.phase));
  const puffW = v.R / 390; // the sibling's column scales with its cone

  for (const p of v.puffs) {
    const k = ((t / LIFE) + p.off) % 1;
    const age = k * LIFE;
    p.s.position.set(
      v.x + wind.x * age * DRIFT + Math.sin(age * 0.5 + p.wig) * 14,
      v.H + 4 + age * RISE * puffW,
      v.z + wind.y * age * DRIFT + Math.cos(age * 0.4 + p.wig) * 14
    );
    const w = (65 + age * 6.5) * puffW;
    p.s.scale.set(w, w * 0.9, 1);
    const emberK = Math.max(0, 1 - k / 0.25) * night;
    p.s.material.opacity = 0.4 * sstep(0, 0.06, k) * Math.pow(1 - k, 1.5)
      * (1 - storm * 0.45) * (1 + emberK * 0.4);
    // day: pale ash gray; night: near-black, except the crater-lit base
    _smoke.setRGB(0.6, 0.58, 0.57).multiplyScalar(0.22 + 0.78 * (1 - night));
    _ember.setRGB(1.0, 0.35, 0.16);
    p.s.material.color.copy(_smoke).lerp(_ember, emberK * flick * 0.85);
  }

  v.glow.material.opacity = night * (0.26 + 0.12 * flick) * (1 - storm * 0.85);
}

export function buildHorizon() {
  const group = new THREE.Group();
  group.name = 'horizon';
  const rand = mulberry32(subSeed('horizon'));

  // bearings, kept apart so the skyline doesn't clump
  const used = [];
  function pickAz() {
    for (let tries = 0; tries < 40; tries++) {
      const az = rand() * Math.PI * 2;
      if (used.every((u) => {
        const d = Math.atan2(Math.sin(az - u), Math.cos(az - u));
        return Math.abs(d) > 0.55;
      })) { used.push(az); return az; }
    }
    return rand() * Math.PI * 2;
  }

  const landMat = landformMaterial();
  const addMesh = (geo) => {
    const m = new THREE.Mesh(geo, landMat);
    group.add(m);
  };

  // ---- the volcanoes: always one, sometimes a smaller sibling ----
  const volcanoes = [];
  const nVolcanoes = 1 + (rand() < 0.4 ? 1 : 0);
  for (let vi = 0; vi < nVolcanoes; vi++) {
    const vAz = pickAz();
    const vDist = 4600 + rand() * 1000;
    const vx = Math.cos(vAz) * vDist, vz = Math.sin(vAz) * vDist;
    const scale = FAR * (vi === 0 ? 1 : 0.55 + rand() * 0.15);
    const cone = volcanoCone(rand, { x: vx, z: vz, scale });
    addMesh(cone.geo);
    volcanoes.push({ ...cone, geo: undefined, phase: rand() * 9 });
  }

  // ---- low sister islands, hull-down ----
  const humps = 2 + (rand() < 0.5 ? 1 : 0);
  for (let i = 0; i < humps; i++) {
    const az = pickAz();
    const dist = 3400 + rand() * 1900;
    const hx = Math.cos(az) * dist, hz = Math.sin(az) * dist;
    const twin = rand() < 0.4;
    const R0 = (150 + rand() * 170) * FAR * 0.95;
    const H0 = (22 + rand() * 32) * FAR * 1.05;
    const spots = [[hx, hz, R0, H0]];
    if (twin) {
      const [x0, z0, r0, h0] = spots[0];
      spots.push([x0 - Math.sin(az) * r0 * 1.5, z0 + Math.cos(az) * r0 * 1.5, r0 * 0.6, h0 * 0.7]);
    }
    for (const [x0, z0, R0, H0] of spots) {
      addMesh(sisterDome(rand, { x: x0, z: z0, R: R0, H: H0 }));
    }
  }

  // ---- smoke columns + crater glows, one set per volcano ----
  const textures = smokeTextures();
  for (const v of volcanoes) {
    // the sibling smokes more shyly
    const count = v === volcanoes[0] ? 6 : 4;
    for (const sprite of volcanoPlume(rand, v, { count, textures })) group.add(sprite);
  }

  function update(t) {
    // thick air (mist, a hard squall) swallows the skyline whole: past this
    // density every landform is ≥95% fogged — the thinner haze slice above
    // doesn't save them, the nearest one is still 3km out — and leaving them
    // drawn shows fog-colored cutouts against the sky dome's own haze
    group.visible = uniforms.uFogDensity.value < 0.0013;
    if (!group.visible) return;
    for (const v of volcanoes) updatePlume(v, t);
  }

  const v0 = volcanoes[0];
  return {
    group, update,
    volcano: { x: v0.x, z: v0.z, h: v0.H },
    volcanoCount: volcanoes.length,
  };
}
