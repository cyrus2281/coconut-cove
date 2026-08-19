// A striped hammock slung between two close palms. Walk up and press E to
// lie back: the camera sinks into the cloth and sways with it, looking up
// through the fronds — stars, meteors and passing clouds included. Press E
// again to sleep the day (or the night) away; any movement key tips you
// back out instead. The whole hammock (and the lying camera) swings gently
// on the wind about the line between its two anchor points.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { subSeed } from '../core/seed.js';
import { uniforms } from '../core/env.js';
import { islandHeight } from './island.js';
import { hammockTexture, barkTexture } from '../core/textures.js';

const EYE_LYING = 0.5; // camera above the cloth's low point

// The hammock itself: the draped cloth, its two ropes, and the wrap rings
// on the trunks. buildHammock() slings this between a pair of palms; the
// /components viewer hangs one between two anchor points of its own.
export function hammockRig(A, B) {
  const group = new THREE.Group();
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const axis = B.clone().sub(A);
  const span = axis.length();
  axis.normalize();
  const perp = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
  const yaw = Math.atan2(axis.z, axis.x);

  // ---- the swinging part: its own group with the origin on the axis ----
  const swing = new THREE.Group();
  swing.position.copy(mid);
  swing.rotation.order = 'YXZ'; // yaw the frame, then rock about its X
  swing.rotation.y = -yaw;      // local +X runs anchor to anchor
  group.add(swing);

  // cloth: a strip draped in a catenary, edges curled up, ends pinched
  const CL = span * 0.62, CW = 0.86, SEG = 14, WID = 6;
  const sag = 0.55;
  const clothGeo = new THREE.PlaneGeometry(CL, CW, SEG, WID);
  {
    const p = clothGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / CL + 0.5;   // 0..1 along
      const v = p.getY(i) / CW + 0.5;   // 0..1 across
      const drop = sag * (1 - Math.pow(2 * u - 1, 2));
      const curl = Math.pow(Math.abs(v - 0.5) * 2, 2)
        * 0.30 * (1 - Math.pow(2 * u - 1, 2) * 0.55);
      const pinch = 0.18 + 0.82 * Math.sin(Math.PI * Math.min(Math.max(u, 0.02), 0.98));
      p.setX(i, (u - 0.5) * CL);
      p.setZ(i, (v - 0.5) * CW * pinch);
      p.setY(i, -0.12 - drop + curl);
    }
    clothGeo.computeVertexNormals();
  }
  const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({
    map: hammockTexture(),
    roughness: 0.85,
    side: THREE.DoubleSide,
  }));
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  swing.add(cloth);

  // ropes from the pinched cloth ends out to each anchor
  const ropeMat = new THREE.MeshStandardMaterial({
    map: barkTexture(true), color: 0xcbb8a0, roughness: 1,
  });
  const localA = A.clone().sub(mid).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const localB = B.clone().sub(mid).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  for (const [from, toX] of [[localA, -CL / 2], [localB, CL / 2]]) {
    const to = new THREE.Vector3(toX, -0.12, 0);
    const d = to.clone().sub(from);
    const len = d.length();
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, len, 5), ropeMat);
    rope.position.copy(from).addScaledVector(d, 0.5);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    swing.add(rope);
  }
  // wrap rings on the trunks (static, outside the swing)
  for (const anchor of [A, B]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.028, 6, 12), ropeMat);
    ring.position.copy(anchor);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }

  return { group, swing, mid, yaw, perp, span, sag };
}

