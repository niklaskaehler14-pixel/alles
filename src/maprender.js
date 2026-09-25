// Map drawing shared by the minimap and the full-screen world map: a stylised terrain raster
// (hillshade, water, forest, city, plaza) plus vector roads, route lines and activity icons.
import { WORLD, CITY, FESTIVAL, ROAD } from './config.js';
import { clamp, smoothstep } from './util.js';

export const ICON_COLORS = {
  run: '#3fd0ff',
  drift: '#ff4fd8',
  trap: '#f2a541',
  jump: '#7dff7a',
  zone: '#ffd24a',
  landmark: '#e6eef3',
  festival: '#ff3fa4',
  board: '#ff8a1f',
  waypoint: '#b98cff',
};

// Terrain raster of the whole world (north up: -z at the top). `size` pixels square.
export function renderTerrainRaster(data, size = 2048) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const hf = data.heightfield;
  const half = WORLD.half;
  const mpp = WORLD.size / size; // metres per pixel
  // Forest density on a coarse grid, blurred.
  const FG = 256;
  const forest = new Float32Array(FG * FG);
  for (const t of data.trees) {
    const gx = Math.floor(((t.x + half) / WORLD.size) * FG);
    const gz = Math.floor(((t.z + half) / WORLD.size) * FG);
    if (gx >= 0 && gz >= 0 && gx < FG && gz < FG) forest[gx + gz * FG] += t.type === 2 ? 0 : 1;
  }
  const blur = new Float32Array(FG * FG);
  for (let z = 0; z < FG; z++) {
    for (let x = 0; x < FG; x++) {
      let s = 0;
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= FG || zz >= FG) continue;
          s += forest[xx + zz * FG] * (dx === 0 && dz === 0 ? 2 : 1);
          n += dx === 0 && dz === 0 ? 2 : 1;
        }
      }
      blur[x + z * FG] = s / n;
    }
  }
  const forestAt = (x, z) => {
    const fx = clamp(((x + half) / WORLD.size) * FG - 0.5, 0, FG - 1.001);
    const fz = clamp(((z + half) / WORLD.size) * FG - 0.5, 0, FG - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = blur[ix + iz * FG] * (1 - tx) + blur[ix + 1 + iz * FG] * tx;
    const b = blur[ix + (iz + 1) * FG] * (1 - tx) + blur[ix + 1 + (iz + 1) * FG] * tx;
    return a * (1 - tz) + b * tz;
  };
  // Light from the north-west, like classic relief maps.
  const L = [-0.55, 0.72, -0.42];
  const ll = Math.hypot(...L);
  const lx = L[0] / ll;
  const ly = L[1] / ll;
  const lz = L[2] / ll;
  const e = Math.max(2, mpp * 1.2);
  const d = img.data;
  for (let py = 0; py < size; py++) {
    const z = -half + (py + 0.5) * mpp;
    for (let px = 0; px < size; px++) {
      const x = -half + (px + 0.5) * mpp;
      const h = hf.get(x, z);
      const hx = hf.get(x + e, z) - hf.get(x - e, z);
      const hz = hf.get(x, z + e) - hf.get(x, z - e);
      let nx = -hx / (2 * e);
      let ny = 1;
      let nz = -hz / (2 * e);
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const lambert = nx * lx + ny * ly + nz * lz;
      const shade = clamp(0.35 + lambert * 0.95, 0.45, 1.25);
      let r;
      let g;
      let b;
      if (h < WORLD.waterLevel) {
        const depth = clamp(-h / 22, 0, 1);
        r = 52 - depth * 30;
        g = 110 - depth * 50;
        b = 142 - depth * 50;
        // Bright shoreline band
        const shore = smoothstep(-1.6, 0, h);
        r += shore * 60;
        g += shore * 70;
        b += shore * 55;
      } else {
        const slope = 1 - ny;
        const t = smoothstep(20, 230, h);
        // Meadow -> upland -> rock -> snow
        r = 104 + t * 40;
        g = 136 + t * 10;
        b = 78 + t * 30;
        const f = clamp(forestAt(x, z) / 2.2, 0, 1);
        r += (58 - r) * f * 0.75;
        g += (92 - g) * f * 0.75;
        b += (56 - b) * f * 0.75;
        const rock = smoothstep(0.2, 0.42, slope) + smoothstep(260, 360, h) * 0.6;
        r += (132 - r) * clamp(rock, 0, 1);
        g += (126 - g) * clamp(rock, 0, 1);
        b += (118 - b) * clamp(rock, 0, 1);
        const snow = smoothstep(380, 440, h) * smoothstep(0.45, 0.2, slope);
        r += (236 - r) * snow;
        g += (240 - g) * snow;
        b += (244 - b) * snow;
        const beach = smoothstep(2.6, 0.8, h);
        r += (196 - r) * beach;
        g += (184 - g) * beach;
        b += (140 - b) * beach;
        r *= shade;
        g *= shade;
        b *= shade;
        // Faint contour every 25 m
        const c0 = Math.floor(h / 25);
        if (c0 !== Math.floor(hf.get(x + mpp, z) / 25) || c0 !== Math.floor(hf.get(x, z + mpp) / 25)) {
          r *= 0.9;
          g *= 0.9;
          b *= 0.9;
        }
      }
      const dc = Math.hypot(x - CITY.x, z - CITY.z);
      if (dc < CITY.radius + 6) {
        const k = smoothstep(CITY.radius + 6, CITY.radius - 4, dc);
        r += (126 - r) * k;
        g += (128 - g) * k;
        b += (134 - b) * k;
        // Street grid
        const gx = (((x - CITY.x) % CITY.grid) + CITY.grid) % CITY.grid;
        const gz = (((z - CITY.z) % CITY.grid) + CITY.grid) % CITY.grid;
        const street = Math.min(gx, CITY.grid - gx) < CITY.street / 2 || Math.min(gz, CITY.grid - gz) < CITY.street / 2;
        if (street && k > 0.5) {
          r = 168;
          g = 170;
          b = 176;
        }
      }
      const df = Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z);
      if (df < FESTIVAL.radius) {
        r = 84;
        g = 86;
        b = 94;
        if (df > FESTIVAL.radius - 3) {
          r = 255;
          g = 63;
          b = 164;
        }
      }
      const i = (px + py * size) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Buildings with a light roof and a dark outline.
  const s = size / WORLD.size;
  const toPx = (v) => (v + half) * s;
  for (const bld of data.buildings) {
    const x = toPx(bld.x - bld.w / 2);
    const y = toPx(bld.z - bld.d / 2);
    const w = bld.w * s;
    const h = bld.d * s;
    ctx.fillStyle = 'rgba(20,24,30,0.45)';
    ctx.fillRect(x + 2, y + 2, w, h);
    ctx.fillStyle = bld.h > 40 ? '#dfe3e8' : '#c9cdd3';
    ctx.fillRect(x, y, w, h);
  }
  return c;
}

// Road polylines (every other sample) for fast vector drawing, split into chunks with bounding
// boxes so views that show only part of the world can skip the rest.
export function roadPolylines(data) {
  const out = [];
  const add = (road, kind) => {
    const n = road.count;
    const step = 2;
    const pts = [];
    for (let i = 0; i < n; i += step) pts.push(road.x[i], road.z[i], i * road.spacing);
    if (road.closed) pts.push(road.x[0], road.z[0], road.length);
    else if ((n - 1) % step) pts.push(road.x[n - 1], road.z[n - 1], road.length);
    const all = Float32Array.from(pts);
    const chunks = [];
    const per = 48;
    for (let k = 0; k < all.length / 3 - 1; k += per) {
      const end = Math.min(all.length / 3, k + per + 1);
      const c = all.subarray(k * 3, end * 3);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < c.length; i += 3) {
        minX = Math.min(minX, c[i]);
        maxX = Math.max(maxX, c[i]);
        minZ = Math.min(minZ, c[i + 1]);
        maxZ = Math.max(maxZ, c[i + 1]);
      }
      chunks.push({ pts: c, minX, maxX, minZ, maxZ });
    }
    out.push({ road, kind, pts: all, chunks, width: kind === 'circuit' ? ROAD.width : road.width, index: out.length });
  };
  add(data.track, 'circuit');
  for (const b of data.branches || []) add(b, b.type);
  const trails = [];
  for (const c of data.clearCorridors || []) if (c.trail) trails.push(c);
  return { roads: out, trails };
}

