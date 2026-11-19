// Regression test: runs the same manuscripts through two builds of the reviewer and reports
// every difference in findings, stats and the Word file written back.
//
//   node scripts/regress.mjs --manifest <jobs.json> [--baseline old.html] [--candidate dist/index.html]
//
// The manuscripts are confidential: keep them and the manifest outside this repository.
// Manifest (paths are relative to the manifest file):
//   { "jobs": [
//       { "type": "check", "file": "paper.docx" },
//       { "type": "xml",   "word": "paper-fc.docx", "xml": "paper.xml" },
//       { "type": "main",  "orig": "paper-ori.docx", "done": "paper-done.docx" },
//       { "type": "ref",   "orig": "refs-ori.docx",  "done": "refs-done.docx" } ] }
// Without --baseline, the candidate's results are written to --out (default regress-out.json)
// so they can be compared later with --expect <that file>.
// Needs Playwright with Chromium (`npm install` then `npx playwright install chromium`).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? a.concat([[x.slice(2), all[i + 1]]]) : a), []));
if (!args.manifest) { console.error('usage: node scripts/regress.mjs --manifest jobs.json [--baseline old.html] [--candidate dist/index.html] [--expect results.json] [--out results.json]'); process.exit(2); }
const manDir = path.dirname(path.resolve(args.manifest));
const jobs = JSON.parse(fs.readFileSync(args.manifest, 'utf8')).jobs;
const abs = p => path.resolve(manDir, p);
const label = j => j.type + ': ' + [j.file, j.word, j.xml, j.orig, j.done].filter(Boolean).map(p => path.basename(p)).join(' + ');

async function runAll(htmlPath) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const files = new Map();
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.host !== 'localhost:5917') return route.abort();
    if (u.pathname === '/app.html') return route.fulfill({ body: fs.readFileSync(htmlPath), contentType: 'text/html; charset=utf-8' });
    const f = files.get(decodeURIComponent(u.pathname.slice(3)));
    return f ? route.fulfill({ body: fs.readFileSync(f), contentType: 'application/octet-stream' }) : route.fulfill({ status: 404 });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // localhost counts as a secure context, so crypto.subtle works as it does on github.io
  await page.goto('http://localhost:5917/app.html');
  const out = {};
  for (const j of jobs) {
    const keys = {};
    for (const k of ['file', 'word', 'xml', 'orig', 'done']) if (j[k]) { const id = String(files.size); files.set(id, abs(j[k])); keys[k] = '/f/' + id; }
    const t0 = Date.now();
    out[label(j)] = await page.evaluate(async ({ type, keys }) => {
      const get = async (k, asText) => { const r = await fetch(keys[k]); return asText ? r.text() : r.arrayBuffer(); };
      const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
      try {
        let res;
        if (type === 'check') res = await processDocx(await get('file'), { lang: 'en', parts: undefined, compact: false, includeCheck: true, author: 'MDPI Layout Checker' });
        else if (type === 'xml') res = await compareXml(await get('word'), await get('xml', true), { lang: 'en' });
        else res = await compareDocx(await get('orig'), await get('done'), { lang: 'en', mode: type });
        const r = { ...res };
        if (res.blob) {
          // hash every part of the Word file written back; comment dates are the run time, so they are left out
          const zip = await JSZip.loadAsync(res.blob); const parts = {};
          for (const name of Object.keys(zip.files).sort()) if (!zip.files[name].dir) parts[name] = await sha((await zip.file(name).async('string')).replace(/ w:date="[^"]*"/g, ''));
          r.blob = parts;
        }
        return JSON.parse(JSON.stringify(r));
      } catch (e) { return { error: String(e && e.stack || e) }; }
    }, { type: j.type, keys });
    console.log(`  ${label(j)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  await browser.close();
  if (errors.length) out['page errors'] = errors;
  return out;
}

function diff(a, b, at = '', acc = []) {
  if (acc.length > 40) return acc;
  if (JSON.stringify(a) === JSON.stringify(b)) return acc;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], at + (Array.isArray(a) ? `[${k}]` : '.' + k), acc);
  } else acc.push(`${at}: ${JSON.stringify(a)?.slice(0, 200)} → ${JSON.stringify(b)?.slice(0, 200)}`);
  return acc;
}

const candidate = path.resolve(args.candidate || 'dist/index.html');
console.log('Candidate', candidate);
const got = await runAll(candidate);
let expected = null;
if (args.baseline) { console.log('Baseline', path.resolve(args.baseline)); expected = await runAll(path.resolve(args.baseline)); }
else if (args.expect) expected = JSON.parse(fs.readFileSync(args.expect, 'utf8'));
else { const o = args.out || 'regress-out.json'; fs.writeFileSync(o, JSON.stringify(got)); console.log('Wrote', o); process.exit(0); }

let bad = 0;
for (const k of new Set([...Object.keys(expected), ...Object.keys(got)])) {
  const d = diff(expected[k], got[k]);
  const n = got[k]?.findings?.length ?? got[k]?.items?.length;
  if (d.length) { bad++; console.log(`✗ ${k}\n    ` + d.join('\n    ')); }
  else if (got[k]?.error) { bad++; console.log(`✗ ${k}: fails in both builds: ${got[k].error.split('\n')[0]}`); }
  else console.log(`✓ ${k}${n != null ? ` (${n} findings)` : ''}`);
}
console.log(bad ? `\n${bad} job(s) differ` : '\nAll jobs identical');
process.exit(bad ? 1 : 0);
