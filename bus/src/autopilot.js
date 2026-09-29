// Bus autopilot: drives a trip like a careful driver (used by the tests and the menu demo).
// Front-axle Stanley steering along the route with lateral offsets (curb at stops, swinging
// wide before right turns), speed planning for bends, stops, lights, signs and traffic.

import { signalState, leftOf, opposite } from './citymap.js';
import { clamp, wrapAngle, smoothstep, pointInBox } from './util.js';
import { FARES, roundCents } from './tickets.js';

// How far the bus swings out before a right turn so the rear wheels clear the curb.
const SWING = { solo: 1.35, electric: 1.35, midi: 0.7, articulated: 2.2 };

export class Autopilot {
  constructor(city, route, bus) {
    this.city = city;
    this.route = route;
    this.bus = bus;
    this.swing = SWING[bus.spec.id] ?? 1.35;
    this.indicator = 0;
    this.state = 'drive';
    this.timer = 0;
    this.stoppedAtSign = null;
    this.saleTimer = 0;
    this.buildOffsets();
  }

  // Lateral target offset (+ = right of the lane centre) along the route.
  buildOffsets() {
    const r = this.route;
    const half = this.bus.spec.width / 2;
    this.bumps = [];
    for (const j of r.junctions) {
      if (j.turn !== 'right') continue;
      // Swing out before the corner, come back into the own lane from the middle of the arc on.
      this.bumps.push({ a: j.start - 22, b: j.start - 4, c: j.start + (j.end - j.start) * 0.7, d: j.end + 6, off: -this.swing });
    }
    for (const rs of r.stops) {
      const s = rs.stop;
      const curb = s.curbOffset - half - 0.18;
      // Bays: follow the tapers (move over only once the curb recedes, pull out before the exit taper closes).
      if (s.type === 'bay') this.bumps.push({ a: rs.dist - s.zone - 12, b: rs.dist - s.zone + 6, c: rs.dist + 0.5, d: rs.dist + 12, off: curb, stop: true });
      else this.bumps.push({ a: rs.dist - 28, b: rs.dist - 10, c: rs.dist + 0.5, d: rs.dist + 14, off: curb, stop: true });
    }
  }

  offsetAt(s) {
    let off = 0;
    for (const b of this.bumps) {
      if (s <= b.a || s >= b.d) continue;
      let w;
      if (s < b.b) w = smoothstep(b.a, b.b, s);
      else if (s <= b.c) w = 1;
      else w = 1 - smoothstep(b.c, b.d, s);
      if (Math.abs(b.off * w) > Math.abs(off)) off = b.off * w;
    }
    return off;
  }

