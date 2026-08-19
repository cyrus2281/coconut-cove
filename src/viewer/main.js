// The /components viewer: every piece of the island, one at a time, on a
// lit turntable with its poses on buttons. No island here, no player, no
// weather; just the assets, so their looks can be judged fast. Animals come
// from registry.js, everything else from props.js — a few props (the fig,
// the campfire, the pond) bring a patch of their own ground with them.
//
// The audio section is the odd one out: those entries have nothing to render,
// so they swap the stage for a panel and hand off to tracks.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { uniforms } from '../core/env.js';
import { mulberry32 } from '../core/rng.js';
import { uwPatch } from '../world/underwater.js';
import { REGISTRY } from './registry.js';
import { audioStudio } from './tracks.js';

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(1.6, 1.2, 2.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 40;

// ---- lights ----
const key = new THREE.DirectionalLight(0xfff1da, 2.4);
key.position.set(4, 6, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -4; key.shadow.camera.right = 4;
key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
key.shadow.camera.far = 30;
key.shadow.bias = -0.0004;
scene.add(key);

const rim = new THREE.DirectionalLight(0xcfe4f2, 0.9);
rim.position.set(-4, 3, -4);
scene.add(rim);

const hemi = new THREE.HemisphereLight(0xbfd9ea, 0xd9c9a3, 0.85);
scene.add(hemi);

// ---- stage ----
const stage = new THREE.Group(); // spins when the turntable is on
scene.add(stage);

// both floors are built at 10m and scaled to fit the specimen
const beachFloor = new THREE.Mesh(
  new THREE.CircleGeometry(10, 56).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0xd8c9a3, roughness: 1 })
);
beachFloor.receiveShadow = true;
scene.add(beachFloor);

const seaFloor = new THREE.Mesh(
  new THREE.CircleGeometry(10, 56).rotateX(-Math.PI / 2),
  uwPatch(new THREE.MeshStandardMaterial({ color: 0xb9ac83, roughness: 1 }), 'viewer-floor')
);
seaFloor.receiveShadow = true;
seaFloor.visible = false;
scene.add(seaFloor);

const grid = new THREE.GridHelper(4, 8, 0x88a0aa, 0x536770);
grid.material.transparent = true;
grid.material.opacity = 0.4;
grid.position.y = 0.002;
grid.visible = false;
scene.add(grid);

// ---- environments ----
// beach: warm sun, sand, open sky. water: teal fog, caustic light on the
// floor (uTide raised so the shared underwater shader wakes up). night
// flips the shared uniforms so glow effects (jelly) can be judged.
const ENVS = {
  beach: {
    bg: new THREE.Color(0x9ec4d8), fog: null,
    hemi: [0xbfd9ea, 0xd9c9a3, 0.85], key: 2.4, rim: 0.9,
    tide: -10, fogColor: new THREE.Color(0.70, 0.80, 0.89), fogDensity: 0.0004,
  },
  water: {
    bg: new THREE.Color(0x0d4358), fog: [0x0d4358, 0.045],
    hemi: [0xaadcee, 0x2a4a50, 0.9], key: 2.2, rim: 0.55,
    tide: 4, fogColor: new THREE.Color(0.16, 0.42, 0.5), fogDensity: 0.045,
  },
};

function updateFloors() {
  beachFloor.visible = !state.ownGround && state.env === 'beach';
  seaFloor.visible = !state.ownGround && state.env === 'water';
}

const state = {
  env: 'beach',
  ownGround: false,
  night: false,
  entry: null,
  view: null,     // { object, anims, state, tick, dispose?: fn | disposable[] }
  animId: null,
  seed: 2281,
  turntable: false,
  wireframe: false,
  speed: 1,
  touchedMats: new Set(),
};

function applyEnv() {
  const e = ENVS[state.env];
  const nightK = state.night ? 1 : 0;
  scene.background = e.bg.clone().multiplyScalar(state.night ? 0.14 : 1);
  scene.fog = e.fog ? new THREE.FogExp2(
    new THREE.Color(e.fog[0]).multiplyScalar(state.night ? 0.18 : 1), e.fog[1]) : null;
  hemi.color.set(e.hemi[0]);
  hemi.groundColor.set(e.hemi[1]);
  hemi.intensity = e.hemi[2] * (state.night ? 0.25 : 1);
  key.intensity = e.key * (state.night ? 0.12 : 1);
  key.color.set(state.night ? 0xa8c4e0 : 0xfff1da);
  rim.intensity = e.rim * (state.night ? 0.4 : 1);
  updateFloors();
  uniforms.uTide.value = e.tide;
  uniforms.uSunI.value = state.night ? 0.1 : 1;
  uniforms.uNightF.value = nightK;
  uniforms.uFogColor.value.copy(e.fogColor).multiplyScalar(state.night ? 0.2 : 1);
  uniforms.uFogDensity.value = e.fogDensity;
  document.querySelectorAll('#envRow [data-env]').forEach((b) => {
    b.classList.toggle('on', b.dataset.env === state.env);
  });
  document.getElementById('nightBtn').classList.toggle('on', state.night);
}

