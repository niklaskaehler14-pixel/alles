// Road network as a graph for the GPS route, discovered-road tracking and the map regions.
// Pure JavaScript (tested in Node).

import { FESTIVAL } from './config.js';

// Region names shown on the world map.
export const REGIONS = [
  { name: 'Nordkamm City', x: -700, z: -600, size: 1 },
  { name: 'Kaminari-Berge', x: 440, z: -330, size: 1 },
  { name: 'Spiegelsee', x: 560, z: 700, size: 0.9 },
  { name: 'Nordkamm-Hochland', x: 560, z: -1300, size: 0.9 },
  { name: 'Westwald', x: -1170, z: 380, size: 0.85 },
  { name: 'Südwald', x: -380, z: 1300, size: 0.85 },
  { name: 'Osthügel', x: 1500, z: -120, size: 0.85 },
  { name: 'Festivalgelände', x: -60, z: 330, size: 0.7 },
];

export function regionAt(x, z) {
  let best = REGIONS[0];
  let bd = Infinity;
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.x, z - r.z);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best.name;
}

export class RoadGraph {
  constructor(world) {
    this.world = world;
    this.roads = [world.track, ...(world.branches || [])];
    this.nodes = [];
    this.stops = new Map(this.roads.map((r) => [r, []]));
    const q = {};
    const addNode = (x, z, name) => {
      const node = { id: this.nodes.length, x, z, name };
      this.nodes.push(node);
      return node;
    };
    const stop = (road, s, node) => this.stops.get(road).push({ s, node });
    // Junctions between branches and the roads they join.
    for (const b of world.branches || []) {
      for (const j of b.junctions) {
        const p = b.pointAt(j.s, 0, {});
        const node = addNode(p.x, p.z, 'Kreuzung');
        stop(b, j.s, node);
        stop(j.other, j.other.nearest(p.x, p.z, -1, q, 4).s, node);
      }
    }
    // The festival plaza connects the roads that touch it.
    const fest = addNode(FESTIVAL.x, FESTIVAL.z, 'Festival');
    this.festivalNode = fest;
    for (const b of world.branches || []) {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < b.count; i++) {
        const d = Math.hypot(b.x[i] - FESTIVAL.x, b.z[i] - FESTIVAL.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (bd < FESTIVAL.radius + 8) stop(b, best * b.spacing, fest);
    }
    // Dead ends of open roads.
    for (const b of world.branches || []) {
      const list = this.stops.get(b);
      for (const s of [0, b.length]) {
        if (list.some((st) => Math.abs(st.s - s) < 30)) continue;
        const p = b.pointAt(s, 0, {});
        stop(b, s, addNode(p.x, p.z, 'Ende'));
      }
    }
    // Edges between consecutive stops along each road (the circuit wraps around).
    this.adj = this.nodes.map(() => []);
    for (const road of this.roads) {
      const list = this.stops.get(road).sort((a, b) => a.s - b.s);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        let b = list[i + 1];
        let s1 = b ? b.s : 0;
        if (!b) {
          if (!road.closed || list.length < 2) break;
          b = list[0];
          s1 = b.s + road.length;
        }
        if (a.node === b.node) continue;
        const len = s1 - a.s;
        this.adj[a.node.id].push({ to: b.node.id, road, s0: a.s, s1, len });
        this.adj[b.node.id].push({ to: a.node.id, road, s0: s1, s1: a.s, len });
      }
    }
  }

  // Nearest point on any road: { road, s, dist, x, z } (null if none within maxDist).
  project(x, z, maxDist = Infinity) {
    let best = null;
    const q = {};
    for (const road of this.roads) {
      const r = road.nearest(x, z, -1, q, 40);
      if (r.index < 0) continue;
      if (!best || r.dist < best.dist) best = { road, s: r.s, dist: r.dist };
    }
    if (!best || best.dist > maxDist) return null;
    const p = best.road.pointAt(best.s, 0, {});
    best.x = p.x;
    best.z = p.z;
    return best;
  }

