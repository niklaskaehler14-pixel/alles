// Builds the renderable world (terrain, road, city, vegetation, water, sky, lights) from WorldData.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, ROAD, CITY } from './config.js';
import { mulberry32, createNoise2D } from './noise.js';
import { clamp, lerp, smoothstep } from './util.js';
import * as TX from './textures.js';

export const TIME_PRESETS = {
  day: {
    label: 'Tag',
    elevation: 46,
    azimuth: 205,
    sun: '#fff1dc',
    sunIntensity: 2.7,
    hemiSky: '#c4dcff',
    hemiGround: '#4f5a3c',
    hemiIntensity: 0.8,
    fog: '#b8cadb',
    fogDensity: 0.00016,
    turbidity: 3,
    rayleigh: 1.25,
    mie: 0.004,
    mieG: 0.8,
    exposure: 0.5,
    clouds: 0.38,
    env: 0.85,
    night: 0,
  },
  evening: {
    label: 'Abend',
    elevation: 4.5,
    azimuth: 262,
    sun: '#ffac6b',
    sunIntensity: 2.3,
    hemiSky: '#f3bf98',
    hemiGround: '#3d3630',
    hemiIntensity: 0.62,
    fog: '#cf9f86',
    fogDensity: 0.0002,
    turbidity: 7,
    rayleigh: 2.6,
    mie: 0.006,
    mieG: 0.86,
    exposure: 0.56,
    clouds: 0.45,
    env: 0.85,
    night: 0.35,
  },
  night: {
    label: 'Nacht',
    elevation: -12,
    azimuth: 250,
    moonElevation: 38,
    moonAzimuth: 40,
    sun: '#9db6ff',
    sunIntensity: 0.32,
    hemiSky: '#2b3a58',
    hemiGround: '#0c0e12',
    hemiIntensity: 0.34,
    fog: '#0c1422',
    fogDensity: 0.00032,
    turbidity: 2,
    rayleigh: 0.6,
    mie: 0.003,
    mieG: 0.8,
    exposure: 0.95,
    clouds: 0.12,
    env: 0.28,
    night: 1,
  },
};

function colorizeGeometry(geo, hex, jitter = 0.06, rng = Math.random) {
  const base = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = 1 + (rng() - 0.5) * 2 * jitter;
    col[i * 3] = base.r * k;
    col[i * 3 + 1] = base.g * k;
    col[i * 3 + 2] = base.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function addSway(material, uniforms, strength = 0.05) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 tp = instanceMatrix[3].xz;
          float sway = sin(uTime * 1.3 + tp.x * 0.05 + tp.y * 0.07) + 0.5 * sin(uTime * 2.7 + tp.y * 0.11);
          float bend = max(0.0, position.y - 2.5);
          transformed.x += sway * ${strength.toFixed(3)} * bend;
          transformed.z += sway * ${(strength * 0.6).toFixed(3)} * bend;
        #endif`,
      );
  };
}

