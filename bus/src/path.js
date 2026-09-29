// 2D polylines with arc-length parametrisation (x/z plane).

export class Path {
  // pts: flat array [x0, z0, x1, z1, ...]
  constructor(pts) {
    this.pts = Float64Array.from(pts);
    const n = this.pts.length / 2;
    this.n = n;
    this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      this.cum[i] = this.cum[i - 1] + Math.hypot(this.pts[i * 2] - this.pts[i * 2 - 2], this.pts[i * 2 + 1] - this.pts[i * 2 - 1]);
    }
    this.length = this.cum[n - 1];
  }

  #segment(s) {
    const cum = this.cum;
    if (s <= 0) return 0;
    if (s >= this.length) return this.n - 2;
    let lo = 0;
    let hi = this.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // Position and heading at arc length s (clamped; extrapolates linearly past the ends).
  at(s, out = {}) {
    const i = this.#segment(s);
    const p = this.pts;
    const x0 = p[i * 2];
    const z0 = p[i * 2 + 1];
    const x1 = p[i * 2 + 2];
    const z1 = p[i * 2 + 3];
    const len = this.cum[i + 1] - this.cum[i] || 1e-9;
    const t = (s - this.cum[i]) / len;
    out.x = x0 + (x1 - x0) * t;
    out.z = z0 + (z1 - z0) * t;
    out.dx = (x1 - x0) / len;
    out.dz = (z1 - z0) / len;
    out.yaw = Math.atan2(out.dx, out.dz);
    return out;
  }

  // Nearest point: returns {s, d (unsigned distance), side (+ = left of path)}.
  nearest(x, z, out = {}) {
    const p = this.pts;
    let best = Infinity;
    let bs = 0;
    let side = 0;
    for (let i = 0; i < this.n - 1; i++) {
      const ax = p[i * 2];
      const az = p[i * 2 + 1];
      const vx = p[i * 2 + 2] - ax;
      const vz = p[i * 2 + 3] - az;
      const l2 = vx * vx + vz * vz;
      let t = l2 > 0 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + vx * t;
      const qz = az + vz * t;
      const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d2 < best) {
        best = d2;
        bs = this.cum[i] + t * Math.sqrt(l2);
        // left of direction (vx, vz) is (vz, -vx) in this coordinate frame
        side = (x - qx) * vz - (z - qz) * vx;
      }
    }
    out.s = bs;
    out.d = Math.sqrt(best);
    out.side = side >= 0 ? 1 : -1;
    return out;
  }

  // Curvature estimate (1/m) at s using headings a little before and after.
  curvature(s, span = 2) {
    const a = this.at(s - span);
    const b = this.at(s + span);
    let d = b.yaw - a.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d / (2 * span);
  }
}

// Straight segment from (ax, az) to (bx, bz).
export const line = (ax, az, bx, bz) => [ax, az, bx, bz];

// Arc around (cx, cz) with radius r from angle a0 to a1 (angles measured with atan2(dx, dz)),
// sampled roughly every `step` metres. Includes both end points.
export function arcPoints(cx, cz, r, a0, a1, step = 1) {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step) + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (n - 1);
    out.push(cx + Math.sin(a) * r, cz + Math.cos(a) * r);
  }
  return out;
}

// Concatenate flat point arrays, dropping duplicated joints.
export function joinPoints(...parts) {
  const out = [];
  for (const p of parts) {
    for (let i = 0; i < p.length; i += 2) {
      const n = out.length;
      if (n >= 2 && Math.abs(out[n - 2] - p[i]) < 1e-6 && Math.abs(out[n - 1] - p[i + 1]) < 1e-6) continue;
      out.push(p[i], p[i + 1]);
    }
  }
  return out;
}

// Offset a polyline sideways by d (positive = to the left of travel).
export function offsetPoints(pts, d) {
  const n = pts.length / 2;
  const out = new Array(pts.length);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let dx = pts[i1 * 2] - pts[i0 * 2];
    let dz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // left = (dz, -dx)
    out[i * 2] = pts[i * 2] + dz * d;
    out[i * 2 + 1] = pts[i * 2 + 1] - dx * d;
  }
  return out;
}
