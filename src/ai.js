// Computer drivers: pure-pursuit steering along the track, curvature-based speed planning,
// overtaking lanes and light rubber-banding. Kinematic model (stable and cheap).
import { ROAD } from './config.js';
import { CAR_SPEC } from './vehicle.js';
import { clamp, lerp, wrapAngle } from './util.js';

const G = 9.81;
const L = CAR_SPEC.a + CAR_SPEC.b;

export class AIDriver {
  constructor(track, world, { name = 'KI', skill = 0.92, color = '#ffffff', direction = 1, speedCap = Infinity, lane = 0 } = {}) {
    this.track = track;
    this.world = world;
    this.name = name;
    this.skill = skill;
    this.color = color;
    this.direction = direction;
    this.speedCap = speedCap;
    this.baseLane = lane;
    this.lane = lane;
    this.targetLane = lane;
    this.mu = 1.02 * skill + 0.06;
    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.yaw = 0;
    this.speed = 0;
    this.vx = 0;
    this.vz = 0;
    this.index = 0;
    this.s = 0;
    this.lateral = 0;
    this.steerAngle = 0;
    this.wheelSpin = 0;
    this.rearSpin = 0;
    this.pitch = 0;
    this.roll = 0;
    this.susPitch = 0;
    this.susRoll = 0;
    this.accel = 0;
    this.gear = 1;
    this.rpm = 900;
    this.throttle = 0;
    this.brake = 0;
    this.q = {};
    this.pt = {};
    this.laneTimer = 0;
    this.bump = 0;
    this.stuck = 0;
    this.wheelOffsets = [
      [CAR_SPEC.a, CAR_SPEC.track / 2],
      [CAR_SPEC.a, -CAR_SPEC.track / 2],
      [-CAR_SPEC.b, CAR_SPEC.track / 2],
      [-CAR_SPEC.b, -CAR_SPEC.track / 2],
    ];
  }

  placeAt(s, lateral) {
    const p = this.track.pointAt(s, lateral, this.pt);
    this.x = p.x;
    this.z = p.z;
    this.yaw = this.direction > 0 ? p.heading : p.heading + Math.PI;
    this.lane = this.targetLane = lateral;
    this.speed = 0;
    this.index = p.index;
    this.s = s;
    this.y = this.world.groundHeight(this.x, this.z, this.track.nearest(this.x, this.z, this.index, this.q));
  }

