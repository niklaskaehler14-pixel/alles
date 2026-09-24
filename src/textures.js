// Procedurally painted canvas textures (no image downloads needed).
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function speckle(ctx, w, h, count, colors, rng, size = 1.5) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const s = size * (0.4 + rng());
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
}

// Road ribbon: u = across (gravel | asphalt | gravel), v = 20 m along.
export function roadTexture(aniso) {
  const W = 512;
  const H = 1024;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rng = mulberry32(11);
  const total = 16.2;
  const px = (m) => (m / total) * W;
  const shoulder = px(1.6);
  // Gravel shoulders
  ctx.fillStyle = '#7b7264';
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 26000, ['#8d8474', '#6a6255', '#9a917f', '#5d564b'], rng, 2.2);
  // Asphalt
  ctx.fillStyle = '#3b3d42';
  ctx.fillRect(shoulder, 0, W - 2 * shoulder, H);
  speckle(ctx, W, H, 60000, ['#45474d', '#33353a', '#4c4e54', '#2d2f33', '#56585d'], rng, 1.4);
  // Wheel tracks: slightly darker, polished lanes
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#1e1f22';
  for (const m of [3.6, 5.2, 11.0, 12.6]) ctx.fillRect(px(m) - 10, 0, 20, H);
  ctx.globalAlpha = 1;
  // Cracks / patches
  ctx.strokeStyle = 'rgba(20,20,22,0.35)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 18; i++) {
    let x = shoulder + rng() * (W - 2 * shoulder);
    let y = rng() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rng() - 0.5) * 30;
      y += rng() * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Edge lines (solid) and centre line (dashed, 6 m line / 4 m gap)
  ctx.fillStyle = '#e9e7df';
  const lineW = px(0.18);
  ctx.fillRect(shoulder + px(0.25), 0, lineW, H);
  ctx.fillRect(W - shoulder - px(0.25) - lineW, 0, lineW, H);
  const perM = H / 20;
  for (let d = 0; d < 20; d += 10) ctx.fillRect(W / 2 - lineW / 2, d * perM, lineW, 6 * perM);
  // Worn paint
  ctx.globalCompositeOperation = 'multiply';
  speckle(ctx, W, H, 9000, ['#b8b6ae', '#d0cec6'], rng, 1.2);
  ctx.globalCompositeOperation = 'source-over';
  return finish(c, { aniso });
}

export function detailTexture() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const rng = mulberry32(5);
  // Tileable value noise at several scales
  const grid = (n) => {
    const g = [];
    for (let i = 0; i < n * n; i++) g.push(rng());
    return (x, y) => {
      const fx = (x / S) * n;
      const fy = (y / S) * n;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const at = (i, j) => g[((j % n) + n) % n * n + (((i % n) + n) % n)];
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const n1 = grid(8);
  const n2 = grid(32);
  const n3 = grid(128);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = 0.5 * n1(x, y) + 0.3 * n2(x, y) + 0.2 * n3(x, y);
      const g = Math.round(150 + v * 95 + (rng() - 0.5) * 22);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, { srgb: false });
}

export function curbTexture() {
  const c = canvas(64, 256);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#f2f2ee' : '#c8202a';
    ctx.fillRect(0, i * 64, 64, 64);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, 6, 256);
  return finish(c);
}

export function checkerTexture() {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  const n = 16;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  return finish(c, { repeat: false });
}

export function gridBoxTexture() {
  const c = canvas(128, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 256);
  ctx.strokeStyle = 'rgba(240,240,235,0.9)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(8, 250);
  ctx.lineTo(8, 6);
  ctx.lineTo(120, 6);
  ctx.lineTo(120, 250);
  ctx.stroke();
  return finish(c, { repeat: false });
}

