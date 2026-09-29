// Traffic rules and driving faults. Watches the bus every tick and records violations with
// penalty points and a deduction (what the company charges the driver: fines, damage).

import { signalState, DIRS, leftOf, opposite } from './citymap.js';
import { wrapAngle, pointInBox } from './util.js';

export const FAULTS = {
  redLight: { text: 'Rote Ampel überfahren', points: 25, fine: 90 },
  redLightQualified: { text: 'Rote Ampel überfahren (länger als 1 s rot)', points: 40, fine: 200 },
  stopSign: { text: 'Stoppschild: nicht angehalten', points: 10, fine: 25 },
  rightOfWay: { text: 'Vorfahrt missachtet', points: 20, fine: 100 },
  speed1: { text: 'Zu schnell (bis 10 km/h drüber)', points: 5, fine: 30 },
  speed2: { text: 'Zu schnell (11–20 km/h drüber)', points: 12, fine: 70 },
  speed3: { text: 'Deutlich zu schnell (über 20 km/h drüber)', points: 25, fine: 150 },
  rightTurnSpeed: { text: 'Rechtsabbiegen schneller als Schrittgeschwindigkeit', points: 12, fine: 70 },
  noIndicator: { text: 'Beim Abbiegen nicht geblinkt', points: 5, fine: 10 },
  wrongIndicator: { text: 'Falsch geblinkt', points: 5, fine: 10 },
  noIndicatorDepart: { text: 'Beim Abfahren von der Haltestelle nicht geblinkt', points: 4, fine: 10 },
  curb: { text: 'Bordstein überfahren', points: 3, fine: 15 },
  collisionLight: { text: 'Hindernis gestreift', points: 10, fine: 150 },
  collisionHeavy: { text: 'Unfall: Aufprall auf Hindernis', points: 25, fine: 600 },
  carCrash: { text: 'Unfall mit einem Pkw', points: 30, fine: 900 },
  pedHit: { text: 'Fußgänger angefahren', points: 60, fine: 2000 },
  zebra: { text: 'Fußgänger am Zebrastreifen nicht durchgelassen', points: 15, fine: 80 },
  pedDanger: { text: 'Fußgänger gefährdet', points: 15, fine: 80 },
  doorsOutside: { text: 'Türen außerhalb der Haltestelle geöffnet', points: 5, fine: 0 },
  doorTrap: { text: 'Tür auf einen Fahrgast zugefahren', points: 4, fine: 0 },
  noLights: { text: 'Bei Dunkelheit ohne Licht gefahren', points: 5, fine: 20 },
  hardBrake: { text: 'Vollbremsung – Fahrgäste gestürzt', points: 8, fine: 0 },
  skippedStop: { text: 'Haltestelle ausgelassen', points: 10, fine: 0 },
  leftBehind: { text: 'Fahrgäste an der Haltestelle stehen gelassen', points: 8, fine: 0 },
  early: { text: 'Zu früh abgefahren', points: 6, fine: 0 },
  offRoute: { text: 'Linienweg verlassen', points: 10, fine: 0 },
  badStop: { text: 'Schlecht an der Haltestelle gehalten', points: 3, fine: 0 },
};

const TURN_WALK = 12; // km/h: walking pace (4–10 km/h) plus a little tolerance

export class RuleMonitor {
  constructor(city) {
    this.city = city;
    this.faults = [];
    this.events = [];
    this.cool = new Map();
    this.speeding = { active: false, max: 0, timer: 0, calm: 0, limit: 50 };
    this.prevLane = null;
    this.prevS = 0;
    this.minSpeedBeforeLine = Infinity;
    this.junction = null; // current junction passage
    this.approach = null; // last stop line crossed {lane, control, time}
    this.indicatorHistory = [];
    this.limit = 50;
    this.dark = 0;
    this.hardBrake = 0;
    this.lightTimer = 0;
  }

