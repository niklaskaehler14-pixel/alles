// Tyre smoke, dust, sparks and skid marks.
import * as THREE from 'three';
import { smokeTexture } from './textures.js';

const PARTICLE_VS = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const PARTICLE_FS = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, tex.a * vAlpha);
    #include <fog_fragment>
  }
`;

class ParticlePool {
  constructor(scene, count, { additive = false, texture } = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.alpha0 = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.gravity = new Float32Array(count);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uScale: { value: 400 } }]);
    this.uniforms.uMap.value = texture;
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(x, y, z, vx, vy, vz, size, grow, alpha, life, r, g, b, drag = 1.5, gravity = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.grow[i] = grow;
    this.alpha0[i] = alpha;
    this.alpha[i] = alpha;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.alpha0[i] * t * Math.min(1, (1 - t) * 8);
    }
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[name].needsUpdate = true;
  }
}

class SkidMarks {
  constructor(scene, maxSegments = 2400) {
    this.max = maxSegments;
    this.pos = new Float32Array(maxSegments * 4 * 3);
    this.alpha = new Float32Array(maxSegments * 4);
    const index = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.02,0.02,0.025, vA); }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.geo = geo;
    this.next = 0;
    this.dirty = false;
  }

  // Adds a quad from the previous left/right edge points to the new ones.
  add(prev, cur, strength) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const o = i * 12;
    this.pos.set([prev.lx, prev.y, prev.lz, prev.rx, prev.y, prev.rz, cur.lx, cur.y, cur.lz, cur.rx, cur.y, cur.rz], o);
    const a = Math.min(0.75, strength * 0.8);
    this.alpha.set([prev.a ?? a, prev.a ?? a, a, a], i * 4);
    cur.a = a;
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.alpha.fill(0);
    this.dirty = true;
  }
}

export class Effects {
  constructor(scene) {
    const tex = smokeTexture();
    this.smoke = new ParticlePool(scene, 420, { texture: tex });
    this.sparks = new ParticlePool(scene, 160, { texture: tex, additive: true });
    this.skids = new SkidMarks(scene);
    this.trails = new Map();
  }

  setViewportHeight(h, fov) {
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.smoke.uniforms.uScale.value = scale;
    this.sparks.uniforms.uScale.value = scale;
  }

  // Emit smoke/dust for a wheel contact point.
  wheelEmit(x, y, z, vx, vz, intensity, surface, night) {
    if (intensity <= 0.02) return;
    const dust = surface !== 0;
    const n = dust ? 2 : 1;
    for (let k = 0; k < n; k++) {
      if (Math.random() > intensity * (dust ? 0.9 : 0.75)) continue;
      const c = dust ? [0.52, 0.45, 0.36] : night ? [0.35, 0.36, 0.38] : [0.86, 0.86, 0.85];
      this.smoke.spawn(
        x + (Math.random() - 0.5) * 0.4,
        y + 0.25,
        z + (Math.random() - 0.5) * 0.4,
        vx * 0.25 + (Math.random() - 0.5) * 1.5,
        0.6 + Math.random() * 1.1,
        vz * 0.25 + (Math.random() - 0.5) * 1.5,
        dust ? 1.2 : 1.0,
        dust ? 3.2 : 3.8,
        (dust ? 0.5 : 0.42) * Math.min(1, intensity + 0.2),
        dust ? 1.6 : 2.2,
        c[0],
        c[1],
        c[2],
        1.1,
      );
    }
  }

  sparkBurst(x, y, z, nx, nz, strength) {
    const n = Math.min(40, Math.floor(strength * 2));
    for (let i = 0; i < n; i++) {
      const s = 3 + Math.random() * strength * 0.4;
      this.sparks.spawn(x, y + 0.4, z, nx * s + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, nz * s + (Math.random() - 0.5) * 4, 0.12, -0.05, 1, 0.35 + Math.random() * 0.3, 1.0, 0.72, 0.35, 0.8, 9.8);
    }
  }

  // Continue or break a skid trail for a wheel id.
  skid(id, x, y, z, yaw, active, strength) {
    let t = this.trails.get(id);
    if (!active || strength < 0.12) {
      if (t) t.active = false;
      return;
    }
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const w = 0.13;
    const cur = { lx: x + cs * w, lz: z - sn * w, rx: x - cs * w, rz: z + sn * w, y: y + 0.07, x, z };
    if (!t || !t.active) {
      this.trails.set(id, { active: true, last: cur });
      return;
    }
    const d = Math.hypot(x - t.last.x, z - t.last.z);
    if (d < 0.35) return;
    if (d > 3) {
      t.last = cur;
      return;
    }
    this.skids.add(t.last, cur, strength);
    t.last = cur;
  }

  update(dt) {
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.skids.flush();
  }

  reset() {
    this.skids.clear();
    this.trails.clear();
  }
}
