// Car bodies for the AI traffic, lofted from a side profile (roof line, belt line, wheel
// arches) and a rounded cross-section, so they get smooth highlights, a narrower glass-house
// with tumblehome and real wheel arches. Each variant yields two geometries: the painted body
// (tinted per car) and the dark parts (glass, grille, bumpers, arch liners, underbody).
import * as THREE from 'three';
import { smoothstep } from './util.js';

const V = (z, y) => [z, y];

// z: forward (front = +L/2), y: up. Profiles are [z, y] pairs sorted by z.
const SEDAN = {
  L: 4.7,
  W: 1.82,
  wheelR: 0.32,
  axles: [-1.35, 1.4],
  bottom: 0.3,
  top: [V(-2.35, 0.74), V(-2.3, 0.93), V(-2.1, 1.0), V(-1.55, 1.04), V(-1.3, 1.1), V(-0.9, 1.4), V(0.2, 1.45), V(0.45, 1.43), V(1.2, 1.02), V(1.45, 0.97), V(2.15, 0.86), V(2.35, 0.72)],
  belt: [V(-2.35, 0.72), V(-2.2, 0.92), V(-1.4, 0.99), V(0.3, 0.97), V(1.25, 0.96), V(2.15, 0.85), V(2.35, 0.7)],
  glass: { front: [0.52, 1.17], rear: [-1.24, -0.94], side: [-0.95, 1.12], splits: [-0.2] },
  head: 0.66,
  tail: 0.9,
  plateF: 0.42,
  plateR: 0.66,
};

const ESTATE = {
  ...SEDAN,
  top: [V(-2.35, 0.74), V(-2.33, 1.0), V(-2.25, 1.36), V(-2.05, 1.45), V(0.2, 1.47), V(0.45, 1.45), V(1.2, 1.02), V(1.45, 0.97), V(2.15, 0.86), V(2.35, 0.72)],
  belt: [V(-2.35, 0.72), V(-2.3, 0.97), V(-1.4, 1.0), V(0.3, 0.97), V(1.25, 0.96), V(2.15, 0.85), V(2.35, 0.7)],
  glass: { front: [0.52, 1.17], rear: null, tail: [1.03, 1.37], side: [-2.0, 1.12], splits: [-0.2, -1.25] },
  rails: true,
  tail: 0.98,
  plateR: 0.62,
};

const HATCH = {
  L: 4.1,
  W: 1.76,
  wheelR: 0.31,
  axles: [-1.28, 1.3],
  bottom: 0.3,
  top: [V(-2.05, 0.74), V(-2.02, 1.02), V(-1.9, 1.38), V(-1.65, 1.46), V(0.15, 1.48), V(0.35, 1.46), V(1.05, 1.0), V(1.3, 0.95), V(1.9, 0.84), V(2.05, 0.7)],
  belt: [V(-2.05, 0.72), V(-1.95, 0.98), V(-1.6, 1.0), V(0.9, 0.95), V(1.9, 0.83), V(2.05, 0.68)],
  glass: { front: [0.42, 1.01], rear: null, tail: [1.04, 1.38], side: [-1.62, 0.98], splits: [-0.35] },
  head: 0.64,
  tail: 0.98,
  plateF: 0.4,
  plateR: 0.6,
};

const SUV = {
  L: 4.7,
  W: 1.9,
  wheelR: 0.36,
  axles: [-1.35, 1.42],
  bottom: 0.4,
  top: [V(-2.35, 0.86), V(-2.32, 1.15), V(-2.2, 1.6), V(-1.95, 1.68), V(0.35, 1.7), V(0.55, 1.68), V(1.25, 1.2), V(1.55, 1.14), V(2.2, 1.02), V(2.35, 0.86)],
  belt: [V(-2.35, 0.84), V(-2.25, 1.12), V(-1.9, 1.16), V(1.2, 1.12), V(2.2, 1.0), V(2.35, 0.84)],
  glass: { front: [0.62, 1.22], rear: null, tail: [1.2, 1.58], side: [-1.9, 1.18], splits: [-0.25, -1.2] },
  rails: true,
  head: 0.84,
  tail: 1.14,
  plateF: 0.52,
  plateR: 0.78,
};

