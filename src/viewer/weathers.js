// The weather wing of the /components gallery: one tiny island — a scoop of
// sand, a single palm, a ring of sea, a few grass tufts — living under each
// sky the island can roll. Every entry drives the same shared uniforms the
// world's weather director does, so the palm bends, the sea roughens and the
// sand soaks through the real shader paths; the rain, clouds, mist banks,
// lightning and the rainbow are scaled-down local props (the world versions
// wrap the camera and would swallow the studio whole).
//
// Two poses everywhere: `settled` is the weather in full swing, `rolling in`
// resets to a calm sky and lets the front arrive the way it does out there.

import * as THREE from 'three';
import { uniforms } from '../core/env.js';
import { cloudTexture, rainbowTexture, sandTextures } from '../core/textures.js';
import { MeshData, buildPalm, palmMaterials } from '../world/palms.js';
import { grassTuft, grassMaterial } from '../world/scatter.js';
import { WEATHER_LOOKS } from '../world/weather.js';

const R_ISLE = 2.5;   // sand crest radius
const R_SEA = 4.6;    // the ring of sea around it
const RAIN_N = 240;   // local rain streaks
const RAIN_H = 4.4;

const SAND_DRY = new THREE.Color(1, 1, 1);
const SAND_WET = new THREE.Color(0.55, 0.53, 0.5);
const SEA_FAIR = new THREE.Color(0x2f8fa3);
const SEA_GRAY = new THREE.Color(0x5c6d72);

const sstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// one gentle dome falling away to a seabed shelf, with a little lumpiness
function isleHeight(x, z, ph) {
  const r = Math.hypot(x, z);
  const crest = 0.66 * Math.exp(-(r * r) / (R_ISLE * R_ISLE * 0.34));
  const shelf = 0.5 * sstep(R_ISLE * 0.62, R_SEA * 0.9, r);
  const lump = 0.035 * Math.sin(x * 2.3 + ph) * Math.sin(z * 1.9 + ph * 1.7);
  return crest - shelf + lump * (1 - sstep(R_ISLE, R_SEA, r));
}

function buildIslet(rand) {
  const ph = rand() * 9;
  const group = new THREE.Group();

  // ---- the sand, wearing the island's own texture ----
  // a displaced grid, with everything past the sea rim pinched onto the rim
  // circle so no dry corner pokes out from under the round sea
  const SIZE = R_SEA * 2;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, 56, 56).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > R_SEA - 0.05) {
      const k = (R_SEA - 0.05) / r;
      x *= k;
      z *= k;
      pos.setX(i, x);
      pos.setZ(i, z);
    }
    pos.setY(i, isleHeight(x, z, ph));
  }
  geo.computeVertexNormals();
  const { map, normalMap } = sandTextures();
  map.repeat.set(SIZE / 5.2, SIZE / 5.2);
  normalMap.repeat.set(SIZE / 5.2, SIZE / 5.2);
  const sandMat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.88,
  });
  const sand = new THREE.Mesh(geo, sandMat);
  sand.receiveShadow = true;
  group.add(sand);

  // ---- the ring of sea ----
  const seaMat = new THREE.MeshStandardMaterial({
    color: SEA_FAIR.clone(),
    transparent: true,
    opacity: 0.8,
    roughness: 0.16,
    metalness: 0.02,
  });
  const sea = new THREE.Mesh(new THREE.CircleGeometry(R_SEA, 64).rotateX(-Math.PI / 2), seaMat);
  sea.position.y = 0.02;
  group.add(sea);

  // ---- one palm on the crest, leaning seaward ----
  const bark = new MeshData(), leaf = new MeshData(), husk = new MeshData();
  const px = 0.35, pz = -0.2;
  const leanA = rand() * Math.PI * 2;
  buildPalm(bark, leaf, husk, {
    x: px, z: pz, baseY: isleHeight(px, pz, ph) - 0.16,
    height: 3.4 + rand() * 0.9,
    leanDir: new THREE.Vector2(Math.cos(leanA), Math.sin(leanA)),
    leanAmount: 0.45 + rand() * 0.7,
    seed: (rand() * 0xffffffff) >>> 0,
  });
  const { barkMat, leafMat, huskMat } = palmMaterials();
  for (const [data, m] of [[bark, barkMat], [leaf, leafMat], [husk, huskMat]]) {
    const mesh = new THREE.Mesh(data.build(), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- a few grass tufts on the slope ----
  const grass = new MeshData();
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2, d = 0.8 + rand() * 0.9;
    grassTuft(grass, Math.cos(a) * d, Math.sin(a) * d, rand, (x, z) => isleHeight(x, z, ph));
  }
  group.add(new THREE.Mesh(grass.build(), grassMaterial()));

  return { group, sandMat, seaMat };
}

