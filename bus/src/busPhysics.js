// City bus dynamics: single-track model that blends into pure rolling kinematics at low speed
// (so rear-wheel offtracking and tail swing come out right when turning), diesel engine with
// torque-converter automatic or electric drive, air brakes with lag, retarder, stop brake,
// parking brake, kneeling, doors and an optional articulated rear section (kinematic trailer).
// Coordinates: x/z ground plane, forward = (sin yaw, cos yaw), left = (cos yaw, -sin yaw).

import { clamp, lerp, smoothstep, wrapAngle, approach } from './util.js';
import { busGeometry } from './busTypes.js';

const G = 9.81;
const GEARS = [3.36, 1.91, 1.42, 1.0, 0.72, 0.62];
const REVERSE = 4.0;
const FINAL = 5.74;
const EFF = 0.88;
export const IDLE_RPM = 600;
export const MAX_RPM = 2300;
export const GOVERNOR = 80 / 3.6;
const REVERSE_LIMIT = 8 / 3.6;
const KNEEL_LIMIT = 5 / 3.6;
const PASSENGER_MASS = 75;
const MAX_DECEL = 6.8; // full service brake (m/s²)
const STOP_BRAKE = 2.2; // stop brake holding decel (m/s²)
const PARK_BRAKE = 4.5;

// Full-load torque curve of a 6-cylinder city-bus diesel, normalised to peak torque.
const TORQUE_CURVE = [
  [400, 0.35],
  [600, 0.62],
  [900, 0.9],
  [1100, 1],
  [1400, 1],
  [1800, 0.87],
  [2100, 0.7],
  [2300, 0.4],
  [2500, 0],
];

