// Static city meshes: ground, asphalt, raised sidewalks with curbs, surface areas,
// road markings and buildings (merged per material).
import * as THREE from 'three';
import { ROAD, WORLD } from './config.js';
import { DIRS, rightOf } from './citymap.js';
import { Path, offsetPoints } from './path.js';
import { GeoBuilder, hexRgb, addMacroVariation } from './geo.js';
import * as T from './textures.js';
import { mulberry32 } from './util.js';

const H = ROAD.half;
const CURB = ROAD.curbHeight;

const PLASTER = ['#f2e6c9', '#e9d3b5', '#dbe4e8', '#f1d8cf', '#e5ecd8', '#f4efe3', '#e8d9e6', '#d9e2cf', '#f3dfb3', '#d8d4cc', '#ecc9a6', '#cfdbe3'];
const OLDTOWN = ['#f4e3b5', '#e9c6a9', '#d7e5d0', '#f1d0cf', '#e3d2ee', '#fff4d6', '#d9e7ef'];

export class CityView {
  constructor(city, layout, { shadows = true } = {}) {
    this.city = city;
    this.layout = layout;
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.nightMaterials = [];
    this.shadows = shadows;
    this.#ground();
    this.#sidewalks();
    this.#areas();
    this.#markings();
    this.#buildings();
  }

