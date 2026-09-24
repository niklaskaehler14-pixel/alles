// Procedural sports coupe: lofted body, glass cabin, detailed wheels, lights and a cockpit.
// Local frame: +z forward, +x left, y up, origin on the ground below the centre of gravity.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { keyframes, clamp } from './util.js';
import * as TX from './textures.js';

const HALF_LEN = 2.24;
const AXLE_F = 1.22;
const AXLE_R = -1.38;
const WHEEL_X = 0.81;
const WHEEL_R = 0.34;
const ARCH_R = 0.43;
const STATIONS = 84;
const SECTION = 32;
const CAB_Z0 = -1.62;
const CAB_Z1 = 0.64;
const ROOF_Z0 = -0.86;
const ROOF_Z1 = -0.06;
const TOP_REGION = 0.72;

const bodyTop = keyframes([
  [-2.24, 0.5],
  [-2.18, 0.78],
  [-2.04, 0.9],
  [-1.75, 0.955],
  [-1.45, 0.96],
  [-1.0, 0.945],
  [0, 0.925],
  [0.5, 0.905],
  [0.85, 0.862],
  [1.3, 0.795],
  [1.8, 0.705],
  [2.1, 0.605],
  [2.24, 0.44],
]);
const bodyBottom = keyframes([
  [-2.24, 0.42],
  [-2.15, 0.27],
  [-1.9, 0.2],
  [1.9, 0.18],
  [2.15, 0.25],
  [2.24, 0.36],
]);
const cabinLift = keyframes([
  [CAB_Z0, 0],
  [-1.36, 0.1],
  [-1.05, 0.25],
  [-0.82, 0.325],
  [-0.4, 0.36],
  [-0.06, 0.352],
  [0.18, 0.27],
  [0.44, 0.11],
  [CAB_Z1, 0],
]);

function halfWidth(z) {
  const p = z > 0 ? 3.6 : 4.2;
  const t = Math.min(1, Math.abs(z) / HALF_LEN);
  let w = 0.925 * Math.pow(Math.max(0, 1 - Math.pow(t, p)), 1 / p);
  // Fender flares over the wheels
  w += 0.045 * Math.exp(-(((z - AXLE_F) / 0.5) ** 2)) + 0.055 * Math.exp(-(((z - AXLE_R) / 0.52) ** 2));
  return w;
}

function bottomAt(z) {
  let b = bodyBottom(z);
  for (const zc of [AXLE_F, AXLE_R]) {
    const dz = z - zc;
    if (Math.abs(dz) < ARCH_R) b = Math.max(b, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dz * dz) - 0.02);
  }
  return b;
}

function sectionPoint(z, k, out) {
  const theta = -Math.PI / 2 + (k / SECTION) * Math.PI * 2;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const w = halfWidth(z);
  const top = bodyTop(z);
  const bot = Math.min(bottomAt(z), top - 0.02);
  const yc = (top + bot) / 2;
  const hh = (top - bot) / 2;
  const nx = s > 0 ? 3.0 : 7;
  const ny = s > 0 ? 3.4 : 7;
  let x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / nx);
  const y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / ny);
  x *= 1 - 0.11 * Math.max(0, s) ** 2;
  out[0] = x;
  out[1] = y;
  out[2] = s;
  return out;
}

function inTop(k) {
  const theta = -Math.PI / 2 + (k / SECTION) * Math.PI * 2;
  return Math.sin(theta) > TOP_REGION;
}

let shared = null;