const scaleZ = (spec, f) => ({
  ...spec,
  L: spec.L * f,
  axles: spec.axles.map((z) => z * f),
  top: spec.top.map(([z, y]) => [z * f, y]),
  belt: spec.belt.map(([z, y]) => [z * f, y]),
  glass: { ...spec.glass, front: spec.glass.front.map((z) => z * f), rear: spec.glass.rear && spec.glass.rear.map((z) => z * f), side: spec.glass.side.map((z) => z * f), splits: spec.glass.splits.map((z) => z * f) },
});

const TAXI = { ...scaleZ(SEDAN, 4.9 / 4.7), W: 1.84, taxi: true };

const VAN = {
  L: 5.3,
  W: 2.0,
  wheelR: 0.35,
  axles: [-1.65, 1.72],
  bottom: 0.38,
  top: [V(-2.65, 0.9), V(-2.64, 2.2), V(-2.55, 2.28), V(0.9, 2.32), V(1.2, 2.26), V(1.7, 1.5), V(1.95, 1.32), V(2.5, 1.12), V(2.65, 0.88)],
  belt: [V(-2.65, 0.88), V(-2.63, 2.15), V(0.8, 2.2), V(0.97, 1.2), V(1.7, 1.18), V(2.5, 1.1), V(2.65, 0.86)],
  glass: { front: null, screen: [1.56, 2.18], rear: null, side: [0.99, 1.6], splits: [] },
  head: 0.95,
  tail: 1.05,
  plateF: 0.5,
  plateR: 0.62,
};

// Box truck: lofted cab in front, cargo box behind.
const TRUCK = {
  L: 7.6,
  W: 2.45,
  wheelR: 0.48,
  axles: [-1.9, 2.75],
  bottom: 0.62,
  cab: [1.8, 3.8],
  top: [V(1.8, 2.55), V(3.4, 2.62), V(3.7, 2.5), V(3.8, 2.32)],
  belt: [V(1.8, 1.52), V(3.8, 1.48)],
  glass: { front: null, rear: null, side: [2.25, 3.5], splits: [] },
  windscreen: [1.55, 2.2],
  box: [-3.8, 1.72, 0.95, 3.2],
  head: 0.8,
  tail: 1.0,
  plateF: 0.55,
  plateR: 0.75,
  dual: true,
};

export const VARIANTS = {
  sedan: SEDAN,
  estate: ESTATE,
  hatch: HATCH,
  suv: SUV,
  taxi: TAXI,
  van: VAN,
  truck: TRUCK,
};

// Visual variants per traffic type (picked by the car's id).
export const VARIANTS_OF = { sedan: ['sedan', 'estate'], hatch: ['hatch'], suv: ['suv'], taxi: ['taxi'], van: ['van'], truck: ['truck'] };

// Smooth monotone cubic interpolation through the profile points (Fritsch–Carlson): no
// ripples between the key points and no overshoot.
const TANGENTS = new WeakMap();
function tangents(pts) {
  let m = TANGENTS.get(pts);
  if (m) return m;
  const n = pts.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1e-6));
  m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = (3 * a * d[i]) / h;
      m[i + 1] = (3 * b * d[i]) / h;
    }
  }
  TANGENTS.set(pts, m);
  return m;
}

function interp(pts, z) {
  if (z <= pts[0][0]) return pts[0][1];
  const m = tangents(pts);
  for (let i = 1; i < pts.length; i++) {
    if (z <= pts[i][0]) {
      const [z0, y0] = pts[i - 1];
      const [z1, y1] = pts[i];
      const h = z1 - z0 || 1e-6;
      const t = (z - z0) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i];
    }
  }
  return pts[pts.length - 1][1];
}

const lerp = (a, b, t) => a + (b - a) * t;

class Loft {
  constructor(spec, z0, z1) {
    this.s = spec;
    this.z0 = z0;
    this.z1 = z1;
    // Shoulder line: the smooth upper body starts above the wheel arches.
    this.shoulder = spec.wheelR * 2 + 0.1;
  }

  bottom(z) {
    const s = this.s;
    let y = s.bottom;
    for (const a of s.axles) {
      const R = s.wheelR + 0.07;
      const dz = z - a;
      if (Math.abs(dz) < R) y = Math.max(y, s.wheelR + Math.sqrt(R * R - dz * dz) * 0.97);
    }
    return Math.min(y, this.shoulder - 0.01);
  }

