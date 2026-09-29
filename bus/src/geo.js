// Tiny geometry builder: collects triangles (position, normal, uv, colour) and turns them
// into one BufferGeometry. Used to merge thousands of boxes/quads into few draw calls.
import * as THREE from 'three';

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpN = new THREE.Vector3();

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
  }

  get empty() {
    return this.pos.length === 0;
  }

  // Triangle with explicit normal (winding fixed to face the normal).
  tri(a, b, c, n, ua, ub, uc, color) {
    tmpA.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    tmpB.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    tmpN.crossVectors(tmpA, tmpB);
    if (tmpN.x * n[0] + tmpN.y * n[1] + tmpN.z * n[2] < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
    }
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...n, ...n, ...n);
    this.uv.push(...ua, ...ub, ...uc);
    const [r, g, bl] = color || [1, 1, 1];
    this.col.push(r, g, bl, r, g, bl, r, g, bl);
  }

  // Quad a-b-c-d (any winding) facing normal n.
  quad(a, b, c, d, n, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]], color) {
    this.tri(a, b, c, n, uvs[0], uvs[1], uvs[2], color);
    this.tri(a, c, d, n, uvs[0], uvs[2], uvs[3], color);
  }

  // Axis-aligned-in-local-frame box: centre (x, y, z), size (sx, sy, sz), rotated by yaw about y.
  // uvScale: metres per texture unit (world-scaled UVs), or null for 0..1 per face.
  box(x, y, z, sx, sy, sz, yaw = 0, color, { uvScale = null, faces = 'all' } = {}) {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const N = (lx, ly, lz) => [lx * c + lz * s, ly, -lx * s + lz * c];
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const uvq = (w, h) => (uvScale ? [[0, 0], [w / uvScale, 0], [w / uvScale, h / uvScale], [0, h / uvScale]] : undefined);
    const f = faces === 'all' ? ['px', 'nx', 'py', 'ny', 'pz', 'nz'] : faces;
    if (f.includes('pz')) this.quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 0, 1), uvq(sx, sy), color);
    if (f.includes('nz')) this.quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N(0, 0, -1), uvq(sx, sy), color);
    if (f.includes('px')) this.quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), N(1, 0, 0), uvq(sz, sy), color);
    if (f.includes('nx')) this.quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N(-1, 0, 0), uvq(sz, sy), color);
    if (f.includes('py')) this.quad(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), N(0, 1, 0), uvq(sx, sz), color);
    if (f.includes('ny')) this.quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), N(0, -1, 0), uvq(sx, sz), color);
  }

  // Vertical cylinder (or cone with r1 != r0) at (x, y0) up to y1.
  cylinder(x, y0, z, r0, r1, h, seg = 10, color, caps = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const am = (a0 + a1) / 2;
      const n = [Math.cos(am), (r0 - r1) / h, Math.sin(am)];
      const l = Math.hypot(n[0], n[1], n[2]);
      n[0] /= l;
      n[1] /= l;
      n[2] /= l;
      this.quad([x + c0 * r0, y0, z + s0 * r0], [x + c1 * r0, y0, z + s1 * r0], [x + c1 * r1, y0 + h, z + s1 * r1], [x + c0 * r1, y0 + h, z + s0 * r1], n, [[i / seg, 0], [(i + 1) / seg, 0], [(i + 1) / seg, 1], [i / seg, 1]], color);
      if (caps && r1 > 0.001) this.tri([x, y0 + h, z], [x + c0 * r1, y0 + h, z + s0 * r1], [x + c1 * r1, y0 + h, z + s1 * r1], [0, 1, 0], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5], color);
    }
  }

  // Flat polygon (flat [x0, z0, x1, z1, ...]) at height y facing up; uv = world / uvScale.
  polygon(pts, y, uvScale = 1, color, holes = []) {
    const contour = [];
    for (let i = 0; i < pts.length; i += 2) contour.push(new THREE.Vector2(pts[i], pts[i + 1]));
    const holeVecs = holes.map((h) => {
      const arr = [];
      for (let i = 0; i < h.length; i += 2) arr.push(new THREE.Vector2(h[i], h[i + 1]));
      return arr;
    });
    const all = contour.concat(...holeVecs);
    const tris = THREE.ShapeUtils.triangulateShape(contour, holeVecs);
    for (const [a, b, c] of tris) {
      const P = (v) => [all[v].x, y, all[v].y];
      const U = (v) => [all[v].x / uvScale, -all[v].y / uvScale];
      this.tri(P(a), P(b), P(c), [0, 1, 0], U(a), U(b), U(c), color);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const hexRgb = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// Adds a subtle large-scale brightness variation (world space noise) so tiled textures
// don't look like wallpaper. Works on MeshStandardMaterial.
export function addMacroVariation(material, amount = 0.14, scale = 0.035) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMacroAmount = { value: amount };
    shader.uniforms.uMacroScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMacroPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vMacroPos;
uniform float uMacroAmount;
uniform float uMacroScale;
float mh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mh(i), mh(i+vec2(1,0)), f.x), mix(mh(i+vec2(0,1)), mh(i+vec2(1,1)), f.x), f.y); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{ vec2 q = vMacroPos.xz * uMacroScale;
  float n = mn(q) * 0.6 + mn(q * 3.1) * 0.4;
  diffuseColor.rgb *= 1.0 - uMacroAmount + n * uMacroAmount * 1.6; }`,
      );
  };
  material.customProgramCacheKey = () => `macro${amount}${scale}`;
}
