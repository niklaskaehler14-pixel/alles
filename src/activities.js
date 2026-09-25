// Open-world activity layout (pure data): checkpoint runs, drift zones, speed traps and jump ramps.
// Planned after the terrain and city exist, before vegetation, so trails and landing zones stay clear.

import { CITY, ROAD, WORLD } from './config.js';
import { clamp } from './util.js';

const TWO_PI = Math.PI * 2;

function segDist(px, pz, ax, az, bx, bz) {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez || 1;
  const t = clamp(((px - ax) * ex + (pz - az) * ez) / l2, 0, 1);
  return Math.hypot(px - (ax + ex * t), pz - (az + ez * t));
}

// Stars awarded for a result (higher is better unless `lowerIsBetter`).
export function starsFor(value, thresholds, lowerIsBetter = false) {
  if (!Number.isFinite(value)) return 0;
  let s = 0;
  for (const t of thresholds) if (lowerIsBetter ? value <= t : value >= t) s++;
  return s;
}

// Steepest grade and lowest ground along a straight leg (sampled every 5 m).
function legStats(hf, a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  let maxG = 0;
  let minH = Infinity;
  let prev = hf.get(a.x, a.z);
  for (let t = 5; t <= d; t += 5) {
    const x = a.x + ((b.x - a.x) * t) / d;
    const z = a.z + ((b.z - a.z) * t) / d;
    const h = hf.get(x, z);
    maxG = Math.max(maxG, Math.abs(h - prev) / 5);
    minH = Math.min(minH, h);
    prev = h;
  }
  return { maxG, minH, d };
}

// Off-road runs: road endpoints slide along the circuit and waypoints are nudged locally
// until every leg is drivable (moderate grades, no water, no buildings).
function refineOffroad(world, spec) {
  const tr = world.track;
  const hf = world.heightfield;
  const legCost = (a, b) => {
    const st = legStats(hf, a, b);
    let c = Math.max(0, st.maxG - 0.12) * 10 + st.maxG;
    if (st.minH < WORLD.waterLevel + 2.5) c += 20;
    if (Math.abs(b.x) > 1800 || Math.abs(b.z) > 1800) c += 20;
    return c;
  };
  const endpoint = (target, next) => {
    let best = null;
    for (let ds = -spec.window; ds <= spec.window; ds += 10) {
      const p = tr.pointAt(tr.startS + target + ds, 0, {});
      const cand = { x: p.x, z: p.z, road: true };
      const c = legCost(cand, next) + Math.abs(ds) * 0.0005;
      if (!best || c < best.c) best = { c, p: cand };
    }
    return best.p;
  };
  const pts = spec.waypoints.map(([x, z]) => ({ x, z }));
  let start = endpoint(spec.fromS, pts[0]);
  let end = spec.toS !== undefined ? endpoint(spec.toS, pts[pts.length - 1]) : null;
  const all = () => [start, ...pts, ...(end ? [end] : [])];
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < pts.length; i++) {
      const list = all();
      const k = i + 1;
      const prev = list[k - 1];
      const next = list[k + 1];
      let best = { c: Infinity };
      for (let dx = -60; dx <= 60; dx += 12) {
        for (let dz = -60; dz <= 60; dz += 12) {
          const cand = { x: pts[i].x + dx * (pass < 2 ? 1 : 0.4), z: pts[i].z + dz * (pass < 2 ? 1 : 0.4) };
          const c = legCost(prev, cand) + (next ? legCost(cand, next) : 0) + Math.hypot(dx, dz) * 0.002;
          if (c < best.c) best = { c, cand };
        }
      }
      pts[i] = best.cand;
    }
    start = endpoint(spec.fromS, pts[0]);
    if (end) end = endpoint(spec.toS, pts[pts.length - 1]);
  }
  return all();
}