export class WorldView {
  constructor({ renderer, scene, data, quality }) {
    this.renderer = renderer;
    this.scene = scene;
    this.data = data;
    this.quality = quality;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.uniforms = { uTime: { value: 0 } };
    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);
    this.treeChunks = [];
    this.night = 0;
    this.startLights = [];
  }

  // ------------------------------------------------------------------ terrain
  buildTerrain() {
    const d = this.data;
    const hf = d.heightfield;
    const S = hf.segments;
    const stride = hf.stride;
    const cell = hf.cell;
    const count = stride * stride;
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const noise = createNoise2D(mulberry32(77));
    const H = hf.heights;

    const C = (hex) => new THREE.Color(hex);
    const grassA = C('#4d6b2b');
    const grassB = C('#7c8742');
    const forest = C('#3a4f26');
    const rock = C('#77716a');
    const rockDark = C('#5b5751');
    const alpine = C('#7f7d5f');
    const snow = C('#eef2f6');
    const sand = C('#c2b183');
    const mud = C('#5c5645');
    const gravel = C('#80766a');
    const concrete = C('#8f8b84');
    const tmp = new THREE.Color();
    const tmp2 = new THREE.Color();

    for (let iz = 0; iz <= S; iz++) {
      for (let ix = 0; ix <= S; ix++) {
        const i = ix + iz * stride;
        const x = hf.worldX(ix);
        const z = hf.worldZ(iz);
        const h = H[i];
        const hl = H[Math.max(ix - 1, 0) + iz * stride];
        const hr = H[Math.min(ix + 1, S) + iz * stride];
        const hd = H[ix + Math.max(iz - 1, 0) * stride];
        const hu = H[ix + Math.min(iz + 1, S) * stride];
        let nx = -(hr - hl) / (2 * cell);
        let nz = -(hu - hd) / (2 * cell);
        let ny = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        normals[i * 3] = nx;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = nz;

        const n1 = noise(x * 0.0035, z * 0.0035);
        const n2 = noise(x * 0.021, z * 0.021);
        const n3 = noise(x * 0.0012 + 40, z * 0.0012);
        tmp.copy(grassA).lerp(grassB, smoothstep(-0.35, 0.7, n1));
        tmp.lerp(forest, smoothstep(0.1, 0.6, n3) * 0.6);
        const slope = 1 - ny;
        tmp.lerp(alpine, smoothstep(170, 270, h) * 0.8);
        tmp2.copy(rock).lerp(rockDark, smoothstep(-0.4, 0.5, n2));
        tmp.lerp(tmp2, smoothstep(0.16, 0.34, slope + n2 * 0.04) );
        tmp.lerp(tmp2, smoothstep(300, 360, h) * 0.7);
        tmp.lerp(snow, smoothstep(390, 450, h + n2 * 25) * smoothstep(0.5, 0.8, ny));
        tmp.lerp(sand, smoothstep(3.4, 1.4, h + n2 * 0.6));
        tmp.lerp(mud, smoothstep(-0.5, -6, h));
        const rd = d.roadDist[i];
        tmp.lerp(gravel, smoothstep(ROAD.halfTotal + 7, ROAD.halfTotal + 1, rd) * 0.85);
        const dCity = Math.hypot(x - CITY.x, z - CITY.z);
        tmp.lerp(concrete, smoothstep(CITY.radius + 20, CITY.radius - 20, dCity));
        const shade = 1 + n2 * 0.06;
        colors[i * 3] = tmp.r * shade;
        colors[i * 3 + 1] = tmp.g * shade;
        colors[i * 3 + 2] = tmp.b * shade;
      }
    }

    const detail = TX.detailTexture();
    detail.anisotropy = this.aniso;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.97, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          float d1 = texture2D( map, vMapUv ).r;
          float d2 = texture2D( map, vMapUv * 0.137 + 0.31 ).r;
          diffuseColor.rgb *= ( d1 * 0.55 + d2 * 0.45 ) * 1.3;
        #endif`,
      );
    };
    this.terrainMaterial = material;

    const CH = 128;
    const chunks = S / CH;
    const index = [];
    for (let z = 0; z < CH; z++) {
      for (let x = 0; x < CH; x++) {
        const a = x + z * (CH + 1);
        const b = a + 1;
        const c = a + (CH + 1);
        const e = c + 1;
        index.push(a, c, b, b, c, e);
      }
    }
    const terrain = new THREE.Group();
    terrain.name = 'terrain';
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) {
        const vcount = (CH + 1) * (CH + 1);
        const pos = new Float32Array(vcount * 3);
        const nor = new Float32Array(vcount * 3);
        const col = new Float32Array(vcount * 3);
        const uv = new Float32Array(vcount * 2);
        let k = 0;
        for (let z = 0; z <= CH; z++) {
          for (let x = 0; x <= CH; x++) {
            const ix = cx * CH + x;
            const iz = cz * CH + z;
            const gi = ix + iz * stride;
            const wx = hf.worldX(ix);
            const wz = hf.worldZ(iz);
            pos[k * 3] = wx;
            pos[k * 3 + 1] = H[gi];
            pos[k * 3 + 2] = wz;
            nor.set(normals.subarray(gi * 3, gi * 3 + 3), k * 3);
            col.set(colors.subarray(gi * 3, gi * 3 + 3), k * 3);
            uv[k * 2] = wx / 5;
            uv[k * 2 + 1] = wz / 5;
            k++;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(index);
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        terrain.add(mesh);
      }
    }
    this.root.add(terrain);
    this.terrain = terrain;
  }

  // ------------------------------------------------------------------ road
  buildRoad() {
    const tr = this.data.track;
    const n = tr.count;
    const cols = [-ROAD.halfTotal, -ROAD.half, -ROAD.half * 0.5, 0, ROAD.half * 0.5, ROAD.half, ROAD.halfTotal];
    const drop = [-0.12, 0, 0, 0, 0, 0, -0.12];
    const nc = cols.length;
    const rows = n + 1;
    const pos = new Float32Array(rows * nc * 3);
    const uv = new Float32Array(rows * nc * 2);
    for (let i = 0; i < rows; i++) {
      const idx = i % n;
      const s = i * tr.spacing;
      const lx = tr.tz[idx];
      const lz = -tr.tx[idx];
      for (let c = 0; c < nc; c++) {
        const k = i * nc + c;
        pos[k * 3] = tr.x[idx] + lx * cols[c];
        pos[k * 3 + 1] = tr.h[idx] + drop[c] + 0.04;
        pos[k * 3 + 2] = tr.z[idx] + lz * cols[c];
        uv[k * 2] = (cols[c] + ROAD.halfTotal) / (2 * ROAD.halfTotal);
        uv[k * 2 + 1] = s / 20;
      }
    }
    const index = [];
    for (let i = 0; i < rows - 1; i++) {
      for (let c = 0; c < nc - 1; c++) {
        const a = i * nc + c;
        const b = a + 1;
        const cc = a + nc;
        const dd = cc + 1;
        index.push(a, cc, b, b, cc, dd);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      map: TX.roadTexture(this.aniso),
      roughness: 0.86,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    road.name = 'road';
    this.root.add(road);
    this.roadMaterial = mat;

    this.#buildCurbs();
    this.#buildStart();
  }

  #buildCurbs() {
    const tr = this.data.track;
    const n = tr.count;
    const flags = new Uint8Array(n);
    const thr = 1 / 240;
    for (let i = 0; i < n; i++) {
      if (Math.abs(tr.curv[i]) > thr) for (let k = -14; k <= 14; k++) flags[(i + k + n) % n] = 1;
    }
    // Keep curbs off the start straight.
    for (let k = -40; k <= 40; k++) flags[(tr.startIndex + k + n) % n] = 0;
    tr.curbFlags = flags;

    const positions = [];
    const uvs = [];
    const index = [];
    const profile = [
      [ROAD.half - 1.0, 0.045],
      [ROAD.half - 0.3, 0.1],
      [ROAD.half + 0.35, 0.05],
    ];
    let vbase = 0;
    for (const side of [1, -1]) {
      let i = 0;
      while (i < n) {
        if (!flags[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j < n && flags[j]) j++;
        const count = j - i + 1;
        for (let r = 0; r < count; r++) {
          const idx = (i + r) % n;
          const lx = tr.tz[idx];
          const lz = -tr.tx[idx];
          for (let p = 0; p < profile.length; p++) {
            const lat = profile[side > 0 ? p : profile.length - 1 - p][0] * side;
            const up = profile[side > 0 ? p : profile.length - 1 - p][1];
            positions.push(tr.x[idx] + lx * lat, tr.h[idx] + up, tr.z[idx] + lz * lat);
            uvs.push(p / (profile.length - 1), ((i + r) * tr.spacing) / 8);
          }
        }
        for (let r = 0; r < count - 1; r++) {
          for (let p = 0; p < profile.length - 1; p++) {
            const a = vbase + r * profile.length + p;
            const b = a + 1;
            const c = a + profile.length;
            const d = c + 1;
            // Columns increase to the left for side>0 and to the right for side<0 (reversed), keep winding up.
            if (side > 0) index.push(a, c, b, b, c, d);
            else index.push(a, c, b, b, c, d);
          }
        }
        vbase += count * profile.length;
        i = j;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: TX.curbTexture(),
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
    });
    const curbs = new THREE.Mesh(geo, mat);
    curbs.receiveShadow = true;
    this.root.add(curbs);
  }

  #buildStart() {
    const tr = this.data.track;
    const p = tr.pointAt(tr.startS, 0, {});
    const group = new THREE.Group();
    group.position.set(p.x, p.h, p.z);
    group.rotation.y = p.heading;
    // Checkered line
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD.width, 2),
      new THREE.MeshStandardMaterial({ map: TX.checkerTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.05;
    line.receiveShadow = true;
    group.add(line);
    // Grid boxes behind the line
    const boxTex = TX.gridBoxTexture();
    const boxMat = new THREE.MeshBasicMaterial({ map: boxTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0xdddddd });
    const boxes = [];
    for (let k = 0; k < 6; k++) {
      const row = Math.floor(k / 2);
      const col = k % 2;
      const g = new THREE.PlaneGeometry(2.6, 5.2);
      g.rotateX(-Math.PI / 2);
      g.translate(col ? -2.6 : 2.6, 0.05, -8 - row * 9 - col * 4.5);
      boxes.push(g);
    }
    group.add(new THREE.Mesh(mergeGeometries(boxes), boxMat));
    // Gantry
    const steel = new THREE.MeshStandardMaterial({ color: '#2b2f36', metalness: 0.6, roughness: 0.45 });
    const span = ROAD.width + 5;
    for (const sd of [1, -1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8, 0.9), steel);
      pillar.position.set((span / 2) * sd, 4, 0);
      pillar.castShadow = true;
      group.add(pillar);
      const wp = new THREE.Vector3((span / 2) * sd, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
      this.data.colliders.addCircle(p.x + wp.x, p.z + wp.z, 0.7, 'pole');
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.9, 1.6, 1.1), steel);
    beam.position.set(0, 7.6, 0);
    beam.castShadow = true;
    group.add(beam);
    const bannerMat = new THREE.MeshStandardMaterial({ map: TX.bannerTexture('START · ZIEL', 'Seeufer-Ring · 8,1 km'), emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.5 });
    bannerMat.emissiveMap = bannerMat.map;
    for (const sd of [1, -1]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(span - 1, 1.3), bannerMat);
      banner.position.set(0, 7.6, 0.56 * sd);
      if (sd < 0) banner.rotation.y = Math.PI;
      group.add(banner);
    }
    // Countdown lights facing the grid (towards -z local)
    const lampGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 20);
    lampGeo.rotateX(Math.PI / 2);
    for (let k = 0; k < 5; k++) {
      const mat = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ff2a1a', emissiveIntensity: 0, roughness: 0.3 });
      const lamp = new THREE.Mesh(lampGeo, mat);
      lamp.position.set((k - 2) * 0.9, 6.55, -0.6);
      group.add(lamp);
      this.startLights.push(mat);
    }
    this.root.add(group);
    this.startGroup = group;
  }

  // state: number of red lights (0..5) or 'green' or 'off'
  setStartLights(state) {
    this.startLights.forEach((mat, k) => {
      if (state === 'green') {
        mat.emissive.set('#27ff5a');
        mat.emissiveIntensity = 6;
      } else if (typeof state === 'number') {
        mat.emissive.set('#ff2a1a');
        mat.emissiveIntensity = k < state ? 7 : 0;
      } else mat.emissiveIntensity = 0;
    });
  }

  // ------------------------------------------------------------------ city
  buildCity() {
    const d = this.data;
    const R = CITY.radius;
    const size = R * 2 + 60;
    const tex = TX.cityGroundTexture(size, CITY.grid, CITY.street, CITY.x, CITY.z, R + 10);
    tex.anisotropy = this.aniso;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(CITY.x, d.cityHeight + 0.03, CITY.z);
    ground.receiveShadow = true;
    ground.renderOrder = -1;
    this.root.add(ground);

    const styles = [0, 1, 2].map(() => ({ pos: [], nor: [], uv: [] }));
    const roof = { pos: [], nor: [], uv: [] };
    const rng = mulberry32(404);
    const quad = (t, p0, p1, p2, p3, n, uv0, uv1) => {
      // p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left (counter-clockwise seen from outside)
      for (const [p, u] of [
        [p0, [uv0[0], uv0[1]]],
        [p1, [uv1[0], uv0[1]]],
        [p2, [uv1[0], uv1[1]]],
        [p0, [uv0[0], uv0[1]]],
        [p2, [uv1[0], uv1[1]]],
        [p3, [uv0[0], uv1[1]]],
      ]) {
        t.pos.push(p[0], p[1], p[2]);
        t.nor.push(n[0], n[1], n[2]);
        t.uv.push(u[0], u[1]);
      }
    };
    const box = (t, x0, y0, z0, x1, y1, z1, tileW, tileH, withTop = null) => {
      const h = y1 - y0;
      const wx = x1 - x0;
      const wz = z1 - z0;
      // +z face
      quad(t, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [0, 0], [wx / tileW, h / tileH]);
      // -z face
      quad(t, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [0, 0], [wx / tileW, h / tileH]);
      // +x face
      quad(t, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [0, 0], [wz / tileW, h / tileH]);
      // -x face
      quad(t, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [0, 0], [wz / tileW, h / tileH]);
      const top = withTop || t;
      quad(top, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 / 8, z1 / 8], [x1 / 8, z0 / 8]);
    };
    for (const b of d.buildings) {
      const x0 = b.x - b.w / 2;
      const x1 = b.x + b.w / 2;
      const z0 = b.z - b.d / 2;
      const z1 = b.z + b.d / 2;
      const y0 = b.y - 0.5;
      const y1 = b.y + b.h;
      box(styles[b.style], x0, y0, z0, x1, y1, z1, 12, 14, roof);
      // Parapet and rooftop plant
      box(roof, x0 + 0.2, y1, z0 + 0.2, x1 - 0.2, y1 + 0.8, z0 + 0.6, 6, 6);
      box(roof, x0 + 0.2, y1, z1 - 0.6, x1 - 0.2, y1 + 0.8, z1 - 0.2, 6, 6);
      const units = 1 + Math.floor(rng() * 3);
      for (let u = 0; u < units; u++) {
        const ux = lerp(x0 + 3, x1 - 7, rng());
        const uz = lerp(z0 + 3, z1 - 7, rng());
        box(roof, ux, y1, uz, ux + 3 + rng() * 3, y1 + 1.5 + rng() * 2.5, uz + 3 + rng() * 3, 6, 6);
      }
    }
    const toGeo = (t) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
      g.computeBoundingSphere();
      return g;
    };
    const params = [
      { metalness: 0.75, roughness: 0.16, envMapIntensity: 1.3 },
      { metalness: 0.05, roughness: 0.75 },
      { metalness: 0.0, roughness: 0.88 },
    ];
    this.windowMaterials = [];
    styles.forEach((t, s) => {
      if (!t.pos.length) return;
      const tex2 = TX.facadeTextures(s);
      tex2.map.anisotropy = this.aniso;
      const mat = new THREE.MeshStandardMaterial({ map: tex2.map, emissiveMap: tex2.emissive, emissive: '#ffffff', emissiveIntensity: 0, ...params[s] });
      const mesh = new THREE.Mesh(toGeo(t), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.windowMaterials.push(mat);
    });
    const roofMat = new THREE.MeshStandardMaterial({ map: TX.roofTexture(), roughness: 0.9 });
    const roofMesh = new THREE.Mesh(toGeo(roof), roofMat);
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    this.root.add(roofMesh);
  }

  // ------------------------------------------------------------------ vegetation
  #pineGeometry(rng) {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.14, 0.26, 3.4, 6);
    trunk.translate(0, 1.7, 0);
    parts.push(colorizeGeometry(trunk, '#5b4028', 0.08, rng));
    const layers = [
      [2.5, 4.4, 2.2, '#2c4527'],
      [2.0, 3.8, 4.4, '#30492a'],
      [1.45, 3.2, 6.4, '#35502d'],
      [0.85, 2.6, 8.2, '#3a5731'],
    ];
    for (const [r, h, y, col] of layers) {
      const cone = new THREE.ConeGeometry(r, h, 9, 2);
      const p = cone.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const yy = p.getY(i);
        if (yy < h / 2 - 0.01) {
          const k = 1 + (rng() - 0.5) * 0.25;
          p.setX(i, p.getX(i) * k);
          p.setZ(i, p.getZ(i) * k);
          p.setY(i, yy + (rng() - 0.5) * 0.25);
        }
      }
      cone.computeVertexNormals();
      cone.translate(0, y + h / 2, 0);
      parts.push(colorizeGeometry(cone, col, 0.12, rng));
    }
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
  }

  #broadleafGeometry(rng) {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.16, 0.3, 4, 6);
    trunk.translate(0, 2, 0);
    parts.push(colorizeGeometry(trunk, '#5e4630', 0.08, rng));
    const blobs = [
      [0, 5.6, 0, 2.6],
      [1.3, 4.9, 0.6, 1.9],
      [-1.2, 5.0, -0.5, 2.0],
      [0.2, 6.9, -0.4, 1.8],
      [-0.4, 4.6, 1.3, 1.7],
    ];
    const noise = createNoise2D(rng);
    for (const [bx, by, bz, r] of blobs) {
      const g = new THREE.IcosahedronGeometry(r, 1);
      const p = g.attributes.position;
      const nrm = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const k = 1 + noise(x * 0.9 + bx, z * 0.9 + y) * 0.18;
        p.setXYZ(i, x * k, y * k * 0.85, z * k);
        const l = Math.hypot(x, y, z) || 1;
        nrm.setXYZ(i, x / l, y / l, z / l);
      }
      g.translate(bx, by, bz);
      parts.push(colorizeGeometry(g, '#4f7031', 0.14, rng));
    }
    return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  }

  #pineLowGeometry(rng) {
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 3.4, 5, 1, true);
    trunk.translate(0, 1.7, 0);
    const parts = [colorizeGeometry(trunk, '#5b4028', 0.05, rng)];
    for (const [r, h, y, col] of [
      [2.4, 6.2, 2.4, '#2e4828'],
      [1.5, 4.2, 6.2, '#35502d'],
    ]) {
      const cone = new THREE.ConeGeometry(r, h, 7, 1, true);
      cone.translate(0, y + h / 2, 0);
      parts.push(colorizeGeometry(cone, col, 0.08, rng));
    }
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
  }

  #broadleafLowGeometry(rng) {
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 4, 5, 1, true);
    trunk.translate(0, 2, 0);
    const parts = [colorizeGeometry(trunk, '#5e4630', 0.05, rng)];
    for (const [bx, by, bz, r] of [
      [0, 5.5, 0, 2.9],
      [0.3, 6.9, -0.3, 2.0],
    ]) {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.scale(1, 0.85, 1);
      g.translate(bx, by, bz);
      parts.push(colorizeGeometry(g, '#4f7031', 0.1, rng));
    }
    return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  }

  buildVegetation() {
    const d = this.data;
    const rng = mulberry32(99);
    const geos = [this.#pineGeometry(rng), this.#broadleafGeometry(rng)];
    const lowGeos = [this.#pineLowGeometry(rng), this.#broadleafLowGeometry(rng)];
    const mats = geos.map(() => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
      addSway(m, this.uniforms, 0.035);
      return m;
    });
    const chunkSize = 500;
    const buckets = new Map();
    const keep = this.quality.trees;
    d.trees.forEach((t, i) => {
      if (((i * 2654435761) % 1000) / 1000 >= keep) return;
      const key = `${t.type}:${Math.floor((t.x + 2000) / chunkSize)}:${Math.floor((t.z + 2000) / chunkSize)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    const tints = [
      [new THREE.Color('#d6e3c4'), new THREE.Color('#ffffff'), new THREE.Color('#c2cfa3')],
      [new THREE.Color('#e8f0c8'), new THREE.Color('#ffffff'), new THREE.Color('#f0d9a0')],
    ];
    const shadows = this.quality.shadows > 0;
    for (const [key, list] of buckets) {
      const type = Number(key.split(':')[0]);
      const mesh = new THREE.InstancedMesh(geos[type], mats[type], list.length);
      let cx = 0;
      let cz = 0;
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        pos.set(t.x, t.y, t.z);
        const sy = t.s * (0.85 + t.tint * 0.35);
        scl.set(t.s, sy, t.s);
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(i, m4);
        const tt = tints[type];
        col.copy(tt[0]).lerp(tt[1], t.tint).lerp(tt[2], Math.max(0, t.tint - 0.7) * 1.6);
        mesh.setColorAt(i, col);
        cx += t.x;
        cz += t.z;
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      // Far LOD shares the instance data with a much lighter geometry.
      const low = new THREE.InstancedMesh(lowGeos[type], mats[type], list.length);
      low.instanceMatrix = mesh.instanceMatrix;
      low.instanceColor = mesh.instanceColor;
      low.boundingSphere = mesh.boundingSphere.clone();
      low.visible = false;
      const center = new THREE.Vector3(cx / list.length, 0, cz / list.length);
      this.root.add(mesh, low);
      this.treeChunks.push({ hi: mesh, lo: low, center });
    }

    // Rocks
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const noise = createNoise2D(rng);
    const rp = rockGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i);
      const y = rp.getY(i);
      const z = rp.getZ(i);
      const k = 1 + noise(x * 1.7, z * 1.7 + y) * 0.28;
      rp.setXYZ(i, x * k * 1.2, y * k * 0.75, z * k);
    }
    const rockFlat = rockGeo.toNonIndexed();
    rockFlat.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({ color: '#8a847b', roughness: 0.95, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockFlat, rockMat, d.rocks.length);
    const e = new THREE.Euler();
    d.rocks.forEach((r, i) => {
      e.set(r.tilt * 0.4, r.rot, r.tilt * 0.3);
      q.setFromEuler(e);
      pos.set(r.x, r.y, r.z);
      scl.set(r.s, r.s, r.s);
      m4.compose(pos, q, scl);
      rocks.setMatrixAt(i, m4);
      col.setHSL(0.08, 0.06, 0.45 + r.tilt * 0.2);
      rocks.setColorAt(i, col);
    });
    rocks.computeBoundingSphere();
    rocks.castShadow = shadows;
    rocks.receiveShadow = true;
    this.root.add(rocks);
  }

  // ------------------------------------------------------------------ lamps & billboards
  buildLamps() {
    const d = this.data;
    const pole = new THREE.CylinderGeometry(0.09, 0.14, 8.6, 8);
    pole.translate(0, 4.3, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 2.6);
    arm.translate(0, 8.45, 1.25);
    const head = new THREE.BoxGeometry(0.45, 0.16, 0.95);
    head.translate(0, 8.4, 2.55);
    const lampGeo = mergeGeometries([pole, arm, head]);
    const lampMat = new THREE.MeshStandardMaterial({ color: '#3a3f46', metalness: 0.7, roughness: 0.4 });
    const bulbGeo = new THREE.BoxGeometry(0.34, 0.04, 0.8);
    bulbGeo.translate(0, 8.3, 2.55);
    this.bulbMaterial = new THREE.MeshStandardMaterial({ color: '#fff2d6', emissive: '#ffcf85', emissiveIntensity: 0 });
    const poolMat = new THREE.MeshBasicMaterial({
      map: TX.softDotTexture('rgba(255,196,120,0.85)', 'rgba(255,170,90,0)'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.poolMaterial = poolMat;
    const poolGeo = new THREE.PlaneGeometry(15, 15);
    poolGeo.rotateX(-Math.PI / 2);
    const n = d.lamps.length;
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, n);
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMaterial, n);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    d.lamps.forEach((l, i) => {
      q.setFromAxisAngle(up, l.yaw);
      p.set(l.x, l.y - 0.1, l.z);
      m4.compose(p, q, one);
      lamps.setMatrixAt(i, m4);
      bulbs.setMatrixAt(i, m4);
      const tx = l.x + Math.sin(l.yaw) * 3.2;
      const tz = l.z + Math.cos(l.yaw) * 3.2;
      const q2 = d.track.nearest(tx, tz, -1, {});
      p.set(tx, d.groundHeight(tx, tz, q2) + 0.08, tz);
      m4.compose(p, q, one);
      pools.setMatrixAt(i, m4);
    });
    for (const m of [lamps, bulbs, pools]) m.computeBoundingSphere();
    lamps.castShadow = this.quality.shadows > 0;
    pools.renderOrder = 2;
    this.root.add(lamps, bulbs, pools);

    // Billboards
    const frameMat = new THREE.MeshStandardMaterial({ color: '#34393f', metalness: 0.5, roughness: 0.6 });
    const frames = [];
    const mtx = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    this.billboardFaces = [];
    for (const b of d.billboards) {
      qq.setFromAxisAngle(up, b.yaw);
      mtx.compose(new THREE.Vector3(b.x, b.y, b.z), qq, one);
      for (const sd of [-1, 1]) {
        const post = new THREE.CylinderGeometry(0.12, 0.14, 5.2, 8).toNonIndexed();
        post.deleteAttribute('uv');
        post.translate(sd * 2.6, 2.6, 0);
        frames.push(post.applyMatrix4(mtx));
      }
      const back = new THREE.BoxGeometry(8.4, 4.4, 0.25).toNonIndexed();
      back.deleteAttribute('uv');
      back.translate(0, 6.6, -0.14);
      frames.push(back.applyMatrix4(mtx));
      const tex = TX.billboardTexture(b.text);
      tex.anisotropy = this.aniso;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0 }));
      face.position.set(b.x, b.y + 6.6, b.z);
      face.rotation.y = b.yaw;
      this.root.add(face);
      this.billboardFaces.push(face.material);
    }
    if (frames.length) {
      const fm = new THREE.Mesh(mergeGeometries(frames), frameMat);
      fm.castShadow = this.quality.shadows > 0;
      fm.receiveShadow = true;
      this.root.add(fm);
    }
  }

  // ------------------------------------------------------------------ water
  buildWater() {
    const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#1c4652', roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.86, envMapIntensity: 1.4 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec2 wp = vWPos.xz;
          float t = uTime;
          vec2 g = vec2(0.0);
          g += vec2(0.8, 0.6) * cos(dot(wp, vec2(0.8, 0.6)) * 0.35 + t * 1.3) * 0.035;
          g += vec2(-0.5, 0.86) * cos(dot(wp, vec2(-0.5, 0.86)) * 0.62 + t * 1.9) * 0.022;
          g += vec2(0.3, -0.95) * cos(dot(wp, vec2(0.3, -0.95)) * 1.4 + t * 2.6) * 0.012;
          g += vec2(0.95, 0.3) * cos(dot(wp, vec2(0.95, 0.3)) * 3.1 + t * 3.7) * 0.006;
          vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`,
        );
    };
    const water = new THREE.Mesh(geo, mat);
    water.position.y = WORLD.waterLevel;
    water.receiveShadow = true;
    water.renderOrder = 1;
    this.root.add(water);
    this.water = water;
  }

  // ------------------------------------------------------------------ backdrop & sky
  buildBackdrop() {
    const rng = mulberry32(8);
    const noise = createNoise2D(rng);
    const seg = 160;
    const rings = [2900, 3600, 4400, 5200];
    const pos = [];
    const col = [];
    const index = [];
    const c1 = new THREE.Color('#5d6a64');
    const c2 = new THREE.Color('#9aa3a8');
    const c3 = new THREE.Color('#e9eef2');
    for (let r = 0; r < rings.length; r++) {
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const rad = rings[r] * (1 + noise(Math.cos(a) * 3, Math.sin(a) * 3 + r) * 0.05);
        let h = 0;
        if (r === 1) h = 300 + 280 * Math.abs(noise(Math.cos(a) * 4, Math.sin(a) * 4));
        if (r === 2) h = 520 + 520 * Math.abs(noise(Math.cos(a) * 6 + 9, Math.sin(a) * 6));
        if (r === 3) h = 200;
        if (r === 0) h = 120;
        pos.push(Math.cos(a) * rad, h, Math.sin(a) * rad);
        const c = new THREE.Color().copy(c1).lerp(c2, clamp(h / 700, 0, 1)).lerp(c3, smoothstep(760, 980, h));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let s = 0; s < seg; s++) {
        const a = r * (seg + 1) + s;
        const b = a + 1;
        const c = a + seg + 1;
        const d = c + 1;
        index.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
    this.root.add(mesh);
    this.backdrop = mesh;

    // Stars for the night sky
    const starPos = [];
    for (let i = 0; i < 2200; i++) {
      const u = rng();
      const v = rng() * 0.95 + 0.05;
      const th = u * Math.PI * 2;
      const y = v;
      const r = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(th) * r * 5000, y * 5000, Math.sin(th) * r * 5000);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.starMaterial = new THREE.PointsMaterial({ color: '#dfe8ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMaterial);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(20000);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;

    const sun = new THREE.DirectionalLight('#ffffff', 3);
    const sq = this.quality.shadows;
    if (sq > 0) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(sq, sq);
      const e = 75;
      Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: 900 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.04;
    }
    this.scene.add(sun, sun.target);
    this.sunLight = sun;
    this.hemi = new THREE.HemisphereLight('#c4dcff', '#4f5a3c', 1);
    this.scene.add(this.hemi);
    this.sunDir = new THREE.Vector3();

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(80);
    // The sun is already a directional light; a sun disc in the reflections would double it.
    // The glow around a low sun is clamped too, so glossy paint does not turn into a hot spot.
    if (this.envSky.material.uniforms.showSunDisc) this.envSky.material.uniforms.showSunDisc.value = 0;
    this.envSky.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(2.5));\n#include <tonemapping_fragment>');
    };
    this.envScene.add(this.envSky);
    this.envGround = new THREE.Mesh(
      new THREE.SphereGeometry(40, 32, 12, 0, Math.PI * 2, Math.PI / 2 + 0.03, Math.PI / 2 - 0.03),
      new THREE.MeshBasicMaterial({ color: '#3b4032', side: THREE.BackSide }),
    );
    this.envScene.add(this.envGround);
    this.scene.fog = new THREE.FogExp2('#b8cadb', 0.00016);
  }

  setTimeOfDay(name) {
    const p = TIME_PRESETS[name] || TIME_PRESETS.day;
    this.timeName = name;
    this.preset = p;
    const dir = (elev, az) => {
      const phi = THREE.MathUtils.degToRad(90 - elev);
      const theta = THREE.MathUtils.degToRad(az);
      return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    };
    const sunDir = dir(p.elevation, p.azimuth);
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mie;
      u.mieDirectionalG.value = p.mieG;
      u.sunPosition.value.copy(sunDir);
      if (u.cloudCoverage) u.cloudCoverage.value = p.clouds;
      if (u.cloudDensity) u.cloudDensity.value = p.night ? 0.25 : 0.45;
    }
    this.sunDir.copy(p.moonElevation !== undefined ? dir(p.moonElevation, p.moonAzimuth) : sunDir);
    this.sunLight.color.set(p.sun);
    this.sunLight.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.scene.fog.color.set(p.fog);
    this.scene.fog.density = p.fogDensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.envGround.material.color.set(p.night ? '#07080a' : p.elevation < 10 ? '#3a3027' : '#3b4032');
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = p.env;
    this.night = p.night;
    this.bulbMaterial.emissiveIntensity = p.night > 0 ? 3 + p.night * 5 : 0;
    this.poolMaterial.opacity = p.night * 0.15;
    for (const m of this.windowMaterials) m.emissiveIntensity = Math.pow(p.night, 1.6) * 0.95;
    for (const m of this.billboardFaces || []) m.emissiveIntensity = p.night * 0.6;
    this.starMaterial.opacity = p.night > 0.9 ? 0.9 : 0;
    this.backdrop.material.color.set(p.night ? '#6b7a99' : '#ffffff');
  }

  setShadowFocus(target) {
    const e = this.sunLight;
    // Snap to shadow texels to reduce shimmering.
    const step = 150 / (this.quality.shadows || 1024);
    const fx = Math.round(target.x / step) * step;
    const fz = Math.round(target.z / step) * step;
    e.target.position.set(fx, target.y, fz);
    e.position.set(fx + this.sunDir.x * 400, target.y + Math.max(0.15, this.sunDir.y) * 400, fz + this.sunDir.z * 400);
    e.target.updateMatrixWorld();
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    if (this.sky.material.uniforms.time) this.sky.material.uniforms.time.value += dt;
    const far = this.quality.drawDistance;
    const cp = camera.position;
    for (const c of this.treeChunks) {
      const dist = Math.hypot(c.center.x - cp.x, c.center.z - cp.z);
      c.hi.visible = dist < 620;
      c.lo.visible = dist >= 620 && dist < far + 350;
    }
  }

  buildAll() {
    this.buildSky();
    this.buildTerrain();
    this.buildRoad();
    this.buildCity();
    this.buildVegetation();
    this.buildLamps();
    this.buildWater();
    this.buildBackdrop();
    this.setTimeOfDay('day');
  }
}