  // Stops on either side of `s` along `road` with the distance to each.
  #neighbours(road, s) {
    const list = this.stops.get(road);
    const out = [];
    if (!list.length) return out;
    let before = null;
    let after = null;
    for (const st of list) {
      if (st.s <= s && (!before || st.s > before.s)) before = st;
      if (st.s >= s && (!after || st.s < after.s)) after = st;
    }
    if (road.closed) {
      if (!before) before = list.reduce((m, st) => (st.s > m.s ? st : m));
      if (!after) after = list.reduce((m, st) => (st.s < m.s ? st : m));
      const L = road.length;
      out.push({ node: before.node, len: (s - before.s + L) % L, s0: s, s1: s - ((s - before.s + L) % L) });
      out.push({ node: after.node, len: (after.s - s + L) % L, s0: s, s1: s + ((after.s - s + L) % L) });
    } else {
      if (before) out.push({ node: before.node, len: s - before.s, s0: s, s1: before.s });
      if (after) out.push({ node: after.node, len: after.s - s, s0: s, s1: after.s });
    }
    return out;
  }

  // GPS route between two points: road network in between, straight lines off-road.
  // Returns { points: [[x, z], ...], length } or null.
  route(ax, az, bx, bz) {
    const pa = this.project(ax, az, 600);
    const pb = this.project(bx, bz, 600);
    const straight = Math.hypot(bx - ax, bz - az);
    if (!pa || !pb) return { points: [[ax, az], [bx, bz]], length: straight };
    // Candidate: the same road directly.
    let best = null;
    if (pa.road === pb.road) {
      let d = pb.s - pa.s;
      if (pa.road.closed) {
        const L = pa.road.length;
        d = ((d % L) + L) % L;
        if (d > L / 2) d -= L;
      }
      best = { len: Math.abs(d), segs: [{ road: pa.road, s0: pa.s, s1: pa.s + d }] };
    }
    // Dijkstra from the neighbours of A to the neighbours of B.
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Array(n).fill(null);
    const startLegs = this.#neighbours(pa.road, pa.s);
    const endLegs = this.#neighbours(pb.road, pb.s);
    const open = new Set();
    for (const l of startLegs) {
      if (l.len < dist[l.node.id]) {
        dist[l.node.id] = l.len;
        prev[l.node.id] = { start: true, seg: { road: pa.road, s0: l.s0, s1: l.s1 } };
        open.add(l.node.id);
      }
    }
    const done = new Uint8Array(n);
    while (open.size) {
      let u = -1;
      for (const k of open) if (u < 0 || dist[k] < dist[u]) u = k;
      open.delete(u);
      done[u] = 1;
      for (const e of this.adj[u]) {
        if (done[e.to]) continue;
        const nd = dist[u] + e.len;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = { from: u, seg: { road: e.road, s0: e.s0, s1: e.s1 } };
          open.add(e.to);
        }
      }
    }
    for (const l of endLegs) {
      const total = dist[l.node.id] + l.len;
      if (!Number.isFinite(total) || (best && total >= best.len)) continue;
      const segs = [{ road: pb.road, s0: l.s1, s1: l.s0 }];
      let k = l.node.id;
      while (prev[k] && !prev[k].start) {
        segs.unshift(prev[k].seg);
        k = prev[k].from;
      }
      if (prev[k]) segs.unshift(prev[k].seg);
      best = { len: total, segs };
    }
    if (!best) return { points: [[ax, az], [bx, bz]], length: straight };
    // Off-road target close to where we are: just head straight there.
    if (straight < best.len * 0.6 && straight < 250) return { points: [[ax, az], [bx, bz]], length: straight };
    const points = [];
    if (pa.dist > 6) points.push([ax, az]);
    const pt = {};
    for (const seg of best.segs) {
      const d = seg.s1 - seg.s0;
      const steps = Math.max(1, Math.ceil(Math.abs(d) / 8));
      for (let i = 0; i <= steps; i++) {
        seg.road.pointAt(seg.s0 + (d * i) / steps, 0, pt);
        const last = points[points.length - 1];
        if (!last || Math.hypot(last[0] - pt.x, last[1] - pt.z) > 0.5) points.push([pt.x, pt.z]);
      }
    }
    if (pb.dist > 6) points.push([bx, bz]);
    return { points, length: best.len + (pa.dist > 6 ? pa.dist : 0) + (pb.dist > 6 ? pb.dist : 0) };
  }
}

// Discovered road sections (25 m chunks over every road), saved as a compact string.
export class RoadDiscovery {
  constructor(world, saved = '') {
    this.roads = [world.track, ...(world.branches || [])];
    this.chunk = 25;
    this.offsets = [];
    let total = 0;
    for (const r of this.roads) {
      this.offsets.push(total);
      total += Math.ceil(r.length / this.chunk);
    }
    this.total = total;
    this.bits = new Uint8Array(total);
    this.count = 0;
    this.q = {};
    this.load(saved);
  }

  load(str) {
    if (!str) return;
    try {
      const raw = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
      for (let i = 0; i < this.total; i++) {
        const byte = raw.charCodeAt(i >> 3) || 0;
        this.bits[i] = (byte >> (i & 7)) & 1;
      }
      this.count = this.bits.reduce((a, b) => a + b, 0);
    } catch {
      /* corrupt save: start fresh */
    }
  }

  save() {
    let raw = '';
    for (let i = 0; i < this.total; i += 8) {
      let byte = 0;
      for (let k = 0; k < 8 && i + k < this.total; k++) byte |= this.bits[i + k] << k;
      raw += String.fromCharCode(byte);
    }
    return typeof btoa === 'function' ? btoa(raw) : Buffer.from(raw, 'binary').toString('base64');
  }

  // Marks the chunks around (x, z) on every road within `radius`. Returns the number of new chunks.
  visit(x, z, radius = 40) {
    let added = 0;
    this.roads.forEach((road, ri) => {
      const r = road.nearest(x, z, -1, this.q, 2);
      if (r.index < 0 || r.dist > radius) return;
      const n = Math.ceil(road.length / this.chunk);
      const c0 = Math.floor((r.s - radius) / this.chunk);
      const c1 = Math.floor((r.s + radius) / this.chunk);
      for (let c = c0; c <= c1; c++) {
        let k = c;
        if (road.closed) k = ((c % n) + n) % n;
        else if (c < 0 || c >= n) continue;
        const i = this.offsets[ri] + k;
        if (!this.bits[i]) {
          this.bits[i] = 1;
          this.count++;
          added++;
        }
      }
    });
    return added;
  }

  isKnown(roadIndex, s) {
    const road = this.roads[roadIndex];
    const n = Math.ceil(road.length / this.chunk);
    let k = Math.floor(s / this.chunk);
    k = Math.max(0, Math.min(n - 1, k));
    return this.bits[this.offsets[roadIndex] + k] === 1;
  }

  get fraction() {
    return this.total ? this.count / this.total : 0;
  }
}
