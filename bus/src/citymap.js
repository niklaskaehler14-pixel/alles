// City model built from mapdata.js: junctions, lanes, turn paths, crossings, sidewalks
// (with rounded curbs and bus bays), stops and signal timing. Pure JS, no three.js.

import { ROAD } from './config.js';
import { XS, ZS, X_NAMES, Z_NAMES, X_RANK, Z_RANK, MISSING, SIGNALS, RBL, STOP_SIGNS, ZEBRAS, CELL_USE, STOPS } from './mapdata.js';
import { Path, arcPoints, joinPoints } from './path.js';
import { pointInPolygon } from './util.js';

export const DIRS = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
];
export const DIR_NAMES = ['N', 'E', 'S', 'W'];
export const rightOf = (d) => (d + 1) % 4;
export const leftOf = (d) => (d + 3) % 4;
export const opposite = (d) => (d + 2) % 4;
export const dirYaw = (d) => Math.atan2(DIRS[d][0], DIRS[d][1]);

const H = ROAD.half;
const R = ROAD.cornerRadius;
const HR = H + R;

// ---------------------------------------------------------------- signals

export const SIGNAL = { yellow: 3, allRed: 1, redYellow: 1 };

// Signal state for a group (0 = north–south approaches, 1 = east–west) at time t.
export function signalState(sig, group, t) {
  const [g0, g1] = sig.green;
  const cycle = sig.cycle;
  const u = (((t + sig.offset) % cycle) + cycle) % cycle;
  const y = SIGNAL.yellow;
  const clear = SIGNAL.allRed + SIGNAL.redYellow;
  if (group === 0) {
    if (u < g0) return 'green';
    if (u < g0 + y) return 'yellow';
    if (u >= cycle - SIGNAL.redYellow) return 'redyellow';
    return 'red';
  }
  const s1 = g0 + y + clear;
  if (u < s1 - SIGNAL.redYellow) return 'red';
  if (u < s1) return 'redyellow';
  if (u < s1 + g1) return 'green';
  if (u < s1 + g1 + y) return 'yellow';
  return 'red';
}

// Seconds until the group turns green (0 if green now).
export function timeToGreen(sig, group, t) {
  const cycle = sig.cycle;
  const u = (((t + sig.offset) % cycle) + cycle) % cycle;
  const start = group === 0 ? 0 : sig.green[0] + SIGNAL.yellow + SIGNAL.allRed + SIGNAL.redYellow;
  const len = sig.green[group];
  const d = (((u - start) % cycle) + cycle) % cycle;
  if (d < len) return 0;
  return cycle - d;
}

// Pedestrians walking parallel to group g may start crossing.
export function pedestrianWalk(sig, group, t) {
  const cycle = sig.cycle;
  const u = (((t + sig.offset) % cycle) + cycle) % cycle;
  const start = group === 0 ? 0 : sig.green[0] + SIGNAL.yellow + SIGNAL.allRed + SIGNAL.redYellow;
  const walk = Math.max(6, sig.green[group] - 8);
  const d = (((u - start) % cycle) + cycle) % cycle;
  return d < walk;
}

// ---------------------------------------------------------------- build

function key(i, j) {
  return `${i},${j}`;
}

