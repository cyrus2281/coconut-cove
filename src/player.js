// First-person beach walker: pointer-lock mouse look (with drag fallback),
// WASD/arrows + run + jump, gravity, terrain collision from the island height
// function, wading slowdown in the shallows, and a soft head-bob.

import * as THREE from 'three';
import { islandHeight, shoreRadius } from './world/island.js';
import { uniforms } from './core/env.js';

const EYE = 1.66;
const WALK = 4.3, RUN = 7.6;
const GRAVITY = 22, JUMP = 6.8;
const MAX_WADE_DEPTH = 1.25; // deeper than this pushes you back

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    camera.rotation.order = 'YXZ';

    // spawn on the south beach looking out over the water toward the sun
    const az = 1.62;
    const r = shoreRadius(az) - 7.5;
    this.pos = new THREE.Vector3(Math.cos(az) * r, 0, Math.sin(az) * r);
    this.pos.y = islandHeight(this.pos.x, this.pos.z) + EYE;
    const out = new THREE.Vector2(Math.cos(az), Math.sin(az));
    this.yaw = Math.atan2(-out.x, -out.y) + 0.35;
    this.pitch = -0.06;

    this.vel = new THREE.Vector3();
    this.grounded = true;
    this.keys = new Set();
    this.bobPhase = 0;
    this.bob = 0;
    this.enabled = false; // set true when the intro overlay is dismissed

    // footprint stamping
    this.onStep = null;   // (x, z, h, dirX, dirZ, side) => void
    this.strideAcc = 0.4; // start mid-stride so the first print lands quickly
    this.stepSide = 0;

    this._bind();
  }

  _bind() {
    const dom = this.dom;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // mouse look: pointer lock when available, click-drag as fallback
    let dragging = false;
    dom.addEventListener('mousedown', () => { dragging = true; });
    window.addEventListener('mouseup', () => { dragging = false; });
    dom.addEventListener('mousemove', (e) => {
      const locked = document.pointerLockElement === dom;
      if (!this.enabled || (!locked && !dragging)) return;
      this._look(e.movementX, e.movementY);
    });

    // touch: dragging on the world looks around; movement comes from the
    // on-screen joystick (touchui.js), which writes touchMove/touchJump
    this.touchMove = new THREE.Vector2();
    this.touchJump = false;
    const looks = new Map();
    dom.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        looks.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const rec = looks.get(t.identifier);
        if (!rec) continue;
        if (this.enabled) this._look((t.clientX - rec.x) * 2.2, (t.clientY - rec.y) * 2.2);
        rec.x = t.clientX; rec.y = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const endTouch = (e) => {
      for (const t of e.changedTouches) looks.delete(t.identifier);
    };
    dom.addEventListener('touchend', endTouch);
    dom.addEventListener('touchcancel', endTouch);
  }

  _look(dx, dy) {
    this.yaw -= dx * 0.0023;
    this.pitch -= dy * 0.0023;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
  }

  requestLock() {
    // Pointer lock is unavailable in some embedded contexts — the click-drag
    // fallback in _bind() keeps mouse look working there.
    try {
      const p = this.dom.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* fall back to drag-look */ }
  }

  update(dt) {
    const k = this.keys;
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    fwd += -this.touchMove.y;
    strafe += this.touchMove.x;
    if (!this.enabled) { fwd = 0; strafe = 0; }

    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const target = running ? RUN : WALK;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const dir = new THREE.Vector3(-sy * fwd + cy * strafe, 0, -cy * fwd - sy * strafe);
    if (dir.lengthSq() > 1) dir.normalize();

    // wading drag (against the live, tide-shifted waterline)
    const tide = uniforms.uTide.value;
    const ground = islandHeight(this.pos.x, this.pos.z);
    const submersion = Math.max(0, tide - ground);
    const drag = 1 / (1 + submersion * 1.1);

    // horizontal velocity with pleasant accel/decel
    const accel = this.grounded ? 34 : 8;
    this.vel.x += (dir.x * target * drag - this.vel.x) * Math.min(accel * dt, 1);
    this.vel.z += (dir.z * target * drag - this.vel.z) * Math.min(accel * dt, 1);

    // gravity + jump
    this.vel.y -= GRAVITY * dt;
    if (this.enabled && this.grounded && (k.has('Space') || this.touchJump)) {
      this.vel.y = JUMP * Math.sqrt(drag);
      this.grounded = false;
    }

    // integrate with axis-slide so deep water blocks like a soft wall
    const tryMove = (nx, nz) => islandHeight(nx, nz) > tide - MAX_WADE_DEPTH;
    const px0 = this.pos.x, pz0 = this.pos.z;
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    if (tryMove(nx, nz)) {
      this.pos.x = nx; this.pos.z = nz;
    } else if (tryMove(nx, this.pos.z)) {
      this.pos.x = nx; this.vel.z = 0;
    } else if (tryMove(this.pos.x, nz)) {
      this.pos.z = nz; this.vel.x = 0;
    } else {
      this.vel.x = 0; this.vel.z = 0;
    }

    this.pos.y += this.vel.y * dt;
    const floor = islandHeight(this.pos.x, this.pos.z) + EYE;
    if (this.pos.y <= floor) {
      this.pos.y = floor;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > floor + 0.02) {
      this.grounded = false;
    }

    // footprints: stamp alternating feet along the direction of travel
    const speed0 = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && speed0 > 0.6) {
      this.strideAcc += Math.hypot(this.pos.x - px0, this.pos.z - pz0);
      const stride = 0.6 + speed0 * 0.06;
      if (this.strideAcc >= stride) {
        this.strideAcc = 0;
        const mx = this.vel.x / speed0, mz = this.vel.z / speed0;
        this.stepSide = 1 - this.stepSide;
        const lat = (this.stepSide ? 1 : -1) * 0.11;
        const fx = this.pos.x - mx * 0.24 - mz * lat;
        const fz = this.pos.z - mz * 0.24 + mx * lat;
        const fh = islandHeight(fx, fz);
        if (this.onStep && fh > tide - 0.06) this.onStep(fx, fz, fh, mx, mz, this.stepSide);
      }
    } else if (!this.grounded) {
      this.strideAcc = 0.45; // land mid-stride
    }

    // head bob
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && speed > 0.4) {
      this.bobPhase += dt * (4.6 + speed * 0.9);
      this.bob = THREE.MathUtils.lerp(this.bob, Math.sin(this.bobPhase) * 0.043 * Math.min(speed / WALK, 1.3), 0.3);
    } else {
      this.bob = THREE.MathUtils.lerp(this.bob, 0, 0.1);
    }

    this.camera.position.set(this.pos.x, this.pos.y + this.bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
