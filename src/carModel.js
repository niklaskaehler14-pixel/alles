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

  return { body, cabin, lining, tire, barrel, rimFace, disc, caliper, HALF_LEN, merged: new Map(), patches: new Map() };
}

function sharedMaterials() {
  if (shared.materials) return shared.materials;
  shared.materials = {
    glass: new THREE.MeshPhysicalMaterial({ color: '#16202a', metalness: 0.3, roughness: 0.07, transparent: true, opacity: 0.72, envMapIntensity: 2.2, clearcoat: 0.6, clearcoatRoughness: 0.08 }),
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

// Ray queries against the body shell so lights, plates and trim sit exactly on the surface.
let bodySampler = null;
function sampleBody(origin, dir) {
  if (!bodySampler) {
    const target = new THREE.Mesh(shared.body, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    target.updateMatrixWorld(true);
    bodySampler = {
      target,
      rc: new THREE.Raycaster(),
      tri: new THREE.Triangle(),
      na: new THREE.Vector3(),
      nb: new THREE.Vector3(),
      nc: new THREE.Vector3(),
    };
  }
  const S = bodySampler;
  S.rc.set(origin, dir);
  S.rc.far = 6;
  const hit = S.rc.intersectObject(S.target, false)[0];
  if (!hit) return null;
  const pos = shared.body.attributes.position;
  const nrm = shared.body.attributes.normal;
  const f = hit.face;
  S.tri.setFromAttributeAndIndices(pos, f.a, f.b, f.c);
  S.na.fromBufferAttribute(nrm, f.a);
  S.nb.fromBufferAttribute(nrm, f.b);
  S.nc.fromBufferAttribute(nrm, f.c);
  const n = THREE.Triangle.getInterpolation(hit.point, S.tri.a, S.tri.b, S.tri.c, S.na, S.nb, S.nc, new THREE.Vector3()).normalize();
  if (n.dot(dir) > 0) n.negate();
  return { p: hit.point.clone(), n };
}

// A thin mesh that follows the body surface: rays are cast along D through a grid spanned by
// U (texture u) and V (texture v) around `center`, and each hit is lifted by `offset`.
function surfacePatch(key, { center, U, V, D, nu = 12, nv = 4, offset = 0.004 }) {
  if (shared.patches.has(key)) return shared.patches.get(key);
  const dir = D.clone().normalize();
  const pos = [];
  const nor = [];
  const uv = [];
  const ok = [];
  const o = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      o.copy(center)
        .addScaledVector(U, i / nu - 0.5)
        .addScaledVector(V, j / nv - 0.5)
        .addScaledVector(dir, -2);
      const h = sampleBody(o, dir);
      ok.push(!!h);
      const p = h ? h.p.addScaledVector(h.n, offset) : o;
      const n = h ? h.n : dir.clone().negate();
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(i / nu, j / nv);
    }
  }
  const index = [];
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (ok[a] && ok[b] && ok[c] && ok[d]) index.push(a, b, d, a, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  shared.patches.set(key, geo);
  return geo;
}

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// A flat rectangle facing against D, placed in front of the highest surface point it covers.
function flatPanel(key, { center, U, V, D, gap = 0.01 }) {
  if (shared.patches.has(key)) return shared.patches.get(key);
  const dir = D.clone().normalize();
  let front = -Infinity;
  const o = new THREE.Vector3();
  for (let j = 0; j <= 4; j++) {
    for (let i = 0; i <= 6; i++) {
      o.copy(center)
        .addScaledVector(U, i / 6 - 0.5)
        .addScaledVector(V, j / 4 - 0.5)
        .addScaledVector(dir, -2);
      const h = sampleBody(o, dir);
      if (h) front = Math.max(front, -h.p.dot(dir));
    }
  }
  const base = center.clone().addScaledVector(dir, -center.dot(dir) - front - gap);
  const geo = new THREE.BufferGeometry();
  const corners = [
    [-0.5, -0.5, 0, 0],
    [0.5, -0.5, 1, 0],
    [0.5, 0.5, 1, 1],
    [-0.5, 0.5, 0, 1],
  ];
  const pos = [];
  const nor = [];
  const uv = [];
  for (const [a, b, u, v] of corners) {
    const p = base.clone().addScaledVector(U, a).addScaledVector(V, b);
    pos.push(p.x, p.y, p.z);
    nor.push(-dir.x, -dir.y, -dir.z);
    uv.push(u, v);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeBoundingSphere();
  shared.patches.set(key, geo);
  return geo;
}

function decalMaterial(name, opts) {
  return new THREE.MeshStandardMaterial({
    name,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    ...opts,
  });
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
    this.paint = new THREE.MeshPhysicalMaterial({ name: 'paint', map: paintTex, metalness: 0.35, roughness: 0.4, specularIntensity: 0.7, clearcoat: 0.8, clearcoatRoughness: 0.09, envMapIntensity: 1.2 });
    // Same paint without decals, for small parts whose UVs would stretch the stripes.
    this.paintPlain = this.paint.clone();
    this.paintPlain.name = 'paintPlain';
    this.paintPlain.map = null;
    this.paintPlain.color.set(color);
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
    const decals = shared.decals || (shared.decals = {
      grille: decalMaterial('grille', { map: TX.grilleTexture(), roughness: 0.6, metalness: 0.3 }),
      vent: decalMaterial('vent', { map: TX.ventTexture(), roughness: 0.6, metalness: 0.2 }),
    });
    // Front grille and side intakes, projected onto the nose
    c.add(mesh(surfacePatch('grille', { center: V3(0, 0.3, 2.3), U: V3(0.96, 0, 0), V: V3(0, 0.17, 0), D: V3(0, 0, -1), nu: 16, nv: 3 }), decals.grille, false));
    for (const sd of [1, -1]) {
      const g = surfacePatch(`intake${sd}`, { center: V3(sd * 0.56, 0.31, 2.3), U: V3(0.24 * sd, 0, 0), V: V3(0, 0.12, 0), D: V3(-0.25 * sd, 0, -1), nu: 6, nv: 2 });
      c.add(mesh(g, decals.grille, false));
    }
    // Bonnet vents
    for (const sd of [1, -1]) {
      const g = surfacePatch(`vent${sd}`, { center: V3(sd * 0.28, 1.5, 1.34), U: V3(0.15 * sd, 0, 0), V: V3(0, 0, -0.26), D: V3(0, -1, 0), nu: 3, nv: 5, offset: 0.003 });
      c.add(mesh(g, decals.vent, false));
    }
    // Splitter, side skirts, diffuser
    add(new THREE.BoxGeometry(1.24, 0.025, 0.2), M.carbon, 0, 0.175, 2.06);
    for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.06, 0.09, 1.7), M.carbon, sd * 0.93, 0.22, -0.08);
    add(new THREE.BoxGeometry(1.3, 0.1, 0.32), M.carbon, 0, 0.24, -2.06);
    for (let f = -2; f <= 2; f++) add(new THREE.BoxGeometry(0.015, 0.1, 0.28), M.trim, f * 0.24, 0.2, -2.08);
    // Exhaust tips poke out of the rear surface
    const ex = new THREE.CylinderGeometry(0.05, 0.056, 0.16, 18, 1, true);
    ex.rotateX(Math.PI / 2);
    for (const sd of [1, -1]) {
      const h = sampleBody(V3(sd * 0.34, 0.3, -3), V3(0, 0, 1));
      const z = h ? h.p.z - 0.04 : -2.17;
      add(ex, M.chrome, sd * 0.34, 0.3, z);
    }
    // Rear wing on two stands that reach the deck
    const deck = sampleBody(V3(0.55, 2, -1.93), V3(0, -1, 0));
    const deckY = deck ? deck.p.y : 0.95;
    add(new THREE.BoxGeometry(1.72, 0.03, 0.3), M.carbon, 0, 1.1, -1.96, -0.08);
    for (const sd of [1, -1]) {
      const hgt = 1.09 - deckY + 0.02;
      add(new THREE.BoxGeometry(0.03, hgt, 0.09), M.carbon, sd * 0.55, deckY + hgt / 2 - 0.01, -1.93);
      add(new THREE.BoxGeometry(0.02, 0.13, 0.36), M.carbon, sd * 0.86, 1.1, -1.96);
    }
    // Door mirrors mounted on the body side at the base of the A-pillar
    for (const sd of [1, -1]) {
      const h = sampleBody(V3(sd * 2, 0.86, 0.46), V3(-sd, 0, 0));
      const bx = h ? h.p.x : sd * 0.9;
      add(new THREE.BoxGeometry(0.12, 0.035, 0.05), M.trim, bx + sd * 0.05, 0.9, 0.46);
      const housing = add(new THREE.SphereGeometry(1, 18, 12), this.paintPlain, bx + sd * 0.13, 0.96, 0.47, 0, sd * 0.12);
      housing.scale.set(0.1, 0.055, 0.07);
      add(new THREE.PlaneGeometry(0.15, 0.075), M.chrome, bx + sd * 0.13, 0.96, 0.398, 0, Math.PI);
    }
  }

  #addLights() {
    const c = this.chassis;
    const head = shared.headTex || (shared.headTex = TX.headlightTextures());
    const tail = shared.tailTex || (shared.tailTex = TX.tailLightTextures());
    this.headMat = decalMaterial('head', { map: head.map, emissiveMap: head.emissive, emissive: '#eaf2ff', emissiveIntensity: 1.2, roughness: 0.12, metalness: 0.5 });
    this.tailMat = decalMaterial('tail', { map: tail.map, emissiveMap: tail.emissive, emissive: '#ff1a10', emissiveIntensity: 1, roughness: 0.25, metalness: 0.2 });
    this.reverseMat = decalMaterial('reverse', { color: '#d9dde2', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.2 });
    // Headlights sit on the upper corners of the nose, seen along a slightly downward view.
    for (const sd of [1, -1]) {
      const D = V3(-0.12 * sd, -0.5, -1).normalize();
      const U = V3(0.4 * sd, 0, 0);
      const V = new THREE.Vector3().crossVectors(V3(sd, 0, 0), D).normalize().multiplyScalar(0.19 * sd);
      const g = surfacePatch(`head${sd}`, { center: V3(sd * 0.47, 0.64, 1.99), U, V, D, nu: 12, nv: 6, offset: 0.005 });
      c.add(mesh(g, this.headMat, false));
    }
    // Light bar across the tail
    c.add(mesh(surfacePatch('tail', { center: V3(0, 0.77, -2.3), U: V3(-1.12, 0, 0), V: V3(0, 0.1, 0), D: V3(0, -0.15, 1), nu: 24, nv: 3, offset: 0.005 }), this.tailMat, false));
    // Reverse lights low on the rear
    for (const sd of [1, -1]) {
      c.add(mesh(surfacePatch(`reverse${sd}`, { center: V3(sd * 0.5, 0.36, -2.3), U: V3(-0.14 * sd, 0, 0), V: V3(0, 0.035, 0), D: V3(0, 0, 1), nu: 3, nv: 1, offset: 0.004 }), this.reverseMat, false));
    }
  }

  #addPlates(text) {
    const tex = TX.plateTexture(text);
    const mat = decalMaterial('plate', { map: tex, roughness: 0.35, metalness: 0.1, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    // Plates are flat, mounted just in front of the most protruding point behind them.
    const front = flatPanel('plateFront', { center: V3(0, 0.31, 2.3), U: V3(0.52, 0, 0), V: V3(0, 0.112, 0), D: V3(0, 0, -1), gap: 0.012 });
    const rear = flatPanel('plateRear', { center: V3(0, 0.5, -2.3), U: V3(-0.52, 0, 0), V: V3(0, 0.112, 0), D: V3(0, 0, 1), gap: 0.01 });
    this.chassis.add(mesh(front, mat, false));
    this.chassis.add(mesh(rear, mat, false));
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
    add(new THREE.BoxGeometry(1.3, 0.54, 2.1), M.interior, 0, 0.53, -0.48);
    // Dashboard
    add(new THREE.BoxGeometry(1.08, 0.2, 0.4), M.interiorFront, 0, 0.76, 0.42);
    add(new THREE.BoxGeometry(1.04, 0.04, 0.3), M.interiorFront, 0, 0.855, 0.44, 0.22);
    // Binnacle visor and gauges
    add(new THREE.BoxGeometry(0.4, 0.03, 0.18), M.interiorFront, 0.33, 0.975, 0.38, 0.12);
    add(new THREE.BoxGeometry(0.4, 0.12, 0.05), M.interiorFront, 0.33, 0.9, 0.47);
    this.gaugeCanvas = TX.gaugeCanvas();
    this.gaugeTex = new THREE.CanvasTexture(this.gaugeCanvas);
    this.gaugeTex.colorSpace = THREE.SRGBColorSpace;
    const gauge = add(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshBasicMaterial({ map: this.gaugeTex, toneMapped: false }), 0.33, 0.9, 0.34, 0.28, Math.PI);
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
      add(new THREE.BoxGeometry(0.42, 0.13, 0.5), M.seat, sd * 0.31, 0.36, -0.46);
      add(new THREE.BoxGeometry(0.42, 0.64, 0.14), M.seat, sd * 0.31, 0.72, -0.8, -0.18);
      add(new THREE.BoxGeometry(0.09, 0.56, 0.15), M.seatAccent, sd * 0.31, 0.73, -0.79, -0.18);
      add(new THREE.BoxGeometry(0.24, 0.16, 0.1), M.seat, sd * 0.31, 1.1, -0.85, -0.18);
    }
    // Headliner
    const liner = add(new THREE.PlaneGeometry(1.2, 0.95), M.lining, 0, 1.2, -0.44, Math.PI / 2);
    liner.material = M.lining;
    // Rear-view mirror
    add(new THREE.BoxGeometry(0.24, 0.07, 0.03), M.trim, 0, 1.13, 0.1);
    // Steering wheel
    const wheel = new THREE.Group();
    wheel.position.set(0.33, 0.83, 0.16);
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
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.24), M.suit);
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
    driver.position.x = 0.31;
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
    this.headMat.emissiveIntensity = headlights ? 5 : 1.4;
    this.tailMat.emissiveIntensity = 0.6 + (headlights ? 0.6 : 0) + brake * 3.4;
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