// Draws every road into `ctx`. `tf` maps world (x, z) to screen: { a, b, c, d, e, f } like setTransform
// (sx = a x + c z + e, sy = b x + d z + f); `ppm` is screen pixels per metre. `bounds` (world
// { minX, maxX, minZ, maxZ }) skips chunks outside the view.
export function drawRoads(ctx, polylines, tf, ppm, { discovery = null, dpr = 1, simple = false, bounds = null } = {}) {
  const px = (x, z) => tf.a * x + tf.c * z + tf.e;
  const py = (x, z) => tf.b * x + tf.d * z + tf.f;
  const visible = (c) => !bounds || !(c.maxX < bounds.minX || c.minX > bounds.maxX || c.maxZ < bounds.minZ || c.minZ > bounds.maxZ);
  const trace = (pts) => {
    for (let i = 0; i < pts.length; i += 3) {
      const x = px(pts[i], pts[i + 1]);
      const y = py(pts[i], pts[i + 1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Dirt trails of the off-road runs
  ctx.setLineDash([6 * dpr, 5 * dpr]);
  ctx.strokeStyle = 'rgba(214,190,140,0.85)';
  ctx.lineWidth = Math.max(1.5 * dpr, 4 * ppm);
  ctx.beginPath();
  for (const t of polylines.trails) {
    ctx.moveTo(px(t.ax, t.az), py(t.ax, t.az));
    ctx.lineTo(px(t.bx, t.bz), py(t.bx, t.bz));
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // Casing first for all roads, then the fill, so junctions merge cleanly.
  for (const pass of ['casing', 'fill']) {
    for (const r of polylines.roads) {
      const gravel = r.kind === 'gravel';
      const w = Math.max(simple ? 2.2 * dpr : 1.6 * dpr, r.width * ppm) * (r.kind === 'circuit' ? 1 : 0.92);
      const known = gravel ? '#d8c197' : r.kind === 'circuit' ? '#f6f3ec' : '#ecebe6';
      if (pass === 'casing' || !discovery) {
        ctx.strokeStyle = pass === 'casing' ? 'rgba(12,15,20,0.9)' : known;
        ctx.lineWidth = pass === 'casing' ? w + Math.max(2 * dpr, 4 * ppm) : w;
        ctx.beginPath();
        for (const c of r.chunks) if (visible(c)) trace(c.pts);
        ctx.stroke();
        continue;
      }
      // Discovered stretches bright, the rest grey.
      for (const c of r.chunks) {
        if (!visible(c)) continue;
        const pts = c.pts;
        let cur = null;
        for (let i = 0; i < pts.length; i += 3) {
          const k = discovery.isKnown(r.index, pts[i + 2]);
          const x = px(pts[i], pts[i + 1]);
          const y = py(pts[i], pts[i + 1]);
          if (k !== cur) {
            if (cur !== null) {
              ctx.lineTo(x, y);
              ctx.stroke();
            }
            cur = k;
            ctx.strokeStyle = k ? known : 'rgba(150,158,166,0.75)';
            ctx.lineWidth = k ? w : w * 0.8;
            ctx.beginPath();
            ctx.moveTo(x, y);
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  // Centre lines on the touge when zoomed in.
  if (ppm > 0.9 && !simple) {
    ctx.strokeStyle = 'rgba(242,194,48,0.9)';
    ctx.lineWidth = Math.max(1, 0.3 * ppm);
    for (const r of polylines.roads) {
      if (r.kind !== 'touge') continue;
      ctx.beginPath();
      for (const c of r.chunks) if (visible(c)) trace(c.pts);
      ctx.stroke();
    }
  }
}

// GPS route: bright line with a dark casing.
export function drawRoute(ctx, points, tf, width, color = ICON_COLORS.waypoint) {
  if (!points || points.length < 2) return;
  const P = (x, z) => [tf.a * x + tf.c * z + tf.e, tf.b * x + tf.d * z + tf.f];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [col, w] of [
    ['rgba(20,10,40,0.85)', width + 3],
    [color, width],
  ]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    points.forEach(([x, z], i) => {
      const p = P(x, z);
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    });
    ctx.stroke();
  }
}

// Pictograms drawn with paths (no font needed), centred at 0,0 in a box of size 1.
function glyph(ctx, kind, s) {
  ctx.save();
  ctx.scale(s, s);
  ctx.lineWidth = 0.1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = '#0b0e12';
  ctx.strokeStyle = '#0b0e12';
  switch (kind) {
    case 'run': {
      // Chequered flag
      ctx.beginPath();
      ctx.moveTo(-0.28, 0.36);
      ctx.lineTo(-0.28, -0.34);
      ctx.stroke();
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if ((r + c) % 2 === 0) ctx.fillRect(-0.24 + c * 0.17, -0.34 + r * 0.14, 0.17, 0.14);
      ctx.strokeRect(-0.24, -0.34, 0.51, 0.42);
      break;
    }
    case 'drift': {
      ctx.lineWidth = 0.11;
      ctx.beginPath();
      ctx.moveTo(-0.32, 0.26);
      ctx.bezierCurveTo(-0.1, 0.3, 0.3, 0.12, 0.1, -0.06);
      ctx.bezierCurveTo(-0.08, -0.22, 0.12, -0.34, 0.32, -0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.3, -0.3, 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'trap': {
      ctx.beginPath();
      ctx.roundRect(-0.32, -0.2, 0.64, 0.42, 0.06);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0.02, 0.01, 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0e12';
      ctx.fillRect(-0.12, -0.3, 0.2, 0.1);
      break;
    }
    case 'jump': {
      ctx.beginPath();
      ctx.moveTo(-0.36, 0.3);
      ctx.lineTo(0.08, 0.3);
      ctx.lineTo(0.08, 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 0.08;
      ctx.setLineDash([0.08, 0.07]);
      ctx.beginPath();
      ctx.moveTo(0.1, 0.0);
      ctx.quadraticCurveTo(0.26, -0.36, 0.38, 0.24);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'zone': {
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.arc(0, 0.12, 0.32, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0.12);
      ctx.lineTo(0.2, -0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0.12, 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'landmark': {
      ctx.beginPath();
      ctx.moveTo(0, -0.36);
      ctx.lineTo(0.3, 0);
      ctx.lineTo(0, 0.36);
      ctx.lineTo(-0.3, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'festival': {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 0.17 : 0.38;
        const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r + 0.02);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'board': {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 0.14 : 0.32;
        const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r + 0.02);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// Map icon: coloured badge with a pictogram. `m` = { kind, color, stars, done, locked }.
export function drawIcon(ctx, x, y, m, size, { stars = false, selected = false, hover = false } = {}) {
  const r = size / 2;
  ctx.save();
  ctx.translate(x, y);
  if (selected || hover) {
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, r + size * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(8,10,14,0.85)';
  if (m.kind === 'board') {
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-r * 0.86 - 1.5, -r * 0.86 - 1.5, r * 1.72 + 3, r * 1.72 + 3);
    ctx.fillStyle = m.color;
    ctx.fillRect(-r * 0.86, -r * 0.86, r * 1.72, r * 1.72);
    ctx.rotate(-Math.PI / 4);
  } else if (m.kind === 'landmark' || m.kind === 'festival') {
    // Hexagon badge
    const hex = (rr) => {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k / 6) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
    };
    hex(r + 2);
    ctx.fill();
    if (m.kind === 'festival') {
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, '#ff3fa4');
      g.addColorStop(1, '#f2a541');
      ctx.fillStyle = g;
    } else ctx.fillStyle = m.locked ? '#6d7780' : m.color;
    hex(r);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    if (m.done) {
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = Math.max(1.5, size * 0.09);
      ctx.beginPath();
      ctx.arc(0, 0, r - size * 0.05, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  glyph(ctx, m.kind, size * (m.kind === 'board' ? 0.8 : 1));
  if (stars && m.stars !== undefined) {
    const sr = size * 0.16;
    for (let k = 0; k < 3; k++) {
      const sx = (k - 1) * sr * 2.3;
      const sy = r + sr * 1.8;
      ctx.fillStyle = k < m.stars ? '#ffd24a' : 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      for (let j = 0; j < 10; j++) {
        const rr = j % 2 ? sr * 0.45 : sr;
        const a = -Math.PI / 2 + (j / 10) * Math.PI * 2;
        ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

// Player arrow pointing along `angle` (screen radians, 0 = up).
export function drawPlayer(ctx, x, y, angle, size, color = '#f2a541') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0b0e12';
  ctx.lineWidth = Math.max(2, size * 0.14);
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.25);
  ctx.lineTo(size, size);
  ctx.lineTo(0, size * 0.45);
  ctx.lineTo(-size, size);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

// Waypoint pin (teardrop).
export function drawPin(ctx, x, y, size, color = ICON_COLORS.waypoint) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(8,10,14,0.85)';
  ctx.beginPath();
  ctx.arc(0, -size * 1.15, size * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0b0e12';
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-size * 0.2, -size * 0.45, -size * 0.62, -size * 0.7, -size * 0.62, -size * 1.12);
  ctx.arc(0, -size * 1.12, size * 0.62, Math.PI, 0);
  ctx.bezierCurveTo(size * 0.62, -size * 0.7, size * 0.2, -size * 0.45, 0, 0);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, -size * 1.12, size * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
