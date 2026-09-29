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
  await step('manual trip start (ticket sale, doors)', async () => {
    await page.click('#r-menu');
    await run(800);
    await page.evaluate(() => window.__bus.start({ tripId: '1a', difficulty: 'normal' }));
    await run(1500);
    await page.keyboard.press('Space');
    await run(6000);
    await shot('08-manual-doors');
    const sale = await page.evaluate(() => !document.getElementById('ticket').hidden);
    console.log('    ticket panel open:', sale);
    await page.keyboard.press('Escape');
    await run(500);
    await shot('09-pause');
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
