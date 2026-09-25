// Open-world road network beyond the circuit: the Kaminari touge over the twin peaks, the lake road
// past the festival and a gravel road through the south. Pure data, shared by physics, map and tests.

import { ROAD, WORLD, FESTIVAL, MOUNTAIN } from './config.js';
import { Track } from './track.js';
import { clamp } from './util.js';

// Cross-section and profile limits per road type.
export const ROAD_TYPES = {
  touge: { width: 10, shoulder: 1.3, surface: 0, maxGrade: 0.1, crestSpeed: 30, sigma: 10, label: 'Bergstraße' },
  lake: { width: 11.5, shoulder: 1.5, surface: 0, maxGrade: 0.065, crestSpeed: 55, sigma: 30, label: 'Landstraße' },
  gravel: { width: 8.5, shoulder: 1.2, surface: 2, maxGrade: 0.1, crestSpeed: 26, sigma: 15, label: 'Schotterstraße' },
};

// Switchbacks stacked up a slope. `top` is the upper end, `down` the downhill axis direction.
// Hairpin centres alternate sides of the axis at lateral offset `reach`; each one is placed as far
// down the axis as the terrain allows for the road to climb to the previous one at `grade`.
// Returns control points from the bottom to the top (half circles around each hairpin centre).
export function contourSwitchbacks({ top, down, heightAt, reach, radius, grade, rows, startSide = 1, maxRun = 500 }) {
  const a = [-down[0], -down[1]]; // uphill
  const p = [a[1], -a[0]];
  const centre = (u, side) => [top[0] + down[0] * u + p[0] * side * reach, top[1] + down[1] * u + p[1] * side * reach];
  const list = [];
  let uPrev = 0;
  let hPrev = heightAt(top[0], top[1]);
  let side = startSide;
  for (let k = 0; k < rows; k++) {
    let found = null;
    const minU = uPrev + (k === 0 ? radius + 8 : 2 * radius + 9);
    for (let u = minU; u < maxRun; u += 1) {
      const c = centre(u, side);
      const du = u - uPrev;
      // The top leg starts on the axis, all others at the opposite hairpin.
      const path = Math.hypot(k === 0 ? reach : 2 * reach, du) + Math.PI * radius * 0.5;
      if (hPrev - heightAt(c[0], c[1]) >= grade * path) {
        found = { u, c, h: heightAt(c[0], c[1]) };
        break;
      }
    }
    if (!found) break;
    list.push({ ...found, side });
    uPrev = found.u;
    hPrev = found.h;
    side = -side;
  }
  // Bottom to top, half circles on the outside of each hairpin.
  const pts = [];
  for (let k = list.length - 1; k >= 0; k--) {
    const { c, side: sd } = list[k];
    for (let j = 0; j <= 4; j++) {
      const phi = (j / 4) * Math.PI;
      const ca = -Math.cos(phi) * radius;
      const cp = Math.sin(phi) * radius * sd;
      pts.push([c[0] + a[0] * ca + p[0] * cp, c[1] + a[1] * ca + p[1] * cp]);
    }
  }
  return { points: pts, hairpins: list.length, bottom: list.length ? list[list.length - 1] : null, lateral: p, uphill: a };
}

