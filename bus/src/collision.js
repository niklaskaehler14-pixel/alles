// Static collision world (buildings, poles, trees, shelters) in a uniform grid,
// and the response that keeps the bus out of it.

import { boxOverlap } from './util.js';

const CELL = 16;

export class StaticWorld {
  constructor(layout) {
    this.grid = new Map();
    this.items = [];
    for (const b of layout.boxes) this.#add({ shape: 'box', x: b.x, z: b.z, yaw: b.yaw, hl: b.hl, hw: b.hw, kind: b.kind });
    for (const c of layout.circles) this.#add({ shape: 'circle', x: c.x, z: c.z, r: c.r, kind: c.kind });
    this.stamp = 0;
  }

  #add(item) {
    item.id = this.items.length;
    item.mark = 0;
    this.items.push(item);
    const ext = item.shape === 'box' ? Math.hypot(item.hl, item.hw) : item.r;
    const x0 = Math.floor((item.x - ext) / CELL);
    const x1 = Math.floor((item.x + ext) / CELL);
    const z0 = Math.floor((item.z - ext) / CELL);
    const z1 = Math.floor((item.z + ext) / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = i * 100003 + j;
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(item);
      }
    }
  }

  // Items whose cells touch the circle (x, z, r).
  query(x, z, r, out = []) {
    out.length = 0;
    this.stamp++;
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const arr = this.grid.get(i * 100003 + j);
        if (!arr) continue;
        for (const it of arr) {
          if (it.mark === this.stamp) continue;
          it.mark = this.stamp;
          out.push(it);
        }
      }
    }
    return out;
  }
}

// Circle vs oriented box: returns {depth, nx, nz} pushing the box away from the circle.
function circleBox(c, b) {
  const s = Math.sin(b.yaw);
  const co = Math.cos(b.yaw);
  const dx = c.x - b.x;
  const dz = c.z - b.z;
  const f = dx * s + dz * co;
  const l = dx * co - dz * s;
  const cf = Math.max(-b.hl, Math.min(b.hl, f));
  const cl = Math.max(-b.hw, Math.min(b.hw, l));
  const inside = cf === f && cl === l;
  let nf;
  let nl;
  let depth;
  if (inside) {
    // Centre inside the box: push out along the shallowest face.
    const pf = b.hl - Math.abs(f);
    const pl = b.hw - Math.abs(l);
    if (pf < pl) {
      nf = f >= 0 ? -1 : 1;
      nl = 0;
      depth = pf + c.r;
    } else {
      nf = 0;
      nl = l >= 0 ? -1 : 1;
      depth = pl + c.r;
    }
  } else {
    const ef = f - cf;
    const el = l - cl;
    const d = Math.hypot(ef, el);
    if (d >= c.r) return null;
    nf = -ef / (d || 1);
    nl = -el / (d || 1);
    depth = c.r - d;
  }
  // back to world: forward = (s, co), left = (co, -s)
  return { depth, nx: nf * s + nl * co, nz: nf * co - nl * s };
}

const tmp = [];

// Push the bus out of static objects. Returns the strongest impact or null.
export function resolveBusStatic(bus, world) {
  let impact = null;
  const boxes = bus.boxes();
  for (let iter = 0; iter < 2; iter++) {
    for (const b of boxes) {
      const reach = Math.hypot(b.hl, b.hw) + 1;
      world.query(b.x, b.z, reach, tmp);
      for (const it of tmp) {
        let hit;
        if (it.shape === 'box') hit = boxOverlap(b, it);
        else hit = circleBox(it, b);
        if (!hit || hit.depth <= 0.001) continue;
        const depth = Math.min(hit.depth, 0.6);
        bus.x += hit.nx * depth;
        bus.z += hit.nz * depth;
        b.x += hit.nx * depth;
        b.z += hit.nz * depth;
        // Remove the velocity component into the obstacle.
        const s = Math.sin(bus.yaw);
        const c = Math.cos(bus.yaw);
        const vx = s * bus.u + c * bus.v;
        const vz = c * bus.u - s * bus.v;
        const vn = vx * hit.nx + vz * hit.nz;
        if (vn < 0) {
          const nvx = vx - vn * hit.nx * 1.15;
          const nvz = vz - vn * hit.nz * 1.15;
          bus.u = s * nvx + c * nvz;
          bus.v = c * nvx - s * nvz;
          bus.r *= 0.6;
          const speed = -vn;
          if (!impact || speed > impact.speed) impact = { speed, x: bus.x, z: bus.z, kind: it.kind, part: b.part };
        }
      }
    }
  }
  return impact;
}
