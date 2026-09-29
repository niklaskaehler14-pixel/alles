// The whole driving world without graphics: bus physics, collisions, traffic, pedestrians,
// the trip (passengers, timetable) and the rule monitor. Used by the game and by the tests.

import { Bus } from './busPhysics.js';
import { BUS_TYPES } from './busTypes.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Trip, DAYTIME } from './trip.js';
import { RuleMonitor, FAULTS } from './rules.js';
import { buildRoute } from './lines.js';
import { resolveBusStatic } from './collision.js';
import { boxOverlap } from './util.js';

export class Simulation {
  constructor(city, statics, opts = {}) {
    this.city = city;
    this.statics = statics;
    this.opts = opts;
    this.spec = BUS_TYPES[opts.busType] || BUS_TYPES.solo;
    this.bus = new Bus(this.spec);
    this.daytime = DAYTIME[opts.daytime] || DAYTIME.day;
    this.night = opts.daytime === 'night';
    this.clock = this.daytime.clock;
    this.indicator = 0; // 1 left, -1 right
    this.hazard = false;
    this.lights = this.night;
    this.horn = false;
    this.events = [];
    this.acc = 0;
    this.steerPeak = 0;
    this.carHitCool = 0;
    this.route = null;
    this.trip = null;
    this.rules = new RuleMonitor(city);
    const tf = opts.traffic ?? 22;
    this.traffic = new Traffic(city, { seed: opts.seed ?? 3, count: Math.round(tf * (this.daytime.traffic || 1)) });
    this.peds = new Pedestrians(city, { seed: (opts.seed ?? 3) + 17, count: Math.round((opts.pedestrians ?? 40) * (this.night ? 0.4 : 1)) });
    this.ground = { ground: (x, z) => (city.isSidewalk(x, z) ? 1 : 0), wet: !!opts.wet };

    if (opts.tripId) {
      this.route = buildRoute(city, opts.tripId);
      this.trip = new Trip(city, this.route, { bus: this.bus, difficulty: opts.difficulty, daytime: opts.daytime, seed: opts.seed ?? 1 });
      this.clock = this.trip.clock;
      const s0 = this.route.stops[0].stop;
      const lane = city.lanes[s0.lane];
      const p = lane.path.at(s0.sFront);
      const half = this.spec.width / 2;
      const lat = s0.curbOffset - half - 0.2;
      this.bus.resetAtFront(p.x + s0.rx * lat, p.z + s0.rz * lat, lane.yaw);
      if (this.spec.joint) this.bus.yaw2 = lane.yaw;
    } else {
      // Free driving: start at the depot stop.
      const s0 = city.stopById[opts.startStop || 'depot-s'];
      const lane = city.lanes[s0.lane];
      const p = lane.path.at(s0.sFront);
      this.bus.resetAtFront(p.x, p.z, lane.yaw);
    }
    // A bus waiting at the first stop is secured with the parking brake; on "Profi" the
    // engine is off as well and has to be started.
    if (this.trip) {
      this.bus.setParkingBrake(true);
      if (this.trip.diff.engine === 'manual') {
        this.bus.engineOn = false;
        this.bus.rpm = 0;
        this.bus.selector = 'N';
      }
      this.bus.drainEvents();
    }
    this.traffic.reset(this.bus.x, this.bus.z, this.bus.boxes().map((b) => ({ ...b, hl: b.hl + 12, hw: b.hw + 3 })));
    this.peds.reset(this.bus.x, this.bus.z);
  }

  // Player commands (keyboard, touch, gamepad).
  command(name, arg) {
    const bus = this.bus;
    switch (name) {
      case 'doors':
        if (!bus.toggleAllDoors()) this.#note('refused', 'Türen öffnen nur im Stand');
        break;
      case 'door':
        if (!bus.toggleDoor(arg)) this.#note('refused', 'Türen öffnen nur im Stand');
        break;
      case 'kneel':
        if (!bus.setKneel(bus.kneelTarget < 0.5)) this.#note('refused', 'Absenken nur im Stand');
        break;
      case 'indicatorLeft':
        this.indicator = this.indicator === 1 ? 0 : 1;
        this.steerPeak = 0;
        this.events.push({ type: 'indicator', value: this.indicator });
        break;
      case 'indicatorRight':
        this.indicator = this.indicator === -1 ? 0 : -1;
        this.steerPeak = 0;
        this.events.push({ type: 'indicator', value: this.indicator });
        break;
      case 'hazard':
        this.hazard = !this.hazard;
        this.events.push({ type: 'indicator', value: this.indicator });
        break;
      case 'lights':
        this.lights = !this.lights;
        this.events.push({ type: 'lights', value: this.lights });
        break;
      case 'parkingBrake':
        bus.setParkingBrake(!bus.parkingBrake);
        break;
      case 'reverse':
        if (!bus.setSelector(bus.selector === 'R' ? 'D' : 'R')) this.#note('refused', 'Fahrtrichtung nur im Stand wechseln');
        break;
      case 'neutral':
        bus.setSelector(bus.selector === 'N' ? 'D' : 'N');
        break;
      case 'engine':
        bus.setEngine(!bus.engineOn);
        break;
      default:
        break;
    }
  }

