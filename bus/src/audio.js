// Fully synthesised bus sounds (Web Audio): diesel or electric drive, road noise, air
// brakes, doors with warning beeps, indicator relay, stop-request gong, horn, reverse
// beeper, kneeling, curbs, crashes and a little city ambience.
import { clamp } from './util.js';

export class BusAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.lastBlink = false;
    this.reverseTimer = 0;
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
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.noise = this.#noiseBuffer(3);
      this.#engine();
      this.#road();
      this.#ambience();
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

  #noiseBuffer(sec) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.98 * b + 0.02 * w;
      d[i] = w * 0.5 + b * 2;
    }
    return buf;
  }

  #noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(0, Math.random() * 2);
    return s;
  }

  #engine() {
    const ctx = this.ctx;
    // Diesel: rich harmonic series of the firing frequency.
    const n = 20;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const amps = [0, 1, 0.8, 0.55, 0.7, 0.35, 0.45, 0.2, 0.28, 0.12, 0.18, 0.08, 0.1, 0.05, 0.06, 0.04, 0.03, 0.03, 0.02, 0.02];
    for (let i = 1; i < n; i++) {
      re[i] = amps[i] * Math.cos(i * 2.1);
      im[i] = amps[i] * Math.sin(i * 2.1);
    }
    this.eng = ctx.createOscillator();
    this.eng.setPeriodicWave(ctx.createPeriodicWave(re, im));
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'triangle';
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 300;
    this.engFilter.Q.value = 1.2;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.eng.connect(this.engFilter);
    this.engSub.connect(subGain).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    // Diesel clatter: band-passed noise modulated at the firing rate.
    this.clatter = this.#noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    this.clatterGain = ctx.createGain();
    this.clatterGain.gain.value = 0;
    this.clatterMod = ctx.createOscillator();
    this.clatterMod.type = 'square';
    const modGain = ctx.createGain();
    modGain.gain.value = 0.5;
    this.clatterMod.connect(modGain).connect(this.clatterGain.gain);
    this.clatter.connect(bp).connect(this.clatterGain).connect(this.master);
    // Turbo whistle.
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.master);
    // Electric motor whine.
    this.motor = ctx.createOscillator();
    this.motor.type = 'triangle';
    this.motor2 = ctx.createOscillator();
    this.motor2.type = 'sine';
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motor.connect(this.motorGain);
    this.motor2.connect(this.motorGain);
    this.motorGain.connect(this.master);
    for (const o of [this.eng, this.engSub, this.clatterMod, this.turbo, this.motor, this.motor2]) o.start();
  }

  #road() {
    const ctx = this.ctx;
    this.roadSrc = this.#noiseSrc();
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 500;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    this.roadSrc.connect(this.roadFilter).connect(this.roadGain).connect(this.master);
  }

  #ambience() {
    const ctx = this.ctx;
    const src = this.#noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 350;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.05;
    src.connect(f).connect(this.ambGain).connect(this.master);
  }

  // Short noise burst through a filter (air, thumps, crashes).
  #burst(freq, q, dur, gain, type = 'bandpass', attack = 0.005) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 2, dur + 0.1);
  }

  #tone(freq, dur, gain, type = 'sine', when = 0, decay = true) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    if (decay) {
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    } else {
      g.gain.setValueAtTime(gain, t + dur - 0.01);
      g.gain.linearRampToValueAtTime(0, t + dur);
    }
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  airRelease() {
    this.#burst(3200, 0.6, 0.55, 0.22, 'highpass', 0.01);
  }

  doorOpen() {
    this.#burst(2400, 0.7, 0.9, 0.16, 'bandpass', 0.02);
    this.#burst(160, 1, 0.25, 0.25, 'lowpass', 0.005);
  }

  doorClose() {
    // Warning beeps, then the air and the thud of the door seal.
    for (let k = 0; k < 4; k++) this.#tone(2650, 0.12, 0.12, 'square', k * 0.3, false);
    setTimeout(() => {
      this.#burst(2200, 0.7, 0.8, 0.14, 'bandpass', 0.02);
      this.#burst(120, 1, 0.3, 0.3, 'lowpass', 0.004);
    }, 1200);
  }

  kneel() {
    this.#burst(3600, 0.5, 1.8, 0.12, 'highpass', 0.05);
  }

  gong() {
    this.#tone(880, 1.4, 0.2);
    this.#tone(1318, 1.0, 0.08);
    this.#tone(698, 1.6, 0.18, 'sine', 0.35);
  }

  click(on) {
    this.#burst(on ? 2500 : 1800, 2, 0.03, 0.18, 'bandpass', 0.001);
  }

  curb() {
    this.#burst(90, 1, 0.35, 0.45, 'lowpass', 0.003);
    this.#burst(500, 1, 0.2, 0.12, 'bandpass', 0.003);
  }

  crash(strength = 1) {
    this.#burst(160, 0.7, 0.9, 0.7 * strength, 'lowpass', 0.002);
    this.#burst(1600, 0.4, 0.6, 0.35 * strength, 'bandpass', 0.002);
  }

  fault() {
    this.#tone(420, 0.18, 0.12, 'triangle');
    this.#tone(320, 0.26, 0.12, 'triangle', 0.16);
  }

  coin() {
    this.#tone(2400, 0.2, 0.08, 'sine');
    this.#tone(3600, 0.15, 0.05, 'sine', 0.02);
  }

  // Ticket printer: a quick rattle of short bursts.
  printer() {
    for (let k = 0; k < 6; k++) setTimeout(() => this.#burst(2800, 3, 0.04, 0.08, 'bandpass', 0.001), k * 55);
  }

  good() {
    this.#tone(660, 0.15, 0.1);
    this.#tone(990, 0.25, 0.1, 'sine', 0.12);
  }

  starter() {
    this.#burst(140, 2, 1.1, 0.2, 'bandpass', 0.05);
  }

  // Continuous sounds. s: { rpm, load, speed, engine ('diesel'|'electric'), engineOn, horn,
  //   reversing, blinkOn (indicator relay), interior (camera inside) }
  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const inside = s.interior ? 0.75 : 1;
    if (s.engine === 'electric') {
      this.engGain.gain.setTargetAtTime(0, t, 0.1);
      this.clatterGain.gain.setTargetAtTime(0, t, 0.1);
      this.turboGain.gain.setTargetAtTime(0, t, 0.1);
      const f = 90 + s.speed * 38;
      this.motor.frequency.setTargetAtTime(f, t, 0.05);
      this.motor2.frequency.setTargetAtTime(f * 2.02, t, 0.05);
      this.motorGain.gain.setTargetAtTime(s.engineOn ? clamp(0.012 + s.load * 0.04 + s.speed * 0.0015, 0, 0.08) * inside : 0, t, 0.08);
    } else {
      this.motorGain.gain.setTargetAtTime(0, t, 0.1);
      const on = s.engineOn ? 1 : 0;
      const fire = (Math.max(s.rpm, 1) / 60) * 3; // 6 cylinders, 4-stroke
      this.eng.frequency.setTargetAtTime(fire, t, 0.03);
      this.engSub.frequency.setTargetAtTime(fire / 2, t, 0.03);
      this.clatterMod.frequency.setTargetAtTime(fire, t, 0.03);
      this.engFilter.frequency.setTargetAtTime(160 + s.rpm * 0.18 + s.load * 500, t, 0.05);
      this.engGain.gain.setTargetAtTime(on * (0.2 + s.load * 0.22 + (s.rpm / 2300) * 0.12) * inside, t, 0.06);
      this.clatterGain.gain.setTargetAtTime(on * (0.018 + s.load * 0.03) * inside, t, 0.06);
      this.turbo.frequency.setTargetAtTime(1800 + s.rpm * 1.4, t, 0.1);
      this.turboGain.gain.setTargetAtTime(on * s.load * (s.rpm / 2300) * 0.02 * inside, t, 0.15);
    }
    this.roadGain.gain.setTargetAtTime(clamp(s.speed * 0.012, 0, 0.22) * inside, t, 0.1);
    this.roadFilter.frequency.setTargetAtTime(300 + s.speed * 40, t, 0.1);
    // Indicator relay.
    if (s.blinkOn !== this.lastBlink) {
      if (s.blinking) this.click(s.blinkOn);
      this.lastBlink = s.blinkOn;
    }
    // Horn (two-tone).
    if (s.horn && !this.hornNodes) {
      const g = this.ctx.createGain();
      g.gain.value = 0.16;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      const o1 = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      o1.type = o2.type = 'sawtooth';
      o1.frequency.value = 370;
      o2.frequency.value = 466;
      o1.connect(f);
      o2.connect(f);
      f.connect(g).connect(this.master);
      o1.start();
      o2.start();
      this.hornNodes = { g, o1, o2 };
    } else if (!s.horn && this.hornNodes) {
      const h = this.hornNodes;
      h.g.gain.setTargetAtTime(0, t, 0.02);
      h.o1.stop(t + 0.1);
      h.o2.stop(t + 0.1);
      this.hornNodes = null;
    }
    // Reverse beeper.
    if (s.reversing) {
      this.reverseTimer -= dt;
      if (this.reverseTimer <= 0) {
        this.#tone(1150, 0.35, 0.1, 'square', 0, false);
        this.reverseTimer = 0.9;
      }
    } else this.reverseTimer = 0;
  }
}
