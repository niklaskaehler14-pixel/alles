// Head-up display: tachometer, minimap, race panel and messages.
import { WORLD, ROAD } from './config.js';
import { clamp, formatTime, lerp } from './util.js';
import { drawRoads, drawRoute, drawIcon, drawPlayer, drawPin } from './maprender.js';

const AMBER = '#f2a541';
const ICE = '#e6eef3';
const RED = '#ff4d3d';

// Shared gauge drawing used by the HUD and the in-car instrument cluster.
export function drawGauge(ctx, w, h, { rpm, speed, gear, redline = 7400, limiter = false, cluster = false }) {
  ctx.clearRect(0, 0, w, h);
  const kmh = Math.round(speed * 3.6);
  const gearText = gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear);
  if (cluster) {
    // Wide instrument panel: tach arc on the left, digital speed on the right.
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#07090c');
    bg.addColorStop(1, '#10151b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const cx = w * 0.3;
    const cy = h * 0.58;
    const r = h * 0.42;
    arc(ctx, cx, cy, r, rpm, redline, limiter, h * 0.05);
    ctx.fillStyle = ICE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${h * 0.3}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
    ctx.fillText(gearText, cx, cy + h * 0.03);
    ctx.font = `800 ${h * 0.34}px "Chivo Mono", monospace`;
    ctx.fillText(String(kmh), w * 0.73, h * 0.46);
    ctx.font = `600 ${h * 0.09}px "Barlow", sans-serif`;
    ctx.fillStyle = '#8aa0b0';
    ctx.fillText('km/h', w * 0.73, h * 0.72);
    return;
  }
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.44;
  ctx.fillStyle = 'rgba(8,11,15,0.62)';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.fill();
  arc(ctx, cx, cy, r - 4, rpm, redline, limiter, r * 0.09);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ICE;
  ctx.font = `800 ${r * 0.52}px "Chivo Mono", monospace`;
  ctx.fillText(String(kmh), cx, cy + r * 0.02);
  ctx.font = `600 ${r * 0.14}px "Barlow", sans-serif`;
  ctx.fillStyle = '#8aa0b0';
  ctx.fillText('KM/H', cx, cy + r * 0.34);
  ctx.font = `800 ${r * 0.3}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
  ctx.fillStyle = rpm > redline - 500 ? RED : AMBER;
  ctx.fillText(gearText, cx, cy + r * 0.66);
}

function arc(ctx, cx, cy, r, rpm, redline, limiter, width) {
  const a0 = Math.PI * 0.78;
  const a1 = Math.PI * 2.22;
  const max = 8000;
  const ang = (v) => a0 + (a1 - a0) * (v / max);
  ctx.lineCap = 'butt';
  ctx.lineWidth = width;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,77,61,0.45)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, ang(redline - 400), a1);
  ctx.stroke();
  const v = clamp(rpm, 0, max);
  const g = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  g.addColorStop(0, '#f7c77a');
  g.addColorStop(0.7, AMBER);
  g.addColorStop(1, RED);
  ctx.strokeStyle = limiter ? RED : g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, ang(v));
  ctx.stroke();
  // Ticks
  ctx.lineWidth = 2;
  for (let k = 0; k <= 8; k++) {
    const a = ang(k * 1000);
    const inner = r - width * 1.2;
    ctx.strokeStyle = k * 1000 >= redline - 400 ? RED : 'rgba(230,238,243,0.8)';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * (inner - width * 0.9), cy + Math.sin(a) * (inner - width * 0.9));
    ctx.stroke();
  }
}

export class Hud {
  constructor(root, world, { raster, lines }) {
    this.root = root;
    this.el = (id) => root.querySelector(`#${id}`);
    this.gauge = this.el('gauge');
    this.gctx = this.gauge.getContext('2d');
    this.mini = this.el('minimap');
    this.mctx = this.mini.getContext('2d');
    this.world = world;
    this.msgTimer = 0;
    this.raster = raster;
    this.lines = lines;
    this.bigMap = false;
    this.miniView = 460;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Match canvas pixels to their on-screen size (call after the HUD becomes visible).
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.gauge, this.mini]) {
      const r = c.getBoundingClientRect();
      c.width = Math.max(64, Math.round(r.width * dpr));
      c.height = Math.max(64, Math.round(r.height * dpr));
    }
  }

  // Heading-up minimap: terrain, roads, the GPS route, traffic and activity icons. It zooms out
  // with speed. cars: [{ x, z, color }], markers: map items, route: GPS points or null.
  drawMinimap(player, cars, markers = [], route = null, dt = 0.033) {
    const ctx = this.mctx;
    const W = this.mini.width;
    const H = this.mini.height;
    const want = this.bigMap ? 1600 : lerp(440, 900, clamp(player.speed / 70, 0, 1));
    this.miniView += (want - this.miniView) * (1 - Math.exp(-dt * 2.5));
    const ppm = W / this.miniView;
    const th = Math.PI + player.yaw;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const tf = { a: ppm * cs, b: ppm * sn, c: -ppm * sn, d: ppm * cs, e: 0, f: 0 };
    tf.e = W / 2 - tf.a * player.x - tf.c * player.z;
    tf.f = H / 2 - tf.b * player.x - tf.d * player.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1a2229';
    ctx.fillRect(0, 0, W, H);
    // Only the part of the terrain raster around the car is sampled.
    const r = this.miniView * 0.75;
    const k = this.raster.width / WORLD.size;
    const x0 = clamp(player.x - r, -WORLD.half, WORLD.half);
    const x1 = clamp(player.x + r, -WORLD.half, WORLD.half);
    const z0 = clamp(player.z - r, -WORLD.half, WORLD.half);
    const z1 = clamp(player.z + r, -WORLD.half, WORLD.half);
    ctx.setTransform(tf.a, tf.b, tf.c, tf.d, tf.e, tf.f);
    ctx.imageSmoothingEnabled = true;
    if (x1 > x0 && z1 > z0) ctx.drawImage(this.raster, (x0 + WORLD.half) * k, (z0 + WORLD.half) * k, (x1 - x0) * k, (z1 - z0) * k, x0, z0, x1 - x0, z1 - z0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = W / Math.max(1, this.mini.clientWidth || W);
    drawRoads(ctx, this.lines, tf, ppm, { simple: true, dpr, bounds: { minX: player.x - r, maxX: player.x + r, minZ: player.z - r, maxZ: player.z + r } });
    if (route) drawRoute(ctx, route, tf, Math.max(3, W * 0.028));
    for (const c of cars) {
      const x = tf.a * c.x + tf.c * c.z + tf.e;
      const y = tf.b * c.x + tf.d * c.z + tf.f;
      ctx.fillStyle = c.color;
      ctx.strokeStyle = '#0b0e12';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, 3.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    // Icons in screen space (upright), pinned to the rim when they are targets.
    const rim = W / 2 - 10 * dpr;
    for (const m of markers) {
      let sx = tf.a * m.x + tf.c * m.z + tf.e - W / 2;
      let sy = tf.b * m.x + tf.d * m.z + tf.f - H / 2;
      const d = Math.hypot(sx, sy);
      if (d > rim) {
        if (!m.target) continue;
        sx *= rim / d;
        sy *= rim / d;
      }
      if (m.kind === 'waypoint') drawPin(ctx, W / 2 + sx, H / 2 + sy, W * 0.05);
      else drawIcon(ctx, W / 2 + sx, H / 2 + sy, m, W * (m.kind === 'festival' ? 0.1 : 0.075));
    }
    drawPlayer(ctx, W / 2, H / 2, 0, W * 0.042);
    ctx.strokeStyle = 'rgba(230,238,243,0.35)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    // North marker on the rim: world -z maps to (sin th, -cos th) on screen.
    const ndx = sn;
    const ndy = -cs;
    ctx.fillStyle = '#e6eef3';
    ctx.font = `800 ${Math.round(W * 0.075)}px "Barlow", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', W / 2 + ndx * (W / 2 - 12 * dpr), H / 2 + ndy * (H / 2 - 12 * dpr));
  }

  drawGauge(car) {
    drawGauge(this.gctx, this.gauge.width, this.gauge.height, { rpm: car.rpm, speed: car.speed, gear: car.gear, limiter: car.limiter > 0 });
  }

  setText(id, text) {
    const e = this.el(id);
    if (e && e.textContent !== text) e.textContent = text;
  }

  show(id, visible) {
    const e = this.el(id);
    if (e) e.hidden = !visible;
  }

  message(text, seconds = 1.6, kind = '') {
    const m = this.el('message');
    m.textContent = text;
    m.dataset.kind = kind;
    m.hidden = false;
    m.classList.remove('pop');
    void m.offsetWidth;
    m.classList.add('pop');
    this.msgTimer = seconds;
  }

  setRace({ position, total, lap, laps, lapTime, bestLap, mode }) {
    const race = mode === 'race';
    this.show('pos-block', race);
    this.show('lap-block', mode !== 'free');
    this.show('time-block', mode !== 'free');
    this.show('level-block', mode === 'free');
    if (race) this.setText('pos-value', `${position}/${total}`);
    if (mode !== 'free') {
      this.setText('lap-value', mode === 'race' ? `${Math.min(lap, laps)}/${laps}` : String(Math.max(1, lap)));
      this.setText('time-value', formatTime(lapTime));
      this.setText('best-value', formatTime(bestLap));
    }
  }

  setLevel({ level, into, need, fraction }) {
    this.setText('level-value', String(level));
    this.el('xp-fill').style.width = `${Math.round(fraction * 100)}%`;
    this.setText('xp-text', `${into.toLocaleString('de-DE')} / ${need.toLocaleString('de-DE')} XP`);
  }

  // Skill chain display: latest skills, chain total with multiplier and the time left to bank.
  showSkills(chain, bankTime) {
    const box = this.el('skills');
    if (this.skillHold > 0) return; // showing a banked or broken chain
    if (!chain.active) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.classList.remove('banked', 'broken');
    const feed = this.el('skill-feed');
    const key = chain.feed.map((f) => `${f.name}:${Math.round(f.points)}`).join('|');
    if (key !== this.skillKey) {
      this.skillKey = key;
      feed.textContent = '';
      chain.feed.slice(0, 3).forEach((f) => {
        const d = document.createElement('div');
        d.textContent = f.name;
        const b = document.createElement('b');
        b.textContent = `+${Math.round(f.points).toLocaleString('de-DE')}`;
        d.appendChild(b);
        feed.appendChild(d);
      });
    }
    this.setText('skill-points', Math.round(chain.points).toLocaleString('de-DE'));
    this.setText('skill-mult', `×${chain.mult}`);
    this.el('skill-timer').style.width = `${Math.round(clamp(chain.timer / bankTime, 0, 1) * 100)}%`;
  }

  // Result of a finished chain, shown for a moment: banked (green) or broken by a crash (red).
  skillResult(total, banked) {
    const box = this.el('skills');
    box.hidden = false;
    box.classList.toggle('banked', banked);
    box.classList.toggle('broken', !banked);
    this.el('skill-feed').textContent = '';
    const d = document.createElement('div');
    d.textContent = banked ? 'Skill-Kette gesichert' : 'Skill-Kette gerissen';
    this.el('skill-feed').appendChild(d);
    this.setText('skill-points', total.toLocaleString('de-DE'));
    this.setText('skill-mult', '');
    this.el('skill-timer').style.width = '0%';
    this.skillKey = '';
    this.skillHold = 1.8;
  }

  // Small XP notices on the right: "+500 XP Entdeckung".
  feed(text, xp = 0) {
    const box = this.el('feed');
    const d = document.createElement('div');
    if (xp) {
      const b = document.createElement('b');
      b.textContent = `+${Math.round(xp).toLocaleString('de-DE')} XP`;
      d.appendChild(b);
    }
    d.appendChild(document.createTextNode(text));
    box.prepend(d);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
  }

  banner(kind, title, sub = '', seconds = 3.2) {
    const b = this.el('banner');
    this.setText('banner-kind', kind);
    this.setText('banner-title', title);
    this.setText('banner-sub', sub);
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    this.bannerTimer = seconds;
  }

  update(dt) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el('message').hidden = true;
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el('banner').hidden = true;
    }
    if (this.skillHold > 0) {
      this.skillHold -= dt;
      if (this.skillHold <= 0) this.el('skills').hidden = true;
    }
  }
}

export { formatTime };
export const ROAD_HALF = ROAD.half;