// Branch road designs. Junction ends are snapped to the road they join when the network is built.
export function roadPlans(heightAt) {
  const plans = [];
  // Lake road: from the circuit south of the festival, along the festival plaza and the north shore
  // to the circuit on the east side.
  plans.push({
    id: 'lake',
    name: 'Seestraße',
    type: 'lake',
    points: [
      [10, 852],
      [-8, 730],
      [-48, 575],
      [-96, 430],
      [-70, 292],
      [110, 262],
      [300, 232],
      [500, 222],
      [700, 232],
      [900, 268],
      [1080, 312],
      [1225, 318],
    ],
    snapStart: 'circuit',
    snapEnd: 'circuit',
  });
  // Touge over the Kaminari pass: from the circuit in the east, in hairpins up the north-east flank,
  // across the pass and down the south-west flank to the festival.
  const M = MOUNTAIN;
  const n = M.normal; // points north-east
  const topNE = [M.passPoint[0] + n[0] * 14, M.passPoint[1] + n[1] * 14];
  const topSW = [M.passPoint[0] - n[0] * 14, M.passPoint[1] - n[1] * 14];
  // Pick the side the switchbacks start on so the lowest hairpin opens towards where the road comes from.
  const stack = (top, down, reach, towards) => {
    let best = null;
    for (const startSide of [1, -1]) {
      const sb = contourSwitchbacks({ top, down, heightAt, reach, radius: 14, grade: 0.085, rows: 9, startSide });
      const b = sb.bottom;
      const facing = ((towards[0] - b.c[0]) * sb.lateral[0] + (towards[1] - b.c[1]) * sb.lateral[1]) * -b.side;
      if (!best || facing > best.facing) best = { sb, facing };
    }
    return best.sb;
  };
  const junction = [986, -719];
  const gate = [-22, 104];
  const ne = stack(topNE, n, 70, junction);
  const sw = stack(topSW, [-n[0], -n[1]], 62, gate);
  const swDown = [...sw.points].reverse();
  // A point on the approach leg before the lowest hairpin (coming in from the open side, slightly below).
  const lead = (sb, dist) => {
    const b = sb.bottom;
    const e = [b.c[0] - sb.uphill[0] * 14, b.c[1] - sb.uphill[1] * 14];
    return [e[0] - sb.lateral[0] * b.side * dist - sb.uphill[0] * dist * 0.3, e[1] - sb.lateral[1] * b.side * dist - sb.uphill[1] * dist * 0.3];
  };
  plans.push({
    id: 'touge',
    name: 'Kaminari-Touge',
    type: 'touge',
    points: [junction, lead(ne, 170), lead(ne, 70), ...ne.points, topNE, topSW, ...swDown, lead(sw, 70), lead(sw, 170), gate],
    snapStart: 'circuit',
    endAt: 'festival',
  });
  // Gravel road through the southern woods, from the circuit to the south shore of the lake.
  plans.push({
    id: 'gravel',
    name: 'Südwald-Schotter',
    type: 'gravel',
    points: [
      [-640, 845],
      [-600, 1010],
      [-470, 1160],
      [-300, 1300],
      [-80, 1380],
      [160, 1430],
      [380, 1420],
      [520, 1340],
      [585, 1245],
    ],
    snapStart: 'circuit',
    snapEnd: 'circuit',
  });
  return plans;
}

