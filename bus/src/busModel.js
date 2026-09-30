// 3D city bus: thin body panels with real window/door openings, livery, glass, lights,
// LED destination displays, mirrors, wheels (dual rear tyres, Ackermann steering),
// swinging doors, interior with seats and poles, the driver's cockpit with live
// instruments, and for the articulated bus a rear section with a flexing bellows.
// Local frame of the front section: origin on the ground under the rear (drive) axle,
// +z forward, +x left, y up. The rear section's origin is the joint.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { busGeometry } from './busTypes.js';
import { GeoBuilder, hexRgb } from './geo.js';
import { makeCanvasTexture, drawDestination, seatTexture, floorTexture } from './textures.js';
import { clamp } from './util.js';

const BOTTOM = 0.28; // lower edge of the body panels
const ROOF = 2.95;
const SILL = 1.02; // bottom of the side windows
const WTOP = 2.6; // top of windows and doors
const FLOOR = 0.34; // low floor
const HALF = 1.275;
const CORNER = 0.12;

function sidePanelGeometry(shape, xSide, outward, inset = 0) {
  const g = new THREE.ShapeGeometry(shape, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const v = pos.getY(i);
    pos.setXYZ(i, xSide - outward * inset, v, u);
  }
  const n = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) n[i * 3] = inset > 0 ? -outward : outward;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  // Seen from +x the shape's u axis (→ z) points to the viewer's left: flip winding for the left side.
  const flip = (outward > 0) !== (inset > 0);
  if (flip) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }
  return g;
}

function maskGeometry(shape, zPos, outward) {
  const g = new THREE.ShapeGeometry(shape, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, zPos);
  const n = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) n[i * 3 + 2] = outward;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  if (outward < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }
  return g;
}

function roundRectPath(path, x0, y0, x1, y1, r) {
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0);
  path.quadraticCurveTo(x1, y0, x1, y0 + r);
  path.lineTo(x1, y1 - r);
  path.quadraticCurveTo(x1, y1, x1 - r, y1);
  path.lineTo(x0 + r, y1);
  path.quadraticCurveTo(x0, y1, x0, y1 - r);
  path.lineTo(x0, y0 + r);
  path.quadraticCurveTo(x0, y0, x0 + r, y0);
}