  // Highest safe speed looking ahead along the direction of travel.
  #plannedSpeed() {
    const tr = this.track;
    const dir = this.direction;
    const decel = 8.2 * this.skill;
    let v = 95;
    for (let d = 0; d <= 220; d += 10) {
      const k = Math.abs(tr.curvatureAt(this.s + d * dir)) + 1e-4;
      const vmax = Math.sqrt((this.mu * G) / k);
      v = Math.min(v, Math.sqrt(vmax * vmax + 2 * decel * d));
    }
    return v;
  }

  update(dt, cars, { race = true, rubber = 1, frozen = false } = {}) {
    const tr = this.track;
    const q = tr.nearest(this.x, this.z, this.index, this.q);
    if (q.index >= 0) {
      this.index = q.index;
      this.s = q.s;
      this.lateral = q.lateral;
    }
    if (frozen) {
      this.speed = 0;
      this.#updateVisuals(dt, 0, 0);
      return;
    }
    const dir = this.direction;

    // Overtaking: look for a slower car ahead in our lane.
    this.laneTimer -= dt;
    let blocker = null;
    for (const c of cars) {
      if (c === this) continue;
      const dx = c.x - this.x;
      const dz = c.z - this.z;
      const ahead = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
      const side = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
      if (ahead > 0 && ahead < 16 + this.speed * 0.6 && Math.abs(side) < 2.4) {
        if (!blocker || ahead < blocker.ahead) blocker = { car: c, ahead, side };
      }
    }
    const maxLane = ROAD.half - 1.6;
    if (blocker && this.laneTimer <= 0 && race) {
      const options = [-maxLane * 0.7, 0, maxLane * 0.7].filter((l) => Math.abs(l - this.targetLane) > 1.5);
      options.sort((a, b) => Math.abs(a - this.lateral) - Math.abs(b - this.lateral));
      this.targetLane = options[0] ?? this.targetLane;
      this.laneTimer = 2.5;
    } else if (!blocker && this.laneTimer <= -3) {
      this.targetLane = this.baseLane;
      this.laneTimer = 0;
    }
    this.lane += clamp(this.targetLane - this.lane, -1.4 * dt, 1.4 * dt);

    // Pure pursuit steering towards a line that cuts to the inside of corners
    const look = 8 + this.speed * 0.42;
    const kOwn = tr.curvatureAt(this.s + look * 0.7 * dir) * dir;
    this.apex = lerp(this.apex || 0, race ? clamp(kOwn * 650, -2.6, 2.6) : 0, 1 - Math.exp(-1.5 * dt));
    const p = tr.pointAt(this.s + look * dir, clamp(this.lane + this.apex, -ROAD.half + 1.2, ROAD.half - 1.2) * dir, this.pt);
    const alpha = wrapAngle(Math.atan2(p.x - this.x, p.z - this.z) - this.yaw);
    let delta = Math.atan((2 * L * Math.sin(alpha)) / look);
    delta = clamp(delta, -0.6, 0.6);
    this.steerAngle = lerp(this.steerAngle, delta, 1 - Math.exp(-10 * dt));

    // Speed planning
    let target = Math.min(this.#plannedSpeed(), this.speedCap) * (race ? rubber : 1);
    if (blocker && Math.abs(this.lane - this.targetLane) < 0.5) {
      const other = blocker.car.speed ?? 0;
      if (blocker.ahead < 10) target = Math.min(target, other * 0.97);
    }
    if (Math.abs(this.lateral) > ROAD.halfTotal + 2) target = Math.min(target, 20);
    const powerAccel = Math.min(7.5, 205000 / (CAR_SPEC.mass * Math.max(this.speed, 4))) - (0.4 * this.speed * this.speed) / CAR_SPEC.mass;
    if (this.speed < target) {
      this.accel = Math.min(powerAccel * this.skill, (target - this.speed) * 3);
      this.throttle = clamp(this.accel / 5, 0.25, 1);
      this.brake = 0;
    } else {
      this.accel = -Math.min(9, (this.speed - target) * 2.5 + 1);
      this.throttle = 0;
      this.brake = clamp(-this.accel / 9, 0, 1);
    }
    this.speed = Math.max(0, this.speed + this.accel * dt);
    if (this.bump > 0) {
      this.bump -= dt;
    }

    // Kinematic bicycle with lateral acceleration limit
    let yawRate = (this.speed * Math.tan(this.steerAngle)) / L;
    const latMax = this.mu * G * 1.05;
    if (Math.abs(yawRate * this.speed) > latMax) yawRate = (Math.sign(yawRate) * latMax) / Math.max(this.speed, 0.1);
    this.yaw += yawRate * dt;
    this.vx = Math.sin(this.yaw) * this.speed;
    this.vz = Math.cos(this.yaw) * this.speed;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.#updateVisuals(dt, yawRate, this.accel);

    // Stuck detection (e.g. pushed into a tree)
    if (race && this.speed < 1 && target > 5) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 3) {
      this.placeAt(this.s + 5 * dir, this.baseLane * dir);
      this.speed = 8;
      this.stuck = 0;
    }
  }

  #updateVisuals(dt, yawRate, accel) {
    const hs = [0, 0, 0, 0];
    const sn = Math.sin(this.yaw);
    const cs = Math.cos(this.yaw);
    for (let w = 0; w < 4; w++) {
      const [fo, lo] = this.wheelOffsets[w];
      const wx = this.x + sn * fo + cs * lo;
      const wz = this.z + cs * fo - sn * lo;
      const q = this.track.nearest(wx, wz, this.index, this.q);
      hs[w] = this.world.groundHeight(wx, wz, q);
    }
    this.y = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
    this.pitch = Math.atan(((hs[0] + hs[1]) / 2 - (hs[2] + hs[3]) / 2) / L);
    this.roll = Math.atan(((hs[0] + hs[2]) / 2 - (hs[1] + hs[3]) / 2) / CAR_SPEC.track);
    this.susPitch = lerp(this.susPitch, clamp(-accel * 0.007, -0.05, 0.05), 1 - Math.exp(-6 * dt));
    this.susRoll = lerp(this.susRoll, clamp(yawRate * this.speed * 0.008, -0.06, 0.06), 1 - Math.exp(-6 * dt));
    this.wheelSpin += (this.speed / CAR_SPEC.wheelRadius) * dt;
    this.rearSpin = this.wheelSpin;
    // Cosmetic gearbox for engine sound
    const gears = CAR_SPEC.gears;
    const wheelRpm = (this.speed / CAR_SPEC.wheelRadius) * CAR_SPEC.finalDrive * (60 / (2 * Math.PI));
    while (this.gear < gears.length && wheelRpm * gears[this.gear - 1] > 6800) this.gear++;
    while (this.gear > 1 && wheelRpm * gears[this.gear - 1] < 3000) this.gear--;
    this.rpm = Math.max(1000, wheelRpm * gears[this.gear - 1]);
  }

  // Signed forward speed (for compatibility with Vehicle).
  get forwardSpeed() {
    return this.speed;
  }
}
