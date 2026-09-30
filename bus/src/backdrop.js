// The landscape around the town, drawn in its own far pass behind the city: suburbs along the
// roads out of town, patchwork fields, forests, rolling hills, a mountain range in the west
// with a castle hill in line with the Hauptstraße, villages with church towers, wind turbines
// on the eastern ridge, a TV tower in the north-east and the river running on through the
// valley. Nothing here is solid; the bus stays inside the town area (see worldExtent).
import * as THREE from 'three';
import { ROAD, worldExtent } from './config.js';
import { mulberry32, hash2, smoothstep, clamp } from './util.js';
import { waterNormalTexture } from './textures.js';

// ---------------------------------------------------------------- noise

function vnoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, z, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

function ridged(x, z, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    const r = 1 - Math.abs(2 * vnoise(x * f + i * 5.1, z * f + i * 3.7) - 1);
    s += a * r * r;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

const MOUNTAIN_DIR = -2.8; // west-north-west (angle of (x, z) around the town centre)
const NEAR = 2600; // half size of the detailed terrain square
const FAR = 9500; // half size of the whole landscape

const WALLS = ['#f3efe6', '#efe6d2', '#e8e4dc', '#f1e3c4', '#e6ddd0', '#dfe3e2', '#f4ead8', '#e9d6bf'];
const ROOFS = ['#a8432e', '#9a3a2a', '#b5553a', '#7f3326', '#4a4c52', '#5b4a42', '#8e3f30', '#3d4046'];
const CROPS = ['#b9a54f', '#c8b25a', '#8aa447', '#6f9440', '#5f8a3a', '#8c7152', '#a08a60', '#d7c64a', '#799c45', '#9a8a55'];

export class Backdrop {
  constructor(city, { quality } = {}) {
    const b = city.bounds;
    this.E = worldExtent(b);
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    this.riverZ = (this.E.riverZ0 + this.E.riverZ1) / 2;
    this.trackZ = b.minZ - ROAD.half - ROAD.sidewalk - 80;
    // The castle stands on its hill at the western end of the Hauptstraße.
    this.castle = { x: this.E.x0 - 1250, z: -110 };
    this.tvTower = { x: this.cx + 2500, z: this.cz - 3000 };
    this.Q = quality || { trees: 4500, tex: 2048, step: 30 };
    this.rng = mulberry32(777);
    this.group = new THREE.Group();
    this.group.name = 'backdrop';
    this.nightMats = [];
    this.houses = [];
    this.roads = [];
    this.villages = [];
    this.halls = [];
    this.roadCells = new Set();
    this.houseCells = new Set();
    this.#plan();
    this.#terrain();
    this.#water();
    this.#buildings();
    this.#trees();
    this.#landmarks();
  }

  // ------------------------------------------------------------ shape of the land

  // Distance outside the town area (0 inside).
  dOut(x, z) {
    const E = this.E;
    const dx = Math.max(E.x0 - x, 0, x - E.x1);
    const dz = Math.max(E.z0 - z, 0, z - E.z1);
    return Math.hypot(dx, dz);
  }

  heightAt(x, z) {
    const d = this.dOut(x, z);
    if (d <= 0) return -0.3;
    const r = Math.hypot(x - this.cx, z - this.cz);
    // Gentle rolling farmland, flat right at the edge of town.
    let h = Math.max(-3, (fbm(x / 1300 + 3.1, z / 1300 - 7.7, 4) - 0.42) * 150) * smoothstep(120, 1500, d);
    // Hills further out all around, rising to a rim that hides the end of the world.
    h += fbm(x / 2300 - 11, z / 2300 + 5, 3) * 300 * smoothstep(2400, 6000, r);
    h += smoothstep(7000, 9500, r) * 380;
    // Mountain range in the west-north-west.
    const ang = Math.atan2(z - this.cz, x - this.cx);
    const west = Math.max(0, Math.cos(ang - MOUNTAIN_DIR));
    if (west > 0) h += ridged(x / 2100, z / 2100, 4) * 760 * Math.pow(west, 1.6) * smoothstep(2000, 4600, r);
    // The castle hill.
    const cdx = x - this.castle.x;
    const cdz = z - this.castle.z;
    h += 165 * Math.exp(-(cdx * cdx + cdz * cdz) / (2 * 340 * 340));
    // The river keeps its level: a valley through everything.
    const dr = Math.abs(z - this.riverZ);
    h *= smoothstep(45, 650, dr);
    if (dr < 36) h = Math.min(h, -1.6 + (dr / 36) * 1.2);
    return h;
  }

  forestAt(x, z) {
    if (this.dOut(x, z) < 90) return false;
    if (Math.abs(z - this.riverZ) < 70) return false;
    const key = `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
    if (this.houseCells.has(key) || this.roadCells.has(`${Math.floor(x / 8)},${Math.floor(z / 8)}`)) return false;
    const h = this.heightAt(x, z);
    const n = fbm(x / 650 + 40, z / 650 - 13, 3);
    return n > 0.6 - Math.min(0.28, Math.max(0, h) / 500) || h > 240;
  }

  // ------------------------------------------------------------ roads, suburbs, villages

  #plan() {
    const E = this.E;
    const rng = this.rng;
    const R = (a, b) => a + (b - a) * rng();
    // Roads out of town, wandering a little.
    const radial = (x, z, dx, dz, len, width, kind) => {
      const pts = [[x, z]];
      const base = Math.atan2(dz, dx);
      let ang = base;
      for (let d = 0; d < len; d += 50) {
        ang = base + clamp(ang - base + (rng() - 0.5) * 0.1, -0.3, 0.3);
        x += Math.cos(ang) * 50;
        z += Math.sin(ang) * 50;
        pts.push([x, z]);
      }
      return this.#road(pts, width, kind);
    };
    const mains = [];
    for (const z of [-262, 188]) mains.push(radial(E.x0 - 4, z, -1, 0, 3600, 9, 'main'));
    for (const z of [-262, 38]) mains.push(radial(E.x1 + 4, z, 1, 0, 3600, 9, 'main'));
    for (const x of [-472, 178, 518]) mains.push(radial(x, E.z0 - 4, 0, -1, 3400, 9, 'main'));
    for (const x of [-302, 178]) mains.push(radial(x, E.z1 + 4, 0, 1, 3000, 8, 'main'));
    // Riverside road on the far bank.
    this.#road([[E.x0 - 1600, E.z1 + 30], [E.x1 + 1600, E.z1 + 30]], 7, 'main');
    // Suburbs: houses along the first stretch of every road out of town, with side streets.
    for (const road of mains) {
      const len = R(650, 1000);
      this.#houseRow(road.pts, 0, len, 'suburb');
      for (let s = 90; s < len - 40; s += R(95, 150)) {
        const p = alongPolyline(road.pts, s);
        for (const side of [-1, 1]) {
          if (rng() < 0.2) continue;
          const nx = -p.dz * side;
          const nz = p.dx * side;
          const l = R(110, 240);
          const pts = [];
          for (let t = 0; t <= l; t += 30) pts.push([p.x + nx * (8 + t), p.z + nz * (8 + t)]);
          const side1 = this.#road(pts, 6, 'side');
          this.#houseRow(side1.pts, 10, l, 'side');
        }
      }
    }
    // Industrial halls along the railway east and west of town.
    for (const [x0, dir] of [[E.x1 + 60, 1], [E.x0 - 60, -1]]) {
      for (let i = 0; i < 5; i++) {
        const x = x0 + dir * (40 + i * 85 + R(0, 20));
        for (const side of [-1, 1]) {
          if (rng() < 0.3) continue;
          const d = R(24, 40);
          const hall = { kind: 'hall', x, z: this.trackZ + side * (22 + d / 2 + R(0, 20)), yaw: 0, w: R(45, 75), d, h: R(8, 11), wall: rng() < 0.5 ? '#c9ccd0' : '#9fb0bf', roof: '#6e7277' };
          if (this.#free(hall)) this.#addHouse(hall);
        }
      }
    }
    // Villages out in the country, each with a church, linked to the nearest road.
    const sites = [
      [-2.45, 2700],
      [-1.55, 3100],
      [-0.75, 2900],
      [0.2, 3200],
      [0.95, 2600],
      [1.75, 2900],
      [2.55, 3300],
      [-1.15, 5200],
      [0.55, 5600],
    ];
    for (const [a, r] of sites) {
      let x = this.cx + Math.cos(a) * r;
      let z = this.cz + Math.sin(a) * r;
      if (Math.abs(z - this.riverZ) < 320) z = this.riverZ + Math.sign(z - this.riverZ || 1) * 320;
      if (this.heightAt(x, z) > 180) {
        // Too high up in the mountains: move down towards the town.
        x = this.cx + (x - this.cx) * 0.75;
        z = this.cz + (z - this.cz) * 0.75;
      }
      const ang = rng() * Math.PI;
      const main = [];
      for (let t = -200; t <= 200; t += 40) main.push([x + Math.cos(ang) * t, z + Math.sin(ang) * t]);
      const cross = [];
      for (let t = -110; t <= 110; t += 40) cross.push([x - Math.sin(ang) * t, z + Math.cos(ang) * t]);
      const r1 = this.#road(main, 6, 'village');
      const r2 = this.#road(cross, 5, 'village');
      this.villages.push({ x, z, yaw: ang });
      // Church first (centre), then the houses around it.
      this.houseCells.add(`${Math.floor(x / 20)},${Math.floor(z / 20)}`);
      this.#houseRow(r1.pts, 14, 400, 'village');
      this.#houseRow(r2.pts, 14, 220, 'village');
      // Country road towards town.
      const nearest = this.#nearestRoadPoint(x, z, mains);
      if (nearest) {
        const pts = [];
        const n = Math.ceil(Math.hypot(nearest[0] - x, nearest[1] - z) / 60);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const wob = Math.sin(t * Math.PI) * 60 * (hash2(Math.floor(x), Math.floor(z)) - 0.5);
          pts.push([x + (nearest[0] - x) * t - Math.sin(ang) * wob, z + (nearest[1] - z) * t + Math.cos(ang) * wob]);
        }
        this.#road(pts, 5.5, 'country');
      }
    }
  }

  #road(pts, width, kind) {
    const road = { pts, width, kind };
    this.roads.push(road);
    // Rasterise (8 m cells) so houses and trees keep off the road.
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t <= len; t += 4) {
        const x = ax + ((bx - ax) * t) / len;
        const z = az + ((bz - az) * t) / len;
        for (let o = -width / 2; o <= width / 2; o += 4) {
          const nx = (-(bz - az) / len) * o;
          const nz = ((bx - ax) / len) * o;
          this.roadCells.add(`${Math.floor((x + nx) / 8)},${Math.floor((z + nz) / 8)}`);
        }
      }
    }
    return road;
  }

  #nearestRoadPoint(x, z, roads) {
    let best = null;
    let bd = Infinity;
    for (const r of roads) {
      for (const p of r.pts) {
        const d = Math.hypot(p[0] - x, p[1] - z);
        if (d < bd && this.dOut(p[0], p[1]) > 400) {
          bd = d;
          best = p;
        }
      }
    }
    return best;
  }

  // Houses on both sides of a road stretch.
  #houseRow(pts, from, to, kind) {
    const rng = this.rng;
    const R = (a, b) => a + (b - a) * rng();
    for (let s = from; s < to; s += kind === 'village' ? R(16, 24) : R(17, 25)) {
      const p = alongPolyline(pts, s);
      if (!p) break;
      for (const side of [-1, 1]) {
        if (rng() < (kind === 'village' ? 0.12 : 0.08)) continue;
        const d0 = this.dOut(p.x, p.z);
        let h;
        if (kind === 'suburb' && d0 < 320 && rng() < 0.55) {
          // Apartment blocks near town.
          h = { kind: 'block', w: R(24, 34), d: R(11, 13), h: R(11, 15.5) };
        } else {
          h = { kind: 'house', w: R(8.5, 12), d: R(8, 10), h: R(5.2, 6.6) };
        }
        const setback = (kind === 'side' ? 3 : 4.5) + R(3, 7);
        const nx = -p.dz * side;
        const nz = p.dx * side;
        const off = setback + h.d / 2 + 4;
        h.x = p.x + nx * off;
        h.z = p.z + nz * off;
        // Front (+z local) faces the road.
        h.yaw = Math.atan2(-nx, -nz);
        h.wall = WALLS[Math.floor(rng() * WALLS.length)];
        h.roof = h.kind === 'block' ? '#6b6e73' : ROOFS[Math.floor(rng() * ROOFS.length)];
        if (this.#free(h)) this.#addHouse(h);
      }
    }
  }

  #free(h) {
    if (this.dOut(h.x, h.z) < 35) return false;
    if (Math.abs(h.z - this.riverZ) < 75) return false;
    if (Math.abs(h.z - this.trackZ) < 18 && this.dOut(h.x, h.z) < 3000) return false;
    const cx = this.castle.x - h.x;
    const cz = this.castle.z - h.z;
    if (cx * cx + cz * cz < 450 * 450) return false; // the castle hill stays wooded
    const s = Math.sin(h.yaw);
    const c = Math.cos(h.yaw);
    const corners = [];
    for (const [a, l] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) corners.push([h.x + s * (h.d / 2) * a + c * (h.w / 2) * l, h.z + c * (h.d / 2) * a - s * (h.w / 2) * l]);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, z] of corners) {
      if (this.roadCells.has(`${Math.floor(x / 8)},${Math.floor(z / 8)}`)) return false;
      const y = this.heightAt(x, z);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (hi - lo > 4) return false;
    h.y = lo;
    // Other houses (20 m cells).
    const r = Math.max(h.w, h.d) / 2 + 3;
    for (let ix = Math.floor((h.x - r) / 20); ix <= Math.floor((h.x + r) / 20); ix++) {
      for (let iz = Math.floor((h.z - r) / 20); iz <= Math.floor((h.z + r) / 20); iz++) {
        if (this.houseCells.has(`${ix},${iz}`)) return false;
      }
    }
    return true;
  }

  #addHouse(h) {
    this.houses.push(h);
    const r = Math.max(h.w, h.d) / 2;
    for (let ix = Math.floor((h.x - r) / 20); ix <= Math.floor((h.x + r) / 20); ix++) {
      for (let iz = Math.floor((h.z - r) / 20); iz <= Math.floor((h.z + r) / 20); iz++) this.houseCells.add(`${ix},${iz}`);
    }
  }

  // ------------------------------------------------------------ terrain

  #terrain() {
    const Q = this.Q;
    const nearTex = this.#paint(Q.tex, this.cx - NEAR, this.cz - NEAR, NEAR * 2, true);
    const farTex = this.#paint(1024, this.cx - FAR, this.cz - FAR, FAR * 2, false);
    const near = this.#grid(this.cx - NEAR, this.cz - NEAR, NEAR * 2, Q.step, null, 0);
    const far = this.#grid(this.cx - FAR, this.cz - FAR, FAR * 2, 120, NEAR - 130, -1.5);
    const mNear = new THREE.MeshStandardMaterial({ map: nearTex, roughness: 1 });
    const mFar = new THREE.MeshStandardMaterial({ map: farTex, roughness: 1 });
    this.group.add(new THREE.Mesh(near, mNear), new THREE.Mesh(far, mFar));
  }

  // Height grid over a square; `hole` = half size of a centred square left out.
  #grid(x0, z0, size, step, hole, dy) {
    const n = Math.ceil(size / step);
    const pos = [];
    const uv = [];
    const idx = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = x0 + (i / n) * size;
        const z = z0 + (j / n) * size;
        pos.push(x, this.heightAt(x, z) + dy, z);
        uv.push(i / n, 1 - j / n);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (hole) {
          const x = x0 + ((i + 0.5) / n) * size - this.cx;
          const z = z0 + ((j + 0.5) / n) * size - this.cz;
          if (Math.abs(x) < hole && Math.abs(z) < hole) continue;
        }
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Paint the ground texture of a square (fields, meadows, forest, roads, railway, river).
  #paint(size, x0, z0, span, near) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const k = size / span;
    const X = (x) => (x - x0) * k;
    const Z = (z) => (z - z0) * k;
    const rng = mulberry32(near ? 31 : 32);
    // Meadow base with variation.
    g.fillStyle = '#577d3b';
    g.fillRect(0, 0, size, size);
    const cell = near ? 45 : 140;
    for (let z = z0; z < z0 + span; z += cell) {
      for (let x = x0; x < x0 + span; x += cell) {
        const n = fbm(x / 400, z / 400, 2);
        const l = 0.85 + n * 0.3;
        g.fillStyle = `rgb(${Math.round(84 * l)},${Math.round(122 * l)},${Math.round(58 * l)})`;
        g.fillRect(X(x), Z(z), cell * k + 1, cell * k + 1);
      }
    }
    // Fields: strips in farm cells, turned a little each.
    const farm = near ? 230 : 300;
    for (let fz = z0; fz < z0 + span; fz += farm) {
      for (let fx = x0; fx < x0 + span; fx += farm) {
        const cx = fx + farm / 2;
        const cz = fz + farm / 2;
        const d = this.dOut(cx, cz);
        if (d < 140) continue;
        const h = this.heightAt(cx, cz);
        const slope = Math.abs(this.heightAt(cx + 60, cz) - h) + Math.abs(this.heightAt(cx, cz + 60) - h);
        if (h > 170 || slope > 22 || Math.abs(cz - this.riverZ) < 90) continue;
        if (this.houseCells.has(`${Math.floor(cx / 20)},${Math.floor(cz / 20)}`)) continue;
        const ang = (fbm(cx / 3000, cz / 3000, 1) - 0.5) * 1.6 + (rng() - 0.5) * 0.3;
        g.save();
        g.translate(X(cx), Z(cz));
        g.rotate(ang);
        let y = -farm / 2;
        while (y < farm / 2) {
          const w = 25 + rng() * 55;
          g.fillStyle = CROPS[Math.floor(rng() * CROPS.length)];
          g.fillRect((-farm / 2) * k, y * k, farm * k, Math.min(w, farm / 2 - y) * k);
          // Furrows / tramlines.
          if (near) {
            g.fillStyle = 'rgba(0,0,0,0.06)';
            for (let t = 0; t < farm; t += 6) g.fillRect((-farm / 2 + t) * k, y * k, 1, Math.min(w, farm / 2 - y) * k);
          }
          g.fillStyle = 'rgba(40,60,25,0.55)';
          g.fillRect((-farm / 2) * k, y * k, farm * k, Math.max(1, 2 * k));
          y += w;
        }
        g.restore();
      }
    }
    // Forest.
    const fc = near ? 22 : 90;
    for (let z = z0; z < z0 + span; z += fc) {
      for (let x = x0; x < x0 + span; x += fc) {
        if (!this.forestAt(x + fc / 2, z + fc / 2)) continue;
        const n = hash2(Math.floor(x), Math.floor(z));
        g.fillStyle = n < 0.5 ? '#2c4a26' : '#35552c';
        g.fillRect(X(x), Z(z), fc * k + 1, fc * k + 1);
        if (near) {
          for (let t = 0; t < 4; t++) {
            g.fillStyle = rng() < 0.5 ? 'rgba(20,38,18,0.7)' : 'rgba(70,100,50,0.5)';
            g.beginPath();
            g.arc(X(x + rng() * fc), Z(z + rng() * fc), (2.5 + rng() * 3.5) * k, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }
    // Gardens around the houses.
    for (const h of this.houses) {
      if (h.kind === 'hall') {
        g.fillStyle = '#7d7f80';
        g.fillRect(X(h.x - h.w / 2 - 12), Z(h.z - h.d / 2 - 12), (h.w + 24) * k, (h.d + 24) * k);
        continue;
      }
      g.fillStyle = hash2(Math.floor(h.x), Math.floor(h.z)) < 0.5 ? '#628a44' : '#6b9148';
      const r = Math.max(h.w, h.d) * 0.9 + 6;
      g.fillRect(X(h.x - r), Z(h.z - r), r * 2 * k, r * 2 * k);
    }
    // Railway (ballast) on the whole width.
    g.fillStyle = '#6f675d';
    g.fillRect(0, Z(this.trackZ - 7), size, 14 * k);
    // Roads.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const r of this.roads) {
      g.strokeStyle = r.kind === 'main' ? '#5c6064' : r.kind === 'country' ? '#6d6e6c' : '#686b6e';
      g.lineWidth = Math.max(1, r.width * k);
      g.beginPath();
      r.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
      g.stroke();
      if (near && r.kind === 'main') {
        g.strokeStyle = 'rgba(235,235,225,0.55)';
        g.lineWidth = Math.max(1, 0.15 * k);
        g.setLineDash([3 * k, 6 * k]);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // River with sandy banks.
    g.fillStyle = '#8f9a6a';
    g.fillRect(0, Z(this.E.riverZ0 - 6), size, (this.E.riverZ1 - this.E.riverZ0 + 12) * k);
    g.fillStyle = '#35596a';
    g.fillRect(0, Z(this.E.riverZ0), size, (this.E.riverZ1 - this.E.riverZ0) * k);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }

  #water() {
    const n = waterNormalTexture();
    n.repeat.set(400, 3);
    const mat = new THREE.MeshStandardMaterial({ color: '#2d4f5e', roughness: 0.1, metalness: 0.3, normalMap: n, normalScale: new THREE.Vector2(0.3, 0.3) });
    this.waterMaterial = mat;
    const g = new THREE.PlaneGeometry(FAR * 2, this.E.riverZ1 - this.E.riverZ0 + 8);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(this.cx, -0.6, this.riverZ);
    this.group.add(m);
  }

  // ------------------------------------------------------------ houses (instanced)

  #buildings() {
    const house = facadeTexture(4, 2, false);
    const houseN = facadeTexture(4, 2, true);
    const block = facadeTexture(5, 4, false, true);
    const blockN = facadeTexture(5, 4, true, true);
    const hallT = hallTexture();
    const mk = (map, emi) => {
      const m = new THREE.MeshStandardMaterial({ map, emissiveMap: emi, emissive: new THREE.Color('#ffd49a'), emissiveIntensity: 0, roughness: 0.85 });
      if (emi) this.nightMats.push(m);
      return m;
    };
    const roofMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 });
    const groups = { house: [], block: [], hall: [] };
    for (const h of this.houses) groups[h.kind].push(h);
    const geo = {
      house: houseGeometry(1),
      block: boxGeometry(1.6, 1.25),
      hall: boxGeometry(1, 1),
    };
    const roofGeo = { house: gableRoofGeometry(), block: slabGeometry(), hall: slabGeometry() };
    const mats = { house: mk(house, houseN), block: mk(block, blockN), hall: mk(hallT, null) };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const kind of Object.keys(groups)) {
      const list = groups[kind];
      if (!list.length) continue;
      const body = new THREE.InstancedMesh(geo[kind], mats[kind], list.length);
      const roof = new THREE.InstancedMesh(roofGeo[kind], roofMat, list.length);
      list.forEach((h, i) => {
        // Standing on the lowest corner: on a slope the uphill side is dug in, never floating.
        q.setFromAxisAngle(up, h.yaw);
        m4.compose(new THREE.Vector3(h.x, h.y, h.z), q, new THREE.Vector3(h.w, h.h, h.d));
        body.setMatrixAt(i, m4);
        roof.setMatrixAt(i, m4);
        body.setColorAt(i, col.set(h.wall));
        roof.setColorAt(i, col.set(h.roof));
      });
      body.computeBoundingSphere();
      roof.computeBoundingSphere();
      this.group.add(body, roof);
    }
  }

  // ------------------------------------------------------------ trees (instanced)

  #trees() {
    const rng = mulberry32(99);
    const list = [];
    const max = this.Q.trees;
    // Forest near town (the detailed zone): trees on forest ground.
    let guard = 0;
    while (list.length < max * 0.72 && guard++ < max * 12) {
      const x = this.cx + (rng() * 2 - 1) * NEAR * 0.95;
      const z = this.cz + (rng() * 2 - 1) * NEAR * 0.95;
      if (!this.forestAt(x, z)) continue;
      list.push({ x, z, h: 13 + rng() * 11, conifer: rng() < 0.55 });
    }
    // Garden trees and avenues along the country roads.
    for (const h of this.houses) {
      if (h.kind === 'hall' || rng() < 0.55 || list.length >= max) continue;
      const a = h.yaw + Math.PI + (rng() - 0.5) * 1.5;
      const d = h.d / 2 + 5 + rng() * 5;
      const x = h.x + Math.sin(a) * d;
      const z = h.z + Math.cos(a) * d;
      if (this.roadCells.has(`${Math.floor(x / 8)},${Math.floor(z / 8)}`)) continue;
      list.push({ x, z, h: 7 + rng() * 6, conifer: rng() < 0.3 });
    }
    for (const r of this.roads) {
      if (r.kind !== 'country' && r.kind !== 'main') continue;
      for (let s = 30; list.length < max; s += 22 + rng() * 18) {
        const p = alongPolyline(r.pts, s);
        if (!p) break;
        if (this.dOut(p.x, p.z) < 900 || Math.hypot(p.x - this.cx, p.z - this.cz) > NEAR) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const x = p.x - p.dz * side * (r.width / 2 + 3);
        const z = p.z + p.dx * side * (r.width / 2 + 3);
        if (!this.houseCells.has(`${Math.floor(x / 20)},${Math.floor(z / 20)}`)) list.push({ x, z, h: 9 + rng() * 6, conifer: false });
      }
    }
    // The castle hill is wooded.
    for (let i = 0; i < 260 && list.length < max * 1.05; i++) {
      const a = rng() * Math.PI * 2;
      const d = 60 + Math.sqrt(rng()) * 380;
      list.push({ x: this.castle.x + Math.cos(a) * d, z: this.castle.z + Math.sin(a) * d, h: 12 + rng() * 9, conifer: rng() < 0.4 });
    }
    const con = list.filter((t) => t.conifer);
    const brd = list.filter((t) => !t.conifer);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const [arr, geo, widthF] of [
      [con, coniferGeometry(), 0.42],
      [brd, broadleafGeometry(), 0.78],
    ]) {
      if (!arr.length) continue;
      const mesh = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach((t, i) => {
        const y = this.heightAt(t.x, t.z) - 0.5;
        const w = t.h * widthF * (0.85 + hash2(Math.floor(t.x * 3), Math.floor(t.z * 3)) * 0.3);
        q.setFromAxisAngle(up, hash2(Math.floor(t.x), Math.floor(t.z)) * 6.28);
        m4.compose(new THREE.Vector3(t.x, y, t.z), q, new THREE.Vector3(w, t.h, w));
        mesh.setMatrixAt(i, m4);
        const v = 0.8 + hash2(Math.floor(t.z * 7), Math.floor(t.x * 5)) * 0.35;
        mesh.setColorAt(i, col.setRGB(v, v * (0.95 + 0.1 * hash2(i, 3)), v * 0.9));
      });
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.treeCount = list.length;
  }

  // ------------------------------------------------------------ castle, churches, TV tower, wind turbines

  #landmarks() {
    const B = new Builder();
    const Y = (x, z) => this.heightAt(x, z);
    // Castle on its hill: curtain wall, round keep, great hall.
    {
      const { x, z } = this.castle;
      const y = Y(x, z) - 3;
      const stone = '#b8ae9b';
      const w = 74;
      const d = 46;
      for (const [px, pz, sw, sd] of [
        [0, -d / 2, w, 2.4],
        [0, d / 2, w, 2.4],
        [-w / 2, 0, 2.4, d],
        [w / 2, 0, 2.4, d],
      ]) B.box(x + px, y + 6.5, z + pz, sw, 13, sd, stone);
      // Battlements.
      for (let t = -w / 2; t <= w / 2; t += 3.2) {
        B.box(x + t, y + 13.8, z - d / 2, 1.6, 1.6, 2.6, stone);
        B.box(x + t, y + 13.8, z + d / 2, 1.6, 1.6, 2.6, stone);
      }
      B.cylinder(x - w / 2 + 6, y, z - d / 2 + 6, 7, 7, 34, 14, stone);
      B.cylinder(x - w / 2 + 6, y + 34, z - d / 2 + 6, 7.6, 7.6, 2.2, 14, '#a9a08c');
      B.cone(x - w / 2 + 6, y + 36.2, z - d / 2 + 6, 8, 11, 14, '#5d4a44');
      B.box(x + 12, y + 10, z + 6, 30, 20, 14, '#cfc5b0');
      B.gable(x + 12, y + 20, z + 6, 31, 9, 15, '#8a3b2b');
      for (const [tx, tz] of [
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ]) B.cylinder(x + tx, y, z + tz, 3.6, 3.6, 18, 10, stone);
    }
    // Village churches.
    for (const v of this.villages) {
      const y = Y(v.x, v.z) - 1;
      const s = Math.sin(v.yaw);
      const c = Math.cos(v.yaw);
      const P = (lx, lz) => [v.x + lx * c + lz * s, v.z - lx * s + lz * c];
      const [nx, nz] = P(0, 0);
      B.box(nx, y + 6, nz, 11, 12, 24, '#efe8da', v.yaw + Math.PI / 2);
      B.gable(nx, y + 12, nz, 24.5, 7, 12, '#8e3a2a', v.yaw);
      const [tx, tz] = P(-14.5, 0);
      B.box(tx, y + 14, tz, 6, 28, 6, '#f1ebdf', v.yaw);
      B.cone(tx, y + 28, tz, 4.6, 14, 4, '#3f5a50', v.yaw + Math.PI / 4);
    }
    // TV tower on its hill.
    {
      const { x, z } = this.tvTower;
      const y = Y(x, z) - 2;
      B.cylinder(x, y, z, 5, 2.6, 150, 12, '#cfd0cc');
      B.cylinder(x, y + 112, z, 11, 11, 11, 16, '#d8d9d6');
      B.cylinder(x, y + 123, z, 8, 3, 4, 16, '#bdbfbc');
      for (let k = 0; k < 6; k++) B.cylinder(x, y + 150 + k * 7, z, 1.2 - k * 0.12, 1.1 - k * 0.12, 7, 8, k % 2 ? '#f1f1ee' : '#c0392b');
      this.lights = [[x, y + 193, z]];
    }
    // Wind turbines on the eastern ridge.
    this.turbines = [];
    for (let i = 0; i < 8; i++) {
      const a = -0.25 + i * 0.075;
      const r = 4300 + (i % 2) * 280;
      const x = this.cx + Math.cos(a) * r;
      const z = this.cz + Math.sin(a) * r;
      const y = Y(x, z) - 2;
      const hub = 105;
      B.cylinder(x, y, z, 2.4, 1.5, hub, 10, '#eef0ef');
      B.box(x, y + hub + 1.6, z + 2, 3.6, 3.4, 10, '#e8eae9');
      this.turbines.push({ x, y: y + hub + 1.6, z: z + 7.2, phase: i * 1.7 });
      this.lights.push([x, y + hub + 3.6, z + 2]);
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    this.group.add(new THREE.Mesh(B.build(), mat));
    // Rotors (turning).
    const rotor = new Builder();
    rotor.box(0, 0, 0, 2.6, 2.6, 2.4, '#e5e7e6');
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      rotor.blade(a, '#f2f3f2');
    }
    this.rotors = new THREE.InstancedMesh(rotor.build(), mat, this.turbines.length);
    this.rotors.frustumCulled = false;
    this.group.add(this.rotors);
    this.#spinRotors(0);
    // Aviation lights (red, blinking at night).
    const lg = new THREE.SphereGeometry(1.2, 6, 4);
    this.lightMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a', fog: false });
    this.lightMesh = new THREE.InstancedMesh(lg, this.lightMat, this.lights.length);
    const m4 = new THREE.Matrix4();
    this.lights.forEach(([x, y, z], i) => this.lightMesh.setMatrixAt(i, m4.makeTranslation(x, y, z)));
    this.lightMesh.visible = false;
    this.group.add(this.lightMesh);
  }

  #spinRotors(t) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    this.turbines.forEach((tb, i) => {
      e.set(0, 0, t * 1.15 + tb.phase);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(tb.x, tb.y, tb.z), q, one);
      this.rotors.setMatrixAt(i, m4);
    });
    this.rotors.instanceMatrix.needsUpdate = true;
  }

  setNight(f) {
    for (const m of this.nightMats) m.emissiveIntensity = f > 0.2 ? Math.pow(f, 1.3) * 1.2 : 0;
    this.night = f;
  }

  update(dt, t) {
    this.#spinRotors(t);
    if (this.waterMaterial) this.waterMaterial.normalMap.offset.x = (t * 0.003) % 1;
    this.lightMesh.visible = (this.night || 0) > 0.3 && t % 1.5 < 0.9;
  }
}

// ---------------------------------------------------------------- helpers

// Point and direction at arc length s along a polyline ([[x, z], ...]); null past the end.
function alongPolyline(pts, s) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (acc + len >= s) {
      const t = (s - acc) / len;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len };
    }
    acc += len;
  }
  return null;
}

// Windows on a plain wall (tinted by the instance colour); `lit` = night emissive map.
function facadeTexture(cols, rows, lit, flat = false) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const rng = mulberry32(cols * 13 + rows * 7 + (lit ? 1 : 0));
  g.fillStyle = lit ? '#000' : '#ffffff';
  g.fillRect(0, 0, S, S);
  const cw = S / cols;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.28;
      const y = r * rh + rh * (flat ? 0.3 : 0.26);
      const w = cw * 0.44;
      const h = rh * (flat ? 0.42 : 0.5);
      if (lit) {
        if (rng() < 0.35) {
          g.fillStyle = rng() < 0.7 ? '#ffd28a' : '#cfe0ff';
          g.fillRect(x, y, w, h);
        }
        continue;
      }
      g.fillStyle = '#d8d4cc';
      g.fillRect(x - 3, y - 3, w + 6, h + 6);
      g.fillStyle = '#2b3440';
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(160,190,215,0.35)';
      g.fillRect(x, y, w, h * 0.35);
      g.fillStyle = '#b7b2aa';
      g.fillRect(x - 4, y + h + 2, w + 8, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function hallTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 4) {
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(x, 0, 2, 128);
  }
  g.fillStyle = '#39424c';
  g.fillRect(0, 12, 128, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Unit box (x, z in -0.5..0.5, y in 0..1) with facade UVs: u repeats `uRep` times along the
// long walls, v repeats `vRep` times up the wall.
function boxGeometry(uRep, vRep) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const uv = g.attributes.uv;
  const nor = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ny = nor.getY(i);
    const nx = Math.abs(nor.getX(i));
    if (Math.abs(ny) > 0.5) {
      uv.setXY(i, 0.02, 0.02); // roof / floor: plain wall colour (covered anyway)
      continue;
    }
    const u = uv.getX(i) * (nx > 0.5 ? uRep * 0.5 : uRep);
    uv.setXY(i, u, uv.getY(i) * vRep);
  }
  return g;
}

// House body: walls plus the two gable triangles on top (ridge along x, height 0.6 of the
// wall height), so one instance matrix fits body and roof.
function houseGeometry(uRep) {
  const box = boxGeometry(uRep, 1);
  const pos = [];
  const nor = [];
  const uv = [];
  for (const sx of [-0.5, 0.5]) {
    const tri = sx < 0 ? [[sx, 1, -0.5], [sx, 1, 0.5], [sx, 1.6, 0]] : [[sx, 1, 0.5], [sx, 1, -0.5], [sx, 1.6, 0]];
    for (const p of tri) {
      pos.push(...p);
      nor.push(Math.sign(sx), 0, 0);
      uv.push(0.3 + p[2] * 0.5, 1 + (p[1] - 1) * 0.9);
    }
  }
  const g = box.index ? box.toNonIndexed() : box;
  const out = new THREE.BufferGeometry();
  const cat = (a, b) => {
    const r = new Float32Array(a.length + b.length);
    r.set(a);
    r.set(b, a.length);
    return r;
  };
  out.setAttribute('position', new THREE.BufferAttribute(cat(g.attributes.position.array, pos), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(cat(g.attributes.normal.array, nor), 3));
  out.setAttribute('uv', new THREE.BufferAttribute(cat(g.attributes.uv.array, uv), 2));
  return out;
}

// Gable roof over the unit body (eaves at y = 1, ridge at 1.6, a little overhang).
function gableRoofGeometry() {
  const o = 0.06;
  const ox = 0.04;
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad([-0.5 - ox, 0.97, 0.5 + o], [0.5 + ox, 0.97, 0.5 + o], [0.5 + ox, 1.62, 0], [-0.5 - ox, 1.62, 0]);
  quad([0.5 + ox, 0.97, -0.5 - o], [-0.5 - ox, 0.97, -0.5 - o], [-0.5 - ox, 1.62, 0], [0.5 + ox, 1.62, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function slabGeometry() {
  const g = new THREE.BoxGeometry(1.02, 0.03, 1.02);
  g.translate(0, 1.015, 0);
  return g;
}

function coniferGeometry() {
  const b = new Builder();
  b.cylinder(0, 0, 0, 0.03, 0.03, 0.2, 4, '#4a3524', true);
  b.cone(0, 0.12, 0, 0.5, 0.88, 7, '#2f5a2f', 0, true);
  return b.build();
}

function broadleafGeometry() {
  const b = new Builder();
  b.cylinder(0, 0, 0, 0.035, 0.035, 0.4, 4, '#4d3a28', true);
  b.blob(0, 0.62, 0, 0.5, 0.4, '#4f7d35');
  return b.build();
}

// Tiny vertex-coloured geometry builder for the landscape pieces.
class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }

  #push(p, n, c) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c.r, c.g, c.b);
  }

  #geo(g, x, y, z, color, yaw = 0) {
    if (yaw) g.rotateY(yaw);
    g.translate(x, y, z);
    const ng = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(color);
    const p = ng.attributes.position;
    const n = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) this.#push([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], c);
  }

  box(x, y, z, w, h, d, color, yaw = 0) {
    this.#geo(new THREE.BoxGeometry(w, h, d), x, y, z, color, yaw);
  }

  // Cylinder standing on (x, y, z).
  cylinder(x, y, z, r0, r1, h, seg, color, open = false) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, open);
    this.#geo(g, x, y + h / 2, z, color);
  }

  cone(x, y, z, r, h, seg, color, yaw = 0, open = false) {
    const g = new THREE.ConeGeometry(r, h, seg, 1, open);
    this.#geo(g, x, y + h / 2, z, color, yaw);
  }

  // Gable roof (ridge along the local x axis) sitting at height y.
  gable(x, y, z, len, h, depth, color, yaw = 0) {
    const s = new THREE.Shape([new THREE.Vector2(-depth / 2, 0), new THREE.Vector2(depth / 2, 0), new THREE.Vector2(0, h)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    this.#geo(g, x, y, z, color, yaw);
  }

  // Rounded crown with smooth normals.
  blob(x, y, z, r, hr, color) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * r, p.getY(i) * hr, p.getZ(i) * r);
    const ng = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(color);
    const pp = ng.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const nx = pp.getX(i) / r;
      const ny = pp.getY(i) / hr;
      const nz = pp.getZ(i) / r;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.#push([pp.getX(i) + x, pp.getY(i) + y, pp.getZ(i) + z], [nx / l, ny / l, nz / l], c);
    }
  }

  // One rotor blade in the x-y plane, angle a around z.
  blade(a, color) {
    const L = 52;
    const g = new THREE.BoxGeometry(2.4, L, 0.5);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + L / 2) / L; // 0 root .. 1 tip
      p.setX(i, p.getX(i) * (1 - t * 0.75));
    }
    g.translate(0, L / 2 + 1, 0);
    g.rotateZ(a);
    g.computeVertexNormals();
    this.#geo(g, 0, 0, 0, color);
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
