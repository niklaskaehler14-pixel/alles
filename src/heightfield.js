// Regular height grid. Interpolation matches the triangulation used by the terrain mesh,
// so the physics ground and the rendered ground are identical.

export class Heightfield {
  constructor(size, segments) {
    this.size = size;
    this.half = size / 2;
    this.segments = segments;
    this.cell = size / segments;
    this.stride = segments + 1;
    this.heights = new Float32Array(this.stride * this.stride);
  }

  index(ix, iz) {
    return ix + iz * this.stride;
  }

  worldX(ix) {
    return -this.half + ix * this.cell;
  }

  worldZ(iz) {
    return -this.half + iz * this.cell;
  }

  get(x, z) {
    const s = this.segments;
    let fx = (x + this.half) / this.cell;
    let fz = (z + this.half) / this.cell;
    if (fx < 0) fx = 0;
    if (fz < 0) fz = 0;
    if (fx > s - 1e-4) fx = s - 1e-4;
    if (fz > s - 1e-4) fz = s - 1e-4;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h = this.heights;
    const i00 = ix + iz * this.stride;
    const h00 = h[i00];
    const h10 = h[i00 + 1];
    const h01 = h[i00 + this.stride];
    const h11 = h[i00 + this.stride + 1];
    // Triangles (00, 01, 10) and (10, 01, 11): diagonal from (1,0) to (0,1).
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  // Surface normal (unnormalised y = 1 form is fine for slope tests).
  normal(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = this.cell * 0.5;
    const dx = (this.get(x + e, z) - this.get(x - e, z)) / (2 * e);
    const dz = (this.get(x, z + e) - this.get(x, z - e)) / (2 * e);
    const len = Math.hypot(dx, 1, dz);
    out.x = -dx / len;
    out.y = 1 / len;
    out.z = -dz / len;
    return out;
  }
}
