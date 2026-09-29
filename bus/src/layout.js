// What stands in the city: buildings along the streets, landmarks, trees, street lamps,
// bus-stop furniture, signal poles and the collision shapes for all of it.
// Pure data (no three.js); cityView.js turns it into meshes.

import { ROAD } from './config.js';
import { DIRS, leftOf, rightOf } from './citymap.js';
import { mulberry32 } from './util.js';

const H = ROAD.half;

// Street trees grow along these streets (Lindenallee = lime tree avenue).
const TREE_STREETS = new Set(['Lindenallee', 'Parkstraße', 'Rathausstraße', 'Mühlenweg', 'Schillerstraße', 'Uhlandstraße']);

const USES = {
  apartments: { depth: 14, width: [16, 28], floors: [5, 8], styles: ['modern', 'plaster'], gable: 0, shop: 0.25 },
  offices: { depth: 16, width: [18, 32], floors: [4, 8], styles: ['office', 'modern'], gable: 0, shop: 0.35 },
  civic: { depth: 16, width: [18, 30], floors: [3, 5], styles: ['civic', 'plaster', 'brick'], gable: 0.2, shop: 0.4 },
  station: { depth: 16, width: [22, 40], floors: [5, 10], styles: ['office', 'modern', 'civic'], gable: 0, shop: 0.6 },
  university: { depth: 16, width: [24, 40], floors: [3, 5], styles: ['modern', 'office'], gable: 0, shop: 0.1, gaps: 0.35 },
  residential: { depth: 12, width: [12, 22], floors: [3, 5], styles: ['plaster', 'brick', 'plaster'], gable: 0.55, shop: 0.12 },
  oldtown: { depth: 12, width: [7, 12], floors: [2, 4], styles: ['oldtown', 'plaster', 'oldtown'], gable: 0.85, shop: 0.55 },
  church: { depth: 12, width: [7, 12], floors: [2, 4], styles: ['oldtown', 'plaster'], gable: 0.85, shop: 0.5 },
  theater: { depth: 14, width: [14, 24], floors: [3, 5], styles: ['civic', 'plaster'], gable: 0.3, shop: 0.5 },
  shops: { depth: 14, width: [10, 20], floors: [3, 5], styles: ['plaster', 'brick', 'modern'], gable: 0.35, shop: 0.95 },
  seniors: { depth: 13, width: [16, 26], floors: [3, 4], styles: ['plaster', 'brick'], gable: 0.5, shop: 0.05, gaps: 0.25 },
  outerWest: { depth: 13, width: [12, 22], floors: [2, 4], styles: ['plaster', 'brick'], gable: 0.7, shop: 0.1, gaps: 0.2 },
  outerEast: { depth: 14, width: [16, 28], floors: [4, 7], styles: ['modern', 'plaster'], gable: 0.1, shop: 0.15, gaps: 0.15 },
};

