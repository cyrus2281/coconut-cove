// A striped hammock slung between two close palms. Walk up and press E to
// lie back: the camera sinks into the cloth and sways with it, looking up
// through the fronds — stars, meteors and passing clouds included. Any
// movement key tips you back out. The whole hammock (and the lying camera)
// swings gently on the wind about the line between its two anchor points.

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

export function buildHammock(player, trees, camera) {
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
    return { group, update: () => {}, resting: () => false, sited: false };
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

  // ---- the "lie back" prompt: a keycap hint on desktop, a button on touch ----
  const hint = document.createElement('div');
  hint.id = 'hammockHint';
  Object.assign(hint.style, {
    position: 'fixed', left: '50%', bottom: '64px', transform: 'translateX(-50%)',
    fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '13px',
    color: 'rgba(255,255,255,0.85)', background: 'rgba(10,25,35,0.45)',
    border: '1px solid rgba(255,255,255,0.25)', borderRadius: '999px',
    padding: '7px 16px', zIndex: 6, opacity: 0, transition: 'opacity 0.3s',
    pointerEvents: 'none', letterSpacing: '0.08em', backdropFilter: 'blur(4px)',
    cursor: 'pointer', userSelect: 'none', webkitUserSelect: 'none',
    touchAction: 'none',
  });
  // tappable/clickable — pointer events only turn on while it's visible,
  // so an invisible pill can't catch stray taps
  hint.addEventListener('touchstart', (e) => {
    e.preventDefault(); // also swallows the synthetic click that would follow
    e.stopPropagation();
    tryToggle();
  }, { passive: false });
  hint.addEventListener('click', () => tryToggle());
  document.body.appendChild(hint);
  const touchRoot = document.getElementById('touchui');
  const onTouchUI = () => touchRoot && !touchRoot.classList.contains('hidden');
  let hintText = '';
  function setHint(text, on) {
    if (text !== hintText) { hintText = text; hint.textContent = text; }
    hint.style.opacity = on ? 0.9 : 0;
    hint.style.pointerEvents = on ? 'auto' : 'none';
  }

  // ---- state ----
  let resting = false;
  let restT = 0;
  const saved = { yaw: 0, pitch: 0 };
  const lieP = mid.clone().add(new THREE.Vector3(0, -sag - 0.12 + EYE_LYING, 0));

  function tryToggle() {
    if (resting) { dismount(); return true; }
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
    setHint(hintText, false);
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
      if (restT > 0.6) {
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
          if (player.keys.has(code)) { dismount(); break; }
        }
        if (resting && (player.touchMove.lengthSq() > 0.3 || player.touchJump)) {
          dismount();
        }
      }
      // touch users also get a tappable way out (keyboards need no pill)
      setHint('sit up', resting && onTouchUI() && restT > 0.6);
      return;
    }

    // proximity prompt: a tap target on touch, a keycap hint on desktop
    const d = Math.hypot(player.pos.x - mid.x, player.pos.z - mid.z);
    setHint(onTouchUI() ? 'lie back' : 'E  lie back', player.enabled && d < 2.0);
  }

  function dispose() {
    hint.remove();
  }

  return { group, update, tryToggle, dispose, resting: () => resting, sited: true, mid };
}
