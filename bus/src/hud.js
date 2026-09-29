// Everything drawn in HTML on top of the 3D view: driver terminal (next stop, delay, clock),
// speed and limit, warning lamps, timetable, minimap and line map, fault slips, hints,
// the ticket machine and the end-of-shift report.
import { fmtClock } from './trip.js';
import { FARES, euroText, roundCents } from './tickets.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);

export function mmss(sec) {
  const s = Math.round(Math.abs(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Deviation from the timetable in seconds (+ late, − early), interpolated between stops
// like the "Fahrplanlage" shown on a real driver terminal.
export function scheduleDeviation(trip) {
  const k = trip.current;
  const st = trip.stops[k];
  if (!st) return 0;
  if (st.state === 'here' || k === 0) return trip.clock - st.sched;
  const prev = trip.stops[k - 1];
  const f = clamp((trip.progress - prev.dist) / Math.max(1, st.dist - prev.dist), 0, 1);
  return trip.clock - (prev.sched + (st.sched - prev.sched) * f);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- city map canvas

const MAP_COLORS = {
  land: '#1f2a24',
  road: '#4a5058',
  walk: '#6b727a',
  block: '#2b3137',
  park: '#2c4a33',
  sports: '#2f4d3a',
  building: '#3c434b',
  water: '#27496a',
};

class CityMap {
  constructor(city, layout) {
    this.city = city;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const n of city.nodes) {
      x0 = Math.min(x0, n.x);
      z0 = Math.min(z0, n.z);
      x1 = Math.max(x1, n.x);
      z1 = Math.max(z1, n.z);
    }
    const pad = 110;
    this.x0 = x0 - pad;
    this.z0 = z0 - pad;
    this.S = 1.5; // pixels per metre in the base image
    this.w = Math.ceil((x1 - x0 + pad * 2) * this.S);
    this.h = Math.ceil((z1 - z0 + pad * 2) * this.S);
    this.base = document.createElement('canvas');
    this.base.width = this.w;
    this.base.height = this.h;
    this.#drawBase(layout);
  }

  px(x) {
    return (x - this.x0) * this.S;
  }

  pz(z) {
    return (z - this.z0) * this.S;
  }

  #poly(g, pts) {
    g.beginPath();
    for (let k = 0; k < pts.length; k += 2) {
      const X = this.px(pts[k]);
      const Z = this.pz(pts[k + 1]);
      if (k === 0) g.moveTo(X, Z);
      else g.lineTo(X, Z);
    }
    g.closePath();
  }

  #drawBase(layout) {
    const g = this.base.getContext('2d');
    g.fillStyle = MAP_COLORS.land;
    g.fillRect(0, 0, this.w, this.h);
    const outer = this.city.regions.find((r) => r.outer);
    if (outer) {
      // Outside the ring: a strip of sidewalk, then the land.
      g.save();
      g.lineJoin = 'round';
      g.strokeStyle = MAP_COLORS.walk;
      g.lineWidth = 12 * this.S;
      this.#poly(g, outer.curb);
      g.stroke();
      g.fillStyle = MAP_COLORS.road;
      g.fill();
      g.restore();
    }
    for (const r of this.city.regions) {
      if (r.outer) continue;
      g.fillStyle = MAP_COLORS.walk;
      this.#poly(g, r.curb);
      g.fill();
      g.fillStyle = r.use === 'park' ? MAP_COLORS.park : r.use === 'sports' || r.use === 'school' ? MAP_COLORS.sports : MAP_COLORS.block;
      this.#poly(g, r.front);
      g.fill();
    }
    if (layout) {
      g.fillStyle = MAP_COLORS.building;
      for (const b of layout.buildings) {
        const s = Math.sin(b.yaw);
        const c = Math.cos(b.yaw);
        const hl = b.d / 2;
        const hw = b.w / 2;
        g.beginPath();
        for (const [a, l] of [
          [1, 1],
          [1, -1],
          [-1, -1],
          [-1, 1],
        ]) {
          const x = b.x + s * hl * a + c * hw * l;
          const z = b.z + c * hl * a - s * hw * l;
          g.lineTo(this.px(x), this.pz(z));
        }
        g.closePath();
        g.fill();
      }
    }
    // Centre lines, thin.
    g.strokeStyle = 'rgba(230,236,240,0.18)';
    g.lineWidth = 1;
    for (const e of this.city.edges || []) {
      const a = this.city.nodes[e.a];
      const b = this.city.nodes[e.b];
      if (!a || !b) continue;
      g.beginPath();
      g.moveTo(this.px(a.x), this.pz(a.z));
      g.lineTo(this.px(b.x), this.pz(b.z));
      g.stroke();
    }
  }

  routePath(route) {
    const p = new Path2D();
    const pts = route.path.pts;
    const from = route.startDist;
    const to = route.endDist;
    const a = route.path.at(from);
    p.moveTo(this.px(a.x), this.pz(a.z));
    for (let i = 0; i < route.path.n; i++) {
      const s = route.path.cum[i];
      if (s <= from || s >= to) continue;
      p.lineTo(this.px(pts[i * 2]), this.pz(pts[i * 2 + 1]));
    }
    const b = route.path.at(to);
    p.lineTo(this.px(b.x), this.pz(b.z));
    return p;
  }
}

// ---------------------------------------------------------------- HUD

export class Hud {
  constructor(city, layout) {
    this.city = city;
    this.map = new CityMap(city, layout);
    this.el = {
      hud: $('hud'),
      line: $('h-line'),
      head: $('h-head'),
      next: $('h-next'),
      delay: $('h-delay'),
      clock: $('h-clock'),
      request: $('h-request'),
      speed: $('h-speed'),
      limit: $('h-limit'),
      gear: $('h-gear'),
      hint: $('h-hint'),
      toasts: $('toasts'),
      timetable: $('h-timetable'),
      pax: $('h-pax'),
      comfort: $('h-comfort'),
      comfortBar: $('h-comfort-bar'),
      points: $('h-points'),
      cash: $('h-cash'),
      mode: $('h-mode'),
      minimap: $('minimap'),
      bigmap: $('bigmap'),
      mapOverlay: $('map'),
      mapTitle: $('map-title'),
      ticket: $('ticket'),
    };
    this.lamps = {};
    for (const el of document.querySelectorAll('[data-lamp]')) this.lamps[el.dataset.lamp] = el;
    this.miniCtx = this.el.minimap.getContext('2d');
    this.lastText = new Map();
    this.routePath = null;
    this.trip = null;
    this.sale = null;
    // One label per street, on its middle segment.
    const byName = new Map();
    for (const e of city.edges) {
      if (!e.name) continue;
      if (!byName.has(e.name)) byName.set(e.name, []);
      byName.get(e.name).push(e);
    }
    this.streetNames = [...byName.entries()].map(([text, list]) => {
      const e = list[Math.floor(list.length / 2)];
      const a = city.nodes[e.a];
      const b = city.nodes[e.b];
      return { text, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, vertical: e.axis === 'v' };
    });
    this.#bindTicket();
  }

  // Only touch the DOM when a value changed.
  #text(el, v) {
    if (this.lastText.get(el) === v) return;
    this.lastText.set(el, v);
    el.textContent = v;
  }

  #cls(el, name, on) {
    if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
  }

  show(on) {
    this.el.hud.hidden = !on;
  }

  // New trip (or free driving when route is null).
  setup({ route, trip, line, headsign, free }) {
    this.route = route;
    this.trip = trip;
    this.free = free;
    this.lastText.clear();
    this.el.line.textContent = line ? line.id : 'F';
    this.el.line.style.setProperty('--line', line ? line.color : '#6b7785');
    this.el.head.textContent = free ? 'Freie Fahrt' : `Richtung ${headsign}`;
    this.routePath = route ? this.map.routePath(route) : null;
    this.lineColor = line ? line.color : '#ffb52e';
    this.el.toasts.textContent = '';
    this.el.ticket.hidden = true;
    this.sale = null;
    // Timetable rows.
    const tt = this.el.timetable;
    tt.textContent = '';
    this.rows = [];
    if (trip) {
      for (const st of trip.stops) {
        const li = document.createElement('li');
        li.innerHTML = `<time>${fmtClock(st.sched)}</time><span class="tt-name">${esc(st.name)}</span><span class="tt-state"></span>`;
        tt.appendChild(li);
        this.rows.push({ li, state: li.querySelector('.tt-state') });
      }
    }
    tt.hidden = !trip;
  }

  // s: snapshot built in main.js each HUD tick.
  update(s) {
    const e = this.el;
    this.#text(e.speed, String(Math.round(s.kmh)));
    this.#text(e.limit, String(s.limit));
    this.#cls(e.speed.parentElement, 'is-over', s.kmh > s.limit + 3);
    this.#text(e.gear, s.gear);
    this.#text(e.clock, fmtClock(s.clock));
    const L = this.lamps;
    this.#cls(L.indL, 'on', (s.indicator === 1 || s.hazard) && s.blinkOn);
    this.#cls(L.indR, 'on', (s.indicator === -1 || s.hazard) && s.blinkOn);
    this.#cls(L.doors, 'on', s.doors);
    this.#cls(L.stopBrake, 'on', s.stopBrake);
    this.#cls(L.park, 'on', s.parking);
    this.#cls(L.kneel, 'on', s.kneel);
    this.#cls(L.lights, 'on', s.lights);
    this.#cls(L.engine, 'on', !s.engineOn);
    this.#cls(L.auto, 'on', s.autopilot);
    this.#text(e.pax, s.capacity ? `${s.onboard}/${s.capacity}` : '–');
    this.#text(e.points, String(s.points));
    this.#cls(e.points.parentElement, 'is-bad', s.points > 0);
    this.#text(e.cash, euroText(s.cash));
    const cf = Math.round(s.comfort);
    this.#text(e.comfort, `${cf} %`);
    e.comfortBar.style.transform = `scaleX(${cf / 100})`;
    this.#cls(e.comfortBar.parentElement, 'is-low', cf < 60);
    e.request.hidden = !s.request;
    this.#text(e.hint, s.hint || '');
    e.hint.hidden = !s.hint;

    const trip = this.trip;
    if (trip && !trip.finished) {
      const st = trip.nextStop;
      this.#text(e.next, st ? st.name : '—');
      const dev = scheduleDeviation(trip);
      const here = st && st.state === 'here';
      let text;
      let tone;
      if (here && dev < -5) {
        text = `ab ${fmtClock(st.sched)}`;
        tone = 'wait';
      } else if (Math.abs(dev) < 30) {
        text = 'pünktlich';
        tone = 'ok';
      } else if (dev > 0) {
        text = `+${mmss(dev)}`;
        tone = dev > 180 ? 'bad' : 'late';
      } else {
        text = `−${mmss(dev)}`;
        tone = 'early';
      }
      this.#text(e.delay, text);
      e.delay.dataset.tone = tone;
      this.#timetable(trip);
    } else if (trip) {
      const last = trip.stops[trip.stops.length - 1];
      this.#text(e.next, trip.aborted ? 'Fahrt beendet' : last.name);
      this.#text(e.delay, 'Endhaltestelle');
      e.delay.dataset.tone = 'ok';
    } else if (this.free) {
      this.#text(e.next, s.nearStop || 'Freie Fahrt');
      this.#text(e.delay, '');
      e.delay.dataset.tone = '';
    }
  }

  #timetable(trip) {
    const k = trip.current;
    trip.stops.forEach((st, i) => {
      const row = this.rows[i];
      if (!row) return;
      const visible = i >= k - 1 && i <= k + 3;
      if (row.li.hidden === visible) row.li.hidden = !visible;
      if (!visible) return;
      let state = '';
      let cls = '';
      if (st.state === 'done') {
        cls = 'done';
        state = st.delay === null ? '✓' : st.delay > 30 ? `+${mmss(st.delay)}` : st.delay < -30 ? `−${mmss(st.delay)}` : '✓';
      } else if (st.state === 'skipped') {
        cls = 'skipped';
        state = 'ausgelassen';
      } else if (st.state === 'here') {
        cls = 'here';
        state = 'Halt';
      } else if (i === k) {
        cls = 'next';
        const need = st.waiting.length > 0 || trip.onboard.some((p) => p.to === i) || st.last;
        state = st.last ? 'Endhalt' : need ? (trip.stopRequest ? 'hält' : 'wartet') : 'Bedarf';
      }
      if (row.cls !== cls) {
        row.li.className = cls;
        row.cls = cls;
      }
      if (row.stateText !== state) {
        row.state.textContent = state;
        row.stateText = state;
      }
    });
  }

  // ------------------------------------------------------------ maps

  drawMinimap(bus, traffic, trip) {
    const cv = this.el.minimap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = cv.clientWidth || 180;
    const cssH = cv.clientHeight || 180;
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }
    const g = this.miniCtx;
    const M = this.map;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = MAP_COLORS.land;
    g.fillRect(0, 0, cv.width, cv.height);
    const zoom = (0.85 * dpr) / M.S;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(cssW / 2, cssH * 0.62);
    g.rotate(bus.yaw - Math.PI);
    g.scale(zoom / dpr, zoom / dpr);
    g.translate(-M.px(bus.x), -M.pz(bus.z));
    g.drawImage(M.base, 0, 0);
    this.#overlay(g, trip, 1 / zoom, traffic, false);
    // Bus arrow in the centre.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(cssW / 2, cssH * 0.62);
    g.fillStyle = '#ffb52e';
    g.strokeStyle = '#111';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.fill();
    g.stroke();
  }

  // Route, stops and cars on top of the base map. unit = base-map pixels per screen pixel.
  #overlay(g, trip, unit, traffic, big) {
    this.#route(g, unit);
    this.#stops(g, trip, unit, traffic, big);
  }

  #route(g, unit) {
    if (this.routePath) {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 7 * unit;
      g.stroke(this.routePath);
      g.strokeStyle = this.lineColor;
      g.lineWidth = 4 * unit;
      g.stroke(this.routePath);
    }
  }

  #stops(g, trip, unit, traffic, big) {
    const M = this.map;
    // All stops as small dots; route stops bigger.
    const r = 3 * unit;
    g.fillStyle = 'rgba(240,244,246,0.75)';
    for (const s of this.city.stops) {
      g.beginPath();
      g.arc(M.px(s.x), M.pz(s.z), r * 0.7, 0, Math.PI * 2);
      g.fill();
    }
    if (trip) {
      trip.stops.forEach((st, i) => {
        const s = st.stop;
        const done = st.state === 'done' || st.state === 'skipped';
        g.beginPath();
        g.arc(M.px(s.x), M.pz(s.z), r * (i === trip.current ? 2.1 : 1.5), 0, Math.PI * 2);
        g.fillStyle = i === trip.current ? '#ffb52e' : done ? '#7d8791' : '#ffffff';
        g.fill();
        g.lineWidth = 1.5 * unit;
        g.strokeStyle = '#111';
        g.stroke();
        if (big) {
          g.font = `600 ${12 * unit}px "Atkinson Hyperlegible", Arial, sans-serif`;
          g.fillStyle = i === trip.current ? '#ffb52e' : '#e8eef1';
          g.strokeStyle = 'rgba(10,14,18,0.85)';
          g.lineWidth = 3 * unit;
          g.strokeText(st.name, M.px(s.x) + 8 * unit, M.pz(s.z) + 4 * unit);
          g.fillText(st.name, M.px(s.x) + 8 * unit, M.pz(s.z) + 4 * unit);
        }
      });
    }
    if (traffic) {
      g.fillStyle = 'rgba(200,210,220,0.8)';
      for (const v of traffic.vehicles) g.fillRect(M.px(v.x) - 2 * unit, M.pz(v.z) - 2 * unit, 4 * unit, 4 * unit);
    }
  }

  openMap(bus, trip) {
    const cv = this.el.bigmap;
    this.el.mapOverlay.hidden = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    const M = this.map;
    const fit = Math.min(W / M.w, H / M.h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = MAP_COLORS.land;
    g.fillRect(0, 0, W, H);
    g.translate((W - M.w * fit) / 2, (H - M.h * fit) / 2);
    g.scale(fit, fit);
    g.drawImage(M.base, 0, 0);
    const unit = 1 / fit;
    this.#route(g, unit);
    // Street names.
    g.font = `600 ${11 * unit}px "Atkinson Hyperlegible", Arial, sans-serif`;
    g.fillStyle = 'rgba(232,238,241,0.55)';
    g.textAlign = 'center';
    for (const n of this.streetNames) {
      g.save();
      g.translate(M.px(n.x), M.pz(n.z));
      if (n.vertical) g.rotate(-Math.PI / 2);
      g.strokeStyle = 'rgba(10,14,18,0.8)';
      g.lineWidth = 3 * unit;
      g.strokeText(n.text, 0, 4 * unit);
      g.fillText(n.text, 0, 4 * unit);
      g.restore();
    }
    g.textAlign = 'left';
    this.#stops(g, trip, unit, null, true);
    // Bus.
    g.save();
    g.translate(M.px(bus.x), M.pz(bus.z));
    g.rotate(Math.PI - bus.yaw);
    g.scale(unit, unit);
    g.fillStyle = '#ffb52e';
    g.strokeStyle = '#111';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(9, 9);
    g.lineTo(0, 4);
    g.lineTo(-9, 9);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    this.el.mapTitle.textContent = trip ? `Linie ${trip.route.line.id} · ${trip.route.line.title}` : 'Stadtplan Nordkamm';
  }

  closeMap() {
    this.el.mapOverlay.hidden = true;
  }

  get mapOpen() {
    return !this.el.mapOverlay.hidden;
  }

  // ------------------------------------------------------------ messages

  // kind: 'fault' | 'info' | 'good'
  toast(kind, title, sub = '', ms = 4200) {
    const box = this.el.toasts;
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.innerHTML = `<strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, ms);
  }

  fault(f) {
    const cost = [];
    if (f.points) cost.push(`${f.points} Fehlerpunkte`);
    if (f.fine) cost.push(`${f.fine} € Abzug`);
    this.toast('fault', f.detail ? `${f.text} (${f.detail})` : f.text, cost.join(' · '), 5200);
  }

  // ------------------------------------------------------------ ticket machine

  #bindTicket() {
    const fares = $('t-fares');
    for (const f of FARES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.fare = f.id;
      b.innerHTML = `<span>${esc(f.name)}</span><b>${euroText(f.price)}</b>`;
      b.addEventListener('click', () => this.#pickFare(f));
      fares.appendChild(b);
    }
    const coins = $('t-coins');
    for (const c of [10, 5, 2, 1, 0.5, 0.2, 0.1]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = c >= 5 ? 'note' : 'coin';
      b.textContent = c >= 1 ? `${c} €` : `${Math.round(c * 100)} ct`;
      b.addEventListener('click', () => {
        if (!this.sale) return;
        this.sale.change = roundCents(this.sale.change + c);
        this.#renderSale();
        if (this.onCoin) this.onCoin();
      });
      coins.appendChild(b);
    }
    $('t-reset').addEventListener('click', () => {
      if (!this.sale) return;
      this.sale.change = 0;
      this.#renderSale();
    });
    $('t-issue').addEventListener('click', () => this.issueTicket());
  }

  openSale(sale, onSell) {
    this.sale = { request: sale.request, fare: null, change: 0 };
    this.onSell = onSell;
    $('t-phrase').textContent = `„${sale.request.phrase}“`;
    $('t-paid').textContent = euroText(sale.request.paid);
    this.el.ticket.hidden = false;
    this.#renderSale();
  }

  closeSale() {
    this.sale = null;
    this.el.ticket.hidden = true;
  }

  get saleOpen() {
    return !!this.sale;
  }

  #pickFare(f) {
    if (!this.sale) return;
    this.sale.fare = f;
    this.#renderSale();
  }

  #renderSale() {
    const s = this.sale;
    for (const b of $('t-fares').children) b.classList.toggle('is-picked', !!s.fare && b.dataset.fare === s.fare.id);
    $('t-price').textContent = s.fare ? euroText(s.fare.price) : '–';
    const due = s.fare ? roundCents(s.request.paid - s.fare.price) : null;
    $('t-due').textContent = due === null ? '–' : euroText(Math.max(0, due));
    $('t-change').textContent = euroText(s.change);
    $('t-issue').disabled = !s.fare;
  }

  issueTicket() {
    const s = this.sale;
    if (!s || !s.fare) return false;
    const fare = s.fare;
    const change = s.change;
    this.closeSale();
    if (this.onSell) this.onSell(fare, change);
    return true;
  }

  // ------------------------------------------------------------ report

  showReport(rep, { tripTitle, demo, unlocks = [], balance }) {
    const r = $('report');
    $('r-title').textContent = tripTitle;
    $('r-grade').textContent = rep.aborted ? '6' : String(rep.grade);
    $('r-grade').dataset.grade = rep.aborted ? 6 : rep.grade;
    $('r-grade-text').textContent = rep.aborted ? 'Fahrt abgebrochen' : `${rep.gradeText} · ${rep.score} von 100 Punkten`;
    const parts = [
      ['Fahrweise & Regeln', rep.parts.driving],
      ['Pünktlichkeit', rep.parts.punctual],
      ['Fahrgastkomfort', rep.parts.comfort],
      ['Service an Haltestellen', rep.parts.service],
    ];
    $('r-parts').innerHTML = parts.map(([n, v]) => `<li><span>${n}</span><i style="--v:${v}"></i><b>${v}</b></li>`).join('');
    // Faults grouped.
    const groups = new Map();
    for (const f of rep.faults) {
      const g = groups.get(f.code) || { text: f.text, n: 0, points: 0, fine: 0 };
      g.n++;
      g.points += f.points;
      g.fine += f.fine;
      groups.set(f.code, g);
    }
    $('r-faults').innerHTML = groups.size
      ? [...groups.values()].map((g) => `<li><span>${g.n > 1 ? `${g.n}× ` : ''}${esc(g.text)}</span><b>${g.points} P.</b><b>${g.fine ? `−${g.fine} €` : ''}</b></li>`).join('')
      : '<li class="clean"><span>Keine Fehler. Sauber gefahren!</span></li>';
    const m = rep.money;
    const rows = [
      ['Grundvergütung (Strecke und Halte)', m.basePay],
      ['Fahrkartenverkauf', m.tickets],
      [`Fahrgastbonus (${rep.transported} Fahrgäste)`, m.passengerBonus],
      ['Qualitätsbonus nach Note', m.qualityBonus],
      ['Betriebskosten (Kraftstoff, Strom)', -m.running],
      ['Bußgelder und Schäden', -m.fines],
    ];
    $('r-money').innerHTML =
      rows.map(([n, v]) => `<tr><td>${n}</td><td class="${v < 0 ? 'neg' : ''}">${v < 0 ? '−' : ''}${euroText(Math.abs(v))}</td></tr>`).join('') +
      `<tr class="sum"><td>${demo ? 'Vorführfahrt – wird nicht gebucht' : 'Gutschrift für den Betrieb'}</td><td class="${m.total < 0 ? 'neg' : ''}">${demo ? '–' : `${m.total < 0 ? '−' : ''}${euroText(Math.abs(m.total))}`}</td></tr>`;
    $('r-stops').innerHTML = rep.stops
      .map((s) => {
        const dep = s.departed ?? s.arrived;
        const dl = s.delay === null ? '' : Math.abs(s.delay) < 30 ? 'pünktlich' : s.delay > 0 ? `+${mmss(s.delay)}` : `−${mmss(s.delay)}`;
        const q = s.state === 'skipped' ? 'ausgelassen' : s.quality ? s.quality.text.replace(' gehalten', '') : s.served ? '' : 'kein Halt';
        return `<tr><td>${fmtClock(s.sched)}</td><td>${esc(s.name)}</td><td>${dep ? fmtClock(dep) : '–'}</td><td>${dl}</td><td>${esc(q)}</td></tr>`;
      })
      .join('');
    const notes = [];
    if (demo) notes.push('Der Autopilot ist gefahren. Vorführfahrten bringen kein Geld und zählen nicht für neue Linien.');
    for (const u of unlocks) notes.push(`Neue Linie freigeschaltet: ${u}`);
    if (balance !== undefined && !demo) notes.push(`Kontostand des Betriebs: ${euroText(balance)}`);
    $('r-notes').innerHTML = notes.map((n) => `<p>${esc(n)}</p>`).join('');
    r.hidden = false;
  }

  hideReport() {
    $('report').hidden = true;
  }
}
