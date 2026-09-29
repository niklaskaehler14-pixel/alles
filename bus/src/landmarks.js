// Landmarks: main bodies are regular textured buildings, the special parts (towers, roofs,
// columns, stands, tracks, water) are built here.
import * as THREE from 'three';
import { ROAD } from './config.js';
import { GeoBuilder, hexRgb } from './geo.js';

const CURB = ROAD.curbHeight;

// Building records (same format as layout.buildings) for landmark main bodies.
export function landmarkBuildings(layout) {
  const out = [];
  const add = (lm, o) => out.push({ x: lm.x, z: lm.z, yaw: lm.yaw, tint: 0.5, seed: 7, street: '', roof: 'flat', ground: 'plain', ...o });
  const body = (floors, floorH, groundH) => ({ floors, floorH, groundH, h: groundH + (floors - 1) * floorH });
  for (const lm of layout.landmarks) {
    switch (lm.type) {
      case 'station':
        add(lm, { w: lm.w, d: lm.d, style: 'civic', ...body(3, 4.2, 5), ground: 'shop' });
        break;
      case 'townhall':
        add(lm, { w: lm.w, d: lm.d, style: 'civic', ...body(3, 3.8, 4.4), roof: 'gable', tint: 0.3 });
        break;
      case 'theater':
        add(lm, { w: lm.w, d: lm.d, style: 'civic', ...body(4, 4, 5), tint: 0.9 });
        break;
      case 'mall':
        add(lm, { w: lm.w, d: lm.d, style: 'office', ...body(4, 4.2, 5), ground: 'lobby' });
        break;
      case 'school':
      case 'schoolWing':
        add(lm, { w: lm.w, d: lm.d, style: 'modern', ...body(lm.floors || 3, 3.4, 3.8), tint: 0.95 });
        break;
      case 'hospital':
      case 'hospitalWing':
        add(lm, { w: lm.w, d: lm.d, style: 'modern', ...body(lm.floors || 6, 3.4, 4.2), ground: 'lobby', tint: 1 });
        break;
      case 'depotOffice':
        add(lm, { w: lm.w, d: lm.d, style: 'office', ...body(3, 3.6, 4), ground: 'lobby' });
        break;
      default:
        break;
    }
  }
  return out;
}

function signTexture(lines) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64 * lines.length;
  const g = c.getContext('2d');
  const uv = {};
  lines.forEach(([key, text, bg, fg], i) => {
    g.fillStyle = bg;
    g.fillRect(0, i * 64, 1024, 64);
    g.fillStyle = fg;
    g.font = 'bold 44px "Atkinson Hyperlegible", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, i * 64 + 34, 980);
    uv[key] = [0, 1 - ((i + 1) * 64) / c.height, 1, 1 - (i * 64) / c.height];
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, uv };
}

function clockTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1e8';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#222';
  g.lineWidth = 5;
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillStyle = '#222';
    g.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 5, 4, 10);
  }
  g.strokeStyle = '#111';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(64, 64);
  g.lineTo(64 + 28, 64 - 14);
  g.moveTo(64, 64);
  g.lineTo(64 - 6, 64 - 44);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class LandmarksView {
  constructor(layout, { shadows = true, companyName = 'Nordkamm Verkehrsbetriebe' } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    this.shadows = shadows;
    const B = {
      stone: new GeoBuilder(),
      metal: new GeoBuilder(),
      glass: new GeoBuilder(),
      slate: new GeoBuilder(),
      copper: new GeoBuilder(),
      water: new GeoBuilder(),
      sign: new GeoBuilder(),
      clock: new GeoBuilder(),
    };
    this.B = B;
    const { texture: signTex, uv } = signTexture([
      ['station', 'HAUPTBAHNHOF', '#1c3f73', '#ffffff'],
      ['theater', 'STADTTHEATER', '#6b1d2a', '#f3e2b3'],
      ['mall', 'STADTGALERIE', '#ffffff', '#c2185b'],
      ['school', 'SCHULZENTRUM NORDKAMM', '#f2f2ee', '#1b5fa8'],
      ['hospital', 'KLINIKUM', '#ffffff', '#c8102e'],
      ['depot', `BETRIEBSHOF · ${companyName.toUpperCase()}`, '#f2b705', '#1c232b'],
      ['stadium', 'SPORTPARK', '#1f7a4d', '#ffffff'],
      ['townhall', 'RATHAUS', '#f4efe3', '#5a3d2b'],
    ]);
    this.signUV = uv;
    for (const lm of layout.landmarks) {
      switch (lm.type) {
        case 'station':
          this.station(lm);
          break;
        case 'tracks':
          this.tracks(lm);
          break;
        case 'townhall':
          this.townhall(lm);
          break;
        case 'fountain':
          this.fountain(lm);
          break;
        case 'church':
          this.church(lm);
          break;
        case 'theater':
          this.theater(lm);
          break;
        case 'mall':
          this.sign(lm, 'mall', 0, 21.2, lm.d / 2 + 0.3, 30, 3.2);
          this.B.glass.box(...this.p(lm, 0, 3, lm.d / 2 + 2.5), 24, 0.25, 5, lm.yaw, [0.6, 0.7, 0.75]);
          break;
        case 'school':
          this.sign(lm, 'school', 0, 11.2, lm.d / 2 + 0.3, 26, 1.6);
          break;
        case 'hospital':
          this.hospital(lm);
          break;
        case 'busHall':
          this.busHall(lm);
          break;
        case 'depotOffice':
          this.sign(lm, 'depot', 0, 12.6, lm.d / 2 + 0.3, 40, 2);
          break;
        case 'warehouse':
          this.warehouse(lm);
          break;
        case 'silo':
          this.silo(lm);
          break;
        case 'stadium':
          this.stadium(lm);
          break;
        case 'pond':
          this.pond(lm);
          break;
        case 'playground':
          this.playground(lm);
          break;
        case 'kiosk':
          B.stone.box(lm.x, CURB + 1.4, lm.z, 5, 2.8, 4, lm.yaw, hexRgb('#2f6b4f'));
          B.stone.box(lm.x, CURB + 2.95, lm.z, 6, 0.3, 5, lm.yaw, hexRgb('#e8e2d0'));
          break;
        default:
          break;
      }
    }
    const mats = {
      stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.75 }),
      slate: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, color: '#4a5058' }),
      copper: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, color: '#5f9e89', metalness: 0.2 }),
      water: new THREE.MeshStandardMaterial({ color: '#3b6b7a', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.88 }),
      sign: new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.4, emissiveMap: signTex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 }),
      clock: new THREE.MeshStandardMaterial({ map: clockTexture(), roughness: 0.5, transparent: true, alphaTest: 0.4 }),
    };
    this.signMat = mats.sign;
    for (const [k, gb] of Object.entries(B)) {
      if (gb.empty) continue;
      const m = new THREE.Mesh(gb.build(), mats[k]);
      m.castShadow = shadows && k !== 'water' && k !== 'sign' && k !== 'clock';
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.group.add(m);
    }
  }

  // Local (lx, ly, lz) of a landmark (local +z = the side facing yaw) → world position.
  p(lm, lx, ly, lz) {
    const s = Math.sin(lm.yaw);
    const c = Math.cos(lm.yaw);
    return [lm.x + lx * c + lz * s, CURB + ly, lm.z - lx * s + lz * c];
  }

  // Sign board on a facade (text from the atlas).
  sign(lm, key, lx, ly, lz, w, h) {
    const [u0, v0, u1, v1] = this.signUV[key];
    const s = Math.sin(lm.yaw);
    const c = Math.cos(lm.yaw);
    const P = (x, y) => this.p(lm, x, y, lz);
    this.B.sign.quad(P(lx - w / 2, ly - h / 2), P(lx + w / 2, ly - h / 2), P(lx + w / 2, ly + h / 2), P(lx - w / 2, ly + h / 2), [s, 0, c], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }

  clockFace(lm, lx, ly, lz, r, yawOff = 0) {
    const s = Math.sin(lm.yaw + yawOff);
    const c = Math.cos(lm.yaw + yawOff);
    const [cx, cy, cz] = this.p(lm, lx, ly, lz);
    const lxv = [c * r, 0, -s * r];
    this.B.clock.quad([cx - lxv[0], cy - r, cz - lxv[2]], [cx + lxv[0], cy - r, cz + lxv[2]], [cx + lxv[0], cy + r, cz + lxv[2]], [cx - lxv[0], cy + r, cz - lxv[2]], [s, 0, c]);
  }

  // Tower with a clock on all four sides and a spire.
  tower(lm, lx, lz, w, h, spireH, color, spire = 'copper') {
    const [x, , z] = this.p(lm, lx, 0, lz);
    this.B.stone.box(x, CURB + h / 2, z, w, h, w, lm.yaw, color);
    this.B.stone.box(x, CURB + h + 0.3, z, w + 0.6, 0.6, w + 0.6, lm.yaw, hexRgb('#cfc6b3'));
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      this.clockFace({ ...lm, x, z, yaw: lm.yaw + a }, 0, h - w * 0.7, w / 2 + 0.03, w * 0.32);
    }
    // Spire: four-sided pyramid.
    const top = [x, CURB + h + spireH, z];
    const s = Math.sin(lm.yaw);
    const c = Math.cos(lm.yaw);
    const hw = w / 2 + 0.2;
    const corners = [
      [-hw, -hw],
      [hw, -hw],
      [hw, hw],
      [-hw, hw],
    ].map(([a, b]) => [x + a * c + b * s, CURB + h + 0.6, z - a * s + b * c]);
    for (let k = 0; k < 4; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 4];
      const mx = (a[0] + b[0]) / 2 - x;
      const mz = (a[2] + b[2]) / 2 - z;
      const l = Math.hypot(mx, mz);
      this.B[spire].tri(a, b, top, [mx / l, 0.5, mz / l], [0, 0], [1, 0], [0.5, 1]);
    }
  }

  station(lm) {
    const B = this.B;
    const stone = hexRgb('#d9c8a4');
    // Central entrance hall with a barrel glass roof.
    const hallW = 36;
    const hallD = lm.d + 4;
    B.stone.box(...this.p(lm, 0, 9, 0), hallW, 18, hallD, lm.yaw, stone);
    const segs = 12;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI;
      const a1 = ((i + 1) / segs) * Math.PI;
      const r = hallW / 2;
      const P = (a, z) => this.p(lm, -Math.cos(a) * r, 18 + Math.sin(a) * 7, z);
      const n = [Math.cos((a0 + a1) / 2) * -1, Math.sin((a0 + a1) / 2), 0];
      const s = Math.sin(lm.yaw);
      const c = Math.cos(lm.yaw);
      const nw = [n[0] * c, n[1], -n[0] * s];
      B.glass.quad(P(a0, -hallD / 2), P(a1, -hallD / 2), P(a1, hallD / 2), P(a0, hallD / 2), nw, undefined, [0.55, 0.68, 0.75]);
    }
    // Big arched window and entrance canopy on the front.
    B.glass.box(...this.p(lm, 0, 10, hallD / 2 + 0.05), 26, 12, 0.1, lm.yaw, [0.45, 0.58, 0.68]);
    B.metal.box(...this.p(lm, 0, 4.6, hallD / 2 + 3), 30, 0.35, 6, lm.yaw, hexRgb('#6c737a'));
    this.sign(lm, 'station', 0, 17, hallD / 2 + 0.2, 30, 2.2);
    // Clock tower at the west end.
    this.tower(lm, -lm.w / 2 + 6, 2, 9, 34, 10, stone);
  }

  tracks(lm) {
    const B = this.B;
    const len = lm.length;
    const zc = lm.z;
    // Gravel bed, platforms, rails and platform roofs.
    B.stone.box(lm.x, 0.2, zc, len, 0.4, 40, 0, hexRgb('#6e675e'));
    for (const pz of [-14, 0, 14]) {
      B.stone.box(lm.x, 0.55, zc + pz, 420, 0.9, 6, 0, hexRgb('#b3aea6'));
      B.stone.box(lm.x, 1.02, zc + pz + 2.9, 420, 0.04, 0.3, 0, hexRgb('#f2f2ee'));
      B.stone.box(lm.x, 1.02, zc + pz - 2.9, 420, 0.04, 0.3, 0, hexRgb('#f2f2ee'));
      for (let x = lm.x - 190; x <= lm.x + 190; x += 20) B.metal.box(x, 3.1, zc + pz, 0.25, 4, 0.25, 0, hexRgb('#58606a'));
      B.metal.box(lm.x, 5.2, zc + pz, 400, 0.3, 7, 0, hexRgb('#6c747c'));
    }
    for (const tz of [-7, 7, -20.5, 20.5]) {
      for (const off of [-0.72, 0.72]) B.metal.box(lm.x, 0.48, zc + tz + off, len, 0.14, 0.08, 0, hexRgb('#8a8580'));
    }
    // A regional train at platform 1 (white with a red stripe).
    for (let k = 0; k < 4; k++) {
      const x = lm.x - 60 + k * 26.5;
      B.stone.box(x, 2.35, zc - 7, 26, 3.4, 2.9, 0, hexRgb('#eeeeea'));
      B.stone.box(x, 1.4, zc - 7, 26.02, 0.5, 2.92, 0, hexRgb('#c8102e'));
      B.glass.box(x, 2.9, zc - 7, 24, 1.0, 2.95, 0, [0.2, 0.25, 0.3]);
    }
  }

  townhall(lm) {
    this.tower(lm, 0, -2, 7, 30, 12, hexRgb('#e7dcc3'), 'slate');
    this.sign(lm, 'townhall', 0, 5.4, lm.d / 2 + 0.25, 12, 1.2);
    // Arcade on the ground floor.
    for (let k = -3; k <= 3; k++) this.B.stone.box(...this.p(lm, k * 7, 2.2, lm.d / 2 + 1.6), 0.8, 4.4, 0.8, lm.yaw, hexRgb('#cfc3a8'));
    this.B.stone.box(...this.p(lm, 0, 4.6, lm.d / 2 + 1.6), 50, 0.5, 3.4, lm.yaw, hexRgb('#cfc3a8'));
  }

  fountain(lm) {
    const B = this.B;
    const stone = hexRgb('#b9b1a2');
    const seg = 20;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      B.stone.box(lm.x + Math.cos(a) * 4.2, CURB + 0.35, lm.z + Math.sin(a) * 4.2, 1.4, 0.7, 0.5, -a + Math.PI / 2, stone);
    }
    B.water.cylinder(lm.x, CURB, lm.z, 4, 4, 0.55, 24, [1, 1, 1]);
    B.stone.cylinder(lm.x, CURB, lm.z, 0.5, 0.35, 2.4, 10, stone);
    B.stone.cylinder(lm.x, CURB + 2.4, lm.z, 1.4, 1.4, 0.2, 14, stone);
    B.water.cylinder(lm.x, CURB + 2.6, lm.z, 0.12, 0.02, 1.4, 8, [1, 1, 1]);
  }

  church(lm) {
    const B = this.B;
    const stone = hexRgb('#b8a88a');
    // Nave along local z (yaw points to the altar in the east).
    const L = 46;
    const W = 19;
    const Hn = 16;
    B.stone.box(lm.x, CURB + Hn / 2, lm.z, W, Hn, L, lm.yaw, stone);
    // Tall arched windows.
    for (let k = -4; k <= 4; k++) {
      for (const side of [-1, 1]) {
        const [x, y, z] = this.p(lm, side * (W / 2 + 0.03), 7.5, k * 4.6);
        B.glass.box(x, y, z, 0.06, 7, 1.8, lm.yaw, [0.25, 0.3, 0.45]);
      }
    }
    // Roof ridge along the nave.
    const rh = 9;
    const P = (lx, y, lz) => this.p(lm, lx, y, lz);
    const s = Math.sin(lm.yaw);
    const c = Math.cos(lm.yaw);
    const nL = [-Math.cos(0.76) * c, Math.sin(0.76), Math.cos(0.76) * s];
    const nR = [Math.cos(0.76) * c, Math.sin(0.76), -Math.cos(0.76) * s];
    B.slate.quad(P(-W / 2 - 0.4, Hn, -L / 2 - 0.4), P(-W / 2 - 0.4, Hn, L / 2 + 0.4), P(0, Hn + rh, L / 2 + 0.4), P(0, Hn + rh, -L / 2 - 0.4), nL);
    B.slate.quad(P(W / 2 + 0.4, Hn, L / 2 + 0.4), P(W / 2 + 0.4, Hn, -L / 2 - 0.4), P(0, Hn + rh, -L / 2 - 0.4), P(0, Hn + rh, L / 2 + 0.4), nR);
    for (const e of [-1, 1]) B.stone.tri(P(-W / 2, Hn, (e * L) / 2), P(W / 2, Hn, (e * L) / 2), P(0, Hn + rh, (e * L) / 2), [s * e, 0, c * e], [0, 0], [1, 0], [0.5, 1], stone);
    // West tower with a tall copper spire.
    this.tower(lm, 0, -L / 2 - 5, 10, 44, 24, stone);
    // Apse.
    const [ax, , az] = this.p(lm, 0, 0, L / 2);
    B.stone.cylinder(ax, CURB, az, 7, 7, 13, 12, stone);
  }

  theater(lm) {
    const B = this.B;
    const col = hexRgb('#efe6d0');
    for (let k = 0; k < 8; k++) {
      const [x, , z] = this.p(lm, -17.5 + k * 5, 0, lm.d / 2 + 3.5);
      B.stone.cylinder(x, CURB + 0.8, z, 0.6, 0.55, 11, 12, col);
    }
    B.stone.box(...this.p(lm, 0, 0.4, lm.d / 2 + 3.5), 42, 0.8, 7, lm.yaw, hexRgb('#d8cdb3'));
    B.stone.box(...this.p(lm, 0, 12.4, lm.d / 2 + 3.5), 42, 1.2, 7.5, lm.yaw, col);
    // Pediment.
    const s = Math.sin(lm.yaw);
    const c = Math.cos(lm.yaw);
    const P = (lx, y) => this.p(lm, lx, y, lm.d / 2 + 7.2);
    B.stone.tri(P(-21, 13), P(21, 13), P(0, 19), [s, 0, c], [0, 0], [1, 0], [0.5, 1], col);
    const P2 = (lx, y, lz) => this.p(lm, lx, y, lz);
    B.slate.quad(P2(-21, 13, lm.d / 2 + 7.2), P2(0, 19, lm.d / 2 + 7.2), P2(0, 19, lm.d / 2 - 0.2), P2(-21, 13, lm.d / 2 - 0.2), [-c * 0.3, 0.95, s * 0.3]);
    B.slate.quad(P2(0, 19, lm.d / 2 + 7.2), P2(21, 13, lm.d / 2 + 7.2), P2(21, 13, lm.d / 2 - 0.2), P2(0, 19, lm.d / 2 - 0.2), [c * 0.3, 0.95, -s * 0.3]);
    this.sign(lm, 'theater', 0, 14.2, lm.d / 2 + 7.3, 20, 1.6);
  }

  hospital(lm) {
    const B = this.B;
    const h = 4.2 + 7 * 3.4;
    this.sign(lm, 'hospital', 0, h - 1.5, lm.d / 2 + 0.3, 22, 2.4);
    // Red cross.
    const [x, , z] = this.p(lm, lm.w / 2 - 8, 0, lm.d / 2 + 0.35);
    B.stone.box(x, CURB + h - 3, z, 4, 1.2, 0.1, lm.yaw, hexRgb('#c8102e'));
    B.stone.box(x, CURB + h - 3, z, 1.2, 4, 0.1, lm.yaw, hexRgb('#c8102e'));
    // Helipad on the roof.
    const [hx, , hz] = this.p(lm, -20, 0, 0);
    B.stone.cylinder(hx, CURB + h + 0.05, hz, 8, 8, 0.25, 24, hexRgb('#3c4148'));
    B.stone.box(hx, CURB + h + 0.32, hz, 1, 0.02, 5, lm.yaw, hexRgb('#f2f2ee'));
    B.stone.box(hx - 1.5 * Math.cos(lm.yaw), CURB + h + 0.32, hz + 1.5 * Math.sin(lm.yaw), 1, 0.02, 5, lm.yaw, hexRgb('#f2f2ee'));
    B.stone.box(hx + 1.5 * Math.cos(lm.yaw), CURB + h + 0.32, hz - 1.5 * Math.sin(lm.yaw), 1, 0.02, 5, lm.yaw, hexRgb('#f2f2ee'));
    // Entrance canopy.
    B.metal.box(...this.p(lm, 12, 3.6, lm.d / 2 + 3), 16, 0.3, 6, lm.yaw, hexRgb('#c8102e'));
  }

  busHall(lm) {
    const B = this.B;
    const wall = hexRgb('#aab2b8');
    const H = 9;
    B.metal.box(lm.x, CURB + H / 2, lm.z, lm.w, H, lm.d, lm.yaw, wall);
    // Sawtooth roof.
    for (let k = 0; k < 8; k++) {
      const lx = -lm.w / 2 + 6 + k * 12;
      B.metal.box(...this.p(lm, lx, H + 1.2, 0), 1, 2.4, lm.d, lm.yaw, hexRgb('#7d868e'));
      B.glass.box(...this.p(lm, lx + 3, H + 1.1, 0), 5, 0.2, lm.d, lm.yaw + 0, [0.6, 0.7, 0.8]);
    }
    // Doors facing the yard.
    for (let k = 0; k < 6; k++) B.metal.box(...this.p(lm, -lm.w / 2 + 10 + k * 15.2, 2.8, -lm.d / 2 - 0.05), 4.5, 5.6, 0.1, lm.yaw, hexRgb('#f2b705'));
  }

  warehouse(lm) {
    const B = this.B;
    const col = [hexRgb('#c7ccd1'), hexRgb('#9fb3c2'), hexRgb('#d6cdb8')][Math.floor(Math.abs(lm.x * 7 + lm.z)) % 3];
    B.metal.box(lm.x, CURB + lm.h / 2, lm.z, lm.w, lm.h, lm.d, lm.yaw, col);
    for (let k = 0; k < 4; k++) B.metal.box(...this.p(lm, -lm.w / 2 + 8 + k * 12, 2.2, lm.d / 2 + 0.05), 3.5, 4.2, 0.1, lm.yaw, hexRgb('#4a5058'));
  }

  silo(lm) {
    for (let k = 0; k < 3; k++) this.B.metal.cylinder(lm.x + k * 5.5, CURB, lm.z, 2.5, 2.5, 20, 16, hexRgb('#d9dcdf'));
  }

  stadium(lm) {
    const B = this.B;
    const grey = hexRgb('#9ea4aa');
    // Running track and pitch lines.
    B.stone.box(lm.x, CURB + 0.02, lm.z, 130, 0.02, 84, 0, hexRgb('#b35a3c'));
    B.stone.box(lm.x, CURB + 0.03, lm.z, 105, 0.02, 68, 0, hexRgb('#3f8f3f'));
    const white = hexRgb('#f2f2ee');
    for (const dz of [-34, 34]) B.stone.box(lm.x, CURB + 0.045, lm.z + dz, 105, 0.01, 0.15, 0, white);
    for (const dx of [-52.5, 0, 52.5]) B.stone.box(lm.x + dx, CURB + 0.045, lm.z, 0.15, 0.01, 68, 0, white);
    // Stands (stepped) on both long sides with a roof.
    for (const side of [-1, 1]) {
      for (let r = 0; r < 6; r++) B.stone.box(lm.x, CURB + 0.5 + r * 0.7, lm.z + side * (46 + r * 0.9), 110, 1 + r * 1.4, 0.9, 0, r % 2 ? grey : hexRgb('#1b5fa8'));
      B.metal.box(lm.x, CURB + 8.5, lm.z + side * 49, 112, 0.3, 9, 0, hexRgb('#e8e8e4'));
      for (let x = -50; x <= 50; x += 25) B.metal.box(lm.x + x, CURB + 4.25, lm.z + side * 53, 0.4, 8.5, 0.4, 0, grey);
    }
    this.sign({ ...lm, yaw: 0 }, 'stadium', 0, 9.6, 53.6, 30, 1.8);
  }

  pond(lm) {
    const B = this.B;
    const seg = 28;
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(lm.x + Math.cos(a) * lm.rx, lm.z + Math.sin(a) * lm.rz);
    }
    B.water.polygon(pts, CURB + 0.03, 1);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      B.stone.box(lm.x + Math.cos(a) * (lm.rx + 0.3), CURB + 0.08, lm.z + Math.sin(a) * (lm.rz + 0.3), 4, 0.16, 0.6, -a + Math.PI / 2, hexRgb('#9d9486'));
    }
  }

  playground(lm) {
    const B = this.B;
    B.stone.box(lm.x, CURB + 0.03, lm.z, 22, 0.04, 16, 0, hexRgb('#d9c79b'));
    // Swing frame, slide, climbing frame.
    const red = hexRgb('#d9534f');
    const blue = hexRgb('#2e86c1');
    for (const dx of [-7, -3]) B.metal.box(lm.x + dx, CURB + 1.3, lm.z - 4, 0.12, 2.6, 0.12, 0, red);
    B.metal.box(lm.x - 5, CURB + 2.6, lm.z - 4, 4.2, 0.12, 0.12, 0, red);
    B.metal.box(lm.x + 4, CURB + 1, lm.z + 3, 1, 2, 1, 0, blue);
    B.metal.box(lm.x + 5.8, CURB + 1, lm.z + 3, 3.5, 0.1, 0.9, 0, hexRgb('#f1c40f'));
    B.metal.box(lm.x - 2, CURB + 0.9, lm.z + 4, 3, 1.8, 3, 0, hexRgb('#27ae60'));
  }

  setNight(f) {
    this.signMat.emissiveIntensity = f * 0.8;
  }
}
