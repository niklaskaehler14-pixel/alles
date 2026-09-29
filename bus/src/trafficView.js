// Instanced AI cars: one body mesh per car type (paint via instance colour), shared
// wheels and lamps (brake lights, indicators, headlights, hazard lights after a crash).
import * as THREE from 'three';
import { CAR_TYPES } from './traffic.js';

// Side silhouette (z forward, y up) per type: [z, y] points, and the window band.
const PROFILES = {
  sedan: { body: [[-2.35, 0.28], [2.35, 0.28], [2.38, 0.62], [2.2, 0.82], [1.1, 0.9], [0.55, 1.42], [-0.9, 1.45], [-1.8, 0.98], [-2.35, 0.95]], cabin: [[1.05, 0.93], [0.55, 1.38], [-0.88, 1.41], [-1.72, 0.99]] },
  hatch: { body: [[-2.05, 0.28], [2.05, 0.28], [2.08, 0.62], [1.9, 0.84], [0.95, 0.94], [0.35, 1.47], [-1.75, 1.47], [-2.05, 1.05]], cabin: [[0.9, 0.97], [0.35, 1.43], [-1.7, 1.43], [-1.95, 1.05]] },
  suv: { body: [[-2.35, 0.34], [2.35, 0.34], [2.38, 0.78], [2.15, 1.0], [1.15, 1.08], [0.6, 1.66], [-2.15, 1.68], [-2.35, 1.15]], cabin: [[1.1, 1.1], [0.6, 1.62], [-2.08, 1.63], [-2.25, 1.15]] },
  van: { body: [[-2.65, 0.32], [2.65, 0.32], [2.68, 0.75], [2.45, 1.1], [1.6, 1.3], [1.0, 2.2], [-2.65, 2.25]], cabin: [[1.5, 1.33], [0.98, 2.12], [0.1, 2.12], [0.1, 1.33]] },
  taxi: { body: [[-2.45, 0.28], [2.45, 0.28], [2.48, 0.62], [2.28, 0.82], [1.15, 0.9], [0.6, 1.43], [-0.95, 1.46], [-1.9, 0.98], [-2.45, 0.95]], cabin: [[1.1, 0.93], [0.6, 1.39], [-0.93, 1.42], [-1.82, 0.99]] },
  truck: { body: [[-3.8, 0.45], [3.8, 0.45], [3.8, 3.2], [1.9, 3.2], [1.9, 2.6], [-3.8, 2.6]], cabin: [[3.82, 1.7], [3.82, 2.6], [3.0, 2.6], [3.0, 1.7]] },
};

function extrudeProfile(points, width, bevel = 0.06) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // Shape (x=z_car, y) extruded along +z → rotate so the extrusion is across the car (x).
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return g.index ? g.toNonIndexed() : g;
}

function colorize(g, rgb) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = rgb[0];
    c[i * 3 + 1] = rgb[1];
    c[i * 3 + 2] = rgb[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function merge(geos) {
  const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['color', 3],
  ]) {
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

function boxG(w, h, d, x, y, z, rgb) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return colorize(g, rgb);
}

function carGeometry(type) {
  const t = CAR_TYPES.find((c) => c.id === type);
  const p = PROFILES[type];
  const parts = [];
  // Body: white vertex colour → instance colour paints it.
  parts.push(colorize(extrudeProfile(p.body, t.width), [1, 1, 1]));
  // Windows: dark band slightly wider than the body.
  const cabin = extrudeProfile(p.cabin, t.width + 0.02, 0.02);
  parts.push(colorize(cabin, [0.05, 0.06, 0.07]));
  // Bumpers and underside (dark, not tinted much).
  const half = t.length / 2;
  parts.push(boxG(t.width + 0.04, 0.18, 0.12, 0, 0.4, half - 0.02, [0.12, 0.12, 0.13]));
  parts.push(boxG(t.width + 0.04, 0.18, 0.12, 0, 0.4, -half + 0.02, [0.12, 0.12, 0.13]));
  if (type === 'taxi') parts.push(boxG(0.55, 0.14, 0.22, 0, 1.52, -0.2, [1.4, 1.25, 0.35]));
  if (type === 'truck') parts.push(boxG(t.width, 0.4, t.length - 0.4, 0, 0.55, 0, [0.15, 0.15, 0.16]));
  return merge(parts);
}

const LAMP = {
  off: new THREE.Color('#1a1a1a'),
  tail: new THREE.Color('#7a0a06'),
  brake: new THREE.Color('#ff2010').multiplyScalar(2.2),
  ind: new THREE.Color('#ff9a1a').multiplyScalar(2.2),
  indOff: new THREE.Color('#3a2408'),
  head: new THREE.Color('#fff4de').multiplyScalar(2.4),
  headOff: new THREE.Color('#c9ccce'),
};

