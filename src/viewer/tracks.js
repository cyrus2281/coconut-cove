// The audio half of the /components gallery. Nothing here is a mesh, so these
// entries skip the studio stage and drive a panel instead. The sound is the
// island's own OceanAudio with a single layer soloed and a stub player stood
// wherever that layer is worth hearing from, so what you judge here is what
// plays out there.

import { uniforms } from '../core/env.js';
import { DEFAULT_SEED, setSeed } from '../core/seed.js';
import { OceanAudio } from '../audio.js';
import { islandHeight, reseedIsland, shoreRadius } from '../world/island.js';
import { ZONES } from '../world/swash.js';

// Every track carries the same shape as a creature or prop entry (id, label,
// section, anims) plus three of its own: `layer` is what solo() listens to,
// `apply` dresses the stub world for the chosen pose, and `shot` fires a
// one-shot. A track with no `shot` is a bed and gets a play/stop toggle.
const track = (o) => ({ section: 'audio', kind: 'audio', anims: [], ...o });

const POSE_RAIN = [
  { id: 'drizzle', label: 'drizzle' },
  { id: 'downpour', label: 'downpour' },
];
const POSE_FIRE = [
  { id: 'blazing', label: 'blazing' },
  { id: 'dying', label: 'dying down' },
];

export const AUDIO_TRACKS = [
  // -------------------------------------------------------------- the beds
  track({
    id: 'aud-surf-a', label: 'surf · main beach', layer: 'surf-a',
    blurb: 'the long swell breaking on the first surge beach, panned to its own stretch of coast and phased so the crash lands with the bore.',
    anims: [
      { id: 'waterline', label: 'at the waterline' },
      { id: 'dune', label: 'up the dune' },
      { id: 'squall', label: 'squall' },
    ],
    apply(s, pose) {
      s.stand(ZONES[0].az, pose === 'dune' ? 2.6 : 0);
      if (pose === 'squall') s.storm(1);
    },
  }),
  track({
    id: 'aud-surf-b', label: 'surf · second beach', layer: 'surf-b',
    blurb: 'the other surge beach: brighter, a longer period, its own bore rhythm. Two of these running together is most of the ocean you hear.',
    anims: [
      { id: 'waterline', label: 'at the waterline' },
      { id: 'dune', label: 'up the dune' },
      { id: 'squall', label: 'squall' },
    ],
    apply(s, pose) {
      s.stand(ZONES[1].az, pose === 'dune' ? 2.6 : 0);
      if (pose === 'squall') s.storm(1);
    },
  }),
  track({
    id: 'aud-lap', label: 'shore lap', layer: 'lap',
    blurb: 'the gentle everywhere-swash at the water’s edge. No bearing of its own: it just gets quieter the further up the beach you walk.',
    anims: [
      { id: 'waterline', label: 'at the waterline' },
      { id: 'dune', label: 'up the dune' },
    ],
    apply(s, pose) { s.stand(ZONES[0].az, pose === 'dune' ? 3 : 0); },
  }),
  track({
    id: 'aud-wind', label: 'wind', layer: 'wind',
    blurb: 'the wind bed, thin down on the sand and rising over the dune tops. A squall multiplies it by three and a half.',
    anims: [
      { id: 'shore', label: 'down on the sand' },
      { id: 'dune', label: 'on the dune tops' },
      { id: 'squall', label: 'squall' },
    ],
    apply(s, pose) {
      s.stand(ZONES[0].az, pose === 'dune' ? 4 : 0);
      if (pose === 'squall') s.storm(1);
    },
  }),
  track({
    id: 'aud-rustle', label: 'palm rustle', layer: 'rustle',
    blurb: 'dry fronds hissing overhead. Gain is pure proximity: it falls to nothing about nine metres from the nearest crown, so it only speaks when you stand under a palm.',
    anims: [
      { id: 'under', label: 'under the crown' },
      { id: 'off', label: 'a few steps off' },
      { id: 'gale', label: 'gale' },
    ],
    apply(s, pose) {
      s.stand(ZONES[0].az, 2);
      s.crownsAt(pose === 'off' ? 6 : 0.6);
      if (pose === 'gale') s.wind(2.8);
    },
  }),
  track({
    id: 'aud-rain-hi', label: 'rain · patter', layer: 'rain-hi',
    blurb: 'the bright half of a squall: rain hitting leaves and sand.',
    anims: POSE_RAIN,
    apply(s, pose) { s.stand(ZONES[0].az, 2); s.rain(pose === 'downpour' ? 1 : 0.25); },
  }),
  track({
    id: 'aud-rain-lo', label: 'rain · wash', layer: 'rain-lo',
    blurb: 'the low half of the same squall: the wash sitting underneath the patter.',
    anims: POSE_RAIN,
    apply(s, pose) { s.stand(ZONES[0].az, 2); s.rain(pose === 'downpour' ? 1 : 0.25); },
  }),
  track({
    id: 'aud-fire', label: 'campfire bed', layer: 'fire',
    blurb: 'the fire’s low rushing bed with its crackle held back, breathing on two detuned sines.',
    anims: [...POSE_FIRE, { id: 'far', label: 'across the camp' }],
    apply(s, pose) {
      s.stand(ZONES[0].az, 3);
      s.fire(pose === 'far' ? 9 : 2, pose === 'dying' ? 0.25 : 1);
    },
  }),
  track({
    id: 'aud-uw', label: 'underwater wash', layer: 'uw',
    blurb: 'the deep wash you hear with your head under. Submerging also clamps the master lowpass from 19.5 kHz down to 460 Hz, which is why everything else goes to mud.',
    anims: [
      { id: 'half', label: 'half under' },
      { id: 'under', label: 'submerged' },
    ],
    apply(s, pose) { s.stand(ZONES[0].az, 0); s.underwater(pose === 'half' ? 0.5 : 1); },
  }),

  // ---------------------------------------------------------- the one-shots
  track({
    id: 'aud-crackle', label: 'fire crackle', layer: 'fx',
    blurb: 'the pops the campfire throws, rescheduled one at a time rather than looped. Denser and louder the harder the fire burns.',
    spec: 'noise burst · highpass 1.8 to 4.4 kHz · 30 to 80 ms decay · next pop in 50 to 350 ms',
    anims: POSE_FIRE,
    apply(s, pose) { s.stand(ZONES[0].az, 3); s.fire(2, pose === 'dying' ? 0.3 : 1); },
  }),
  track({
    id: 'aud-gull', label: 'gull cry', layer: 'fx',
    blurb: 'a two syllable kee-yah, each syllable sliding downward. Cried from wherever the gull actually is, so it pans and thins with distance.',
    spec: 'two sawtooth syllables · 1380 to 920 Hz then 1260 to 800 Hz · bandpass Q 2.4',
    anims: [
      { id: 'near', label: 'close by' },
      { id: 'far', label: 'down the beach' },
    ],
    apply(s) { s.stand(ZONES[0].az, 1); },
    shot(audio, s) {
      const q = s.ahead(s.pose === 'far' ? 60 : 6);
      audio.gullCry(q.x, q.z);
    },
  }),
  track({
    id: 'aud-thock', label: 'coconut thock', layer: 'fx',
    blurb: 'the hollow knock of a booted coconut. Goes silent past thirty metres.',
    spec: 'sine 210 to 70 Hz · 110 ms exponential decay',
    anims: [
      { id: 'feet', label: 'at your feet' },
      { id: 'down', label: 'down the beach' },
    ],
    apply(s) { s.stand(ZONES[0].az, 1); },
    shot(audio, s) {
      const q = s.ahead(s.pose === 'down' ? 18 : 2);
      audio.thock(q.x, q.z);
    },
  }),
  track({
    id: 'aud-splash', label: 'splash', layer: 'fx',
    blurb: 'a body meeting the water: a burst of noise sweeping down as it closes over.',
    spec: 'noise burst · bandpass sweep 1400 to 320 Hz · 300 to 550 ms decay',
    anims: [
      { id: 'step', label: 'a step in' },
      { id: 'dive', label: 'a dive' },
    ],
    apply(s) { s.stand(ZONES[0].az, 0); },
    shot(audio, s) { audio.splash(s.pose === 'dive' ? 1 : 0.25); },
  }),
  track({
    id: 'aud-bubble', label: 'bubble', layer: 'fx',
    blurb: 'one exhaled bubble wobbling up past your mask.',
    spec: 'sine blip curling up about an octave · 100 ms',
    apply(s) { s.stand(ZONES[0].az, 0); s.underwater(1); },
    shot(audio) { audio.bubble(); },
  }),
];