// the local weather props: clouds, mist banks, rain, lightning, rainbow
function buildEffects(rand) {
  const fx = new THREE.Group();

  const puffs = [];
  const texA = cloudTexture(171), texB = cloudTexture(172);
  for (let i = 0; i < 3; i++) {
    const m = new THREE.SpriteMaterial({
      map: i % 2 ? texA : texB,
      color: new THREE.Color(1, 1, 1),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const s = new THREE.Sprite(m);
    s.position.set(-1.4 + i * 1.4 + (rand() - 0.5), 3.3 + i * 0.35, (rand() - 0.5) * 1.6);
    s.scale.set(2.7, 1.15, 1);
    fx.add(s);
    puffs.push({ sprite: s, drift: 0.1 + rand() * 0.1, baseO: 0.5 + rand() * 0.2 });
  }

  // the viewer has no scene fog, so these banks carry the whole mist alone:
  // thick, low, and crowding the waterline from every side
  const mists = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.SpriteMaterial({
      map: i % 2 ? texB : texA,
      color: new THREE.Color(0.95, 0.97, 0.99),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const s = new THREE.Sprite(m);
    const a = (i / 10) * Math.PI * 2 + rand();
    const d = 1.1 + rand() * 2.3;
    s.position.set(Math.cos(a) * d, 0.35 + (i % 3) * 0.42 + rand() * 0.2, Math.sin(a) * d);
    s.scale.set(4.6 + rand() * 1.4, 1.7 + rand() * 0.5, 1);
    fx.add(s);
    mists.push({ sprite: s, drift: (i % 2 ? 1 : -1) * (0.06 + rand() * 0.08), baseO: 0.68 + rand() * 0.17 });
  }

  // rain: the world's line-segment trick at diorama scale, fixed on the islet
  const rainPos = new Float32Array(RAIN_N * 2 * 3);
  const rainSeed = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (R_SEA - 0.4);
    rainSeed[i * 3] = Math.cos(a) * d;
    rainSeed[i * 3 + 1] = rand() * RAIN_H;
    rainSeed[i * 3 + 2] = Math.sin(a) * d;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xb8c8d4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.visible = false;
  rain.frustumCulled = false;
  fx.add(rain);

  // lightning: a point light above the cloud deck, spiking per strike
  const bolt = new THREE.PointLight(0xdfe9ff, 0, 26, 1.8);
  bolt.position.set(0.4, 4.4, 0.2);
  fx.add(bolt);

  // the rainbow, arched behind the islet
  const bowMat = new THREE.SpriteMaterial({
    map: rainbowTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bow = new THREE.Sprite(bowMat);
  bow.position.set(-2.0, 1.15, -2.0);
  bow.scale.set(7.5, 3.75, 1);
  bow.visible = false;
  fx.add(bow);

  return { fx, puffs, mists, rain, rainGeo, rainMat, rainSeed, rainPos, bolt, bowMat, bow };
}

function weatherEntry(id, label) {
  const look = WEATHER_LOOKS[id];
  return {
    id: 'wx-' + id, label, section: 'weather', env: 'beach',
    build(rand) {
      const islet = buildIslet(rand);
      const eff = buildEffects(rand);
      const root = new THREE.Group();
      root.add(islet.group);
      root.add(eff.fx);

      const state = { anim: 'settled' };
      const ch = { cloud: 0, rain: 0, fog: 0, wind: 1, bow: 0, wet: 0, flash: 0, strikeIn: 1.5, fall: 0 };
      let lastPose = 'settled';

      return {
        object: root,
        focus: islet.group,
        floor: false,
        anims: [
          { id: 'settled', label: 'settled' },
          { id: 'roll', label: 'rolling in' },
        ],
        state,
        tick(t, dt) {
          if (state.anim !== lastPose) {
            lastPose = state.anim;
            if (state.anim === 'roll') {
              // hand the front a calm sky to arrive over
              ch.cloud = ch.rain = ch.fog = ch.bow = ch.wet = 0;
              ch.wind = 1;
            }
          }
          // `settled` snaps in a couple of seconds; the roll takes its time
          const k = Math.min(dt * (state.anim === 'roll' ? 0.09 : 1.2), 1);
          ch.cloud += (look.cloud - ch.cloud) * k;
          ch.rain += (look.rain - ch.rain) * k;
          ch.fog += (look.fog - ch.fog) * k;
          ch.wind += (look.wind - ch.wind) * k;
          ch.bow += ((look.rainbow ? 1 : 0) - ch.bow) * k;
          const rainK = Math.min(ch.rain, 1);
          const wetT = rainK * 0.85;
          ch.wet += (wetT - ch.wet) * Math.min(dt * (wetT > ch.wet ? 0.5 : 0.06), 1);

          // shared uniforms: the palm and the grass answer the wind, and the
          // studio's own lights grade themselves off the gloom and the flash
          uniforms.uWindAmp.value = ch.wind;
          uniforms.uStorm.value = ch.cloud;
          uniforms.uRain.value = rainK;
          uniforms.uRainWet.value = ch.wet;
          uniforms.uFogW.value = ch.fog;
          uniforms.uFlash.value = ch.flash;

          // sand darkens as it soaks; the sea grays under gloom and pales in mist
          islet.sandMat.color.lerpColors(SAND_DRY, SAND_WET, ch.wet * 0.75);
          islet.seaMat.color.lerpColors(SEA_FAIR, SEA_GRAY, Math.min(ch.cloud * 0.7 + ch.fog * 0.55, 1));
          islet.seaMat.roughness = 0.16 + 0.3 * rainK + 0.07 * Math.max(ch.wind - 1, 0);

          // lightning: quick strikes while the cell is dark enough
          if (look.lightning && ch.cloud > 0.6) {
            ch.strikeIn -= dt;
            if (ch.strikeIn <= 0) {
              ch.strikeIn = 2.2 + Math.random() * 3.6;
              ch.flash = 0.8 + Math.random() * 0.4;
            }
          }
          ch.flash *= Math.exp(-dt * 7);
          eff.bolt.intensity = ch.flash * 150;

          // cloud deck: white wisps on a breeze, a charcoal lid in a storm
          const cloudVis = Math.min(ch.cloud * 1.7, 1);
          for (const p of eff.puffs) {
            p.sprite.position.x += p.drift * dt;
            if (p.sprite.position.x > 2.6) p.sprite.position.x = -2.6;
            p.sprite.material.opacity = p.baseO * (0.14 + 0.86 * cloudVis);
            const tone = 1.55 - 1.25 * ch.cloud + ch.flash * 1.4;
            p.sprite.material.color.setScalar(tone);
          }

          // mist banks slide through the palm
          for (const m of eff.mists) {
            m.sprite.position.x += m.drift * dt;
            if (m.sprite.position.x > 3) m.sprite.position.x = -3;
            if (m.sprite.position.x < -3) m.sprite.position.x = 3;
            m.sprite.material.opacity = m.baseO * ch.fog;
          }

          // rain streaks, thinned to the live intensity
          if (ch.rain > 0.03) {
            eff.rain.visible = true;
            eff.rainMat.opacity = 0.42 * rainK;
            const drops = Math.min(RAIN_N, Math.round(RAIN_N * ch.rain / 1.2));
            eff.rainGeo.setDrawRange(0, drops * 2);
            ch.fall += 10 * (0.7 + 0.3 * rainK) * dt;
            for (let i = 0; i < drops; i++) {
              const fy = (eff.rainSeed[i * 3 + 1] - ch.fall) % RAIN_H;
              const y = (fy < 0 ? fy + RAIN_H : fy) + 0.15;
              const j = i * 6;
              eff.rainPos[j] = eff.rainSeed[i * 3];
              eff.rainPos[j + 1] = y + 0.3;
              eff.rainPos[j + 2] = eff.rainSeed[i * 3 + 2];
              eff.rainPos[j + 3] = eff.rainSeed[i * 3] + 0.02 * ch.wind;
              eff.rainPos[j + 4] = y;
              eff.rainPos[j + 5] = eff.rainSeed[i * 3 + 2];
            }
            eff.rainGeo.attributes.position.needsUpdate = true;
          } else if (eff.rain.visible) {
            eff.rain.visible = false;
          }

          // the rainbow only stands once the shower is properly lit
          eff.bowMat.opacity = 0.62 * ch.bow;
          eff.bow.visible = eff.bowMat.opacity > 0.02;
        },
      };
    },
  };
}

export const WEATHER_EXHIBITS = [
  weatherEntry('sunny', 'sunny'),
  weatherEntry('breezy', 'fresh breeze'),
  weatherEntry('overcast', 'overcast'),
  weatherEntry('mist', 'sea mist'),
  weatherEntry('drizzle', 'drizzle'),
  weatherEntry('squall', 'squall'),
  weatherEntry('thunder', 'thunderstorm'),
  weatherEntry('sunshower', 'sunshower'),
];