export class TrafficView {
  constructor(max = 60) {
    this.max = max;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45, envMapIntensity: 1.2 });
    this.bodies = {};
    for (const t of CAR_TYPES) {
      const m = new THREE.InstancedMesh(carGeometry(t.id), bodyMat, max);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.bodies[t.id] = m;
      this.group.add(m);
    }
    const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    this.wheels = new THREE.InstancedMesh(wheelGeo, new THREE.MeshStandardMaterial({ color: '#1c1c1d', roughness: 0.9 }), max * 4);
    this.wheels.count = 0;
    this.wheels.frustumCulled = false;
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.wheels);
    const lampGeo = new THREE.BoxGeometry(1, 1, 1);
    this.lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), max * 8);
    this.lamps.count = 0;
    this.lamps.frustumCulled = false;
    this.group.add(this.lamps);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    this.local = new THREE.Matrix4();
    this.root = new THREE.Matrix4();
    this.paint = new THREE.Color();
    this.blink = 0;
  }

  update(vehicles, dt, { lights = false } = {}) {
    this.blink = (this.blink + dt) % 0.8;
    const blinkOn = this.blink < 0.4;
    const counts = {};
    for (const t of CAR_TYPES) counts[t.id] = 0;
    let wi = 0;
    let li = 0;
    for (const v of vehicles) {
      const body = this.bodies[v.type];
      const i = counts[v.type]++;
      if (i >= this.max) continue;
      this.e.set(-v.pitch, v.yaw, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.root.compose(this.v.set(v.x, 0, v.z), this.q, this.s.set(1, 1, 1));
      body.setMatrixAt(i, this.root);
      body.setColorAt(i, this.paint.set(v.color));
      const t = v.spec;
      const half = t.length / 2;
      const wx = t.width / 2 - 0.12;
      const wz = half - (v.type === 'truck' ? 1.2 : 0.8);
      for (const [x, z] of [
        [wx, wz],
        [-wx, wz],
        [wx, -wz],
        [-wx, -wz],
      ]) {
        this.e.set(v.spin, 0, 0);
        this.q.setFromEuler(this.e);
        this.local.compose(this.v.set(x, 0.33, z), this.q, this.s.set(1, 1, 1));
        this.m.multiplyMatrices(this.root, this.local);
        this.wheels.setMatrixAt(wi++, this.m);
      }
      // Lamps: rear (tail/brake), front (head), indicators at the four corners.
      const hazard = v.hazard && blinkOn;
      const lamp = (x, y, z, sx, sy, color) => {
        this.q.identity();
        this.local.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, 0.04));
        this.m.multiplyMatrices(this.root, this.local);
        this.lamps.setMatrixAt(li, this.m);
        this.lamps.setColorAt(li, color);
        li++;
      };
      const tailY = v.type === 'van' ? 0.95 : v.type === 'truck' ? 0.9 : 0.8;
      const rear = -half - 0.01;
      const front = half + 0.01;
      const tail = v.braking ? LAMP.brake : lights ? LAMP.tail : LAMP.off;
      lamp(t.width / 2 - 0.22, tailY, rear, 0.34, 0.12, tail);
      lamp(-t.width / 2 + 0.22, tailY, rear, 0.34, 0.12, tail);
      const head = lights ? LAMP.head : LAMP.headOff;
      lamp(t.width / 2 - 0.25, 0.68, front, 0.36, 0.1, head);
      lamp(-t.width / 2 + 0.25, 0.68, front, 0.36, 0.1, head);
      const indL = (v.indicator === 1 && blinkOn) || hazard ? LAMP.ind : LAMP.indOff;
      const indR = (v.indicator === -1 && blinkOn) || hazard ? LAMP.ind : LAMP.indOff;
      lamp(t.width / 2 - 0.05, tailY - 0.14, rear, 0.14, 0.08, indL);
      lamp(-t.width / 2 + 0.05, tailY - 0.14, rear, 0.14, 0.08, indR);
      lamp(t.width / 2 - 0.05, 0.56, front, 0.14, 0.07, indL);
      lamp(-t.width / 2 + 0.05, 0.56, front, 0.14, 0.07, indR);
    }
    for (const t of CAR_TYPES) {
      const b = this.bodies[t.id];
      b.count = Math.min(this.max, counts[t.id]);
      b.instanceMatrix.needsUpdate = true;
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    }
    this.wheels.count = wi;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.lamps.count = li;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