function buildShared() {
  const stationZ = [];
  for (let i = 0; i <= STATIONS; i++) stationZ.push(-HALF_LEN + (i / STATIONS) * HALF_LEN * 2);
  // Insert exact cabin boundaries so body opening and cabin share stations.
  for (const z of [CAB_Z0, CAB_Z1]) if (!stationZ.some((v) => Math.abs(v - z) < 1e-6)) stationZ.push(z);
  stationZ.sort((a, b) => a - b);
  const NS = stationZ.length;

  // ---- body loft
  const pos = [];
  const uv = [];
  const idx = [];
  const p = [0, 0, 0];
  for (let i = 0; i < NS; i++) {
    const z = stationZ[i];
    for (let k = 0; k <= SECTION; k++) {
      sectionPoint(z, k % SECTION, p);
      pos.push(p[0], p[1], z);
      uv.push((z + HALF_LEN) / (HALF_LEN * 2), k / SECTION);
    }
  }
  const ring = SECTION + 1;
  const inCab = (z) => z >= CAB_Z0 - 1e-6 && z <= CAB_Z1 + 1e-6;
  for (let i = 0; i < NS - 1; i++) {
    const cab = inCab(stationZ[i]) && inCab(stationZ[i + 1]);
    for (let k = 0; k < SECTION; k++) {
      if (cab && inTop(k) && inTop(k + 1)) continue;
      const a = i * ring + k;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  body.setIndex(idx);
  body.computeVertexNormals();

  // ---- cabin loft on the body opening
  const topKs = [];
  for (let k = 0; k <= SECTION; k++) if (inTop(k)) topKs.push(k);
  const nC = topKs.length;
  const cPos = [];
  const cUv = [];
  const cabStations = stationZ.filter(inCab);
  for (const z of cabStations) {
    const lift = Math.max(0, cabinLift(z));
    for (let j = 0; j < nC; j++) {
      sectionPoint(z, topKs[j], p);
      const edge = j === 0 || j === nC - 1;
      let x = p[0];
      let y = p[1];
      if (!edge) {
        y += lift;
        x *= 1 - 0.2 * clamp(lift / 0.3, 0, 1);
      }
      cPos.push(x, y, z);
      cUv.push((z + HALF_LEN) / (HALF_LEN * 2), topKs[j] / SECTION);
    }
  }
  const paintIdx = [];
  const glassIdx = [];
  for (let i = 0; i < cabStations.length - 1; i++) {
    const zm = (cabStations[i] + cabStations[i + 1]) / 2;
    for (let j = 0; j < nC - 1; j++) {
      const side = j === 0 || j === nC - 2;
      const nearSide = j === 1 || j === nC - 3;
      let paint = false;
      if (!side && zm > ROOF_Z0 && zm < ROOF_Z1) paint = true; // roof
      if (nearSide && zm >= ROOF_Z1) paint = true; // A-pillars
      if (nearSide && zm <= ROOF_Z0 && zm > CAB_Z0 + 0.25) paint = true; // C-pillars (fastback edge)
      if (side && zm > -0.64 && zm < -0.52) paint = true; // B-pillar
      if (side && zm < ROOF_Z0 - 0.08) paint = true; // rear quarter
      const a = i * nC + j;
      const b = a + 1;
      const c = a + nC;
      const d = c + 1;
      (paint ? paintIdx : glassIdx).push(a, b, c, b, d, c);
    }
  }
  const cabin = new THREE.BufferGeometry();
  cabin.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  cabin.setAttribute('uv', new THREE.Float32BufferAttribute(cUv, 2));
  cabin.setIndex([...paintIdx, ...glassIdx]);
  cabin.addGroup(0, paintIdx.length, 0);
  cabin.addGroup(paintIdx.length, glassIdx.length, 1);
  cabin.computeVertexNormals();

  // Inner lining of the painted cabin parts (visible from the cockpit).
  const lining = new THREE.BufferGeometry();
  const lPos = new Float32Array(cPos.length);
  const cn = cabin.attributes.normal.array;
  for (let i = 0; i < cPos.length; i += 3) {
    lPos[i] = cPos[i] - cn[i] * 0.012;
    lPos[i + 1] = cPos[i + 1] - cn[i + 1] * 0.012;
    lPos[i + 2] = cPos[i + 2] - cn[i + 2] * 0.012;
  }
  lining.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
  const rev = [];
  for (let i = 0; i < paintIdx.length; i += 3) rev.push(paintIdx[i], paintIdx[i + 2], paintIdx[i + 1]);
  lining.setIndex(rev);
  lining.computeVertexNormals();

  // ---- wheel parts (axis along x)
  const tireProfile = [
    [0.232, -0.118],
    [0.3, -0.126],
    [0.328, -0.118],
    [0.34, -0.095],
    [0.342, 0],
    [0.34, 0.095],
    [0.328, 0.118],
    [0.3, 0.126],
    [0.232, 0.118],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(tireProfile, 36);
  tire.rotateZ(Math.PI / 2);
  const barrel = new THREE.CylinderGeometry(0.234, 0.234, 0.2, 28, 1, true);
  barrel.rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(0.228, 0.014, 8, 36);
  lip.rotateY(Math.PI / 2);
  lip.translate(0.1, 0, 0);
  const spokes = [];
  for (let s = 0; s < 5; s++) {
    for (const off of [-0.09, 0.09]) {
      const sp = new THREE.BoxGeometry(0.03, 0.2, 0.034);
      sp.translate(0, 0.12, 0);
      sp.rotateX(off);
      sp.rotateX((s / 5) * Math.PI * 2);
      sp.translate(0.085, 0, 0);
      spokes.push(sp);
    }
  }
  const hub = new THREE.CylinderGeometry(0.055, 0.06, 0.05, 20);
  hub.rotateZ(Math.PI / 2);
  hub.translate(0.09, 0, 0);
  const rimFace = mergeGeometries([lip, ...spokes, hub].map((g) => (g.index ? g.toNonIndexed() : g)));
  const disc = new THREE.CylinderGeometry(0.19, 0.19, 0.028, 28);
  disc.rotateZ(Math.PI / 2);
  disc.translate(-0.01, 0, 0);
  const caliper = new THREE.BoxGeometry(0.07, 0.15, 0.1);
  caliper.translate(0.02, 0.13, -0.08);

  return { body, cabin, lining, tire, barrel, rimFace, disc, caliper, HALF_LEN, merged: new Map() };
}

function sharedMaterials() {
  if (shared.materials) return shared.materials;
  shared.materials = {
    glass: new THREE.MeshPhysicalMaterial({ color: '#16202a', metalness: 0.35, roughness: 0.03, transparent: true, opacity: 0.72, envMapIntensity: 2.4, clearcoat: 1 }),
    glassDark: new THREE.MeshPhysicalMaterial({ color: '#06080b', metalness: 0.3, roughness: 0.05, envMapIntensity: 1.6, clearcoat: 1 }),
    trim: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.55, metalness: 0.2 }),
    carbon: new THREE.MeshStandardMaterial({ color: '#1b1d21', roughness: 0.3, metalness: 0.5 }),
    tire: new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 1, roughness: 0.22 }),
    rimDark: new THREE.MeshStandardMaterial({ color: '#2b2e33', metalness: 0.9, roughness: 0.35 }),
    disc: new THREE.MeshStandardMaterial({ color: '#77787a', metalness: 0.85, roughness: 0.45 }),
    caliper: new THREE.MeshStandardMaterial({ color: '#d22c1f', roughness: 0.4, metalness: 0.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#d8dade', metalness: 1, roughness: 0.12 }),
    interior: new THREE.MeshStandardMaterial({ color: '#1c1d21', roughness: 0.95, side: THREE.BackSide }),
    interiorFront: new THREE.MeshStandardMaterial({ color: '#202227', roughness: 0.85 }),
    lining: new THREE.MeshStandardMaterial({ color: '#2a2b2f', roughness: 0.95 }),
    seat: new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.8 }),
    seatAccent: new THREE.MeshStandardMaterial({ color: '#b3261e', roughness: 0.7 }),
    suit: new THREE.MeshStandardMaterial({ color: '#23324a', roughness: 0.8 }),
    helmet: new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.25, metalness: 0.1 }),
    visor: new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.05, metalness: 0.6 }),
  };
  for (const [k, m] of Object.entries(shared.materials)) m.name = k;
  return shared.materials;
}

