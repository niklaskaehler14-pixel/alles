// Usage: node bus/tools/shot.mjs <page relative to repo root> <out.png> [w h]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const [page0, out, w = 1600, h = 1100] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.route('https://cdn.jsdelivr.net/npm/three@0.186.1/**', (route) => {
  const rel = route.request().url().split('three@0.186.1/')[1];
  const file = path.join(root, 'node_modules/three', rel);
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(file) });
});
await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => console.log('console', m.text()));
await page.goto(`http://localhost:${server.address().port}/${page0}`);
await page.waitForFunction(() => window.__done === true, null, { timeout: 240000 });
await page.screenshot({ path: out });
await browser.close();
server.close();