export function buildCity() {
  const NX = XS.length;
  const NZ = ZS.length;
  const missing = new Set(MISSING);
  const nodeAt = (i, j) => j * NX + i;

  // ---- nodes and edges
  const nodes = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      nodes.push({ id: nodeAt(i, j), i, j, key: key(i, j), x: XS[i], z: ZS[j], arms: [-1, -1, -1, -1], degree: 0 });
    }
  }
  const edges = [];
  const addEdge = (axis, i, j) => {
    const a = nodeAt(i, j);
    const b = axis === 'h' ? nodeAt(i + 1, j) : nodeAt(i, j + 1);
    const dirAB = axis === 'h' ? 1 : 2;
    const e = {
      id: edges.length,
      axis,
      i,
      j,
      a,
      b,
      dirAB,
      name: axis === 'h' ? Z_NAMES[j] : X_NAMES[i],
      rank: axis === 'h' ? Z_RANK[j] : X_RANK[i],
      length: axis === 'h' ? XS[i + 1] - XS[i] : ZS[j + 1] - ZS[j],
      speed: 50,
      lanes: [-1, -1],
    };
    edges.push(e);
    nodes[a].arms[dirAB] = e.id;
    nodes[b].arms[opposite(dirAB)] = e.id;
    nodes[a].degree++;
    nodes[b].degree++;
  };
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX - 1; i++) if (!missing.has(`h ${i},${j}`)) addEdge('h', i, j);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ - 1; j++) if (!missing.has(`v ${i},${j}`)) addEdge('v', i, j);

  const signalSet = new Set(SIGNALS);
  const rblSet = new Set(RBL);
  const stopSet = new Set(STOP_SIGNS);

  for (const n of nodes) {
    if (n.degree === 0) {
      n.kind = 'none';
      continue;
    }
    if (n.degree === 1) throw new Error(`dead end at ${n.key}`);
    if (n.degree === 2) {
      const a = n.arms.findIndex((e) => e >= 0);
      n.kind = n.arms[opposite(a)] >= 0 ? 'straight' : 'bend';
    } else {
      n.kind = n.degree === 4 ? 'cross' : 'tee';
    }
    n.trim = n.kind === 'straight' ? ROAD.straightTrim : n.kind === 'bend' ? ROAD.bendTrim : ROAD.junctionTrim;
    // Curb radius around this node's corners: wide sweeping bends, tighter junction corners.
    n.radius = n.kind === 'bend' ? ROAD.bendRadius : R;
    n.hr = H + n.radius;
    // Junction control. majorAxis: 'h' (east–west has priority) or 'v'.
    if (n.kind === 'cross' || n.kind === 'tee') {
      if (signalSet.has(n.key)) n.control = 'signal';
      else if (rblSet.has(n.key)) n.control = 'rbl';
      else n.control = 'priority';
      if (n.kind === 'tee') {
        n.majorAxis = n.arms[1] >= 0 && n.arms[3] >= 0 ? 'h' : 'v';
      } else {
        n.majorAxis = X_RANK[n.i] > Z_RANK[n.j] ? 'v' : 'h';
      }
      n.minorSign = stopSet.has(n.key) ? 'stop' : 'yield';
    } else {
      n.control = 'none';
    }
  }
  for (const k of [...signalSet, ...rblSet, ...stopSet]) {
    const [i, j] = k.split(',').map(Number);
    const n = nodes[nodeAt(i, j)];
    if (n.kind !== 'cross' && n.kind !== 'tee') throw new Error(`control at ${k} which is not a junction`);
  }

  // Signal timing: two groups, 0 = north–south approaches, 1 = east–west.
  for (const n of nodes) {
    if (n.control !== 'signal') continue;
    const stemAxis = n.kind === 'tee' ? (n.majorAxis === 'h' ? 0 : 1) : -1;
    const g = [22, 22];
    if (stemAxis >= 0) {
      g[stemAxis] = 15;
      g[1 - stemAxis] = 26;
    } else if (Z_RANK[n.j] > X_RANK[n.i]) {
      g[0] = 18;
      g[1] = 26;
    }
    const cycle = g[0] + g[1] + 2 * (SIGNAL.yellow + SIGNAL.allRed + SIGNAL.redYellow);
    n.signal = { green: g, cycle, offset: (n.i * 11 + n.j * 17) % cycle };
  }

  // Tempo-30 zone: every street touching a right-before-left junction, except main roads.
  for (const e of edges) {
    const na = nodes[e.a];
    const nb = nodes[e.b];
    if ((na.control === 'rbl' || nb.control === 'rbl') && e.rank < 3) {
      e.speed = 30;
      e.zone30 = true;
    }
  }

  // ---- lanes
  const lanes = [];
  for (const e of edges) {
    for (const forward of [true, false]) {
      const from = nodes[forward ? e.a : e.b];
      const to = nodes[forward ? e.b : e.a];
      const dir = forward ? e.dirAB : opposite(e.dirAB);
      const [dx, dz] = DIRS[dir];
      const [rx, rz] = DIRS[rightOf(dir)];
      const lo = ROAD.laneOffset;
      const sx = from.x + dx * from.trim + rx * lo;
      const sz = from.z + dz * from.trim + rz * lo;
      const ex = to.x - dx * to.trim + rx * lo;
      const ez = to.z - dz * to.trim + rz * lo;
      const lane = {
        id: lanes.length,
        edge: e.id,
        from: from.id,
        to: to.id,
        dir,
        yaw: dirYaw(dir),
        name: e.name,
        speed: e.speed,
        path: new Path([sx, sz, ex, ez]),
        movements: [],
        incoming: [],
      };
      lanes.push(lane);
      e.lanes[forward ? 0 : 1] = lane.id;
    }
  }
  for (const n of nodes) {
    n.inLanes = [];
    n.outLanes = [];
  }
  for (const l of lanes) {
    nodes[l.to].inLanes.push(l.id);
    nodes[l.from].outLanes.push(l.id);
  }

  // What the driver faces at the end of each lane.
  for (const l of lanes) {
    const n = nodes[l.to];
    if (n.control === 'signal') {
      l.endControl = 'signal';
      l.signalGroup = l.dir === 0 || l.dir === 2 ? 0 : 1;
    } else if (n.control === 'rbl') l.endControl = 'rbl';
    else if (n.control === 'priority') {
      const axis = l.dir === 0 || l.dir === 2 ? 'v' : 'h';
      l.endControl = axis === n.majorAxis ? 'major' : n.minorSign;
    } else l.endControl = 'none';
  }

  // ---- movements (turn paths through junctions)
  const movements = [];
  for (const n of nodes) {
    n.movements = [];
    if (n.kind === 'none') continue;
    for (const li of n.inLanes) {
      const inL = lanes[li];
      const dIn = inL.dir;
      const k = opposite(dIn); // arm we arrive from
      for (const lo of n.outLanes) {
        const outL = lanes[lo];
        if (outL.edge === inL.edge) continue; // no U-turns
        const m = outL.dir;
        const turn = m === dIn ? 'straight' : m === rightOf(dIn) ? 'right' : 'left';
        const s = inL.path.at(inL.path.length);
        const e = outL.path.at(0);
        let pts;
        let radius = Infinity;
        if (turn === 'straight') {
          pts = [s.x, s.z, e.x, e.z];
        } else {
          const [kx, kz] = DIRS[k];
          const [mx, mz] = DIRS[m];
          const [rix, riz] = DIRS[rightOf(dIn)];
          const [rmx, rmz] = DIRS[rightOf(m)];
          const lo2 = ROAD.laneOffset;
          const hr = n.hr;
          const t1x = n.x + kx * hr + rix * lo2;
          const t1z = n.z + kz * hr + riz * lo2;
          const t2x = n.x + mx * hr + rmx * lo2;
          const t2z = n.z + mz * hr + rmz * lo2;
          const cx = n.x + hr * (kx + mx);
          const cz = n.z + hr * (kz + mz);
          const rad = Math.hypot(t1x - cx, t1z - cz);
          const a0 = Math.atan2(t1x - cx, t1z - cz);
          const a1 = a0 + (turn === 'left' ? Math.PI / 2 : -Math.PI / 2);
          pts = joinPoints([s.x, s.z, t1x, t1z], arcPoints(cx, cz, rad, a0, a1, 0.75), [t2x, t2z, e.x, e.z]);
          radius = rad;
          const end = arcPoints(cx, cz, rad, a1, a1, 1);
          if (Math.hypot(end[0] - t2x, end[1] - t2z) > 1e-6) throw new Error(`turn geometry mismatch at ${n.key}`);
        }
        const mv = {
          id: movements.length,
          node: n.id,
          inLane: li,
          outLane: lo,
          turn,
          radius,
          path: new Path(pts),
          conflicts: new Set(),
        };
        movements.push(mv);
        n.movements.push(mv.id);
        inL.movements.push(mv.id);
        outL.incoming.push(mv.id);
      }
    }
    // Conflicting movement pairs: paths come closer than ~2.6 m (unless they share the entry lane).
    for (let a = 0; a < n.movements.length; a++) {
      for (let b = a + 1; b < n.movements.length; b++) {
        const A = movements[n.movements[a]];
        const B = movements[n.movements[b]];
        if (A.inLane === B.inLane) continue;
        if (A.outLane === B.outLane || pathsConflict(A.path, B.path, 2.6)) {
          A.conflicts.add(B.id);
          B.conflicts.add(A.id);
        }
      }
    }
  }

  // ---- stops
  const edgeOnLine = (axis, line, coord) =>
    edges.find((e) => e.axis === axis && (axis === 'h' ? e.j === line && coord > XS[e.i] && coord < XS[e.i + 1] : e.i === line && coord > ZS[e.j] && coord < ZS[e.j + 1]));
  const stops = STOPS.map((def, idx) => {
    const e = edgeOnLine(def.axis, def.line, def.front);
    if (!e) throw new Error(`stop ${def.id}: no street`);
    const dir = DIR_NAMES.indexOf(def.dir);
    const lane = lanes[e.lanes[dir === e.dirAB ? 0 : 1]];
    if (lane.dir !== dir) throw new Error(`stop ${def.id}: lane direction`);
    const start = lane.path.at(0);
    const [dx, dz] = DIRS[dir];
    const sFront = (def.axis === 'h' ? def.front - start.x : def.front - start.z) * (def.axis === 'h' ? dx : dz);
    const zone = 22;
    if (sFront - zone - (def.type === 'bay' ? ROAD.bayTaperIn : 0) < 0 || sFront + (def.type === 'bay' ? ROAD.bayTaperOut : 3) > lane.path.length) {
      throw new Error(`stop ${def.id} does not fit on its lane (s=${sFront.toFixed(1)}, lane ${lane.path.length.toFixed(1)})`);
    }
    const [rx, rz] = DIRS[rightOf(dir)];
    const frontPt = lane.path.at(sFront);
    // Curb line at the stop (bay curbs are set back).
    const curbOff = H - ROAD.laneOffset + (def.type === 'bay' ? ROAD.bayDepth : 0);
    return {
      ...def,
      index: idx,
      edge: e.id,
      lane: lane.id,
      dirIndex: dir,
      yaw: lane.yaw,
      sFront,
      zone,
      // Point on the curb where the bus front should be.
      x: frontPt.x + rx * curbOff,
      z: frontPt.z + rz * curbOff,
      curbOffset: curbOff, // lateral distance from lane centre to the curb
      rx,
      rz,
      fx: dx,
      fz: dz,
    };
  });
  for (const s of stops) {
    for (const t of stops) {
      if (s !== t && s.lane === t.lane && Math.abs(s.sFront - t.sFront) < 40) throw new Error(`stops ${s.id} and ${t.id} overlap`);
    }
  }

  // ---- crossings
  const crossings = [];
  const CW = ROAD.crossingWidth;
  const CC = ROAD.crossingCentre;
  for (const n of nodes) {
    if (n.control !== 'signal') continue;
    for (let k = 0; k < 4; k++) {
      if (n.arms[k] < 0) continue;
      const [kx, kz] = DIRS[k];
      const u = rightOf(k);
      const ext = (side) => {
        if (n.arms[side] < 0) return H;
        const dk = CC - HR;
        return HR - Math.sqrt(Math.max(0, R * R - dk * dk));
      };
      crossings.push({
        id: crossings.length,
        kind: 'signal',
        node: n.id,
        arm: k,
        edge: n.arms[k],
        x: n.x + kx * CC,
        z: n.z + kz * CC,
        ux: DIRS[u][0],
        uz: DIRS[u][1],
        extPos: ext(u),
        extNeg: ext(opposite(u)),
        width: CW,
        // Pedestrians walk across arm k, i.e. parallel to the other axis.
        group: k === 0 || k === 2 ? 1 : 0,
      });
    }
  }
  for (const zdef of ZEBRAS) {
    const e = edgeOnLine(zdef.axis, zdef.line, zdef.at);
    if (!e) throw new Error('zebra without street');
    const x = zdef.axis === 'h' ? zdef.at : XS[e.i];
    const z = zdef.axis === 'h' ? ZS[e.j] : zdef.at;
    const u = zdef.axis === 'h' ? 2 : 1; // across the street
    crossings.push({ id: crossings.length, kind: 'zebra', node: -1, edge: e.id, x, z, ux: DIRS[u][0], uz: DIRS[u][1], extPos: H, extNeg: H, width: CW, group: -1 });
  }
  // Which lanes pass each crossing, and where.
  for (const c of crossings) {
    c.lanes = [];
    const e = edges[c.edge];
    for (const li of e.lanes) {
      const l = lanes[li];
      const near = l.path.nearest(c.x, c.z);
      c.lanes.push({ lane: li, s: near.s });
    }
  }

  // ---- regions (blocks) and sidewalks
  const regions = buildRegions(nodes, lanes, stops, nodeAt, NX, NZ);

  // ---- signs
  const signs = buildSigns(nodes, edges, lanes, stops);

  const city = { nodes, edges, lanes, movements, stops, crossings, regions, signs, NX, NZ, nodeAt };
  city.bounds = { minX: XS[0], maxX: XS[NX - 1], minZ: ZS[0], maxZ: ZS[NZ - 1] };
  city.stopById = Object.fromEntries(stops.map((s) => [s.id, s]));
  city.nodeByKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
  city.movementBetween = (inLane, outLane) => {
    for (const id of lanes[inLane].movements) if (movements[id].outLane === outLane) return movements[id];
    return null;
  };
  city.isSidewalk = (x, z) => isSidewalk(regions, x, z);
  city.laneAt = (x, z, yaw, maxDist = 4.5) => laneAt(lanes, x, z, yaw, maxDist);
  city.nodeBoxAt = (x, z, pad = 0) => {
    for (const n of nodes) {
      if (n.kind !== 'cross' && n.kind !== 'tee' && n.kind !== 'bend') continue;
      const t = n.trim + pad;
      if (Math.abs(x - n.x) <= t && Math.abs(z - n.z) <= t) return n;
    }
    return null;
  };
  return city;
}