// Smooth an open or closed height profile: Gaussian smoothing, a grade limit and a crest limit
// (vertical curvature h'' > -g / v^2), keeping pinned samples fixed and easing into them.
export function smoothProfile(raw, { closed, spacing, maxGrade, crestSpeed, fixed, fixedHeight, ease = 90, floor = -Infinity, sigma = 30 }) {
  const n = raw.length;
  const idx = (i) => (closed ? (i % n + n) % n : i < 0 ? 0 : i >= n ? n - 1 : i);
  const smooth = (src, radius, sigma) => {
    const out = new Float32Array(n);
    const weights = [];
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      weights.push(w);
      wsum += w;
    }
    for (let i = 0; i < n; i++) {
      if (fixed && fixed[i]) {
        out[i] = src[i];
        continue;
      }
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += src[idx(i + k)] * weights[k + radius];
      out[i] = s / wsum;
    }
    return out;
  };
  let h = smooth(raw, Math.ceil(sigma * 2.35), sigma);
  for (let i = 0; i < n; i++) {
    h[i] = Math.max(h[i], floor);
    if (fixed && fixed[i]) h[i] = fixedHeight[i];
  }
  const maxStep = maxGrade * spacing;
  const limit = () => {
    for (let pass = 0; pass < 4; pass++) {
      const span = closed ? n * 2 : n;
      for (let k = 1; k < span; k++) {
        const a = idx(k);
        const p = idx(k - 1);
        if (!fixed || !fixed[a]) h[a] = clamp(h[a], h[p] - maxStep, h[p] + maxStep);
      }
      for (let k = span - 2; k >= 0; k--) {
        const a = idx(k);
        const p = idx(k + 1);
        if (!fixed || !fixed[a]) h[a] = clamp(h[a], h[p] - maxStep, h[p] + maxStep);
      }
    }
  };
  limit();
  // Distance (in samples) to the nearest pinned sample, used to ease into junctions and plateaus.
  const distFixed = new Float32Array(n).fill(1e9);
  if (fixed) {
    for (let pass = 0; pass < 2; pass++) {
      const span = closed ? 2 * n : n;
      for (let k = 0; k < span; k++) {
        const i = idx(k);
        distFixed[i] = fixed[i] ? 0 : Math.min(distFixed[i], k > 0 || closed ? distFixed[idx(k - 1)] + 1 : 1e9);
      }
      for (let k = span - 1; k >= 0; k--) {
        const i = idx(k);
        distFixed[i] = Math.min(distFixed[i], k < span - 1 || closed ? distFixed[idx(k + 1)] + 1 : 1e9);
      }
    }
  }
  const minCurv = -9.81 / (crestSpeed * crestSpeed);
  const nearestFixedHeight = (i) => {
    for (let k = 0; k < ease + 2; k++) {
      const a = idx(i - k);
      if (fixed[a]) return fixedHeight[a];
      const b = idx(i + k);
      if (fixed[b]) return fixedHeight[b];
    }
    return h[i];
  };
  for (let pass = 0; pass < 12; pass++) {
    h = smooth(h, 40, 15);
    if (fixed) {
      for (let i = 0; i < n; i++) {
        if (distFixed[i] >= ease) continue;
        // Blend towards the nearest pinned height so junctions stay level.
        const t = distFixed[i] / ease;
        const w = t * t * (3 - 2 * t);
        const anchor = nearestFixedHeight(i);
        h[i] = anchor + (h[i] - anchor) * w;
      }
    }
    let worst = 0;
    for (let i = 1; i < n - 1 || (closed && i < n); i++) {
      const c = (h[idx(i + 1)] - 2 * h[i] + h[idx(i - 1)]) / (spacing * spacing);
      worst = Math.min(worst, c);
    }
    if (worst > minCurv) break;
  }
  limit();
  return h;
}

// Distance over which a branch tilts from the slope of the road it joins to its own cross-section.
const JUNCTION_BLEND = 22;

