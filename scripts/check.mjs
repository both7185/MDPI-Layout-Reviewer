// Quick checks that need no browser: every source file parses, every file in src/ and data/
// is included by the page, and the build is reproducible. Used by CI.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name).split(path.sep).join('/')]);
let bad = 0;

for (const f of walk('src').filter(f => f.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error(`✗ ${f} does not parse\n${e.stderr}`); }
}
const { html, used } = build();
const all = [...walk('src'), ...walk('data')].filter(f => f !== 'src/index.html');
for (const f of all.filter(f => !used.includes(f))) { bad++; console.error(`✗ ${f} is not included by src/index.html`); }
for (const f of used.filter((f, i) => used.indexOf(f) !== i)) { bad++; console.error(`✗ ${f} is included twice`); }
if (/<!-- include:/.test(html)) { bad++; console.error('✗ an include marker is left in the built page'); }
if (build().html !== html) { bad++; console.error('✗ the build is not reproducible'); }
console.log(bad ? `${bad} problem(s)` : `OK: ${used.length} files, ${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB`);
process.exit(bad ? 1 : 0);
