// Closed race track: centripetal Catmull-Rom spline resampled at a fixed spacing,
// with fast nearest-point queries used by physics, AI and race logic.

function catmullRomPoint(p0, p1, p2, p3, t, alpha = 0.5) {
  // Barry-Goldman pyramidal formulation of the centripetal Catmull-Rom spline.
  const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha);
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const mix = (a, b, ta, tb) => {
    const d = tb - ta || 1e-6;
    return [((tb - tt) / d) * a[0] + ((tt - ta) / d) * b[0], ((tb - tt) / d) * a[1] + ((tt - ta) / d) * b[1]];
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

export class Track {
  constructor(controlPoints, spacing = 2) {
    this.spacing = spacing;
    const n = controlPoints.length;

    // Dense polyline through the spline.
    const dense = [];
    const sub = 60;
    for (let i = 0; i < n; i++) {
      const p0 = controlPoints[(i - 1 + n) % n];
      const p1 = controlPoints[i];
      const p2 = controlPoints[(i + 1) % n];
      const p3 = controlPoints[(i + 2) % n];
      for (let k = 0; k < sub; k++) dense.push(catmullRomPoint(p0, p1, p2, p3, k / sub));
    }
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    const count = Math.round(total / spacing);
    this.count = count;
    this.length = count * spacing;
    this.spacing = total / count;

    this.x = new Float32Array(count);
    this.z = new Float32Array(count);
    this.tx = new Float32Array(count);
    this.tz = new Float32Array(count);
    this.curv = new Float32Array(count);
    this.h = new Float32Array(count);

    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = i * this.spacing;
      while (j < dense.length - 1 && cum[j + 1] < s) j++;
      const a = dense[j];
      const b = dense[(j + 1) % dense.length];
      const seg = cum[j + 1] - cum[j] || 1;
      const f = (s - cum[j]) / seg;
      this.x[i] = a[0] + (b[0] - a[0]) * f;
      this.z[i] = a[1] + (b[1] - a[1]) * f;
    }

    for (let i = 0; i < count; i++) {
      const p = (i - 1 + count) % count;
      const q = (i + 1) % count;
      const dx = this.x[q] - this.x[p];
      const dz = this.z[q] - this.z[p];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }

    // Signed curvature (positive = turning left), smoothed.
    const raw = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const p = (i - 2 + count) % count;
      const q = (i + 2) % count;
      const a1 = Math.atan2(this.tx[p], this.tz[p]);
      const a2 = Math.atan2(this.tx[q], this.tz[q]);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      raw[i] = d / (4 * this.spacing);
    }
    const w = 6;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let k = -w; k <= w; k++) sum += raw[(i + k + count) % count];
      this.curv[i] = sum / (2 * w + 1);
    }

    this.#buildGrid();
    this._q = { index: 0, t: 0, lateral: 0, dist: 0, height: 0, s: 0, tx: 0, tz: 1 };
  }

  #buildGrid() {
    const cell = 48;
    this.gridCell = cell;
    this.gridMin = -2200;
    this.gridDim = Math.ceil(4400 / cell);
    const cells = new Map();
    for (let i = 0; i < this.count; i++) {
      const cx = Math.floor((this.x[i] - this.gridMin) / cell);
      const cz = Math.floor((this.z[i] - this.gridMin) / cell);
      const key = cx + cz * this.gridDim;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
    this.grid = cells;
  }

  wrapIndex(i) {
    const c = this.count;
    return ((i % c) + c) % c;
  }

  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  // Nearest sample index by brute-force over nearby grid cells. Returns -1 if nothing within ~1 cell ring.
  nearestIndexGlobal(x, z, rings = 2) {
    const cell = this.gridCell;
    const cx = Math.floor((x - this.gridMin) / cell);
    const cz = Math.floor((z - this.gridMin) / cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= rings; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const list = this.grid.get(cx + dx + (cz + dz) * this.gridDim);
          if (!list) continue;
          for (const i of list) {
            const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      // A hit in ring r is only guaranteed nearest after checking ring r+1.
      if (best >= 0 && r >= 1 && Math.sqrt(bestD) < r * cell) break;
    }
    return best;
  }

  nearestIndexLocal(x, z, hint, range = 24) {
    let best = hint;
    let bestD = Infinity;
    for (let k = -range; k <= range; k++) {
      const i = this.wrapIndex(hint + k);
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // Projects (x, z) onto the centre line. `hint` is the previous sample index (or -1).
  // Writes into `out` (or a shared object) and returns it.
  nearest(x, z, hint = -1, out = this._q, rings = 2) {
    let i = -1;
    if (hint >= 0) {
      i = this.nearestIndexLocal(x, z, hint);
      const d = Math.hypot(this.x[i] - x, this.z[i] - z);
      // Walk further if the local window's edge was hit (fast movement).
      if (d > 40) i = -1;
    }
    if (i < 0) i = this.nearestIndexGlobal(x, z, rings);
    if (i < 0) {
      out.index = -1;
      out.lateral = Infinity;
      out.dist = Infinity;
      return out;
    }
    // Refine on the adjacent segments.
    let bestT = 0;
    let bestI = i;
    let bestD = Infinity;
    for (const a of [this.wrapIndex(i - 1), i]) {
      const b = this.wrapIndex(a + 1);
      const ex = this.x[b] - this.x[a];
      const ez = this.z[b] - this.z[a];
      const len2 = ex * ex + ez * ez || 1;
      let t = ((x - this.x[a]) * ex + (z - this.z[a]) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = this.x[a] + ex * t;
      const pz = this.z[a] + ez * t;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        bestI = a;
        bestT = t;
      }
    }
    const a = bestI;
    const b = this.wrapIndex(a + 1);
    const tx = this.tx[a] + (this.tx[b] - this.tx[a]) * bestT;
    const tz = this.tz[a] + (this.tz[b] - this.tz[a]) * bestT;
    const tl = Math.hypot(tx, tz) || 1;
    const px = this.x[a] + (this.x[b] - this.x[a]) * bestT;
    const pz = this.z[a] + (this.z[b] - this.z[a]) * bestT;
    out.index = a;
    out.t = bestT;
    out.tx = tx / tl;
    out.tz = tz / tl;
    // Left of travel direction is positive: left = (tz, -tx).
    out.lateral = (x - px) * out.tz - (z - pz) * out.tx;
    out.dist = Math.sqrt(bestD);
    out.height = this.h[a] + (this.h[b] - this.h[a]) * bestT;
    out.s = (a + bestT) * this.spacing;
    return out;
  }

  // Position on the centre line (optionally offset to the left) at arc length s.
  pointAt(s, lateral = 0, out = {}) {
    const f = this.wrapS(s) / this.spacing;
    const a = Math.floor(f) % this.count;
    const b = (a + 1) % this.count;
    const t = f - Math.floor(f);
    let tx = this.tx[a] + (this.tx[b] - this.tx[a]) * t;
    let tz = this.tz[a] + (this.tz[b] - this.tz[a]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    out.x = this.x[a] + (this.x[b] - this.x[a]) * t + tz * lateral;
    out.z = this.z[a] + (this.z[b] - this.z[a]) * t - tx * lateral;
    out.h = this.h[a] + (this.h[b] - this.h[a]) * t;
    out.tx = tx;
    out.tz = tz;
    out.heading = Math.atan2(tx, tz);
    out.index = a;
    return out;
  }

  curvatureAt(s) {
    const i = Math.round(this.wrapS(s) / this.spacing) % this.count;
    return this.curv[i];
  }

  indexOf(x, z) {
    return this.nearestIndexGlobal(x, z, 6);
  }
}