function pathsConflict(a, b, dist) {
  const d2 = dist * dist;
  const p = a.pts;
  const q = b.pts;
  for (let i = 0; i < p.length; i += 2) {
    for (let j = 0; j < q.length; j += 2) {
      const dx = p[i] - q[j];
      const dz = p[i + 1] - q[j + 1];
      if (dx * dx + dz * dz < d2) return true;
    }
  }
  // Also test densely resampled points so long straight segments cannot slip past each other.
  for (let s = 0; s <= a.length; s += 0.5) {
    const pa = a.at(s);
    const nb = b.nearest(pa.x, pa.z);
    if (nb.d < dist) return true;
  }
  return false;
}

// Lane nearest to (x, z) whose direction matches `yaw` within ~60°.
function laneAt(lanes, x, z, yaw, maxDist) {
  let best = null;
  let bestD = maxDist;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  for (const l of lanes) {
    const [dx, dz] = DIRS[l.dir];
    if (dx * sy + dz * cy < 0.5) continue;
    const q = l.path.nearest(x, z);
    if (q.s <= 0.01 || q.s >= l.path.length - 0.01) {
      // outside the lane's extent: only accept if really close to the end
      if (q.d > 1.5) continue;
    }
    if (q.d < bestD) {
      bestD = q.d;
      best = { lane: l, s: q.s, d: q.d, side: q.side };
    }
  }
  return best;
}

