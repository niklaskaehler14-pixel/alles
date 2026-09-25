// Open-world scenery in 3D: festival grounds (plaza, arches, stage, Ferris wheel, tents, flags and
// show cars), torii gates, stone lanterns, the lighthouse, neon signs in the city and the volcano on
// the horizon. Layout comes from WorldData (landmarks.js); this file only builds meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { CarModel } from './carModel.js';
import { mulberry32 } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);

// Collects geometry per material and bakes each group into one mesh.
class Batch {
  constructor() {
    this.groups = new Map();
  }

  add(geo, material, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (matrix) g.applyMatrix4(matrix);
    if (!this.groups.has(material)) this.groups.set(material, []);
    this.groups.get(material).push(g);
  }

  build(parent, { castShadow = true, receiveShadow = true } = {}) {
    const meshes = [];
    for (const [mat, list] of this.groups) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}

// Cylinder between two points.
function beamGeometry(a, b, radius, segments = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(radius, radius, len, segments, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  return g.applyMatrix4(m);
}

const mat4 = (x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(sx, sy, sz));

// A box whose ends sweep upwards (torii lintel).
function sweptBox(length, height, depth, lift) {
  const g = new THREE.BoxGeometry(length, height, depth, 24, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) / (length / 2);
    p.setY(i, p.getY(i) + lift * t * t * t * t);
  }
  g.computeVertexNormals();
  return g;
}

export class Scenery {
  constructor({ scene, data, quality, uniforms }) {
    this.scene = scene;
    this.data = data;
    this.quality = quality;
    this.uniforms = uniforms;
    this.root = new THREE.Group();
    this.root.name = 'scenery';
    scene.add(this.root);
    this.glow = []; // [material, day, night]
    this.time = 0;
    this.shadows = quality.shadows > 0;
  }

  #glowing(material, day, night) {
    this.glow.push([material, day, night]);
    return material;
  }

  build() {
    if (this.data.festival) this.#festival();
    for (const t of this.data.torii || []) this.#torii(t);
    this.#lanterns();
    if (this.data.lighthouse) this.#lighthouse();
    this.#neon();
    this.#volcano();
  }

  // ------------------------------------------------------------------ festival
  #festival() {
    const F = this.data.festival;
    const group = new THREE.Group();
    group.name = 'festival';
    this.root.add(group);

