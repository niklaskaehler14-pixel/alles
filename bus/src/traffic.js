// AI road traffic: cars follow lanes and junction paths with the Intelligent Driver Model,
// obey traffic lights (incl. red-yellow), stop and yield signs, right-before-left, give way
// to oncoming traffic when turning left and never enter a junction while a conflicting
// movement is inside. The player's bus, pedestrians on crossings and crashed cars are
// handled as geometric obstacles along the planned path.

import { signalState, DIRS, leftOf, opposite } from './citymap.js';
import { clamp, mulberry32, pointInBox, boxOverlap } from './util.js';

export const CAR_TYPES = [
  { id: 'sedan', length: 4.7, width: 1.82, height: 1.45, weight: 5 },
  { id: 'hatch', length: 4.1, width: 1.76, height: 1.5, weight: 5 },
  { id: 'suv', length: 4.7, width: 1.9, height: 1.7, weight: 3 },
  { id: 'van', length: 5.3, width: 2.0, height: 2.3, weight: 2 },
  { id: 'taxi', length: 4.9, width: 1.84, height: 1.47, weight: 1.3 },
  { id: 'truck', length: 7.6, width: 2.45, height: 3.2, weight: 0.8 },
];

const CAR_COLORS = ['#e7e7e4', '#1d1f24', '#8c9197', '#b8bcc0', '#2f4d7a', '#7a1f24', '#3d5a44', '#c4c7ca', '#5b6068', '#a3782e', '#1f3a5f', '#d8d2c4'];

const LANE = 0;
const MOVE = 1;
const DODGE = 0.85; // how far a car moves to the right edge of its lane to pass a bus
const IDM = { a: 1.5, b: 2.2, s0: 2.2, T: 1.35 };
// Comfortable speed through a junction path: ~2.2 m/s² sideways.
const turnSpeed = (mv) => (mv.turn === 'straight' ? 14 : Math.min(13, Math.sqrt(2.2 * mv.radius)));

export class Traffic {
  constructor(city, { seed = 7, count = 24 } = {}) {
    this.city = city;
    this.rng = mulberry32(seed);
    this.target = count;
    this.vehicles = [];
    this.nextId = 1;
    this.onPiece = new Map();
    this.nodeOcc = new Map();
    this.events = [];
    this.spawnTimer = 0;
    this.radius = 380;
    this.typeWeights = CAR_TYPES.reduce((s, t) => s + t.weight, 0);
  }

  path(v) {
    return v.kind === LANE ? this.city.lanes[v.id].path : this.city.movements[v.id].path;
  }