function isSidewalk(regions, x, z) {
  for (const r of regions) {
    if (r.outer) {
      if (!pointInPolygon(x, z, r.curb)) return true;
      continue;
    }
    const b = r.bbox;
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    if (pointInPolygon(x, z, r.curb)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- regions

function buildRegions(nodes, lanes, stops, nodeAt, NX, NZ) {
  const CX = NX - 1;
  const CZ = NZ - 1;
  const hasH = (i, j) => nodes[nodeAt(i, j)].arms[1] >= 0; // [i,j]–[i+1,j]
  const hasV = (i, j) => nodes[nodeAt(i, j)].arms[2] >= 0; // [i,j]–[i,j+1]

  // Union-find over cells: merge neighbours that are not separated by a street.
  const parent = Array.from({ length: CX * CZ }, (_, k) => k);
  const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const cellId = (i, j) => j * CX + i;
  for (let j = 0; j < CZ; j++) {
    for (let i = 0; i < CX; i++) {
      if (i + 1 < CX && !hasV(i + 1, j)) parent[find(cellId(i + 1, j))] = find(cellId(i, j));
      if (j + 1 < CZ && !hasH(i, j + 1)) parent[find(cellId(i, j + 1))] = find(cellId(i, j));
    }
  }
  const groups = new Map();
  for (let j = 0; j < CZ; j++) {
    for (let i = 0; i < CX; i++) {
      const r = find(cellId(i, j));
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push([i, j]);
    }
  }

  // Bays by street line and boundary direction.
  const bays = stops
    .filter((s) => s.type === 'bay')
    .map((s) => {
      const zone = s.zone;
      return {
        stop: s.id,
        lane: lanes[s.lane],
        dir: s.dirIndex,
        // Along-lane start/end of the whole recess including tapers.
        s0: s.sFront - zone - ROAD.bayTaperIn,
        s1: s.sFront + ROAD.bayTaperOut,
        sIn: s.sFront - zone,
        sOut: s.sFront,
      };
    });

  const regions = [];
  for (const cells of groups.values()) {
    const inRegion = new Set(cells.map(([i, j]) => `${i},${j}`));
    const segs = new Map(); // start node key -> [end node key, direction]
    const add = (a, b, d) => {
      if (segs.has(a)) throw new Error(`pinched region boundary at ${a}`);
      segs.set(a, [b, d]);
    };
    for (const [i, j] of cells) {
      if (!inRegion.has(`${i},${j - 1}`)) add(key(i + 1, j), key(i, j), 3); // north side, heading W
      if (!inRegion.has(`${i - 1},${j}`)) add(key(i, j), key(i, j + 1), 2); // west side, heading S
      if (!inRegion.has(`${i},${j + 1}`)) add(key(i, j + 1), key(i + 1, j + 1), 1); // south side, heading E
      if (!inRegion.has(`${i + 1},${j}`)) add(key(i + 1, j + 1), key(i + 1, j), 0); // east side, heading N
    }
    const loop = traceLoop(segs, nodes, nodeAt);
    const [ci, cj] = cells[0];
    const use = CELL_USE[`${ci},${cj}`] || 'residential';
    regions.push(makeRegion(regions.length, loop, cells, use, false, bays, nodes));
  }
  // Outer region: everything outside the ring, traced with the outside on the left.
  {
    const segs = new Map();
    const add = (a, b, d) => segs.set(a, [b, d]);
    for (let i = 0; i < CX; i++) {
      add(key(i, 0), key(i + 1, 0), 1); // along the north ring heading E (outside = north = left)
      add(key(i + 1, CZ), key(i, CZ), 3); // south ring heading W
    }
    for (let j = 0; j < CZ; j++) {
      add(key(CX, j), key(CX, j + 1), 2); // east ring heading S
      add(key(0, j + 1), key(0, j), 0); // west ring heading N
    }
    const loop = traceLoop(segs, nodes, nodeAt);
    regions.push(makeRegion(regions.length, loop, [], 'outer', true, bays, nodes));
  }
  return regions;
}

function traceLoop(segs, nodes, nodeAt) {
  const startKey = segs.keys().next().value;
  const pts = [];
  let k = startKey;
  let guard = 0;
  do {
    const [next, d] = segs.get(k);
    const [i, j] = k.split(',').map(Number);
    pts.push({ node: nodes[nodeAt(i, j)], d });
    k = next;
    if (++guard > 10000) throw new Error('region trace did not close');
  } while (k !== startKey);
  if (pts.length !== segs.size) throw new Error('region boundary has several loops');
  // Corners only: keep vertices where the direction changes.
  const n = pts.length;
  const corners = [];
  for (let a = 0; a < n; a++) {
    const prev = pts[(a - 1 + n) % n];
    const cur = pts[a];
    if (prev.d !== cur.d) corners.push({ node: cur.node, dIn: prev.d, dOut: cur.d });
  }
  return corners;
}

function makeRegion(id, loop, cells, use, outer, bays, nodes) {
  const curb = offsetLoop(loop, H, bays, 0);
  // Along bus bays the walking line keeps 1 m from the recessed curb.
  const walk = offsetLoop(loop, H + ROAD.walkway, bays, ROAD.walkway - 1.0);
  const front = offsetLoop(loop, H + ROAD.sidewalk, bays, ROAD.sidewalk, true);
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k < curb.pts.length; k += 2) {
    bbox[0] = Math.min(bbox[0], curb.pts[k]);
    bbox[1] = Math.min(bbox[1], curb.pts[k + 1]);
    bbox[2] = Math.max(bbox[2], curb.pts[k]);
    bbox[3] = Math.max(bbox[3], curb.pts[k + 1]);
  }
  return {
    id,
    use,
    outer,
    cells,
    corners: loop.map((c) => ({ node: c.node.id, dIn: c.dIn, dOut: c.dOut })),
    curb: curb.pts,
    walk: walk.pts,
    front: front.pts,
    frontRuns: front.runs,
    curbRuns: curb.runs,
    bbox,
  };
}

// Offset a rectilinear loop of street centre lines into the region by `inset`, rounding the
// corners like the curbs: convex corners around the junction fillet, reflex corners around
// the outside of the bend. Bus bays are cut in with depth max(0, bayDepth - bayShrink).
// Returns flat points and the straight runs (for placing buildings along the street).
function offsetLoop(loop, inset, bays, bayShrink, noBays = false) {
  const pts = [];
  const runs = [];
  const n = loop.length;
  const corner = (c) => {
    const L1 = DIRS[leftOf(c.dIn)];
    const L2 = DIRS[leftOf(c.dOut)];
    const nx = c.node.x;
    const nz = c.node.z;
    const convex = c.dOut === leftOf(c.dIn);
    if (!convex && c.dOut !== rightOf(c.dIn)) throw new Error('loop reverses direction');
    if (convex) {
      const hr = c.node.hr;
      const cx = nx + hr * (L1[0] + L2[0]);
      const cz = nz + hr * (L1[1] + L2[1]);
      const rad = hr - inset;
      if (rad < 0.4) {
        const px = nx + inset * (L1[0] + L2[0]);
        const pz = nz + inset * (L1[1] + L2[1]);
        return { p1: [px, pz], p2: [px, pz], arc: [px, pz] };
      }
      const a0 = Math.atan2(-L1[0], -L1[1]);
      const arc = arcPoints(cx, cz, rad, a0, a0 + Math.PI / 2, 1.2);
      return { p1: arc.slice(0, 2), p2: arc.slice(-2), arc };
    }
    const hr = c.node.hr;
    const cx = nx - hr * (L1[0] + L2[0]);
    const cz = nz - hr * (L1[1] + L2[1]);
    const rad = hr + inset;
    const a0 = Math.atan2(L1[0], L1[1]);
    const arc = arcPoints(cx, cz, rad, a0, a0 - Math.PI / 2, 1.2);
    return { p1: arc.slice(0, 2), p2: arc.slice(-2), arc };
  };
  const cs = loop.map(corner);
  for (let a = 0; a < n; a++) {
    const c = cs[a];
    for (let k = 0; k < c.arc.length; k += 2) pts.push(c.arc[k], c.arc[k + 1]);
    // Straight run from this corner's p2 to the next corner's p1, heading dOut.
    const nextC = cs[(a + 1) % n];
    const d = loop[a].dOut;
    const [ax, az] = c.p2;
    const [bx, bz] = nextC.p1;
    runs.push({ ax, az, bx, bz, dir: d });
    if (noBays) continue;
    const notch = [];
    for (const b of bays) {
      // A bay belongs to the region on the right of its lane: boundary heads the opposite way.
      if (opposite(b.dir) !== d) continue;
      const bayPts = bayNotch(b, inset, bayShrink);
      if (!bayPts) continue;
      // Is the bay on this run's line?
      const [mx, mz] = [bayPts[0], bayPts[1]];
      const L = DIRS[leftOf(d)];
      const lineOff = (mx - ax) * L[0] + (mz - az) * L[1];
      if (Math.abs(lineOff) > 0.01) continue;
      const along = (x, z) => (x - ax) * DIRS[d][0] + (z - az) * DIRS[d][1];
      const runLen = along(bx, bz);
      const t0 = along(bayPts[0], bayPts[1]);
      const t1 = along(bayPts[bayPts.length - 2], bayPts[bayPts.length - 1]);
      if (Math.min(t0, t1) < 0 || Math.max(t0, t1) > runLen) continue;
      notch.push({ t: Math.min(t0, t1), pts: bayPts });
    }
    notch.sort((p, q) => p.t - q.t);
    for (const nt of notch) for (let k = 0; k < nt.pts.length; k += 2) pts.push(nt.pts[k], nt.pts[k + 1]);
  }
  return { pts, runs };
}

// Bay outline points (in boundary order, i.e. against the lane direction).
function bayNotch(b, inset, shrink) {
  const lane = b.lane;
  const depth = Math.max(0, ROAD.bayDepth - shrink);
  if (depth <= 0.01) return null;
  const [rx, rz] = DIRS[rightOf(lane.dir)];
  const lat = inset - ROAD.laneOffset; // lane centre -> this offset line
  const P = (s, extra) => {
    const p = lane.path.at(s);
    return [p.x + rx * (lat + extra), p.z + rz * (lat + extra)];
  };
  const taperIn = ROAD.bayTaperIn * (depth / ROAD.bayDepth);
  const taperOut = ROAD.bayTaperOut * (depth / ROAD.bayDepth);
  const inLanePts = [P(b.sIn - taperIn, 0), P(b.sIn, depth), P(b.sOut, depth), P(b.sOut + taperOut, 0)];
  return inLanePts.reverse().flat();
}

// ---------------------------------------------------------------- signs

function buildSigns(nodes, edges, lanes, stops) {
  const signs = [];
  // Signs never stand in a bus bay or a stop zone: shift them in front of it.
  const clear = (lane, s) => {
    for (const st of stops) {
      if (st.lane !== lane.id) continue;
      const a = st.sFront - st.zone - (st.type === 'bay' ? ROAD.bayTaperIn : 3) - 3;
      const b = st.sFront + (st.type === 'bay' ? ROAD.bayTaperOut : 3) + 3;
      if (s > a && s < b) s = a - 2 >= 4 ? a - 2 : Math.min(lane.path.length, b + 2);
    }
    return s;
  };
  const place = (lane, sAlong, type, sideOff = H - ROAD.laneOffset + 0.9) => {
    const p = lane.path.at(clear(lane, sAlong));
    const [rx, rz] = DIRS[rightOf(lane.dir)];
    signs.push({ type, x: p.x + rx * sideOff, z: p.z + rz * sideOff, yaw: lane.yaw + Math.PI, lane: lane.id });
  };
  for (const l of lanes) {
    const len = l.path.length;
    if (l.endControl === 'yield' || l.endControl === 'stop') place(l, len, l.endControl);
    if (l.endControl === 'major') {
      const e = edges[l.edge];
      place(l, Math.max(0, len - 30), e.rank >= 3 ? 'priorityRoad' : 'priorityNext');
    }
    const from = nodes[l.from];
    const to = nodes[l.to];
    if (l.speed === 30 && from.control !== 'rbl') place(l, 6, 'zone30');
    if (l.speed === 30 && to.control !== 'rbl') place(l, len - 2, 'zone30end', H - ROAD.laneOffset + 0.9);
  }
  return signs;
}
