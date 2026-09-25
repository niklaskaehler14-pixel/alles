// Rear-wheel-drive sports car: bicycle model with Pacejka-style tyres, load transfer,
// engine torque curve, gearbox, aero drag/downforce and simple vertical dynamics.
// Coordinates: x/z ground plane, y up. Heading `yaw`: forward = (sin yaw, cos yaw).
// Positive yaw rate and positive steering angle turn left.

import { clamp, lerp, approach } from './util.js';

const G = 9.81;

export const CAR_SPEC = {
  mass: 1380,
  inertia: 2300,
  a: 1.22, // CG -> front axle
  b: 1.38, // CG -> rear axle
  cgHeight: 0.46,
  track: 1.62,
  wheelRadius: 0.34,
  cdA: 0.64,
  clA: 1.5,
  rollRes: 0.014,
  gears: [3.3, 2.13, 1.56, 1.24, 1.02, 0.84],
  reverse: 3.2,
  finalDrive: 3.42,
  efficiency: 0.88,
  idleRpm: 900,
  redline: 7400,
  shiftUpRpm: 7050,
  shiftDownRpm: 3100,
  shiftTime: 0.16,
  torque: [
    [800, 190],
    [1500, 270],
    [2500, 360],
    [3500, 430],
    [4500, 470],
    [5500, 468],
    [6500, 445],
    [7200, 405],
    [7600, 320],
  ],
  brakeForce: 24000,
  handbrakeForce: 6200,
  tireB: 9.5,
  tireC: 1.55,
  muFront: 1.0,
  muRear: 1.1,
  steerMax: 0.6,
  assist: 0.5, // counter-steer help
};

// Surface grip and rolling resistance by surface id (see WorldData.surfaceAt).
export const SURFACES = [
  { name: 'asphalt', mu: 1.2, roll: 1, rumble: 0 },
  { name: 'grass', mu: 0.74, roll: 3.4, rumble: 1 },
  { name: 'gravel', mu: 0.85, roll: 2.6, rumble: 0.7 },
  { name: 'sand', mu: 0.6, roll: 6, rumble: 0.8 },
];

