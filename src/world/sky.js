// Atmosphere + day/night cycle. One full day lasts DAY_CYCLE_SECONDS.
// A single directional light plays the sun by day and the moon by night;
// every tone in the scene (sky, fog, hemisphere, water palette, clouds,
// stars, caustic strength) is lerped from the sun's elevation, and the
// image-based ambient light is rebaked from the live sky on a throttle.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { uniforms, FOG_COLOR, FOG_DENSITY, DAY_CYCLE_SECONDS } from '../core/env.js';
import { cloudTexture } from '../core/textures.js';
import { mulberry32 } from '../core/rng.js';
import { tideFromTod } from './swash.js';

export { DAY_CYCLE_SECONDS };
const DAY_FRAC = 0.72;    // fraction of the cycle with the sun up (~8.6 min day, ~3.4 min night)
const AZ0 = -1.17;        // start-of-cycle azimuth offset
const START_TOD = 0.60;   // begin in golden afternoon, ~90s before sunset colors

const sstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// three-key palette evaluated by sun elevation (degrees)
class Palette {
  constructor(day, dusk, night) {
    this.day = new THREE.Color(...day);
    this.dusk = new THREE.Color(...dusk);
    this.night = new THREE.Color(...night);
  }
  get(elevDeg, out) {
    return out.copy(this.night)
      .lerp(this.dusk, sstep(-7, 3, elevDeg))
      .lerp(this.day, sstep(7, 20, elevDeg));
  }
}

const PAL = {
  light: new Palette([1.0, 0.9, 0.75], [1.0, 0.42, 0.18], [0.55, 0.65, 0.95]),
  fog: new Palette([0.70, 0.80, 0.89], [0.68, 0.48, 0.40], [0.018, 0.032, 0.055]),
  hemiSky: new Palette([0.55, 0.71, 0.88], [0.48, 0.34, 0.38], [0.07, 0.09, 0.16]),
  hemiGround: new Palette([0.82, 0.72, 0.55], [0.52, 0.36, 0.28], [0.05, 0.05, 0.07]),
  cloud: new Palette([2.6, 2.5, 2.35], [2.7, 1.3, 0.9], [0.10, 0.12, 0.18]),
  sunShared: new Palette([1.0, 0.9, 0.72], [1.0, 0.5, 0.24], [0.5, 0.6, 0.9]),
  waterSun: new Palette([1.0, 0.86, 0.62], [1.0, 0.45, 0.18], [0.35, 0.45, 0.75]),
  waterZenith: new Palette([0.16, 0.36, 0.72], [0.09, 0.14, 0.42], [0.012, 0.022, 0.055]),
  waterHorizon: new Palette([0.42, 0.60, 0.82], [0.88, 0.46, 0.28], [0.035, 0.05, 0.09]),
  waterShallow: new Palette([0.05, 0.5, 0.46], [0.05, 0.32, 0.28], [0.008, 0.05, 0.06]),
  waterDeep: new Palette([0.02, 0.16, 0.29], [0.015, 0.09, 0.17], [0.004, 0.016, 0.035]),
};

function dirFrom(az, elev, out) {
  return out.set(
    Math.cos(elev) * Math.cos(az),
    Math.sin(elev),
    Math.cos(elev) * Math.sin(az)
  ).normalize();
}

