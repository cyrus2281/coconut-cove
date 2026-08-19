// Coconut Cove — bootstrap: renderer, world assembly, UI, and the frame loop.

import * as THREE from 'three';
import { uniforms, FOG_COLOR } from './core/env.js';
import { applyAnisotropy } from './core/textures.js';
import {
  getSeed, setSeed, randomSeed, subSeed, DEFAULT_SEED, writeSeedParam,
} from './core/seed.js';
import { mulberry32 } from './core/rng.js';
import {
  buildTerrain, bakeHeightmap, islandHeight, shoreRadius, reseedIsland, lagoonInfo,
} from './world/island.js';
import { buildPond } from './world/pond.js';
import { buildFig } from './world/fig.js';
import { buildCampfire } from './world/campfire.js';
import { buildFireflies } from './world/fireflies.js';
import { buildButterflies } from './world/butterflies.js';
import { buildCoconuts } from './world/coconuts.js';
import { buildHammock } from './world/hammock.js';
import { reseedSwash } from './world/swash.js';
import { buildOcean } from './world/water.js';
import { buildHorizon } from './world/horizon.js';
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
import { buildReef } from './world/reef.js';
import { buildSealife } from './world/sealife.js';
import { buildUnderwater } from './world/underwater.js';
import { Player } from './player.js';
import { buildTouchUI } from './touchui.js';
import { OceanAudio } from './audio.js';

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const enterBtn = document.getElementById('enter');
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
player.onSplash = (k) => audio.splash(k);

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
  const horizon = buildHorizon();
  scene.add(horizon.group);
  const palms = buildPalms();
  scene.add(palms.group);
  const fig = buildFig();
  scene.add(fig.group);
  const scatterG = buildScatter();
  scene.add(scatterG);
  const campfire = buildCampfire(); // after scatter: it camps beside the cairn
  scene.add(campfire.group);
  audio.attachFire(campfire.pos, campfire.fireK);
  const fireflies = buildFireflies(player);
  scene.add(fireflies.group);
  const butterflies = buildButterflies(player);
  scene.add(butterflies.group);
  const coconuts = buildCoconuts(player, palms.trees, audio);
  scene.add(coconuts.group);
  const hammock = buildHammock(player, palms.trees, camera);
  scene.add(hammock.group);
  const crabs = buildCrabs(player, footprints);
  scene.add(crabs.group);
  const fish = buildFish(player);
  scene.add(fish.group);
  const reef = buildReef();
  scene.add(reef.group);
  const sealife = buildSealife(player, reef);
  scene.add(sealife.group);
  const birds = buildBirds(player, audio);
  scene.add(birds.group);
  // the seed decides how many turtles call this island home
  const turtles = (() => {
    const tr = mulberry32(subSeed('turtleCount'));
    const n = 1 + (tr() < 0.35 ? 1 : 0);
    const list = [];
    const g = new THREE.Group();
    g.name = 'turtles';
    for (let i = 0; i < n; i++) {
      const tu = buildTurtle(player, footprints, i ? String(i) : '');
      g.add(tu.group);
      list.push(tu);
    }
    return {
      group: g, list,
      update(t, dt) { for (const tu of list) tu.update(t, dt); },
    };
  })();
  scene.add(turtles.group);
  audio.attachWorld(player, palms.trees.map((t) => t.crown));
  // the surf layers pan to the surge beaches, which just moved
  audio.refreshZones();
  applyAnisotropy(renderer);
  return {
    terrain, heightTex, ocean, pond, horizon, palms, fig, scatterG,
    campfire, fireflies, butterflies, coconuts, hammock, crabs, fish,
    birds, turtles, reef, sealife,
  };
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
      world.terrain, world.ocean.group, world.pond.group, world.horizon.group,
      world.palms.group, world.fig.group, world.scatterG, world.campfire.group,
      world.fireflies.group, world.butterflies.group, world.coconuts.group,
      world.hammock.group, world.crabs.group, world.fish.group,
      world.birds.group, world.turtles.group, world.reef.group,
      world.sealife.group,
    ]) {
      scene.remove(obj);
      disposeDeep(obj);
    }
    world.heightTex.dispose();
    if (world.hammock.dispose) world.hammock.dispose(); // DOM hint + listeners
    if (player.resting) player.resting = false;
    footprints.clear();
  }
  world = buildWorldNow();
  applySeedMood();
  updateSeedTag();
}

world = buildWorldNow();

const boat = buildBoat();
scene.add(boat.group);

const weather = buildWeather(camera, audio);
scene.add(weather.group);
applySeedMood(); // the seed picks the arrival hour + sky

// the underwater feel (fog, sun shafts, motes, bubbles, boundary message)
// lives for the whole session; it reads the live island through uniforms
const underwater = buildUnderwater(player, camera, scene, sky, audio);
scene.add(underwater.group);
underwater.attachWeather(weather.group);

// ---- UI ----
const touchUI = buildTouchUI(player);

const seedTag = document.getElementById('seedTag');
const regenBtn = document.getElementById('regen');
function updateSeedTag() {
  seedTag.textContent = 'island #' + getSeed();
}
updateSeedTag();