function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1];
      const [r1, t1] = curve[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

function tireForce(alpha, peak, B, C) {
  return peak * Math.sin(C * Math.atan(B * alpha));
}

export class Vehicle {
  constructor(spec = CAR_SPEC) {
    this.spec = spec;
    this.wheelOffsets = [
      [spec.a, spec.track / 2], // front left  (forward, left)
      [spec.a, -spec.track / 2], // front right
      [-spec.b, spec.track / 2], // rear left
      [-spec.b, -spec.track / 2], // rear right
    ];
    this.wheelHeights = [0, 0, 0, 0];
    this.wheelSurface = [0, 0, 0, 0];
    this.events = [];
    this.reset(0, 0, 0, 0);
  }

  reset(x, y, z, yaw) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.yawRate = 0;
    this.gear = 1;
    this.rpm = this.spec.idleRpm;
    this.steerInput = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.shiftTimer = 0;
    this.limiter = 0;
    this.onGround = true;
    this.airTime = 0;
    this.groundY = y;
    this.renderY = y;
    this.gradeF = 0;
    this.gradeL = 0;
    this.abs = 0;
    this.axSmooth = 0;
    this.ayLocal = 0;
    this.axLocal = 0;
    this.pitch = 0;
    this.roll = 0;
    this.susPitch = 0;
    this.susPitchVel = 0;
    this.susRoll = 0;
    this.susRollVel = 0;
    this.wheelSpin = 0;
    this.rearSpin = 0;
    this.slipRear = 0;
    this.slipFront = 0;
    this.wheelspin = 0;
    this.lockup = 0;
    this.skid = 0;
    this.driftAngle = 0;
    this.reverseTimer = 0;
    this.boost = 0;
    this.surfaceMix = 0;
    this.rumble = 0;
    this.events.length = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  // Signed forward speed.
  get forwardSpeed() {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  // input: { throttle, brake, steer (-1 left .. +1 right), handbrake, shiftUp, shiftDown, manual, analogSteer }
  // ground(x, z, wheelIndex) -> writes { h, surface } into the provided object
  step(dt, input, ground) {
    const s = this.spec;
    const m = s.mass;
    const L = s.a + s.b;
    const sn = Math.sin(this.yaw);
    const cs = Math.cos(this.yaw);

    // --- ground contact at the four wheels
    let hSum = 0;
    let muF = 0;
    let muR = 0;
    let rollRes = 0;
    let rumble = 0;
    const gs = this._gs || (this._gs = { h: 0, surface: 0 });
    for (let w = 0; w < 4; w++) {
      const [fo, lo] = this.wheelOffsets[w];
      const wx = this.x + sn * fo + cs * lo;
      const wz = this.z + cs * fo - sn * lo;
      ground(wx, wz, w, gs);
      this.wheelHeights[w] = gs.h;
      this.wheelSurface[w] = gs.surface;
      const surf = SURFACES[gs.surface] || SURFACES[1];
      if (w < 2) muF += surf.mu * 0.5;
      else muR += surf.mu * 0.5;
      rollRes += surf.roll * 0.25;
      rumble += surf.rumble * 0.25;
      hSum += gs.h;
    }
    this.rumble = rumble;
    this.surfaceMix = rollRes;
    const groundY = hSum / 4;
    const hF = (this.wheelHeights[0] + this.wheelHeights[1]) / 2;
    const hR = (this.wheelHeights[2] + this.wheelHeights[3]) / 2;
    const hLeft = (this.wheelHeights[0] + this.wheelHeights[2]) / 2;
    const hRight = (this.wheelHeights[1] + this.wheelHeights[3]) / 2;
    const slopeF = (hF - hR) / L; // rise per metre forward
    const slopeL = (hLeft - hRight) / s.track; // rise per metre to the left

    // --- vertical motion: the body is ballistic and pushed up by the ground (one-sided contact).
    // Upward push only follows the ground slope, so kerbs and steps are absorbed (no launches),
    // while crests taken fast still lift the car off.
    const uNow = this.vx * sn + this.vz * cs;
    const vNow = this.vx * cs - this.vz * sn;
    // Low-pass the grade: a kerb or step lasts a few centimetres and must not act like a ramp,
    // a real ramp or crest lasts long enough to pass the filter.
    const kGrade = 1 - Math.exp(-dt / 0.06);
    this.gradeF += (clamp(slopeF, -0.5, 0.5) - this.gradeF) * kGrade;
    this.gradeL += (clamp(slopeL, -0.3, 0.3) - this.gradeL) * kGrade;
    const slopeVel = this.gradeF * uNow + this.gradeL * vNow;
    this.groundY = groundY;
    const wasGround = this.onGround;
    const vyBefore = this.vy;
    this.vy -= G * dt;
    this.y += this.vy * dt;
    if (this.y <= groundY) {
      this.y = groundY;
      this.vy = Math.max(this.vy, slopeVel);
    }
    // Suspension droop keeps the tyres in contact for a few centimetres.
    this.onGround = this.y - groundY < 0.25;
    if (!this.onGround) this.airTime += dt;
    else {
      if (!wasGround) {
        const impact = slopeVel - vyBefore;
        if (impact > 2.5) this.events.push({ type: 'land', strength: impact });
      }
      this.airTime = 0;
    }
    // Smoothed height for rendering hides small steps.
    this.renderY += (this.y - this.renderY) * (1 - Math.exp(-28 * dt));
    if (this.renderY < groundY - 0.12) this.renderY = groundY - 0.12;
    if (this.onGround) {
      this.pitch = Math.atan(slopeF);
      this.roll = Math.atan(slopeL);
    }

    // --- local velocities (forward u, left v)
    let u = this.vx * sn + this.vz * cs;
    let v = this.vx * cs - this.vz * sn;
    let r = this.yawRate;
    const speed = Math.hypot(u, v);

    // --- driver inputs, gear selection and reverse handling
    let throttleIn = clamp(input.throttle || 0, 0, 1);
    let brakeIn = clamp(input.brake || 0, 0, 1);
    const hand = input.handbrake ? 1 : 0;

    if (!input.manual) {
      if (this.gear > 0 && brakeIn > 0.1 && throttleIn < 0.1 && Math.abs(u) < 0.8) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.25) {
          this.gear = -1;
          this.reverseTimer = 0;
        }
      } else if (this.gear < 0 && throttleIn > 0.1 && u > -0.8) {
        this.gear = 1;
      } else {
        this.reverseTimer = 0;
      }
    } else {
      if (input.shiftUp) {
        if (this.gear < 0) this.gear = 1;
        else if (this.gear < s.gears.length) this.gear++;
        this.shiftTimer = s.shiftTime;
        this.events.push({ type: 'shift', up: true });
      }
      if (input.shiftDown) {
        if (this.gear > 1) this.gear--;
        else if (this.gear === 1 && u < 1.5) this.gear = -1;
        this.shiftTimer = s.shiftTime;
        this.events.push({ type: 'shift', up: false });
      }
    }
    // In reverse (automatic) the pedals swap roles.
    if (this.gear < 0 && !input.manual) {
      const t = throttleIn;
      throttleIn = brakeIn;
      brakeIn = t;
    }
    // The brake always wins over the throttle while rolling (like brake override in road cars).
    if (brakeIn > 0.05 && Math.abs(u) > 1) throttleIn = 0;
    this.throttle = approach(this.throttle, throttleIn, dt * 8);
    this.brake = approach(this.brake, brakeIn, dt * (brakeIn > this.brake ? 14 : 10));
    this.handbrake = hand;

    // --- steering: rate-limited for digital input, speed sensitive range
    const steerTarget = clamp(input.steer || 0, -1, 1);
    const fast = Math.abs(this.forwardSpeed);
    const returning = Math.sign(steerTarget) !== Math.sign(this.steerInput) || steerTarget === 0;
    const rate = input.analogSteer ? 14 : returning ? 9 / (1 + fast / 60) : 5.5 / (1 + fast / 45);
    this.steerInput = approach(this.steerInput, steerTarget, rate * dt);
    const beta = u > 4 ? Math.atan2(v, u) : 0;
    // Speed-sensitive lock: roughly the angle that uses the available grip, plus room to counter-steer.
    const uSteer = Math.max(Math.abs(u), 1);
    const maxSteer = clamp((L * 13) / (uSteer * uSteer) + 0.07, 0.06, s.steerMax);
    let delta = -this.steerInput * maxSteer + clamp(beta, -0.5, 0.5) * s.assist;
    delta = clamp(delta, -s.steerMax, s.steerMax);
    this.steerAngle = delta;

    // --- engine and gearbox
    const ratio = this.gear > 0 ? s.gears[this.gear - 1] : this.gear < 0 ? s.reverse : 0;
    const total = ratio * s.finalDrive;
    const wheelRpm = (Math.abs(u) / s.wheelRadius) * total * (60 / (2 * Math.PI));
    // Slipping clutch at launch; in neutral (grid) the engine revs freely.
    const clutch = s.idleRpm + this.throttle * (this.gear === 0 ? 6700 : 2800) * (1 - clamp(wheelRpm / 3600, 0, 1));
    let targetRpm = Math.max(wheelRpm, clutch, s.idleRpm);
    if (this.shiftTimer > 0) targetRpm = lerp(targetRpm, this.rpm, 0.5);
    targetRpm += this.wheelspin * 1800;
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-18 * dt));

    if (!input.manual && this.gear > 0 && this.shiftTimer <= 0 && this.onGround) {
      const gearCount = s.gears.length;
      if (wheelRpm > s.shiftUpRpm && this.gear < gearCount && this.throttle > 0.05) {
        this.gear++;
        this.shiftTimer = s.shiftTime;
        this.events.push({ type: 'shift', up: true });
      } else if (this.gear > 1) {
        const lower = (Math.abs(u) / s.wheelRadius) * s.gears[this.gear - 2] * s.finalDrive * (60 / (2 * Math.PI));
        const threshold = this.brake > 0.2 ? 4300 : s.shiftDownRpm;
        if (wheelRpm < threshold && lower < 6500) {
          this.gear--;
          this.shiftTimer = s.shiftTime * 0.8;
          this.events.push({ type: 'shift', up: false });
        }
      }
    }
    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    let engineTorque;
    if (this.rpm > s.redline) this.limiter = 0.07;
    if (this.limiter > 0) this.limiter -= dt;
    if (this.shiftTimer > 0 || this.limiter > 0) engineTorque = 0;
    else if (this.throttle > 0.02) engineTorque = torqueAt(s.torque, this.rpm) * this.throttle;
    else engineTorque = -(30 + this.rpm * 0.011);
    if (this.gear < 0 && u < -11) engineTorque = Math.min(engineTorque, 0);
    // Turbo boost is cosmetic (sound), follows throttle and rpm.
    const boostTarget = this.throttle > 0.5 && this.rpm > 2800 ? clamp((this.rpm - 2800) / 2500, 0, 1) : 0;
    const prevBoost = this.boost;
    this.boost += (boostTarget - this.boost) * (1 - Math.exp(-(boostTarget > this.boost ? 2.5 : 6) * dt));
    if (prevBoost > 0.55 && this.throttle < 0.2 && this._blowoffReady) {
      this.events.push({ type: 'blowoff', strength: prevBoost });
      this._blowoffReady = false;
    }
    if (this.boost > 0.6) this._blowoffReady = true;

    const dir = this.gear < 0 ? -1 : 1;
    let driveForce = (engineTorque * total * s.efficiency) / s.wheelRadius * dir;
    // Engine braking only acts in the direction of travel.
    if (engineTorque < 0) driveForce = -Math.sign(u) * Math.min(Math.abs(driveForce), Math.abs(u) * m * 2);

    // --- vertical loads with aero and longitudinal transfer
    const down = 0.5 * 1.225 * s.clA * u * u;
    let Wf = (m * G * s.b) / L + down * 0.45 - (m * this.axSmooth * s.cgHeight) / L;
    let Wr = (m * G * s.a) / L + down * 0.55 + (m * this.axSmooth * s.cgHeight) / L;
    Wf = Math.max(Wf, m * G * 0.12);
    Wr = Math.max(Wr, m * G * 0.12);

    muF *= s.muFront;
    muR *= s.muRear;

    if (!this.onGround) {
      // Airborne: only drag acts, rotation damps slowly.
      const drag = 0.5 * 1.225 * s.cdA * speed;
      u -= (drag * u * dt) / m;
      v -= (drag * v * dt) / m;
      r *= 1 - 0.4 * dt;
      this.wheelspin = this.throttle * 0.8;
      this.skid = 0;
    } else {
      // Longitudinal demands per axle
      const sgn = u >= 0 ? 1 : -1;
      const brakeF = this.brake * s.brakeForce;
      const maxF = muF * Wf;
      const maxR = muR * Wr;
      let FxF = -sgn * brakeF * 0.66;
      // Brake-force distribution keeps the rear axle below its limit (stable under braking).
      const rearBrake = Math.min(brakeF * 0.34, maxR * 0.72);
      let FxR = driveForce - sgn * rearBrake - sgn * hand * s.handbrakeForce;
      this.lockup = 0;
      this.abs = 0;
      if (Math.abs(FxF) > maxF * 0.99) {
        FxF = Math.sign(FxF) * maxF * 0.99; // ABS keeps the fronts at the grip limit
        if (Math.abs(u) > 4) this.abs = 1;
      }
      this.wheelspin = 0;
      if (Math.abs(FxR) > maxR) {
        const excess = (Math.abs(FxR) - maxR) / maxR;
        if (driveForce * sgn > 0 && !hand) this.wheelspin = clamp(excess, 0, 1);
        else this.lockup = 1;
        FxR = Math.sign(FxR) * maxR * 0.92;
      }
      if (hand && Math.abs(u) > 1) this.lockup = 1;

      // Lateral tyre forces (forward driving), friction-circle limited
      const uAbs = Math.max(Math.abs(u), 3);
      const alphaF = delta - Math.atan2(v + s.a * r, uAbs);
      const alphaR = -Math.atan2(v - s.b * r, uAbs);
      const circF = Math.sqrt(Math.max(0, 1 - (FxF / maxF) ** 2));
      const rearGrip = (hand ? 0.36 : 1) * (1 - this.wheelspin * 0.55);
      const circR = Math.sqrt(Math.max(0, 1 - (FxR / maxR) ** 2));
      const reversing = u < -0.5;
      const FyF = reversing ? 0 : tireForce(alphaF, maxF, s.tireB, s.tireC) * circF;
      const FyR = reversing ? 0 : tireForce(alphaR, maxR * rearGrip, s.tireB, s.tireC) * Math.max(circR, 0.25);
      this.slipFront = alphaF;
      this.slipRear = alphaR;

      const cosD = Math.cos(delta);
      const sinD = Math.sin(delta);
      const drag = 0.5 * 1.225 * s.cdA * speed;
      const roll = s.rollRes * rollRes * m * G;
      const rollU = Math.abs(u) < 0.3 ? 0 : roll * sgn;

      let ax = (FxR + FxF * cosD - FyF * sinD - drag * u - rollU) / m - G * slopeF + r * v;
      let ay = (FyR + FyF * cosD + FxF * sinD - drag * v) / m - G * slopeL - r * u;
      let rdot = (s.a * (FyF * cosD + FxF * sinD) - s.b * FyR) / s.inertia;

      // Stability control: when the rear axle slides past its grip peak and beyond the front
      // (breakaway oversteer), brake the yaw motion. It holds back after a handbrake pull so
      // deliberate drifts stay possible.
      this.escHold = hand ? 1.6 : Math.max(0, (this.escHold || 0) - dt);
      this.esc = 0;
      const aR = Math.abs(alphaR);
      if (u > 6 && aR > 0.15 && aR > Math.abs(alphaF) + 0.02) {
        const strength = Math.min(5, (aR - 0.15) * 32) * (this.escHold > 0 ? 0.12 : 1);
        rdot -= Math.sign(r) * strength;
        this.esc = strength;
        if (this.escHold <= 0) this.throttle *= 1 - Math.min(0.6, (aR - 0.15) * 3);
      }

      const uPrev = u;
      u += ax * dt;
      v += ay * dt;
      r += rdot * dt;

      // Brakes and rolling resistance never reverse the direction of travel.
      const pushing = Math.abs(driveForce) > 1 && Math.sign(driveForce) === Math.sign(u);
      if (!pushing && uPrev !== 0 && Math.sign(u) !== Math.sign(uPrev)) u = 0;
      if (!pushing && Math.abs(u) < 0.05 && (this.brake > 0.05 || this.throttle < 0.02)) u = 0;

      // Low speed and reversing: blend towards kinematic steering (no sliding while parking).
      const rKin = (u * Math.tan(delta)) / L;
      if (reversing && Math.hypot(u, v) > 4 && (this.gear > 0 || Math.abs(v) > 2.5)) {
        // Spun around at speed: all four tyres slide, the car scrubs off speed.
        const sp = Math.hypot(u, v);
        const decel = ((muF + muR) / 2) * G * 0.8 * dt;
        u -= (u / sp) * Math.min(decel, sp);
        v -= (v / sp) * Math.min(decel, sp);
        r *= 1 - Math.min(1, 2.5 * dt);
      } else if (reversing) {
        r = rKin;
        v = approach(v, 0, 9 * dt);
      } else {
        const k = clamp((Math.hypot(u, v) - 1.5) / 3.5, 0, 1);
        if (k < 1) {
          r = lerp(rKin, r, k);
          v = lerp(approach(v, 0, 12 * dt), v, k);
        }
      }

      this.axLocal = ax - r * v;
      this.ayLocal = ay + r * u;
      this.axSmooth += (this.axLocal - this.axSmooth) * (1 - Math.exp(-8 * dt));

      const rearSlide = Math.abs(v - s.b * r);
      this.skid = clamp((rearSlide - 1.8) / 5, 0, 1) * (u > 3 ? 1 : 0) + this.wheelspin * 0.8 + (this.lockup && Math.abs(u) > 3 ? 0.7 : 0);
      this.skid = clamp(this.skid, 0, 1);
    }

    this.driftAngle = u > 3 ? Math.atan2(v, u) : 0;
    this.yawRate = r;
    this.yaw += r * dt;
    const sn2 = Math.sin(this.yaw);
    const cs2 = Math.cos(this.yaw);
    this.vx = u * sn2 + v * cs2;
    this.vz = u * cs2 - v * sn2;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // --- cosmetic suspension (sprung body pitch/roll) and wheel rotation
    const targetPitch = clamp(-this.axSmooth * 0.0085, -0.07, 0.09);
    const targetRoll = clamp(this.ayLocal * 0.0085, -0.08, 0.08);
    this.susPitchVel += ((targetPitch - this.susPitch) * 140 - this.susPitchVel * 14) * dt;
    this.susPitch += this.susPitchVel * dt;
    this.susRollVel += ((targetRoll - this.susRoll) * 120 - this.susRollVel * 12) * dt;
    this.susRoll += this.susRollVel * dt;
    this.wheelSpin += (u / s.wheelRadius) * dt;
    this.rearSpin += ((u / s.wheelRadius) * (1 + this.wheelspin * 1.5)) * dt;
  }

  // Resolve contact with a static obstacle (normal points away from the obstacle).
  collide(nx, nz, depth, offsetForward, restitution = 0.25) {
    this.x += nx * depth;
    this.z += nz * depth;
    const vn = this.vx * nx + this.vz * nz;
    if (vn >= 0) return 0;
    const j = -(1 + restitution) * vn;
    this.vx += nx * j;
    this.vz += nz * j;
    // Scrub tangential speed a little and add some yaw from off-centre hits.
    const tx = -nz;
    const tz = nx;
    const vt = this.vx * tx + this.vz * tz;
    const scrub = Math.min(Math.abs(vt), j * 0.35) * Math.sign(vt);
    this.vx -= tx * scrub;
    this.vz -= tz * scrub;
    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    const leverX = fwdX * offsetForward;
    const leverZ = fwdZ * offsetForward;
    // Angular impulse around y: r x J (2D cross, sign matches yaw convention).
    const cross = leverZ * nx - leverX * nz;
    this.yawRate += (cross * j * this.spec.mass * 0.25) / this.spec.inertia;
    return -vn;
  }

  drainEvents() {
    if (!this.events.length) return null;
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }
}
