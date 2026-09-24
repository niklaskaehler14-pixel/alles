// Static collision shapes (tree trunks, poles, buildings) in a uniform hash grid.

export class StaticColliders {
  constructor(cell = 24) {
    this.cell = cell;
    this.cells = new Map();
    this.circles = [];
    this.boxes = [];
    this._result = [];
  }

  #key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  #insert(item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    for (let cz = Math.floor(minZ / c); cz <= Math.floor(maxZ / c); cz++) {
      for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
        const k = this.#key(cx, cz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }

  addCircle(x, z, r, kind = 'tree') {
    const item = { type: 0, x, z, r, kind, stamp: 0 };
    this.circles.push(item);
    this.#insert(item, x - r, z - r, x + r, z + r);
  }

  addBox(minX, minZ, maxX, maxZ, kind = 'building') {
    const item = { type: 1, minX, minZ, maxX, maxZ, kind, stamp: 0 };
    this.boxes.push(item);
    this.#insert(item, minX, minZ, maxX, maxZ);
  }

  // Returns shapes whose cells overlap the query square (deduplicated).
  query(x, z, r) {
    const out = this._result;
    out.length = 0;
    const stamp = (this._stamp = (this._stamp || 0) + 1);
    const c = this.cell;
    for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
      for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
        const list = this.cells.get(this.#key(cx, cz));
        if (!list) continue;
        for (const item of list) {
          if (item.stamp === stamp) continue;
          item.stamp = stamp;
          out.push(item);
        }
      }
    }
    return out;
  }

  // Penetration of a circle against one shape; writes normal (pointing out of the shape) and depth.
  static penetration(item, x, z, r, out) {
    if (item.type === 0) {
      const dx = x - item.x;
      const dz = z - item.z;
      const d = Math.hypot(dx, dz);
      const depth = r + item.r - d;
      if (depth <= 0) return false;
      out.nx = d > 1e-6 ? dx / d : 1;
      out.nz = d > 1e-6 ? dz / d : 0;
      out.depth = depth;
      return true;
    }
    const px = Math.max(item.minX, Math.min(x, item.maxX));
    const pz = Math.max(item.minZ, Math.min(z, item.maxZ));
    const dx = x - px;
    const dz = z - pz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) {
      if (d >= r) return false;
      out.nx = dx / d;
      out.nz = dz / d;
      out.depth = r - d;
      return true;
    }
    // Centre inside the box: push out along the shallowest axis.
    const left = x - item.minX;
    const right = item.maxX - x;
    const top = z - item.minZ;
    const bottom = item.maxZ - z;
    const m = Math.min(left, right, top, bottom);
    if (m === left) { out.nx = -1; out.nz = 0; } else if (m === right) { out.nx = 1; out.nz = 0; } else if (m === top) { out.nx = 0; out.nz = -1; } else { out.nx = 0; out.nz = 1; }
    out.depth = m + r;
    return true;
  }
}
