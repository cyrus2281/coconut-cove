// The weather director. The island used to know two skies; now it rolls
// eight — clear trade-wind days above all, but also fresh blows, gray lids,
// sea mists, drizzle, the old squall, proper thunderstorms and the occasional
// sunshower trailing a rainbow. Each weather is a set of channel targets the
// director eases into over half a minute or so; which sky comes next is
// rolled by forecast.js, where the weather that just ended bends the odds.
//
// Channels → shared uniforms: cloud drives uStorm (dim light, gray sea,
// hazy air — every old squall consumer keeps working), rain drives uRain
// (streak density, patter, pond dimples) and soaks uRainWet (which keeps
// drying long after the rain stops), fog drives uFogW (milky air), wind
// drives uWindAmp, and thunderstorm strikes pulse uFlash for sky.js to
// light the whole world with.

import * as THREE from 'three';
import { uniforms, DAY_CYCLE_SECONDS } from '../core/env.js';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { rainbowTexture } from '../core/textures.js';
import { WEATHER_IDS, pickNext, pickArrival, transitionOdds } from './forecast.js';

// spell is how long the sky holds, in day-cycles: a sunny stretch settles in
// for most of a day, a sunshower is minutes. rain above 1 only packs the
// streaks denser — the shader/audio side clamps at 1.
export const WEATHER_LOOKS = {
  sunny:     { cloud: 0,    rain: 0,    fog: 0,    wind: 1.0,  spell: [0.55, 1.3] },
  breezy:    { cloud: 0.12, rain: 0,    fog: 0,    wind: 2.3,  spell: [0.3, 0.7] },
  overcast:  { cloud: 0.55, rain: 0,    fog: 0.12, wind: 1.25, spell: [0.25, 0.6] },
  mist:      { cloud: 0.3,  rain: 0,    fog: 1.0,  wind: 0.35, spell: [0.15, 0.4] },
  drizzle:   { cloud: 0.45, rain: 0.35, fog: 0.25, wind: 1.15, spell: [0.15, 0.4] },
  squall:    { cloud: 1.0,  rain: 1.0,  fog: 0.15, wind: 2.7,  spell: [0.1, 0.2] },
  thunder:   { cloud: 1.0,  rain: 1.2,  fog: 0.2,  wind: 3.1,  spell: [0.12, 0.22], lightning: true },
  sunshower: { cloud: 0.15, rain: 0.3,  fog: 0,    wind: 1.2,  spell: [0.08, 0.18], rainbow: true },
};

const RAIN_COUNT = 700;
const CYL_R = 15;    // rain cylinder radius around the camera
const CYL_H = 13;    // and height
const FALL_SPEED = 15;