  halfWidth(z) {
    const s = this.s;
    const e = Math.max(smoothstep(this.z1 - 0.55, this.z1, z), smoothstep(this.z0 + 0.55, this.z0, z));
    return (s.W / 2) * (1 - 0.12 * Math.pow(e, 1.5));
  }

  // Upper body, left half: shoulder → belt → glass-house / bonnet → roof centre.
  half(z) {
    const s = this.s;
    const sh = this.shoulder;
    const yBelt = Math.max(Math.min(interp(s.belt, z), interp(s.top, z) - 0.02), sh + 0.03);
    const yt = Math.max(interp(s.top, z), yBelt + 0.02);
    const w = this.halfWidth(z);
    const cab = smoothstep(0.08, 0.3, yt - yBelt);
    const wg = w * 0.8;
    return [
      [w, sh],
      [w * 0.995, sh + (yBelt - sh) * 0.55],
      [w * 0.975, yBelt - 0.015],
      [lerp(w * 0.92, w * 0.89, cab), yBelt + lerp(0.012, 0.05, cab)],
      [lerp(w * 0.72, wg, cab), lerp(yt - 0.012, yBelt + (yt - yBelt) * 0.82, cab)],
      [lerp(w * 0.38, wg * 0.86, cab), yt - 0.003],
      [0, yt + 0.015],
    ];
  }

  // Lower body, left half: sill (rising over the wheel arches) → shoulder.
  lowerHalf(z) {
    const sh = this.shoulder;
    const yb = this.bottom(z);
    const w = this.halfWidth(z);
    return [
      [w * 0.94, yb],
      [w * 0.995, Math.max(yb, this.s.bottom + (sh - this.s.bottom) * 0.4)],
      [w, sh],
      [0, sh],
    ];
  }

  ring(z, lower = false) {
    const h = lower ? this.lowerHalf(z) : this.half(z);
    const out = h.map(([x, y]) => [x, y]);
    for (let i = h.length - 2; i >= 0; i--) out.push([-h[i][0], h[i][1]]);
    return out;
  }
}

// Geometry accumulator with vertex colours.
class Acc {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }

  tri(a, b, c, n, col) {
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(...(n || [0, 1, 0]));
      this.col.push(...col);
    }
  }

  // Quad with per-vertex normals (a b c d counter-clockwise from outside).
  quadN(a, b, c, d, na, nb, nc, nd, col) {
    const P = [a, b, c, a, c, d];
    const N = [na, nb, nc, na, nc, nd];
    for (let i = 0; i < 6; i++) {
      this.pos.push(...P[i]);
      this.nor.push(...N[i]);
      this.col.push(...col);
    }
  }

  box(cx, cy, cz, w, h, d, col) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(cx, cy, cz);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.nor.push(n[i], n[i + 1], n[i + 2]);
      this.col.push(...col);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const rgb = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// Build the smooth lofted skin between z0 and z1 into `acc` (indexed grid → smooth normals).
function skin(loft, zs, acc, col, capFront = true, capRear = true, lower = false) {
  const rings = zs.map((z) => loft.ring(z, lower).map(([x, y]) => [x, y, z]));
  const n = rings[0].length;
  const pos = [];
  for (const r of rings) for (const p of r) pos.push(...p);
  const idx = [];
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  const P = ng.attributes.position.array;
  const N = ng.attributes.normal.array;
  for (let i = 0; i < P.length; i++) acc.pos.push(P[i]);
  for (let i = 0; i < N.length; i++) acc.nor.push(N[i]);
  for (let i = 0; i < P.length / 3; i++) acc.col.push(...col);
  // End caps: a slightly shrunken ring (rounded bumper edge) and a flat face.
  const cap = (ring, dir) => {
    const z = ring[0][2];
    let cx = 0;
    let cy = 0;
    for (const p of ring) cy += p[1] / ring.length;
    const inner = ring.map(([x, y]) => [x * 0.9, cy + (y - cy) * 0.9, z + dir * 0.05]);
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      const c = inner[i + 1];
      const d = inner[i];
      const nrm = [a[0] * 0.3, (a[1] - cy) * 0.3, dir * 0.9];
      if (dir > 0) acc.quadN(a, b, c, d, nrm, nrm, nrm, nrm, col);
      else acc.quadN(b, a, d, c, nrm, nrm, nrm, nrm, col);
    }
    const fn = [0, 0, dir];
    const centre = [cx, cy, z + dir * 0.05];
    for (let i = 0; i < inner.length - 1; i++) {
      if (dir > 0) acc.tri(inner[i], inner[i + 1], centre, fn, col);
      else acc.tri(inner[i + 1], inner[i], centre, fn, col);
    }
    // Close the bottom of the cap (sill line straight across).
    const l = inner[0];
    const r = inner[inner.length - 1];
    if (dir > 0) acc.tri(r, l, centre, fn, col);
    else acc.tri(l, r, centre, fn, col);
  };
  if (capRear) cap(rings[0], -1);
  if (capFront) cap(rings[rings.length - 1], 1);
}