// The bench itself: one OceanAudio for the session, a stub world for it to
// read, and the panel that draws what is coming out.
class AudioStudio {
  constructor() {
    this.audio = null;
    this.entry = null;
    this.pose = null;
    this.active = false;
    this.playing = false;
    this.analyser = null;
    this.rms = 0;
    this.peak = 0;
    // all audio.update() wants of a player is a position and a heading
    this.world = { player: { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 }, crowns: [] };
    this.el = null;
    this.seeded = false;
    this._readoutIn = 0;
  }

  // The layers read the real height field and the real surge bearings, so the
  // bench needs an island under it. It always stands on the curated default,
  // island #2281, however the props have reseeded the world since.
  _ensureWorld() {
    if (this.seeded) return;
    setSeed(DEFAULT_SEED);
    reseedIsland();
    this.seeded = true;
  }

  _ensureAudio() {
    if (this.audio) return this.audio;
    this._ensureWorld();
    const audio = new OceanAudio();
    audio.attachWorld(this.world.player, this.world.crowns);
    audio.start();
    audio.refreshZones();
    const an = audio.ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.72;
    audio.lp.connect(an); // a tap, not a route: an analyser has no output
    this.analyser = an;
    this.bins = new Uint8Array(an.frequencyBinCount);
    this.wave = new Float32Array(an.fftSize);
    this.audio = audio;
    return audio;
  }

