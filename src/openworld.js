// Open-world layer for free roam: checkpoint runs, drift zones, speed traps and jump ramps,
// their world markers, HUD and saved progress.
import * as THREE from 'three';
import { starsFor, rampSurface } from './activities.js';
import { ROAD } from './config.js';
import { clamp, formatTime, wrapAngle } from './util.js';
import * as TX from './textures.js';

const PROGRESS_KEY = 'nordkamm.progress.v1';
export const ACTIVITY_COLORS = { run: '#3fd0ff', drift: '#ff4fd8', trap: '#f2a541', jump: '#7dff7a' };
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
    const count = d.routes.length + d.driftZones.length + d.speedTraps.length + d.ramps.length;
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
    const better = this.#record(r.id, t, true);
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
    }
    if (!this.holding) {
      this.#updateTraps(v);
      this.#updateJump(dt, v);
    }
    this.#updateHud(v);
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
      prompt.textContent = nearest.d < 8 ? `${nearest.r.name} startet …` : `Checkpoint-Lauf „${nearest.r.name}“ · in den Ring fahren`;
      if (nearest.d < 7 && v.speed < 45) {
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
    const better = this.#record(z.id, score, false);
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
      const better = this.#record(t.id, kmh, false);
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
          const better = this.#record(r.id, Math.round(dist * 10) / 10, false);
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

  // ------------------------------------------------------------------ map markers
  markers() {
    const out = [];
    const d = this.data;
    if (this.run) {
      const cps = this.run.route.checkpoints;
      const cp = cps[Math.min(this.run.next, cps.length - 1)];
      out.push({ x: cp.x, z: cp.z, color: ACTIVITY_COLORS.run, glyph: '◎', target: true });
      return out;
    }
    for (const r of d.routes) out.push({ x: r.start.x, z: r.start.z, color: ACTIVITY_COLORS.run, glyph: 'C', name: r.name, stars: this.starsOf('run', r) });
    for (const z of d.driftZones) {
      const p = this.track.pointAt(z.s0, 0, {});
      out.push({ x: p.x, z: p.z, color: ACTIVITY_COLORS.drift, glyph: 'D', name: z.name, stars: this.starsOf('drift', z) });
    }
    for (const t of d.speedTraps) out.push({ x: t.x, z: t.z, color: ACTIVITY_COLORS.trap, glyph: 'B', name: t.name, stars: this.starsOf('trap', t) });
    for (const r of d.ramps) out.push({ x: r.x, z: r.z, color: ACTIVITY_COLORS.jump, glyph: 'S', name: r.name, stars: this.starsOf('jump', r) });
    return out;
  }
}
