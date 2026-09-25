// Head-up display: tachometer, minimap, race panel and messages.
import { WORLD, CITY, ROAD } from './config.js';
import { clamp, formatTime, smoothstep } from './util.js';

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

// Round activity marker with an upright glyph; optional stars underneath.
function drawMarker(ctx, x, y, m, size, withStars = false) {
  const r = size / 2;
  ctx.fillStyle = '#0b0e12';
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = m.color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b0e12';
  ctx.font = `800 ${size * 0.62}px "Barlow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(m.glyph, x, y + size * 0.03);
  if (withStars && m.stars !== undefined) {
    ctx.font = `700 ${size * 0.6}px "Barlow", sans-serif`;
    ctx.fillStyle = '#ffd24a';
    ctx.fillText('★'.repeat(m.stars) + '☆'.repeat(3 - m.stars), x, y + size * 0.95);
  }
}

export class Hud {
  constructor(root, world) {
    this.root = root;
    this.el = (id) => root.querySelector(`#${id}`);
    this.gauge = this.el('gauge');
    this.gctx = this.gauge.getContext('2d');
    this.mini = this.el('minimap');
    this.mctx = this.mini.getContext('2d');
    this.world = world;
    this.msgTimer = 0;
    this.mapImage = this.#renderMap();
    this.bigMap = false;
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

  // Top-down map image of the whole world (rendered once).
  #renderMap() {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const hf = this.world.heightfield;
    const half = WORLD.half;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = -half + ((px + 0.5) / S) * WORLD.size;
        const z = -half + ((py + 0.5) / S) * WORLD.size;
        const h = hf.get(x, z);
        const ex = hf.get(x + 8, z) - h;
        const shade = clamp(1 - ex * 0.08, 0.7, 1.25);
        let r;
        let g;
        let b;
        if (h < WORLD.waterLevel) {
          const d = clamp(-h / 20, 0, 1);
          r = 40 - d * 16;
          g = 92 - d * 30;
          b = 118 - d * 20;
        } else {
          const t = smoothstep(0, 320, h);
          r = 78 + t * 70;
          g = 102 + t * 40;
          b = 60 + t * 60;
          if (h > 390) r = g = b = 225;
          r *= shade;
          g *= shade;
          b *= shade;
        }
        if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.radius) {
          r = 118;
          g = 118;
          b = 122;
        }
        const i = (py * S + px) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Buildings
    ctx.fillStyle = '#5b5d63';
    const toPx = (v) => ((v + half) / WORLD.size) * S;
    for (const b of this.world.buildings) ctx.fillRect(toPx(b.x - b.w / 2), toPx(b.z - b.d / 2), (b.w / WORLD.size) * S, (b.d / WORLD.size) * S);
    // Road
    const tr = this.world.track;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= tr.count; i += 4) {
        const k = i % tr.count;
        const x = toPx(tr.x[k]);
        const y = toPx(tr.z[k]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,12,16,0.85)';
    ctx.lineWidth = 7;
    path();
    ctx.stroke();
    ctx.strokeStyle = '#e8e4da';
    ctx.lineWidth = 3.4;
    path();
    ctx.stroke();
    // Dirt trails of the off-road runs
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#c9b48a';
    ctx.lineWidth = 2;
    for (const cor of this.world.clearCorridors || []) {
      if (!cor.trail) continue;
      ctx.beginPath();
      ctx.moveTo(toPx(cor.ax), toPx(cor.az));
      ctx.lineTo(toPx(cor.bx), toPx(cor.bz));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Start line
    const sx = toPx(tr.x[tr.startIndex]);
    const sy = toPx(tr.z[tr.startIndex]);
    ctx.fillStyle = AMBER;
    ctx.fillRect(sx - 2, sy - 7, 4, 14);
    return c;
  }

  // cars: [{ x, z, yaw, color, player }]
  drawMinimap(player, cars, markers = []) {
    const ctx = this.mctx;
    const W = this.mini.width;
    const H = this.mini.height;
    ctx.clearRect(0, 0, W, H);
    const S = this.mapImage.width;
    const scale = S / WORLD.size;
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1a2229';
    ctx.fillRect(0, 0, W, H);
    const viewMeters = this.bigMap ? 1600 : 520;
    const zoom = W / (viewMeters * scale);
    ctx.translate(W / 2, H / 2);
    // Heading up: rotate so that the car's forward points to the top of the map.
    ctx.rotate(Math.PI + player.yaw);
    ctx.scale(zoom, zoom);
    const px = (player.x + WORLD.half) * scale;
    const pz = (player.z + WORLD.half) * scale;
    ctx.drawImage(this.mapImage, -px, -pz);
    for (const c of cars) {
      if (c.player) continue;
      const cx = (c.x + WORLD.half) * scale - px;
      const cz = (c.z + WORLD.half) * scale - pz;
      ctx.fillStyle = c.color;
      ctx.strokeStyle = '#0b0e12';
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.arc(cx, cz, 4.2 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    // Activity markers in screen space (upright glyphs), pinned to the rim when out of view.
    const th = Math.PI + player.yaw;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const rim = W / 2 - 10;
    for (const m of markers) {
      const lx = ((m.x + WORLD.half) * scale - px) * zoom;
      const lz = ((m.z + WORLD.half) * scale - pz) * zoom;
      let sx = lx * cs - lz * sn;
      let sy = lx * sn + lz * cs;
      const d = Math.hypot(sx, sy);
      if (d > rim) {
        if (!m.target) continue;
        sx *= rim / d;
        sy *= rim / d;
      }
      drawMarker(ctx, W / 2 + sx, H / 2 + sy, m, W * 0.06);
    }
    // Player arrow (always centre, pointing up)
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = AMBER;
    ctx.strokeStyle = '#0b0e12';
    ctx.lineWidth = 2;
    const a = W * 0.045;
    ctx.beginPath();
    ctx.moveTo(0, -a * 1.3);
    ctx.lineTo(a, a);
    ctx.lineTo(0, a * 0.45);
    ctx.lineTo(-a, a);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(230,238,243,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Full-screen north-up map with every activity, the player and a legend.
  drawWorldMap(canvas, player, cars, markers, totals) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const Wc = Math.round(canvas.clientWidth * dpr);
    const Hc = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== Wc || canvas.height !== Hc) {
      canvas.width = Wc;
      canvas.height = Hc;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, Wc, Hc);
    ctx.fillStyle = 'rgba(6,9,13,0.78)';
    ctx.fillRect(0, 0, Wc, Hc);
    const size = Math.min(Wc, Hc) * 0.84;
    const ox = (Wc - size) / 2;
    const oy = (Hc - size) / 2 + Hc * 0.02;
    ctx.drawImage(this.mapImage, ox, oy, size, size);
    ctx.strokeStyle = 'rgba(230,238,243,0.4)';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(ox, oy, size, size);
    const toX = (x) => ox + ((x + WORLD.half) / WORLD.size) * size;
    const toY = (z) => oy + ((z + WORLD.half) / WORLD.size) * size;
    for (const c of cars) {
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(toX(c.x), toY(c.z), 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const m of markers) drawMarker(ctx, toX(m.x), toY(m.z), m, 17 * dpr, true);
    // Player
    ctx.save();
    ctx.translate(toX(player.x), toY(player.z));
    ctx.rotate(Math.atan2(Math.cos(player.yaw), Math.sin(player.yaw)) + Math.PI / 2);
    ctx.fillStyle = AMBER;
    ctx.strokeStyle = '#0b0e12';
    ctx.lineWidth = 2 * dpr;
    const a = 11 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -a * 1.3);
    ctx.lineTo(a, a);
    ctx.lineTo(0, a * 0.45);
    ctx.lineTo(-a, a);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Title and legend
    ctx.fillStyle = ICE;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `800 ${22 * dpr}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
    ctx.fillText(`KARTE · ${totals.stars}/${totals.max} ★`, ox, Math.max(8 * dpr, oy - 30 * dpr));
    const legend = [
      ['C', '#3fd0ff', 'Checkpoint-Lauf'],
      ['D', '#ff4fd8', 'Drift-Zone'],
      ['B', '#f2a541', 'Blitzer'],
      ['S', '#7dff7a', 'Sprungschanze'],
    ];
    ctx.font = `600 ${13 * dpr}px "Barlow", sans-serif`;
    let lx = ox;
    const ly = oy + size + 10 * dpr;
    for (const [g, col, label] of legend) {
      drawMarker(ctx, lx + 9 * dpr, ly + 9 * dpr, { glyph: g, color: col }, 16 * dpr);
      ctx.font = `600 ${13 * dpr}px "Barlow", sans-serif`;
      ctx.fillStyle = ICE;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 22 * dpr, ly + 9 * dpr);
      lx += ctx.measureText(label).width + 44 * dpr;
    }
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

  update(dt) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el('message').hidden = true;
    }
  }

  setRace({ position, total, lap, laps, lapTime, bestLap, mode, driftTotal, driftCurrent, driftMult }) {
    const race = mode === 'race';
    this.show('pos-block', race);
    this.show('lap-block', mode !== 'free');
    this.show('time-block', mode !== 'free');
    this.show('drift-block', mode === 'free');
    if (race) this.setText('pos-value', `${position}/${total}`);
    if (mode !== 'free') {
      this.setText('lap-value', mode === 'race' ? `${Math.min(lap, laps)}/${laps}` : String(Math.max(1, lap)));
      this.setText('time-value', formatTime(lapTime));
      this.setText('best-value', formatTime(bestLap));
    } else {
      this.setText('drift-total', Math.round(driftTotal).toLocaleString('de-DE'));
      const cur = this.el('drift-current');
      if (driftCurrent > 0) {
        cur.hidden = false;
        this.setText('drift-current', `+${Math.round(driftCurrent).toLocaleString('de-DE')}  ×${driftMult}`);
      } else cur.hidden = true;
    }
  }
}

export { formatTime };
export const ROAD_HALF = ROAD.half;