export class BusModel {
  constructor(spec, livery, { interior = true } = {}) {
    this.spec = spec;
    this.geo = busGeometry(spec);
    this.root = new THREE.Group();
    this.root.name = 'bus';
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.articulated = !!spec.joint;
    if (this.articulated) {
      this.trailer = new THREE.Group();
      this.root.add(this.trailer);
    }
    this.mats = this.#materials(livery);
    this.wheels = [];
    this.doorLeaves = [];
    this.lights = { head: [], tail: [], brake: [], indL: [], indR: [], reverse: [], drl: [] };
    this.interiorSeats = [];
    const g = this.geo;
    const L = spec.wheelbase;
    if (this.articulated) {
      this.#section(this.body, { zr: g.rear, zf: g.front, front: true, rearOpen: true, axles: [[0, true], [L, false]], doors: spec.doors.filter((d) => !d.trailer), engineTower: false });
      this.#section(this.trailer, { zr: g.trailerRear, zf: g.trailerFront, frontOpen: true, rear: true, axles: [[-spec.trailerAxle, true]], doors: spec.doors.filter((d) => d.trailer), engineTower: true });
      this.#bellows();
    } else {
      this.#section(this.body, { zr: g.rear, zf: g.front, front: true, rear: true, axles: [[0, true], [L, false]], doors: spec.doors, engineTower: true });
    }
    if (interior) this.#cockpit();
    this.#mirrors();
    this.#displays();
    this.#contactShadow();
    this.headLight = new THREE.SpotLight('#fff3dd', 0, 70, 0.55, 0.5, 1.2);
    this.headLight.position.set(0, 0.9, g.front + 0.2);
    this.headLight.target.position.set(0, 0, g.front + 25);
    this.body.add(this.headLight, this.headLight.target);
    this.blink = 0;
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !o.material.transparent;
        o.receiveShadow = true;
      }
    });
    this.#optimize();
  }

  // Soft dark patch on the ground under each section (grounds the bus even without shadow maps).
  #contactShadow() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 6, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.6)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: '#000000', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const geo = this.geo;
    const add = (parent, z0, z1) => {
      const pg = new THREE.PlaneGeometry(HALF * 2 * 1.35, (z1 - z0) * 1.12);
      pg.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(pg, mat);
      m.position.set(0, 0.03, (z0 + z1) / 2);
      m.renderOrder = 1;
      m.userData.shadowBlob = true;
      parent.add(m);
    };
    add(this.body, geo.rear, geo.front);
    if (this.trailer) add(this.trailer, geo.trailerRear, geo.trailerFront);
  }

  // Fewer draw calls: merge the static pieces of every group that share a material
  // (the wheels become tyre + rim, the body a handful of meshes per material).
  #optimize() {
    for (const w of this.wheels) {
      for (const c of w.spin.children) if (c.material === this.mats.chrome || c.material === this.mats.dark) c.material = this.mats.rim;
      mergeChildren(w.spin);
    }
    if (this.steeringWheel) mergeChildren(this.steeringWheel);
    for (const g of [this.body, this.trailer, this.cab]) if (g) mergeChildren(g);
    // Interior pieces sit inside the body: their shadows are never seen.
    const inside = new Set([this.mats.seat, this.mats.pole, this.mats.interiorFloor, this.mats.ceiling, this.mats.ceilingLight, this.mats.dash, this.mats.cabBlack, this.mats.paintInside]);
    this.root.traverse((o) => {
      if (o.isMesh && inside.has(o.material)) o.castShadow = false;
    });
  }

  #materials(livery) {
    const paint = new THREE.MeshPhysicalMaterial({ color: livery.body, roughness: 0.32, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    return {
      paint,
      paintInside: new THREE.MeshStandardMaterial({ color: '#d9dde0', roughness: 0.8 }),
      skirt: new THREE.MeshStandardMaterial({ color: livery.skirt, roughness: 0.6, metalness: 0.2 }),
      stripe: new THREE.MeshStandardMaterial({ color: livery.stripe, roughness: 0.45, metalness: 0.2 }),
      roof: new THREE.MeshStandardMaterial({ color: livery.roof, roughness: 0.55, metalness: 0.2 }),
      glass: new THREE.MeshStandardMaterial({ color: '#16212b', roughness: 0.04, metalness: 0.85, transparent: true, opacity: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.4, depthWrite: false }),
      glassLight: new THREE.MeshStandardMaterial({ color: '#8fb3c4', roughness: 0.03, metalness: 0.6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
      black: new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.6, metalness: 0.2 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2b2f35', roughness: 0.5, metalness: 0.3 }),
      tyre: new THREE.MeshStandardMaterial({ color: '#1b1b1c', roughness: 0.95 }),
      rim: new THREE.MeshStandardMaterial({ color: '#cfd3d6', roughness: 0.3, metalness: 0.85 }),
      chrome: new THREE.MeshStandardMaterial({ color: '#dfe3e6', roughness: 0.18, metalness: 1 }),
      head: new THREE.MeshStandardMaterial({ color: '#f4f6f8', emissive: new THREE.Color('#fff6e8'), emissiveIntensity: 0.2, roughness: 0.1 }),
      drl: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#e8f2ff'), emissiveIntensity: 0, roughness: 0.2 }),
      tail: new THREE.MeshStandardMaterial({ color: '#5a0c0c', emissive: new THREE.Color('#ff1a0d'), emissiveIntensity: 0.05, roughness: 0.2 }),
      indicator: new THREE.MeshStandardMaterial({ color: '#6a3c08', emissive: new THREE.Color('#ff9a1a'), emissiveIntensity: 0, roughness: 0.2 }),
      indicatorR: new THREE.MeshStandardMaterial({ color: '#6a3c08', emissive: new THREE.Color('#ff9a1a'), emissiveIntensity: 0, roughness: 0.2 }),
      reverse: new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.2 }),
      interiorFloor: (() => {
        const t = floorTexture();
        t.repeat.set(2, 6);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
      })(),
      seat: (() => {
        const t = seatTexture();
        t.repeat.set(2, 2);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
      })(),
      pole: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.35, metalness: 0.4 }),
      ceiling: new THREE.MeshStandardMaterial({ color: '#e6e8ea', roughness: 0.8 }),
      ceilingLight: new THREE.MeshStandardMaterial({ color: '#f5f5f0', emissive: new THREE.Color('#fff9ec'), emissiveIntensity: 0.3, roughness: 0.3 }),
      // Cab plastics get a little self-light: the cab sits in the shadow of the roof.
      dash: new THREE.MeshStandardMaterial({ color: '#3b4047', emissive: new THREE.Color('#171a1e'), roughness: 0.75 }),
      cabBlack: new THREE.MeshStandardMaterial({ color: '#23262b', emissive: new THREE.Color('#0e1013'), roughness: 0.55 }),
      red: new THREE.MeshStandardMaterial({ color: '#c8102e', emissive: new THREE.Color('#ff2020'), emissiveIntensity: 0, roughness: 0.4 }),
    };
  }

  setLivery(livery) {
    this.mats.paint.color.set(livery.body);
    this.mats.skirt.color.set(livery.skirt);
    this.mats.stripe.color.set(livery.stripe);
    this.mats.roof.color.set(livery.roof);
  }

  #mesh(parent, geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  // ------------------------------------------------------------ body section
  #section(parent, S) {
    const spec = this.spec;
    const zr = S.zr + (S.rearOpen ? 0 : CORNER);
    const zf = S.zf - (S.frontOpen ? 0 : CORNER);
    const archR = 0.66;
    const archC = 0.5;
    const arches = S.axles.map(([z]) => z).sort((a, b) => a - b);
    const doorsRight = S.doors.map((d) => [d.z - d.w / 2, d.z + d.w / 2]);
    // Engine tower at the rear left: no windows there.
    const towerEnd = S.engineTower ? S.zr + 1.9 : -Infinity;

    for (const side of [1, -1]) {
      const xSide = side * HALF;
      const doors = side < 0 ? doorsRight : [];
      // Outline (u = z, v = y): bottom edge from rear to front with arches and door notches.
      const outline = new THREE.Shape();
      outline.moveTo(zr, BOTTOM);
      const events = [];
      for (const a of arches) events.push({ z0: a - archR - 0.04, z1: a + archR + 0.04, kind: 'arch', c: a });
      for (const [d0, d1] of doors) events.push({ z0: d0, z1: d1, kind: 'door' });
      events.sort((a, b) => a.z0 - b.z0);
      for (const e of events) {
        if (e.z1 < zr || e.z0 > zf) continue;
        outline.lineTo(Math.max(zr, e.z0), BOTTOM);
        if (e.kind === 'arch') {
          outline.lineTo(e.c - archR, archC);
          outline.absarc(e.c, archC, archR, Math.PI, 0, true);
          outline.lineTo(e.c + archR, BOTTOM);
        } else {
          outline.lineTo(e.z0, WTOP);
          outline.lineTo(e.z1, WTOP);
          outline.lineTo(e.z1, BOTTOM);
        }
      }
      outline.lineTo(zf, BOTTOM);
      outline.lineTo(zf, ROOF - 0.08);
      outline.quadraticCurveTo(zf, ROOF, zf - 0.08, ROOF);
      outline.lineTo(zr + 0.08, ROOF);
      outline.quadraticCurveTo(zr, ROOF, zr, ROOF - 0.08);
      outline.lineTo(zr, BOTTOM);
      // Windows between pillars (skipping doors and the engine tower).
      const panes = [];
      const w0 = Math.max(zr + 0.25, side > 0 ? towerEnd : zr + 0.25);
      const w1 = zf - (S.front ? 0.12 : 0.2); // slim A-pillar in front of the driver's window
      let segs = [[w0, w1]];
      for (const [d0, d1] of doors) {
        const next = [];
        for (const [a, b] of segs) {
          if (d1 + 0.14 <= a || d0 - 0.14 >= b) next.push([a, b]);
          else {
            if (d0 - 0.14 > a + 0.3) next.push([a, d0 - 0.14]);
            if (d1 + 0.14 < b - 0.3) next.push([d1 + 0.14, b]);
          }
        }
        segs = next;
      }
      for (const [a, b] of segs) {
        const n = Math.max(1, Math.round((b - a) / 1.45));
        const pw = (b - a) / n;
        for (let k = 0; k < n; k++) panes.push([a + k * pw + 0.06, a + (k + 1) * pw - 0.06]);
      }
      for (const [a, b] of panes) {
        const hole = new THREE.Path();
        const bottom = S.front && b > zf - 2.4 && side > 0 ? SILL + 0.08 : SILL; // driver's window
        roundRectPath(hole, a, bottom, b, WTOP, 0.07);
        outline.holes.push(hole);
      }
      this.#mesh(parent, sidePanelGeometry(outline, xSide, side), this.mats.paint);
      this.#mesh(parent, sidePanelGeometry(outline, xSide, side, 0.035), this.mats.paintInside);
      // Glass in the window openings (one long pane per side, sits just inside the panel).
      const gb = new GeoBuilder();
      for (const [a, b] of panes) {
        const x = xSide - side * 0.012;
        gb.quad([x, SILL, a], [x, SILL, b], [x, WTOP, b], [x, WTOP, a], [side, 0, 0]);
      }
      this.#mesh(parent, gb.build(), this.mats.glass);
      // Skirt and livery stripe as segments that skip arches and doors.
      const sk = new GeoBuilder();
      const st = new GeoBuilder();
      let z = zr;
      const blocks = events.filter((e) => e.z1 > zr && e.z0 < zf);
      const pieces = [];
      for (const e of blocks) {
        if (e.z0 > z) pieces.push([z, e.z0]);
        z = Math.max(z, e.z1);
      }
      if (z < zf) pieces.push([z, zf]);
      for (const [a, b] of pieces) {
        const x = xSide + side * 0.012;
        sk.box(x, (BOTTOM + 0.62) / 2, (a + b) / 2, 0.02, 0.62 - BOTTOM, b - a, 0);
      }
      let zs = zr;
      const stripePieces = [];
      for (const [d0, d1] of doors) {
        if (d0 > zs) stripePieces.push([zs, d0]);
        zs = Math.max(zs, d1);
      }
      if (zs < zf) stripePieces.push([zs, zf]);
      for (const [a, b] of stripePieces) st.box(xSide + side * 0.013, SILL - 0.07, (a + b) / 2, 0.02, 0.1, b - a, 0);
      this.#mesh(parent, sk.build(), this.mats.skirt);
      this.#mesh(parent, st.build(), this.mats.stripe);
    }

    // Roof and roof edges.
    const rb = new GeoBuilder();
    rb.box(0, ROOF + 0.01, (zr + zf) / 2, HALF * 2 - 0.05, 0.03, zf - zr, 0);
    this.#mesh(parent, rb.build(), this.mats.roof);
    const top = new GeoBuilder();
    // Roof equipment: AC unit (diesel) or battery packs (electric).
    const mid = (zr + zf) / 2;
    if (spec.engine === 'electric' && S.front) {
      top.box(0, ROOF + 0.2, mid + 1.5, 2.1, 0.38, 5.8, 0);
      top.box(0, ROOF + 0.12, zf - 1.6, 1.6, 0.22, 1.6, 0);
    } else top.box(0, ROOF + 0.15, S.front ? zf - 3.6 : mid, 2.05, 0.3, 3.2, 0);
    this.#mesh(parent, top.build(), this.mats.roof);

    // Corner posts (rounded look).
    const corners = [];
    if (!S.frontOpen) corners.push([zf, 1]);
    if (!S.rearOpen) corners.push([zr, -1]);
    for (const [z, dir] of corners) {
      for (const side of [1, -1]) {
        const g = new THREE.CylinderGeometry(CORNER, CORNER, ROOF - BOTTOM, 8, 1, true, 0, Math.PI / 2);
        g.rotateY(side > 0 ? (dir > 0 ? 0 : Math.PI / 2) : dir > 0 ? -Math.PI / 2 : Math.PI);
        g.translate(side * (HALF - CORNER), (ROOF + BOTTOM) / 2, z);
        this.#mesh(parent, g, this.mats.paint);
      }
    }
    // Front mask with windscreen and destination opening.
    if (S.front) {
      const w = HALF - CORNER;
      const shape = new THREE.Shape();
      shape.moveTo(-w, BOTTOM);
      shape.lineTo(w, BOTTOM);
      shape.lineTo(w, ROOF);
      shape.lineTo(-w, ROOF);
      shape.lineTo(-w, BOTTOM);
      const ws = new THREE.Path();
      roundRectPath(ws, -w + 0.06, 0.98, w - 0.06, 2.56, 0.1);
      shape.holes.push(ws);
      const ds = new THREE.Path();
      roundRectPath(ds, -w + 0.12, 2.62, w - 0.12, 2.9, 0.03);
      shape.holes.push(ds);
      const zm = S.zf;
      this.#mesh(parent, maskGeometry(shape, zm, 1), this.mats.paint);
      const gb = new GeoBuilder();
      gb.quad([-w, 0.98, zm - 0.01], [w, 0.98, zm - 0.01], [w, 2.56, zm - 0.01], [-w, 2.56, zm - 0.01], [0, 0, 1]);
      this.#mesh(parent, gb.build(), this.mats.glassLight);
      // Bumper, grille, lights, wipers, number plate.
      const fb = new GeoBuilder();
      fb.box(0, 0.42, zm + 0.04, HALF * 2 - 0.1, 0.28, 0.1, 0);
      fb.box(0, 0.78, zm + 0.02, 1.0, 0.08, 0.04, 0);
      fb.box(0.45, 1.0, zm + 0.02, 0.7, 0.03, 0.04, 0.4);
      fb.box(-0.45, 1.0, zm + 0.02, 0.7, 0.03, 0.04, -0.4);
      this.#mesh(parent, fb.build(), this.mats.black);
      const plate = new GeoBuilder();
      plate.box(0, 0.42, zm + 0.1, 0.52, 0.11, 0.01, 0);
      this.#mesh(parent, plate.build(), new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.4 }));
      for (const sx of [1, -1]) {
        const hg = new GeoBuilder();
        hg.box(sx * 0.86, 0.72, zm + 0.025, 0.4, 0.16, 0.05, 0);
        this.lights.head.push(this.#mesh(parent, hg.build(), this.mats.head));
        const dg = new GeoBuilder();
        dg.box(sx * 0.86, 0.62, zm + 0.025, 0.4, 0.035, 0.05, 0);
        this.lights.drl.push(this.#mesh(parent, dg.build(), this.mats.drl));
        const ig = new GeoBuilder();
        ig.box(sx * 1.12, 0.72, zm + 0.02, 0.12, 0.14, 0.05, 0);
        ig.box(sx * (HALF + 0.01), 1.0, zm - 1.2, 0.02, 0.05, 0.18, 0);
        this.#mesh(parent, ig.build(), sx > 0 ? this.mats.indicator : this.mats.indicatorR);
      }
    }
    // Rear mask with window, engine hatch and lights.
    if (S.rear) {
      const w = HALF - CORNER;
      const zm = S.zr;
      const shape = new THREE.Shape();
      shape.moveTo(-w, BOTTOM);
      shape.lineTo(w, BOTTOM);
      shape.lineTo(w, ROOF);
      shape.lineTo(-w, ROOF);
      shape.lineTo(-w, BOTTOM);
      const rw = new THREE.Path();
      roundRectPath(rw, -w + 0.2, 1.95, w - 0.2, 2.6, 0.08);
      shape.holes.push(rw);
      this.#mesh(parent, maskGeometry(shape, zm, -1), this.mats.paint);
      const gb = new GeoBuilder();
      gb.quad([w - 0.2, 1.95, zm + 0.01], [-w + 0.2, 1.95, zm + 0.01], [-w + 0.2, 2.6, zm + 0.01], [w - 0.2, 2.6, zm + 0.01], [0, 0, -1]);
      this.#mesh(parent, gb.build(), this.mats.glass);
      const rb2 = new GeoBuilder();
      rb2.box(0, 0.42, zm - 0.04, HALF * 2 - 0.1, 0.28, 0.1, 0);
      if (spec.engine !== 'electric') for (let k = 0; k < 6; k++) rb2.box(0, 0.75 + k * 0.1, zm - 0.02, 1.4, 0.04, 0.04, 0);
      this.#mesh(parent, rb2.build(), this.mats.black);
      for (const sx of [1, -1]) {
        const tg = new GeoBuilder();
        tg.box(sx * 1.07, 1.3, zm - 0.025, 0.14, 0.75, 0.05, 0);
        this.lights.tail.push(this.#mesh(parent, tg.build(), this.mats.tail));
        const ig = new GeoBuilder();
        ig.box(sx * 1.07, 0.82, zm - 0.025, 0.14, 0.14, 0.05, 0);
        this.#mesh(parent, ig.build(), sx > 0 ? this.mats.indicator : this.mats.indicatorR);
        const rv = new GeoBuilder();
        rv.box(sx * 1.07, 0.66, zm - 0.025, 0.14, 0.1, 0.05, 0);
        this.#mesh(parent, rv.build(), this.mats.reverse);
      }
    }
    // Open ends of an articulated bus: a frame around the passage.
    if (S.rearOpen || S.frontOpen) {
      const z = S.rearOpen ? S.zr : S.zf;
      const fr = new GeoBuilder();
      fr.box(HALF - 0.08, (ROOF + BOTTOM) / 2, z, 0.16, ROOF - BOTTOM, 0.08, 0);
      fr.box(-HALF + 0.08, (ROOF + BOTTOM) / 2, z, 0.16, ROOF - BOTTOM, 0.08, 0);
      fr.box(0, ROOF - 0.1, z, HALF * 2, 0.2, 0.08, 0);
      this.#mesh(parent, fr.build(), this.mats.dark);
    }

    // Wheels.
    for (const [z, dual] of S.axles) {
      for (const side of [1, -1]) {
        const wheel = new THREE.Group();
        const tw = dual ? 0.6 : 0.3;
        const x = side * (dual ? HALF - 0.05 - tw / 2 : spec.trackFront / 2);
        wheel.position.set(x, spec.wheelRadius, z);
        const spin = new THREE.Group();
        wheel.add(spin);
        const tyre = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, tw, 20);
        tyre.rotateZ(Math.PI / 2);
        spin.add(new THREE.Mesh(tyre, this.mats.tyre));
        const rim = new THREE.CylinderGeometry(0.29, 0.29, 0.02, 16);
        rim.rotateZ(Math.PI / 2);
        rim.translate(side * (tw / 2 + 0.005), 0, 0);
        spin.add(new THREE.Mesh(rim, this.mats.rim));
        const hub = new THREE.CylinderGeometry(0.1, 0.13, 0.08, 10);
        hub.rotateZ(Math.PI / 2);
        hub.translate(side * (tw / 2 + 0.04), 0, 0);
        spin.add(new THREE.Mesh(hub, this.mats.chrome));
        // Lug nuts show the rotation.
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const nut = new THREE.BoxGeometry(0.03, 0.035, 0.035);
          nut.translate(side * (tw / 2 + 0.02), Math.cos(a) * 0.19, Math.sin(a) * 0.19);
          spin.add(new THREE.Mesh(nut, this.mats.dark));
        }
        parent.add(wheel);
        this.wheels.push({ group: wheel, spin, front: !dual && z > 0, side, trailer: parent === this.trailer });
      }
    }

    // Doors: two glass leaves hinged at the opening edges, swinging outwards.
    for (const d of S.doors) {
      const leafW = d.w / 2 - 0.02;
      const x = -HALF - 0.015;
      const leaves = [];
      for (const k of [0, 1]) {
        const hingeZ = k === 0 ? d.z - d.w / 2 + 0.02 : d.z + d.w / 2 - 0.02;
        const hinge = new THREE.Group();
        hinge.position.set(x, 0, hingeZ);
        const dir = k === 0 ? 1 : -1;
        const leaf = new GeoBuilder();
        const h0 = FLOOR + 0.02;
        const h1 = WTOP - 0.02;
        leaf.box(0, (h0 + h1) / 2, (dir * leafW) / 2, 0.05, h1 - h0, leafW, 0);
        const frame = new THREE.Mesh(leaf.build(), this.mats.glass);
        hinge.add(frame);
        const fb = new GeoBuilder();
        fb.box(0, h1 - 0.03, (dir * leafW) / 2, 0.06, 0.06, leafW, 0);
        fb.box(0, h0 + 0.03, (dir * leafW) / 2, 0.06, 0.06, leafW, 0);
        fb.box(0, (h0 + h1) / 2, dir * (leafW - 0.03), 0.06, h1 - h0, 0.06, 0);
        fb.box(0, (h0 + h1) / 2, dir * 0.03, 0.06, h1 - h0, 0.06, 0);
        fb.box(0, 1.05, (dir * leafW) / 2, 0.07, 0.05, leafW - 0.1, 0);
        hinge.add(new THREE.Mesh(fb.build(), this.mats.black));
        parent.add(hinge);
        leaves.push({ hinge, dir });
      }
      this.doorLeaves.push(leaves);
    }

    // ---------------- interior
    const inner = new GeoBuilder();
    const z0 = S.zr + 0.15;
    const z1 = S.zf - (S.front ? 0.3 : 0.1);
    inner.box(0, FLOOR - 0.02, (z0 + z1) / 2, HALF * 2 - 0.08, 0.04, z1 - z0, 0);
    this.#mesh(parent, inner.build(), this.mats.interiorFloor);
    // Ceiling, luggage-rack style side boxes and light strips stop behind the driver's cab.
    const zc = S.front ? S.zf - 2.35 : z1;
    const ceil = new GeoBuilder();
    ceil.box(0, 2.62, (z0 + z1) / 2, HALF * 2 - 0.08, 0.04, z1 - z0, 0, undefined, { faces: ['ny'] });
    ceil.box(HALF - 0.25, 2.5, (z0 + zc) / 2, 0.4, 0.22, zc - z0, 0, undefined, { faces: ['ny', 'nx', 'pz'] });
    ceil.box(-HALF + 0.25, 2.5, (z0 + zc) / 2, 0.4, 0.22, zc - z0, 0, undefined, { faces: ['ny', 'px', 'pz'] });
    this.#mesh(parent, ceil.build(), this.mats.ceiling);
    const cl = new GeoBuilder();
    cl.box(0.55, 2.6, (z0 + zc) / 2, 0.12, 0.02, zc - z0 - 0.6, 0);
    cl.box(-0.55, 2.6, (z0 + zc) / 2, 0.12, 0.02, zc - z0 - 0.6, 0);
    this.#mesh(parent, cl.build(), this.mats.ceilingLight);
    // Seats in pairs along both sides, leaving room at the doors and a wheelchair bay opposite door 2.
    const seats = new GeoBuilder();
    const poles = new GeoBuilder();
    const busy = S.doors.map((d) => [d.z - d.w / 2 - 0.3, d.z + d.w / 2 + 0.3]);
    const rowStart = S.zr + 0.5;
    const rowEnd = S.zf - (S.front ? 2.2 : 0.6);
    for (const side of [1, -1]) {
      for (let z = rowStart; z < rowEnd; z += 0.82) {
        if (side < 0 && busy.some(([a, b]) => z > a && z < b)) continue;
        if (side > 0 && S.doors.length > 1 && z > S.doors[1].z - 1.2 && z < S.doors[1].z + 1.0 && !S.frontOpen) continue;
        for (const k of [0, 1]) {
          const x = side * (HALF - 0.32 - k * 0.47);
          const base = S.axles.some(([za]) => Math.abs(z - za) < 0.8) ? 0.25 : 0;
          seats.box(x, FLOOR + 0.42 + base, z, 0.44, 0.1, 0.44, 0);
          seats.box(x, FLOOR + 0.75 + base, z - 0.2, 0.44, 0.6, 0.08, -0.12);
          this.interiorSeats.push([x, FLOOR + 0.5 + base, z + 0.02, parent === this.trailer ? 1 : 0]);
        }
        poles.cylinder(side * (HALF - 1.0), FLOOR, z + 0.25, 0.022, 0.022, 2.1, 6);
      }
    }
    // Horizontal grab rails (not above the driver).
    for (const side of [1, -1]) poles.box(side * 0.35, 2.3, (z0 + zc) / 2, 0.035, 0.035, zc - z0 - 0.4, 0);
    this.#mesh(parent, seats.build(), this.mats.seat);
    this.#mesh(parent, poles.build(), this.mats.pole);
    this.standingSpots = this.standingSpots || [];
    for (let z = rowStart + 0.4; z < rowEnd; z += 0.9) this.standingSpots.push([parent === this.trailer ? 1 : 0, (Math.random() - 0.5) * 0.4, FLOOR, z]);
  }

  #bellows() {
    // Accordion rings between the two sections; placed every frame.
    this.bellowRings = [];
    const n = 7;
    const ringGeo = new THREE.BoxGeometry(HALF * 2 - 0.1, ROOF - BOTTOM - 0.1, 0.12);
    const mat = new THREE.MeshStandardMaterial({ color: '#1f2226', roughness: 0.9 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(ringGeo, mat);
      this.root.add(m);
      this.bellowRings.push(m);
    }
  }

  // ------------------------------------------------------------ cockpit
  #cockpit() {
    const g = this.geo;
    const zf = g.front;
    const cab = new THREE.Group();
    this.cab = cab;
    this.body.add(cab);
    // Dashboard across the front, higher on the driver's side.
    const d = new GeoBuilder();
    d.box(0.55, 1.02, zf - 0.45, 1.3, 0.3, 0.6, 0);
    d.box(-0.6, 0.95, zf - 0.35, 1.1, 0.2, 0.45, 0);
    d.box(0.55, 0.62, zf - 0.6, 1.2, 0.55, 0.3, 0);
    // Instrument binnacle above the steering wheel.
    d.box(0.6, 1.27, zf - 0.5, 0.74, 0.3, 0.26, 0);
    // Cab partition behind the driver and a fare box near door 1.
    d.box(0.05, 1.3, zf - 2.3, 0.06, 1.1, 1.1, 0);
    d.box(-0.25, 1.05, zf - 1.35, 0.35, 0.4, 0.3, 0);
    // Driver seat.
    d.box(0.62, 0.95, zf - 1.75, 0.5, 0.12, 0.5, 0);
    d.box(0.62, 1.4, zf - 2.0, 0.5, 0.8, 0.1, 0);
    this.#mesh(cab, d.build(), this.mats.dash);
    // Instrument screen (canvas) facing the driver.
    this.dashCanvas = makeCanvasTexture(512, 256);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: this.dashCanvas.texture, toneMapped: false }));
    screen.position.set(0.6, 1.33, zf - 0.69);
    screen.rotation.set(-0.6, Math.PI, 0);
    cab.add(screen);
    this.dashScreen = screen;
    // Steering wheel (nearly flat, like in a bus).
    this.steeringWheel = new THREE.Group();
    this.steeringWheel.position.set(0.62, 1.2, zf - 1.05);
    this.steeringWheel.rotation.x = -0.95;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 8, 28), this.mats.cabBlack);
    rim.rotation.x = Math.PI / 2;
    this.steeringWheel.add(rim);
    for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.04), this.mats.dark);
      spoke.position.set(Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11);
      spoke.rotation.y = -a;
      this.steeringWheel.add(spoke);
    }
    cab.add(this.steeringWheel);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8), this.mats.dark);
    col.position.set(0.62, 0.95, zf - 0.85);
    col.rotation.x = 0.6;
    cab.add(col);
    // Passenger information screen above the windscreen (next stop, stop request).
    this.infoCanvas = makeCanvasTexture(512, 128);
    const info = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.14), new THREE.MeshBasicMaterial({ map: this.infoCanvas.texture, toneMapped: false }));
    info.position.set(-0.62, 2.47, zf - 0.32);
    info.rotation.y = Math.PI;
    this.body.add(info);
    // Dark header above the windscreen (houses the destination display).
    const hdr = new GeoBuilder();
    hdr.box(0, 2.76, zf - 0.2, HALF * 2 - 0.1, 0.36, 0.3, 0);
    // Dark trim on the inside of the A-pillars and below the windscreen.
    for (const sx of [1, -1]) hdr.box(sx * (HALF - 0.05), (SILL + ROOF) / 2, zf - 0.16, 0.04, ROOF - SILL, 0.28, 0);
    hdr.box(0, 0.96, zf - 0.08, HALF * 2 - 0.12, 0.1, 0.12, 0);
    this.#mesh(cab, hdr.build(), this.mats.dash);
    // Driver's eye position (camera anchor).
    this.driverEye = new THREE.Object3D();
    this.driverEye.position.set(0.62, 1.98, zf - 1.7);
    this.body.add(this.driverEye);
  }

  // ------------------------------------------------------------ mirrors
  #mirrors() {
    const zf = this.geo.front;
    this.mirrorHeads = [];
    for (const side of [1, -1]) {
      const arm = new GeoBuilder();
      const x0 = side * (HALF - 0.1);
      const x1 = side * (HALF + 0.3);
      arm.box((x0 + x1) / 2, ROOF - 0.05, zf + 0.05, Math.abs(x1 - x0), 0.05, 0.05, 0);
      arm.box(x1, ROOF - 0.25, zf + 0.2, 0.05, 0.45, 0.05, 0.3);
      this.#mesh(this.body, arm.build(), this.mats.black);
      const head = new THREE.Group();
      head.position.set(side * (HALF + 0.32), 2.22, zf + 0.32);
      head.rotation.y = side * 0.18;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.46, 0.09), this.mats.black);
      head.add(box);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.42), new THREE.MeshBasicMaterial({ color: '#8a96a0' }));
      glass.position.z = -0.05;
      glass.rotation.y = Math.PI;
      head.add(glass);
      this.body.add(head);
      this.mirrorHeads.push({ head, glass, side });
    }
  }

  // Use render targets for the mirror glasses (u flipped = mirror image).
  setMirrorTextures(left, right) {
    for (const m of this.mirrorHeads) {
      const t = m.side > 0 ? left : right;
      m.glass.material = new THREE.MeshBasicMaterial({ map: t });
      m.glass.geometry = m.glass.geometry.clone();
      const uv = m.glass.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    }
  }

  // ------------------------------------------------------------ destination displays
  #displays() {
    const g = this.geo;
    this.destFront = makeCanvasTexture(512, 64);
    this.destSide = makeCanvasTexture(512, 64);
    this.destRear = makeCanvasTexture(128, 64);
    const mat = (t) => new THREE.MeshStandardMaterial({ map: t.texture, emissiveMap: t.texture, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, roughness: 0.3, toneMapped: false });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 0.27), mat(this.destFront));
    front.position.set(0, 2.76, g.front + 0.003);
    this.body.add(front);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.2), mat(this.destSide));
    side.position.set(-HALF - 0.004, 2.32, this.spec.doors[0].z - 1.6);
    side.rotation.y = -Math.PI / 2;
    this.body.add(side);
    const rearParent = this.trailer || this.body;
    const rz = this.trailer ? g.trailerRear : g.rear;
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), mat(this.destRear));
    rear.position.set(0, 2.3, rz - 0.003);
    rear.rotation.y = Math.PI;
    rearParent.add(rear);
    this.setDestination('', 'Nicht einsteigen', '#ffb52e');
  }

  setDestination(line, text, color = '#ffb52e') {
    drawDestination(this.destFront.ctx, 512, 64, line, text, color);
    drawDestination(this.destSide.ctx, 512, 64, line, text, color);
    const c = this.destRear.ctx;
    c.fillStyle = '#050505';
    c.fillRect(0, 0, 128, 64);
    c.fillStyle = color;
    c.font = 'bold 46px "IBM Plex Mono", ui-monospace, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(line || '', 64, 35);
    this.destFront.texture.needsUpdate = true;
    this.destSide.texture.needsUpdate = true;
    this.destRear.texture.needsUpdate = true;
  }

  // ------------------------------------------------------------ per frame
  // s: { bus (physics), indicator, hazard, lights, braking, reversing, dt, night }
  update(s) {
    const bus = s.bus;
    const g = this.geo;
    // Front section pose: rear axle under the origin.
    const sy = Math.sin(bus.yaw);
    const cy = Math.cos(bus.yaw);
    const rx = bus.x - sy * bus.b;
    const rz = bus.z - cy * bus.b;
    this.body.position.set(rx, bus.heave, rz);
    this.body.rotation.set(-bus.pitch, bus.yaw, bus.roll, 'YXZ');
    // Wheels: steering (Ackermann) and rolling.
    const delta = bus.steer;
    const L = bus.L;
    const R = Math.abs(delta) > 1e-4 ? L / Math.tan(Math.abs(delta)) : Infinity;
    for (const w of this.wheels) {
      w.spin.rotation.x = bus.wheelSpin;
      if (w.front) {
        const inner = Math.sign(delta) === w.side;
        const r = inner ? R - this.spec.trackFront / 2 : R + this.spec.trackFront / 2;
        w.group.rotation.y = Math.sign(delta) * Math.atan(L / Math.max(r, 0.5));
      }
    }
    // Doors.
    bus.doors.forEach((d, i) => {
      const leaves = this.doorLeaves[i];
      if (!leaves) return;
      const a = d.open * 1.45;
      for (const lf of leaves) lf.hinge.rotation.y = lf.dir > 0 ? -a * 1 : a;
    });
    // Rear section and bellows.
    if (this.trailer) {
      const j = bus.jointPos();
      this.trailer.position.set(j[0], bus.heave * 0.5, j[1]);
      this.trailer.rotation.set(0, bus.yaw2, 0);
      const n = this.bellowRings.length;
      const a0 = bus.localToWorld(0, g.rear + 0.05);
      const a1 = bus.trailerToWorld(0, g.trailerFront - 0.05);
      let dy = bus.yaw2 - bus.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const m = this.bellowRings[i];
        m.position.set(a0[0] + (a1[0] - a0[0]) * t, (ROOF + BOTTOM) / 2 + bus.heave * 0.7, a0[1] + (a1[1] - a0[1]) * t);
        m.rotation.set(0, bus.yaw + dy * t, 0);
      }
    }
    // Lights.
    this.blink = (this.blink + s.dt) % 0.8;
    const on = this.blink < 0.42;
    const left = (s.indicator === 1 || s.hazard) && on;
    const right = (s.indicator === -1 || s.hazard) && on;
    this.mats.indicator.emissiveIntensity = left ? 3 : 0;
    this.mats.indicatorR.emissiveIntensity = right ? 3 : 0;
    this.mats.head.emissiveIntensity = s.lights ? 3.2 : 0.15;
    this.mats.drl.emissiveIntensity = bus.engineOn ? 2.2 : 0;
    this.mats.tail.emissiveIntensity = s.braking ? 3 : s.lights ? 1 : 0.08;
    this.mats.reverse.emissiveIntensity = s.reversing ? 2.5 : 0;
    this.mats.ceilingLight.emissiveIntensity = s.lights || s.night > 0.3 ? 1.6 : 0.35;
    this.headLight.intensity = s.lights ? 60 : 0;
    // Steering wheel follows the front wheels (ratio ~18:1); Euler XYZ spins it about its own axis.
    if (this.steeringWheel) this.steeringWheel.rotation.set(-0.95, clamp(-delta * 18, -14, 14), 0);
  }

  // Dashboard instruments (call ~10–20 Hz).
  drawDashboard(d) {
    if (!this.dashCanvas) return;
    const c = this.dashCanvas.ctx;
    const W = 512;
    const H = 256;
    c.fillStyle = '#0d1116';
    c.fillRect(0, 0, W, H);
    // Speedometer.
    const cx = 128;
    const cyy = 132;
    c.strokeStyle = '#3a4450';
    c.lineWidth = 10;
    c.beginPath();
    c.arc(cx, cyy, 96, Math.PI * 0.75, Math.PI * 2.25);
    c.stroke();
    c.fillStyle = '#cfd8e0';
    c.font = '600 16px "IBM Plex Mono", ui-monospace, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let v = 0; v <= 100; v += 20) {
      const a = Math.PI * 0.75 + (v / 100) * Math.PI * 1.5;
      c.fillText(String(v), cx + Math.cos(a) * 72, cyy + Math.sin(a) * 72);
    }
    const a = Math.PI * 0.75 + (clamp(d.kmh, 0, 100) / 100) * Math.PI * 1.5;
    c.strokeStyle = d.over ? '#ff4d3d' : '#f2a541';
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(cx, cyy);
    c.lineTo(cx + Math.cos(a) * 90, cyy + Math.sin(a) * 90);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '800 34px "IBM Plex Mono", ui-monospace, monospace';
    c.fillText(String(Math.round(d.kmh)), cx, cyy + 48);
    // Status panel.
    c.textAlign = 'left';
    c.font = '700 22px "IBM Plex Mono", ui-monospace, monospace';
    c.fillStyle = '#9fb3c2';
    c.fillText(d.clock, 262, 36);
    c.fillStyle = '#ffffff';
    c.font = '800 44px "IBM Plex Mono", ui-monospace, monospace';
    c.fillText(d.gear, 262, 92);
    const lamp = (x, y, text, onState, color) => {
      c.fillStyle = onState ? color : '#222a33';
      c.fillRect(x, y, 108, 34);
      c.fillStyle = onState ? '#101010' : '#56626e';
      c.font = '700 17px "Atkinson Hyperlegible", Arial, sans-serif';
      c.textAlign = 'center';
      c.fillText(text, x + 54, y + 18);
      c.textAlign = 'left';
    };
    lamp(262, 130, 'TÜREN', d.doors, '#ff6b3d');
    lamp(378, 130, 'HALTEBR.', d.stopBrake, '#ffd23d');
    lamp(262, 172, 'WAGEN HÄLT', d.request, '#ffd23d');
    lamp(378, 172, 'KNEELING', d.kneel, '#3dc0ff');
    lamp(262, 214, 'FESTSTELLBR.', d.parking, '#ff3d3d');
    lamp(378, 214, 'RETARDER', d.retarder, '#7dff8a');
    if (d.indicator === 1 && d.blinkOn) {
      c.fillStyle = '#3dff6a';
      c.beginPath();
      c.moveTo(390, 70);
      c.lineTo(420, 52);
      c.lineTo(420, 88);
      c.fill();
    }
    if (d.indicator === -1 && d.blinkOn) {
      c.fillStyle = '#3dff6a';
      c.beginPath();
      c.moveTo(490, 70);
      c.lineTo(460, 52);
      c.lineTo(460, 88);
      c.fill();
    }
    this.dashCanvas.texture.needsUpdate = true;
  }

  drawInfoScreen(line, next, request, color = '#ffb52e') {
    if (!this.infoCanvas) return;
    const c = this.infoCanvas.ctx;
    c.fillStyle = '#0b1f3a';
    c.fillRect(0, 0, 512, 128);
    c.fillStyle = color;
    c.fillRect(0, 0, 88, 128);
    c.fillStyle = '#111';
    c.font = 'bold 54px "IBM Plex Mono", ui-monospace, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(line, 44, 66);
    c.fillStyle = '#ffffff';
    c.textAlign = 'left';
    c.font = '600 22px "Atkinson Hyperlegible", Arial, sans-serif';
    c.fillText('Nächster Halt', 104, 34);
    c.font = 'bold 38px "Atkinson Hyperlegible", Arial, sans-serif';
    c.fillText(next, 104, 80, 400);
    if (request) {
      c.fillStyle = '#ff3b30';
      c.fillRect(360, 8, 144, 34);
      c.fillStyle = '#fff';
      c.font = 'bold 22px "Atkinson Hyperlegible", Arial';
      c.textAlign = 'center';
      c.fillText('Wagen hält', 432, 26);
    }
    this.infoCanvas.texture.needsUpdate = true;
  }

  // World position of seat i (seat surface) or standing spot i (floor), for drawing the
  // passengers inside. Call after update() so the section matrices are current.
  seatWorld(i, out) {
    const p = this.interiorSeats[i % this.interiorSeats.length];
    out.set(p[0], p[1], p[2]);
    return (p[3] ? this.trailer : this.body).localToWorld(out);
  }

  standWorld(i, out) {
    const p = this.standingSpots[i % this.standingSpots.length];
    out.set(p[1], p[2], p[3]);
    return (p[0] ? this.trailer : this.body).localToWorld(out);
  }

  sectionOfSeat(i) {
    return this.interiorSeats[i % this.interiorSeats.length][3];
  }

  sectionOfStand(i) {
    return this.standingSpots[i % this.standingSpots.length][0];
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

// Merge the direct mesh children of a group that share material and attribute layout.
function mergeChildren(group) {
  const buckets = new Map();
  for (const m of group.children) {
    if (!m.isMesh || m.isInstancedMesh) continue;
    const key = `${m.material.uuid}|${Object.keys(m.geometry.attributes).sort().join(',')}|${m.castShadow}|${m.renderOrder}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrix);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.renderOrder = list[0].renderOrder;
    for (const m of list) {
      group.remove(m);
      m.geometry.dispose();
    }
    group.add(mesh);
  }
}