export function buildLayout(city, seed = 4242) {
  const rng = mulberry32(seed);
  const rand = (a, b) => a + rng() * (b - a);
  const L = {
    buildings: [],
    landmarks: [],
    trees: [],
    lamps: [],
    props: [],
    areas: [],
    stopFurniture: [],
    signalPoles: [],
    signPoles: [],
    boxes: [],
    circles: [],
  };
  const addBox = (x, z, yaw, hl, hw, kind = 'solid') => L.boxes.push({ x, z, yaw, hl, hw, kind });
  const addCircle = (x, z, r, kind = 'pole') => L.circles.push({ x, z, r, kind });

  // ---- keep-out spots for street furniture (x, z, radius)
  const keep = [];
  for (const s of city.stops) {
    const lane = city.lanes[s.lane];
    for (let d = -s.zone - (s.type === 'bay' ? ROAD.bayTaperIn : 4); d <= (s.type === 'bay' ? ROAD.bayTaperOut : 4); d += 3) {
      const p = lane.path.at(s.sFront + d);
      keep.push([p.x + s.rx * s.curbOffset, p.z + s.rz * s.curbOffset, 4.5]);
    }
  }
  for (const c of city.crossings) {
    keep.push([c.x + c.ux * c.extPos, c.z + c.uz * c.extPos, 5]);
    keep.push([c.x - c.ux * c.extNeg, c.z - c.uz * c.extNeg, 5]);
  }
  for (const sg of city.signs) keep.push([sg.x, sg.z, 3]);
  const kept = (x, z, extra = 0) => keep.some(([kx, kz, r]) => (x - kx) ** 2 + (z - kz) ** 2 < (r + extra) ** 2);
  const nearJunction = (x, z, pad) => city.nodes.some((n) => (n.kind === 'cross' || n.kind === 'tee' || n.kind === 'bend') && Math.abs(x - n.x) < ROAD.junctionTrim + pad && Math.abs(z - n.z) < ROAD.junctionTrim + pad);

  // ---- signal poles: one per approach at the stop line, right-hand side
  for (const lane of city.lanes) {
    if (lane.endControl !== 'signal') continue;
    const e = lane.path.at(lane.path.length);
    const [rx, rz] = DIRS[rightOf(lane.dir)];
    const off = H - ROAD.laneOffset + 0.75;
    const x = e.x + rx * off;
    const z = e.z + rz * off;
    L.signalPoles.push({ x, z, yaw: lane.yaw + Math.PI, lane: lane.id, node: lane.to, group: lane.signalGroup, arm: true });
    addCircle(x, z, 0.18);
    keep.push([x, z, 3]);
  }
  // Pedestrian signals at both ends of signalised crossings.
  for (const c of city.crossings) {
    if (c.kind !== 'signal') continue;
    for (const sgn of [-1, 1]) {
      const ext = sgn < 0 ? c.extNeg : c.extPos;
      const x = c.x + c.ux * sgn * (ext + 0.5) + c.uz * (c.width / 2 + 0.3);
      const z = c.z + c.uz * sgn * (ext + 0.5) - c.ux * (c.width / 2 + 0.3);
      L.props.push({ type: 'pedSignal', x, z, yaw: Math.atan2(-c.ux * sgn, -c.uz * sgn), crossing: c.id });
      addCircle(x, z, 0.1);
    }
  }
  for (const sg of city.signs) {
    L.signPoles.push(sg);
    addCircle(sg.x, sg.z, 0.08);
  }

  // ---- bus stops: sign post, shelter, bench, bin
  for (const s of city.stops) {
    const lane = city.lanes[s.lane];
    const inset = (d) => [s.rx * (s.curbOffset + d), s.rz * (s.curbOffset + d)];
    const pAt = (along, d) => {
      const p = lane.path.at(s.sFront + along);
      const [ox, oz] = inset(d);
      return [p.x + ox, p.z + oz];
    };
    const [px, pz] = pAt(0.2, 0.55);
    const back = s.type === 'bay' ? ROAD.sidewalk - ROAD.bayDepth : ROAD.sidewalk;
    const shelterD = s.type === 'bay' ? back - 1.5 : Math.min(3.9, back - 1.7);
    const [sx, sz] = pAt(-7.5, shelterD + 0.75);
    L.stopFurniture.push({
      stop: s.id,
      name: s.name,
      pole: [px, pz],
      shelter: [sx, sz],
      yaw: lane.yaw,
      // passengers wait between the curb and the shelter
      waitArea: { along: [-12, -1], depth: [0.7, Math.max(1.2, shelterD - 0.3)] },
      big: s.demand >= 1.2,
    });
    addCircle(px, pz, 0.1);
    addBox(sx, sz, lane.yaw + Math.PI / 2, 0.75, 2.6, 'shelter');
  }

  // ---- per region
  const reserved = [];
  const reserve = (x, z, yaw, hl, hw) => reserved.push({ x, z, yaw, d: hl * 2, w: hw * 2 });
  const place = (b) => {
    // Reject overlaps with buildings already placed and with landmarks.
    for (const o of L.buildings) {
      if (Math.abs(o.x - b.x) > 60 || Math.abs(o.z - b.z) > 60) continue;
      if (boxesOverlap(o, b, -0.3)) return false;
    }
    for (const o of reserved) if (boxesOverlap(o, b, 1)) return false;
    L.buildings.push(b);
    addBox(b.x, b.z, b.yaw, b.d / 2, b.w / 2, 'building');
    return true;
  };

  const perimeter = (region, cfg, runFilter = () => true, opts = {}) => {
    const runs = region.frontRuns;
    for (let k = 0; k < runs.length; k++) {
      const run = runs[k];
      if (!runFilter(run, k)) continue;
      const [dx, dz] = DIRS[run.dir];
      const [lx, lz] = DIRS[leftOf(run.dir)];
      const len = (run.bx - run.ax) * dx + (run.bz - run.az) * dz;
      const depth = opts.depth || cfg.depth;
      // Extend into the rounded corner at the start, leave room for the next run's corner building.
      const t0 = -3;
      const t1 = len - depth + 3 - 0.2;
      let t = t0;
      const street = streetOf(city, run);
      while (t < t1 - 5) {
        let w = rand(cfg.width[0], cfg.width[1]);
        if (t1 - (t + w) < cfg.width[0]) w = t1 - t;
        if (w < 5) break;
        if (cfg.gaps && rng() < cfg.gaps) {
          t += rand(6, 14);
          continue;
        }
        const cx = run.ax + dx * (t + w / 2) + lx * (depth / 2);
        const cz = run.az + dz * (t + w / 2) + lz * (depth / 2);
        const floors = Math.round(rand(cfg.floors[0], cfg.floors[1]));
        const style = cfg.styles[Math.floor(rng() * cfg.styles.length)];
        const gable = rng() < cfg.gable;
        const shop = rng() < cfg.shop;
        const floorH = style === 'oldtown' ? 3.1 : style === 'office' ? 3.6 : 3.2;
        const groundH = shop ? 4.2 : floorH + 0.3;
        place({
          x: cx,
          z: cz,
          yaw: Math.atan2(-lx, -lz), // front faces the street
          w,
          d: depth,
          floors,
          floorH,
          groundH,
          h: groundH + (floors - 1) * floorH,
          style,
          roof: gable ? 'gable' : 'flat',
          ground: shop ? 'shop' : style === 'office' ? 'lobby' : 'plain',
          tint: rng(),
          seed: Math.floor(rng() * 1e6),
          street,
        });
        t += w;
      }
    }
  };

  const rectOf = (region) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < region.front.length; i += 2) {
      b[0] = Math.min(b[0], region.front[i]);
      b[1] = Math.min(b[1], region.front[i + 1]);
      b[2] = Math.max(b[2], region.front[i]);
      b[3] = Math.max(b[3], region.front[i + 1]);
    }
    return { x0: b[0], z0: b[1], x1: b[2], z1: b[3], cx: (b[0] + b[2]) / 2, cz: (b[1] + b[3]) / 2, w: b[2] - b[0], d: b[3] - b[1] };
  };
  const areaRect = (type, x0, z0, x1, z1, extra = {}) => L.areas.push({ type, pts: [x0, z0, x1, z0, x1, z1, x0, z1], ...extra });
  const tree = (x, z, kind = 'broad', s = 1) => {
    L.trees.push({ x, z, kind, scale: s * rand(0.85, 1.2), rot: rng() * 6.28 });
    addCircle(x, z, 0.35 * s, 'tree');
  };
  const scatterTrees = (R, n, margin, kind, avoid = () => false) => {
    for (let i = 0; i < n; i++) {
      const x = rand(R.x0 + margin, R.x1 - margin);
      const z = rand(R.z0 + margin, R.z1 - margin);
      if (avoid(x, z)) continue;
      tree(x, z, kind === 'mix' ? (rng() < 0.3 ? 'conifer' : 'broad') : kind);
    }
  };
  const lm = (type, x, z, yaw, extra = {}) => {
    const o = { type, x, z, yaw, ...extra };
    L.landmarks.push(o);
    return o;
  };
  const courtyard = (R, depth) => {
    const inner = { x0: R.x0 + depth + 2, z0: R.z0 + depth + 2, x1: R.x1 - depth - 2, z1: R.z1 - depth - 2 };
    if (inner.x1 - inner.x0 < 10 || inner.z1 - inner.z0 < 10) return;
    areaRect('grass', inner.x0, inner.z0, inner.x1, inner.z1);
    const n = Math.floor(((inner.x1 - inner.x0) * (inner.z1 - inner.z0)) / 700);
    scatterTrees(inner, n, 3, 'mix');
  };

  for (const region of city.regions) {
    if (region.outer) continue;
    const R = rectOf(region);
    const use = region.use;
    const cfg = USES[use];
    // Everything inside the building line starts as paved ground; areas paint over it.
    switch (use) {
      case 'market': {
        areaRect('plaza', R.x0, R.z0, R.x1, R.z1);
        perimeter(region, USES.oldtown, (run) => run.dir === 2 || run.dir === 0);
        const rh = lm('townhall', R.cx, R.z1 - 13, Math.PI, { w: 58, d: 22 });
        addBox(rh.x, rh.z, rh.yaw, 11, 29);
        const f = lm('fountain', R.cx, R.cz - 12, 0);
        addCircle(f.x, f.z, 4.6, 'solid');
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 5; c++) {
            const x = R.cx - 36 + c * 9 + (r ? 4 : 0);
            const z = R.cz + 10 + r * 9;
            L.props.push({ type: 'stall', x, z, yaw: 0, color: Math.floor(rng() * 5) });
            addBox(x, z, 0, 1.4, 1.8);
          }
        }
        for (let i = 0; i < 6; i++) {
          tree(R.x0 + 18 + i * ((R.w - 36) / 5), R.z0 + 10, 'broad', 0.9);
        }
        for (let i = 0; i < 8; i++) L.props.push({ type: 'bench', x: R.cx - 30 + i * 8.5, z: R.cz - 22, yaw: Math.PI });
        break;
      }
      case 'church': {
        perimeter(region, cfg);
        areaRect('grass', R.x0 + 16, R.z0 + 16, R.x1 - 16, R.z1 - 16);
        const ch = lm('church', R.cx + 4, R.cz, Math.PI / 2, { name: 'St. Marien' });
        addBox(ch.x, ch.z, ch.yaw, 23, 9.5);
        addBox(ch.x - 27, ch.z, 0, 5.5, 5.5);
        scatterTrees({ x0: R.x0 + 16, z0: R.z0 + 16, x1: R.x1 - 16, z1: R.z1 - 16 }, 18, 3, 'broad', (x, z) => Math.abs(x - ch.x) < 36 && Math.abs(z - ch.z) < 14);
        break;
      }
      case 'theater': {
        const th = lm('theater', R.cx, R.z1 - 17, 0, { w: 70, d: 32 });
        addBox(th.x, th.z, 0, 16, 35);
        reserve(th.x, th.z, 0, 16, 35);
        perimeter(region, cfg);
        break;
      }
      case 'mall': {
        areaRect('parking', R.x0, R.z0 + 95, R.x1, R.z1);
        const m = lm('mall', R.cx, R.z0 + 46, Math.PI, { w: 118, d: 84, name: 'Stadtgalerie' });
        addBox(m.x, m.z, 0, 42, 59);
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 14; c++) {
            if (rng() < 0.35) continue;
            const x = R.x0 + 12 + c * 8.8;
            const z = R.z0 + 104 + r * 12;
            L.props.push({ type: 'parkedCar', x, z, yaw: r ? 0 : Math.PI, color: Math.floor(rng() * 12) });
            addBox(x, z, 0, 2.3, 1);
          }
        }
        break;
      }
      case 'school': {
        const s1 = lm('school', R.cx - 6, R.z0 + 9, Math.PI, { w: 90, d: 16, floors: 3 });
        addBox(s1.x, s1.z, 0, 8, 45);
        const s2 = lm('schoolWing', R.x0 + 9, R.z0 + 40, Math.PI / 2, { w: 50, d: 16, floors: 3 });
        addBox(s2.x, s2.z, Math.PI / 2, 8, 25);
        areaRect('schoolyard', R.x0 + 20, R.z0 + 20, R.x1 - 4, R.z0 + 70);
        areaRect('pitch', R.x0 + 24, R.z0 + 78, R.x1 - 12, R.z1 - 8);
        L.props.push({ type: 'goal', x: R.x0 + 26, z: (R.z0 + 78 + R.z1 - 8) / 2, yaw: Math.PI / 2 });
        L.props.push({ type: 'goal', x: R.x1 - 14, z: (R.z0 + 78 + R.z1 - 8) / 2, yaw: -Math.PI / 2 });
        for (let i = 0; i < 7; i++) tree(R.x1 - 6, R.z0 + 8 + i * 9, 'broad', 0.9);
        break;
      }
      case 'park': {
        areaRect('grass', R.x0, R.z0, R.x1, R.z1);
        const pond = { x: R.cx + 70, z: R.cz + 8, rx: 34, rz: 22 };
        lm('pond', pond.x, pond.z, 0, { rx: pond.rx, rz: pond.rz });
        L.areas.push({ type: 'path', pts: [R.x0, R.cz - 2, R.x1, R.cz - 2, R.x1, R.cz + 2, R.x0, R.cz + 2] });
        L.areas.push({ type: 'path', pts: [R.cx - 2, R.z0, R.cx + 2, R.z0, R.cx + 2, R.z1, R.cx - 2, R.z1] });
        const inPond = (x, z) => ((x - pond.x) / (pond.rx + 4)) ** 2 + ((z - pond.z) / (pond.rz + 4)) ** 2 < 1;
        const onPath = (x, z) => Math.abs(z - R.cz) < 5 || Math.abs(x - R.cx) < 5;
        const pg = { x: R.x0 + 40, z: R.z1 - 30 };
        lm('playground', pg.x, pg.z, 0);
        scatterTrees(R, 150, 4, 'mix', (x, z) => inPond(x, z) || onPath(x, z) || (Math.abs(x - pg.x) < 18 && Math.abs(z - pg.z) < 14));
        for (let i = 0; i < 10; i++) L.props.push({ type: 'bench', x: R.x0 + 20 + i * 28, z: R.cz - 4.5, yaw: Math.PI });
        lm('kiosk', R.cx + 10, R.cz + 9, 0);
        addBox(R.cx + 10, R.cz + 9, 0, 2.5, 3);
        break;
      }
      case 'sports': {
        areaRect('grass', R.x0, R.z0, R.x1, R.z1);
        const st = lm('stadium', R.cx + 10, R.cz, 0, { name: 'Sportpark' });
        addBox(st.x, st.z - 50, 0, 5, 60);
        addBox(st.x, st.z + 50, 0, 5, 60);
        for (const [sx, sz] of [
          [-62, -40],
          [62, -40],
          [-62, 40],
          [62, 40],
        ]) {
          L.props.push({ type: 'floodlight', x: st.x + sx, z: st.z + sz, yaw: Math.atan2(-sx, -sz) });
          addCircle(st.x + sx, st.z + sz, 0.4);
        }
        areaRect('parking', R.x0 + 4, R.z0 + 4, R.x0 + 70, R.z1 - 4);
        scatterTrees({ x0: R.x1 - 60, z0: R.z0, x1: R.x1, z1: R.z1 }, 20, 4, 'broad');
        break;
      }
      case 'hospital': {
        const h = lm('hospital', R.cx, R.z0 + 20, Math.PI, { w: 96, d: 24, floors: 8, name: 'Klinikum' });
        addBox(h.x, h.z, 0, 12, 48);
        const w2 = lm('hospitalWing', R.cx - 26, R.z0 + 62, 0, { w: 40, d: 36, floors: 4 });
        addBox(w2.x, w2.z, 0, 18, 20);
        areaRect('parking', R.cx + 4, R.z0 + 40, R.x1 - 4, R.z1 - 4);
        for (let i = 0; i < 16; i++) {
          if (rng() < 0.3) continue;
          const x = R.cx + 12 + (i % 8) * 8;
          const z = R.z0 + 60 + Math.floor(i / 8) * 26;
          L.props.push({ type: 'parkedCar', x, z, yaw: 0, color: Math.floor(rng() * 12) });
          addBox(x, z, 0, 2.3, 1);
        }
        areaRect('grass', R.x0 + 4, R.z0 + 84, R.cx - 2, R.z1 - 4);
        scatterTrees({ x0: R.x0 + 4, z0: R.z0 + 84, x1: R.cx - 2, z1: R.z1 - 4 }, 14, 3, 'broad');
        break;
      }
      case 'depot': {
        areaRect('parking', R.x0 + 2, R.z0 + 40, R.x1 - 2, R.z1 - 26);
        const hall = lm('busHall', R.cx, R.z0 + 18, Math.PI, { w: 96, d: 32 });
        addBox(hall.x, hall.z, 0, 16, 48);
        const office = lm('depotOffice', R.cx, R.z1 - 12, 0, { w: 50, d: 16, floors: 3, name: 'Betriebshof' });
        addBox(office.x, office.z, 0, 8, 25);
        for (let i = 0; i < 9; i++) {
          const x = R.x0 + 14 + i * 14.5;
          L.props.push({ type: 'parkedBus', x, z: R.cz + 12, yaw: 0, tint: i % 3 });
          addBox(x, R.cz + 12, 0, 6.05, 1.3);
        }
        break;
      }
      case 'industrial': {
        areaRect('parking', R.x0, R.z0, R.x1, R.z1);
        for (let i = 0; i < 4; i++) {
          const w = lm('warehouse', R.cx + (i % 2 ? 30 : -30), R.z0 + 40 + Math.floor(i / 2) * 110 + (i % 2) * 20, 0, { w: 54, d: 36, h: 10 + (i % 3) * 2 });
          addBox(w.x, w.z, 0, 18, 27);
        }
        const silo = lm('silo', R.x0 + 22, R.z1 - 24, 0);
        addCircle(silo.x, silo.z, 5, 'solid');
        for (let i = 0; i < 5; i++) {
          const x = R.x1 - 18;
          const z = R.z0 + 100 + i * 14;
          L.props.push({ type: 'truckTrailer', x, z, yaw: Math.PI / 2 });
          addBox(x, z, Math.PI / 2, 6.5, 1.3);
        }
        break;
      }
      case 'university': {
        perimeter(region, cfg);
        courtyard(R, 16);
        break;
      }
      case 'seniors': {
        perimeter(region, cfg);
        courtyard(R, 13);
        break;
      }
      default: {
        perimeter(region, cfg || USES.residential);
        courtyard(R, (cfg || USES.residential).depth);
      }
    }
  }

  // ---- outskirts: houses along the outer side of the ring, the station in the north
  const outer = city.regions.find((r) => r.outer);
  perimeter(outer, USES.outerWest, (run) => run.dir === 0);
  perimeter(outer, USES.outerEast, (run) => run.dir === 2);
  {
    // Hauptbahnhof with forecourt north of Bahnhofstraße.
    const z0 = city.bounds.minZ - H - ROAD.sidewalk;
    const st = lm('station', -40, z0 - 30, 0, { w: 124, d: 34, name: 'Hauptbahnhof' });
    addBox(st.x, st.z, 0, 17, 62);
    areaRect('plaza', -150, z0 - 13, 70, z0);
    lm('tracks', -40, z0 - 80, 0, { length: 1300 });
    addBox(-40, z0 - 80, 0, 26, 700, 'solid');
    for (let i = 0; i < 6; i++) L.props.push({ type: 'taxi', x: 20 + i * 6.2, z: z0 - 5, yaw: -Math.PI / 2 });
    // Houses along the rest of the northern ring.
    perimeter(outer, USES.outerEast, (run) => run.dir === 1, { depth: 14 });
    L.buildings = L.buildings.filter((b) => {
      const clash = b.z < city.bounds.minZ && b.x > -175 && b.x < 95;
      return !clash;
    });
  }
  // River promenade in the south.
  {
    const z0 = city.bounds.maxZ + H + ROAD.sidewalk;
    areaRect('grass', city.bounds.minX - 300, z0, city.bounds.maxX + 300, z0 + 50);
    lm('river', (city.bounds.minX + city.bounds.maxX) / 2, z0 + 80, 0, { width: 60, length: 2200 });
    for (let x = city.bounds.minX - 250; x < city.bounds.maxX + 250; x += rand(11, 17)) tree(x, z0 + rand(8, 40), rng() < 0.2 ? 'conifer' : 'broad');
  }
  // Rebuild building colliders after filtering.
  L.boxes = L.boxes.filter((b) => b.kind !== 'building');
  for (const b of L.buildings) addBox(b.x, b.z, b.yaw, b.d / 2, b.w / 2, 'building');

  // ---- street furniture along every curb
  for (const region of city.regions) {
    for (const run of region.curbRuns) {
      const [dx, dz] = DIRS[run.dir];
      const [lx, lz] = DIRS[leftOf(run.dir)];
      const len = (run.bx - run.ax) * dx + (run.bz - run.az) * dz;
      const street = streetOf(city, run, H);
      const treesHere = street && TREE_STREETS.has(street) && !region.outer;
      for (let t = 10; t < len - 10; t += 34) {
        const x = run.ax + dx * t + lx * 0.55;
        const z = run.az + dz * t + lz * 0.55;
        if (kept(x, z) || nearJunction(x, z, 1)) continue;
        L.lamps.push({ x, z, yaw: Math.atan2(-lx, -lz) });
        addCircle(x, z, 0.14);
      }
      if (treesHere) {
        for (let t = 16; t < len - 10; t += 13) {
          const x = run.ax + dx * t + lx * 1.35;
          const z = run.az + dz * t + lz * 1.35;
          if (kept(x, z, 1) || nearJunction(x, z, 2)) continue;
          if (L.lamps.some((l) => Math.abs(l.x - x) < 3 && Math.abs(l.z - z) < 3)) continue;
          tree(x, z, street === 'Lindenallee' ? 'lime' : 'broad', 0.95);
        }
      }
      // Occasional bins, advertising columns and bike racks.
      for (let t = 25; t < len - 25; t += rand(40, 90)) {
        const x = run.ax + dx * t + lx * 4.8;
        const z = run.az + dz * t + lz * 4.8;
        if (kept(x, z) || nearJunction(x, z, 2)) continue;
        const r = rng();
        const type = r < 0.45 ? 'bin' : r < 0.7 ? 'litfass' : r < 0.9 ? 'bikes' : 'bollard';
        L.props.push({ type, x, z, yaw: Math.atan2(-lx, -lz) });
        if (type === 'litfass') addCircle(x, z, 0.6, 'solid');
      }
    }
  }
  return L;
}