export function planActivities(world) {
  const tr = world.track;
  const hf = world.heightfield;
  const clear = []; // corridors kept free of trees and rocks
  world.clearCorridors = clear;

  // ---------------------------------------------------------------- checkpoint runs
  const routes = [];
  const trackPoint = (s, lateral = 0) => {
    const p = tr.pointAt(tr.startS + s, lateral, {});
    return { x: p.x, z: p.z, road: true };
  };
  const cityPoint = (i, j) => ({ x: CITY.x + i * CITY.grid, z: CITY.z + j * CITY.grid, road: true });

  routes.push({
    id: 'run-city',
    name: 'Stadtkurs',
    blurb: 'Durch die Häuserschluchten, Kreuzung für Kreuzung',
    points: [[-2, 1], [0, 1], [2, 1], [2, -1], [0, -1], [0, -2], [-2, -2], [-2, 0], [-2, 1]].map(([i, j]) => cityPoint(i, j)),
    goldSpeed: 20,
  });

  const pass = [];
  for (let s = 1250; s <= 3050; s += 225) pass.push(trackPoint(s, 0));
  routes.push({ id: 'run-pass', name: 'Passstraße', blurb: 'Hinauf zum Nordkamm und durch die Kehren', points: pass, goldSpeed: 36 });

  routes.push({
    id: 'run-summit',
    name: 'Gipfelsturm',
    blurb: 'Querfeldein über den Nordkamm-Gipfel',
    points: refineOffroad(world, {
      fromS: 1700,
      toS: 2900,
      window: 260,
      waypoints: [
        [640, -1110],
        [610, -1190],
        [720, -1240],
        [860, -1200],
        [950, -1080],
        [1040, -960],
      ],
    }),
    goldSpeed: 19,
  });

  routes.push({
    id: 'run-forest',
    name: 'Waldpfad',
    blurb: 'Schotterweg quer durch den Südwald',
    points: refineOffroad(world, {
      fromS: 6000,
      toS: 6850,
      window: 200,
      waypoints: [
        [-740, 960],
        [-900, 1080],
        [-1080, 1040],
        [-1220, 900],
        [-1330, 700],
      ],
    }),
    goldSpeed: 18,
  });

  // Lake sprint: along the south shore road, then down a meadow to the beach.
  const lake = [];
  for (let s = 3650; s <= 4450; s += 200) lake.push(trackPoint(s, 0));
  const exit = lake[lake.length - 1];
  const toLake = { x: world.lakeCentre.x - exit.x, z: world.lakeCentre.z - exit.z };
  const dl = Math.hypot(toLake.x, toLake.z);
  for (let t = 20; t < dl; t += 5) {
    const x = exit.x + (toLake.x / dl) * t;
    const z = exit.z + (toLake.z / dl) * t;
    const h = hf.get(x, z);
    if (h < 3.2) {
      lake.push({ x: exit.x + (toLake.x / dl) * (t + 4), z: exit.z + (toLake.z / dl) * (t + 4) });
      break;
    }
  }
  routes.push({ id: 'run-lake', name: 'Seeufer-Sprint', blurb: 'Am Südufer entlang und runter an den Strand', points: lake, goldSpeed: 30 });

  for (const r of routes) {
    let len = 0;
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1];
      const b = r.points[i];
      len += Math.hypot(b.x - a.x, b.z - a.z);
      if (!(a.road && b.road)) clear.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r: 11, trail: true });
    }
    r.length = len;
    // Medal times in seconds: gold, silver, bronze.
    const gold = Math.round(len / r.goldSpeed);
    r.medals = [gold, Math.round(gold * 1.2), Math.round(gold * 1.45)];
    r.start = r.points[0];
    r.checkpoints = r.points.slice(1);
    for (const p of r.points) p.y = hf.get(p.x, p.z);
  }

  // ---------------------------------------------------------------- drift zones
  // The three stretches of the circuit with the most sustained curvature.
  const n = tr.count;
  const win = Math.round(420 / tr.spacing);
  const bend = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < win; k++) sum += Math.abs(tr.curv[(i + k) % n]);
    bend[i] = sum;
  }
  const zones = [];
  const names = ['Kehren-Zone', 'Seekurven', 'Waldschwünge'];
  const taken = [];
  // Circular distance along the loop below `gap` to any entry of `list`.
  const near = (s, list, gap) => list.some((t) => Math.abs(((s - t + tr.length * 1.5) % tr.length) - tr.length / 2) < gap);
  const order = [...bend.keys()].sort((a, b) => bend[b] - bend[a]);
  for (const i of order) {
    const s = i * tr.spacing;
    const rs = tr.wrapS(s - tr.startS);
    if (rs < 300 || rs > tr.length - 300) continue; // not on the start straight
    if (near(s, taken, 900)) continue;
    taken.push(s);
    zones.push({ s0: s, s1: s + win * tr.spacing });
    if (zones.length === 3) break;
  }
  zones.sort((a, b) => tr.wrapS(a.s0 - tr.startS) - tr.wrapS(b.s0 - tr.startS));
  world.driftZones = zones.map((z, k) => {
    const len = z.s1 - z.s0;
    return {
      id: `drift-${k}`,
      name: names[k] || `Drift-Zone ${k + 1}`,
      s0: z.s0,
      s1: z.s1,
      length: len,
      goals: [Math.round((len * 6) / 100) * 100, Math.round((len * 15) / 100) * 100, Math.round((len * 30) / 100) * 100],
    };
  });

  // ---------------------------------------------------------------- speed traps
  const straight = new Float32Array(n);
  const runUp = Math.round(300 / tr.spacing);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = 0; k < runUp; k++) m = Math.max(m, Math.abs(tr.curv[(i - k + n) % n]));
    straight[i] = m;
  }
  const traps = [];
  const trapOrder = [...straight.keys()].sort((a, b) => straight[a] - straight[b]);
  const placeName = (x, z) => {
    if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.radius + 80) return 'Stadt';
    if (Math.hypot(x - world.lakeCentre.x, z - world.lakeCentre.z) < 720) return x > world.lakeCentre.x ? 'Ostufer' : 'Südufer';
    if (z < -700) return 'Nordkamm';
    return x < 0 ? 'Westwald' : 'Hügelland';
  };
  world.placeName = placeName;
  for (const i of trapOrder) {
    const s = i * tr.spacing;
    if (near(s, traps.map((t) => t.s), 1200)) continue;
    if (world.driftZones.some((z) => tr.wrapS(s - z.s0) < z.length + 100)) continue;
    const p = tr.pointAt(s, 0, {});
    traps.push({ s, x: p.x, z: p.z, heading: p.heading });
    if (traps.length === 4) break;
  }
  traps.sort((a, b) => tr.wrapS(a.s - tr.startS) - tr.wrapS(b.s - tr.startS));
  world.speedTraps = traps.map((t, k) => {
    const inCity = Math.hypot(t.x - CITY.x, t.z - CITY.z) < CITY.radius + 50;
    const side = tr.pointAt(t.s, -(ROAD.halfTotal + 2.2), {});
    return {
      id: `trap-${k}`,
      name: inCity ? 'Blitzer Boulevard' : `Blitzer ${placeName(t.x, t.z)}`,
      s: t.s,
      x: t.x,
      z: t.z,
      poleX: side.x,
      poleZ: side.z,
      heading: t.heading,
      goals: inCity ? [120, 155, 190] : [150, 195, 235],
    };
  });

  // ---------------------------------------------------------------- jump ramps
  const ramps = [];
  const L = 16;
  const W = 7.5;
  const H = 2.7;
  const q = {};
  const candidates = [];
  for (let gx = -1700; gx <= 1700; gx += 50) {
    for (let gz = -1700; gz <= 1700; gz += 50) {
      const base = tr.nearest(gx, gz, -1, q, 4);
      const roadDist = base.index >= 0 ? base.dist : 999;
      if (roadDist < 35 || roadDist > 220) continue;
      if (Math.hypot(gx - CITY.x, gz - CITY.z) < CITY.radius + 60) continue;
      for (let k = 0; k < 8; k++) {
        const yaw = (k / 8) * TWO_PI;
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        let ok = true;
        let prev = hf.get(gx - fx * 40, gz - fz * 40);
        let drop = 0;
        for (let d = -40; d <= 150 && ok; d += 10) {
          const x = gx + fx * d;
          const z = gz + fz * d;
          const h = hf.get(x, z);
          if (h < WORLD.waterLevel + 3 || Math.abs(x) > 1850 || Math.abs(z) > 1850) ok = false;
          const g = (h - prev) / 10;
          if (d > -40 && (g > 0.07 || g < -0.14)) ok = false;
          for (const side of [-6, 6]) {
            const sx = x + fz * side;
            const sz = z - fx * side;
            const nb = tr.nearest(sx, sz, -1, q, 2);
            if (nb.index >= 0 && nb.dist < ROAD.halfTotal + 8) ok = false;
            if (Math.abs(hf.get(sx, sz) - h) > 1.2) ok = false;
          }
          if (d > 0) drop += prev - h;
          prev = h;
        }
        if (ok) candidates.push({ x: gx, z: gz, yaw, score: drop - roadDist * 0.03 });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (ramps.some((r) => Math.hypot(r.x - c.x, r.z - c.z) < 650)) continue;
    ramps.push({ id: `jump-${ramps.length}`, x: c.x, z: c.z, yaw: c.yaw, length: L, width: W, height: H, goals: [30, 45, 60] });
    clear.push({ ax: c.x - Math.sin(c.yaw) * 60, az: c.z - Math.cos(c.yaw) * 60, bx: c.x + Math.sin(c.yaw) * 170, bz: c.z + Math.cos(c.yaw) * 170, r: 16 });
    if (ramps.length === 4) break;
  }
  const rampNames = ['Westschanze', 'Waldschanze', 'Stadtschanze', 'Seeschanze'];
  [...ramps].sort((a, b) => a.x - b.x).forEach((r, k) => (r.name = rampNames[k] || `Schanze ${k + 1}`));
  ramps.forEach((r) => {
    r.baseY = hf.get(r.x, r.z);
  });
  world.ramps = ramps;
  world.routes = routes;
  return world;
}

// Distance from a point to the nearest cleared corridor (trees and rocks stay out).
export function inClearCorridor(world, x, z, margin = 0) {
  for (const c of world.clearCorridors || []) if (segDist(x, z, c.ax, c.az, c.bx, c.bz) < c.r + margin) return true;
  return false;
}

// Ramp surface height above the terrain at (x, z), or -Infinity outside every ramp.
export function rampSurface(world, x, z) {
  let best = -Infinity;
  for (const r of world.ramps || []) {
    const dx = x - r.x;
    const dz = z - r.z;
    if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
    const fx = Math.sin(r.yaw);
    const fz = Math.cos(r.yaw);
    const along = dx * fx + dz * fz;
    const side = dx * fz - dz * fx;
    if (along < 0 || along > r.length || Math.abs(side) > r.width / 2) continue;
    const t = along / r.length;
    best = Math.max(best, r.height * Math.pow(t, 1.6));
  }
  return best;
}
