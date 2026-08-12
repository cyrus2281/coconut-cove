// Procedural ocean ambience with Web Audio: two surf layers of filtered noise
// swelling on offset periods, plus a soft steady wind bed. No audio files.

export class OceanAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.layers = [];
    this.muted = false;
    this.volume = 0.4;
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
    this.master.connect(ctx.destination);

    const mkLayer = (freq, q, period, phase, gainMax, pow) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filter).connect(g).connect(this.master);
      src.start();
      this.layers.push({ filter, g, period, phase, gainMax, baseFreq: freq, pow });
    };

    // two surf swells matched to the surge-zone periods (13s / 17s), phased
    // so the audio crash lands roughly when the bore rushes the beach
    mkLayer(650, 0.6, 13.0, 0.44, 0.75, 2.6);
    mkLayer(950, 0.7, 17.0, -1.96, 0.55, 3.0);
    mkLayer(320, 0.4, 31, 7, 0.16, 1); // wind: long slow wander

    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, ctx.currentTime, 1.2);
  }

  update(t) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const l of this.layers) {
      const s = 0.5 + 0.5 * Math.sin((t / l.period) * Math.PI * 2 + l.phase);
      const swell = Math.pow(s, l.pow);
      l.g.gain.setTargetAtTime(0.06 + swell * l.gainMax, now, 0.25);
      // surf brightens as it crashes
      l.filter.frequency.setTargetAtTime(l.baseFreq * (0.6 + swell * 1.5), now, 0.3);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.4);
    }
  }
}
