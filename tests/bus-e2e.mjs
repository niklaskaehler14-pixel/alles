// Browser test for the bus game: loads the page in headless Chromium, checks the menu, drives
// a trip with the autopilot, takes screenshots and fails on any page error.
// Usage: node tests/bus-e2e.mjs [outDir]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'bus/tools/shots'));
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));

const errors = [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('https://cdn.jsdelivr.net/npm/three@0.186.1/**', (route) => {
  const rel = route.request().url().split('three@0.186.1/')[1];
  const file = path.join(root, 'node_modules/three', rel);
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(file) });
});
await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const step = async (name, fn) => {
  const t0 = Date.now();
  await fn();
  console.log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
};
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const state = () => page.evaluate(() => window.__bus.state());
const run = (ms) => page.waitForTimeout(ms);

let failed = false;
try {
  await step('page loads', async () => {
    await page.goto(`http://localhost:${server.address().port}/bus/index.html`);
    await page.waitForFunction(() => window.__bus && window.__bus.ready === true, null, { timeout: 180000 });
  });
  await step('menu', async () => {
    await run(1500);
    const rows = await page.locator('.trip-row').count();
    if (rows < 5) throw new Error(`expected 5 trips on the board, got ${rows}`);
    await shot('01-menu');
  });
  await step('start demo trip', async () => {
    await page.click('#btn-demo');
    await run(4000);
    const s = await state();
    if (s.mode !== 'drive') throw new Error(`mode ${s.mode}`);
    await shot('02-demo-chase');
  });
  await step('cockpit view', async () => {
    await page.evaluate(() => {
      window.__bus.W.rig.set('cockpit');
    });
    await run(2500);
    await shot('03-cockpit');
  });
  await step('drive to the second stop', async () => {
    await page.evaluate(() => window.__bus.fastForward(150));
    await run(2500);
    const s = await state();
    console.log('   ', JSON.stringify({ progress: s.progress, next: s.next, kmh: s.kmh.toFixed(1), faults: s.faults, calls: s.calls, triangles: s.triangles }));
    await shot('04-cockpit-later');
    await page.evaluate(() => window.__bus.W.rig.set('chase'));
    await run(2000);
    await shot('05-chase-later');
  });
  await step('line map', async () => {
    await page.keyboard.press('KeyM');
    await run(600);
    await shot('06-map');
    await page.keyboard.press('KeyM');
  });
  await step('finish trip and report', async () => {
    for (let i = 0; i < 12; i++) {
      const s = await state();
      if (s.report) break;
      await page.evaluate(() => window.__bus.fastForward(120));
    }
    await run(1500);
    const s = await state();
    if (!s.report) throw new Error(`no report (finished=${s.finished}, next=${s.next})`);
    console.log('    faults', JSON.stringify(s.faults));
    await shot('07-report');
  });
  await step('menu tabs', async () => {
    await page.click('#r-menu');
    await run(800);
    await page.click('[data-tab="fleet"]');
    await run(400);
    const cards = await page.locator('.bus-card').count();
    if (cards !== 4) throw new Error(`expected 4 buses in the fleet, got ${cards}`);
    await shot('08-fleet');
    await page.click('[data-tab="drive"]');
  });
  await step('ticket sale by hand', async () => {
    await page.evaluate(() => window.__bus.start({ tripId: '1a', difficulty: 'normal' }));
    await run(1000);
    await page.keyboard.press('Space');
    const ok = await page.evaluate(() => {
      const B = window.__bus;
      for (let i = 0; i < 60 && !B.G.sim.trip.pendingSale; i++) B.fastForward(1);
      return !!B.G.sim.trip.pendingSale;
    });
    if (!ok) throw new Error('no passenger asked for a ticket');
    await run(500);
    if (await page.locator('#ticket').isHidden()) throw new Error('ticket panel not shown');
    // Sell the right ticket with exact change.
    const plan = await page.evaluate(() => {
      const r = window.__bus.G.sim.trip.pendingSale.request;
      return { fare: r.fare, change: Math.round((r.paid - r.price) * 100) };
    });
    await page.click(`[data-fare="${plan.fare}"]`);
    let cents = plan.change;
    const coins = [1000, 500, 200, 100, 50, 20, 10];
    const labels = ['10 €', '5 €', '2 €', '1 €', '50 ct', '20 ct', '10 ct'];
    for (let k = 0; k < coins.length; k++) {
      while (cents >= coins[k]) {
        await page.locator('#t-coins button', { hasText: labels[k] }).first().click();
        cents -= coins[k];
      }
    }
    await shot('09-ticket');
    await page.click('#t-issue');
    await run(400);
    const sold = await page.evaluate(() => window.__bus.G.sim.trip.ticketsSold);
    const errs = await page.evaluate(() => window.__bus.G.sim.trip.ticketErrors);
    if (sold < 1 || errs !== 0) throw new Error(`ticket sale failed (sold ${sold}, errors ${errs})`);
  });
  await step('drive by keyboard', async () => {
    // Finish boarding, then close the doors, release the parking brake, indicate and go.
    await page.evaluate(() => {
      const B = window.__bus;
      const t = B.G.sim.trip;
      for (let i = 0; i < 120 && (t.pendingSale || t.nextStop.waiting.length); i++) {
        if (t.pendingSale) {
          const r = t.pendingSale.request;
          t.sellTicket(r.fare, r.price, Math.round((r.paid - r.price) * 100) / 100);
        }
        B.fastForward(1);
      }
      B.fastForward(Math.max(0, t.nextStop.sched - t.clock));
    });
    await page.keyboard.press('Space');
    await page.evaluate(() => window.__bus.fastForward(4));
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyQ');
    await page.keyboard.down('KeyW');
    await run(4000);
    await page.keyboard.up('KeyW');
    const s1 = await state();
    await shot('10-keyboard-drive');
    if (s1.kmh < 2) throw new Error(`bus did not move (${s1.kmh.toFixed(1)} km/h)`);
    await page.keyboard.down('KeyS');
    await run(3000);
    await page.keyboard.up('KeyS');
    const s2 = await state();
    console.log(`    ${s1.kmh.toFixed(1)} km/h after gas, ${s2.kmh.toFixed(1)} km/h after braking, faults: ${JSON.stringify(s2.faults)}`);
    if (s2.kmh >= s1.kmh) throw new Error('brake had no effect');
    await page.keyboard.press('Escape');
    await run(500);
    await shot('11-pause');
  });
} catch (e) {
  failed = true;
  console.error('✗', e.message);
  await shot('error').catch(() => {});
}
await browser.close();
server.close();
if (errors.length) {
  console.error('Page errors:');
  for (const e of errors) console.error('  ', e);
}
process.exit(failed || errors.length ? 1 : 0);
