// Coconut Cove — bootstrap: renderer, world assembly, UI, and the frame loop.

import * as THREE from 'three';
import { uniforms, FOG_COLOR } from './core/env.js';
import { applyAnisotropy } from './core/textures.js';
import {
  getSeed, setSeed, randomSeed, subSeed,
  DEFAULT_SEED, readRandomPref, writeRandomPref,
  writeSeedParam, clearSeedParam,
} from './core/seed.js';
import { mulberry32 } from './core/rng.js';
import {
  buildTerrain, bakeHeightmap, islandHeight, shoreRadius, reseedIsland, lagoonInfo,
} from './world/island.js';
import { buildPond } from './world/pond.js';
import { buildFig } from './world/fig.js';
import { reseedSwash } from './world/swash.js';
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
// Static pieces live for the whole session; everything whose shape depends
// on the island seed lives in `world` and can be regrown live.
const sky = buildSky(scene, renderer, camera);

const footprints = buildFootprints();
scene.add(footprints.mesh);

const player = new Player(camera, canvas);
player.onStep = footprints.stamp;

let world = null;

function buildWorldNow() {
  reseedSwash();
  reseedIsland();
  player.respawn();
  const terrain = buildTerrain();
  scene.add(terrain);
  const heightTex = bakeHeightmap(512);
  const ocean = buildOcean(heightTex);
  scene.add(ocean.group);
  sky.attachWater(ocean.material);
  const pond = buildPond();
  scene.add(pond.group);
  sky.attachPond(pond.material);
  const palms = buildPalms();
  scene.add(palms.group);
  const fig = buildFig();
  scene.add(fig.group);
  const scatterG = buildScatter();
  scene.add(scatterG);
  const crabs = buildCrabs(player, footprints);
  scene.add(crabs.group);
  const fish = buildFish(player);
  scene.add(fish.group);
  audio.attachWorld(player, palms.trees.map((t) => t.crown));
  applyAnisotropy(renderer);
  return { terrain, heightTex, ocean, pond, palms, fig, scatterG, crabs, fish };
}

function disposeDeep(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k in m) {
          if (m[k] && m[k].isTexture) m[k].dispose();
        }
        if (m.uniforms) {
          for (const u of Object.values(m.uniforms)) {
            if (u.value && u.value.isTexture) u.value.dispose();
          }
        }
        m.dispose();
      }
    }
  });
}

// the seed also picks the moment you arrive in: time of day (and with it
// the tide) plus the weather. The curated default island keeps its golden
// afternoon; every other seed rolls its own hour and sky.
function applySeedMood() {
  if (getSeed() === DEFAULT_SEED) {
    sky.setTod(0.60); // curated: golden afternoon, clear sky on arrival
    weather.clearNow();
    return;
  }
  sky.setTod(mulberry32(subSeed('tod'))());
  weather.reseed();
}

function rebuildWorld() {
  if (world) {
    for (const obj of [
      world.terrain, world.ocean.group, world.pond.group, world.palms.group,
      world.fig.group, world.scatterG, world.crabs.group, world.fish.group,
    ]) {
      scene.remove(obj);
      disposeDeep(obj);
    }
    world.heightTex.dispose();
    footprints.clear();
  }
  world = buildWorldNow();
  applySeedMood();
  updateSeedTag();
}

world = buildWorldNow();

const boat = buildBoat();
scene.add(boat.group);

const birds = buildBirds(scene, player, audio);

const turtle = buildTurtle(player, footprints);
scene.add(turtle.group);

const weather = buildWeather(camera, audio);
scene.add(weather.group);
applySeedMood(); // the seed picks the arrival hour + sky

// ---- UI ----
const touchUI = buildTouchUI(player);

// island seed controls. Two intents, kept from colliding by who owns the URL:
//   ⟳ new island  — roll one now and pin it in ?seed= (shareable, survives F5)
//   random toggle  — sticky "roll a fresh island every load", so it drops the
//                    ?seed= param (a pinned seed would otherwise win at boot)
const seedToggle = document.getElementById('seedToggle');
const seedTag = document.getElementById('seedTag');
const regenBtn = document.getElementById('regen');
function updateSeedTag() {
  seedTag.textContent = 'island #' + getSeed();
}
updateSeedTag();

seedToggle.checked = readRandomPref();
seedToggle.addEventListener('change', () => {
  writeRandomPref(seedToggle.checked);
  clearSeedParam();
  setSeed(seedToggle.checked ? randomSeed() : DEFAULT_SEED);
  rebuildWorld();
});

// ⟳ / R lives in the world, not on the title screen (which has its own
// seed controls), so it only appears once you've walked out onto the beach
function regenerateIsland() {
  regenBtn.blur(); // drop focus, or the next Space (jump) re-triggers the button
  regenBtn.classList.remove('spun');
  void regenBtn.offsetWidth; // restart the glyph spin
  regenBtn.classList.add('spun');
  setSeed(randomSeed());
  writeSeedParam(getSeed());
  rebuildWorld();
}
regenBtn.addEventListener('click', regenerateIsland);

function enterWorld(withTouch = false) {
  overlay.classList.add('hidden');
  regenBtn.classList.remove('hidden');
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
  } else if (e.code === 'KeyR' && player.enabled) {
    regenerateIsland();
  }
});
muteBtn.addEventListener('click', () => {
  muteBtn.blur(); // else Space (jump) re-clicks it
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
  world.crabs.update(t, dt);
  boat.update(t);
  world.fish.update(t, dt);
  turtle.update(t, dt);
  weather.update(t, dt);
  audio.update(t);

  renderer.render(scene, camera);

  // one-shot frame grab for tooling/screenshots (__beach.snap())
  if (window.__snapReq) {
    window.__snapReq = false;
    const c2 = document.createElement('canvas');
    c2.width = renderer.domElement.width;
    c2.height = renderer.domElement.height;
    c2.getContext('2d').drawImage(renderer.domElement, 0, 0);
    window.__cap = c2.toDataURL('image/jpeg', 0.86);
  }
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
  scene, renderer, camera, player, uniforms, audio, footprints, sky, boat, birds, turtle, weather,
  get crabs() { return world.crabs; },
  get fish() { return world.fish; },
  seed: () => getSeed(),
  reseed(s) {
    setSeed(s === undefined ? randomSeed() : s);
    rebuildWorld();
    return getSeed();
  },
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
  lagoon: () => lagoonInfo(),
  // stand back from the big fig, looking at it
  figview(bearing = 2.2, dist = 14) {
    const f = world.fig;
    if (!f.base) return 'no fig on this island';
    const x = f.base.x + Math.cos(bearing) * dist, z = f.base.z + Math.sin(bearing) * dist;
    this.teleport(x, z, Math.atan2(-(f.base.x - x), -(f.base.z - z)), 0.05);
    return { base: [+f.base.x.toFixed(1), +f.base.z.toFixed(1)] };
  },
  // stand on the lagoon bank looking across the water
  pondside(bearing = 0.9) {
    const L = lagoonInfo();
    if (!L) return 'this island has no lagoon';
    const d = L.rW * 1.5;
    const x = L.x + Math.cos(bearing) * d, z = L.z + Math.sin(bearing) * d;
    this.teleport(x, z, Math.atan2(-(L.x - x), -(L.z - z)), -0.12);
    return { center: [+L.x.toFixed(1), +L.z.toFixed(1)], level: +L.level.toFixed(2) };
  },
  rain: (on = true) => weather.rain(on),
  snap() { window.__snapReq = true; }, // grab the next rendered frame to window.__cap
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
