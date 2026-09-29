// Bus lines: route geometry through the lane graph and timetables.
import { LINES } from './mapdata.js';
import { Path, joinPoints } from './path.js';

export { LINES };

export function findTrip(tripId) {
  for (const line of LINES) for (const t of line.trips) if (t.id === tripId) return { line, trip: t };
  return null;
}

// Planning speeds used for the timetable (m/s).
const TURN_SPEED = { straight: 8.5, right: 3.3, left: 5 };
const DWELL = 24; // seconds per intermediate stop
const SIGNAL_WAIT = 11; // average wait at a red light
const YIELD_WAIT = 3;

export function buildRoute(city, tripId) {
  const found = findTrip(tripId);
  if (!found) throw new Error(`unknown trip ${tripId}`);
  const { line, trip } = found;
  const stops = trip.stops.map((id) => {
    const s = city.stopById[id];
    if (!s) throw new Error(`trip ${tripId}: unknown stop ${id}`);
    return s;
  });
  const first = stops[0];
  const last = stops[stops.length - 1];
  const pieces = [];
  let dist = 0;
  let lane = city.lanes[first.lane];
  const pushLane = (l) => {
    pieces.push({ kind: 'lane', lane: l.id, path: l.path, start: dist, length: l.path.length, speed: l.speed });
    dist += l.path.length;
  };
  pushLane(lane);
  for (let k = 0; k < trip.nodes.length; k++) {
    const node = city.nodeByKey[trip.nodes[k]];
    if (!node) throw new Error(`trip ${tripId}: unknown node ${trip.nodes[k]}`);
    if (lane.to !== node.id) throw new Error(`trip ${tripId}: lane ${lane.id} does not reach node ${node.key}`);
    let next;
    if (k + 1 < trip.nodes.length) {
      const target = city.nodeByKey[trip.nodes[k + 1]];
      next = node.outLanes.map((id) => city.lanes[id]).find((l) => l.to === target.id);
      if (!next) throw new Error(`trip ${tripId}: no street from ${node.key} to ${target.key}`);
    } else {
      next = city.lanes[last.lane];
      if (next.from !== node.id) throw new Error(`trip ${tripId}: last stop not after ${node.key}`);
    }
    const mv = city.movementBetween(lane.id, next.id);
    if (!mv) throw new Error(`trip ${tripId}: no movement at ${node.key}`);
    pieces.push({ kind: 'move', movement: mv.id, node: node.id, turn: mv.turn, path: mv.path, start: dist, length: mv.path.length, lane: lane.id });
    dist += mv.path.length;
    pushLane(next);
    lane = next;
  }
  const length = dist;
  const pts = joinPoints(...pieces.map((p) => Array.from(p.path.pts)));
  const path = new Path(pts);

  // Route distance of each stop's front position; stops must come in order along the route.
  let cursor = -1;
  const routeStops = stops.map((s, idx) => {
    const lanePieces = pieces.filter((p) => p.kind === 'lane' && p.lane === s.lane);
    const piece = lanePieces.find((p) => p.start + s.sFront > cursor);
    if (!piece) throw new Error(`trip ${tripId}: stop ${s.id} is not on the route (or out of order)`);
    const d = piece.start + s.sFront;
    if (idx === 0 && d !== pieces[0].start + s.sFront) throw new Error('first stop must be on the first lane');
    cursor = d;
    return { stop: s, dist: d, index: idx };
  });
  const startDist = routeStops[0].dist;
  const endDist = routeStops[routeStops.length - 1].dist;

  // Junction events along the route (for navigation and rule checks).
  const junctions = pieces
    .filter((p) => p.kind === 'move')
    .map((p) => {
      const n = city.nodes[p.node];
      const inLane = city.lanes[p.lane];
      return { node: p.node, turn: p.turn, start: p.start, end: p.start + p.length, control: inLane.endControl, signalGroup: inLane.signalGroup, kind: n.kind };
    });

  // Timetable: seconds after departure from the first stop.
  const times = [0];
  let t = 0;
  for (let k = 1; k < routeStops.length; k++) {
    const a = routeStops[k - 1].dist;
    const b = routeStops[k].dist;
    t += travelTime(pieces, junctions, a, b);
    times.push(t);
    t += DWELL;
  }
  // Round to full minutes like a printed timetable (never earlier than planned).
  const sched = times.map((v, k) => (k === 0 ? 0 : Math.ceil(v / 60) * 60));
  routeStops.forEach((rs, k) => {
    rs.sched = sched[k];
  });

  return {
    tripId,
    line,
    trip,
    headsign: trip.headsign,
    pieces,
    path,
    length,
    startDist,
    endDist,
    stops: routeStops,
    junctions,
    duration: sched[sched.length - 1],
  };
}

function travelTime(pieces, junctions, a, b) {
  let t = 0;
  for (const p of pieces) {
    const s0 = Math.max(a, p.start);
    const s1 = Math.min(b, p.start + p.length);
    if (s1 <= s0) continue;
    const len = s1 - s0;
    const v = p.kind === 'lane' ? (p.speed / 3.6) * 0.78 : TURN_SPEED[p.turn];
    t += len / v;
  }
  for (const j of junctions) {
    if (j.start < a || j.start > b) continue;
    if (j.control === 'signal') t += SIGNAL_WAIT;
    else if (j.control === 'yield' || j.control === 'stop' || j.control === 'rbl') t += YIELD_WAIT;
  }
  // Pulling out of the previous stop and braking into the next one.
  return t + 12;
}

// Where along the route (distance) is the point (x, z)? Searches near `hint`.
export function routeProgress(route, x, z, hint, window = 60) {
  const path = route.path;
  const p = path.pts;
  const lo = Math.max(0, hint - window);
  const hi = Math.min(route.length, hint + window);
  let best = Infinity;
  let bestS = hint;
  let bestSide = 0;
  // Walk segments overlapping [lo, hi].
  for (let i = 0; i < path.n - 1; i++) {
    if (path.cum[i + 1] < lo || path.cum[i] > hi) continue;
    const ax = p[i * 2];
    const az = p[i * 2 + 1];
    const vx = p[i * 2 + 2] - ax;
    const vz = p[i * 2 + 3] - az;
    const l2 = vx * vx + vz * vz;
    let t = l2 > 0 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + vx * t;
    const qz = az + vz * t;
    const d2 = (x - qx) ** 2 + (z - qz) ** 2;
    if (d2 < best) {
      best = d2;
      bestS = path.cum[i] + t * Math.sqrt(l2);
      bestSide = (x - qx) * vz - (z - qz) * vx;
    }
  }
  return { s: bestS, d: Math.sqrt(best), side: bestSide >= 0 ? 1 : -1 };
}