export function bannerTexture(text, sub) {
  const c = canvas(1024, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#1b2230');
  g.addColorStop(1, '#0d1118');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = '#f2a541';
  ctx.fillRect(0, 118, 1024, 10);
  ctx.fillStyle = '#e8eef2';
  ctx.font = '800 64px "Big Shoulders Display", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 52);
  if (sub) {
    ctx.font = '600 26px "Barlow", sans-serif';
    ctx.fillStyle = '#9fb3c2';
    ctx.fillText(sub, 512, 98);
  }
  return finish(c, { repeat: false });
}

const ADS = [
  { bg: '#0f1b2d', fg: '#f2a541', title: 'NORDKAMM GT', sub: 'Rennwochenende · Seeufer-Ring' },
  { bg: '#2a1a12', fg: '#f3e6d0', title: 'BERGKAFFEE', sub: 'frisch geröstet am Nordkamm' },
  { bg: '#e9efe9', fg: '#1d3b2a', title: 'SEEBLICK HOTEL', sub: '★★★★  direkt am Wasser' },
  { bg: '#101010', fg: '#ffd400', title: 'KÜHNE REIFEN', sub: 'Grip für jede Kurve' },
  { bg: '#3b0d2e', fg: '#ffffff', title: 'RADIO NORD 104,7', sub: 'Die Musik zur Strecke' },
  { bg: '#f4f1e6', fg: '#b3261e', title: 'ACHTUNG WILDWECHSEL', sub: 'Fahr vorsichtig im Wald' },
];

export function billboardTexture(i) {
  const ad = ADS[i % ADS.length];
  const c = canvas(1024, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = ad.bg;
  ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = ad.fg;
  ctx.globalAlpha = 0.15;
  for (let k = 0; k < 8; k++) ctx.fillRect(-200 + k * 180, 0, 60, 512);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 118px "Big Shoulders Display", "Arial Narrow", sans-serif';
  ctx.fillText(ad.title, 512, 220, 960);
  ctx.font = '600 46px "Barlow", sans-serif';
  ctx.fillText(ad.sub, 512, 350, 960);
  ctx.strokeStyle = ad.fg;
  ctx.lineWidth = 10;
  ctx.strokeRect(24, 24, 976, 464);
  return finish(c, { repeat: false });
}

// Building facades: 12 m wide x 14 m tall per tile (3 bays x 4 floors).
export function facadeTextures(style, rng = mulberry32(100 + style)) {
  const W = 512;
  const H = 512;
  const base = canvas(W, H);
  const emis = canvas(W, H);
  const b = base.getContext('2d');
  const e = emis.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const bays = 3;
  const floors = 4;
  const bw = W / bays;
  const fh = H / floors;
  if (style === 0) {
    // Glass curtain wall
    b.fillStyle = '#5d6f7d';
    b.fillRect(0, 0, W, H);
    for (let f = 0; f < floors; f++) {
      for (let x = 0; x < bays * 2; x++) {
        const shade = 70 + rng() * 30;
        b.fillStyle = `rgb(${shade * 0.55},${shade * 0.8},${shade})`;
        b.fillRect(x * (bw / 2) + 3, f * fh + 6, bw / 2 - 6, fh - 12);
        if (rng() < 0.22) {
          e.fillStyle = `rgba(255,${200 + rng() * 40},${130 + rng() * 60},${0.35 + rng() * 0.45})`;
          e.fillRect(x * (bw / 2) + 3, f * fh + 6, bw / 2 - 6, fh - 12);
        }
      }
      b.fillStyle = '#39444d';
      b.fillRect(0, f * fh, W, 6);
    }
  } else if (style === 1) {
    // Office: light concrete with ribbon windows
    b.fillStyle = '#b9b4aa';
    b.fillRect(0, 0, W, H);
    speckle(b, W, H, 5000, ['#aca79d', '#c4bfb5'], rng, 2);
    for (let f = 0; f < floors; f++) {
      b.fillStyle = '#2c3a44';
      b.fillRect(0, f * fh + fh * 0.3, W, fh * 0.5);
      b.fillStyle = 'rgba(160,190,210,0.35)';
      b.fillRect(0, f * fh + fh * 0.3, W, fh * 0.12);
      for (let x = 0; x < bays * 3; x++) {
        b.fillStyle = '#9d988e';
        b.fillRect(x * (W / 9), f * fh + fh * 0.3, 5, fh * 0.5);
        if (rng() < 0.3) {
          e.fillStyle = `rgba(255,${215 + rng() * 30},${160 + rng() * 50},${0.45 + rng() * 0.4})`;
          e.fillRect(x * (W / 9) + 5, f * fh + fh * 0.3, W / 9 - 5, fh * 0.5);
        }
      }
    }
  } else {
    // Apartment: warm brick with punched windows
    b.fillStyle = '#8a4b36';
    b.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) {
      for (let x = (y / 8) % 2 ? 0 : 12; x < W; x += 24) {
        b.fillStyle = `rgb(${120 + rng() * 30},${62 + rng() * 18},${45 + rng() * 12})`;
        b.fillRect(x, y, 22, 6);
      }
    }
    for (let f = 0; f < floors; f++) {
      for (let x = 0; x < bays * 2; x++) {
        const wx = x * (bw / 2) + bw * 0.12;
        const wy = f * fh + fh * 0.25;
        b.fillStyle = '#d9d2c3';
        b.fillRect(wx - 4, wy - 4, bw * 0.26 + 8, fh * 0.55 + 8);
        b.fillStyle = '#26323a';
        b.fillRect(wx, wy, bw * 0.26, fh * 0.55);
        b.fillStyle = 'rgba(170,200,220,0.3)';
        b.fillRect(wx, wy, bw * 0.26, fh * 0.12);
        if (rng() < 0.35) {
          e.fillStyle = `rgba(255,${190 + rng() * 40},${110 + rng() * 60},${0.45 + rng() * 0.45})`;
          e.fillRect(wx, wy, bw * 0.26, fh * 0.55);
        }
      }
    }
  }
  return { map: finish(base), emissive: finish(emis) };
}

export function roofTexture() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const rng = mulberry32(77);
  ctx.fillStyle = '#5b5c5e';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 6000, ['#4f5052', '#67686a', '#737476'], rng, 2);
  return finish(c);
}

