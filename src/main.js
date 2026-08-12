// Coconut Cove — bootstrap: renderer, world assembly, UI, and the frame loop.

import * as THREE from 'three';
import { uniforms, FOG_COLOR } from './core/env.js';
import { applyAnisotropy } from './core/textures.js';
import { buildTerrain, bakeHeightmap, islandHeight, shoreRadius } from './world/island.js';
import { buildOcean } from './world/water.js';
import { buildSky } from './world/sky.js';
import { buildPalms } from './world/palms.js';
import { buildScatter } from './world/scatter.js';
import { buildBirds } from './world/birds.js';
import { buildFootprints } from './world/footprints.js';
import { buildCrabs } from './world/crabs.js';
import { buildBoat } from './world/boat.js';
import { buildFish } from './world/fish.js';
import { buildTurtle } from './world/turtle.js';
import { buildWeather } from './world/weather.js';
import { Player } from './player.js';
import { buildTouchUI } from './touchui.js';
import { OceanAudio } from './audio.js';

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const enterBtn = document.getElementById('enter');
const enterTouchBtn = document.getElementById('enterTouch');
const muteBtn = document.getElementById('mute');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.66;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 42000);

const audio = new OceanAudio();

// ---- world ----
const sky = buildSky(scene, renderer, camera);
const terrain = buildTerrain();
scene.add(terrain);
const heightTex = bakeHeightmap(512);
const ocean = buildOcean(heightTex);
scene.add(ocean.group);
const palms = buildPalms();
scene.add(palms.group);
scene.add(buildScatter());
sky.attachWater(ocean.material);

const footprints = buildFootprints();
scene.add(footprints.mesh);

const player = new Player(camera, canvas);
player.onStep = footprints.stamp;
audio.attachWorld(player, palms.trees.map((t) => t.crown));

const crabs = buildCrabs(player, footprints);
scene.add(crabs.group);

const boat = buildBoat();
scene.add(boat.group);

const fish = buildFish(player);
scene.add(fish.group);

const birds = buildBirds(scene, player, audio);

const turtle = buildTurtle(player, footprints);
scene.add(turtle.group);

applyAnisotropy(renderer);

const weather = buildWeather(camera, audio);
scene.add(weather.group);

// ---- UI ----
const touchUI = buildTouchUI(player);

function enterWorld(withTouch = false) {
  overlay.classList.add('hidden');
  player.enabled = true;
  audio.start();
  if (withTouch) touchUI.show();
  else player.requestLock();
}
enterBtn.addEventListener('click', () => enterWorld(false));
enterTouchBtn.addEventListener('click', () => enterWorld(true));
canvas.addEventListener('click', () => {
  if (!player.enabled || touchUI.active) return;
  if (document.pointerLockElement !== canvas) player.requestLock();
});
// anyone who starts touching the world gets the joystick automatically
canvas.addEventListener('touchstart', () => {
  if (player.enabled && !touchUI.active) touchUI.show();
}, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    audio.setMuted(!audio.muted);
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  }
});
muteBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- frame loop ----
const clock = new THREE.Clock();
let t = 0;
let fpsEMA = 60;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  fpsEMA = fpsEMA * 0.97 + (dt > 0 ? 1 / dt : 60) * 0.03;

  uniforms.uTime.value = t;
  player.update(dt);
  birds.update(t, dt);
  sky.update(dt, t);
  crabs.update(t, dt);
  boat.update(t);
  fish.update(t, dt);
  turtle.update(t, dt);
  weather.update(t, dt);
  audio.update(t);

  renderer.render(scene, camera);
});

// ---- debug hooks (used for automated screenshots; harmless in production) ----
const VIEWS = {
  overview: { pos: [95, 60, 95], yaw: Math.PI / 4, pitch: -0.42 },
  beach: null, // spawn
  waterline: { pos: [4, 1.8, 36], yaw: 2.6, pitch: -0.15 },
  shells: { pos: [8.6, 1.35, 29.5], yaw: 2.5, pitch: -0.7 },
  palm: { pos: [-5.2, 1.7, 34.8], yaw: 0.12, pitch: 0.62 },
  sun: { pos: [-20, 2.2, 38], yaw: 2.2, pitch: -0.02 },
};
window.__beach = {
  scene, renderer, camera, player, uniforms, audio, crabs, footprints, sky, boat, fish, birds, turtle, weather,
  fps: () => Math.round(fpsEMA),
  info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, fps: Math.round(fpsEMA) }),
  height: islandHeight,
  enter: enterWorld,
  // jump the world clock forward (waves, drying sand, footprint age;
  // pass false to leave the sky/time-of-day where it is)
  warp(s, skyToo = true) { t += s; if (skyToo) sky.warp(s); },
  setTod(v) { sky.setTod(v); },
  getTod: () => sky.getTod(),
  tide: () => ({
    level: +uniforms.uTide.value.toFixed(3),
    rising: Math.sin(uniforms.uTideAng.value) < 0,
  }),
  rain: (on = true) => weather.rain(on),
  // lay a test track of prints marching down the beach into the surge zone
  stampLine(az = 1.55) {
    const ox = Math.cos(az), oz = Math.sin(az);
    let side = 0, n = 0;
    for (let r = shoreRadius(az) - 7; r < shoreRadius(az) + 2 && n < 18; r += 0.48) {
      const x = ox * r, z = oz * r;
      const h = islandHeight(x, z);
      if (h < -0.06) break;
      side = 1 - side;
      const lat = (side ? 1 : -1) * 0.11;
      footprints.stamp(x - oz * lat, z + ox * lat, h, ox, oz, side);
      n++;
    }
    return n + ' prints stamped';
  },
  view(name) {
    overlay.classList.add('hidden');
    player.enabled = true;
    const v = VIEWS[name];
    if (!v) return;
    player.pos.set(v.pos[0], v.pos[1], v.pos[2]);
    player.vel.set(0, 0, 0);
    player.yaw = v.yaw;
    player.pitch = v.pitch;
  },
  teleport(x, z, yaw = 0, pitch = -0.1, eye = 1.66) {
    overlay.classList.add('hidden');
    player.enabled = true;
    player.pos.set(x, Math.max(islandHeight(x, z), -1) + eye, z);
    player.vel.set(0, 0, 0);
    player.yaw = yaw;
    player.pitch = pitch;
  },
};