// Name of the street a run (building line or curb) runs along.
function streetOf(city, run, inset = H + ROAD.sidewalk) {
  const [lx, lz] = DIRS[leftOf(run.dir)];
  const mx = (run.ax + run.bx) / 2 - lx * inset;
  const mz = (run.az + run.bz) / 2 - lz * inset;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    if (e.axis === 'h' && Math.abs(mz - a.z) < 1 && mx >= a.x && mx <= b.x) return e.name;
    if (e.axis === 'v' && Math.abs(mx - a.x) < 1 && mz >= a.z && mz <= b.z) return e.name;
  }
  return null;
}

// Oriented box overlap for building boxes {x, z, yaw, w, d}.
function boxesOverlap(a, b, tol = 0) {
  const A = { x: a.x, z: a.z, yaw: a.yaw, hl: a.d / 2 + tol, hw: a.w / 2 + tol };
  const B = { x: b.x, z: b.z, yaw: b.yaw, hl: b.d / 2 + tol, hw: b.w / 2 + tol };
  const axes = [];
  for (const o of [A, B]) {
    axes.push([Math.sin(o.yaw), Math.cos(o.yaw)], [Math.cos(o.yaw), -Math.sin(o.yaw)]);
  }
  const proj = (o, [nx, nz]) => o.hl * Math.abs(nx * Math.sin(o.yaw) + nz * Math.cos(o.yaw)) + o.hw * Math.abs(nx * Math.cos(o.yaw) - nz * Math.sin(o.yaw));
  for (const n of axes) {
    const d = Math.abs((B.x - A.x) * n[0] + (B.z - A.z) * n[1]);
    if (d >= proj(A, n) + proj(B, n)) return false;
  }
  return true;
}