// horizontal streak, bright head at the right, soft gaussian cross-section
function streakTexture() {
  const W = 128, H = 16;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    const dy = (j + 0.5) / H - 0.5;
    const g = Math.exp(-dy * dy * 26);
    for (let i = 0; i < W; i++) {
      const u = i / (W - 1);
      const head = Math.pow(u, 3.2);                 // brightens toward the head
      const tip = 1 - Math.max(0, (u - 0.94)) / 0.06; // rounded head tip
      const a = Math.min(head * tip, 1) * g;
      const k = (j * W + i) * 4;
      img.data[k] = 235; img.data[k + 1] = 240; img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function moonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(235,240,255,1)');
  g.addColorStop(0.22, 'rgba(225,232,252,0.98)');
  g.addColorStop(0.3, 'rgba(180,200,240,0.35)');
  g.addColorStop(1, 'rgba(150,180,230,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSky(scene, renderer, camera) {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.4;
  u.rayleigh.value = 3.1;
  u.mieCoefficient.value = 0.009;
  u.mieDirectionalG.value = 0.94;
  scene.add(sky);

  // ambient IBL rebaked from a tiny twin of the sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(80);
  Object.keys(u).forEach((k) => {
    const val = u[k].value;
    envSky.material.uniforms[k].value = val && val.clone ? val.clone() : val;
  });
  envScene.add(envSky);
  let envRT = null;
  function bakeEnv(sunDir) {
    envSky.material.uniforms.sunPosition.value.copy(sunDir);
    const rt = pmrem.fromScene(envScene, 0.04);
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  }
  scene.environmentIntensity = 0.55;

  // one light, two jobs (sun by day, moon by night — same shadow rig)
  const sun = new THREE.DirectionalLight(0xffffff, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90;
  sc.near = 40; sc.far = 420;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x8cb5e0, 0xd1b78c, 0.55);
  scene.add(hemi);

  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  // clouds
  const clouds = [];
  {
    const texA = cloudTexture(71);
    const texB = cloudTexture(72);
    const rand = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.SpriteMaterial({
        map: i % 2 ? texA : texB,
        color: new THREE.Color(2.6, 2.5, 2.35),
        transparent: true,
        opacity: rand(0.55, 0.8),
        depthWrite: false,
        fog: true,
      });
      const s = new THREE.Sprite(mat);
      const r = rand(380, 1500);
      const a = rand(0, Math.PI * 2);
      s.position.set(Math.cos(a) * r, rand(130, 340), Math.sin(a) * r);
      const w = rand(180, 420);
      s.scale.set(w, w * rand(0.30, 0.42), 1);
      scene.add(s);
      clouds.push({ sprite: s, speed: rand(0.9, 2.2), baseOpacity: mat.opacity });
    }
  }

  // stars
  const starMat = new THREE.PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  {
    const rand = mulberry32(97);
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // uniform-ish points on the upper dome
      const zc = 0.06 + rand() * 0.94;
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(1 - zc * zc, 0));
      pos[i * 3] = Math.cos(a) * rr * 3300;
      pos[i * 3 + 1] = zc * 3300;
      pos[i * 3 + 2] = Math.sin(a) * rr * 3300;
      const b = 0.35 + Math.pow(rand(), 2.2) * 0.65;
      const warm = rand();
      col[i * 3] = b * (warm > 0.8 ? 1.0 : 0.85);
      col[i * 3 + 1] = b * 0.9;
      col[i * 3 + 2] = b * (warm > 0.8 ? 0.8 : 1.0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, starMat);
    stars.frustumCulled = false;
    scene.add(stars);
  }

  // shooting stars: a tiny pool of streak sprites, spawned at random while
  // the stars are out. The sprite is rotated in screen space to match the
  // projected travel direction each frame.
  const meteors = [];
  {
    const tex = streakTexture();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }));
      s.scale.set(310, 13, 1);
      s.visible = false;
      scene.add(s);
      meteors.push({ sprite: s, age: 1e9, dur: 0.5, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    }
  }
  let meteorWait = 6;
  const _mNorm = new THREE.Vector3(), _mP1 = new THREE.Vector3(), _mP2 = new THREE.Vector3();

  function spawnMeteor(dur, azHint) {
    const m = meteors.find((mm) => mm.age >= mm.dur);
    if (!m) return false;
    const a = azHint !== undefined ? azHint : Math.random() * Math.PI * 2;
    const elev = 0.45 + Math.random() * 0.65;
    m.pos.set(
      Math.cos(elev) * Math.cos(a) * 3200,
      Math.sin(elev) * 3200,
      Math.cos(elev) * Math.sin(a) * 3200
    );
    // travel roughly along the dome, biased downward
    m.vel.set(Math.random() - 0.5, -(0.4 + Math.random() * 0.5), Math.random() - 0.5).normalize();
    _mNorm.copy(m.pos).normalize();
    m.vel.addScaledVector(_mNorm, -m.vel.dot(_mNorm));
    if (m.vel.lengthSq() < 0.05) m.vel.set(0.7, -0.7, 0);
    m.dur = dur || 0.45 + Math.random() * 0.4;
    // total travel is a fixed arc; speed follows from the lifetime
    m.vel.normalize().multiplyScalar((850 + Math.random() * 550) / m.dur);
    m.age = 0;
    if (dur) { // debug spawns start mid-arc at peak brightness
      m.age = m.dur * 0.42;
      m.pos.addScaledVector(m.vel, m.age);
    }
    m.sprite.visible = true;
    return true;
  }

  function updateMeteors(dt) {
    const vis = starMat.opacity / 0.85; // ride the star fade
    meteorWait -= dt * vis;
    if (meteorWait <= 0 && vis > 0.5) {
      spawnMeteor();
      meteorWait = 5 + Math.random() * 13;
    }
    for (const m of meteors) {
      if (m.age >= m.dur) { m.sprite.visible = false; continue; }
      m.age += dt;
      m.pos.addScaledVector(m.vel, dt);
      m.sprite.position.copy(m.pos);
      const k = m.age / m.dur;
      m.sprite.material.opacity = Math.sin(Math.min(k, 1) * Math.PI) * 0.9 * vis;
      if (camera) {
        _mP1.copy(m.pos).project(camera);
        _mP2.copy(m.pos).addScaledVector(m.vel, 0.02).project(camera);
        m.sprite.material.rotation = Math.atan2(_mP2.y - _mP1.y, (_mP2.x - _mP1.x) * camera.aspect);
      }
    }
  }

  // moon
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: moonTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  }));
  moon.scale.setScalar(260);
  scene.add(moon);

  // ---- the cycle ----
  let tod = START_TOD;
  let waterMat = null, pondMat = null;
  let lastBakeT = -100, lastBakeElev = 999, lastBakeStorm = 0;
  const _sunDir = new THREE.Vector3(), _moonDir = new THREE.Vector3();
  const _c = new THREE.Color();

  function angles(t01) {
    const az = t01 * Math.PI * 2 + AZ0;
    let sunElev, moonElev;
    if (t01 < DAY_FRAC) {
      const x = t01 / DAY_FRAC;
      sunElev = Math.sin(Math.PI * x) * 0.80;
      moonElev = -0.4;
    } else {
      const x = (t01 - DAY_FRAC) / (1 - DAY_FRAC);
      moonElev = Math.sin(Math.PI * x) * 0.70;
      sunElev = -0.12 - 0.5 * Math.sin(Math.PI * x);
    }
    return { az, sunElev, moonElev, moonAz: az + Math.PI * 0.9 };
  }

  function apply(t) {
    const { az, sunElev, moonElev, moonAz } = angles(tod);
    const elevDeg = THREE.MathUtils.radToDeg(sunElev);
    const moonDeg = THREE.MathUtils.radToDeg(moonElev);
    const storm = uniforms.uStorm.value;
    dirFrom(az, sunElev, _sunDir);
    dirFrom(moonAz, moonElev, _moonDir);

    // the sky dome always tracks the true sun (goes dark below the horizon);
    // squalls load the air with haze until the blue drowns in it
    u.sunPosition.value.copy(_sunDir);
    u.turbidity.value = 3.4 + 17 * storm;
    u.mieCoefficient.value = 0.009 + 0.028 * storm;

    // light role
    const sunI = 3.3 * sstep(-1, 12, elevDeg);
    const moonI = 0.5 * sstep(3, 16, moonDeg);
    const moonRole = moonI > sunI;
    const roleDir = moonRole ? _moonDir : _sunDir;
    sun.position.copy(roleDir).multiplyScalar(180);
    sun.intensity = Math.max(sunI, moonI, 0.02) * (1 - 0.78 * storm);
    if (moonRole) sun.color.setRGB(0.55, 0.65, 0.95);
    else PAL.light.get(elevDeg, sun.color);

    // shared shader uniforms (water spec, caustics, sparkle, footprints)
    uniforms.uSunDir.value.copy(roleDir);
    PAL.sunShared.get(elevDeg, uniforms.uSunColor.value);
    uniforms.uSunI.value = sstep(-1, 10, elevDeg) + 0.3 * sstep(3, 16, moonDeg);

    // fog + hemisphere (squalls gray the air out and thicken it)
    PAL.fog.get(elevDeg, scene.fog.color);
    if (storm > 0.001) {
      const lum = scene.fog.color.r * 0.3 + scene.fog.color.g * 0.5 + scene.fog.color.b * 0.2;
      _c.setRGB(lum * 0.62, lum * 0.66, lum * 0.7);
      scene.fog.color.lerp(_c, storm * 0.8);
    }
    scene.fog.density = FOG_DENSITY * (1 + 2.6 * storm);
    uniforms.uFogDensity.value = scene.fog.density;
    uniforms.uFogColor.value.copy(scene.fog.color);
    PAL.hemiSky.get(elevDeg, hemi.color);
    PAL.hemiGround.get(elevDeg, hemi.groundColor);
    hemi.intensity = (0.16 + 0.42 * sstep(-3, 15, elevDeg)) * (1 - 0.4 * storm);
    scene.environmentIntensity = 0.55 * (1 - 0.5 * storm);

    // ocean palette
    if (waterMat) {
      const wu = waterMat.uniforms;
      PAL.waterSun.get(elevDeg, wu.uSunColor.value);
      PAL.waterZenith.get(elevDeg, wu.uSkyZenith.value);
      PAL.waterHorizon.get(elevDeg, wu.uSkyHorizon.value);
      PAL.waterShallow.get(elevDeg, wu.uShallowColor.value);
      PAL.waterDeep.get(elevDeg, wu.uDeepColor.value);
    }

    // the lagoon mirrors the same sky as the sea
    if (pondMat) {
      PAL.waterZenith.get(elevDeg, pondMat.uniforms.uSkyZenith.value);
      PAL.waterHorizon.get(elevDeg, pondMat.uniforms.uSkyHorizon.value);
    }

    // clouds, stars, moon (the squall smothers the sky)
    PAL.cloud.get(elevDeg, _c);
    _c.multiplyScalar(1 - 0.62 * storm);
    for (const cl of clouds) {
      cl.sprite.material.color.copy(_c);
      cl.sprite.material.opacity = cl.baseOpacity * (1 + 0.5 * storm);
    }
    starMat.opacity = 0.85 * (1 - sstep(-11, -3, elevDeg)) * (1 - 0.9 * storm);
    uniforms.uNightF.value = 1 - sstep(-10, -2, elevDeg);

    // tide rides the same clock
    const tide = tideFromTod(tod);
    uniforms.uTide.value = tide.level;
    uniforms.uTideAng.value = tide.angle;
    moon.position.copy(_moonDir).multiplyScalar(3100);
    moon.material.opacity = 0.9 * sstep(1, 8, moonDeg) * (1 - sstep(-2, 6, elevDeg));

    // throttled ambient rebake (storm shifts count as sky changes too).
    // The steps must stay tiny: each bake swaps scene.environment in one
    // frame, and at 0.8° per step that ambient pop was visible every ~2s
    // (it read as the shadows on the sand flickering). Elevation can only
    // drift ~0.12° between bakes in normal play, so a big accumulated jump
    // means the clock was set (setTod/reseed) — bake that same frame, while
    // the whole scene is changing anyway, instead of snapping 0.25s later.
    const elevJump = Math.abs(elevDeg - lastBakeElev);
    if (elevJump > 5 ||
        (t - lastBakeT > 0.25 &&
         (elevJump > 0.12 || Math.abs(storm - lastBakeStorm) > 0.05))) {
      bakeEnv(_sunDir);
      lastBakeT = t;
      lastBakeElev = elevDeg;
      lastBakeStorm = storm;
    }
  }

  bakeEnv(dirFrom(angles(tod).az, angles(tod).sunElev, _sunDir));
  apply(0);

  function update(dt, t) {
    tod = (tod + dt / DAY_CYCLE_SECONDS) % 1;
    for (const c of clouds) {
      c.sprite.position.x += c.speed * dt;
      if (c.sprite.position.x > 1700) c.sprite.position.x = -1700;
    }
    updateMeteors(dt);
    apply(t);
  }

  return {
    sun,
    update,
    attachWater(mat) { waterMat = mat; },
    attachPond(mat) { pondMat = mat; },
    setTod(v) { tod = ((v % 1) + 1) % 1; },
    getTod: () => tod,
    warp(s) { tod = (tod + s / DAY_CYCLE_SECONDS) % 1; },
    meteor: (dur, azHint) => spawnMeteor(dur, azHint), // debug: force one now
  };
}
