// Procedural world data: terrain heights, track profile, city layout, vegetation and colliders.
// Pure JavaScript so it can be unit-tested in Node without WebGL.

import { WORLD, ROAD, CITY, LAKE, TRACK_POINTS, START_POINT, SEED } from './config.js';
import { mulberry32, createNoise2D, fbm, ridged } from './noise.js';
import { clamp, lerp, smoothstep } from './util.js';
import { Track } from './track.js';
import { Heightfield } from './heightfield.js';
import { StaticColliders } from './collision.js';
import { planActivities, inClearCorridor, rampSurface } from './activities.js';

export class WorldData {
  constructor(seed = SEED) {
    this.seed = seed;
    const rng = mulberry32(seed);
    this.nHills = createNoise2D(rng);
    this.nDetail = createNoise2D(rng);
    this.nRidge = createNoise2D(rng);
    this.nShore = createNoise2D(rng);
    this.nForest = createNoise2D(rng);
    this.nMisc = createNoise2D(rng);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.cityHeight = 0;
    this.colliders = new StaticColliders(24);
    this.lakeCentre = { x: LAKE.x, z: LAKE.z };
  }

  // ---------------------------------------------------------------- terrain shape
  lakeRadius(x, z) {
    const a = Math.atan2(z - LAKE.z, x - LAKE.x);
    return LAKE.radius * (1 + 0.16 * this.nShore(Math.cos(a) * 1.3, Math.sin(a) * 1.3) + 0.06 * this.nShore(Math.cos(a) * 4, Math.sin(a) * 4));
  }

  // 0 outside the lake, 1 on the lake floor.
  lakeMask(x, z) {
    const d = Math.hypot(x - LAKE.x, z - LAKE.z);
    const r = this.lakeRadius(x, z);
    return smoothstep(r + 170, r - 60, d);
  }

  cityMask(x, z) {
    const d = Math.hypot(x - CITY.x, z - CITY.z);
    return smoothstep(CITY.radius + 240, CITY.radius, d);
  }