  _ensurePanel() {
    if (this.el) return this.el;
    const id = (k) => document.getElementById(k);
    this.el = {
      panel: id('audioPanel'), name: id('apName'), blurb: id('apBlurb'),
      spec: id('apSpec'), play: id('apPlay'), meter: id('apMeter'),
      readout: id('apReadout'), vol: id('apVol'), volVal: id('apVolVal'),
    };
    this.el.play.addEventListener('click', () => {
      if (this.entry && this.entry.shot) this.trigger();
      else if (this.playing) this.stop();
      else this.play();
    });
    this.el.vol.addEventListener('input', () => {
      const v = parseFloat(this.el.vol.value);
      this.el.volVal.textContent = v.toFixed(2);
      this._ensureAudio().setVolume(v);
    });
    return this.el;
  }

  // ---- what the layers are listening to ----

  // Stand where the ground is `h` metres above the water on this bearing,
  // looking out at the waterline. Walking inland until the height field says
  // so keeps "up the dune" meaning the same thing whatever the seed grew.
  stand(az, h = 0) {
    const r = shoreRadius(az);
    const sx = Math.cos(az) * r, sz = Math.sin(az) * r;
    let f = 1;
    for (let i = 0; i <= 60; i++) {
      f = 1 - (i / 60) * 0.8;
      if (islandHeight(Math.cos(az) * r * f, Math.sin(az) * r * f) >= h) break;
    }
    const p = this.world.player.pos;
    p.x = Math.cos(az) * r * f;
    p.z = Math.sin(az) * r * f;
    this.face(sx, sz);
    return this;
  }

  face(x, z) {
    const p = this.world.player.pos;
    // forward is (-sin yaw, -cos yaw)
    this.world.player.yaw = Math.atan2(-(x - p.x), -(z - p.z));
  }

