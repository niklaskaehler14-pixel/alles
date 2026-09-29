// Pedestrians walking around the blocks. At signalised crossings they wait for their green
// man, at zebra crossings they step out when approaching traffic can still stop comfortably.
// Pure logic; people are drawn by peopleView.js.

import { Path } from './path.js';
import { pedestrianWalk } from './citymap.js';
import { mulberry32, pointInPolygon, pointInBox } from './util.js';

const SHIRTS = ['#c0392b', '#2c3e50', '#27ae60', '#8e44ad', '#d35400', '#34495e', '#16a085', '#7f8c8d', '#f1c40f', '#2980b9', '#e8e2d0', '#5d4037', '#1e272e', '#b33771'];
const TROUSERS = ['#2d3436', '#1e3799', '#4a4a4a', '#6d4c41', '#222f3e', '#576574', '#3c6382', '#1b1b1b'];
const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#8d5a3b', '#5c3a21', '#f5d7bd'];
const HAIR = ['#2b1d14', '#4a3222', '#1a1a1a', '#a37b4f', '#d9c08c', '#7a7a7a', '#b5651d'];

export function randomLook(rng) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const kid = rng() < 0.1;
  const senior = !kid && rng() < 0.18;
  return {
    shirt: pick(SHIRTS),
    trousers: pick(TROUSERS),
    skin: pick(SKIN),
    hair: senior ? (rng() < 0.6 ? '#cfcfcf' : '#8a8a8a') : pick(HAIR),
    height: kid ? 1.2 + rng() * 0.15 : 1.62 + rng() * 0.28,
    width: 0.9 + rng() * 0.25,
    kid,
    senior,
    bag: rng() < 0.3,
  };
}

export class Pedestrians {
  constructor(city, { seed = 11, count = 40 } = {}) {
    this.city = city;
    this.rng = mulberry32(seed);
    this.count = count;
    this.list = [];
    this.events = [];
    // Closed walking loops per region.
    this.loops = city.regions.map((r) => {
      const pts = Array.from(r.walk);
      pts.push(pts[0], pts[1]);
      return new Path(pts);
    });
    // Crossing ends: which loop and where along it.
    this.crossEnds = city.crossings.map((c) => {
      const ends = [];
      for (const sgn of [-1, 1]) {
        const ext = sgn < 0 ? c.extNeg : c.extPos;
        const cx = c.x + c.ux * sgn * ext;
        const cz = c.z + c.uz * sgn * ext;
        const wx = c.x + c.ux * sgn * (ext + 0.7);
        const wz = c.z + c.uz * sgn * (ext + 0.7);
        const region = this.#regionAt(wx, wz);
        if (region < 0) return null;
        const q = this.loops[region].nearest(wx, wz);
        ends.push({ region, s: q.s, curb: [cx, cz], wait: [wx, wz] });
      }
      return ends;
    });
  }