  #rawHeight(x, z) {
    const dCity = Math.hypot(x - CITY.x, z - CITY.z);
    const calm = 0.3 + 0.7 * smoothstep(CITY.radius, CITY.radius + 750, dCity);
    let h = 34 + fbm(this.nHills, x * 0.00085, z * 0.00085, 5) * 52 * calm;
    h += fbm(this.nDetail, x * 0.006, z * 0.006, 3) * 2.2;
    // Northern highlands the track climbs through.
    h += 95 * Math.exp(-((x - 600) ** 2 + (z + 1180) ** 2) / (2 * 430 * 430));
    // Mountain rim that closes the map.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD.half;
    const m = smoothstep(0.66, 0.99, edge);
    if (m > 0) h += m * m * (240 + 330 * ridged(this.nRidge, x * 0.0013, z * 0.0013, 5));
    return h;
  }

  naturalHeight(x, z) {
    let h = this.#rawHeight(x, z);
    const lk = this.lakeMask(x, z);
    if (lk > 0) h = lerp(h, LAKE.depth, lk);
    const ck = this.cityMask(x, z);
    if (ck > 0) h = lerp(h, this.cityHeight, ck);
    return h;
  }

  // ---------------------------------------------------------------- generation stages
  buildTrack() {
    let sum = 0;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      sum += this.#rawHeight(CITY.x + Math.cos(a) * (CITY.radius + 260), CITY.z + Math.sin(a) * (CITY.radius + 260));
    }
    this.cityHeight = Math.round(sum / 32);
    CITY.height = this.cityHeight;

    const track = new Track(TRACK_POINTS, ROAD.spacing);
    this.track = track;
    const n = track.count;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = this.naturalHeight(track.x[i], track.z[i]);

    // Gaussian smoothing along the loop.
    const smooth = (src, radius, sigma, fixed) => {
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
        for (let k = -radius; k <= radius; k++) s += src[(i + k + n) % n] * weights[k + radius];
        out[i] = s / wsum;
      }
      return out;
    };

    let h = smooth(raw, 70, 30);
    const fixed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      h[i] = Math.max(h[i], WORLD.waterLevel + 3);
      const dCity = Math.hypot(track.x[i] - CITY.x, track.z[i] - CITY.z);
      if (dCity < CITY.radius - 10) {
        h[i] = this.cityHeight;
        fixed[i] = 1;
      }
    }
    // Limit the gradient to keep the road drivable.
    const maxStep = 0.065 * track.spacing;
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 1; i < n * 2; i++) {
        const a = i % n;
        const p = (i - 1) % n;
        if (!fixed[a]) h[a] = clamp(h[a], h[p] - maxStep, h[p] + maxStep);
      }
      for (let i = n * 2; i > 0; i--) {
        const a = i % n;
        const p = (i + 1) % n;
        if (!fixed[a]) h[a] = clamp(h[a], h[p] - maxStep, h[p] + maxStep);
      }
    }
    // Smooth the kinks left by the gradient limiter until crests are only jumpable
    // at very high speed (vertical curvature h'' > -g / v^2 with v ~ 250 km/h).
    const minCurv = -9.81 / (69 * 69);
    // Distance (in samples) to the city section, used to ease the road onto the plateau.
    const distFixed = new Float32Array(n).fill(1e9);
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < 2 * n; k++) {
        const i = k % n;
        distFixed[i] = fixed[i] ? 0 : Math.min(distFixed[i], distFixed[(i - 1 + n) % n] + 1);
      }
      for (let k = 2 * n; k > 0; k--) {
        const i = k % n;
        distFixed[i] = Math.min(distFixed[i], distFixed[(i + 1) % n] + 1);
      }
    }
    const ease = 90; // samples (~180 m)
    for (let pass = 0; pass < 12; pass++) {
      h = smooth(h, 40, 15);
      for (let i = 0; i < n; i++) {
        const t = Math.min(1, distFixed[i] / ease);
        const w = t * t * (3 - 2 * t);
        h[i] = this.cityHeight + (h[i] - this.cityHeight) * w;
      }
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const c = (h[(i + 1) % n] - 2 * h[i] + h[(i - 1 + n) % n]) / (track.spacing * track.spacing);
        worst = Math.min(worst, c);
      }
      if (worst > minCurv) break;
    }
    track.h.set(h);

    track.startIndex = track.indexOf(START_POINT[0], START_POINT[1]);
    track.startS = track.startIndex * track.spacing;
    return track;
  }

  buildTerrain() {
    const hf = new Heightfield(WORLD.size, WORLD.segments);
    this.heightfield = hf;
    const track = this.track;
    const stride = hf.stride;
    this.roadDist = new Float32Array(stride * stride);
    const q = { index: 0 };
    for (let iz = 0; iz < stride; iz++) {
      const z = hf.worldZ(iz);
      for (let ix = 0; ix < stride; ix++) {
        const x = hf.worldX(ix);
        let h = this.naturalHeight(x, z);
        let dist = 999;
        const near = track.nearest(x, z, -1, q, 3);
        if (near.index >= 0) {
          dist = near.dist;
          const hr = near.height;
          const core = ROAD.halfTotal + 0.6;
          const flat = ROAD.halfTotal + 6;
          const blend = clamp(Math.abs(h - hr) * 2.4, 22, 110);
          if (dist < core) h = hr - 0.4;
          else if (dist < flat) h = hr - 0.1;
          else if (dist < flat + blend) h = lerp(hr - 0.1, h, smoothstep(flat, flat + blend, dist));
        }
        const idx = ix + iz * stride;
        hf.heights[idx] = h;
        this.roadDist[idx] = dist;
      }
    }
    return hf;
  }

  // Ground under a point: road ribbon where present, terrain elsewhere.
  groundHeight(x, z, q) {
    if (q && q.index >= 0 && Math.abs(q.lateral) < ROAD.halfTotal) {
      const l = Math.abs(q.lateral);
      return q.height - (l > ROAD.half ? ((l - ROAD.half) / ROAD.shoulder) * 0.12 : 0);
    }
    const h = this.heightfield.get(x, z);
    const ramp = rampSurface(this, x, z);
    return ramp > 0 ? h + ramp : h;
  }

  planActivities() {
    return planActivities(this);
  }

  surfaceAt(x, z, h, q) {
    if (q && q.index >= 0) {
      const l = Math.abs(q.lateral);
      if (l < ROAD.half) return 0; // asphalt
      if (l < ROAD.halfTotal) return 2; // gravel shoulder
    }
    if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.radius - 8) return 0;
    if (rampSurface(this, x, z) > 0) return 0; // ramp deck grips like asphalt
    if (h < WORLD.waterLevel + 2.2) return 3; // sand / shallow water
    return 1; // grass
  }

  // ---------------------------------------------------------------- objects
  placeCity() {
    const rng = this.rng;
    const G = CITY.grid;
    const buildings = [];
    const parks = [];
    const nearTrack = (x, z, margin) => {
      const q = this.track.nearest(x, z, -1, {});
      return q.index >= 0 && q.dist < margin;
    };
    for (let j = -4; j < 4; j++) {
      for (let i = -4; i < 4; i++) {
        const bx = CITY.x + (i + 0.5) * G;
        const bz = CITY.z + (j + 0.5) * G;
        const dBlock = Math.hypot(bx - CITY.x, bz - CITY.z);
        if (dBlock > CITY.radius - 50) continue;
        const inner = G - CITY.street;
        const park = rng() < 0.1;
        for (let lz = 0; lz < 2; lz++) {
          for (let lx = 0; lx < 2; lx++) {
            const cx = bx + (lx - 0.5) * (inner / 2);
            const cz = bz + (lz - 0.5) * (inner / 2);
            if (nearTrack(cx, cz, ROAD.halfTotal + 30)) continue;
            if (park) {
              parks.push({ x: cx, z: cz, size: inner / 2 - 4 });
              continue;
            }
            const centre = 1 - dBlock / CITY.radius;
            const w = inner / 2 - 6 - rng() * 8;
            const d = inner / 2 - 6 - rng() * 8;
            const tall = rng() < 0.35 + centre * 0.4;
            const hgt = tall ? 40 + rng() * 70 * (0.5 + centre) : 14 + rng() * 22;
            const style = tall ? (rng() < 0.6 ? 0 : 1) : rng() < 0.5 ? 2 : 1;
            const b = { x: cx, z: cz, w, d, h: Math.round(hgt / 3.5) * 3.5, style, y: this.cityHeight };
            buildings.push(b);
            this.colliders.addBox(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 'building');
          }
        }
      }
    }
    this.buildings = buildings;
    this.parks = parks;
  }

  placeLamps() {
    const track = this.track;
    const lamps = [];
    let side = 1;
    const pt = {};
    for (let s = 0; s < track.length; ) {
      track.pointAt(s, 0, pt);
      const inCity = Math.hypot(pt.x - CITY.x, pt.z - CITY.z) < CITY.radius + 40;
      const off = ROAD.halfTotal + 1.4;
      const sides = inCity ? [1, -1] : [side];
      for (const sd of sides) {
        const p = track.pointAt(s, off * sd, {});
        const h = this.heightfield.get(p.x, p.z);
        // Arm points towards the road centre.
        lamps.push({ x: p.x, z: p.z, y: h, yaw: p.heading + (sd > 0 ? -Math.PI / 2 : Math.PI / 2) });
        this.colliders.addCircle(p.x, p.z, 0.25, 'pole');
      }
      side = -side;
      s += inCity ? 32 : 58;
    }
    this.lamps = lamps;
  }

  placeVegetation() {
    const rng = this.rng;
    const hf = this.heightfield;
    const trees = [];
    const rocks = [];
    const nrm = { x: 0, y: 1, z: 0 };
    const q = {};
    const tries = 90000;
    for (let t = 0; t < tries; t++) {
      const x = (rng() * 2 - 1) * 1930;
      const z = (rng() * 2 - 1) * 1930;
      const h = hf.get(x, z);
      if (h < WORLD.waterLevel + 3 || h > 330) continue;
      hf.normal(x, z, nrm);
      if (nrm.y < 0.82) continue;
      const dCity = Math.hypot(x - CITY.x, z - CITY.z);
      if (dCity < CITY.radius + 25) continue;
      const forest = fbm(this.nForest, x * 0.0021, z * 0.0021, 3);
      const alpine = smoothstep(150, 300, h);
      const p = smoothstep(-0.25, 0.35, forest) * (1 - alpine * 0.8) + 0.025;
      if (rng() > p * 0.42) continue;
      if (inClearCorridor(this, x, z)) continue;
      const near = this.track.nearest(x, z, -1, q);
      if (near.index >= 0 && near.dist < ROAD.halfTotal + 9) continue;
      const pine = h > 75 || forest + this.nMisc(x * 0.01, z * 0.01) * 0.3 > 0.25;
      const scale = 0.75 + rng() * 0.6;
      trees.push({ x, z, y: h - 0.2, s: scale, type: pine ? 0 : 1, rot: rng() * Math.PI * 2, tint: rng() });
    }
    for (const park of this.parks) {
      for (let k = 0; k < 7; k++) {
        const x = park.x + (rng() - 0.5) * park.size;
        const z = park.z + (rng() - 0.5) * park.size;
        trees.push({ x, z, y: this.cityHeight - 0.1, s: 0.8 + rng() * 0.3, type: 1, rot: rng() * 6.28, tint: rng() });
      }
    }
    // Sort into a stable order and register trunks as colliders.
    for (const tr of trees) this.colliders.addCircle(tr.x, tr.z, 0.45 * tr.s + 0.1, 'tree');
    this.trees = trees;

    for (let t = 0; t < 5000 && rocks.length < 700; t++) {
      const x = (rng() * 2 - 1) * 1950;
      const z = (rng() * 2 - 1) * 1950;
      const h = hf.get(x, z);
      const lake = this.lakeMask(x, z);
      const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD.half;
      const want = edge > 0.7 || (lake > 0.05 && lake < 0.5) || rng() < 0.05;
      if (!want || h < -2) continue;
      if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.radius + 30) continue;
      if (inClearCorridor(this, x, z, 4)) continue;
      const near = this.track.nearest(x, z, -1, q);
      if (near.index >= 0 && near.dist < ROAD.halfTotal + 7) continue;
      const s = 0.6 + rng() * rng() * 3.2;
      rocks.push({ x, z, y: h - s * 0.25, s, rot: rng() * 6.28, tilt: rng() });
      if (s > 0.9) this.colliders.addCircle(x, z, s * 0.75, 'rock');
    }
    this.rocks = rocks;
  }

  placeBillboards() {
    const track = this.track;
    const boards = [];
    const texts = [0, 1, 2, 3, 4, 5];
    let k = 0;
    for (let s = 300; s < track.length - 200; s += 830) {
      const curv = Math.abs(track.curvatureAt(s));
      if (curv > 0.004) continue;
      const side = k % 2 === 0 ? 1 : -1;
      const p = track.pointAt(s, (ROAD.halfTotal + 11) * side, {});
      const h = this.heightfield.get(p.x, p.z);
      // Face oncoming traffic at an angle.
      boards.push({ x: p.x, z: p.z, y: h, yaw: p.heading + Math.PI + side * 0.35, text: texts[k % texts.length] });
      this.colliders.addCircle(p.x, p.z, 1.2, 'board');
      k++;
    }
    this.billboards = boards;
  }

  generateAll() {
    this.buildTrack();
    this.buildTerrain();
    this.placeCity();
    this.placeLamps();
    this.planActivities();
    this.placeVegetation();
    this.placeBillboards();
    return this;
  }
}
