// Lists text wrapped in t('…') that a language file hasn't translated yet, and translations nothing uses.
// Run: node scripts/i18n-check.mjs        (add --keys to print every key, handy for a new language)
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', 'web', 'src');
const files = fs.readdirSync(root, { recursive: true }).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.') && !f.endsWith('i18n.ts'));
const keys = new Set();
// t('…') / t("…") calls, plus page and section names that are translated where they're shown.
const call = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
const label = /\blabel: (['"])((?:\\.|(?!\1).)*)\1/g;
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of src.matchAll(call)) keys.add(m[2].replace(/\\(.)/g, '$1'));
  if (/App\.tsx$|Settings\.tsx$|CommandBar\.tsx$/.test(f)) for (const m of src.matchAll(label)) keys.add(m[2].replace(/\\(.)/g, '$1'));
}

if (process.argv.includes('--keys')) {
  console.log(JSON.stringify([...keys].sort(), null, 2));
  process.exit(0);
}

let missing = 0;
const dir = path.join(root, 'locales');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const cat = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const gaps = [...keys].filter((k) => !cat[k]);
  const unused = Object.keys(cat).filter((k) => !keys.has(k));
  console.log(`${file}: ${keys.size - gaps.length}/${keys.size} translated`);
  for (const k of gaps) console.log(`  missing: ${k}`);
  for (const k of unused) console.log(`  unused:  ${k}`);
  missing += gaps.length;
}
process.exit(process.argv.includes('--strict') && missing ? 1 : 0);
