// Keeps the web app quick to load on a phone: fails when the built JavaScript or CSS grows past its budget.
// Run after `npm run build`. Sizes are gzipped, which is roughly what a browser downloads.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Raise these on purpose, in the same pull request as the change that needs it, and say why.
const BUDGET = {
  entry: 140 * 1024, // the main script every visit loads
  js: 260 * 1024, // every script, including pages loaded on demand
  css: 12 * 1024,
};

const dir = path.join(import.meta.dirname, '..', 'web', 'dist', 'assets');
if (!fs.existsSync(dir)) {
  console.error('No web/dist/assets. Run npm run build first.');
  process.exit(1);
}
const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(dir, f))).length;
const files = fs.readdirSync(dir);
const js = files.filter((f) => f.endsWith('.js')).map((f) => ({ f, size: gz(f) })).sort((a, b) => b.size - a.size);
const css = files.filter((f) => f.endsWith('.css')).reduce((n, f) => n + gz(f), 0);
const entry = js.find((x) => x.f.startsWith('index-'))?.size ?? 0;
const total = js.reduce((n, x) => n + x.size, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const rows = [
  ['Main script', entry, BUDGET.entry],
  ['All scripts', total, BUDGET.js],
  ['Styles', css, BUDGET.css],
];
let over = false;
for (const [name, size, budget] of rows) {
  const ok = size <= budget;
  over ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${kb(size)} of ${kb(budget)}`);
}
console.log(`Largest: ${js.slice(0, 3).map((x) => `${x.f} ${kb(x.size)}`).join(', ')}`);
if (over) {
  console.error('Over budget. Load the new code on demand (a lazy page or import()), or raise the budget in scripts/bundle-budget.mjs and say why.');
  process.exit(1);
}