  // a point `dist` metres straight ahead: where a one-shot sounds from
  ahead(dist) {
    const { pos, yaw } = this.world.player;
    return { x: pos.x - Math.sin(yaw) * dist, z: pos.z - Math.cos(yaw) * dist };
  }

  crownsAt(dist) {
    const c = this.ahead(dist);
    // attachWorld holds this array, so refill it rather than replacing it
    this.world.crowns.length = 0;
    this.world.crowns.push({ x: c.x, y: 7, z: c.z });
  }

  fire(dist, k = 1) {
    const c = this.ahead(dist);
    this._ensureAudio().attachFire({ x: c.x, y: 0.2, z: c.z }, () => k);
  }

  rain(k) { this._ensureAudio().setRain(k); }
  underwater(k) { this._ensureAudio().setUnderwater(k); }
  storm(k) { uniforms.uStorm.value = k; }
  wind(amp) { uniforms.uWindAmp.value = amp; }

  // ---- the viewer's handle on all this ----

  enter(entry) {
    const audio = this._ensureAudio();
    this._ensurePanel();
    audio.ctx.resume();
    document.body.classList.add('audio-mode');
    this.active = true;
    this.entry = entry;
    this.playing = false;
    this.setPose(entry.anims.length ? entry.anims[0].id : null);
    // a rail click is a real user gesture, so a bed can start straight away
    if (entry.shot) this.trigger();
    else this.play();
    return this.pose;
  }

  leave() {
    if (!this.active) return;
    this.stop();
    this.active = false;
    this.entry = null;
    document.body.classList.remove('audio-mode');
    if (this.audio) this.audio.ctx.suspend();
  }

  // Hand every audition a calm, empty world, then let the track dress it.
  setPose(id) {
    if (!this.entry) return;
    this.pose = id;
    const audio = this._ensureAudio();
    uniforms.uStorm.value = 0;
    uniforms.uWindAmp.value = 1;
    // the beach env parks uTide at -10 m, which would read as standing miles
    // inland and leave every shore layer silent. The bench wants sea level.
    uniforms.uTide.value = 0;
    this.world.crowns.length = 0;
    audio.attachFire(null);
    audio.setRain(0);
    audio.setUnderwater(0);
    this.stand(ZONES[0].az, 0);
    this.entry.apply?.(this, id);
    this._render();
  }

  play() {
    if (!this.entry) return;
    this._ensureAudio().solo(this.entry.layer);
    this.playing = true;
    this._render();
  }

  stop() {
    if (this.audio) this.audio.solo(false);
    this.playing = false;
    this._render();
  }

  trigger() {
    if (!this.entry || !this.entry.shot) return;
    const audio = this._ensureAudio();
    audio.solo('fx');
    this.playing = true;
    this.entry.shot(audio, this);
    this._render();
  }

  tick(t) {
    if (!this.audio) return;
    this.audio.update(t);
    this._drawMeter();
  }

  info() {
    const l = this.audio && this.entry
      ? this.audio.layers.find((x) => x.id === this.entry.layer) : null;
    return {
      track: this.entry ? this.entry.id : null,
      pose: this.pose,
      playing: this.playing,
      ctx: this.audio ? this.audio.ctx.state : 'none',
      rms: this.rms,
      peak: this.peak,
      gain: l ? l.g.gain.value : null,
      solo: l ? l.solo.gain.value : null,
      fx: this.audio ? this.audio.fx.gain.value : null,
      at: { ...this.world.player.pos, yaw: this.world.player.yaw },
    };
  }

  // ---- the panel ----

  _render() {
    const e = this.entry;
    if (!e || !this.el) return;
    this.el.name.textContent = e.label;
    this.el.blurb.textContent = e.blurb || '';
    this.el.spec.textContent = this._spec();
    this.el.play.textContent = e.shot ? 'play it again' : this.playing ? 'stop' : 'play';
    this.el.play.classList.toggle('on', this.playing && !e.shot);
  }

