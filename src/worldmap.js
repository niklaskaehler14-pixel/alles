// Full-screen world map in the style of open-world racing games: pan and zoom (mouse, wheel, touch,
// keyboard, gamepad), region names, activity and landmark icons with filters, an info card with
// route and fast travel, the GPS route and the progress of the career.
import { WORLD } from './config.js';
import { drawRoads, drawRoute, drawIcon, drawPlayer, drawPin, ICON_COLORS } from './maprender.js';
import { REGIONS, regionAt } from './navigation.js';
import { clamp } from './util.js';

const FILTERS = [
  { id: 'run', label: 'Läufe', kinds: ['run'] },
  { id: 'pr', label: 'PR-Stunts', kinds: ['drift', 'trap', 'jump', 'zone'] },
  { id: 'place', label: 'Orte', kinds: ['landmark', 'festival'] },
  { id: 'board', label: 'Bonusschilder', kinds: ['board'] },
];
const MAX_PPM = 3;

export class WorldMap {
  constructor(game, raster, polylines) {
    this.game = game;
    this.raster = raster;
    this.lines = polylines;
    this.root = document.getElementById('worldmap');
    this.canvas = document.getElementById('wm-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.view = { x: 0, z: 0, ppm: 0.3 };
    this.filters = new Set(FILTERS.map((f) => f.id));
    this.selected = null;
    this.hover = null;
    this.cursor = null; // free spot picked on the map: { x, z }
    this.dirty = true;
    this.pointers = new Map();
    this.drag = null;
    this.items = [];
    this.$ = (id) => document.getElementById(id);
    this.#buildFilters();
    this.#bind();
  }

  get isOpen() {
    return !this.root.hidden;
  }

  show() {
    const v = this.game.vehicle;
    const wasOpen = this.isOpen;
    this.root.hidden = false;
    this.#resize();
    this.view.x = v.x;
    this.view.z = v.z;
    this.view.ppm = clamp(Math.min(this.w, this.h) / 1500, this.minPpm, MAX_PPM);
    this.selected = null;
    this.cursor = null;
    this.#card(null);
    this.#refreshStats();
    this.items = this.#collect();
    this.dirty = true;
    if (!wasOpen && !this.looping) this.#loop();
  }

  hide() {
    this.root.hidden = true;
    this.pointers.clear();
    this.drag = null;
  }

  // ------------------------------------------------------------------ data
  #collect() {
    const ow = this.game.openWorld;
    return ow ? ow.mapItems() : [];
  }

