/* ---- Word side ---- */
// formatting from the add-style template (styles named _1_… to _9_…) only marks text for the HTML conversion (citations bold, table headers bold …): compare the formatting underneath
const xTpl = st => !!st && /^_\d+_/.test(st.name || '');
let X_MS = null; const X_FW = new WeakMap();
function xFmtW(P, i) {
  const f = P.fmt(i); const c = P.chars[i];
  if (!X_MS || !c || !c.r) return f;
  if (X_FW.has(c.r)) return X_FW.get(c.r);
  if (P._tpl === undefined) P._tpl = (P.chain || []).some(xTpl);
  const d = readRPr(kid(c.r, 'rPr'), {});
  let e = f;
  if (P._tpl || (d.rStyle && styleChain(X_MS, d.rStyle).some(xTpl))) {
    e = Object.assign({}, X_MS.docR, P.tsR || {});
    for (const st of P.chain || []) if (!xTpl(st)) Object.assign(e, st.rPr);
    if (d.rStyle) for (const st of styleChain(X_MS, d.rStyle)) if (!xTpl(st)) Object.assign(e, st.rPr);
    Object.assign(e, d); e.font = f.font; e.size = f.size;
  }
  X_FW.set(c.r, e); return e;
}
// an equation made with MathType (an OLE object, Equation.DSMT4): Word keeps only a picture, so it is not compared
const xIsOleEq = n => !!n && n.localName === 'object' && [...n.getElementsByTagName('*')].some(e => /Equation/i.test(e.getAttribute('ProgID') || ''));
const X_OPQ = (P, pos) => ({ atom: true, lin: [{ c: '▣', opq: true }], math: true, opq: true, P, pos });
// MathType “Convert Equations” to MathML text: <!-- MathType@Translator… --> <math>…</math> <!-- MathType@End… --> typed as text, often over several paragraphs
function xMtPrep(paras) {
  const S0 = '<!-- MathType@Translator', E0 = 'MathType@End';
  for (let k = 0; k < paras.length; k++) {
    const P = paras[k]; let from = 0;
    for (let guard = 0; guard < 200; guard++) {
      const s = P.text.indexOf(S0, from); if (s < 0) break;
      let txt = '', endP = -1, endPos = -1;
      for (let j = k; j < paras.length && j < k + 80; j++) {
        const Q = paras[j]; const st = j === k ? s : 0; const ei = Q.text.indexOf(E0, j === k ? s + S0.length : 0);
        if (ei >= 0) { const cl = Q.text.indexOf('-->', ei); endPos = cl >= 0 ? cl + 3 : Q.text.length; txt += Q.text.slice(st, endPos); endP = j; break; }
        txt += Q.text.slice(st) + '\n';
      }
      if (endP < 0) break;
      let atom = null; const m = txt.match(/<math[\s>][\s\S]*<\/math>/);
      if (m) { let src = m[0]; if (!/xmlns\s*=/.test(src.slice(0, src.indexOf('>')))) src = src.replace(/^<math/, '<math xmlns="' + MMLNS + '"'); try { const d = new DOMParser().parseFromString(src, 'application/xml'); if (!d.getElementsByTagName('parsererror').length && d.documentElement.namespaceURI === MMLNS) atom = { atom: true, lin: linMml(d.documentElement).map(x => ({ ...x, math: true })), math: true, P, pos: s }; } catch (e) { /* shown as an opaque equation */ } }
      if (!atom) atom = X_OPQ(P, s);
      for (let q = k; q <= endP; q++) { const Q = paras[q]; (Q._mtR = Q._mtR || []).push({ s: q === k ? s : 0, e: q === endP ? endPos : Q.text.length, atom: q === k ? atom : null }); if (q > k) Q._mtJoin = true; if (q < endP) Q._mtJoinNext = true; }
      const nx = paras[endP + 1]; if (nx && !paras[endP].text.slice(endPos).trim() && (nx.tbl || null) === (paras[endP].tbl || null)) { paras[endP]._mtJoinNext = true; nx._mtJoin = true; }
      if (endP > k) { k = endP - 1; break; }
      from = endPos;
    }
  }
}
function xDocStream(P, out, o = {}) {
  if (!P._mtJoin) out.push({ blk: true });
  if (o.label !== false && P.label && P.num && P.num.fmt !== 'bullet' && !o.from && (o.label === true || /heading|title/i.test((P.styleName || '') + (P.styleId || '')))) { const f0 = P.text.length ? xFmtW(P, 0) : {}; for (const ch of P.label) out.push({ ch, i: !!f0.i, b: !!f0.b, sup: false, sub: false, P, pos: 0, lab: true }); out.push({ ch: ' ', P, pos: 0 }); }
  const skip = o.skip || null;
  for (let i = o.from || 0; i < (o.to ?? P.text.length); i++) {
    if (skip && skip.some(([a, b]) => i >= a && i < b)) continue;
    if (P._mtR) { const r = P._mtR.find(r => i >= r.s && i < r.e); if (r) { if (i === r.s && r.atom) out.push(r.atom); continue; } }
    const c = P.chars[i]; const ch = P.text[i];
    if (c && c.math) { out.push({ atom: true, lin: linOmml(c.node).map(x => ({ ...x, math: true })), math: true, P, pos: i }); continue; }
    if ((c && c.drawing) || ch === '￼') { if (c && xIsOleEq(c.node)) out.push(X_OPQ(P, i)); continue; }
    const f = xFmtW(P, i);
    let g = ch;
    const symF = c && (c.sym ? isSymbolFont(c.sym) : (c.r && isSymbolFont(f.font)));
    if (symF) g = SYMBOL_GREEK[ch] || SYMBOL_EXTRA[ch.charCodeAt(0)] || ch;
    if (f.caps) g = g.toUpperCase();
    out.push({ ch: g, i: !!f.i, b: !!f.b, sup: f.vert === 'superscript', sub: f.vert === 'subscript', u: !!f.u, sc: !!f.smallCaps, P, pos: i });
  }
  if (!P._mtJoinNext) out.push({ blk: true });
}
const xMostlyItalic = P => { if (P._mi != null) return P._mi; let n = 0, y = 0; for (let i = 0; i < P.text.length; i++) { if (!/\p{L}/u.test(P.text[i])) continue; const f = xFmtW(P, i); if (f.math) continue; n++; if (f.i) y++; } return (P._mi = n > 0 && y / n >= 0.8); };
const X_CAP = /^\s*(Figure|Fig\.|Scheme|Chart|Table|Algorithm|Box|Graphical Abstract|Video)\s+([A-Z]{0,2}\d+[a-z]?|[A-Z])\b\s*[.:]?\s*/i;
const X_BACK = /^\s*(Supplementary Materials|Author Contributions|Funding|Institutional Review Board Statement|Informed Consent Statement|Data Availability Statement|Acknowledg(?:e)?ments?|Conflicts? of Interest|Abbreviations|Appendix\s+[A-Z]\b|Disclaimer\/Publisher[’']s Note|Disclaimer|Publisher[’']s Note|Sample Availability|Dual Use Research of Concern|Use of Artificial Intelligence|Institutional Biosafety Committee Statement|Nomenclature|Glossary|Author Notes?|Ethics Statement|Patents)\b/i;
const xFloatKey = s => { const m = X_CAP.exec(s || ''); if (!m) return null; let t = m[1].toLowerCase(); if (t === 'fig.') t = 'figure'; return t + ' ' + m[2].toLowerCase(); };
const xBackKey = s => { const m = X_BACK.exec(s || ''); if (!m) return null; return m[1].toLowerCase().replace(/acknowledge?ments?/, 'acknowledgments').replace(/conflicts? of interest/, 'conflicts of interest').replace(/[’']/g, '’').replace(/^disclaimer$|^publisher’s note$/, 'disclaimer/publisher’s note').replace(/\s+/g, ' ').replace(/^author notes?$/, 'author notes'); };
const xPOle = p => p.chars.some(c => c && c.drawing && xIsOleEq(c.node));
function xIsEqTable(T) {
  if (T.hasMath && T.rows.every(r => r.filter(c => c.paras.some(p => p.text.trim())).length <= 3)) return true;
  const ct = c => c.paras.map(p => p.text).join(' ').trim();
  return T.rows.length >= 1 && T.rows.length <= 12 && T.rows.every(r => { const ne = r.filter(c => ct(c)); return ne.length >= 2 && ne.length <= 3 && /^\(\s*[A-Z]?\d+[a-z]?\s*\)$/.test(ct(ne[ne.length - 1])) && ne.slice(0, -1).some(c => /[=≈≤≥<>]/.test(ct(c)) || c.paras.some(p => p.hasMath || xPOle(p))); });
}
function xEqTableStream(T, out) {
  T.rows.forEach(r => {
    const ne = r.filter(c => c.paras.some(p => p.text.replace(/[\s￼]/g, '') || p.hasMath || xPOle(p)));
    if (!ne.length) return;
    const last = ne[ne.length - 1]; const lastT = last.paras.map(p => p.text).join(' ').trim();
    const hasLbl = /^\(\s*[A-Z]?\d+[a-z]?\s*\)$/.test(lastT);
    const fcells = hasLbl ? ne.slice(0, -1) : ne;
    fcells.forEach(c => c.paras.forEach(p => {
      const ole = xPOle(p); if (!(p.text.replace(/[\s￼]/g, '') || p.hasMath || ole)) return;
      const tmp = []; xDocStream(p, tmp, { label: false });
      out.push({ blk: true });
      out.push({ atom: true, lin: xCharsToLin(tmp), math: p.hasMath || ole, P: p, pos: Math.max(0, p.chars.findIndex(c => c.math)), disp: true, label: hasLbl ? lastT : '' });
      out.push({ blk: true });
    }));
    if (hasLbl) last.paras.forEach(p => { if (p.text.trim()) { const tmp = []; xDocStream(p, tmp, { label: false }); tmp.forEach(c => { if (!c.blk) c.lab = true; }); out.push(...tmp); } });
  });
}
function xFlatTableStream(T, out) { T.rows.forEach(r => r.forEach(c => c.paras.forEach(p => xDocStream(p, out, { label: false })))); }