// Points of the glass along a section: between section params (index-based) t0..t1 of the
// half-section, offset outward a little.
function sectionPoint(half, t) {
  const f = t * (half.length - 1);
  const i = Math.min(half.length - 2, Math.floor(f));
  const u = f - i;
  return [lerp(half[i][0], half[i + 1][0], u), lerp(half[i][1], half[i + 1][1], u)];
}

function outward(half, t) {
  const a = sectionPoint(half, Math.max(0, t - 0.02));
  const b = sectionPoint(half, Math.min(1, t + 0.02));
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l]; // rotate tangent (going up/inward) → outward
}

function glassStrip(loft, acc, za, zb, t0, t1, side, col, off = 0.012) {
  const steps = Math.max(2, Math.ceil(Math.abs(zb - za) / 0.15));
  const cols = 4;
  const rows = [];
  for (let k = 0; k <= steps; k++) {
    const z = za + ((zb - za) * k) / steps;
    const half = loft.half(z);
    const row = [];
    for (let c = 0; c <= cols; c++) {
      const t = t0 + ((t1 - t0) * c) / cols;
      const [x, y] = sectionPoint(half, t);
      const [nx, ny] = outward(half, t);
      row.push({ p: [side * (x + nx * off), y + ny * off, z], n: [side * nx, ny, 0] });
    }
    rows.push(row);
  }
  for (let k = 0; k < steps; k++) {
    for (let c = 0; c < cols; c++) {
      const a = rows[k][c];
      const b = rows[k][c + 1];
      const d = rows[k + 1][c];
      const e = rows[k + 1][c + 1];
      // Orientation: outward-facing for either side and either z direction.
      const flip = (side > 0) !== (zb > za);
      if (!flip) acc.quadN(a.p, b.p, e.p, d.p, a.n, b.n, e.n, d.n, col);
      else acc.quadN(a.p, d.p, e.p, b.p, a.n, d.n, e.n, b.n, col);
    }
  }
}

// Windscreen / rear window: across the top between the A (or C) pillars.
function glassTop(loft, acc, za, zb, col) {
  const t0 = 0.66;
  for (const side of [1, -1]) glassStrip(loft, acc, za, zb, t0, 1, side, col, 0.014);
}

// Glass on a steep end (tailgate, van windscreen): rows by height; z follows the roof line.
function glassSteep(loft, acc, y0, y1, end, col) {
  const s = loft.s;
  const zAt = (y) => {
    // Walk in from the end until the roof line reaches y.
    const step = 0.01 * -end;
    let z = end > 0 ? loft.z1 : loft.z0;
    for (let k = 0; k < 400 && interp(s.top, z) < y; k++) z += step;
    return z;
  };
  const rows = 5;
  const P = [];
  for (let r = 0; r <= rows; r++) {
    const y = y0 + ((y1 - y0) * r) / rows;
    const z = zAt(y);
    const w = loft.halfWidth(z) * lerp(0.84, 0.74, r / rows);
    P.push({ y, z: z + end * 0.018, w });
  }
  for (let r = 0; r < rows; r++) {
    const a = P[r];
    const b = P[r + 1];
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const l = Math.hypot(dy, dz) || 1;
    const n = [0, (-dz * end) / l, (dy * end) / l];
    const A = [a.w, a.y, a.z];
    const B = [-a.w, a.y, a.z];
    const C = [-b.w, b.y, b.z];
    const D = [b.w, b.y, b.z];
    if (end > 0) acc.quadN(B, A, D, C, n, n, n, n, col);
    else acc.quadN(A, B, C, D, n, n, n, n, col);
  }
}

