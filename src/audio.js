// Fully synthesised sound: six-cylinder engine, turbo, tyres, wind, curbs, crashes and UI beeps.
import { clamp } from './util.js';

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.85;
    this.popQueue = 0;
    this.lastThrottle = 0;
  }

  get ready() {
    return !!this.ctx;
  }

  async init() {
    try {
      if (this.ctx) {
        if (this.ctx.state !== 'running') await this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 14;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.25;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.noiseBuffer = this.#makeNoise(2.5);
      this.#buildEngine();
      this.#buildTires();
      this.#buildAmbience();
      this.#buildTraffic();
      if (ctx.state !== 'running') await ctx.resume();
    } catch (e) {
      console.warn('Audio nicht verfügbar', e);
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  #makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w; // mix in some brown noise for body
      d[i] = w * 0.6 + b * 2.2;
    }
    return buf;
  }

  #noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 2);
    return src;
  }

  #buildEngine() {
    const ctx = this.ctx;
    // Harmonic series of a straight-six firing pulse.
    const n = 24;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    const amps = [0, 1, 0.62, 0.42, 0.55, 0.26, 0.33, 0.16, 0.22, 0.1, 0.14, 0.07, 0.09, 0.05, 0.06, 0.04, 0.05, 0.03, 0.03, 0.02, 0.02, 0.015, 0.01, 0.01];
    for (let i = 1; i < n; i++) {
      real[i] = amps[i] * Math.cos(i * 1.7);
      imag[i] = amps[i] * Math.sin(i * 1.7);
    }
    const wave = ctx.createPeriodicWave(real, imag);

    this.engMain = ctx.createOscillator();
    this.engMain.setPeriodicWave(wave);
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'sawtooth';
    this.engHi = ctx.createOscillator();
    this.engHi.type = 'square';
    const gMain = ctx.createGain();
    gMain.gain.value = 0.55;
    const gSub = ctx.createGain();
    gSub.gain.value = 0.32;
    const gHi = ctx.createGain();
    gHi.gain.value = 0.045;
    this.engSubGain = gSub;

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 1.1;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 140;
    body.gain.value = 5;
    body.Q.value = 0.9;
    this.engAM = ctx.createGain();
    this.engAM.gain.value = 1;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;

    // Low-frequency burble on overrun
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0.05;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.engAM.gain);

    this.engMain.connect(gMain);
    this.engSub.connect(gSub);
    this.engHi.connect(gHi);
    for (const g of [gMain, gSub, gHi]) g.connect(shaper);
    shaper.connect(this.engFilter);
    this.engFilter.connect(body);
    body.connect(this.engAM);
    this.engAM.connect(this.engGain);
    this.engGain.connect(this.master);

    // Intake / induction noise
    const intakeSrc = this.#noiseSource();
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 1.4;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    intakeSrc.connect(this.intakeFilter);
    this.intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.master);

    // Turbo whistle
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain);
    this.turboGain.connect(this.master);

    for (const o of [this.engMain, this.engSub, this.engHi, this.lfo, this.turbo]) o.start();
  }

  #buildTires() {
    const ctx = this.ctx;
    // Squeal: resonant noise + slightly wobbling tone
    const src = this.#noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150;
    bp.Q.value = 7;
    this.squealTone = ctx.createOscillator();
    this.squealTone.type = 'triangle';
    this.squealTone.frequency.value = 720;
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 28;
    vib.connect(vibDepth);
    vibDepth.connect(this.squealTone.frequency);
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.18;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    src.connect(bp);
    bp.connect(this.squealGain);
    this.squealTone.connect(toneGain);
    toneGain.connect(this.squealGain);
    this.squealGain.connect(this.master);
    this.squealTone.start();
    vib.start();

    // Rolling noise (asphalt) and gravel/grass rumble
    const rollSrc = this.#noiseSource();
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 220;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    rollSrc.connect(this.rollFilter);
    this.rollFilter.connect(this.rollGain);
    this.rollGain.connect(this.master);

    const gravelSrc = this.#noiseSource();
    const gf = ctx.createBiquadFilter();
    gf.type = 'bandpass';
    gf.frequency.value = 700;
    gf.Q.value = 0.6;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    this.gravelAM = ctx.createGain();
    const crackle = ctx.createOscillator();
    crackle.type = 'square';
    crackle.frequency.value = 23;
    const crackleDepth = ctx.createGain();
    crackleDepth.gain.value = 0.4;
    crackle.connect(crackleDepth);
    crackleDepth.connect(this.gravelAM.gain);
    gravelSrc.connect(gf);
    gf.connect(this.gravelAM);
    this.gravelAM.connect(this.gravelGain);
    this.gravelGain.connect(this.master);
    crackle.start();

    // Curb rumble strip
    this.curb = ctx.createOscillator();
    this.curb.type = 'square';
    const cf = ctx.createBiquadFilter();
    cf.type = 'lowpass';
    cf.frequency.value = 260;
    this.curbGain = ctx.createGain();
    this.curbGain.gain.value = 0;
    this.curb.connect(cf);
    cf.connect(this.curbGain);
    this.curbGain.connect(this.master);
    this.curb.start();
  }

  #buildAmbience() {
    const ctx = this.ctx;
    const src = this.#noiseSource();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);

    // Horn
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 1800;
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hf);
      o.start();
    }
    hf.connect(this.hornGain);
    this.hornGain.connect(this.master);
  }

  #buildTraffic() {
    const ctx = this.ctx;
    this.trafficOsc = ctx.createOscillator();
    this.trafficOsc.type = 'sawtooth';
    this.trafficOsc2 = ctx.createOscillator();
    this.trafficOsc2.type = 'square';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    this.trafficGain = ctx.createGain();
    this.trafficGain.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    this.trafficOsc.connect(f);
    this.trafficOsc2.connect(g2);
    g2.connect(f);
    this.trafficPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    f.connect(this.trafficGain);
    if (this.trafficPan) {
      this.trafficGain.connect(this.trafficPan);
      this.trafficPan.connect(this.master);
    } else this.trafficGain.connect(this.master);
    this.trafficOsc.start();
    this.trafficOsc2.start();
  }

  // ------------------------------------------------------------------ one-shots
  #burst({ duration = 0.3, gain = 0.5, type = 'lowpass', freq = 1000, q = 0.7, attack = 0.003, when = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + duration + 0.05);
  }

  #tone({ freq = 440, duration = 0.2, gain = 0.3, type = 'sine', endFreq, when = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  crash(strength) {
    const s = clamp(strength / 25, 0.1, 1);
    this.#burst({ duration: 0.25 + s * 0.5, gain: 0.35 + s * 0.6, freq: 700 + s * 900, q: 0.6 });
    this.#burst({ duration: 0.18, gain: 0.2 * s, type: 'highpass', freq: 3000, q: 0.5, when: 0.02 });
    this.#tone({ freq: 90, endFreq: 40, duration: 0.35, gain: 0.5 * s });
  }

  land(strength) {
    const s = clamp(strength / 8, 0.1, 1);
    this.#tone({ freq: 70, endFreq: 35, duration: 0.3, gain: 0.45 * s });
    this.#burst({ duration: 0.2, gain: 0.18 * s, freq: 400 });
  }

  shift() {
    this.#burst({ duration: 0.07, gain: 0.08, type: 'bandpass', freq: 2200, q: 2 });
  }

  blowoff(strength) {
    this.#burst({ duration: 0.45, gain: 0.12 * strength, type: 'highpass', freq: 2400, q: 0.8, attack: 0.02 });
  }

  pops(count) {
    for (let i = 0; i < count; i++) {
      this.#burst({ duration: 0.05 + Math.random() * 0.06, gain: 0.25 + Math.random() * 0.35, freq: 900 + Math.random() * 700, q: 1.2, when: 0.05 + Math.random() * 0.8 });
    }
  }

  beep(high = false) {
    this.#tone({ freq: high ? 1320 : 660, duration: high ? 0.6 : 0.25, gain: 0.28, type: 'square' });
  }

  click() {
    this.#tone({ freq: 1800, duration: 0.04, gain: 0.08, type: 'triangle' });
  }

  chime() {
    this.#tone({ freq: 880, duration: 0.2, gain: 0.2 });
    this.#tone({ freq: 1320, duration: 0.35, gain: 0.2, when: 0.12 });
  }

  // ------------------------------------------------------------------ per-frame update
  update(dt, car, opts = {}) {
    if (!this.ctx || !car) return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.04) => param.setTargetAtTime(v, t, tc);
    const interior = !!opts.interior;
    const rpm = car.rpm;
    const rn = clamp((rpm - 800) / 6600, 0, 1);
    const f = (rpm / 60) * 3;
    const thr = car.throttle;
    const speed = car.speed;

    set(this.engMain.frequency, f * (1 + (Math.random() - 0.5) * 0.004), 0.015);
    set(this.engSub.frequency, f * 0.5, 0.015);
    set(this.engHi.frequency, f * 2.01, 0.015);
    set(this.lfo.frequency, f * 0.25, 0.05);
    const load = 0.35 + 0.65 * thr;
    let g = (0.16 + 0.26 * thr + 0.14 * rn) * (interior ? 1.15 : 1);
    if (car.limiter > 0) g *= 0.35;
    if (car.shiftTimer > 0) g *= 0.55;
    if (opts.paused) g = 0;
    set(this.engGain.gain, g, car.limiter > 0 ? 0.008 : 0.03);
    const cutoff = (380 + rn * 3600 * load) * (interior ? 0.62 : 1);
    set(this.engFilter.frequency, cutoff, 0.03);
    set(this.lfoDepth.gain, thr < 0.1 && rpm > 2200 ? 0.32 : 0.06, 0.08);
    set(this.engSubGain.gain, 0.24 + (1 - thr) * 0.18, 0.1);
    set(this.intakeFilter.frequency, 280 + rpm * 0.3, 0.03);
    set(this.intakeGain.gain, opts.paused ? 0 : thr * (0.03 + rn * 0.1) * (interior ? 0.6 : 1), 0.04);
    set(this.turbo.frequency, 1900 + car.boost * 3200, 0.05);
    set(this.turboGain.gain, opts.paused ? 0 : car.boost * car.boost * 0.022, 0.08);

    // Crackles when lifting off at high rpm
    if (this.lastThrottle > 0.6 && thr < 0.15 && rpm > 4200 && !opts.paused) this.pops(3 + Math.floor(Math.random() * 5));
    this.lastThrottle = thr;

    const onAsphalt = car.surfaceMix < 1.5;
    const skid = car.onGround ? car.skid : 0;
    set(this.squealGain.gain, opts.paused ? 0 : onAsphalt ? Math.pow(skid, 1.4) * 0.3 : 0, 0.05);
    set(this.squealTone.frequency, 650 + skid * 180 + Math.random() * 20, 0.05);
    const sn = clamp(speed / 70, 0, 1);
    set(this.rollGain.gain, opts.paused || !car.onGround ? 0 : sn * (onAsphalt ? 0.1 : 0.05) * (interior ? 1.4 : 1), 0.06);
    set(this.rollFilter.frequency, 140 + sn * 260, 0.1);
    set(this.gravelGain.gain, opts.paused || !car.onGround ? 0 : clamp(car.rumble, 0, 1) * clamp(speed / 25, 0, 1) * 0.3, 0.06);
    const curbOn = opts.onCurb && car.onGround && speed > 4;
    set(this.curb.frequency, clamp(speed / 1.0, 10, 90), 0.05);
    set(this.curbGain.gain, curbOn && !opts.paused ? 0.16 : 0, 0.03);

    set(this.windFilter.frequency, 300 + speed * 12, 0.1);
    set(this.windGain.gain, opts.paused ? 0 : Math.pow(clamp(speed / 85, 0, 1), 2) * (interior ? 0.09 : 0.26), 0.1);
    set(this.hornGain.gain, opts.horn && !opts.paused ? 0.12 : 0, 0.02);

    const tr = opts.traffic;
    if (tr && !opts.paused) {
      const tf = (tr.rpm / 60) * 3;
      set(this.trafficOsc.frequency, tf, 0.05);
      set(this.trafficOsc2.frequency, tf * 0.5, 0.05);
      set(this.trafficGain.gain, clamp(1 - tr.dist / 70, 0, 1) ** 2 * 0.12, 0.08);
      if (this.trafficPan) set(this.trafficPan.pan, clamp(tr.pan, -1, 1), 0.05);
    } else set(this.trafficGain.gain, 0, 0.1);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.engGain, this.intakeGain, this.turboGain, this.squealGain, this.rollGain, this.gravelGain, this.curbGain, this.windGain, this.hornGain, this.trafficGain]) g.gain.setTargetAtTime(0, t, 0.05);
  }
}