  #regionAt(x, z) {
    for (const r of this.city.regions) {
      if (r.outer) continue;
      const b = r.bbox;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (pointInPolygon(x, z, r.curb)) return r.id;
    }
    const outer = this.city.regions.find((r) => r.outer);
    return pointInPolygon(x, z, outer.curb) ? -1 : outer.id;
  }

  // Spawn walkers on loops near (x, z).
  reset(x, z) {
    this.list = [];
    let guard = 0;
    while (this.list.length < this.count && guard++ < this.count * 30) this.#spawn(x, z, 0, 260);
  }

  #spawn(cx, cz, minD, maxD) {
    const rng = this.rng;
    const region = Math.floor(rng() * this.loops.length);
    const loop = this.loops[region];
    const s = rng() * loop.length;
    const p = loop.at(s);
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d < minD || d > maxD) return false;
    const lateral = (rng() - 0.5) * 1.0;
    this.list.push({
      region,
      s,
      dir: rng() < 0.5 ? 1 : -1,
      lateral,
      speed: 1.05 + rng() * 0.5,
      state: 'walk',
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      phase: rng() * 10,
      moving: 1,
      look: randomLook(rng),
      cooldown: 0,
      wait: 0,
      dodge: 0,
    });
    return true;
  }

  // Crossing pedestrians (for traffic and rules).
  crossingPeds() {
    return this.list.filter((p) => p.state === 'cross');
  }

  update(dt, t, env) {
    const city = this.city;
    const busBoxes = env.busBoxes || [];
    const busSpeed = Math.abs(env.busSpeed || 0);
    for (const p of this.list) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.dodge = Math.max(0, p.dodge - dt);
      let speed = p.speed;
      if (p.state === 'walk') {
        const loop = this.loops[p.region];
        const prevS = p.s;
        p.s += p.dir * speed * dt;
        if (p.s < 0) p.s += loop.length;
        if (p.s > loop.length) p.s -= loop.length;
        const q = loop.at(p.s);
        const lx = q.dz * p.lateral;
        const lz = -q.dx * p.lateral;
        p.x = q.x + lx;
        p.z = q.z + lz;
        p.yaw = p.dir > 0 ? q.yaw : q.yaw + Math.PI;
        p.moving = 1;
        // Passing a crossing end? Maybe cross.
        if (p.cooldown <= 0) {
          for (let ci = 0; ci < this.crossEnds.length; ci++) {
            const ends = this.crossEnds[ci];
            if (!ends) continue;
            for (let e = 0; e < 2; e++) {
              const end = ends[e];
              if (end.region !== p.region) continue;
              const ds = end.s - prevS;
              const passed = p.dir > 0 ? ds > 0 && ds <= speed * dt + 0.01 : ds < 0 && -ds <= speed * dt + 0.01;
              if (!passed) continue;
              p.cooldown = 8;
              if (this.rng() < 0.45) {
                p.state = 'toCurb';
                p.crossing = ci;
                p.from = e;
                p.target = [end.wait[0] + (this.rng() - 0.5) * 1.2 * city.crossings[ci].uz, end.wait[1] - (this.rng() - 0.5) * 1.2 * city.crossings[ci].ux];
              }
            }
          }
        }
      } else if (p.state === 'toCurb' || p.state === 'cross' || p.state === 'leave') {
        const [tx, tz] = p.target;
        const dx = tx - p.x;
        const dz = tz - p.z;
        const d = Math.hypot(dx, dz);
        // Never walk into the bus.
        const nx = p.x + (dx / (d || 1)) * 0.8;
        const nz = p.z + (dz / (d || 1)) * 0.8;
        const blocked = this.#blocked(nx, nz, busBoxes, env.vehicles, p.state === 'cross' ? 1.4 : 0.35);
        if (blocked) {
          speed = 0;
          p.moving = 0;
        } else {
          p.moving = 1;
        }
        if (d < 0.15) {
          if (p.state === 'toCurb') {
            p.state = 'wait';
            p.wait = 0;
          } else if (p.state === 'cross') {
            const ends = this.crossEnds[p.crossing];
            const end = ends[1 - p.from];
            p.state = 'walk';
            p.region = end.region;
            p.s = end.s;
            p.dir = this.rng() < 0.5 ? 1 : -1;
            p.cooldown = 10;
          }
        } else {
          const step = Math.min(d, speed * dt);
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          if (speed > 0) p.yaw = Math.atan2(dx, dz);
        }
      } else if (p.state === 'wait') {
        p.moving = 0;
        p.wait += dt;
        const c = city.crossings[p.crossing];
        let go;
        if (c.kind === 'signal') {
          go = pedestrianWalk(city.nodes[c.node].signal, c.group, t);
        } else {
          go = this.#zebraClear(c, env) && p.wait > 0.8;
        }
        // Face the street while waiting.
        p.yaw = Math.atan2(c.x - p.x, c.z - p.z);
        const ends = this.crossEnds[p.crossing];
        if (go && p.wait > 0.4 && !this.#crossingOccupied(ends[p.from].wait, ends[1 - p.from].wait, env)) {
          const end = ends[1 - p.from];
          p.state = 'cross';
          p.target = [end.wait[0], end.wait[1]];
          p.speed = Math.max(p.speed, 1.25);
        }
        if (p.wait > 70) {
          // give up and walk on
          p.state = 'walk';
          p.cooldown = 12;
          const q = this.loops[p.region].nearest(p.x, p.z);
          p.s = q.s;
        }
      }
      p.phase += (p.moving ? speed : 0) * dt * 1.9;

      // The bus touching a pedestrian: they jump aside, the rules decide what it means.
      for (const b of busBoxes) {
        if (pointInBox(p.x, p.z, b, 0.25)) {
          const s = Math.sin(b.yaw);
          const c = Math.cos(b.yaw);
          const dx = p.x - b.x;
          const dz = p.z - b.z;
          const l = dx * c - dz * s;
          const sgn = l >= 0 ? 1 : -1;
          p.x += c * sgn * 0.12;
          p.z += -s * sgn * 0.12;
          // Only a real touch counts (people step back from a bus creeping past).
          if (busSpeed > 0.4 && p.dodge <= 0 && pointInBox(p.x, p.z, b, 0.02)) {
            p.dodge = 3;
            this.events.push({ type: 'pedHit', ped: p, speed: busSpeed });
          }
        }
      }
    }

    // Keep the population around the player.
    const bx = env.busX ?? 0;
    const bz = env.busZ ?? 0;
    this.list = this.list.filter((p) => p.state !== 'walk' || Math.hypot(p.x - bx, p.z - bz) < 320);
    let guard = 0;
    while (this.list.length < this.count && guard++ < 10) this.#spawn(bx, bz, 150, 300);
  }

  // Any vehicle on the crossing, or the bus about to drive over it?
  #crossingOccupied(a, b, env) {
    for (let k = 1; k < 8; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / 8;
      const z = a[1] + ((b[1] - a[1]) * k) / 8;
      if (this.#blocked(x, z, env.busBoxes || [], env.vehicles, 0.6)) return true;
    }
    // A bus rolling in closer than it can comfortably stop: people wait a moment.
    if (env.busFrontX !== undefined && (env.busSpeed || 0) > 1.2) {
      const v = env.busSpeed;
      const reach = (v * v) / (2 * 1.5) + 8;
      for (let k = 0; k <= 8; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / 8;
        const z = a[1] + ((b[1] - a[1]) * k) / 8;
        if (Math.hypot(x - env.busFrontX, z - env.busFrontZ) < reach) return true;
      }
    }
    return false;
  }

  // Is (x, z) inside or right next to the bus or a car?
  #blocked(x, z, busBoxes, vehicles, margin) {
    for (const b of busBoxes) if (pointInBox(x, z, b, margin)) return true;
    if (vehicles) {
      for (const v of vehicles) {
        if (Math.abs(v.x - x) > 7 || Math.abs(v.z - z) > 7) continue;
        if (pointInBox(x, z, { x: v.x, z: v.z, yaw: v.yaw, hl: v.hl, hw: v.hw }, margin)) return true;
      }
    }
    return false;
  }

  // May a pedestrian step onto the zebra? Approaching traffic must be able to stop.
  #zebraClear(c, env) {
    const city = this.city;
    for (const cl of c.lanes) {
      for (const v of env.vehicles || []) {
        if (v.kind !== 0 || v.id !== cl.lane) continue;
        const d = cl.s - v.s - v.hl;
        if (d > -1 && d < (v.v * v.v) / (2 * 2.5) + 4) return false;
      }
    }
    if (env.busX !== undefined) {
      const dx = c.x - env.busFrontX;
      const dz = c.z - env.busFrontZ;
      const along = dx * Math.sin(env.busYaw) + dz * Math.cos(env.busYaw);
      const lat = Math.abs(dx * Math.cos(env.busYaw) - dz * Math.sin(env.busYaw));
      const v = Math.max(0, env.busSpeed || 0);
      if (lat < 6 && along > -1 && along < (v * v) / (2 * 2.2) + 6) return false;
    }
    return true;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
