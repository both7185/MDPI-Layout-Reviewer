/* =====================================================================
   Content comparison: Original vs Done
   Reports content of the original that cannot be found in the done file.
   Order does not matter (moved figures/paragraphs are fine); formatting,
   capitalization, punctuation, dash/space changes and journal/unit
   abbreviations are ignored.
   ===================================================================== */
const CMP_UNIT = { minute: 'min', minutes: 'min', mins: 'min', hour: 'h', hours: 'h', hr: 'h', hrs: 'h', second: 's', seconds: 's', sec: 's', gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', milligram: 'mg', milligrams: 'mg', liter: 'l', liters: 'l', litre: 'l', litres: 'l', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', meter: 'm', meters: 'm', metre: 'm', metres: 'm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km', figure: 'fig', figures: 'fig', figs: 'fig', table: 'tab', tables: 'tab', tabs: 'tab', equation: 'eq', equations: 'eq', eqs: 'eq', reference: 'ref', references: 'ref', refs: 'ref', acknowledgement: 'acknowledgment', acknowledgements: 'acknowledgment', acknowledgments: 'acknowledgment', conclusion: 'conclusions', percent: '%', x: '×' };
const CMP_STOP = new Set(['the', 'a', 'an', 'and', 'of', '&', 'et', 'al', 'eg', 'ie']);
const CMP_NOISE = new Set(['doi', 'https', 'http', 'www', 'org', 'com', 'available', 'online', 'accessed', 'on', 'in', 'pp', 'p', 'vol', 'no', 'eds', 'ed', 'retrieved', 'from', 'at', 'to', 'pmid', 'pmcid', 'tel', 'fax', 'e', 'mail', 'email', 'type', 'paper', 'article', 'review', 'communication', 'etc']);
function cmpNorm(raw) {
  // Greek keeps its case: α → Α (looks like A) is a real change
  let w = /[\u0370-\u03FF\u1F00-\u1FFF]/.test(raw) ? raw.normalize('NFKC') : raw.normalize('NFKC').toLowerCase();
  if (/^\.?\d/.test(w)) {
    let n = w;
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(n)) n = n.replace(/,/g, '');
    if (/^\.?\d+(\.\d+)?$/.test(n)) { const v = Number(n); if (isFinite(v)) return String(v); }
    return n.replace(/,/g, '');
  }
  if (w === '-') return '−';
  if (CMP_UNIT[w]) return CMP_UNIT[w];
  if (typeof ABBR_DICT !== 'undefined' && ABBR_DICT[w]) return ABBR_DICT[w].replace(/\.$/, '').toLowerCase();
  return w;
}
const CMP_TOK = /[\p{L}\p{M}]+|\.?\p{N}+(?:,\p{N}{3}(?!\p{N}))*(?:\.\p{N}+)?|[%×±<>≤≥≈]|−(?=\s?\.?\p{N})|(?<=^|[\s(\[=])-(?=\.?\p{N})/gu;
function cmpTokens(text) {
  const out = []; let m; CMP_TOK.lastIndex = 0;
  while ((m = CMP_TOK.exec(text)) !== null) {
    if (/^\.\d/.test(m[0]) && /[A-Za-z]$/.test(text.slice(0, m.index))) { m = Object.assign([m[0].slice(1)], { index: m.index + 1 }); } // “Fig.1”
    const t = cmpNorm(m[0]);
    if (!t || (CMP_STOP.has(t) && !(m[0].length === 1 && /^[-‐‑–]/.test(text.slice(m.index + 1))))) continue; // “A-amylase” is not the article
    out.push({ t, s: m.index, e: m.index + m[0].length, raw: m[0] });
  }
  return out;
}
function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const SYMBOL_GREEK = (() => { const lo = 'abcdefghijklmnopqrstuvwxyz', gl = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ', up = 'ABCDEFGHIKLMNOPQRSTUWXYZ', gu = 'ΑΒΧΔΕΦΓΗΙΚΛΜΝΟΠΘΡΣΤΥΩΞΨΖ'; const m = {}; for (let i = 0; i < lo.length; i++) m[lo[i]] = gl[i]; for (let i = 0; i < up.length; i++) m[up[i]] = gu[i]; return m; })();
const isSymbolFont = f => /^symbol$/i.test(f || '');
const GREEK_RE = /[Ͱ-Ͽἀ-῿]/;
const isNumTok = t => /^[\d.]+$/.test(t);
function similarTok(a, b) {
  if (a === b) return true;
  // a Greek letter turning into a Latin one (α → a, β → b) is a real change
  if (GREEK_RE.test(a) || GREEK_RE.test(b)) { const g = x => (x.match(/[\u0370-\u03FF\u1F00-\u1FFF]/g) || []).join(''); if (g(a) !== g(b)) return false; }
  if (isNumTok(a) || isNumTok(b)) return false;
  if (a.length >= 2 && b.length >= 2 && (a.startsWith(b) || b.startsWith(a))) return true; // abbreviation
  const L = Math.max(a.length, b.length);
  return lev(a, b) <= Math.max(1, Math.floor(L / 4));
}

/* Collect every paragraph's text from a raw part (document, footnotes, …): text boxes and table cells included */
function rawParagraphTexts(xml) {
  if (!xml) return [];
  const d = parseXml(xml); const out = [];
  for (const p of d.getElementsByTagNameNS(W, 'p')) {
    let s = '';
    const walk = el => {
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === W && c.localName === 'p') continue; // nested paragraph (text box) is its own entry
        if (c.namespaceURI === W && (c.localName === 'del' || c.localName === 'moveFrom' || c.localName === 'instrText')) continue;
        if (c.namespaceURI === MCNS && c.localName === 'Fallback') continue;
        if ((c.namespaceURI === W || c.namespaceURI === MNS) && c.localName === 't') { const rf = c.parentNode && c.parentNode.localName === 'r' ? kid(kid(c.parentNode, 'rPr'), 'rFonts') : null; const sym = rf && (isSymbolFont(wa(rf, 'ascii')) || isSymbolFont(wa(rf, 'hAnsi'))); s += sym ? c.textContent.replace(/[A-Za-z]/g, x => SYMBOL_GREEK[x] || x) : c.textContent; continue; }
        if (c.namespaceURI === W && (c.localName === 'tab' || c.localName === 'br')) { s += ' '; continue; }
        if (c.namespaceURI === W && c.localName === 'sym') { const code = parseInt(wa(c, 'char') || '0', 16); const ch = String.fromCharCode(code >= 0xF000 ? code - 0xF000 : code); s += isSymbolFont(wa(c, 'font') || 'Symbol') ? (SYMBOL_GREEK[ch] || ch) : ch; continue; }
        walk(c);
      }
    };
    walk(p);
    if (s.trim()) out.push(s);
  }
  return out;
}
function mathStrings(xml) {
  if (!xml) return [];
  const d = parseXml(xml); const out = [];
  for (const m of d.getElementsByTagNameNS(MNS, 'oMath')) {
    if (m.parentNode && m.parentNode.namespaceURI === MNS && m.parentNode.localName !== 'oMathPara') continue;
    const s = Array.from(m.getElementsByTagNameNS(MNS, 't')).map(x => x.textContent).join('').replace(/\s+/g, '').normalize('NFKC');
    if (s) out.push(s);
  }
  return out;
}
async function sha1(buf) {
  const h = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function loadPackage(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const read = async p => { const f = zip.file(p); return f ? f.async('string') : null; };
  const rootRels = await read('_rels/.rels');
  let docPath = 'word/document.xml';
  if (rootRels) { const m = rootRels.match(/Target="\/?([^"]*document[^"]*\.xml)"[^>]*Type="[^"]*officeDocument"|Type="[^"]*\/officeDocument"[^>]*Target="\/?([^"]+)"/); if (m) docPath = m[1] || m[2]; }
  const dir = docPath.replace(/[^/]+$/, '');
  const relsPath = dir + '_rels/' + docPath.split('/').pop() + '.rels';
  const relsXml = await read(relsPath);
  const relsDoc = relsXml ? parseXml(relsXml) : parseXml(`<Relationships xmlns="${RELNS}"/>`);
  const rels = {};
  for (const r of relsDoc.getElementsByTagNameNS(RELNS, 'Relationship')) rels[r.getAttribute('Id')] = { type: r.getAttribute('Type'), target: r.getAttribute('Target'), external: r.getAttribute('TargetMode') === 'External' };
  const relTarget = typeRe => { for (const id in rels) if (typeRe.test(rels[id].type)) { const t = rels[id].target; return t.startsWith('/') ? t.slice(1) : dir + t; } return null; };
  const files = {
    document: await read(docPath),
    styles: await read(relTarget(/\/styles$/) || dir + 'styles.xml'),
    numbering: await read(relTarget(/\/numbering$/) || dir + 'numbering.xml'),
    theme: await read(relTarget(/\/theme$/) || dir + 'theme/theme1.xml'),
    settings: await read(relTarget(/\/settings$/) || dir + 'settings.xml'),
    footnotes: await read(relTarget(/\/footnotes$/) || dir + 'footnotes.xml'),
    endnotes: await read(relTarget(/\/endnotes$/) || dir + 'endnotes.xml')
  };
  if (!files.document) throw new Error('word/document.xml not found');
  // images: rId → {hash, path, bytes}
  const images = {};
  for (const id in rels) {
    if (!/\/image$/.test(rels[id].type) || rels[id].external) continue;
    const path = rels[id].target.startsWith('/') ? rels[id].target.slice(1) : (dir + rels[id].target).replace(/[^/]+\/\.\.\//g, '');
    const f = zip.file(path); if (!f) continue;
    const bytes = await f.async('uint8array');
    images[id] = { path, bytes, hash: await sha1(bytes), ext: path.split('.').pop().toLowerCase() };
  }
  return { zip, docPath, dir, relsPath, relsDoc, rels, files, images };
}

