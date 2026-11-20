// Builds dist/index.html: one self-contained page, as the reviewer has always been shipped.
// src/index.html is the page skeleton; each `<!-- include: path -->` is replaced by that file's
// exact contents (a marker alone on its line replaces the whole line). No other changes are made,
// so the order of the includes is the order the code runs in. No npm packages are needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = /^<!-- include: ([^ ]+) -->\n|<!-- include: ([^ ]+) -->/gm;

export function build() {
  const template = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const used = [];
  const html = template.replace(MARK, (_, onLine, inline) => {
    const rel = onLine || inline;
    used.push(rel);
    return fs.readFileSync(path.join(root, rel), 'utf8');
  });
  return { html, used };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.resolve(root, process.argv[2] || 'dist/index.html');
  const { html, used } = build();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`Built ${path.relative(root, out)} from ${used.length} files (${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB)`);
}