export function buildCar(id) {
  const s = VARIANTS[id];
  const body = new Acc();
  const dark = new Acc();
  const paint = [1, 1, 1];
  const GLASS = rgb('#0c1218');
  const BLACK = rgb('#141516');
  const GREY = rgb('#2a2c30');
  const WELL = rgb('#0a0a0b');
  const z0 = s.cab ? s.cab[0] : -s.L / 2;
  const z1 = s.cab ? s.cab[1] : s.L / 2;
  const loft = new Loft(s, z0, z1);
  // Slices: even spacing plus dense around the wheel arches.
  const zs = new Set();
  for (let z = z0; z <= z1 + 1e-6; z += 0.075) zs.add(+z.toFixed(4));
  zs.add(z1);
  for (const a of s.axles) {
    const R = s.wheelR + 0.07;
    for (let k = -8; k <= 8; k++) {
      const z = a + (k / 8) * R * 1.02;
      if (z > z0 && z < z1) zs.add(+z.toFixed(4));
    }
  }
  const zl = [...zs].sort((a, b) => a - b);
  skin(loft, zl, body, paint, true, true);
  skin(loft, zl, body, paint, true, true, true);

  // Glass-house.
  const g = s.glass;
  if (g.side) {
    const cuts = [g.side[0], ...g.splits.slice().sort((a, b) => a - b), g.side[1]];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i] + (i ? 0.045 : 0);
      const b = cuts[i + 1] - (i < cuts.length - 2 ? 0.045 : 0);
      for (const side of [1, -1]) glassStrip(loft, dark, a, b, 0.48, 0.8, side, GLASS);
    }
  }
  if (g.front) glassTop(loft, dark, g.front[1], g.front[0], GLASS);
  if (g.rear) glassTop(loft, dark, g.rear[0], g.rear[1], GLASS);
  if (g.tail) glassSteep(loft, dark, g.tail[0], g.tail[1], -1, GLASS);
  if (g.screen) glassSteep(loft, dark, g.screen[0], g.screen[1], 1, GLASS);

  const hw = s.W / 2;
  const zf = z1;
  const zr = s.box ? s.box[0] : -s.L / 2;
  // Truck: cargo box and flat windscreen on the cab front.
  if (s.box) {
    const [b0, b1, y0, y1] = s.box;
    body.box(0, (y0 + y1) / 2, (b0 + b1) / 2, s.W, y1 - y0, b1 - b0, paint);
    dark.box(0, y0 - 0.12, (b0 + b1) / 2, s.W - 0.3, 0.24, b1 - b0, GREY);
    const [w0, w1] = s.windscreen;
    dark.box(0, (w0 + w1) / 2, zf + 0.04, s.W * 0.84, w1 - w0, 0.02, GLASS);
    dark.box(0, 0.85, zf + 0.04, s.W * 0.7, 0.35, 0.03, BLACK);
    dark.box(0, 0.5, zf + 0.02, s.W, 0.28, 0.12, GREY);
  }
  // Grille, lower intake, rear bumper insert, side sills.
  if (!s.box) {
    const yb = s.bottom;
    dark.box(0, s.head - 0.06, zf + 0.06, s.W * 0.34, 0.1, 0.03, BLACK);
    dark.box(0, yb + 0.08, zf + 0.055, s.W * 0.5, 0.07, 0.03, BLACK);
    dark.box(0, yb + 0.06, zr - 0.055, s.W * 0.78, 0.1, 0.03, GREY);
  }
  // Wheel wells and underbody (fill the view into the arches).
  for (const a of s.axles) dark.box(0, s.wheelR + 0.1, a, s.W - 0.72, s.wheelR * 1.4, (s.wheelR + 0.06) * 2, WELL);
  dark.box(0, s.bottom * 0.62, (s.box ? s.box[0] + s.cab[1] : 0) / 2, s.W - 0.5, s.bottom * 0.45, (s.cab ? s.cab[1] - s.box[0] : s.L) - 1.1, WELL);
  // Door seams and handles on the sides.
  if (g.side && !s.box) {
    const doors = [g.side[1] + 0.08, ...g.splits.filter((z) => z > g.side[0] + 0.3)];
    if (id !== 'van') doors.push(g.side[0] + (g.splits.length > 1 ? 0 : -0.05));
    const yb = loft.shoulder - 0.05;
    for (const z of doors) {
      const top = interp(s.belt, z) - 0.02;
      const bot = Math.max(loft.bottom(z), s.bottom) + 0.03;
      const w = loft.halfWidth(z);
      for (const side of [1, -1]) {
        dark.box(side * (w + 0.004), (top + bot) / 2, z, 0.012, top - bot, 0.012, BLACK);
      }
    }
    for (let i = 0; i < doors.length - 1; i++) {
      const z = doors[i] - 0.16;
      const w = loft.halfWidth(z);
      for (const side of [1, -1]) dark.box(side * (w + 0.012), yb + 0.2, z, 0.02, 0.035, 0.16, GREY);
    }
  }
  // Mirrors (painted caps on dark arms).
  const mz = s.glass.side ? s.glass.side[1] - 0.08 : zf - 0.9;
  const my = interp(s.belt, mz) + 0.08;
  for (const side of [1, -1]) {
    body.box(side * (hw + 0.1), my, mz, 0.16, 0.12, 0.2, paint);
    dark.box(side * (hw + 0.02), my - 0.02, mz + 0.02, 0.1, 0.03, 0.06, BLACK);
  }
  // Roof rails.
  if (s.rails) {
    const [a, b] = [s.glass.side[0] + 0.1, s.glass.front[0] - 0.05];
    for (const side of [1, -1]) {
      const y = interp(s.top, (a + b) / 2) + 0.04;
      dark.box(side * hw * 0.62, y, (a + b) / 2, 0.05, 0.05, b - a, GREY);
    }
  }
  return { body: body.build(), dark: dark.build(), spec: s };
}

