/* ---------------- document model ---------------- */
const CONTAINERS = new Set(['hyperlink', 'ins', 'smartTag', 'fldSimple', 'customXml', 'moveTo', 'dir', 'bdo', 'sdt', 'sdtContent']);

function buildModel(files) {
  const theme = parseTheme(files.theme);
  const S = parseStyles(files.styles, theme);
  const N = parseNumbering(files.numbering);
  const numberer = new Numberer(N);
  const doc = parseXml(files.document);
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const model = { doc, body, S, N, theme, paras: [], blocks: [], tables: [], sects: [], settings: files.settings };
  const effCache = new Map();

  function paraEff(p) {
    const pPr = kid(p, 'pPr');
    const direct = readPPr(pPr);
    let sid = direct.pStyle || S.defPara;
    if (sid && !S.byId[sid]) sid = S.defPara;
    let eff = mergePP({}, S.docP);
    const chain = styleChain(S, sid);
    for (const st of chain) eff = mergePP(eff, st.pPr);
    // numbering: direct numPr overrides style numPr
    let numId = direct.numId ?? eff.numId, ilvl = direct.ilvl ?? eff.ilvl ?? 0;
    let numInfo = null;
    if (numId && numId !== '0') {
      numInfo = numberer.next(numId, ilvl);
      if (numInfo) eff = mergePP(eff, numInfo.pPr);
    }
    eff = mergePP(eff, direct);
    const st = sid ? S.byId[sid] : null;
    return { eff, styleId: sid, styleName: st ? st.name : '', chain, numInfo, pPr };
  }
  function runEff(r, chain, tsR) {
    if (effCache.has(r)) return effCache.get(r);
    const d = readRPr(kid(r, 'rPr'), theme);
    let e = Object.assign({}, S.docR, tsR || {});
    for (const st of chain) Object.assign(e, st.rPr);
    if (d.rStyle) for (const st of styleChain(S, d.rStyle)) Object.assign(e, st.rPr);
    Object.assign(e, d);
    if (!e.font) e.font = 'Times New Roman';
    if (!e.size) e.size = 10;
    effCache.set(r, e);
    return e;
  }

  function buildPara(p, ctx) {
    const info = paraEff(p);
    const P = {
      el: p, idx: model.paras.length, chars: [], text: '', links: [],
      pp: info.eff, styleId: info.styleId, styleName: info.styleName || '', num: info.numInfo,
      chain: info.chain, drawings: [], hasMath: false, mathOnly: false, inTable: !!ctx.tbl, tbl: ctx.tbl || null,
      row: ctx.row ?? null, cell: ctx.cell ?? null, role: null, findings: [], tsR: ctx.tsR || null
    };
    const chars = P.chars; let text = '';
    const push = (ch, o) => { chars.push(o); text += ch; };
    function walkRun(r) {
      for (let c = r.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === MCNS && c.localName === 'AlternateContent') {
          const dr = c.getElementsByTagNameNS(W, 'drawing')[0] || c.getElementsByTagNameNS(W, 'pict')[0];
          if (dr) { recordDrawing(dr); push('￼', { r, node: c, off: 0, atom: true, drawing: true }); }
          continue;
        }
        if (c.namespaceURI !== W) continue;
        switch (c.localName) {
          case 't': { const s = c.textContent; for (let i = 0; i < s.length; i++) push(s[i], { r, node: c, off: i }); break; }
          case 'tab': case 'ptab': push('\t', { r, node: c, off: 0, atom: true }); break;
          case 'br': case 'cr': push('\n', { r, node: c, off: 0, atom: true, br: wa(c, 'type') || 'line' }); break;
          case 'noBreakHyphen': push('‑', { r, node: c, off: 0, atom: true }); break;
          case 'sym': {
            const code = parseInt(wa(c, 'char') || '0', 16);
            let ch = String.fromCharCode(code >= 0xF000 ? code - 0xF000 : code);
            push(ch, { r, node: c, off: 0, atom: true, sym: wa(c, 'font') || 'Symbol' }); break;
          }
          case 'drawing': case 'pict': case 'object':
            recordDrawing(c); push('￼', { r, node: c, off: 0, atom: true, drawing: true }); break;
          default: break;
        }
      }
    }
    function recordDrawing(d) {
      const anchor = d.getElementsByTagNameNS(WPNS, 'anchor')[0];
      const inline = d.getElementsByTagNameNS(WPNS, 'inline')[0];
      const ext = (anchor || inline) ? (anchor || inline).getElementsByTagNameNS(WPNS, 'extent')[0] : null;
      const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const rids = [];
      for (const b of d.getElementsByTagNameNS(ANS, 'blip')) { const id = b.getAttributeNS(RNS, 'embed') || b.getAttributeNS(RNS, 'link'); if (id) rids.push(id); }
      for (const v of d.getElementsByTagName('v:imagedata')) { const id = v.getAttributeNS(RNS, 'id'); if (id) rids.push(id); }
      const ole = d.getElementsByTagNameNS('urn:schemas-microsoft-com:office:office', 'OLEObject')[0];
      const oleEq = !!ole && /Equation/i.test(ole.getAttribute('ProgID') || '');
      if (oleEq) P.oleEq = true;
      P.drawings.push({ anchor: !!anchor, inline: !!inline, vml: !anchor && !inline, cx: ext ? Number(ext.getAttribute('cx')) : 0, cy: ext ? Number(ext.getAttribute('cy')) : 0, rids, oleEq });
    }
    function walk(el, linkStart) {
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const ns = c.namespaceURI, ln = c.localName;
        if (ns === W) {
          if (ln === 'r') walkRun(c);
          else if (ln === 'hyperlink') {
            const s0 = chars.length; walk(c);
            P.links.push({ el: c, s: s0, e: chars.length, rid: c.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'), anchor: wa(c, 'anchor') });
          }
          else if (CONTAINERS.has(ln)) walk(c);
        } else if (ns === MNS && (ln === 'oMath' || ln === 'oMathPara')) {
          P.hasMath = true;
          const mt = Array.from(c.getElementsByTagNameNS(MNS, 't')).map(x => x.textContent).join('');
          push('￼', { r: null, node: c, off: 0, atom: true, math: true, mathText: mt });
        } else if (ns === MCNS && ln === 'AlternateContent') {
          const ch = c.getElementsByTagNameNS(MCNS, 'Choice')[0]; if (ch) walk(ch);
        }
      }
    }
    walk(p);
    P.text = text;
    P.fmt = i => {
      const c = chars[i];
      if (!c || !c.r) return { math: true, font: PALATINO, size: 10 };
      return runEff(c.r, info.chain, P.tsR);
    };
    P.label = info.numInfo ? info.numInfo.label : '';
    P.display = (P.label ? P.label + (info.numInfo.suff === 'nothing' ? '' : ' ') : '') + text;
    const visible = text.replace(/[￼\s]/g, '');
    P.empty = visible.length === 0 && P.drawings.length === 0 && !P.hasMath;
    P.mathOnly = P.hasMath && text.replace(/[￼\s]/g, '').replace(/^\(?[A-Z]?\d+[a-z]?\)?$/, '').length === 0;
    const sp = pPrSect(p); if (sp) model.sects.push(sp);
    model.paras.push(P);
    return P;
  }
  function pPrSect(p) { const pPr = kid(p, 'pPr'); return pPr ? kid(pPr, 'sectPr') : null; }

  function buildTable(tbl, depth) {
    const T = { el: tbl, rows: [], paras: [], depth, hasMath: false };
    const rows = kids(tbl, 'tr');
    const tsId = wa(kid(kid(tbl, 'tblPr'), 'tblStyle'), 'val');
    const tsChain = tsId ? styleChain(S, tsId).filter(st => st.type === 'table') : [];
    const look = tblLookOf(tbl), nCols = kids(kid(tbl, 'tblGrid'), 'gridCol').length;
    rows.forEach((tr, ri) => {
      const row = [];
      let gc = Number(wa(kid(kid(tr, 'trPr'), 'gridBefore'), 'val')) || 0;
      kids(tr, 'tc').forEach((tc, ci) => {
        const cell = { el: tc, paras: [] };
        const span = Number(wa(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val')) || 1;
        const tsR = tblCellRPr(tsChain, look, ri, rows.length, gc, gc + span - 1, nCols); gc += span;
        for (const c of kids(tc)) {
          if (c.localName === 'p') { const P = buildPara(c, { tbl: T, row: ri, cell: ci, tsR }); cell.paras.push(P); T.paras.push(P); if (P.hasMath) T.hasMath = true; }
          else if (c.localName === 'tbl') { const sub = buildTable(c, depth + 1); sub.paras.forEach(P => { cell.paras.push(P); T.paras.push(P); }); }
          else if (c.localName === 'sdt') { for (const q of kid(c, 'sdtContent') ? kids(kid(c, 'sdtContent'), 'p') : []) { const P = buildPara(q, { tbl: T, row: ri, cell: ci, tsR }); cell.paras.push(P); T.paras.push(P); } }
        }
        row.push(cell);
      });
      T.rows.push(row);
    });
    model.tables.push(T);
    return T;
  }
  function walkBody(el) {
    for (const c of kids(el)) {
      if (c.localName === 'p') model.blocks.push({ kind: 'p', p: buildPara(c, {}) });
      else if (c.localName === 'tbl') model.blocks.push({ kind: 'tbl', t: buildTable(c, 0) });
      else if (c.localName === 'sdt') { const sc = kid(c, 'sdtContent'); if (sc) walkBody(sc); }
      else if (c.localName === 'sectPr') model.sects.push(c);
      else if (c.localName === 'customXml') walkBody(c);
    }
  }
  walkBody(body);
  return model;
}

/* ---------------- text helpers on paragraphs ---------------- */
function isLetterOrDigit(ch) { return /[\p{L}\p{N}]/u.test(ch); }
function fracFmt(P, s, e, test, filter) {
  let n = 0, y = 0;
  for (let i = s; i < e; i++) {
    const ch = P.text[i];
    if (ch === '￼' || /\s/.test(ch)) continue;
    if (filter && !filter(ch, i)) continue;
    const f = P.fmt(i); if (f.math) continue;
    n++; if (test(f, ch, i)) y++;
  }
  return n ? y / n : null;
}
function allFmt(P, s, e, test) { const f = fracFmt(P, s, e, test); return f == null ? true : f >= 0.999; }
function anyFmt(P, s, e, test) { const f = fracFmt(P, s, e, test); return f != null && f > 0; }
function trimRange(P, s = 0, e = P.text.length) {
  while (s < e && /[\s￼]/.test(P.text[s]) && !P.chars[s]?.drawing) s++;
  while (e > s && /[\s￼]/.test(P.text[e - 1]) && !P.chars[e - 1]?.drawing) e--;
  return [s, e];
}

