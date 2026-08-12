// A driftwood campfire beside the summit cairn. Teepee logs and a stone
// ring are static; the flames are two crossed shader quads (scrolling noise
// shaped into tongues), embers ride the wind as additive points, smoke
// puffs drift off downwind, and a warm point light flickers over the sand.
// A squall beats the fire down to embers and smoke; it recovers when the
// rain moves on. The crackle lives in audio.js and follows the same k.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight, islandNormal, lagoonFreeboard } from './island.js';
import { figBase } from './fig.js';
import { cairnPos } from './scatter.js';
import { foamTexture, cloudTexture, barkTexture } from '../core/textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FLAME_VERT = /* glsl */`
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // tongues lean and lick sideways more toward their tips
  p.x += sin(uTime * 9.0 + p.y * 5.0) * 0.05 * uv.y;
  p.z += sin(uTime * 7.3 + p.y * 4.0 + 1.7) * 0.04 * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FLAME_FRAG = /* glsl */`
uniform float uTime;
uniform float uFireK;
uniform sampler2D uNoise;
varying vec2 vUv;
void main() {
  if (uFireK <= 0.02) discard;
  vec2 uv = vUv;
  float n1 = texture2D(uNoise, vec2(uv.x * 1.7, uv.y * 1.1 - uTime * 0.55)).r;
  float n2 = texture2D(uNoise, vec2(uv.x * 2.9 + 0.37, uv.y * 2.1 - uTime * 0.93)).r;
  float m = n1 * 0.7 + n2 * 0.55;
  float xd = abs(uv.x - 0.5) * 2.0;
  // tongue mask: wide at the base, pinched and raggedy at the top; the hard
  // top fade keeps strong noise from spawning orphan wisps at the quad rim
  float flame = m * 1.45 - xd * (0.5 + uv.y * 1.7) - uv.y * 0.32 - 0.18;
  float topFade = 1.0 - smoothstep(0.55, 0.92, uv.y);
  flame = clamp(flame * 1.7, 0.0, 1.0) * topFade * uFireK;
  if (flame < 0.02) discard;
  vec3 col = mix(vec3(1.0, 0.23, 0.02), vec3(1.0, 0.88, 0.42), pow(flame, 1.7));
  gl_FragColor = vec4(col * flame * 2.4, flame);
}
`;