// ---- creature loading ----
// A view's optional `dispose` is either a teardown function or a list of
// resources (geometries, materials) the object tree below doesn't reach.
// Both shapes are in use, and calling the list would throw, so normalise.
function releaseView(dispose) {
  if (typeof dispose === 'function') dispose();
  else for (const r of [].concat(dispose ?? [])) r?.dispose?.();
}

function disposeView() {
  if (!state.view) return;
  releaseView(state.view.dispose);
  const shared = !!state.entry.shared;
  state.view.object.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !shared) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      }
    }
  });
  stage.remove(state.view.object);
  state.view = null;
}

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return 1;
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 0.08);
  controls.target.copy(center);
  const dir = new THREE.Vector3(0.55, 0.35, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, r * 2.8 + 0.15);
  camera.near = Math.max(r / 50, 0.005);
  camera.far = Math.max(200, r * 60);
  camera.updateProjectionMatrix();
  controls.maxDistance = Math.max(40, r * 14);
  controls.update();
  return r;
}

// A shell sits on a couple of metres of sand, a palm on ten, a volcano on
// nothing at all: floor, grid and shadow frustum all follow the specimen.
function fitStudio(r) {
  const floorK = THREE.MathUtils.clamp(r / 4, 0.22, 30);
  beachFloor.scale.setScalar(floorK);
  seaFloor.scale.setScalar(floorK);
  grid.scale.setScalar(THREE.MathUtils.clamp(r / 1.6, 0.15, 12));

  // past a certain size a 2048 map over the whole subject is mush, and the
  // props that big (the volcano, the far islands) cast nothing worth seeing
  key.castShadow = r <= 40;
  const s = Math.max(r * 1.6, 1);
  key.position.set(4, 6, 3).normalize().multiplyScalar(Math.max(r * 3, 8));
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.camera.far = Math.max(r * 9, 30);
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004 * Math.max(1, r / 2);
  rim.position.set(-4, 3, -4).normalize().multiplyScalar(Math.max(r * 3, 8));
}

function setWireframe(on) {
  if (!state.view) return;
  state.view.object.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.wireframe = on;
      state.touchedMats.add(m);
    }
  });
}

function loadCreature(entry, { reseed = false } = {}) {
  // wireframe is a per-material flag: clear it off shared materials first
  for (const m of state.touchedMats) m.wireframe = false;
  state.touchedMats.clear();
  disposeView();
  audioStudio.leave();

  // poses drive the shared weather uniforms (wind bends the palms, a squall
  // beats the campfire down), so hand the next specimen a calm day
  uniforms.uWindAmp.value = 1;
  uniforms.uStorm.value = 0;
  uniforms.uRainWet.value = 0;

  state.entry = entry;

  // nothing to build, frame or light: the track plays into the audio panel
  if (entry.kind === 'audio') {
    state.animId = audioStudio.enter(entry);
    renderAnimButtons();
    renderList();
    return;
  }

  if (reseed) state.seed = (Math.random() * 0xffffffff) >>> 0;
  const rand = mulberry32(state.seed ^ entry.id.length * 2654435761);
  const view = entry.build(rand);
  state.view = view;
  state.animId = view.state.anim;
  stage.add(view.object);
  stage.rotation.y = 0;

  // creatures cast shadows in the studio (skip see-through materials, a
  // butterfly quad would throw a solid rectangle otherwise)
  view.object.traverse((o) => {
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!mats.some((m) => m.transparent)) o.castShadow = true;
    }
  });

  if (state.env !== entry.env) {
    state.env = entry.env;
  }
  applyEnv();
  // a prop that carries its own ground (a dune, a pond basin, open sea)
  // stands on that instead of the studio's flat disc
  state.ownGround = view.floor === false;
  updateFloors();
  if (state.wireframe) setWireframe(true);

  // settle one tick so the pose is right before framing the camera
  view.tick(uniforms.uTime.value, 1 / 60);
  stage.updateMatrixWorld(true);
  // props framed on the prop itself, not on the patch of island under it
  fitStudio(frameObject(view.focus ?? view.object));

  renderAnimButtons();
  renderList();
  updateStatsSoon = 0.1;
}

// ---- UI ----
const listEl = document.getElementById('list');
function renderList() {
  listEl.innerHTML = '';
  let section = null;
  for (const entry of REGISTRY) {
    if (entry.section !== section) {
      section = entry.section;
      const h = document.createElement('div');
      h.className = 'section';
      h.textContent = section;
      listEl.appendChild(h);
    }
    const b = document.createElement('button');
    b.className = 'creature' + (state.entry === entry ? ' active' : '');
    b.textContent = entry.label;
    b.addEventListener('click', () => loadCreature(entry));
    listEl.appendChild(b);
  }
}