  #key(kind, id) {
    return kind === LANE ? id : 100000 + id;
  }

  #pickType() {
    let r = this.rng() * this.typeWeights;
    for (const t of CAR_TYPES) {
      r -= t.weight;
      if (r <= 0) return t;
    }
    return CAR_TYPES[0];
  }

  #chooseMovement(laneId) {
    const lane = this.city.lanes[laneId];
    const opts = lane.movements.map((id) => this.city.movements[id]);
    let total = 0;
    const w = opts.map((m) => {
      let x = m.turn === 'straight' ? 2.2 : 1;
      // Avoid streets that are backed up to the junction.
      const out = this.onPiece.get(m.outLane);
      if (out && out.length && out[0].s < 18) x *= 0.08;
      total += x;
      return x;
    });
    let r = this.rng() * total;
    for (let i = 0; i < opts.length; i++) {
      r -= w[i];
      if (r <= 0) return opts[i].id;
    }
    return opts[opts.length - 1].id;
  }

  // Remove all cars and populate lanes around (x, z).
  reset(x, z, avoid = null) {
    this.vehicles = [];
    for (let k = 0; k < this.target * 4 && this.vehicles.length < this.target; k++) this.#trySpawn(x, z, 30, this.radius, avoid);
    this.#rebuild();
  }

  #trySpawn(cx, cz, minD, maxD, avoid) {
    const lanes = this.city.lanes;
    const lane = lanes[Math.floor(this.rng() * lanes.length)];
    const len = lane.path.length;
    const s = 6 + this.rng() * Math.max(1, len - 30);
    const p = lane.path.at(s);
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d < minD || d > maxD) return false;
    const type = this.#pickType();
    for (const o of this.vehicles) {
      if (Math.hypot(o.x - p.x, o.z - p.z) < 14) return false;
    }
    const hl = type.length / 2;
    const hw = type.width / 2;
    if (avoid) {
      for (const b of avoid) if (boxOverlap({ x: p.x, z: p.z, yaw: p.yaw, hl: hl + 6, hw: hw + 1 }, b)) return false;
    }
    const colour = type.id === 'taxi' ? '#efe6c9' : CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)];
    const desired = (lane.speed / 3.6) * (0.86 + this.rng() * 0.2);
    const v = {
      uid: this.nextId++,
      type: type.id,
      spec: type,
      color: colour,
      hl,
      hw,
      kind: LANE,
      id: lane.id,
      s,
      v: desired * 0.8,
      desired,
      desiredFactor: desired / (lane.speed / 3.6),
      next: this.#chooseMovement(lane.id),
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      acc: 0,
      braking: false,
      indicator: 0,
      wait: 0,
      permit: false,
      committed: false,
      stopDone: false,
      crashed: 0,
      hazard: false,
      spin: 0,
      pitch: 0,
      fade: 0,
      lat: 0,
      dodge: 0,
    };
    this.vehicles.push(v);
    return true;
  }

  #rebuild() {
    this.onPiece.clear();
    this.nodeOcc.clear();
    for (const v of this.vehicles) {
      const k = this.#key(v.kind, v.id);
      let arr = this.onPiece.get(k);
      if (!arr) this.onPiece.set(k, (arr = []));
      arr.push(v);
      if (v.kind === MOVE) {
        const n = this.city.movements[v.id].node;
        let set = this.nodeOcc.get(n);
        if (!set) this.nodeOcc.set(n, (set = new Set()));
        set.add(v);
      }
    }
    for (const arr of this.onPiece.values()) arr.sort((a, b) => a.s - b.s);
  }

  // Nearest vehicle ahead on the same piece or the next pieces. Returns {gap, speed}.
  #leader(v) {
    const city = this.city;
    const list = this.onPiece.get(this.#key(v.kind, v.id)) || [];
    for (const o of list) {
      if (o !== v && o.s > v.s) return { gap: o.s - v.s - o.hl - v.hl, speed: o.v, veh: o };
    }
    let dist = this.path(v).length - v.s;
    // Next pieces: the chosen movement (if on a lane), then its outgoing lane.
    const chain = [];
    if (v.kind === LANE) {
      chain.push([MOVE, v.next]);
      chain.push([LANE, city.movements[v.next].outLane]);
    } else {
      chain.push([LANE, city.movements[v.id].outLane]);
    }
    for (const [kind, id] of chain) {
      const arr = this.onPiece.get(this.#key(kind, id));
      if (arr && arr.length) {
        const o = arr[0];
        return { gap: dist + o.s - o.hl - v.hl, speed: o.v, veh: o };
      }
      dist += kind === LANE ? city.lanes[id].path.length : city.movements[id].path.length;
      if (dist > 120) break;
    }
    return null;
  }

  // Vehicle closest to the stop line on a lane (arriving first).
  #front(laneId) {
    const arr = this.onPiece.get(laneId);
    return arr && arr.length ? arr[arr.length - 1] : null;
  }

  #tta(o) {
    const d = this.city.lanes[o.id].path.length - o.s - o.hl;
    return d / Math.max(o.v, 0.8);
  }

  #nodeHasConflict(nodeId, mv, self) {
    const set = this.nodeOcc.get(nodeId);
    if (!set) return false;
    for (const o of set) {
      if (o === self) continue;
      if (mv.conflicts.has(o.id)) return true;
    }
    return false;
  }

  // Vehicles on a lane that reach the stop line within `maxTta` seconds (front first).
  #approaching(laneId, maxTta) {
    const arr = this.onPiece.get(laneId);
    const out = [];
    if (!arr) return out;
    for (let i = arr.length - 1; i >= 0; i--) {
      const o = arr[i];
      if (o.kind !== LANE || o.id !== laneId) continue; // already moved on this frame
      const tta = this.#tta(o);
      if (tta > maxTta) break;
      out.push(o);
    }
    return out;
  }

  // Would entering movement `mv` now be allowed?
  #mayEnter(v, mv, t, env, distToLine) {
    const city = this.city;
    const lane = city.lanes[v.id];
    const node = city.nodes[mv.node];
    const ctl = lane.endControl;
    if (ctl === 'signal') {
      const st = signalState(node.signal, lane.signalGroup, t);
      if (st === 'red' || st === 'redyellow') return false;
      if (st === 'yellow' && distToLine > (v.v * v.v) / (2 * 3.2) + 1) return false;
    }
    if (ctl === 'stop' && !v.stopDone) return false;
    if (this.#nodeHasConflict(node.id, mv, v)) return false;
    // Room behind the junction.
    const outList = this.onPiece.get(mv.outLane);
    if (outList && outList.length && outList[0].s - outList[0].hl < v.hl * 2 + 3) return false;
    // The bus in the junction blocks every path it covers – with room for its swinging tail.
    if (env.busBoxes && this.#pathBlocked(mv.path, 0, mv.path.length, env.busBoxes, v.hw + (mv.turn === 'straight' ? 0.6 : 1.6))) return false;
    // ... and so does the path the moving bus is about to take through it.
    if (env.busFuture && this.#pathBlocked(mv.path, 0, mv.path.length, env.busFuture, v.hw + 0.3)) return false;

    // Give way: collect the cars we have to let pass.
    const yieldTo = [];
    if (ctl === 'yield' || ctl === 'stop' || ctl === 'rbl') {
      for (const li of node.inLanes) {
        if (li === lane.id) continue;
        const other = city.lanes[li];
        if (ctl !== 'rbl' && other.endControl !== 'major') continue;
        if (ctl === 'rbl' && other.dir !== leftOf(lane.dir)) continue; // only traffic from the right
        // Impatient drivers accept smaller gaps after a long wait.
        const window = (ctl === 'rbl' ? 4.5 : 5.5) - clamp((v.wait - 20) / 20, 0, 1) * 1.8;
        for (const o of this.#approaching(li, window)) {
          if (mv.conflicts.has(o.next)) yieldTo.push(o);
        }
        // The bus coming along a priority lane has the right of way too.
        if (env.busApproach && env.busApproach.lane === li && env.busApproach.tta < window + 1) return false;
      }
    }
    if (mv.turn === 'left') {
      for (const li of node.inLanes) {
        const other = city.lanes[li];
        if (other.dir !== opposite(lane.dir)) continue;
        if (ctl === 'signal' && other.endControl === 'signal') {
          const st = signalState(node.signal, other.signalGroup, t);
          if (st === 'red' || st === 'redyellow') continue;
        }
        for (const o of this.#approaching(li, 5.5)) {
          if (city.movements[o.next].turn !== 'left') yieldTo.push(o);
        }
        const b = env.busApproach;
        if (b && b.lane === li && b.tta < 6 && b.turn !== 'left') return false;
      }
    }
    if (!yieldTo.length) return true;
    // Deadlock breaker (e.g. four cars at a right-before-left junction): if everybody we wait
    // for is standing at the line too, the one that has waited longest goes.
    if (v.wait < 2) return false;
    for (const o of yieldTo) {
      if (o.v > 0.4) return false;
      // Standing further back in a queue: that car cannot come before the one at the line.
      if (this.#tta(o) > 3.5) continue;
      if (o.wait > v.wait + 0.01 || (Math.abs(o.wait - v.wait) <= 0.01 && o.uid < v.uid)) return false;
    }
    return true;
  }

  #pathBlocked(path, s0, s1, boxes, margin) {
    const p = {};
    for (let s = s0; s <= s1; s += 1.5) {
      path.at(s, p);
      for (const b of boxes) if (pointInBox(p.x, p.z, b, margin)) return true;
    }
    return false;
  }

  // First geometric obstacle along the path ahead (bus, pedestrians, crashed cars).
  #obstacle(v, look, env) {
    const city = this.city;
    const pieces = [[v.kind, v.id, v.s]];
    if (v.kind === LANE) {
      pieces.push([MOVE, v.next, 0]);
      pieces.push([LANE, city.movements[v.next].outLane, 0]);
    } else pieces.push([LANE, city.movements[v.id].outLane, 0]);
    let travelled = 0;
    const p = {};
    const margin = v.hw + 0.45;
    // Cars squeeze past a bus a little closer on a straight lane; while turning the corners sweep out.
    const busMargin = v.hw + (v.kind === MOVE && this.city.movements[v.id].turn !== 'straight' ? 0.75 : 0.25);
    const busBoxes = env.busBoxes || [];
    const peds = env.pedestrians || [];
    const crashed = this.crashed;
    // Yield zones (bus pulling out of a stop): ignored by cars that are already alongside.
    const fx = v.x + Math.sin(v.yaw) * v.hl;
    const fz = v.z + Math.cos(v.yaw) * v.hl;
    const yields = (env.yieldBoxes || []).filter((b) => !pointInBox(fx, fz, b, 0.5) && !pointInBox(v.x, v.z, b, 0.5));
    for (let pi = 0; pi < pieces.length; pi++) {
      const [kind, id, s0] = pieces[pi];
      const path = kind === LANE ? city.lanes[id].path : city.movements[id].path;
      for (let s = pi === 0 ? s0 + v.hl : s0; s <= path.length; s += 1.25) {
        const d = travelled + (s - s0);
        if (d - v.hl > look) return null;
        path.at(s, p);
        for (let k = 0; k < busBoxes.length; k++) {
          const b = busBoxes[k];
          // Sample on the car's current lateral position (it may already be dodging).
          const lat = kind === LANE ? v.lat : 0;
          const px = p.x - p.dz * lat;
          const pz = p.z + p.dx * lat;
          if (!pointInBox(px, pz, b, busMargin)) continue;
          // On a straight lane a car can move over to the right edge of its lane to pass the bus.
          const canDodge = kind === LANE && !busBoxes.some((bb) => pointInBox(p.x - p.dz * DODGE, p.z + p.dx * DODGE, bb, busMargin));
          if (canDodge) {
            v.dodge = 1.5;
            if (Math.abs(v.lat - DODGE) < 0.05) continue;
            return { gap: Math.max(d - v.hl - 0.3, 3), speed: 1.5, bus: true, dodging: true };
          }
          return { gap: d - v.hl - 0.3, speed: Math.max(0, env.busSpeedAlong ? env.busSpeedAlong(p.dx, p.dz) : 0), bus: true };
        }
        for (let k = 0; k < yields.length; k++) {
          if (pointInBox(p.x, p.z, yields[k], 0.2)) return { gap: d - v.hl - 1, speed: 0, bus: true, courtesy: true };
        }
        for (let k = 0; k < peds.length; k++) {
          const q = peds[k];
          const dx = q.x - p.x;
          const dz = q.z - p.z;
          if (dx * dx + dz * dz < (margin + 0.5) ** 2) return { gap: d - v.hl - 0.6, speed: 0, ped: true };
        }
        for (let k = 0; k < crashed.length; k++) {
          const o = crashed[k];
          if (o === v) continue;
          if (pointInBox(p.x, p.z, o.box, margin)) return { gap: d - v.hl - 0.3, speed: 0 };
        }
        // Cars that entered the junction before us are obstacles if they sit on our path.
        if (kind === MOVE) {
          const occ = this.nodeOcc.get(city.movements[id].node);
          if (occ) {
            for (const o of occ) {
              if (o === v || (v.kind === MOVE && o.enteredAt >= v.enteredAt)) continue;
              if (o.kind === MOVE && o.id === id) continue; // same path: handled by car following
              if (pointInBox(p.x, p.z, { x: o.x, z: o.z, yaw: o.yaw, hl: o.hl, hw: o.hw }, margin - 0.2)) return { gap: d - v.hl - 0.5, speed: 0 };
            }
          }
        }
      }
      travelled += path.length - s0;
    }
    return null;
  }

  update(dt, t, env) {
    const city = this.city;
    this.#rebuild();
    this.crashed = this.vehicles.filter((v) => v.crashed > 0);
    for (const v of this.crashed) v.box = { x: v.x, z: v.z, yaw: v.yaw, hl: v.hl, hw: v.hw };
    const busX = env.busX ?? 0;
    const busZ = env.busZ ?? 0;

    // Process cars closest to their junction first so decisions see each other's entries.
    for (const v of this.vehicles) {
      if (v.crashed > 0) {
        v.crashed -= dt;
        v.v = Math.max(0, v.v - 8 * dt);
        v.hazard = true;
        v.braking = true;
        if (v.crashed <= 0) v.fade = 1;
        continue;
      }
      const path = this.path(v);
      let desired = v.desired;
      // Speed for the next turn.
      let turnLimit = Infinity;
      if (v.kind === LANE) {
        const mv = city.movements[v.next];
        const dist = path.length - v.s - v.hl;
        const vt = turnSpeed(mv);
        turnLimit = Math.sqrt(vt * vt + 2 * 1.4 * Math.max(0, dist));
        v.indicator = mv.turn === 'left' ? 1 : mv.turn === 'right' ? -1 : 0;
        if (dist > 45) v.indicator = 0;
        const lane = city.lanes[v.id];
        desired = (lane.speed / 3.6) * v.desiredFactor;
      } else {
        const mv = city.movements[v.id];
        turnLimit = turnSpeed(mv);
        v.indicator = mv.turn === 'left' ? 1 : mv.turn === 'right' ? -1 : 0;
      }
      desired = Math.min(desired, turnLimit);

      // IDM free road term.
      let acc = IDM.a * (1 - Math.pow(Math.max(v.v, 0) / Math.max(desired, 0.1), 4));
      const idmTo = (gap, lv, s0 = IDM.s0) => {
        const g = Math.max(gap, 0.1);
        const ss = s0 + Math.max(0, v.v * IDM.T + (v.v * (v.v - lv)) / (2 * Math.sqrt(IDM.a * IDM.b)));
        return IDM.a * (1 - Math.pow(Math.max(v.v, 0) / Math.max(desired, 0.1), 4) - (ss / g) * (ss / g));
      };
      const lead = this.#leader(v);
      if (lead && lead.gap < 80) acc = Math.min(acc, idmTo(lead.gap, lead.speed));

      // Junction entry.
      if (v.kind === LANE) {
        const mv = city.movements[v.next];
        const distToLine = path.length - v.s - v.hl;
        const lane = city.lanes[v.id];
        if (lane.endControl === 'stop' && distToLine < 2.5 && v.v < 0.3) {
          v.stopTimer = (v.stopTimer || 0) + dt;
          if (v.stopTimer > 0.8) v.stopDone = true;
        }
        const decide = distToLine < Math.max(28, (v.v * v.v) / 3 + 12);
        if (decide && !v.committed) {
          v.permit = lane.endControl === 'none' ? !this.#nodeHasConflict(mv.node, mv, v) : this.#mayEnter(v, mv, t, env, distToLine);
          // Too close to stop comfortably: commit to the permission we have.
          if (v.permit && v.v > 2 && distToLine < (v.v * v.v) / (2 * 3.5) + 0.5) v.committed = true;
        }
        if (decide && !v.permit && !v.committed) {
          acc = Math.min(acc, idmTo(distToLine - 0.3, 0, 0.6));
        }
      }

      // Geometric obstacles.
      const look = Math.max(14, v.v * 3.2 + 10);
      const obs = this.#obstacle(v, look, env);
      if (obs) {
        const aObs = idmTo(obs.gap, obs.speed);
        if (aObs < acc) {
          acc = aObs;
          if (obs.courtesy) {
            // letting the bus out is voluntary: never a hard stop
            acc = Math.max(acc, -3);
          } else if (obs.bus && aObs < -3.5 && v.v > 3 && v.kind === MOVE) this.events.push({ type: 'forcedBrake', vehicle: v, decel: -aObs });
          else if (obs.bus && aObs < -4.5 && v.v > 4) this.events.push({ type: 'forcedBrake', vehicle: v, decel: -aObs });
        }
      }

      // Face to face with a waiting bus for a while: back up a few metres to let it through.
      if (obs && obs.bus && !obs.courtesy && v.wait > 6 && (env.busStopped || 0) > 5 && Math.cos(v.yaw - (env.busYaw ?? 0)) < 0.3 && (v.backed || 0) < 8) {
        this.#backUp(v, dt);
        continue;
      }
      if (v.v > 1) v.backed = 0;
      acc = clamp(acc, -8, IDM.a);
      v.acc = acc;
      v.v = Math.max(0, v.v + acc * dt);
      v.braking = acc < -0.4 || v.v < 0.2;
      v.wait = v.v < 0.3 ? v.wait + dt : 0;
      v.s += v.v * dt;
      v.spin += (v.v / 0.33) * dt;
      v.pitch += (clamp(-acc * 0.006, -0.03, 0.02) - v.pitch) * (1 - Math.exp(-dt * 6));

      // Advance through pieces.
      let guard = 0;
      while (v.s > this.path(v).length && guard++ < 4) {
        v.s -= this.path(v).length;
        if (v.kind === LANE) {
          v.kind = MOVE;
          v.id = v.next;
          v.committed = false;
          v.permit = false;
          v.stopDone = false;
          v.stopTimer = 0;
          v.enteredAt = t + v.uid * 1e-9;
          // Register immediately so later cars this frame see the occupant.
          const n = city.movements[v.id].node;
          let set = this.nodeOcc.get(n);
          if (!set) this.nodeOcc.set(n, (set = new Set()));
          set.add(v);
        } else {
          const mv = city.movements[v.id];
          const set = this.nodeOcc.get(mv.node);
          if (set) set.delete(v);
          v.kind = LANE;
          v.id = mv.outLane;
          v.next = this.#chooseMovement(v.id);
        }
      }
      // Lateral dodge towards the right edge of the lane (and back once past).
      v.dodge = Math.max(0, v.dodge - dt);
      const latTarget = v.kind === LANE && v.dodge > 0 ? DODGE : 0;
      const dl = latTarget - v.lat;
      v.lat += Math.sign(dl) * Math.min(Math.abs(dl), 0.9 * dt);
      const p = this.path(v).at(v.s);
      v.x = p.x - p.dz * v.lat;
      v.z = p.z + p.dx * v.lat;
      v.yaw = p.yaw - (dl !== 0 ? Math.sign(dl) * Math.min(0.12, Math.abs(dl)) * Math.min(1, v.v / 3) : 0);
    }

    // Despawn far or finished crashed cars, spawn new ones out of sight.
    this.vehicles = this.vehicles.filter((v) => {
      const d = Math.hypot(v.x - busX, v.z - busZ);
      if (v.fade > 0 && d > 60) return false;
      if (v.fade > 0 && v.crashed <= 0) {
        v.hazard = true;
        return d < 400 && (v.fadeTime = (v.fadeTime || 0) + dt) < 40;
      }
      // Cars stuck in a jam far away from the player are recycled.
      if (v.wait > 45 && d > 140) return false;
      return d < this.radius + 70;
    });
    this.spawnTimer -= dt;
    if (this.vehicles.length < this.target && this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      for (let k = 0; k < 6; k++) if (this.#trySpawn(busX, busZ, 150, this.radius, env.busBoxes)) break;
    }
  }

  // Reverse slowly along the path (back into the approach lane if necessary).
  #backUp(v, dt) {
    const step = 1.1 * dt;
    v.backed = (v.backed || 0) + step;
    v.braking = false;
    v.reversing = 0.5;
    v.s -= step;
    if (v.s < 0.5 && v.kind === MOVE) {
      const mv = this.city.movements[v.id];
      const set = this.nodeOcc.get(mv.node);
      if (set) set.delete(v);
      v.kind = LANE;
      v.id = mv.inLane;
      v.next = mv.id;
      v.committed = false;
      v.permit = false;
      v.s += this.city.lanes[v.id].path.length;
    }
    v.s = Math.max(0, v.s);
    const p = this.path(v).at(v.s);
    v.x = p.x - p.dz * v.lat;
    v.z = p.z + p.dx * v.lat;
    v.yaw = p.yaw;
  }

  // Called when the bus overlaps a car.
  crash(v) {
    if (v.crashed > 0) return;
    v.crashed = 25;
    v.v = 0;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export { DIRS };
