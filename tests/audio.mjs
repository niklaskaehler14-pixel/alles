// Renders the synthesised engine offline at several rpm/throttle states and checks
// level, clipping and that the pitch follows the rpm. Run: node tests/audio.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/tests/blank.html`);

const results = await page.evaluate(async () => {
  const { GameAudio } = await import('/src/audio.js');
  const SR = 44100;
  const render = async (car, opts) => {
    window.AudioContext = class extends OfflineAudioContext {
      constructor() {
        super(1, SR * 1.5, SR);
      }
      resume() {
        return Promise.resolve();
      }
    };
    const a = new GameAudio();
    await a.init();
    a.lastThrottle = car.throttle;
    a.update(1 / 60, car, opts);
    const buf = await a.ctx.startRendering();
    const d = buf.getChannelData(0).slice(SR * 0.5); // skip the attack
    let peak = 0;
    let sum = 0;
    let nan = false;
    for (const x of d) {
      if (!Number.isFinite(x)) nan = true;
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
    }
    // Energy at the expected firing frequency vs. a non-harmonic neighbour (Goertzel).
    const goertzel = (f) => {
      const k = (2 * Math.PI * f) / SR;
      const coeff = 2 * Math.cos(k);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < SR * 0.9; i++) {
        const s0 = d[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return s1 * s1 + s2 * s2 - coeff * s1 * s2;
    };
    const f0 = (car.rpm / 60) * 3;
    const ratio = goertzel(f0) / Math.max(1e-9, goertzel(f0 * 1.37));
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(3), nan, harmonic: +ratio.toFixed(1) };
  };
  const base = { speed: 0, boost: 0, limiter: 0, shiftTimer: 0, onGround: true, skid: 0, surfaceMix: 1, rumble: 0 };
  const out = {};
  for (const [name, rpm, throttle] of [
    ['idle', 900, 0],
    ['3000 on', 3000, 1],
    ['6000 on', 6000, 1],
    ['6000 off', 6000, 0],
  ]) {
    out[name] = await render({ ...base, rpm, throttle }, {});
    out[name].firingHz = +((rpm / 60) * 3).toFixed(1);
  }
  out['skid 100kmh'] = await render({ ...base, rpm: 4000, throttle: 0.5, speed: 28, skid: 1 }, {});
  return out;
});
console.table(results);
await browser.close();
server.close();

let failed = 0;
for (const [name, r] of Object.entries(results)) {
  const problems = [];
  if (r.nan) problems.push('NaN samples');
  if (r.peak > 1.0) problems.push(`clipping (peak ${r.peak})`);
  if (r.rms < 0.01) problems.push(`too quiet (rms ${r.rms})`);
  if (r.firingHz && r.harmonic < 4) problems.push(`firing frequency ${r.firingHz} Hz not dominant (ratio ${r.harmonic})`);
  if (problems.length) {
    failed++;
    console.log(`FAIL ${name}: ${problems.join(', ')}`);
  }
}
if (failed) process.exit(1);
console.log('Audio checks passed.');
