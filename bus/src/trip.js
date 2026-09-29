// One scheduled trip on a line: passengers waiting, boarding and alighting, stop requests,
// ticket sales, the timetable, stop quality, passenger comfort and the final report.

import { mulberry32, clamp, wrapAngle } from './util.js';
import { randomLook } from './pedestrians.js';
import { makeRequest, PASSES, roundCents } from './tickets.js';
import { routeProgress } from './lines.js';

export const DIFFICULTY = {
  easy: { label: 'Einsteiger', blurb: 'Großzügiger Fahrplan, Fahrkarten automatisch, viele Tipps', schedule: 1.3, tickets: 'auto', engine: 'auto', hints: true, early: 60 },
  normal: { label: 'Normal', blurb: 'Fahrkarten selbst verkaufen, Tipps an', schedule: 1.12, tickets: 'manual', engine: 'auto', hints: true, early: 30 },
  pro: { label: 'Profi', blurb: 'Knapper Fahrplan, Motor selbst starten, keine Tipps', schedule: 1.0, tickets: 'manual', engine: 'manual', hints: false, early: 20 },
};

export const DAYTIME = {
  morning: { label: 'Morgens', clock: 7 * 3600 + 38 * 60, demand: 1.35, traffic: 1.15, sky: 'morning' },
  day: { label: 'Mittags', clock: 12 * 3600 + 8 * 60, demand: 1, traffic: 1, sky: 'day' },
  evening: { label: 'Abends', clock: 18 * 3600 + 34 * 60, demand: 1.05, traffic: 1, sky: 'evening' },
  night: { label: 'Nachts', clock: 22 * 3600 + 47 * 60, demand: 0.5, traffic: 0.45, sky: 'night' },
};

const GRADES = [
  { min: 92, grade: 1, text: 'sehr gut', bonus: 0.3 },
  { min: 81, grade: 2, text: 'gut', bonus: 0.15 },
  { min: 67, grade: 3, text: 'befriedigend', bonus: 0 },
  { min: 50, grade: 4, text: 'ausreichend', bonus: -0.1 },
  { min: 30, grade: 5, text: 'mangelhaft', bonus: -0.25 },
  { min: -Infinity, grade: 6, text: 'ungenügend', bonus: -0.4 },
];

export function gradeFor(score) {
  return GRADES.find((g) => score >= g.min);
}

const RUNNING_COST = { solo: 0.9, midi: 0.75, electric: 0.45, articulated: 1.25 };
const PAY_FACTOR = { solo: 1, midi: 0.95, electric: 1.1, articulated: 1.2 };

let PID = 1;

export class Trip {
  constructor(city, route, { bus, difficulty = 'normal', daytime = 'day', seed = 1 } = {}) {
    this.city = city;
    this.route = route;
    this.bus = bus;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.daytime = DAYTIME[daytime] || DAYTIME.day;
    this.rng = mulberry32(seed * 7919 + route.tripId.length * 131);
    this.clock = this.daytime.clock;
    this.depart = this.clock + 60;
    this.events = [];
    this.people = []; // passengers outside the bus (drawn in the world)
    this.onboard = [];
    this.progress = route.stops[0].dist;
    this.lateral = 0;
    this.offRoute = 0;
    this.offRouteFlag = false;
    this.finished = false;
    this.aborted = false;
    this.revenue = 0;
    this.ticketsSold = 0;
    this.ticketErrors = 0;
    this.transported = 0;
    this.comfort = 100;
    this.satisfaction = 82;
    this.stopScores = [];
    this.pendingSale = null;
    this.stopRequest = false;
    this.hint = '';
    this.totalDwell = 0;
    this.stops = route.stops.map((rs, k) => ({
      ...rs,
      name: rs.stop.name,
      sched: this.depart + Math.round((rs.sched * this.diff.schedule) / 60) * 60,
      waiting: [],
      spawned: false,
      state: 'ahead', // ahead | here | done | skipped
      arrived: null,
      departed: null,
      served: false,
      last: k === route.stops.length - 1,
      delay: null,
      quality: null,
    }));
    this.current = 0; // index of the stop we are at or heading to
    this.stops[0].state = 'here';
    this.#spawnStop(0);
    for (let k = 1; k < this.stops.length; k++) if (this.stops[k].dist - this.progress < 260) this.#spawnStop(k);
  }

