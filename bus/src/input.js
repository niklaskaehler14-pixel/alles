// Keyboard, touch and gamepad merged into one driving state. Pedals on keys ramp up
// smoothly (tap = gentle braking), steering keys self-centre when released.
import { clamp, approach } from './util.js';

const HOLD = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyH: 'horn',
  ShiftLeft: 'hardBrake',
  ShiftRight: 'hardBrake',
};

const TAP = {
  Space: 'doors',
  Digit1: 'door1',
  Digit2: 'door2',
  Digit3: 'door3',
  KeyQ: 'indicatorLeft',
  KeyE: 'indicatorRight',
  KeyX: 'hazard',
  KeyK: 'kneel',
  KeyP: 'parkingBrake',
  KeyR: 'reverse',
  KeyN: 'neutral',
  KeyO: 'autopilot',
  KeyI: 'engine',
  KeyL: 'lights',
  KeyC: 'camera',
  KeyM: 'map',
  KeyV: 'mirrors',
  KeyF: 'lookRight',
  Escape: 'pause',
  Enter: 'confirm',
};

export class Input {
  constructor() {
    this.hold = new Set();
    this.taps = [];
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.touch = { steer: null, gas: 0, brake: 0, horn: false };
    this.usingTouch = false;
    this.usingPad = false;
    this.prevButtons = [];
    this.look = { dx: 0, dy: 0 };
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const h = HOLD[e.code];
      const t = TAP[e.code];
      if (h || t) e.preventDefault();
      if (h) this.hold.add(h);
      if (t && !e.repeat) this.taps.push(t);
    });
    window.addEventListener('keyup', (e) => {
      const h = HOLD[e.code];
      if (h) this.hold.delete(h);
    });
    window.addEventListener('blur', () => this.hold.clear());
  }

  consume() {
    const t = this.taps;
    this.taps = [];
    return t;
  }

  tap(action) {
    this.taps.push(action);
  }

  // Mouse drag / touch drag on the view to look around in the cockpit.
  bindLook(el) {
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target !== el) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      this.look.dx += e.clientX - drag.x;
      this.look.dy += e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = () => {
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => this.taps.push('lookReset'));
    el.addEventListener('wheel', (e) => {
      this.look.zoom = (this.look.zoom || 0) + Math.sign(e.deltaY);
    }, { passive: true });
  }

  // On-screen controls: steering wheel, analogue pedals and buttons.
  bindTouch(root) {
    const wheel = root.querySelector('[data-wheel]');
    const knob = root.querySelector('[data-wheel-img]');
    let wheelDrag = null;
    let wheelAngle = 0;
    const angleOf = (e) => {
      const r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    wheel.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.usingTouch = true;
      wheelDrag = { id: e.pointerId, a: angleOf(e) };
      try {
        wheel.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    wheel.addEventListener('pointermove', (e) => {
      if (!wheelDrag || e.pointerId !== wheelDrag.id) return;
      const a = angleOf(e);
      let d = a - wheelDrag.a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      wheelDrag.a = a;
      wheelAngle = clamp(wheelAngle + d, -Math.PI * 1.5, Math.PI * 1.5);
      this.touch.steer = -wheelAngle / (Math.PI * 1.5);
    });
    const release = () => {
      wheelDrag = null;
      this.touch.steer = null; // self-centring via the normal steering logic
    };
    wheel.addEventListener('pointerup', release);
    wheel.addEventListener('pointercancel', release);
    this.wheelVisual = (steer) => {
      if (!wheelDrag) wheelAngle = -steer * Math.PI * 1.5;
      if (knob) knob.style.transform = `rotate(${wheelAngle}rad)`;
    };
    // Analogue pedals: finger height = pedal travel.
    for (const el of root.querySelectorAll('[data-pedal]')) {
      const key = el.dataset.pedal;
      const fill = el.querySelector('i');
      let id = null;
      const setFrom = (e) => {
        const r = el.getBoundingClientRect();
        const v = clamp((r.bottom - e.clientY) / r.height, 0, 1);
        this.touch[key] = 0.18 + v * 0.82;
        if (fill) fill.style.height = `${this.touch[key] * 100}%`;
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.usingTouch = true;
        id = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        setFrom(e);
        el.classList.add('is-down');
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId === id) setFrom(e);
      });
      const up = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        this.touch[key] = 0;
        if (fill) fill.style.height = '0%';
        el.classList.remove('is-down');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }
    for (const el of root.querySelectorAll('[data-tap]')) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.usingTouch = true;
        this.taps.push(el.dataset.tap);
      });
    }
    for (const el of root.querySelectorAll('[data-hold]')) {
      const k = el.dataset.hold;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.touch[k] = true;
      });
      const up = () => {
        this.touch[k] = false;
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    }
  }

  #pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const btn = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      const pressed = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const edge = (i, action) => {
        if (pressed(i) && !this.prevButtons[i]) this.taps.push(action);
        this.prevButtons[i] = pressed(i);
      };
      edge(0, 'doors');
      edge(1, 'kneel');
      edge(2, 'engine');
      edge(3, 'camera');
      edge(4, 'indicatorLeft');
      edge(5, 'indicatorRight');
      edge(9, 'pause');
      edge(8, 'map');
      edge(12, 'lights');
      edge(13, 'hazard');
      edge(14, 'reverse');
      edge(15, 'parkingBrake');
      const ax = Math.abs(p.axes[0]) > 0.08 ? p.axes[0] : 0;
      const rt = btn(7);
      const lt = btn(6);
      if (ax || rt > 0.02 || lt > 0.02) this.usingPad = true;
      return { steer: -ax, throttle: rt, brake: lt, horn: pressed(10) || pressed(11) };
    }
    return null;
  }

  // Merged driving input for this frame. speed in m/s (steering is slower at speed).
  update(dt, speed = 0) {
    const pad = this.#pad();
    const h = this.hold;
    // Pedals: keys ramp, touch/pad are analogue.
    const wantThrottle = h.has('throttle') ? 1 : 0;
    const wantBrake = h.has('brake') ? 1 : 0;
    this.throttle = wantThrottle ? approach(this.throttle, 1, 0.95 * dt) : approach(this.throttle, 0, 3.5 * dt);
    if (wantBrake) {
      if (this.brake < 0.12) this.brake = 0.12;
      this.brake = approach(this.brake, 1, (h.has('hardBrake') ? 4 : 0.75) * dt);
    } else this.brake = approach(this.brake, 0, 4 * dt);
    let throttle = this.throttle;
    let brake = this.brake;
    if (this.touch.gas) throttle = Math.max(throttle, this.touch.gas);
    if (this.touch.brake) brake = Math.max(brake, this.touch.brake);
    if (pad) {
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
    }
    // Steering.
    const dir = (h.has('left') ? 1 : 0) - (h.has('right') ? 1 : 0);
    if (pad && pad.steer) {
      this.steer = pad.steer;
    } else if (this.touch.steer !== null) {
      this.steer = this.touch.steer;
    } else if (dir) {
      const rate = speed < 3 ? 1.25 : speed < 8 ? 0.95 : 0.6;
      // Faster when turning back towards the centre.
      const back = Math.sign(this.steer) !== dir && this.steer !== 0 ? 1.8 : 1;
      this.steer = clamp(this.steer + dir * rate * back * dt, -1, 1);
    } else {
      // Self-centring when moving, slowly at standstill.
      const rate = speed > 1 ? 0.9 + Math.min(speed, 10) * 0.08 : 0.25;
      this.steer = approach(this.steer, 0, rate * dt);
    }
    if (this.wheelVisual) this.wheelVisual(this.steer);
    const horn = h.has('horn') || this.touch.horn || (pad && pad.horn);
    return { throttle: clamp(throttle, 0, 1), brake: clamp(brake, 0, 1), steer: this.steer, horn: !!horn };
  }
}
