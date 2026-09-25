// End-to-end smoke test in headless Chromium (software WebGL).
// Usage: node tests/e2e.mjs [outDir]   — writes screenshots and fails on page errors.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'test-output'));
fs.mkdirSync(outDir, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const openContexts = new Set();

async function openGame({ settings = {}, viewport = { width: 960, height: 540 }, touch = false, name }) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  openContexts.add(context);
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.186.1/**', (route) => {
    const rel = route.request().url().split('three@0.186.1/')[1];
    const file = path.join(root, 'node_modules/three', rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(file) });
  });
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.addInitScript((s) => {
    localStorage.setItem('nordkamm.settings.v1', JSON.stringify(s));
    localStorage.removeItem('nordkamm.progress.v1');
  }, settings);
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => window.__nordkamm && window.__nordkamm.state === 'menu', null, { timeout: 180000 });
  console.log(`[${name}] loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { page, context, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const g = window.__nordkamm;
    const v = g.vehicle;
    return {
      state: g.state,
      speed: +(v.speed * 3.6).toFixed(1),
      gear: v.gear,
      rpm: Math.round(v.rpm),
      x: +v.x.toFixed(1),
      z: +v.z.toFixed(1),
      y: +v.y.toFixed(2),
      onGround: v.onGround,
      fps: +g.fps.value.toFixed(1),
      lap: g.race?.entries[0]?.lap,
      ai: g.ai.map((a) => Math.round(a.speed * 3.6)),
    };
  });

// Fast-forward the simulation (software WebGL renders only ~1 frame per second).
const sim = (page, seconds) => page.evaluate((t) => window.__nordkamm.simulateFor(t), seconds);
const shot = async (page, file) => {
  await sleep(300);
  await page.screenshot({ path: path.join(outDir, file) });
};

async function waitRunning(page) {
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => window.__nordkamm.state === 'running')) return;
    await sim(page, 1);
  }
  throw new Error('race did not start');
}

async function run(name, fn) {
  if (only && !only.includes(name)) return;
  console.log(`\n=== ${name}`);
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL ${name}: ${e.message}`);
  } finally {
    // A page left running keeps rendering in software and slows down every later scenario.
    for (const c of openContexts) await c.close().catch(() => {});
    openContexts.clear();
  }
}

await run('race-desktop', async () => {
  const { page, context, errors } = await openGame({ name: 'race', settings: { mode: 'race', laps: 1, time: 'evening', quality: 'high', paint: 0, camera: 'chase' } });
  await shot(page, '01-menu.png');
  await page.click('#start-btn');
  await sim(page, 2.5);
  await shot(page, '02-countdown.png');
  await waitRunning(page);
  console.log('running', await state(page));
  await page.keyboard.down('KeyW');
  await sim(page, 4);
  console.log('after 4s throttle', await state(page));
  await shot(page, '03-race-chase.png');
  await sim(page, 6);
  await page.keyboard.up('KeyW');
  const s1 = await state(page);
  console.log('after 10s', s1);
  if (s1.speed < 100) throw new Error(`car too slow after throttle: ${s1.speed} km/h`);
  if (Math.max(...s1.ai) < 60) throw new Error('AI cars are not driving');
  const camera = async () => {
    await page.keyboard.press('KeyC');
    await sim(page, 0.05);
    return page.evaluate(() => window.__nordkamm.rig.mode);
  };
  await camera();
  await page.keyboard.down('KeyW');
  await sim(page, 1.0);
  await shot(page, '04a-far.png');
  if ((await camera()) !== 'cockpit') throw new Error('camera did not switch to cockpit');
  await sim(page, 1.0);
  await shot(page, '04-cockpit.png');
  await page.keyboard.up('KeyW');
  await camera();
  await sim(page, 0.5);
  await shot(page, '05-hood.png');
  if ((await camera()) !== 'chase') throw new Error('camera cycle broken');
  await sim(page, 0.3);
  // Handbrake drift
  await page.keyboard.down('KeyA');
  await page.keyboard.down('Space');
  await sim(page, 0.9);
  await page.keyboard.up('Space');
  await page.keyboard.down('KeyW');
  await sim(page, 0.6);
  await shot(page, '06-drift.png');
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');
  await sim(page, 0.1);
  await shot(page, '07-pause.png');
  const ps = await state(page);
  if (ps.state !== 'paused') throw new Error('pause did not open');
  await page.click('#resume-btn');
  await page.keyboard.press('KeyR');
  await sim(page, 0.5);
  console.log('final', await state(page));
  if (errors.length) throw new Error(errors.join('\n'));
  await context.close();
});

await run('finish', async () => {
  const { page, context, errors } = await openGame({ name: 'finish', settings: { mode: 'race', laps: 1, time: 'day', quality: 'low', paint: 4 } });
  await page.click('#start-btn');
  await waitRunning(page);
  await page.keyboard.down('KeyW');
  await sim(page, 5);
  // Jump to the end of the lap: every sector counts as visited, car placed before the line.
  await page.evaluate(() => {
    const g = window.__nordkamm;
    const me = g.race.entries[0];
    if (me.lap !== 1) throw new Error(`expected lap 1 after the start, got ${me.lap}`);
    me.mask = 0x3ff;
    me.prevS = null; // a teleport back over the line must not count as driving backwards
    const tr = g.data.track;
    const p = tr.pointAt(tr.startS - 60, 0, {});
    const q = tr.nearest(p.x, p.z, p.index, {});
    g.vehicle.reset(p.x, g.data.groundHeight(p.x, p.z, q), p.z, p.heading);
    g.vehicle.vz = Math.cos(p.heading) * 40;
    g.vehicle.vx = Math.sin(p.heading) * 40;
    g.vehicle.gear = 4;
  });
  await sim(page, 3);
  await page.keyboard.up('KeyW');
  const st = await page.evaluate(() => window.__nordkamm.state);
  if (st !== 'finished') throw new Error(`race not finished: ${st}`);
  await sleep(3600);
  await sim(page, 0.1);
  const visible = await page.evaluate(() => !document.getElementById('results').hidden);
  if (!visible) throw new Error('results table not shown');
  await shot(page, '13-results.png');
  const rows = await page.$$eval('#results-body tr', (r) => r.length);
  if (rows !== 6) throw new Error(`results should list 6 drivers, got ${rows}`);
  await page.click('#results-menu-btn');
  await sim(page, 0.1);
  if ((await page.evaluate(() => window.__nordkamm.state)) !== 'menu') throw new Error('back to menu failed');
  if (errors.length) throw new Error(errors.join('\n'));
  await context.close();
});

await run('openworld', async () => {
  const { page, context, errors } = await openGame({ name: 'openworld', settings: { mode: 'free', time: 'day', quality: 'medium', paint: 0, camera: 'chase' } });
  await page.click('#start-btn');
  await waitRunning(page);
  // Roll into the start ring of the city run.
  await page.evaluate(() => {
    const g = window.__nordkamm;
    g.ai.forEach((a) => (a.model.root.visible = false));
    g.ai = [];
    const r = g.data.routes.find((x) => x.id === 'run-city');
    const cp = r.checkpoints[0];
    const h = Math.atan2(cp.x - r.start.x, cp.z - r.start.z);
    g.placeCar(r.start.x - Math.sin(h) * 12, r.start.z - Math.cos(h) * 12, h);
    g.vehicle.vx = Math.sin(h) * 8;
    g.vehicle.vz = Math.cos(h) * 8;
  });
  await sim(page, 2);
  const started = await page.evaluate(() => ({ run: !!window.__nordkamm.openWorld.run, holding: window.__nordkamm.openWorld.holding }));
  if (!started.run || !started.holding) throw new Error(`run did not start: ${JSON.stringify(started)}`);
  await sim(page, 3.5);
  await shot(page, '14-ow-run.png');
  const cps = await page.evaluate(() => window.__nordkamm.openWorld.run.route.checkpoints.length);
  for (let i = 0; i < cps; i++) {
    await page.evaluate(() => {
      const g = window.__nordkamm;
      const active = g.openWorld.run;
      const r = active.route;
      const cp = r.checkpoints[active.next];
      const from = active.next === 0 ? r.start : r.checkpoints[active.next - 1];
      const h = Math.atan2(cp.x - from.x, cp.z - from.z);
      g.placeCar(cp.x - Math.sin(h) * 14, cp.z - Math.cos(h) * 14, h);
      g.vehicle.vx = Math.sin(h) * 15;
      g.vehicle.vz = Math.cos(h) * 15;
      g.vehicle.gear = 2;
    });
    await sim(page, 1.2);
  }
  const runResult = await page.evaluate(() => ({ active: !!window.__nordkamm.openWorld.run, best: window.__nordkamm.openWorld.best('run-city'), toast: document.getElementById('result-toast').textContent }));
  console.log('city run', runResult);
  if (runResult.active || !(runResult.best > 0)) throw new Error('checkpoint run did not finish');
  await shot(page, '15-ow-finish.png');
  // Speed trap: pass the first one at speed.
  await page.evaluate(() => {
    const g = window.__nordkamm;
    const t = g.data.speedTraps[1];
    const p = g.data.track.pointAt(t.s - 70, 0, {});
    g.placeCar(p.x, p.z, p.heading);
    g.vehicle.vx = Math.sin(p.heading) * 55;
    g.vehicle.vz = Math.cos(p.heading) * 55;
    g.vehicle.gear = 5;
  });
  await page.keyboard.down('KeyW');
  await sim(page, 1.6);
  await page.keyboard.up('KeyW');
  const trap = await page.evaluate(() => window.__nordkamm.openWorld.best(window.__nordkamm.data.speedTraps[1].id));
  console.log('speed trap', trap);
  if (!(trap > 150)) throw new Error(`speed trap did not register: ${trap}`);
  // Jump: approach a ramp at speed.
  await page.evaluate(() => {
    const g = window.__nordkamm;
    const r = g.data.ramps.find((x) => x.name === 'Westschanze') || g.data.ramps[0];
    g.placeCar(r.x - Math.sin(r.yaw) * 40, r.z - Math.cos(r.yaw) * 40, r.yaw);
    g.vehicle.vx = Math.sin(r.yaw) * 28;
    g.vehicle.vz = Math.cos(r.yaw) * 28;
    g.vehicle.gear = 3;
  });
  await page.keyboard.down('KeyW');
  await sim(page, 1.4);
  await shot(page, '16-ow-jump.png');
  await sim(page, 3);
  await page.keyboard.up('KeyW');
  const jump = await page.evaluate(() => {
    const g = window.__nordkamm;
    const r = g.data.ramps.find((x) => x.name === 'Westschanze') || g.data.ramps[0];
    return g.openWorld.best(r.id);
  });
  console.log('jump', jump);
  if (!(jump > 15)) throw new Error(`jump did not register: ${jump}`);
  // World map
  await page.keyboard.press('KeyM');
  await sim(page, 0.1);
  await shot(page, '17-ow-map.png');
  await page.keyboard.press('KeyM');
  if (errors.length) throw new Error(errors.join('\n'));
  await context.close();
});

await run('night-free', async () => {
  const { page, context, errors } = await openGame({ name: 'night', settings: { mode: 'free', time: 'night', quality: 'medium', paint: 1, camera: 'chase' } });
  await page.click('#start-btn');
  await waitRunning(page);
  await page.keyboard.down('KeyW');
  await sim(page, 5);
  await page.keyboard.up('KeyW');
  await shot(page, '08-night.png');
  console.log('night', await state(page));
  // Handbrake drift scores points in free mode. Done on an empty straight: any contact
  // (e.g. with traffic) correctly cancels the running combo and would make the check random.
  await page.evaluate(() => {
    const g = window.__nordkamm;
    g.ai.forEach((a) => (a.model.root.visible = false));
    g.ai = [];
    const tr = g.data.track;
    let best = 0;
    for (let s = 300; s < tr.length; s += 20) {
      let k = 0;
      for (let d = 0; d < 200; d += 10) k = Math.max(k, Math.abs(tr.curvatureAt(s + d)));
      if (k < 0.0015) {
        best = s;
        break;
      }
    }
    const p = tr.pointAt(best, -3, {});
    const q = tr.nearest(p.x, p.z, p.index, {});
    g.vehicle.reset(p.x, g.data.groundHeight(p.x, p.z, q), p.z, p.heading);
    g.vehicle.vx = Math.sin(p.heading) * 30;
    g.vehicle.vz = Math.cos(p.heading) * 30;
    g.vehicle.gear = 3;
  });
  const sample = () =>
    page.evaluate(() => {
      const g = window.__nordkamm;
      return { angle: Math.round(Math.abs(g.vehicle.driftAngle) * 57.3), speed: Math.round(g.vehicle.speed * 3.6), points: Math.round(g.drift.points + g.drift.total), hand: g.input.state.handbrake, steer: g.input.state.steer };
    });
  let drift = 0;
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyA');
  await page.keyboard.down('Space');
  for (let i = 0; i < 10; i++) {
    if (i === 4) await page.keyboard.up('Space');
    await sim(page, 0.2);
    const smp = await sample();
    if (process.env.VERBOSE) console.log(smp);
    drift = Math.max(drift, smp.points);
  }
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  console.log('drift points', drift);
  if (drift <= 0) throw new Error('drift scoring did not register');
  if (errors.length) throw new Error(errors.join('\n'));
  await context.close();
});

await run('day-time-trial', async () => {
  const { page, context, errors } = await openGame({ name: 'day', settings: { mode: 'time', time: 'day', quality: 'high', paint: 3, camera: 'far' } });
  await shot(page, '09-day-menu.png');
  await page.click('#start-btn');
  await waitRunning(page);
  await page.keyboard.down('KeyW');
  await sim(page, 7);
  await shot(page, '10-day-far.png');
  await page.keyboard.up('KeyW');
  console.log('day', await state(page));
  if (errors.length) throw new Error(errors.join('\n'));
  await context.close();
});

await run('mobile', async () => {
  const { page, context, errors } = await openGame({ name: 'mobile', viewport: { width: 844, height: 390 }, touch: true, settings: { mode: 'race', laps: 1, time: 'day', quality: 'low', paint: 2 } });
  await shot(page, '11-mobile-menu.png');
  await page.tap('#start-btn');
  await waitRunning(page);
  const center = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    return { clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
  };
  const zone = page.locator('.pedals');
  const touch = { pointerId: 7, pointerType: 'touch', isPrimary: true };
  await zone.dispatchEvent('pointerdown', { ...touch, ...(await center('.pedal.gas')) });
  await sim(page, 5);
  await shot(page, '12-mobile-drive.png');
  const s = await state(page);
  console.log('mobile', s);
  if (s.speed < 60) throw new Error(`touch gas did not accelerate: ${s.speed}`);
  // Slide the same thumb from gas onto the brake: the car must brake.
  await zone.dispatchEvent('pointermove', { ...touch, ...(await center('.pedal.brake')) });
  await sim(page, 1.5);
  const braked = await state(page);
  console.log('after sliding to brake', braked);
  if (braked.speed > s.speed - 40) throw new Error(`sliding onto the brake did not brake: ${s.speed} -> ${braked.speed}`);
  await zone.dispatchEvent('pointerup', touch);
  if (errors.length) throw new Error(errors.join('\n'));
  await context.close();
});

await browser.close();
server.close();
if (failures.length) {
  console.log(`\n${failures.length} scenario(s) failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nAll browser scenarios passed.');