  get nextStop() {
    return this.stops[this.current];
  }

  // ------------------------------------------------------------ passengers

  #spawnStop(k) {
    const st = this.stops[k];
    if (st.spawned) return;
    st.spawned = true;
    if (st.last) return;
    const rng = this.rng;
    const remaining = this.stops.length - 1 - k;
    const base = st.stop.demand * this.daytime.demand * (k === 0 ? 1.5 : 1);
    let n = Math.round(base * (1.2 + rng() * 3.8));
    if (k > 0 && rng() < 0.18 / base) n = 0; // sometimes nobody is waiting
    n = clamp(n, 0, 14);
    for (let i = 0; i < n; i++) {
      // Destination: mostly a few stops ahead.
      const hop = 1 + Math.min(remaining - 1, Math.floor(Math.pow(rng(), 1.6) * remaining));
      const look = randomLook(rng);
      const special = rng();
      const p = {
        id: PID++,
        look,
        from: k,
        to: k + hop,
        state: 'waiting',
        x: 0,
        z: 0,
        yaw: 0,
        phase: rng() * 10,
        moving: 0,
        stroller: !look.kid && special < 0.06,
        wheelchair: !look.kid && special >= 0.06 && special < 0.085,
        pass: null,
        request: null,
        timer: 0,
      };
      if (p.stroller || p.wheelchair) p.look.bag = false;
      if (look.kid) p.pass = rng() < 0.6 ? 'Schülerticket' : null;
      else p.pass = rng() < 0.62 ? PASSES[Math.floor(rng() * PASSES.length)] : null;
      if (look.senior && rng() < 0.5) p.pass = 'Seniorenkarte';
      if (!p.pass) p.request = makeRequest(rng, { kid: look.kid, stopsToGo: hop });
      this.#placeWaiting(p, st);
      st.waiting.push(p);
      this.people.push(p);
    }
  }

  #stopFrame(st) {
    const s = st.stop;
    const lane = this.city.lanes[s.lane];
    return { lane, s };
  }

  #placeWaiting(p, st) {
    const { lane, s } = this.#stopFrame(st);
    const along = -1.5 - this.rng() * 10;
    const depth = s.type === 'bay' ? 0.6 + this.rng() * 0.7 : 1.2 + this.rng() * 1.8;
    const q = lane.path.at(s.sFront + along);
    p.x = q.x + s.rx * (s.curbOffset + depth);
    p.z = q.z + s.rz * (s.curbOffset + depth);
    p.yaw = Math.atan2(-s.rx, -s.rz) + (this.rng() - 0.5) * 1.2;
    p.home = [p.x, p.z];
  }

  // Door the passenger uses: wheelchairs and prams at door 2, everybody else boards at the front.
  #boardDoor(p) {
    const bus = this.bus;
    if ((p.stroller || p.wheelchair) && bus.doors.length > 1) return 1;
    return 0;
  }

  #alightDoor() {
    const bus = this.bus;
    // Prefer the rear doors if open.
    for (let i = bus.doors.length - 1; i >= 1; i--) if (bus.doors[i].open > 0.9) return i;
    if (bus.doors[0].open > 0.9) return 0;
    return -1;
  }

  #doorPoint(i, out = 0.7) {
    const d = this.bus.doorPos(i);
    const s = Math.sin(this.bus.yaw);
    const c = Math.cos(this.bus.yaw);
    // right of the bus = -left = (-c, s)
    return [d[0] - c * out, d[1] + s * out];
  }

  // ------------------------------------------------------------ main update

  // ctx: { signalled: -1/0/1, kneeling }
  update(dt, ctx = {}) {
    const bus = this.bus;
    this.clock += dt;
    const route = this.route;
    // Progress along the route (front of the bus).
    const f = bus.frontPos();
    let pr = routeProgress(route, f[0], f[1], this.progress, 70);
    if (pr.d > 12) {
      // Lost? Search the whole route (cheap enough once in a while).
      const g = routeProgress(route, f[0], f[1], route.length / 2, route.length);
      if (g.d < pr.d) pr = g;
    }
    this.lateral = pr.d;
    if (pr.d < 14) this.progress = pr.s;
    if (pr.d > 14 && Math.abs(bus.u) > 0.5) {
      this.offRoute += dt;
      if (this.offRoute > 3 && !this.offRouteFlag) {
        this.offRouteFlag = true;
        this.events.push({ type: 'fault', code: 'offRoute' });
      }
    } else if (pr.d < 8) {
      this.offRoute = 0;
      this.offRouteFlag = false;
    }

    // Spawn passengers at stops coming up.
    for (let k = this.current; k < this.stops.length; k++) {
      if (this.stops[k].dist - this.progress < 260) this.#spawnStop(k);
    }

    this.#serveStops(dt, ctx);
    this.#movePeople(dt);
    this.#comfort(dt);
    this.#requests();
    this.#hints(ctx);
  }

  #atStopZone(st) {
    const bus = this.bus;
    const along = this.progress - st.dist;
    if (along < -15 || along > 7) return null;
    // Gap between the door side of the bus and the curb at the front door.
    const { lane, s } = this.#stopFrame(st);
    const d = bus.doorPos(0);
    const q = lane.path.nearest(d[0], d[1]);
    const cp = lane.path.at(q.s);
    const curbX = cp.x + s.rx * s.curbOffset;
    const curbZ = cp.z + s.rz * s.curbOffset;
    const gap = (curbX - d[0]) * s.rx + (curbZ - d[1]) * s.rz;
    const yawErr = Math.abs(wrapAngle(bus.yaw - s.yaw));
    return { along, gap, yawErr };
  }

  get inStopZone() {
    const st = this.nextStop;
    if (!st) return false;
    const z = this.#atStopZone(st);
    return !!z && z.gap < 3 && z.along > -14 && z.along < 6;
  }

  #serveStops(dt, ctx) {
    const bus = this.bus;
    const st = this.stops[this.current];
    if (!st) return;
    const zone = this.#atStopZone(st);
    const stopped = Math.abs(bus.u) < 0.3;
    const doorsOpen = bus.doors.some((d) => d.open > 0.9);
    const here = zone && zone.gap < 3 && zone.along > -14 && zone.along < 6;

    if (st.state === 'ahead' && here && stopped && (doorsOpen || bus.doors.some((d) => d.target > 0))) {
      st.state = 'here';
      st.arrived = this.clock;
      st.quality = this.#rateStop(zone);
      this.events.push({ type: 'arrive', stop: st });
    }
    if (st.state === 'here') {
      if (doorsOpen && stopped && here) {
        st.served = true;
        this.totalDwell += dt;
        this.#exchange(dt, st, zone);
      }
      // Terminus: done when everybody got off and the doors are shut again.
      if (st.last && st.served && this.onboard.length === 0 && bus.doorsFullyClosed) {
        this.#departStop(st, ctx);
        return;
      }
      // Leaving the stop.
      const gone = this.progress - st.dist > 8 || (!here && Math.abs(bus.u) > 1.2 && this.progress > st.dist - 15);
      if (gone && bus.doorsFullyClosed) this.#departStop(st, ctx);
    } else if (st.state === 'ahead') {
      // Passed without stopping?
      if (this.progress - st.dist > 8) {
        const needed = st.waiting.length > 0 || this.onboard.some((p) => p.to === this.current);
        if (needed || st.last) {
          st.state = 'skipped';
          this.events.push({ type: 'fault', code: 'skippedStop', detail: st.name });
          // Passengers who wanted to get off ride on to the next stop and complain.
          for (const p of this.onboard) if (p.to === this.current) p.to = Math.min(this.stops.length - 1, p.to + 1);
          for (const p of st.waiting) p.state = 'gone';
          st.waiting = [];
          this.satisfaction -= 12;
        } else {
          st.state = 'done';
        }
        if (st.last) {
          this.#finish();
          return;
        }
        this.#advance();
      }
    }
  }

  #rateStop(zone) {
    const along = Math.abs(zone.along);
    const gap = Math.max(0, zone.gap);
    let score = 100;
    score -= Math.max(0, along - 1.5) * 7;
    score -= Math.max(0, gap - 0.3) * 45;
    score -= zone.yawErr > 0.12 ? 15 : 0;
    score = clamp(score, 0, 100);
    const text = score >= 85 ? 'Perfekt gehalten' : score >= 60 ? 'Gut gehalten' : score >= 35 ? 'Etwas ungenau gehalten' : 'Schlecht gehalten';
    if (score < 35) this.events.push({ type: 'fault', code: 'badStop' });
    return { score, along: zone.along, gap: zone.gap, text };
  }

  #departStop(st, ctx) {
    st.departed = this.clock;
    st.state = 'done';
    st.delay = st.departed - st.sched;
    // People who were still waiting are left behind.
    const left = st.waiting.filter((p) => p.state === 'waiting' || p.state === 'toDoor' || p.state === 'queue');
    if (left.length && !st.last) {
      this.events.push({ type: 'fault', code: 'leftBehind', detail: `${left.length}` });
      this.satisfaction -= 4 * left.length;
      for (const p of left) {
        p.state = 'leaving';
        p.target = p.home;
      }
    }
    if (st.served && st.delay < -this.diff.early && this.current > 0) this.events.push({ type: 'fault', code: 'early', detail: `${Math.round(-st.delay)} s` });
    if (st.served && this.current === 0 && st.delay < -this.diff.early) this.events.push({ type: 'fault', code: 'early', detail: `${Math.round(-st.delay)} s` });
    if (st.served && st.quality) this.stopScores.push(st.quality.score);
    this.events.push({ type: 'depart', stop: st, signalled: ctx.departSignalled });
    if (st.last) {
      this.#finish();
      return;
    }
    this.#advance();
  }

  #advance() {
    this.current++;
    this.stopRequest = false;
    this.requestAt = [];
    const st = this.stops[this.current];
    if (!st) return;
    // Passengers for the next stop press the button a little after departure.
    for (const p of this.onboard) {
      if (p.to === this.current) p.requestTime = this.clock + 6 + this.rng() * 30;
    }
  }

  #requests() {
    if (this.stopRequest) return;
    for (const p of this.onboard) {
      if (p.to === this.current && p.requestTime && this.clock >= p.requestTime) {
        this.stopRequest = true;
        this.events.push({ type: 'stopRequest' });
        break;
      }
    }
  }

  // Alighting first, then boarding (front door; prams/wheelchairs at door 2).
  #exchange(dt, st, zone) {
    const bus = this.bus;
    const k = this.current;
    // Alighting.
    const leaving = this.onboard.filter((p) => p.to === k || st.last);
    const aDoor = this.#alightDoor();
    if (leaving.length && aDoor >= 0) {
      this.doorTimer = (this.doorTimer || 0) - dt;
      if (this.doorTimer <= 0) {
        const p = leaving[0];
        const slow = p.stroller || p.wheelchair || p.look.senior;
        const kneel = bus.kneel > 0.9;
        this.doorTimer = (slow ? (kneel ? 2.2 : 4.5) : 1.1) + this.rng() * 0.5;
        if (slow && kneel) this.satisfaction += 1.5;
        this.onboard.splice(this.onboard.indexOf(p), 1);
        const d = this.#doorPoint(p.stroller || p.wheelchair ? Math.min(1, bus.doors.length - 1) : aDoor, 0.4);
        p.x = d[0];
        p.z = d[1];
        p.state = 'leaving';
        p.moving = 1;
        const s = st.stop;
        p.target = [d[0] + s.rx * (3 + this.rng() * 2) + s.fx * (this.rng() - 0.5) * 8, d[1] + s.rz * (3 + this.rng() * 2) + s.fz * (this.rng() - 0.5) * 8];
        p.fade = 6;
        this.people.push(p);
        this.transported++;
        this.#obstruct(aDoor, 0.9);
        this.events.push({ type: 'alight', passenger: p });
      }
      return; // board after everybody got off
    }
    if (st.last) return;
    // Boarding: send waiting passengers to their door when it is open and the bus is reachable.
    const reachable = zone.gap < 2.2 && zone.along > -10 && zone.along < 4;
    for (const p of st.waiting) {
      if (p.state !== 'waiting') continue;
      const door = this.#boardDoor(p);
      if (!reachable || bus.doors[door].open < 0.9) continue;
      if (this.onboard.length + this.#boardingCount(st) >= bus.spec.capacity) continue;
      // Queue along the bus side behind the door.
      const queued = st.waiting.filter((q) => q !== p && q.door === door && (q.state === 'toDoor' || q.state === 'queue')).length;
      const dp = this.#doorPoint(door, 0.8 + this.rng() * 0.3);
      p.state = 'toDoor';
      p.door = door;
      p.moving = 1;
      p.target = [dp[0] - Math.sin(bus.yaw) * 0.7 * queued, dp[1] - Math.cos(bus.yaw) * 0.7 * queued];
    }
  }

  #boardingCount(st) {
    return st.waiting.filter((p) => p.state === 'toDoor' || p.state === 'queue' || p.state === 'boarding' || p.state === 'ticket').length;
  }

  #obstruct(door, time) {
    this.obstructions = this.obstructions || [0, 0, 0, 0];
    this.obstructions[door] = Math.max(this.obstructions[door], time);
  }

  #movePeople(dt) {
    const bus = this.bus;
    const st = this.stops[this.current];
    this.obstructions = this.obstructions || [0, 0, 0, 0];
    for (let i = 0; i < this.obstructions.length; i++) this.obstructions[i] = Math.max(0, this.obstructions[i] - dt);
    const doorBusy = [false, false, false, false];
    for (const p of this.people) {
      p.phase += (p.moving ? 1.35 : 0) * dt * 1.9;
      if (p.state === 'toDoor' || p.state === 'leaving') {
        const [tx, tz] = p.target;
        const dx = tx - p.x;
        const dz = tz - p.z;
        const d = Math.hypot(dx, dz);
        const speed = p.state === 'toDoor' ? 1.3 : 1.1;
        if (d > 0.05) {
          const step = Math.min(d, speed * dt);
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          p.yaw = Math.atan2(dx, dz);
          p.moving = 1;
        } else p.moving = 0;
        if (p.state === 'toDoor' && d < 0.15) {
          p.state = 'queue';
          p.moving = 0;
        }
        if (p.state === 'leaving') {
          p.fade -= dt;
          if (p.fade <= 0 || (d < 0.1 && p.fade < 4)) p.state = 'gone';
        }
        // The bus left: walk back.
        if (p.state === 'toDoor' && (bus.doors[p.door].target < 0.5 || Math.abs(bus.u) > 0.5)) {
          p.state = 'waiting';
          p.target = null;
        }
      }
      if (p.state === 'queue' || p.state === 'boarding' || p.state === 'ticket') {
        const door = p.door;
        const open = bus.doors[door].open > 0.9;
        if (p.state === 'queue') {
          if (!open) {
            p.state = 'waiting';
            continue;
          }
          if (doorBusy[door] || this.obstructions[door] > 0) continue;
          doorBusy[door] = true;
          // Step into the door.
          const dp = this.#doorPoint(door, 0.1);
          p.x = dp[0];
          p.z = dp[1];
          p.yaw = bus.yaw + Math.PI / 2;
          const kneel = bus.kneel > 0.9;
          const slow = p.stroller || p.wheelchair || p.look.senior;
          if (p.request && door === 0) {
            p.state = 'ticket';
            p.timer = this.diff.tickets === 'auto' ? 2.6 + this.rng() * 1.5 : Infinity;
            if (this.diff.tickets !== 'auto') {
              this.pendingSale = { passenger: p, request: p.request, started: this.clock };
              this.events.push({ type: 'ticketRequest', passenger: p });
            }
          } else {
            p.state = 'boarding';
            p.timer = (slow ? (kneel ? 2 : 4.2) : 0.9) + this.rng() * 0.5 + (p.pass ? 0.4 : 0);
            if (slow && kneel) this.satisfaction += 1.5;
            if (p.pass) this.events.push({ type: 'pass', passenger: p, pass: p.pass });
          }
        } else {
          doorBusy[door] = true;
          this.#obstruct(door, 0.3);
          p.timer -= dt;
          if (p.state === 'ticket' && this.diff.tickets === 'auto' && p.timer <= 0) {
            this.revenue += p.request.price;
            this.ticketsSold++;
            p.request = null;
            p.state = 'boarding';
            p.timer = 0.6;
          } else if (p.state === 'boarding' && p.timer <= 0) {
            p.state = 'onboard';
            this.onboard.push(p);
            if (st) st.waiting = st.waiting.filter((q) => q !== p);
            this.events.push({ type: 'board', passenger: p });
          }
        }
      }
    }
    this.people = this.people.filter((p) => p.state !== 'onboard' && p.state !== 'gone');
    // Tell the doors who is standing in them (sensitive edges).
    for (let i = 0; i < bus.doors.length; i++) bus.doors[i].obstructed = this.obstructions[i] > 0 || doorBusy[i];
  }

  // Player sold a ticket: fare id and the change handed back.
  sellTicket(fareId, price, changeGiven) {
    const sale = this.pendingSale;
    if (!sale) return null;
    const p = sale.passenger;
    const req = sale.request;
    const correctFare = fareId === req.fare;
    const correctChange = Math.abs(roundCents(changeGiven) - roundCents(req.paid - price)) < 0.005;
    let result;
    const due = roundCents(req.paid - price);
    if (correctFare && correctChange) {
      this.revenue += price;
      this.satisfaction += 1;
      result = { ok: true, text: 'Danke schön!' };
    } else if (!correctFare) {
      this.revenue += Math.min(price, req.price);
      this.ticketErrors++;
      this.satisfaction -= 5;
      result = { ok: false, text: 'Das ist aber nicht die Fahrkarte, die ich wollte …' };
    } else if (changeGiven < due) {
      // Too little change: the passenger complains, the difference is refunded.
      this.revenue += price;
      this.ticketErrors++;
      this.satisfaction -= 6;
      result = { ok: false, text: `Da fehlt noch Wechselgeld! (${(due - changeGiven).toFixed(2).replace('.', ',')} €)` };
    } else {
      this.revenue += roundCents(req.paid - changeGiven);
      this.ticketErrors++;
      result = { ok: false, text: 'Oh, zu viel Wechselgeld – danke!' };
    }
    this.ticketsSold++;
    p.request = null;
    p.state = 'boarding';
    p.timer = 0.6;
    this.pendingSale = null;
    this.events.push({ type: 'sale', result });
    return result;
  }

  #comfort(dt) {
    const bus = this.bus;
    const standing = Math.max(0, this.onboard.length - bus.spec.seats);
    const weight = this.onboard.length ? 1 + standing / 20 : 0.25;
    const along = Math.abs(bus.aLong);
    const lat = Math.abs(bus.aLat);
    const jerk = Math.abs(bus.jerk);
    let loss = 0;
    if (along > 1.6) loss += (along - 1.6) * 2.2;
    if (lat > 1.9) loss += (lat - 1.9) * 2.6;
    if (jerk > 6) loss += (jerk - 6) * 0.08;
    const bonus = bus.spec.comfortBonus || 1;
    this.comfort = clamp(this.comfort - (loss * weight * dt) / bonus, 0, 100);
    this.comfortNow = loss;
    this.satisfaction = clamp(this.satisfaction - loss * weight * dt * 0.3, 0, 100);
  }

  #hints(ctx) {
    const bus = this.bus;
    const st = this.nextStop;
    this.hint = '';
    if (!st || this.finished) return;
    const dist = st.dist - this.progress;
    if (this.pendingSale) {
      this.hint = 'Fahrgast möchte eine Fahrkarte: Ticket wählen, Wechselgeld geben.';
      return;
    }
    if (st.state === 'here') {
      const waiting = st.waiting.some((p) => p.state !== 'onboard');
      const leaving = this.onboard.some((p) => p.to === this.current);
      if (!bus.doorsOpen && (waiting || leaving || this.current === 0)) this.hint = 'Türen öffnen: Leertaste';
      else if (bus.doorsOpen && !waiting && !leaving) {
        const wait = st.sched - this.clock;
        if (st.last) this.hint = 'Alle ausgestiegen – Türen schließen, Fahrt beendet.';
        else if (wait > 5) this.hint = `Abfahrt um ${fmtClock(st.sched)} – noch warten`;
        else this.hint = 'Alle eingestiegen: Türen schließen (Leertaste), links blinken (Q), losfahren';
      } else if (bus.doorsOpen) this.hint = 'Fahrgäste steigen ein und aus …';
      if (!bus.doorsOpen && !waiting && !leaving && this.current > 0) this.hint = 'Links blinken (Q) und abfahren';
      if (this.current === 0 && !bus.doorsOpen && st.served) this.hint = 'Links blinken (Q) und abfahren';
      return;
    }
    void ctx;
    const need = st.waiting.length > 0 || this.onboard.some((p) => p.to === this.current) || st.last;
    if (dist < 140 && dist > -8) {
      if (need) this.hint = `${st.name}: rechts ranfahren, im gelben Haltebereich anhalten`;
      else this.hint = `${st.name}: niemand wartet, kein Haltewunsch – durchfahren`;
    }
  }

  #finish() {
    if (this.finished) return;
    this.finished = true;
    this.events.push({ type: 'finished' });
  }

  abort() {
    this.aborted = true;
    this.finished = true;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------ report

  report(rules, busSpec) {
    const served = this.stops.filter((s) => s.served);
    const delays = this.stops.filter((s) => s.delay !== null && s.served).map((s) => s.delay);
    const punctual = delays.length ? delays.reduce((a, d) => a + clamp(100 - Math.max(0, d - 60) / 1.8, 0, 100), 0) / delays.length : 100;
    const driving = clamp(100 - rules.points, 0, 100);
    const stopQ = this.stopScores.length ? this.stopScores.reduce((a, b) => a + b, 0) / this.stopScores.length : 100;
    const comfort = (this.comfort + this.satisfaction) / 2;
    const ticketQ = clamp(100 - this.ticketErrors * 15, 0, 100);
    const service = (stopQ * 2 + ticketQ) / 3;
    let score = driving * 0.45 + punctual * 0.2 + comfort * 0.15 + service * 0.2;
    if (this.aborted) score = Math.min(score, 25);
    score = Math.round(clamp(score, 0, 100));
    const g = gradeFor(score);
    const km = (this.route.endDist - this.route.startDist) / 1000;
    const basePay = this.aborted ? 0 : Math.round((km * 55 + served.length * 25) * (PAY_FACTOR[busSpec.id] || 1));
    const passengerBonus = this.aborted ? 0 : Math.round(this.transported * 0.6);
    const qualityBonus = Math.round((basePay + this.revenue) * g.bonus);
    const running = Math.round(((this.bus.distance / 1000) * (RUNNING_COST[busSpec.id] || 1)) * 10) / 10;
    const fines = rules.fines;
    const total = Math.round(basePay + this.revenue + passengerBonus + qualityBonus - running - fines);
    const last = this.stops[this.stops.length - 1];
    return {
      score,
      grade: g.grade,
      gradeText: g.text,
      parts: { driving: Math.round(driving), punctual: Math.round(punctual), comfort: Math.round(comfort), service: Math.round(service) },
      faults: rules.faults.slice(),
      points: rules.points,
      money: { basePay, tickets: roundCents(this.revenue), passengerBonus, qualityBonus, running, fines, total },
      transported: this.transported,
      ticketsSold: this.ticketsSold,
      stops: this.stops.map((s) => ({ name: s.name, sched: s.sched, departed: s.departed, arrived: s.arrived, delay: s.delay, served: s.served, state: s.state, quality: s.quality })),
      finalDelay: last.arrived ? last.arrived - last.sched : null,
      km,
      aborted: this.aborted,
    };
  }
}

export function fmtClock(t) {
  const s = ((Math.floor(t) % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}
