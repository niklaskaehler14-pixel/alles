// Open-world scenery layout (pure data): the festival grounds, torii gates, stone lanterns, the
// lighthouse, cherry trees, neon signs in the city, bonus boards and the discoverable landmarks.
// Planned after the roads, terrain, city and activities, before vegetation.

import { CITY, FESTIVAL, LAKE, MOUNTAIN, ROAD, WORLD } from './config.js';
import { mulberry32 } from './noise.js';

const NEON_COLORS = ['#ff3fa4', '#29e3ff', '#ffb13b', '#7dff6a', '#b36bff', '#ff5a3c'];

// Where a road crosses a circle (first sample inside, searched from the given end).
function crossing(road, cx, cz, r, fromEnd) {
  const n = road.count;
  for (let k = 0; k < n; k++) {
    const i = fromEnd ? n - 1 - k : k;
    if (Math.hypot(road.x[i] - cx, road.z[i] - cz) < r) return i;
  }
  return -1;
}

export function planLandmarks(world) {
  const hf = world.heightfield;
  const rng = mulberry32(0x5eed);
  const col = world.colliders;
  const circuit = world.track;
  const touge = world.branches.find((b) => b.id === 'touge');
  const lake = world.branches.find((b) => b.id === 'lake');

  // ---------------------------------------------------------------- festival grounds
  const F = { x: FESTIVAL.x, z: FESTIVAL.z, y: world.festivalHeight, radius: FESTIVAL.radius };
  // Gate arches where the touge and the lake road enter the plaza.
  F.gates = [];
  for (const [road, fromEnd] of [
    [touge, true],
    [lake, false],
  ]) {
    const i = crossing(road, F.x, F.z, F.radius + 2, fromEnd);
    if (i < 0) continue;
    const p = road.pointAt(i * road.spacing, 0, {});
    F.gates.push({ x: p.x, z: p.z, y: F.y, yaw: p.heading, span: road.width + 7 });
    for (const sd of [1, -1]) {
      const q = road.pointAt(i * road.spacing, sd * (road.width / 2 + 3.5), {});
      col.addCircle(q.x, q.z, 0.8, 'pole');
    }
  }
  // Stage on the west side facing the plaza, the Ferris wheel beyond the north-west edge.
  F.stage = { x: F.x - 70, z: F.z + 8, yaw: Math.PI / 2, width: 32, depth: 10, height: 15 };
  col.addBox(F.stage.x - 5, F.stage.z - 16, F.stage.x + 5, F.stage.z + 16, 'building');
  const wx = F.x - 118;
  const wz = F.z - 70;
  F.wheel = { x: wx, z: wz, y: hf.get(wx, wz), yaw: Math.PI * 0.2, radius: 24, hub: 28 };
  col.addBox(wx - 7, wz - 7, wx + 7, wz + 7, 'building');
  // Pavilions (tents) and two display podiums with cars.
  F.tents = [
    [F.x - 48, F.z - 44],
    [F.x - 30, F.z - 58],
    [F.x - 48, F.z + 56],
    [F.x - 28, F.z + 66],
  ].map(([x, z], k) => ({ x, z, size: k % 2 ? 9 : 11, yaw: rng() * Math.PI }));
  for (const t of F.tents) col.addCircle(t.x, t.z, t.size * 0.62, 'building');
  F.podiums = [
    { x: F.x + 42, z: F.z - 34, color: '#ffffff', stripe: '#ff3fa4', number: 1 },
    { x: F.x + 50, z: F.z + 22, color: '#f2b705', stripe: '#111111', number: 6 },
  ];
  for (const p of F.podiums) col.addCircle(p.x, p.z, 4.6, 'building');
  // Flag poles around the plaza edge, leaving the entrances free.
  F.flags = [];
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const x = F.x + Math.cos(a) * (F.radius - 3);
    const z = F.z + Math.sin(a) * (F.radius - 3);
    if (F.gates.some((g) => Math.hypot(g.x - x, g.z - z) < 22)) continue;
    if ([...world.branches, circuit].some((r) => r.nearest(x, z, -1, {}, 2).dist < (r.halfTotal || ROAD.halfTotal) + 3)) continue;
    F.flags.push({ x, z, color: NEON_COLORS[k % NEON_COLORS.length] });
    col.addCircle(x, z, 0.2, 'pole');
  }
  // Spawn: on the lake road just before the festival arch, facing along the road towards the lake.
  const li = crossing(lake, F.x, F.z, F.radius + 2, false);
  if (li >= 0) {
    const p = lake.pointAt(li * lake.spacing - 24, -2.6, {});
    F.spawn = { x: p.x, z: p.z, heading: p.heading };
  } else F.spawn = { x: F.x, z: F.z, heading: 0 };
  // Lamp posts around the plaza, lit at night.
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13;
    const x = F.x + Math.cos(a) * (F.radius - 7);
    const z = F.z + Math.sin(a) * (F.radius - 7);
    if (F.gates.some((g) => Math.hypot(g.x - x, g.z - z) < 20)) continue;
    if (Math.hypot(x - F.stage.x, z - F.stage.z) < 22) continue;
    world.lamps.push({ x, z, y: F.y, yaw: Math.atan2(F.x - x, F.z - z) });
    col.addCircle(x, z, 0.25, 'pole');
  }
  world.festival = F;

  // ---------------------------------------------------------------- torii, lanterns, lighthouse
  const torii = [];
  // A big drive-through torii at the Kaminari pass.
  if (touge) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < touge.count; i++) {
      const d = Math.hypot(touge.x[i] - MOUNTAIN.passPoint[0], touge.z[i] - MOUNTAIN.passPoint[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const p = touge.pointAt(best * touge.spacing, 0, {});
    const span = touge.halfTotal * 2 + 3.2;
    torii.push({ x: p.x, z: p.z, y: p.h, yaw: p.heading, span, height: 10.5, road: true });
    for (const sd of [1, -1]) {
      const q = touge.pointAt(best * touge.spacing, (sd * span) / 2, {});
      col.addCircle(q.x, q.z, 0.55, 'pole');
    }
    world.passIndex = best;
  }
  // The floating torii in the lake, off the north shore and facing the lake road.
  {
    let x = LAKE.x;
    let z = LAKE.z;
    for (let t = 0; t < 600; t += 2) {
      z = LAKE.z - t;
      if (hf.get(x, z - 38) > -1.5) break;
    }
    torii.push({ x, z, y: WORLD.waterLevel - 2, yaw: 0, span: 17, height: 15, water: true });
  }
  world.torii = torii;

  // Stone lanterns along the road below the pass torii.
  const lanterns = [];
  if (touge && world.passIndex !== undefined) {
    for (const ds of [-54, -36, -18, 18, 36, 54]) {
      const s = world.passIndex * touge.spacing + ds;
      for (const sd of [1, -1]) {
        const p = touge.pointAt(s, sd * (touge.halfTotal + 1.6), {});
        lanterns.push({ x: p.x, z: p.z, y: hf.get(p.x, p.z), yaw: p.heading });
        col.addCircle(p.x, p.z, 0.45, 'pole');
      }
    }
  }
  world.lanterns = lanterns;

  // Lighthouse on the east shore of the lake.
  {
    let x = LAKE.x;
    const z = LAKE.z + 40;
    for (let t = 0; t < 700; t += 2) {
      x = LAKE.x + t;
      if (hf.get(x, z) > 1.2) break;
    }
    x += 6;
    world.lighthouse = { x, z, y: hf.get(x, z), height: 19 };
    col.addCircle(x, z, 2.4, 'building');
  }

  // ---------------------------------------------------------------- cherry trees
  // An avenue along the lake road and a ring around the festival.
  const sakura = [];
  const clearOfRoads = (x, z, m) => {
    const c = circuit.nearest(x, z, -1, {}, 2);
    if (c.index >= 0 && c.dist < ROAD.halfTotal + m) return false;
    return world.branchDistance(x, z, 20) > m;
  };
  if (lake) {
    const s0 = Math.min(lake.length - 200, 620);
    const s1 = Math.min(lake.length - 120, 1250);
    for (let s = s0; s < s1; s += 11) {
      for (const sd of [1, -1]) {
        const off = lake.halfTotal + 7 + rng() * 9;
        const p = lake.pointAt(s + rng() * 5, sd * off, {});
        const h = hf.get(p.x, p.z);
        if (h < WORLD.waterLevel + 2.5 || !clearOfRoads(p.x, p.z, 5)) continue;
        sakura.push({ x: p.x, z: p.z, y: h - 0.2, s: 0.9 + rng() * 0.35 });
      }
    }
    world.sakuraAvenue = lake.pointAt((s0 + s1) / 2, 0, {});
  }
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2 + rng() * 0.1;
    const r = F.radius + 12 + rng() * 14;
    const x = F.x + Math.cos(a) * r;
    const z = F.z + Math.sin(a) * r;
    if (!clearOfRoads(x, z, 6)) continue;
    if (Math.hypot(x - F.wheel.x, z - F.wheel.z) < 20) continue;
    sakura.push({ x, z, y: hf.get(x, z) - 0.2, s: 0.85 + rng() * 0.3 });
  }
  world.sakura = sakura;

  // ---------------------------------------------------------------- neon signs in the city
  // Vertical signs on the street corners of the taller buildings near the centre (`word` indexes the
  // neon atlas).
  const signs = [];
  let w = 0;
  for (const b of world.buildings) {
    if (b.h < 20) continue;
    const dc = Math.hypot(b.x - CITY.x, b.z - CITY.z);
    if (dc > CITY.radius - 50 || rng() > 0.9) continue;
    const count = rng() < 0.6 ? 2 : 1;
    const width = 2.3;
    for (let k = 0; k < count; k++) {
      // Pick a face (+x, -x, +z, -z) and a corner of it.
      const face = Math.floor(rng() * 4);
      const along = (rng() < 0.5 ? -1 : 1) * 0.36;
      const nx = face === 0 ? 1 : face === 1 ? -1 : 0;
      const nz = face === 2 ? 1 : face === 3 ? -1 : 0;
      const out = width / 2 + 0.35;
      const x = b.x + nx * (b.w / 2 + out) + (nz !== 0 ? along * b.w : 0);
      const z = b.z + nz * (b.d / 2 + out) + (nx !== 0 ? along * b.d : 0);
      const height = 9 + Math.floor(rng() * 3) * 1.8;
      const y = b.y + 3.2 + rng() * Math.max(0, Math.min(8, b.h - height - 4));
      signs.push({ x, y, z, nx, nz, width, height, word: (w * 7) % 16 });
      w++;
    }
  }
  world.neonSigns = signs;

  // ---------------------------------------------------------------- bonus boards
  // Orange boards to smash, spread over every road of the network, a little off the edge.
  const boards = [];
  const roads = [circuit, ...world.branches];
  const perRoad = { circuit: 7, touge: 4, lake: 3, gravel: 3 };
  for (const road of roads) {
    const count = perRoad[road.id] || 2;
    const ht = road.halfTotal || ROAD.halfTotal;
    for (let k = 0; k < count; k++) {
      let s = ((k + 0.5) / count) * road.length + (rng() - 0.5) * 80;
      if (road === circuit) s = circuit.wrapS(s);
      else s = Math.max(60, Math.min(road.length - 60, s));
      const side = rng() < 0.5 ? 1 : -1;
      const p = road.pointAt(s, side * (ht + 3.2), {});
      const h = hf.get(p.x, p.z);
      if (h < WORLD.waterLevel + 1 || Math.hypot(p.x - CITY.x, p.z - CITY.z) < CITY.radius - 20) continue;
      if (boards.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 150)) continue;
      boards.push({ id: `board-${boards.length}`, x: p.x, z: p.z, y: h, yaw: p.heading + (side > 0 ? -0.5 : 0.5), road: road.id });
    }
  }
  world.bonusBoards = boards;

  // ---------------------------------------------------------------- landmarks to discover
  const marks = [];
  marks.push({ id: 'lm-festival', name: 'Nordkamm Festival', blurb: 'Herz der offenen Welt: Riesenrad, Bühne und Schnellreise', x: F.x, z: F.z, radius: F.radius + 10 });
  if (world.passIndex !== undefined) {
    const p = touge.pointAt(world.passIndex * touge.spacing, 0, {});
    marks.push({ id: 'lm-pass', name: 'Kaminari-Pass', blurb: 'Das rote Tor auf der Passhöhe', x: p.x, z: p.z, radius: 40 });
  }
  const lakeTorii = torii.find((t) => t.water);
  if (lakeTorii) marks.push({ id: 'lm-torii', name: 'Schwimmendes Tor', blurb: 'Das Torii im See, am besten von der Seestraße aus', x: lakeTorii.x, z: lakeTorii.z, radius: 130 });
  if (world.sakuraAvenue) marks.push({ id: 'lm-sakura', name: 'Kirschblütenallee', blurb: 'Blühende Kirschbäume an der Seestraße', x: world.sakuraAvenue.x, z: world.sakuraAvenue.z, radius: 60 });
  marks.push({ id: 'lm-neon', name: 'Neonviertel', blurb: 'Leuchtreklame in der Stadtmitte, nachts am schönsten', x: CITY.x, z: CITY.z, radius: 110 });
  marks.push({ id: 'lm-lighthouse', name: 'Leuchtturm Ostufer', blurb: 'Weiß-roter Leuchtturm am Ostufer', x: world.lighthouse.x, z: world.lighthouse.z, radius: 50 });
  // Lookout: the highest point of the northern highlands next to the circuit's pass.
  let look = null;
  for (let x = 450; x <= 800; x += 10) {
    for (let z = -1320; z <= -1050; z += 10) {
      const h = hf.get(x, z);
      if (!look || h > look.h) look = { x, z, h };
    }
  }
  marks.push({ id: 'lm-lookout', name: 'Nordkamm-Aussicht', blurb: 'Höchster Punkt des Hochlands mit Blick über die Welt', x: look.x, z: look.z, radius: 45 });
  for (const m of marks) m.y = hf.get(m.x, m.z);
  world.landmarks = marks;
  return world;
}