  // env: { trip, t (signal clock), traffic, pedestrians }
  update(dt, env) {
    const bus = this.bus;
    const trip = env.trip;
    const route = this.route;
    const out = { throttle: 0, brake: 0, steer: 0 };
    const front = bus.frontPos();
    const prog = trip.progress;

    // ---- steering: Stanley on the front axle
    const fa = bus.localToWorld(0, bus.L);
    const sFa = prog - (bus.geo.front - bus.L);
    const p = route.path.at(sFa);
    const off = this.offsetAt(prog);
    const tx = p.x - p.dz * off;
    const tz = p.z + p.dx * off;
    // Signed lateral error (+ = bus left of the target).
    const ex = fa[0] - tx;
    const ez = fa[1] - tz;
    const e = ex * p.dz - ez * p.dx;
    // Tangent of the offset path at the front axle (a hair ahead to cover the steering lag).
    const v = Math.max(0, bus.u);
    const lead = 0.5 + v * 0.25;
    const pb = route.path.at(sFa - 0.6);
    const offB = this.offsetAt(prog - 0.6);
    const pa = route.path.at(sFa + lead);
    const offA = this.offsetAt(prog + lead);
    const pathYaw = Math.atan2(pa.x - pa.dz * offA - (pb.x - pb.dz * offB), pa.z + pa.dx * offA - (pb.z + pb.dx * offB));
    const headErr = wrapAngle(pathYaw - bus.yaw);
    // Stanley: in a steady turn the front wheels point along the path, so delta = heading error.
    const delta = headErr + Math.atan2(-2.4 * e, v + 0.8);
    out.steer = clamp(delta / bus.spec.steerMax, -1, 1);

    // ---- speed planning
    let vt = this.#laneLimit(prog) / 3.6 - 0.8;
    // Curves ahead (bends, turns) within 60 m.
    for (let d = 0; d < 60; d += 3) {
      const kk = Math.abs(route.path.curvature(prog + d, 3));
      if (kk < 0.005) continue;
      let vc = Math.sqrt(1.1 / kk);
      if (route.path.curvature(prog + d, 3) < 0) vc = Math.min(vc, 14 / 3.6);
      vt = Math.min(vt, Math.sqrt(vc * vc + 2 * 0.9 * Math.max(0, d - 4)));
    }
    // Right turns at junctions: walking pace (§ 9 Abs. 6 StVO) until the bus has straightened out.
    for (const j of route.junctions) {
      if (j.turn !== 'right' || (j.kind !== 'cross' && j.kind !== 'tee')) continue;
      if (prog > j.end + 9 || j.start - prog > 70) continue;
      const vcap = 9 / 3.6;
      const d0 = j.start - 3 - prog;
      vt = Math.min(vt, d0 <= 0 ? vcap : Math.sqrt(vcap * vcap + 2 * 0.9 * d0));
    }
    // Stop ahead.
    const st = trip.nextStop;
    let stopDist = Infinity;
    if (st && st.state === 'ahead') {
      const needed = st.waiting.length > 0 || trip.onboard.some((q) => q.to === trip.current) || st.last;
      if (needed) stopDist = st.dist - prog - 0.3;
    }
    // Junction controls ahead.
    const jn = route.junctions.find((j) => j.start > prog - 1 && j.start - prog < 90);
    let lineDist = Infinity;
    if (jn) {
      const d = jn.start - prog - 0.8;
      const node = this.city.nodes[jn.node];
      if (jn.control === 'signal') {
        const s = signalState(node.signal, jn.signalGroup, env.t);
        if (s === 'red' || s === 'redyellow' || (s === 'yellow' && d > (v * v) / (2 * 2.6))) lineDist = d;
      } else if (jn.control === 'stop') {
        if (this.stoppedAtSign !== jn.node) {
          lineDist = d;
          if (d < 1.2 && v < 0.2) this.stoppedAtSign = jn.node;
        } else if (!this.#clearToGo(jn, env)) lineDist = d;
      } else if (jn.control === 'yield' || jn.control === 'rbl') {
        if (d < 18 && !this.#clearToGo(jn, env)) lineDist = d;
      } else if (jn.turn === 'left' && d < 18 && !this.#clearToGo(jn, env)) lineDist = d;
      if (jn.kind === 'bend') lineDist = Infinity;
    }
    // Traffic and pedestrians on the path ahead.
    const obstacle = this.#obstacle(env, prog);
    const target = Math.min(stopDist, lineDist, obstacle);
    if (target < Infinity) vt = Math.min(vt, Math.sqrt(2 * 0.95 * Math.max(0, target)) * (target < 1.2 ? 0.4 : 1));
    if (target < 0.4) vt = 0;

    // ---- stop handling (doors, passengers, tickets, departure)
    this.#stopLogic(dt, env, out, st, stopDist);
    if (this.state !== 'drive') vt = 0;

    // ---- indicators
    this.indicator = 0;
    const turnAhead = route.junctions.find((j) => j.end > prog - bus.spec.length * 0.2 && j.start - prog < 45 && j.turn !== 'straight' && j.kind !== 'bend');
    if (turnAhead) this.indicator = turnAhead.turn === 'left' ? 1 : -1;
    if (stopDist < 70 && this.state === 'drive') this.indicator = -1;
    if (this.state === 'depart' || (this.departing && this.departing > 0)) this.indicator = 1;

    // ---- pedals: speed controller
    if (this.state === 'drive') {
      const acc = clamp((vt - v) * 1.4, -3.2, 1.3);
      if (vt < 0.05 && v < 0.4) {
        out.brake = 0.35;
      } else if (acc >= 0) {
        out.throttle = clamp(acc / 1.4 + (vt > v ? 0.12 : 0), 0, 0.85);
      } else {
        out.brake = clamp(-acc / 6.8 + 0.02, 0, 1);
      }
    } else {
      out.brake = 0.3;
    }
    if (this.departing > 0) this.departing -= dt;
    return out;
  }

  #laneLimit(prog) {
    const r = this.route;
    for (const pc of r.pieces) {
      if (prog >= pc.start && prog < pc.start + pc.length) return pc.kind === 'lane' ? pc.speed : 50;
    }
    return 50;
  }

  // Priority traffic check before entering a junction.
  #clearToGo(jn, env) {
    const city = this.city;
    const node = city.nodes[jn.node];
    const inLane = city.lanes[this.route.pieces.find((p) => p.kind === 'move' && p.start === jn.start).lane];
    const traffic = env.traffic;
    if (!traffic) return true;
    for (const v of traffic.vehicles) {
      // Cars standing still for a while are waiting (possibly for us): they don't block.
      if (v.v < 0.3 && v.wait > 2) continue;
      if (v.kind === 1 && city.movements[v.id].node === node.id) return false; // somebody inside
      if (v.kind !== 0) continue;
      const lane = city.lanes[v.id];
      if (lane.to !== node.id || lane.id === inLane.id) continue;
      const tta = (lane.path.length - v.s - v.hl) / Math.max(v.v, 0.8);
      if (tta > 6) continue;
      if (jn.control === 'yield' || jn.control === 'stop') {
        if (lane.endControl === 'major') return false;
      } else if (jn.control === 'rbl') {
        if (lane.dir === leftOf(inLane.dir)) return false;
      }
      if (jn.turn === 'left' && lane.dir === opposite(inLane.dir)) {
        const mv = city.movements[v.next];
        if (mv && mv.turn !== 'left') return false;
      }
    }
    return true;
  }

  // Distance to the first car / pedestrian on the route ahead.
  #obstacle(env, prog) {
    const route = this.route;
    const bus = this.bus;
    const look = Math.max(18, bus.u * 3 + 12);
    let best = Infinity;
    const q = {};
    const half = bus.spec.width / 2;
    for (let d = 1; d < look; d += 1.5) {
      route.path.at(prog + d, q);
      const off = this.offsetAt(prog + d);
      const x = q.x - q.dz * off;
      const z = q.z + q.dx * off;
      if (env.traffic) {
        for (const v of env.traffic.vehicles) {
          if (Math.abs(v.x - x) > 8 || Math.abs(v.z - z) > 8) continue;
          if (pointInBox(x, z, { x: v.x, z: v.z, yaw: v.yaw, hl: v.hl, hw: v.hw }, half + 0.3)) {
            best = Math.min(best, d - 3);
          }
        }
      }
      for (const pd of env.pedestrians || []) {
        if (Math.abs(pd.x - x) < half + 1.2 && Math.abs(pd.z - z) < half + 1.2) best = Math.min(best, d - 2);
      }
      if (best < Infinity) break;
    }
    return best;
  }

