// The prop half of the /components registry: everything on the island that
// isn't an animal. Each entry builds one specimen with the very same code
// the island runs, so what you judge here is what grows out there. Props
// that hunt for their own site (the fig, the campfire, the pond) are built
// where the height field puts them and then slid to the studio origin with
// a patch of their own ground under them.

import * as THREE from 'three';
import { mulberry32, Simplex2 } from '../core/rng.js';
import { uniforms } from '../core/env.js';
import { setSeed, subSeed } from '../core/seed.js';
import { sandTextures } from '../core/textures.js';
import {
  islandHeight, islandNormal, lagoonInfo, lagoonFreeboard, reseedIsland,
} from '../world/island.js';
import { uwPatch } from '../world/underwater.js';
import { MeshData, buildPalm, buildFrond, palmMaterials } from '../world/palms.js';
import { buildFig } from '../world/fig.js';
import { nutMesh } from '../world/coconuts.js';
import { hammockRig } from '../world/hammock.js';
import { buildCampfire } from '../world/campfire.js';
import { buildBoat } from '../world/boat.js';
import { buildFootprints } from '../world/footprints.js';
import { pondGeometry, pondMaterial } from '../world/pond.js';
import {
  reefGeometry, reefMaterial, clamAssets, clamRig,
  FAN_TINTS, SPONGE_TINTS, STAR_TINTS, ANEM_TINTS,
} from '../world/reef.js';
import {
  spiralShellGeometry, scallopGeometry, clamGeometry, starfishGeometry,
  shellMaterial, starfishMaterial, SHELL_TINTS, pebbleAssets,
  boulderGeo, boulderMaterial, driftwoodGeo, driftwoodMaterial,
  wreckGeo, wreckMaterial, cairnStack, cairnRing,
  grassTuft, grassMaterial, reedClump, reedMaterial,
  seaweedClump, seaweedMaterial,
} from '../world/scatter.js';
import {
  volcanoCone, sisterDome, landformMaterial, volcanoPlume, updatePlume,
} from '../world/horizon.js';

const UP = new THREE.Vector3(0, 1, 0);
const FLAT = () => 0; // the studio floor, for props grown off the island

// ---------------------------------------------------------------- studio kit

// A patch of the real island: the height field sampled around (x, z),
// wearing the island's own sand.
function terrainPatch(cx, cz, r, { sea = false } = {}) {
  const SIZE = r * 2;
  const SEGS = Math.min(120, Math.max(24, Math.round(SIZE * 3)));
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, 0, cz);
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, islandHeight(x, z));
    const n = islandNormal(x, z);
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  geo.computeBoundingSphere();

  const { map, normalMap } = sandTextures();
  const TILE = 5.2; // meters per texture repeat, as on the island
  map.repeat.set(SIZE / TILE, SIZE / TILE);
  normalMap.repeat.set(SIZE / TILE, SIZE / TILE);
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.88,
    color: sea ? 0x9fb0a0 : 0xffffff, // the bed reads greener under water
  });
  if (sea) uwPatch(mat, 'viewer-patch');

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// Slide a prop that grew at a real site back to the studio origin, with its
// own ground under it, so the turntable spins about the prop and not the
// island it came from.
function sited(object, { x, z, r = 5, sea = false }) {
  const root = new THREE.Group();
  root.add(terrainPatch(x, z, r, { sea }));
  root.add(object);
  root.position.set(-x, -islandHeight(x, z), -z);
  return root;
}

// A flat sheet of sea for the things that live too far out for a sand floor.
function seaDisc(r) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(r, 72).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a5c74, roughness: 0.62, metalness: 0.04 })
  );
  mesh.position.y = -0.01;
  return mesh;
}