// ⟳ / R rolls a fresh island and pins it in ?seed= (shareable, survives F5).
// It lives in the world, not on the title screen, so it only appears once
// you've walked out onto the beach
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
// one enter button for everyone: if a finger has touched the page, the
// tap brings the thumb controls along (no separate mobile button)
let touchIntent = false;
window.addEventListener('touchstart', () => { touchIntent = true; }, { passive: true });
enterBtn.addEventListener('click', () => enterWorld(touchIntent));
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
    muteBtn.classList.toggle('muted', audio.muted);
  } else if (e.code === 'KeyR' && player.enabled) {
    regenerateIsland();
  } else if (e.code === 'KeyE') {
    world.hammock.tryToggle && world.hammock.tryToggle();
  }
});
muteBtn.addEventListener('click', () => {
  muteBtn.blur(); // else Space (jump) re-clicks it
  audio.setMuted(!audio.muted);
  muteBtn.classList.toggle('muted', audio.muted);
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
  touchUI.setSwimming(player.swimming);
  world.birds.update(t, dt);
  sky.update(dt, t);
  underwater.update(t, dt); // after sky: it overrides the fog when submerged
  world.reef.update(t, dt, player);
  world.sealife.update(t, dt);
  world.crabs.update(t, dt);
  world.campfire.update(t, dt);
  world.fireflies.update(t, dt);
  world.butterflies.update(t, dt);
  world.coconuts.update(t, dt);
  world.hammock.update(t, dt);
  world.horizon.update(t);
  boat.update(t);
  world.fish.update(t, dt);
  world.turtles.update(t, dt);
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
  scene, renderer, camera, player, uniforms, audio, footprints, sky, boat, weather,
  get birds() { return world.birds; },
  get turtles() { return world.turtles; },
  get horizon() { return world.horizon; },
  get turtle() { return world.turtles.list[0]; },
  get crabs() { return world.crabs; },
  get fish() { return world.fish; },
  get reef() { return world.reef; },
  get sealife() { return world.sealife; },
  get campfire() { return world.campfire; },
  get fireflies() { return world.fireflies; },
  get butterflies() { return world.butterflies; },
  get coconuts() { return world.coconuts; },
  get hammock() { return world.hammock; },
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
  // stand by the campfire
  campview(bearing = 0.8, dist = 3.2) {
    const c = world.campfire.pos;
    const x = c.x + Math.cos(bearing) * dist, z = c.z + Math.sin(bearing) * dist;
    this.teleport(x, z, Math.atan2(-(c.x - x), -(c.z - z)), -0.18);
    return { fire: [+c.x.toFixed(1), +c.z.toFixed(1)], k: +world.campfire.fireK().toFixed(2) };
  },
  // stand back from the big fig, looking at it
  figview(bearing = 2.2, dist = 14) {
    const f = world.fig;
    if (!f.base) return 'no fig on this island';
    const x = f.base.x + Math.cos(bearing) * dist, z = f.base.z + Math.sin(bearing) * dist;
    this.teleport(x, z, Math.atan2(-(f.base.x - x), -(f.base.z - z)), 0.05);
    return { base: [+f.base.x.toFixed(1), +f.base.z.toFixed(1)] };
  },
  // stand on the beach nearest the volcano, looking out at it
  volcanoview() {
    const v = world.horizon.volcano;
    const az = Math.atan2(v.z, v.x);
    const r = shoreRadius(az) - 4;
    const x = Math.cos(az) * r, z = Math.sin(az) * r;
    this.teleport(x, z, Math.atan2(-(v.x - x), -(v.z - z)), 0.02);
    return { volcano: [Math.round(v.x), Math.round(v.z)], h: Math.round(v.h) };
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
  // float at the surface over the nth coral garden, looking down at it
  snorkel(n = 0) {
    const cl = world.reef.clusters[n % world.reef.clusters.length];
    if (!cl) return 'no reef on this island';
    overlay.classList.add('hidden');
    player.enabled = true;
    const az = Math.atan2(cl.z, cl.x);
    const x = cl.x + Math.cos(az) * 6, z = cl.z + Math.sin(az) * 6;
    player.pos.set(x, uniforms.uTide.value + 0.42, z);
    player.vel.set(0, 0, 0);
    player.swimming = true;
    player.yaw = Math.atan2(x - cl.x, z - cl.z);
    player.pitch = -0.5;
    return { cluster: [+cl.x.toFixed(1), +cl.z.toFixed(1)], depth: +(-cl.h).toFixed(1) };
  },
  // hang mid-water inside the nth coral garden
  dive(n = 0, above = 1.2) {
    const cl = world.reef.clusters[n % world.reef.clusters.length];
    if (!cl) return 'no reef on this island';
    overlay.classList.add('hidden');
    player.enabled = true;
    const az = Math.atan2(cl.z, cl.x);
    const x = cl.x + Math.cos(az) * 4.5, z = cl.z + Math.sin(az) * 4.5;
    player.pos.set(x, islandHeight(x, z) + above, z);
    player.vel.set(0, 0, 0);
    player.swimming = true;
    player.yaw = Math.atan2(x - cl.x, z - cl.z);
    player.pitch = -0.12;
    return { cluster: [+cl.x.toFixed(1), +cl.z.toFixed(1)], depth: +(-cl.h).toFixed(1) };
  },
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
