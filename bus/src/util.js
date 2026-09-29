// Small math helpers shared by all modules (no three.js dependency).
// Ground plane is x/z with y up. Heading `yaw`: forward = (sin yaw, cos yaw),
// left = (cos yaw, -sin yaw). Positive yaw rate turns left.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Frame-rate independent exponential smoothing.
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export const headingOf = (dx, dz) => Math.atan2(dx, dz);

// Seeded PRNG (mulberry32).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

// Cheap hash for deterministic per-object variation.
export function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Clock time in seconds since midnight → "07:42".
export function clockText(t, seconds = false) {
  const s = ((Math.floor(t) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return seconds ? `${hm}:${String(s % 60).padStart(2, '0')}` : hm;
}

// Signed delay in seconds → "+1:20" / "−0:35".
export function delayText(d) {
  const sign = d < 0 ? '−' : '+';
  const a = Math.round(Math.abs(d));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

export const euro = (v) =>
  `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const euroShort = (v) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('de-DE')} €`;

// Point-in-polygon for a flat [x0, z0, x1, z1, ...] array.
export function pointInPolygon(x, z, pts) {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2];
    const zi = pts[i * 2 + 1];
    const xj = pts[j * 2];
    const zj = pts[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Oriented box helpers. Box: {x, z, yaw, hl (half length), hw (half width)}.
export function boxCorners(b, out = new Float64Array(8)) {
  const s = Math.sin(b.yaw);
  const c = Math.cos(b.yaw);
  const fx = s * b.hl;
  const fz = c * b.hl;
  const lx = c * b.hw;
  const lz = -s * b.hw;
  out[0] = b.x + fx + lx;
  out[1] = b.z + fz + lz;
  out[2] = b.x + fx - lx;
  out[3] = b.z + fz - lz;
  out[4] = b.x - fx - lx;
  out[5] = b.z - fz - lz;
  out[6] = b.x - fx + lx;
  out[7] = b.z - fz + lz;
  return out;
}

export function pointInBox(x, z, b, margin = 0) {
  const dx = x - b.x;
  const dz = z - b.z;
  const s = Math.sin(b.yaw);
  const c = Math.cos(b.yaw);
  const f = dx * s + dz * c;
  const l = dx * c - dz * s;
  return Math.abs(f) <= b.hl + margin && Math.abs(l) <= b.hw + margin;
}

// Separating-axis test for two oriented boxes. Returns null or {depth, nx, nz}
// where (nx, nz) pushes box `a` out of box `b`.
export function boxOverlap(a, b) {
  const ax = [Math.sin(a.yaw), Math.cos(a.yaw), Math.cos(a.yaw), -Math.sin(a.yaw)];
  const bx = [Math.sin(b.yaw), Math.cos(b.yaw), Math.cos(b.yaw), -Math.sin(b.yaw)];
  const axes = [ax[0], ax[1], ax[2], ax[3], bx[0], bx[1], bx[2], bx[3]];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let best = Infinity;
  let bnx = 0;
  let bnz = 0;
  for (let k = 0; k < 4; k++) {
    const nx = axes[k * 2];
    const nz = axes[k * 2 + 1];
    const ra = a.hl * Math.abs(nx * ax[0] + nz * ax[1]) + a.hw * Math.abs(nx * ax[2] + nz * ax[3]);
    const rb = b.hl * Math.abs(nx * bx[0] + nz * bx[1]) + b.hw * Math.abs(nx * bx[2] + nz * bx[3]);
    const d = dx * nx + dz * nz;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) {
      best = o;
      const sgn = d > 0 ? -1 : 1;
      bnx = nx * sgn;
      bnz = nz * sgn;
    }
  }
  return { depth: best, nx: bnx, nz: bnz };
}

// Distance from point to segment.
export function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}
