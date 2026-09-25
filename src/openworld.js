// Open-world layer for free roam: checkpoint runs, drift zones, speed traps, jump ramps and speed
// zones, bonus boards and discoveries, their world markers, HUD, map data and saved progress.
import * as THREE from 'three';
import { starsFor, rampSurface } from './activities.js';
import { ROAD } from './config.js';
import { clamp, formatTime, wrapAngle } from './util.js';
import { RoadDiscovery } from './navigation.js';
import { ICON_COLORS } from './maprender.js';
import * as TX from './textures.js';

const PROGRESS_KEY = 'nordkamm.progress.v1';
export const ACTIVITY_COLORS = { run: ICON_COLORS.run, drift: ICON_COLORS.drift, trap: ICON_COLORS.trap, jump: ICON_COLORS.jump, zone: ICON_COLORS.zone };
const XP = { star: 1000, finish: 150, landmark: 500, board: 1000, road: 5 };
const LABELS = { run: 'Checkpoint-Lauf', drift: 'Drift-Zone', trap: 'Blitzer', jump: 'Sprungschanze', zone: 'Tempozone', landmark: 'Sehenswürdigkeit', festival: 'Festival', board: 'Bonusschild' };
const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const km = (m) => `${(m / 1000).toFixed(2).replace('.', ',')} km`;
const STAR = '★';
const NO_STAR = '☆';

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveProgress(p) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* storage may be unavailable */
  }
}

export const starText = (n) => STAR.repeat(n) + NO_STAR.repeat(3 - n);

export class OpenWorld {
  constructor(game) {
    this.game = game;
    this.data = game.data;
    this.track = game.data.track;
    this.group = new THREE.Group();
    this.group.name = 'openworld';
    this.group.visible = false;
    game.scene.add(this.group);
    this.progress = loadProgress();
    this.career = game.career;
    this.discovery = new RoadDiscovery(game.data, this.career.roads);
    this.discoverTimer = 0;
    this.saveTimer = 0;
    this.roadXp = 0;
    this.roadMilestone = Math.floor(this.discovery.fraction * 10);
    this.debris = [];
    this.speedZone = null;
    this.enabled = false;
    this.run = null;
    this.zone = null;
    this.jump = null;
    this.holding = false;
    this.wasGround = true;
    this.trapCooldown = new Map();
    this.time = 0;
    this.q = {};
    this.el = (id) => document.getElementById(id);
  }

  // ------------------------------------------------------------------ progress
  best(id) {
    return this.progress[id];
  }

  starsOf(kind, item) {
    const b = this.progress[item.id];
    if (b === undefined) return 0;
    if (kind === 'run') return starsFor(b, item.medals, true);
    return starsFor(b, item.goals);
  }