  // What the synthesis actually is, read off the live layer where there is one
  // so the panel can never drift from the code.
  _spec() {
    const e = this.entry;
    if (e.spec) return e.spec;
    const l = this.audio && this.audio.layers.find((x) => x.id === e.layer);
    if (!l) return '';
    const bits = [
      'pink noise × ' + l.src.playbackRate.value.toFixed(2),
      l.filter.type + ' ' + Math.round(l.baseFreq) + ' Hz Q ' + l.filter.Q.value.toFixed(2),
    ];
    if (l.period) bits.push('swell ' + l.period.toFixed(1) + ' s, curved ×' + (l.pow || 1));
    if (l.gainMax) bits.push('peak gain ' + l.gainMax.toFixed(2));
    return bits.join(' · ');
  }

  _drawMeter() {
    const cv = this.el && this.el.meter;
    if (!cv || !this.analyser) return;

    this.analyser.getFloatTimeDomainData(this.wave);
    let sum = 0;
    for (let i = 0; i < this.wave.length; i++) sum += this.wave[i] * this.wave[i];
    this.rms = Math.sqrt(sum / this.wave.length);
    // a one-shot is over long before the readout's next refresh, so hold the
    // peak and bleed it off slowly: the number stays readable either way
    this.peak = Math.max(this.rms, this.peak * 0.94);
    this.analyser.getByteFrequencyData(this.bins);

    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
    if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // spectrum: log frequency across, 0..255 up
    const nyq = this.audio.ctx.sampleRate / 2;
    const lo = 40, hi = 13000;
    const bars = 68, gap = 2;
    const bw = (w - gap * (bars - 1)) / bars;
    const base = h - 14;
    for (let i = 0; i < bars; i++) {
      const f0 = lo * Math.pow(hi / lo, i / bars);
      const f1 = lo * Math.pow(hi / lo, (i + 1) / bars);
      const b0 = Math.min(this.bins.length - 1, Math.floor(f0 / nyq * this.bins.length));
      const b1 = Math.max(b0 + 1, Math.floor(f1 / nyq * this.bins.length));
      let peak = 0;
      for (let b = b0; b < b1 && b < this.bins.length; b++) peak = Math.max(peak, this.bins[b]);
      const bh = Math.max(1, (peak / 255) * (base - 4));
      g.fillStyle = 'rgba(232, 228, 216, ' + (0.22 + (peak / 255) * 0.6).toFixed(3) + ')';
      g.fillRect(i * (bw + gap), base - bh, bw, bh);
    }

    // level bar along the bottom, full scale at about -6 dBFS, with the
    // held peak as a tick ahead of it
    const lvl = Math.min(1, this.rms / 0.5);
    const pk = Math.min(1, this.peak / 0.5);
    g.fillStyle = 'rgba(255, 255, 255, 0.10)';
    g.fillRect(0, h - 6, w, 4);
    g.fillStyle = 'rgba(255, 235, 200, 0.85)';
    g.fillRect(0, h - 6, w * lvl, 4);
    if (pk > 0.005) {
      g.fillStyle = 'rgba(255, 245, 225, 0.9)';
      g.fillRect(Math.min(w - 2, w * pk), h - 8, 2, 8);
    }

    this._readoutIn -= 1;
    if (this._readoutIn <= 0) {
      this._readoutIn = 8;
      this._drawReadout();
    }
  }

  _drawReadout() {
    if (!this.el || !this.entry) return;
    const db = this.peak > 1e-5 ? 'peak ' + (20 * Math.log10(this.peak)).toFixed(1) + ' dBFS' : 'silent';
    const l = this.audio.layers.find((x) => x.id === this.entry.layer);
    const parts = [db];
    if (l) {
      parts.push('gain ' + l.g.gain.value.toFixed(3));
      parts.push('pan ' + l.pan.pan.value.toFixed(2));
      parts.push('filter ' + Math.round(l.filter.frequency.value) + ' Hz');
    } else {
      parts.push('one-shot bus');
    }
    parts.push(this.audio.ctx.state);
    this.el.readout.textContent = parts.join('  ·  ');
  }
}

export const audioStudio = new AudioStudio();