// Merge all single-material meshes below `group` (outside `exclude` subtrees) into one mesh per material.
// Merged geometry is cached so every car of the same detail level shares it.
function mergeByMaterial(group, cacheKey, exclude) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    for (let p = o; p && p !== group; p = p.parent) if (exclude.includes(p)) return;
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(o);
  });
  for (const [mat, list] of buckets) {
    if (list.length < 2) continue;
    const key = `${cacheKey}:${mat.name || mat.uuid}`;
    let geo = shared.merged.get(key);
    if (!geo) {
      const parts = list.map((m) => {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        return g;
      });
      geo = mergeGeometries(parts);
      if (!geo) continue;
      geo.computeBoundingSphere();
      shared.merged.set(key, geo);
    }
    const merged = new THREE.Mesh(geo, mat);
    merged.castShadow = list.some((m) => m.castShadow);
    merged.receiveShadow = true;
    group.add(merged);
    for (const m of list) m.parent.remove(m);
  }
}

function mesh(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export class CarModel {
  constructor({ color = '#c1121f', stripe = '#f4f4f0', number = 7, plate = 'NK·GT 7', detail = 'high', glassOpacity = 0.72 } = {}) {
    if (!shared) shared = buildShared();
    const M = sharedMaterials();
    this.detail = detail;
    this.root = new THREE.Group();
    // tilt follows the ground plane, chassis adds the sprung body motion on top
    this.tilt = new THREE.Group();
    this.chassis = new THREE.Group();
    this.root.add(this.tilt);
    this.tilt.add(this.chassis);

    const paintTex = TX.carPaintTexture(color, stripe, number);
    this.paint = new THREE.MeshPhysicalMaterial({ name: 'paint', map: paintTex, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.25 });
    const glass = detail === 'high' ? M.glass.clone() : M.glassDark;
    if (detail === 'high') glass.opacity = glassOpacity;
    this.glass = glass;

    this.chassis.add(mesh(shared.body, this.paint));
    const cabin = new THREE.Mesh(shared.cabin, [this.paint, glass]);
    cabin.castShadow = true;
    this.chassis.add(cabin);
    if (detail === 'high') this.chassis.add(mesh(shared.lining, M.lining, false));

    this.#addDetails(M);
    this.#addLights();
    this.wheels = [];
    const wheelPos = [
      [WHEEL_X, AXLE_F, true],
      [-WHEEL_X, AXLE_F, true],
      [WHEEL_X, AXLE_R, false],
      [-WHEEL_X, AXLE_R, false],
    ];
    for (const [x, z, front] of wheelPos) this.wheels.push(this.#makeWheel(M, x, z, front));
    if (detail === 'high') this.#addInterior(M, plate);
    this.#addPlates(plate);
    // Collapse static parts into one mesh per material to keep draw calls low.
    const keep = [this.interior, this.driver].filter(Boolean);
    mergeByMaterial(this.chassis, `${detail}:chassis`, keep);
    if (this.interior) mergeByMaterial(this.interior, `${detail}:interior`, [this.steeringWheel]);
    if (this.steeringWheel) mergeByMaterial(this.steeringWheel, `${detail}:wheel`, []);
    if (this.driver) mergeByMaterial(this.driver, `${detail}:driver`, []);
  }

  #addDetails(M) {
    const c = this.chassis;
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      c.add(m);
      return m;
    };
    // Front intake, splitter, side skirts, diffuser
    add(new THREE.BoxGeometry(1.0, 0.17, 0.12), M.trim, 0, 0.33, 2.15);
    add(new THREE.BoxGeometry(0.34, 0.12, 0.1), M.trim, 0.58, 0.3, 2.06, 0, 0.35);
    add(new THREE.BoxGeometry(0.34, 0.12, 0.1), M.trim, -0.58, 0.3, 2.06, 0, -0.35);
    add(new THREE.BoxGeometry(1.3, 0.03, 0.34), M.carbon, 0, 0.17, 2.02);
    for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.06, 0.09, 1.7), M.carbon, sd * 0.93, 0.22, -0.08);
    add(new THREE.BoxGeometry(1.36, 0.1, 0.32), M.carbon, 0, 0.24, -2.08);
    for (let f = -2; f <= 2; f++) add(new THREE.BoxGeometry(0.015, 0.1, 0.28), M.trim, f * 0.26, 0.2, -2.1);
    // Exhausts
    const ex = new THREE.CylinderGeometry(0.052, 0.058, 0.2, 18, 1, true);
    ex.rotateX(Math.PI / 2);
    for (const sd of [1, -1]) add(ex, M.chrome, sd * 0.34, 0.27, -2.17);
    // Rear wing
    add(new THREE.BoxGeometry(1.72, 0.03, 0.3), M.carbon, 0, 1.1, -1.96, -0.08);
    for (const sd of [1, -1]) {
      add(new THREE.BoxGeometry(0.03, 0.17, 0.09), M.carbon, sd * 0.55, 1.01, -1.93);
      add(new THREE.BoxGeometry(0.02, 0.13, 0.36), M.carbon, sd * 0.86, 1.1, -1.96);
    }
    // Mirrors
    for (const sd of [1, -1]) {
      add(new THREE.BoxGeometry(0.2, 0.1, 0.13), this.paint, sd * 0.97, 1.0, 0.44, 0, sd * 0.12);
      add(new THREE.BoxGeometry(0.1, 0.03, 0.05), M.trim, sd * 0.88, 0.96, 0.46);
      add(new THREE.PlaneGeometry(0.16, 0.07), M.chrome, sd * 0.97, 1.0, 0.374, 0, Math.PI);
    }
    // Hood vents
    for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.16, 0.012, 0.22), M.trim, sd * 0.28, 0.792, 1.32, -0.14);
  }

  #addLights() {
    const c = this.chassis;
    this.headMat = new THREE.MeshStandardMaterial({ name: 'head', color: '#dfe7ef', emissive: '#e8f1ff', emissiveIntensity: 1.2, roughness: 0.1, metalness: 0.3 });
    this.drlMat = new THREE.MeshStandardMaterial({ name: 'drl', color: '#ffffff', emissive: '#f1f6ff', emissiveIntensity: 2.5 });
    this.tailMat = new THREE.MeshStandardMaterial({ name: 'tail', color: '#4a0a0a', emissive: '#ff1a10', emissiveIntensity: 1.2, roughness: 0.3 });
    this.reverseMat = new THREE.MeshStandardMaterial({ name: 'reverse', color: '#dddddd', emissive: '#ffffff', emissiveIntensity: 0 });
    const housing = shared.housing || (shared.housing = new THREE.MeshStandardMaterial({ name: 'housing', color: '#0c0d10', roughness: 0.2, metalness: 0.6 }));
    for (const sd of [1, -1]) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), housing);
      h.scale.set(0.2, 0.05, 0.17);
      h.position.set(sd * 0.55, 0.588, 1.99);
      h.rotation.set(0.32, sd * 0.35, 0);
      c.add(h);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), this.headMat);
      lens.scale.set(0.065, 0.04, 0.05);
      lens.position.set(sd * 0.49, 0.6, 2.05);
      c.add(lens);
      const lens2 = lens.clone();
      lens2.position.set(sd * 0.62, 0.59, 2.0);
      c.add(lens2);
      const drl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.018, 0.03), this.drlMat);
      drl.position.set(sd * 0.56, 0.555, 2.04);
      drl.rotation.set(0, sd * 0.35, 0);
      c.add(drl);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.05), this.tailMat);
    bar.position.set(0, 0.79, -2.135);
    c.add(bar);
    for (const sd of [1, -1]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), this.tailMat);
      t.position.set(sd * 0.5, 0.79, -2.1);
      t.rotation.y = sd * 0.35;
      c.add(t);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.04), this.reverseMat);
      r.position.set(sd * 0.5, 0.32, -2.17);
      c.add(r);
    }
  }

  #addPlates(text) {
    const tex = TX.plateTexture(text);
    const mat = new THREE.MeshStandardMaterial({ name: 'plate', map: tex, roughness: 0.4 });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.12), mat);
    front.position.set(0, 0.33, 2.232);
    this.chassis.add(front);
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.12), mat);
    rear.position.set(0, 0.5, -2.228);
    rear.rotation.y = Math.PI;
    this.chassis.add(rear);
  }

  #makeWheel(M, x, z, front) {
    const mount = new THREE.Group();
    mount.position.set(x, WHEEL_R, z);
    const steer = new THREE.Group();
    mount.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    if (x < 0) {
      steer.scale.x = -1;
    }
    spin.add(mesh(shared.tire, M.tire));
    spin.add(mesh(shared.rimFace, M.rim, false));
    if (this.detail === 'high') {
      spin.add(mesh(shared.barrel, M.rimDark, false));
      steer.add(mesh(shared.disc, M.disc, false));
      steer.add(mesh(shared.caliper, M.caliper, false));
    }
    this.tilt.add(mount);
    return { mount, steer, spin, front };
  }

  #addInterior(M, plate) {
    const g = new THREE.Group();
    this.interior = g;
    this.chassis.add(g);
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // Tub (inside walls)
    add(new THREE.BoxGeometry(1.66, 0.64, 2.1), M.interior, 0, 0.58, -0.48);
    // Dashboard
    add(new THREE.BoxGeometry(1.62, 0.2, 0.4), M.interiorFront, 0, 0.76, 0.42);
    add(new THREE.BoxGeometry(1.5, 0.04, 0.32), M.interiorFront, 0, 0.87, 0.46, 0.22);
    // Binnacle visor and gauges
    add(new THREE.BoxGeometry(0.46, 0.03, 0.18), M.interiorFront, 0.37, 0.975, 0.38, 0.12);
    add(new THREE.BoxGeometry(0.46, 0.12, 0.05), M.interiorFront, 0.37, 0.9, 0.47);
    this.gaugeCanvas = TX.gaugeCanvas();
    this.gaugeTex = new THREE.CanvasTexture(this.gaugeCanvas);
    this.gaugeTex.colorSpace = THREE.SRGBColorSpace;
    const gauge = add(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshBasicMaterial({ map: this.gaugeTex, toneMapped: false }), 0.37, 0.9, 0.34, 0.28, Math.PI);
    gauge.renderOrder = 3;
    // Centre display
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 256;
    screenCanvas.height = 160;
    const sc = screenCanvas.getContext('2d');
    const grad = sc.createLinearGradient(0, 0, 256, 160);
    grad.addColorStop(0, '#0b1d2c');
    grad.addColorStop(1, '#10324a');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, 256, 160);
    sc.fillStyle = '#f2a541';
    sc.font = '700 22px "Barlow", sans-serif';
    sc.fillText('Radio Nord 104,7', 16, 40);
    sc.fillStyle = '#9fb3c2';
    sc.font = '500 16px "Barlow", sans-serif';
    sc.fillText('Seeufer-Ring · 8,1 km', 16, 70);
    sc.fillText(plate, 16, 96);
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    add(new THREE.PlaneGeometry(0.24, 0.15), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false, color: '#bbbbbb' }), 0, 0.87, 0.3, 0.5, Math.PI);
    // Console
    add(new THREE.BoxGeometry(0.24, 0.26, 1.0), M.interiorFront, 0, 0.44, -0.2);
    add(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 10), M.chrome, 0, 0.62, -0.05);
    // Seats
    for (const sd of [1, -1]) {
      add(new THREE.BoxGeometry(0.5, 0.13, 0.52), M.seat, sd * 0.37, 0.36, -0.46);
      add(new THREE.BoxGeometry(0.52, 0.7, 0.14), M.seat, sd * 0.37, 0.74, -0.8, -0.18);
      add(new THREE.BoxGeometry(0.1, 0.62, 0.15), M.seatAccent, sd * 0.37, 0.75, -0.79, -0.18);
      add(new THREE.BoxGeometry(0.3, 0.18, 0.1), M.seat, sd * 0.37, 1.16, -0.86, -0.18);
    }
    // Headliner
    const liner = add(new THREE.PlaneGeometry(1.2, 0.95), M.lining, 0, 1.2, -0.44, Math.PI / 2);
    liner.material = M.lining;
    // Rear-view mirror
    add(new THREE.BoxGeometry(0.24, 0.07, 0.03), M.trim, 0, 1.13, 0.1);
    // Steering wheel
    const wheel = new THREE.Group();
    wheel.position.set(0.37, 0.83, 0.16);
    wheel.rotation.x = 0.36;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.021, 10, 40), M.trim);
    wheel.add(rim);
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.023, 10, 12, 0.5), M.seatAccent);
    grip.rotation.z = Math.PI / 2 - 0.25;
    wheel.add(grip);
    for (const a of [0, Math.PI * 0.5 + Math.PI, Math.PI]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.015), M.trim);
      spoke.position.set(Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0);
      spoke.rotation.z = a;
      wheel.add(spoke);
    }
    const hubW = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 20), M.trim);
    hubW.rotation.x = Math.PI / 2;
    wheel.add(hubW);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.28, 10), M.trim);
    column.rotation.x = Math.PI / 2;
    column.position.z = 0.15;
    wheel.add(column);
    g.add(wheel);
    this.steeringWheel = wheel;
    // Driver figure (hidden in cockpit view)
    const driver = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.26), M.suit);
    torso.position.set(0, 0.68, -0.62);
    torso.rotation.x = -0.18;
    driver.add(torso);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 14), M.helmet);
    helmet.position.set(0, 1.05, -0.56);
    driver.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.137, 20, 10, Math.PI / 2 - 0.9, 1.8, 1.1, 0.6), M.visor);
    visor.position.copy(helmet.position);
    driver.add(visor);
    for (const sd of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.42, 4, 8), M.suit);
      arm.position.set(sd * 0.17, 0.82, -0.28);
      arm.rotation.set(Math.PI / 2 - 0.45, 0, sd * 0.25);
      driver.add(arm);
    }
    driver.position.x = 0.37;
    driver.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.chassis.add(driver);
    this.driver = driver;
  }

  setCockpit(on) {
    if (this.driver) this.driver.visible = !on;
  }

  setLights({ headlights = false, brake = 0, reverse = false }) {
    this.headMat.emissiveIntensity = headlights ? 6 : 1.2;
    this.tailMat.emissiveIntensity = 0.45 + (headlights ? 0.55 : 0) + brake * 3.2;
    this.reverseMat.emissiveIntensity = reverse ? 4 : 0;
  }

  // state: { x, y, z, yaw, pitch, roll, susPitch, susRoll, steerAngle, wheelSpin, rearSpin, steerInput }
  update(st) {
    this.root.position.set(st.x, st.renderY ?? st.y, st.z);
    this.root.rotation.set(0, st.yaw, 0);
    // Ground slope tilts the whole car, suspension motion only the body.
    this.tilt.rotation.set(-st.pitch, 0, st.roll);
    this.chassis.rotation.set(st.susPitch, 0, st.susRoll);
    this.chassis.position.y = 0.01 + Math.abs(st.susPitch) * 0.15;
    for (const w of this.wheels) {
      if (w.front) w.steer.rotation.y = st.steerAngle;
      w.spin.rotation.x = w.front ? st.wheelSpin : st.rearSpin;
    }
    if (this.steeringWheel) this.steeringWheel.rotation.z = -st.steerAngle * 7.5;
  }
}

export const CAR_DIMENSIONS = { halfLength: HALF_LEN, halfWidth: 0.95, axleFront: AXLE_F, axleRear: AXLE_R, wheelRadius: WHEEL_R };