    // Plaza
    const plazaGeo = new THREE.CircleGeometry(F.radius, 96);
    plazaGeo.rotateX(-Math.PI / 2);
    const plaza = new THREE.Mesh(
      plazaGeo,
      new THREE.MeshStandardMaterial({ map: TX.plazaTexture(F.radius), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    plaza.position.set(F.x, F.y + 0.05, F.z);
    plaza.receiveShadow = true;
    plaza.renderOrder = -1;
    group.add(plaza);

    const steel = new THREE.MeshStandardMaterial({ color: '#23272e', metalness: 0.6, roughness: 0.42 });
    const white = new THREE.MeshStandardMaterial({ color: '#eceae4', roughness: 0.7 });
    const pink = this.#glowing(new THREE.MeshStandardMaterial({ color: '#ff3fa4', emissive: '#ff3fa4', emissiveIntensity: 0.4, roughness: 0.4 }), 0.35, 2.4);
    const amber = this.#glowing(new THREE.MeshStandardMaterial({ color: '#f2a541', emissive: '#f2a541', emissiveIntensity: 0.3, roughness: 0.4 }), 0.25, 2.2);
    const cyan = this.#glowing(new THREE.MeshStandardMaterial({ color: '#29e3ff', emissive: '#29e3ff', emissiveIntensity: 0.3, roughness: 0.4 }), 0.25, 2.2);
    const batch = new Batch();

    // Entrance arches
    const bannerTex = TX.festivalBannerTexture();
    const bannerMat = this.#glowing(new THREE.MeshStandardMaterial({ map: bannerTex, emissiveMap: bannerTex, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.5 }), 0.3, 1.4);
    for (const g of F.gates) {
      const half = g.span / 2;
      for (const sd of [1, -1]) batch.add(new THREE.BoxGeometry(1.3, 10, 1.3), steel, mat4(g.x, g.y, g.z, g.yaw).multiply(mat4(sd * half, 5, 0)));
      const arc = new THREE.TorusGeometry(half, 0.42, 10, 48, Math.PI);
      batch.add(arc, pink, mat4(g.x, g.y, g.z, g.yaw).multiply(mat4(0, 10, 0)));
      const arc2 = new THREE.TorusGeometry(half - 1.1, 0.26, 8, 48, Math.PI);
      batch.add(arc2, amber, mat4(g.x, g.y, g.z, g.yaw).multiply(mat4(0, 10, 0)));
      batch.add(new THREE.BoxGeometry(g.span, 0.7, 0.7), steel, mat4(g.x, g.y, g.z, g.yaw).multiply(mat4(0, 9.7, 0)));
      for (const turn of [0, Math.PI]) {
        const banner = new THREE.PlaneGeometry(g.span - 1.6, (g.span - 1.6) * 0.156);
        batch.add(banner, bannerMat, mat4(g.x, g.y, g.z, g.yaw).multiply(mat4(0, 8.3, 0.36 * (turn ? -1 : 1), turn)));
      }
    }

    // Stage
    const S = F.stage;
    const stageM = mat4(S.x, F.y, S.z, S.yaw);
    batch.add(new THREE.BoxGeometry(S.width, 1.4, S.depth), steel, stageM.clone().multiply(mat4(0, 0.7, 0)));
    for (const sd of [1, -1]) {
      batch.add(new THREE.BoxGeometry(1.2, S.height + 1, 1.2), steel, stageM.clone().multiply(mat4((sd * S.width) / 2, (S.height + 1) / 2, -S.depth / 2 + 1)));
      batch.add(new THREE.BoxGeometry(1.2, S.height + 1, 1.2), steel, stageM.clone().multiply(mat4((sd * S.width) / 2, (S.height + 1) / 2, S.depth / 2 - 0.6)));
      batch.add(new THREE.BoxGeometry(2.6, 5.5, 2.2), steel, stageM.clone().multiply(mat4(sd * (S.width / 2 - 2.4), 4.15, S.depth / 2 - 1.8)));
    }
    batch.add(new THREE.BoxGeometry(S.width + 1.4, 1.1, S.depth), steel, stageM.clone().multiply(mat4(0, S.height + 1, 0)));
    batch.add(new THREE.BoxGeometry(S.width + 1.4, 0.35, 0.4), pink, stageM.clone().multiply(mat4(0, S.height + 0.3, S.depth / 2 - 0.2)));
    const screenTex = TX.stageScreenTexture();
    const screenMat = this.#glowing(new THREE.MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.35 }), 0.55, 1.8);
    batch.add(new THREE.PlaneGeometry(S.width - 6, (S.width - 6) * 0.5), screenMat, stageM.clone().multiply(mat4(0, 1.4 + (S.width - 6) * 0.25 + 0.6, -S.depth / 2 + 1.7)));

    // Tents
    for (const t of F.tents) {
      const m = mat4(t.x, F.y, t.z, t.yaw);
      batch.add(new THREE.BoxGeometry(t.size, 2.6, t.size), white, m.clone().multiply(mat4(0, 1.3, 0)));
      const roof = new THREE.ConeGeometry(t.size * 0.78, 4.2, 4, 1);
      roof.rotateY(Math.PI / 4);
      batch.add(roof, white, m.clone().multiply(mat4(0, 4.7, 0)));
      batch.add(new THREE.BoxGeometry(t.size + 0.1, 0.5, t.size + 0.1), t.size > 10 ? pink : cyan, m.clone().multiply(mat4(0, 2.5, 0)));
    }

    // Flag poles
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 9.5, 6);
    for (const f of F.flags) batch.add(poleGeo, steel, mat4(f.x, F.y + 4.75, f.z));
    batch.build(group, { castShadow: this.shadows });

    // Flags: one merged mesh with vertex colours, waving in the vertex shader.
    const flagParts = [];
    for (const f of F.flags) {
      const g = new THREE.PlaneGeometry(2.8, 1.6, 10, 1);
      g.translate(1.4, 0, 0);
      const c = new THREE.Color(f.color);
      const col = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.applyMatrix4(mat4(f.x, F.y + 8.4, f.z, Math.PI / 2 - 0.4));
      flagParts.push(g);
    }
    if (flagParts.length) {
      const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
      flagMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.uniforms.uTime;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float wave = sin(uTime * 5.0 - uv.x * 6.0 + position.x * 0.13 + position.z * 0.11);
          transformed += normal * wave * 0.28 * uv.x;`,
        );
      };
      const flags = new THREE.Mesh(mergeGeometries(flagParts), flagMat);
      flags.castShadow = this.shadows;
      group.add(flags);
    }

    // Ferris wheel
    this.#ferrisWheel(group, F.wheel);

    // Show cars on turntables
    this.turntables = [];
    const ringMat = this.#glowing(new THREE.MeshStandardMaterial({ color: '#f2a541', emissive: '#f2a541', emissiveIntensity: 0.5 }), 0.5, 2.4);
    for (const p of F.podiums) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.7, 0.6, 48), steel);
      base.position.set(p.x, F.y + 0.3, p.z);
      base.castShadow = this.shadows;
      base.receiveShadow = true;
      group.add(base);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.55, 0.09, 6, 64), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, F.y + 0.55, p.z);
      group.add(ring);
      const car = new CarModel({ color: p.color, stripe: p.stripe, number: p.number, plate: 'FESTIVAL', detail: 'low' });
      const st = { x: p.x, y: F.y + 0.6, z: p.z, yaw: 0, pitch: 0, roll: 0, susPitch: 0, susRoll: 0, steerAngle: 0.25, wheelSpin: 0, rearSpin: 0 };
      car.update(st);
      car.setLights({ headlights: true });
      group.add(car.root);
      this.turntables.push({ car, st, speed: 0.25 + this.turntables.length * 0.07 });
    }
  }

  #ferrisWheel(parent, W) {
    const group = new THREE.Group();
    group.position.set(W.x, W.y, W.z);
    group.rotation.y = W.yaw;
    parent.add(group);
    const steel = new THREE.MeshStandardMaterial({ color: '#d8dde2', metalness: 0.55, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2f36', metalness: 0.5, roughness: 0.5 });
    const batch = new Batch();
    const hub = W.hub;
    // A-frame legs on both sides of the wheel and the axle.
    for (const z of [-3.2, 3.2]) {
      for (const x of [-10, 10]) batch.add(beamGeometry(new THREE.Vector3(x, 0, z * 1.6), new THREE.Vector3(0, hub, z), 0.45), steel);
      batch.add(beamGeometry(new THREE.Vector3(-6, hub * 0.4, z * 1.35), new THREE.Vector3(6, hub * 0.4, z * 1.35), 0.25), steel);
    }
    batch.add(new THREE.BoxGeometry(24, 1, 13), dark, mat4(0, 0.5, 0));
    const axle = new THREE.CylinderGeometry(1.1, 1.1, 8.2, 16);
    axle.rotateX(Math.PI / 2);
    batch.add(axle, dark, mat4(0, hub, 0));
    batch.build(group, { castShadow: this.shadows });

    // Rotating wheel
    const rot = new THREE.Group();
    rot.position.set(0, hub, 0);
    group.add(rot);
    const R = W.radius;
    const rim = this.#glowing(new THREE.MeshStandardMaterial({ color: '#f4f4f4', emissive: '#ff5fb8', emissiveIntensity: 0.15, metalness: 0.4, roughness: 0.35 }), 0.1, 2.6);
    const wb = new Batch();
    const spokes = 16;
    for (const z of [-1.7, 1.7]) {
      wb.add(new THREE.TorusGeometry(R, 0.32, 8, 120), rim, mat4(0, 0, z));
      wb.add(new THREE.TorusGeometry(R * 0.55, 0.18, 6, 80), steel, mat4(0, 0, z));
      for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * Math.PI * 2;
        wb.add(beamGeometry(new THREE.Vector3(0, 0, z), new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, z), 0.12, 5), steel);
      }
    }
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      wb.add(beamGeometry(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, -1.7), new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 1.7), 0.14, 5), steel);
    }
    wb.build(rot, { castShadow: this.shadows });
    // Gondolas stay upright while the wheel turns.
    const colors = ['#ff3fa4', '#29e3ff', '#f2a541', '#7dff6a', '#b36bff', '#ffffff'];
    const cabinGeo = new THREE.BoxGeometry(2.1, 2.1, 2.3);
    const roofGeo = new THREE.CylinderGeometry(0.2, 1.3, 0.5, 4);
    roofGeo.rotateY(Math.PI / 4);
    this.gondolas = [];
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      const mat = new THREE.MeshStandardMaterial({ color: colors[k % colors.length], roughness: 0.45, metalness: 0.2 });
      const cabin = new THREE.Mesh(cabinGeo, mat);
      cabin.position.y = -1.9;
      const roof = new THREE.Mesh(roofGeo, dark);
      roof.position.y = -0.6;
      pivot.add(cabin, roof);
      cabin.castShadow = this.shadows;
      rot.add(pivot);
      this.gondolas.push(pivot);
    }
    this.wheel = rot;
  }

  // ------------------------------------------------------------------ torii
  #torii(t) {
    const H = t.height;
    const red = new THREE.MeshStandardMaterial({ color: '#cf3a1f', roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.6 });
    // Local x spans the road (perpendicular to the heading), like the plan's pillar colliders.
    const base = mat4(t.x, t.y, t.z, t.yaw);
    const batch = new Batch();
    const half = t.span / 2;
    const r = H * 0.045;
    const pillarH = H * 0.9;
    for (const sd of [1, -1]) {
      batch.add(new THREE.CylinderGeometry(r * 0.9, r, pillarH, 16), red, base.clone().multiply(mat4(sd * half, pillarH / 2, 0)));
      if (!t.water) batch.add(new THREE.CylinderGeometry(r * 1.2, r * 1.25, H * 0.06, 16), black, base.clone().multiply(mat4(sd * half, H * 0.03, 0)));
    }
    batch.add(new THREE.BoxGeometry(t.span + H * 0.22, H * 0.07, H * 0.055), red, base.clone().multiply(mat4(0, H * 0.7, 0)));
    batch.add(sweptBox(t.span + H * 0.3, H * 0.065, H * 0.09, H * 0.05), red, base.clone().multiply(mat4(0, H * 0.87, 0)));
    batch.add(sweptBox(t.span + H * 0.42, H * 0.075, H * 0.11, H * 0.08), black, base.clone().multiply(mat4(0, H * 0.94, 0)));
    batch.add(new THREE.BoxGeometry(H * 0.06, H * 0.12, H * 0.05), red, base.clone().multiply(mat4(0, H * 0.79, 0)));
    for (const sd of [1, -1]) batch.add(new THREE.BoxGeometry(H * 0.13, H * 0.1, H * 0.03), black, base.clone().multiply(mat4(0, H * 0.79, sd * H * 0.035)));
    batch.build(this.root, { castShadow: this.shadows });
  }

  // ------------------------------------------------------------------ stone lanterns
  #lanterns() {
    const list = this.data.lanterns || [];
    if (!list.length) return;
    const stone = new THREE.MeshStandardMaterial({ color: '#8f8a80', roughness: 0.95 });
    const fire = this.#glowing(new THREE.MeshStandardMaterial({ color: '#f5e2c0', emissive: '#ffb45e', emissiveIntensity: 0.1 }), 0.05, 3.5);
    const batch = new Batch();
    const roof = new THREE.ConeGeometry(0.62, 0.45, 4, 1);
    roof.rotateY(Math.PI / 4);
    for (const l of list) {
      const m = mat4(l.x, l.y, l.z, l.yaw);
      batch.add(new THREE.CylinderGeometry(0.42, 0.52, 0.3, 8), stone, m.clone().multiply(mat4(0, 0.15, 0)));
      batch.add(new THREE.CylinderGeometry(0.17, 0.21, 1.1, 8), stone, m.clone().multiply(mat4(0, 0.85, 0)));
      batch.add(new THREE.BoxGeometry(0.78, 0.18, 0.78), stone, m.clone().multiply(mat4(0, 1.48, 0)));
      batch.add(new THREE.BoxGeometry(0.42, 0.42, 0.42), fire, m.clone().multiply(mat4(0, 1.78, 0)));
      for (const [dx, dz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        batch.add(new THREE.BoxGeometry(0.08, 0.44, 0.08), stone, m.clone().multiply(mat4(dx * 0.24, 1.78, dz * 0.24)));
      batch.add(roof, stone, m.clone().multiply(mat4(0, 2.2, 0)));
      batch.add(new THREE.SphereGeometry(0.1, 8, 6), stone, m.clone().multiply(mat4(0, 2.5, 0)));
    }
    batch.build(this.root, { castShadow: this.shadows });
  }

  // ------------------------------------------------------------------ lighthouse
  #lighthouse() {
    const L = this.data.lighthouse;
    const group = new THREE.Group();
    group.position.set(L.x, L.y, L.z);
    this.root.add(group);
    const H = L.height - 3;
    const towerTex = TX.lighthouseTexture();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 2.2, H, 24, 1), new THREE.MeshStandardMaterial({ map: towerTex, roughness: 0.6 }));
    tower.position.y = H / 2;
    const dark = new THREE.MeshStandardMaterial({ color: '#23272e', metalness: 0.5, roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: '#c8231c', roughness: 0.5 });
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 24), dark);
    gallery.position.y = H + 0.15;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.05, 4, 32), dark);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = H + 1.2;
    this.lampMat = this.#glowing(new THREE.MeshStandardMaterial({ color: '#fff4d0', emissive: '#ffe7a0', emissiveIntensity: 0.3, roughness: 0.1 }), 0.3, 6);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.7, 16), this.lampMat);
    lamp.position.y = H + 1.15;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.45, 1.5, 16), red);
    cap.position.y = H + 2.75;
    const house = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), new THREE.MeshStandardMaterial({ color: '#efece5', roughness: 0.8 }));
    house.position.set(4.6, 1.5, 0);
    const houseRoof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.6, 4), red);
    houseRoof.rotation.y = Math.PI / 4;
    houseRoof.scale.set(1, 1, 0.8);
    houseRoof.position.set(4.6, 3.8, 0);
    for (const m of [tower, gallery, lamp, cap, house, houseRoof]) {
      m.castShadow = this.shadows;
      m.receiveShadow = true;
    }
    group.add(tower, gallery, rail, lamp, cap, house, houseRoof);
    // Rotating light beam at night.
    const beamGeo = new THREE.CylinderGeometry(7, 0.4, 90, 16, 1, true);
    beamGeo.translate(0, 45, 0);
    beamGeo.rotateZ(-Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#fff0c0', map: TX.beamTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const beams = new THREE.Group();
    beams.position.y = H + 1.15;
    for (const turn of [0, Math.PI]) {
      const b = new THREE.Mesh(beamGeo, beamMat);
      b.rotation.y = turn;
      beams.add(b);
    }
    beams.visible = false;
    group.add(beams);
    this.lighthouseBeams = beams;
    this.lighthouseBeamMat = beamMat;
  }

  // ------------------------------------------------------------------ neon signs
  #neon() {
    const signs = this.data.neonSigns || [];
    if (!signs.length) return;
    const atlas = TX.neonAtlasTexture();
    const cols = atlas.userData.cols;
    const pos = [];
    const uv = [];
    const nor = [];
    for (const s of signs) {
      const col = s.word % cols;
      const u0 = col / cols;
      const u1 = (col + 1) / cols;
      // The sign sticks out of the facade: its width runs along the facade normal.
      const ax = s.nx;
      const az = s.nz;
      const hw = s.width / 2;
      const y0 = s.y;
      const y1 = s.y + s.height;
      // Side normal (perpendicular to the sign plane).
      const px = -az;
      const pz = ax;
      for (const sd of [1, -1]) {
        const a = [s.x - ax * hw * sd, s.z - az * hw * sd];
        const b = [s.x + ax * hw * sd, s.z + az * hw * sd];
        const quad = [
          [a[0], y0, a[1], u0, 0],
          [b[0], y0, b[1], u1, 0],
          [b[0], y1, b[1], u1, 1],
          [a[0], y0, a[1], u0, 0],
          [b[0], y1, b[1], u1, 1],
          [a[0], y1, a[1], u0, 1],
        ];
        for (const v of quad) {
          pos.push(v[0] + px * 0.03 * sd, v[1], v[2] + pz * 0.03 * sd);
          uv.push(v[3], v[4]);
          nor.push(px * sd, 0, pz * sd);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    // Each side is its own quad wound towards its viewer, so the letters read correctly from both.
    const mat = this.#glowing(new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: '#ffffff', emissiveIntensity: 0.8, roughness: 0.4 }), 0.8, 3.4);
    const mesh = new THREE.Mesh(geo, mat);
    this.root.add(mesh);
  }

  // ------------------------------------------------------------------ volcano on the horizon
  #volcano() {
    const rng = mulberry32(1707);
    const H = 1500;
    const R = 2300;
    const pts = [];
    const steps = 28;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps; // 0 = base, 1 = crater rim
      const r = 150 + (R - 150) * Math.pow(1 - t, 1.9);
      pts.push(new THREE.Vector2(r, -150 + (H + 150) * t));
    }
    pts.push(new THREE.Vector2(95, H - 55));
    const geo = new THREE.LatheGeometry(pts, 128);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const base = new THREE.Color('#57625d');
    const rock = new THREE.Color('#6f6862');
    const snow = new THREE.Color('#f4f6f8');
    const c = new THREE.Color();
    const phase = rng() * 10;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const t = (y + 150) / (H + 150);
      // Gullies running down the flanks.
      const ridge = Math.sin(a * 23 + phase) * 0.5 + Math.sin(a * 57 + y * 0.004) * 0.3 + Math.sin(a * 9 - phase) * 0.2;
      const k = 1 + ridge * 0.035 * (1 - t * 0.6);
      p.setX(i, x * k);
      p.setZ(i, z * k);
      const snowLine = 0.6 + ridge * 0.07 + Math.sin(a * 5 + phase) * 0.03;
      c.copy(base).lerp(rock, Math.min(1, t * 2));
      if (t > snowLine) c.copy(snow).multiplyScalar(0.92 + ridge * 0.06);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.position.set(-2050, 0, -3350);
    this.root.add(mesh);
    this.volcano = mesh;
  }

  // ------------------------------------------------------------------ runtime
  setNight(night) {
    for (const [m, day, nightVal] of this.glow) m.emissiveIntensity = day + (nightVal - day) * night;
    if (this.lighthouseBeams) {
      this.lighthouseBeams.visible = night > 0.5;
      this.lighthouseBeamMat.opacity = night > 0.5 ? 0.22 : 0;
    }
    if (this.turntables) for (const t of this.turntables) t.car.setLights({ headlights: night > 0 });
  }

  update(dt) {
    this.time += dt;
    if (this.wheel) {
      this.wheel.rotation.z += dt * 0.045;
      for (const g of this.gondolas) g.rotation.z = -this.wheel.rotation.z;
    }
    if (this.turntables) {
      for (const t of this.turntables) {
        t.st.yaw += dt * t.speed;
        t.car.update(t.st);
      }
    }
    if (this.lighthouseBeams && this.lighthouseBeams.visible) this.lighthouseBeams.rotation.y += dt * 0.9;
  }
}