function torqueFactor(rpm) {
  const c = TORQUE_CURVE;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const [r0, t0] = c[i - 1];
      const [r1, t1] = c[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return 0;
}

// Torque converter multiplication over speed ratio (turbine / pump).
const converter = (sr) => (sr >= 0.85 ? 1 : 1.9 - (0.9 * sr) / 0.85);

export class Bus {
  constructor(spec) {
    this.spec = spec;
    this.geo = busGeometry(spec);
    this.L = spec.wheelbase;
    this.b = spec.cgFromRear;
    this.a = this.L - this.b;
    this.articulated = !!spec.joint;
    this.events = [];
    this.doors = spec.doors.map((d, i) => ({ index: i, ...d, open: 0, target: 0, obstructed: false, reversing: 0 }));
    this.passengers = 0;
    this.wheelHeights = new Float64Array(6);
    this.wheelOnCurb = new Uint8Array(6);
    this.wheelPos = new Float64Array(12);
    this.reset(0, 0, 0);
  }

  get mass() {
    return this.spec.mass + (this.spec.trailerMass || 0) + this.passengers * PASSENGER_MASS;
  }

  get speed() {
    return this.u;
  }

  get kmh() {
    return Math.abs(this.u) * 3.6;
  }

  // Place the bus so its front bumper is at (fx, fz), heading yaw.
  resetAtFront(fx, fz, yaw) {
    const d = this.geo.front - this.b;
    this.reset(fx - Math.sin(yaw) * d, fz - Math.cos(yaw) * d, yaw);
  }

  reset(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.yaw2 = yaw; // rear section of an articulated bus
    this.u = 0;
    this.v = 0;
    this.r = 0;
    this.steer = 0;
    this.steerTarget = 0;
    this.gear = 0;
    this.selector = 'D';
    this.engineOn = true;
    this.starter = 0;
    this.rpm = IDLE_RPM;
    this.shiftTimer = 0;
    this.throttle = 0;
    this.brakeInput = 0;
    this.brakePressure = 0;
    this.stopBrake = false;
    this.parkingBrake = false;
    this.retarder = 0;
    this.regen = 0;
    this.kneel = 0;
    this.kneelTarget = 0;
    this.aLong = 0;
    this.aLat = 0;
    this.jerk = 0;
    this.pitch = 0;
    this.pitchV = 0;
    this.roll = 0;
    this.rollV = 0;
    this.heave = 0;
    this.wheelSpin = 0;
    this.distance = 0;
    this.drive = 0;
    this.brakeForce = 0;
    this.hold = '';
    this.wheelOnCurb.fill(0);
    for (const d of this.doors || []) {
      d.open = 0;
      d.target = 0;
    }
    this.#updateWheels(null);
  }

  // ------------------------------------------------------------ commands

  setDoor(i, open) {
    const d = this.doors[i];
    if (!d) return false;
    if (open && Math.abs(this.u) > 0.4) {
      this.events.push({ type: 'refused', reason: 'doorsMoving' });
      return false;
    }
    if (d.target === (open ? 1 : 0)) return true;
    d.target = open ? 1 : 0;
    this.events.push({ type: open ? 'doorOpen' : 'doorClose', door: i });
    return true;
  }

  toggleDoor(i) {
    const d = this.doors[i];
    return d ? this.setDoor(i, d.target < 0.5) : false;
  }

  // All doors: open if any is closed, otherwise close.
  toggleAllDoors() {
    const anyClosed = this.doors.some((d) => d.target < 0.5);
    let ok = true;
    for (let i = 0; i < this.doors.length; i++) ok = this.setDoor(i, anyClosed) && ok;
    return ok;
  }

  get doorsOpen() {
    return this.doors.some((d) => d.open > 0.02 || d.target > 0.5);
  }

  get doorsFullyClosed() {
    return this.doors.every((d) => d.open <= 0.001 && d.target === 0);
  }

  setKneel(on) {
    if (on && Math.abs(this.u) > 0.3) {
      this.events.push({ type: 'refused', reason: 'kneelMoving' });
      return false;
    }
    if (this.kneelTarget !== (on ? 1 : 0)) this.events.push({ type: on ? 'kneelDown' : 'kneelUp' });
    this.kneelTarget = on ? 1 : 0;
    return true;
  }

  setSelector(sel) {
    if (sel === this.selector) return true;
    if (Math.abs(this.u) > 0.5 && sel !== 'N') {
      this.events.push({ type: 'refused', reason: 'selectorMoving' });
      return false;
    }
    this.selector = sel;
    this.gear = 0;
    this.events.push({ type: 'selector', value: sel });
    return true;
  }

  setParkingBrake(on) {
    if (this.parkingBrake === on) return;
    this.parkingBrake = on;
    this.events.push({ type: on ? 'parkOn' : 'parkOff' });
  }

  setEngine(on) {
    if (on === this.engineOn) return;
    if (on) {
      this.starter = 1.1;
    } else {
      this.engineOn = false;
      this.events.push({ type: 'engineOff' });
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------ geometry

  forward() {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }

  // Point in bus-local coordinates (lateral l to the left, longitudinal f from the rear axle).
  localToWorld(l, f, out = [0, 0]) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const df = f - this.b;
    out[0] = this.x + s * df + c * l;
    out[1] = this.z + c * df - s * l;
    return out;
  }

  // Rear-section point: f measured from the joint (negative = towards the rear).
  trailerToWorld(l, f, out = [0, 0]) {
    const j = this.jointPos();
    const s = Math.sin(this.yaw2);
    const c = Math.cos(this.yaw2);
    out[0] = j[0] + s * f + c * l;
    out[1] = j[1] + c * f - s * l;
    return out;
  }

  jointPos(out = [0, 0]) {
    return this.localToWorld(0, -this.spec.joint || 0, out);
  }

  get articulation() {
    return this.articulated ? wrapAngle(this.yaw - this.yaw2) : 0;
  }

  // Oriented boxes of the body (front section, then rear section).
  boxes() {
    const g = this.geo;
    const c = this.localToWorld(0, g.center);
    const out = [{ x: c[0], z: c[1], yaw: this.yaw, hl: g.halfLength, hw: g.halfWidth, part: 0 }];
    if (this.articulated) {
      const mid = (g.trailerFront + g.trailerRear) / 2;
      const p = this.trailerToWorld(0, mid);
      out.push({ x: p[0], z: p[1], yaw: this.yaw2, hl: (g.trailerFront - g.trailerRear) / 2, hw: g.halfWidth, part: 1 });
    }
    return out;
  }

  frontPos(out = [0, 0]) {
    return this.localToWorld(0, this.geo.front, out);
  }

  // World position of a door centre on the right-hand side (door side), at the curb line.
  doorPos(i, out = [0, 0]) {
    const d = this.doors[i];
    const l = -this.spec.width / 2;
    return d.trailer ? this.trailerToWorld(l, d.z, out) : this.localToWorld(l, d.z, out);
  }

  // ------------------------------------------------------------ simulation

  // input: { throttle, brake (0..1), steer (-1..1, + = left) }
  // env: { ground(x, z) -> 0 (road) | 1 (curb/sidewalk) | 2 (grass), wet }
  step(dt, input, env) {
    const spec = this.spec;
    const m = this.mass;
    this.hold = '';

    // ---- steering (hydraulic power steering, rate limited)
    this.steerTarget = clamp(input.steer || 0, -1, 1) * spec.steerMax;
    this.steer = approach(this.steer, this.steerTarget, 0.62 * dt);

    // ---- doors
    for (const d of this.doors) {
      if (d.reversing > 0) {
        d.reversing -= dt;
        d.target = 1;
      }
      const rate = d.target > d.open ? 1 / 2.2 : 1 / 2.6;
      if (d.target < d.open && d.obstructed && d.open < 0.9) {
        // Sensitive edges: the door reopens when it closes on somebody.
        d.target = 1;
        d.reversing = 1.2;
        this.events.push({ type: 'doorReverse', door: d.index });
      }
      const before = d.open;
      d.open = approach(d.open, d.target, rate * dt);
      if (before > 0 && d.open === 0) this.events.push({ type: 'doorShut', door: d.index });
    }
    const doorsOpen = this.doors.some((d) => d.open > 0.001 || d.target > 0);

    // ---- stop brake: engages with open doors, releases when the doors are shut
    if (doorsOpen && Math.abs(this.u) < 1.5 && !this.stopBrake) {
      this.stopBrake = true;
      this.events.push({ type: 'stopBrakeOn' });
    }
    if (this.stopBrake && !doorsOpen && (input.throttle || 0) > 0.05) {
      this.stopBrake = false;
      this.events.push({ type: 'stopBrakeOff' });
    }

    // ---- kneeling
    if (this.kneelTarget > 0 && Math.abs(this.u) > 0.6) this.kneelTarget = 0;
    if (this.kneelTarget > 0 && (input.throttle || 0) > 0.2 && !doorsOpen) {
      this.kneelTarget = 0;
      this.events.push({ type: 'kneelUp' });
    }
    this.kneel = approach(this.kneel, this.kneelTarget, (this.kneelTarget > this.kneel ? 1 / 2.2 : 1 / 3) * dt);

    // ---- engine start
    if (this.starter > 0) {
      this.starter -= dt;
      this.rpm = 180 + Math.random() * 60;
      if (this.starter <= 0) {
        this.engineOn = true;
        this.rpm = IDLE_RPM * 1.35;
        this.events.push({ type: 'engineStart' });
      }
    }

    // ---- pedals
    let throttle = clamp(input.throttle || 0, 0, 1);
    const brakeIn = clamp(input.brake || 0, 0, 1);
    this.brakeInput = brakeIn;
    if (brakeIn > 0.05) throttle = 0; // brake has priority
    if (this.stopBrake || this.parkingBrake) {
      if (throttle > 0.2) this.hold = this.parkingBrake ? 'parkingBrake' : 'stopBrake';
    }
    this.throttle = throttle;
    // Pneumatic brake pressure follows the pedal with a short lag.
    const tau = brakeIn > this.brakePressure ? 0.2 : 0.12;
    this.brakePressure += (brakeIn - this.brakePressure) * (1 - Math.exp(-dt / tau));

    // ---- powertrain
    const absU = Math.abs(this.u);
    let drive = 0;
    const powerOn = this.engineOn && this.starter <= 0;
    const wheelRpm = (absU / spec.wheelRadius) * (60 / (2 * Math.PI));
    if (spec.engine === 'electric') {
      this.rpm = powerOn ? wheelRpm * 11.2 : 0;
      if (powerOn && this.selector !== 'N') {
        drive = throttle * Math.min(spec.driveForceCap, (spec.power * 0.93) / Math.max(absU, 2.5));
      }
    } else if (!powerOn) {
      this.rpm = Math.max(0, this.rpm - 900 * dt);
    } else if (this.selector === 'N' || this.parkingBrake) {
      const target = IDLE_RPM + throttle * 1500;
      this.rpm = approach(this.rpm, target, (target > this.rpm ? 2600 : 1400) * dt);
    } else {
      const reverse = this.selector === 'R';
      if (reverse) this.gear = 0;
      const ratio = (reverse ? REVERSE : GEARS[this.gear]) * FINAL;
      const turbine = wheelRpm * ratio;
      const lockup = !reverse && this.gear >= 1 && turbine > 1000 && this.shiftTimer <= 0;
      let target;
      if (lockup) target = Math.max(turbine, IDLE_RPM * 0.95);
      else target = Math.max(turbine, IDLE_RPM + throttle * 1150);
      this.rpm = approach(this.rpm, target, (target > this.rpm ? 3000 : 2200) * dt);
      const sr = clamp(turbine / Math.max(this.rpm, 1), 0, 1);
      const tr = lockup ? 1 : converter(sr);
      let te = throttle * spec.torque * torqueFactor(this.rpm);
      if (!lockup) te += spec.torque * 0.07 * (1 - sr); // idle creep through the converter
      if (lockup && throttle < 0.05) te -= spec.torque * 0.06; // engine drag
      drive = (te * tr * ratio * EFF) / spec.wheelRadius;
      drive = Math.min(drive, spec.driveForceCap, (spec.power * EFF) / Math.max(absU, 1.5));
      if (reverse) drive = -drive;
      // Automatic shifting.
      if (this.shiftTimer > 0) {
        this.shiftTimer -= dt;
        drive *= 0.45;
      } else if (!reverse) {
        const up = 1250 + 700 * throttle;
        const down = 760 + 330 * throttle;
        if (this.gear < GEARS.length - 1 && turbine > up && this.u > 0) {
          this.gear++;
          this.shiftTimer = 0.45;
          this.events.push({ type: 'shift', gear: this.gear, up: true });
        } else if (this.gear > 0 && turbine < down) {
          this.gear--;
          this.shiftTimer = 0.35;
          this.events.push({ type: 'shift', gear: this.gear, up: false });
        }
      }
    }
    // Speed governor, reverse and kneeling limits.
    if (this.u > GOVERNOR && drive > 0) drive *= clamp(1 - (this.u - GOVERNOR) * 2, 0, 1);
    if (this.selector === 'R' && this.u < -REVERSE_LIMIT) drive = Math.max(0, drive);
    if (this.selector === 'D' && this.u < -0.3) drive = Math.max(drive, 0);
    if (this.kneel > 0.05 && absU > KNEEL_LIMIT) drive = 0;
    if (this.stopBrake || this.parkingBrake) drive = this.parkingBrake ? drive * 0.25 : 0;
    this.drive = drive;

    // ---- resistances and brakes (always oppose motion, never reverse it)
    const mu = env && env.wet ? 0.68 : 0.88;
    let surfaceRoll = 0.008;
    let onGrass = 0;
    for (let k = 0; k < 4; k++) if (this.wheelOnCurb[k] === 2) onGrass++;
    surfaceRoll += onGrass * 0.02;
    let resist = surfaceRoll * m * G;
    let brakeDecel = this.brakePressure * MAX_DECEL;
    this.regen = 0;
    if (spec.engine === 'electric' && powerOn && absU > 0.5) {
      // Recuperation: part of the pedal braking plus a little when coasting.
      const coast = throttle < 0.02 ? 0.35 : 0;
      this.regen = Math.min(brakeDecel + coast, 2.2) * smoothstep(0.5, 3, absU);
      brakeDecel = Math.max(brakeDecel, coast);
    }
    this.retarder = spec.engine !== 'electric' && this.brakePressure > 0.04 && absU > 3 ? clamp(this.brakePressure * 3, 0, 1) : 0;
    if (this.stopBrake) brakeDecel = Math.max(brakeDecel, STOP_BRAKE);
    if (this.parkingBrake) brakeDecel = Math.max(brakeDecel, PARK_BRAKE);
    brakeDecel = Math.min(brakeDecel, mu * G);
    resist += brakeDecel * m + 0.5 * 1.2 * 5.2 * this.u * this.u;
    this.brakeForce = brakeDecel * m;

    const prevU = this.u;
    if (Math.abs(this.u) > 0.05) {
      const sgn = Math.sign(this.u);
      let nu = this.u + ((drive - sgn * resist) / m) * dt;
      if (Math.sign(nu) !== sgn && Math.abs(drive) < resist) nu = 0;
      this.u = nu;
    } else if (Math.abs(drive) > resist) {
      this.u += ((drive - Math.sign(drive) * resist) / m) * dt;
    } else {
      this.u = 0;
    }

    // ---- lateral / yaw
    const L = this.L;
    const a = this.a;
    const b = this.b;
    const delta = this.steer;
    const rK = (this.u * Math.tan(delta)) / L;
    const vK = b * rK;
    const w = smoothstep(3, 6.5, Math.abs(this.u));
    if (w > 0) {
      const u = Math.max(this.u, 0.5);
      const Fzf = (m * G * b) / L;
      const Fzr = (m * G * a) / L;
      const Cf = 6.2 * Fzf;
      const Cr = 7.5 * Fzr;
      const Iz = (m * (spec.length * spec.length + spec.width * spec.width)) / 14;
      const af = Math.atan2(this.v + a * this.r, u) - delta;
      const ar = Math.atan2(this.v - b * this.r, u);
      const Fyf = clamp(-Cf * af, -mu * Fzf, mu * Fzf);
      const Fyr = clamp(-Cr * ar, -mu * Fzr, mu * Fzr);
      const dv = (Fyr + Fyf * Math.cos(delta)) / m - u * this.r;
      const dr = (a * Fyf * Math.cos(delta) - b * Fyr) / Iz;
      const vD = this.v + dv * dt;
      const rD = this.r + dr * dt;
      this.v = lerp(vK, vD, w);
      this.r = lerp(rK, rD, w);
    } else {
      this.v = vK;
      this.r = rK;
    }

    // ---- integrate pose
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const vxw = s * this.u + c * this.v;
    const vzw = c * this.u - s * this.v;
    this.x += vxw * dt;
    this.z += vzw * dt;
    this.yaw = wrapAngle(this.yaw + this.r * dt);
    this.distance += Math.abs(this.u) * dt;
    this.wheelSpin += (this.u / spec.wheelRadius) * dt;

    // ---- rear section (kinematic trailer: its axle cannot slide sideways)
    if (this.articulated) {
      const j = this.jointPos();
      const rx = j[0] - this.x;
      const rz = j[1] - this.z;
      const vjx = vxw + this.r * rz;
      const vjz = vzw - this.r * rx;
      const l2x = Math.cos(this.yaw2);
      const l2z = -Math.sin(this.yaw2);
      this.yaw2 = wrapAngle(this.yaw2 + ((vjx * l2x + vjz * l2z) / spec.trailerAxle) * dt);
      const phi = wrapAngle(this.yaw - this.yaw2);
      const lim = 1.0;
      if (Math.abs(phi) > lim) {
        this.yaw2 = wrapAngle(this.yaw - Math.sign(phi) * lim);
        if (this.u < 0) {
          this.u = 0; // anti-jackknife protection stops the bus when reversing
          this.hold = 'jackknife';
        }
      }
    }

    // ---- comfort measurements
    const aLong = (this.u - prevU) / dt;
    const aLatNow = this.u * this.r;
    const prevA = this.aLong;
    this.aLong += (aLong - this.aLong) * (1 - Math.exp(-dt / 0.15));
    this.aLat += (aLatNow - this.aLat) * (1 - Math.exp(-dt / 0.15));
    this.jerk = (this.aLong - prevA) / dt;

    // ---- wheels on curbs and body motion (visual)
    this.#updateWheels(env);
    const kneelDrop = this.kneel * 0.075;
    const hf = (this.wheelHeights[0] + this.wheelHeights[1]) / 2;
    const hr = (this.wheelHeights[2] + this.wheelHeights[3]) / 2;
    const hl = (this.wheelHeights[0] + this.wheelHeights[2]) / 2;
    const hri = (this.wheelHeights[1] + this.wheelHeights[3]) / 2;
    const pitchT = clamp(this.aLong * 0.0065, -0.035, 0.02) + Math.atan2(hf - hr, L);
    const rollT = clamp(this.aLat * 0.011, -0.05, 0.05) + kneelDrop / spec.width + Math.atan2(hl - hri, spec.trackFront);
    const k = 55;
    const cdamp = 7;
    this.pitchV += ((pitchT - this.pitch) * k - this.pitchV * cdamp) * dt;
    this.pitch += this.pitchV * dt;
    this.rollV += ((rollT - this.roll) * k - this.rollV * cdamp) * dt;
    this.roll += this.rollV * dt;
    this.heave += ((hf + hr) / 2 - kneelDrop * 0.5 - this.heave) * (1 - Math.exp(-dt / 0.12));
  }

  // Wheel contact points: 0 FL, 1 FR, 2 RL, 3 RR, 4 trailer L, 5 trailer R.
  #updateWheels(env) {
    const spec = this.spec;
    const tf = spec.trackFront / 2;
    const tr = 1.22; // outer dual tyre
    const pts = [
      [tf, this.L],
      [-tf, this.L],
      [tr, 0],
      [-tr, 0],
    ];
    const tmp = [0, 0];
    const n = this.articulated ? 6 : 4;
    for (let k = 0; k < n; k++) {
      if (k < 4) this.localToWorld(pts[k][0], pts[k][1], tmp);
      else this.trailerToWorld(k === 4 ? tr : -tr, -spec.trailerAxle, tmp);
      this.wheelPos[k * 2] = tmp[0];
      this.wheelPos[k * 2 + 1] = tmp[1];
      const surf = env ? env.ground(tmp[0], tmp[1]) : 0;
      if (env && surf && !this.wheelOnCurb[k] && Math.abs(this.u) > 0.3) {
        this.events.push({ type: 'curb', wheel: k, speed: Math.abs(this.u), x: tmp[0], z: tmp[1] });
      }
      this.wheelOnCurb[k] = surf;
      const h = surf ? 0.15 : 0;
      this.wheelHeights[k] += (h - this.wheelHeights[k]) * (env ? 0.35 : 1);
    }
  }
}

export { GEARS, FINAL };
