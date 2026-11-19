/* ---------------- styles / theme / numbering ---------------- */
function parseTheme(xml) {
  const t = { minor: null, major: null };
  if (!xml) return t;
  const d = parseXml(xml);
  const pick = tag => {
    const f = d.getElementsByTagNameNS(ANS, tag)[0];
    if (!f) return null;
    const l = f.getElementsByTagNameNS(ANS, 'latin')[0];
    return l ? l.getAttribute('typeface') : null;
  };
  t.minor = pick('minorFont'); t.major = pick('majorFont');
  return t;
}
function readRPr(rPr, theme) {
  const o = {};
  if (!rPr) return o;
  const f = kid(rPr, 'rFonts');
  if (f) {
    const a = wa(f, 'ascii') || wa(f, 'hAnsi');
    const th = wa(f, 'asciiTheme') || wa(f, 'hAnsiTheme');
    if (th) o.font = /major/i.test(th) ? (theme.major || 'theme') : (theme.minor || 'theme');
    else if (a) o.font = a;
  }
  const sz = kid(rPr, 'sz'); if (sz) o.size = Number(wa(sz, 'val')) / 2;
  for (const k of ['b', 'i', 'caps', 'smallCaps', 'strike', 'u']) {
    const e = kid(rPr, k);
    if (e) { if (k !== 'u') o[k] = onOff(e); else if (wa(e, 'val') != null) o[k] = wa(e, 'val') !== 'none'; }
  }
  const va = kid(rPr, 'vertAlign'); if (va) o.vert = wa(va, 'val');
  const col = kid(rPr, 'color'); if (col) o.color = wa(col, 'val');
  const sp = kid(rPr, 'spacing'); if (sp) o.spc = Number(wa(sp, 'val'));
  const lang = kid(rPr, 'lang'); if (lang && wa(lang, 'val')) o.lang = wa(lang, 'val');
  const rs = kid(rPr, 'rStyle'); if (rs) o.rStyle = wa(rs, 'val');
  const sh = kid(rPr, 'shd'); if (sh && wa(sh, 'fill') && !/^(auto|FFFFFF)$/i.test(wa(sh, 'fill'))) o.shd = wa(sh, 'fill');
  const hl = kid(rPr, 'highlight'); if (hl && wa(hl, 'val') !== 'none') o.hl = wa(hl, 'val');
  return o;
}
function readPPr(pPr) {
  const o = {};
  if (!pPr) return o;
  const ps = kid(pPr, 'pStyle'); if (ps) o.pStyle = wa(ps, 'val');
  const jc = kid(pPr, 'jc'); if (jc) o.jc = wa(jc, 'val');
  const ind = kid(pPr, 'ind');
  if (ind) {
    const l = wa(ind, 'left') ?? wa(ind, 'start'); if (l != null) o.left = Number(l);
    const r = wa(ind, 'right') ?? wa(ind, 'end'); if (r != null) o.right = Number(r);
    const h = wa(ind, 'hanging'); const f = wa(ind, 'firstLine');
    if (h != null) { o.hanging = Number(h); o.firstLine = 0; }
    else if (f != null) { o.firstLine = Number(f); o.hanging = 0; }
  }
  const sp = kid(pPr, 'spacing');
  if (sp) {
    const b = wa(sp, 'before'); if (b != null) o.before = Number(b);
    const a = wa(sp, 'after'); if (a != null) o.after = Number(a);
    const ln = wa(sp, 'line'); if (ln != null) o.line = Number(ln);
    const lr = wa(sp, 'lineRule'); if (lr != null) o.lineRule = lr;
    if (onOff(kid(pPr, 'spacing')) && wa(sp, 'beforeAutospacing') && wa(sp, 'beforeAutospacing') !== '0') o.beforeAuto = true;
    if (wa(sp, 'afterAutospacing') && wa(sp, 'afterAutospacing') !== '0') o.afterAuto = true;
  }
  const np = kid(pPr, 'numPr');
  if (np) {
    const id = kid(np, 'numId'); const lv = kid(np, 'ilvl');
    if (id) o.numId = wa(id, 'val');
    if (lv) o.ilvl = Number(wa(lv, 'val'));
  }
  const ol = kid(pPr, 'outlineLvl'); if (ol) o.outline = Number(wa(ol, 'val'));
  const rPr = kid(pPr, 'rPr'); if (rPr) o._markRPr = rPr;
  return o;
}
function mergePP(base, add) {
  const o = Object.assign({}, base);
  for (const k in add) if (add[k] !== undefined && k !== 'pStyle' && k !== '_markRPr') o[k] = add[k];
  return o;
}
function parseStyles(xml, theme) {
  const S = { byId: {}, defPara: null, docR: {}, docP: {}, hasCommentRef: false, nameToId: {} };
  if (!xml) return S;
  const d = parseXml(xml);
  const dd = d.getElementsByTagNameNS(W, 'docDefaults')[0];
  if (dd) {
    const rd = kid(kid(dd, 'rPrDefault'), 'rPr'); S.docR = readRPr(rd, theme);
    const pd = kid(kid(dd, 'pPrDefault'), 'pPr'); S.docP = readPPr(pd);
  }
  for (const s of d.getElementsByTagNameNS(W, 'style')) {
    const id = wa(s, 'styleId');
    const o = {
      id, type: wa(s, 'type'),
      name: (wa(kid(s, 'name'), 'val') || id || ''),
      basedOn: wa(kid(s, 'basedOn'), 'val'),
      pPr: readPPr(kid(s, 'pPr')), rPr: readRPr(kid(s, 'rPr'), theme),
      isDefault: wa(s, 'default') === '1' || wa(s, 'default') === 'true'
    };
    S.byId[id] = o;
    S.nameToId[o.name.toLowerCase()] = id;
    if (o.type === 'paragraph' && o.isDefault) S.defPara = id;
    if (/^comment ?reference$/i.test(o.name) || id === 'CommentReference') S.hasCommentRef = id;
    const tp = kid(s, 'tblPr'); if (tp) o.tblBorders = kid(tp, 'tblBorders');
    if (o.type === 'table') {
      o.cond = {};
      for (const c of kids(s, 'tblStylePr')) { const t = wa(c, 'type'), r = kid(c, 'rPr'); if (t && r) o.cond[t] = readRPr(r, theme); }
      o.rowBand = Number(wa(kid(tp, 'tblStyleRowBandSize'), 'val')) || 0; o.colBand = Number(wa(kid(tp, 'tblStyleColBandSize'), 'val')) || 0;
    }
  }
  return S;
}
// run formatting a table style gives one cell: the style's own rPr, then its conditional parts in Word's order (bands, first/last column, first/last row, corners), each part from base style to derived
const TS_KEYS = new Set(['b', 'i', 'u', 'strike', 'caps', 'smallCaps', 'vert']);
function tblLookOf(tbl) {
  const L = kid(kid(tbl, 'tblPr'), 'tblLook'); if (!L) return null;
  const h = parseInt(wa(L, 'val') || '0', 16) || 0;
  const on = (a, bit) => { const v = wa(L, a); return v != null ? /^(1|true|on)$/i.test(v) : !!(h & bit); };
  return { fr: on('firstRow', 0x20), lr: on('lastRow', 0x40), fc: on('firstColumn', 0x80), lc: on('lastColumn', 0x100), nh: on('noHBand', 0x200), nv: on('noVBand', 0x400) };
}
function tblCellRPr(chain, look, ri, nRows, gc, ge, nCols) {
  if (!chain.length) return null;
  const types = ['wholeTable'];
  if (look) {
    const fr = look.fr && ri === 0, lr = look.lr && ri === nRows - 1 && nRows > 1, fc = look.fc && gc === 0, lc = look.lc && ge >= nCols - 1 && nCols > 1;
    const rb = Math.max(1, ...chain.map(st => st.rowBand || 0)), cb = Math.max(1, ...chain.map(st => st.colBand || 0));
    if (!look.nv && !fc && !lc) { const k = gc - (look.fc ? 1 : 0); if (k >= 0) types.push(Math.floor(k / cb) % 2 ? 'band2Vert' : 'band1Vert'); }
    if (!look.nh && !fr && !lr) { const k = ri - (look.fr ? 1 : 0); if (k >= 0) types.push(Math.floor(k / rb) % 2 ? 'band2Horz' : 'band1Horz'); }
    if (fc) types.push('firstCol'); if (lc) types.push('lastCol');
    if (fr) types.push('firstRow'); if (lr) types.push('lastRow');
    if (fr && fc) types.push('nwCell'); if (fr && lc) types.push('neCell'); if (lr && fc) types.push('swCell'); if (lr && lc) types.push('seCell');
  }
  const e = {};
  for (const st of chain) Object.assign(e, st.rPr);
  for (const t of types) for (const st of chain) if (st.cond && st.cond[t]) Object.assign(e, st.cond[t]);
  // only the character formatting a reader sees (bold, italic, underline, …); font, size, colour and language stay as the paragraph styles give them
  for (const k of Object.keys(e)) if (!TS_KEYS.has(k)) delete e[k];
  return Object.keys(e).length ? e : null;
}
function styleChain(S, id) {
  const out = []; let cur = id, guard = 0;
  while (cur && S.byId[cur] && guard++ < 25) { out.unshift(S.byId[cur]); cur = S.byId[cur].basedOn; }
  return out;
}
function parseNumbering(xml) {
  const N = { abs: {}, nums: {} };
  if (!xml) return N;
  const d = parseXml(xml);
  for (const a of d.getElementsByTagNameNS(W, 'abstractNum')) {
    const id = wa(a, 'abstractNumId'); const lvls = {};
    for (const l of kids(a, 'lvl')) {
      const il = Number(wa(l, 'ilvl'));
      lvls[il] = {
        start: Number(wa(kid(l, 'start'), 'val') || 1),
        fmt: wa(kid(l, 'numFmt'), 'val') || 'decimal',
        text: wa(kid(l, 'lvlText'), 'val') ?? '',
        suff: wa(kid(l, 'suff'), 'val') || 'tab',
        lgl: !!kid(l, 'isLgl'),
        pPr: readPPr(kid(l, 'pPr')),
        pStyle: wa(kid(l, 'pStyle'), 'val')
      };
    }
    N.abs[id] = { lvls, link: wa(kid(a, 'numStyleLink'), 'val') };
  }
  for (const n of d.getElementsByTagNameNS(W, 'num')) {
    const id = wa(n, 'numId');
    const ov = {};
    for (const o of kids(n, 'lvlOverride')) {
      const il = Number(wa(o, 'ilvl'));
      const so = kid(o, 'startOverride');
      ov[il] = { start: so ? Number(wa(so, 'val')) : undefined };
      const l = kid(o, 'lvl');
      if (l) ov[il].lvl = { start: Number(wa(kid(l, 'start'), 'val') || 1), fmt: wa(kid(l, 'numFmt'), 'val') || 'decimal', text: wa(kid(l, 'lvlText'), 'val') ?? '', suff: wa(kid(l, 'suff'), 'val') || 'tab', pPr: readPPr(kid(l, 'pPr')) };
    }
    N.nums[id] = { abs: wa(kid(n, 'abstractNumId'), 'val'), ov };
  }
  return N;
}
function roman(n) {
  const m = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s;
}
function fmtNum(n, f) {
  switch (f) {
    case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1);
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return n < 10 ? '0' + n : String(n);
    case 'bullet': case 'none': return '';
    default: return String(n);
  }
}
class Numberer {
  constructor(N) { this.N = N; this.counters = {}; this.seenNum = {}; }
  lvl(numId, il) {
    const n = this.N.nums[numId]; if (!n) return null;
    if (n.ov[il] && n.ov[il].lvl) return n.ov[il].lvl;
    const a = this.N.abs[n.abs]; if (!a) return null;
    return a.lvls[il] || null;
  }
  next(numId, il) {
    const n = this.N.nums[numId];
    if (!n || numId === '0') return null;
    const absId = n.abs;
    const key = absId;
    if (!this.counters[key]) this.counters[key] = {};
    const C = this.counters[key];
    if (!this.seenNum[numId]) {
      this.seenNum[numId] = true;
      for (const k in n.ov) if (n.ov[k].start != null) C['_restart' + k] = n.ov[k].start;
    }
    const L = this.lvl(numId, il); if (!L) return null;
    if (C['_restart' + il] != null) { C[il] = C['_restart' + il] - 1; delete C['_restart' + il]; }
    if (C[il] == null) C[il] = L.start - 1;
    C[il]++;
    for (let k = il + 1; k < 9; k++) delete C[k];
    let label = L.text.replace(/%(\d)/g, (m, d) => {
      const k = Number(d) - 1;
      const LL = this.lvl(numId, k) || { start: 1, fmt: 'decimal' };
      const v = C[k] != null ? C[k] : LL.start;
      return fmtNum(v, L.lgl ? 'decimal' : LL.fmt);
    });
    if (L.fmt === 'bullet') label = '•';
    if (L.fmt === 'none') label = '';
    return { label, fmt: L.fmt, suff: L.suff, ilvl: il, numId, pPr: L.pPr, text: L.text };
  }
}