export function buildWeather(camera, audio) {
  // rain as line segments: cheap, and exactly how rain reads in motion
  const positions = new Float32Array(RAIN_COUNT * 2 * 3);
  const seeds = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    seeds[i * 3] = (Math.random() * 2 - 1) * CYL_R;
    seeds[i * 3 + 1] = Math.random() * CYL_H;
    seeds[i * 3 + 2] = (Math.random() * 2 - 1) * CYL_R;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xb8c8d4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.visible = false;
  lines.frustumCulled = false;
  lines.renderOrder = 3;

  // the sunshower's rainbow: one huge soft sprite hung at the anti-solar
  // point, far enough out that the island sits under it
  const bowMat = new THREE.SpriteMaterial({
    map: rainbowTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // a rainbow is added light, never shade
    fog: false,
  });
  const bow = new THREE.Sprite(bowMat);
  bow.scale.set(2600, 1300, 1);
  bow.visible = false;

  const group = new THREE.Group();
  group.name = 'weather';
  group.add(lines);
  group.add(bow);

  const W = {
    id: 'sunny',
    spellT: 600,
    cloud: 0, rain: 0, fog: 0, wind: 1, bowK: 0,
    groundWet: 0,
    flash: 0, strikeIn: 8, reFlash: 0,
    fallPhase: 0,
  };

  function setWeather(id, rand = Math.random) {
    const look = WEATHER_LOOKS[id] ?? WEATHER_LOOKS.sunny;
    W.id = WEATHER_LOOKS[id] ? id : 'sunny';
    W.spellT = (look.spell[0] + rand() * (look.spell[1] - look.spell[0])) * DAY_CYCLE_SECONDS;
    W.strikeIn = 5 + rand() * 9;
    return W.id;
  }

  // write every eased channel to the shared uniforms
  function push() {
    uniforms.uStorm.value = W.cloud;
    uniforms.uRain.value = Math.min(W.rain, 1);
    uniforms.uFogW.value = W.fog;
    uniforms.uWindAmp.value = W.wind;
    uniforms.uRainWet.value = W.groundWet;
  }

  // snap the channels straight to the current weather's targets (arrival)
  function snap(r) {
    const look = WEATHER_LOOKS[W.id];
    W.cloud = look.cloud;
    W.rain = look.rain;
    W.fog = look.fog;
    W.wind = look.wind;
    W.bowK = look.rainbow ? 1 : 0;
    W.groundWet = look.rain > 0
      ? Math.min(look.rain, 1) * (0.6 + 0.4 * r())
      : (W.id === 'mist' ? 0.3 : 0);
    W.flash = 0;
    uniforms.uFlash.value = 0;
    push();
  }

  function update(t, dt) {
    // ---- the cycle: hold the spell, then let the forecast roll the next ----
    W.spellT -= dt;
    if (W.spellT <= 0) setWeather(pickNext(W.id, Math.random()));
    const look = WEATHER_LOOKS[W.id];

    // ---- ease the channels toward this weather's targets ----
    // heavy skies keep the squall's old slow breathing; the wind always
    // gusts a little around whatever the weather asks for
    const breathe = 1 - 0.08 * (0.5 + 0.5 * Math.sin(t * 0.7)) * look.cloud;
    const gust = 1 + 0.06 * Math.sin(t * 0.23) + 0.045 * Math.sin(t * 0.57);
    W.cloud += (look.cloud * breathe - W.cloud) * Math.min(dt * 0.045, 1);
    W.rain += (look.rain - W.rain) * Math.min(dt * 0.05, 1);
    W.fog += (look.fog - W.fog) * Math.min(dt * 0.03, 1);
    W.wind += (Math.max(look.wind * gust, 0.05) - W.wind) * Math.min(dt * 0.06, 1);
    W.bowK += ((look.rainbow ? 1 : 0) - W.bowK) * Math.min(dt * 0.05, 1);

    // ground soaks fast under rain, dries out over ~2 minutes afterwards
    const soak = Math.min(W.rain, 1);
    if (soak > W.groundWet) W.groundWet += (soak - W.groundWet) * Math.min(dt * 0.12, 1);
    else W.groundWet *= Math.exp(-dt / 120);

    // ---- lightning: strikes land seconds apart while the cell is overhead ----
    if (look.lightning && W.cloud > 0.65) {
      W.strikeIn -= dt;
      if (W.strikeIn <= 0) {
        W.strikeIn = 4 + Math.random() * 11;
        W.flash = 0.75 + Math.random() * 0.45;
        // about half the strikes flare a second time a beat later
        W.reFlash = Math.random() < 0.5 ? 0.09 + Math.random() * 0.13 : 0;
        // the thunder arrives late from however far off the bolt landed
        const delay = 0.4 + Math.random() * 2.6;
        if (audio) audio.thunder(delay, 1 / (0.7 + delay * 0.5));
      }
    }
    if (W.reFlash > 0) {
      W.reFlash -= dt;
      if (W.reFlash <= 0) W.flash = Math.max(W.flash, 0.9 + Math.random() * 0.3);
    }
    W.flash *= Math.exp(-dt * 7);
    uniforms.uFlash.value = W.flash > 0.004 ? W.flash : 0;

    push();
    if (audio) audio.setRain(Math.min(W.rain, 1));

    // ---- the rainbow rides opposite whichever body lights the sky ----
    if (W.bowK > 0.01) {
      const sd = uniforms.uSunDir.value;
      const az = Math.atan2(-sd.z, -sd.x);
      bow.position.set(
        camera.position.x + Math.cos(az) * 2400,
        camera.position.y + 250,
        camera.position.z + Math.sin(az) * 2400
      );
      bowMat.opacity = 0.62 * W.bowK * (1 - uniforms.uNightF.value) * (1 - W.cloud);
      bow.visible = bowMat.opacity > 0.01;
    } else if (bow.visible) {
      bow.visible = false;
    }

    // ---- rain streaks around the camera ----
    const rainK = Math.min(W.rain, 1);
    if (W.rain > 0.03) {
      lines.visible = true;
      mat.opacity = 0.34 * rainK;
      // a drizzle falls thin and a touch slower than a squall
      const drops = Math.min(RAIN_COUNT, Math.round(RAIN_COUNT * W.rain / 1.2));
      geo.setDrawRange(0, drops * 2);
      W.fallPhase += FALL_SPEED * (0.7 + 0.3 * rainK) * dt;
      const shearX = uniforms.uWindDir.value.x * 2.2 * rainK;
      const shearZ = uniforms.uWindDir.value.y * 2.2 * rainK;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < drops; i++) {
        // wrap each drop into the moving cylinder around the camera
        const fy = (seeds[i * 3 + 1] - W.fallPhase) % CYL_H;
        const y = cy + (fy < 0 ? fy + CYL_H : fy) - CYL_H * 0.45;
        const x = cx + (((seeds[i * 3] - cx) % CYL_R + CYL_R * 1.5) % (CYL_R * 2)) - CYL_R;
        const z = cz + (((seeds[i * 3 + 2] - cz) % CYL_R + CYL_R * 1.5) % (CYL_R * 2)) - CYL_R;
        const j = i * 6;
        positions[j] = x;
        positions[j + 1] = y + 0.62;
        positions[j + 2] = z;
        positions[j + 3] = x + shearX * 0.05;
        positions[j + 4] = y;
        positions[j + 5] = z + shearZ * 0.05;
      }
      geo.attributes.position.needsUpdate = true;
    } else if (lines.visible) {
      lines.visible = false;
    }
  }

  // the island seed decides what sky you arrive under: sunny more often than
  // anything (nobody books a holiday into a thunderstorm), but any of the
  // eight can be waiting, already settled in
  function reseed() {
    const r = mulberry32(subSeed('weather'));
    setWeather(pickArrival(r()), r);
    W.spellT *= 0.35 + 0.65 * r(); // arrive mid-spell, not at its first minute
    snap(r);
  }

  // hard reset to a clear sky (the curated default island's arrival state)
  function clearNow() {
    setWeather('sunny');
    snap(Math.random);
    if (audio) audio.setRain(0);
  }

  return {
    group,
    update,
    reseed,
    clearNow,
    // debug: call the next sky now; it rolls in the way the real one would
    set: (id) => setWeather(id),
    weathers: () => WEATHER_IDS.slice(),
    // what the current sky is likely to hand over to
    forecast() {
      const odds = transitionOdds(W.id);
      for (const k of Object.keys(odds)) odds[k] = +odds[k].toFixed(3);
      return odds;
    },
    // debug compat: bring a squall on (or end it) right now
    rain(on = true) {
      return setWeather(on ? 'squall' : 'sunny');
    },
    state: () => ({
      weather: W.id,
      cloud: +W.cloud.toFixed(2),
      rain: +W.rain.toFixed(2),
      fog: +W.fog.toFixed(2),
      wind: +W.wind.toFixed(2),
      wet: +W.groundWet.toFixed(2),
      spellLeft: Math.round(W.spellT),
    }),
  };
}
