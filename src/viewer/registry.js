// The creature registry for the /components viewer. Each entry builds one
// animal in isolation and exposes named poses; the tick drivers mirror the
// motion math the world's brains use (birds.js, crabs.js, turtle.js,
// sealife.js), so what you evaluate here is what plays on the island.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { buildGull } from '../creatures/gull.js';
import { buildCrab } from '../creatures/crab.js';
import { buildTurtleMesh, buildSwimTurtleMesh } from '../creatures/turtle.js';
import { speciesLibrary } from '../creatures/species.js';
import { wigAttribute } from '../creatures/fishcraft.js';
import { rayGeometry, rayMaterial } from '../creatures/ray.js';
import { jellyGeometry, jellyMaterial } from '../creatures/jelly.js';
import { buildEel } from '../creatures/eel.js';
import { buildShark } from '../creatures/shark.js';
import { buildButterflyWings, BUTTERFLY_TINTS } from '../creatures/butterfly.js';
import { silversideAsset } from '../creatures/shorefish.js';

// the species library is session-shared in the viewer (its geometries and
// materials are never disposed on switch); everything else rebuilds per view
let _lib = null;
const lib = () => (_lib ??= speciesLibrary());

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
  _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// single-instance helper for the instanced swim materials (fish, ray):
// compose slot 0 with a yaw/pitch/bob so the creature swims in place
function composeAt(inst, x, y, z, yaw, pitch, roll, size) {
  _e.set(roll, yaw, pitch); // model nose +x: pitch is z in composeFish terms
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.setScalar(size);
  _m.compose(_v, _q, _s);
  inst.setMatrixAt(0, _m);
  inst.instanceMatrix.needsUpdate = true;
}

function fishEntry(id, label, section, opts = {}) {
  const { swimY = 1.1, size = 1 } = opts;
  return {
    id, label, section, env: 'water', shared: true,
    build(rand) {
      const sp = lib()[id];
      const geo = sp.geo.clone();
      wigAttribute(geo, 1, rand);
      const wig = geo.getAttribute('aWig');
      const inst = new THREE.InstancedMesh(geo, sp.mat, 1);
      inst.frustumCulled = false;
      const state = { anim: 'swim' };
      composeAt(inst, 0, swimY, 0, 0, 0, 0, size);
      return {
        object: inst,
        anims: [
          { id: 'swim', label: 'swim' },
          { id: 'burst', label: 'burst' },
          { id: 'hold', label: 'hold still' },
        ],
        state,
        tick(t) {
          if (state.anim === 'burst') { wig.setY(0, 1.35); wig.setZ(0, 1.9); }
          else if (state.anim === 'hold') { wig.setY(0, 0.12); wig.setZ(0, 0.5); }
          else { wig.setY(0, 1.0); wig.setZ(0, 1.0); }
          wig.needsUpdate = true;
          // a slow bob and heading sway so light moves across the flanks
          const yaw = Math.sin(t * 0.4) * 0.35;
          const bob = Math.sin(t * 0.9) * 0.04;
          composeAt(inst, 0, swimY + bob, 0, yaw, Math.sin(t * 0.7) * 0.05, 0, size);
        },
      };
    },
  };
}

