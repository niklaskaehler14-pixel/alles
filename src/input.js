// Keyboard, touch and gamepad input merged into one driving state.
import { clamp } from './util.js';

const HOLD_KEYS = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
  KeyH: 'horn',
  KeyB: 'lookBack',
};

const TAP_KEYS = {
  KeyC: 'camera',
  KeyR: 'reset',
  Escape: 'pause',
  KeyP: 'pause',
  KeyE: 'shiftUp',
  KeyQ: 'shiftDown',
  KeyL: 'lights',
  KeyM: 'map',
};

export class Input {
  constructor() {
    this.hold = new Set();
    this.taps = new Set();
    this.touch = { steer: 0, steering: false, gas: false, brake: false, handbrake: false, horn: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, lookBack: false, analogSteer: false };
    this.usingTouch = false;
    this.usingGamepad = false;
    this.prevPad = [];
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const h = HOLD_KEYS[e.code];
      const t = TAP_KEYS[e.code];
      if (h || t || e.code.startsWith('Arrow')) e.preventDefault();
      if (h) this.hold.add(h);
      if (t && !e.repeat) this.taps.add(t);
    });
    window.addEventListener('keyup', (e) => {
      const h = HOLD_KEYS[e.code];
      if (h) this.hold.delete(h);
    });
    window.addEventListener('blur', () => this.hold.clear());
  }

  consume(action) {
    if (this.taps.has(action)) {
      this.taps.delete(action);
      return true;
    }
    return false;
  }

  clearTaps() {
    this.taps.clear();
  }

  // Wire up the on-screen touch controls.
  bindTouch(root) {
    const holdButton = (el, key) => {
      const on = (e) => {
        e.preventDefault();
        this.usingTouch = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        this.touch[key] = true;
        el.classList.add('is-down');
      };
      const off = () => {
        this.touch[key] = false;
        el.classList.remove('is-down');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    };
    root.querySelectorAll('[data-hold]').forEach((el) => holdButton(el, el.dataset.hold));
    root.querySelectorAll('[data-tap]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.usingTouch = true;
        this.taps.add(el.dataset.tap);
      });
    });
    const pad = root.querySelector('[data-steer]');
    if (pad) {
      const knob = pad.querySelector('.steer-knob');
      let active = null;
      const move = (e) => {
        const r = pad.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const v = clamp(dx / (r.width * 0.36), -1, 1);
        this.touch.steer = Math.abs(v) < 0.08 ? 0 : v;
        if (knob) knob.style.transform = `translateX(${(v * r.width * 0.36).toFixed(1)}px)`;
      };
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.usingTouch = true;
        active = e.pointerId;
        try {
          pad.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        this.touch.steering = true;
        move(e);
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId === active) move(e);
      });
      const end = (e) => {
        if (e.pointerId !== active) return;
        active = null;
        this.touch.steering = false;
        this.touch.steer = 0;
        if (knob) knob.style.transform = 'translateX(0px)';
      };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      pad.addEventListener('lostpointercapture', end);
    }
  }

  #pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const btn = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      const axis = p.axes[0] || 0;
      const steer = Math.abs(axis) < 0.12 ? 0 : (axis - Math.sign(axis) * 0.12) / 0.88;
      const pad = { steer, throttle: btn(7), brake: btn(6), handbrake: btn(0) > 0.5 || btn(2) > 0.5 };
      const edges = { 3: 'camera', 9: 'pause', 1: 'reset', 5: 'shiftUp', 4: 'shiftDown', 8: 'map', 12: 'lights' };
      for (const [i, action] of Object.entries(edges)) {
        const now = btn(Number(i)) > 0.5;
        if (now && !this.prevPad[i]) this.taps.add(action);
        this.prevPad[i] = now;
      }
      if (Math.abs(steer) > 0.05 || pad.throttle > 0.05 || pad.brake > 0.05) this.usingGamepad = true;
      return pad;
    }
    return null;
  }

  poll() {
    const s = this.state;
    const k = this.hold;
    const t = this.touch;
    let steer = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
    let throttle = k.has('throttle') || t.gas ? 1 : 0;
    let brake = k.has('brake') || t.brake ? 1 : 0;
    let handbrake = k.has('handbrake') || t.handbrake;
    let analog = false;
    if (t.steering) {
      steer = t.steer;
      analog = true;
    }
    const pad = this.#pollGamepad();
    if (pad) {
      if (Math.abs(pad.steer) > 0.02) {
        steer = pad.steer;
        analog = true;
      }
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      handbrake = handbrake || pad.handbrake;
    }
    if (!this.enabled) {
      steer = 0;
      throttle = 0;
      brake = 0;
      handbrake = false;
    }
    s.steer = steer;
    s.throttle = throttle;
    s.brake = brake;
    s.handbrake = handbrake;
    s.analogSteer = analog;
    s.horn = k.has('horn') || t.horn;
    s.lookBack = k.has('lookBack');
    return s;
  }
}