export function buildCampfire() {
  const group = new THREE.Group();
  group.name = 'campfire';
  const rand = mulberry32(subSeed('campfire'));

  // ---- site: a flat dry shelf near the cairn, not under the fig ----
  const cairn = cairnPos();
  const fb = figBase();
  let site = null;
  for (let tries = 0; tries < 60 && cairn; tries++) {
    const a = rand() * Math.PI * 2;
    const d = 2.6 + rand() * 2.6;
    const x = cairn.x + Math.cos(a) * d, z = cairn.z + Math.sin(a) * d;
    if (fb && Math.hypot(x - fb.x, z - fb.z) < 7) continue;
    if (lagoonFreeboard(x, z) < 1.0) continue;
    if (islandNormal(x, z).y < 0.965) continue;
    site = { x, z, h: islandHeight(x, z) };
    break;
  }
  if (!site) {
    // no cairn or no flat ground beside it: tuck in wherever is high and dry
    for (let tries = 0; tries < 120 && !site; tries++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 12;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (fb && Math.hypot(x - fb.x, z - fb.z) < 7) continue;
      if (lagoonFreeboard(x, z) < 1.0) continue;
      if (islandHeight(x, z) < 3.4) continue;
      if (islandNormal(x, z).y < 0.96) continue;
      site = { x, z, h: islandHeight(x, z) };
    }
  }
  if (!site) site = { x: 0, z: 6, h: islandHeight(0, 6) };

  const S = new THREE.Vector3(site.x, site.h, site.z);

  // ---- logs: a leaning teepee over a charred heart + two spares ----
  const logs = [];
  const N_LOGS = 6;
  for (let i = 0; i < N_LOGS; i++) {
    const a = (i / N_LOGS) * Math.PI * 2 + rand() * 0.5;
    const len = 0.85 + rand() * 0.2;
    const g = new THREE.CylinderGeometry(0.026, 0.038, len, 6);
    g.translate(0, len / 2, 0);
    g.rotateX(0.62 + rand() * 0.1);           // lean inward
    g.rotateY(-a);
    g.translate(Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34);
    logs.push(g);
  }
  for (let i = 0; i < 2; i++) {
    const len = 0.9 + rand() * 0.4;
    const g = new THREE.CylinderGeometry(0.03, 0.042, len, 6);
    g.rotateZ(Math.PI / 2);
    const a = rand() * Math.PI * 2;
    g.rotateY(a);
    g.translate(Math.cos(a + 1.3) * (0.9 + rand() * 0.5), 0.04, Math.sin(a + 1.3) * (0.9 + rand() * 0.5));
    logs.push(g);
  }
  const logGeo = mergeGeometries(logs);
  logGeo.translate(S.x, S.y, S.z);
  const logMat = new THREE.MeshStandardMaterial({
    map: barkTexture(true), roughness: 0.95, color: 0x6b5a49,
  });
  const logMesh = new THREE.Mesh(logGeo, logMat);
  logMesh.castShadow = true;
  logMesh.receiveShadow = true;
  group.add(logMesh);

  // charred heart: a shallow dark mound under the teepee
  const charGeo = new THREE.SphereGeometry(0.3, 12, 8);
  charGeo.scale(1, 0.28, 1);
  charGeo.translate(S.x, S.y + 0.02, S.z);
  const charMesh = new THREE.Mesh(charGeo, new THREE.MeshStandardMaterial({
    color: 0x191412, roughness: 1.0,
  }));
  charMesh.receiveShadow = true;
  group.add(charMesh);

  // ---- stone ring ----
  const stones = [];
  const N_ST = 9;
  for (let i = 0; i < N_ST; i++) {
    const a = (i / N_ST) * Math.PI * 2 + rand() * 0.3;
    const r0 = 0.09 + rand() * 0.05;
    const g = new THREE.IcosahedronGeometry(r0, 1);
    g.scale(1, 0.72, 1);
    g.rotateY(rand() * 6.3);
    const rx = S.x + Math.cos(a) * 0.62, rz = S.z + Math.sin(a) * 0.62;
    g.translate(rx, islandHeight(rx, rz) + r0 * 0.35, rz);
    stones.push(g);
  }
  const stoneMesh = new THREE.Mesh(
    mergeGeometries(stones),
    new THREE.MeshStandardMaterial({ color: 0x7e7a72, roughness: 0.97 })
  );
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;
  group.add(stoneMesh);

  // ---- flames: two crossed quads + a smaller hot core ----
  const noiseTex = foamTexture();
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  const flameMat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: uniforms.uTime,
      uFireK: { value: 1 },
      uNoise: { value: noiseTex },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const flames = new THREE.Group();
  const quad = (w, h, yaw) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 6), flameMat);
    m.position.set(S.x, S.y + h / 2 + 0.1, S.z);
    m.rotation.y = yaw;
    flames.add(m);
  };
  quad(0.95, 1.25, 0);
  quad(0.95, 1.25, Math.PI / 2);
  quad(0.6, 0.85, Math.PI / 4);
  group.add(flames);

  // ---- embers: a small pool of additive points, moved on the CPU ----
  const N_EMB = 42;
  const embGeo = new THREE.BufferGeometry();
  const embPos = new Float32Array(N_EMB * 3);
  const embCol = new Float32Array(N_EMB * 3);
  embGeo.setAttribute('position', new THREE.BufferAttribute(embPos, 3));
  embGeo.setAttribute('color', new THREE.BufferAttribute(embCol, 3));
  const embers = [];
  for (let i = 0; i < N_EMB; i++) {
    embers.push({ age: 1e9, life: 1, vx: 0, vy: 0, vz: 0, x: S.x, y: S.y, z: S.z });
    embPos[i * 3] = S.x; embPos[i * 3 + 1] = S.y; embPos[i * 3 + 2] = S.z;
  }
  const embMesh = new THREE.Points(embGeo, new THREE.PointsMaterial({
    size: 2.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  embMesh.frustumCulled = false;
  group.add(embMesh);

  // ---- smoke: soft sprites cycling upward ----
  const smokeTex = cloudTexture(73);
  const smokes = [];
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTex,
      color: 0x777777,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    sp.position.copy(S);
    scaleSprite(sp, 0.5);
    group.add(sp);
    smokes.push({ sprite: sp, age: i * 1.1, life: 4.2 });
  }
  function scaleSprite(sp, s) { sp.scale.set(s, s, 1); }

  // ---- light ----
  const light = new THREE.PointLight(0xff9a3c, 0, 16, 2);
  light.position.set(S.x, S.y + 0.7, S.z);
  group.add(light);

  // ---- live state ----
  let fireK = 1;

  function update(t, dt) {
    const storm = uniforms.uStorm.value;
    const wet = uniforms.uRainWet.value;
    // rain beats the flames down; lingering soak keeps them shy afterwards
    const target = Math.max(0.06, 1 - storm * 1.05 - wet * 0.25);
    fireK += (target - fireK) * Math.min(dt * 0.8, 1);
    flameMat.uniforms.uFireK.value = fireK;

    // flicker
    const fl = 0.72 + 0.28 * Math.sin(t * 11.3 + Math.sin(t * 7.1) * 2.2)
      + 0.12 * Math.sin(t * 23.7);
    const night = uniforms.uNightF.value;
    light.intensity = fireK * fl * (1.1 + night * 2.1);

    // embers
    const wind = uniforms.uWindDir.value, windAmp = uniforms.uWindAmp.value;
    for (const e of embers) {
      e.age += dt;
      if (e.age > e.life) {
        if (fireK > 0.3 && Math.random() < 0.5) {
          e.age = 0;
          e.life = 0.9 + Math.random() * 1.4;
          e.x = S.x + (Math.random() - 0.5) * 0.3;
          e.y = S.y + 0.25 + Math.random() * 0.3;
          e.z = S.z + (Math.random() - 0.5) * 0.3;
          e.vx = (Math.random() - 0.5) * 0.4;
          e.vy = 0.9 + Math.random() * 0.9;
          e.vz = (Math.random() - 0.5) * 0.4;
        } else {
          continue;
        }
      }
      e.vx += wind.x * windAmp * dt * 0.9 + (Math.random() - 0.5) * dt * 2.4;
      e.vz += wind.y * windAmp * dt * 0.9 + (Math.random() - 0.5) * dt * 2.4;
      e.vy -= dt * 0.35; // embers slow as they cool
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
    }
    for (let i = 0; i < N_EMB; i++) {
      const e = embers[i];
      const alive = e.age < e.life;
      embPos[i * 3] = e.x; embPos[i * 3 + 1] = e.y; embPos[i * 3 + 2] = e.z;
      const k = alive ? Math.pow(1 - e.age / e.life, 1.4) * fireK : 0;
      embCol[i * 3] = k; embCol[i * 3 + 1] = k * 0.42; embCol[i * 3 + 2] = k * 0.08;
    }
    embGeo.attributes.position.needsUpdate = true;
    embGeo.attributes.color.needsUpdate = true;

    // smoke: thicker while rain is quenching the fire
    const smokeK = 0.10 + (1 - fireK) * 0.16 + storm * 0.06;
    for (const s of smokes) {
      s.age += dt;
      if (s.age > s.life) {
        s.age = 0;
        s.life = 3.6 + Math.random() * 1.6;
        s.sprite.position.set(S.x, S.y + 0.5, S.z);
      }
      const k = s.age / s.life;
      s.sprite.position.y += dt * (0.55 - k * 0.2);
      s.sprite.position.x += wind.x * windAmp * dt * 0.5;
      s.sprite.position.z += wind.y * windAmp * dt * 0.5;
      scaleSprite(s.sprite, 0.5 + k * 2.4);
      s.sprite.material.opacity = Math.sin(Math.min(k, 1) * Math.PI) * smokeK;
    }
  }

  return { group, update, pos: S.clone(), fireK: () => fireK };
}
