// Street furniture: trees, lamps, traffic lights (live), signs, bus-stop furniture and props.
import * as THREE from 'three';
import { ROAD } from './config.js';
import { signalState, pedestrianWalk } from './citymap.js';
import { GeoBuilder, hexRgb } from './geo.js';
import * as T from './textures.js';
import { mulberry32 } from './util.js';

const CURB = ROAD.curbHeight;

function crownGeometry(seed, stretch = 1) {
  const rng = mulberry32(seed);
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const f = 0.82 + rng() * 0.3;
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * stretch, p.getZ(i) * f);
    }
    const s = k === 0 ? 1 : 0.7;
    g.scale(s, s, s);
    g.translate(k === 0 ? 0 : (rng() - 0.5) * 1.1, k === 0 ? 0 : 0.35 + rng() * 0.3, k === 0 ? 0 : (rng() - 0.5) * 1.1);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const merged = mergeSimple(parts);
  merged.computeVertexNormals();
  return merged;
}

function mergeSimple(geos) {
  const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off);
    off += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,220,160,1)');
  grad.addColorStop(0.4, 'rgba(255,200,140,0.45)');
  grad.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PropsView {
  constructor(city, layout, { shadows = true, treeDensity = 1 } = {}) {
    this.city = city;
    this.layout = layout;
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.shadows = shadows;
    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpS = new THREE.Vector3();
    this.tmpP = new THREE.Vector3();
    this.tmpC = new THREE.Color();
    this.#trees(treeDensity);
    this.#lamps();
    this.#signals();
    this.#signs();
    this.#stops();
    this.#props();
  }

  #mesh(geo, mat, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast && this.shadows;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.group.add(m);
    return m;
  }

  #instanced(geo, mat, count, { cast = true, receive = true } = {}) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.count = count;
    m.castShadow = cast && this.shadows;
    m.receiveShadow = receive;
    this.group.add(m);
    return m;
  }

  #set(mesh, i, x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1) {
    this.tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.tmpM.compose(this.tmpP.set(x, y, z), this.tmpQ, this.tmpS.set(sx, sy, sz));
    mesh.setMatrixAt(i, this.tmpM);
  }

  // ------------------------------------------------------------ trees
  #trees(density) {
    const trees = this.layout.trees.filter((t, i) => density >= 1 || (i * 0.618) % 1 < density);
    const kinds = { broad: [], lime: [], conifer: [] };
    for (const t of trees) (kinds[t.kind] || kinds.broad).push(t);
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.22, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const trunk = this.#instanced(trunkGeo, new THREE.MeshStandardMaterial({ color: '#5a4332', roughness: 1 }), trees.length);
    const crownMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });
    const geos = {
      broad: crownGeometry(5, 0.85),
      lime: crownGeometry(9, 1.25),
      conifer: (() => {
        const g = new THREE.ConeGeometry(1, 1, 7, 3);
        g.translate(0, 0.5, 0);
        return g;
      })(),
    };
    const rng = mulberry32(17);
    let ti = 0;
    for (const [kind, list] of Object.entries(kinds)) {
      if (!list.length) continue;
      const crowns = this.#instanced(geos[kind], crownMat, list.length);
      list.forEach((t, i) => {
        const s = t.scale;
        const base = CURB;
        if (kind === 'conifer') {
          this.#set(trunk, ti++, t.x, base, t.z, 0, 1, 2 * s, 1);
          this.#set(crowns, i, t.x, base + 1.4 * s, t.z, t.rot, 2.2 * s, 7.5 * s, 2.2 * s);
          crowns.setColorAt(i, this.tmpC.setHSL(0.36 + rng() * 0.05, 0.42, 0.2 + rng() * 0.06));
        } else {
          const th = kind === 'lime' ? 3.2 : 2.6;
          this.#set(trunk, ti++, t.x, base, t.z, 0, 1.1 * s, th * s + 1.5, 1.1 * s);
          const r = (kind === 'lime' ? 2.5 : 2.9) * s;
          this.#set(crowns, i, t.x, base + (th + 1.8) * s + 1, t.z, t.rot, r, r, r);
          crowns.setColorAt(i, this.tmpC.setHSL(0.24 + rng() * 0.07, 0.45 + rng() * 0.15, 0.24 + rng() * 0.1));
        }
      });
      crowns.instanceMatrix.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    }
    trunk.count = ti;
    trunk.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ street lamps
  #lamps() {
    const L = this.layout.lamps;
    const gb = new GeoBuilder();
    const grey = hexRgb('#4a5058');
    gb.cylinder(0, 0, 0, 0.09, 0.06, 7, 8, grey);
    gb.box(0, 7.0, 0.55, 0.08, 0.08, 1.2, 0, grey);
    gb.box(0, 6.92, 1.15, 0.36, 0.14, 0.62, 0, grey);
    const poleMesh = this.#instanced(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }), L.length);
    const headGeo = new THREE.BoxGeometry(0.3, 0.03, 0.56);
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0 });
    const heads = this.#instanced(headGeo, this.lampMat, L.length, { cast: false });
    // Light pools on the ground at night.
    this.poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = this.#instanced(poolGeo, this.poolMat, L.length, { cast: false, receive: false });
    L.forEach((l, i) => {
      this.#set(poleMesh, i, l.x, CURB, l.z, l.yaw);
      const hx = l.x + Math.sin(l.yaw) * 1.15;
      const hz = l.z + Math.cos(l.yaw) * 1.15;
      this.#set(heads, i, hx, CURB + 6.84, hz, l.yaw);
      this.#set(pools, i, hx + Math.sin(l.yaw) * 1.2, 0.05, hz + Math.cos(l.yaw) * 1.2, 0, 17, 1, 17);
    });
    poleMesh.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    this.pools = pools;
  }

  // ------------------------------------------------------------ traffic lights
  #signals() {
    const poles = this.layout.signalPoles;
    const peds = this.layout.props.filter((p) => p.type === 'pedSignal');
    const gb = new GeoBuilder();
    const dark = hexRgb('#2a2d31');
    const grey = hexRgb('#6d737a');
    const white = hexRgb('#e8e8e4');
    for (const p of poles) {
      const s = Math.sin(p.yaw);
      const c = Math.cos(p.yaw);
      gb.cylinder(p.x, CURB, p.z, 0.075, 0.07, 3.75, 8, grey);
      // Housing, backplate with white border, visors.
      const hx = p.x + s * 0.14;
      const hz = p.z + c * 0.14;
      gb.box(hx, CURB + 3.1, hz, 0.36, 1.05, 0.24, p.yaw, dark);
      gb.box(hx - s * 0.13, CURB + 3.1, hz - c * 0.13, 0.62, 1.3, 0.03, p.yaw, white);
      gb.box(hx - s * 0.11, CURB + 3.1, hz - c * 0.11, 0.56, 1.24, 0.03, p.yaw, dark);
      for (let k = 0; k < 3; k++) gb.box(hx + s * 0.2, CURB + 3.43 - k * 0.33 + 0.1, hz + c * 0.2, 0.3, 0.03, 0.16, p.yaw, dark);
    }
    for (const p of peds) {
      gb.cylinder(p.x, CURB, p.z, 0.06, 0.05, 2.7, 6, grey);
      gb.box(p.x, CURB + 2.35, p.z, 0.3, 0.62, 0.2, p.yaw, dark);
    }
    this.#mesh(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }));
    // Lamps: one instance per light, colour updated every frame.
    const lampGeo = new THREE.CircleGeometry(0.105, 16);
    this.signalLampMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const n = poles.length * 3 + peds.length * 2;
    this.signalLamps = this.#instanced(lampGeo, this.signalLampMat, n, { cast: false, receive: false });
    this.lampInfo = [];
    let i = 0;
    for (const p of poles) {
      const s = Math.sin(p.yaw);
      const c = Math.cos(p.yaw);
      const hx = p.x + s * 0.265;
      const hz = p.z + c * 0.265;
      ['red', 'yellow', 'green'].forEach((col, k) => {
        this.#set(this.signalLamps, i, hx, CURB + 3.43 - k * 0.33, hz, p.yaw);
        this.lampInfo.push({ kind: 'car', node: p.node, group: p.group, col });
        i++;
      });
    }
    for (const p of peds) {
      const s = Math.sin(p.yaw);
      const c = Math.cos(p.yaw);
      const cr = this.city.crossings[p.crossing];
      ['red', 'green'].forEach((col, k) => {
        this.#set(this.signalLamps, i, p.x + s * 0.105, CURB + 2.5 - k * 0.3, p.z + c * 0.105, p.yaw, 0.95, 0.95, 1);
        this.lampInfo.push({ kind: 'ped', node: cr.node, group: cr.group, col });
        i++;
      });
    }
    this.signalLamps.instanceMatrix.needsUpdate = true;
    this.lampColors = {
      red: [new THREE.Color('#ff2a1a').multiplyScalar(2.2), new THREE.Color('#3a0d0a')],
      yellow: [new THREE.Color('#ffb400').multiplyScalar(2.2), new THREE.Color('#3a2a06')],
      green: [new THREE.Color('#22ff7a').multiplyScalar(2), new THREE.Color('#06301a')],
    };
    this.updateSignals(0);
  }

  updateSignals(t) {
    const nodes = this.city.nodes;
    for (let i = 0; i < this.lampInfo.length; i++) {
      const L = this.lampInfo[i];
      const sig = nodes[L.node].signal;
      let on;
      if (L.kind === 'car') {
        const st = signalState(sig, L.group, t);
        on = (L.col === 'red' && (st === 'red' || st === 'redyellow')) || (L.col === 'yellow' && (st === 'yellow' || st === 'redyellow')) || (L.col === 'green' && st === 'green');
      } else {
        const walk = pedestrianWalk(sig, L.group, t);
        on = L.col === 'green' ? walk : !walk;
      }
      this.signalLamps.setColorAt(i, this.lampColors[L.col][on ? 0 : 1]);
    }
    this.signalLamps.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------ traffic signs
  #signs() {
    const { texture, cells } = T.signAtlas();
    this.signAtlas = { texture, cells };
    const face = new GeoBuilder();
    const poles = new GeoBuilder();
    const grey = hexRgb('#8d9297');
    const signs = this.layout.signPoles.slice();
    // Zebra crossing signs at both ends.
    for (const c of this.city.crossings) {
      if (c.kind !== 'zebra') continue;
      for (const sgn of [-1, 1]) {
        const ext = sgn < 0 ? c.extNeg : c.extPos;
        signs.push({ type: 'zebra', x: c.x + c.ux * sgn * (ext + 0.8) + c.uz * 2.6 * sgn, z: c.z + c.uz * sgn * (ext + 0.8) - c.ux * 2.6 * sgn, yaw: Math.atan2(-c.uz * sgn, c.ux * sgn) });
      }
    }
    for (const sg of signs) {
      const cell = cells[sg.type];
      if (!cell) continue;
      const s = Math.sin(sg.yaw);
      const c = Math.cos(sg.yaw);
      const h = sg.type === 'zone30' || sg.type === 'zone30end' ? 2.35 : 2.3;
      const size = sg.type === 'zone30' || sg.type === 'zone30end' ? 0.75 : 0.72;
      poles.cylinder(sg.x, CURB, sg.z, 0.04, 0.035, h + size / 2, 6, grey);
      const cx = sg.x + s * 0.05;
      const cz = sg.z + c * 0.05;
      const lx = c * (size / 2);
      const lz = -s * (size / 2);
      const y0 = CURB + h - size / 2;
      const y1 = CURB + h + size / 2;
      const [u0, v0, u1, v1] = cell;
      // Front faces the traffic (+z local = yaw direction). Left edge as seen by the viewer.
      face.quad([cx + lx, y0, cz + lz], [cx - lx, y0, cz - lz], [cx - lx, y1, cz - lz], [cx + lx, y1, cz + lz], [s, 0, c], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      poles.quad([cx - lx - s * 0.01, y0, cz - lz - c * 0.01], [cx + lx - s * 0.01, y0, cz + lz - c * 0.01], [cx + lx - s * 0.01, y1, cz + lz - c * 0.01], [cx - lx - s * 0.01, y1, cz - lz - c * 0.01], [-s, 0, -c], undefined, hexRgb('#a8adb2'));
    }
    this.#mesh(face.build(), new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.5, roughness: 0.5 }), { cast: false });
    this.#mesh(poles.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }));
  }

  // ------------------------------------------------------------ bus stops
  #stops() {
    const stops = this.layout.stopFurniture;
    const { texture, cells } = this.signAtlas;
    // Stop name atlas: 4 × 16 cells of 256 × 64.
    const nc = document.createElement('canvas');
    nc.width = 1024;
    nc.height = 1024;
    const g = nc.getContext('2d');
    const names = [...new Set(stops.map((s) => s.name))];
    const nameUV = {};
    names.forEach((n, i) => {
      const x = (i % 4) * 256;
      const y = Math.floor(i / 4) * 64;
      g.fillStyle = '#ffffff';
      g.fillRect(x, y, 256, 64);
      g.fillStyle = '#128a3a';
      g.fillRect(x, y, 56, 64);
      g.fillStyle = '#f5c400';
      g.beginPath();
      g.arc(x + 28, y + 32, 22, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#128a3a';
      g.font = 'bold 34px Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('H', x + 28, y + 34);
      g.fillStyle = '#1b1b1b';
      g.font = 'bold 30px Barlow, Arial, sans-serif';
      g.textAlign = 'left';
      g.fillText(n, x + 66, y + 34, 182);
      nameUV[n] = [x / 1024, 1 - (y + 64) / 1024, (x + 256) / 1024, 1 - y / 1024];
    });
    const nameTex = new THREE.CanvasTexture(nc);
    nameTex.colorSpace = THREE.SRGBColorSpace;
    nameTex.anisotropy = 4;

    const frame = new GeoBuilder();
    const glass = new GeoBuilder();
    const signs = new GeoBuilder();
    const names2 = new GeoBuilder();
    const steel = hexRgb('#59616b');
    const wood = hexRgb('#8a6a4a');
    const yellow = hexRgb('#f2c230');
    for (const st of stops) {
      const yaw = st.yaw; // along the lane
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      // Pole with H sign facing along the street (both ways).
      const [px, pz] = st.pole;
      frame.cylinder(px, CURB, pz, 0.05, 0.05, 3.1, 8, hexRgb('#c9ccd0'));
      const [u0, v0, u1, v1] = cells.busStop;
      const r = 0.34;
      for (const dir of [1, -1]) {
        const nx = s * dir;
        const nz = c * dir;
        const lx = c * r * dir;
        const lz = -s * r * dir;
        const y0 = CURB + 2.7 - r;
        const y1 = CURB + 2.7 + r;
        signs.quad([px + nx * 0.03 + lx, y0, pz + nz * 0.03 + lz], [px + nx * 0.03 - lx, y0, pz + nz * 0.03 - lz], [px + nx * 0.03 - lx, y1, pz + nz * 0.03 - lz], [px + nx * 0.03 + lx, y1, pz + nz * 0.03 + lz], [nx, 0, nz], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      }
      // Timetable box.
      frame.box(px + (c * 0.12), CURB + 1.55, pz - s * 0.12, 0.08, 0.55, 0.4, yaw, yellow);
      // Shelter: roof, back wall glass, side glass, posts, bench. Local frame: x along street, z towards the curb.
      const [sx, sz] = st.shelter;
      // Shelter frame: a = along the street, q = from the shelter towards the curb.
      const ax = s;
      const az = c;
      const toCurbX = px - sx;
      const toCurbZ = pz - sz;
      const dAlong = toCurbX * ax + toCurbZ * az;
      let qx = toCurbX - ax * dAlong;
      let qz = toCurbZ - az * dAlong;
      const ql = Math.hypot(qx, qz) || 1;
      qx /= ql;
      qz /= ql;
      const L = 2.6;
      const D = 0.75;
      const P = (a, d, y) => [sx + ax * a + qx * d, y, sz + az * a + qz * d];
      // Posts
      for (const a of [-L, L]) for (const d of [-D, D]) frame.box(...P(a, d, CURB + 1.25), 0.07, 2.5, 0.07, yaw, steel);
      // Roof
      frame.box(...P(0, 0, CURB + 2.55), 5.5, 0.12, 1.8, yaw, steel);
      // Bench
      frame.box(...P(0, -D + 0.35, CURB + 0.45), 3.2, 0.06, 0.4, yaw, wood);
      frame.box(...P(-1.4, -D + 0.35, CURB + 0.22), 0.06, 0.44, 0.35, yaw, steel);
      frame.box(...P(1.4, -D + 0.35, CURB + 0.22), 0.06, 0.44, 0.35, yaw, steel);
      // Glass back wall and one side panel with an advertising poster.
      glass.box(...P(0, -D, CURB + 1.35), 5.1, 2.1, 0.02, yaw, [0.75, 0.85, 0.9]);
      glass.box(...P(-L, 0, CURB + 1.35), 0.02, 2.1, 1.4, yaw, [0.75, 0.85, 0.9]);
      frame.box(...P(L, 0, CURB + 1.35), 0.06, 2.0, 1.3, yaw, hexRgb('#2b6fb3'));
      // Name board on the roof edge facing the street.
      const [n0, m0, n1, m1] = nameUV[st.name];
      const bx = P(0, D + 0.02, 0);
      const hw = 1.6;
      // Seen from the street the lane direction points to the viewer's left, so the text runs against it.
      names2.quad([bx[0] + ax * hw, CURB + 2.62, bx[2] + az * hw], [bx[0] - ax * hw, CURB + 2.62, bx[2] - az * hw], [bx[0] - ax * hw, CURB + 3.02, bx[2] - az * hw], [bx[0] + ax * hw, CURB + 3.02, bx[2] + az * hw], [qx, 0, qz], [[n0, m0], [n1, m0], [n1, m1], [n0, m1]]);
    }
    this.#mesh(frame.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }));
    this.#mesh(glass.build(), new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false }), { cast: false });
    this.#mesh(signs.build(), new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.5, roughness: 0.4 }), { cast: false });
    this.stopNameMat = new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.5, emissiveMap: nameTex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
    this.#mesh(names2.build(), this.stopNameMat, { cast: false });
  }

  // ------------------------------------------------------------ small props
  #props() {
    const gb = new GeoBuilder();
    const rng = mulberry32(5);
    const col = (h) => hexRgb(h);
    const stallCols = ['#c0392b', '#2e86c1', '#27ae60', '#f39c12', '#8e44ad'];
    const litfass = [];
    for (const p of this.layout.props) {
      const s = Math.sin(p.yaw || 0);
      const c = Math.cos(p.yaw || 0);
      const Y = CURB;
      switch (p.type) {
        case 'bench':
          gb.box(p.x, Y + 0.45, p.z, 1.8, 0.06, 0.45, p.yaw, col('#8a6a4a'));
          gb.box(p.x - s * 0.2, Y + 0.72, p.z - c * 0.2, 1.8, 0.4, 0.05, p.yaw, col('#8a6a4a'));
          gb.box(p.x, Y + 0.22, p.z, 1.6, 0.44, 0.06, p.yaw, col('#3d4248'));
          break;
        case 'bin':
          gb.cylinder(p.x, Y, p.z, 0.25, 0.27, 0.95, 8, col('#e4572e'));
          break;
        case 'bollard':
          gb.cylinder(p.x, Y, p.z, 0.08, 0.08, 0.9, 6, col('#9aa0a6'));
          break;
        case 'bikes':
          for (let k = 0; k < 4; k++) {
            const o = (k - 1.5) * 0.7;
            gb.box(p.x + c * o, Y + 0.45, p.z - s * o, 0.05, 0.5, 1.6, p.yaw, col('#b0b6bb'));
            if (rng() < 0.7) gb.box(p.x + c * o + 0.1 * c, Y + 0.5, p.z - s * o, 0.05, 0.9, 1.7, p.yaw, col(['#1f3a5f', '#7a1f24', '#2d2d2d', '#3d5a44'][k]));
          }
          break;
        case 'litfass':
          litfass.push(p);
          break;
        case 'stall': {
          const sc = col(stallCols[p.color % stallCols.length]);
          gb.box(p.x, Y + 0.45, p.z, 2.6, 0.9, 1.9, 0, col('#8a6a4a'));
          gb.box(p.x, Y + 2.3, p.z, 3.2, 0.1, 2.5, 0, sc);
          for (const [dx, dz] of [
            [-1.4, -1.0],
            [1.4, -1.0],
            [-1.4, 1.0],
            [1.4, 1.0],
          ])
            gb.box(p.x + dx, Y + 1.15, p.z + dz, 0.06, 2.3, 0.06, 0, col('#dddddd'));
          for (let k = 0; k < 6; k++) gb.box(p.x - 1 + k * 0.4, Y + 0.98, p.z + 0.4, 0.3, 0.16, 0.5, 0, col(['#e74c3c', '#f1c40f', '#27ae60', '#e67e22'][k % 4]));
          break;
        }
        case 'goal':
          // Posts 7.32 m apart across the goal (local x), crossbar at 2.44 m.
          gb.box(p.x + c * 3.66, Y + 1.22, p.z - s * 3.66, 0.1, 2.44, 0.1, p.yaw, col('#ffffff'));
          gb.box(p.x - c * 3.66, Y + 1.22, p.z + s * 3.66, 0.1, 2.44, 0.1, p.yaw, col('#ffffff'));
          gb.box(p.x, Y + 2.44, p.z, 7.42, 0.1, 0.1, p.yaw, col('#ffffff'));
          break;
        case 'floodlight':
          gb.cylinder(p.x, Y, p.z, 0.25, 0.15, 22, 8, col('#8d9297'));
          gb.box(p.x, Y + 22.5, p.z, 3, 1.8, 0.4, p.yaw, col('#50555b'));
          break;
        case 'parkedCar':
        case 'taxi': {
          const colors = ['#e7e7e4', '#1d1f24', '#8c9197', '#b8bcc0', '#2f4d7a', '#7a1f24', '#3d5a44', '#c4c7ca', '#5b6068', '#a3782e', '#1f3a5f', '#d8d2c4'];
          const cc = col(p.type === 'taxi' ? '#efe6c9' : colors[p.color % colors.length]);
          gb.box(p.x, Y + 0.55, p.z, 1.8, 0.7, 4.4, p.yaw, cc);
          gb.box(p.x, Y + 1.12, p.z - c * 0.2 - s * 0, 1.6, 0.5, 2.3, p.yaw, col('#20262c'));
          gb.box(p.x, Y + 1.38, p.z - c * 0.2, 1.62, 0.05, 2.1, p.yaw, cc);
          if (p.type === 'taxi') gb.box(p.x, Y + 1.5, p.z, 0.5, 0.15, 0.2, p.yaw, col('#f2c230'));
          break;
        }
        case 'parkedBus': {
          const tints = ['#f2b705', '#f2b705', '#f2f2ee'];
          const bc = col(tints[p.tint % tints.length]);
          gb.box(p.x, Y + 0.95, p.z, 2.5, 1.3, 12, p.yaw, bc);
          gb.box(p.x, Y + 2.15, p.z, 2.52, 1.1, 11.6, p.yaw, col('#1c232b'));
          gb.box(p.x, Y + 2.95, p.z, 2.5, 0.5, 12, p.yaw, col('#f4f4f0'));
          break;
        }
        case 'truckTrailer':
          gb.box(p.x, Y + 2.2, p.z, 2.5, 2.8, 13, p.yaw, col(['#e8e8e4', '#2f4d7a', '#c0392b'][Math.floor(rng() * 3)]));
          gb.box(p.x, Y + 0.6, p.z, 2.3, 0.5, 12, p.yaw, col('#2a2a2a'));
          break;
        default:
          break;
      }
    }
    this.#mesh(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 }));
    // Advertising columns (Litfaßsäulen) with a poster texture.
    if (litfass.length) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 256;
      const g = c.getContext('2d');
      const posters = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#ffb703', '#8ecae6', '#fb8500', '#2a9d8f'];
      for (let i = 0; i < 8; i++) {
        g.fillStyle = posters[i];
        g.fillRect(i * 64, 0, 64, 256);
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.font = 'bold 20px Barlow, Arial';
        g.save();
        g.translate(i * 64 + 32, 128);
        g.rotate(-Math.PI / 2);
        g.textAlign = 'center';
        g.fillText(['KONZERT', 'THEATER', 'ZIRKUS', 'MUSEUM', 'KINO', 'STADTFEST', 'FLOHMARKT', 'OPER'][i], 0, 7);
        g.restore();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const geo = new THREE.CylinderGeometry(0.6, 0.6, 2.6, 16, 1, true);
      geo.translate(0, 1.3 + CURB, 0);
      const inst = this.#instanced(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }), litfass.length);
      const capGeo = new THREE.SphereGeometry(0.66, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      capGeo.translate(0, 2.6 + CURB, 0);
      const caps = this.#instanced(capGeo, new THREE.MeshStandardMaterial({ color: '#2f5d3a', roughness: 0.6 }), litfass.length);
      litfass.forEach((p, i) => {
        this.#set(inst, i, p.x, 0, p.z, p.yaw);
        this.#set(caps, i, p.x, 0, p.z, 0);
      });
      inst.instanceMatrix.needsUpdate = true;
      caps.instanceMatrix.needsUpdate = true;
    }
  }

  setNight(f) {
    this.lampMat.emissiveIntensity = f > 0.05 ? 2 + f * 6 : 0;
    this.poolMat.opacity = f * 0.9;
    this.pools.visible = f > 0.05;
    this.stopNameMat.emissiveIntensity = f * 0.9;
  }
}
