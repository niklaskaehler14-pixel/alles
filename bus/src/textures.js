// Procedurally painted canvas textures (nothing is downloaded).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

let ANISO = 4;
export function setAnisotropy(a) {
  ANISO = a;
}

function tex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function speckle(ctx, w, h, n, colors, rng, size = 1.5, alpha = 1) {
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(rng() * colors.length) | 0];
    const s = size * (0.4 + rng());
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ ground

// Asphalt: 1 texture = 8 m. Fine grain, patches and a few cracks.
export function asphaltTexture() {
  const S = 1024;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rng = mulberry32(21);
  g.fillStyle = '#4a4c50';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 90000, ['#55575b', '#404246', '#5d5f63', '#3a3c40', '#626468', '#47494d'], rng, 1.6);
  // Darker repair patches.
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `rgba(30,31,34,${0.12 + rng() * 0.12})`;
    const w = 60 + rng() * 220;
    const h = 60 + rng() * 160;
    g.fillRect(rng() * (S - w), rng() * (S - h), w, h);
  }
  // Wheel-polished bands (lanes run along v).
  g.globalAlpha = 0.07;
  g.fillStyle = '#1f2023';
  for (const u of [0.18, 0.36, 0.64, 0.82]) g.fillRect(u * S - 26, 0, 52, S);
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(22,22,24,0.45)';
  g.lineWidth = 1.3;
  for (let i = 0; i < 14; i++) {
    let x = rng() * S;
    let y = rng() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (rng() - 0.5) * 40;
      y += (rng() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return tex(c);
}

// Concrete paving slabs: 1 texture = 2 m (4 × 4 slabs of 0.5 m).
export function paverTexture(base = '#a9a69f', seed = 5) {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  const n = 4;
  const cell = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = (rng() - 0.5) * 18;
      const col = new THREE.Color(base);
      col.offsetHSL(0, 0, v / 255);
      g.fillStyle = `#${col.getHexString()}`;
      g.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  speckle(g, S, S, 26000, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.25)', 'rgba(60,60,60,0.3)'], rng, 1.4, 0.5);
  g.strokeStyle = 'rgba(60,58,54,0.8)';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell, S);
    g.moveTo(0, i * cell);
    g.lineTo(S, i * cell);
    g.stroke();
  }
  return tex(c);
}

// Cobblestones for the market square (1 texture = 3 m).
export function cobbleTexture() {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rng = mulberry32(8);
  g.fillStyle = '#5b554d';
  g.fillRect(0, 0, S, S);
  const rows = 22;
  const h = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * h * 0.5 - h;
    while (x < S) {
      const w = h * (0.8 + rng() * 0.5);
      const shade = 120 + rng() * 60;
      g.fillStyle = `rgb(${shade + 10},${shade + 4},${shade - 6})`;
      g.beginPath();
      g.roundRect(x + 1.5, r * h + 1.5, w - 3, h - 3, 4);
      g.fill();
      x += w;
    }
  }
  return tex(c);
}