  add(code, extra = {}) {
    const f = FAULTS[code];
    const now = extra.time ?? 0;
    const cd = this.cool.get(code);
    if (cd !== undefined && now < cd) return null;
    this.cool.set(code, now + (extra.cooldown ?? 6));
    const fault = { code, text: f.text, points: f.points, fine: f.fine, time: now, x: extra.x, z: extra.z, detail: extra.detail || '' };
    this.faults.push(fault);
    this.events.push(fault);
    return fault;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  get points() {
    return this.faults.reduce((s, f) => s + f.points, 0);
  }

  get fines() {
    return this.faults.reduce((s, f) => s + f.fine, 0);
  }

  // ctx: { bus, t (signal clock), now (game time), indicator: -1 right / 1 left / 0, hazard,
  //        lights, night, passengers, crossingPeds, trafficEvents, pedEvents, busEvents, impact, carHit, inStopZone }
  update(dt, ctx) {
    const { bus, city } = { bus: ctx.bus, city: this.city };
    const now = ctx.now;
    const front = bus.frontPos();
    const kmh = bus.kmh;

    // Indicator history (for "did you signal before turning?").
    this.indicatorHistory.push([now, ctx.hazard ? 0 : ctx.indicator]);
    while (this.indicatorHistory.length && this.indicatorHistory[0][0] < now - 40) this.indicatorHistory.shift();
    const signalled = (dir, since) => this.indicatorHistory.some(([t, v]) => t >= since && v === dir);

    // ---- current lane and stop lines
    const q = city.laneAt(front[0], front[1], bus.yaw, 3.2);
    const center = bus.localToWorld(0, bus.geo.center);
    const qc = city.laneAt(center[0], center[1], bus.yaw, 4.5);
    if (qc) this.limit = qc.lane.speed;
    if (q && q.lane === this.prevLane) {
      const len = q.lane.path.length;
      if (q.s > len - 12) this.minSpeedBeforeLine = Math.min(this.minSpeedBeforeLine, kmh);
      if (this.prevS < len && q.s >= len) this.#crossLine(q.lane, ctx);
    } else if (this.prevLane) {
      // Left the lane: did we drive over its stop line into the junction?
      const len = this.prevLane.path.length;
      const node = city.nodes[this.prevLane.to];
      if (this.prevS > len - 5 && bus.u > 0.3 && node && Math.abs(front[0] - node.x) < node.trim + 1.5 && Math.abs(front[1] - node.z) < node.trim + 1.5) {
        this.#crossLine(this.prevLane, ctx);
      }
      this.minSpeedBeforeLine = Infinity;
    }
    this.prevLane = q ? q.lane : null;
    this.prevS = q ? q.s : 0;

    // ---- junction passages: turn direction, indicator, right-turn speed
    const node = city.nodeBoxAt(center[0], center[1], -1);
    const isJunction = node && (node.kind === 'cross' || node.kind === 'tee');
    if (isJunction && (!this.junction || this.junction.node !== node.id)) {
      this.junction = { node: node.id, yaw0: bus.yaw, entered: now, maxKmh: 0 };
    }
    if (this.junction) {
      // Only the speed while actually turning counts (not accelerating out afterwards).
      if (Math.abs(bus.r) > 0.1) this.junction.maxKmh = Math.max(this.junction.maxKmh, kmh);
      const dYaw = wrapAngle(bus.yaw - this.junction.yaw0);
      if (!isJunction || node.id !== this.junction.node) {
        const turn = dYaw < -0.8 ? -1 : dYaw > 0.8 ? 1 : 0; // -1 right, 1 left
        const j = this.junction;
        this.junction = null;
        if (turn !== 0) {
          const since = j.entered - 8;
          const wrong = signalled(-turn, j.entered - 1) && !signalled(turn, since);
          if (wrong) this.add('wrongIndicator', { time: now, x: front[0], z: front[1] });
          else if (!signalled(turn, since)) this.add('noIndicator', { time: now, x: front[0], z: front[1] });
        }
        if (turn === -1 && j.maxKmh > TURN_WALK) this.add('rightTurnSpeed', { time: now, x: front[0], z: front[1], detail: `${Math.round(j.maxKmh)} km/h` });
      }
    }

    // ---- speed
    const lim = this.limit;
    const sp = this.speeding;
    if (kmh > lim + 5) {
      sp.timer += dt;
      sp.max = Math.max(sp.max, kmh - lim);
      sp.calm = 0;
      if (sp.timer > 1.5 && !sp.active) sp.active = true;
    } else {
      sp.calm += dt;
      if (sp.calm > 3 || kmh < lim) {
        if (sp.active) {
          const over = Math.round(sp.max);
          const code = over > 20 ? 'speed3' : over > 10 ? 'speed2' : 'speed1';
          this.add(code, { time: now, cooldown: 1, x: front[0], z: front[1], detail: `${lim} km/h erlaubt, ${Math.round(lim + sp.max)} km/h gefahren` });
        }
        sp.active = false;
        sp.max = 0;
        sp.timer = 0;
      }
    }

    // ---- physics events: curbs, doors
    for (const e of ctx.busEvents || []) {
      if (e.type === 'curb') this.add('curb', { time: now, cooldown: 3, x: e.x, z: e.z });
      if (e.type === 'doorReverse') this.add('doorTrap', { time: now, cooldown: 4 });
      if (e.type === 'doorOpen' && !ctx.inStopZone) this.add('doorsOutside', { time: now, cooldown: 20 });
    }
    // ---- collisions
    if (ctx.impact && ctx.impact.speed > 0.8) {
      this.add(ctx.impact.speed > 3 ? 'collisionHeavy' : 'collisionLight', { time: now, cooldown: 3, x: ctx.impact.x, z: ctx.impact.z });
    }
    if (ctx.carHit) this.add('carCrash', { time: now, cooldown: 5 });
    for (const e of ctx.pedEvents || []) {
      if (e.type === 'pedHit') this.add('pedHit', { time: now, cooldown: 5, x: e.ped.x, z: e.ped.z });
    }
    // ---- other road users forced to brake because of us
    for (const e of ctx.trafficEvents || []) {
      if (e.type !== 'forcedBrake') continue;
      if (this.#hadPriority(e.vehicle, ctx)) this.add('rightOfWay', { time: now, cooldown: 8, x: e.vehicle.x, z: e.vehicle.z });
    }
    // ---- pedestrians on crossings
    const boxes = bus.boxes();
    for (const p of ctx.crossingPeds || []) {
      let near = false;
      for (const b of boxes) if (pointInBox(p.x, p.z, b, 1.1)) near = true;
      if (!near || Math.abs(bus.u) < 0.8) continue;
      const c = city.crossings[p.crossing];
      if (c && c.kind === 'zebra') this.add('zebra', { time: now, cooldown: 8, x: p.x, z: p.z });
      else this.add('pedDanger', { time: now, cooldown: 8, x: p.x, z: p.z });
    }
    // ---- lights at night
    if (ctx.night && !ctx.lights && kmh > 5) {
      this.lightTimer += dt;
      if (this.lightTimer > 6) this.add('noLights', { time: now, cooldown: 120 });
    } else this.lightTimer = 0;
    // ---- emergency braking with passengers on board
    if (ctx.passengers > 0 && bus.aLong < -4.2 && bus.u > 1) {
      this.hardBrake += dt;
      if (this.hardBrake > 0.25) this.add('hardBrake', { time: now, cooldown: 10 });
    } else this.hardBrake = 0;
  }

  // Front of the bus crossed the stop line at the end of `lane`.
  #crossLine(lane, ctx) {
    const now = ctx.now;
    const node = this.city.nodes[lane.to];
    const front = ctx.bus.frontPos();
    this.approach = { lane: lane.id, control: lane.endControl, node: lane.to, dir: lane.dir, time: now };
    if (lane.endControl === 'signal') {
      const st = signalState(node.signal, lane.signalGroup, ctx.t);
      if (st === 'red' || st === 'redyellow') {
        // How long has it been red? (step back in time)
        let redFor = 0;
        for (let k = 0.1; k <= 1.2; k += 0.1) {
          const s2 = signalState(node.signal, lane.signalGroup, ctx.t - k);
          if (s2 === 'red' || s2 === 'redyellow') redFor = k;
          else break;
        }
        this.add(redFor >= 1 ? 'redLightQualified' : 'redLight', { time: now, cooldown: 2, x: front[0], z: front[1] });
      }
    }
    if (lane.endControl === 'stop' && this.minSpeedBeforeLine > 1.5) {
      this.add('stopSign', { time: now, cooldown: 2, x: front[0], z: front[1] });
    }
    this.minSpeedBeforeLine = Infinity;
  }

  // Did the car that had to brake for us have the right of way?
  #hadPriority(v, ctx) {
    const city = this.city;
    const a = this.approach;
    if (!a || ctx.now - a.time > 25) return false;
    const carLane = v.kind === 0 ? city.lanes[v.id] : city.lanes[city.movements[v.id].inLane];
    if (!carLane || carLane.to !== a.node) return false;
    if (a.control === 'yield' || a.control === 'stop') return carLane.endControl === 'major';
    if (a.control === 'rbl') return carLane.dir === leftOf(a.dir); // came from our right
    // Turning left across oncoming traffic.
    const busTurnLeft = wrapAngle(ctx.bus.yaw - Math.atan2(DIRS[a.dir][0], DIRS[a.dir][1])) > 0.5;
    if (busTurnLeft && carLane.dir === opposite(a.dir)) return true;
    return false;
  }
}
