// Instanced AI cars: per visual variant a painted body (colour per car, clear-coat) and the
// dark parts (glass, grille, bumpers), plus shared wheels (steering and rolling), lamps
// (brake lights, indicators, headlights, hazard lights after a crash), number plates,
// taxi signs and a soft contact shadow under every car.
import * as THREE from 'three';
import { VARIANTS, VARIANTS_OF, buildCar, wheelGeometry, carLayout } from './carModels.js';

const LAMP = {
  off: new THREE.Color('#2a0c0a'),
  tail: new THREE.Color('#9a120a').multiplyScalar(1.4),
  brake: new THREE.Color('#ff2010').multiplyScalar(2.4),
  ind: new THREE.Color('#ff9a1a').multiplyScalar(2.2),
  indOff: new THREE.Color('#4a2e10'),
  head: new THREE.Color('#fff4de').multiplyScalar(2.6),
  headOff: new THREE.Color('#aab4bd'),
};

const PLATES = 8;

function plateTexture() {
  const W = 256;
  const H = 56;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H * PLATES;
  const g = c.getContext('2d');
  const letters = ['NK·B 214', 'NK·AL 87', 'NK·R 3301', 'LH·K 120', 'NK·MS 45', 'SW·E 918', 'NK·T 777', 'BG·P 62'];
  for (let k = 0; k < PLATES; k++) {
    const y = k * H;
    g.fillStyle = '#1b1b1b';
    g.fillRect(0, y, W, H);
    g.fillStyle = '#f4f4ef';
    g.fillRect(3, y + 3, W - 6, H - 6);
    g.fillStyle = '#1d3f9a';
    g.fillRect(3, y + 3, 30, H - 6);
    g.fillStyle = '#f2d21b';
    g.beginPath();
    g.arc(18, y + 18, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = 'bold 18px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('D', 18, y + 46);
    g.fillStyle = '#111';
    g.font = 'bold 34px "Arial Narrow", Arial, sans-serif';
    g.fillText(letters[k], 145, y + 41, 200);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function taxiTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#f5d20f';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#111';
  g.font = 'bold 24px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI', 64, 17);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.12, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.42)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

export class TrafficView {
  constructor(max = 60, { quality = 'medium' } = {}) {
    this.max = max;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    const paintOpts = { roughness: 0.38, metalness: 0.3, envMapIntensity: 1.15 };
    const paint = quality === 'low' ? new THREE.MeshStandardMaterial(paintOpts) : new THREE.MeshPhysicalMaterial({ ...paintOpts, clearcoat: 1, clearcoatRoughness: 0.08 });
    const dark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.55, envMapIntensity: 1.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const inst = (geo, mat, n, cast = true) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.castShadow = cast;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    this.variants = {};
    for (const id of Object.keys(VARIANTS)) {
      const car = buildCar(id);
      this.variants[id] = { body: inst(car.body, paint, max), dark: inst(car.dark, dark, max, false), layout: carLayout(id), n: 0 };
    }
    this.wheels = inst(wheelGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), max * 6);
    this.lamps = inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), max * 8, false);
    // Number plates: 8 different ones in an atlas, picked per plate by an instanced attribute.
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.35, metalness: 0.1 });
    plateMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float plateRow;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv.y = (vMapUv.y + plateRow) / ${PLATES.toFixed(1)};`);
    };
    const plateGeo = new THREE.PlaneGeometry(0.52, 0.12);
    this.plateRows = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 1);
    this.plateRows.setUsage(THREE.DynamicDrawUsage);
    plateGeo.setAttribute('plateRow', this.plateRows);
    this.plates = inst(plateGeo, plateMat, max * 2, false);
    const signGeo = new THREE.BoxGeometry(0.62, 0.17, 0.26);
    this.signs = inst(signGeo, new THREE.MeshStandardMaterial({ map: taxiTexture(), roughness: 0.4, emissive: new THREE.Color('#ffd84a'), emissiveIntensity: 0 }), max, false);
    this.signMat = this.signs.material;
    const shGeo = new THREE.PlaneGeometry(1, 1);
    shGeo.rotateX(-Math.PI / 2);
    this.shadows = inst(shGeo, new THREE.MeshBasicMaterial({ map: shadowTexture(), color: '#000000', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), max, false);
    this.shadows.renderOrder = 1;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    this.local = new THREE.Matrix4();
    this.root = new THREE.Matrix4();
    this.paint = new THREE.Color();
    this.blink = 0;
    this.prevYaw = new WeakMap();
  }

  update(vehicles, dt, { lights = false } = {}) {
    this.blink = (this.blink + dt) % 0.8;
    const blinkOn = this.blink < 0.4;
    for (const V of Object.values(this.variants)) V.n = 0;
    let wi = 0;
    let li = 0;
    let pi = 0;
    let ti = 0;
    let si = 0;
    this.signMat.emissiveIntensity = lights ? 0.8 : 0;
    const part = (mesh, idx, x, y, z, yaw, sx, sy, sz, rx = 0) => {
      this.e.set(rx, yaw, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.local.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, sz));
      this.m.multiplyMatrices(this.root, this.local);
      mesh.setMatrixAt(idx, this.m);
    };
    for (const v of vehicles) {
      const ids = VARIANTS_OF[v.type] || VARIANTS_OF.sedan;
      const vid = ids[(v.uid || 0) % ids.length];
      const V = this.variants[vid];
      if (V.n >= this.max) continue;
      const i = V.n++;
      const L = V.layout;
      this.e.set(-v.pitch, v.yaw, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.root.compose(this.v.set(v.x, 0, v.z), this.q, this.s.set(1, 1, 1));
      V.body.setMatrixAt(i, this.root);
      V.body.setColorAt(i, this.paint.set(v.color));
      V.dark.setMatrixAt(i, this.root);
      // Steering from the yaw rate (bicycle model).
      const prev = this.prevYaw.get(v);
      let rate = 0;
      if (prev !== undefined && dt > 0) {
        let d = v.yaw - prev;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        rate = d / dt;
      }
      this.prevYaw.set(v, v.yaw);
      const steer = Math.max(-0.6, Math.min(0.6, Math.atan((L.wheelbase * rate) / Math.max(v.v, 0.5))));
      for (const w of L.wheels) {
        const yaw = w.front ? steer : 0;
        for (const side of [1, -1]) {
          if (wi >= this.max * 6) break;
          part(this.wheels, wi++, side * w.x, w.r, w.z, yaw, w.r, w.r, w.r, v.spin);
          if (!w.front && vid === 'truck' && wi < this.max * 6) part(this.wheels, wi++, side * (w.x - 0.26), w.r, w.z, 0, w.r, w.r, w.r, v.spin);
        }
      }
      // Lamps: rear (tail/brake), front (head), indicators at the four corners.
      const hazard = v.hazard && blinkOn;
      const tail = v.braking ? LAMP.brake : lights ? LAMP.tail : LAMP.off;
      const head = lights ? LAMP.head : LAMP.headOff;
      const indL = (v.indicator === 1 && blinkOn) || hazard ? LAMP.ind : LAMP.indOff;
      const indR = (v.indicator === -1 && blinkOn) || hazard ? LAMP.ind : LAMP.indOff;
      const lamp = (x, y, z, sx, sy, color, yaw = 0) => {
        part(this.lamps, li, x, y, z, yaw, sx, sy, 0.05);
        this.lamps.setColorAt(li, color);
        li++;
      };
      const { head: H, tail: T } = L;
      // Slim lamps that wrap a little around the corners.
      lamp(H.x, H.y, H.z - 0.02, 0.42, 0.075, head, 0.28);
      lamp(-H.x, H.y, H.z - 0.02, 0.42, 0.075, head, -0.28);
      lamp(T.x, T.y, T.z + 0.02, 0.36, 0.09, tail, -0.25);
      lamp(-T.x, T.y, T.z + 0.02, 0.36, 0.09, tail, 0.25);
      lamp(H.x + 0.2, H.y - 0.04, H.z - 0.02, 0.1, 0.07, indL);
      lamp(-H.x - 0.2, H.y - 0.04, H.z - 0.02, 0.1, 0.07, indR);
      lamp(T.x + 0.15, T.y - 0.12, T.z, 0.12, 0.07, indL);
      lamp(-T.x - 0.15, T.y - 0.12, T.z, 0.12, 0.07, indR);
      // Plates (front and rear), taxi sign, contact shadow.
      const row = (v.uid || 0) % PLATES;
      this.plateRows.array[pi] = row;
      part(this.plates, pi++, 0, L.plateF.y, L.plateF.z, 0, 1, 1, 1);
      this.plateRows.array[pi] = row;
      part(this.plates, pi++, 0, L.plateR.y, L.plateR.z, Math.PI, 1, 1, 1);
      if (vid === 'taxi') part(this.signs, ti++, 0, L.roof + 0.1, -0.15, 0, 1, 1, 1);
      part(this.shadows, si++, 0, 0.03, 0, 0, L.width * 1.3, 1, L.length * 1.12);
    }
    for (const V of Object.values(this.variants)) {
      for (const m of [V.body, V.dark]) {
        m.count = V.n;
        m.instanceMatrix.needsUpdate = true;
      }
      if (V.body.instanceColor) V.body.instanceColor.needsUpdate = true;
    }
    const done = (m, n) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    };
    done(this.wheels, wi);
    done(this.lamps, li);
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    done(this.plates, pi);
    this.plateRows.needsUpdate = true;
    done(this.signs, ti);
    done(this.shadows, si);
  }
}