  // Mirror check before pulling out: a car right next to the bus (only possible at a bay)
  // or one still approaching fast from behind. Cars waiting behind us let us go.
  #laneBusy(env, st) {
    if (!env.traffic) return false;
    const lane = this.city.lanes[st.stop.lane];
    const f = this.bus.frontPos();
    const busFront = lane.path.nearest(f[0], f[1]).s;
    const busRear = busFront - this.bus.spec.length;
    const bay = st.stop.type === 'bay';
    for (const v of env.traffic.vehicles) {
      if (v.kind !== 0 || v.id !== lane.id) continue;
      const cf = v.s + v.hl;
      const cr = v.s - v.hl;
      if (cr > busFront + 4) continue; // already ahead
      if (cf >= busRear - 1) {
        if (bay) return true; // alongside
        continue;
      }
      if (bay && v.v > 1.5 && cf > busRear - 30) return true; // closing in
    }
    return false;
  }

  #stopLogic(dt, env, out, st, stopDist) {
    const bus = this.bus;
    const trip = env.trip;
    if (!st) return;
    if (this.state === 'drive') {
      // First stop: we start standing there.
      const atStart = st.state === 'here' && !st.served && trip.current === 0;
      if ((stopDist < 0.6 && Math.abs(bus.u) < 0.15) || atStart) {
        this.state = 'doors';
        this.timer = 0.6;
      }
      return;
    }
    this.timer -= dt;
    if (this.state === 'doors' && this.timer <= 0) {
      if (st.stop.type === 'bay' || trip.onboard.some((p) => p.look.senior || p.stroller) || st.waiting.some((p) => p.look.senior || p.stroller || p.wheelchair)) bus.setKneel(true);
      bus.toggleAllDoors();
      this.state = 'exchange';
      this.timer = 2;
    } else if (this.state === 'exchange') {
      // Sell tickets like a good driver.
      if (trip.pendingSale) {
        this.saleTimer += dt;
        if (this.saleTimer > 1.5) {
          const req = trip.pendingSale.request;
          const fare = FARES.find((f) => f.id === req.fare);
          trip.sellTicket(fare.id, fare.price, roundCents(req.paid - fare.price));
          this.saleTimer = 0;
        }
      }
      const busy = st.waiting.length > 0 || trip.onboard.some((p) => p.to === trip.current || st.last) || bus.doors.some((d) => d.obstructed);
      if (busy) this.clearTimer = 1.6;
      else this.clearTimer = (this.clearTimer || 0) - dt;
      const early = !st.last && trip.clock < st.sched - 5;
      if (!busy && this.clearTimer <= 0 && !early && this.timer <= 0) {
        bus.setDoor(0, false);
        for (let i = 1; i < bus.doors.length; i++) bus.setDoor(i, false);
        this.state = 'closing';
        this.timer = 3.2;
      }
    } else if (this.state === 'closing') {
      if (bus.doors.some((d) => d.target > 0)) {
        // The door reversed (somebody stepped in): wait for them again.
        this.state = 'exchange';
        this.timer = 1;
        return;
      }
      if (this.timer > 0 || !bus.doorsFullyClosed) return;
      if (st.last) {
        this.state = 'done';
        return;
      }
      this.state = 'depart';
      this.timer = 1.6;
    } else if (this.state === 'depart' && this.timer <= 0) {
      // Mirror check: nobody alongside or closing in from behind in the lane.
      if (this.#laneBusy(env, st)) return;
      this.state = 'drive';
      this.departing = 5;
    }
  }
}