// City ground: streets, sidewalks and crossings on a square around the city centre.
export function cityGroundTexture(size, grid, street, originX, originZ, radius) {
  const S = 2048;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = mulberry32(31);
  const m = S / size; // pixels per metre
  ctx.fillStyle = '#86827a';
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 40000, ['#7c786f', '#918d84', '#817d76'], rng, 2);
  // Paving pattern
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  for (let p = 0; p < S; p += m * 2) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  const half = size / 2;
  const toPx = (w) => (w + half) * m;
  const lines = [];
  for (let k = -5; k <= 5; k++) lines.push(k * grid);
  ctx.fillStyle = '#34363b';
  for (const l of lines) {
    const p = toPx(l);
    ctx.fillRect(p - (street / 2) * m, 0, street * m, S);
    ctx.fillRect(0, p - (street / 2) * m, S, street * m);
  }
  speckle(ctx, S, S, 30000, ['#3c3e44', '#2e3035'], rng, 1.5);
  // Lane dashes
  ctx.fillStyle = 'rgba(235,233,225,0.85)';
  for (const l of lines) {
    const p = toPx(l);
    for (let d = 0; d < S; d += 10 * m) {
      ctx.fillRect(p - 0.08 * m, d, 0.16 * m, 5 * m);
      ctx.fillRect(d, p - 0.08 * m, 5 * m, 0.16 * m);
    }
  }
  // Intersections: clear dashes, add zebra crossings
  for (const a of lines) {
    for (const b of lines) {
      const px = toPx(a);
      const pz = toPx(b);
      ctx.fillStyle = '#34363b';
      ctx.fillRect(px - (street / 2) * m, pz - (street / 2) * m, street * m, street * m);
      ctx.fillStyle = 'rgba(235,233,225,0.9)';
      for (let k = -3; k <= 3; k++) {
        const off = k * 1.6 * m;
        ctx.fillRect(px + off - 0.4 * m, pz - (street / 2 + 3.5) * m, 0.8 * m, 3 * m);
        ctx.fillRect(px + off - 0.4 * m, pz + (street / 2 + 0.5) * m, 0.8 * m, 3 * m);
        ctx.fillRect(px - (street / 2 + 3.5) * m, pz + off - 0.4 * m, 3 * m, 0.8 * m);
        ctx.fillRect(px + (street / 2 + 0.5) * m, pz + off - 0.4 * m, 3 * m, 0.8 * m);
      }
    }
  }
  // Soft circular edge into the terrain
  ctx.globalCompositeOperation = 'destination-in';
  const grad = ctx.createRadialGradient(S / 2, S / 2, (radius - 30) * m, S / 2, S / 2, radius * m);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  const t = finish(c, { repeat: false, aniso: 8 });
  return t;
}