function meshOf(data, mat) {
  const mesh = new THREE.Mesh(data.build(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Single-instance stand-in for the reef's instanced beds: same geometry,
// same material, same per-instance tint the beds would have handed it.
function oneInstance(geo, mat, { scale = 1, tint = null, y = 0 }) {
  const inst = new THREE.InstancedMesh(geo, mat, 1);
  inst.frustumCulled = false;
  inst.setMatrixAt(0, new THREE.Matrix4().compose(
    new THREE.Vector3(0, y, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(scale, scale, scale)
  ));
  inst.instanceMatrix.needsUpdate = true;
  inst.setColorAt(0, tint ? new THREE.Color(tint[0], tint[1], tint[2]) : new THREE.Color(1, 1, 1));
  inst.instanceColor.needsUpdate = true;
  return inst;
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// World props grow from the island seed rather than the viewer's own rand,
// so reroll regrows the island under them to get a fresh specimen.
function reseedWorld(rand) {
  setSeed((rand() * 0xffffffff) >>> 0);
  reseedIsland();
}

// ---------------------------------------------------------------- poses

// Anything windified answers to uWindAmp, so the wind is the pose.
const WIND_ANIMS = [
  { id: 'breeze', label: 'breeze' },
  { id: 'still', label: 'still air' },
  { id: 'gale', label: 'gale' },
];
const WIND_AMP = { still: 0.05, breeze: 1, gale: 2.8 };

function windTick(state, dt) {
  const target = WIND_AMP[state.anim] ?? 1;
  uniforms.uWindAmp.value += (target - uniforms.uWindAmp.value) * Math.min(dt * 1.5, 1);
}

// A windified prop with nothing else to animate: the whole entry is the
// mesh and the three wind poses.
function windEntry(id, label, section, build) {
  return {
    id, label, section, env: 'beach',
    build(rand) {
      const built = build(rand);
      const state = { anim: 'breeze' };
      return {
        object: built.object ?? built,
        focus: built.focus,
        floor: built.floor,
        anims: WIND_ANIMS,
        state,
        tick(t, dt) { windTick(state, dt); built.tick?.(t, dt); },
      };
    },
  };
}

// A prop that just sits there: no poses, nothing ticking.
function stillEntry(id, label, section, env, build) {
  return {
    id, label, section, env,
    build(rand) {
      const built = build(rand);
      return {
        object: built.object ?? built,
        focus: built.focus,
        floor: built.floor,
        anims: [],
        state: { anim: null },
        tick() {},
      };
    },
  };
}

// ---------------------------------------------------------------- the props

export const PROPS = [
  // ------------------------------------------------------------ palms
  windEntry('palm', 'coconut palm', 'palms & trees', (rand) => {
    const bark = new MeshData(), leaf = new MeshData(), husk = new MeshData();
    const leanA = rand() * Math.PI * 2;
    buildPalm(bark, leaf, husk, {
      x: 0, z: 0, baseY: -0.22,
      height: 6.0 + rand() * 2.2,
      leanDir: new THREE.Vector2(Math.cos(leanA), Math.sin(leanA)),
      leanAmount: 0.5 + rand() * 1.6,
      seed: (rand() * 0xffffffff) >>> 0,
    });
    const { barkMat, leafMat, huskMat } = palmMaterials();
    const group = new THREE.Group();
    for (const [data, mat] of [[bark, barkMat], [leaf, leafMat], [husk, huskMat]]) {
      group.add(meshOf(data, mat));
    }
    return group;
  }),

  {
    id: 'frond', label: 'palm frond', section: 'palms & trees', env: 'beach',
    build(rand) {
      // one green frond and one dead one from the same crown, swapped by
      // pose: the leaflets fold harder and hang lower once they die
      const group = new THREE.Group();
      const { leafMat } = palmMaterials();
      const parts = {};
      const seed = (rand() * 0xffffffff) >>> 0;
      let lift = 0;
      for (const dead of [false, true]) {
        const leaf = new MeshData();
        buildFrond(leaf, {
          origin: new THREE.Vector3(0, 0.1, 0),
          crownUp: UP.clone(),
          azimuth: 0,
          pitch: 1.15,
          length: 2.9,
          rand: mulberry32(seed),
          tint: dead ? [0.62, 0.45, 0.24] : [0.78, 0.95, 0.55],
          droopRate: dead ? 1.25 : 0.85,
          flexBase: 0.4,
          phase: 0,
          dead,
        });
        const mesh = meshOf(leaf, leafMat);
        mesh.rotation.z = dead ? -0.5 : -0.25; // hold it out like a cut frond
        mesh.updateMatrixWorld(true);
        lift = Math.max(lift, 0.05 - new THREE.Box3().setFromObject(mesh).min.y);
        group.add(mesh);
        parts[dead ? 'dead' : 'green'] = mesh;
      }
      // A frond droops far below the butt it hangs from, so posed at the
      // origin most of the blade would be under the floor. Hang both poses
      // from the same raised point instead: same anchor, different droop.
      parts.green.position.y = lift;
      parts.dead.position.y = lift;
      const state = { anim: 'green' };
      return {
        object: group,
        anims: [{ id: 'green', label: 'green' }, { id: 'dead', label: 'dead' }],
        state,
        tick(t, dt) {
          parts.green.visible = state.anim === 'green';
          parts.dead.visible = state.anim === 'dead';
          uniforms.uWindAmp.value += (1.4 - uniforms.uWindAmp.value) * Math.min(dt * 1.5, 1);
        },
      };
    },
  },

  windEntry('fig', 'grandmother fig', 'palms & trees', (rand) => {
    reseedWorld(rand);
    const fig = buildFig();
    return {
      object: sited(fig.group, {
        x: fig.base.x, z: fig.base.z, r: fig.canopyR + 4,
      }),
      focus: fig.group,
      floor: false,
    };
  }),

  // ------------------------------------------------------------ undergrowth
  windEntry('duneGrass', 'dune grass', 'undergrowth', (rand) => {
    const data = new MeshData();
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2, d = i === 0 ? 0 : 0.2 + rand() * 0.5;
      grassTuft(data, Math.cos(a) * d, Math.sin(a) * d, rand, FLAT);
    }
    return meshOf(data, grassMaterial());
  }),

  windEntry('reeds', 'pond reeds', 'undergrowth', (rand) => {
    const data = new MeshData();
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2, d = i === 0 ? 0 : 0.25 + rand() * 0.55;
      reedClump(data, Math.cos(a) * d, Math.sin(a) * d, rand, FLAT);
    }
    return meshOf(data, reedMaterial());
  }),

  stillEntry('seaweed', 'seaweed wrack', 'undergrowth', 'beach', (rand) => {
    const data = new MeshData();
    seaweedClump(data, 0, 0, rand, FLAT);
    seaweedClump(data, 0.3, -0.25, rand, FLAT);
    return meshOf(data, seaweedMaterial());
  }),

  // ------------------------------------------------------------ beach
  {
    id: 'coconut', label: 'coconut', section: 'beach', env: 'beach',
    build(rand) {
      const { mesh, r } = nutMesh(rand);
      mesh.position.y = r * 0.8;
      const state = { anim: 'rest' };
      return {
        object: mesh,
        anims: [
          { id: 'rest', label: 'at rest' },
          { id: 'roll', label: 'rolling' },
          { id: 'float', label: 'afloat' },
        ],
        state,
        tick(t, dt) {
          if (state.anim === 'roll') {
            // rolling downhill: spin about the axis it would tip over
            mesh.rotation.x += dt * 2.6;
            mesh.position.y = r * 0.8;
          } else if (state.anim === 'float') {
            // riding the swell, floating high the way a dry husk does
            mesh.position.y = r * 0.35 + Math.sin(t * 1.3) * 0.03;
            mesh.rotation.z = Math.sin(t * 0.9) * 0.16;
            mesh.rotation.x = Math.sin(t * 1.1 + 1) * 0.12;
          } else {
            mesh.position.y = r * 0.8;
          }
        },
      };
    },
  },

  stillEntry('shells', 'sea shells', 'beach', 'beach', (rand) => {
    // the four species the drift line collects, laid out side by side at
    // the sizes they wash up in
    const group = new THREE.Group();
    const mat = shellMaterial();
    const kinds = [
      { geo: spiralShellGeometry(2.6, 1.35), s: 0.10, lay: true },
      { geo: spiralShellGeometry(3.4, 2.3), s: 0.075, lay: true },
      { geo: scallopGeometry(), s: 0.11, lay: false },
      { geo: clamGeometry(), s: 0.095, lay: false },
    ];
    kinds.forEach((kind, i) => {
      const tinted = mat.clone(); // shares the one painted texture
      tinted.color.setRGB(...pick(rand, SHELL_TINTS));
      const mesh = new THREE.Mesh(kind.geo, tinted);
      mesh.scale.setScalar(kind.s / 0.5);
      mesh.rotation.set(
        kind.lay ? Math.PI / 2 + (rand() - 0.5) * 0.5 : (rand() - 0.5) * 0.24,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.3
      );
      mesh.position.set((i - 1.5) * 0.32, kind.s * 0.2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    return group;
  }),

  stillEntry('starfish', 'starfish', 'beach', 'beach', (rand) => {
    const mesh = new THREE.Mesh(starfishGeometry(), starfishMaterial());
    mesh.scale.setScalar(0.12 + rand() * 0.04);
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }),

  stillEntry('pebbles', 'pebble drift', 'beach', 'beach', (rand) => {
    // a hand's width of the drift line: the same lumps at the same sizes,
    // just without the kilometre of beach they usually spread over
    const { geo, mat, shades } = pebbleAssets();
    const COUNT = 160;
    const inst = new THREE.InstancedMesh(geo, mat, COUNT);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
      e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < COUNT; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 0.5;
      const s = (0.006 + rand() * 0.012) / 0.5;
      e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
      q.setFromEuler(e);
      v.set(Math.cos(a) * d, -0.002, Math.sin(a) * d * 0.55);
      sc.set(s * (0.7 + rand() * 0.6), s * (0.45 + rand() * 0.3), s * (0.7 + rand() * 0.6));
      inst.setMatrixAt(i, m.compose(v, q, sc));
      inst.setColorAt(i, pick(rand, shades));
    }
    inst.receiveShadow = true;
    return inst;
  }),

  stillEntry('driftwood', 'driftwood', 'beach', 'beach', (rand) => {
    const len = 2.6 + rand() * 1.2, r = 0.13 + rand() * 0.05;
    const mesh = new THREE.Mesh(driftwoodGeo(len, r), driftwoodMaterial());
    mesh.position.y = r * 0.55;
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.rotation.z = (rand() - 0.5) * 0.12;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }),

  stillEntry('boulder', 'shore boulder', 'beach', 'beach', (rand) => {
    const size = 1.0 + rand() * 1.1;
    const seed = (rand() * 0xffffffff) >>> 0;
    const mesh = new THREE.Mesh(
      boulderGeo(size, new Simplex2(seed), rand() * 20, rand() * 20),
      boulderMaterial()
    );
    mesh.position.y = size * 0.10;
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }),

  // ------------------------------------------------------------ camp
  stillEntry('cairn', 'walker cairn', 'camp', 'beach', (rand) => {
    const group = new THREE.Group();
    group.add(cairnStack(rand, new Simplex2((rand() * 0xffffffff) >>> 0), 0, 0, 0));
    group.add(cairnRing(rand, 0, 0, FLAT));
    return group;
  }),

  stillEntry('wreck', 'wrecked hull', 'camp', 'beach', (rand) => {
    // the dunes swallow the lower arcs out there; here the whole hull is
    // above ground, which is the point of looking at it in here
    const mesh = new THREE.Mesh(wreckGeo(rand), wreckMaterial());
    mesh.position.y = 0.1;
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }),

  {
    id: 'campfire', label: 'campfire', section: 'camp', env: 'beach',
    build(rand) {
      reseedWorld(rand);
      const fire = buildCampfire();
      const state = { anim: 'blazing' };
      return {
        object: sited(fire.group, { x: fire.pos.x, z: fire.pos.z, r: 3.2 }),
        focus: fire.group,
        floor: false,
        anims: [
          { id: 'blazing', label: 'blazing' },
          { id: 'squall', label: 'squall' },
          { id: 'soaked', label: 'after the rain' },
        ],
        state,
        tick(t, dt) {
          // the fire reads the weather uniforms, so the poses set weather
          const storm = state.anim === 'squall' ? 1 : 0;
          const wet = state.anim === 'blazing' ? 0 : 1;
          uniforms.uStorm.value += (storm - uniforms.uStorm.value) * Math.min(dt * 2, 1);
          uniforms.uRainWet.value += (wet - uniforms.uRainWet.value) * Math.min(dt * 2, 1);
          fire.update(t, dt);
        },
      };
    },
  },

  {
    id: 'hammock', label: 'hammock', section: 'camp', env: 'beach',
    build(rand) {
      // slung between two palms, the way the island always finds a pair
      const group = new THREE.Group();
      const bark = new MeshData(), leaf = new MeshData(), husk = new MeshData();
      const anchors = [];
      for (const side of [-1, 1]) {
        const x = side * 2.1;
        const tree = buildPalm(bark, leaf, husk, {
          x, z: 0, baseY: -0.22,
          height: 5.9 + rand() * 1.2,
          leanDir: new THREE.Vector2(side * 0.6, rand() - 0.5),
          leanAmount: 0.45 + rand() * 0.5,
          seed: (rand() * 0xffffffff) >>> 0,
        });
        const k = Math.min(1.55 / tree.height, 0.35);
        anchors.push(tree.base.clone().lerp(tree.crown, k));
      }
      const { barkMat, leafMat, huskMat } = palmMaterials();
      for (const [data, mat] of [[bark, barkMat], [leaf, leafMat], [husk, huskMat]]) {
        group.add(meshOf(data, mat));
      }
      const rig = hammockRig(anchors[0], anchors[1]);
      group.add(rig.group);

      const state = { anim: 'breeze' };
      return {
        object: group,
        focus: rig.group,
        anims: WIND_ANIMS,
        state,
        tick(t, dt) {
          windTick(state, dt);
          // the same swing buildHammock gives it: harder in a blow
          const amp = 0.035 + uniforms.uWindAmp.value * 0.03;
          rig.swing.rotation.x = Math.sin(t * 0.62) * amp + Math.sin(t * 1.7) * amp * 0.2;
        },
      };
    },
  },

  {
    id: 'footprints', label: 'footprints', section: 'camp', env: 'beach',
    build() {
      // decals fade over ~90s and wash out under the surge, so the studio
      // lays a whole trail at once and walks it again before it goes
      const prints = buildFootprints();
      const KIND = { foot: 0, crab: 1, turtle: 2 };
      const state = { anim: 'foot', laidAt: -1e9, laidKind: -1 };

      function layTrail(kind) {
        prints.clear();
        const size = kind === 2 ? 1.7 : kind === 1 ? 0.55 : 1;
        const gap = kind === 2 ? 0.34 : kind === 1 ? 0.12 : 0.17;
        const straddle = kind === 2 ? 0.2 : kind === 1 ? 0.05 : 0.08;
        const n = kind === 1 ? 30 : 18;
        for (let i = 0; i < n; i++) {
          const side = i % 2 ? 1 : -1;
          const x = -(n - 1) * gap * 0.5 + i * gap;
          const z = side * straddle;
          prints.stamp(x, z, islandHeight(x, z), 1, 0, side > 0 ? 1 : 0, kind, size);
        }
        // the decal buffer holds a thousand idle slots parked at the origin;
        // drawing only the laid ones keeps them out of the framing box too
        prints.mesh.count = n;
      }

      return {
        object: sited(prints.mesh, { x: 0, z: 0, r: 3.2 }),
        focus: prints.mesh,
        floor: false,
        anims: [
          { id: 'foot', label: 'barefoot' },
          { id: 'crab', label: 'crab' },
          { id: 'turtle', label: 'turtle' },
        ],
        state,
        tick(t) {
          const kind = KIND[state.anim] ?? 0;
          // re-walk it while the first prints are still fresh
          if (kind !== state.laidKind || t - state.laidAt > 40) {
            layTrail(kind);
            state.laidKind = kind;
            state.laidAt = t;
          }
        },
      };
    },
  },

  // ------------------------------------------------------------ coral garden
  ...[
    ['brain', 'brain coral', { scale: 0.85 }],
    ['stagA', 'staghorn coral', { scale: 1.3 }],
    ['stagB', 'staghorn coral · violet', { scale: 1.3 }],
    ['table', 'table coral', { scale: 1.2 }],
    ['fan', 'sea fan', { scale: 1.1, tints: FAN_TINTS }],
    ['sponge', 'barrel sponge', { scale: 1.1, tints: SPONGE_TINTS }],
    ['anemone', 'anemone', { scale: 1.4, tints: ANEM_TINTS }],
    ['urchin', 'sea urchin', { scale: 1.4 }],
    ['star', 'sea star', { scale: 1.4, tints: STAR_TINTS }],
    ['grass', 'seagrass', { scale: 1.3 }],
    ['rock', 'reef boulder', { scale: 1.0 }],
  ].map(([kind, label, opts]) => ({
    id: 'reef-' + kind, label, section: 'coral garden', env: 'water',
    build(rand) {
      const inst = oneInstance(reefGeometry(kind), reefMaterial(kind), {
        scale: opts.scale,
        tint: opts.tints ? pick(rand, opts.tints) : null,
      });
      return { object: inst, anims: [], state: { anim: null }, tick() {} };
    },
  })),

  {
    id: 'clam', label: 'giant clam', section: 'coral garden', env: 'water',
    build(rand) {
      const s = 0.42 + rand() * 0.22;
      const { g, lid, mantle } = clamRig(s, clamAssets());
      const state = { anim: 'open', open: 0.5 };
      return {
        object: g,
        anims: [
          { id: 'open', label: 'open' },
          { id: 'shut', label: 'slammed shut' },
        ],
        state,
        tick(t, dt) {
          // the same snap buildReef runs when you loom over one
          const target = state.anim === 'shut' ? 0.04 : 0.5;
          const rate = target < state.open ? 6 : 0.5;
          state.open += (target - state.open) * Math.min(dt * rate, 1);
          lid.rotation.z = state.open;
          mantle.scale.setScalar(Math.max(state.open * 1.6, 0.05));
          mantle.scale.z = 0.55 * Math.max(state.open * 1.6, 0.05);
          mantle.visible = state.open > 0.1;
        },
      };
    },
  },

  // ------------------------------------------------------------ water
  {
    id: 'pond', label: 'freshwater pond', section: 'water', env: 'beach',
    build(rand) {
      // the pond is a basin carved into the height field, so it only makes
      // sense with its own ground: keep regrowing islands until one digs
      let L = null;
      for (let i = 0; i < 12 && !L; i++) {
        reseedWorld(rand);
        L = lagoonInfo();
      }
      const group = new THREE.Group();
      if (L) {
        const water = new THREE.Mesh(pondGeometry(L), pondMaterial());
        water.renderOrder = 1;
        group.add(water);

        // the reed fringe that always crowds the wet margin
        const data = new MeshData();
        const rr = mulberry32(subSeed('reeds'));
        for (let tries = 0, clumps = 0; tries < 900 && clumps < 60; tries++) {
          const a = rr() * Math.PI * 2;
          const d = L.rW * (0.76 + rr() * 0.42);
          const x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d;
          const fb = lagoonFreeboard(x, z);
          if (fb > 0.14 || fb < -0.45) continue;
          reedClump(data, x, z, rr);
          clumps++;
        }
        if (data.pos.length) group.add(meshOf(data, reedMaterial()));
      }
      const state = { anim: 'calm' };
      return {
        object: L ? sited(group, { x: L.x, z: L.z, r: L.rOuter + 5 }) : group,
        focus: group,
        floor: !L,
        anims: [
          { id: 'calm', label: 'calm' },
          { id: 'rain', label: 'in the rain' },
        ],
        state,
        tick(t, dt) {
          // the sheet dimples and swells under rain, and the reeds thrash
          const rain = state.anim === 'rain' ? 1 : 0;
          uniforms.uStorm.value += (rain - uniforms.uStorm.value) * Math.min(dt * 2, 1);
          uniforms.uRainWet.value += (rain - uniforms.uRainWet.value) * Math.min(dt * 2, 1);
          uniforms.uWindAmp.value += ((1 + rain * 1.6) - uniforms.uWindAmp.value) * Math.min(dt * 1.5, 1);
        },
      };
    },
  },

  // ------------------------------------------------------------ horizon
  {
    id: 'volcano', label: 'volcano', section: 'horizon', env: 'beach',
    build(rand) {
      const group = new THREE.Group();
      const cone = volcanoCone(rand, { shrink: 0.9 + rand() * 0.2 });
      const mesh = new THREE.Mesh(cone.geo, landformMaterial());
      group.add(mesh);
      const v = { ...cone, phase: rand() * 9 };
      for (const sprite of volcanoPlume(rand, v, { count: 6 })) group.add(sprite);
      group.add(seaDisc(cone.R * 2.4));

      const state = { anim: 'clear' };
      return {
        object: group,
        focus: mesh,
        floor: false,
        anims: [
          { id: 'clear', label: 'clear' },
          { id: 'squall', label: 'squall' },
        ],
        state,
        tick(t, dt) {
          const storm = state.anim === 'squall' ? 1 : 0;
          uniforms.uStorm.value += (storm - uniforms.uStorm.value) * Math.min(dt * 1.5, 1);
          updatePlume(v, t);
        },
      };
    },
  },

  stillEntry('sister', 'sister island', 'horizon', 'beach', (rand) => {
    const group = new THREE.Group();
    const R = 150 + rand() * 170, H = 22 + rand() * 32;
    const mesh = new THREE.Mesh(sisterDome(rand, { R, H }), landformMaterial());
    group.add(mesh);
    group.add(seaDisc(R * 2.2));
    return { object: group, focus: mesh, floor: false };
  }),

  {
    id: 'sailboat', label: 'sailboat', section: 'horizon', env: 'beach',
    build() {
      const boat = buildBoat();
      const group = new THREE.Group();
      group.add(boat.group);
      group.add(seaDisc(48));
      return {
        object: group,
        focus: boat.group,
        floor: false,
        anims: [],
        state: { anim: null },
        tick(t) {
          // the sloop's own bob, heel and masthead light, minus the 640m lap
          // it would otherwise be sailing off on. Its waterline follows the
          // real tide out there, so hold it on the studio's sheet instead,
          // beam on to the camera where the sails read.
          boat.update(t);
          boat.group.position.set(0, 0.5 + Math.sin(t * 0.47) * 0.3, 0);
          boat.group.rotation.y = 0.5;
        },
      };
    },
  },
];
