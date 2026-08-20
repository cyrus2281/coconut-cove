// Procedural, positional ocean ambience with Web Audio — no audio files.
// The two surf layers sit on their surge beaches (stereo-panned by where you
// face, louder as you approach the waterline), a gentle lap rides the shore
// everywhere, wind swells on the dune tops and in squalls, palms hiss when
// you stand under a crown, rain drums during a squall, and gulls cry from
// wherever they actually are.

import { islandHeight, shoreRadius } from './world/island.js';
import { ZONES } from './world/swash.js';
import { uniforms } from './core/env.js';

export class OceanAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.layers = [];
    this.muted = false;
    this.volume = 0.4;
    this.player = null;
    this.crowns = [];
  }

  attachWorld(player, crowns) {
    this.player = player;
    this.crowns = crowns || [];
  }

  // the campfire's place in the world + its live intensity (0..1)
  attachFire(pos, fireK) {
    this.firePos = pos;
    this.fireK = fireK || (() => 1);
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    // 4s loop of pink-ish noise
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + 0.029 * w;
      b1 = 0.985 * b1 + 0.032 * w;
      b2 = 0.95 * b2 + 0.048 * w;
      d[i] = (b0 * 3.5 + b1 * 1.8 + b2 * 0.8 + w * 0.05) * 0.24;
    }

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // one lowpass between the world and your ears: wide open in the air,
    // slammed down to a muffled thud with your head under the water
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 19500;
    this.lp.Q.value = 0.4;
    this.master.connect(this.lp).connect(ctx.destination);

    // every one-shot (gull, thock, splash, bubble, the fire pops) rides this
    // bus instead of going straight to master, so solo() can hold them back
    // while a single bed is being auditioned in the component viewer
    this.fx = ctx.createGain();
    this.fx.connect(this.master);

    const mkLayer = (opts) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = opts.rate || 0.9 + Math.random() * 0.2;
      const filter = ctx.createBiquadFilter();
      filter.type = opts.type || 'lowpass';
      filter.frequency.value = opts.freq;
      filter.Q.value = opts.q;
      const g = ctx.createGain();
      g.gain.value = 0;
      // unity unless solo() pulls it down: the island always runs the full
      // mix, the component viewer listens to one layer at a time
      const solo = ctx.createGain();
      const pan = ctx.createStereoPanner();
      src.connect(filter).connect(g).connect(solo).connect(pan).connect(this.master);
      src.start();
      const layer = { ...opts, src, filter, g, solo, pan, baseFreq: opts.freq };
      this.layers.push(layer);
      return layer;
    };

    // surf on the two surge beaches, phased so the crash lands with the bore
    mkLayer({ id: 'surf-a', kind: 'zone', az: ZONES[0].az, freq: 650, q: 0.6, period: 13.0, phase: 0.44, gainMax: 0.8, pow: 2.6 });
    mkLayer({ id: 'surf-b', kind: 'zone', az: ZONES[1].az, freq: 950, q: 0.7, period: 17.0, phase: -1.96, gainMax: 0.6, pow: 3.0 });
    // the everywhere-lap at the waterline
    mkLayer({ id: 'lap', kind: 'lap', freq: 540, q: 0.5, period: 7.0, phase: 2.1, gainMax: 0.3, pow: 1.8 });
    // wind bed
    mkLayer({ id: 'wind', kind: 'wind', freq: 320, q: 0.4, period: 31, phase: 7, gainMax: 0.16, pow: 1 });
    // palm-frond hiss (gain fully driven in update)
    mkLayer({ id: 'rustle', kind: 'rustle', type: 'bandpass', freq: 1750, q: 0.9, rate: 1.9 });

    // rain: bright patter + low wash, silent until a squall
    this.rainHi = mkLayer({ id: 'rain-hi', kind: 'rain', type: 'bandpass', freq: 3200, q: 0.8, rate: 1.7 });
    this.rainLo = mkLayer({ id: 'rain-lo', kind: 'rain', freq: 420, q: 0.5, rate: 1.7 });

    // campfire: a low rushing bed; the pops are scheduled in update()
    this.fireBed = mkLayer({ id: 'fire', kind: 'fire', type: 'bandpass', freq: 820, q: 0.5, rate: 1.35 });
    // the underwater bed: a slow deep wash, silent until you submerge
    this.uwBed = mkLayer({ id: 'uw', kind: 'uw', freq: 210, q: 0.7, rate: 0.62 });
    this.uwK = 0;
    this.noiseBuf = buf;
    this._nextPop = 0;

    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, ctx.currentTime, 1.2);
  }

  // stereo pan of a world point relative to where the player faces
  _spatial(x, z) {
    const p = this.player;
    if (!p) return { pan: 0, dist: 20 };
    const dx = x - p.pos.x, dz = z - p.pos.z;
    const dist = Math.hypot(dx, dz) || 1e-4;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = -fz, rz = fx; // screen-right in world space
    const pan = ((dx * rx + dz * rz) / dist) * Math.min(dist / 22, 1);
    return { pan: Math.max(-1, Math.min(1, pan)), dist };
  }

  update(t) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const p = this.player;
    const storm = uniforms.uStorm.value;
    const windAmp = uniforms.uWindAmp.value;

    let hRel = 0.4;
    if (p) {
      hRel = Math.max(islandHeight(p.pos.x, p.pos.z) - uniforms.uTide.value, 0);
    }
    const beach = 1 / (1 + hRel * 0.5); // 1 at the waterline, fades up-dune

    // campfire bed + crackle pops, from where the fire actually burns
    if (this.firePos && this.fireBed) {
      const k = this.fireK();
      const { pan, dist } = this._spatial(this.firePos.x, this.firePos.z);
      const prox = 1 / (1 + Math.max(dist - 2.5, 0) * 0.45);
      this.fireBed.pan.pan.setTargetAtTime(pan, now, 0.3);
      const crackleBed = 0.4 + 0.6 * Math.min(1, Math.abs(Math.sin(t * 1.7) + Math.sin(t * 2.9)) * 0.6);
      this.fireBed.g.gain.setTargetAtTime(k * prox * 0.30 * crackleBed, now, 0.2);
      // pops: sharp little bursts of high noise, denser up close
      if (!this.muted && k > 0.15 && dist < 20 && t > this._nextPop) {
        this._nextPop = t + 0.05 + Math.random() * 0.3 / Math.max(k, 0.2);
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.playbackRate.value = 1.4 + Math.random() * 1.2;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1800 + Math.random() * 2600;
        const pg = this.ctx.createGain();
        const amp = (0.10 + Math.random() * 0.22) * k * prox;
        pg.gain.setValueAtTime(amp, now);
        pg.gain.exponentialRampToValueAtTime(0.001, now + 0.03 + Math.random() * 0.05);
        const pp = this.ctx.createStereoPanner();
        pp.pan.value = pan;
        src.connect(hp).connect(pg).connect(pp).connect(this.fx);
        src.start(now, Math.random() * 3.5, 0.09);
      }
    }

    // underwater: the lowpass clamps down and the deep wash swells up
    if (this.lp) {
      const uw = this.uwK;
      this.lp.frequency.setTargetAtTime(19500 - (19500 - 460) * uw, now, 0.12);
      const wash = 0.55 + 0.45 * Math.sin(t * 0.5) * Math.sin(t * 0.23 + 1.7);
      this.uwBed.g.gain.setTargetAtTime(uw * 0.34 * (0.6 + 0.4 * wash), now, 0.25);
      this.uwBed.filter.frequency.setTargetAtTime(180 + 90 * wash, now, 0.4);
    }

    for (const l of this.layers) {
      if (l.kind === 'rain') continue; // driven by setRain
      if (l.kind === 'fire') continue; // driven above
      if (l.kind === 'uw') continue;   // driven above
      const s = 0.5 + 0.5 * Math.sin((t / (l.period || 10)) * Math.PI * 2 + (l.phase || 0));
      const swell = Math.pow(s, l.pow || 1);

      if (l.kind === 'zone') {
        // the emitter is the nearest point of the surge beach's ARC, not a
        // single spot — walking the beach keeps the surf beside you — and
        // the falloff is steep enough that the far shore goes quiet on an
        // island this size
        let azE = l.az;
        if (p) {
          const pAz = Math.atan2(p.pos.z, p.pos.x);
          const dAz = Math.atan2(Math.sin(pAz - l.az), Math.cos(pAz - l.az));
          const w = l.width || 0.55;
          azE = l.az + Math.max(-w, Math.min(w, dAz));
        }
        const zr = shoreRadius(azE);
        const zx = Math.cos(azE) * zr, zz = Math.sin(azE) * zr;
        const { pan, dist } = this._spatial(zx, zz);
        const prox = 1 / (1 + Math.max(dist - 12, 0) * 0.14);
        l.pan.pan.setTargetAtTime(pan, now, 0.4);
        l.g.gain.setTargetAtTime((0.05 + swell * l.gainMax) * prox * (1 + 0.5 * storm), now, 0.25);
        l.filter.frequency.setTargetAtTime(l.baseFreq * (0.6 + swell * 1.5), now, 0.3);
      } else if (l.kind === 'lap') {
        // near the waterline AND near the shore — a summit at 60m used to
        // keep a faint shorebreak in its ears
        let lapK = beach;
        if (p) {
          const pAz = Math.atan2(p.pos.z, p.pos.x);
          const shoreDist = Math.abs(shoreRadius(pAz) - Math.hypot(p.pos.x, p.pos.z));
          lapK = beach / (1 + Math.max(shoreDist - 8, 0) * 0.05);
        }
        l.g.gain.setTargetAtTime((0.05 + swell * l.gainMax) * lapK, now, 0.3);
        l.filter.frequency.setTargetAtTime(l.baseFreq * (0.7 + swell * 1.2), now, 0.3);
      } else if (l.kind === 'wind') {
        // keyed to the actual wind, so a fresh breeze roars under a blue sky
        // and a windless mist goes hushed; the squall's gloom stacks on top
        const g = (0.06 + swell * l.gainMax)
          * (0.25 + 0.75 * windAmp + hRel * 0.22 + storm * 1.2);
        l.g.gain.setTargetAtTime(g, now, 0.5);
      } else if (l.kind === 'rustle') {
        let prox = 0, best = null;
        if (p) {
          let bd = 1e9;
          for (const c of this.crowns) {
            const dd = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
            if (dd < bd) { bd = dd; best = c; }
          }
          prox = Math.pow(Math.max(1 - bd / 9, 0), 2);
        }
        const flutter = 0.55 + 0.45 * Math.sin(t * 2.1 + Math.sin(t * 3.3) * 1.4);
        l.g.gain.setTargetAtTime(prox * flutter * (0.04 + 0.1 * windAmp), now, 0.25);
        if (best) {
          const { pan } = this._spatial(best.x, best.z);
          l.pan.pan.setTargetAtTime(pan * 0.7, now, 0.3);
        }
      }
    }
  }

  // a two-syllable "kee-yah" from a world position
  gullCry(x, z) {
    if (!this.ctx || this.muted) return;
    const { pan, dist } = this._spatial(x, z);
    if (dist > 95) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const amp = 0.26 / (1 + dist * 0.045);
    const out = ctx.createStereoPanner();
    out.pan.value = pan;
    out.connect(this.fx);
    const syllables = [
      [0, 1380, 920, 0.30],
      [0.34, 1260, 800, 0.40],
    ];
    for (const [at, f0, f1, dur] of syllables) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (f0 + f1) * 0.5;
      bp.Q.value = 2.4;
      const og = ctx.createGain();
      og.gain.value = 0;
      o.connect(bp).connect(og).connect(out);
      o.frequency.setValueAtTime(f0, now + at);
      o.frequency.exponentialRampToValueAtTime(f1, now + at + dur);
      og.gain.setValueAtTime(0, now + at);
      og.gain.linearRampToValueAtTime(amp, now + at + 0.06);
      og.gain.setValueAtTime(amp * 0.85, now + at + dur - 0.12);
      og.gain.linearRampToValueAtTime(0, now + at + dur);
      o.start(now + at);
      o.stop(now + at + dur + 0.05);
    }
  }

  // the hollow knock of a booted coconut
  thock(x, z) {
    if (!this.ctx || this.muted) return;
    const { pan, dist } = this._spatial(x, z);
    if (dist > 30) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const amp = 0.5 / (1 + dist * 0.2);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(210 + Math.random() * 40, now);
    o.frequency.exponentialRampToValueAtTime(70, now + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.fx);
    o.start(now);
    o.stop(now + 0.13);
  }

  // how far under the player's head is (0 air → 1 submerged, pre-smoothed)
  setUnderwater(k) {
    this.uwK = k;
  }

  // a body hitting the water: a burst of filtered noise sweeping down
  splash(intensity = 0.6) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1.2 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, now);
    bp.frequency.exponentialRampToValueAtTime(320, now + 0.28);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    const amp = 0.16 + 0.5 * intensity;
    g.gain.setValueAtTime(amp, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.30 + intensity * 0.25);
    src.connect(bp).connect(g).connect(this.fx);
    src.start(now, Math.random() * 3, 0.6);
  }

  // one exhaled bubble: a tiny sine blip curling upward in pitch
  bubble() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 260 + Math.random() * 240;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f0 * (2.1 + Math.random()), now + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.05, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    o.connect(g).connect(this.fx);
    o.start(now);
    o.stop(now + 0.12);
  }

  setRain(k) {
    if (!this.ctx || !this.rainHi) return;
    const now = this.ctx.currentTime;
    this.rainHi.g.gain.setTargetAtTime(k * 0.5, now, 0.8);
    this.rainLo.g.gain.setTargetAtTime(k * 0.28, now, 0.8);
  }

  // a thunderclap, `delay` seconds after its flash: distant strikes arrive as
  // pure rumble, close ones lead with the tearing crack overhead
  thunder(delay = 1, intensity = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + delay;
    const close = Math.max(1 - delay / 3, 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.4 + Math.random() * 0.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(90 + close * 170, at);
    lp.frequency.exponentialRampToValueAtTime(45, at + 2.4);
    const g = ctx.createGain();
    const amp = (0.5 + 0.5 * close) * 0.55 * intensity;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(amp, 0.001), at + 0.06 + (1 - close) * 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, at + 2.2 + Math.random() * 1.3);
    src.connect(lp).connect(g).connect(this.fx);
    src.start(at, Math.random() * 3);
    src.stop(at + 4.2);
    if (close > 0.4) {
      const c = ctx.createBufferSource();
      c.buffer = this.noiseBuf;
      c.playbackRate.value = 1.5;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.4 * close * intensity, at);
      cg.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
      c.connect(hp).connect(cg).connect(this.fx);
      c.start(at, Math.random() * 3, 0.6);
    }
  }

  // Listen to one thing at a time. `null` is the island's full mix; a layer
  // id ('surf-a', 'wind', 'uw'...) is that bed alone; 'fx' is the one-shots
  // alone; `false` is silence. Only the component viewer ever calls this.
  solo(sel = null) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const all = sel === null || sel === undefined;
    for (const l of this.layers) {
      l.solo.gain.setTargetAtTime(all || l.id === sel ? 1 : 0, now, 0.08);
    }
    this.fx.gain.setTargetAtTime(all || sel === 'fx' ? 1 : 0, now, 0.08);
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx && this.master && !this.muted) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.15);
    }
  }

  // The two surf layers pan to their surge beaches, but they read the zone
  // bearings once at start() and reseedSwash() swaps those objects out from
  // under them on every new island. Re-point them at the current coast.
  refreshZones() {
    for (const l of this.layers) {
      if (l.kind !== 'zone') continue;
      const z = ZONES[l.id === 'surf-a' ? 0 : 1];
      l.az = z.az;
      l.width = z.width; // the arc the emitter slides along
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.4);
    }
  }
}