export function softDotTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, { repeat: false });
}

export function smokeTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const rng = mulberry32(9);
  for (let i = 0; i < 26; i++) {
    const x = 64 + (rng() - 0.5) * 50;
    const y = 64 + (rng() - 0.5) * 50;
    const r = 18 + rng() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return finish(c, { repeat: false, srgb: false });
}

export function plateTexture(text) {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#1f3d99';
  ctx.fillRect(0, 0, 26, 64);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 252, 60);
  ctx.fillStyle = '#111';
  ctx.font = '700 40px "Chivo Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 140, 34);
  return finish(c, { repeat: false });
}

// Car paint with stripes, door gaps and race number.
// u runs along the car (rear -> front), v around the section (bottom -> left side -> top -> right side -> bottom).
export function carPaintTexture(color, stripe, number) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  // Canvas y grows downward while v grows upward: y = (1 - v) * H
  const y = (v) => (1 - v) * H;
  // Dark underbody
  ctx.fillStyle = '#16171a';
  ctx.fillRect(0, y(0.07), W, H * 0.07);
  ctx.fillRect(0, 0, W, H * 0.07);
  // Twin stripes over the top (v = 0.5)
  if (stripe) {
    ctx.fillStyle = stripe;
    ctx.fillRect(0, y(0.535), W, H * 0.022);
    ctx.fillRect(0, y(0.487), W, H * 0.022);
  }
  // Door gaps on both sides (u 0.42..0.62)
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  for (const u of [0.43, 0.63]) {
    ctx.beginPath();
    ctx.moveTo(u * W, y(0.12));
    ctx.lineTo(u * W, y(0.36));
    ctx.moveTo(u * W, y(0.64));
    ctx.lineTo(u * W, y(0.88));
    ctx.stroke();
  }
  // Hood line
  ctx.beginPath();
  ctx.moveTo(0.73 * W, y(0.42));
  ctx.lineTo(0.73 * W, y(0.58));
  ctx.stroke();
  // Race number roundels on the doors
  const roundel = (cx, cy, flipX, flipY) => {
    ctx.save();
    ctx.translate(cx, cy);
    // The v direction is compressed (~0.45) relative to u on the body, so pre-squash.
    ctx.scale(flipX ? -1 : 1, (flipY ? -1 : 1) * 0.45);
    ctx.fillStyle = '#f5f5f2';
    ctx.beginPath();
    ctx.ellipse(0, 0, 58, 58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = '900 76px "Big Shoulders Display", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 0, 4);
    ctx.restore();
  };
  roundel(0.53 * W, y(0.25), true, false);
  roundel(0.53 * W, y(0.75), false, true);
  return finish(c, { repeat: false });
}

export function gaugeCanvas() {
  return canvas(512, 256);
}