export function grassTexture() {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rng = mulberry32(3);
  g.fillStyle = '#4f7a36';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 60000, ['#5c8a3f', '#44692d', '#6a9a48', '#3d6128', '#76a552', '#58803a'], rng, 2.2);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${rng() < 0.5 ? '90,70,40' : '120,150,70'},0.08)`;
    g.beginPath();
    g.arc(rng() * S, rng() * S, 20 + rng() * 60, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

// Granite curb stones: u along the curb (1 = 2 m), v up the face.
export function curbTexture() {
  const c = canvas(512, 64);
  const g = c.getContext('2d');
  const rng = mulberry32(12);
  g.fillStyle = '#b9b7b1';
  g.fillRect(0, 0, 512, 64);
  speckle(g, 512, 64, 5000, ['#8f8d88', '#d2d0ca', '#a3a19b', '#6e6c68'], rng, 1.5);
  g.fillStyle = 'rgba(40,40,40,0.6)';
  for (let x = 0; x <= 512; x += 256) g.fillRect(x - 1, 0, 2, 64);
  return tex(c);
}

export function waterNormalTexture() {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = Math.sin((x / S) * Math.PI * 8 + Math.sin((y / S) * Math.PI * 4) * 1.5);
      const b = Math.cos((y / S) * Math.PI * 6 + Math.sin((x / S) * Math.PI * 6));
      const i = (y * S + x) * 4;
      img.data[i] = 128 + a * 40;
      img.data[i + 1] = 128 + b * 40;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

// ------------------------------------------------------------------ facades

// Facade styles: one tile = `cols` window bays × `rows` floors.
export const FACADE = {
  plaster: { bay: 3.2, floor: 3.2, cols: 4, rows: 4 },
  brick: { bay: 3.2, floor: 3.2, cols: 4, rows: 4 },
  modern: { bay: 3.6, floor: 3.2, cols: 4, rows: 4 },
  office: { bay: 3.0, floor: 3.6, cols: 4, rows: 4 },
  oldtown: { bay: 2.6, floor: 3.1, cols: 4, rows: 4 },
  civic: { bay: 3.8, floor: 3.2, cols: 4, rows: 4 },
};

// Returns { map, emissive, rough } for a facade style. Base colour is white-ish so vertex colours tint it.
export function facadeTextures(style) {
  const S = 512;
  const rng = mulberry32(style.length * 977 + style.charCodeAt(0));
  const f = FACADE[style];
  const col = canvas(S, S);
  const emi = canvas(S, S);
  const rou = canvas(S, S);
  const g = col.getContext('2d');
  const e = emi.getContext('2d');
  const r = rou.getContext('2d');
  const bw = S / f.cols;
  const fh = S / f.rows;
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  r.fillStyle = '#e0e0e0';
  r.fillRect(0, 0, S, S);

  // Wall.
  if (style === 'brick') {
    g.fillStyle = '#a4553f';
    g.fillRect(0, 0, S, S);
    const bh = 8;
    for (let y = 0; y < S; y += bh) {
      const off = ((y / bh) % 2) * 12;
      for (let x = -off; x < S; x += 24) {
        const t = rng();
        g.fillStyle = t < 0.3 ? '#8e4533' : t < 0.6 ? '#b0624a' : t < 0.8 ? '#9b4c39' : '#7f3d2e';
        g.fillRect(x + 1, y + 1, 22, bh - 2);
      }
    }
  } else if (style === 'office') {
    g.fillStyle = '#9aa7b1';
    g.fillRect(0, 0, S, S);
  } else if (style === 'civic') {
    g.fillStyle = '#d8c7a3';
    g.fillRect(0, 0, S, S);
    speckle(g, S, S, 9000, ['#c9b791', '#e3d4b3', '#bfae8b'], rng, 1.8, 0.6);
    g.strokeStyle = 'rgba(120,100,70,0.35)';
    for (let y = 0; y < S; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y);
      g.stroke();
    }
  } else {
    g.fillStyle = style === 'modern' ? '#eeeeea' : '#f2efe8';
    g.fillRect(0, 0, S, S);
    speckle(g, S, S, 12000, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.08)'], rng, 2, 1);
  }

  for (let row = 0; row < f.rows; row++) {
    const y0 = row * fh;
    // Floor band / cornice line.
    if (style === 'modern') {
      g.fillStyle = 'rgba(80,85,90,0.25)';
      g.fillRect(0, y0 + fh - 6, S, 6);
    }
    for (let col2 = 0; col2 < f.cols; col2++) {
      const x0 = col2 * bw;
      let wx;
      let wy;
      let ww;
      let wh;
      if (style === 'office') {
        wx = x0 + 3;
        ww = bw - 6;
        wy = y0 + fh * 0.18;
        wh = fh * 0.76;
      } else if (style === 'modern') {
        wx = x0 + bw * 0.12;
        ww = bw * 0.76;
        wy = y0 + fh * 0.22;
        wh = fh * 0.62;
      } else if (style === 'civic') {
        wx = x0 + bw * 0.3;
        ww = bw * 0.4;
        wy = y0 + fh * 0.18;
        wh = fh * 0.66;
      } else {
        wx = x0 + bw * 0.27;
        ww = bw * 0.46;
        wy = y0 + fh * 0.22;
        wh = fh * 0.58;
      }
      // Glass (canvas y grows downwards; row 0 is the top floor of the tile).
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, style === 'office' ? '#5f7d95' : '#6c8397');
      grad.addColorStop(1, style === 'office' ? '#2d3e4d' : '#2b3440');
      g.fillStyle = grad;
      if (style === 'civic') {
        g.beginPath();
        g.moveTo(wx, wy + wh);
        g.lineTo(wx, wy + ww / 2);
        g.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0);
        g.lineTo(wx + ww, wy + wh);
        g.closePath();
        g.fill();
      } else g.fillRect(wx, wy, ww, wh);
      // Curtains / blinds in some windows.
      if (style !== 'office' && rng() < 0.35) {
        g.fillStyle = rng() < 0.5 ? 'rgba(230,225,210,0.55)' : 'rgba(180,170,150,0.5)';
        g.fillRect(wx, wy, ww, wh * (0.2 + rng() * 0.5));
      }
      // Frames and cross bars.
      g.strokeStyle = style === 'office' ? '#3a4652' : style === 'brick' ? '#f4f1ea' : '#fbfaf6';
      g.lineWidth = style === 'office' ? 3 : 4;
      if (style !== 'civic') g.strokeRect(wx, wy, ww, wh);
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(wx + ww / 2, wy);
      g.lineTo(wx + ww / 2, wy + wh);
      if (style !== 'office') {
        g.moveTo(wx, wy + wh * 0.35);
        g.lineTo(wx + ww, wy + wh * 0.35);
      }
      g.stroke();
      // Window sill.
      if (style !== 'office') {
        g.fillStyle = style === 'brick' ? '#d8d2c6' : 'rgba(170,165,155,0.9)';
        g.fillRect(wx - 4, wy + wh, ww + 8, 5);
      }
      // Shutters for old-town houses.
      if (style === 'oldtown' && rng() < 0.6) {
        g.fillStyle = rng() < 0.5 ? '#3f6b4a' : '#6b3f2f';
        g.fillRect(wx - ww * 0.32, wy, ww * 0.28, wh);
        g.fillRect(wx + ww * 1.04, wy, ww * 0.28, wh);
      }
      // Balconies on modern blocks.
      if (style === 'modern' && col2 % 2 === 1 && rng() < 0.7) {
        g.fillStyle = 'rgba(70,75,80,0.85)';
        g.fillRect(wx - 6, wy + wh * 0.62, ww + 12, wh * 0.38);
        g.fillStyle = 'rgba(200,205,210,0.5)';
        g.fillRect(wx - 6, wy + wh * 0.62, ww + 12, 3);
      }
      // Emissive: warm light in some windows.
      if (rng() < 0.42) {
        const warm = ['#ffd9a0', '#ffe7c2', '#ffcf87', '#fff1d6', '#cfe3ff'];
        e.fillStyle = warm[(rng() * warm.length) | 0];
        e.globalAlpha = 0.55 + rng() * 0.45;
        if (style === 'civic') {
          e.beginPath();
          e.moveTo(wx, wy + wh);
          e.lineTo(wx, wy + ww / 2);
          e.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0);
          e.lineTo(wx + ww, wy + wh);
          e.fill();
        } else e.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        e.globalAlpha = 1;
      }
      // Glass is smoother.
      r.fillStyle = '#3a3a3a';
      r.fillRect(wx, wy, ww, wh);
    }
  }
  // Half-timbering over the plaster for old-town houses.
  if (style === 'oldtown') {
    g.strokeStyle = '#4a3325';
    g.lineWidth = 9;
    for (let row = 0; row < f.rows; row++) {
      const y0 = row * fh;
      g.beginPath();
      g.moveTo(0, y0 + 4);
      g.lineTo(S, y0 + 4);
      g.moveTo(0, y0 + fh * 0.84);
      g.lineTo(S, y0 + fh * 0.84);
      for (let col2 = 0; col2 <= f.cols; col2++) {
        const x0 = col2 * bw;
        g.moveTo(x0, y0);
        g.lineTo(x0, y0 + fh);
        if (col2 < f.cols && rng() < 0.5) {
          g.moveTo(x0 + 4, y0 + fh * 0.84);
          g.lineTo(x0 + bw * 0.24, y0 + fh * 0.2);
        }
      }
      g.stroke();
    }
  }
  const map = tex(col);
  const emissive = tex(emi);
  const rough = tex(rou, { srgb: false });
  return { map, emissive, rough };
}

const SHOPS = [
  ['Bäckerei Krume', '#c78a3b'],
  ['Apotheke', '#2e9e5b'],
  ['Café Mocca', '#6b4226'],
  ['Blumen Lotte', '#c2185b'],
  ['Buchladen', '#3b5ba5'],
  ['Friseur', '#8e44ad'],
  ['Metzgerei', '#b71c1c'],
  ['Optik Klar', '#1f6f8b'],
  ['Eiscafé Venezia', '#e67e22'],
  ['Kiosk', '#2c3e50'],
  ['Mode & Mehr', '#34495e'],
  ['Sparkasse', '#d50000'],
  ['Döner Kebab', '#d35400'],
  ['Fahrräder', '#16a085'],
  ['Spielwaren', '#f1c40f'],
  ['Reisebüro', '#0097a7'],
];

// Shop ground floors: 8 fronts of 8 m side by side (u spans 64 m), v covers the ground floor.
export function shopTextures() {
  const W = 2048;
  const H = 256;
  const col = canvas(W, H);
  const emi = canvas(W, H);
  const g = col.getContext('2d');
  const e = emi.getContext('2d');
  const rng = mulberry32(77);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const fw = W / 8;
  for (let i = 0; i < 8; i++) {
    const [name, color] = SHOPS[(i * 2 + 1) % SHOPS.length];
    const x0 = i * fw;
    g.fillStyle = '#d9d5cc';
    g.fillRect(x0, 0, fw, H);
    // Sign band.
    g.fillStyle = color;
    g.fillRect(x0 + 8, 18, fw - 16, 44);
    g.fillStyle = '#fff';
    g.font = 'bold 26px Barlow, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, x0 + fw / 2, 41, fw - 28);
    e.fillStyle = color;
    e.fillRect(x0 + 8, 18, fw - 16, 44);
    e.fillStyle = '#fff';
    e.font = g.font;
    e.textAlign = 'center';
    e.textBaseline = 'middle';
    e.fillText(name, x0 + fw / 2, 41, fw - 28);
    // Awning stripes.
    for (let k = 0; k < 10; k++) {
      g.fillStyle = k % 2 ? color : '#f4f1ea';
      g.fillRect(x0 + 8 + ((fw - 16) / 10) * k, 64, (fw - 16) / 10, 16);
    }
    // Display windows and door.
    const grad = g.createLinearGradient(0, 84, 0, H);
    grad.addColorStop(0, '#80919f');
    grad.addColorStop(1, '#2c343c');
    g.fillStyle = grad;
    g.fillRect(x0 + 12, 88, fw * 0.55, H - 96);
    g.fillRect(x0 + fw * 0.62, 88, fw * 0.3, H - 96);
    // Goods in the window.
    for (let k = 0; k < 6; k++) {
      g.fillStyle = `hsl(${rng() * 360},45%,${45 + rng() * 25}%)`;
      g.fillRect(x0 + 18 + rng() * (fw * 0.5 - 20), 150 + rng() * 70, 10 + rng() * 16, 14 + rng() * 22);
    }
    g.strokeStyle = '#2b2b2b';
    g.lineWidth = 5;
    g.strokeRect(x0 + 12, 88, fw * 0.55, H - 96);
    g.strokeRect(x0 + fw * 0.62, 88, fw * 0.3, H - 96);
    e.fillStyle = '#ffe2b0';
    e.globalAlpha = 0.85;
    e.fillRect(x0 + 12, 88, fw * 0.55, H - 96);
    e.fillRect(x0 + fw * 0.62, 88, fw * 0.3, H - 96);
    e.globalAlpha = 1;
  }
  return { map: tex(col), emissive: tex(emi) };
}

// Plain ground floors: a house door every 8 m, small windows.
export function entranceTexture() {
  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rng = mulberry32(31);
  g.fillStyle = '#e9e5dc';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 5000, ['rgba(0,0,0,0.06)'], rng, 2);
  g.fillStyle = '#b9b3a7';
  g.fillRect(0, H - 40, W, 40);
  // Door
  g.fillStyle = '#5a3d2b';
  g.fillRect(W * 0.08, 70, W * 0.16, H - 70);
  g.fillStyle = '#8ea0ad';
  g.fillRect(W * 0.1, 84, W * 0.12, 60);
  g.fillStyle = '#d4af37';
  g.fillRect(W * 0.21, 170, 6, 14);
  // Windows
  for (const x of [0.36, 0.62, 0.84]) {
    g.fillStyle = '#44525f';
    g.fillRect(W * x - 34, 80, 68, 100);
    g.strokeStyle = '#fbfaf6';
    g.lineWidth = 5;
    g.strokeRect(W * x - 34, 80, 68, 100);
  }
  return tex(c);
}

export function lobbyTexture() {
  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#7d8f9c');
  grad.addColorStop(1, '#2d3740');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#3b444c';
  for (let x = 0; x <= W; x += 64) g.fillRect(x - 3, 0, 6, H);
  g.fillRect(0, 0, W, 14);
  return tex(c);
}

export function roofTexture(kind) {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rng = mulberry32(kind === 'tiles' ? 4 : 9);
  if (kind === 'tiles') {
    g.fillStyle = '#9b3d27';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) {
      for (let x = ((y / 16) % 2) * 8; x < S; x += 16) {
        g.fillStyle = `rgba(${60 + rng() * 40},${20 + rng() * 15},10,${0.25 + rng() * 0.2})`;
        g.fillRect(x, y, 14, 14);
        g.fillStyle = 'rgba(255,200,170,0.12)';
        g.fillRect(x, y, 14, 3);
      }
    }
  } else {
    g.fillStyle = '#6a6c6e';
    g.fillRect(0, 0, S, S);
    speckle(g, S, S, 12000, ['#5a5c5e', '#7a7c7e', '#4f5153', '#85878a'], rng, 2);
  }
  return tex(c);
}

// ------------------------------------------------------------------ signs

// Traffic signs atlas (4 × 4 cells of 128 px). Returns { texture, cells: {type: [u0, v0, u1, v1]} }.
export function signAtlas() {
  const C = 128;
  const c = canvas(C * 4, C * 4);
  const g = c.getContext('2d');
  const cells = {};
  let idx = 0;
  const cell = (name, draw) => {
    const cx = (idx % 4) * C;
    const cy = Math.floor(idx / 4) * C;
    g.save();
    g.translate(cx, cy);
    draw(g);
    g.restore();
    cells[name] = [cx / (C * 4), 1 - (cy + C) / (C * 4), (cx + C) / (C * 4), 1 - cy / (C * 4)];
    idx++;
  };
  // Zeichen 205: Vorfahrt gewähren (inverted triangle).
  cell('yield', (g) => {
    g.fillStyle = '#c1121f';
    g.beginPath();
    g.moveTo(6, 14);
    g.lineTo(122, 14);
    g.lineTo(64, 118);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(26, 25);
    g.lineTo(102, 25);
    g.lineTo(64, 94);
    g.closePath();
    g.fill();
  });
  // Zeichen 206: Halt! Vorfahrt gewähren (octagon).
  cell('stop', (g) => {
    g.fillStyle = '#fff';
    const oct = (r) => {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      g.closePath();
    };
    oct(60);
    g.fill();
    g.fillStyle = '#c1121f';
    oct(55);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STOP', 64, 66);
  });
  // Zeichen 306: Vorfahrtstraße (yellow diamond).
  cell('priorityRoad', (g) => {
    g.translate(64, 64);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#fff';
    g.fillRect(-43, -43, 86, 86);
    g.fillStyle = '#222';
    g.fillRect(-40, -40, 80, 80);
    g.fillStyle = '#fff';
    g.fillRect(-36, -36, 72, 72);
    g.fillStyle = '#f5c400';
    g.fillRect(-26, -26, 52, 52);
  });
  // Zeichen 301: Vorfahrt (triangle with bold arrow).
  cell('priorityNext', (g) => {
    g.fillStyle = '#c1121f';
    g.beginPath();
    g.moveTo(64, 10);
    g.lineTo(122, 112);
    g.lineTo(6, 112);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(64, 32);
    g.lineTo(102, 101);
    g.lineTo(26, 101);
    g.closePath();
    g.fill();
    g.fillStyle = '#111';
    g.fillRect(58, 52, 12, 42);
    g.fillRect(44, 64, 40, 10);
  });
  const zone = (end) => (g) => {
    g.fillStyle = '#fff';
    g.fillRect(8, 4, 112, 120);
    g.strokeStyle = '#222';
    g.lineWidth = 3;
    g.strokeRect(9.5, 5.5, 109, 117);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(64, 52, 38, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = end ? '#777' : '#c1121f';
    g.lineWidth = 8;
    g.stroke();
    g.fillStyle = end ? '#777' : '#111';
    g.font = 'bold 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('30', 64, 54);
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText('ZONE', 64, 108);
    if (end) {
      g.strokeStyle = '#222';
      g.lineWidth = 5;
      for (let k = -2; k <= 2; k++) {
        g.beginPath();
        g.moveTo(20 + k * 8, 118);
        g.lineTo(108 + k * 8, 14);
        g.stroke();
      }
    }
  };
  cell('zone30', zone(false));
  cell('zone30end', zone(true));
  // Zeichen 224: Haltestelle (green H on yellow).
  cell('busStop', (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#128a3a';
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f5c400';
    g.beginPath();
    g.arc(64, 64, 50, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#128a3a';
    g.font = 'bold 70px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('H', 64, 68);
  });
  // Zeichen 350: Fußgängerüberweg.
  cell('zebra', (g) => {
    g.fillStyle = '#fff';
    g.fillRect(4, 4, 120, 120);
    g.fillStyle = '#1f5fbf';
    g.fillRect(10, 10, 108, 108);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(64, 18);
    g.lineTo(112, 108);
    g.lineTo(16, 108);
    g.closePath();
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(62, 48, 7, 0, Math.PI * 2);
    g.fill();
    g.fillRect(58, 56, 8, 24);
    g.fillRect(52, 78, 6, 20);
    g.fillRect(66, 78, 6, 20);
    for (let k = 0; k < 4; k++) g.fillRect(34 + k * 16, 100, 10, 5);
  });
  const t = tex(c, { repeat: false });
  return { texture: t, cells };
}

// Road text markings (white on transparent): "BUS" and "30".
export function roadTextTexture(text) {
  const c = canvas(256, 512);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 512);
  g.fillStyle = '#fff';
  g.font = 'bold 150px Arial Narrow, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(128, 256);
  g.scale(1, 2.2);
  g.fillText(text, 0, 0);
  g.restore();
  return tex(c, { repeat: false });
}

// ------------------------------------------------------------------ bus

// LED dot-matrix destination display. Draws line number and headsign into a canvas.
export function drawDestination(ctx, w, h, line, text, color = '#ffb52e') {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.floor(h * 0.72)}px "Chivo Mono", monospace`;
  ctx.textAlign = 'left';
  const pad = h * 0.18;
  ctx.fillText(line, pad, h * 0.54);
  const lw = ctx.measureText(line).width + pad * 2.2;
  ctx.font = `bold ${Math.floor(h * 0.5)}px "Barlow", Arial, sans-serif`;
  ctx.fillText(text, lw, h * 0.54, w - lw - pad);
  // Dot-matrix grid overlay.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const step = Math.max(2, Math.floor(h / 20));
  for (let x = 0; x < w; x += step) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, 1);
}

export function makeCanvasTexture(w, h) {
  const c = canvas(w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return { canvas: c, ctx: c.getContext('2d'), texture: t };
}

export function seatTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const rng = mulberry32(55);
  g.fillStyle = '#1d3c78';
  g.fillRect(0, 0, 64, 64);
  speckle(g, 64, 64, 900, ['#e24a33', '#f2c230', '#2f5fb8', '#0f2350'], rng, 1.4);
  return tex(c);
}

export function floorTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const rng = mulberry32(66);
  g.fillStyle = '#5a5d61';
  g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 3000, ['#6b6e72', '#4a4d51', '#7a7d81'], rng, 1.2);
  return tex(c);
}