  #visibleItems() {
    const kinds = new Set();
    for (const f of FILTERS) if (this.filters.has(f.id)) for (const k of f.kinds) kinds.add(k);
    return this.items.filter((it) => kinds.has(it.kind));
  }

  #refreshStats() {
    const ow = this.game.openWorld;
    const c = this.game.career;
    const t = ow.totals();
    this.$('wm-stars').textContent = `${t.stars}/${t.max}`;
    this.$('wm-roads').textContent = `${Math.round(ow.discovery.fraction * 100)} %`;
    const marks = this.game.data.landmarks;
    this.$('wm-places').textContent = `${marks.filter((m) => c.found.has(m.id)).length}/${marks.length}`;
    this.$('wm-boards').textContent = `${c.boards.size}/${this.game.data.bonusBoards.length}`;
    const lp = c.levelProgress();
    this.$('wm-level').textContent = String(lp.level);
    this.$('wm-xp').style.width = `${Math.round(lp.fraction * 100)}%`;
  }

  // ------------------------------------------------------------------ UI
  #buildFilters() {
    const box = this.$('wm-filters');
    box.textContent = '';
    for (const f of FILTERS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.filter = f.id;
      b.setAttribute('aria-pressed', 'true');
      const dot = document.createElement('i');
      dot.style.background = ICON_COLORS[f.kinds[0] === 'landmark' ? 'festival' : f.kinds[0]];
      b.append(dot, document.createTextNode(f.label));
      b.addEventListener('click', () => {
        if (this.filters.has(f.id)) this.filters.delete(f.id);
        else this.filters.add(f.id);
        b.setAttribute('aria-pressed', String(this.filters.has(f.id)));
        if (this.selected && !this.#visibleItems().includes(this.selected)) this.#card(null);
        this.dirty = true;
      });
      box.appendChild(b);
    }
  }

  #card(item) {
    this.selected = item && !item.spot ? item : null;
    const card = this.$('wm-card');
    if (!item) {
      card.hidden = true;
      this.cursor = null;
      this.dirty = true;
      return;
    }
    card.hidden = false;
    card.style.setProperty('--kind', item.color || ICON_COLORS.waypoint);
    this.$('wm-card-kind').textContent = item.label;
    this.$('wm-card-title').textContent = item.name;
    this.$('wm-card-blurb').textContent = item.blurb || '';
    const stats = this.$('wm-card-stats');
    stats.textContent = '';
    for (const [k, v] of item.stats || []) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      stats.append(dt, dd);
    }
    const travel = this.$('wm-travel');
    const allowed = this.game.canFastTravel(item);
    travel.disabled = !allowed.ok;
    this.$('wm-card-note').textContent = allowed.ok ? '' : allowed.reason;
    const gps = this.game.gps;
    const routed = gps.active && Math.hypot(gps.target.x - item.x, gps.target.z - item.z) < 1;
    this.$('wm-route').textContent = routed ? 'Route löschen' : 'Route setzen';
    this.dirty = true;
  }

  #routeToSelection() {
    const item = this.selected || (this.cursor && { ...this.cursor, name: 'Wegpunkt' });
    if (!item) return;
    const gps = this.game.gps;
    if (gps.active && Math.hypot(gps.target.x - item.x, gps.target.z - item.z) < 1) {
      gps.clear();
      this.#card(this.selected || null);
      this.dirty = true;
      return;
    }
    gps.set(item.x, item.z, item.name);
    this.game.closeMap();
    this.game.hud.message('Route gesetzt', 1.2, 'info');
  }

  #travelToSelection() {
    const item = this.selected || (this.cursor && { ...this.cursor, name: regionAt(this.cursor.x, this.cursor.z), spot: true });
    if (!item || !this.game.canFastTravel(item).ok) return;
    this.game.fastTravel(item);
  }

  // ------------------------------------------------------------------ geometry
  #resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    // Zoomed all the way out, the whole world just fits the screen.
    this.minPpm = Math.min(this.w, this.h) / (WORLD.size * 1.05);
    this.view.ppm = Math.max(this.view.ppm, this.minPpm);
    this.dirty = true;
  }

  toScreen(x, z) {
    return [this.w / 2 + (x - this.view.x) * this.view.ppm, this.h / 2 + (z - this.view.z) * this.view.ppm];
  }

  toWorld(sx, sy) {
    return [this.view.x + (sx - this.w / 2) / this.view.ppm, this.view.z + (sy - this.h / 2) / this.view.ppm];
  }

  #clampView() {
    const lim = WORLD.half;
    this.view.x = clamp(this.view.x, -lim, lim);
    this.view.z = clamp(this.view.z, -lim, lim);
  }

  zoomAt(sx, sy, factor) {
    const [wx, wz] = this.toWorld(sx, sy);
    this.view.ppm = clamp(this.view.ppm * factor, this.minPpm, MAX_PPM);
    // Keep the point under the cursor fixed.
    this.view.x = wx - (sx - this.w / 2) / this.view.ppm;
    this.view.z = wz - (sy - this.h / 2) / this.view.ppm;
    this.#clampView();
    this.dirty = true;
  }

  pan(dx, dy) {
    this.view.x -= dx / this.view.ppm;
    this.view.z -= dy / this.view.ppm;
    this.#clampView();
    this.dirty = true;
  }

  #hit(sx, sy) {
    let best = null;
    let bd = Infinity;
    for (const it of this.#visibleItems()) {
      const [x, y] = this.toScreen(it.x, it.z);
      const d = Math.hypot(x - sx, y - sy);
      const r = it.kind === 'board' ? 14 : 20;
      if (d < r && d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  #click(sx, sy) {
    const it = this.#hit(sx, sy);
    if (it) {
      this.cursor = null;
      this.#card(it);
      return;
    }
    // Empty spot: offer a waypoint there.
    const [x, z] = this.toWorld(sx, sy);
    this.cursor = { x, z };
    this.#card({ spot: true, x, z, name: regionAt(x, z), label: 'Wegpunkt', blurb: 'Freie Stelle auf der Karte', color: ICON_COLORS.waypoint, stats: [] });
  }

  // ------------------------------------------------------------------ input
  #bind() {
    const cv = this.canvas;
    // Positions relative to the canvas from client coordinates (offsetX is unreliable for touch).
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    window.addEventListener('resize', () => {
      if (this.isOpen) this.#resize();
    });
    cv.addEventListener('pointerdown', (e) => {
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic or already released pointer */
      }
      const q = at(e);
      this.pointers.set(e.pointerId, q);
      if (this.pointers.size === 1) this.drag = { x: q.x, y: q.y, moved: 0 };
      else this.drag = { pinch: this.#pinchState(), moved: 99 };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      const q = at(e);
      if (!p) {
        // Mouse hover
        const it = this.#hit(q.x, q.y);
        if (it !== this.hover) {
          this.hover = it;
          cv.style.cursor = it ? 'pointer' : 'grab';
          this.dirty = true;
        }
        return;
      }
      p.x = q.x;
      p.y = q.y;
      if (!this.drag) return;
      if (this.drag.pinch && this.pointers.size >= 2) {
        const now = this.#pinchState();
        if (this.drag.pinch.d > 0) this.zoomAt(now.x, now.y, now.d / this.drag.pinch.d);
        this.pan(now.x - this.drag.pinch.x, now.y - this.drag.pinch.y);
        this.drag.pinch = now;
        return;
      }
      const dx = q.x - this.drag.x;
      const dy = q.y - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.drag.x = q.x;
      this.drag.y = q.y;
      if (this.drag.moved > 4) {
        cv.style.cursor = 'grabbing';
        this.pan(dx, dy);
      }
    });
    const end = (e) => {
      const wasTap = this.drag && !this.drag.pinch && this.drag.moved <= 6 && this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      const q = at(e);
      if (wasTap && e.type === 'pointerup' && e.button !== 2) this.#click(q.x, q.y);
      if (this.pointers.size === 0) this.drag = null;
      else if (this.pointers.size === 1) {
        const [q] = this.pointers.values();
        this.drag = { x: q.x, y: q.y, moved: 99 };
      }
      cv.style.cursor = 'grab';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.game.gps.active) {
        this.game.gps.clear();
        this.game.hud.message('Route gelöscht', 1, 'info');
        this.dirty = true;
      }
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const q = at(e);
        this.zoomAt(q.x, q.y, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const step = 90;
      const k = e.code;
      if (k === 'ArrowLeft' || k === 'KeyA') this.pan(step, 0);
      else if (k === 'ArrowRight' || k === 'KeyD') this.pan(-step, 0);
      else if (k === 'ArrowUp' || k === 'KeyW') this.pan(0, step);
      else if (k === 'ArrowDown' || k === 'KeyS') this.pan(0, -step);
      else if (k === 'Equal' || k === 'NumpadAdd' || k === 'KeyE') this.zoomAt(this.w / 2, this.h / 2, 1.3);
      else if (k === 'Minus' || k === 'NumpadSubtract' || k === 'KeyQ') this.zoomAt(this.w / 2, this.h / 2, 1 / 1.3);
      else if (k === 'Enter') this.#routeToSelection();
      else if (k === 'KeyF') this.#travelToSelection();
      else if (k === 'Delete' || k === 'Backspace') {
        this.game.gps.clear();
        this.dirty = true;
      } else return;
      e.preventDefault();
    });
    this.$('wm-zoom-in').addEventListener('click', () => this.zoomAt(this.w / 2, this.h / 2, 1.4));
    this.$('wm-zoom-out').addEventListener('click', () => this.zoomAt(this.w / 2, this.h / 2, 1 / 1.4));
    this.$('wm-center').addEventListener('click', () => {
      this.view.x = this.game.vehicle.x;
      this.view.z = this.game.vehicle.z;
      this.dirty = true;
    });
    this.$('wm-close').addEventListener('click', () => this.game.closeMap());
    this.$('wm-route').addEventListener('click', () => this.#routeToSelection());
    this.$('wm-travel').addEventListener('click', () => this.#travelToSelection());
    this.$('wm-card-close').addEventListener('click', () => this.#card(null));
  }

  #pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  // Gamepad: left stick pans, triggers zoom, A selects under the centre, X fast travel, B closes.
  gamepad(dt, input) {
    const pad = input.pad;
    if (!pad) return;
    const sp = 700 * dt;
    if (Math.abs(pad.x) > 0.15 || Math.abs(pad.y) > 0.15) this.pan(-pad.x * sp, -pad.y * sp);
    if (pad.zoomIn > 0.1) this.zoomAt(this.w / 2, this.h / 2, 1 + pad.zoomIn * dt * 2);
    if (pad.zoomOut > 0.1) this.zoomAt(this.w / 2, this.h / 2, 1 / (1 + pad.zoomOut * dt * 2));
    if (input.consume('confirm')) {
      if (this.selected || this.cursor) this.#routeToSelection();
      else this.#click(this.w / 2, this.h / 2);
    }
    if (input.consume('travel')) this.#travelToSelection();
    this.padCursor = true;
  }

  // ------------------------------------------------------------------ drawing
  #loop() {
    this.looping = this.isOpen;
    if (!this.isOpen) return;
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    requestAnimationFrame(() => this.#loop());
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.w;
    const H = this.h;
    const ppm = this.view.ppm;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1117';
    ctx.fillRect(0, 0, W, H);
    // Terrain: only the visible part of the raster is sampled.
    const [vx0, vz0] = this.toWorld(0, 0);
    const [vx1, vz1] = this.toWorld(W, H);
    const wx0 = clamp(vx0, -WORLD.half, WORLD.half);
    const wx1 = clamp(vx1, -WORLD.half, WORLD.half);
    const wz0 = clamp(vz0, -WORLD.half, WORLD.half);
    const wz1 = clamp(vz1, -WORLD.half, WORLD.half);
    const k = this.raster.width / WORLD.size;
    ctx.imageSmoothingEnabled = true;
    if (wx1 > wx0 && wz1 > wz0) {
      const [dx, dy] = this.toScreen(wx0, wz0);
      ctx.drawImage(this.raster, (wx0 + WORLD.half) * k, (wz0 + WORLD.half) * k, (wx1 - wx0) * k, (wz1 - wz0) * k, dx, dy, (wx1 - wx0) * ppm, (wz1 - wz0) * ppm);
    }
    // Slight vignette so the UI reads well on top.
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(6,9,13,0)');
    vg.addColorStop(1, 'rgba(6,9,13,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    // Roads
    const tf = { a: ppm, b: 0, c: 0, d: ppm, e: W / 2 - this.view.x * ppm, f: H / 2 - this.view.z * ppm };
    drawRoads(ctx, this.lines, tf, ppm, { discovery: this.game.openWorld.discovery, bounds: { minX: vx0 - 50, maxX: vx1 + 50, minZ: vz0 - 50, maxZ: vz1 + 50 } });
    // Region names, fading out when zoomed in.
    const regionAlpha = clamp((0.75 - ppm) / 0.4, 0, 1);
    if (regionAlpha > 0.02) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const r of REGIONS) {
        const [x, y] = this.toScreen(r.x, r.z);
        const size = Math.round(clamp(ppm * 60, 13, 26) * r.size);
        ctx.font = `800 ${size}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
        const text = r.name.toUpperCase().split('').join(' ');
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(8,12,17,${0.7 * regionAlpha})`;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = `rgba(236,242,246,${0.92 * regionAlpha})`;
        ctx.fillText(text, x, y);
      }
    }
    // GPS route
    const gps = this.game.gps;
    if (gps.active && gps.route) drawRoute(ctx, gps.route.points, tf, 5);
    // Traffic
    for (const a of this.game.ai) {
      const [x, y] = this.toScreen(a.x, a.z);
      ctx.fillStyle = a.color;
      ctx.strokeStyle = '#0b0e12';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Icons: boards below, the rest on top; selected last.
    const items = this.#visibleItems();
    const size = clamp(18 + ppm * 10, 20, 32);
    const order = [...items].sort((a, b) => (a.kind === 'board') - (b.kind === 'board')).reverse();
    for (const it of order) {
      if (it === this.selected) continue;
      const [x, y] = this.toScreen(it.x, it.z);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      drawIcon(ctx, x, y, it, it.kind === 'board' ? size * 0.62 : it.kind === 'festival' ? size * 1.3 : size, { stars: it.stars !== undefined && ppm > 0.22, hover: it === this.hover });
    }
    if (gps.active) {
      const [x, y] = this.toScreen(gps.target.x, gps.target.z);
      drawPin(ctx, x, y, 14);
    }
    if (this.cursor) {
      const [x, y] = this.toScreen(this.cursor.x, this.cursor.z);
      drawPin(ctx, x, y, 12, 'rgba(185,140,255,0.7)');
    }
    if (this.selected) {
      const it = this.selected;
      const [x, y] = this.toScreen(it.x, it.z);
      drawIcon(ctx, x, y, it, (it.kind === 'festival' ? size * 1.3 : size) * 1.15, { stars: it.stars !== undefined, selected: true });
    }
    // Hover label
    if (this.hover && this.hover !== this.selected) {
      const [x, y] = this.toScreen(this.hover.x, this.hover.z);
      ctx.font = '700 13px "Barlow", sans-serif';
      const text = this.hover.name;
      const tw = ctx.measureText(text).width + 16;
      ctx.fillStyle = 'rgba(8,12,17,0.9)';
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y - size - 30, tw, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#e6eef3';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y - size - 19);
    }
    // Player
    const v = this.game.vehicle;
    const [px, py] = this.toScreen(v.x, v.z);
    // World +z is down on the map: heading yaw points along (sin, cos) -> screen angle.
    drawPlayer(ctx, px, py, Math.atan2(Math.sin(v.yaw), -Math.cos(v.yaw)), 11);
    // Centre crosshair for keyboard / gamepad use
    ctx.strokeStyle = 'rgba(230,238,243,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 9, H / 2);
    ctx.lineTo(W / 2 - 3, H / 2);
    ctx.moveTo(W / 2 + 3, H / 2);
    ctx.lineTo(W / 2 + 9, H / 2);
    ctx.moveTo(W / 2, H / 2 - 9);
    ctx.lineTo(W / 2, H / 2 - 3);
    ctx.moveTo(W / 2, H / 2 + 3);
    ctx.lineTo(W / 2, H / 2 + 9);
    ctx.stroke();
    // Scale bar
    const metres = [50, 100, 250, 500, 1000].find((m) => m * ppm > 70) || 1000;
    const len = metres * ppm;
    const sx = 20;
    // Above the filter chips on small or touch screens, below them otherwise.
    const sy = document.body.classList.contains('touch') || H < 560 ? H - 66 : H - 26;
    ctx.fillStyle = 'rgba(8,12,17,0.75)';
    ctx.fillRect(sx - 8, sy - 20, len + 16, 30);
    ctx.strokeStyle = '#e6eef3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 4);
    ctx.lineTo(sx, sy);
    ctx.lineTo(sx + len, sy);
    ctx.lineTo(sx + len, sy - 4);
    ctx.stroke();
    ctx.fillStyle = '#e6eef3';
    ctx.font = '600 11px "Chivo Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(metres >= 1000 ? '1 km' : `${metres} m`, sx, sy - 7);
    // Region under the centre
    this.$('wm-region').textContent = regionAt(this.view.x, this.view.z);
  }
}
