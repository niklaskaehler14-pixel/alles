// Builds a page fragment for hosting environments that wrap the page in their own
// <html>/<head>/<body> skeleton: dist/index.html plus dist/src/*.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const headInner = head
  .split('\n')
  .filter((line) => !/<meta (charset|name="viewport")/i.test(line))
  .join('\n');

const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'src'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), `${headInner.trim()}\n${body.trim()}\n`);
for (const f of fs.readdirSync(path.join(root, 'src'))) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(root, 'src', f), path.join(out, 'src', f));
}
console.log(`dist/ written (${fs.readdirSync(path.join(out, 'src')).length} modules)`);