export function buildHammock(player, trees, camera, onSleep) {
  const group = new THREE.Group();
  group.name = 'hammock';
  const rand = mulberry32(subSeed('hammock'));

  // ---- find a palm pair a hammock's length apart ----
  let pair = null, bestScore = 1e9;
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const a = trees[i].base, b = trees[j].base;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 3.1 || d > 5.6) continue;
      const score = Math.abs(d - 4.2) + rand() * 0.5;
      if (score < bestScore) { bestScore = score; pair = [trees[i], trees[j]]; }
    }
  }
  if (!pair) {
    return { group, update: () => {}, resting: () => false, sleeping: () => false, sited: false };
  }

  // anchor points ~1.55m up each trunk (palms are near-vertical that low)
  const anchorOf = (t) => {
    const k = Math.min(1.55 / t.height, 0.35);
    return new THREE.Vector3(
      t.base.x + (t.crown.x - t.base.x) * k,
      t.base.y + (t.crown.y - t.base.y) * k,
      t.base.z + (t.crown.z - t.base.z) * k
    );
  };
  const rig = hammockRig(anchorOf(pair[0]), anchorOf(pair[1]));
  const { swing, mid, yaw, perp, sag } = rig;
  group.add(rig.group);

  // ---- the prompts: keycap hints on desktop, tap targets on touch ----
  // Two slots side by side: the main one carries the action E performs
  // (lie back, then sleep), and once you're lying down a touchscreen gets a
  // second one to sit back up (a keyboard just presses a movement key).
  const prompt = document.createElement('div');
  prompt.id = 'hammockHint';
  Object.assign(prompt.style, {
    position: 'fixed', left: '50%', bottom: '64px', transform: 'translateX(-50%)',
    display: 'flex', gap: '10px', zIndex: 6, pointerEvents: 'none',
  });
  document.body.appendChild(prompt);

  function makePill(onTap) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '13px',
      color: 'rgba(255,255,255,0.85)', background: 'rgba(10,25,35,0.45)',
      border: '1px solid rgba(255,255,255,0.25)', borderRadius: '999px',
      padding: '7px 16px', opacity: 0, transition: 'opacity 0.3s',
      pointerEvents: 'none', letterSpacing: '0.08em', backdropFilter: 'blur(4px)',
      cursor: 'pointer', userSelect: 'none', webkitUserSelect: 'none',
      touchAction: 'none', whiteSpace: 'nowrap',
    });
    // tappable/clickable — pointer events only turn on while it's visible,
    // so an invisible pill can't catch stray taps
    el.addEventListener('touchstart', (e) => {
      e.preventDefault(); // also swallows the synthetic click that would follow
      e.stopPropagation();
      onTap();
    }, { passive: false });
    el.addEventListener('click', () => onTap());
    prompt.appendChild(el);
    let shown = '';
    return {
      set(text, on) {
        if (text !== shown) { shown = text; el.textContent = text; }
        el.style.opacity = on ? 0.9 : 0;
        el.style.pointerEvents = on ? 'auto' : 'none';
      },
      hide() { el.style.opacity = 0; el.style.pointerEvents = 'none'; },
    };
  }
  const mainPill = makePill(() => tryToggle());
  const upPill = makePill(() => { if (resting && !sleeping) dismount(); });
  const touchRoot = document.getElementById('touchui');
  const onTouchUI = () => touchRoot && !touchRoot.classList.contains('hidden');

  // thumbs own the bottom corners, so on touch the row rides above the
  // joystick (24 + 132 tall) and the JUMP button rather than across them
  let lifted = null;
  function liftRow(on) {
    if (on === lifted) return;
    lifted = on;
    prompt.style.bottom = on ? 'calc(168px + env(safe-area-inset-bottom))' : '64px';
  }

  // ---- state ----
  let resting = false;
  let restT = 0;
  let sleeping = false; // dozing off: the fade owns the screen, keys are dead
  const saved = { yaw: 0, pitch: 0 };
  const lieP = mid.clone().add(new THREE.Vector3(0, -sag - 0.12 + EYE_LYING, 0));

  // The one action key: walk up to lie back, press again to sleep.
  function tryToggle() {
    if (sleeping) return true;      // already drifting off
    if (resting) return trySleep();
    const d = Math.hypot(player.pos.x - mid.x, player.pos.z - mid.z);
    if (d > 2.0 || !player.enabled) return false;
    resting = true;
    restT = 0;
    player.resting = true;
    saved.yaw = player.yaw;
    saved.pitch = player.pitch;
    // eyes drift up the trunk line toward the sky
    player.yaw = -yaw + Math.PI / 2 + (rand() < 0.5 ? Math.PI : 0);
    player.pitch = 1.28;
    mainPill.hide();
    return true;
  }

  // Sleep the rest of the half-day away: the screen fades out, the world
  // clock jumps in the dark, and you wake still lying in the cloth.
  function trySleep() {
    if (!resting || sleeping || !onSleep) return false;
    sleeping = true;
    mainPill.hide();
    upPill.hide();
    Promise.resolve(onSleep()).then(() => {
      sleeping = false;
      restT = 0; // a fresh grace beat, so a held key doesn't tip you straight out
    });
    return true;
  }

  function dismount() {
    resting = false;
    player.resting = false;
    const side = rand() < 0.5 ? 1 : -1;
    const px = mid.x + perp.x * 0.95 * side, pz = mid.z + perp.z * 0.95 * side;
    player.pos.set(px, islandHeight(px, pz) + 1.66, pz);
    player.vel.set(0, 0, 0);
    player.pitch = -0.06;
  }

  function update(t, dt) {
    // the hammock swings on the wind, harder in a blow
    const amp = 0.035 + uniforms.uWindAmp.value * 0.03;
    const ang = Math.sin(t * 0.62) * amp + Math.sin(t * 1.7) * amp * 0.2;
    swing.rotation.x = ang; // about the anchor line, thanks to YXZ order

    const touch = onTouchUI();
    liftRow(touch);

    if (resting) {
      restT += dt;
      // the camera lies in the cloth, riding the same swing
      const r = new THREE.Vector3(0, -sag - 0.12 + EYE_LYING, 0);
      r.applyAxisAngle(new THREE.Vector3(1, 0, 0), ang);
      r.applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      camera.position.set(mid.x + r.x, mid.y + r.y + Math.sin(t * 0.9) * 0.012, mid.z + r.z);
      camera.rotation.set(player.pitch, player.yaw, ang * 0.7);
      // any movement key tips you out (after a grace beat); on touch the
      // joystick or the jump button does the same
      if (!sleeping && restT > 0.6) {
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
          if (player.keys.has(code)) { dismount(); break; }
        }
        if (resting && (player.touchMove.lengthSq() > 0.3 || player.touchJump)) {
          dismount();
        }
      }
      // lying down, the main slot turns into the sleep button; touch users
      // also get a tappable way out (keyboards just press a movement key)
      const lying = resting && !sleeping && restT > 0.4;
      mainPill.set(touch ? 'sleep' : 'E  sleep · move to get up', lying);
      upPill.set('sit up', lying && touch);
      return;
    }

    // proximity prompt: a tap target on touch, a keycap hint on desktop
    const d = Math.hypot(player.pos.x - mid.x, player.pos.z - mid.z);
    mainPill.set(touch ? 'lie back' : 'E  lie back', player.enabled && d < 2.0);
    upPill.hide();
  }

  function dispose() {
    prompt.remove();
  }

  return {
    group, update, tryToggle, trySleep, dispose, mid, sited: true,
    resting: () => resting,
    sleeping: () => sleeping,
  };
}
