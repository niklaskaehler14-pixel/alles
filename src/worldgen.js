// Procedural world data: terrain heights, track profile, city layout, vegetation and colliders.
// Pure JavaScript so it can be unit-tested in Node without WebGL.

import { WORLD, ROAD, CITY, LAKE, MOUNTAIN, FESTIVAL, TRACK_POINTS, START_POINT, SEED } from './config.js';
import { mulberry32, createNoise2D, fbm, ridged } from './noise.js';
import { clamp, lerp, smoothstep } from './util.js';
import { Track } from './track.js';
import { Heightfield } from './heightfield.js';
import { StaticColliders } from './collision.js';
import { planActivities, inClearCorridor, rampSurface } from './activities.js';
import { buildRoadNetwork, branchAt } from './roads.js';
import { planLandmarks } from './landmarks.js';

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
    this.festivalHeight = 0;
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

  // Kaminari range in the middle of the map: a ridge with two summits and a pass. The flanks at the
  // pass are smooth so the touge switchbacks lie cleanly in the slope; elsewhere the rock is rugged.
  // Compact support keeps the circuit and the city untouched.
  mountainHeight(x, z) {
    const M = MOUNTAIN;
    const rx = x - M.a[0];
    const rz = z - M.a[1];
    const s = (rx * M.dir[0] + rz * M.dir[1]) / M.length;
    const sc = clamp(s, 0, 1);
    const d = Math.hypot(x - (M.a[0] + M.dir[0] * sc * M.length), z - (M.a[1] + M.dir[1] * sc * M.length));
    if (d >= M.halfWidth) return 0;
    // Ridge body with a level crest (the pass), smooth flanks.
    const u = d / M.halfWidth;
    let m = M.passHeight * (1 - u * u * u * (u * (u * 6 - 15) + 10));
    // Summits: cones joined with a soft union. They fade out around the pass so its flanks stay
    // planar there and the touge switchbacks lie cleanly in the slope.
    const quiet = smoothstep(0.34, 0.2, Math.abs(s - M.pass));
    for (const p of M.peaks) {
      const px = M.a[0] + M.dir[0] * p.s * M.length;
      const pz = M.a[1] + M.dir[1] * p.s * M.length;
      const v2 = ((x - px) ** 2 + (z - pz) ** 2) / (p.r * p.r);
      if (v2 >= 1) continue;
      const c = p.h * (1 - v2) * (1 - v2) * (1 - quiet);
      m = m + c - (m * c) / p.h;
    }
    const rough = 0.88 + 0.24 * ridged(this.nRidge, x * 0.0021 + 7.1, z * 0.0021 - 3.3, 3);
    return m * (rough + (1 - rough) * quiet);
  }

  festivalMask(x, z) {
    const d = Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z);
    return smoothstep(FESTIVAL.radius + 120, FESTIVAL.radius, d);
  }

  naturalHeight(x, z) {
    let h = this.#rawHeight(x, z) + this.mountainHeight(x, z);
    const lk = this.lakeMask(x, z);
    if (lk > 0) h = lerp(h, LAKE.depth, lk);
    const ck = this.cityMask(x, z);
    if (ck > 0) h = lerp(h, this.cityHeight, ck);
    const fk = this.festivalMask(x, z);
    if (fk > 0) h = lerp(h, this.festivalHeight, fk);
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
    let fsum = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      fsum += this.#rawHeight(FESTIVAL.x + Math.cos(a) * FESTIVAL.radius, FESTIVAL.z + Math.sin(a) * FESTIVAL.radius);
    }
    this.festivalHeight = Math.round(fsum / 16);

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

  // Branch roads of the open world (touge, lake road, gravel road).
  buildRoads() {
    return buildRoadNetwork(this);
  }

  buildTerrain() {
    const hf = new Heightfield(WORLD.size, WORLD.segments);
    this.heightfield = hf;
    const stride = hf.stride;
    const cell = hf.cell;
    const N = stride * stride;
    // Every road sample stamps its neighbourhood. Each vertex keeps the nearest candidate and the
    // nearest one from a different road or a different leg of the same road (switchbacks), so the
    // slope between two stacked legs is interpolated instead of snapping to one of them.
    const d1 = new Float32Array(N).fill(1e9);
    const h1 = new Float32Array(N);
    const w1 = new Float32Array(N); // half width (road edge incl. shoulder) of that road
    const r1 = new Int16Array(N).fill(-1);
    const i1 = new Int32Array(N);
    const d2 = new Float32Array(N).fill(1e9);
    const h2 = new Float32Array(N);
    const w2 = new Float32Array(N);
    const r2 = new Int16Array(N).fill(-1);
    const roads = [this.track, ...(this.branches || [])];
    const maxBlend = 110;
    roads.forEach((road, ri) => {
      const ht = road === this.track ? ROAD.halfTotal : road.halfTotal;
      const reach = ht + 6 + maxBlend;
      const n = road.count;
      const legGap = (i, j) => {
        let k = Math.abs(i - j);
        if (road.closed) k = Math.min(k, n - k);
        return k * road.spacing;
      };
      for (let i = 0; i < n; i++) {
        const x = road.x[i];
        const z = road.z[i];
        const hr = road.h[i];
        const ix0 = Math.max(0, Math.floor((x - reach + WORLD.half) / cell));
        const ix1 = Math.min(stride - 1, Math.ceil((x + reach + WORLD.half) / cell));
        const iz0 = Math.max(0, Math.floor((z - reach + WORLD.half) / cell));
        const iz1 = Math.min(stride - 1, Math.ceil((z + reach + WORLD.half) / cell));
        for (let iz = iz0; iz <= iz1; iz++) {
          const dz = hf.worldZ(iz) - z;
          for (let ix = ix0; ix <= ix1; ix++) {
            const dx = hf.worldX(ix) - x;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d > reach) continue;
            const v = ix + iz * stride;
            const e = d - ht; // distance beyond the road edge
            if (e < d1[v]) {
              const sameLeg = r1[v] === ri && legGap(i, i1[v]) < (e + d1[v] + 2 * ht) * 1.6 + 20;
              if (!sameLeg) {
                d2[v] = d1[v];
                h2[v] = h1[v];
                w2[v] = w1[v];
                r2[v] = r1[v];
              }
              d1[v] = e;
              h1[v] = hr;
              w1[v] = ht;
              r1[v] = ri;
              i1[v] = i;
            } else if (e < d2[v]) {
              const sameLeg = r1[v] === ri && legGap(i, i1[v]) < (e + d1[v] + 2 * ht) * 1.6 + 20;
              if (!sameLeg) {
                d2[v] = e;
                h2[v] = hr;
                w2[v] = ht;
                r2[v] = ri;
              }
            }
          }
        }
      }
    });
    // Terrain shaped by one road: cut to sit under the ribbon, level shoulders, then blend out.
    const shape = (e, hr, nat) => {
      if (e < 0.6) return hr - 0.4;
      if (e < 6) return hr - 0.1;
      const blend = clamp(Math.abs(nat - hr) * 2.4, 22, maxBlend);
      if (e < 6 + blend) return lerp(hr - 0.1, nat, smoothstep(6, 6 + blend, e));
      return nat;
    };
    this.roadDist = new Float32Array(N);
    for (let iz = 0; iz < stride; iz++) {
      const z = hf.worldZ(iz);
      for (let ix = 0; ix < stride; ix++) {
        const x = hf.worldX(ix);
        const v = ix + iz * stride;
        const nat = this.naturalHeight(x, z);
        let h = nat;
        if (r1[v] >= 0) {
          h = shape(d1[v], h1[v], nat);
          if (r2[v] >= 0 && d1[v] > 6) {
            // Between two roads (or two legs): inverse-distance blend of both shapes.
            const hB = shape(d2[v], h2[v], nat);
            const a = 1 / Math.max(0.5, d1[v] - 6) ** 2;
            const b = 1 / Math.max(0.5, d2[v] - 6) ** 2;
            h = (h * a + hB * b) / (a + b);
          }
        }
        hf.heights[v] = h;
        // Distance from the centre of a standard-width road with the same edge distance (terrain tint).
        this.roadDist[v] = r1[v] >= 0 ? d1[v] + ROAD.halfTotal : 999;
      }
    }
    return hf;
  }

  // Ground under a point: road ribbon where present (circuit or branch), terrain elsewhere.
  groundHeight(x, z, q) {
    let h = -Infinity;
    if (q && q.index >= 0 && Math.abs(q.lateral) < ROAD.halfTotal) {
      const l = Math.abs(q.lateral);
      h = q.height - (l > ROAD.half ? ((l - ROAD.half) / ROAD.shoulder) * 0.12 : 0);
    }
    const b = this.branchAt(x, z);
    if (b && b.height > h) h = b.height;
    if (h > -Infinity) return h;
    const t = this.heightfield.get(x, z);
    const ramp = rampSurface(this, x, z);
    return ramp > 0 ? t + ramp : t;
  }

  // Branch road under (x, z) or null. The last lookup is cached (ground and surface ask in turn).
  branchAt(x, z) {
    const c = this._branchCache || (this._branchCache = { x: NaN, z: NaN, hit: null, out: {}, q: {} });
    if (c.x === x && c.z === z) return c.hit;
    c.x = x;
    c.z = z;
    c.hit = branchAt(this, x, z, c.out, c.q);
    return c.hit;
  }

  planActivities() {
    return planActivities(this);
  }

  // Festival grounds, torii, lighthouse, cherry trees, neon signs, bonus boards and landmarks.
  planLandmarks() {
    return planLandmarks(this);
  }

  surfaceAt(x, z, h, q) {
    if (q && q.index >= 0) {
      const l = Math.abs(q.lateral);
      if (l < ROAD.half) return 0; // asphalt
      if (l < ROAD.halfTotal) {
        const b = this.branchAt(x, z);
        if (b && Math.abs(b.lateral) < b.road.half) return b.road.surface;
        return 2; // gravel shoulder
      }
    }
    const b = this.branchAt(x, z);
    if (b) return Math.abs(b.lateral) < b.road.half ? b.road.surface : 2;
    if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.radius - 8) return 0;
    if (Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z) < FESTIVAL.radius - 4) return 0; // festival plaza
    if (rampSurface(this, x, z) > 0) return 0; // ramp deck grips like asphalt
    if (h < WORLD.waterLevel + 2.2) return 3; // sand / shallow water
    return 1; // grass
  }

  // Distance from (x, z) to the nearest branch road centre line (Infinity when far away).
  branchDistance(x, z, margin = 0) {
    let best = Infinity;
    const q = this._bdq || (this._bdq = {});
    for (const road of this.branches || []) {
      const b = road.bbox;
      if (x < b.minX - margin || x > b.maxX + margin || z < b.minZ - margin || z > b.maxZ + margin) continue;
      const r = road.nearest(x, z, -1, q, 2);
      if (r.index >= 0) best = Math.min(best, r.dist - road.halfTotal);
    }
    return best;
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

  // Guard rails along the touge: on the outside of hairpins and wherever the slope falls away.
  placeGuardRails() {
    const rails = [];
    for (const road of this.branches || []) {
      if (road.type !== 'touge') continue;
      const n = road.count;
      const flags = [new Uint8Array(n), new Uint8Array(n)]; // left, right
      const pt = {};
      for (let i = 0; i < n; i++) {
        const s = i * road.spacing;
        for (const [k, sd] of [
          [0, 1],
          [1, -1],
        ]) {
          road.pointAt(s, sd * (road.halfTotal + 16), pt);
          const drop = road.h[i] - this.naturalHeight(pt.x, pt.z);
          const outer = road.curv[i] * sd < -1 / 45; // turning away from this side
          if (drop > 3.5 || outer) flags[k][i] = 1;
        }
      }
      for (const [k, sd] of [
        [0, 1],
        [1, -1],
      ]) {
        // Close small gaps, then keep runs of at least 30 m away from the road ends and junctions.
        const f = flags[k];
        const grown = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (f[i]) for (let d = -8; d <= 8; d++) if (i + d >= 0 && i + d < n) grown[i + d] = 1;
        const keepOut = (i) => {
          const s = i * road.spacing;
          if (s < 40 || s > road.length - 40) return true;
          return road.junctions.some((j) => Math.abs(s - j.s) < 40);
        };
        let i = 0;
        while (i < n) {
          if (!grown[i] || keepOut(i)) {
            i++;
            continue;
          }
          let j = i;
          while (j < n && grown[j] && !keepOut(j)) j++;
          if ((j - i) * road.spacing >= 30) rails.push({ road, side: sd, s0: i * road.spacing, s1: (j - 1) * road.spacing });
          i = j;
        }
      }
    }
    const pt = {};
    for (const r of rails) {
      const lat = r.side * (r.road.halfTotal - 0.25);
      for (let s = r.s0; s <= r.s1; s += 1.5) {
        r.road.pointAt(s, lat, pt);
        this.colliders.addCircle(pt.x, pt.z, 0.3, 'rail');
      }
    }
    this.rails = rails;
    return rails;
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
    // The lake road is lit on its lake side.
    for (const road of this.branches || []) {
      if (road.type !== 'lake') continue;
      for (let s = 30; s < road.length - 30; s += 62) {
        const p = road.pointAt(s, -(road.halfTotal + 1.4), {});
        if (this.track.nearest(p.x, p.z, -1, {}).dist < ROAD.halfTotal + 6) continue;
        lamps.push({ x: p.x, z: p.z, y: this.heightfield.get(p.x, p.z), yaw: p.heading + Math.PI / 2, road: road.id });
        this.colliders.addCircle(p.x, p.z, 0.25, 'pole');
      }
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
      if (this.branchDistance(x, z, 10) < 8) continue;
      if (Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z) < FESTIVAL.radius + 30) continue;
      if (this.#nearScenery(x, z)) continue;
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
    // Cherry trees (type 2) from the scenery plan: the lake road avenue and around the festival.
    for (const c of this.sakura || []) trees.push({ x: c.x, z: c.z, y: c.y, s: c.s, type: 2, rot: rng() * Math.PI * 2, tint: rng() });
    // Register trunks as colliders.
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
      if (this.branchDistance(x, z, 10) < 6) continue;
      if (Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z) < FESTIVAL.radius + 30) continue;
      if (this.#nearScenery(x, z)) continue;
      const s = 0.6 + rng() * rng() * 3.2;
      rocks.push({ x, z, y: h - s * 0.25, s, rot: rng() * 6.28, tilt: rng() });
      if (s > 0.9) this.colliders.addCircle(x, z, s * 0.75, 'rock');
    }
    this.rocks = rocks;
  }

  // Keeps trees and rocks off the landmarks, the bonus boards and the Ferris wheel.
  #nearScenery(x, z) {
    const lh = this.lighthouse;
    if (lh && Math.hypot(x - lh.x, z - lh.z) < 14) return true;
    const w = this.festival?.wheel;
    if (w && Math.hypot(x - w.x, z - w.z) < 34) return true;
    for (const b of this.bonusBoards || []) if (Math.abs(x - b.x) < 8 && Math.abs(z - b.z) < 8) return true;
    for (const l of this.lanterns || []) if (Math.abs(x - l.x) < 4 && Math.abs(z - l.z) < 4) return true;
    return false;
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
    this.buildRoads();
    this.buildTerrain();
    this.placeGuardRails();
    this.placeCity();
    this.placeLamps();
    this.planActivities();
    this.planLandmarks();
    this.placeVegetation();
    this.placeBillboards();
    return this;
  }
}