  #note(type, text) {
    this.events.push({ type, text });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // Advance by dt (seconds) with pedal/steering input.
  step(dt, input) {
    const bus = this.bus;
    this.clock += dt;
    bus.step(dt, input, this.ground);

    // Indicator self-cancelling after a turn (like a real steering column switch).
    if (this.indicator !== 0) {
      const steer = input.steer || 0;
      if (Math.sign(steer) === this.indicator && Math.abs(steer) > this.steerPeak) this.steerPeak = Math.abs(steer);
      if (this.steerPeak > 0.45 && Math.abs(steer) < 0.08 && bus.u > 1) {
        this.indicator = 0;
        this.steerPeak = 0;
        this.events.push({ type: 'indicator', value: 0 });
      }
    }

    // Static obstacles.
    const impact = resolveBusStatic(bus, this.statics);
    if (impact) this.events.push({ type: 'impact', speed: impact.speed, kind: impact.kind });

    // Cars.
    let carHit = false;
    this.carHitCool = Math.max(0, this.carHitCool - dt);
    const boxes = bus.boxes();
    const bsn = Math.sin(bus.yaw);
    const bcs = Math.cos(bus.yaw);
    for (const v of this.traffic.vehicles) {
      if (Math.abs(v.x - bus.x) > 25 || Math.abs(v.z - bus.z) > 25) continue;
      const vb = { x: v.x, z: v.z, yaw: v.yaw, hl: v.hl, hw: v.hw };
      for (const b of boxes) {
        const hit = boxOverlap(b, vb);
        if (!hit) continue;
        // Who drove into whom? Closing speed of the bus towards the car vs. the car towards the bus.
        const busTowards = -(bsn * bus.u * hit.nx + bcs * bus.u * hit.nz);
        const carTowards = Math.sin(v.yaw) * v.v * hit.nx + Math.cos(v.yaw) * v.v * hit.nz;
        const busFault = busTowards > 0.5 && busTowards >= carTowards;
        const d = Math.min(hit.depth, 0.5);
        if (busFault) {
          bus.x += hit.nx * d;
          bus.z += hit.nz * d;
          bus.u *= 0.8;
        } else {
          // The car ran into the bus: it stops, the bus stays where it is.
          v.s = Math.max(0, v.s - d);
          v.v = 0;
        }
        const rel = Math.max(busTowards, carTowards);
        if (rel > 0.6 && v.crashed <= 0) {
          this.traffic.crash(v);
          this.events.push({ type: 'crash', speed: rel, busFault });
          if (busFault && this.carHitCool <= 0) {
            carHit = true;
            this.carHitCool = 3;
          }
        }
      }
    }

    // Slower systems run at ~30 Hz.
    this.acc += dt;
    const busEvents = bus.drainEvents();
    for (const e of busEvents) this.events.push(e);
    this.pendingBusEvents = (this.pendingBusEvents || []).concat(busEvents);
    this.pendingImpact = impact && (!this.pendingImpact || impact.speed > this.pendingImpact.speed) ? impact : this.pendingImpact;
    this.pendingCarHit = this.pendingCarHit || carHit;
    if (this.acc < 1 / 30) return;
    const sdt = this.acc;
    this.acc = 0;

    const f = bus.frontPos();
    const busBoxes = bus.boxes();
    const bs = Math.sin(bus.yaw);
    const bc = Math.cos(bus.yaw);
    const crossing = this.peds.crossingPeds();
    // A bus leaving a stop with the left indicator on gets let out (§ 20 Abs. 5 StVO):
    // cars coming from behind wait before the lane stretch next to the bus.
    const yieldBoxes = this.indicator === 1 && Math.abs(bus.u) < 3 ? this.#pullOutBox(f) : [];
    // Where the bus is heading (so cars at junctions give way to it when they have to).
    let busApproach = null;
    const bq = bus.u > 0.3 ? this.city.laneAt(f[0], f[1], bus.yaw, 3.2) : null;
    if (bq) {
      let turn = null;
      if (this.route && this.trip) {
        const j = this.route.junctions.find((jj) => jj.start > this.trip.progress - 1);
        if (j) turn = j.turn;
      }
      busApproach = { lane: bq.lane.id, tta: (bq.lane.path.length - bq.s) / Math.max(bus.u, 0.8), turn };
    }
    this.busStopped = Math.abs(bus.u) < 0.2 ? (this.busStopped || 0) + sdt : 0;
    this.traffic.update(sdt, this.clock, {
      busBoxes,
      yieldBoxes,
      busApproach,
      busStopped: this.busStopped,
      busYaw: bus.yaw,
      busX: bus.x,
      busZ: bus.z,
      busSpeedAlong: (dx, dz) => (bs * dx + bc * dz) * bus.u,
      pedestrians: crossing,
    });
    this.peds.update(sdt, this.clock, {
      busBoxes,
      busSpeed: bus.u,
      busX: bus.x,
      busZ: bus.z,
      busFrontX: f[0],
      busFrontZ: f[1],
      busYaw: bus.yaw,
      vehicles: this.traffic.vehicles,
    });
    this.lastCrossingPeds = crossing;
    const trafficEvents = this.traffic.drainEvents();
    const pedEvents = this.peds.drainEvents();

    let inStopZone = false;
    if (this.trip && !this.trip.finished) {
      this.trip.update(sdt, {});
      inStopZone = this.trip.inStopZone;
      for (const e of this.trip.drainEvents()) {
        if (e.type === 'fault') {
          // Re-emitted by the rule monitor below.
          this.rules.add(e.code, { time: this.clock, cooldown: 1, detail: e.detail });
          continue;
        }
        if (e.type === 'depart' && e.stop && !e.stop.last && e.stop.served) this.#checkDepartIndicator();
        this.events.push(e);
      }
    } else if (!this.trip) {
      // Free driving: any stop zone counts.
      inStopZone = this.city.stops.some((s) => Math.hypot(s.x - f[0], s.z - f[1]) < 14);
    }

    this.rules.update(sdt, {
      bus,
      t: this.clock,
      now: this.clock,
      indicator: this.indicator,
      hazard: this.hazard,
      lights: this.lights,
      night: this.night,
      passengers: this.trip ? this.trip.onboard.length : 0,
      crossingPeds: crossing,
      trafficEvents,
      pedEvents,
      busEvents: this.pendingBusEvents,
      impact: this.pendingImpact,
      carHit: this.pendingCarHit,
      inStopZone,
    });
    this.pendingBusEvents = [];
    this.pendingImpact = null;
    this.pendingCarHit = false;
    for (const e of this.rules.drainEvents()) this.events.push({ type: 'fault', fault: e });
  }

  // Lane stretch the bus will pull into when leaving the stop it stands at (or none).
  #pullOutBox(front) {
    let stop = null;
    if (this.trip) {
      const st = this.trip.nextStop;
      if (st && this.trip.inStopZone) stop = st.stop;
    } else {
      stop = this.city.stops.find((s) => Math.hypot(s.x - front[0], s.z - front[1]) < 14) || null;
    }
    if (!stop) return [];
    const lane = this.city.lanes[stop.lane];
    const q = lane.path.nearest(front[0], front[1]);
    const len = this.spec.length + 16;
    const mid = q.s - this.spec.length / 2 + 3;
    const p = lane.path.at(mid);
    return [{ x: p.x, z: p.z, yaw: lane.yaw, hl: len / 2, hw: 1.5 }];
  }

  #checkDepartIndicator() {
    const h = this.rules.indicatorHistory;
    const since = this.clock - 14;
    const ok = h.some(([t, v]) => t >= since && v === 1);
    if (!ok) this.rules.add('noIndicatorDepart', { time: this.clock, cooldown: 1 });
  }

  report() {
    return this.trip ? this.trip.report(this.rules, this.spec) : null;
  }
}

export { FAULTS };