// Wheel: tyre, rim and hub (vertex-coloured), axis along x, radius 1.
export function wheelGeometry() {
  const parts = [];
  const add = (g, color) => {
    const ng = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(color);
    const n = ng.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(ng);
  };
  const tyre = new THREE.CylinderGeometry(1, 1, 0.68, 18, 1, true);
  tyre.rotateZ(Math.PI / 2);
  add(tyre, '#161617');
  for (const sx of [1, -1]) {
    const side = new THREE.RingGeometry(0.66, 1, 18);
    side.rotateY((sx * Math.PI) / 2);
    side.translate(sx * 0.34, 0, 0);
    add(side, '#1b1b1c');
    const rim = new THREE.CircleGeometry(0.66, 18);
    rim.rotateY((sx * Math.PI) / 2);
    rim.translate(sx * 0.345, 0, 0);
    add(rim, '#aeb3b8');
    // Five spoke shadows.
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const gap = new THREE.CircleGeometry(0.16, 8);
      gap.rotateY((sx * Math.PI) / 2);
      gap.translate(sx * 0.35, Math.cos(a) * 0.42, Math.sin(a) * 0.42);
      add(gap, '#3a3d42');
    }
    const hub = new THREE.CircleGeometry(0.14, 10);
    hub.rotateY((sx * Math.PI) / 2);
    hub.translate(sx * 0.352, 0, 0);
    add(hub, '#7c8288');
  }
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['color', 3],
  ]) {
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

// Lamp, plate and wheel positions for a variant (local coordinates).
export function carLayout(id) {
  const s = VARIANTS[id];
  const zf = s.cab ? s.cab[1] : s.L / 2;
  const zr = s.box ? s.box[0] : -s.L / 2;
  const hw = s.W / 2;
  const track = hw - (s.dual ? 0.3 : 0.2);
  return {
    head: { x: hw - 0.36, y: s.head, z: zf + 0.07 },
    tail: { x: hw - 0.27, y: s.tail, z: zr - 0.07 },
    plateF: { y: s.plateF, z: zf + 0.085 },
    plateR: { y: s.plateR, z: zr - 0.085 },
    wheels: s.axles.map((z) => ({ z, x: track, r: s.wheelR, front: z > 0 })),
    wheelbase: s.axles[1] - s.axles[0],
    width: s.W,
    length: s.L,
    roof: interp(s.top, 0),
  };
}

