// Instanced low-poly people (pedestrians and passengers) with walking, standing and
// sitting poses, plus prams and wheelchairs.
import * as THREE from 'three';

const PARTS = ['legL', 'legR', 'torso', 'armL', 'armR', 'head', 'hair'];

export class PeopleView {
  constructor(max = 260) {
    this.max = max;
    this.group = new THREE.Group();
    this.group.name = 'people';
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
    // Rounded limbs (capsules) hanging from the hip / shoulder pivots.
    const limb = (r, len, sx = 1, sz = 1) => {
      const g = new THREE.CapsuleGeometry(r, len - 2 * r, 2, 7);
      g.scale(sx, 1, sz);
      g.translate(0, -len / 2, 0);
      return g;
    };
    const torso = new THREE.CapsuleGeometry(0.15, 0.34, 3, 9);
    torso.scale(1.38, 1, 0.78);
    torso.translate(0, 0.31, 0);
    const geos = {
      legL: limb(0.074, 0.88, 1, 1.05),
      legR: limb(0.074, 0.88, 1, 1.05),
      torso,
      armL: limb(0.05, 0.62),
      armR: limb(0.05, 0.62),
      head: (() => {
        const g = new THREE.SphereGeometry(0.112, 12, 9);
        g.scale(0.92, 1.12, 1);
        return g;
      })(),
      hair: (() => {
        const g = new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
        g.scale(0.94, 1, 1.02);
        g.translate(0, 0.022, -0.012);
        return g;
      })(),
    };
    this.meshes = {};
    for (const p of PARTS) {
      const m = new THREE.InstancedMesh(geos[p], mat, max);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes[p] = m;
      this.group.add(m);
    }
    // Prams and wheelchairs.
    const pramGeo = mergeBoxes([
      [0.5, 0.35, 0.8, 0, 0.6, 0],
      [0.55, 0.3, 0.45, 0, 0.9, -0.15],
      [0.04, 0.5, 0.04, 0.22, 0.95, 0.45],
      [0.04, 0.5, 0.04, -0.22, 0.95, 0.45],
      [0.5, 0.04, 0.04, 0, 1.2, 0.47],
    ]);
    this.prams = new THREE.InstancedMesh(pramGeo, new THREE.MeshStandardMaterial({ color: '#34495e', roughness: 0.7 }), 30);
    this.prams.count = 0;
    this.prams.frustumCulled = false;
    const chairGeo = mergeBoxes([
      [0.55, 0.06, 0.5, 0, 0.5, 0],
      [0.55, 0.5, 0.06, 0, 0.8, -0.25],
      [0.04, 0.6, 0.6, 0.3, 0.3, 0],
      [0.04, 0.6, 0.6, -0.3, 0.3, 0],
    ]);
    this.chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: '#555b61', roughness: 0.5, metalness: 0.4 }), 20);
    this.chairs.count = 0;
    this.chairs.frustumCulled = false;
    this.group.add(this.prams, this.chairs);
    this.m = new THREE.Matrix4();
    this.root = new THREE.Matrix4();
    this.local = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
    this.colorCache = new Map();
  }

  #color(hex) {
    let c = this.colorCache.get(hex);
    if (!c) this.colorCache.set(hex, (c = new THREE.Color(hex)));
    return c;
  }

  begin() {
    this.n = 0;
    this.np = 0;
    this.nc = 0;
  }

  // pose: 'walk' | 'stand' | 'sit'. y = ground level (sidewalk top or bus floor).
  add(x, y, z, yaw, look, phase, moving, pose = 'walk', extra = null) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const scale = look.height / 1.75;
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.root.compose(this.v.set(x, y, z), this.q, this.s.set(scale * look.width, scale, scale));
    const swing = pose === 'walk' && moving ? Math.sin(phase * 2.2) * 0.55 : 0;
    const bob = pose === 'walk' && moving ? Math.abs(Math.cos(phase * 2.2)) * 0.03 : 0;
    const sit = pose === 'sit' || (extra && extra.wheelchair);
    const hip = sit ? 0.5 : 0.88 + bob;
    const set = (part, px, py, pz, rx, rz = 0) => {
      this.e.set(rx, 0, rz);
      this.q.setFromEuler(this.e);
      this.local.compose(this.v.set(px, py, pz), this.q, this.s.set(1, 1, 1));
      this.m.multiplyMatrices(this.root, this.local);
      this.meshes[part].setMatrixAt(i, this.m);
    };
    if (sit) {
      set('legL', 0.1, hip, 0.02, -Math.PI / 2 + 0.15);
      set('legR', -0.1, hip, 0.02, -Math.PI / 2 + 0.15);
    } else {
      set('legL', 0.1, hip, 0, swing);
      set('legR', -0.1, hip, 0, -swing);
    }
    set('torso', 0, hip, 0, sit ? -0.05 : 0);
    const armRaise = extra && (extra.stroller || extra.wheelchair) && !sit ? -1.1 : 0;
    set('armL', 0.25, hip + 0.56, 0, armRaise || -swing * 0.8, 0.06);
    set('armR', -0.25, hip + 0.56, 0, armRaise || swing * 0.8, -0.06);
    set('head', 0, hip + 0.78, 0, 0);
    set('hair', 0, hip + 0.8, 0, 0);
    this.meshes.legL.setColorAt(i, this.#color(look.trousers));
    this.meshes.legR.setColorAt(i, this.#color(look.trousers));
    this.meshes.torso.setColorAt(i, this.#color(look.shirt));
    this.meshes.armL.setColorAt(i, this.#color(look.shirt));
    this.meshes.armR.setColorAt(i, this.#color(look.shirt));
    this.meshes.head.setColorAt(i, this.#color(look.skin));
    this.meshes.hair.setColorAt(i, this.#color(look.hair));
    if (extra && extra.stroller && this.np < 30) {
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      this.m.compose(this.v.set(x + Math.sin(yaw) * 0.85, y, z + Math.cos(yaw) * 0.85), this.q, this.s.set(1, 1, 1));
      this.prams.setMatrixAt(this.np++, this.m);
    }
    if (extra && extra.wheelchair && this.nc < 20) {
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      this.m.compose(this.v.set(x, y, z), this.q, this.s.set(1, 1, 1));
      this.chairs.setMatrixAt(this.nc++, this.m);
    }
  }

  end() {
    for (const p of PARTS) {
      const m = this.meshes[p];
      m.count = this.n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.prams.count = this.np;
    this.prams.instanceMatrix.needsUpdate = true;
    this.chairs.count = this.nc;
    this.chairs.instanceMatrix.needsUpdate = true;
  }
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function mergeBoxes(list) {
  const pos = [];
  const nor = [];
  for (const [w, h, d, x, y, z] of list) {
    const g = box(w, h, d, x, y, z).toNonIndexed();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

export { mergeBoxes };