  #add(geo, mat, { cast = false, receive = true, name = '' } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast && this.shadows;
    m.receiveShadow = receive;
    m.name = name;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.group.add(m);
    return m;
  }

  // ------------------------------------------------------------ ground & asphalt
  #ground() {
    const city = this.city;
    const b = city.bounds;
    const outer = city.regions.find((r) => r.outer);
    // Asphalt under the whole city (sidewalks sit on top of it).
    {
      const asphalt = T.asphaltTexture();
      const mat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.93, metalness: 0 });
      addMacroVariation(mat, 0.16, 0.03);
      const gb = new GeoBuilder();
      const x0 = b.minX - 30;
      const x1 = b.maxX + 30;
      const z0 = b.minZ - 30;
      const z1 = b.maxZ + 30;
      const s = 8;
      gb.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, 1, 0], [[x0 / s, -z0 / s], [x1 / s, -z0 / s], [x1 / s, -z1 / s], [x0 / s, -z1 / s]]);
      this.asphalt = this.#add(gb.build(), mat, { name: 'asphalt' });
    }
    // Grass around the city, with a hole for the city and a river bed in the south.
    {
      const grass = T.grassTexture();
      const mat = new THREE.MeshStandardMaterial({ map: grass, roughness: 1 });
      addMacroVariation(mat, 0.25, 0.02);
      const M = WORLD.margin;
      const riverZ0 = b.maxZ + H + ROAD.sidewalk + 55;
      const riverZ1 = riverZ0 + 60;
      this.river = { z0: riverZ0, z1: riverZ1 };
      const gb = new GeoBuilder();
      const bigNorth = [b.minX - M, b.minZ - M, b.maxX + M, b.minZ - M, b.maxX + M, riverZ0, b.minX - M, riverZ0];
      gb.polygon(bigNorth, CURB - 0.002, 6, undefined, [outer.front]);
      gb.polygon([b.minX - M, riverZ1, b.maxX + M, riverZ1, b.maxX + M, b.maxZ + M, b.minX - M, b.maxZ + M], CURB - 0.002, 6);
      // River banks.
      const x0 = b.minX - M;
      const x1 = b.maxX + M;
      const bank = (zTop, zBottom) => gb.quad([x0, CURB, zTop], [x1, CURB, zTop], [x1, -0.9, zBottom], [x0, -0.9, zBottom], [0, 0.8, zTop < zBottom ? 0.6 : -0.6], [[0, 0], [300, 0], [300, 1], [0, 1]]);
      bank(riverZ0, riverZ0 + 5);
      bank(riverZ1, riverZ1 - 5);
      this.grass = this.#add(gb.build(), mat, { name: 'grass' });
      // Water.
      const wmat = new THREE.MeshStandardMaterial({ color: '#2d4f5e', roughness: 0.08, metalness: 0.3, normalMap: T.waterNormalTexture(), normalScale: new THREE.Vector2(0.35, 0.35) });
      wmat.normalMap.repeat.set(60, 3);
      this.waterMaterial = wmat;
      const wg = new GeoBuilder();
      wg.quad([x0, -0.55, riverZ0], [x1, -0.55, riverZ0], [x1, -0.55, riverZ1], [x0, -0.55, riverZ1], [0, 1, 0]);
      this.#add(wg.build(), wmat, { name: 'river' });
    }
  }

  // ------------------------------------------------------------ sidewalks (extruded, 15 cm)
  #sidewalks() {
    const city = this.city;
    const pav = T.paverTexture();
    pav.repeat.set(0.5, 0.5);
    const curbTex = T.curbTexture();
    curbTex.repeat.set(0.5, 1 / CURB);
    const top = new THREE.MeshStandardMaterial({ map: pav, roughness: 0.9 });
    addMacroVariation(top, 0.12, 0.05);
    const side = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.75, color: '#dcdad4' });
    const toShape = (flat) => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], -flat[i + 1]));
      return pts;
    };
    const geos = [];
    for (const r of city.regions) {
      let shape;
      if (r.outer) {
        shape = new THREE.Shape(toShape(r.front));
        shape.holes.push(new THREE.Path(toShape(r.curb)));
      } else shape = new THREE.Shape(toShape(r.curb));
      const g = new THREE.ExtrudeGeometry(shape, { depth: CURB, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(-Math.PI / 2);
      geos.push(g);
    }
    const merged = mergeGeometries(geos);
    // ExtrudeGeometry groups: 0 = caps (top/bottom), 1 = side walls (the curb faces).
    this.sidewalk = this.#add(merged, [top, side], { name: 'sidewalks' });
  }

  // ------------------------------------------------------------ surface areas
  #areas() {
    const mats = {
      grass: (() => {
        const m = new THREE.MeshStandardMaterial({ map: T.grassTexture(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
        addMacroVariation(m, 0.25, 0.03);
        return m;
      })(),
      plaza: (() => {
        const t = T.cobbleTexture();
        t.repeat.set(1 / 3, 1 / 3);
        const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
        addMacroVariation(m, 0.1, 0.04);
        return m;
      })(),
      parking: (() => {
        const t = T.asphaltTexture();
        t.repeat.set(1 / 8, 1 / 8);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, color: '#c9c9c9', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      })(),
      pitch: new THREE.MeshStandardMaterial({ color: '#3f8f3f', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      schoolyard: (() => {
        const t = T.paverTexture('#b46a55', 9);
        t.repeat.set(0.5, 0.5);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      })(),
      path: new THREE.MeshStandardMaterial({ color: '#b8a888', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    };
    const builders = {};
    for (const a of this.layout.areas) {
      const gb = (builders[a.type] = builders[a.type] || new GeoBuilder());
      const y = CURB + (a.type === 'path' || a.type === 'pitch' ? 0.008 : 0.004);
      gb.polygon(a.pts, y, 1);
    }
    for (const [type, gb] of Object.entries(builders)) {
      const m = mats[type];
      if (m.map) m.map.repeat.set(m.map.repeat.x || 1, m.map.repeat.y || 1);
      if (type === 'grass') m.map.repeat.set(1 / 6, 1 / 6);
      this.#add(gb.build(), m, { name: `area-${type}` });
    }
    // White lines on the parking lots and the pitches.
    const lines = new GeoBuilder();
    const white = [0.95, 0.95, 0.93];
    for (const a of this.layout.areas) {
      const [x0, z0, x1, , , z1] = [a.pts[0], a.pts[1], a.pts[2], a.pts[3], a.pts[4], a.pts[5]];
      if (a.type === 'parking') {
        for (let x = x0 + 3; x < x1 - 2; x += 2.6) lines.box(x, CURB + 0.012, z0 + 3, 0.1, 0.004, 5, 0, white);
      }
      if (a.type === 'pitch') {
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        const w = x1 - x0;
        const d = z1 - z0;
        lines.box(mx, CURB + 0.014, z0 + 1, w - 2, 0.004, 0.12, 0, white);
        lines.box(mx, CURB + 0.014, z1 - 1, w - 2, 0.004, 0.12, 0, white);
        lines.box(x0 + 1, CURB + 0.014, mz, 0.12, 0.004, d - 2, 0, white);
        lines.box(x1 - 1, CURB + 0.014, mz, 0.12, 0.004, d - 2, 0, white);
        lines.box(mx, CURB + 0.014, mz, 0.12, 0.004, d - 2, 0, white);
      }
    }
    if (!lines.empty) this.#add(lines.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), { name: 'area-lines' });
  }

  // ------------------------------------------------------------ road markings
  #markings() {
    const city = this.city;
    const gb = new GeoBuilder();
    const W = [0.93, 0.93, 0.9];
    const Y = 0.012;
    // Painted strip from (ax, az) to (bx, bz) with width w.
    const strip = (ax, az, bx, bz, w, color = W) => {
      const dx = bx - ax;
      const dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * (w / 2);
      const nz = (dx / l) * (w / 2);
      gb.quad([ax + nx, Y, az + nz], [bx + nx, Y, bz + nz], [bx - nx, Y, bz - nz], [ax - nx, Y, az - nz], [0, 1, 0], undefined, color);
    };
    const texts = { BUS: [], 30: [] };

    // Centre lines: dashed 3 m / 6 m, solid for the last 15 m before a stop line.
    for (const e of city.edges) {
      const a = city.nodes[e.a];
      const bnode = city.nodes[e.b];
      const [dx, dz] = DIRS[e.dirAB];
      const s0 = a.trim;
      const s1 = e.length - bnode.trim;
      const P = (s) => [a.x + dx * s, a.z + dz * s];
      const solidA = a.kind === 'cross' || a.kind === 'tee' ? 12 : 0;
      const solidB = bnode.kind === 'cross' || bnode.kind === 'tee' ? 12 : 0;
      if (solidA) strip(...P(s0), ...P(s0 + solidA), 0.12);
      if (solidB) strip(...P(s1 - solidB), ...P(s1), 0.12);
      for (let s = s0 + solidA + 2; s + 3 < s1 - solidB; s += 9) strip(...P(s), ...P(s + 3), 0.12);
    }
    // Centre line around the wide bends of the ring road.
    for (const n of city.nodes) {
      if (n.kind !== 'bend') continue;
      const mv = city.movements[n.movements[0]];
      // Every lane runs right of the centre line, so the centre line is laneOffset to its left.
      const pts = offsetPoints(Array.from(mv.path.pts), ROAD.laneOffset);
      const path = new Path(pts);
      for (let s = 2; s + 3 < path.length; s += 9) {
        const a = path.at(s);
        const b = path.at(s + 3);
        strip(a.x, a.z, b.x, b.z, 0.12);
      }
    }
    // Stop lines (signals, stop signs) and give-way lines (yield).
    for (const l of city.lanes) {
      if (!['signal', 'stop', 'yield'].includes(l.endControl)) continue;
      const e = l.path.at(l.path.length);
      const [rx, rz] = DIRS[rightOf(l.dir)];
      const [dx, dz] = DIRS[l.dir];
      const cx = e.x + dx * 0.3;
      const cz = e.z + dz * 0.3;
      const a = [cx - rx * ROAD.laneOffset, cz - rz * ROAD.laneOffset];
      const b = [cx + rx * ROAD.laneOffset, cz + rz * ROAD.laneOffset];
      if (l.endControl === 'yield') {
        // Wartelinie: dashes 0.5 m, gaps 0.25 m, 0.5 m wide.
        const n = 5;
        for (let k = 0; k < n; k++) {
          const t0 = k / n;
          const t1 = t0 + 0.6 / n;
          strip(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, 0.5);
        }
      } else strip(a[0], a[1], b[0], b[1], 0.5);
    }
    // Pedestrian crossings.
    for (const c of city.crossings) {
      const px = -c.uz;
      const pz = c.ux;
      if (c.kind === 'zebra') {
        for (let t = -c.extNeg + 0.3; t < c.extPos - 0.3; t += 1) {
          const x = c.x + c.ux * t;
          const z = c.z + c.uz * t;
          strip(x - px * 1.9, z - pz * 1.9, x + px * 1.9, z + pz * 1.9, 0.5);
        }
      } else {
        // Fußgängerfurt: two dashed borders.
        for (const side of [-1, 1]) {
          const ox = px * (c.width / 2) * side;
          const oz = pz * (c.width / 2) * side;
          for (let t = -c.extNeg; t < c.extPos - 0.4; t += 0.9) {
            strip(c.x + c.ux * t + ox, c.z + c.uz * t + oz, c.x + c.ux * (t + 0.5) + ox, c.z + c.uz * (t + 0.5) + oz, 0.12);
          }
        }
      }
    }
    // Bus stops: zig-zag line along the curb and "BUS" in the lane.
    for (const s of city.stops) {
      const lane = city.lanes[s.lane];
      const lat = s.curbOffset - 0.6;
      const P = (along, off) => {
        const p = lane.path.at(s.sFront + along);
        return [p.x + s.rx * off, p.z + s.rz * off];
      };
      if (s.type === 'kerb') {
        let k = 0;
        for (let a = -s.zone; a < 1.5; a += 1.5, k++) {
          const p0 = P(a, lat + (k % 2 ? 0 : 0.5));
          const p1 = P(a + 1.5, lat + (k % 2 ? 0.5 : 0));
          strip(p0[0], p0[1], p1[0], p1[1], 0.12);
        }
      }
      const tp = P(-s.zone * 0.55, s.type === 'bay' ? s.curbOffset - 1.3 : ROAD.laneOffset * 0 + 0.2);
      texts.BUS.push({ x: tp[0], z: tp[1], yaw: lane.yaw });
    }
    // "30" at the start of Tempo-30 zones.
    for (const sg of city.signs) {
      if (sg.type !== 'zone30') continue;
      const lane = city.lanes[sg.lane];
      const p = lane.path.at(10);
      texts[30].push({ x: p.x, z: p.z, yaw: lane.yaw });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.#add(gb.build(), mat, { name: 'markings' });
    // Text markings: quads with alpha textures (read in driving direction).
    for (const [text, list] of Object.entries(texts)) {
      if (!list.length) continue;
      const tb = new GeoBuilder();
      for (const t of list) {
        const s = Math.sin(t.yaw);
        const c = Math.cos(t.yaw);
        const w = 1.8;
        const len = 4.2;
        // local x across (to the left = (c, -s)), z along (s, c)
        const P = (lx, lz) => [t.x + c * lx + s * lz, 0.014, t.z - s * lx + c * lz];
        tb.quad(P(w / 2, -len / 2), P(-w / 2, -len / 2), P(-w / 2, len / 2), P(w / 2, len / 2), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      const tmat = new THREE.MeshStandardMaterial({ map: T.roadTextTexture(String(text)), transparent: true, alphaTest: 0.3, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, depthWrite: false });
      this.#add(tb.build(), tmat, { name: `text-${text}` });
    }
  }

  // ------------------------------------------------------------ buildings
  #buildings() {
    const rng = mulberry32(99);
    const styles = Object.keys(T.FACADE);
    const facadeMats = {};
    for (const st of styles) {
      const { map, emissive, rough } = T.facadeTextures(st);
      const m = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughnessMap: rough, roughness: 1, metalness: st === 'office' ? 0.25 : 0, vertexColors: true });
      facadeMats[st] = m;
      this.nightMaterials.push(m);
    }
    const shop = T.shopTextures();
    const groundMats = {
      shop: new THREE.MeshStandardMaterial({ map: shop.map, emissiveMap: shop.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.7 }),
      plain: new THREE.MeshStandardMaterial({ map: T.entranceTexture(), roughness: 0.9, vertexColors: true }),
      lobby: new THREE.MeshStandardMaterial({ map: T.lobbyTexture(), roughness: 0.3, metalness: 0.2, emissiveMap: T.lobbyTexture(), emissive: new THREE.Color('#fff2d8'), emissiveIntensity: 0 }),
    };
    this.nightMaterials.push(groundMats.shop, groundMats.lobby);
    const roofFlat = new THREE.MeshStandardMaterial({ map: T.roofTexture('flat'), roughness: 1, vertexColors: true });
    const roofTiles = new THREE.MeshStandardMaterial({ map: T.roofTexture('tiles'), roughness: 0.85, vertexColors: true });
    const trim = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true });

    const B = {};
    const get = (k) => (B[k] = B[k] || new GeoBuilder());
    for (const b of this.layout.buildings) {
      const s = Math.sin(b.yaw);
      const c = Math.cos(b.yaw);
      // local -> world: x' = x c + z s, z' = -x s + z c (local +z faces the street)
      const P = (lx, y, lz) => [b.x + lx * c + lz * s, y, b.z - lx * s + lz * c];
      const N = (lx, ly, lz) => [lx * c + lz * s, ly, -lx * s + lz * c];
      const hw = b.w / 2;
      const hd = b.d / 2;
      const f = T.FACADE[b.style];
      const tileW = f.bay * f.cols;
      const tileH = b.floorH * f.rows;
      let tint;
      if (b.style === 'plaster') tint = hexRgb(PLASTER[Math.floor(b.tint * PLASTER.length)]);
      else if (b.style === 'oldtown') tint = hexRgb(OLDTOWN[Math.floor(b.tint * OLDTOWN.length)]);
      else {
        const v = 0.88 + b.tint * 0.12;
        tint = [v, v, v * 0.98];
      }
      const up = get(`f:${b.style}`);
      const gr = get(`g:${b.ground}`);
      const shopOffset = (b.seed % 8) * 8;
      // Walls: [start point, end point, outward normal] in local coordinates, traversed left→right as seen from outside.
      const walls = [
        [[-hw, hd], [hw, hd], [0, 0, 1], b.w],
        [[hw, -hd], [-hw, -hd], [0, 0, -1], b.w],
        [[hw, hd], [hw, -hd], [1, 0, 0], b.d],
        [[-hw, -hd], [-hw, hd], [-1, 0, 0], b.d],
      ];
      for (const [a, e, n, len] of walls) {
        const nn = N(...n);
        // Upper floors.
        if (b.h > b.groundH + 0.1) {
          const v0 = 0;
          const v1 = (b.h - b.groundH) / tileH;
          const u1 = len / tileW;
          const off = (b.seed % 4) * 0.25;
          up.quad(P(a[0], b.groundH, a[1]), P(e[0], b.groundH, e[1]), P(e[0], b.h, e[1]), P(a[0], b.h, a[1]), nn, [[off, v0], [off + u1, v0], [off + u1, v1], [off, v1]], tint);
        }
        // Ground floor.
        const gw = b.ground === 'shop' ? 64 : b.ground === 'lobby' ? 12 : 16;
        const u0 = b.ground === 'shop' ? shopOffset / gw : (b.seed % 3) * 0.33;
        gr.quad(P(a[0], 0, a[1]), P(e[0], 0, e[1]), P(e[0], b.groundH, e[1]), P(a[0], b.groundH, a[1]), nn, [[u0, 0], [u0 + len / gw, 0], [u0 + len / gw, 1], [u0, 1]], b.ground === 'plain' ? tint : [1, 1, 1]);
      }
      // Roof.
      if (b.roof === 'gable') {
        const rh = b.d * 0.42;
        const o = 0.35;
        const rt = get('roofTiles');
        const rc = rng() < 0.7 ? [0.95 + rng() * 0.1, 0.85 + rng() * 0.1, 0.85] : [0.45, 0.45, 0.5];
        const nf = N(0, Math.cos(0.7), Math.sin(0.7));
        const nb = N(0, Math.cos(0.7), -Math.sin(0.7));
        const slope = Math.hypot(hd + o, rh);
        rt.quad(P(-hw - o, b.h - 0.2, hd + o), P(hw + o, b.h - 0.2, hd + o), P(hw + o, b.h + rh, 0), P(-hw - o, b.h + rh, 0), nf, [[0, 0], [b.w / 3, 0], [b.w / 3, slope / 3], [0, slope / 3]], rc);
        rt.quad(P(hw + o, b.h - 0.2, -hd - o), P(-hw - o, b.h - 0.2, -hd - o), P(-hw - o, b.h + rh, 0), P(hw + o, b.h + rh, 0), nb, [[0, 0], [b.w / 3, 0], [b.w / 3, slope / 3], [0, slope / 3]], rc);
        // Gable walls.
        const gt = get('trim');
        for (const sx of [-1, 1]) {
          const n = N(sx, 0, 0);
          gt.tri(P(sx * hw, b.h, hd), P(sx * hw, b.h, -hd), P(sx * hw, b.h + rh, 0), n, [0, 0], [1, 0], [0.5, 1], tint);
        }
      } else {
        const rf = get('roofFlat');
        const g = 0.75 + b.tint * 0.2;
        rf.quad(P(-hw, b.h, hd), P(hw, b.h, hd), P(hw, b.h, -hd), P(-hw, b.h, -hd), [0, 1, 0], [[0, 0], [b.w / 4, 0], [b.w / 4, b.d / 4], [0, b.d / 4]], [g, g, g]);
        // Parapet.
        const gt = get('trim');
        const pc = [tint[0] * 0.9, tint[1] * 0.9, tint[2] * 0.9];
        const ph = 0.7;
        gt.box(...P(0, b.h + ph / 2, hd - 0.12), b.w, ph, 0.24, b.yaw, pc);
        gt.box(...P(0, b.h + ph / 2, -hd + 0.12), b.w, ph, 0.24, b.yaw, pc);
        gt.box(...P(hw - 0.12, b.h + ph / 2, 0), 0.24, ph, b.d - 0.48, b.yaw, pc);
        gt.box(...P(-hw + 0.12, b.h + ph / 2, 0), 0.24, ph, b.d - 0.48, b.yaw, pc);
        // Some roof boxes (stairwell, AC).
        if (b.w > 14 && rng() < 0.6) gt.box(...P((rng() - 0.5) * (b.w - 8), b.h + 1.2, (rng() - 0.5) * (b.d - 6)), 3 + rng() * 3, 2.4, 3, b.yaw, [0.7, 0.7, 0.7]);
      }
      // Ledge between ground floor and upper floors.
      const gt = get('trim');
      const lc = [tint[0] * 0.82, tint[1] * 0.82, tint[2] * 0.82];
      gt.box(...P(0, b.groundH + 0.08, hd + 0.08), b.w + 0.16, 0.16, 0.16, b.yaw, lc, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
    }
    for (const [k, gb] of Object.entries(B)) {
      let mat;
      if (k.startsWith('f:')) mat = facadeMats[k.slice(2)];
      else if (k.startsWith('g:')) mat = groundMats[k.slice(2)];
      else if (k === 'roofTiles') mat = roofTiles;
      else if (k === 'roofFlat') mat = roofFlat;
      else mat = trim;
      this.#add(gb.build(), mat, { cast: true, name: `bld-${k}` });
    }
  }

  // Night factor 0 (day) .. 1 (night).
  setNight(f) {
    for (const m of this.nightMaterials) m.emissiveIntensity = Math.pow(f, 1.4) * 1.1;
  }

  update(dt, t) {
    if (this.waterMaterial) {
      this.waterMaterial.normalMap.offset.x = (t * 0.004) % 1;
      this.waterMaterial.normalMap.offset.y = (t * 0.01) % 1;
    }
  }
}

// Minimal geometry merge (same attribute set), keeps groups of the inputs.
export function mergeGeometries(geos) {
  const attrs = ['position', 'normal', 'uv'];
  const out = new THREE.BufferGeometry();
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = nonIndexed.reduce((s, g) => s + g.attributes.position.count, 0);
  for (const a of attrs) {
    const size = nonIndexed[0].attributes[a].itemSize;
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of nonIndexed) {
      arr.set(g.attributes[a].array, off);
      off += g.attributes[a].array.length;
    }
    out.setAttribute(a, new THREE.BufferAttribute(arr, size));
  }
  // Groups: concatenate by material index so the merged mesh needs one draw per material.
  let start = 0;
  const byMat = new Map();
  for (const g of nonIndexed) {
    const count = g.attributes.position.count;
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const gr of groups) {
      if (!byMat.has(gr.materialIndex)) byMat.set(gr.materialIndex, []);
      byMat.get(gr.materialIndex).push([start + gr.start, gr.count]);
    }
    start += count;
  }
  // Reorder vertices so each material is contiguous.
  const order = [];
  for (const [mi, ranges] of [...byMat.entries()].sort((a, b) => a[0] - b[0])) {
    const s0 = order.length;
    for (const [s, c] of ranges) for (let i = 0; i < c; i++) order.push(s + i);
    out.addGroup(s0, order.length - s0, mi);
  }
  for (const a of attrs) {
    const src = out.attributes[a];
    const size = src.itemSize;
    const arr = new Float32Array(order.length * size);
    for (let i = 0; i < order.length; i++) for (let k = 0; k < size; k++) arr[i * size + k] = src.array[order[i] * size + k];
    out.setAttribute(a, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
