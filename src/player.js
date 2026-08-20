// First-person beach walker and snorkeler: pointer-lock mouse look (with drag
// fallback), WASD/arrows + run + jump, gravity, terrain collision from the
// island height function, wading slowdown in the shallows, and a soft
// head-bob. Wade past chest depth and the water takes you — surface swimming
// rides the swell, diving follows your gaze, and a gentle current marks the
// edge of the cove so you can't swim out to sea.

import * as THREE from 'three';
import { islandHeight, shoreRadius, waterLevelAt } from './world/island.js';
import { runupNow, runupVel, ZONES } from './world/swash.js';
import { uniforms } from './core/env.js';

const EYE = 1.66;
const EYE_SURF = 0.42;  // eye height above the waterline while surface swimming
const WALK = 4.3, RUN = 7.6;
const GRAVITY = 22, JUMP = 6.8;
const MAX_WADE_DEPTH = 1.25; // walking deeper than this pushes you back
const SWIM_ON = 1.12;   // water this deep floats you off your feet
const SWIM_OFF = 0.95;  // wading back in: feet find the ground again
const SWIM = 2.7, SWIM_FAST = 4.7;
export const SWIM_MAX = 72; // how far past the shoreline the cove lets you swim

// JS mirror of the two dominant Gerstner swells in water.js (W0 + W1) — just
// enough for the camera to ride the waves while surface swimming. W2/W3 are
// fine chop the eye doesn't need to track.
function gerstY(x, z, t, dx, dz, amp, len) {
  const il = 1 / Math.hypot(dx, dz);
  const k = (Math.PI * 2) / len;
  const c = Math.sqrt(9.8 / k);
  return amp * Math.sin(k * ((x * dx + z * dz) * il - c * t));
}
export function swellAt(x, z, t, depth) {
  const shallow = THREE.MathUtils.clamp(depth / 1.8, 0.1, 1);
  return (gerstY(x, z, t, 1.0, 0.25, 0.25, 33)
    + gerstY(x, z, t, 0.72, 0.62, 0.14, 17)) * shallow;
}

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    camera.rotation.order = 'YXZ';

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.06;
    this.respawn();
    this.grounded = true;
    this.keys = new Set();
    this.bobPhase = 0;
    this.bob = 0;
    this.enabled = false; // set true when the intro overlay is dismissed
    this.resting = false; // lying in the hammock: it owns the camera

    // swimming
    this.swimming = false;
    this.submerged = false; // eye below the water surface right now
    this.subK = 0;          // smoothed 0→1 submersion (audio / overlay fades)
    this.surfaceY = 0;      // live water surface at the player (tide + swell)
    this.boundaryK = 0;     // 0 free water → 1 pressed against the swim limit
    this.swimTime = 0;      // seconds spent in the current swim
    this.onSplash = null;   // (intensity 0..1) => void, fired on water entry

    // footprint stamping
    this.onStep = null;   // (x, z, h, dirX, dirZ, side) => void
    this.strideAcc = 0.4; // start mid-stride so the first print lands quickly
    this.stepSide = 0;

    this._bind();
  }

  // spawn on the main surge beach looking out over the water
  // (called again whenever the island is regrown from a new seed)
  respawn() {
    const az = ZONES[0].az + 0.08;
    const r = shoreRadius(az) - 7.5;
    this.pos.set(Math.cos(az) * r, 0, Math.sin(az) * r);
    this.pos.y = islandHeight(this.pos.x, this.pos.z) + EYE;
    this.yaw = Math.atan2(-Math.cos(az), -Math.sin(az)) + 0.35;
    this.pitch = -0.06;
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.swimming = false;
    this.submerged = false;
    this.subK = 0;
    this.boundaryK = 0;
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
    this.touchDive = false;
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
    if (this.resting) return; // the hammock drives the camera; keys still read
    const t = uniforms.uTime.value;
    const ground = islandHeight(this.pos.x, this.pos.z);
    const still = waterLevelAt(this.pos.x, this.pos.z);
    const depth = still - ground;
    this.surfaceY = still + swellAt(this.pos.x, this.pos.z, t, depth);

    // deep enough to float and low enough to be in it: the water takes you
    if (!this.swimming) {
      if (depth > SWIM_ON && this.pos.y - EYE < this.surfaceY - 0.55) {
        this.swimming = true;
        this.grounded = false;
        this.swimTime = 0;
        this.strideAcc = 0.45;
        if (this.onSplash) {
          this.onSplash(THREE.MathUtils.clamp(0.35 + Math.abs(this.vel.y) * 0.22, 0, 1));
        }
        this.vel.y *= 0.25; // the water catches you
      }
    } else if (depth < SWIM_OFF) {
      this.swimming = false; // feet can reach the sand again
      this.boundaryK = 0;
    }

    if (this.swimming) this._updateSwim(dt, t, ground);
    else this._updateWalk(dt, t, ground, still);

    // smoothed submersion drives the underwater tint / audio muffle fades
    this.submerged = this.pos.y + this.bob < this.surfaceY - 0.02;
    this.subK += ((this.submerged ? 1 : 0) - this.subK) * Math.min(dt * 7, 1);

    this.camera.position.set(this.pos.x, this.pos.y + this.bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  // ---------------------------------------------------------------- swimming
  _updateSwim(dt, t, ground) {
    const k = this.keys;
    this.swimTime += dt;
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    fwd += -this.touchMove.y;
    strafe += this.touchMove.x;
    let kick = 0;
    if (this.enabled) {
      if (k.has('Space') || this.touchJump) kick += 1;
      if (k.has('KeyC') || k.has('ControlLeft') || this.touchDive) kick -= 1;
    } else { fwd = 0; strafe = 0; }

    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    const spd = fast ? SWIM_FAST : SWIM;

    // forward follows your gaze once your eyes are under (that's the dive);
    // from the surface an emphatic look-down also takes you under
    const usePitch = this.submerged || this.pitch < -0.5;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const cp = usePitch ? Math.cos(this.pitch) : 1;
    const sp = usePitch ? Math.sin(this.pitch) : 0;
    const dir = new THREE.Vector3(
      -sy * cp * fwd + cy * strafe,
      sp * fwd,
      -cy * cp * fwd - sy * strafe
    );
    if (dir.lengthSq() > 1) dir.normalize();

    const floatY = this.surfaceY + EYE_SURF;
    let tx = dir.x * spd;
    let ty = dir.y * spd + kick * 2.4;
    let tz = dir.z * spd;

    // buoyancy: unless you're pushing down, a snorkeler drifts up and
    // settles right at the surface, bobbing with the swell
    if (ty > -0.05) {
      const lift = THREE.MathUtils.clamp((floatY - this.pos.y) * 0.9, 0, 0.85);
      ty += lift;
    }

    const acc = 5.0; // water is soggy: slow to start, slow to stop
    this.vel.x += (tx - this.vel.x) * Math.min(acc * dt, 1);
    this.vel.y += (ty - this.vel.y) * Math.min(acc * 1.4 * dt, 1);
    this.vel.z += (tz - this.vel.z) * Math.min(acc * dt, 1);

    // the edge of the cove: past the reef a firm current turns you back
    const azP = Math.atan2(this.pos.z, this.pos.x);
    const limit = shoreRadius(azP) + SWIM_MAX;
    const rr = Math.hypot(this.pos.x, this.pos.z);
    this.boundaryK = THREE.MathUtils.clamp((rr - (limit - 9)) / 9, 0, 1);
    if (this.boundaryK > 0) {
      const push = this.boundaryK * this.boundaryK * 10;
      this.vel.x -= Math.cos(azP) * push * dt;
      this.vel.z -= Math.sin(azP) * push * dt;
    }

    this.pos.addScaledVector(this.vel, dt);

    // hard stop at the limit: slide along the arc, never through it
    const rNew = Math.hypot(this.pos.x, this.pos.z);
    const azN = Math.atan2(this.pos.z, this.pos.x);
    const limN = shoreRadius(azN) + SWIM_MAX;
    if (rNew > limN) {
      this.pos.x *= limN / rNew;
      this.pos.z *= limN / rNew;
      const outX = Math.cos(azN), outZ = Math.sin(azN);
      const vOut = this.vel.x * outX + this.vel.z * outZ;
      if (vOut > 0) { this.vel.x -= outX * vOut; this.vel.z -= outZ * vOut; }
    }

    // body clearance off the sand, and no launching out of the sea
    const floor = islandHeight(this.pos.x, this.pos.z) + 0.55;
    if (this.pos.y < floor) {
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    if (this.pos.y > floatY) {
      this.pos.y = floatY;
      if (this.vel.y > 0.4) this.vel.y = 0.4;
    }

    // slow stroke sway instead of the walking head-bob
    const speed = this.vel.length();
    if (speed > 0.5) {
      this.bobPhase += dt * (1.8 + speed * 0.55);
      this.bob = THREE.MathUtils.lerp(this.bob, Math.sin(this.bobPhase) * 0.028, 0.12);
    } else {
      this.bob = THREE.MathUtils.lerp(this.bob, 0, 0.06);
    }
    this.grounded = false;
  }

  // ----------------------------------------------------------------- walking
  _updateWalk(dt, t, ground, still) {
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

    // the mountains are real: climbing slows past ~20° and stalls past ~50°.
    // Only the uphill component is taxed — downhill and contouring stay at
    // full speed, so a slope can never trap you (jump remains the escape
    // hatch for small pockets).
    let climbK = 1;
    const dl = dir.length();
    if (dl > 1e-4) {
      const px = dir.x / dl, pz = dir.z / dl;
      const grade = (islandHeight(this.pos.x + px * 0.7, this.pos.z + pz * 0.7) - ground) / 0.7;
      if (grade > 0.36) climbK = 1 - THREE.MathUtils.smoothstep(grade, 0.36, 1.19);
    }

    // wading drag. `tide` is the sea (the swash model below is a sea thing);
    // `water` is whatever stands underfoot, so the lagoon wades like the sea.
    const tide = uniforms.uTide.value;
    const submersion = Math.max(0, still - ground);
    const drag = 1 / (1 + submersion * 1.1);

    // surge push: standing in the swash sheet, the bore carries you up the
    // beach and the backwash tugs you back out (jump to escape it)
    let driftX = 0, driftZ = 0;
    if (this.grounded) {
      const azP = Math.atan2(this.pos.z, this.pos.x);
      const rel = ground - tide;             // feet above the still waterline
      const ru = runupNow(azP, uniforms.uTime.value);
      if (rel > -0.6 && rel < ru) {
        const rv = runupVel(azP, uniforms.uTime.value);
        const sheet = THREE.MathUtils.clamp((ru - Math.max(rel, 0)) / 0.3, 0, 1);
        const wade = 1 - THREE.MathUtils.clamp((-rel - 0.1) / 0.5, 0, 1);
        // + = inland; horizontal sheet speed ~ run-up rate / beach slope
        const speed = THREE.MathUtils.clamp(rv * 5.5, -1.35, 2.9) * sheet * wade;
        driftX = -Math.cos(azP) * speed;
        driftZ = -Math.sin(azP) * speed;
      }
    }

    // horizontal velocity with pleasant accel/decel
    const accel = this.grounded ? 34 : 8;
    this.vel.x += (dir.x * target * drag * climbK + driftX - this.vel.x) * Math.min(accel * dt, 1);
    this.vel.z += (dir.z * target * drag * climbK + driftZ - this.vel.z) * Math.min(accel * dt, 1);

    // gravity + jump
    this.vel.y -= GRAVITY * dt;
    if (this.enabled && this.grounded && (k.has('Space') || this.touchJump)) {
      this.vel.y = JUMP * Math.sqrt(drag);
      this.grounded = false;
    }

    // integrate with axis-slide so deep water blocks like a soft wall
    const tryMove = (nx, nz) => islandHeight(nx, nz) > waterLevelAt(nx, nz) - MAX_WADE_DEPTH;
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

    // standing on a near-vertical face (a cliff lip, a mountain wall): the
    // ground sheds you downhill until you're back under ~50°
    if (this.grounded) {
      const gx = islandHeight(this.pos.x + 0.5, this.pos.z) - islandHeight(this.pos.x - 0.5, this.pos.z);
      const gz = islandHeight(this.pos.x, this.pos.z + 0.5) - islandHeight(this.pos.x, this.pos.z - 0.5);
      const steep = Math.hypot(gx, gz); // rise over the 1m probe baseline
      if (steep > 1.19) {
        const push = Math.min((steep - 1.19) * 8, 10);
        this.vel.x -= (gx / steep) * push * dt;
        this.vel.z -= (gz / steep) * push * dt;
      }
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
        if (this.onStep && fh > waterLevelAt(fx, fz) - 0.06) {
          this.onStep(fx, fz, fh, mx, mz, this.stepSide);
        }
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
  }
}