// Builds the branch roads (after the circuit, before the terrain).
export function buildRoadNetwork(world) {
  const circuit = world.track;
  circuit.halfTotal = ROAD.halfTotal;
  circuit.half = ROAD.half;
  circuit.id = 'circuit';
  circuit.name = 'Seeufer-Ring';
  const branches = [];
  const tmp = {};
  for (const plan of roadPlans((x, z) => world.naturalHeight(x, z))) {
    const type = ROAD_TYPES[plan.type];
    const pts = plan.points.map((p) => [p[0], p[1]]);
    // Snap junction ends onto the centre line of the road they join.
    const snap = (p) => {
      const q = circuit.nearest(p[0], p[1], -1, tmp, 6);
      if (q.index >= 0) {
        const c = circuit.pointAt(q.s, 0, {});
        p[0] = c.x;
        p[1] = c.z;
      }
    };
    if (plan.snapStart === 'circuit') snap(pts[0]);
    if (plan.snapEnd === 'circuit') snap(pts[pts.length - 1]);
    const road = new Track(pts, ROAD.spacing, { closed: false });
    road.id = plan.id;
    road.name = plan.name;
    road.type = plan.type;
    road.width = type.width;
    road.half = type.width / 2;
    road.halfTotal = road.half + type.shoulder;
    road.shoulder = type.shoulder;
    road.surface = type.surface;
    road.endAt = plan.endAt || null;
    road.junctions = [];
    const n = road.count;
    const raw = new Float32Array(n);
    const fixed = new Uint8Array(n);
    const fixedHeight = new Float32Array(n);
    const joined = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const x = road.x[i];
      const z = road.z[i];
      raw[i] = world.naturalHeight(x, z);
      // Pinned where the branch overlaps the circuit or an earlier branch.
      for (const other of [circuit, ...branches]) {
        const q = other.nearest(x, z, -1, tmp, 2);
        if (q.index >= 0 && q.dist < other.halfTotal + 1.5) {
          fixed[i] = 1;
          fixedHeight[i] = q.height;
          joined[i] = { other, dist: q.dist };
          break;
        }
      }
      // Level with the festival plaza wherever a road touches it.
      if (!fixed[i] && Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z) < FESTIVAL.radius + 6) {
        fixed[i] = 1;
        fixedHeight[i] = world.festivalHeight;
      }
    }
    // Junctions: where the branch centre line meets the other road's centre line.
    for (let i = 0; i < n; ) {
      if (!joined[i]) {
        i++;
        continue;
      }
      let best = i;
      let j = i;
      while (j < n && joined[j] && joined[j].other === joined[i].other) {
        if (joined[j].dist < joined[best].dist) best = j;
        j++;
      }
      road.junctions.push({ other: joined[i].other, s: best * road.spacing, reach: joined[i].other.halfTotal + 1 });
      i = j;
    }
    const h = smoothProfile(raw, {
      closed: false,
      spacing: road.spacing,
      maxGrade: type.maxGrade,
      crestSpeed: type.crestSpeed,
      fixed,
      fixedHeight,
      ease: 25,
      floor: WORLD.waterLevel + 3,
      sigma: type.sigma,
    });
    road.h.set(h);
    // Bounding box for quick rejection in ground queries.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, road.x[i]);
      maxX = Math.max(maxX, road.x[i]);
      minZ = Math.min(minZ, road.z[i]);
      maxZ = Math.max(maxZ, road.z[i]);
    }
    const pad = road.halfTotal + 2;
    road.bbox = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
    branches.push(road);
  }
  world.branches = branches;
  return branches;
}

const _c = {};
const _p = {};
// Surface height of a branch at (x, z) given its centre-line query `q`: shoulders drop off slightly, and
// near a junction the surface takes on the slope of the joined road so both meet without a step.
export function branchSurface(road, x, z, q) {
  const l = Math.abs(q.lateral);
  let h = q.height - (l > road.half ? ((l - road.half) / road.shoulder) * 0.1 : 0);
  for (const j of road.junctions) {
    const e = Math.abs(q.s - j.s) - j.reach;
    if (e > JUNCTION_BLEND) continue;
    const t = e <= 0 ? 0 : Math.min(1, e / JUNCTION_BLEND);
    const w = 1 - t * t * (3 - 2 * t);
    const at = j.other.nearest(x, z, -1, _p, 2);
    if (at.index < 0) continue;
    const hPoint = at.height;
    road.pointAt(q.s, 0, _c);
    const atC = j.other.nearest(_c.x, _c.z, -1, _p, 2);
    if (atC.index < 0) continue;
    h += w * (hPoint - atC.height);
  }
  return h;
}

// Best branch ribbon under (x, z): writes { road, index, s, lateral, dist, height } into `out` and
// returns it, or null when no branch covers the point. The ends of open roads are cut square.
export function branchAt(world, x, z, out, qTmp) {
  let best = null;
  for (const road of world.branches || []) {
    const b = road.bbox;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    const q = road.nearest(x, z, -1, qTmp, 1);
    if (q.index < 0 || q.dist > road.halfTotal) continue;
    const f = q.index + q.t;
    if (f <= 0 || f >= road.count - 1) {
      // Beyond an open end: the projection is clamped, so only accept points beside the end sample.
      const i = f <= 0 ? 0 : road.count - 1;
      const along = (x - road.x[i]) * road.tx[i] + (z - road.z[i]) * road.tz[i];
      if (i === 0 ? along < -0.05 : along > 0.05) continue;
    }
    const h = branchSurface(road, x, z, q);
    if (!best || h > best.height) {
      best = out;
      out.road = road;
      out.index = q.index;
      out.s = q.s;
      out.lateral = q.lateral;
      out.dist = q.dist;
      out.height = h;
      out.tx = q.tx;
      out.tz = q.tz;
    }
  }
  return best;
}