  // XP for a result: every newly earned star plus a little for finishing.
  #reward(kind, item, before) {
    const after = this.starsOf(kind, item);
    const xp = XP.finish + Math.max(0, after - before) * XP.star;
    this.career.award(xp, item.name);
    return after;
  }

  #record(id, value, lowerIsBetter) {
    const old = this.progress[id];
    const better = old === undefined || (lowerIsBetter ? value < old : value > old);
    if (better) {
      this.progress[id] = value;
      saveProgress(this.progress);
    }
    return better;
  }

  totals() {
    const d = this.data;
    let stars = 0;
    for (const r of d.routes) stars += this.starsOf('run', r);
    for (const z of d.driftZones) stars += this.starsOf('drift', z);
    for (const t of d.speedTraps) stars += this.starsOf('trap', t);
    for (const j of d.ramps) stars += this.starsOf('jump', j);
    for (const z of d.speedZones) stars += this.starsOf('zone', z);
    const count = d.routes.length + d.driftZones.length + d.speedTraps.length + d.ramps.length + d.speedZones.length;
    return { stars, max: count * 3, count };
  }

  // ------------------------------------------------------------------ visuals
  #beam(x, y, z, color, height, radius = 1.4) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 20, 1, true);
    geo.translate(0, height / 2, 0);
    const mat = new THREE.MeshBasicMaterial({
      color,
      map: this.beamTex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 6;
    m.userData.baseOpacity = mat.opacity;
    this.group.add(m);
    (this.beams || (this.beams = [])).push(m);
    return m;
  }

  #label(x, y, z, title, sub, color, scale = 1) {
    const mat = new THREE.SpriteMaterial({ map: TX.labelTexture(title, sub, color), depthWrite: false, fog: false, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, z);
    s.scale.set(11 * scale, 3.45 * scale, 1);
    s.renderOrder = 7;
    this.group.add(s);
    return s;
  }

  #setLabel(sprite, title, sub, color) {
    sprite.material.map.dispose();
    sprite.material.map = TX.labelTexture(title, sub, color);
    sprite.material.needsUpdate = true;
  }

  #ring(x, y, z, color, inner = 5.5, outer = 7) {
    const geo = new THREE.RingGeometry(inner, outer, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + 0.25, z);
    m.renderOrder = 6;
    this.group.add(m);
    return m;
  }

  #groundY(x, z) {
    const q = this.track.nearest(x, z, -1, this.q);
    return this.data.groundHeight(x, z, q);
  }

  build() {
    this.beamTex = TX.beamTexture();
    const d = this.data;

    // Checkpoint runs: start marker with light beam, ring and name.
    this.runMarkers = d.routes.map((r) => {
      const y = this.#groundY(r.start.x, r.start.z);
      const beam = this.#beam(r.start.x, y, r.start.z, ACTIVITY_COLORS.run, 160, 1.8);
      const ring = this.#ring(r.start.x, y, r.start.z, ACTIVITY_COLORS.run);
      const label = this.#label(r.start.x, y + 9, r.start.z, r.name, this.#runSub(r), ACTIVITY_COLORS.run);
      return { route: r, beam, ring, label };
    });

    // Gates for an active run (current, next) and a finish variant.
    const torus = new THREE.TorusGeometry(7.5, 0.32, 10, 60);
    const gateMat = () => new THREE.MeshBasicMaterial({ color: ACTIVITY_COLORS.run, transparent: true, opacity: 0.95, toneMapped: false, fog: false });
    this.gates = [0, 1].map(() => {
      const m = new THREE.Mesh(torus, gateMat());
      m.visible = false;
      m.renderOrder = 6;
      this.group.add(m);
      return m;
    });
    this.gateBeam = this.#beam(0, 0, 0, ACTIVITY_COLORS.run, 90, 0.9);
    this.gateBeam.visible = false;

    // Drift zones: arch with banner at the start, smaller one at the end.
    const pillarGeo = new THREE.BoxGeometry(0.7, 7.5, 0.7);
    pillarGeo.translate(0, 3.75, 0);
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#2a2230', metalness: 0.5, roughness: 0.4, emissive: ACTIVITY_COLORS.drift, emissiveIntensity: 0.35 });
    this.zoneMarkers = d.driftZones.map((z) => {
      const parts = [];
      for (const [s, title] of [
        [z.s0, 'Drift-Zone'],
        [z.s1, 'Ende'],
      ]) {
        const p = this.track.pointAt(s, 0, {});
        for (const sd of [1, -1]) {
          const pp = this.track.pointAt(s, sd * (ROAD.halfTotal + 1.2), {});
          const pillar = new THREE.Mesh(pillarGeo, pillarMat);
          pillar.position.set(pp.x, this.#groundY(pp.x, pp.z), pp.z);
          pillar.castShadow = true;
          this.group.add(pillar);
          parts.push(pillar);
          this.data.colliders.addCircle(pp.x, pp.z, 0.6, 'pole');
        }
        // Two single-sided planes so the text reads correctly from both directions.
        const bannerMat = new THREE.MeshBasicMaterial({ map: TX.labelTexture(title, z.name, ACTIVITY_COLORS.drift), toneMapped: false });
        for (const turn of [Math.PI, 0]) {
          const banner = new THREE.Mesh(new THREE.PlaneGeometry(ROAD.width + 3, 2.4), bannerMat);
          banner.position.set(p.x, p.h + 8, p.z);
          banner.rotation.y = p.heading + turn;
          this.group.add(banner);
          parts.push(banner);
        }
      }
      const p0 = this.track.pointAt(z.s0, 0, {});
      const beam = this.#beam(p0.x, p0.h, p0.z, ACTIVITY_COLORS.drift, 110, 1.3);
      return { zone: z, parts, beam };
    });

    // Speed traps: roadside pole with a radar box and a sign.
    const trapPole = new THREE.CylinderGeometry(0.12, 0.14, 4.2, 10);
    trapPole.translate(0, 2.1, 0);
    const trapBox = new THREE.BoxGeometry(0.55, 0.45, 0.8);
    const trapMat = new THREE.MeshStandardMaterial({ color: '#d9dde2', metalness: 0.3, roughness: 0.5 });
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3f46', metalness: 0.6, roughness: 0.4 });
    this.trapLeds = [];
    this.trapMarkers = d.speedTraps.map((t) => {
      const y = this.#groundY(t.poleX, t.poleZ);
      const g = new THREE.Group();
      g.position.set(t.poleX, y, t.poleZ);
      g.rotation.y = t.heading + Math.PI;
      const pole = new THREE.Mesh(trapPole, poleMat);
      pole.castShadow = true;
      g.add(pole);
      const box = new THREE.Mesh(trapBox, trapMat);
      box.position.set(0, 4.3, 0);
      box.castShadow = true;
      g.add(box);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false }));
      led.position.set(0.15, 4.45, 0.41);
      g.add(led);
      this.trapLeds.push(led);
      this.group.add(g);
      this.data.colliders.addCircle(t.poleX, t.poleZ, 0.4, 'pole');
      const label = this.#label(t.poleX, y + 7, t.poleZ, t.name, this.#trapSub(t), ACTIVITY_COLORS.trap, 0.8);
      const beam = this.#beam(t.poleX, y, t.poleZ, ACTIVITY_COLORS.trap, 60, 0.8);
      return { trap: t, group: g, label, beam };
    });

    // Ramps
    const rampMat = new THREE.MeshStandardMaterial({ map: TX.rampTexture(), roughness: 0.85, side: THREE.DoubleSide });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#4a3622', roughness: 0.9, side: THREE.DoubleSide });
    this.rampMarkers = d.ramps.map((r) => {
      const { top, sides } = this.#rampGeometry(r);
      const deck = new THREE.Mesh(top, rampMat);
      deck.castShadow = true;
      deck.receiveShadow = true;
      const walls = new THREE.Mesh(sides, sideMat);
      walls.castShadow = true;
      this.group.add(deck, walls);
      const fx = Math.sin(r.yaw);
      const fz = Math.cos(r.yaw);
      const bx = r.x - fx * 6;
      const bz = r.z - fz * 6;
      const y = this.#groundY(bx, bz);
      const beam = this.#beam(bx, y, bz, ACTIVITY_COLORS.jump, 90, 1.2);
      const label = this.#label(bx, y + 8, bz, r.name, this.#jumpSub(r), ACTIVITY_COLORS.jump, 0.85);
      return { ramp: r, beam, label };
    });

    this.#buildTrails();
    this.#buildSpeedZones();
    this.#buildBoards();
  }

  // Speed zones: yellow arches at the start and the end of the measured stretch.
  #buildSpeedZones() {
    const pillarGeo = new THREE.BoxGeometry(0.6, 7, 0.6);
    pillarGeo.translate(0, 3.5, 0);
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#2b2a22', metalness: 0.5, roughness: 0.4, emissive: ACTIVITY_COLORS.zone, emissiveIntensity: 0.35 });
    const roads = [this.track, ...this.data.branches];
    this.zoneGates = this.data.speedZones.map((z) => {
      const road = roads.find((r) => (r.id || 'circuit') === z.roadId) || this.track;
      z.road = road;
      const ht = road.halfTotal || ROAD.halfTotal;
      const parts = [];
      for (const [s, title] of [
        [z.s0, 'Tempozone'],
        [z.s0 + z.length, 'Ziel'],
      ]) {
        const p = road.pointAt(s, 0, {});
        for (const sd of [1, -1]) {
          const pp = road.pointAt(s, sd * (ht + 1.2), {});
          const pillar = new THREE.Mesh(pillarGeo, pillarMat);
          pillar.position.set(pp.x, this.#groundY(pp.x, pp.z), pp.z);
          pillar.castShadow = true;
          this.group.add(pillar);
          this.data.colliders.addCircle(pp.x, pp.z, 0.5, 'pole');
        }
        const mat = new THREE.MeshBasicMaterial({ map: TX.labelTexture(title, z.name, ACTIVITY_COLORS.zone), toneMapped: false });
        for (const turn of [Math.PI, 0]) {
          const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * ht + 2.4, 2.2), mat);
          banner.position.set(p.x, p.h + 7.4, p.z);
          banner.rotation.y = p.heading + turn;
          this.group.add(banner);
          parts.push(banner);
        }
      }
      const p0 = road.pointAt(z.s0, 0, {});
      const beam = this.#beam(p0.x, p0.h, p0.z, ACTIVITY_COLORS.zone, 80, 1.1);
      return { zone: z, parts, beam };
    });
  }

  // Bonus boards: orange signs on two posts, smashed by driving through them.
  #buildBoards() {
    const tex = TX.bonusBoardTexture();
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: '#ff8a1f', emissiveIntensity: 0.15 });
    const backMat = new THREE.MeshStandardMaterial({ color: '#d8611a', roughness: 0.7 });
    const postMat = new THREE.MeshStandardMaterial({ color: '#3a3f46', metalness: 0.5, roughness: 0.5 });
    const face = new THREE.PlaneGeometry(3.2, 2);
    const back = new THREE.PlaneGeometry(3.2, 2);
    back.rotateY(Math.PI);
    const post = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6);
    post.translate(0, 1.2, 0);
    this.boardParts = { faceMat, backMat, postMat, face, back, post };
    this.boardMarkers = this.data.bonusBoards.map((b) => {
      const g = new THREE.Group();
      g.position.set(b.x, b.y, b.z);
      g.rotation.y = b.yaw;
      for (const sd of [-1, 1]) {
        const m = new THREE.Mesh(post, postMat);
        m.position.x = sd * 1.35;
        g.add(m);
      }
      const f = new THREE.Mesh(face, faceMat);
      f.position.y = 2.6;
      const bk = new THREE.Mesh(back, backMat);
      bk.position.y = 2.6;
      g.add(f, bk);
      g.traverse((o) => (o.castShadow = true));
      g.visible = !this.career.boards.has(b.id);
      this.group.add(g);
      return { board: b, group: g };
    });
  }

  #rampGeometry(r) {
    const hf = this.data.heightfield;
    const fx = Math.sin(r.yaw);
    const fz = Math.cos(r.yaw);
    const lx = fz;
    const lz = -fx;
    const nA = 18;
    const top = { pos: [], uv: [], idx: [] };
    for (let i = 0; i <= nA; i++) {
      const along = (i / nA) * r.length;
      for (let j = 0; j <= 2; j++) {
        const side = (j / 2 - 0.5) * r.width;
        const x = r.x + fx * along + lx * side;
        const z = r.z + fz * along + lz * side;
        const y = hf.get(x, z) + Math.max(0.03, rampSurface(this.data, x - fx * 0.001, z - fz * 0.001)) + 0.02;
        top.pos.push(x, y, z);
        top.uv.push(j / 2, i / nA); // v = 1 at the lip, where the chevrons are painted
      }
    }
    for (let i = 0; i < nA; i++) {
      for (let j = 0; j < 2; j++) {
        const a = i * 3 + j;
        const b = a + 1;
        const c = a + 3;
        const e = c + 1;
        top.idx.push(a, c, b, b, c, e);
      }
    }
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(top.pos, 3));
    topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(top.uv, 2));
    topGeo.setIndex(top.idx);
    topGeo.computeVertexNormals();
    // Side walls and the vertical face under the lip, down into the ground.
    const walls = [];
    const quad = (p1, p2, p3, p4) => walls.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
    for (const j of [0, 2]) {
      for (let i = 0; i < nA; i++) {
        const a = top.pos.slice((i * 3 + j) * 3, (i * 3 + j) * 3 + 3);
        const b = top.pos.slice(((i + 1) * 3 + j) * 3, ((i + 1) * 3 + j) * 3 + 3);
        quad(a, b, [b[0], hf.get(b[0], b[2]) - 0.4, b[2]], [a[0], hf.get(a[0], a[2]) - 0.4, a[2]]);
      }
    }
    const l0 = top.pos.slice(nA * 3 * 3, nA * 3 * 3 + 3);
    const l2 = top.pos.slice((nA * 3 + 2) * 3, (nA * 3 + 2) * 3 + 3);
    quad(l0, l2, [l2[0], hf.get(l2[0], l2[2]) - 0.4, l2[2]], [l0[0], hf.get(l0[0], l0[2]) - 0.4, l0[2]]);
    const sideGeo = new THREE.BufferGeometry();
    sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(walls, 3));
    sideGeo.computeVertexNormals();
    sideGeo.computeBoundingSphere();
    return { top: topGeo, sides: sideGeo };
  }

  #buildTrails() {
    const hf = this.data.heightfield;
    const pos = [];
    const uv = [];
    const idx = [];
    const q = {};
    for (const c of this.data.clearCorridors || []) {
      if (!c.trail) continue;
      const dx = c.bx - c.ax;
      const dz = c.bz - c.az;
      const len = Math.hypot(dx, dz);
      const fx = dx / len;
      const fz = dz / len;
      const lx = fz;
      const lz = -fx;
      let prevOk = false;
      for (let t = 0; t <= len; t += 3) {
        const x = c.ax + fx * t;
        const z = c.az + fz * t;
        const near = this.track.nearest(x, z, -1, q);
        const ok = !(near.index >= 0 && near.dist < ROAD.halfTotal + 3);
        const base = pos.length / 3;
        for (const side of [-2.4, 2.4]) {
          const px = x + lx * side;
          const pz = z + lz * side;
          pos.push(px, hf.get(px, pz) + 0.08, pz);
          uv.push(side < 0 ? 0 : 1, t / 10);
        }
        if (t > 0 && ok && prevOk) idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
        prevOk = ok;
      }
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: TX.trailTexture(), transparent: true, depthWrite: false, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    // Trails belong to the world, visible in every mode.
    this.game.scene.add(mesh);
  }

  #runSub(r) {
    const b = this.best(r.id);
    return b === undefined ? `Checkpoint-Lauf · Gold ${formatTime(r.medals[0])}` : `Bestzeit ${formatTime(b)} ${starText(this.starsOf('run', r))}`;
  }

  #trapSub(t) {
    const b = this.best(t.id);
    return b === undefined ? `Ziel ${t.goals[2]} km/h` : `Rekord ${Math.round(b)} km/h ${starText(this.starsOf('trap', t))}`;
  }

  #jumpSub(r) {
    const b = this.best(r.id);
    return b === undefined ? `Sprungweite · Ziel ${r.goals[2]} m` : `Rekord ${b.toFixed(1).replace('.', ',')} m ${starText(this.starsOf('jump', r))}`;
  }

  // ------------------------------------------------------------------ state
  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
    this.cancelRun(true);
    this.zone = null;
    this.speedZone = null;
    this.jump = null;
    this.holding = false;
    this.trapCooldown.clear();
    this.#showRunMarkers(true);
    this.#hud(null);
    this.el('prompt').hidden = true;
  }

  // Start markers show while no run is active; gates only during a run.
  #showRunMarkers(on) {
    for (const m of this.runMarkers) {
      m.beam.visible = on;
      m.ring.visible = on;
      m.label.visible = on;
    }
    if (on) {
      for (const g of this.gates) g.visible = false;
      this.gateBeam.visible = false;
    }
  }

  get runActive() {
    return !!this.run;
  }

  cancelRun(silent = false) {
    if (!this.run) return;
    this.rearm = this.run.route.id;
    this.run = null;
    this.holding = false;
    this.#showRunMarkers(true);
    if (!silent) this.game.hud.message('Lauf abgebrochen', 1.4, 'warn');
  }

  // Where to put the car on a reset during a run: the last gate, facing the next one.
  respawnPose() {
    if (!this.run) return null;
    const r = this.run.route;
    const from = this.run.next === 0 ? r.start : r.checkpoints[this.run.next - 1];
    const to = r.checkpoints[this.run.next];
    return { x: from.x, z: from.z, heading: Math.atan2(to.x - from.x, to.z - from.z) };
  }

  #startRun(r) {
    const g = this.game;
    const first = r.checkpoints[0];
    const heading = Math.atan2(first.x - r.start.x, first.z - r.start.z);
    g.placeCar(r.start.x, r.start.z, heading);
    this.run = { route: r, next: 0, time: 0, countdown: 3.2, lastBeep: 4 };
    this.holding = true;
    this.#showRunMarkers(false);
    this.#placeGates();
    g.hud.message(r.name, 1.2, 'info');
  }

  #placeGates() {
    const r = this.run.route;
    const cps = r.checkpoints;
    this.gates.forEach((gate, k) => {
      const i = this.run.next + k;
      if (i >= cps.length) {
        gate.visible = false;
        return;
      }
      const p = cps[i];
      const prev = i === 0 ? r.start : cps[i - 1];
      gate.position.set(p.x, this.#groundY(p.x, p.z) + 3.6, p.z);
      gate.rotation.set(0, Math.atan2(p.x - prev.x, p.z - prev.z), 0);
      const finish = i === cps.length - 1;
      gate.material.color.set(finish ? '#ffd24a' : ACTIVITY_COLORS.run);
      gate.material.opacity = k === 0 ? 0.95 : 0.3;
      gate.visible = true;
    });
    const cur = cps[this.run.next];
    this.gateBeam.position.set(cur.x, this.#groundY(cur.x, cur.z), cur.z);
    this.gateBeam.material.color.set(this.run.next === cps.length - 1 ? '#ffd24a' : ACTIVITY_COLORS.run);
    this.gateBeam.visible = true;
  }

  #finishRun() {
    const r = this.run.route;
    const t = this.run.time;
    const before = this.starsOf('run', r);
    const better = this.#record(r.id, t, true);
    this.#reward('run', r, before);
    const stars = starsFor(t, r.medals, true);
    const medal = ['Ziel', 'Bronze', 'Silber', 'Gold'][stars];
    this.game.hud.message(`${medal} · ${formatTime(t)}`, 3, stars >= 3 ? 'go' : 'info');
    this.game.audio.chime();
    this.#toastResult(`${r.name}: ${formatTime(t)} ${starText(stars)}${better ? ' · Neue Bestzeit' : ''}`);
    const marker = this.runMarkers.find((m) => m.route === r);
    this.#setLabel(marker.label, r.name, this.#runSub(r), ACTIVITY_COLORS.run);
    this.rearm = r.id;
    this.run = null;
    this.#showRunMarkers(true);
  }

  #toastResult(text) {
    const el = this.el('result-toast');
    el.textContent = text;
    el.hidden = false;
    this.resultTimer = 4;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, v, q) {
    if (!this.enabled) return;
    this.time += dt;
    const pulse = 0.55 + 0.35 * Math.sin(this.time * 3);
    for (const m of this.runMarkers) m.ring.material.opacity = pulse;
    for (const led of this.trapLeds) led.visible = Math.sin(this.time * 6) > 0;
    for (const g of this.gates) g.rotation.z += dt * 0.4;
    // Light beams fade out close to the camera so they never wash over the screen.
    const cam = this.game.camera.position;
    for (const b of this.beams) {
      const d = Math.hypot(b.position.x - cam.x, b.position.z - cam.z);
      b.material.opacity = b.userData.baseOpacity * clamp((d - 8) / 40, 0, 1);
    }
    if (this.resultTimer > 0) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) this.el('result-toast').hidden = true;
    }

    if (this.run) this.#updateRun(dt, v);
    else {
      this.#checkRunStart(v);
      this.#updateZone(v, q);
      this.#updateSpeedZone(dt, v);
    }
    if (!this.holding) {
      this.#updateTraps(v);
      this.#updateJump(dt, v);
      this.#updateBoards(v);
    }
    this.#updateDebris(dt);
    this.#updateDiscovery(dt, v);
    this.#updateHud(v);
  }

  // ------------------------------------------------------------------ discoveries
  #updateDiscovery(dt, v) {
    this.discoverTimer -= dt;
    this.saveTimer -= dt;
    if (this.discoverTimer > 0) return;
    this.discoverTimer = 0.25;
    const added = this.discovery.visit(v.x, v.z, 32);
    if (added) {
      this.roadXp += added * XP.road;
      const tenth = Math.floor(this.discovery.fraction * 10);
      if (tenth > this.roadMilestone) {
        this.roadMilestone = tenth;
        this.career.award(this.roadXp + 500, `Straßen entdeckt: ${tenth * 10} %`);
        this.roadXp = 0;
      }
    }
    if (this.saveTimer <= 0) {
      this.saveTimer = 4;
      if (this.roadXp >= 250) {
        this.career.award(this.roadXp, 'Neue Straßen entdeckt');
        this.roadXp = 0;
      }
      const roads = this.discovery.save();
      if (roads !== this.career.roads) {
        this.career.roads = roads;
        this.career.save();
      }
    }
    // Landmarks
    for (const m of this.data.landmarks) {
      if (this.career.found.has(m.id)) continue;
      if (Math.hypot(v.x - m.x, v.z - m.z) > m.radius) continue;
      this.career.discover(m.id);
      this.game.hud.banner('Neuer Ort entdeckt', m.name, `+${fmt(XP.landmark)} XP · Schnellreise freigeschaltet`);
      this.game.audio.chime();
      this.career.award(XP.landmark, m.name);
    }
    // Activities become fast-travel targets once you have been close.
    for (const it of this.#activityList()) {
      if (this.career.found.has(it.id)) continue;
      if (Math.hypot(v.x - it.x, v.z - it.z) > 140) continue;
      this.career.discover(it.id);
      this.game.hud.feed(`Neu auf der Karte: ${it.name}`);
    }
  }

  // ------------------------------------------------------------------ bonus boards
  #updateBoards(v) {
    if (v.speed < 4) return;
    for (const m of this.boardMarkers) {
      if (!m.group.visible) continue;
      const b = m.board;
      if (Math.abs(v.x - b.x) > 4 || Math.abs(v.z - b.z) > 4) continue;
      if (Math.hypot(v.x - b.x, v.z - b.z) > 3.4 || Math.abs(v.y - b.y) > 3) continue;
      m.group.visible = false;
      this.career.smash(b.id);
      this.#shatter(m, v);
      this.game.audio.crash(6);
      this.game.onBoardSmashed(b);
    }
  }

  // Board splinters fly off in the direction of travel and settle on the ground.
  #shatter(m, v) {
    const P = this.boardParts;
    const b = m.board;
    const pieces = [
      [new THREE.PlaneGeometry(1.6, 2), P.faceMat, -0.8],
      [new THREE.PlaneGeometry(1.6, 2), P.faceMat, 0.8],
      [P.post, P.postMat, -1.35],
      [P.post, P.postMat, 1.35],
    ];
    const cs = Math.cos(b.yaw);
    const sn = Math.sin(b.yaw);
    if (!P.debrisMat) {
      P.debrisMat = P.faceMat.clone();
      P.debrisMat.side = THREE.DoubleSide;
    }
    for (const [geo, mat, off] of pieces) {
      const face = mat === P.faceMat;
      const mesh = new THREE.Mesh(geo, face ? P.debrisMat : mat);
      const x = b.x + cs * off;
      const z = b.z - sn * off;
      mesh.position.set(x, b.y + (face ? 2.6 : 0), z);
      mesh.rotation.set(0, b.yaw, 0);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.debris.push({
        mesh,
        vx: v.vx * (0.7 + Math.random() * 0.4) + (Math.random() - 0.5) * 6,
        vz: v.vz * (0.7 + Math.random() * 0.4) + (Math.random() - 0.5) * 6,
        vy: 5 + Math.random() * 6,
        spin: [(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12],
        life: 4,
      });
    }
  }

  #updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      const m = d.mesh;
      const ground = this.#groundY(m.position.x, m.position.z) + 0.1;
      if (m.position.y > ground || d.vy > 0) {
        d.vy -= 9.81 * dt;
        m.position.x += d.vx * dt;
        m.position.y += d.vy * dt;
        m.position.z += d.vz * dt;
        m.rotation.x += d.spin[0] * dt;
        m.rotation.y += d.spin[1] * dt;
        m.rotation.z += d.spin[2] * dt;
        if (m.position.y < ground) {
          m.position.y = ground;
          d.vy = -d.vy * 0.25;
          d.vx *= 0.5;
          d.vz *= 0.5;
          if (Math.abs(d.vy) < 1) d.vy = 0;
        }
      }
      if (d.life <= 0) {
        this.group.remove(m);
        if (m.geometry !== this.boardParts.post) m.geometry.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ speed zones
  #updateSpeedZone(dt, v) {
    const sz = this.speedZone;
    if (sz) {
      const z = sz.zone;
      const road = z.road;
      const q = road.nearest(v.x, v.z, -1, this.q, 2);
      sz.time += dt;
      const into = road.closed ? road.wrapS(q.s - z.s0) : q.s - z.s0;
      if (q.index < 0 || q.dist > 30 || (into > road.length / 2 && road.closed) || into < -25 || sz.time > 60) {
        this.speedZone = null;
        this.game.hud.message('Tempozone verlassen', 1.2, 'warn');
        return;
      }
      sz.avg = (Math.max(0, into) / Math.max(0.1, sz.time)) * 3.6;
      if (into >= z.length) {
        this.speedZone = null;
        const avg = Math.round((z.length / sz.time) * 3.6);
        const stars = starsFor(avg, z.goals);
        const before = this.starsOf('zone', z);
        const better = this.#record(z.id, avg, false);
        this.#reward('zone', z, before);
        this.game.hud.message(`Ø ${avg} km/h`, 2, stars >= 3 ? 'go' : 'info');
        this.#toastResult(`${z.name}: Ø ${avg} km/h ${starText(stars)}${better ? ' · Rekord' : ''}`);
        if (stars > 0) this.game.audio.chime();
      }
      return;
    }
    if (this.zone) return;
    for (const g of this.zoneGates) {
      const z = g.zone;
      if (Math.abs(v.x - z.x) > 16 || Math.abs(v.z - z.z) > 16) continue;
      const q = z.road.nearest(v.x, v.z, -1, this.q, 2);
      if (q.index < 0 || q.dist > 12) continue;
      const into = z.road.closed ? z.road.wrapS(q.s - z.s0) : q.s - z.s0;
      const forward = Math.sin(v.yaw) * q.tx + Math.cos(v.yaw) * q.tz > 0.5;
      if (into >= 0 && into < 8 && forward && v.speed > 5) {
        this.speedZone = { zone: z, time: 0, avg: 0 };
        this.game.hud.message('Tempozone', 1, 'info');
        return;
      }
    }
  }

  #checkRunStart(v) {
    let nearest = null;
    for (const m of this.runMarkers) {
      const d = Math.hypot(v.x - m.route.start.x, v.z - m.route.start.z);
      // A run that just ended (loops end at their start) re-arms once the car has left the ring.
      if (this.rearm === m.route.id) {
        if (d > 30) this.rearm = null;
        else continue;
      }
      if (!nearest || d < nearest.d) nearest = { d, r: m.route };
    }
    const prompt = this.el('prompt');
    if (nearest && nearest.d < 60 && !this.zone) {
      prompt.hidden = false;
      prompt.textContent = nearest.d < 8 ? (v.speed < 9 ? `${nearest.r.name} startet …` : 'Langsamer: im Ring anhalten') : `Checkpoint-Lauf „${nearest.r.name}“ · im Ring anhalten`;
      if (nearest.d < 7 && v.speed < 9) {
        prompt.hidden = true;
        this.#startRun(nearest.r);
      }
    } else prompt.hidden = true;
  }

  #updateRun(dt, v) {
    const run = this.run;
    const g = this.game;
    const cps = run.route.checkpoints;
    if (run.countdown > 0) {
      run.countdown -= dt;
      const n = Math.ceil(run.countdown);
      if (n !== run.lastBeep && n >= 1 && n <= 3) {
        run.lastBeep = n;
        g.audio.beep(false);
        g.hud.message(String(n), 0.7);
      }
      if (run.countdown <= 0) {
        this.holding = false;
        g.audio.beep(true);
        g.hud.message('Los!', 0.9, 'go');
      }
      return;
    }
    run.time += dt;
    const cp = cps[run.next];
    const d = Math.hypot(v.x - cp.x, v.z - cp.z);
    if (d < 11) {
      run.next++;
      if (run.next >= cps.length) {
        this.#finishRun();
        return;
      }
      g.audio.click();
      g.audio.beep(false);
      this.#placeGates();
    } else if (d > 700) this.cancelRun();
  }

  #updateZone(v, q) {
    const tr = this.track;
    if (!q || q.index < 0) {
      if (this.zone) this.#endZone(false);
      return;
    }
    const drift = this.game.drift;
    const total = drift.total + drift.points;
    if (this.zone) {
      const z = this.zone.zone;
      const into = tr.wrapS(q.s - z.s0);
      if (Math.abs(q.lateral) > 25 || into > z.length + 40) {
        this.#endZone(into >= z.length && into < z.length + 200);
        return;
      }
      this.zone.score = Math.max(0, total - this.zone.base);
      return;
    }
    const forward = Math.sin(v.yaw) * q.tx + Math.cos(v.yaw) * q.tz > 0.3;
    for (const z of this.data.driftZones) {
      const into = tr.wrapS(q.s - z.s0);
      if (into < 25 && forward && Math.abs(q.lateral) < 15 && v.speed > 5) {
        this.zone = { zone: z, base: total, score: 0 };
        this.game.hud.message('Drift-Zone', 1.2, 'info');
        return;
      }
    }
  }

  #endZone(completed) {
    const z = this.zone.zone;
    const score = Math.round(this.zone.score);
    this.zone = null;
    if (!completed) {
      this.game.hud.message('Drift-Zone verlassen', 1.2, 'warn');
      return;
    }
    const stars = starsFor(score, z.goals);
    const before = this.starsOf('drift', z);
    const better = this.#record(z.id, score, false);
    this.#reward('drift', z, before);
    this.game.hud.message(`${score.toLocaleString('de-DE')} Punkte`, 2.4, stars >= 3 ? 'go' : 'info');
    this.#toastResult(`${z.name}: ${score.toLocaleString('de-DE')} Punkte ${starText(stars)}${better && score > 0 ? ' · Rekord' : ''}`);
    if (stars > 0) this.game.audio.chime();
  }

  #updateTraps(v) {
    for (const m of this.trapMarkers) {
      const t = m.trap;
      const cool = this.trapCooldown.get(t.id) || 0;
      if (this.time < cool) continue;
      if (Math.hypot(v.x - t.x, v.z - t.z) > 13 || v.speed < 8) continue;
      this.trapCooldown.set(t.id, this.time + 6);
      const kmh = Math.round(v.speed * 3.6);
      const stars = starsFor(kmh, t.goals);
      const before = this.starsOf('trap', t);
      const better = this.#record(t.id, kmh, false);
      this.#reward('trap', t, before);
      this.#flash();
      this.game.hud.message(`${kmh} km/h`, 1.8, stars >= 3 ? 'go' : 'info');
      this.#toastResult(`${t.name}: ${kmh} km/h ${starText(stars)}${better ? ' · Rekord' : ''}`);
      this.#setLabel(m.label, t.name, this.#trapSub(t), ACTIVITY_COLORS.trap);
    }
  }

  #flash() {
    const el = this.el('flash');
    el.hidden = false;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => (el.hidden = true), 450);
    this.game.audio.shutter();
  }

  #updateJump(dt, v) {
    const grounded = v.onGround;
    if (this.wasGround && !grounded && !this.jump) {
      for (const r of this.data.ramps) {
        const dx = v.x - r.x;
        const dz = v.z - r.z;
        const along = dx * Math.sin(r.yaw) + dz * Math.cos(r.yaw);
        const side = dx * Math.cos(r.yaw) - dz * Math.sin(r.yaw);
        if (along > r.length * 0.55 && along < r.length + 6 && Math.abs(side) < r.width / 2 + 1.5) {
          this.jump = { ramp: r, x: v.x, z: v.z, t: 0 };
          break;
        }
      }
    }
    if (this.jump) {
      this.jump.t += dt;
      if (grounded) {
        const j = this.jump;
        this.jump = null;
        const dist = Math.hypot(v.x - j.x, v.z - j.z);
        if (j.t > 0.35 && dist > 6) {
          const r = j.ramp;
          const stars = starsFor(dist, r.goals);
          const before = this.starsOf('jump', r);
          const better = this.#record(r.id, Math.round(dist * 10) / 10, false);
          this.#reward('jump', r, before);
          this.game.hud.message(`${dist.toFixed(1).replace('.', ',')} m`, 2, stars >= 3 ? 'go' : 'info');
          this.#toastResult(`${r.name}: ${dist.toFixed(1).replace('.', ',')} m ${starText(stars)}${better ? ' · Rekord' : ''}`);
          const marker = this.rampMarkers.find((m) => m.ramp === r);
          this.#setLabel(marker.label, r.name, this.#jumpSub(r), ACTIVITY_COLORS.jump);
          if (stars > 0) this.game.audio.chime();
        }
      } else if (this.jump.t > 6) this.jump = null;
    }
    this.wasGround = grounded;
  }

  // ------------------------------------------------------------------ HUD
  #hud(info) {
    const box = this.el('activity');
    if (!info) {
      box.hidden = true;
      this.el('nav').hidden = true;
      return;
    }
    box.hidden = false;
    box.style.setProperty('--act', info.color);
    this.el('act-kind').textContent = info.kind;
    this.el('act-title').textContent = info.title;
    this.el('act-value').textContent = info.value;
    this.el('act-sub').textContent = info.sub;
  }

  #updateHud(v) {
    const nav = this.el('nav');
    if (this.run) {
      const r = this.run.route;
      const cps = r.checkpoints;
      const cp = cps[Math.min(this.run.next, cps.length - 1)];
      const bestT = this.best(r.id);
      this.#hud({
        kind: 'Checkpoint-Lauf',
        title: r.name,
        value: formatTime(this.run.time),
        sub: `Tor ${Math.min(this.run.next + 1, cps.length)}/${cps.length} · Gold ${formatTime(r.medals[0])}${bestT !== undefined ? ` · Beste ${formatTime(bestT)}` : ''}`,
        color: ACTIVITY_COLORS.run,
      });
      const bearing = Math.atan2(cp.x - v.x, cp.z - v.z);
      const rel = wrapAngle(bearing - v.yaw);
      nav.hidden = false;
      // Screen rotation: 0 = straight ahead (up), positive = to the right.
      this.el('nav-arrow').style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      this.el('nav-dist').textContent = `${Math.round(Math.hypot(cp.x - v.x, cp.z - v.z))} m`;
      return;
    }
    nav.hidden = true;
    if (this.speedZone) {
      const z = this.speedZone.zone;
      const avg = Math.round(this.speedZone.avg);
      const next = z.goals.find((g) => g > avg);
      this.#hud({
        kind: 'Tempozone',
        title: z.name,
        value: `Ø ${avg} km/h`,
        sub: next ? `Nächster Stern ab Ø ${next} km/h` : 'Alle Sterne in Reichweite',
        color: ACTIVITY_COLORS.zone,
      });
      return;
    }
    if (this.zone) {
      const z = this.zone.zone;
      const s = Math.round(this.zone.score);
      const next = z.goals.find((g) => g > s);
      this.#hud({
        kind: 'Drift-Zone',
        title: z.name,
        value: s.toLocaleString('de-DE'),
        sub: next ? `Nächster Stern bei ${next.toLocaleString('de-DE')}` : 'Alle Sterne erreicht',
        color: ACTIVITY_COLORS.drift,
      });
      return;
    }
    this.#hud(null);
  }

  // ------------------------------------------------------------------ map data
  // Every activity with its map position: runs at their start, zones at their entry.
  #activityList() {
    const d = this.data;
    const list = [];
    for (const r of d.routes) list.push({ kind: 'run', id: r.id, name: r.name, x: r.start.x, z: r.start.z, item: r });
    for (const z of d.driftZones) {
      const p = this.track.pointAt(z.s0, 0, {});
      list.push({ kind: 'drift', id: z.id, name: z.name, x: p.x, z: p.z, item: z, heading: p.heading });
    }
    for (const t of d.speedTraps) list.push({ kind: 'trap', id: t.id, name: t.name, x: t.x, z: t.z, item: t, heading: t.heading });
    for (const r of d.ramps) list.push({ kind: 'jump', id: r.id, name: r.name, x: r.x, z: r.z, item: r });
    for (const z of d.speedZones) {
      const p = z.road ? z.road.pointAt(z.s0, 0, {}) : { heading: 0 };
      list.push({ kind: 'zone', id: z.id, name: z.name, x: z.x, z: z.z, item: z, heading: p.heading });
    }
    return list;
  }

  // Place to put the car for a fast travel to an activity: just before it, facing it.
  #travelPose(a) {
    if (a.kind === 'run') {
      const r = a.item;
      const cp = r.checkpoints[0];
      const h = Math.atan2(cp.x - r.start.x, cp.z - r.start.z);
      return { x: r.start.x - Math.sin(h) * 28, z: r.start.z - Math.cos(h) * 28, heading: h };
    }
    if (a.kind === 'jump') {
      const r = a.item;
      return { x: r.x - Math.sin(r.yaw) * 90, z: r.z - Math.cos(r.yaw) * 90, heading: r.yaw };
    }
    if (a.heading !== undefined) return { x: a.x - Math.sin(a.heading) * 160, z: a.z - Math.cos(a.heading) * 160, heading: a.heading, onRoad: true };
    return null;
  }

  #stats(kind, item) {
    const b = this.best(item.id);
    const none = '–';
    switch (kind) {
      case 'run':
        return [
          ['Bestzeit', b === undefined ? none : formatTime(b)],
          ['Gold · Silber · Bronze', item.medals.map((m) => formatTime(m).replace(/\.\d+$/, '')).join(' · ')],
          ['Strecke', km(item.length)],
          ['Tore', String(item.checkpoints.length)],
        ];
      case 'drift':
        return [
          ['Rekord', b === undefined ? none : `${fmt(b)} Punkte`],
          ['Sterne ab', item.goals.map(fmt).join(' · ')],
          ['Länge', km(item.length)],
        ];
      case 'trap':
        return [
          ['Rekord', b === undefined ? none : `${b} km/h`],
          ['Sterne ab', item.goals.map((g) => `${g}`).join(' · ') + ' km/h'],
        ];
      case 'jump':
        return [
          ['Rekord', b === undefined ? none : `${String(b).replace('.', ',')} m`],
          ['Sterne ab', item.goals.join(' · ') + ' m'],
        ];
      case 'zone':
        return [
          ['Rekord', b === undefined ? none : `Ø ${b} km/h`],
          ['Sterne ab', `Ø ${item.goals.join(' · ')} km/h`],
          ['Länge', `${item.length} m`],
        ];
      default:
        return [];
    }
  }

  // Items for the world map (activities, places, the festival and bonus boards).
  mapItems() {
    const out = [];
    const blurbs = {
      drift: 'Driften zwischen Start- und Ziel-Banner, die Punkte zählen',
      trap: 'So schnell wie möglich am Blitzer vorbei',
      jump: 'Mit Tempo auf die Schanze, gemessen wird die Weite',
      zone: 'Durchschnittstempo zwischen den beiden gelben Toren',
    };
    for (const a of this.#activityList()) {
      const stars = this.starsOf(a.kind, a.item);
      out.push({
        kind: a.kind,
        id: a.id,
        name: a.name,
        label: LABELS[a.kind],
        blurb: a.item.blurb || blurbs[a.kind] || '',
        x: a.x,
        z: a.z,
        color: ACTIVITY_COLORS[a.kind],
        stars,
        done: stars >= 3,
        stats: this.#stats(a.kind, a.item),
        travel: this.#travelPose(a),
      });
    }
    const F = this.data.festival;
    for (const m of this.data.landmarks) {
      const found = this.career.found.has(m.id);
      const festival = m.id === 'lm-festival';
      out.push({
        kind: festival ? 'festival' : 'landmark',
        id: m.id,
        name: m.name,
        label: festival ? 'Festival' : found ? 'Sehenswürdigkeit' : 'Unentdeckter Ort',
        blurb: m.blurb,
        x: m.x,
        z: m.z,
        color: festival ? ICON_COLORS.festival : ICON_COLORS.landmark,
        locked: !found && !festival,
        stats: festival
          ? [
              ['Fahrerstufe', String(this.career.level)],
              ['Sterne', `${this.totals().stars}/${this.totals().max}`],
            ]
          : [
              ['Status', found ? 'Entdeckt' : 'Noch nicht entdeckt'],
              ['Belohnung', `${fmt(XP.landmark)} XP`],
            ],
        travel: festival ? { ...F.spawn } : null,
      });
    }
    for (const m of this.boardMarkers) {
      if (!m.group.visible) continue;
      const b = m.board;
      out.push({ kind: 'board', id: b.id, name: 'Bonusschild', label: 'Sammelobjekt', blurb: 'Durchfahren und zerstören', x: b.x, z: b.z, color: ICON_COLORS.board, stats: [['Belohnung', `${fmt(XP.board)} XP`]] });
    }
    return out;
  }

  // Icons for the minimap: the active run gate, or nearby activities, places and the festival.
  markers() {
    const out = [];
    if (this.run) {
      const cps = this.run.route.checkpoints;
      const cp = cps[Math.min(this.run.next, cps.length - 1)];
      out.push({ kind: 'run', x: cp.x, z: cp.z, color: ACTIVITY_COLORS.run, target: true });
      return out;
    }
    for (const a of this.#activityList()) {
      const stars = this.starsOf(a.kind, a.item);
      out.push({ kind: a.kind, x: a.x, z: a.z, color: ACTIVITY_COLORS[a.kind], stars, done: stars >= 3 });
    }
    for (const m of this.data.landmarks) {
      const festival = m.id === 'lm-festival';
      if (!festival && !this.career.found.has(m.id)) continue;
      out.push({ kind: festival ? 'festival' : 'landmark', x: m.x, z: m.z, color: festival ? ICON_COLORS.festival : ICON_COLORS.landmark });
    }
    return out;
  }
}