const animRow = document.getElementById('animRow');
const animLabel = animRow.querySelector('.chipLabel');
function renderAnimButtons() {
  animRow.querySelectorAll('button').forEach((b) => b.remove());
  // an audio track's poses are the world conditions that drive it (where you
  // stand, how hard it blows), so they ride the same chip row as a pose
  const audio = !!state.entry && state.entry.kind === 'audio';
  const anims = audio ? state.entry.anims : state.view ? state.view.anims : [];
  animLabel.style.display = anims.length ? '' : 'none';
  for (const a of anims) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.animId === a.id ? ' on' : '');
    b.textContent = a.label;
    b.addEventListener('click', () => {
      state.animId = a.id;
      if (audio) audioStudio.setPose(a.id);
      else state.view.state.anim = a.id;
      renderAnimButtons();
    });
    animRow.appendChild(b);
  }
}

document.querySelectorAll('#envRow [data-env]').forEach((b) => {
  b.addEventListener('click', () => {
    state.env = b.dataset.env;
    applyEnv();
  });
});
document.getElementById('nightBtn').addEventListener('click', () => {
  state.night = !state.night;
  applyEnv();
});

const turnBtn = document.getElementById('turnBtn');
turnBtn.addEventListener('click', () => {
  state.turntable = !state.turntable;
  turnBtn.classList.toggle('on', state.turntable);
});
const wireBtn = document.getElementById('wireBtn');
wireBtn.addEventListener('click', () => {
  state.wireframe = !state.wireframe;
  wireBtn.classList.toggle('on', state.wireframe);
  setWireframe(state.wireframe);
});
const gridBtn = document.getElementById('gridBtn');
gridBtn.addEventListener('click', () => {
  grid.visible = !grid.visible;
  gridBtn.classList.toggle('on', grid.visible);
});
document.getElementById('rerollBtn').addEventListener('click', () => {
  if (state.entry) loadCreature(state.entry, { reseed: true });
});
const speedEl = document.getElementById('speed');
const speedVal = document.getElementById('speedVal');
speedEl.addEventListener('input', () => {
  state.speed = parseFloat(speedEl.value);
  speedVal.textContent = state.speed.toFixed(2).replace(/0$/, '') + 'x';
});

// ---- stats ----
const statsEl = document.getElementById('stats');
let fpsEMA = 60;
let updateStatsSoon = 0;
function updateStats() {
  const info = renderer.info.render;
  statsEl.innerHTML = `${Math.round(fpsEMA)} fps · ${info.calls} calls<br/>`
    + `${info.triangles.toLocaleString()} triangles`;
}

// ---- frame loop ----
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = rawDt * state.speed;
  uniforms.uTime.value += dt;
  fpsEMA = fpsEMA * 0.95 + (rawDt > 0 ? 1 / rawDt : 60) * 0.05;

  if (state.view) state.view.tick(uniforms.uTime.value, dt);
  if (audioStudio.active) audioStudio.tick(uniforms.uTime.value);
  if (state.turntable) stage.rotation.y += rawDt * 0.5;
  controls.update();
  // the stage is hidden behind the audio panel; don't pay to draw it
  if (!audioStudio.active) renderer.render(scene, camera);

  updateStatsSoon -= rawDt;
  if (updateStatsSoon <= 0) {
    updateStatsSoon = 0.5;
    updateStats();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- go ----
renderList();
loadCreature(REGISTRY[0]);

// debug hooks for tooling/screenshots: pick a creature by id, set a pose,
// orbit the camera by angles
window.__viewer = {
  state, camera, controls, audio: audioStudio, renderer, scene,
  // one-shot frame grab that works even when the tab isn't compositing
  snap(q = 0.85) {
    controls.update();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', q);
  },
  load(id) {
    const entry = REGISTRY.find((e) => e.id === id);
    if (entry) loadCreature(entry);
    return entry ? entry.label : 'unknown id';
  },
  pose(id, settle = true) {
    if (state.entry && state.entry.kind === 'audio') {
      state.animId = id;
      audioStudio.setPose(id);
      renderAnimButtons();
      return;
    }
    if (!state.view) return;
    state.animId = id;
    state.view.state.anim = id;
    renderAnimButtons();
    // fast-forward the eased transitions so screenshots catch the settled
    // pose even when the tab's animation loop is throttled
    if (settle) {
      for (let i = 0; i < 30; i++) state.view.tick(uniforms.uTime.value + i * 0.12, 0.12);
    }
  },
  play() { audioStudio.entry && audioStudio.entry.shot ? audioStudio.trigger() : audioStudio.play(); },
  stop() { audioStudio.stop(); },
  track() { return audioStudio.info(); },
  orbit(azimuth = 0.6, polar = 1.2, dist = null) {
    const r = dist ?? camera.position.distanceTo(controls.target);
    camera.position.set(
      controls.target.x + r * Math.sin(polar) * Math.cos(azimuth),
      controls.target.y + r * Math.cos(polar),
      controls.target.z + r * Math.sin(polar) * Math.sin(azimuth)
    );
    controls.update();
  },
};