export const REGISTRY = [
  // ------------------------------------------------------------- shore
  {
    id: 'gull', label: 'gull', section: 'shore', env: 'beach',
    build(rand) {
      const gull = buildGull(undefined, rand);
      const state = { anim: 'fly' };
      gull.group.position.y = 1.3;
      return {
        object: gull.group,
        anims: gull.anims,
        state,
        tick(t, dt) {
          gull.play(state.anim);
          gull.update(dt, { speed: 0.30 });
          // sit the gull on the studio floor for the two closed-wing clips
          // and up in clear air for the three flying ones
          const down = state.anim === 'ground' || state.anim === 'walk';
          const g = gull.group;
          const y = down ? gull.standY : 1.3;
          g.position.y += (y - g.position.y) * Math.min(dt * 3, 1);
          const bank = state.anim === 'fly' ? 0.22
            : state.anim === 'glide' ? Math.sin(t * 0.6) * 0.14 : 0;
          const pitch = down ? 0 : state.anim === 'glide' ? -0.04 : 0.02;
          g.rotation.z += (bank - g.rotation.z) * Math.min(dt * 2.5, 1);
          g.rotation.x += (pitch - g.rotation.x) * Math.min(dt * 2.5, 1);
        },
      };
    },
  },
  {
    id: 'crab', label: 'ghost crab', section: 'shore', env: 'beach',
    build(rand) {
      const tint = new THREE.Color().setHSL(0.05 + rand() * 0.06, 0.5 + rand() * 0.2, 0.42 + rand() * 0.12);
      const parts = buildCrab(tint);
      const state = { anim: 'walk', gait: 0, bob: 0 };
      return {
        object: parts.group,
        anims: [
          { id: 'walk', label: 'scuttle' },
          { id: 'sprint', label: 'sprint' },
          { id: 'idle', label: 'idle' },
          { id: 'alarm', label: 'claws up' },
        ],
        state,
        tick(t, dt) {
          const speed = state.anim === 'sprint' ? 1.6 : state.anim === 'walk' ? 0.6 : 0;
          const stride = speed > 0.01 ? 1 : 0;
          state.gait += dt * (8 + speed * 26) * stride;
          state.bob = THREE.MathUtils.lerp(state.bob, stride, dt * 6);
          for (const l of parts.legs) {
            l.hip.rotation.z = Math.sin(state.gait + l.phase) * 0.3 * state.bob;
          }
          const alarmed = state.anim === 'alarm' || state.anim === 'sprint';
          for (let i = 0; i < parts.claws.length; i++) {
            const raise = alarmed ? -0.55 : -0.12 + Math.sin(t * 1.3 + i * 2.1) * 0.1;
            parts.claws[i].rotation.x = THREE.MathUtils.lerp(parts.claws[i].rotation.x, raise, dt * 5);
          }
          parts.group.position.y = 0.034 + Math.abs(Math.sin(state.gait * 0.5)) * 0.005 * state.bob;
          parts.group.rotation.z = Math.sin(state.gait * 0.5) * 0.03 * state.bob;
        },
      };
    },
  },
  {
    id: 'turtleNester', label: 'turtle · nesting', section: 'shore', env: 'beach',
    build() {
      const parts = buildTurtleMesh();
      const state = { anim: 'crawl', gait: 0, crawlK: 0 };
      return {
        object: parts.group,
        anims: [
          { id: 'crawl', label: 'crawl' },
          { id: 'dig', label: 'dig' },
          { id: 'rest', label: 'rest' },
          { id: 'swim', label: 'swim' },
        ],
        state,
        tick(t, dt) {
          if (state.anim === 'crawl') {
            state.gait += dt * 2.4;
            const g = state.gait;
            const stroke = Math.pow(0.5 + 0.5 * Math.sin(g), 1.6);
            state.crawlK = stroke;
            const sw = Math.sin(g), cw = Math.cos(g);
            parts.frontL.rotation.z = 0.14 + Math.max(-sw, 0) * 0.34;
            parts.frontR.rotation.z = 0.14 + Math.max(-sw, 0) * 0.34;
            parts.frontL.rotation.y = -0.55 - cw * 0.45;
            parts.frontR.rotation.y = 0.55 + cw * 0.45;
            parts.backL.rotation.z = 0.08 + Math.sin(g + 2.5) * 0.12;
            parts.backR.rotation.z = 0.08 + Math.sin(g + 2.5 + Math.PI) * 0.12;
            parts.group.position.y = stroke * 0.028;
            parts.group.rotation.z = (stroke - 0.5) * 0.055;
            parts.head.position.y = 0.13;
          } else if (state.anim === 'dig') {
            const k = Math.sin(t * 4);
            parts.backL.rotation.z = 0.15 + Math.max(k, 0) * 0.7;
            parts.backR.rotation.z = 0.15 + Math.max(-k, 0) * 0.7;
            parts.frontL.rotation.z = 0.1;
            parts.frontR.rotation.z = 0.1;
            parts.frontL.rotation.y = -0.55;
            parts.frontR.rotation.y = 0.55;
            parts.group.position.y = -0.01;
            parts.group.rotation.z = 0;
            parts.head.position.y = 0.13;
          } else if (state.anim === 'rest') {
            parts.group.position.y = -0.01;
            parts.group.rotation.z = 0;
            parts.frontL.rotation.set(0, -0.55, 0.1);
            parts.frontR.rotation.set(0, 0.55, 0.1);
            parts.backL.rotation.z = 0.08;
            parts.backR.rotation.z = 0.08;
            parts.head.position.y = 0.13 + Math.max(Math.sin(t * 0.5), 0) * 0.05;
          } else { // swim: front flippers fly like slow wings
            state.gait += dt * 3.2;
            parts.frontL.rotation.z = Math.sin(state.gait) * 0.5;
            parts.frontR.rotation.z = Math.sin(state.gait + Math.PI) * 0.5;
            parts.frontL.rotation.y = -0.35;
            parts.frontR.rotation.y = 0.35;
            parts.group.position.y = 0.25 + Math.sin(t * 1.3) * 0.03;
            parts.group.rotation.z = 0;
            parts.head.position.y = 0.13;
          }
        },
      };
    },
  },
  {
    id: 'butterfly', label: 'butterfly', section: 'shore', env: 'beach',
    build(rand) {
      const { geo, mat, rests, restAttr, flapUniform } = buildButterflyWings(1, rand);
      const inst = new THREE.InstancedMesh(geo, mat, 1);
      inst.frustumCulled = false;
      const tint = BUTTERFLY_TINTS[Math.floor(rand() * BUTTERFLY_TINTS.length)];
      inst.setColorAt(0, new THREE.Color(...tint));
      const state = { anim: 'fly', rest: 0 };
      return {
        object: inst,
        anims: [
          { id: 'fly', label: 'fly' },
          { id: 'perch', label: 'perch' },
          { id: 'settle', label: 'settle' },
        ],
        state,
        tick(t, dt) {
          const perched = state.anim === 'perch';
          state.rest += ((perched ? 1 : 0) - state.rest) * Math.min(dt * 5, 1);
          rests[0] = state.rest;
          restAttr.needsUpdate = true;
          const targetAmp = state.anim === 'settle' ? 0.06 : 1;
          flapUniform.value += (targetAmp - flapUniform.value) * Math.min(dt * 1.6, 1);
          const flying = state.anim === 'fly';
          const y = perched || state.anim === 'settle'
            ? 0.04
            : 0.5 + Math.sin(t * 1.7) * 0.1;
          composeAt(inst, 0, y, 0,
            flying ? Math.sin(t * 0.7) * 0.6 : 0,
            0, flying ? Math.sin(t * 2.2) * 0.14 : 0, 2.4);
        },
      };
    },
  },
  {
    id: 'shorefish', label: 'silverside', section: 'shore', env: 'water',
    build(rand) {
      const asset = silversideAsset();
      const geo = asset.geo;
      wigAttribute(geo, 1, rand);
      const inst = new THREE.InstancedMesh(geo, asset.mat, 1);
      inst.frustumCulled = false;
      const state = { anim: 'swim' };
      return {
        object: inst,
        anims: [{ id: 'swim', label: 'swim' }],
        state,
        tick(t) {
          const yaw = Math.sin(t * 0.4) * 0.3;
          composeAt(inst, 0, 1.1 + Math.sin(t * 0.9) * 0.05, 0, yaw, 0, 0, 1.4);
        },
      };
    },
  },

  // ------------------------------------------------------------- reef fish
  fishEntry('sergeant', 'sergeant major', 'reef fish'),
  fishEntry('fusilier', 'fusilier', 'reef fish', { size: 1.6 }),
  fishEntry('blueTang', 'blue tang', 'reef fish'),
  fishEntry('yellowTang', 'yellow tang', 'reef fish'),
  fishEntry('butterfly', 'butterflyfish', 'reef fish'),
  fishEntry('angelfish', 'emperor angelfish', 'reef fish'),
  fishEntry('parrotfish', 'parrotfish', 'reef fish'),
  fishEntry('clownfish', 'clownfish', 'reef fish', { size: 1.3 }),

  // ------------------------------------------------------------- open water
  {
    id: 'shark', label: 'blacktip reef shark', section: 'open water', env: 'water',
    // the hide and the four materials are session-shared; the hull, the fins
    // and the eyes are rebuilt per view, so the viewer is free to dispose them
    shared: true,
    build() {
      const rig = buildShark();
      const swimmer = new THREE.Group(); // the slow drift the patrol would give it
      swimmer.add(rig.group);
      const state = { anim: 'cruise', beat: 0 };
      return {
        object: swimmer,
        anims: [
          { id: 'cruise', label: 'cruise' },
          { id: 'glide', label: 'glide' },
          { id: 'burst', label: 'burst' },
          { id: 'hold', label: 'hold still' },
        ],
        state,
        tick(t, dt) {
          // the gaits sealife.js derives from the ground speed it is making
          const gait = state.anim === 'burst' ? 1.9
            : state.anim === 'glide' ? 0.45 : state.anim === 'hold' ? 0 : 1;
          state.beat += dt * 0.62 * gait;
          rig.update(state.beat, gait > 0 ? 0.82 + 0.22 * gait : 0.12);
          swimmer.position.y = 1.0 + 0.045 * Math.sin(t * 0.23);
          swimmer.rotation.y = 0.17 * Math.sin(t * 0.11) + 0.05 * Math.sin(t * 0.29);
          swimmer.rotation.z = -0.075 * Math.sin(t * 0.11 + 0.6);
          swimmer.rotation.x = 0.035 * Math.sin(t * 0.19);
        },
      };
    },
  },
  {
    id: 'ray', label: 'stingray', section: 'open water', env: 'water',
    build(rand) {
      const geo = rayGeometry();
      wigAttribute(geo, 1, rand);
      const wig = geo.getAttribute('aWig');
      const mat = rayMaterial();
      const inst = new THREE.InstancedMesh(geo, mat, 1);
      inst.frustumCulled = false;
      const state = { anim: 'glide' };
      return {
        object: inst,
        anims: [
          { id: 'glide', label: 'glide' },
          { id: 'burst', label: 'burst' },
          { id: 'settle', label: 'settle on sand' },
        ],
        state,
        tick(t, dt) {
          const target = state.anim === 'burst' ? 1.6 : state.anim === 'settle' ? 0.12 : 0.9;
          wig.setY(0, THREE.MathUtils.lerp(wig.getY(0), target, Math.min(dt * 3, 1)));
          wig.needsUpdate = true;
          const y = state.anim === 'settle' ? 0.06 : 0.7 + Math.sin(t * 0.7) * 0.08;
          composeAt(inst, 0, y, 0, Math.sin(t * 0.3) * 0.3, 0, 0, 1);
        },
        dispose: [geo, mat],
      };
    },
  },
  {
    id: 'seaTurtle', label: 'sea turtle', section: 'open water', env: 'water',
    build(rand) {
      const parts = buildSwimTurtleMesh(Math.floor(rand() * 0xffffffff));
      const state = { anim: 'cruise', gait: 0 };
      parts.group.position.y = 1.0;
      return {
        object: parts.group,
        anims: [
          { id: 'cruise', label: 'cruise' },
          { id: 'sprint', label: 'spooked' },
          { id: 'breathe', label: 'breathe' },
        ],
        state,
        tick(t, dt) {
          const rate = state.anim === 'breathe' ? 1.1 : state.anim === 'sprint' ? 4.4 : 2.4;
          state.gait += dt * rate;
          const fl = Math.sin(state.gait) * 0.55;
          parts.frontL.rotation.z = fl;
          parts.frontR.rotation.z = -fl;
          parts.frontL.rotation.y = -0.35;
          parts.frontR.rotation.y = 0.35;
          parts.backL.rotation.z = 0.1 + Math.sin(state.gait * 0.5 + 1.2) * 0.15;
          parts.backR.rotation.z = -0.1 - Math.sin(state.gait * 0.5 + 1.2) * 0.15;
          parts.head.position.y = 0.02 + (state.anim === 'breathe' ? 0.08 : 0);
          parts.group.position.y = 1.0 + Math.sin(t * 0.8) * 0.05;
          parts.group.rotation.z = Math.sin(t * 0.5) * 0.05;
        },
      };
    },
  },
  {
    id: 'jelly', label: 'moon jelly', section: 'open water', env: 'water',
    build(rand) {
      const geo = jellyGeometry();
      const ph = new Float32Array([rand() * Math.PI * 2]);
      geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
      const mat = jellyMaterial();
      const inst = new THREE.InstancedMesh(geo, mat, 1);
      inst.frustumCulled = false;
      const state = { anim: 'pulse', y: 0.9 };
      return {
        object: inst,
        anims: [{ id: 'pulse', label: 'pulse' }],
        state,
        tick(t, dt) {
          const pulse = Math.sin(t * 1.7 + ph[0]);
          state.y += (Math.max(pulse, 0) * 0.11 - 0.045) * dt * 2;
          state.y = THREE.MathUtils.clamp(state.y, 0.75, 1.1);
          composeAt(inst, 0, state.y, 0, 0, 0, 0, 1.6);
        },
        dispose: [geo, mat],
      };
    },
  },
  {
    id: 'eel', label: 'moray eel', section: 'open water', env: 'water',
    build(rand) {
      const root = new THREE.Group();
      const eel = buildEel();
      root.add(eel.group);
      // a small den mound so the lean reads: a few dark stones over the root
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x555046, roughness: 0.95 });
      for (let i = 0; i < 4; i++) {
        const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09 + rand() * 0.07, 1), rockMat);
        r.position.set(-0.42 + rand() * 0.22, 0.04 + i * 0.05, (rand() - 0.5) * 0.3);
        r.scale.y = 0.75;
        root.add(r);
      }
      eel.group.position.y = 0.22;
      const state = { anim: 'lurk' };
      return {
        object: root,
        anims: [{ id: 'lurk', label: 'lurk' }],
        state,
        tick(t) { eel.update(t); },
      };
    },
  },
];
