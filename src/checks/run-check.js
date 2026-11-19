function runCheck(model, opts) {
  const L = opts.lang || 'en';
  const tx = (th, en) => L === 'th' ? th : en;
  const findings = [];
  let nVarSeen = false;
  const add = (P, s, e, sev, cat, sec, th, en, rule) => {
    if (!P || P.inBox) return;
    if (s == null) { [s, e] = trimRange(P); if (e <= s) { s = 0; e = P.text.length; } }
    findings.push({ P, s, e, sev, cat, sec, msg: tx(th, en), rule });
  };
  const paras = model.paras;
  const nonEmpty = paras.filter(p => !p.empty);
  const firstP = nonEmpty[0] || paras[0];
  const blocks = model.blocks;
  const topParas = blocks.filter(b => b.kind === 'p').map(b => b.p);

  /* ---------- 1. page & document settings ---------- */
  const docIssues = [];
  model.sects.forEach((sp, si) => {
    const pg = kid(sp, 'pgSz'), mar = kid(sp, 'pgMar');
    if (pg) {
      let w = num(wa(pg, 'w')), h = num(wa(pg, 'h'));
      const land = wa(pg, 'orient') === 'landscape' || w > h;
      if (land) [w, h] = [h, w];
      if (Math.abs(w - 11906) > 30 || Math.abs(h - 16838) > 30)
        docIssues.push({ sec: '2', t: tx(`ขนาดกระดาษ (Section ${si + 1}) เป็น ${r2(cm(w))} × ${r2(cm(h))} cm ต้องเป็น A4 (21 × 29.7 cm)`, `Paper size (section ${si + 1}) is ${r2(cm(w))} × ${r2(cm(h))} cm; must be A4 (21 × 29.7 cm)`), rule: 'Paper Size: A4 (21 cm by 29.7 cm).' });
      if (mar && !land) {
        const want = { top: 2.5, bottom: 1.6, left: 1.27, right: 1.27 };
        const bad = [];
        for (const k in want) { const v = cm(Math.abs(num(wa(mar, k)) || 0)); if (Math.abs(v - want[k]) > 0.03) bad.push(`${k[0].toUpperCase() + k.slice(1)} ${r2(v)} → ${want[k]} cm`); }
        if (bad.length) docIssues.push({ sec: '2', t: tx(`ระยะขอบกระดาษ (Section ${si + 1}) ไม่ถูกต้อง: `, `Page margins (section ${si + 1}) are wrong: `) + bad.join('; '), rule: 'Margin: Top = 2.5 cm; Bottom = 1.6 cm; Left = 1.27 cm; Right = 1.27 cm.' });
        const hb = [];
        const hv = cm(num(wa(mar, 'header')) || 0), fv = cm(num(wa(mar, 'footer')) || 0);
        if (Math.abs(hv - 1.27) > 0.03) hb.push(`Header from Top ${r2(hv)} → 1.27 cm`);
        if (Math.abs(fv - 1.08) > 0.03) hb.push(`Footer from Bottom ${r2(fv)} → 1.08 cm`);
        if (hb.length) docIssues.push({ sec: '2', t: tx('ระยะ Header/Footer ไม่ถูกต้อง: ', 'Header/footer distance is wrong: ') + hb.join('; '), rule: 'Header from Top = 1.27 cm; Footer from Bottom = 1.08 cm; Select “Different First Page”.' });
      }
      if (si === 0 && !onOff(kid(sp, 'titlePg')))
        docIssues.push({ sec: '2', t: tx('ยังไม่ได้เลือก “Different First Page” ใน Header & Footer', '“Different First Page” is not selected for the header/footer'), rule: 'Header from Top = 1.27 cm; Footer from Bottom = 1.08 cm; Select “Different First Page”.' });
    }
  });
  if (model.settings) {
    const sd = parseXml(model.settings);
    const ah = sd.getElementsByTagNameNS(W, 'autoHyphenation')[0];
    if (!ah || !onOff(ah)) docIssues.push({ sec: '2', t: tx('Hyphenation ยังไม่ได้ตั้งเป็น Automatic (Layout → Hyphenation → Automatic)', 'Hyphenation is not set to Automatic (Layout → Hyphenation → Automatic)'), rule: 'Hyphenation: Automatic.' });
  }
  // language
  const langs = new Map();
  for (const P of paras) for (let i = 0; i < P.text.length; i++) {
    if (!/[A-Za-z]/.test(P.text[i])) continue;
    const f = P.fmt(i); if (f.math) continue;
    const lg = f.lang || '(none)'; langs.set(lg, (langs.get(lg) || 0) + 1);
  }
  const badLang = [...langs.keys()].filter(l => l.toLowerCase() !== 'en-us');
  if (badLang.length) docIssues.push({ sec: '2', t: tx(`ภาษาของข้อความ (Proofing language) ไม่ใช่ English (U.S.) — พบ: ${badLang.join(', ')} (เลือกทั้งหมด Ctrl+A แล้วตั้งภาษาเป็น English (U.S.))`, `Proofing language is not English (U.S.) — found: ${badLang.join(', ')} (select all, Ctrl+A, and set English (U.S.))`), rule: 'Language: English (U.S.). Select all (Ctrl-A), and then click the language bar at the bottom.' });
  // header/footer font size
  if (opts.headerFooter && opts.headerFooter.length) {
    const bad = opts.headerFooter.filter(h => h.sizes.some(z => z !== 8));
    if (bad.length) docIssues.push({ sec: '4.1', t: tx(`Header/Footer มีขนาดตัวอักษร ${[...new Set(bad.flatMap(b => b.sizes))].join(', ')} pt ต้องเป็น 8 pt`, `Header/footer font size is ${[...new Set(bad.flatMap(b => b.sizes))].join(', ')} pt; must be 8 pt`), rule: 'Header for other pages / First Page Footer / Footer for other pages: Font size: 8 pt.' });
  }
  docIssues.forEach(d => add(firstP, null, null, 'error', 'page', d.sec, d.t, d.t, d.rule));

  /* ---------- 2. classify paragraphs ---------- */
  const textOf = P => P.text.replace(/￼/g, ' ').trim();
  const sname = P => (P.styleName || '').toLowerCase();
  // the editor/dates/copyright box (a one-cell table, anywhere in the file, even after the first heading)
  const BOX_LINE = /^(Citation|Academic Editors?|Academic Editor\(s\)|Received|Revised|Accepted|Published|Copyright|Publisher[’']s Note)\s*:|^©/i;
  for (const T of model.tables) if (T.paras.filter(p => BOX_LINE.test(textOf(p))).length >= 2) { T.box = true; T.paras.forEach(p => { p.inBox = true; }); }
  // a Highlights block before the abstract (a “Highlights” line, its items, up to the “Abstract” line) is not the abstract
  const isHighlights = P => /^highlights?\s*:?\s*$/i.test(textOf(P));
  const iHigh0 = topParas.findIndex(isHighlights);
  const iAbsLbl = iHigh0 >= 0 ? topParas.findIndex((P, i) => i > iHigh0 && /^abstract\b/i.test(textOf(P))) : -1;
  let iAbs = topParas.findIndex((P, i) => (iAbsLbl < 0 || i < iHigh0 || i >= iAbsLbl) && !isHighlights(P) && (/^abstract\b/i.test(textOf(P)) || /mdpi_1\.7|abstract/.test(sname(P)) && textOf(P)));
  const iHigh = iHigh0 >= 0 && iHigh0 < iAbs ? iHigh0 : -1;
  if (iHigh >= 0) for (let i = iHigh; i < iAbs; i++) if (!topParas[i].empty) topParas[i].role = 'highlights';
  let iKey = topParas.findIndex((P, i) => i > iAbs && /^key\s*-?words?\b/i.test(textOf(P)));
  const backMatch = P => {
    let t = textOf(P);
    if (P.inTable) return null;
    const numM = t.match(/^(\d+(\.\d+)*\.?|[IVX]+\.)\s+/);
    const t2 = numM ? t.slice(numM[0].length) : t;
    for (const [key, name, re, order] of BACK_LABELS) {
      const m = t2.match(re);
      if (m) {
        if (key === 'appendix' && !(t2.length < 120 || /^Appendix\s+[A-Z]\b/.test(t2))) continue;
        return { key, name, order, len: m[0].length + (numM ? numM[0].length : 0), numbered: !!numM, labelText: m[0] };
      }
    }
    return null;
  };
  const mainStartTop = iKey >= 0 ? iKey + 1 : (iAbs >= 0 ? iAbs + 1 : 0);
  const blockOf = new Map(); blocks.forEach((b, i) => { if (b.kind === 'p') blockOf.set(b.p, i); });
  const underTable = P => { const bi = blockOf.get(P); if (bi == null) return false; for (let k = bi - 1; k >= 0; k--) { const b = blocks[k]; if (b.kind === 'tbl') return !b.t.box; if (!b.p.empty) return false; } return false; };
  const isTableFooterLabel = (P, m) => !!m && m.key === 'abbrev' && textOf(P).length > m.len + 3 && !/following abbreviations/i.test(textOf(P)) && underTable(P);
  // first back-matter label after the main text start
  let iBack = -1;
  for (let i = mainStartTop; i < topParas.length; i++) {
    const m = backMatch(topParas[i]);
    if (isTableFooterLabel(topParas[i], m)) continue;
    if (m && m.key !== 'appendix') { iBack = i; break; }
    if (m && m.key === 'appendix') { iBack = i; break; }
  }
  const frontEnd = iAbs >= 0 ? iAbs : (() => { const h = topParas.findIndex(P => /^1\.?\s+[A-Z]/.test(textOf(P)) || /^introduction$/i.test(textOf(P))); return h >= 0 ? h : 0; })();

  // ---- front matter
  const front = topParas.slice(0, frontEnd).filter(P => !P.empty && P.role !== 'highlights');
  let fi = 0;
  const frontRoles = [];
  const isNorms = t => BOX_LINE.test(t);
  for (const P of front) {
    const t = textOf(P);
    if (isNorms(t)) { P.role = 'norms'; P.inBox = true; continue; }
    if (/^(running\s+(title|head)|short\s+title)\b/i.test(t)) { P.role = 'running'; continue; }
    frontRoles.push(P);
  }
  const byStyle = (P, re) => re.test(sname(P));
  let k = 0;
  if (frontRoles[k] && (byStyle(frontRoles[k], /article_type|articletype/) || (ARTICLE_TYPES.test(textOf(frontRoles[k])) && textOf(frontRoles[k]).split(/\s+/).length <= 6) || /^type of the paper/i.test(textOf(frontRoles[k])))) { frontRoles[k].role = 'article_type'; k++; }
  if (frontRoles[k]) { frontRoles[k].role = 'title'; k++; }
  const looksAff = P => /^\s*\d{1,2}\s*[\t ]/.test(P.text) || /^\s*\d{1,2}[A-Z]/.test(P.text) && P.fmt(0).vert === 'superscript' || byStyle(P, /affiliation/);
  if (frontRoles[k] && !looksAff(frontRoles[k]) && !/^\s*\*/.test(frontRoles[k].text)) { frontRoles[k].role = 'authors'; k++; }
  for (; k < frontRoles.length; k++) {
    const P = frontRoles[k], t = textOf(P);
    if (/^\*?\s*Correspondence\b/i.test(t) || /^\*\s/.test(t)) P.role = 'corr';
    else if (/^[†‡§¶‖#]/.test(t) || /contributed equally|current address|present address/i.test(t)) P.role = 'frontnote';
    else if (looksAff(P) || /@|University|Department|Institute|Faculty|School|College|Laboratory|Center|Centre|Hospital/i.test(t)) P.role = 'affiliation';
    else P.role = 'front_other';
  }
  // ---- abstract / keywords
  if (iAbs >= 0) {
    const A = topParas[iAbs];
    A.role = /^Abstract\s*$/.test(textOf(A)) ? 'abstract_title' : 'abstract_mixed';
    const endAbs = iKey >= 0 ? iKey : Math.min(topParas.length, iAbs + 3);
    for (let i = iAbs + 1; i < endAbs; i++) if (!topParas[i].empty) topParas[i].role = topParas[i].role || 'abstract_body';
  }
  if (iKey >= 0) topParas[iKey].role = 'keywords';
  for (let i = iKey + 1; i > 0 && i < Math.min(topParas.length, iKey + 3); i++) if (/^(PACS|MSC|JEL)\b/.test(textOf(topParas[i]))) topParas[i].role = 'pacs';

  // ---- main text + back matter (walk blocks)
  const mainStartPara = topParas[mainStartTop];
  const backStartPara = iBack >= 0 ? topParas[iBack] : null;
  let zone = 'front', backKey = null, prevBlock = null;
  const backSeq = []; // {key,name,order,P}
  const captionRe = /^\s*(Figure|Fig\.?|Scheme|Chart|Graph)\s*([A-Z]?\d+)[a-z]?\s*(\.|:|\||–|—|-|\s+Cont\.?)/i;
  const tabCapRe = /^\s*Table\s*([A-Z]?\d+)[a-z]?\s*(\.|:|\||–|—|-|\s+Cont\.?)/i;
  const headingInfo = P => {
    const t = textOf(P).replace(/\n/g, ' ');
    const nm = sname(P);
    let lvl = null, numStr = null, numbered = false, manual = false;
    const st = nm.match(/heading\s*([1-9])|mdpi_2\.(\d)_heading/);
    if (st) lvl = Number(st[1] || st[2]);
    if (lvl == null && P.pp.outline != null && P.pp.outline < 6 && !P.inTable) lvl = P.pp.outline + 1;
    const m = t.match(/^((?:\d{1,2}\.)*\d{1,2})(\.?)(\s+|\t)(\S.*)$/);
    // a heading style on what is really body text (long, sentence-like) — treat it as body text and report the style
    if (lvl != null && !P.inTable) {
      const words = t.split(/\s+/).length;
      const numberedLike = m && m[4].split(/\s+/).length <= 25 && t.length <= 200;
      const [hs, he] = trimRange(P); const f0 = he > hs ? P.fmt(hs) : {};
      const looksText = lvl === 1 && he > hs && (f0.size || 12) <= 10.5 && !allFmt(P, hs, he, f => f.b);
      const titleLike = !numberedLike && words <= 12 && t.length <= 110 && !/[.:;,!?]$/.test(t) && /^[\p{Lu}]/u.test(t);
      if (looksText && titleLike && (!P.num || P.num.fmt === 'bullet')) { if (st && lvl !== 4) P.styleMis = { kind: 'level', have: P.styleName || P.styleId, from: lvl, to: 4 }; lvl = 4; }
      else if (!numberedLike && (!P.num || P.num.fmt === 'bullet' || looksText) && (looksText || t.length > 200 || (words > 20 && /[.!?:]["”’)]?$/.test(t)) || /[a-z]\.\s+[A-Z][a-z]+\s+[a-z]+/.test(t) && words > 12)) { P.styleMis = { kind: st ? 'body' : 'outline', have: P.styleName || P.styleId }; return null; }
      if (numberedLike && !P.num && m[1].split('.').length !== lvl && st) { const d = m[1].split('.').length; P.styleMis = { kind: 'level', have: P.styleName || P.styleId, from: lvl, to: d }; lvl = d; }
    }
    if (P.num && P.num.fmt !== 'bullet' && P.num.label && (lvl != null)) { numStr = P.num.label.replace(/\.$/, ''); numbered = true; }
    else if (m && (lvl != null || (t.length <= 160 && !/[.;,]$/.test(t) && /^[A-Z\p{Lu}]/u.test(m[4]) && Number(m[1].split('.')[0]) <= 30 && m[4].split(/\s+/).length <= 25 && !/^\d+(\.\d+)?\s*(%|°|mm|cm|g|kg|mg|mL|L|h|min|s)\b/.test(t)))) {
      numStr = m[1]; numbered = true; manual = true;
      if (lvl == null) lvl = numStr.split('.').length;
    } else if (lvl == null && P.num && P.num.fmt === 'decimal' && /%1\.%2|%\d\.%\d/.test(P.num.text) && t.length < 160 && !/\.$/.test(t)) {
      numStr = P.num.label.replace(/\.$/, ''); numbered = true; lvl = numStr.split('.').length;
    }
    if (lvl == null) {
      // unnumbered heading: short, no closing punctuation, all bold or all italic, or a standard section name
      if (t.length > 0 && t.length <= 110 && !/[.:;,]$/.test(t) && !P.drawings.length && !P.hasMath && !captionRe.test(t) && !tabCapRe.test(t)) {
        const [s, e] = trimRange(P);
        const bold = allFmt(P, s, e, f => f.b), ital = allFmt(P, s, e, f => f.i);
        if (/^(Introduction|Materials and Methods|Methods|Results|Discussion|Conclusions?|Results and Discussion|Literature Review|Background|Methodology|Related Work)$/i.test(t)) lvl = 1;
        else if (bold && t.split(/\s+/).length <= 16) {
          if (zone === 'back' || /^[\p{L}][\p{L} ]{0,30}?\s+(\d+|[IVX]+)[a-z]?\s*[:.–—-]\s*\S/u.test(t) || /bullet|itemize|list/.test(nm)) P.boldLabel = zone === 'back' ? 'back' : 'main';
          else lvl = 1;
        }
        else if (ital && t.split(/\s+/).length <= 16 && !/[a-z]{3,} [a-z]{3,} [a-z]{3,} [a-z]{3,} [a-z]{3,} [a-z]{3,}/.test('')) lvl = 2;
      }
    }
    if (lvl == null) return null;
    return { lvl: Math.min(lvl, 5), numStr, numbered, manual, title: m && manual ? m[4] : (P.num && numbered ? t : t) };
  };

  // an equation layout table: each row holds an equation (OMML, MathType OLE or a typed formula) and, usually, its label “(n)” in the last cell;
  // a multi-line equation may leave the label off some rows. Tables with a “Table X.” caption, pictures or ordinary text cells are data tables.
  const EQ_LABEL = /^\([A-Z]?\d+[a-z]?\)$/;
  const isEquationTable = (T, blocks, bi) => {
    if (T.rows.length > 12) return false;
    for (let k = bi - 1; k >= 0; k--) { const b = blocks[k]; if (b.kind === 'tbl') break; if (b.p.empty) continue; if (b.p.role === 'tab_caption') return false; break; }
    const cellInfo = c => {
      const txt = c.paras.map(textOf).join(' ').trim();
      const math = c.paras.some(p => p.hasMath || p.oleEq);
      const pic = c.paras.some(p => p.drawings.some(d => !d.oleEq));
      const empty = c.paras.every(p => p.empty);
      return { txt, math, pic, empty, lbl: !math && EQ_LABEL.test(txt), typed: !math && txt.length <= 120 && /[=≈≤≥∝<>]/.test(txt) };
    };
    const kinds = T.rows.map(r => {
      const ne = r.map(cellInfo).filter(x => !x.empty);
      if (!ne.length) return 'blank';
      if (ne.length > 3 || ne.some(x => x.pic)) return null;
      const hasLbl = ne[ne.length - 1].lbl, body = hasLbl ? ne.slice(0, -1) : ne;
      if (body.some(x => x.lbl)) return null;
      if (!body.length) return 'label';
      if (!body.every(x => x.math || x.typed || /^[,.;]?$/.test(x.txt.replace(/\s/g, '')))) return null;
      return hasLbl ? 'label' : body.some(x => x.math) ? 'math' : 'typed';
    });
    if (kinds.includes(null)) return false;
    const used = kinds.filter(k => k !== 'blank');
    if (!used.length) return false;
    if (used.includes('label')) return true;
    if (used.every(k => k === 'math')) return true;
    return used.length === 1 && T.rows.length === 1;
  };
  let afterEquation = false;
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const P0 = b.kind === 'p' ? b.p : b.t.paras[0];
    if (b.kind === 'p' && b.p === mainStartPara) zone = 'main';
    if (b.kind === 'p' && b.p === backStartPara) zone = 'back';
    if (b.kind === 'tbl' && b.t.box) { b.t.kind = 'box'; b.t.zone = zone; b.t.paras.forEach(P => { P.role = 'norms'; }); continue; }
    if (zone === 'front') { if (b.kind === 'tbl') b.t.paras.forEach(P => { P.role = P.role || 'front_table'; }); continue; }
    if (b.kind === 'tbl') {
      const T = b.t;
      const isEq = isEquationTable(T, blocks, bi);
      T.kind = isEq ? 'equation' : (zone === 'back' && backKey === 'abbrev' ? 'abbrev' : 'data');
      T.zone = zone; T.backKey = backKey;
      T.paras.forEach(P => { P.role = isEq ? (P.empty || P.hasMath || P.oleEq || EQ_LABEL.test(textOf(P)) ? 'equation_cell' : 'table_cell') : (T.kind === 'abbrev' ? 'abbrev_cell' : 'table_cell'); });
      afterEquation = isEq;
      prevBlock = b; continue;
    }
    const P = b.p;
    if (P.empty) { continue; }
    const t = textOf(P);
    if (zone === 'back') {
      const m = backMatch(P);
      if (m && !isTableFooterLabel(P, m)) {
        backKey = m.key; P.backLabel = m; backSeq.push({ ...m, P });
        if (m.key === 'refs') { P.role = 'refs_heading'; continue; }
        if (m.key === 'disclaimer') { P.role = 'disclaimer'; continue; }
        if (m.key === 'appendix') { P.role = 'appendix_heading'; P.head = { lvl: 1, numbered: false, title: t }; continue; }
        P.role = m.key === 'supp' ? 'supp' : (m.key === 'abbrev' ? 'abbrev_label' : 'back');
        P.backKey = m.key;
        continue;
      }
      if (backKey === 'refs') { P.role = 'ref'; continue; }
      if (backKey === 'disclaimer') { P.role = 'disclaimer'; continue; }
      if (backKey === 'sba') { P.role = 'sba'; continue; }
      if (backKey === 'appendix') {
        // appendix content follows main-text rules
      } else {
        P.role = backKey === 'supp' ? 'supp' : (backKey === 'abbrev' ? 'abbrev' : 'back');
        P.backKey = backKey;
        continue;
      }
    }
    // main text (or appendix)
    const inApp = zone === 'back';
    if (captionRe.test(t) || /caption/.test(sname(P)) && /^(Figure|Scheme|Fig)/i.test(t)) { P.role = 'fig_caption'; }
    else if (tabCapRe.test(t) || /caption/.test(sname(P)) && /^Table/i.test(t)) { P.role = 'tab_caption'; }
    else if (P.drawings.length && t.replace(/[￼\s]/g, '').length < 4) P.role = 'figure';
    else if (P.mathOnly) { P.role = 'equation_para'; afterEquation = true; prevBlock = b; continue; }
    else {
      const h = headingInfo(P);
      if (h && !(P.num && !h.numbered && h.lvl == null)) { P.role = inApp ? 'appendix_heading' : 'heading'; P.head = h; }
      else if (P.num && P.num.label !== undefined && !/heading/.test(sname(P))) P.role = 'list';
      else if (P.boldLabel) P.role = 'label';
      else if (/quote/i.test(sname(P)) || (cm(P.pp.left) > 5.1 && cm(P.pp.right) > 0.5)) P.role = 'quote';
      else P.role = inApp ? 'appendix_body' : 'body';
      if ((P.role === 'body' || P.role === 'appendix_body') && /^[\p{Ll}]/u.test(t)) P.noIndent = true;
      if ((P.role === 'body' || P.role === 'appendix_body') && prevBlock && prevBlock.kind === 'tbl' && prevBlock.t.kind === 'data' && P.pp && (P.fmt(trimRange(P)[0]).size <= 9)) P.role = 'table_footnote';
    }
    afterEquation = false;
    prevBlock = b;
  }

  /* ---------- 3. paragraph format checks ---------- */
  const fmtGroups = new Map();
  const roleSpec = P => {
    switch (P.role) {
      case 'affiliation': return (/^\s*\d/.test(P.text) || (P.num && P.num.label)) ? SPECS.affiliation : Object.assign({}, SPECS.affiliation, { hanging: undefined });
      case 'article_type': case 'title': case 'authors': case 'corr': case 'frontnote':
      case 'abstract_title': case 'abstract_body': case 'keywords': case 'pacs':
        return SPECS[P.role === 'pacs' ? 'keywords' : P.role];
      case 'abstract_mixed': return SPECS.abstract_body;
      case 'heading': case 'appendix_heading': { const l = P.head ? P.head.lvl : 1; return SPECS['h' + Math.min(4, l)]; }
      case 'body': return P.noIndent ? Object.assign({}, SPECS.body, { firstLine: undefined }) : SPECS.body;
      case 'appendix_body': return P.noIndent ? Object.assign({}, SPECS.appendix, { firstLine: undefined }) : SPECS.appendix;
      case 'list': return P.num && P.num.ilvl > 0 ? Object.assign({}, SPECS.list, { left: undefined, hanging: 0.75 }) : SPECS.list;
      case 'fig_caption': return SPECS.fig_caption;
      case 'tab_caption': return SPECS.tab_caption;
      case 'figure': { const w = Math.max(...P.drawings.map(d => d.cx)); return w > 4989600 + 40000 ? SPECS.figure_large : SPECS.figure_small; }
      case 'back': return SPECS.back;
      case 'supp': return SPECS.supp;
      case 'abbrev': case 'abbrev_label': return null;
      case 'label': return P.boldLabel === 'back' ? { label: SPECS.appendix.label, sec: SPECS.appendix.sec, size: 10, rule: SPECS.appendix.rule } : { label: SPECS.body.label, sec: SPECS.body.sec, size: 10, rule: SPECS.body.rule };
      case 'ref': return SPECS.ref;
      case 'disclaimer': return SPECS.disclaimer;
      case 'table_cell': return SPECS.table_cell;
      case 'equation_cell': return SPECS.equation;
      case 'table_footnote': return SPECS.table_footnote;
      case 'quote': return SPECS.quote;
      case 'abbrev_cell': return Object.assign({}, SPECS.table_cell, { sizeRange: null, size: 9, rule: 'Abbreviations formatted as a table: Font size: 9 pt; Alignment: left; Line spacing: Single.' });
      default: return null;
    }
  };
  const symbolParas = [];
  for (const P of paras) {
    if (P.empty || !P.role) continue;
    const spec = roleSpec(P);
    if (!spec) continue;
    const { list, symFont } = formatDeviations(P, spec, { skipFont: P.role === 'equation_cell' });
    if (symFont) symbolParas.push(P);
    if (P.role === 'abstract_title' && list.length && P.abstractInline) {/* handled below */ }
    if (list.length) {
      const sig = P.role + '|' + list.join('|');
      const g = fmtGroups.get(sig) || { n: 0 }; g.n++; fmtGroups.set(sig, g);
      if (opts.compact && g.n > 2) { g.suppressed = (g.suppressed || 0) + 1; continue; }
      const head = tx(`รูปแบบ ${spec.label} ไม่ถูกต้อง:`, `${spec.label} formatting is wrong:`);
      add(P, null, null, 'error', 'format', spec.sec, head + '\n• ' + list.join('\n• '), head + '\n• ' + list.join('\n• '), spec.rule);
    }
  }
  if (opts.compact) {
    const sup = [...fmtGroups.values()].reduce((a, g) => a + (g.suppressed || 0), 0);
    if (sup) add(firstP, null, null, 'check', 'format', '—', tx(`โหมดย่อ: ยังมีอีก ${sup} ย่อหน้าที่มีปัญหารูปแบบแบบเดียวกับที่คอมเมนต์ไว้แล้ว (แสดงคอมเมนต์เฉพาะ 2 จุดแรกของแต่ละแบบ)`, `Compact mode: ${sup} more paragraphs have the same formatting problem as already commented (only the first 2 of each are commented)`), '', 'Each repeated formatting problem is commented at its first two occurrences only.');
  }

  /* ---------- 4. run-level checks over all paragraphs ---------- */
  const textRoles = new Set(['body', 'appendix_body', 'list', 'fig_caption', 'tab_caption', 'abstract_body', 'back', 'supp', 'heading', 'appendix_heading', 'table_cell', 'table_footnote', 'quote', 'title', 'keywords', 'abbrev']);
  for (const P of paras) {
    if (P.empty) continue;
    const t = P.text;
    // Symbol font
    for (let i = 0; i < t.length; i++) {
      const c = P.chars[i];
      if (c.sym && /symbol/i.test(c.sym)) { add(P, i, i + 1, 'error', 'text', '6.1', 'สัญลักษณ์นี้ใช้ฟอนต์ “Symbol” ต้องพิมพ์เป็นอักขระ Unicode ในฟอนต์ Palatino Linotype', 'This symbol uses the “Symbol” font; type it as a Unicode character in Palatino Linotype', 'Symbols: The font of all symbols, such as “α, β, µ, δ”, should be in “Palatino Linotype” format, not “Symbol”.'); continue; }
      if (c.math || c.atom) continue;
      const f = P.fmt(i);
      if (/^symbol$/i.test(f.font) && /\S/.test(t[i])) { add(P, i, i + 1, 'error', 'text', '6.1', 'สัญลักษณ์นี้ใช้ฟอนต์ “Symbol” ต้องเป็น Palatino Linotype', 'This symbol is set in the “Symbol” font; use Palatino Linotype', 'Symbols: The font of all symbols, such as “α, β, µ, δ”, should be in “Palatino Linotype” format, not “Symbol”.'); }
    }
    // character spacing condensed > 0.2 pt
    let cs = -1;
    for (let i = 0; i < t.length; i++) {
      const c = P.chars[i]; if (!c.r) continue;
      const f = P.fmt(i);
      if (f.spc != null && f.spc < -4) { if (cs < 0) cs = i; }
      else if (cs >= 0) { add(P, cs, i, 'error', 'text', '6.1', `ระยะห่างตัวอักษร (Character spacing) ถูกบีบ (Condensed) เกิน 0.2 pt`, 'Character spacing is condensed by more than 0.2 pt', 'Some fixed format requests: Character spacing condense should not exceed 0.2 pt.'); cs = -1; }
    }
    if (cs >= 0) add(P, cs, t.length, 'error', 'text', '6.1', 'ระยะห่างตัวอักษร (Character spacing) ถูกบีบ (Condensed) เกิน 0.2 pt', 'Character spacing is condensed by more than 0.2 pt', 'Some fixed format requests: Character spacing condense should not exceed 0.2 pt.');
    // superscript ordinals
    eachMatch(/(\d)(st|nd|rd|th)\b/g, t, m => {
      const i = m.index + 1;
      if (P.fmt(i).vert === 'superscript') add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `ลำดับที่ “${m[0]}” ห้ามเป็นตัวยก (superscript)`, `Ordinal “${m[0]}” must not be superscript`, 'Some fixed format requests: 1st, 2nd, 3rd, … should be 1st, 2nd, 3rd, …; do not use superscripts.');
    });
    // ® superscript, © not superscript
    eachMatch(/[®©]/g, t, m => {
      const f = P.fmt(m.index); if (f.math) return;
      if (m[0] === '®' && f.vert !== 'superscript') add(P, m.index, m.index + 1, 'error', 'text', '6.1', 'เครื่องหมาย ® ต้องเป็นตัวยก (superscript)', 'The ® symbol must be superscript', 'Symbols: Use superscript format for the registered symbol: ®.');
      if (m[0] === '©' && f.vert === 'superscript') add(P, m.index, m.index + 1, 'error', 'text', '6.1', 'เครื่องหมาย © ห้ามเป็นตัวยก', 'The © symbol must not be superscript', 'Symbols: Do not use superscript format for the copyright symbol, ©.');
    });
    // superscript/subscript numbers italic
    for (let i = 0; i < t.length; i++) {
      if (!/\d/.test(t[i]) || !P.chars[i].r) continue;
      const f = P.fmt(i);
      if ((f.vert === 'superscript' || f.vert === 'subscript') && f.i && !['title'].includes(P.role) && !(P.role === 'heading' && P.head && P.head.lvl === 2)) {
        let j = i; while (j < t.length && /\d/.test(t[j]) && P.fmt(j).i && (P.fmt(j).vert === f.vert)) j++;
        add(P, i, j, 'error', 'text', '6.1', 'ตัวเลขที่เป็นตัวยก/ตัวห้อยห้ามเป็นตัวเอียง', 'Numbers in superscript/subscript must not be italic', 'Mathematical Terms: Numbers in superscript/subscript should not be in italics, e.g., H2O2, 103.');
        i = j;
      }
    }
    // embedded hyperlinks / colored links
    for (const ln of P.links) {
      const lt = t.slice(ln.s, ln.e).trim();
      if (!lt || ln.anchor) continue;
      const isUrl = /^(https?:\/\/|www\.|ftp\.|doi\.org|[\w.-]+\.[a-z]{2,}\/)/i.test(lt) || /^[\w.+-]+@[\w.-]+$/.test(lt);
      if (!isUrl && P.role !== 'norms') add(P, ln.s, ln.e, 'error', 'text', '6.1', `ลิงก์ฝังอยู่ในข้อความ “${lt.slice(0, 40)}” — ต้องแสดง URL จริงในข้อความ เช่น Name (https://…)`, `Embedded hyperlink on “${lt.slice(0, 40)}” — show the URL itself, e.g., Name (https://…)`, 'URLs should not be embedded. For example, “Science History Institute (https://digital.sciencehistory.org/)” should be used rather than “Science History Institute” with an embedded link.');
      let colored = false;
      for (let i = ln.s; i < ln.e; i++) { const f = P.fmt(i); if (f.color && !/^(auto|000000)$/i.test(f.color)) { colored = true; break; } }
      if (colored) add(P, ln.s, ln.e, 'error', 'text', '6.1', 'ลิงก์เว็บไซต์ใน Word ต้องเป็นสีดำ (ไม่ใช่สีน้ำเงิน)', 'Website links must be black in Word (not blue)', 'Website links in the main text and references should be accessible. Keep the website link in black in Word, but blue in LaTex documents and PDFs.');
    }
    // Unicode superscript digits
    if (textRoles.has(P.role) || P.role === 'ref') eachMatch(/[²³¹⁰⁴⁵⁶⁷⁸⁹⁻⁺]+/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `“${m[0]}” เป็นอักขระตัวยกสำเร็จรูป ต้องใช้ตัวเลขปกติแล้วตั้งเป็น superscript`, `“${m[0]}” is a pre-composed superscript character; type a normal number formatted as superscript`, 'Symbols: 2, 3 should be real superscript numbers, not inserted symbols such as ², ³.'));
  }
  if (symbolParas.length) { /* already flagged per char */ }

  /* ---------- 5. front-matter content checks ---------- */
  const learnedSp = learnSpecies(paras);
  const titleCaseIssues = (P, s, e) => {
    const out = [];
    const re = /[\p{L}\p{N}][\p{L}\p{N}'’\-‐]*\.?/gu;
    const toks = [];
    let m; const str = P.text.slice(s, e);
    re.lastIndex = 0;
    while ((m = re.exec(str)) !== null) toks.push({ w: m[0], i: s + m.index });
    toks.forEach((tk, k) => {
      let w = tk.w.replace(/\.$/, (x) => /^(vs|al|spp|sp|var|subsp|cf|ca|e\.g|i\.e|etc)$/i.test(tk.w.slice(0, -1)) ? x : '');
      const bare = w.replace(/[’']s$/, '');
      const before = P.text.slice(Math.max(s, tk.i - 3), tk.i);
      const prev = toks[k - 1], next = toks[k + 1];
      const first = k === 0 || /[:—?!]\s*$/.test(P.text.slice(prev.i + prev.w.length, tk.i));
      const last = k === toks.length - 1;
      if (/\d/.test(bare) || /[\p{Lu}]/u.test(bare.slice(1).replace(/-./g, '')) || /^[\p{Lu}]{2,}/u.test(bare)) return; // acronyms, formulas
      if (bare.length === 1 && !/^[aA]$/.test(bare)) return;
      if (/^[α-ωΑ-Ω]/.test(bare)) return;
      const f = P.fmt(tk.i);
      const lower = bare.toLowerCase();
      // species epithet / italic lower-case word after italic capitalised word
      if (f.i && /^[a-z]/.test(bare) && prev && /^[A-Z]/.test(prev.w) && P.fmt(prev.i).i) return;
      // second word of a species name stays lowercase (e.g., Escherichia coli)
      if (prev && /^[A-Z][a-z]{2,}$/.test(prev.w) && /^\s+$/.test(P.text.slice(prev.i + prev.w.length, tk.i)) && speciesKind(prev.w, lower, learnedSp)) { if (/^[\p{Lu}]/u.test(bare)) out.push({ i: tk.i, n: bare.length, w: bare, want: lower }); return; }
      if (/^(sp|spp|var|subsp|f)\.?$/.test(lower)) return;
      if (CHEM_DESC.test(bare) && /-/.test(P.text[tk.i + bare.length] || '')) return;
      if (UNIT_WORDS.has(bare)) return;
      // Latin pairs must be capitalised
      const latinPair = LATIN_PAIRS.some(([a, b]) => (lower === a && next && next.w.toLowerCase().replace(/\.$/, '') === b) || (lower === b && prev && prev.w.toLowerCase() === a));
      const isUpper = /^[\p{Lu}]/u.test(bare);
      const parts = bare.split(/[-‐]/);
      if (latinPair) { if (!isUpper) out.push({ i: tk.i, n: bare.length, w: bare, want: bare[0].toUpperCase() + bare.slice(1) }); return; }
      if (first || last) {
        if (!isUpper && /^[\p{Ll}]/u.test(bare) && !/^(e\.g|i\.e|et|vs|via|cis|trans|tert|n|p|m|o|mRNA|iPhone|pH)$/.test(bare)) out.push({ i: tk.i, n: bare.length, w: bare, want: bare[0].toUpperCase() + bare.slice(1) });
      } else if (MINOR_ALWAYS.has(lower)) {
        if (isUpper && !(parts.length > 1)) out.push({ i: tk.i, n: bare.length, w: bare, want: lower });
        return;
      } else if (!MINOR_OK.has(lower) && !isUpper && /^[\p{Ll}]/u.test(bare)) {
        out.push({ i: tk.i, n: bare.length, w: bare, want: bare[0].toUpperCase() + bare.slice(1) });
      }
      // hyphenated elements after the first
      if (parts.length > 1) {
        let off = parts[0].length + 1;
        for (let pI = 1; pI < parts.length; pI++) {
          const el = parts[pI];
          if (el && /^[\p{Ll}]/u.test(el) && !MINOR_OK.has(el.toLowerCase()) && el.length > 1 && !/\d/.test(el) && !CHEM_DESC.test(el)) out.push({ i: tk.i + off, n: el.length, w: el, want: el[0].toUpperCase() + el.slice(1) });
          off += el.length + 1;
        }
      }
    });
    return out;
  };
  const tcRule = 'Capitalization (Chicago title case): Capitalize the initials of all substantives, including Nouns, Pronouns, Verbs, Adjectives, Adverbs; capitalize the first letter after a colon or an em dash. Do not capitalize coordinating conjunctions or articles; prepositions with four letters or less (e.g., “in”, “on”, “for”) should remain lowercase. Latin expressions such as “In Vivo”, “In Vitro” should be capitalized in the Title and Headings.';
  const reportTitleCase = (P, sec, what) => {
    const [s, e] = trimRange(P);
    let s2 = s;
    if (P.head && P.head.manual) { const m = P.text.slice(s).match(/^((?:\d{1,2}\.)*\d{1,2})\.?\s+/); if (m) s2 = s + m[0].length; }
    if (P.role === 'appendix_heading') { const m = P.text.slice(s).match(/^Appendix\s+[A-Z](\.\d+)*\.?\s*/); if (m) s2 = s + m[0].length; }
    const iss = titleCaseIssues(P, s2, e);
    if (!iss.length) return;
    const lst = iss.slice(0, 12).map(x => `${x.w} → ${x.want}`).join(', ');
    add(P, iss[0].i, iss[iss.length - 1].i + iss[iss.length - 1].n, 'error', 'case', sec, `${what}: ตัวพิมพ์ใหญ่-เล็กไม่ตรงตาม Title Case — ${lst}`, `${what}: capitalization is not Title Case — ${lst}`, (sec === '6.1' ? 'Headings: Please capitalize all initial letters of substantives of headings (rules as in §4.2 Article Title). ' : '') + tcRule);
  };

  // decides whether a reference title is sentence case (leave it) or intended Title Case (then report what breaks it)
  const TC_LOWER = new Set([...MINOR_ALWAYS, 'yet', 'so']);
  const titleConsistency = (P, s, e) => {
    const re = /[\p{L}\p{N}][\p{L}\p{N}'’\-‐]*\.?/gu, str = P.text.slice(s, e), toks = [];
    let m; while ((m = re.exec(str)) !== null) toks.push({ w: m[0], i: s + m.index });
    let cap = 0, low = 0;
    toks.forEach((tk, k) => {
      const prev = toks[k - 1];
      if (k === 0 || /[:—?!]\s*$/.test(P.text.slice(prev.i + prev.w.length, tk.i))) return;
      const w = tk.w.replace(/\.$/, '').replace(/[’']s$/, '').split(/[-‐]/)[0];
      if (!w || w.length < 2 || /\d/.test(w) || /[\p{Lu}]/u.test(w.slice(1)) || /^[α-ωΑ-Ω]/.test(w)) return;
      const lw = w.toLowerCase();
      if (MINOR_OK.has(lw) || UNIT_WORDS.has(w) || P.fmt(tk.i).i) return;
      if (LATIN_PAIRS.some(([a, b]) => lw === a || lw === b)) return;
      if (prev && /^[A-Z][a-z]{2,}$/.test(prev.w) && speciesKind(prev.w, lw, learnedSp)) return;
      if (SPECIES_GENERA.has(w)) return;
      const nearDash = /[–\/]$/.test(P.text.slice(Math.max(s, tk.i - 1), tk.i)) || /^[–\/]/.test(P.text.slice(tk.i + tk.w.length, tk.i + tk.w.length + 1));
      if (/^[\p{Lu}][\p{Ll}]/u.test(w)) { if (w.length > 2 && !nearDash && !properNouns().has(w) && ltwaKnowsWord(w)) cap++; } else if (/^[\p{Ll}]/u.test(w)) low++;
    });
    if (!cap || (cap < 2 && cap < low)) return null; // sentence case (capitals only on proper nouns)
    const all = titleCaseIssues(P, s, e);
    const issues = all.filter(x => x.w.length > 2 || TC_LOWER.has(x.w.toLowerCase())).filter(x => x.want !== x.w.toLowerCase() || TC_LOWER.has(x.w.toLowerCase()));
    // short connecting words (yet, so) that titleCaseIssues allows either way
    toks.forEach((tk, k) => { if (k === 0 || k === toks.length - 1) return; const w = tk.w; if (/^(Yet|So)$/.test(w) && !/[:—?!]\s*$/.test(P.text.slice(toks[k - 1].i + toks[k - 1].w.length, tk.i))) issues.push({ i: tk.i, n: w.length, w, want: w.toLowerCase() }); });
    if (!issues.length) return null;
    return { strong: true, issues: issues.sort((a, b) => a.i - b.i) };
  };
  /* ---------- reference-only extras: Title Case to check, species, super/subscript ---------- */
  const SUPSUB_RULE = 'Symbols: 2, 3 should be real superscript numbers, not inserted symbols such as ², ³. Mathematical Terms: Numbers in superscript/subscript should not be in italics, e.g., H2O2, 103; aEb should be written as a × 10b. Chemical species such as Na+, Si or Fe2+ (§4.2 Keywords); units such as mol·L−1 (§6.1 Units).';
  const SPECIES_RULE = 'Species names should always be in italic, even in titles and headings, e.g., Escherichia coli, Staphylococcus aureus (§6.1). Reference example (§7.12): Kinetic Characteristics of Degradation of Geosmin and 2-Methylisoborneol by Bacillus subtilis. The second word in species names should be lowercase (§4.2 Capitalization).';
  const refExtras = (P, body, bodyOff, authEnd, jm, jS) => {
    const t = P.text, S0 = bodyOff, E0 = bodyOff + body.length;
    const fv = i => { const f = P.fmt(i); return f.math ? null : f.vert; };
    const urls = []; eachMatch(/(https?:\/\/|www\.|doi\.org\/|10\.\d{4,9}\/)\S+/g, body, m => urls.push([S0 + m.index, S0 + m.index + m[0].length]));
    const taken = [];
    const hasMath = (a, b) => { for (let k = a; k < b; k++) if (P.chars[k] && (P.chars[k].math || P.fmt(k).math)) return true; return false; };
    const free = (a, b) => !urls.some(([x, y]) => a < y && b > x) && !taken.some(([x, y]) => a < y && b > x) && !hasMath(a, b);
    const mainMode = authEnd === 'main'; // main text: superscript/subscript checks only
    const flag = (a, b, sev, cat, th, en, rule) => { taken.push([a, b]); add(P, a, b, sev, cat, mainMode ? '6.1' : '7.12', th, en, rule); };
    const allV = (idx, v) => idx.every(i => fv(i) === v);
    if (!mainMode) {
    // 1) Title Case points to check
    const art0 = authEnd > 0 ? S0 + authEnd : -1;
    const chapterAt = body.search(/\.\s+In\s+(?!Proceedings|[A-Z][a-z]+\)$)/);
    const procAt = body.search(/\.\s+(In Proceedings of the|Presented at the)\s/);
    let artEnd = -1;
    if (jm && jS > 0) artEnd = jS;
    else if (chapterAt > 0) artEnd = S0 + chapterAt + 1;
    else if (procAt > 0) artEnd = S0 + procAt + 1;
    if (art0 > 0 && artEnd > art0) {
      // article / chapter / presentation titles keep the authors' preference, but the first letter after a colon or em dash is capitalized
      eachMatch(/[:—]\s*([\p{Ll}][\p{L}-]*)/gu, t.slice(art0, artEnd), m => {
        const w = m[1]; if (/[\p{Lu}\d]/u.test(w.slice(1)) || /^(cis|trans|tert|sec|iso|n|o|m|p|d|l|meso|syn|anti|endo|exo|ortho|meta|para|e|i)-/.test(w) || /^(e\.g|i\.e|vs|via|et)$/.test(w)) return;
        const k = art0 + m.index + m[0].length - w.length;
        flag(k, k + w.length, 'error', 'case', `ชื่อบทความใน Reference: คำแรกหลัง colon (:) หรือ em dash (—) ต้องขึ้นต้นตัวใหญ่ “${w} → ${w[0].toUpperCase() + w.slice(1)}”`, `Article title in the reference: capitalize the first word after a colon or em dash “${w} → ${w[0].toUpperCase() + w.slice(1)}”`, 'Title Element: For journals/magazines/newspapers, article titles, book chapter titles, and titles of presentations, please retain the authors’ preference. Always capitalize the first letter after a colon/em dash.');
      });
      // capitalization consistency: sentence case (only the first word capitalized) is fine; once the title mixes in Title Case, every substantive must be capitalized and the short connecting words lowercase
      {
        let b = artEnd; while (b > art0 && /[\s.,;]/.test(t[b - 1])) b--;
        const c = titleConsistency(P, art0, b);
        if (c) for (const x of c.issues) {
          if (!free(x.i, x.i + x.n)) continue;
          const up = x.want !== x.w.toLowerCase();
          const sev = c.strong ? 'error' : 'check';
          const th = up
            ? (c.strong ? `ชื่อบทความใช้ Title Case แต่คำนี้ยังเป็นตัวเล็ก “${x.w} → ${x.want}”` : `ควรตรวจสอบ: ชื่อบทความมีบางคำขึ้นต้นตัวใหญ่ ถ้าตั้งใจใช้ Title Case คำนี้ต้องเป็น “${x.want}” (ถ้าคำตัวใหญ่ที่เหลือเป็นชื่อเฉพาะ ไม่ต้องแก้)`)
            : `ชื่อบทความใช้ Title Case แต่คำเชื่อม/คำบุพบทสั้นต้องเป็นตัวเล็ก “${x.w} → ${x.want}”`;
          const en = up
            ? (c.strong ? `The article title uses Title Case but this word is lowercase “${x.w} → ${x.want}”` : `Check: some words in the article title are capitalized; if Title Case is intended this should be “${x.want}” (ignore if the capitalized words are proper nouns)`)
            : `The article title uses Title Case but short connecting words stay lowercase “${x.w} → ${x.want}”`;
          flag(x.i, x.i + x.n, up ? sev : 'error', 'case', th, en, 'Title Element: Article titles retain the authors’ preference, but capitalization must be consistent. In Title Case, capitalize all substantives; do not capitalize coordinating conjunctions (and, but, or, nor, yet, so) or articles (a, an, the); prepositions with four letters or less (in, on, for) stay lowercase, those with five or more (During, Through, Against) are capitalized.');
        }
      }
    } else if (art0 > 0 && !jm) {
      // theses, reports, patents, standards, software, online resources: Title Case (book titles in italics are already checked)
      const rest = t.slice(art0, E0);
      const endM = rest.match(/\.\s|;\s|\.$|\s\(accessed|\sAvailable online/);
      const a = art0, b = art0 + (endM ? endM.index : rest.length);
      const seg = t.slice(a, b);
      if (seg.split(/\s+/).length >= 2 && !allFmt(P, a, b, f => f.i) && !/^(Available online|Accessed)/.test(seg)) {
        const iss = titleCaseIssues(P, a, b).filter(x => free(x.i, x.i + x.n));
        if (iss.length) flag(iss[0].i, iss[iss.length - 1].i + iss[iss.length - 1].n, 'check', 'case', `ควรตรวจสอบ Title Case ของชื่อเรื่อง (วิทยานิพนธ์/รายงาน/สิทธิบัตร/มาตรฐาน/ซอฟต์แวร์/เว็บไซต์): ${iss.slice(0, 10).map(x => `${x.w} → ${x.want}`).join(', ')}`, `Check the Title Case of this title (thesis/report/patent/standard/software/online resource): ${iss.slice(0, 10).map(x => `${x.w} → ${x.want}`).join(', ')}`, 'Title Element: Capitalize the first letters of substantives in book titles, conference titles, theses, patent titles, program titles, standard titles, software titles, online resource titles and reports (non-English text can be retained according to the author’s preference).');
      }
    }
    // 2) species names in italics
    const spAbbr = new Map();
    for (const x of [...KNOWN_SPECIES, ...learnedSp]) { const [g, ep] = x.split(' '); spAbbr.set(g[0] + '.' + ep, x); }
    eachMatch(/(?<![\p{L}.])([A-Z][a-z]{2,})\s+(spp?\.|[a-z][a-z-]{2,})(?![\p{L}])/gu, body, m => {
      const g = m[1], ep = m[2]; if (/^spp?\.$/.test(ep)) return; const kind = speciesKind(g, ep, learnedSp); if (!kind) return;
      const a = S0 + m.index, b = a + m[0].length, isSp = /^spp?\.$/.test(ep);
      const e2 = isSp ? a + g.length : b;
      if (!free(a, b) || allFmt(P, a, e2, f => f.i)) return;
      const name = isSp ? g : `${g} ${ep}`;
      flag(a, e2, kind === 'known' ? 'error' : 'check', 'species', `${kind === 'known' ? '' : 'ควรตรวจสอบ: '}ชื่อสปีชีส์ “${name}” ต้องเป็นตัวเอียง${isSp ? ` (“${ep}” ไม่ต้องเอียง)` : ''}`, `${kind === 'known' ? '' : 'Please check: '}species name “${name}” must be italic${isSp ? ` (“${ep}” stays roman)` : ''}`, SPECIES_RULE);
    });
    eachMatch(/(?<![\p{L}.])([A-Z][a-z]{2,})\s+([A-Z][a-z]{3,})(?![\p{L}])/gu, body, m => {
      const g = m[1], ep = m[2].toLowerCase(); if (speciesKind(g, ep, learnedSp) !== 'known') return;
      const a = S0 + m.index, b = a + m[0].length, k = a + m[0].length - m[2].length;
      if (!free(a, b)) return;
      const it = allFmt(P, a, b, f => f.i);
      flag(a, b, 'error', 'species', `ชื่อสปีชีส์ต้องเป็น “${g} ${ep}” — ชื่อที่สองเป็นตัวเล็ก${it ? '' : ' และเป็นตัวเอียงทั้งชื่อ'}`, `The species name must be “${g} ${ep}” — lowercase epithet${it ? '' : ', whole name in italics'}`, 'Species names: the genus is capitalized, the specific epithet is lowercase, and the full name is in italics — also in Title Case reference titles.');
    });
    eachMatch(/(?<![\p{L}.])([A-Z])\.\s?([a-z]{3,})(?![\p{L}])/gu, body, m => {
      const full = spAbbr.get(m[1] + '.' + m[2]) || (SP_EPITHETS.has(m[2]) ? m[1] + '. ' + m[2] : null); if (!full) return;
      const a = S0 + m.index, b = a + m[0].length;
      if (!free(a, b) || allFmt(P, a, b, f => f.i)) return;
      flag(a, b, 'error', 'species', full === m[0] || full.startsWith(m[1] + '. ') ? `ชื่อสปีชีส์ “${m[0]}” ต้องเป็นตัวเอียง` : `ชื่อสปีชีส์ “${m[0]}” (${full}) ต้องเป็นตัวเอียง`, full.startsWith(m[1] + '. ') ? `Species name “${m[0]}” must be italic` : `Species name “${m[0]}” (${full}) must be italic`, SPECIES_RULE);
    });
    }
    // 3) superscript / subscript
    const supRule = SUPSUB_RULE;
    // 3a ions: Na+, Ca2+, SO42−, NH4+
    eachMatch(ION_RE, body, m => {
      const base = m[1], chg = (m[2] || '') + m[3];
      const okSigns = ION_SIGN.get(base).split('|');
      if (!okSigns.some(s => s.replace('−', '') === chg.replace(/[−-]/, ''))) return;
      if (base.length === 1 && /^(H|K|U|S|O)$/.test(base) && !m[2] && !/^(H|K)$/.test(base)) return;
      const a = S0 + m.index, b = a + m[0].length; if (!free(a, b)) return;
      const pf = parseFormula(base) || { digits: [] };
      const subIdx = pf.digits.map(d => a + d), supIdx = []; for (let k = a + base.length; k < b; k++) supIdx.push(k);
      if (allV(subIdx, 'subscript') && allV(supIdx, 'superscript') && m[3] !== '-') return;
      const want = base.replace(/\d/g, d => SUB_DIG[d]) + toSup(chg.replace('-', '−'));
      flag(a, b, 'error', 'supsub', `ประจุไอออนต้องเป็นตัวยก${pf.digits.length ? ' และตัวเลขในสูตรเป็นตัวห้อย' : ''}: “${m[0]}” → “${want}”${m[3] === '-' ? ' (ใช้เครื่องหมายลบ − ไม่ใช่ hyphen)' : ''}`, `Ion charge must be superscript${pf.digits.length ? ' and formula numbers subscript' : ''}: “${m[0]}” → “${want}”${m[3] === '-' ? ' (use the minus sign −, not a hyphen)' : ''}`, supRule);
    });
    // 3b isotopes: 13C, 15N, 137Cs, 99mTc, δ13C, 1H NMR
    eachMatch(/(?<![\p{L}\p{N}.,\/:–-])(\d{1,3})(m?)([A-Z][a-z]?)(?![a-z])/gu, body, m => {
      let el = m[3]; if (!ELEM_Z.has(el)) { el = el[0]; if (!ELEM_Z.has(el)) return; }
      const Z = ELEM_Z.get(el), A = Number(m[1]);
      const ok = Z === 1 ? A <= 3 : (A >= 1.8 * Z && A <= 2.6 * Z + 12);
      if (!ok) return;
      const a = S0 + m.index, mEnd = a + m[1].length + m[2].length;
      if (/^\s*(rRNA|rDNA|ribosom|subunit)/.test(t.slice(mEnd + el.length))) return;
      if (!free(a, mEnd + el.length)) return;
      const idx = []; for (let k = a; k < mEnd; k++) idx.push(k);
      if (allV(idx, 'superscript')) return;
      const strong = /δ\s?$/.test(t.slice(Math.max(0, a - 2), a)) || /^\s?(NMR|MRI|PET|labell?ed|isotop)/i.test(t.slice(mEnd + el.length));
      flag(a, mEnd + el.length, strong ? 'error' : 'check', 'supsub', `${strong ? '' : 'ควรตรวจสอบ: '}เลขมวลของไอโซโทปต้องเป็นตัวยก “${m[1]}${m[2]}${el}” → “${toSup(m[1] + m[2])}${el}”`, `${strong ? '' : 'Please check: '}the isotope mass number must be superscript “${m[1]}${m[2]}${el}” → “${toSup(m[1] + m[2])}${el}”`, supRule);
    });
    // 3f common terms: IC50, PM2.5, Cmax, t1/2, pKa
    for (const [re, kind, sev] of KNOWN_SUBTERMS) eachMatch(re, body, m => {
      const a = S0 + m.index, b = a + m[0].length; if (!free(a, b)) return;
      const sS = b - m[1].length; const idx = []; for (let k = sS; k < b; k++) idx.push(k);
      if (allV(idx, 'subscript')) return;
      flag(a, b, sev, 'supsub', `${sev === 'check' ? 'ควรตรวจสอบ: ' : ''}“${m[1]}” ใน “${m[0]}” ต้องเป็นตัวห้อย${/^[\d.\/]+$/.test(m[1]) ? ` → “${m[0].slice(0, m[0].length - m[1].length)}${toSub(m[1])}”` : ''}`, `${sev === 'check' ? 'Please check: ' : ''}“${m[1]}” in “${m[0]}” should be subscript`, supRule);
    });
    // 3c chemical formulas: CO2, Fe2O3, Ca(OH)2
    eachMatch(/(?<![\p{L}\p{N}_\/.·-])(?:g-)?([A-Z(][A-Za-z0-9()]*\d[A-Za-z0-9()]*)(?![\p{L}\p{N}])/gu, body, m => {
      const tok = m[1]; const pf = parseFormula(tok); if (!pf || !pf.digits.length) return;
      const single = pf.groups === 1 && /^(O2|O3|N2|H2|Cl2|Br2|I2|F2|S8|P4)$/.test(tok);
      if (pf.groups < 2 && !single) return;
      if (/^PC\d+$/.test(tok) || /^(PS|CS|BS|SS|PP|CP|NS|SP|BP|CN)\d$/.test(tok)) return;
      if (!COMMON_FORMULAS.has(tok) && /^[A-Z]\d+[A-Z]\d*$/.test(tok)) return; // codes such as sensor W1C, W5S
      const a = S0 + m.index + m[0].length - tok.length, b = a + tok.length; if (!free(a, b)) return;
      const idx = pf.digits.map(d => a + d);
      if (allV(idx, 'subscript')) return;
      const sev = COMMON_FORMULAS.has(tok) || pf.groups >= 3 || pf.two ? 'error' : 'check';
      const supWrong = idx.some(i => fv(i) === 'superscript');
      const want = tok.replace(/\d/g, d => SUB_DIG[d]);
      flag(a, b, sev, 'supsub', `${sev === 'check' ? 'ควรตรวจสอบ: ' : ''}ตัวเลขในสูตรเคมีต้องเป็นตัวห้อย${supWrong ? ' (ไม่ใช่ตัวยก)' : ''}: “${tok}” → “${want}”`, `${sev === 'check' ? 'Please check: ' : ''}numbers in a chemical formula must be subscript${supWrong ? ' (not superscript)' : ''}: “${tok}” → “${want}”`, supRule);
    });
    // 3d unit exponents: m2, cm-1, mg L-1, kg ha−1
    eachMatch(UNIT_EXP_RE, body, m => {
      const a = S0 + m.index, b = a + m[0].length;
      const before = t.slice(Math.max(S0, a - 12), a);
      const neg = /^[−-]/.test(m[3]);
      if (!/(\d\s?|[·\/]|\s(m|cm|mm|km|g|kg|mg|μg|µg|L|mL|s|h|d|ha|mol|mmol|yr|min|W|J|t|N|kPa)\s|\d\s(m|cm|mm|km|g|kg|mg|μg|µg|L|mL|mol)\s)$/u.test(before) && !(neg && /\s$/.test(before))) return;
      if (!neg && /^(s|h|d|min|yr|day|t|N|W|J|Da|mol|L|cell|cells|plant|plants|tree|trees)$/.test(m[1])) return;
      if (!free(a, b)) return;
      const eS = a + m[1].length; const idx = []; for (let k = eS; k < b; k++) idx.push(k);
      if (!m[2] && allV(idx, 'superscript') && !/^-/.test(m[3])) return;
      flag(a, b, 'error', 'supsub', `เลขชี้กำลังของหน่วยต้องเป็นตัวยก: “${m[0]}” → “${m[1]}${toSup(m[3].replace('-', '−'))}”${/^-/.test(m[3]) ? ' (ใช้เครื่องหมายลบ −)' : ''}`, `Unit exponents must be superscript: “${m[0]}” → “${m[1]}${toSup(m[3].replace('-', '−'))}”${/^-/.test(m[3]) ? ' (use the minus sign −)' : ''}`, supRule);
    });
    // 3e × 10n and 10^n
    eachMatch(/(×\s?10)(\^?)([−-]?\d+)|(?<![\p{N}.])(10)\^([−-]?\d+)/gu, body, m => {
      const a = S0 + m.index, b = a + m[0].length; if (!free(a, b)) return;
      const ex = m[3] || m[5]; const eS = b - ex.length; const idx = []; for (let k = eS; k < b; k++) idx.push(k);
      if (m[3] && /^0/.test(m[3]) && !m[2]) return; // “× 100” is multiplication, not 10⁰
      if (/^\s*%/.test(t.slice(b, b + 3))) return;
      if (!m[2] && !m[5] && allV(idx, 'superscript')) return;
      flag(a, b, 'error', 'supsub', `เลขชี้กำลังต้องเป็นตัวยก: “${m[0]}” → “${(m[1] || '10').replace('^', '')}${toSup(ex.replace('-', '−'))}”`, `The exponent must be superscript: “${m[0]}” → “${(m[1] || '10')}${toSup(ex.replace('-', '−'))}”`, supRule);
    });
    // 3g degree written with a raised letter o / ordinal sign
    eachMatch(/(\d)\s?([oº˚0])C(?![\p{L}])/gu, body, m => {
      const k = S0 + m.index + m[0].length - 2; if (!free(k, k + 2)) return;
      if (m[2] === '0' || m[2] === 'o') { if (fv(k) !== 'superscript') return; }
      flag(k, k + 2, 'error', 'supsub', `ใช้สัญลักษณ์องศา “°” (U+00B0) ไม่ใช่ตัว “${m[2]}” ที่ตั้งเป็นตัวยก: “°C”`, `Use the degree sign “°” (U+00B0), not a raised “${m[2]}”: “°C”`, 'Units: 90 °F (180 °C); ° (angular degrees, UTF-16: 00B0).');
    });
    // 3h pre-composed subscript characters
    eachMatch(/[₀-₉₊₋]+/g, body, m => { const a = S0 + m.index; if (free(a, a + m[0].length)) flag(a, a + m[0].length, 'error', 'supsub', `“${m[0]}” เป็นอักขระตัวห้อยสำเร็จรูป ต้องใช้ตัวเลขปกติแล้วตั้งเป็น subscript`, `“${m[0]}” is a pre-composed subscript character; type a normal number formatted as subscript`, supRule); });
  };
  // the same superscript/subscript checks for the main text (ions, isotopes, formulas, unit exponents, × 10ⁿ, °C)
  paras.forEach(P => {
    if (P.empty || !['body', 'appendix_body', 'list', 'fig_caption', 'tab_caption', 'table_cell', 'table_footnote', 'abstract_body', 'quote'].includes(P.role)) return;
    const [s0, e0] = trimRange(P); if (e0 <= s0) return;
    refExtras(P, P.text.slice(s0, e0), s0, 'main', null, -1);
  });

  // a file that is only a reference list (no main text): skip the “whole article” requirements
  const refsOnly = paras.some(P => P.role === 'ref') && !paras.some(P => !P.empty && ['body', 'heading', 'fig_caption', 'tab_caption', 'table_cell', 'abstract_body', 'abstract_mixed', 'title'].includes(P.role));
  const art = paras.find(P => P.role === 'article_type');
  if (art && /type of the paper|\(article, review/i.test(art.text)) add(art, null, null, 'error', 'front', '4.2', 'ยังเป็นข้อความตัวอย่างจากเทมเพลต ต้องเหลือเฉพาะประเภทบทความ เช่น “Article”', 'Template placeholder text — keep only the article type, e.g., “Article”', 'Article Type: For available article types for MDPI papers, see https://i.mdpi.cn/team/committee/guide/214.');
  if (!art && front.length && !refsOnly) add(front.find(P => !P.inBox) || front[0], null, null, 'check', 'front', '4.2', 'ไม่พบบรรทัด Article Type (เช่น “Article”) เหนือชื่อเรื่อง', 'No Article Type line (e.g., “Article”) found above the title', 'Article Type: Font size: 10 pt, Italics. Alignment: Left. Spacing: Before: 12 pt; After: 0 pt.');
  const titleP = paras.find(P => P.role === 'title');
  if (titleP) {
    const [s, e] = trimRange(titleP);
    const tt = titleP.text.slice(s, e);
    if (/\.$/.test(tt) && !/\b(spp|sp|L|var|al|Roxb|Rothm|f)\.$/.test(tt) && !/\b[A-Z]\.$/.test(tt)) add(titleP, e - 1, e, 'error', 'front', '4.2', 'ห้ามมีจุด (.) ท้ายชื่อเรื่อง', 'No period at the end of the article title', 'Periods (full-stops) are not allowed in the middle or at the end of the article title. A colon or em dash is recommended instead of a period.');
    eachMatch(/[a-z]{3,}\.\s+(?=[A-Z])/g, tt, m => add(titleP, s + m.index + m[0].indexOf('.'), s + m.index + m[0].indexOf('.') + 1, 'error', 'front', '4.2', 'มีจุด (.) กลางชื่อเรื่อง ให้ใช้ colon (:) หรือ em dash (—) แทน', 'Period in the middle of the title; use a colon or an em dash instead', 'Periods (full-stops) are not allowed in the middle or at the end of the article title. A colon or em dash is recommended instead of a period.'));
    if (/\b(running title|short title|running head)\b/i.test(tt)) add(titleP, null, null, 'error', 'front', '4.2', 'ห้ามใส่ Running Title / Short Title', 'Running Title / Short Title is not allowed', 'Information such as “Running Title”, “Running Head”, “Short Title”, etc., is not allowed.');
    reportTitleCase(titleP, '4.2', tx('ชื่อเรื่อง', 'Title'));
  }
  paras.filter(P => P.role === 'running').forEach(P => add(P, null, null, 'error', 'front', '4.2', 'ห้ามใส่ Running Title / Short Title — ให้ลบออก', 'Running Title / Short Title is not allowed — remove it', 'Information such as “Running Title”, “Running Head”, “Short Title”, etc., is not allowed. For example, the Running Title should be removed.'));

  const affParas = paras.filter(P => P.role === 'affiliation');
  const authorsP = paras.find(P => P.role === 'authors');
  if (authorsP) {
    const t = authorsP.text;
    const [s, e] = trimRange(authorsP);
    // superscript runs
    const sup = i => authorsP.fmt(i).vert === 'superscript';
    const firstOrder = []; let seen = new Set();
    let i = s;
    while (i < e) {
      if (/[\d]/.test(t[i]) && !sup(i)) {
        let j = i; while (j < e && /[\d,*]/.test(t[j]) && !sup(j)) j++;
        const prevCh = t[i - 1] || '';
        if (/[\p{L}.\s]/u.test(prevCh)) add(authorsP, i, j, 'error', 'front', '4.2', 'เลข affiliation ต้องเป็นตัวยก (superscript)', 'Affiliation numbers must be superscript', 'Author Affiliation Numbers: Font: 10 pt, superscript.');
        i = j; continue;
      }
      if (sup(i) && /\S/.test(t[i])) {
        let j = i; while (j < e && sup(j)) j++;
        const seg = t.slice(i, j);
        if (i > 0 && /[\p{L}.]/u.test(t[i - 1])) add(authorsP, i, j, 'error', 'front', '4.2', 'ต้องเว้นวรรค 1 ช่องระหว่างชื่อผู้แต่งกับเลข affiliation', 'A normal space is required between the author name and the affiliation numbers', 'Author Affiliation Numbers: A normal space is required between author name and affiliation numbers; no space is required between affiliation numbers, only a superscript comma.');
        if (/\s/.test(seg.trim())) add(authorsP, i, j, 'error', 'front', '4.2', 'ห้ามเว้นวรรคระหว่างเลข affiliation ใช้เพียงลูกน้ำตัวยก เช่น 1,2', 'No spaces between affiliation numbers, only a superscript comma, e.g., 1,2', 'Author Affiliation Numbers: no space is required between affiliation numbers, only a superscript comma.');
        if (/\*/.test(seg)) { const k = i + seg.indexOf('*'); add(authorsP, k, k + 1, 'error', 'front', '4.2', 'เครื่องหมาย * ของ corresponding author ต้องเป็นตัวหนา และ “ไม่” เป็นตัวยก', 'The corresponding-author * must be bold and NOT superscript', '* (a regular asterisk, non-superscript, bold) should always be reserved for the corresponding author, e.g., Mark N. Breckels 1,2,*.'); }
        const nums = (seg.match(/\d+/g) || []).map(Number);
        for (let q = 1; q < nums.length; q++) if (nums[q] < nums[q - 1]) { add(authorsP, i, j, 'error', 'front', '4.2', 'เลข affiliation ของผู้แต่งคนเดียวกันต้องเรียงจากน้อยไปมาก', 'An author’s affiliation numbers must be in numerical order', 'If one author has more than one affiliation number, affiliation numbers should be in numerical order, e.g., Edward A. Codling 1,3.'); break; }
        nums.forEach(n => { if (!seen.has(n)) { seen.add(n); firstOrder.push({ n, i, j }); } });
        i = j; continue;
      }
      i++;
    }
    for (let q = 0; q < firstOrder.length; q++) if (firstOrder[q].n !== q + 1) { add(authorsP, firstOrder[q].i, firstOrder[q].j, 'error', 'front', '4.2', `การปรากฏครั้งแรกของเลข affiliation ต้องเรียงตามลำดับ (พบ ${firstOrder[q].n} แต่ควรเป็น ${q + 1})`, `First occurrences of affiliation numbers must be in numerical order (found ${firstOrder[q].n}, expected ${q + 1})`, 'The first occurrence of each number should be in numerical order, e.g., Mark N. Breckels 1,2,*, Nikolai W. F. Bode 3, Edward A. Codling 1,3 and Michael Steinke 1.'); break; }
    eachMatch(/\*/g, t, m => {
      const f = authorsP.fmt(m.index);
      if (f.vert !== 'superscript' && !f.b) add(authorsP, m.index, m.index + 1, 'error', 'front', '4.2', 'เครื่องหมาย * ต้องเป็นตัวหนา', 'The * must be bold', '* (a regular asterisk, non-superscript, bold) should always be reserved for the corresponding author.');
    });
    const plain = t.replace(/[\d*†‡§¶‖,￼]+(?=\s|,|$| and)/g, m => m);
    if (/\s&\s/.test(t)) { const k = t.indexOf('&'); add(authorsP, k, k + 1, 'error', 'front', '4.2', 'ใช้ “and” แทน “&” ระหว่างผู้แต่งสองคนสุดท้าย', 'Use “and” instead of “&” between the last two authors', 'Names are separated with commas; “and” is only used between the last two authors: “Li Zheng, Zhongda Shao and Chongzheng Xu”.'); }
    eachMatch(/,\s*and\s/g, t, m => add(authorsP, m.index, m.index + m[0].length - 1, 'error', 'front', '4.2', 'ไม่ต้องมีลูกน้ำหน้า “and” (ไม่ใช้ serial comma)', 'No comma before “and” (no serial comma)', 'Names are separated with commas; “and” is only used between the last two authors: “Li Zheng, Zhongda Shao and Chongzheng Xu”.'));
    eachMatch(/;/g, t, m => add(authorsP, m.index, m.index + 1, 'error', 'front', '4.2', 'คั่นชื่อผู้แต่งด้วยลูกน้ำ (,) ไม่ใช่ semicolon', 'Separate author names with commas, not semicolons', 'Names are separated with commas; “and” is only used between the last two authors.'));
    const nameCount = t.split(/,|\sand\s|&/).filter(x => /\p{L}{2,}/u.test(x)).length;
    if (nameCount >= 2 && !/\sand\s|&/.test(t)) add(authorsP, null, null, 'error', 'front', '4.2', 'ต้องใช้ “and” ระหว่างผู้แต่งสองคนสุดท้าย', '“and” must be used between the last two authors', 'Names are separated with commas; “and” is only used between the last two authors: “Li Zheng, Zhongda Shao and Chongzheng Xu”.');
    eachMatch(/\b(Dr|Prof|Mr|Mrs|Ms|Assoc\. Prof|Asst\. Prof)\.?\s|\b(PhD|Ph\.D\.|MD|MSc|M\.Sc\.|BSc|B\.Sc\.)\b/g, t, m => add(authorsP, m.index, m.index + m[0].trim().length, 'error', 'front', '4.2', 'ต้องลบคำนำหน้า/วุฒิการศึกษา (Dr., Prof., PhD, MD …) ออกจากชื่อผู้แต่ง', 'Remove titles/academic suffixes (Dr., Prof., PhD, MD …) from author names', 'Titles (Dr., Mr., Ms., etc.) or academic suffixes (MD, MSc., BSc., etc.) should be deleted in authors’ names.'));
    eachMatch(/(?<![\p{L}])\p{Lu}[\p{Lu}'’-]{2,}(?![\p{L}])/gu, t, m => { if (!/^(II|III|IV|VI|VII|VIII)$/.test(m[0]) && authorsP.fmt(m.index).vert !== 'superscript' && !/^(\(|on behalf)/.test(t.slice(m.index - 1))) add(authorsP, m.index, m.index + m[0].length, 'check', 'front', '4.2', `ชื่อผู้แต่งเป็นตัวพิมพ์ใหญ่ทั้งคำ “${m[0]}” — ห้ามพิมพ์ใหญ่ทั้งหมด (ยกเว้นชื่อกลุ่ม/ตัวย่อ)`, `Author name in all capitals “${m[0]}” — do not capitalize all letters (unless a group acronym)`, 'Do not capitalize all letters of an author’s name.'); });
    eachMatch(/\b([A-Z])\.([A-Z])\./g, t, m => add(authorsP, m.index, m.index + m[0].length, 'error', 'front', '4.2', 'ต้องเว้นวรรคระหว่างชื่อย่อ เช่น “Fernanda C. G. Barbosa”', 'A normal space is required between abbreviated names, e.g., “Fernanda C. G. Barbosa”', 'A normal space is required between Firstname, Middlename, and Lastname, e.g., Fernanda C. G. Barbosa.'));
    eachMatch(/(?<![\p{L}.])([A-Z])(?=\s+[A-Z][a-z])/gu, t, m => { if (authorsP.fmt(m.index).vert !== 'superscript') add(authorsP, m.index, m.index + 1, 'check', 'front', '4.2', `ชื่อย่อ “${m[0]}” ต้องมีจุดตามหลัง`, `Abbreviated name “${m[0]}” needs a period`, 'Middle names can be added, abbreviated, or optionally written in full at the authors’ discretion. A period is required after an abbreviated name.'); });
    if (affParas.length === 1 && /\d/.test(t.replace(/[^\d]/g, '')) && [...t].some((c, ix) => /\d/.test(c) && authorsP.fmt(ix).vert === 'superscript')) add(authorsP, null, null, 'error', 'front', '4.2', 'มี affiliation เพียงหน่วยงานเดียว จึงไม่ต้องใส่เลข affiliation', 'There is only one affiliation, so no affiliation numbers should be used', 'If there is only one affiliation, there should be no affiliation number; if there is more than one affiliation, affiliation numbers should be added as superscript Arabic numbers.');
    if (nameCount === 1 && /\*/.test(t)) add(authorsP, t.indexOf('*'), t.indexOf('*') + 1, 'error', 'front', '4.2', 'บทความมีผู้แต่งคนเดียว ต้องลบเครื่องหมาย * ออก', 'Single-author paper: delete the corresponding-author asterisk', 'If there is only one author for a paper, the asterisk symbol of the correspondence author should be deleted.');
  }
  // affiliations
  for (const P of affParas) {
    const t = P.text; const [s, e] = trimRange(P);
    const m = t.slice(s).match(/^(\d{1,2})(\s*)/);
    if (m) {
      const after = t[s + m[1].length];
      if (after !== '\t') add(P, s, s + m[1].length, 'error', 'front', '4.2', 'ต้องมี Tab หลังเลข affiliation', 'A tab is required after the affiliation number', 'Author Affiliations: A tab is required after the affiliation numbers.');
      if (P.fmt(s).vert !== 'superscript') add(P, s, s + m[1].length, 'check', 'front', '4.2', 'เลข affiliation ควรเป็นตัวยก (superscript) ตามเทมเพลต MDPI', 'The affiliation number should be superscript as in the MDPI template', 'Author Affiliation Numbers: superscript Arabic numbers.');
    }
    const tt = t.slice(s, e);
    if (/\.$/.test(tt)) add(P, e - 1, e, 'error', 'front', '4.2', 'ห้ามมีจุดท้าย affiliation', 'No period at the end of an affiliation', 'Author Affiliations: There should be no period/full stop at the end of the affiliations.');
    eachMatch(/,\s*(?=[\w.+-]+@)/g, t, mm => add(P, mm.index, mm.index + 1, 'error', 'front', '4.2', 'คั่นที่อยู่กับอีเมลด้วย semicolon (;) ไม่ใช่ลูกน้ำ', 'Separate the address and e-mail with a semicolon, not a comma', 'E-mails: Addresses and e-mail addresses should be separated with a semicolon; e-mail addresses should also be separated with a semicolon.'));
    eachMatch(/@[\w.-]+\.[a-z]{2,}\s*(,|\band\b)\s*(?=[\w.+-]+@)/gi, t, mm => add(P, mm.index, mm.index + mm[0].length, 'error', 'front', '4.2', 'คั่นอีเมลแต่ละรายการด้วย semicolon (;)', 'Separate e-mail addresses with semicolons', 'E-mails: e-mail addresses should also be separated with a semicolon.'));
    const emails = []; eachMatch(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, t, mm => emails.push(mm));
    emails.forEach(mm => {
      if (/[A-Z]/.test(mm[0])) add(P, mm.index, mm.index + mm[0].length, 'error', 'front', '4.2', 'อีเมลต้องเป็นตัวพิมพ์เล็กทั้งหมด', 'E-mail addresses must be lowercase', 'E-mail addresses should be in lowercase English letters.');
      if (/@qq\.com$|@yahoo\.(com\.)?cn$/i.test(mm[0])) add(P, mm.index, mm.index + mm[0].length, 'error', 'front', '4.2', 'ไม่อนุญาตอีเมล QQ หรือ Yahoo .cn', 'QQ and yahoo .cn e-mail addresses are not permitted', 'QQ e-mail addresses are not permitted; Yahoo email addresses ending in “.cn”, e.g., “yahoo.cn” or “yahoo.com.cn”, are not permitted.');
    });
    if (emails.length > 1 && !/\(\s*[A-Z][\p{L}.‘’'\-/]*\.\s*\)/u.test(t)) add(P, emails[0].index, emails[emails.length - 1].index + emails[emails.length - 1][0].length, 'error', 'front', '4.2', 'มีอีเมลมากกว่า 1 รายการ ต้องใส่อักษรย่อชื่อผู้แต่งหลังแต่ละอีเมล เช่น (A.B.)', 'More than one e-mail: add the author initials after each e-mail, e.g., (A.B.)', 'Author name abbreviations: If there is more than one e-mail address after the address, the initial letters for author names should be listed after their e-mail, e.g., mairead.mcnamara@uhn.on.ca (M.G.M.N.); ssahebjam@gmail.com (S.S.)');
    eachMatch(/\b(Dr|Prof|Mr|Mrs|Ms)\.\s|\b(PhD|MD|MSc|BSc)\b/g, t, mm => add(P, mm.index, mm.index + mm[0].trim().length, 'error', 'front', '4.2', 'ห้ามมีคำนำหน้า/วุฒิในที่อยู่', 'Titles/academic suffixes must be removed from addresses', 'Titles (Dr., Mr., Ms., etc.), academic suffixes (MD, MSc., BSc., etc.), sponsor information, and non-email social media accounts should be avoided.'));
    // address segments
    const addr = tt.replace(/^\d{1,2}\s*/, '').split(/;\s*(?=[\w.+-]+@)/)[0];
    const segs = addr.split(/,\s*/).map(x => x.trim()).filter(Boolean);
    if (segs.length >= 2) {
      const country = segs[segs.length - 1].replace(/\.$/, '');
      const cIdx = t.lastIndexOf(country, s + addr.length + 3);
      for (const [re, want] of COUNTRY_FIX) if (re.test(country) && country !== want) { add(P, cIdx, cIdx + country.length, 'error', 'front', '4.2', `ชื่อประเทศ “${country}” ต้องเขียนเป็น “${want}”`, `Country name “${country}” should be “${want}”`, 'Country/Region: We should use the proper format for a Country/Region name, e.g., Republic of Korea (not Korea or South Korea), China (not P.R. China), Taiwan (not Taiwan R.O.C.), United Arab Emirates (not UAE), Côte d’Ivoire, North Macedonia, The Gambia, The Netherlands, UK, Brazil, USA.'); break; }
      const cityPart = segs[segs.length - 2];
      const cpIdx = t.lastIndexOf(cityPart, cIdx);
      const cn = country.replace(/^The /, 'The ');
      if (/^(USA|Canada|United States.*|U\.S\.A\.?)$/i.test(country)) {
        if (!/^[A-Z]{2}\s+[\dA-Z][\dA-Z -]{2,}$/.test(cityPart)) add(P, cpIdx, cpIdx + cityPart.length, 'error', 'front', '4.2', 'สหรัฐฯ/แคนาดา ต้องเป็นรูปแบบ “City, State (Abbr.) Postcode, Country” เช่น Los Angeles, CA 90089, USA', 'USA/Canada format must be “City, State (Abbr.) Postcode, Country”, e.g., Los Angeles, CA 90089, USA', 'States or provinces — USA and Canada: The state or province is required; format: “City, State (Abbr.) Postcode, Country” (for example: “Los Angeles, CA 90089, USA”; “Victoria, BC V8W 2Y2, Canada”).');
      } else if (/^China$/i.test(country)) {
        const pv = segs.find(x => /Province$/i.test(x));
        if (pv) { const k = t.indexOf(pv); add(P, k, k + pv.length, 'error', 'front', '4.2', 'ที่อยู่ในจีนห้ามใส่ชื่อมณฑล (Province)', 'Province information is not permitted for China', 'States or provinces — China: Province information is not permitted (for example: “Wuhan 430000, China”).'); }
        if (/^\d{6}\s+\p{L}/u.test(cityPart)) add(P, cpIdx, cpIdx + cityPart.length, 'error', 'front', '4.2', 'รหัสไปรษณีย์ต้องอยู่หลังชื่อเมือง เช่น Wuhan 430000, China', 'The postcode must follow the city, e.g., Wuhan 430000, China', 'For other countries, the postcode should be put after the city.');
      } else if (EUROPE.test(cn)) {
        if (/^[\p{L} .'’-]+\s+\d{3,5}(-\d+)?$/u.test(cityPart)) add(P, cpIdx, cpIdx + cityPart.length, 'error', 'front', '4.2', 'ประเทศในยุโรป (ยกเว้น UK) รหัสไปรษณีย์ต้องอยู่ “หน้า” ชื่อเมือง เช่น 00050 Fiumicino, Italy', 'For European countries (except UK) the postcode goes BEFORE the city, e.g., 00050 Fiumicino, Italy', 'For European countries (except UK): “Postcode City, (State), Country” (for example: “00050 Fiumicino, RM, Italy”).');
      } else if (/^\d{4,6}\s+\p{L}/u.test(cityPart)) {
        add(P, cpIdx, cpIdx + cityPart.length, 'error', 'front', '4.2', 'ประเทศนอกยุโรป (รวม UK) รหัสไปรษณีย์ต้องอยู่ “หลัง” ชื่อเมือง เช่น Bangkok 10330, Thailand', 'For countries outside Europe (including UK) the postcode goes AFTER the city, e.g., Bangkok 10330, Thailand', 'For other countries (including UK): “City Postcode, (State), Country” (for example: “London KT1 2EE, UK”).');
      }
      if (/^\d{5}$/.test(cityPart) || /,\s*\d{4,6},/.test(addr)) { const mm = addr.match(/,\s*(\d{4,6}),/); if (mm) { const k = t.indexOf(mm[1]); add(P, k, k + mm[1].length, 'error', 'front', '4.2', 'ไม่ต้องมีลูกน้ำระหว่างรหัสไปรษณีย์กับชื่อเมือง ใช้เว้นวรรค', 'No comma between the postcode and the city/state, only a normal space', 'Addresses should be separated with commas; no comma is required between post/zip codes and city/state abbreviations, only a normal space.'); } }
      // subordinate → superior
      const uIdx = segs.findIndex(x => /\bUniversity\b|\bUniversit[éàä]/i.test(x) && !/\b(Department|School|Faculty|Institute|College|Center|Centre|Laboratory|Division|Unit|Program)\b/i.test(x));
      const dIdx = segs.findIndex(x => /\b(Department|School|Faculty|College of|Laboratory|Division|Institute|Center|Centre|Campus|Unit|Program|Programme|Graduate)\b/i.test(x));
      if (uIdx >= 0 && dIdx > uIdx) { const k = t.indexOf(segs[uIdx]); add(P, k, k + segs[uIdx].length, 'error', 'front', '4.2', 'ต้องเรียงที่อยู่จากหน่วยงานย่อยไปใหญ่ (Department/School ก่อน University)', 'Sort the address from subordinate to superior (Department/School before University)', 'Address information should be sorted from subordinate to superior, e.g., the Department should be put before the University.'); }
      if (uIdx >= 0 && dIdx < 0 && !/University of Chinese Academy of Sciences/i.test(addr) && !/Independent Researcher/i.test(addr)) { const k = t.indexOf(segs[uIdx]); add(P, k, k + segs[uIdx].length, 'check', 'front', '4.2', 'ที่อยู่เป็นมหาวิทยาลัยแต่ไม่มีหน่วยงานย่อย (Department/School/Faculty/Campus)', 'University address without a sub-unit (Department/School/Faculty/Campus)', 'If the address is a University or vocational college, it should have sub-unit (Department, School, Faculty, Campus, etc.) as well.'); }
    }
  }
  // correspondence
  paras.filter(P => P.role === 'corr').forEach(P => {
    const t = P.text; const [s, e] = trimRange(P);
    if (!/^\*\t\s*Correspondence:/.test(t.slice(s))) add(P, s, Math.min(e, s + 16), 'error', 'front', '4.2', 'ต้องขึ้นต้นด้วย “* (Tab) Correspondence:”', 'Must start with “* (tab) Correspondence:”', 'Corresponding Author Contact Information: Add in a new paragraph after the affiliation and start with “* (tab) Correspondence:”.');
    if (/\.$/.test(t.slice(s, e))) add(P, e - 1, e, 'error', 'front', '4.2', 'ห้ามมีจุดท้ายบรรทัด Correspondence', 'No period at the end of the Correspondence line', 'There should be no period/full stop at the end of the Corresponding Author Contact Information.');
    eachMatch(/(Tel|Fax|Phone|Tel\.\/Fax)\.?\s*:?\s*(\(?[\d+][\d\s()\-–]{5,})/gi, t, m => { const num = m[2]; const k = m.index + m[0].indexOf(num); if (!/^\+/.test(num.trim())) add(P, k, k + num.trim().length, 'error', 'front', '4.2', 'เบอร์โทร/แฟกซ์ต้องขึ้นต้นด้วย “+” และรหัสประเทศ คั่นด้วยยัติภังค์ เช่น +86-10-5847-9561', 'Telephone/fax numbers must start with “+” and the country code, hyphenated, e.g., +86-10-5847-9561', 'Telephone and fax numbers should start with “+”, and the country calling code should be added and hyphenated; e.g., Tel.: +86-10-5847-9561.'); else if (/\s/.test(num.trim())) add(P, k, k + num.trim().length, 'error', 'front', '4.2', 'เบอร์โทรต้องคั่นด้วยยัติภังค์ (-) ไม่ใช่เว้นวรรค', 'Telephone numbers must be hyphenated, not spaced', 'Telephone and fax numbers should start with “+”, and the country calling code should be added and hyphenated.'); });
    eachMatch(/@[\w.-]+\.[a-z]{2,}\s*,\s*(?=[\w.+-]+@|Tel|Fax)/gi, t, m => add(P, m.index, m.index + m[0].length, 'error', 'front', '4.2', 'คั่นอีเมล/เบอร์โทรด้วย semicolon (;)', 'Separate e-mail, telephone and fax with semicolons', 'The e-mail address, telephone number, and fax number should be separated with a semicolon.'));
    eachMatch(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, t, m => { if (/[A-Z]/.test(m[0])) add(P, m.index, m.index + m[0].length, 'error', 'front', '4.2', 'อีเมลต้องเป็นตัวพิมพ์เล็กทั้งหมด', 'E-mail addresses must be lowercase', 'E-mail addresses should be in lowercase English letters.'); });
  });
  paras.filter(P => P.role === 'frontnote').forEach(P => { const [s, e] = trimRange(P); if (!/\.$/.test(P.text.slice(s, e))) add(P, e - 1, e, 'error', 'front', '4.2', 'Front note ต้องจบด้วยจุด (.)', 'A front note must end with a period', 'Front Notes: A full stop/period is required at the end of each note.'); });
  if (authorsP && paras.filter(P => P.role === 'corr').length === 0 && /\*/.test(authorsP.text)) add(authorsP, authorsP.text.indexOf('*'), authorsP.text.indexOf('*') + 1, 'error', 'front', '4.2', 'มีเครื่องหมาย * แต่ไม่พบบรรทัด “* Correspondence:”', 'An * is used but no “* Correspondence:” line was found', 'Corresponding Author Contact Information: Add in a new paragraph after the affiliation and start with “* (tab) Correspondence:”.');

  // abstract
  const absT = paras.find(P => P.role === 'abstract_title' || P.role === 'abstract_mixed');
  if (absT) {
    const [s, e] = trimRange(absT);
    const t = absT.text.slice(s, e);
    if (!/^Abstract$/.test(t)) {
      add(absT, s, Math.min(e, s + 9), 'error', 'front', '4.2', 'คำว่า “Abstract” ต้องอยู่บรรทัดของตัวเองแยกเหนือเนื้อหาบทคัดย่อ (กฎใหม่ v11) — ห้ามเขียน “Abstract: ข้อความ…” ในบรรทัดเดียวกัน', '“Abstract” must stand alone on its own line above the abstract body (new in v11) — not “Abstract: text…” on one line', 'Abstract title: “Abstract” stands alone on a separate line, positioned above the abstract body. Font size: 10 pt; Bold.');
    }
  }
  const absBody = paras.filter(P => P.role === 'abstract_body' || P.role === 'abstract_mixed');
  if (absBody.filter(P => P.role === 'abstract_body').length > 1) add(absBody.filter(P => P.role === 'abstract_body')[1], null, null, 'error', 'front', '4.2', 'บทคัดย่อต้องมีเพียง 1 ย่อหน้า', 'The abstract must be one paragraph', 'Abstract body: One paragraph.');
  absBody.forEach(P => {
    const t = P.text;
    eachMatch(/\[\s*\d+(?:\s*[,–\-]\s*\d+)*\s*\]/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'front', '4.2', 'ห้ามอ้างอิงเอกสาร [n] ในบทคัดย่อ', 'Do not cite references in the abstract', 'Abstract body: Do not cite references, tables, figures, sections, Supplementary Materials or the Appendix in the abstract.'));
    eachMatch(/\b(Figures?|Fig\.|Tables?|Sections?|Appendix|Supplementary Materials?)\s+[A-Z]?\d+/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'front', '4.2', 'ห้ามอ้างถึง Figure/Table/Section/Appendix ในบทคัดย่อ', 'Do not cite figures/tables/sections/appendix in the abstract', 'Abstract body: Do not cite references, tables, figures, sections, Supplementary Materials or the Appendix in the abstract.'));
    eachMatch(/\b(https?:\/\/|www\.)\S+/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'front', '4.2', 'ห้ามมีลิงก์เว็บไซต์ในบทคัดย่อ', 'No website links in the abstract', 'Abstract body: Do not include running titles, website links, equations, figures (or other graphical elements), tables, or structures that require display on a line separate from the text.'));
    if (P.hasMath || P.drawings.length) add(P, null, null, 'error', 'front', '4.2', 'ห้ามมีสมการ/รูปภาพในบทคัดย่อ', 'No equations or figures in the abstract', 'Abstract body: Do not include running titles, website links, equations, figures (or other graphical elements), tables.');
  });
  // keywords
  const kw = paras.find(P => P.role === 'keywords');
  if (kw) {
    const [s, e] = trimRange(kw); const t = kw.text;
    const lm = t.slice(s).match(/^Key\s*-?words?\s*:?/i);
    const ls = s, le = s + (lm ? lm[0].length : 8);
    if (lm && lm[0] !== 'Keywords:') add(kw, ls, le, 'error', 'front', '4.2', `ต้องเขียนเป็น “Keywords:” (พบ “${lm[0]}”)`, `Must read “Keywords:” (found “${lm[0]}”)`, 'Keywords: Font size: 10 pt, Bold “Keywords:”.');
    if (!allFmt(kw, ls, le, f => f.b)) add(kw, ls, le, 'error', 'front', '4.2', '“Keywords:” ต้องเป็นตัวหนา', '“Keywords:” must be bold', 'Keywords: Font size: 10 pt, Bold “Keywords:”.');
    if (anyFmt(kw, le, e, f => f.b) && fracFmt(kw, le, e, f => f.b) > 0.5) add(kw, le, e, 'error', 'front', '4.2', 'เฉพาะคำว่า “Keywords:” เท่านั้นที่เป็นตัวหนา คำสำคัญต้องเป็นตัวปกติ', 'Only “Keywords:” is bold; the keywords themselves are regular', 'Keywords: Font size: 10 pt, Bold “Keywords:”.');
    const body = t.slice(le, e);
    if (/\.$/.test(body.trim())) add(kw, e - 1, e, 'error', 'front', '4.2', 'ห้ามมีจุดท้ายคำสำคัญ', 'No full stop after the keywords', 'Semi-colon (;) between each keyword; no full stop/period (.) after keywords: Keywords: keyword1; keyword2; keyword3');
    if (!/;/.test(body) && /,/.test(body)) add(kw, le, e, 'error', 'front', '4.2', 'คั่นคำสำคัญแต่ละคำด้วย semicolon (;) ไม่ใช่ลูกน้ำ', 'Separate keywords with semicolons, not commas', 'Semi-colon (;) between each keyword; no full stop/period (.) after keywords: Keywords: keyword1; keyword2; keyword3');
    let off = le;
    for (const raw of body.split(/;/.test(body) ? /;/ : /[;,]/)) {
      const k0 = raw.search(/\S/); const word = raw.trim().replace(/\.$/, '');
      const i0 = off + (k0 < 0 ? 0 : k0);
      if (word && /^[A-Z][a-z]/.test(word) && !/^[A-Z][a-z]+[’']s\b/.test(word) && !kw.fmt(i0).i) add(kw, i0, i0 + word.length, 'check', 'front', '4.2', `คำสำคัญ “${word}” ควรเป็นตัวพิมพ์เล็ก (ยกเว้นชื่อเฉพาะ/ชื่อสปีชีส์/ตัวย่อ)`, `Keyword “${word}” should be lowercase (unless a proper name, species or acronym)`, 'Keywords should be lowercase, except acronyms (such as DNA), proper names (such as Schiff’s base), species names (such as E. coli), and chemical species (such as Na+, Si or Fe2+).');
      if (word.split(/\s+/).length > 7) add(kw, i0, i0 + word.length, 'check', 'front', '4.2', 'คำสำคัญนี้ยาวเหมือนประโยค — ห้ามใช้ประโยคเป็นคำสำคัญ', 'This keyword reads like a sentence — sentences should not be used as keywords', 'Sentences should not be used as keywords.');
      off += raw.length + 1;
    }
  }
  if (iAbs < 0 && !refsOnly) add(firstP, null, null, 'check', 'front', '4.2', 'ไม่พบหัวข้อ “Abstract”', 'No “Abstract” heading found', 'Abstract title: “Abstract” stands alone on a separate line, positioned above the abstract body.');
  if (iAbs >= 0 && iKey < 0) add(topParas[iAbs], null, null, 'check', 'front', '4.2', 'ไม่พบบรรทัด “Keywords:” หลังบทคัดย่อ', 'No “Keywords:” line after the abstract', 'Keywords and PACS/MSC/JEL Classification: Font size: 10 pt, Bold “Keywords:”.');

  /* ---------- 6. headings ---------- */
  const heads = paras.filter(P => P.role === 'heading' && P.head);
  const counters = [];
  const tree = [];
  heads.forEach(P => {
    const h = P.head; const [s, e] = trimRange(P);
    const t = textOf(P);
    if (h.numbered && h.numStr) {
      const parts = h.numStr.split('.').map(Number);
      const lvl = parts.length;
      // numbering format "1." / "1.1."
      if (h.manual) {
        const mm = P.text.slice(s).match(/^((?:\d{1,2}\.)*\d{1,2})(\.?)/);
        if (mm && mm[2] !== '.') add(P, s, s + mm[0].length, 'error', 'heading', '6.1', `เลขหัวข้อต้องลงท้ายด้วยจุด เช่น “${mm[1]}.”`, `Heading number must end with a period, e.g., “${mm[1]}.”`, 'Headings: the decimal system of displayed headings should be used … The heading of the first subsection in an article should thus be 1.1., and that of the second should be 1.2., etc.');
      } else if (P.num && !/\.$/.test(P.num.label)) add(P, s, Math.min(e, s + 4), 'error', 'heading', '6.1', `เลขหัวข้ออัตโนมัติเป็น “${P.num.label}” ต้องลงท้ายด้วยจุด เช่น “${P.num.label}.”`, `Automatic heading number is “${P.num.label}”; it must end with a period, e.g., “${P.num.label}.”`, 'Headings: the decimal system … 1.1., 1.2., 2.1., 2.2., etc.');
      if (lvl >= 4) add(P, null, null, 'error', 'heading', '6.1', lvl === 4 ? 'หัวข้อระดับ 4 ต้องไม่มีเลขกำกับ' : 'ห้ามมีหัวข้อเกิน 4 ระดับ', lvl === 4 ? 'Level 4 headings must be unnumbered' : 'No more than four heading levels are allowed', 'No more than four levels of displayed headings should be employed. Level 4 Headings should be unnumbered.');
      // sequence
      let expected;
      if (lvl === 1) expected = [(counters[0] || 0) + 1];
      else expected = [...counters.slice(0, lvl - 1), (counters[lvl - 1] || 0) + 1];
      const okPrefix = parts.slice(0, lvl - 1).every((v, ix) => v === counters[ix]);
      if (!okPrefix || parts[lvl - 1] !== expected[lvl - 1]) add(P, s, s + (h.manual ? h.numStr.length + 1 : 0) || e, 'error', 'heading', '6.1', `เลขหัวข้อไม่ต่อเนื่อง: พบ “${h.numStr}.” ควรเป็น “${expected.join('.')}.”`, `Heading numbering is not sequential: found “${h.numStr}.”, expected “${expected.join('.')}.”`, 'Headings: In the decimal system, the first number (from the left) is the number of the respective first-level heading. The heading of the first subsection should be 1.1., and that of the second should be 1.2., etc.');
      for (let q = 0; q < lvl; q++) counters[q] = parts[q];
      counters.length = lvl;
      h.lvl = Math.min(lvl, 4);
      tree.push({ P, parts, lvl });
    }
    // Conclusions plural
    const title = t.replace(/^((?:\d{1,2}\.)*\d{1,2})\.?\s+/, '');
    if (/^Conclusion$/i.test(title)) { const k = P.text.indexOf(title.trim()); add(P, k, k + title.trim().length, 'error', 'heading', '6.1', 'หัวข้อนี้ต้องเป็น “Conclusions” (พหูพจน์)', 'This section title should be “Conclusions” (plural)', 'Typically, research articles consist of five sections: the Introduction, Materials and Methods, Results, Discussion, and Conclusions (optional).'); }
  });
  // single-subheading rule
  tree.forEach((n, ix) => {
    if (n.lvl < 1 || n.lvl > 2) return;
    const kidsL = [];
    for (let j = ix + 1; j < tree.length && tree[j].lvl > n.lvl; j++) if (tree[j].lvl === n.lvl + 1) kidsL.push(tree[j]);
    if (kidsL.length === 1) {
      const c = kidsL[0]; const ci = tree.indexOf(c);
      const hasGrand = tree[ci + 1] && tree[ci + 1].lvl > c.lvl;
      if (!hasGrand) add(c.P, null, null, 'check', 'heading', '6.1', `หัวข้อ ${c.parts.join('.')}. เป็นหัวข้อย่อยเพียงหัวข้อเดียวภายใต้หัวข้อแม่ จึงควร “ไม่ใส่เลข”`, `Heading ${c.parts.join('.')}. is the only subheading under its parent, so it should remain unnumbered`, 'Single Subheading under a Parent Heading: If a Level 1 heading contains only one Level 2 subheading, and there are no Level 3 subheadings beneath it, the Level 2 heading shall remain unnumbered.');
    }
  });
  const l1 = tree.filter(n => n.lvl === 1);
  if (l1.length === 1) add(l1[0].P, null, null, 'check', 'heading', '6.1', 'มีหัวข้อระดับ 1 เพียงหัวข้อเดียวในเอกสาร จึงไม่ต้องใส่เลข', 'There is only one Level 1 heading in the document, so it should be unnumbered', 'Globally Unique Heading Level: If there is only one heading of a specific level in the entire document, it should be presented without a number.');

  /* ---------- 7. reference list (needed for citation checks) ---------- */
  const refs = paras.filter(P => P.role === 'ref');
  const refHead = paras.find(P => P.role === 'refs_heading');
  if (refHead) {
    const t = textOf(refHead);
    if (!/^References?(\s+and\s+Notes?)?$/i.test(t.replace(/^\d+\.?\s*/, ''))) add(refHead, null, null, 'error', 'ref', '7.12', `หัวข้อรายการอ้างอิงต้องเป็น “References” (พบ “${t}”)`, `The reference list heading must be “References” (found “${t}”)`, 'Reference List: Section Headings should be correct; they can appear as “Reference(s)” or “Reference(s) and Note(s)”, depending on the content.');
  }
  const refNorm = [];
  refs.forEach((P, ix) => {
    const t = P.text; const [s, e] = trimRange(P);
    const tt = t.slice(s, e);
    let body = tt, bodyOff = s;
    // numbering
    if (P.num && P.num.label) {
      const lab = P.num.label;
      if (!/^\d+\.$/.test(lab)) add(P, s, Math.min(e, s + 10), 'error', 'ref', '7.12', `เลขลำดับอ้างอิงอัตโนมัติเป็น “${lab}” ต้องเป็น “${ix + 1}.”`, `Automatic reference number is “${lab}”; must be “${ix + 1}.”`, 'Reference List: Use Arabic numbers with a period, such as “1.”, “2.”, “3.”… A tab should be added after each reference number.');
      else if (Number(lab) !== ix + 1) add(P, s, Math.min(e, s + 10), 'error', 'ref', '7.12', `เลขลำดับอ้างอิงไม่ต่อเนื่อง (พบ ${lab} ควรเป็น ${ix + 1}.)`, `Reference numbering is not sequential (found ${lab}, expected ${ix + 1}.)`, 'Reference List: Use Arabic numbers with a period, such as “1.”, “2.”, “3.”…');
      if (P.num.suff === 'space') add(P, s, Math.min(e, s + 10), 'error', 'ref', '7.12', 'หลังเลขลำดับอ้างอิงต้องเป็น Tab ไม่ใช่เว้นวรรค', 'A tab, not a space, must follow the reference number', 'A tab should be added after each reference number.');
    } else {
      const m = tt.match(/^(\[\d+\]|\(\d+\)|\d+\)|\d+\.?)(\s*)/);
      if (!m) add(P, s, Math.min(e, s + 10), 'error', 'ref', '7.12', `รายการอ้างอิงไม่มีเลขลำดับ ต้องขึ้นต้นด้วย “${ix + 1}.” ตามด้วย Tab`, `Reference has no number; it must start with “${ix + 1}.” followed by a tab`, 'Reference List: Use Arabic numbers with a period, such as “1.”, “2.”, “3.”… A tab should be added after each reference number.');
      else {
        if (!/^\d+\.$/.test(m[1])) add(P, s, s + m[1].length, 'error', 'ref', '7.12', `รูปแบบเลขลำดับ “${m[1]}” ไม่ถูกต้อง ต้องเป็น “${ix + 1}.”`, `Reference number format “${m[1]}” is wrong; must be “${ix + 1}.”`, 'Reference List: Use Arabic numbers with a period, such as “1.”, “2.”, “3.”…');
        else if (Number(m[1].replace('.', '')) !== ix + 1) add(P, s, s + m[1].length, 'error', 'ref', '7.12', `เลขลำดับอ้างอิงไม่ต่อเนื่อง (พบ ${m[1]} ควรเป็น ${ix + 1}.)`, `Reference numbering is not sequential (found ${m[1]}, expected ${ix + 1}.)`, 'Reference List: Use Arabic numbers with a period, such as “1.”, “2.”, “3.”…');
        if (m[2] !== '\t') add(P, s, s + m[0].length, 'error', 'ref', '7.12', 'หลังเลขลำดับอ้างอิงต้องเป็น Tab', 'A tab must follow the reference number', 'A tab should be added after each reference number.');
        body = tt.slice(m[0].length); bodyOff = s + m[0].length;
      }
    }
    refNorm.push({ P, key: body.toLowerCase().replace(/[^a-z0-9]/g, ''), doi: (body.match(/10\.\d{4,9}\/[^\s;]+/) || [''])[0].replace(/[.,]$/, '').toLowerCase() });
    if (/\(a\)[^()]{10,}\(b\)/.test(body)) add(P, null, null, 'error', 'ref', '7.12', 'หนึ่งเลขลำดับต้องมีเอกสารอ้างอิงเพียงรายการเดียว — ให้แยก (a), (b) เป็นคนละรายการ', 'Only one reference per number — split (a), (b) into separate references', 'Only one reference should be listed per single number, e.g., “(a) ref. 1; (b) ref. 2” is not allowed and should be divided into two references.');
    // authors
    let authEnd = -1;
    const reEnd = /(?:\b[A-Z][a-z]?\.|et al\.|\b[A-Z][a-z]?\.\)?)\s+(?=[A-Z0-9“"'(\[\p{Lu}])/gu;
    let mm;
    reEnd.lastIndex = 0;
    while ((mm = reEnd.exec(body)) !== null) {
      const rest = body.slice(mm.index + mm[0].length);
      if (/^[\p{Lu}][^\s,;]*(\s[\p{Ll}\p{Lu}][^\s,;]*){0,2},\s*[\p{Lu}]\./u.test(rest)) continue;
      authEnd = mm.index + mm[0].length; break;
    }
    if (authEnd > 0) {
      const auth = body.slice(0, authEnd).trim();
      const aOff = bodyOff;
      eachMatch(/\b([A-Z])\.\s+([A-Z])\./g, auth, x => add(P, aOff + x.index, aOff + x.index + x[0].length, 'error', 'ref', '7.12', 'ชื่อย่อของผู้แต่งในรายการอ้างอิงห้ามเว้นวรรค เช่น “F.M.”', 'No space between initials in reference authors, e.g., “F.M.”', 'Author Elements: the first and middle initials should end with a period without a space. Lastname, F.M.; Lastname, F.M.'));
      eachMatch(/(,|;)?\s+(and|&)\s+/g, auth, x => add(P, aOff + x.index, aOff + x.index + x[0].length, 'error', 'ref', '7.12', 'คั่นผู้แต่งด้วย semicolon (;) ห้ามใช้ “and” / “&”', 'Separate authors with semicolons; do not use “and” / “&”', 'Different authors should be separated with semicolons (;): Lastname, F.M.; Lastname, F.M.'));
      const people = auth.replace(/;?\s*et al\.?$/, '').split(/;\s*/).filter(Boolean);
      if (!/;/.test(auth) && (auth.match(/,/g) || []).length >= 3) add(P, aOff, aOff + auth.length, 'error', 'ref', '7.12', 'ผู้แต่งแต่ละคนต้องคั่นด้วย semicolon (;) ในรูปแบบ “Lastname, F.M.; Lastname, F.M.”', 'Each author must be separated by a semicolon: “Lastname, F.M.; Lastname, F.M.”', 'For every author, list the Lastname first … Different authors should be separated with semicolons (;): Lastname, F.M.; Lastname, F.M.');
      else people.forEach(pp => {
        const x = pp.trim().replace(/\.$/, '.');
        if (/^(Anonymous|on behalf)/i.test(x) || /\((Eds?|Coord|Trans|Translator|Coordinator|Comp|Org)\.?\)/.test(x)) return;
        if (!/^[^,]+,\s*(?:[\p{Lu}][\p{Ll}]?\.(?:-[\p{Lu}][\p{Ll}]?\.)?)+(?:,\s*(Jr\.|Sr\.|II|III|IV))?\.?$/u.test(x) && !/^[\p{L}\s.'’-]+$/u.test(x) === false) {
          const k = body.indexOf(pp.trim());
          if (k >= 0 && x.length < 60) add(P, bodyOff + k, bodyOff + k + pp.trim().length, 'check', 'ref', '7.12', `รูปแบบชื่อผู้แต่ง “${x}” ควรเป็น “Lastname, F.M.”`, `Author name “${x}” should be “Lastname, F.M.”`, 'For every author, list the Lastname first, and then the first letter of the Firstname, follows by the first letter of the Middle name if this is available. Lastname, F.M.; Lastname, F.M.');
        }
      });
      if (people.length > 10 && !/et al\./.test(auth)) add(P, aOff, aOff + auth.length, 'error', 'ref', '7.12', `มีผู้แต่ง ${people.length} คน — เกิน 10 คนให้ตัดตั้งแต่คนที่ 11 แล้วใส่ “et al.”`, `${people.length} authors — if there are more than 10, list the first 10 and replace the rest with “et al.”`, 'If there are more than 10 authors, delete the author names from the 11th name and use “et al.” to replace them.');
      if (/\bet al\./.test(auth) && people.length < 10) { const k = auth.indexOf('et al.'); add(P, aOff + k, aOff + k + 6, 'check', 'ref', '7.12', `ควรตรวจสอบ: มี “et al.” หลังผู้แต่งเพียง ${people.length} คน — ต้องใส่ชื่อผู้แต่งให้ครบ (ถ้าเกิน 10 คน ใส่ 10 คนแรกแล้วตามด้วย “et al.”)`, `Check: “et al.” after only ${people.length} author(s) — list all authors (if more than 10, list the first 10 followed by “et al.”)`, 'Author 1, F.M.; Author 2, F.M.; … Author 10, F.M.; et al. — list up to 10 authors before “et al.”.'); }
      if (/et al(?!\.)/.test(auth)) { const k = auth.indexOf('et al'); add(P, aOff + k, aOff + k + 5, 'error', 'ref', '7.12', '“et al” ต้องมีจุด: “et al.”', '“et al” needs a period: “et al.”', 'Author 1; … Author 10; et al.'); }
    }
    // journal pattern: Year, Volume, pages
    let refJS = -1;
    const jm = body.match(/\s((?:19|20)\d{2})([a-z]?)(,\s*)(\d+[A-Z]?)(\s*\(\s*[\w\s–-]+\))?(,\s*)([A-Za-z]?\d+(?:\s*[–\-−]\s*[A-Za-z]?\d+)?)/);
    if (jm) {
      const yS = bodyOff + jm.index + 1, yE = yS + jm[1].length;
      const vS = yE + jm[2].length + jm[3].length, vE = vS + jm[4].length;
      if (!allFmt(P, yS, yE, f => f.b)) add(P, yS, yE, 'error', 'ref', '7.12', 'ปีของวารสารต้องเป็นตัวหนา', 'The journal year must be bold', 'Journal — Basic Format: Author 1, F.M.; Author 2, F.M. Title of the article. Journal Abbreviation Year (bold), Volume (italic), Firstpage–Lastpage. e.g., Am. J. Clin. Nutr. 2006, 84, 274–288.');
      if (!allFmt(P, vS, vE, f => f.i)) add(P, vS, vE, 'error', 'ref', '7.12', 'เลข Volume ต้องเป็นตัวเอียง', 'The volume number must be italic', 'Journal — Basic Format: … Journal Abbreviation Year, Volume (italic), Firstpage–Lastpage.');
      if (jm[5]) { const k = vE; add(P, k, k + jm[5].length, 'error', 'ref', '7.12', 'ห้ามใส่เลข Issue ในวงเล็บหลัง Volume', 'The issue number should not be included', 'Journal Tips: The issue number should not be included. The issue part number … should also not be included.'); }
      const pg = jm[7]; const pS = vE + (jm[5] ? jm[5].length : 0) + jm[6].length;
      if (/-|−/.test(pg)) { const k = pS + pg.search(/[-−]/); add(P, k, k + 1, 'error', 'ref', '7.12', 'ช่วงเลขหน้าต้องใช้ en dash (–)', 'Page ranges must use an en dash (–)', 'Journal — Firstpage–Lastpage; use an en dash (“–”) to indicate a range.'); }
      // journal name: prefer the italic run right before the year, else the text after the article-title period
      const pre = body.slice(0, jm.index + 1);
      let jS = -1, jE = -1;
      { let k = bodyOff + jm.index; while (k > bodyOff && /\s/.test(P.text[k - 1])) k--;
        if (k > bodyOff && P.fmt(k - 1).i) { let a = k; while (a > bodyOff && (P.fmt(a - 1).i || /\s/.test(P.text[a - 1]))) a--; while (a < k && /\s/.test(P.text[a])) a++; if (k - a >= 2 && a >= bodyOff + Math.max(0, authEnd)) { jS = a; jE = k; } } }
      if (jS < 0) {
        const jStart = (() => {
          let lastDot = -1, firstSkip = -1;
          const re = /[.?!]\s+(?=[A-Z])/g; let z;
          while ((z = re.exec(pre)) !== null) {
            const w = pre.slice(0, z.index).match(/(\S+)$/);
            const word = w ? w[1] : '';
            if (/^[A-Z][a-z]{0,12}$/.test(word) && (ABBR_VALUES.has((word + '.').toLowerCase()) || (ltwa() && _ltwaRepl.has((word + '.').toLowerCase())) || /^[A-Z]$/.test(word))) { if (firstSkip < 0 && word.length > 1 && z.index + z[0].length > authEnd) firstSkip = z.index + z[0].length; continue; } // abbreviation inside the journal name
            lastDot = z.index + z[0].length;
          }
          return lastDot >= authEnd ? lastDot : (firstSkip > 0 && pre.slice(firstSkip).trim().split(/\s+/).length >= 2 ? firstSkip : -1);
        })();
        if (jStart > 0) { const jn0 = pre.slice(jStart).replace(/\s+$/, ''); jS = bodyOff + jStart; jE = jS + jn0.length; }
      }
      refJS = jS;
      if (jS > 0) {
        const jn = P.text.slice(jS, jE).trim();
        if (jn && jn.length < 160) {
          if (!allFmt(P, jS, jE, f => f.i)) add(P, jS, jE, 'error', 'ref', '7.12', `ชื่อวารสาร “${jn}” ต้องเป็นตัวเอียง`, `Journal name “${jn}” must be italic`, 'Journal — Basic Format: Journal Abbreviation (italic) Year, Volume, Firstpage–Lastpage.');
          if (/,$/.test(jn)) add(P, jE - 1, jE, 'error', 'ref', '7.12', 'ไม่ต้องมีลูกน้ำระหว่างชื่อวารสารกับปี เช่น “Am. J. Clin. Nutr. 2006, 84, 274–288.”', 'No comma between the journal name and the year, e.g., “Am. J. Clin. Nutr. 2006, 84, 274–288.”', 'Journal Abbreviation Year, Volume, Firstpage–Lastpage.');
          const fixed = FIXED_JABBR.find(([re]) => re.test(jn));
          if (fixed && fixed[1] !== jn) add(P, jS, jE, 'error', 'jabbr', '7.12', `ชื่อย่อวารสารนี้กำหนดตายตัว: “${fixed[1]}”`, `This journal has a fixed abbreviation: “${fixed[1]}”`, 'Some fixed journal abbreviations are as follows: J. Power Sources; J. Alloys Compd.; Int. J. Hydrogen Energy; Trans. Nonferrous Met. Soc. China; Sports Med.; Des. Oil Crops; Glob. Change Biol.; J. Micromech. Microeng.; Toxicol. In Vitro; Proc. Natl. Acad. Sci. USA (not PNAS).');
          const chk = fixed ? null : checkJournalAbbrev(jn);
          if (chk) chk.issues.forEach(is => add(P, jS, jE, is.sev, 'jabbr', '7.12', is.th, is.en, 'Journal abbreviations per ISO 4 / LTWA (abbrevIso). Do not abbreviate journal names that are only one word (e.g., Energies). Omit the definite article.'));
          else if (!fixed) {
            const words = jn.split(/\s+/);
            const subst = words.filter(w => !/^(of|and|the|&|in|on|for|de|la|und|der)$/i.test(w));
            const full = words.filter(w => ABBR_DICT[w.toLowerCase()] && !/\.$/.test(w));
            if (subst.length > 1 && full.length) add(P, jS, jE, 'error', 'jabbr', '7.12', `ชื่อวารสารยังไม่ได้ย่อ: ${full.map(w => `${w} → ${ABBR_DICT[w.toLowerCase()]}`).join(', ')}`, `Journal name is not abbreviated: ${full.map(w => `${w} → ${ABBR_DICT[w.toLowerCase()]}`).join(', ')}`, 'Journal abbreviations per LTWA.');
          }
        }
      }
    }
    // title case of book / conference titles (article titles keep the authors' preference)
    if (!jm) {
      let i0 = bodyOff, end = bodyOff + body.length;
      for (let i = i0; i < end;) {
        if (P.text[i] === '\uFFFC' || !P.fmt(i).i) { i++; continue; }
        let j = i; while (j < end && (P.fmt(j).i || /\s/.test(P.text[j]))) j++;
        let k = j; while (k > i && /[\s.,;:]/.test(P.text[k - 1])) k--;
        if (k - i >= 8 && /\s/.test(P.text.slice(i, k))) {
          const iss = titleCaseIssues(P, i, k);
          if (iss.length) add(P, iss[0].i, iss[iss.length - 1].i + iss[iss.length - 1].n, 'error', 'case', '7.12', `ชื่อหนังสือ/ชื่อเรื่องใน Reference ต้องเป็น Title Case: ${iss.slice(0, 10).map(x => `${x.w} → ${x.want}`).join(', ')}`, `Book/collection title in the reference must be Title Case: ${iss.slice(0, 10).map(x => `${x.w} → ${x.want}`).join(', ')}`, 'Title Element: Capitalize the first letters of substantives in book titles, conference titles, theses, patent titles, program titles, standard titles, software titles, online resource titles and reports.');
        }
        i = j;
      }
      const cm2 = body.match(/(In Proceedings of the|Presented at the)\s+([^,;]+)/);
      if (cm2) {
        const s0 = bodyOff + cm2.index + cm2[0].length - cm2[2].length, s1 = s0 + cm2[2].length;
        const iss = titleCaseIssues(P, s0, s1);
        if (iss.length) add(P, iss[0].i, iss[iss.length - 1].i + iss[iss.length - 1].n, 'error', 'case', '7.12', `ชื่องานประชุมใน Reference ต้องเป็น Title Case: ${iss.slice(0, 10).map(x => `${x.w} → ${x.want}`).join(', ')}`, `Conference name in the reference must be Title Case: ${iss.slice(0, 10).map(x => `${x.w} → ${x.want}`).join(', ')}`, 'Title Element: Capitalize the first letters of substantives in book titles, conference titles, theses, patent titles … and reports.');
      }
    }
    // DOI format
    eachMatch(/\b(doi:\s*|DOI:\s*|doi\s+)(10\.\d{4,9}\/\S+)/g, body, x => add(P, bodyOff + x.index, bodyOff + x.index + x[0].length, 'error', 'ref', '7.12', 'DOI ต้องเขียนเป็นลิงก์ https://doi.org/10.xxxx', 'Write the DOI as a link: https://doi.org/10.xxxx', 'doi writing format: doi link (instead of doi text), e.g., https://doi.org/10.3390/antibiotics10080943'));
    eachMatch(/(?<![/\w.])(10\.\d{4,9}\/[^\s;]+)/g, body, x => { if (!/doi\.org\/$/i.test(body.slice(0, x.index)) && !/(doi:\s*|DOI:\s*|doi\s+)$/.test(body.slice(0, x.index))) add(P, bodyOff + x.index, bodyOff + x.index + x[0].length, 'error', 'ref', '7.12', 'DOI ต้องเขียนเป็นลิงก์ https://doi.org/…', 'Write the DOI as a link: https://doi.org/…', 'doi writing format: doi link (instead of doi text), e.g., https://doi.org/10.3390/antibiotics10080943'); });
    // URLs: accessed on
    eachMatch(/\b(https?:\/\/|www\.)[^\s)]+/g, body, x => {
      if (/doi\.org/i.test(x[0])) return;
      const after = body.slice(x.index + x[0].length, x.index + x[0].length + 60);
      if (!/^\s*\(accessed on \d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\)/.test(after) && !/^\s*[(\[]\s*(accessed|last accessed|retrieved|date accessed)/i.test(after)) add(P, bodyOff + x.index, bodyOff + x.index + x[0].length, 'check', 'ref', '7.12', 'URL ในรายการอ้างอิงต้องตามด้วย “(accessed on Day Month Year)” เช่น (accessed on 2 June 2012) — ยกเว้นหน้าแรกของเว็บไซต์', 'URLs must be followed by “(accessed on Day Month Year)”, e.g., (accessed on 2 June 2012) — homepages excepted', 'Online Resources: Available online: http://URL (accessed on Day Month Year). For homepages, an access date is not mandatory.');
      if (!/Available online:\s*$/.test(body.slice(0, x.index)) && !/doi|arXiv/i.test(body) && !jm) add(P, bodyOff + x.index, bodyOff + x.index + x[0].length, 'check', 'ref', '7.12', 'ก่อน URL ควรมี “Available online:” (มีจุดก่อนหน้า)', 'Put “Available online:” (after a period) before the URL', 'Online Resources — Note: Use a full stop/period before “Available online: http:// (accessed on day month year)”.');
    });
    // Patent
    eachMatch(/\bUS\s+Patent\b/g, body, x => add(P, bodyOff + x.index, bodyOff + x.index + x[0].length, 'error', 'ref', '7.12', 'เขียน “U.S. Patent” ไม่ใช่ “US Patent”', 'Write “U.S. Patent”, not “US Patent”', 'Patent Tips: Write “U.S. Patent”, not “US Patent”; the patent title should not be italicized.'));
    // page abbreviations
    eachMatch(/\bp\.\s*\d+\s*[–-]\s*\d+/g, body, x => add(P, bodyOff + x.index, bodyOff + x.index + 2, 'error', 'ref', '7.12', 'ช่วงหลายหน้าต้องใช้ “pp.” ไม่ใช่ “p.”', 'Use “pp.” for page ranges, not “p.”', 'Pagination: Use the abbreviations “p.” and “pp.” to indicate single and multiple pages, respectively, e.g., p. 1; pp. 1–20.'));
    eachMatch(/\b(pp?)(?=\s*\d)(?!\.)/g, body, x => { if (/[\s,;]$/.test(body.slice(0, x.index)) || x.index === 0) add(P, bodyOff + x.index, bodyOff + x.index + x[0].length, 'error', 'ref', '7.12', `“${x[0]}” ต้องมีจุด: “${x[0]}.”`, `“${x[0]}” needs a period: “${x[0]}.”`, 'Pagination: Use the abbreviations “p.” and “pp.”'); });
    // conference: "In Proceedings of the"
    if (/\bProc(eedings)?\b/i.test(body) && /\b(Conference|Symposium|Workshop|Congress|Meeting)\b/i.test(body) && !jm && !/In Proceedings of the|Presented at the|In [A-Z][^;]+;/.test(body)) add(P, null, null, 'check', 'ref', '7.12', 'อ้างอิงงานประชุมวิชาการต้องใช้รูปแบบ “… Title. In Proceedings of the Name of the Conference, City, Country, Day Month Year.”', 'Conference references must read “… Title. In Proceedings of the Name of the Conference, City, Country, Day Month Year.”', 'Conference — Basic Format: Author 1, F.M.; Author 2, F.M. Title of presentation. In Proceedings of the Name of the Conference, Location of Conference (City, State Abbr.), Country, Date of Conference (Day Month Year).');
    // book pattern without publisher location
    if (/\b(Press|Publishers?|Springer|Elsevier|Wiley|CRC|Academic|Routledge|Sage|Taylor & Francis)\b/.test(body) && !jm && !/:\s*[\p{L} .,'’/-]+,\s*(19|20)\d{2}/u.test(body)) add(P, null, null, 'check', 'ref', '7.12', 'อ้างอิงหนังสือต้องมี “Publisher: City, Country, Year” เช่น “Springer: Berlin/Heidelberg, Germany, 2003”', 'Book references need “Publisher: City, Country, Year”, e.g., “Springer: Berlin/Heidelberg, Germany, 2003”', 'Book — Basic Format: Author 1, F.M.; Author 2, F.M. Title of the Book; Publisher: City, Country, Year.');
    // incomplete links: missing or broken https://, cut-off URLs
    {
      const R = 'Online Resources: Available online: https://URL (accessed on Day Month Year). URLs must be complete, including https://; doi link, e.g., https://doi.org/10.3390/antibiotics10080943.';
      const linkAt = (k, n, th, en, sev = 'error') => add(P, bodyOff + k, bodyOff + k + n, sev, 'ref', '7.12', th, en, R);
      // broken scheme: https//, https:/x, http//, htps://, https: //, https:\\
      eachMatch(/\b(h?ttps?|htps?|hhttps?)(?::\s+\/\/|\/\/|:\/(?!\/)|:\\\\|;\/\/)(?=\S)/gi, body, m => { if (/^https?$/i.test(m[1]) && /^:\/\/$/.test(m[0].slice(m[1].length))) return; linkAt(m.index, m[0].length, `ลิงก์เขียนผิด “${m[0]}” ต้องเป็น “https://”`, `Broken link prefix “${m[0]}” — use “https://”`); });
      // www. / doi.org / dx.doi.org without https://
      eachMatch(/(?<![\w\/.:@-])((?:www\d?\.|dx\.doi\.org\/|doi\.org\/)[^\s,;)]+)/gi, body, m => {
        if (/(https?:\/\/|\/\/)$/i.test(body.slice(Math.max(0, m.index - 8), m.index))) return;
        linkAt(m.index, m[1].replace(/[.]$/, '').length, `ลิงก์ไม่มี “https://” นำหน้า: “https://${m[1].replace(/[.]$/, '')}”`, `Link is missing “https://”: “https://${m[1].replace(/[.]$/, '')}”`);
      });
      // bare domain with a path (fao.org/faostat) without https://
      eachMatch(/(?<![\w\/.:@-])([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:org|com|net|gov|edu|int|io|info|go\.th|ac\.th|or\.th|co\.th|gov\.[a-z]{2}|ac\.[a-z]{2}|[a-z]{2})\/[^\s,;)]*)/gi, body, m => {
        if (/^(www\d?\.|doi\.org|dx\.doi\.org)/i.test(m[1]) || /^\d/.test(m[1])) return;
        linkAt(m.index, m[1].replace(/[.]$/, '').length, `ลิงก์ไม่มี “https://” นำหน้า: “https://${m[1].replace(/[.]$/, '')}”`, `Link is missing “https://”: “https://${m[1].replace(/[.]$/, '')}”`, 'check');
      });
      // cut-off URLs: nothing or no domain after https://, or ending with … / ...
      eachMatch(/\bhttps?:\/\/(\S*)/gi, body, m => {
        const rest = m[1].replace(/[.,;)]+$/, '');
        if (!rest || !/^[^\/\s]+\.[a-z]{2,}/i.test(rest) || /(\.{3}|…)$/.test(m[1]) || /\.$/.test(rest.split('/')[0])) linkAt(m.index, m[0].length, `ลิงก์ไม่สมบูรณ์ “${m[0]}” — ตรวจสอบ URL ให้ครบ`, `Incomplete link “${m[0]}” — please give the full URL`);
      });
    }
    // ---- v16 reference checks ----
    {
      const at = (k, n, sev, th, en, rule) => add(P, bodyOff + k, bodyOff + k + n, sev, 'ref', '7.12', th, en, rule);
      // publisher location in the USA / Canada needs the state: “New York, NY, USA”
      eachMatch(/:\s*([A-Z][\p{L}.'’ -]{1,30}?),\s*(USA|U\.S\.A\.|United States(?: of America)?|US|Canada)(?=\s*[,;.]\s*(?:(?:19|20)\d{2}|$)|\s*,\s*(?:19|20)\d{2})/gu, body, m => {
        const city = m[1].trim(); if (/^[A-Z]{2}$/.test(city)) return;
        const st = US_CITY_STATE[city];
        const want = `${city}, ${st || (m[2] === 'Canada' ? 'XX' : 'XX')}, ${m[2] === 'Canada' ? 'Canada' : 'USA'}`;
        at(m.index + m[0].indexOf(city), m[0].length - m[0].indexOf(city), 'error', `เมืองในสหรัฐฯ/แคนาดาต้องมีอักษรย่อรัฐ: “${want}”${st ? '' : ' (XX = รัฐ)'}`, `Cities in the USA/Canada need the state abbreviation: “${want}”${st ? '' : ' (XX = state)'}`, 'For cities in USA and Canada: the state or province is required. Format: “City, State (Abbr.), Country” (for example: “Los Angeles, CA, USA”; “Victoria, BC, Canada”).');
      });
      eachMatch(/:\s*[A-Z][\p{L}.'’ -]{1,30},\s*(?:[A-Z]{2},\s*)?(United States(?: of America)?|U\.S\.A\.|US)(?=\s*[,;.])/gu, body, m => { const k = m.index + m[0].lastIndexOf(m[1]); at(k, m[1].length, 'error', `ชื่อประเทศต้องเขียนเป็น “USA”`, 'Write the country as “USA”', 'Book: Publisher: City, State (Abbr.), Country, e.g., “Los Angeles, CA, USA”.'); });
      // Springer naming
      eachMatch(/\bSpringer[-\s]Verlag\b/g, body, m => at(m.index, m[0].length, 'error', 'ตัดคำว่า “Verlag” ออก: “Springer”', 'Delete “Verlag”: “Springer”', 'If the book publisher is “Springer xxxx”: if “xxxx” is “Verlag”, then delete it; if “xxxx” is a location, put it as the publisher location, e.g., “Springer: New York”; Springer: Berlin/Heidelberg, Germany (here “/” is requested).'));
      eachMatch(/\bSpringer\s+(New York|Berlin(?:\s+Heidelberg)?|Heidelberg|London|Singapore|Cham|Dordrecht|Netherlands|Japan|Tokyo|Vienna|Wien|Boston|Basel|India|Nature Singapore)\b/g, body, m => at(m.index, m[0].length, 'error', `ชื่อเมืองหลัง Springer คือสถานที่พิมพ์: “Springer: ${m[1].replace(/\s+Heidelberg/, '/Heidelberg').replace('Nature Singapore', 'Singapore')}, …”`, `The place after Springer is the location: “Springer: ${m[1].replace(/\s+Heidelberg/, '/Heidelberg')}, …”`, 'If the book publisher is “Springer xxxx” and “xxxx” is a location, put it as the publisher location, e.g., “Springer New York” should be “Springer: New York”.'));
      eachMatch(/\bBerlin(,\s*|\s+|\s*-\s*)Heidelberg\b/g, body, m => at(m.index, m[0].length, 'error', 'ต้องเขียนเป็น “Berlin/Heidelberg”', 'Write “Berlin/Heidelberg”', 'Springer: Berlin/Heidelberg, Germany, 1999 (here “/” is requested).'));
      // edition: “Title, 2nd ed.;”
      eachMatch(/(,?)(\s*)\b(\d+)(st|nd|rd|th)(\s*)(edition|Edition|edn\.?|Edn\.?|ed\.?|Ed\.?)(?![\p{L}])(\s*)([;,.]?)/gu, body, m => {
        const ok = m[1] === ',' && m[6] === 'ed.' && m[8] === ';';
        if (ok || (m[6] === 'ed.' && m[1] === ',' && m[8] !== ',')) return;
        at(m.index, m[0].length, 'error', `ฉบับพิมพ์ต้องเขียน “, ${m[3]}${m[4]} ed.;” (ตัวเล็ก มีจุด คั่นหน้าด้วยลูกน้ำ หลังด้วย semicolon)`, `Write the edition as “, ${m[3]}${m[4]} ed.;” (lowercase, period, comma before, semicolon after)`, 'Book: The edition number and the abbreviation “ed.” should follow the book title, in lowercase letters, and off-set by a comma. The edition information should be separated from the next field of the reference by a semicolon. e.g., Concepts in Physical Chemistry, 2nd ed.; Royal Society of Chemistry: London, UK, 2024.');
      });
      eachMatch(/\b(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\s+(edition|Edition|edn\.?|ed\.?|Edn\.?|Ed\.?)(?![\p{L}])/gu, body, m => { const n = { First: '1st', Second: '2nd', Third: '3rd', Fourth: '4th', Fifth: '5th', Sixth: '6th', Seventh: '7th', Eighth: '8th', Ninth: '9th', Tenth: '10th' }[m[1]]; at(m.index, m[0].length, 'error', `ฉบับพิมพ์ต้องเขียนเป็นตัวเลข: “${n} ed.”`, `Write the edition with a numeral: “${n} ed.”`, 'Book: The edition number and the abbreviation “ed.” should follow the book title, e.g., 2nd ed.'); });
      // Ed. / Eds. must match the number of editors
      eachMatch(/;\s*([^;]{3,400}?),\s*(Eds?\.)(?=\s*(and\s+Trans\.)?\s*[;:,.])/g, body, m => {
        const seg = m[1].replace(/^In\s+[^;]*$/, '');
        const n = (seg.match(/(?:^|,\s*)(?:(?:van|von|de|der|den|da|del|di|le|la)\s+)*[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?,\s*(?:[\p{Lu}][\p{Ll}]?\.-?)+/gu) || []).length;
        if (!n) return;
        const k = m.index + m[0].length - m[2].length;
        if (n === 1 && m[2] === 'Eds.') at(k, 4, 'error', 'บรรณาธิการคนเดียวใช้ “Ed.” (หลายคนใช้ “Eds.”)', 'One editor takes “Ed.” (several take “Eds.”)', 'Book chapter: Lipkowitz, K.B., Boyd, D.B., Eds.; … Tessier, J., Ed.; — “Ed.” for one editor, “Eds.” for several.');
        if (n > 1 && m[2] === 'Ed.') at(k, 3, 'error', `มีบรรณาธิการ ${n} คน ต้องใช้ “Eds.”`, `There are ${n} editors, so use “Eds.”`, 'Book chapter: Lipkowitz, K.B., Boyd, D.B., Eds.; — “Eds.” for several editors.');
      });
      // language note: “(In Chinese)” — capital In, no period after, after the pagination
      eachMatch(/([(\[])\s*(in|In|IN)?\s*(Chinese|Japanese|Korean|Russian|German|French|Spanish|Portuguese|Italian|Polish|Turkish|Persian|Arabic|Thai|Czech|Hungarian|Ukrainian|Indonesian|Malay|Vietnamese|Dutch|Swedish|Norwegian|Danish|Finnish|Greek|Romanian|Serbian|Croatian|Slovak|Slovenian|Bulgarian|Hebrew|Lithuanian|Latvian|Estonian)((?:\s+with\s+English\s+(?:abstract|summary))?)\s*([)\]])(\.?)/g, body, m => {
        const want = `(In ${m[3]}${m[4]})`;
        const bad = m[1] !== '(' || m[2] !== 'In' || m[5] !== ')';
        if (bad) at(m.index, m[0].length - m[6].length, 'error', `เขียนภาษาของเอกสารเป็น “${want}”`, `Write the language note as “${want}”`, 'Put the language type after the pagination, in parentheses. For the phrase “In X”, the 1st letter of “In” should be capitalized, such as (In Chinese); a period after is not needed.');
        if (m[6] === '.') at(m.index + m[0].length - 1, 1, 'error', `ไม่ต้องมีจุดหลัง “${want}”`, `No period after “${want}”`, 'Put the language type after the pagination, in parentheses … such as (In Chinese); a period after is not needed.');
        if (jm && m.index < jm.index) at(m.index, m[0].length - m[6].length, 'error', `“${want}” ต้องอยู่หลังเลขหน้า (ท้ายรายการ ก่อน DOI)`, `“${want}” goes after the pagination (at the end, before the DOI)`, 'Put the language type after the pagination, in parentheses, e.g., Environ. Sci. 2015, 36, 1379–1384. (In Chinese with English abstract) https://doi.org/….');
      });
      // PMID / PMCID
      eachMatch(/\b(PubMed\s+)?PMID\s*(:?)(\s*)(\d{5,9})/g, body, m => { if (m[1] || m[2] !== ':' || m[3] !== ' ') at(m.index, m[0].length, 'error', `เขียนเป็น “PMID: ${m[4]}”`, `Write “PMID: ${m[4]}”`, 'Journal article with PMID or PMCID: … https://doi.org/10.3389/fcvm.2021.751293. PMID: 34957240; PMCID: PMC8702802.'); });
      eachMatch(/\bPMCID\s*(:?)(\s*)(PMC)?(\d{4,9})|(?<![\w:])\s(PMC\d{4,9})/g, body, m => {
        if (m[5]) { if (!/PMCID:\s*$/.test(body.slice(0, m.index + 1))) at(m.index + 1, m[5].length, 'error', `เขียนเป็น “PMCID: ${m[5]}”`, `Write “PMCID: ${m[5]}”`, 'PMID: 34957240; PMCID: PMC8702802.'); return; }
        if (m[1] !== ':' || m[2] !== ' ' || !m[3]) at(m.index, m[0].length, 'error', `เขียนเป็น “PMCID: PMC${m[4]}”`, `Write “PMCID: PMC${m[4]}”`, 'PMID: 34957240; PMCID: PMC8702802.');
      });
      eachMatch(/PMID:?\s*\d+(\s*[.,]\s*|\s+)PMCID/g, body, m => at(m.index, m[0].length, 'error', 'คั่น PMID กับ PMCID ด้วย semicolon: “PMID: …; PMCID: …”', 'Separate PMID and PMCID with a semicolon: “PMID: …; PMCID: …”', 'PMID: 34957240; PMCID: PMC8702802.'));
      // supplement / part numbers after the volume
      eachMatch(/\b(?:19|20)\d{2},\s*\d+[A-Z]?\s*,?\s*\(?\s*((?:Suppl|Supplement|Suppl\.|Pt|Part)\.?\s*[A-Z]?\d*)\s*\)?(?=\s*,)/g, body, m => { const k = m.index + m[0].indexOf(m[1]); at(k, m[1].length, 'error', `ห้ามใส่ “${m[1]}” (ฉบับเสริม/ส่วน) ในอ้างอิงวารสาร`, `Do not include “${m[1]}” (supplement/part) in a journal reference`, 'Journal Tips: The issue number should not be included. The issue part number, e.g., Pt 2 or Supplemental Issue Number (Suppl. S36), should also not be included.'); });
      // Jr./Sr./II after the initials, with a comma: “Lastname, F.M., Jr.”
      if (authEnd > 0) {
        const auth = body.slice(0, authEnd);
        eachMatch(/((?:[\p{Lu}][\p{Ll}]?\.)+)(\s+)(Jr\.?|Sr\.?|II|III|IV)(?=\s*[;,])/gu, body.slice(0, authEnd + 12), m => at(m.index, m[0].length, 'error', `ต้องมีลูกน้ำหน้า ${m[3]}: “${m[1]}, ${m[3].replace(/^(Jr|Sr)$/, '$1.')}”`, `A comma goes before ${m[3]}: “${m[1]}, ${m[3].replace(/^(Jr|Sr)$/, '$1.')}”`, 'For author names with suffixes “Jr.”, “Sr.”, “II”, etc., there should be a comma between Jr., Sr., II, III, and the author names: Lastname, F.M., II; Lastname, F.M., Jr.'));
        eachMatch(/(?:^|;\s*)([\p{Lu}][\p{L}'’-]+)\s+(Jr\.?|Sr\.?|II|III|IV),\s*((?:[\p{Lu}][\p{Ll}]?\.-?)+)/gu, auth, m => { const k = m.index + m[0].indexOf(m[1]); at(k, m[0].length - (k - m.index), 'error', `ย้าย ${m[2]} ไปไว้ท้ายชื่อย่อ: “${m[1]}, ${m[3]}, ${m[2].replace(/^(Jr|Sr)$/, '$1.')}”`, `Move ${m[2]} after the initials: “${m[1]}, ${m[3]}, ${m[2].replace(/^(Jr|Sr)$/, '$1.')}”`, 'For author names with suffixes “Jr.”, “Sr.”, “II”, etc.: Lastname, F.M., II; Lastname, F.M., Jr.; Lastname, F.M., Sr.'); });
      }
      // thesis type: “Ph.D. Thesis”, “Master’s Thesis”, “Doctoral Dissertation”
      eachMatch(/\b(Ph\.?\s?D\.?|PhD|D\.?Phil\.?|Doctoral|Doctorate|Master[’']?s?|M\.?\s?Sc\.?|MSc|M\.S\.|MS|M\.A\.|MA|M\.Eng\.|MEng|Bachelor[’']?s?|B\.?Sc\.?|BSc|B\.S\.|Diploma|Licentiate|Undergraduate|Graduate)(\s+)(Thesis|thesis|Dissertation|dissertation|Theses|theses)\b/g, body, m => {
        const deg = /^(Ph|D\.?Phil)/i.test(m[1]) ? 'Ph.D.' : /^Doctor/i.test(m[1]) ? 'Doctoral' : /^(Master|M)/i.test(m[1]) ? 'Master’s' : /^(Bachelor|B|Undergraduate)/i.test(m[1]) ? 'Bachelor’s' : m[1];
        const word = /^dis/i.test(m[3]) ? 'Dissertation' : 'Thesis';
        const want = `${deg} ${word}`;
        if (m[0].replace("'", '’') !== want && m[0] !== `${deg} ${word}`) at(m.index, m[0].length, 'error', `ประเภทวิทยานิพนธ์ต้องเขียนเป็น “${want}”`, `Write the thesis type as “${want}”`, 'Thesis: Author, F.M. Title of Thesis. Level of Thesis, Degree-Granting University, Location of University, Year. Thesis types: Ph.D. Thesis; Master’s Thesis; Bachelor’s Thesis; Licentiate Thesis; Diploma Thesis; Doctoral Dissertation.');
      });
      // patent title must not be italic
      { const pk = body.search(/\b(U\.S\.|US|European|Chinese|Japanese|Korean|German|World|International)?\s*Patent\b/);
        if (pk > 0 && authEnd > 0 && pk > authEnd) { let a = -1, b = -1; for (let i = bodyOff + authEnd; i < bodyOff + pk; i++) { if (/\S/.test(P.text[i]) && P.fmt(i).i) { if (a < 0) a = i; b = i + 1; } } if (a >= 0 && b - a > 3) add(P, a, b, 'error', 'ref', '7.12', 'ชื่อสิทธิบัตรห้ามเป็นตัวเอียง', 'The patent title must not be italic', 'Patent Tips: Write “U.S. Patent”, not “US Patent”; the patent title should not be italicized.'); } }
      // unpublished status: lowercase italic (submitted, in press …)
      eachMatch(/(?:[,.(]\s*|\b(?:19|20)\d{2},?\s*)(submitted|in press|accepted|in preparation|manuscript in preparation|to be submitted|under review|forthcoming)(?=\s*[.)]?\s*$|\s*\)?\.\s|\s*;)/gi, body, m => {
        const k = m.index + m[0].length - m[1].length;
        const low = m[1] === m[1].toLowerCase(), ital = allFmt(P, bodyOff + k, bodyOff + k + m[1].length, f => f.i);
        if (!low || !ital) at(k, m[1].length, 'error', `สถานะ “${m[1].toLowerCase()}” ต้องเป็นตัวเล็กและตัวเอียง`, `The status “${m[1].toLowerCase()}” must be lowercase and italic`, 'Unpublished Work: For unpublished references, the paper status should be in lowercase and italics (e.g., submitted, in press, etc.).');
      });
    }
    refExtras(P, body, bodyOff, authEnd, jm, refJS);
    // ending punctuation
    if (!/[.)]$/.test(body.trim()) && !/\(In [A-Z][a-z]+( with English abstract)?\)$/.test(body.trim())) add(P, e - 1, e, 'check', 'ref', '7.12', 'รายการอ้างอิงควรจบด้วยจุด (.)', 'The reference should end with a period', 'Journal — Basic Format: Author 1, F.M.; Author 2, F.M.; Author 3, F.M. Title of the article. Journal Abbreviation Year, Volume, Firstpage–Lastpage/Article Number.');
  });
  // duplicates
  for (let a = 0; a < refNorm.length; a++) for (let b = a + 1; b < refNorm.length; b++) {
    if (refNorm[b].dup) continue;
    if ((refNorm[a].key.length > 30 && refNorm[a].key === refNorm[b].key) || (refNorm[a].doi && refNorm[a].doi === refNorm[b].doi)) (refNorm[b].dup = true) && add(refNorm[b].P, null, null, 'error', 'ref', '7.12', `รายการอ้างอิงที่ ${b + 1} ซ้ำกับรายการที่ ${a + 1}`, `Reference ${b + 1} duplicates reference ${a + 1}`, 'Duplicate references are not allowed.');
  }

  /* ---------- 8. text rules (main text, captions, abstract, back matter) ---------- */
  const mainRoles = new Set(['body', 'appendix_body', 'list', 'fig_caption', 'tab_caption', 'abstract_body', 'abstract_mixed', 'back', 'supp', 'heading', 'appendix_heading', 'table_cell', 'table_footnote', 'quote', 'abbrev']);
  const citeRoles = new Set(['body', 'appendix_body', 'list', 'fig_caption', 'tab_caption', 'heading', 'table_cell', 'table_footnote', 'quote', 'back', 'supp', 'equation_cell']);
  const nRefs = refs.length;
  const citeOrder = []; const citedSet = new Set();
  const figFirst = new Map(), tabFirst = new Map();
  const figCaps = [], tabCaps = [], schCaps = [], schFirst = new Map();
  const appendixMode = P => P.role === 'appendix_body' || P.role === 'appendix_heading';
  const ruleUnitsSpace = 'Units: Use a space between the numeral and the unit; exceptions include %, $, ° (angular degrees), ′ (angular minutes), and ″ (angular seconds). With space: 6 min, 5 mL, 273 K, 0.3 g, 50 μg, 90 °F (180 °C), 25 V/s.';
  const UNIT_RE = /(?<![\w.,\/])(\d+(?:\.\d+)?)(mm|cm|km|nm|μm|µm|mg|kg|µg|μg|ng|mL|ml|μL|µL|L|min|ms|μs|µs|ns|h|s|Hz|kHz|MHz|GHz|kV|mV|V|mA|A|kW|MW|mW|W|kJ|MJ|J|kPa|MPa|GPa|Pa|kN|N|mol|mmol|μmol|µmol|mM|μM|µM|nM|M|°C|°F|K|rpm|dB|ppm|ppb|kDa|Da|bp|kb|cal|kcal|ha|lx|eV|keV|MeV|Ω|kΩ|Gy|mGy|Bq|t\/ha|g\/L|mg\/L|mg\/kg|g\/kg|m\/s|km\/h|m)(?![\p{L}\p{N}])/gu;
  for (const P of paras) {
    if (P.empty || !P.role) continue;
    const t = P.text;
    const isMain = mainRoles.has(P.role);
    const isRef = P.role === 'ref';
    const supAt = i => { const f = P.fmt(i); return f.vert === 'superscript' || f.vert === 'subscript'; };
    const isItal = i => !!P.fmt(i).i;
    const capLike = ['fig_caption', 'tab_caption'].includes(P.role);
    const inBack = ['back', 'supp'].includes(P.role);
    if (isMain || isRef) {
      // e.g., / i.e.,
      eachMatch(/\b(e\.g\.|i\.e\.)(?!,)/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `ต้องมีลูกน้ำหลัง “${m[1]}” → “${m[1]},”`, `A comma is required after “${m[1]}” → “${m[1]},”`, 'Some fixed format requests: Use a comma after the following: “e.g.,” and “i.e.,”.'));
      // non-italic Latin
      if (!isRef && !(P.role === 'heading' && P.head && P.head.lvl === 2)) eachMatch(/\b(i\.e\.|e\.g\.|etc\.|et al\.|vs\.|ca\.|cf\.|in vivo|ex vivo|in situ|ex situ|in vitro|in utero|ad hoc|in silico|ab initio|vice versa|via|a priori|a posteriori|per se|de novo|post hoc|ad libitum|status quo|in toto|sensu lato|sensu stricto)(?![\p{L}])/giu, t, m => { if (allFmt(P, m.index, m.index + m[0].length, f => f.i)) add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `“${m[0]}” ห้ามเป็นตัวเอียง`, `“${m[0]}” must not be italic`, 'Do NOT italicize the following: Greek/Latin expressions … including “i.e.,”, “etc.”, “et al.”, “vs.”, “ca.”, “cf.”, “in vivo”, “ex vivo”, “in situ”, “ex situ”, “in vitro”, “in utero”, “ad hoc”, “in silico”, “ab initio”, “vice versa”, “e.g.,” and “via”.'); });
      // dates
      eachMatch(new RegExp(`\\b(${MONTHS}|${MONTH_ABBR})\\.?\\s+(\\d{1,2})(st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'g'), t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `รูปแบบวันที่ต้องเป็น “วัน เดือน ปี” เช่น “${m[2]} ${fullMonth(m[1])} ${m[4]}”`, `Date must be “day Month year”, e.g., “${m[2]} ${fullMonth(m[1])} ${m[4]}”`, 'Standard date expression: day Month year, e.g., 2 July 2012.'));
      eachMatch(new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)\\s+(of\\s+)?(${MONTHS})`, 'g'), t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `รูปแบบวันที่ต้องเป็น “${m[1]} ${m[4]}” (ไม่มี st/nd/th)`, `Date must be “${m[1]} ${m[4]}” (no ordinal suffix)`, 'Standard date expression: day Month year, e.g., 2 July 2012.'));
      eachMatch(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_ABBR})\\.?\\s+(\\d{4})\\b`, 'g'), t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `ชื่อเดือนต้องเขียนเต็ม: “${m[1]} ${fullMonth(m[2])} ${m[3]}”`, `Spell the month out: “${m[1]} ${fullMonth(m[2])} ${m[3]}”`, 'Standard date expression: day Month year, e.g., 2 July 2012.'));
      if (!isRef) eachMatch(/(?<![\d\/.])(\d{1,2})\/(\d{1,2})\/((?:19|20)?\d{2})(?![\d\/])/g, t, m => add(P, m.index, m.index + m[0].length, 'check', 'text', '6.1', 'วันที่แบบตัวเลขต้องเปลี่ยนเป็น “วัน เดือน(เต็ม) ปี” เช่น 2 July 2012', 'Numeric dates should be “day Month year”, e.g., 2 July 2012', 'Standard date expression: day Month year, e.g., 2 July 2012.'));
      // COVID-19 / SARS-CoV-2
      eachMatch(/\b(covid|Covid|COVID)[\s-]?19\b|\bCOVID19\b/g, t, m => { if (m[0] !== 'COVID-19') add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `ต้องเขียนเป็น “COVID-19”`, 'Must be written “COVID-19”', 'Official naming formats: COVID-19; SARS-CoV-2 (capitalization should be corrected).'); });
      eachMatch(/\bSARS[\s-]?CoV[\s-]?2\b|\bsars-cov-2\b|\bSars-CoV-2\b/gi, t, m => { if (m[0] !== 'SARS-CoV-2') add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', 'ต้องเขียนเป็น “SARS-CoV-2”', 'Must be written “SARS-CoV-2”', 'Official naming formats: COVID-19; SARS-CoV-2 (capitalization should be corrected).'); });
      // “(accessed on 2 June 2012)”: wording and date format
      eachMatch(/([(\[])\s*(Accessed|accessed|Last accessed|last accessed|Retrieved|retrieved|Date accessed)(\s+on)?\s*:?\s*([^)\]]{4,40})([)\]])/g, t, m => {
        const d = m[4].trim(); let want = null;
        const okDate = new RegExp(`^\\d{1,2} (${MONTHS}) \\d{4}$`).test(d);
        let mm;
        if (okDate) want = d;
        else if ((mm = d.match(new RegExp(`^(${MONTHS}|${MONTH_ABBR})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`, 'i')))) want = `${Number(mm[2])} ${fullMonth(mm[1])} ${mm[3]}`;
        else if ((mm = d.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS}|${MONTH_ABBR})\\.?,?\\s+(\\d{4})$`, 'i')))) want = `${Number(mm[1])} ${fullMonth(mm[2])} ${mm[3]}`;
        else if ((mm = d.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) want = `${Number(mm[3])} ${MONTHS.split('|')[Number(mm[2]) - 1] || '?'} ${mm[1]}`;
        else if ((mm = d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) want = `${Number(mm[1])} ${MONTHS.split('|')[Number(mm[2]) - 1] || '?'} ${mm[3]}`;
        const okWord = /^\(accessed on [^:]/.test(m[0]) && m[5] === ')';
        if (okWord && okDate) return;
        if (!/^\d|^[A-Z][a-z]+\.?\s+\d|^\d{1,2}\s/.test(d)) return;
        add(P, m.index, m.index + m[0].length, 'error', isRef ? 'ref' : 'text', isRef ? '7.12' : '6.1', `วันที่เข้าถึงต้องเขียนเป็น “(accessed on ${want || 'Day Month Year'})”`, `Write the access date as “(accessed on ${want || 'Day Month Year'})”`, 'Online Resources: Available online: http://URL (accessed on Day Month Year), e.g., (accessed on 2 June 2012).');
      });
    }
    if (!isMain) continue;
    // placeholders
    eachMatch(/blinded for (peer )?review|removed for (peer )?review|\[blinded\]|anonymi[sz]ed for review/gi, t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', 'ข้อความปิดบังข้อมูลสำหรับการรีวิว ต้องแทนด้วยข้อมูลจริง', 'Anonymization placeholder — replace with the actual information', 'Please ensure all anonymization placeholders (e.g., “blinded for review”, “blinded for peer review”, “removed for peer review”, “removed for review”) have been replaced with the actual information.'));
    eachMatch(/\(?\bdata not shown\b\)?/gi, t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', 'ควรเลี่ยง “data not shown” — ให้ใส่ข้อมูลเป็น Supplementary Material, อ้างอิง หรือลบวลีนี้', 'Avoid “data not shown” — provide the data as Supplementary Material, cite it, or delete the phrase', '“Data not shown” should be avoided; the author needs to provide complete information, related information can be published as a Supplementary Material, or cited as a reference; alternatively this phrase can simply be deleted.'));
    if (P.role === 'heading' || P.role === 'appendix_heading') { /* headings: only above */ }
    // units: spacing
    eachMatch(UNIT_RE, t, m => {
      const i = m.index;
      const lead = t.slice(Math.max(0, i - 12), i);
      if (/(Figure|Fig\.|Table|Scheme|Section|Equation|Sample|Group|S|Appendix|No\.|Type|Line|Day)\s*$/i.test(lead) || /[A-Za-z]$/.test(lead)) return;
      if (supAt(i) || supAt(i + m[1].length)) return;
      if (m[2] === 'M' && /^\s*[A-Z]/.test(t.slice(i + m[0].length))) return;
      if ((m[2] === 's' || m[2] === 'h' || m[2] === 'A' || m[2] === 'K' || m[2] === 'N' || m[2] === 'm') && /^[\p{L}]/u.test(t[i + m[0].length] || '')) return;
      if (/^\d{4}s$/.test(m[1] + m[2])) return; // 1990s
      if (P.role === 'table_cell' && /^[A-Z]$/.test(m[2])) return;
      add(P, i, i + m[0].length, 'error', 'unit', '6.1', `ต้องเว้นวรรคระหว่างตัวเลขกับหน่วย: “${m[1]} ${m[2]}”`, `A space is required between the number and the unit: “${m[1]} ${m[2]}”`, ruleUnitsSpace);
    });
    eachMatch(/(\d)\s+%/g, t, m => add(P, m.index + 1, m.index + m[0].length, 'error', 'unit', '6.1', 'ห้ามเว้นวรรคระหว่างตัวเลขกับ %', 'No space between the number and %', ruleUnitsSpace + ' Without space: 5–10%.'));
    eachMatch(/(\d)\s+°(?![CF])/g, t, m => add(P, m.index + 1, m.index + m[0].length, 'error', 'unit', '6.1', 'องศามุม (°) ต้องติดกับตัวเลข เช่น 90°', 'Angular degrees (°) must follow the number without a space, e.g., 90°', ruleUnitsSpace + ' Without space: 80–90°, 42°50′27″.'));
    eachMatch(/(?<!\d)\$\s+\d/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'unit', '6.1', 'ห้ามเว้นวรรคหลัง $ เช่น $250', 'No space after $, e.g., $250', ruleUnitsSpace + ' Without space: $250.'));
    // unit words after numerals
    eachMatch(/\b(\d+(?:\.\d+)?)(\s|-)(seconds?|minutes?|hours?|millimet(?:er|re)s?|centimet(?:er|re)s?|kilomet(?:er|re)s?|met(?:er|re)s?|kilograms?|grams?|lit(?:er|re)s?)\b/gi, t, m => {
      const map = { second: 's', minute: 'min', hour: 'h', millimeter: 'mm', millimetre: 'mm', centimeter: 'cm', centimetre: 'cm', kilometer: 'km', kilometre: 'km', meter: 'm', metre: 'm', kilogram: 'kg', gram: 'g', liter: 'L', litre: 'L' };
      const u = m[3].toLowerCase().replace(/s$/, '');
      add(P, m.index, m.index + m[0].length, 'error', 'unit', '6.1', `หน่วยหลังตัวเลขต้องใช้ตัวย่อ: “${m[1]} ${map[u]}”`, `Units after numerals must be abbreviated: “${m[1]} ${map[u]}”`, 'The units below should be abbreviated if Arabic numerals are in front of them in the main text: second/seconds → s; minute/minutes → min; hour/hours → h; millimeter → mm; centimeter → cm; meter → m; kilometer → km; gram → g; kilogram → kg; liter → L.');
    });
    // ranges with hyphen
    eachMatch(/(?<![\w.\/:#=-])(\d+(?:\.\d+)?)(\s*)-(\s*)(\d+(?:\.\d+)?)(?![\w\/-]|\.\d)/g, t, m => {
      const i = m.index;
      const before = t.slice(Math.max(0, i - 25), i);
      if (/(https?:\/\/|doi|ISBN|ISSN|Tel|Fax|\+)\S*$/i.test(before) || /\d-\d+-\d/.test(t.slice(i, i + m[0].length + 6))) return;
      if (/[A-Za-z]-$/.test(before)) return;
      if (supAt(i)) return;
      if (t.lastIndexOf('[', i) > t.lastIndexOf(']', i - 1) && /^[\d,–\-\s]*\]/.test(t.slice(i))) return;
      const spaced = m[2] || m[3];
      if (spaced && m[2] && m[3]) add(P, i, i + m[0].length, 'error', 'text', '6.1', `ถ้าเป็นการลบให้ใช้เครื่องหมายลบ “−” (U+2212) เว้นวรรคสองข้าง; ถ้าเป็นช่วงให้ใช้ en dash ไม่เว้นวรรค “${m[1]}–${m[4]}”`, `For subtraction use the minus sign “−” (U+2212) with spaces; for a range use an en dash without spaces “${m[1]}–${m[4]}”`, 'Use a hyphen (“-”) to indicate a word connection; use an en dash (“–”) to indicate a time period or range … the minus sign should be − (UTF-16: 2212), not -.');
      else add(P, i, i + m[0].length, 'error', 'text', '6.1', `ช่วงตัวเลขต้องใช้ en dash (–) ไม่ใช่ hyphen: “${m[1]}–${m[4]}”`, `Ranges need an en dash (–), not a hyphen: “${m[1]}–${m[4]}”`, 'Symbols: Use a hyphen (“-”) to indicate a word connection; use an en dash (“–”) to indicate a time period or range.');
    });
    // hyphen used as minus sign before a number
    eachMatch(/(^|[\s(=,;:[<>±×])-(\d)/g, t, m => { const i = m.index + m[1].length; if (!supAt(i)) add(P, i, i + 1, 'error', 'text', '6.1', 'เครื่องหมายลบต้องใช้ “−” (U+2212) ไม่ใช่ hyphen “-”', 'The minus sign must be “−” (U+2212), not a hyphen', 'Symbols: the minus sign should be − (UTF-16: 2212), not -.'); });
    // spaces around dashes
    eachMatch(/(\S)( +)([–—])( +)(?=\S)/g, t, m => { const i = m.index + 1; add(P, i, i + m[2].length + 1 + m[4].length, 'error', 'text', '6.1', `ห้ามเว้นวรรคหน้า-หลัง ${m[3] === '—' ? 'em dash (—)' : 'en dash (–)'}`, `No spaces on either side of the ${m[3] === '—' ? 'em dash (—)' : 'en dash (–)'}`, 'There should be no space on either side of a hyphen/en dash/em dash.'); });
    eachMatch(/([\p{L}\d)]) - (?=[\p{L}(])/gu, t, m => add(P, m.index + 1, m.index + 4, 'error', 'text', '6.1', 'ใช้ “ - ” (hyphen มีเว้นวรรค) ไม่ได้ — ถ้าเป็นการคั่นความคิดให้ใช้ em dash “—” ไม่เว้นวรรค', 'A spaced hyphen “ - ” is not allowed — use an em dash “—” without spaces for a break in thought', 'Use a hyphen (“-”) to indicate a word connection; … use an em dash (“—”) to indicate a break in thought or interpretation. There should be no space on either side of a hyphen/en dash/em dash.'));
    // ± and multiply
    eachMatch(/\+\s?\/\s?[-−]|\+-(?=\s*\d)/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', 'ใช้อักขระ “±” แทน “+/-”', 'Use the “±” character instead of “+/-”', 'Use the character ±, not an underlined plus sign, +.'));
    for (let i = 0; i < t.length; i++) if (t[i] === '+' && P.chars[i].r && P.fmt(i).u) add(P, i, i + 1, 'error', 'text', '6.1', 'ใช้อักขระ “±” แทนเครื่องหมาย + ขีดเส้นใต้', 'Use the “±” character, not an underlined +', 'Use the character ±, not an underlined plus sign, +.');
    eachMatch(/(?<![\w.])(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)(?![\w])/g, t, m => { if (!/^0x/i.test(m[0])) add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `ใช้เครื่องหมายคูณ “×” แทนตัว x: “${m[1]} × ${m[2]}”`, `Use the multiplication sign “×” instead of x: “${m[1]} × ${m[2]}”`, 'The multiply sign should be 5×, not 5x.'); });
    eachMatch(/(?<![\w.])(\d+(?:\.\d+)?)x(?![\w])/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `ต้องเป็น “${m[1]}×” ไม่ใช่ “${m[0]}”`, `Must be “${m[1]}×”, not “${m[0]}”`, 'The multiply sign should be 5×, not 5x.'));
    eachMatch(/(\d)\s+×\s*g\b/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', 'การปั่นเหวี่ยงต้องเขียนเป็น “ตัวเลข× g” (ไม่เว้นวรรคระหว่างตัวเลขกับ ×) เช่น 5000× g', 'Centrifugation must read “number× g” (no space between number and ×), e.g., 5000× g', '“centrifuged at” or “centrifugation” is usually followed by “numbers× g” (“g” italics, number and “×” with no space), e.g., “5× g”.'));
    eachMatch(/\d×\s?(g)\b/g, t, m => { const k = m.index + m[0].length - 1; if (!isItal(k)) add(P, k, k + 1, 'error', 'text', '6.1', 'ตัว “g” ใน “× g” (แรงเหวี่ยง) ต้องเป็นตัวเอียง', 'The “g” in “× g” (centrifugal force) must be italic', '“centrifuged at” … “numbers× g” (“g” italics …), e.g., “5× g”.'); });
    // operators spacing between two values
    for (let i = 1; i < t.length - 1; i++) {
      const ch = t[i];
      if (!'<>+−±×÷≤≥'.includes(ch)) continue;
      if (!P.chars[i].r || supAt(i)) continue;
      let l = i - 1; while (l >= 0 && t[l] === ' ') l--;
      let r = i + 1; while (r < t.length && t[r] === ' ') r++;
      if (l < 0 || r >= t.length) continue;
      const lv = /[\d%)]/.test(t[l]) || (/[A-Za-z]/.test(t[l]) && !/[A-Za-z]/.test(t[l - 1] || ''));
      const rv = /[\d(]/.test(t[r]) || ((t[r] === '−' || t[r] === '.') && /\d/.test(t[r + 1] || '')) || (/[A-Za-z]/.test(t[r]) && !/[A-Za-z0-9]/.test(t[r + 1] || ''));
      if (!lv || !rv) continue;
      if (ch === '×' && /^\s?g\b/.test(t.slice(i + 1))) continue;
      if (ch === '−' && l === i - 1 && r === i + 1 && /^[gshLlmdKJWVANU]$/.test(t[l]) && !/[\p{L}\d]/u.test(t[l - 1] || '') && /^\d+(?![\d.])/.test(t.slice(r))) continue; // “g−1”: the missing superscript is reported on its own
      if (ch === '−' && t[l] === ')' && /^\d+(,\d+)*-\p{L}/u.test(t.slice(r))) continue; // chemical locants “(3β,6α)-3,6,19-trihydroxy”
      if (l === i - 1 || r === i + 1) {
        let a = l; while (a > 0 && /[\d.,]/.test(t[a - 1])) a--;
        let b = r; while (b + 1 < t.length && /[\d.,]/.test(t[b + 1])) b++;
        add(P, a, b + 1, 'error', 'text', '6.1', `ต้องเว้นวรรคหน้าและหลังเครื่องหมาย “${ch}” เมื่อมีค่าอยู่ทั้งสองข้าง เช่น “a ${ch} b”`, `Add a space before and after “${ch}” when values are on both sides, e.g., “a ${ch} b”`, '>, <, +, −, ±, ×, ÷, ≤, ≥: If these symbols are written in plain text in an equation, add a space before and after them.');
        i = b;
      }
    }
    // < > ≤ ≥ with no variable in front act as part of the value: “<2”, not “< 2”
    for (let i = 0; i < t.length - 2; i++) {
      const ch = t[i];
      if (!'<>≤≥'.includes(ch) || !P.chars[i].r || supAt(i) || P.fmt(i).math) continue;
      if (t[i + 1] !== ' ' && t[i + 1] !== ' ') continue;
      let r = i + 1; while (r < t.length && /[  ]/.test(t[r])) r++;
      if (!(/\d/.test(t[r] || '') || ((t[r] === '−' || t[r] === '-') && /\d/.test(t[r + 1] || '')))) continue;
      const before = t.slice(0, i).replace(/[  ]+$/, '');
      const prevTok = (before.match(/(\S+)$/) || ['', ''])[1];
      const noVar = before === '' || /[(\[,;:=]$/.test(before) || /^[a-z]{2,}$/.test(prevTok) && !/^(pH|pKa|log|ln|exp|max|min)$/.test(prevTok);
      if (!noVar) continue;
      if (/^(or|and|to|vs)$/.test(prevTok) && /[<>≤≥=]\s*[−-]?[\d.]+\s*$/.test(before.slice(0, before.length - prevTok.length).trimEnd().slice(-25))) continue; // “FC ≥ 2 or ≤ 0.5”
      let b = r; while (b + 1 < t.length && /[\d.,]/.test(t[b + 1])) b++;
      while (b > r && /[.,]/.test(t[b])) b--;
      add(P, i, b + 1, 'error', 'text', '6.1', `เมื่อไม่มีตัวแปรอยู่หน้า “${ch}” ไม่ต้องเว้นวรรคหลังเครื่องหมาย: “${ch}${t.slice(r, b + 1)}”`, `With no variable before “${ch}”, do not put a space after it: “${ch}${t.slice(r, b + 1)}”`, 'When >, <, ≤, ≥ indicate a value (no variable before them), write them without a space, e.g., “<2”; with a variable, add spaces, e.g., “r > 4”.');
    }
    // thousands separators
    if (!inBack) eachMatch(/(?<![\d.,\/\p{L}#:-])(\d{5,})(?![\d,\/-]|\.\d*[\p{L}])/gu, t, m => {
      const before = t.slice(Math.max(0, m.index - 15), m.index);
      if (/(No\.|number|grant|code|ID|accession|GenBank|patent|Tel|Fax|ISBN|ISSN|DOI|zip|postcode)\s*:?\s*$/i.test(before)) return;
      if (supAt(m.index)) return;
      add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `ตัวเลขตั้งแต่ 5 หลักต้องมีลูกน้ำคั่นหลักพัน: “${Number(m[1]).toLocaleString('en-US')}”`, `Numbers with five or more digits need comma grouping: “${Number(m[1]).toLocaleString('en-US')}”`, 'Mathematical Terms: For numbers with five or more digits (not for four digits), the digits should be grouped with commas … e.g., 4500, 4,500,000, $1000, $10,000.');
    });
    eachMatch(/(?<![\d.,\[])(\d),(\d{3})(?![\d,]|\.\d)/g, t, m => { if (/\[[\d,–\s]*$/.test(t.slice(Math.max(0, m.index - 10), m.index))) return; add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `ตัวเลข 4 หลักไม่ต้องมีลูกน้ำ: “${m[1]}${m[2]}”`, `Four-digit numbers take no comma: “${m[1]}${m[2]}”`, 'Mathematical Terms: For numbers with five or more digits (not for four digits), the digits should be grouped with commas … e.g., 4500, $1000.'); });
    eachMatch(/(^|[\s=<>(±≤≥,;:])(\.\d+)/g, t, m => { const k = m.index + m[1].length; add(P, k, k + m[2].length, 'error', 'text', '6.1', `ทศนิยมต้องมี 0 นำหน้า: “0${m[2]}”`, `Decimals need a leading zero: “0${m[2]}”`, 'a = .01 should be written as a = 0.01.'); });
    eachMatch(/(?<![\w.])(\d+(?:\.\d+)?)[eE]([−+-]?\d+)(?![\w])/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `เขียนแบบ ${m[1]} × 10^${m[2].replace('-', '−')} (ตัวยก) แทน “${m[0]}”`, `Write ${m[1]} × 10^${m[2].replace('-', '−')} (superscript) instead of “${m[0]}”`, 'aEb or aeb should be written as a × 10b.'));
    // trig functions
    eachMatch(/\b(sin|cos|tan|cot|sec|csc)(?=[θαβγδφψωΘΦ(])/g, t, m => add(P, m.index, m.index + m[0].length + 1, 'error', 'text', '6.4', `ต้องเว้นวรรคหลังฟังก์ชันตรีโกณ เช่น “${m[1]} θ”`, `Leave a space after the trigonometric function, e.g., “${m[1]} θ”`, 'Leave a space before or after trigonometric functions, e.g., cos θ, cot θ, sin θ, tan θ, sec θ, csc θ, etc.'));
    // nucleic acid prime
    eachMatch(/\b([35])(['’])(?=-?[ACGTU]{3,}|-|\s?end)/g, t, m => add(P, m.index + 1, m.index + 2, 'error', 'text', '6.1', `ใช้ prime “′” (U+2032) แทน “${m[2]}” เช่น 5′-TAGC…-3′`, `Use the prime “′” (U+2032) instead of “${m[2]}”, e.g., 5′-TAGC…-3′`, 'For Nucleic Acids, please use “prime” (′, UTF-16: 2032), not right single quotation mark (’) or apostrophe (\'), to number the sugars.'));
    // p value
    eachMatch(/\bP([\s-])values?\b/g, t, m => add(P, m.index, m.index + 1, 'error', 'text', '6.1', '“P value” ต้องเขียนเป็น “p value” (p ตัวเล็ก ตัวเอียง)', '“P value” should be written “p value” (lowercase italic p)', 'Variable quantities should be italicized. The “P value” should be written as “p value”.'));
    eachMatch(/(?<![\p{L}])P\s*([<>=≤≥])\s*0?\.\d/gu, t, m => add(P, m.index, m.index + 1, 'error', 'text', '6.1', '“P” ใน p value ต้องเป็น “p” ตัวเล็กตัวเอียง', 'The “P” of a p value must be a lowercase italic “p”', 'The “P value” should be written as “p value”. Variable quantities should be italicized.'));
    // m/z: m and z are italic, the slash is not
    eachMatch(/(?<![\p{L}\/])m\/z(?![\p{L}])/gu, t, m => { if (P.fmt(m.index).math) return; const bad = !isItal(m.index) || !isItal(m.index + 2) || isItal(m.index + 1); if (bad) add(P, m.index, m.index + 3, 'error', 'text', '6.1', '“m/z” ต้องเป็นตัวเอียงที่ m และ z (เครื่องหมาย / ไม่เอียง): “𝑚/𝑧”', 'In “m/z”, m and z are italic (the slash is not)', 'Variables should be italicized, e.g., m/z.'); });
    // sample size n = 3 is a variable
    if (!nVarSeen) eachMatch(/(?<![\p{L}\p{N}])n(?=\s*=\s*\d)/gu, t, m => { if (nVarSeen || isItal(m.index) || P.fmt(m.index).math) return; nVarSeen = true; add(P, m.index, m.index + 1, 'check', 'text', '6.1', 'ควรตรวจสอบ: “n” ใน “n = 3” เป็นตัวแปร ควรเป็นตัวเอียง — ตรวจทั้งบทความ', 'Check: the “n” in “n = 3” is a variable and should be italic — check throughout the paper', 'A variable is a quantity that changes in value … Variable quantities should be italicized.'); });
    // citation after the full stop: “masking. [65,66]” → “masking [65,66].”
    eachMatch(/([\p{L}\p{N})’”])\.(\s*)(\[\d+(?:[,–-]\s*\d+)*\])/gu, t, m => {
      const before = t.slice(Math.max(0, m.index - 8), m.index + 1);
      if (/\b(al|e\.g|i\.e|etc|vs|Ref|Refs|Eq|Fig|No|cf|ca)$/.test(before) || /\b[A-Z]$/.test(before)) return;
      const k = m.index + 1; add(P, k, k + 1 + m[2].length + m[3].length, 'error', 'cite', '6.1', `เลขอ้างอิงต้องอยู่ก่อนจุด: “${m[3]}.” ไม่ใช่ “. ${m[3]}”`, `The citation goes before the full stop: “… ${m[3]}.”, not “. ${m[3]}”`, 'References’ Citations: place the citation before the punctuation, e.g., “… as reported [1].”');
    });
    eachMatch(/(?<![\p{L}])p(?=\s*[<>=≤≥]\s*0?\.\d|[\s-]values?\b)/gu, t, m => { if (!isItal(m.index)) add(P, m.index, m.index + 1, 'error', 'text', '6.1', '“p” ใน p value เป็นตัวแปร ต้องเป็นตัวเอียง', 'The “p” in p values is a variable and must be italic', 'A variable is a quantity that changes in value … Variable quantities should be italicized. The “P value” should be written as “p value”.'); });
    // w/v italic (Proofroom house rule, consistent with variables)
    eachMatch(/(?<![\p{L}])([wv]\/[wv])(?![\p{L}])/gu, t, m => { if (!allFmt(P, m.index, m.index + 3, f => f.i)) add(P, m.index, m.index + 3, 'check', 'text', '6.1', `“${m[1]}” ควรเป็นตัวเอียง (กฎเพิ่มเติมจาก Proofroom)`, `“${m[1]}” should be italic (Proofroom house rule)`, 'Variable quantities should be italicized (Proofroom house rule: w/v, v/v, w/w in italics).'); });
    // abbreviated species not italic: "E. coli"
    if (!inBack) eachMatch(/(?<![\p{L}.])([A-Z])\.\s([a-z]{3,})\b/gu, t, m => {
      if (/^(al|e|i|g|ca|cf|vs|et|and|or|the|for|with|was|were|from|have|has|in|on|to|of|is|are|as|at|by|who|which|that|this|data|all)$/.test(m[2]) || /\b(et al|Fig|Eq|Ref|No|Vol|pp|vs)\.\s$/.test(t.slice(Math.max(0, m.index - 4), m.index + 3))) return;
      if (!allFmt(P, m.index, m.index + m[0].length, f => f.i) && !(P.role === 'heading' && P.head && P.head.lvl === 2)) add(P, m.index, m.index + m[0].length, 'check', 'text', '6.1', `ชื่อสปีชีส์ “${m[0]}” ต้องเป็นตัวเอียง`, `Species name “${m[0]}” must be italic`, 'Species names should always be in italic in the main text, even in titles and headings, e.g., Escherichia coli, Staphylococcus aureus.');
    });
    // figure / table / equation citation formats
    eachMatch(/\b(Figs?|figs?|FIGS?)\.?\s*((?:S|A)?\d+)/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.2', `ต้องเขียนเต็มคำ: “${/s\.?$/i.test(m[1]) ? 'Figures' : 'Figure'} ${m[2]}”`, `Spell out: “${/s\.?$/i.test(m[1]) ? 'Figures' : 'Figure'} ${m[2]}”`, 'In the main text, all figures should be cited in the following formats: Figure 1; Figures 3 and 4; Figures 1, 3 and 4; Figures 1–3; Figure 1a,b; Figure 1a–c.'));
    eachMatch(/(?<![\p{L}])(figures?|tables?)\s+((?:S|A)?\d+)/gu, t, m => { if (!isSentenceStartIdx(t, m.index)) add(P, m.index, m.index + m[1].length, 'error', 'cite', m[1][0] === 'f' ? '6.2' : '6.3', `ต้องขึ้นต้นด้วยตัวใหญ่: “${m[1][0].toUpperCase() + m[1].slice(1)} ${m[2]}”`, `Capitalize: “${m[1][0].toUpperCase() + m[1].slice(1)} ${m[2]}”`, 'In the main text, all figures/tables should be cited in the following formats: Figure 1, Table 1, Figures 3 and 4, Tables 1–3.'); });
    eachMatch(/\b(Tabs?)\.\s*(\d+)/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.3', `ต้องเขียนเต็มคำ: “Table ${m[2]}”`, `Spell out: “Table ${m[2]}”`, 'In the main text, tables should be cited in the following formats: Table 1; Tables 3 and 4; Tables 1, 3 and 4; Tables 1–3.'));
    // “Table 3, Table S2” → “Tables 3 and S2”
    eachMatch(/\b(Figure|Table)s?\s+((?:S|A)?\d+[a-z]?)((?:\s*[,;]\s*\1s?\s+(?:S|A)?\d+[a-z]?)+)(?!\s*,?\s*(?:and|&|or)\s+\1)/g, t, m => {
      const ids = [m[2], ...(m[3].match(/(?:S|A)?\d+[a-z]?/g) || [])];
      const want = `${m[1]}s ${ids.length > 2 ? ids.slice(0, -1).join(', ') + ' and ' + ids[ids.length - 1] : ids.join(' and ')}`;
      add(P, m.index, m.index + m[0].length, 'error', 'cite', m[1] === 'Figure' ? '6.2' : '6.3', `อ้างหลาย${m[1] === 'Figure' ? 'รูป' : 'ตาราง'}ให้ใช้คำว่า ${m[1]}s ครั้งเดียวและคั่นตัวสุดท้ายด้วย and: “${want}”`, `Cite several ${m[1].toLowerCase()}s with one plural label and “and”: “${want}”`, 'In the main text, figures/tables should be cited as: Figures 3 and 4; Figures 1, 3 and 4; Tables 3 and 4; Tables 1, 3 and 4.');
    });
    // “Figure 6 and Figure A2” → “Figures 6 and A2” (same for tables)
    eachMatch(/\b(Figure|Table)s?\s+((?:S|A)?\d+[a-z]?)((?:\s*,\s*\1s?\s+(?:S|A)?\d+[a-z]?)*)(\s*,?\s*(?:and|&)\s+)\1s?\s+((?:S|A)?\d+[a-z]?)\b/g, t, m => {
      const ids = [m[2], ...(m[3].match(/(?:S|A)?\d+[a-z]?(?=\s*(,|$))/g) || []), m[5]];
      const want = `${m[1]}s ${ids.length > 2 ? ids.slice(0, -1).join(', ') + ' and ' + ids[ids.length - 1] : ids.join(' and ')}`;
      add(P, m.index, m.index + m[0].length, 'error', 'cite', m[1] === 'Figure' ? '6.2' : '6.3', `อ้างหลาย${m[1] === 'Figure' ? 'รูป' : 'ตาราง'}ให้ใช้คำว่า ${m[1]}s ครั้งเดียว: “${want}”`, `Cite several ${m[1].toLowerCase()}s with one plural label: “${want}”`, 'In the main text, figures/tables should be cited as: Figures 3 and 4; Figures 1, 3 and 4; Tables 3 and 4; Tables 1, 3 and 4.');
    });
    if (!capLike || true) eachMatch(/\b(Figure|Table)\s+((?:S|A)?\d+)(\s*,\s*(?:S|A)?\d+)*\s*(and|or|&)\s+((?:S|A)?\d+)\b/g, t, m => { if (P.role === 'fig_caption' && m.index === trimRange(P)[0]) return; if (P.role === 'tab_caption' && m.index === trimRange(P)[0]) return; if (m[4] === 'or') return; add(P, m.index, m.index + m[1].length, 'error', 'cite', m[1] === 'Figure' ? '6.2' : '6.3', `อ้างถึงหลายรายการต้องใช้รูปพหูพจน์ “${m[1]}s”`, `Use the plural “${m[1]}s” when citing several`, 'Figures 3 and 4; Figures 1, 3 and 4; Figures 1–3; Tables 3 and 4; Tables 1–3.'); });
    eachMatch(/\b(Figures?|Tables?)\s+(\d+)\s*[–-]\s*(\d+)\b/g, t, m => { if (/^(Figure|Table)$/.test(m[1])) add(P, m.index, m.index + m[1].length, 'error', 'cite', '6.2', `ช่วงของรูป/ตารางต้องใช้รูปพหูพจน์ “${m[1]}s ${m[2]}–${m[3]}”`, `A range takes the plural “${m[1]}s ${m[2]}–${m[3]}”`, 'Figures 1–3; Tables 1–3.'); });
    eachMatch(/\bFigures?\s+(?:S|A)?\d+\s?\(([a-zA-Z])\)/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.2', 'อ้างรูปย่อยต้องเขียนติดกันโดยไม่มีวงเล็บ เช่น “Figure 1a”', 'Cite subfigures without parentheses, e.g., “Figure 1a”', 'Figure citations: Figure 1a,b; Figure 1a–c; Figure 9a or Figure 9c; Figure 2(a1).'));
    eachMatch(/\bFigure\s+\d+([a-z])\s+(and|&)\s+([a-z])\b/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.2', 'รูปย่อยหลายรูปในรูปเดียวกันให้เขียน “Figure 1a,b”', 'Several subfigures of one figure: write “Figure 1a,b”', 'Figure citations: Figure 1a,b; Figure 1a–c.'));
    eachMatch(/\b(Eqs?\.|eqs?\.|Eq\s|equations?(?=\s*\(?\d))\s*\(?(\d+[a-z]?)\)?/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.4', `ต้องเขียนเป็น “Equation (${m[2]})”`, `Must be “Equation (${m[2]})”`, 'If the word “Equation” is used, ensure that it appears as “Equation” or “Equations” instead of “equation”, “equations”, “Eq.”, “eq.”, “Eqs.”, or “eqs.” before the label. Equation numbers should be in parentheses, for example Equation (1), Equations (1) and (2), and Equations (1)–(3).'));
    eachMatch(/\bEquations?\s+(\d+[a-z]?)(?!\s*\()/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.4', `เลขสมการต้องอยู่ในวงเล็บ: “Equation (${m[1]})”`, `Equation numbers must be in parentheses: “Equation (${m[1]})”`, 'Equation numbers should be in parentheses, for example Equation (1), Equations (1) and (2), and Equations (1)–(3).'));
    // ---- v16 main-text checks ----
    // “Equation (1) and (2)” / “Equation (1) and Equation (2)” → “Equations (1) and (2)”; ranges “Equations (1)–(3)”
    eachMatch(/\bEquation\s*\((\d+[a-z]?)\)((?:\s*,\s*(?:Equations?\s*)?\(\d+[a-z]?\))*)(\s*,?\s*(?:and|&)\s+)(?:Equations?\s*)?\((\d+[a-z]?)\)/g, t, m => {
      const ids = [m[1], ...(m[2].match(/\d+[a-z]?/g) || []), m[4]].map(x => `(${x})`);
      add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.4', `อ้างหลายสมการต้องใช้ “Equations” ครั้งเดียว: “Equations ${ids.length > 2 ? ids.slice(0, -1).join(', ') + ' and ' + ids[ids.length - 1] : ids.join(' and ')}”`, `Cite several equations with one “Equations”: “Equations ${ids.length > 2 ? ids.slice(0, -1).join(', ') + ' and ' + ids[ids.length - 1] : ids.join(' and ')}”`, 'Equation numbers should be in parentheses, for example Equation (1), Equations (1) and (2), and Equations (1)–(3).');
    });
    eachMatch(/\b(Equations?)\s*\((\d+)\)\s*([-−~]|–|to)\s*\((\d+)\)/g, t, m => { if (m[1] === 'Equations' && m[3] === '–' && !/\s/.test(m[0].slice(m[0].indexOf(')') + 1, m[0].lastIndexOf('(')))) return; add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.4', `ช่วงสมการต้องเขียน “Equations (${m[2]})–(${m[4]})”`, `Write the equation range as “Equations (${m[2]})–(${m[4]})”`, 'Equation numbers should be in parentheses, for example Equation (1), Equations (1) and (2), and Equations (1)–(3).'); });
    eachMatch(/\bEquations?\s*\((\d+)\s*[–-]\s*(\d+)\)/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.4', `ช่วงสมการต้องเขียน “Equations (${m[1]})–(${m[2]})”`, `Write the equation range as “Equations (${m[1]})–(${m[2]})”`, 'Equation numbers should be in parentheses: Equations (1)–(3).'));
    // trademark: ™ or superscript TM
    eachMatch(/(?<=[\p{Ll}\d®)\]])(\s?)(\(TM\)|TM)(?![\p{L}\d])/gu, t, m => { const k = m.index + m[1].length; if (m[2] === 'TM' && P.fmt(k).vert === 'superscript') return; if (m[1] && m[2] === 'TM') return; add(P, k, k + m[2].length, 'error', 'text', '6.1', 'เครื่องหมายการค้าต้องใช้ “™” (หรือ TM ที่เป็นตัวยก)', 'Use “™” for trademarks (or a superscript TM)', 'Use ™ (™, UTF-16: 2122) for trademarks (the superscript format of the text TM is also acceptable).'); });
    // units after a number must not be italic
    if (!(P.role === 'heading' && P.head && P.head.lvl === 2)) {
      const [ps, pe] = trimRange(P); const allItal = fracFmt(P, ps, pe, f => f.i);
      if (allItal == null || allItal < 0.8) eachMatch(/(?<![\w.,\/])(\d+(?:\.\d+)?)\s(mm|cm|km|nm|μm|µm|mg|kg|µg|μg|ng|mL|ml|μL|µL|min|ms|μs|µs|ns|Hz|kHz|MHz|GHz|kV|mV|mA|kW|MW|mW|kJ|MJ|kPa|MPa|GPa|Pa|kN|mol|mmol|μmol|µmol|mM|μM|µM|nM|°C|°F|rpm|dB|ppm|ppb|kDa|Da|bp|kb|cal|kcal|ha|lx|eV|keV|MeV|kΩ|Gy|mGy|Bq|g\/L|mg\/L|mg\/kg|g\/kg|m\/s|km\/h|mg\/mL|μg\/mL|µg\/mL)(?![\p{L}\p{N}])/gu, t, m => {
        const k = m.index + m[1].length + 1, n = m[2].length;
        if (P.fmt(k).math || supAt(k)) return;
        if (allFmt(P, k, k + n, f => f.i) && !allFmt(P, m.index, m.index + m[1].length, f => f.i)) add(P, k, k + n, 'error', 'unit', '6.1', `หน่วย “${m[2]}” ห้ามเป็นตัวเอียง`, `The unit “${m[2]}” must not be italic`, 'Units should not be in italics, except when they appear within an entirely italicized environment (e.g., a quotation, theorem), where they may be italicized for consistency.');
      });
    }
    // “Table 2 (continued)” → “Table 2. Cont.”
    { const [s0, e0] = trimRange(P); const tt = t.slice(s0, e0);
      const cm1 = tt.match(/^(Table|Figure|Scheme)\s+([A-Z]?\d+)\.?\s*(\(?\s*(?:continued|contd?\.?|cont’d|cont'd)\s*\)?\.?)\s*$/i) || tt.match(/^\(?\s*(?:continued)\s*\)?\s*(Table|Figure|Scheme)\s+([A-Z]?\d+)\.?$/i);
      if (cm1 && !new RegExp(`^${cm1[1]} ${cm1[2]}\\. Cont\\.$`).test(tt)) add(P, s0, e0, 'error', 'figtab', cm1[1] === 'Table' ? '6.3' : '6.2', `คำบรรยายต่อหน้าต้องเขียน “${cm1[1]} ${cm1[2]}. Cont.”`, `A continued caption must read “${cm1[1]} ${cm1[2]}. Cont.”`, 'If the table is over one page long, there should be captions for each page of the table; the first caption should be Table X. The next few captions should be as follows: Table X. Cont. (Figure X. Cont. for figures.)'); }
    // spaces around operators inside a superscript/subscript: ΔH n – 1 → ΔHn–1
    for (let i = 0; i < t.length; i++) {
      const v = supAt(i) ? P.fmt(i).vert : null; if (!v || !P.chars[i].r) continue;
      let j = i; while (j < t.length && P.chars[j].r && P.fmt(j).vert === v) j++;
      const seg = t.slice(i, j);
      if (seg.length > 2 && /\S\s+[+\-−–=<>×±·\/]\s*\S|\S\s*[+\-−–=<>×±·\/]\s+\S/.test(seg)) add(P, i, j, 'error', 'text', '6.1', `ห้ามเว้นวรรครอบเครื่องหมายในตัวยก/ตัวห้อย: “${seg}” → “${seg.replace(/\s+/g, '')}”`, `No spaces around operators in a superscript/subscript: “${seg}” → “${seg.replace(/\s+/g, '')}”`, 'Mathematical Terms: Leave no space around mathematical operators in subscripts and superscripts: ΔHn–1, Eλ>353, M(x+y)+.');
      i = j;
    }
    // reference citations
    if (citeRoles.has(P.role)) {
      eachMatch(/\[([^\[\]]{1,80})\]/g, t, m => {
        const inner = m[1]; const i = m.index; const j = i + m[0].length;
        if (/^\s*\d+(\s*[,;–\-−]\s*\d+)*\s*$/.test(inner)) {
          const nums = inner.split(/[,;]/).map(x => x.trim());
          const all = [];
          let math = /(^|[,\s])0(\s|,|$)/.test(inner) || /\d\.\d/.test(inner);
          if (math) return;
          nums.forEach(x => { const r = x.split(/\s*[–\-−]\s*/).map(Number); if (r.length === 2) { for (let q = r[0]; q <= r[1] && q - r[0] < 500; q++) all.push(q); } else all.push(r[0]); });
          if (nRefs && all.some(n => n > nRefs) && all.every(n => n > 0)) { if (inner.includes(', ') && all.length === 2) return; add(P, i, j, 'error', 'cite', '7.12', `อ้างอิงเลข ${all.filter(n => n > nRefs).join(', ')} ไม่มีอยู่ในรายการอ้างอิง (มี ${nRefs} รายการ)`, `Citation ${all.filter(n => n > nRefs).join(', ')} does not exist in the reference list (${nRefs} references)`, 'References’ Citations: The references should be cited with the Arabic number in square brackets.'); }
          if (/,\s+/.test(inner) || /^\s|\s$/.test(inner)) add(P, i, j, 'error', 'cite', '6.1', `ห้ามเว้นวรรคในวงเล็บอ้างอิง: “[${inner.replace(/\s+/g, '')}]” (ถ้าเป็นช่วงทางคณิตศาสตร์ เช่น [1, 3] ให้คงไว้)`, `No spaces inside citation brackets: “[${inner.replace(/\s+/g, '')}]” (keep the space only for a mathematical range such as [1, 3])`, 'The references should be cited with the Arabic number in square brackets, “[]”, e.g., “[1]”, “[1,2]”, and “[2–4]”. Pay attention to brackets: when they are expressed as a mathematical range, there should be a space … e.g., [1, 3].');
          if (/\d\s*[-−]\s*\d/.test(inner)) add(P, i, j, 'error', 'cite', '6.1', 'ช่วงเลขอ้างอิงต้องใช้ en dash (–)', 'Citation ranges must use an en dash (–)', 'Citations with more than two consecutive references should be replaced with an en dash (–) in between: “[1]”, “[1,2]”, “[3–5]”, and “[1,3–5,7]”.');
          for (let q = 1; q < all.length; q++) if (all[q] <= all[q - 1]) { add(P, i, j, 'error', 'cite', '6.1', 'เลขอ้างอิงในวงเล็บต้องเรียงจากน้อยไปมาก', 'Numbers inside a citation must be in ascending order', 'References’ Citations: they must be cited in ascending order of appearance in the text: “[1,3–5,7]”.'); break; }
          // 3+ consecutive written with commas
          const singles = nums.map(x => /[–\-−]/.test(x) ? null : Number(x));
          let run = 1;
          for (let q = 1; q < singles.length; q++) { if (singles[q] != null && singles[q - 1] != null && singles[q] === singles[q - 1] + 1) { run++; if (run >= 3) { add(P, i, j, 'error', 'cite', '6.1', `เลขอ้างอิงต่อเนื่อง 3 รายการขึ้นไปต้องใช้ en dash เช่น “[${compress(all)}]”`, `Three or more consecutive references take an en dash, e.g., “[${compress(all)}]”`, 'Citations with more than two consecutive references should be replaced with an en dash (–) in between: “[1]”, “[1,2]”, “[3–5]”, and “[1,3–5,7]”.'); break; } } else run = 1; }
          if (nums.some(x => { const r = x.split(/\s*[–\-−]\s*/).map(Number); return r.length === 2 && r[1] - r[0] === 1; })) add(P, i, j, 'error', 'cite', '6.1', 'เลขอ้างอิง 2 รายการติดกันให้ใช้ลูกน้ำ เช่น [1,2] ไม่ใช่ [1–2]', 'Two consecutive references take a comma, e.g., [1,2], not [1–2]', 'Citations with more than two consecutive references should be replaced with an en dash: “[1,2]”, “[3–5]”.');
          if (supAt(i + 1)) add(P, i, j, 'error', 'cite', '6.1', 'เลขอ้างอิงห้ามเป็นตัวยก ต้องอยู่ในวงเล็บเหลี่ยมระดับบรรทัดปกติ', 'Citations must not be superscript; use normal-size numbers in square brackets', 'The references should be cited with the Arabic number in square brackets, “[]”, e.g., “[1]”.');
          if (isSentenceStartIdx(t, i) && /^\s+[a-z]/.test(t.slice(j)) || (isSentenceStartIdx(t, i) && /^\s+(and|et al\.)?\s*[a-z]/.test(t.slice(j)))) add(P, i, j, 'error', 'cite', '6.1', `ห้ามใช้เลขอ้างอิงเป็นประธานของประโยค — ใช้ “Ref. ${m[0]}” หรือชื่อผู้แต่ง เช่น “Liu ${m[0]}”`, `Do not use the citation as the subject — write “Ref. ${m[0]}” or the author name, e.g., “Liu ${m[0]}”`, 'Ref. number should not be used as the subject in sentences of the main text (e.g., “[1] introduced …” is incorrect). We advise adding “Ref.” or “author names” before the citation.');
          all.forEach(n => { if (!citedSet.has(n) && n > 0) { citedSet.add(n); citeOrder.push({ n, P, i, j }); } });
        } else if (/^\s*\d+\s*,\s*(pp?\.|page|chap|ch\.|Section|Table|Figure)/i.test(inner)) {
          add(P, i, j, 'error', 'cite', '6.1', `ห้ามใส่เลขหน้า/ข้อความอื่นในวงเล็บอ้างอิง — เช่น “[${inner.match(/\d+/)[0]}] (${inner.replace(/^\s*\d+\s*,\s*/, '')})”`, `Move page numbers/other text out of the citation brackets — e.g., “[${inner.match(/\d+/)[0]}] (${inner.replace(/^\s*\d+\s*,\s*/, '')})”`, 'Other content such as the page number, text, etc., should not be included in the square brackets of the reference citations; e.g., “[14, pp. 223–224]” should be replaced by “(pp. 223–224, [14])” or “[14] (pp. 223–224)”.');
          const n0 = Number(inner.match(/\d+/)[0]); if (!citedSet.has(n0)) { citedSet.add(n0); citeOrder.push({ n: n0, P, i, j }); }
        }
      });
      // author-year citation without numeric
      eachMatch(/\(([A-Z][\p{L}'’-]+(?:\s+et al\.)?|[A-Z][\p{L}'’-]+\s+(?:and|&)\s+[A-Z][\p{L}'’-]+),?\s+((?:19|20)\d{2}[a-z]?)\)/gu, t, m => {
        const sentEnd = t.indexOf('. ', m.index); const seg = t.slice(m.index, sentEnd < 0 ? t.length : sentEnd);
        if (!/\[\d/.test(seg)) add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.1', 'การอ้างอิงแบบ ผู้แต่ง-ปี ต้องมีเลขอ้างอิง [X] ในประโยคเดียวกัน', 'An author–date citation needs a numeric citation [X] in the same sentence', 'For non-numeric format reference citations (e.g., author-date formats, bibliographic details), a corresponding numeric citation [X] must be present within the same sentence.');
      });
      // figure/table first citations
      if (!['fig_caption', 'tab_caption'].includes(P.role) || true) {
        eachMatch(/\b(Figures?|Tables?|Schemes?)\s+((?:[A-Z]?\d+[a-z]*(?:\([a-z0-9,]+\))?)(?:\s*(?:,|and|or|&|–|-)\s*[A-Z]?\d+[a-z]*)*)/g, t, m => {
          const isCapStart = (P.role === 'fig_caption' || P.role === 'tab_caption') && m.index === trimRange(P)[0];
          if (isCapStart) return;
          const kind = /^Table/.test(m[1]) ? 'tab' : /^Scheme/.test(m[1]) ? 'sch' : 'fig';
          const ids = []; const re2 = /([A-Z]?)(\d+)/g; let z;
          const seq = m[2]; const parts = seq.split(/\s*(,|and|or|&)\s*/);
          for (const part of parts) {
            const rr = part.match(/^([A-Z]?)(\d+)[a-z]*\s*[–-]\s*([A-Z]?)(\d+)/);
            if (rr) { for (let q = Number(rr[2]); q <= Number(rr[4]); q++) ids.push(rr[1] + q); continue; }
            const one = part.match(/^([A-Z]?)(\d+)/); if (one) ids.push(one[1] + one[2]);
          }
          const map = kind === 'tab' ? tabFirst : kind === 'sch' ? schFirst : figFirst;
          ids.forEach(id => { if (!map.has(id)) map.set(id, { P, i: m.index, j: m.index + m[0].length, order: P.idx }); });
        });
      }
    }
  }
  function isSentenceStartIdx(t, i) { const b = t.slice(0, i).replace(/\s+$/, ''); if (/\bet al\.$/.test(b) || /\b(e\.g|i\.e|cf|vs|ca|Ref|Refs|Fig|Eq|No)\.$/.test(b)) return false; return b === '' || /[.!?:]$/.test(b) || /\t$/.test(t.slice(0, i)); }
  function fullMonth(m) { const all = MONTHS.split('|'); const k = all.findIndex(x => x.toLowerCase().startsWith(m.toLowerCase().replace('.', '').slice(0, 3))); return k >= 0 ? all[k] : m; }
  function compress(arr) { const a = [...new Set(arr)].sort((x, y) => x - y); const out = []; for (let q = 0; q < a.length;) { let r = q; while (r + 1 < a.length && a[r + 1] === a[r] + 1) r++; if (r - q >= 2) out.push(a[q] + '–' + a[r]); else for (let z = q; z <= r; z++) out.push(a[z]); q = r + 1; } return out.join(','); }

  // citation order
  let maxSeen = 0;
  citeOrder.forEach(c => {
    if (c.n > maxSeen + 1) add(c.P, c.i, c.j, 'error', 'cite', '6.1', `อ้างอิง [${c.n}] ถูกอ้างถึงครั้งแรกก่อนอ้างอิง [${maxSeen + 1}] — ต้องอ้างตามลำดับจากน้อยไปมาก`, `Reference [${c.n}] is first cited before reference [${maxSeen + 1}] — references must be cited in ascending order of appearance`, 'References’ Citations: they must be cited in ascending order of appearance in the text.');
    maxSeen = Math.max(maxSeen, c.n);
  });
  refs.forEach((P, ix) => { if (!citedSet.has(ix + 1) && citeOrder.length) add(P, null, null, 'check', 'cite', '6.1', `รายการอ้างอิงที่ ${ix + 1} ไม่ถูกอ้างถึงในเนื้อหา`, `Reference ${ix + 1} is not cited in the text`, 'References’ Citations: The references should be cited with the Arabic number in square brackets … in ascending order of appearance in the text.'); });

  /* ---------- 9. figures, tables, captions ---------- */
  const captionChecks = (P, kind) => {
    const [s, e] = trimRange(P); const t = P.text;
    const re = kind === 'fig' ? captionRe : tabCapRe;
    const m = t.slice(s).match(kind === 'fig' ? /^(Figure|Fig\.?|Scheme|Chart|Graph)\s*([A-Z]?\d+)([a-z]?)(\s*)(\.|:|\||–|—|-|\s+Cont\.?)?/i : /^(Table)\s*([A-Z]?\d+)([a-z]?)(\s*)(\.|:|\||–|—|-|\s+Cont\.?)?/i);
    if (!m) return null;
    const word = m[1], id = m[2], labelEnd = s + m[0].length;
    const sec = kind === 'fig' ? '6.2' : '6.3';
    const capRule = kind === 'fig' ? 'Figure caption: Figure X. Caption. (Scheme X. Caption.) should appear below the image or scheme; Figure/Scheme X. should be in bold; the caption content should be written in regular format, not Title Case; there should always be a full stop/period at the end of the caption.' : 'Table caption: Table X. The caption should appear before the table; Table X. should be bold; the caption content should be written in regular format, not Title Case; there should always be a full stop/period at the end of the caption.';
    const want = kind === 'fig' ? (/^Scheme$/i.test(word) ? 'Scheme' : 'Figure') : 'Table';
    if (word !== want && !(kind === 'fig' && /^(Scheme|Chart)$/.test(word))) add(P, s, s + word.length, 'error', 'figtab', sec, `ต้องเขียน “${want} ${id}.” เต็มคำ`, `Must read “${want} ${id}.” in full`, capRule);
    const punct = (m[5] || '').trim();
    if (punct !== '.' && !/^Cont/i.test(punct)) add(P, s, labelEnd, 'error', 'figtab', sec, `ป้ายกำกับต้องเป็น “${want} ${id}.” (ลงท้ายด้วยจุด) พบ “${t.slice(s, labelEnd).trim()}”`, `The label must be “${want} ${id}.” (ending with a period); found “${t.slice(s, labelEnd).trim()}”`, capRule);
    if (!allFmt(P, s, labelEnd, f => f.b)) add(P, s, labelEnd, 'error', 'figtab', sec, `“${want} ${id}.” ต้องเป็นตัวหนา`, `“${want} ${id}.” must be bold`, capRule);
    const contentS = labelEnd;
    const fb = fracFmt(P, contentS, e, f => f.b, ch => !/[()]/.test(ch));
    if (fb != null && fb > 0.6) add(P, contentS, e, 'error', 'figtab', sec, 'เนื้อหาคำบรรยายต้องเป็นตัวปกติ (เฉพาะป้าย “' + want + ' X.” ที่เป็นตัวหนา)', 'The caption content must be regular (only the “' + want + ' X.” label is bold)', capRule);
    if (!/[.]$/.test(t.slice(s, e).replace(/\s*\(.*?(Reprinted|Adapted)[^)]*\)\s*$/, '').trim()) && !/^Cont/i.test(punct)) add(P, e - 1, e, 'error', 'figtab', sec, 'คำบรรยายต้องจบด้วยจุด (.) เสมอ', 'The caption must always end with a full stop', capRule);
    // Title Case caption content
    const words = t.slice(contentS, e).match(/\b[\p{L}][\p{L}'-]*/gu) || [];
    const content = words.filter(w => !MINOR_OK.has(w.toLowerCase()) && w.length > 3);
    const capd = content.filter(w => /^[\p{Lu}][\p{Ll}]/u.test(w));
    /* caption Title Case is not checked in the main text */
    // subfigure labels bold letters
    const panelSet = (() => { const all = new Set(); eachMatch(/\(([a-zA-Z])\)/g, t.slice(contentS, e), x => all.add(x[1])); const ok = new Set(); for (const base of ['a', 'A']) for (let q = base.charCodeAt(0); all.has(String.fromCharCode(q)); q++) ok.add(String.fromCharCode(q)); return ok; })();
    if (kind === 'fig') eachMatch(/\(([a-zA-Z])\)/g, t.slice(contentS, e), x => { const k = contentS + x.index + 1; if (!panelSet.has(x[1])) return; if (!P.fmt(k).b) add(P, k - 1, k + 2, 'error', 'figtab', sec, `ตัวอักษรรูปย่อย (${x[1]}) ต้องเป็นตัวหนา (วงเล็บไม่หนา)`, `Subfigure letter (${x[1]}) must be bold (parentheses regular)`, 'If there are subfigures in a Figure: Subfigures should be ordered by Latin letters with parentheses, e.g., (a), (b), (c) … Only Latin letters should be bold; parentheses should be whole.'); });
    // credit line for reproduced figures/tables: “(Reprinted/Adapted with permission from Ref. [X]. Copyright Year Owner.)” or “(Reprinted/Adapted from Ref. [X].)”
    {
      const RC = 'Copyright permission: credit lines should appear at the end of the caption in parentheses: “Reprinted with permission from Ref. [X]. Copyright Year Copyright Owner’s Name.” / “Adapted with permission from Ref. [X]. Copyright Year Owner.”; for open access sources: “Reprinted from Ref. [X].” / “Adapted from Ref. [X].” (Chicago/APA: “… from Author Names (Year of Publication).”)';
      const cap = t.slice(contentS, e);
      eachMatch(/\b(Reprinted|Adapted|Reproduced|Modified|Redrawn|Taken|Source[ds]?)(\s+with\s+permission)?(\s+from\s+|:\s*)(Refs?\.\s*)?(\[[\d,–\s-]+\])/gi, cap, m => {
        const k = contentS + m.index, n = m[0].length;
        if (!/^(Reprinted|Adapted)$/.test(m[1])) { add(P, k, k + n, 'check', 'figtab', sec, `เครดิตที่มาของรูป/ตารางควรเขียนแบบ “Reprinted from Ref. ${m[5]}.” หรือ “Adapted from Ref. ${m[5]}.” (ถ้ามีลิขสิทธิ์: “… with permission from Ref. ${m[5]}. Copyright Year Owner.”)`, `Write the credit line as “Reprinted from Ref. ${m[5]}.” or “Adapted from Ref. ${m[5]}.” (with copyright: “… with permission from Ref. ${m[5]}. Copyright Year Owner.”)`, RC); return; }
        if (!m[4] || !/^\s+from\s+$/.test(m[3])) add(P, k, k + n, 'error', 'figtab', sec, `ต้องเขียน “${m[1]}${m[2] || ''} from Ref. ${m[5]}”`, `Write “${m[1]}${m[2] || ''} from Ref. ${m[5]}”`, RC);
        const tail = cap.slice(m.index + n, m.index + n + 120);
        if (m[2] && !/^\.\s*Copyright\s+(?:©\s*)?(?:19|20)\d{2}\s+\S/.test(tail)) add(P, k, k + n, 'error', 'figtab', sec, 'เครดิตแบบ “with permission” ต้องตามด้วย “. Copyright ปี เจ้าของลิขสิทธิ์.”', 'A “with permission” credit must be followed by “. Copyright Year Owner.”', RC);
        else if (m[2] && /^\.\s*Copyright\s+©/.test(tail)) add(P, k, k + n + tail.indexOf('©') + 1, 'error', 'figtab', sec, 'รูปแบบเครดิตเป็น “Copyright ปี เจ้าของ” — ไม่ต้องใส่ ©', 'The credit reads “Copyright Year Owner” — no ©', RC);
        const before = cap.slice(0, m.index);
        if (!/\(\s*$/.test(before)) add(P, k, k + n, 'error', 'figtab', sec, 'เครดิตที่มาต้องอยู่ท้ายคำบรรยายในวงเล็บ “(Reprinted from Ref. [X].)”', 'The credit line goes at the end of the caption in parentheses, e.g., “(Reprinted from Ref. [X].)”', RC);
      });
    }
    return { id, word: want, cont: /^Cont/i.test(punct) || /^\s*\(?\s*(Cont\.|continued|contd)/i.test(t.slice(labelEnd, labelEnd + 12)) };
  };
  const blockIndexOfPara = new Map(); blocks.forEach((b, i) => { if (b.kind === 'p') blockIndexOfPara.set(b.p, i); else b.t.paras.forEach(p => blockIndexOfPara.set(p, i)); });
  const prevNonEmpty = bi => { for (let k = bi - 1; k >= 0; k--) { const b = blocks[k]; if (b.kind === 'tbl' || !b.p.empty) return b; } return null; };
  const nextNonEmpty = bi => { for (let k = bi + 1; k < blocks.length; k++) { const b = blocks[k]; if (b.kind === 'tbl' || !b.p.empty) return b; } return null; };
  paras.filter(P => P.role === 'fig_caption').forEach(P => {
    const r = captionChecks(P, 'fig'); if (!r) return;
    if (!r.cont) (r.word === 'Scheme' ? schCaps : figCaps).push({ P, id: r.id });
    const bi = blockIndexOfPara.get(P);
    const pv = prevNonEmpty(bi), nx = nextNonEmpty(bi);
    const isFig = b => b && b.kind === 'p' && (b.p.drawings.length || b.p.role === 'figure');
    if (!P.inTable && !isFig(pv) && isFig(nx)) add(P, null, null, 'error', 'figtab', '6.2', 'คำบรรยายรูปต้องอยู่ “ใต้” รูปภาพ', 'The figure caption must appear BELOW the image', 'Figure X. Caption. (Scheme X. Caption.) should appear below the image or scheme.');
    if (!P.inTable && nx && nx.kind === 'p' && ['body'].includes(nx.p.role) && nx.p.fmt(trimRange(nx.p)[0]).size <= 9 && !/^\s*[A-Z]/.test('x')) {}
  });
  paras.filter(P => P.role === 'tab_caption').forEach(P => {
    const r = captionChecks(P, 'tab'); if (!r) return;
    if (!r.cont) tabCaps.push({ P, id: r.id });
    const bi = blockIndexOfPara.get(P);
    const pv = prevNonEmpty(bi), nx = nextNonEmpty(bi);
    if (!P.inTable && !(nx && nx.kind === 'tbl') && pv && pv.kind === 'tbl') add(P, null, null, 'error', 'figtab', '6.3', 'คำบรรยายตารางต้องอยู่ “เหนือ” ตาราง', 'The table caption must appear BEFORE (above) the table', 'Table X. The caption should appear before the table.');
    if (!P.inTable && nx && nx.kind === 'p' && nx.p.drawings.length) add(nx.p, null, null, 'error', 'figtab', '6.3', 'ตารางนี้เป็นรูปภาพ — ต้องทำเป็นตาราง Word/Excel ที่แก้ไขได้', 'This table is an image — tables must be prepared in Word/Excel table format', 'Tables should be prepared in MS Word/Excel table format, not inserted as images.');
  });
  // figure paragraphs: inline & sizes
  paras.filter(P => P.role === 'figure' || (P.drawings.length && ['body', 'appendix_body'].includes(P.role))).forEach(P => {
    if (P.drawings.some(d => d.anchor)) add(P, null, null, 'error', 'figtab', '6.2', 'รูปภาพต้องตั้งเป็น “In Line with Text” (ไม่ใช่ลอย/Wrap)', 'Figures must be positioned “In Line with Text” (not floating/wrapped)', 'The position of figures should be “in line with text”.');
    if (P.drawings.some(d => d.cx > 18.46 * 360000 + 20000)) add(P, null, null, 'error', 'figtab', '6.2', `รูปกว้าง ${r2(Math.max(...P.drawings.map(d => d.cx)) / 360000)} cm เกินความกว้างหน้ากระดาษ (18.46 cm)`, `The figure is ${r2(Math.max(...P.drawings.map(d => d.cx)) / 360000)} cm wide, wider than the text area (18.46 cm)`, 'The image size should not be greater than the page size … The content should not exceed the page margins.');
  });
  // sequence: captions numbered 1..n
  const seqCheck = (caps, firstMap, kind) => {
    const word = kind === 'fig' ? 'Figure' : kind === 'sch' ? 'Scheme' : 'Table';
    const sec = kind === 'tab' ? '6.3' : '6.2';
    const main = caps.filter(c => /^\d+$/.test(c.id));
    main.forEach((c, ix) => { if (Number(c.id) !== ix + 1) add(c.P, null, null, 'error', 'figtab', sec, `ลำดับ${kind === 'fig' ? 'รูป' : kind === 'sch' ? ' Scheme ' : 'ตาราง'}ไม่ต่อเนื่อง: พบ ${word} ${c.id} ควรเป็น ${word} ${ix + 1}`, `${word}s are not numbered sequentially: found ${word} ${c.id}, expected ${word} ${ix + 1}`, `${word}s should be numbered sequentially; the first mention of a ${word.toLowerCase()} and the introduction to each ${word.toLowerCase()} must be made in sequence.`); });
    main.forEach(c => {
      const f = firstMap.get(c.id);
      if (!f) add(c.P, null, null, 'error', 'figtab', sec, `${word} ${c.id} ไม่ถูกอ้างถึงในเนื้อหา`, `${word} ${c.id} is not cited in the text`, `${word}s should be numbered sequentially; the first mention of a ${word.toLowerCase()} … must be made in sequence. A ${word} should be after its first citation.`);
      else if (f.order > c.P.idx) add(c.P, null, null, 'check', 'figtab', sec, `${word} ${c.id} อยู่ก่อนการอ้างถึงครั้งแรกในเนื้อหา — ควรวางหลังจุดที่อ้างถึงครั้งแรก`, `${word} ${c.id} appears before its first citation — place it after the first citation`, 'A Figure or Table should be after its first citation, but this can be adjusted depending on the spacing.');
    });
    // first-mention order
    const firsts = [...firstMap.entries()].filter(([id]) => /^\d+$/.test(id)).sort((a, b) => a[1].order - b[1].order || a[1].i - b[1].i);
    let mx = 0;
    firsts.forEach(([id, f]) => { const n = Number(id); if (n > mx + 1) add(f.P, f.i, f.j, 'error', 'figtab', sec, `${word} ${n} ถูกอ้างถึงครั้งแรกก่อน ${word} ${mx + 1} — ต้องอ้างตามลำดับ`, `${word} ${n} is first cited before ${word} ${mx + 1} — cite them in sequence`, `${word}s should be numbered sequentially; the first mention of a ${word.toLowerCase()} and the introduction to each ${word.toLowerCase()} must be made in sequence.`); mx = Math.max(mx, n); });
    firsts.forEach(([id, f]) => { if (!main.some(c => c.id === id) && main.length) add(f.P, f.i, f.j, 'check', 'figtab', sec, `อ้างถึง ${word} ${id} แต่ไม่พบคำบรรยาย ${word} ${id}`, `${word} ${id} is cited but no ${word} ${id} caption was found`, `${word}s should be numbered sequentially.`); });
  };
  seqCheck(figCaps, figFirst, 'fig');
  seqCheck(tabCaps, tabFirst, 'tab');
  if (schCaps.length) seqCheck(schCaps, schFirst, 'sch');

  // tables
  for (const T of model.tables) {
    if (T.depth > 0) continue;
    const P0 = T.paras.find(p => !p.empty) || T.paras[0];
    if (!P0 || !P0.role || P0.role === 'front_table' || T.kind === 'box') continue;
    const tblPr = kid(T.el, 'tblPr');
    if (T.kind === 'equation') {
      // equation number cell
      T.rows.forEach(row => row.forEach(cell => cell.paras.forEach(P => {
        const tt = textOf(P);
        if (tt.length > 10 && /[=≈<>≤≥]/.test(tt)) return;
        if (!P.hasMath && !P.oleEq && tt && !/^[,.;]$/.test(tt) && !/^\([A-Z]?\d+[a-z]?\)$/.test(tt)) add(P, null, null, 'error', 'figtab', '6.4', `เลขสมการต้องอยู่ในวงเล็บ เช่น “(1)” (พบ “${tt}”)`, `Equation numbers must be in parentheses, e.g., “(1)” (found “${tt}”)`, 'If the equation is cited in the main text, it should be labeled with an Arabic number with parentheses, e.g., Equation (1).');
      })));
      continue;
    }
    if (T.kind === 'abbrev') continue;
    // table text may be 8–10 pt, but one size throughout the table
    {
      const cnt = new Map(), firstAt = new Map();
      for (const P of T.paras) {
        if (P.empty || P.role !== 'table_cell') continue;
        const [s0, e0] = trimRange(P);
        for (let i = s0; i < e0; i++) {
          const ch = P.text[i]; if (ch === '￼' || /\s/.test(ch) || !P.chars[i] || P.chars[i].sym) continue;
          const f = P.fmt(i); if (f.math || !f.size || f.size < 8 || f.size > 10) continue;
          cnt.set(f.size, (cnt.get(f.size) || 0) + 1);
          if (!firstAt.has(f.size)) firstAt.set(f.size, P);
        }
      }
      if (cnt.size > 1) {
        const main = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
        for (const [z, P] of firstAt) if (z !== main) add(P, null, null, 'error', 'format', '6.3', `ขนาดตัวอักษรในตารางต้องเท่ากันทั้งตาราง (8–10 pt): ส่วนใหญ่เป็น ${main} pt แต่ตรงนี้เป็น ${z} pt`, `Table text must be one size throughout (8–10 pt): most is ${main} pt but this is ${z} pt`, 'Table content: Font size: 8 pt ≤ font size ≤ 10 pt, the same size throughout the table.');
      }
    }
    // width / indent
    const tw = kid(tblPr, 'tblW'); let width = 0;
    if (tw && wa(tw, 'type') === 'dxa') width = Number(wa(tw, 'w'));
    if (!width) { const grid = kid(T.el, 'tblGrid'); width = kids(grid, 'gridCol').reduce((a, g) => a + Number(wa(g, 'w') || 0), 0); }
    const ind = num(wa(kid(tblPr, 'tblInd'), 'w')) || 0;
    const jc = wa(kid(tblPr, 'jc'), 'val');
    const wcm = cm(width);
    if (width) {
      if (wcm <= 13.86 + 0.05) { /* left indentation not checked */
      }
      if (wcm > 18.46 + 0.1) add(P0, null, null, 'error', 'figtab', '6.3', `ตารางกว้าง ${r2(wcm)} cm เกินขอบกระดาษ (สูงสุด 18.46 cm)`, `Table is ${r2(wcm)} cm wide, beyond the margins (max 18.46 cm)`, 'Table width: The width of a small table is 13.86 cm; the width of a large table is 18.46 cm.');
    }
    // header row bold
    const hdr = T.rows[0] || [];
    const hdrParas = hdr.flatMap(c => c.paras).filter(p => !p.empty);
    const hb = hdrParas.length ? hdrParas.every(p => { const [s, e] = trimRange(p); return allFmt(p, s, e, f => f.b); }) : true;
    if (!hb) add(hdrParas[0], null, null, 'error', 'figtab', '6.3', 'แถวหัวตารางต้องเป็นตัวหนา', 'The table header must be bold', 'The table header should be in bold face and capitalized all initial letters of substantives.');
    const lowW = [];
    hdrParas.forEach(p => eachMatch(/(?<![\p{L}\d(\/-])([\p{Ll}][\p{Ll}]{3,})(?![\p{L}])/gu, p.text, m => { if (!MINOR_OK.has(m[1]) && !UNIT_WORDS.has(m[1]) && !/^(mg|kg|mol|min|vitro|vivo)$/.test(m[1])) lowW.push({ p, m }); }));
    if (lowW.length) { const x = lowW[0]; add(x.p, x.m.index, x.m.index + x.m[0].length, 'check', 'figtab', '6.3', `หัวตาราง: คำหลักต้องขึ้นต้นตัวใหญ่ (${lowW.slice(0, 6).map(z => z.m[1]).join(', ')})`, `Table header: capitalize the initial letters of substantives (${lowW.slice(0, 6).map(z => z.m[1]).join(', ')})`, 'The table header should be in bold face and capitalized all initial letters of substantives.'); }
    // vertical borders
    let bd = kid(tblPr, 'tblBorders');
    if (!bd) { const ts = wa(kid(tblPr, 'tblStyle'), 'val'); for (const st of styleChain(model.S, ts).reverse()) if (st.tblBorders) { bd = st.tblBorders; break; } }
    const vOn = n => { const b = kid(bd, n); return b && !/^(nil|none)$/.test(wa(b, 'val') || '') && Number(wa(b, 'sz') || 0) > 0; };
    let vert = bd && (vOn('insideV') || vOn('left') || vOn('right') || vOn('start') || vOn('end'));
    if (!vert) for (const row of T.rows) for (const c of row) { const tb = kid(kid(c.el, 'tcPr'), 'tcBorders'); if (tb) for (const n of ['left', 'right', 'start', 'end']) { const b = kid(tb, n); if (b && !/^(nil|none)$/.test(wa(b, 'val') || '') && Number(wa(b, 'sz') || 0) > 0) vert = true; } }
    if (vert) add(P0, null, null, 'check', 'figtab', '6.3', 'ตารางมีเส้นแนวตั้ง — ไม่แนะนำ ควรใช้ตารางแบบสามเส้น', 'The table has vertical lines — not advisable; a three-line table is preferred', 'Preferred border form: A three-line table is preferred … Vertical lines, blank rows, and columns are not advisable.');
    // shading / colored text (yellow highlight is the editor's own marking and is ignored)
    let shade = false, color = false, blank = false;
    T.rows.forEach(row => {
      if (row.every(c => c.paras.every(p => p.empty))) blank = true;
      row.forEach(c => { const sh = kid(kid(c.el, 'tcPr'), 'shd'); if (sh && wa(sh, 'fill') && !/^(auto|FFFFFF|FFFF00)$/i.test(wa(sh, 'fill'))) shade = true; c.paras.forEach(p => { for (let i = 0; i < p.text.length; i++) { const f = p.fmt(i); if (!f.math && /\S/.test(p.text[i]) && ((f.color && !/^(auto|000000)$/i.test(f.color)) || (f.hl && f.hl !== 'yellow') || (f.shd && !/^FFFF00$/i.test(f.shd)))) { color = true; break; } } }); });
    });
    if (shade || color) add(P0, null, null, 'check', 'figtab', '6.3', `ตารางมี${shade ? 'สีพื้นหลัง' : ''}${shade && color ? '/' : ''}${color ? 'ข้อความสี/ไฮไลต์' : ''} — ต้องมีคำอธิบาย ไม่เช่นนั้นให้ลบ`, `The table uses ${shade ? 'background color' : ''}${shade && color ? '/' : ''}${color ? 'colored/highlighted text' : ''} — not allowed without an explanation`, 'Tables: background color should not be allowed without an explanation; text should not be colored or shaded without explanation.');
    if (blank) add(P0, null, null, 'check', 'figtab', '6.3', 'ตารางมีแถวว่าง — ไม่แนะนำ', 'The table has blank rows — not advisable', 'Vertical lines, blank rows, and columns are not advisable.');
    // caption before table
    const bi = blockIndexOfPara.get(P0);
    const pv = prevNonEmpty(bi);
    if (!(pv && pv.kind === 'p' && pv.p.role === 'tab_caption') && T.zone !== undefined) add(P0, null, null, 'error', 'figtab', '6.3', 'ไม่พบคำบรรยาย “Table X.” อยู่เหนือตารางนี้', 'No “Table X.” caption directly above this table', 'Table X. The caption should appear before the table.');
  }
  // equations in plain paragraphs (not table)
  paras.filter(P => P.role === 'equation_para').forEach(P => add(P, null, null, 'check', 'figtab', '6.4', 'สมการแบบแยกบรรทัดควรอยู่ในตาราง 1 แถว 2 คอลัมน์ (สมการ | เลขสมการ)', 'A displayed equation should sit in a one-row, two-column table (equation | number)', 'Equations: A table of one row with two columns, with the main equation in the first column: Alignment = center … equation number is in the second column: Alignment = right.'));
  // "Where" after equations
  paras.forEach((P, ix) => {
    if (!['body', 'appendix_body'].includes(P.role)) return;
    const bi = blockIndexOfPara.get(P); const pv = prevNonEmpty(bi);
    const prevEq = pv && ((pv.kind === 'tbl' && pv.t.kind === 'equation') || (pv.kind === 'p' && pv.p.role === 'equation_para'));
    if (prevEq && /^Where\b/.test(textOf(P))) { const s = trimRange(P)[0]; add(P, s, s + 5, 'error', 'text', '6.4', '“Where” หลังสมการต้องเป็นตัวเล็ก “where” และไม่เยื้องบรรทัดแรก', '“Where” after an equation must be lowercase “where” without an indent', '“Where” after equations should be in lower case without an indent.'); }
  });

  /* ---------- 10. back matter ---------- */
  const isResearch = art && RESEARCH_TYPES.test(textOf(art));
  let lastOrder = 0;
  backSeq.forEach(b => {
    const P = b.P; const [s] = trimRange(P);
    if (b.numbered) add(P, s, s + b.len, 'error', 'back', '7', 'หัวข้อ Back Matter ห้ามมีเลขกำกับ', 'Back-matter headings must not be numbered', 'There is no numeral label for Back Matter headings.');
    if (b.order < lastOrder && b.key !== 'appendix') add(P, s, s + b.len, 'error', 'back', '7', `ลำดับ Back Matter ไม่ถูกต้อง: “${b.name}” ต้องอยู่ก่อนส่วนที่มาก่อนหน้า`, `Back-matter order is wrong: “${b.name}” must come earlier`, 'The sequence of Back Matter elements: 1. Supplementary Materials 2. Author Contributions 3. Funding 4. Institutional Review Board Statement 5. Informed Consent Statement 6. Data Availability Statement 7. Acknowledgments 8. Conflicts of Interest/Disclaimer 9. Glossary/Nomenclature/Abbreviations 10. Appendix 11. References 12. Short Biography of Author(s) 13. Disclaimer/Publisher’s Note.');
    lastOrder = Math.max(lastOrder, b.order);
    const lab = b.labelText;
    if (b.key === 'ack' && /Acknowledge/i.test(lab)) add(P, s + (b.len - lab.length), s + b.len, 'error', 'back', '7.8', 'สะกดเป็น “Acknowledgments” (ไม่มี e หลัง g)', 'Spell it “Acknowledgments” (no “e” after “g”)', 'No “e” after “g” in “Acknowledgments”.');
    if (b.key === 'coi' && !/^Conflicts of Interest$/.test(lab) && !/^Disclaimer$/.test(lab)) add(P, s + (b.len - lab.length), s + b.len, 'error', 'back', '7.9', `หัวข้อต้องเป็น “Conflicts of Interest” เสมอ (พบ “${lab}”)`, `The heading should always be “Conflicts of Interest” (found “${lab}”)`, 'The heading should always be “Conflicts of Interest”.');
    if (b.key === 'contrib' && lab !== 'Author Contributions') add(P, s + (b.len - lab.length), s + b.len, 'error', 'back', '7.2', `หัวข้อต้องเป็น “Author Contributions”`, `The heading should be “Author Contributions”`, '7.2. Author Contributions.');
  });
  const bodyOf = key => paras.filter(P => P.backKey === key).map(P => ({ P, t: P.text }));
  const backText = key => bodyOf(key).map(x => x.t).join(' ');
  const has = key => backSeq.some(b => b.key === key);
  const lastPara = [...paras].reverse().find(P => !P.empty) || firstP;
  const nAuthors = authorsP ? authorsP.text.split(/,|\sand\s|&/).filter(x => /\p{L}{2,}/u.test(x)).length : 0;
  if ((iBack >= 0 || refs.length) && !refsOnly) {
    const anchorBack = backSeq.length ? backSeq[0].P : lastPara;
    if (!has('funding')) add(anchorBack, null, null, 'error', 'back', '7.3', 'ไม่พบส่วน “Funding:” — ต้องมีเสมอ แม้ไม่มีทุน (“This research received no external funding.”)', 'No “Funding:” section — it is required even with no funding (“This research received no external funding.”)', 'Funding: the Funding section is required for all papers (except eight special types), even when no funding is available. Either state any funding information or declare that “This research received no external funding”.');
    if (!has('coi')) add(anchorBack, null, null, 'error', 'back', '7.9', 'ไม่พบส่วน “Conflicts of Interest:” — ต้องมีเสมอ', 'No “Conflicts of Interest:” section — it is required', 'After “Acknowledgments”, either state any potential conflicts of interest or declare that “The authors declare no conflicts of interest”. Except for Correction, Retraction, and Expression of Concern, this section is required for all papers.');
    if (!has('disclaimer')) add(lastPara, null, null, 'error', 'back', '7.16', 'ไม่พบ “Disclaimer/Publisher’s Note:” ท้ายบทความ', 'No “Disclaimer/Publisher’s Note:” at the end of the article', 'The Disclaimer/Publisher’s Note for the publication must be included at the end of the article. It should be in the same format and contain the same content as the template.');
    if (nAuthors > 1 && !has('contrib') && isResearch) add(anchorBack, null, null, 'error', 'back', '7.2', 'มีผู้แต่งหลายคน แต่ไม่พบส่วน “Author Contributions:”', 'Several authors but no “Author Contributions:” section', 'If there is more than one author, authors should be asked to prepare a short, one-paragraph statement describing the individual contribution of each co-author.');
    if (isResearch) {
      if (!has('irb')) add(anchorBack, null, null, 'check', 'back', '7.4', 'ไม่พบ “Institutional Review Board Statement:” (จำเป็นสำหรับ Article ที่มีข้อมูลต้นฉบับ — ใส่ “Not applicable.” ได้)', 'No “Institutional Review Board Statement:” (required for research articles — “Not applicable.” is acceptable)', 'This would apply to all journal papers that contain original data; it is necessary for Article, Brief Report, Case Report, Communication, Data Descriptor, Letter, Proceeding Paper and Project Report.');
      if (!has('consent')) add(anchorBack, null, null, 'check', 'back', '7.5', 'ไม่พบ “Informed Consent Statement:”', 'No “Informed Consent Statement:”', 'Informed Consent Statement: necessary for Article, Brief Report, Case Report, Communication, Data Descriptor, Letter, Proceeding Paper and Project Report.');
      if (!has('data')) add(anchorBack, null, null, 'check', 'back', '7.6', 'ไม่พบ “Data Availability Statement:”', 'No “Data Availability Statement:”', 'Data Availability Statement: necessary for Article, Brief Report, Case Report, Communication, Data Descriptor, Letter, Proceeding Paper and Project Report.');
    }
  }
  const contrib = backSeq.find(b => b.key === 'contrib');
  if (contrib) {
    const all = bodyOf('contrib');
    const txt = all.map(x => x.t).join(' ');
    if (!/All authors have read and agreed to the published version of the manuscript\./.test(txt)) add(contrib.P, null, null, 'error', 'back', '7.2', 'ต้องมีประโยค “All authors have read and agreed to the published version of the manuscript.” ครบถ้วนไม่ดัดแปลง', 'The sentence “All authors have read and agreed to the published version of the manuscript.” must be present, unaltered', '“All authors have read and agreed to the published version of the manuscript.” This sentence cannot be missing, repeated, or otherwise altered (even if there are two authors, we should use “All authors” rather than “Both authors”).');
    all.forEach(({ P, t }) => {
      eachMatch(/\bBoth authors\b/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'back', '7.2', 'ใช้ “All authors” แทน “Both authors”', 'Use “All authors”, not “Both authors”', 'even if there are two authors, we should use “All authors” rather than “Both authors”.'));
      eachMatch(/\b(Dr|Prof|Mr|Mrs|Ms)\.\s|\b(PhD|MD|MSc|BSc)\b/g, t, m => add(P, m.index, m.index + m[0].trim().length, 'error', 'back', '7.2', 'ห้ามใช้คำนำหน้า/วุฒิใน Author Contributions', 'No titles/academic suffixes in Author Contributions', 'Titles (Dr., Mr., Prof., etc.) or academic suffixes (MD, MSc., BSc., etc.) should NOT be used in the Author Contributions section.'));
      // within each contribution, the last two authors are joined with “and” (no comma): “methodology, X.X., Y.Y. and Z.Z.;”
      {
        const re = /(?:^|[;:])\s*([A-Za-z][A-Za-z ,'’\/&-]*?),\s+((?:[A-Z][A-Za-z.\-]*\.)(?:\s*(?:,\s*(?:and\s+)?|\s+and\s+)[A-Z][A-Za-z.\-]*\.)+)(?=\s*(?:;|\.\s|\.?$))/g;
        let m;
        while ((m = re.exec(t)) !== null) {
          const names = m[2]; const base = m.index + m[0].length - names.length;
          const seps = [...names.matchAll(/\s*(?:,\s*(?:and\s+)?|\s+and\s+)/g)];
          if (!seps.length) continue;
          const last = seps[seps.length - 1];
          if (/^\s+and\s+$/.test(last[0])) continue;
          const a = base + last.index, b = a + last[0].length;
          const lastName = names.slice(last.index + last[0].length);
          const prevName = names.slice(0, last.index).split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+)/).pop();
          add(P, a, b, 'error', 'back', '7.2', /and/.test(last[0]) ? `ไม่ต้องมีลูกน้ำก่อน “and”: “${prevName} and ${lastName}”` : `ผู้แต่งคนสุดท้ายต้องคั่นด้วย “and”: “${prevName} and ${lastName}”`, /and/.test(last[0]) ? `No comma before “and”: “${prevName} and ${lastName}”` : `Join the last author with “and”: “${prevName} and ${lastName}”`, 'Author Contributions: “Conceptualization, X.X. and Y.Y.; methodology, X.X.; software, X.X.; …” — the last two authors are joined by “and”.');
        }
      }
      eachMatch(/\b([A-Z])\.\s([A-Z])\./g, t, m => add(P, m.index, m.index + m[0].length, 'check', 'back', '7.2', 'อักษรย่อชื่อผู้แต่งควรเขียนติดกัน เช่น “X.Y.”', 'Author initials should be written without spaces, e.g., “X.Y.”', 'For research articles, each author’s contribution should be mentioned, and all author names should be abbreviated correctly: “Conceptualization, X.X. and Y.Y.; methodology, X.X.; …”'));
    });
  }
  bodyOf('ack').forEach(({ P, t }) => eachMatch(/\b(Dr|Prof|Mr|Mrs|Ms)\.\s|\b(PhD|MD|MSc|BSc)\b/g, t, m => add(P, m.index, m.index + m[0].trim().length, 'error', 'back', '7.8', 'ห้ามใช้คำนำหน้า/วุฒิใน Acknowledgments', 'No titles/academic suffixes in Acknowledgments', 'Titles (Dr., Mr., Prof., etc.) or academic suffixes (MD, MSc., BSc., etc.) should NOT be used in the Acknowledgments section.')));
  const fund = backSeq.find(b => b.key === 'funding');
  if (fund) { const t = backText('funding'); if (!/received no external funding|was funded by|funded by|grant|supported by|financial support/i.test(t)) add(fund.P, null, null, 'check', 'back', '7.3', 'ข้อความ Funding ควรเป็น “This research received no external funding.” หรือ “This research was funded by [funder] grant number [xxx].”', 'Funding should read “This research received no external funding.” or “This research was funded by [funder] grant number [xxx].”', 'Please add: “This research received no external funding” or “This research was funded by [name of funder] grant number [xxx]” and “The APC was funded by [XXX]”.'); }
  const coi = backSeq.find(b => b.key === 'coi');
  if (coi) bodyOf('coi').forEach(({ P, t }) => eachMatch(/declare (that there is )?no (potential )?conflict of interest/gi, t, m => add(P, m.index, m.index + m[0].length, 'error', 'back', '7.9', 'ใช้รูปพหูพจน์: “The authors declare no conflicts of interest.”', 'Use the plural: “The authors declare no conflicts of interest.”', 'either state any potential conflicts of interest or declare that “The authors declare no conflicts of interest”.')));
  const disc = paras.find(P => P.role === 'disclaimer');
  if (disc) { const t = paras.filter(P => P.role === 'disclaimer').map(P => P.text).join(' '); if (!/The statements, opinions and data contained in all publications are solely those of the individual author\(s\) and contributor\(s\) and not of MDPI and\/or the editor\(s\)\. MDPI and\/or the editor\(s\) disclaim responsibility for any injury to people or property resulting from any ideas, methods, instructions or products referred to in the content\./.test(t)) add(disc, null, null, 'error', 'back', '7.16', 'ข้อความ Disclaimer/Publisher’s Note ต้องตรงกับเทมเพลตทุกคำ', 'The Disclaimer/Publisher’s Note text must match the template exactly', 'Disclaimer/Publisher’s Note: The statements, opinions and data contained in all publications are solely those of the individual author(s) and contributor(s) and not of MDPI and/or the editor(s). MDPI and/or the editor(s) disclaim responsibility for any injury to people or property resulting from any ideas, methods, instructions or products referred to in the content.'); }
  // Acknowledgements spelling anywhere else
  paras.forEach(P => { if (P.backLabel) return; eachMatch(/\bAcknowledgements?\b/g, P.text, m => add(P, m.index, m.index + m[0].length, 'error', 'back', '7.8', 'สะกดเป็น “Acknowledgments”', 'Spell it “Acknowledgments”', 'No “e” after “g” in “Acknowledgments”.')); });
  // appendix headings & S/A numbering
  paras.filter(P => P.role === 'appendix_heading').forEach(P => {
    const t = textOf(P);
    if (/^Appendix\s*\d/.test(t)) add(P, null, null, 'error', 'back', '7.11', 'ภาคผนวกต้องใช้ตัวอักษร: “Appendix A”, “Appendix B”', 'Appendixes are lettered: “Appendix A”, “Appendix B”', 'If there is only one, it is designated “Appendix A”; if there is more than one, they are designated “Appendix A”, “Appendix B”, etc. Sub-headings: Appendix A.1., Appendix A.2.1., etc.');
    if (/^Appendix$/.test(t)) add(P, null, null, 'check', 'back', '7.11', 'ภาคผนวกต้องมีตัวอักษรกำกับ เช่น “Appendix A”', 'The appendix needs a letter, e.g., “Appendix A”', 'If there is only one, it is designated “Appendix A”.');
  });
  paras.filter(P => P.role === 'appendix_body' || (P.role === 'fig_caption' || P.role === 'tab_caption') && blockIndexOfPara.get(P) > (iBack >= 0 ? blockIndexOfPara.get(topParas[iBack]) : Infinity)).forEach(P => {
    if (!/^(fig|tab)_caption$/.test(P.role)) return;
    const m = textOf(P).match(/^(Figure|Table|Scheme)\s+(\d+)/);
    if (m) add(P, null, null, 'error', 'back', '7.11', `ในภาคผนวกต้องใช้ “${m[1]} A${m[2]}”`, `In an appendix use “${m[1]} A${m[2]}”`, 'The numbering of a Figure/Scheme/Table/Equation/Algorithm/Listing/Box in an Appendix should be introduced with the prefix A, (i.e., Figure A1, Figure A2, Table A1, etc.).');
  });

  /* ---------- 10b. v16 cross-references, tables, equations, theorems, back matter ---------- */
  const citeParas = paras.filter(P => !P.empty && citeRoles.has(P.role) && P.role !== 'supp');
  const listIds = (seq, pref) => { const ids = []; seq.split(/\s*(?:,|and|&|or)\s*/).forEach(part => { const rr = part.match(new RegExp(`^${pref}(\\d+)[a-z]*\\s*[–-]\\s*${pref}?(\\d+)`)); if (rr) { for (let q = Number(rr[1]); q <= Number(rr[2]) && q - Number(rr[1]) < 200; q++) ids.push(q); return; } const one = part.match(new RegExp(`^${pref}(\\d+)`)); if (one) ids.push(Number(one[1])); }); return ids; };
  // M1: “Section 2.3” must exist
  if (tree.length) {
    const have = new Set(tree.map(n => n.parts.join('.')));
    citeParas.forEach(P => eachMatch(/\b(Sections?)\s+((?:\d{1,2}\.)*\d{1,2})(?![\d.]*\d)((?:\s*(?:,|and|&|–|-)\s*(?:\d{1,2}\.)*\d{1,2})*)/g, P.text, m => {
      if (P.role === 'heading') return;
      const nums = [m[2], ...(m[3].match(/(?:\d{1,2}\.)*\d{1,2}/g) || [])].map(x => x.replace(/\.$/, ''));
      const miss = nums.filter(x => !have.has(x));
      if (miss.length) add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.1', `อ้างถึง Section ${miss.join(', ')} แต่ไม่มีหัวข้อเลขนี้ในบทความ`, `Section ${miss.join(', ')} is cited but no heading has this number`, 'Headings: the decimal system of displayed headings should be used … When referring to a section, the number must match a heading; for an unnumbered section use “Section [Heading Name]”.');
    }));
  }
  // M2: equation numbers defined / cited / sequential
  {
    const eqDefs = [];
    blocks.forEach(b => {
      if (b.kind === 'tbl' && b.t.kind === 'equation') b.t.paras.forEach(P => { const m = textOf(P).match(/^\(([A-Z]?)(\d+)([a-z]?)\)$/); if (m && !P.hasMath) eqDefs.push({ P, pre: m[1], n: Number(m[2]), sub: m[3] }); });
      else if (b.kind === 'p' && b.p.role === 'equation_para') { const m = textOf(b.p).match(/\(([A-Z]?)(\d+)([a-z]?)\)\s*$/); if (m) eqDefs.push({ P: b.p, pre: m[1], n: Number(m[2]), sub: m[3] }); }
    });
    const mainEq = eqDefs.filter(d => !d.pre);
    let expect = 1;
    mainEq.forEach(d => { if (d.sub && d.n === expect - 1) return; if (d.n !== expect) add(d.P, null, null, 'error', 'figtab', '6.4', `เลขสมการไม่ต่อเนื่อง: พบ (${d.n}${d.sub}) ควรเป็น (${expect})`, `Equation numbers are not sequential: found (${d.n}${d.sub}), expected (${expect})`, 'If the equation is cited in the main text, it should be labeled with an Arabic number with parentheses, e.g., Equation (1), Equation (2).'); expect = d.n + 1; });
    if (eqDefs.length) {
      const have = new Set(eqDefs.map(d => d.pre + d.n));
      citeParas.forEach(P => eachMatch(/\bEquations?\s*\(([A-Z]?\d+)[a-z]?\)((?:\s*(?:,|and|&|or|–|-)\s*\(?[A-Z]?\d+[a-z]?\)?)*)/g, P.text, m => {
        const ids = [m[1], ...(m[2].match(/[A-Z]?\d+/g) || [])];
        const rng = /[–-]/.test(m[2]) && ids.length === 2 ? Array.from({ length: Math.max(0, Number(ids[1].replace(/\D/g, '')) - Number(ids[0].replace(/\D/g, '')) + 1) }, (_, q) => ids[0].replace(/\d+/, '') + (Number(ids[0].replace(/\D/g, '')) + q)) : ids;
        const miss = rng.filter(x => !have.has(x));
        if (miss.length && miss.length <= 20) add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.4', `อ้างถึง Equation (${miss.join('), (')}) แต่ไม่พบสมการเลขนี้`, `Equation (${miss.join('), (')}) is cited but no equation has this number`, 'If the equation is cited in the main text, it should be labeled with an Arabic number with parentheses, e.g., Equation (1), Equation (2).');
      }));
    }
  }
  // M4: Algorithm / Listing / Box captions numbered and cited
  {
    const KINDS = { Algorithm: /^Algorithms?$/, Listing: /^Listings?$/, Box: /^(Box|Boxes)$/ };
    for (const kind of Object.keys(KINDS)) {
      const caps = [];
      paras.forEach(P => { if (P.empty || P.role === 'ref' || P.role === 'refs_heading') return; const [s0] = trimRange(P); const m = P.text.slice(s0).match(new RegExp(`^${kind}\\s+(A?)(\\d+)(\\s*[.:]?)\\s+\\S`)); if (m && P.text.length < 400 && (allFmt(P, s0, s0 + kind.length, f => f.b) || P.inTable)) caps.push({ P, pre: m[1], n: Number(m[2]), sep: m[3].trim(), s0 }); });
      if (!caps.length) continue;
      const main = caps.filter(c => !c.pre);
      main.forEach((c, ix) => { if (c.n !== ix + 1) add(c.P, null, null, 'error', 'figtab', kind === 'Algorithm' ? '6.6' : kind === 'Listing' ? '6.7' : '6.8', `ลำดับ ${kind} ไม่ต่อเนื่อง: พบ ${kind} ${c.n} ควรเป็น ${kind} ${ix + 1}`, `${kind}s are not numbered sequentially: found ${kind} ${c.n}, expected ${kind} ${ix + 1}`, `Each ${kind} should be indicated with continuous numbers and cited in the main text.`); });
      const seps = new Set(caps.map(c => c.sep));
      if (seps.size > 1) add(caps[0].P, null, null, 'error', 'figtab', kind === 'Algorithm' ? '6.6' : '6.7', `รูปแบบคำบรรยาย ${kind} ไม่เหมือนกันทั้งบทความ (พบ ${[...seps].map(x => `“${kind} 1${x}”`).join(', ')}) — ใช้แบบเดียว`, `${kind} captions are not unified (found ${[...seps].map(x => `“${kind} 1${x}”`).join(', ')}) — use one format`, `Caption: “${kind} 1 xxx”, “${kind} 1. xxx” or “${kind} 1: xxx”. The format should be unified throughout the text.`);
      const cited = new Set();
      citeParas.concat(paras.filter(P => P.role === 'list')).forEach(P => eachMatch(new RegExp(`\\b(${kind}s?|${kind === 'Box' ? 'Boxes' : kind + 's'})\\s+(A?\\d+(?:\\s*(?:,|and|&|or|–|-)\\s*A?\\d+)*)`, 'g'), P.text, m => { if (caps.some(c => c.P === P && c.s0 === m.index)) return; listIds(m[2].replace(/A/g, ''), '').forEach(n => cited.add(n)); }));
      main.forEach(c => { if (!cited.has(c.n)) add(c.P, null, null, 'error', 'figtab', kind === 'Algorithm' ? '6.6' : kind === 'Listing' ? '6.7' : '6.8', `${kind} ${c.n} ไม่ถูกอ้างถึงในเนื้อหา`, `${kind} ${c.n} is not cited in the text`, `Each ${kind} should be indicated with continuous numbers and cited in the main text.`); });
    }
  }
  // M5: Supplementary items cited in the text vs listed in the Supplementary Materials section
  {
    const SRE = /\b(Figure|Table|Video|Movie|File|Dataset|Data Set|Algorithm|Scheme|Text|Audio|Document|Spreadsheet|Section|Method|Equation|Appendix|Note)s?\s+(S\d+[a-z]*(?:\s*(?:,|and|&|or|–|-)\s*S?\d+[a-z]*)*)/g;
    const norm = k => k.replace(/^Movie$/, 'Video').replace(/^Data Set$/, 'Dataset');
    const citedS = new Map(); // key -> {P,i,j,order}
    citeParas.forEach(P => eachMatch(SRE, P.text, m => listIds(m[2], 'S').forEach(n => { const key = norm(m[1]) + ' S' + n; if (!citedS.has(key)) citedS.set(key, { P, i: m.index, j: m.index + m[0].length, kind: norm(m[1]), n }); })));
    const suppParas = paras.filter(P => P.role === 'supp');
    const listed = [];
    suppParas.forEach(P => eachMatch(SRE, P.text, m => listIds(m[2], 'S').forEach(n => listed.push({ P, i: m.index, j: m.index + m[0].length, kind: norm(m[1]), n }))));
    const SMRULE = 'Supplementary Materials: Supplementary Materials should be cited. If there are citations of Supplemental Figures/Tables/Algorithms/Section in the text, “S” should be added before the number (i.e., Figure S1, Table S2, etc.), and “S” should also be added before the number for all items in the supplementary file.';
    if (citedS.size && !suppParas.length && refs.length) { const f = [...citedS.values()][0]; add(f.P, f.i, f.j, 'error', 'back', '7.1', 'อ้างถึงไฟล์เสริม (S) แต่ไม่พบส่วน “Supplementary Materials:” ท้ายบทความ', 'Supplementary items (S) are cited but there is no “Supplementary Materials:” section', SMRULE); }
    if (listed.length) {
      const lset = new Set(listed.map(x => x.kind + ' S' + x.n));
      citedS.forEach((f, key) => { if (!lset.has(key)) add(f.P, f.i, f.j, 'error', 'back', '7.1', `อ้างถึง ${key} แต่ไม่มีในส่วน Supplementary Materials`, `${key} is cited but not listed in the Supplementary Materials section`, SMRULE); });
      const seenL = new Set();
      listed.forEach(x => { const key = x.kind + ' S' + x.n; if (seenL.has(key)) return; seenL.add(key); if (!citedS.has(key) && citedS.size) add(x.P, x.i, x.j, 'check', 'back', '7.1', `${key} อยู่ในส่วน Supplementary Materials แต่ไม่ถูกอ้างถึงในเนื้อหา`, `${key} is listed in the Supplementary Materials but not cited in the text`, SMRULE); });
      // order inside the section: ascending per kind, kinds not interleaved
      const lastN = new Map(); const kindsSeen = []; let inter = null;
      listed.forEach(x => {
        if (lastN.has(x.kind) && x.n < lastN.get(x.kind)) add(x.P, x.i, x.j, 'error', 'back', '7.1', `ลำดับในส่วน Supplementary Materials ไม่ถูกต้อง: ${x.kind} S${x.n} อยู่หลัง ${x.kind} S${lastN.get(x.kind)}`, `Supplementary Materials order is wrong: ${x.kind} S${x.n} comes after ${x.kind} S${lastN.get(x.kind)}`, SMRULE);
        lastN.set(x.kind, Math.max(lastN.get(x.kind) || 0, x.n));
        if (kindsSeen.length && kindsSeen[kindsSeen.length - 1] !== x.kind && kindsSeen.includes(x.kind) && !inter) inter = x;
        if (kindsSeen[kindsSeen.length - 1] !== x.kind) kindsSeen.push(x.kind);
      });
      if (inter) add(inter.P, inter.i, inter.j, 'check', 'back', '7.1', `ส่วน Supplementary Materials เรียงสลับประเภทกัน (${inter.kind} S${inter.n} แทรกอยู่หลังประเภทอื่น) — ควรเรียงแต่ละประเภทให้ต่อเนื่องกัน`, `The Supplementary Materials list mixes item types (${inter.kind} S${inter.n} comes after another type) — keep each type together`, SMRULE);
    }
    // first citation order in the text per kind
    const byKind = new Map(); [...citedS.values()].sort((a, b) => a.P.idx - b.P.idx || a.i - b.i).forEach(f => { const mx = byKind.get(f.kind) || 0; if (f.n > mx + 1) add(f.P, f.i, f.j, 'error', 'cite', '7.1', `${f.kind} S${f.n} ถูกอ้างถึงครั้งแรกก่อน ${f.kind} S${mx + 1} — ต้องอ้างตามลำดับ`, `${f.kind} S${f.n} is first cited before ${f.kind} S${mx + 1} — cite them in sequence`, 'Figures/Tables should be numbered sequentially; the first mention … must be made in sequence (this also applies to Figure S1, Table S1, …).'); byKind.set(f.kind, Math.max(mx, f.n)); });
  }
  // M6: appendixes cited in the text; sub-headings Appendix A.1., A.2. in sequence
  {
    const apps = paras.filter(P => P.role === 'appendix_heading').map(P => { const m = textOf(P).match(/^Appendix\s+([A-Z])((?:\.\d+)*)(\.?)(\s|$)/); return m ? { P, L: m[1], sub: m[2] ? m[2].slice(1).split('.').map(Number) : [], dot: m[3], raw: m[0] } : null; }).filter(Boolean);
    const letters = [...new Set(apps.filter(a => !a.sub.length).map(a => a.L))];
    if (letters.length) {
      const citedL = new Set();
      citeParas.filter(P => !appendixMode(P) && P.role !== 'back').forEach(P => {
        eachMatch(/\bAppendix(?:es)?\s+([A-Z](?:(?:\.\d+)*)(?:\s*(?:,|and|&|–|-)\s*[A-Z](?:\.\d+)*)*)(?![\p{L}])/gu, P.text, m => (m[1].match(/[A-Z]/g) || []).forEach(x => citedL.add(x)));
        eachMatch(/\b(?:Figures?|Tables?|Equations?|Schemes?|Algorithms?)\s*\(?([A-H])\d+/g, P.text, m => citedL.add(m[1]));
      });
      letters.forEach(L => { if (!citedL.has(L)) { const a = apps.find(x => x.L === L && !x.sub.length); add(a.P, null, null, 'error', 'back', '7.11', `Appendix ${L} ไม่ถูกอ้างถึงในเนื้อหา`, `Appendix ${L} is not cited in the text`, 'Appendixes should be cited. An appendix’s Figures/Tables/Equations can be cited in the main text, but are not mandatory.'); } });
    }
    let curL = null; const cnt = [];
    apps.forEach(a => {
      if (!a.sub.length) { curL = a.L; cnt.length = 0; return; }
      const [s0] = trimRange(a.P);
      if (curL && a.L !== curL) add(a.P, s0, s0 + a.raw.trim().length, 'error', 'back', '7.11', `หัวข้อย่อยนี้อยู่ใต้ Appendix ${curL} แต่ใช้ตัวอักษร ${a.L}`, `This sub-heading is under Appendix ${curL} but uses the letter ${a.L}`, 'Sub-headings should be listed sequentially with the correct number (e.g., Appendix A.1., Appendix A.2.1., etc.).');
      const lvl = a.sub.length; const want = [...cnt.slice(0, lvl - 1), (cnt[lvl - 1] || 0) + 1];
      if (a.sub.some((v, q) => v !== want[q])) add(a.P, s0, s0 + a.raw.trim().length, 'error', 'back', '7.11', `เลขหัวข้อย่อยภาคผนวกไม่ต่อเนื่อง: พบ “Appendix ${a.L}.${a.sub.join('.')}.” ควรเป็น “Appendix ${a.L}.${want.join('.')}.”`, `Appendix sub-heading numbering is not sequential: found “Appendix ${a.L}.${a.sub.join('.')}.”, expected “Appendix ${a.L}.${want.join('.')}.”`, 'Sub-headings should be listed sequentially with the correct number (e.g., Appendix A.1., Appendix A.2.1., etc.).');
      else if (a.dot !== '.') add(a.P, s0, s0 + a.raw.trim().length, 'error', 'back', '7.11', `เลขหัวข้อย่อยภาคผนวกต้องลงท้ายด้วยจุด: “Appendix ${a.L}.${a.sub.join('.')}.”`, `Appendix sub-heading numbers end with a period: “Appendix ${a.L}.${a.sub.join('.')}.”`, 'Sub-headings should be listed sequentially with the correct number (e.g., Appendix A.1., Appendix A.2.1., etc.).');
      a.sub.forEach((v, q) => { cnt[q] = v; }); cnt.length = lvl;
    });
  }
  // M8 / M13: table symbols explained in the footnote; blank columns
  for (const T of model.tables) {
    if (T.depth > 0 || T.kind !== 'data') continue;
    const cells = T.paras.filter(p => !p.empty && p.role === 'table_cell');
    if (!cells.length) continue;
    // footnote paragraphs right after the table
    let bi = -1; blocks.forEach((b, i) => { if (b.kind === 'tbl' && b.t === T) bi = i; });
    const foot = [];
    for (let k = bi + 1; k < blocks.length; k++) { const b = blocks[k]; if (b.kind !== 'p') break; if (b.p.empty) { if (foot.length) break; continue; } const r = b.p.role; if (r === 'table_footnote' || (foot.length && ['body', 'appendix_body'].includes(r) && (b.p.fmt(trimRange(b.p)[0]).size || 10) <= 9) || /foot|footer/i.test(sname(b.p))) foot.push(b.p); else break; }
    const ftxt = foot.map(p => p.text).join('\n');
    const stars = new Map(), syms = new Map(); let supLet = null;
    cells.forEach(P => {
      const t = P.text;
      eachMatch(/\*+/g, t, m => { if (P.fmt(m.index).math) return; if (/[\p{L}\d]/u.test(t[m.index - 1] || '') && /[\p{L}\d]/u.test(t[m.index + m[0].length] || '')) return; if (!stars.has(m[0].length)) stars.set(m[0].length, { P, i: m.index, n: m[0].length }); });
      eachMatch(/[†‡§¶#]+/g, t, m => { if (!syms.has(m[0])) syms.set(m[0], { P, i: m.index, n: m[0].length }); });
      if (!supLet) for (let i = 0; i < t.length; i++) if (/[a-zA-Z]/.test(t[i]) && P.fmt(i).vert === 'superscript' && !P.fmt(i).math && (i === 0 || !/[\p{L}]/u.test(t[i - 1]) || P.fmt(i - 1).vert === 'superscript') && /[\d\s)±]/.test(t[i - 1] || ' ')) { supLet = { P, i }; break; }
    });
    const fStars = new Set((ftxt.match(/\*+/g) || []).map(x => x.length));
    const RULE8 = 'Any special characters or icons in a table (e.g., *, **, #, …) need to have a corresponding explanation.';
    stars.forEach(s => { if (!fStars.has(s.n) && !/asterisk/i.test(ftxt)) add(s.P, s.i, s.i + s.n, 'error', 'figtab', '6.3', `สัญลักษณ์ “${'*'.repeat(s.n)}” ในตารางไม่มีคำอธิบายใน footnote ใต้ตาราง`, `The “${'*'.repeat(s.n)}” in the table is not explained in a table footnote`, RULE8); });
    syms.forEach((s, k) => { if (!ftxt.includes(k)) add(s.P, s.i, s.i + s.n, 'error', 'figtab', '6.3', `สัญลักษณ์ “${k}” ในตารางไม่มีคำอธิบายใน footnote ใต้ตาราง`, `The “${k}” in the table is not explained in a table footnote`, RULE8); });
    if (supLet) { const fHasLet = foot.some(p => [...p.text].some((c, i) => /[a-zA-Z]/.test(c) && p.fmt(i).vert === 'superscript')) || /letters?/i.test(ftxt); if (!fHasLet) add(supLet.P, supLet.i, supLet.i + 1, 'error', 'figtab', '6.3', 'ตัวอักษรตัวยกในตาราง (a, b, c …) ไม่มีคำอธิบายใน footnote ใต้ตาราง', 'The superscript letters in the table (a, b, c …) are not explained in a table footnote', RULE8); }
    if (foot.length) {
      const tStars = new Set(stars.keys());
      [...fStars].filter(n => !tStars.has(n)).forEach(n => { const P = foot.find(p => p.text.includes('*'.repeat(n))); const i = P.text.search(new RegExp(`(?<!\\*)\\*{${n}}(?!\\*)`)); if (i >= 0) add(P, i, i + n, 'check', 'figtab', '6.3', `Footnote อธิบาย “${'*'.repeat(n)}” แต่ไม่พบสัญลักษณ์นี้ในตาราง`, `The footnote explains “${'*'.repeat(n)}” but the table does not use it`, RULE8); });
      eachMatch(/[†‡§¶#]+/g, ftxt, m => { if (!syms.has(m[0]) && !cells.some(p => p.text.includes(m[0]))) { const P = foot.find(p => p.text.includes(m[0])); const i = P.text.indexOf(m[0]); add(P, i, i + m[0].length, 'check', 'figtab', '6.3', `Footnote อธิบาย “${m[0]}” แต่ไม่พบสัญลักษณ์นี้ในตาราง`, `The footnote explains “${m[0]}” but the table does not use it`, RULE8); } });
    }
    // blank columns
    const w = T.rows.length ? T.rows[0].length : 0;
    if (w > 1 && T.rows.length > 1 && T.rows.every(r => r.length === w)) for (let c = 0; c < w; c++) if (T.rows.every(r => r[c].paras.every(p => p.empty))) { add(cells[0], null, null, 'check', 'figtab', '6.3', `ตารางมีคอลัมน์ว่าง (คอลัมน์ที่ ${c + 1}) — ไม่แนะนำ`, `The table has a blank column (column ${c + 1}) — not advisable`, 'Vertical lines, blank rows, and columns are not advisable.'); break; }
  }
  // M14 / M15: no citations inside equations; numbers in equations not italic
  paras.filter(P => !P.empty && (P.role === 'equation_cell' || P.role === 'equation_para' || P.hasMath)).forEach(P => {
    const display = P.role === 'equation_cell' || P.role === 'equation_para';
    let reported14 = false, reported15 = false;
    P.chars.forEach((c, i) => {
      if (!c.math || !c.node) return;
      if (display && !reported14 && /\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/.test(c.mathText || '')) { reported14 = true; add(P, i, i + 1, 'error', 'figtab', '6.4', 'ห้ามมีเลขอ้างอิง [n] อยู่ในสมการ — ย้ายไปไว้ในเนื้อหา', 'No reference citations inside equations — move them to the text', 'No references citations are allowed in equations; move them to the main text.'); }
      if (!reported15) for (const r of c.node.getElementsByTagNameNS(MNS, 'r')) {
        const tx0 = [...r.getElementsByTagNameNS(MNS, 't')].map(x => x.textContent).join('');
        if (!/\d/.test(tx0)) continue;
        const sty = r.getElementsByTagNameNS(MNS, 'sty')[0]; const sv = sty ? sty.getAttributeNS(MNS, 'val') : null;
        const wI = [...r.getElementsByTagNameNS(W, 'i')].some(x => wa(x, 'val') !== '0' && wa(x, 'val') !== 'false');
        if (sv === 'i' || sv === 'bi' || (wI && r.getElementsByTagNameNS(MNS, 'nor').length)) { reported15 = true; add(P, i, i + 1, 'error', 'figtab', '6.4', `ตัวเลขในสมการห้ามเป็นตัวเอียง (พบ “${tx0.slice(0, 20)}”)`, `Numbers in an equation must not be italic (found “${tx0.slice(0, 20)}”)`, 'The format of each character in an Equation should be consistent with that in the main text; numbers in an Equation should not be in italics.'); break; }
      }
    });
    if (display) {
      const tt = P.text;
      if (!reported14) eachMatch(/\[\d+(?:[,–-]\d+)*\]/g, tt, m => { if (!P.fmt(m.index).math) add(P, m.index, m.index + m[0].length, 'error', 'figtab', '6.4', 'ห้ามมีเลขอ้างอิง [n] อยู่ในสมการ — ย้ายไปไว้ในเนื้อหา', 'No reference citations inside equations — move them to the text', 'No references citations are allowed in equations; move them to the main text.'); });
      if (!reported15 && !/^\s*\([A-Z]?\d+[a-z]?\)\s*$/.test(tt)) for (let i = 0; i < tt.length; i++) if (/\d/.test(tt[i]) && P.chars[i].r && !P.fmt(i).math && P.fmt(i).i) { add(P, i, i + 1, 'error', 'figtab', '6.4', 'ตัวเลขในสมการห้ามเป็นตัวเอียง', 'Numbers in an equation must not be italic', 'Numbers in an Equation should not be in italics.'); break; }
    }
  });
  // M16 / M17: theorem-like objects and proofs
  {
    const TH = /^(Theorem|Lemma|Proposition|Corollary|Definition|Remark|Example|Conjecture|Axiom|Assumption|Property|Claim|Problem|Notation)\s+(\d+)(\s*\([^)]{1,80}\))?(\s*)([.:]?)/;
    const seqN = new Map();
    const bodyLike = paras.filter(P => !P.empty && ['body', 'appendix_body', 'list', 'quote'].includes(P.role));
    bodyLike.forEach((P, ix) => {
      const [s0, e0] = trimRange(P); const t = P.text;
      const m = t.slice(s0).match(TH);
      if (m) {
        const labelB = allFmt(P, s0, s0 + m[1].length + 1 + m[2].length, f => f.b);
        if (!labelB && m[5] !== '.') return; // ordinary sentence (“Theorem 2 shows …”)
        const kind = m[1], n = Number(m[2]); const lEnd = s0 + m[0].length;
        const R16 = 'Theorem X. Text. The text should be in italics; Theorem X. should be in bold, not italics, and followed by a full stop. Numbering should be continuous. Examples, Propositions, Lemmas, Definitions or Remarks can be formatted in the same way, but should be numbered independently.';
        if (!labelB) add(P, s0, lEnd, 'error', 'math', '6.5', `“${kind} ${n}.” ต้องเป็นตัวหนา`, `“${kind} ${n}.” must be bold`, R16);
        if (fracFmt(P, s0, s0 + kind.length, f => f.i) > 0.5) add(P, s0, lEnd, 'error', 'math', '6.5', `“${kind} ${n}.” ต้องไม่เป็นตัวเอียง`, `“${kind} ${n}.” must not be italic`, R16);
        if (m[5] !== '.') add(P, s0, lEnd, 'error', 'math', '6.5', `ต้องมีจุดตามหลัง “${kind} ${n}${m[3] || ''}.”`, `A full stop must follow “${kind} ${n}${m[3] || ''}.”`, R16);
        const last = seqN.get(kind) || 0;
        if (n !== last + 1) add(P, s0, lEnd, 'error', 'math', '6.5', `ลำดับ ${kind} ไม่ต่อเนื่อง: พบ ${kind} ${n} ควรเป็น ${kind} ${last + 1}`, `${kind}s are not numbered continuously: found ${kind} ${n}, expected ${kind} ${last + 1}`, R16);
        seqN.set(kind, Math.max(last, n));
        if (/^(Theorem|Lemma|Proposition|Corollary|Conjecture)$/.test(kind)) { const fi = fracFmt(P, lEnd, e0, f => f.i || f.math, ch => /[\p{L}]/u.test(ch)); if (fi != null && fi < 0.6) add(P, lEnd, e0, 'error', 'math', '6.5', `ข้อความของ ${kind} ต้องเป็นตัวเอียง`, `The text of a ${kind} must be italic`, R16); }
        return;
      }
      const pm = t.slice(s0).match(/^Proof(\s+of\s+[^.]{1,60})?\s*\.?/);
      if (pm && (allFmt(P, s0, s0 + 5, f => f.b || f.i) || /^Proof\./.test(t.slice(s0)))) {
        const R17 = 'Proof (of [Type Number] optional). Text. □ — The box at the end, signifying QED, is the Unicode symbol 25A1. The text should not be in italics.';
        const fi = fracFmt(P, s0 + pm[0].length, e0, f => f.i, ch => /[\p{L}]/u.test(ch));
        if (fi != null && fi > 0.6) add(P, s0 + pm[0].length, e0, 'error', 'math', '6.5', 'ข้อความใน Proof ต้องไม่เป็นตัวเอียง', 'The text of a Proof must not be italic', R17);
        let endP = null;
        for (let k = ix; k < Math.min(bodyLike.length, ix + 25); k++) { const Q = bodyLike[k]; if (k > ix && TH.test(textOf(Q))) break; if (/[□∎■▪◻☐]\s*$/.test(textOf(Q))) { endP = Q; break; } }
        if (!endP) add(P, s0, s0 + pm[0].length, 'error', 'math', '6.5', 'Proof ต้องจบด้วยสัญลักษณ์ “□” (U+25A1)', 'A Proof must end with “□” (U+25A1)', R17);
        else if (!/□\s*$/.test(textOf(endP))) { const [, e1] = trimRange(endP); add(endP, e1 - 1, e1, 'error', 'math', '6.5', 'สัญลักษณ์จบ Proof ต้องเป็น “□” (U+25A1)', 'The end-of-proof mark must be “□” (U+25A1)', R17); }
      }
    });
  }
  // M33: duplicate headings
  {
    const seenH = new Map();
    heads.forEach(P => {
      const h = P.head; const title = textOf(P).replace(/^((?:\d{1,2}\.)*\d{1,2})\.?\s+/, '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!title || title.length < 3) return;
      const parent = h.numbered && h.numStr ? h.numStr.split('.').slice(0, -1).join('.') : '?';
      const prev = seenH.get(title);
      if (prev) {
        const sib = prev.lvl === h.lvl && prev.parent === parent && parent !== '?';
        add(P, null, null, sib ? 'error' : 'check', 'heading', '6.1', sib ? `หัวข้อซ้ำกับหัวข้อก่อนหน้า (“${textOf(prev.P).slice(0, 60)}”) ภายใต้หัวข้อแม่เดียวกัน` : `ควรตรวจสอบ: ชื่อหัวข้อซ้ำกับ “${textOf(prev.P).slice(0, 60)}”`, sib ? `Duplicate heading — same title as “${textOf(prev.P).slice(0, 60)}” under the same parent` : `Check: this heading repeats “${textOf(prev.P).slice(0, 60)}”`, 'Headings: the decimal system of displayed headings should be used to indicate the hierarchy of sections of text (each heading should be distinct).');
      } else seenH.set(title, { P, lvl: h.lvl, parent });
    });
  }
  // M34: Notes (journals that allow them): callouts in order, no space before, not in title/abstract, one number per position
  {
    const hasNotes = paras.some(P => P.role === 'refs_heading' && /Notes?/i.test(textOf(P))) || paras.some(P => !P.inTable && /^Notes$/.test(textOf(P)));
    if (hasNotes) {
      const RN = 'Notes: Number all Notes consecutively in the order in which their callouts appear in the text with superscript Arabic numerals. Do not put a space before the Note number in the text. Do not place Note callouts in the article title, among the authors, or in the abstract. Avoid using multiple Note numbers in one position (e.g., 5,6).';
      let mx = 0;
      paras.filter(P => !P.empty && ['body', 'appendix_body', 'list', 'quote', 'title', 'abstract_body', 'heading'].includes(P.role)).forEach(P => {
        const t = P.text;
        for (let i = 0; i < t.length; i++) {
          if (!/\d/.test(t[i]) || P.fmt(i).vert !== 'superscript' || P.fmt(i).math) continue;
          let j = i; while (j < t.length && /[\d,–-]/.test(t[j]) && P.fmt(j).vert === 'superscript') j++;
          const prev = t[i - 1] || '';
          const prevTok = (t.slice(0, i).match(/(\S+)\s*$/) || ['', ''])[1];
          if (/[A-Z]$/.test(prevTok) || /[\d−⁻+]$/.test(prevTok) || /(cm|mm|m|km|s|g|L|mol|h|min|Hz|K|ha)$/.test(prevTok) || /\d/.test(prevTok)) { i = j; continue; }
          if (!/[\p{Ll}.,;:)”’"\]]/u.test(prev) && prev !== ' ') { i = j; continue; }
          const seg = t.slice(i, j);
          if (P.role === 'title' || P.role === 'abstract_body') add(P, i, j, 'error', 'text', '6.1', 'ห้ามใส่เลข Note ในชื่อเรื่องหรือบทคัดย่อ', 'No Note callouts in the title or abstract', RN);
          if (prev === ' ') add(P, i - 1, j, 'error', 'text', '6.1', 'ห้ามเว้นวรรคหน้าเลข Note', 'No space before a Note number', RN);
          if (/[,–-]/.test(seg)) add(P, i, j, 'error', 'text', '6.1', `ใส่เลข Note ได้เลขเดียวต่อตำแหน่ง (พบ “${seg}”) — รวมเป็น Note เดียว`, `Use one Note number per position (found “${seg}”) — merge them into one Note`, RN);
          const n = Number(seg.match(/\d+/)[0]);
          if (n > mx + 1) add(P, i, j, 'error', 'text', '6.1', `เลข Note ไม่เรียงตามลำดับที่ปรากฏ: พบ ${n} ก่อน ${mx + 1}`, `Note numbers are not in order of appearance: ${n} appears before ${mx + 1}`, RN);
          mx = Math.max(mx, n); i = j;
        }
      });
    }
  }
  // M35: initials in Author Contributions match the author list
  if (contrib && authorsP) {
    const raw = [...authorsP.text].map((c, i) => authorsP.fmt(i).vert === 'superscript' ? ' ' : c).join('').replace(/[*†‡§¶‖#]/g, ' ').replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    const names = raw.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).map(x => x.trim()).filter(x => /\p{L}{2,}/u.test(x) && !/^on behalf/i.test(x));
    const initialsOf = name => {
      const parts = name.replace(/,\s*(Jr|Sr)\.?$/, ' $1.').split(/\s+/).filter(Boolean);
      let simple = true;
      const out = parts.map(w => {
        if (/^(II|III|IV)$/.test(w)) return w;
        if (/^(Jr|Sr)\.?$/.test(w)) return w[0] + '.';
        if (/^(de|van|von|der|den|di|da|del|du|le|la|e|te|dos|das)$/.test(w)) return w[0] + '.';
        if (/[’']/.test(w) || !/^[\p{Lu}]/u.test(w)) simple = false;
        return w.split('-').map(x => (x.match(/\p{L}/u) || [''])[0].toUpperCase() + '.').join('-');
      }).join('');
      return { ini: out, simple };
    };
    const auth = names.map(n => ({ n, ...initialsOf(n) }));
    if (auth.length > 1 && auth.every(a => a.ini.length >= 2)) {
      const all = bodyOf('contrib'); const txt = all.map(x => x.t).join(' ');
      const toks = [];
      all.forEach(({ P, t }) => eachMatch(/(?<![\p{L}.’'-])((?:[\p{L}][\p{Ll}]?\.|-[\p{L}]\.|[’'‘][\p{L}]+\.|II|III|IV)+)(\s*\([^)]{2,60}\))?(?=[\s,;.)]|$)/gu, t, m => { if (/^(e\.g\.|i\.e\.|et\.|al\.|vs\.)$/i.test(m[1]) || (m[1].match(/\./g) || []).length < 2) return; toks.push({ P, i: m.index, n: m[1].length, ini: m[1], full: m[2] }); }));
      if (toks.length >= 2) {
        const R35 = 'Author Contributions: each author’s contribution should be mentioned, and all author names should be abbreviated correctly. If the initial letters for two authors are the same, put the full name after the abbreviated name, in parentheses, e.g., H.Z. (Huarui Zhang), H.Z. (Hu Zhang).';
        const known = new Set(auth.map(a => a.ini));
        const used = new Set(toks.map(t => t.ini));
        auth.forEach(a => { if (!used.has(a.ini)) add(contrib.P, null, null, a.simple ? 'error' : 'check', 'back', '7.2', `ไม่พบอักษรย่อ “${a.ini}” (${a.n}) ใน Author Contributions`, `The initials “${a.ini}” (${a.n}) do not appear in Author Contributions`, R35); });
        const flagged = new Set();
        toks.forEach(t => { if (!known.has(t.ini) && !flagged.has(t.ini)) { flagged.add(t.ini); add(t.P, t.i, t.i + t.n, auth.every(a => a.simple) ? 'error' : 'check', 'back', '7.2', `อักษรย่อ “${t.ini}” ไม่ตรงกับชื่อผู้แต่งคนใด (ผู้แต่ง: ${auth.map(a => a.ini).join(', ')})`, `The initials “${t.ini}” match no author (authors: ${auth.map(a => a.ini).join(', ')})`, R35); } });
        const dup = auth.filter(a => auth.filter(b => b.ini === a.ini).length > 1);
        if (dup.length) { const t = toks.find(x => x.ini === dup[0].ini && !x.full); if (t) add(t.P, t.i, t.i + t.n, 'error', 'back', '7.2', `ผู้แต่งมีอักษรย่อ “${dup[0].ini}” ซ้ำกัน ต้องใส่ชื่อเต็มในวงเล็บ เช่น “${dup[0].ini} (${dup[0].n})”`, `Two authors share the initials “${dup[0].ini}”; add the full name in parentheses, e.g., “${dup[0].ini} (${dup[0].n})”`, R35); }
      }
    }
  }
  // M36 / M37: Acknowledgments
  {
    const ack = bodyOf('ack');
    ack.forEach(({ P, t }) => eachMatch(/\b(Editage|American Journal Experts|AJE|Enago|MDPI English Editing|English Editing (?:Service|Services) (?:of|from|at) MDPI|MDPI Author Services|Author Services of MDPI|Scribendi|LetPub|Charlesworth(?: Author Services)?|Proof-?Reading-?Service(?:\.com)?|Cambridge Proofreading|Wiley Editing Services|Springer Nature Author Services|Elsevier (?:Language|Author) (?:Editing )?Services?|International Science Editing|Bioedit|Textcheck|Edanz|Write Science Right|PaperTrue|Proofed|Grammarly)\b/g, t, m => add(P, m.index, m.index + m[0].length, 'error', 'back', '7.8', `ห้ามระบุชื่อบริษัทแก้ภาษา “${m[0]}” ใน Acknowledgments`, `Commercial English-editing organizations (“${m[0]}”) cannot appear in the Acknowledgments`, 'Commercial English editing organizations or MDPI internal editor names cannot appear in this part.')));
    const nz = s => s.replace(/^\s*(Acknowledge?ments?|Funding)\s*:?\s*/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const a = nz(ack.map(x => x.t).join(' ')), f = nz(backText('funding'));
    if (a.length > 40 && f.length > 40 && (a === f || (a.includes(f) && f.length / a.length > 0.9) || (f.includes(a) && a.length / f.length > 0.9))) { const ap = ack[0].P; add(ap, null, null, 'error', 'back', '7.8', 'ข้อความ Acknowledgments ซ้ำกับ Funding — ต้องไม่เหมือนกัน', 'The Acknowledgments repeat the Funding statement — they must not be the same', 'The content in the Acknowledgments section should not be exactly the same as that in the Funding section.'); }
  }

  /* ---------- 10c. v17 tier-B checks (“ควรตรวจสอบ”) and X1/X3/X6 ---------- */
  {
    const CK = 'check';
    const bodyRoles = new Set(['body', 'appendix_body', 'list', 'quote', 'table_footnote', 'fig_caption', 'tab_caption', 'abstract_body']);
    const bodyPs = paras.filter(P => !P.empty && bodyRoles.has(P.role));
    // heading typed in a non-heading MDPI style (e.g. “4. Discussion” in MDPI_3.7_itemize)
    if (paras.some(P => P.role === 'heading' && /mdpi_2\.\d_heading/i.test(P.styleName || ''))) paras.filter(P => P.role === 'heading' && P.head && P.head.numbered && /^mdpi_/i.test(P.styleName || '') && !/heading/i.test(P.styleName || '')).forEach((P, i, arr) => {
      if (arr.length > 2) { if (i === 0) add(P, null, null, CK, 'heading', '6.1', `ควรตรวจสอบ: หัวข้อ ${arr.length} หัวข้อใช้สไตล์เนื้อหา (เช่น “${P.styleName}”) แทนสไตล์หัวข้อ MDPI_2.x_heading — ${arr.slice(0, 6).map(x => x.head.numStr || textOf(x).slice(0, 12)).join(', ')}${arr.length > 6 ? ', …' : ''}`, `Check: ${arr.length} headings use a body style (e.g., “${P.styleName}”) instead of the MDPI_2.x_heading styles`, 'Headings: use the template heading styles (MDPI_2.1_heading1, MDPI_2.2_heading2, MDPI_2.3_heading3).'); return; }
      const want = P.head.lvl === 1 ? 'MDPI_2.1_heading1' : P.head.lvl === 2 ? 'MDPI_2.2_heading2' : 'MDPI_2.3_heading3';
      add(P, null, null, CK, 'heading', '6.1', `ควรตรวจสอบ: หัวข้อนี้ใช้สไตล์ “${P.styleName}” — ควรใช้สไตล์หัวข้อ “${want}”`, `Check: this heading uses the style “${P.styleName}” — use the heading style “${want}”`, 'Headings: use the template heading styles (MDPI_2.1_heading1, MDPI_2.2_heading2, MDPI_2.3_heading3).');
    });
    /* ---------- v20: checks learned from the jmse / plants / sports copy-editing files ---------- */
    {
      const mainPs = paras.filter(P => !P.empty && mainRoles.has(P.role) && P.role !== 'ref');
      const bodyLike = paras.filter(P => !P.empty && ['body', 'appendix_body', 'list', 'quote', 'abstract_body', 'abstract_mixed'].includes(P.role));
      const capPs = paras.filter(P => !P.empty && ['fig_caption', 'tab_caption'].includes(P.role));
      const notMath = (P, i) => !P.fmt(i).math;
      const dataTables = model.tables.filter(T => T.depth === 0 && T.kind === 'data' && T.zone !== 'front');
      const cellText = c => c.paras.map(p => p.text).join(' ').trim();
      const footOf = T => { const P0 = T.paras.find(p => !p.empty); const bi = P0 ? blockIndexOfPara.get(P0) : -1; const out = []; for (let k = bi + 1; k < blocks.length; k++) { const b = blocks[k]; if (b.kind !== 'p') break; if (b.p.empty) continue; if (b.p.role !== 'table_footnote') break; out.push(b.p); } return out; };

      // (1) second header row (under merged header cells) must be bold too
      dataTables.forEach(T => {
        if (T.rows.length < 3) return;
        const merged = T.rows[0].some(c => { const tp = kid(c.el, 'tcPr'); return tp && ((Number(wa(kid(tp, 'gridSpan'), 'val')) || 1) > 1 || kid(tp, 'vMerge')); });
        if (!merged) return;
        const r1 = T.rows[1].flatMap(c => c.paras).filter(p => !p.empty);
        if (!r1.length || r1.some(p => /^[−\-–+]?\d[\d.,]*%?$/.test(textOf(p)))) return;
        const r0b = T.rows[0].flatMap(c => c.paras).filter(p => !p.empty).every(p => { const [s, e] = trimRange(p); return allFmt(p, s, e, f => f.b); });
        const bad = r1.filter(p => { const [s, e] = trimRange(p); return !allFmt(p, s, e, f => f.b || f.math); });
        if (r0b && bad.length) add(bad[0], null, null, 'error', 'figtab', '6.3', 'แถวหัวตารางแถวที่ 2 (ใต้หัวที่ผสานเซลล์) ต้องเป็นตัวหนาด้วย', 'The second header row (under the merged header cells) must be bold too', 'The table header should be in bold face and capitalized all initial letters of substantives.');
      });

      // (3) non-standard unit symbols
      mainPs.forEach(P => {
        const t = P.text;
        eachMatch(/(?:(\d)\s?|\(\s*|\[\s*)(secs?|hrs?|mins|msec)(?=\s*[)\]]|\b)/g, t, m => { const u = m[2]; const s = m.index + m[0].length - u.length; const want = { sec: 's', secs: 's', hr: 'h', hrs: 'h', mins: 'min', msec: 'ms' }[u]; add(P, s, s + u.length, 'error', 'unit', '6.1', `สัญลักษณ์หน่วยไม่ถูกต้อง: “${u}” → “${want}”`, `Wrong unit symbol: “${u}” → “${want}”`, 'Units: use SI symbols (s, min, h, ms).'); });
        eachMatch(/(?<![\p{L}])(Kg|KG)(?![\p{L}])/gu, t, m => { if (!m.index || /[.!?]\s+$/.test(t.slice(0, m.index))) return; add(P, m.index, m.index + 2, 'error', 'unit', '6.1', `สัญลักษณ์หน่วยต้องเป็น “kg” (ไม่ใช่ “${m[1]}”)`, `The unit symbol is “kg”, not “${m[1]}”`, 'Units: use the correct case for SI symbols.'); });
      });

      // (4) colored text, highlight and strikethrough outside tables (yellow highlight is the editor’s own marking and is ignored)
      {
        const hits = { strike: [], color: [], hl: [] };
        paras.forEach(P => {
          if (P.empty || P.inTable || P.inBox || P.role === 'ref' || ['title', 'running', 'front_other', 'frontnote'].includes(P.role)) return;
          const got = {};
          for (let i = 0; i < P.text.length; i++) {
            if (!/\S/.test(P.text[i]) || !P.chars[i] || !P.chars[i].r) continue;
            const f = P.fmt(i); if (f.math) continue;
            if (f.strike && !got.strike) got.strike = i;
            if (f.color && /^[0-9A-F]{6}$/i.test(f.color) && Math.max(...[0, 2, 4].map(k => parseInt(f.color.slice(k, k + 2), 16))) > 0x50 && !f.rStyle && !/^https?:|www\.|@/.test(P.text.slice(Math.max(0, i - 40), i + 40)) && got.color == null) got.color = i;
            if (f.hl && f.hl !== 'yellow' && got.hl == null) got.hl = i;
          }
          for (const k in got) { let j = got[k]; while (j < P.text.length && (k === 'strike' ? P.fmt(j).strike : k === 'hl' ? P.fmt(j).hl === P.fmt(got[k]).hl : P.fmt(j).color === P.fmt(got[k]).color)) j++; hits[k].push({ P, s: got[k], e: Math.max(j, got[k] + 1) }); }
        });
        const nm = { strike: ['ข้อความขีดฆ่า (strikethrough)', 'Strikethrough text'], color: ['ข้อความสี', 'Colored text'], hl: ['ไฮไลต์', 'Highlighted text'] };
        for (const k in hits) {
          const L = hits[k]; if (!L.length) continue;
          const th = `${nm[k][0]} — ต้องลบหรือเปลี่ยนเป็นข้อความปกติ (ถ้ามีความหมายต้องมีคำอธิบาย)`, en = `${nm[k][1]} — remove it or make it plain text (explain it if it carries meaning)`;
          if (L.length <= 8) L.forEach(h => add(h.P, h.s, h.e, k === 'strike' ? 'error' : 'check', 'text', '6.1', th, en, 'Text must be plain black; no strikethrough, colored text or highlighting.'));
          else add(L[0].P, L[0].s, L[0].e, k === 'strike' ? 'error' : 'check', 'text', '6.1', `${th} — พบทั้งหมด ${L.length} ย่อหน้า`, `${en} — found in ${L.length} paragraphs`, 'Text must be plain black; no strikethrough, colored text or highlighting.');
        }
      }

      // (5) citation used as a noun: “see [19,20]” → “see Refs. [19,20]”
      bodyLike.concat(capPs).forEach(P => eachMatch(/\b(see|See|cf\.|Cf\.)\s+(\[\d+(?:\s*[,–\-]\s*\d+)*\])/g, P.text, m => {
        const many = /[,–\-]/.test(m[2]); const s = m.index + m[1].length + 1;
        add(P, s, s + m[2].length, 'check', 'cite', '6.1', `ถ้าเลขอ้างอิงทำหน้าที่เป็นคำนามในประโยค ให้ใส่ “${many ? 'Refs.' : 'Ref.'}” นำหน้า: “${m[1]} ${many ? 'Refs.' : 'Ref.'} ${m[2]}”`, `When the citation acts as a noun, add “${many ? 'Refs.' : 'Ref.'}”: “${m[1]} ${many ? 'Refs.' : 'Ref.'} ${m[2]}”`, 'References: when a citation is part of the sentence, write “Ref. [1]” / “Refs. [1,2]”.');
      }));

      // (6) “supplementary …” mentioned but no Supplementary Materials section
      if (!paras.some(P => P.backKey === 'supp')) {
        const P = bodyLike.concat(capPs).find(P => /\bsupplementary\s+(tables?|figures?|files?|materials?|data|information)\b|\bTables?\s+S\d|\bFigures?\s+S\d/i.test(P.text));
        if (P) { const m = P.text.match(/\bsupplementary\s+(tables?|figures?|files?|materials?|data|information)\b|\bTables?\s+S\d+|\bFigures?\s+S\d+/i); add(P, m.index, m.index + m[0].length, 'check', 'back', '7.1', 'มีการอ้างถึงไฟล์เสริม (supplementary) แต่ไม่พบส่วน “Supplementary Materials” — ถ้าหมายถึงตารางใน Appendix ให้อ้างเป็น “Table A1” แทน', 'Supplementary material is mentioned but there is no “Supplementary Materials” section — if it means tables in the Appendix, cite them as “Table A1”', 'Supplementary Materials: list every supplementary file in the Supplementary Materials section.'); }
      }

      // (7) caption cites a reference → reproduced material needs permission
      capPs.forEach(P => { const m = P.text.match(/\[\d+(?:\s*[,–\-]\s*\d+)*\]/); if (m && !/(Reprinted|Adapted|Reproduced)\b[^.]*permission|Copyright/i.test(P.text)) add(P, m.index, m.index + m[0].length, 'check', 'figtab', '6.2', 'คำบรรยายอ้างถึงเอกสารอื่น — ถ้ารูป/ตารางนำมาจากงานอื่น ต้องได้รับอนุญาตและเขียนว่า “Reprinted/adapted with permission from Ref. [X]. Copyright year, owner.”', 'The caption cites another work — if the figure/table is reproduced, permission is needed: “Reprinted/adapted with permission from Ref. [X]. Copyright year, owner.”', 'Copyright: reproduced figures/tables need permission and a credit line.'); });

      // (8) sub-tables (Table 1a / 1b) are not recommended
      {
        const P = bodyLike.concat(capPs).find(P => /\bTables?\s+\d+[a-h]\b/.test(P.text) || (P.role === 'tab_caption' && /^\s*Table\s+\d+\.\s*\(?[a-h][.)]/.test(P.text)));
        if (P) { const m = P.text.match(/\bTables?\s+\d+[a-h]\b/) || P.text.match(/^\s*Table\s+\d+\.\s*\(?[a-h][.)]/); add(P, m.index, m.index + m[0].length, 'check', 'figtab', '6.3', 'ไม่แนะนำตารางย่อย (Table 1a, 1b) — ให้แยกเป็นตารางคนละเลข หรือรวมเป็นตารางเดียว แล้วแก้การอ้างถึงตามนั้น', 'Sub-tables (Table 1a, 1b) are not recommended — split them into separately numbered tables or merge them, and update the citations', 'Tables: sub-tables are not recommended.'); }
      }

      // (9) extra empty paragraphs (Enter) inside cells, empty columns
      dataTables.forEach(T => {
        const P0 = T.paras.find(p => !p.empty); if (!P0) return;
        const extra = T.rows.some(r => r.some(c => c.paras.length > 1 && c.paras.some(p => !p.empty) && c.paras.some(p => p.empty)));
        if (extra) add(P0, null, null, 'check', 'figtab', '6.3', 'มีบรรทัดว่าง (Enter เกิน) ในเซลล์ของตาราง — ให้ลบออก', 'Some table cells contain extra empty lines (extra Enter) — remove them', 'Vertical lines, blank rows, and columns are not advisable.');
        const n = T.rows[0] ? T.rows[0].length : 0;
        if (n > 1 && T.rows.every(r => r.length === n)) for (let j = 0; j < n; j++) if (T.rows.slice(1).every(r => !cellText(r[j])) && T.rows.length > 2) { add(P0, null, null, 'check', 'figtab', '6.3', 'ตารางมีคอลัมน์ว่าง — ไม่แนะนำ', 'The table has an empty column — not advisable', 'Vertical lines, blank rows, and columns are not advisable.'); break; }
      });

      // (11) “*” or “.” used as a multiplication sign between units → “·”
      mainPs.forEach(P => {
        const U = '(?:kg|g|mg|μg|µg|m|cm|mm|km|N|kN|mol|mmol|L|mL|s|min|h|W|kW|J|kJ|Pa|kPa|MPa|V|A)';
        eachMatch(new RegExp(`(?<![\\p{L}])${U}(\\*|\\.)${U}(?:[-−⁻]?\\d)?(?![\\p{L}])`, 'gu'), P.text, m => {
          const k = m.index + m[0].indexOf(m[1]); if (m[1] === '.' && !/[-−⁻\d\/]/.test(P.text.slice(k + 1, k + 6)) && !/^(mg|g|mol|μg|µg)\.L/.test(m[0])) return;
          add(P, k, k + 1, 'error', 'unit', '6.1', `ใช้จุดกึ่งกลาง “·” เป็นเครื่องหมายคูณระหว่างหน่วย (ไม่ใช่ “${m[1]}”): “${m[0].replace(m[1], '·')}”`, `Use a centered dot “·” between units, not “${m[1]}”: “${m[0].replace(m[1], '·')}”`, 'Units: use a centered dot (·) or a space between unit symbols.');
        });
      });

      // (12) em dash used as a minus/range between numbers; lone dashes in table cells need an explanation
      mainPs.forEach(P => eachMatch(/(\d)\s?—\s?(?=\d)|(?<![\p{L}\d])—(?=\d)/gu, P.text, m => { const k = m.index + m[0].indexOf('—'); add(P, k, k + 1, 'error', 'text', '6.1', 'em dash “—” ใช้กับตัวเลขไม่ได้ — ช่วงตัวเลขใช้ en dash “–” ส่วนค่าลบใช้เครื่องหมายลบ “−”', 'An em dash “—” cannot be used with numbers — use an en dash “–” for ranges or a minus sign “−” for negative values', 'Dashes: en dash for ranges, minus sign for negative values.'); }));
      dataTables.forEach(T => {
        const dash = T.paras.find(p => /^[—–-]$/.test(textOf(p)) || /\d[—]$/.test(textOf(p))); if (!dash) return;
        const ft = footOf(T).map(p => p.text).join(' ');
        if (!/[—–-]\s*[:=,]|[—–-]\s+(indicates|means|denotes|not|no)\b|(not applicable|not available|not detected|n\.?a\.?|no data)/i.test(ft)) add(dash, null, null, 'check', 'figtab', '6.3', 'ตารางมีเครื่องหมาย “—” ในเซลล์ — ต้องมีคำอธิบายใต้ตาราง (เช่น — : not available) หรือถ้าเกินให้ลบ', 'The table has “—” in cells — explain it below the table (e.g., —: not available) or remove it if extra', 'Table footer: explain every symbol used in the table.');
      });

      // (14) Greek capitals that look like Latin letters (Τ for T, Α for A …)
      const GL = { 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X' };
      paras.forEach(P => {
        if (P.empty || !mainRoles.has(P.role)) return;
        eachMatch(/[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]/g, P.text, m => {
          const a = P.text[m.index - 1] || ' ', b = P.text[m.index + 1] || ' ';
          if (/[Ͱ-Ͽ]/.test(a) || /[Ͱ-Ͽ]/.test(b)) return; // real Greek word
          if (!notMath(P, m.index)) return;
          add(P, m.index, m.index + 1, 'error', 'text', '6.1', `ตัวนี้เป็นอักษรกรีก “${m[0]}” ที่หน้าตาเหมือนตัวอังกฤษ “${GL[m[0]]}” — ให้พิมพ์ใหม่เป็น “${GL[m[0]]}”`, `This is the Greek letter “${m[0]}”, which looks like the Latin “${GL[m[0]]}” — retype it as “${GL[m[0]]}”`, 'Use the correct characters.');
        });
      });

      // (15) geographic coordinates: ° ′ ″
      mainPs.forEach(P => eachMatch(/(\d{1,3})\s?([º°˚])\s?(\d{1,2})\s?(['’`´′])\s?(?:(\d{1,2}(?:[.,]\d+)?)\s?(["”″]|''|’’|′′)?)?\s?([NSEW])\b/g, P.text, m => {
        if (m[2] === '°' && m[4] === '′' && (!m[6] || m[6] === '″')) return;
        const want = `${m[1]}°${m[3]}′${m[5] ? m[5] + '″' : ''} ${m[7]}`;
        add(P, m.index, m.index + m[0].length, 'error', 'text', '6.1', `พิกัดต้องใช้ ° ′ ″ เช่น “${want}”`, `Coordinates use ° ′ ″, e.g., “${want}”`, 'Symbols: degrees °, minutes ′ (prime), seconds ″ (double prime).');
      }));

      // (16) “Not applicable” statements
      {
        const ack = paras.filter(P => P.backKey === 'ack' && !P.empty);
        const at = ack.map(P => P.text).join(' ').replace(/^\s*Acknowledge?ments?\s*:?\s*/i, '').trim();
        if (ack.length && /^(not applicable|none|n\/a|nil)\.?$/i.test(at)) add(ack[0], null, null, 'check', 'back', '7.8', 'Acknowledgments ที่เป็น “Not applicable”/ว่าง ให้ลบส่วนนี้ออกทั้งหมด', 'An Acknowledgments section that is “Not applicable” or empty should be removed', 'Acknowledgments: remove the section if there is nothing to acknowledge.');
        const da = paras.filter(P => P.backKey === 'data' && !P.empty);
        const dt = da.map(P => P.text).join(' ').replace(/^\s*Data\s+Availability(\s+Statement)?\s*:?\s*/i, '').trim();
        const theory = /\b(review|opinion|perspective|editorial|commentary)\b/i.test((paras.find(P => P.role === 'front_other' || P.role === 'title') || {}).text || '');
        if (da.length && /^(not applicable|n\/a)\.?$/i.test(dt) && !theory) add(da[0], null, null, 'check', 'back', '7.6', '“Not applicable” ใช้ได้เฉพาะงานที่ไม่มีข้อมูลใหม่ (เช่น review, งานทฤษฎี) — งานวิจัยต้องบอกว่าข้อมูลอยู่ที่ไหน เช่น “The data presented in this study are available on request from the corresponding author.”', '“Not applicable” is only for work with no new data (e.g., reviews, theoretical work) — state where the data are, e.g., “The data presented in this study are available on request from the corresponding author.”', 'Data Availability Statement.');
      }

      // (17) “+” marks in tables without an explanation
      dataTables.forEach(T => {
        const cells = T.paras.filter(p => !p.empty);
        const plus = cells.find(p => [...p.text].some((c, i) => c === '+' && (p.fmt(i).vert === 'superscript' || (/[\d)]/.test(p.text[i - 1] || '') && !/\d/.test(p.text[i + 1] || ''))) ) || textOf(p) === '+');
        if (!plus) return;
        const ft = footOf(T).map(p => p.text).join(' ');
        if (!ft.includes('+')) add(plus, plus.text.indexOf('+'), plus.text.indexOf('+') + 1, 'check', 'figtab', '6.3', 'ตารางมีสัญลักษณ์ “+” แต่ไม่มีคำอธิบายใต้ตาราง', 'The table uses “+” but it is not explained below the table', 'Table footer: explain every symbol used in the table.');
      });

      // (19) heading that repeats a caption
      {
        const capT = capPs.map(P => ({ P, t: textOf(P).replace(/^(Figure|Table|Scheme)\s+[A-Z]?\d+\.\s*/, '').replace(/[.\s]+$/, '').toLowerCase() })).filter(x => x.t.length >= 6);
        paras.filter(P => P.role === 'heading' && P.head).forEach(P => {
          const h = (P.head.title || textOf(P)).replace(/^\d+(\.\d+)*\.?\s*/, '').replace(/[.\s]+$/, '').toLowerCase(); if (h.length < 6) return;
          const c = capT.find(x => x.t === h); if (c) add(P, null, null, 'check', 'heading', '6.1', `ควรตรวจสอบ: ชื่อหัวข้อซ้ำกับคำบรรยาย “${textOf(c.P).slice(0, 40)}”`, `Check: this heading repeats the caption “${textOf(c.P).slice(0, 40)}”`, 'Headings should not duplicate captions.');
        });
      }

      // (20) data table with no header row / no top or bottom rule
      dataTables.forEach(T => {
        const P0 = T.paras.find(p => !p.empty); if (!P0 || T.rows.length < 2) return;
        const r0 = T.rows[0].map(cellText).filter(Boolean);
        if (r0.length >= 2 && r0.every(x => /^[−\-–+]?\d[\d.,]*\s*(%|±.*)?$/.test(x))) add(P0, null, null, 'check', 'figtab', '6.3', 'ควรตรวจสอบ: ตารางนี้ดูเหมือนไม่มีแถวหัวตาราง (แถวแรกเป็นตัวเลข)', 'Check: this table seems to have no header row (the first row is numbers)', 'The table header should be in bold face.');
        const on = b => b && !/^(nil|none)$/.test(wa(b, 'val') || '') && (wa(b, 'val') || '') !== '';
        const tb = kid(kid(T.el, 'tblPr'), 'tblBorders');
        const styled = kid(kid(T.el, 'tblPr'), 'tblStyle');
        const cellB = (row, side) => row.some(c => on(kid(kid(kid(c.el, 'tcPr'), 'tcBorders'), side)));
        const paraB = (row, side) => row.some(c => c.paras.some(p => on(kid(kid(kid(p.el || {}, 'pPr'), 'pBdr'), side))));
        const top = on(kid(tb, 'top')) || cellB(T.rows[0], 'top') || paraB(T.rows[0], 'top');
        const last = T.rows[T.rows.length - 1];
        const bot = on(kid(tb, 'bottom')) || cellB(last, 'bottom') || paraB(last, 'bottom');
        if (!styled && (!top || !bot)) add(P0, null, null, 'check', 'figtab', '6.3', `ตารางไม่มีเส้น${!top && !bot ? 'บนและล่าง' : !top ? 'บน' : 'ล่าง'} — ตารางแบบสามเส้นต้องมีเส้นบน ใต้หัวตาราง และล่างสุด`, `The table has no ${!top && !bot ? 'top and bottom' : !top ? 'top' : 'bottom'} rule — a three-line table needs top, header and bottom rules`, 'Preferred border form: A three-line table is preferred.');
      });

      // (21) figure/table placed before its first citation, or far after it
      {
        const firstCite = new Map();
        const order = new Map(); bodyLike.forEach((P, i) => order.set(P, i));
        bodyLike.forEach((P, i) => eachMatch(/\b(Figures?|Figs?\.|Tables?)\s+(\d+(?:[a-z])?(?:\s*(?:[,–\-]|and|&)\s*\d+[a-z]?)*)/g, P.text, m => {
          const kind = /^T/.test(m[1]) ? 'Table' : 'Figure';
          const nums = []; m[2].replace(/(\d+)[a-z]?\s*[–\-]\s*(\d+)|(\d+)/g, (_, a, b, c) => { if (c) nums.push(+c); else for (let k = +a; k <= +b && k - a < 30; k++) nums.push(k); return ''; });
          nums.forEach(n => { const key = kind + ' ' + n; if (!firstCite.has(key)) firstCite.set(key, { P, i }); });
        }));
        const bodyIdxOfBlock = bi => { let best = -1; bodyLike.forEach((P, i) => { if (blockIndexOfPara.get(P) < bi) best = i; }); return best; };
        capPs.forEach(C => {
          const m = textOf(C).match(/^(Figure|Table)\s+(\d+)\./); if (!m) return;
          const fc = firstCite.get(m[1] + ' ' + m[2]); if (!fc) return;
          const cb = blockIndexOfPara.get(C), pos = bodyIdxOfBlock(cb);
          if (pos < fc.i - 1) add(C, 0, m[0].length - 1, 'check', 'figtab', '6.2', `${m[1]} ${m[2]} อยู่ก่อนย่อหน้าที่อ้างถึงครั้งแรก — ควรวางหลังย่อหน้าที่อ้างถึงครั้งแรก`, `${m[1]} ${m[2]} appears before the paragraph that first cites it — place it after that paragraph`, 'Figures and tables should be inserted after (close to) their first citation.');
          else if (pos - fc.i > 6) add(C, 0, m[0].length - 1, 'check', 'figtab', '6.2', `${m[1]} ${m[2]} อยู่ห่างจากย่อหน้าที่อ้างถึงครั้งแรก ${pos - fc.i} ย่อหน้า — ควรวางใกล้จุดที่อ้างครั้งแรก`, `${m[1]} ${m[2]} is ${pos - fc.i} paragraphs after its first citation — place it close to that citation`, 'Figures and tables should be inserted close to their first citation.');
        });
      }

      // (22) panel citations: “Figure 4 A, B” → “Figure 4A,B”; caption panel labels “A-” → “(A)”
      bodyLike.concat(capPs).forEach(P => eachMatch(/\b(Figures?|Figs?\.)\s+(\d+)\s+([A-Ha-h])(?=\s*(?:[,–\-]|and)\s*[A-Ha-h]\b|\s*\))/g, P.text, m => add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.2', `รูปย่อยต้องเขียนติดเลขรูป: “${m[1]} ${m[2]}${m[3]}…” (เช่น Figure 4A–C)`, `Panel letters go right after the figure number: “${m[1]} ${m[2]}${m[3]}…” (e.g., Figure 4A–C)`, 'Figure citations: Figure 1a, Figure 1a,b, Figure 1a–c.')));
      capPs.filter(P => P.role === 'fig_caption').forEach(P => eachMatch(/(^|[.;]\s+)([A-H])\s?[-–—:]\s+(?=[A-Z])/g, P.text, m => { const k = m.index + m[1].length; add(P, k, k + m[0].length - m[1].length, 'check', 'figtab', '6.2', `ป้ายรูปย่อยในคำบรรยายควรเป็น “(${m[2]})”`, `Panel labels in the caption should be “(${m[2]})”`, 'Figure caption: label panels as (a), (b) … matching the figure.'); }));

      // (23) US / Canada / Australia locations need the state abbreviation
      mainPs.concat(paras.filter(P => P.role === 'affiliation')).forEach(P => eachMatch(/\(([^()]{2,80}?),\s*([\p{Lu}][\p{L} .'-]+?),\s*(USA|U\.S\.A\.|United States|Canada|Australia)\s*\)/gu, P.text, m => {
        if (/^[A-Z]{2,3}$/.test(m[2].trim())) return;
        const k = m.index + m[0].indexOf(m[3]);
        add(P, k, k + m[3].length, 'check', 'text', '6.1', `ที่อยู่ใน ${m[3]} ต้องมีอักษรย่อรัฐ/มณฑล: (…, ${m[2]}, XX, ${m[3] === 'United States' || m[3] === 'U.S.A.' ? 'USA' : m[3]})`, `Locations in ${m[3]} need the state/province abbreviation: (…, ${m[2]}, XX, ${m[3]})`, 'Manufacturers: Company, City, State abbreviation (USA/Canada/Australia), Country.');
      }));
      mainPs.forEach(P => eachMatch(/\(([\p{Lu}][\p{L} .'-]+),\s*(USA|U\.S\.A\.|United States)\s*\)/gu, P.text, m => { if (/^[A-Z]{2}$/.test(m[1].trim())) return; const k = m.index + m[0].indexOf(m[2]); add(P, k, k + m[2].length, 'check', 'text', '6.1', `ที่อยู่ในสหรัฐฯ ต้องมีอักษรย่อรัฐ: (${m[1]}, XX, USA)`, `US locations need the state abbreviation: (${m[1]}, XX, USA)`, 'Manufacturers: Company, City, State abbreviation, Country.'); }));

      // (24) affiliations: postal-code prefixes, several institutions in one line
      paras.filter(P => P.role === 'affiliation' && !P.empty).forEach(P => {
        eachMatch(/\b(CEP|C\.P\.|ZIP(?:\s+code)?|Zip(?:\s+code)?|Postal\s+code|Postcode|PIN|P\.O\.\s*Box)\s*:?\s*(?=\d)/g, P.text, m => { if (/P\.O\./.test(m[1])) return; add(P, m.index, m.index + m[0].length, 'error', 'front', '3.3', `ไม่ต้องมีคำนำหน้ารหัสไปรษณีย์ “${m[1]}” — ใส่แค่ตัวเลข`, `Drop the postal-code label “${m[1]}” — give only the number`, 'Affiliations: Department, Institution, City Postcode, Country.'); });
        const inst = P.text.match(/\b(Universi(?:ty|dad|dade|té|tà|tät)|Hospital|Instit(?:ute|uto|ut)\b)/g) || [];
        if (inst.length >= 2) add(P, null, null, 'check', 'front', '3.3', 'ควรตรวจสอบ: บรรทัดนี้มีหลายหน่วยงาน — ถ้าเป็นคนละที่อยู่ให้แยกเป็น affiliation คนละข้อ', 'Check: this line names several institutions — if they are different addresses, split them into separate affiliations', 'Affiliations: one address per affiliation.');
      });

      // (25)(26) species: italic consistency and lowercase genus
      {
        const sp = new Map(); // "Genus epithet" -> italic count
        const genus = new Set();
        const SPSTOP = /^(vitro|vivo|situ|silico|utero|novo|priori|posteriori|hoc|libitum|al|se|vice|versa|initio|vs|and|the|for|with|from)$/;
        bodyLike.forEach(P => eachMatch(/(?<![\p{L}.])([A-Z][a-z]{2,})\s([a-z]{3,})(?![\p{L}])/gu, P.text, m => {
          const a = m.index, b = a + m[0].length;
          if (SPSTOP.test(m[2]) || MINOR_ALWAYS.has(m[1].toLowerCase())) return;
          if (!allFmt(P, a, b, f => f.i)) return;
          if ((a > 0 && /\S/.test(P.text[a - 1]) && P.fmt(a - 1).i) || (b < P.text.length && P.fmt(b + 1 < P.text.length ? b + 1 : b).i && /\S/.test(P.text[b + 1] || ''))) return; // part of a longer italic phrase
          if (!speciesKind(m[1], m[2], learnedSp) && !/^[a-z]+(us|um|a|is|ii|ae|ensis|oides|ata|atus|icus|ica|ium|ianus|iana)$/.test(m[2])) return;
          sp.set(m[1] + ' ' + m[2], 1); genus.add(m[1]);
        }));
        learnedSp.forEach(x => { if (!sp.has(x)) sp.set(x, 0); genus.add(x.split(' ')[0]); });
        const kwPs = paras.filter(P => !P.empty && /^\s*Keywords?\s*:/i.test(P.text));
        const gScan = bodyLike.concat(kwPs);
        const gItal = new Set();
        gScan.forEach(P => eachMatch(/(?<![\p{L}])([A-Z][a-z]{3,})(?![\p{L}])/gu, P.text, m => { if ((genus.has(m[1]) || SPECIES_GENERA.has(m[1])) && allFmt(P, m.index, m.index + m[1].length, f => f.i)) gItal.add(m[1]); }));
        gItal.forEach(g => genus.add(g));
        // genus-only names: not italic (user request) — italic genus standing alone is reported, in the main text and the references
        {
          const refPs = paras.filter(P => !P.empty && P.role === 'ref');
          const allG = new Set(genus);
          paras.filter(P => !P.empty && (mainRoles.has(P.role) || P.role === 'ref')).forEach(P => eachMatch(/(?<![\p{L}.])([A-Z][a-z]{2,})\s([a-z]{3,})(?![\p{L}])/gu, P.text, m => { if (SPSTOP.test(m[2]) || MINOR_ALWAYS.has(m[1].toLowerCase())) return; if (speciesKind(m[1], m[2], learnedSp) === 'known' || (allFmt(P, m.index, m.index + m[0].length, f => f.i) && /^[a-z]+(us|um|a|is|ii|ae|ensis|oides|ata|atus|icus|ica|ium|ianus|iana|ensis|ana)$/.test(m[2]))) allG.add(m[1]); }));
          SPECIES_GENERA.forEach(g => allG.add(g));
          const isIt = (P, i) => i >= 0 && i < P.text.length && !!P.fmt(i).i;
          [...new Set(mainPs.concat(kwPs, refPs))].forEach(P => {
            if (P.role === 'heading' && P.head && P.head.lvl === 2) return; // italic heading style
            eachMatch(/(?<![\p{L}.])([A-Z][a-z]{3,})(?![\p{L}])/gu, P.text, m => {
              const g = m[1], a = m.index, b = a + g.length;
              if (!allG.has(g) || !allFmt(P, a, b, f => f.i)) return;
              const after = P.text.slice(b);
              { const em = after.match(/^(\s+)([a-z]{3,})/); if (em) { const k = b + em[1].length; if (fracFmt(P, k, k + em[2].length, f => f.i) > 0.5 || speciesKind(g, em[2], learnedSp) === 'known') return; } } // binomial (species name)
              if (/^\s+(spp?|var|subsp|cf|aff)\./.test(after)) return; // Genus sp./spp. — left as written
              // part of a longer italic phrase (journal or book title, italic heading)?
              let l = a - 1; while (l >= 0 && /\s/.test(P.text[l]) && isIt(P, l)) l--;
              let r = b; while (r < P.text.length && /\s/.test(P.text[r]) && isIt(P, r)) r++;
              const leftWord = l >= 0 && l < a - 1 && isIt(P, l) && /[\p{L}]/u.test(P.text[l]) ? (P.text.slice(0, l + 1).match(/([\p{L}]+)$/u) || [])[1] : null;
              const rightWord = r > b && isIt(P, r) && /[\p{L}]/u.test(P.text[r] || '') ? (P.text.slice(r).match(/^([\p{L}]+)/u) || [])[1] : null;
              if ((leftWord && !allG.has(leftWord)) || (rightWord && !allG.has(rightWord))) return;
              if (isIt(P, a - 1) && /[\p{L}\d]/u.test(P.text[a - 1] || '')) return;
              add(P, a, b, 'error', P.role === 'ref' ? 'ref' : 'species', P.role === 'ref' ? '7.1' : '6.1', `ชื่อสกุล “${g}” ที่อยู่เดี่ยว ๆ (ไม่มีชื่อสปีชีส์ตามหลัง) ไม่ต้องเป็นตัวเอียง`, `The genus “${g}” standing alone (no species name after it) should not be italic`, 'House rule: a genus name on its own is not italicized; full species names are.');
            });
          });
        }

        const seen = new Set();
        mainPs.concat(kwPs).forEach(P => {
          if (P.role === 'heading' && P.head && P.head.lvl === 2) return;
          eachMatch(/(?<![\p{L}.])([A-Z][a-z]{2,})\s([a-z]{3,})(?![\p{L}])/gu, P.text, m => {
            const name = m[1] + ' ' + m[2]; if (!sp.has(name) && speciesKind(m[1], m[2], learnedSp) !== 'known') return;
            if (fracFmt(P, m.index, m.index + m[0].length, f => f.i) > 0.999) return;
            add(P, m.index, m.index + m[0].length, sp.get(name) ? 'error' : 'check', 'species', '6.1', `${sp.get(name) ? '' : 'ควรตรวจสอบ: '}ชื่อสปีชีส์ “${name}” ต้องเป็นตัวเอียง${sp.get(name) ? ' (ที่อื่นในบทความเป็นตัวเอียง)' : ''}`, `The species name “${name}” must be italic`, 'Species names (genus and species) must be in italics.');
          });
          eachMatch(/(?<![\p{L}])([A-Z])\.\s?([a-z]{3,})(?![\p{L}])/gu, P.text, m => {
            const full = [...sp.keys()].find(x => x[0] === m[1] && x.endsWith(' ' + m[2])); if (!full) return;
            if (fracFmt(P, m.index, m.index + m[0].length, f => f.i) > 0.999) return;
            add(P, m.index, m.index + m[0].length, 'error', 'species', '6.1', `ชื่อสปีชีส์ “${m[0]}” (${full}) ต้องเป็นตัวเอียง`, `The species name “${m[0]}” (${full}) must be italic`, 'Species names must be in italics.');
          });
          // (genus alone, even lowercase, is not reported)
        });
      }

      // leftover HTML tags / entities typed into the text (e.g. “https://doi.org/10.1890/00-0634</u>”)
      paras.filter(P => !P.empty && (mainRoles.has(P.role) || P.role === 'ref' || P.role === 'affiliation')).forEach(P => {
        eachMatch(/<\/?(?:u|i|b|em|strong|sup|sub|span|a|p|br|div|font|sc|italic|bold)\b[^<>]{0,60}>|&(?:lt|gt|amp|quot|nbsp|#\d{2,5});/gi, P.text, m => {
          const doi = /(doi\.org\/|doi:\s*|10\.\d{4,9}\/)\S*$/i.test(P.text.slice(Math.max(0, m.index - 80), m.index));
          add(P, m.index, m.index + m[0].length, 'error', P.role === 'ref' ? 'ref' : 'text', P.role === 'ref' ? '7.1' : '6.1', `มีข้อความเกิน “${m[0]}” (โค้ด HTML ที่ติดมา)${doi ? ' ต่อท้าย DOI' : ''} — ต้องลบออก`, `Extra content “${m[0]}” (leftover HTML code)${doi ? ' stuck to the DOI' : ''} — remove it`, 'Text must not contain stray code.');
        });
      });

      // (27) paragraph after an equation that starts with lowercase “where/with/and” must not be indented
      paras.forEach(P => {
        if (!['body', 'appendix_body'].includes(P.role) || !P.pp) return;
        const bi = blockIndexOfPara.get(P); const pv = prevNonEmpty(bi);
        const prevEq = pv && ((pv.kind === 'tbl' && pv.t.kind === 'equation') || (pv.kind === 'p' && pv.p.role === 'equation_para'));
        if (!prevEq || !/^(where|with|and|in which|for)\b/.test(textOf(P))) return;
        const fl = P.pp.firstLine != null ? P.pp.firstLine : (P.pp.ind && P.pp.ind.firstLine);
        if (fl && Number(fl) > 50) { const s = trimRange(P)[0]; add(P, s, s + textOf(P).split(/\s/)[0].length, 'error', 'text', '6.4', 'ย่อหน้าที่ต่อประโยคจากสมการ (ขึ้นต้นตัวเล็ก) ต้องไม่เยื้องบรรทัดแรก', 'A paragraph that continues the sentence after an equation (lowercase start) must not have a first-line indent', 'Equations: text continuing after an equation starts without indentation.'); }
      });

      // (28) runs of variable definitions typed as separate paragraphs → bullet list
      {
        let run = [];
        const flush = () => { if (run.length >= 3) add(run[0], null, null, 'check', 'text', '6.1', `ควรตรวจสอบ: ย่อหน้าสั้น ๆ ${run.length} ย่อหน้าที่นิยามตัวแปรต่อกัน — ควรจัดเป็นรายการ (bullet list) ตามเทมเพลต`, `Check: ${run.length} short paragraphs defining variables — format them as a bullet list`, 'Lists: use the template list style.'); run = []; };
        paras.forEach(P => {
          if (P.empty) return;
          const ok = ['body', 'appendix_body'].includes(P.role) && textOf(P).length < 160 && /^[\p{L}][\p{L}\d₀-₉]{0,4}\s+(the|is|are|=|denotes|represents)\s/u.test(textOf(P));
          if (ok) run.push(P); else flush();
        });
        flush();
      }
    }
    // heading styles used on body text / on a heading of another level
    {
      const HS = ['', 'MDPI_2.1_heading1', 'MDPI_2.2_heading2', 'MDPI_2.3_heading3', 'a level 3/4 subheading style (not heading1)', 'MDPI_2.3_heading3'];
      const bodyMis = paras.filter(P => P.styleMis && P.styleMis.kind === 'body' && !P.empty);
      const rule = 'Use the template styles: body text MDPI_3.1_text; headings MDPI_2.1_heading1, MDPI_2.2_heading2, MDPI_2.3_heading3.';
      if (bodyMis.length > 3) add(bodyMis[0], null, null, 'error', 'heading', '6.1', `ย่อหน้าเนื้อหา ${bodyMis.length} ย่อหน้าใช้สไตล์หัวข้อ “${bodyMis[0].styleMis.have}” (แต่งให้ดูเหมือนเนื้อหา) — ต้องเปลี่ยนเป็นสไตล์ MDPI_3.1_text ไม่เช่นนั้นจะขึ้นเป็นหัวข้อใน Navigation Pane`, `${bodyMis.length} body paragraphs use the heading style “${bodyMis[0].styleMis.have}” (formatted to look like text) — change them to MDPI_3.1_text`, rule);
      else bodyMis.forEach(P => add(P, null, null, 'error', 'heading', '6.1', `ย่อหน้าเนื้อหานี้ใช้สไตล์หัวข้อ “${P.styleMis.have}” — ต้องเปลี่ยนเป็นสไตล์ MDPI_3.1_text`, `This body paragraph uses the heading style “${P.styleMis.have}” — change it to MDPI_3.1_text`, rule));
      const olMis = paras.filter(P => P.styleMis && P.styleMis.kind === 'outline' && !P.empty);
      if (olMis.length) add(olMis[0], null, null, 'check', 'heading', '6.1', `ควรตรวจสอบ: ย่อหน้าเนื้อหา${olMis.length > 1 ? ` ${olMis.length} ย่อหน้า` : 'นี้'}ตั้ง Outline level เป็นหัวข้อ (Paragraph → Outline level) — ควรตั้งเป็น Body Text`, `Check: ${olMis.length} body paragraph(s) have a heading outline level — set Outline level to Body Text`, rule);
      const lvMis = paras.filter(P => P.styleMis && P.styleMis.kind === 'level' && !P.empty);
      const one = P => [`หัวข้อ ${P.head ? P.head.numStr : ''} เป็นหัวข้อระดับ ${P.styleMis.to} แต่ใช้สไตล์ “${P.styleMis.have}” — ต้องใช้ “${HS[P.styleMis.to] || HS[3]}”`, `Heading ${P.head ? P.head.numStr : ''} is level ${P.styleMis.to} but uses “${P.styleMis.have}” — use “${HS[P.styleMis.to] || HS[3]}”`];
      if (lvMis.length > 3) add(lvMis[0], null, null, 'error', 'heading', '6.1', `${one(lvMis[0])[0]} (มีแบบนี้ทั้งหมด ${lvMis.length} หัวข้อ: ${lvMis.slice(0, 8).map(P => P.head && P.head.numStr).join(', ')}${lvMis.length > 8 ? ', …' : ''})`, `${one(lvMis[0])[1]} (${lvMis.length} headings like this)`, rule);
      else lvMis.forEach(P => add(P, null, null, 'error', 'heading', '6.1', one(P)[0], one(P)[1], rule));
    }
    // M11: caption with a second paragraph
    paras.filter(P => P.role === 'fig_caption' || P.role === 'tab_caption').forEach(P => {
      const bi = blockIndexOfPara.get(P); if (P.inTable) return;
      const nx = nextNonEmpty(bi);
      if (P.role === 'fig_caption' && nx && nx.kind === 'p' && (nx.p.styleId || nx.p.styleName) && (nx.p.styleId || nx.p.styleName) === (P.styleId || P.styleName) && /caption/i.test((P.styleName || '') + ' ' + (P.styleId || '')) && !/^\d+(\.\d+)*\.?\s+\S/.test(nx.p.text) && !/^(fig|tab)_caption$/.test(nx.p.role) && !nx.p.drawings.length) add(nx.p, null, null, CK, 'figtab', '6.2', 'ควรตรวจสอบ: คำบรรยายรูปมีได้ย่อหน้าเดียว — ย่อหน้านี้ดูเหมือนเป็นส่วนต่อของคำบรรยาย', 'Check: a figure caption is one paragraph only — this paragraph looks like a continuation of the caption', 'Figure caption: Only a one-paragraph caption is allowed.');
      if (P.role === 'tab_caption' && nx && nx.kind === 'p' && !nx.p.drawings.length) { const nx2 = nextNonEmpty(blockIndexOfPara.get(nx.p)); if (nx2 && nx2.kind === 'tbl' && nx2.t.kind === 'data' && !/^(fig|tab)_caption$/.test(nx.p.role)) add(nx.p, null, null, CK, 'figtab', '6.3', 'ควรตรวจสอบ: คำบรรยายตารางมีได้ย่อหน้าเดียว — มีย่อหน้าคั่นระหว่างคำบรรยายกับตาราง', 'Check: a table caption is one paragraph only — there is a paragraph between the caption and the table', 'Table caption: Only one-paragraph captions are allowed.'); }
    });
    // M12: bold text in table body cells needs an explanation
    for (const T of model.tables) {
      if (T.depth > 0 || T.kind !== 'data' || T.rows.length < 2) continue;
      let bi = -1; blocks.forEach((b, i) => { if (b.kind === 'tbl' && b.t === T) bi = i; });
      const ft = []; for (let k = bi + 1; k < blocks.length && ft.length < 6; k++) { const b = blocks[k]; if (b.kind !== 'p') break; if (b.p.empty) continue; if (b.p.role === 'table_footnote' || (ft.length && (b.p.fmt(trimRange(b.p)[0]).size || 10) <= 9)) ft.push(b.p.text); else break; }
      const capB = (() => { const pv = prevNonEmpty(bi); return pv && pv.kind === 'p' ? pv.p.text : ''; })();
      if (/\bbold/i.test(ft.join(' ') + ' ' + capB)) continue;
      const firstCol = new Set(T.rows.map(r => r[0]));
      let hit = null;
      for (const row of T.rows.slice(1)) { for (const c of row) { if (firstCol.has(c)) continue; for (const p of c.paras) { if (p.empty) continue; const [s0, e0] = trimRange(p); if (fracFmt(p, s0, e0, f => f.b) > 0.99 && /\d/.test(p.text)) { hit = p; break; } } if (hit) break; } if (hit) break; }
      if (hit) add(hit, null, null, CK, 'figtab', '6.3', 'ควรตรวจสอบ: มีตัวหนาในเนื้อหาตาราง — ต้องมีคำอธิบายใน footnote (เช่น “Bold values indicate …”) ไม่เช่นนั้นให้เป็นตัวปกติ', 'Check: bold text in the table body needs an explanation in the footnote (e.g., “Bold values indicate …”), otherwise make it regular', 'Any special characters or icons in a table need to have a corresponding explanation; text should not be emphasized without explanation.');
    }
    // M19: spaces in (x, y), [0, 1]
    bodyPs.forEach(P => {
      const t = P.text;
      eachMatch(/(?<![\p{L}\d])\(([a-zA-Z]),([a-zA-Z])\)/gu, t, m => { if (/(Figure|Fig\.|Table)s?\s*\d+\s*$/.test(t.slice(Math.max(0, m.index - 12), m.index))) return; if (!P.fmt(m.index + 1).i) return; add(P, m.index, m.index + m[0].length, CK, 'text', '6.1', `ควรตรวจสอบ: เว้นวรรคหลังลูกน้ำ “(${m[1]}, ${m[2]})”`, `Check: add a space after the comma “(${m[1]}, ${m[2]})”`, 'Mathematical Terms — Space: “(x, y)”, “X = 1, 2, …, N”, “(0, 1)”, “[0, 1]”, “a, b, …, x”.'); });
      eachMatch(/[\[(](\d+(?:\.\d+)?),(\d+(?:\.\d+)?)[\])]/g, t, m => { if (!(/^0/.test(m[1]) || /\./.test(m[1] + m[2]))) return; if (m[0][0] === '[' && !/^0(\.|$)/.test(m[1])) return; add(P, m.index, m.index + m[0].length, CK, 'text', '6.1', `ควรตรวจสอบ: ช่วงทางคณิตศาสตร์ต้องเว้นวรรคหลังลูกน้ำ “${m[0][0]}${m[1]}, ${m[2]}${m[0].slice(-1)}”`, `Check: a mathematical interval takes a space after the comma “${m[0][0]}${m[1]}, ${m[2]}${m[0].slice(-1)}”`, 'Mathematical Terms — Space: “(0, 1)”, “[0, 1]”. Pay attention to brackets when they are expressed as a mathematical range: e.g., [1, 3].'); });
    });
    // M21: unit connector (· vs space) used inconsistently; M22: wt% / wt % / wt.%
    {
      const U1 = 'mol|mmol|μmol|µmol|nmol|mg|g|μg|µg|ng|kg|mL|μL|µL|L|cm|mm|m|km|s|min|h|kJ|J|W|U|CFU|cfu|GAE|QE|TE|DW|FW';
      const U2 = 'L|mL|μL|µL|kg|g|mg|m|cm|mm|s|min|h|mol|d';
      const dot = [], spc = [];
      bodyPs.concat(paras.filter(P => P.role === 'table_cell' && !P.empty)).forEach(P => {
        const t = P.text;
        eachMatch(new RegExp(`(?<![\\p{L}])(${U1})·(${U2})(?![\\p{L}])`, 'gu'), t, m => dot.push({ P, i: m.index, n: m[0].length }));
        eachMatch(new RegExp(`(?<![\\p{L}])(${U1}) (${U2})(?=[−-]?\\d)`, 'gu'), t, m => { const k = m.index + m[0].length; if (P.fmt(k).vert === 'superscript' || P.fmt(k + 1).vert === 'superscript') spc.push({ P, i: m.index, n: m[0].length }); });
      });
      if (dot.length && spc.length) { const x = dot.length < spc.length ? dot[0] : spc[0]; add(x.P, x.i, x.i + x.n, CK, 'unit', '6.1', `ควรตรวจสอบ: หน่วยเชื่อมด้วยจุดกลาง (·) ${dot.length} ที่ และเว้นวรรค ${spc.length} ที่ — ต้องใช้แบบเดียวกันทั้งบทความ`, `Check: units are joined with a center dot (·) in ${dot.length} places and with a space in ${spc.length} — use one style throughout`, 'Units can be connected with a center dot (multiply sign) or a normal space, such as “mol·L−1”, “mol L−1”; retain the author’s preferences and ensure this is consistent throughout the article.'); }
      const pct = new Map();
      bodyPs.concat(paras.filter(P => P.role === 'table_cell' && !P.empty)).forEach(P => eachMatch(/\b(wt|mol|vol)(\.?)(\s?)%/g, P.text, m => { const v = m[2] + m[3]; const k = m[1]; if (!pct.has(k)) pct.set(k, new Map()); const mm = pct.get(k); if (!mm.has(v)) mm.set(v, { P, i: m.index, n: m[0].length, c: 0 }); mm.get(v).c++; }));
      pct.forEach((mm, k) => { if (mm.size > 1) { const arr = [...mm.values()].sort((a, b) => a.c - b.c); const x = arr[0]; add(x.P, x.i, x.i + x.n, CK, 'unit', '6.1', `ควรตรวจสอบ: เขียน ${k}% หลายแบบในบทความ (${[...mm.keys()].map(v => `“${k}${v}%”`).join(', ')}) — ใช้แบบเดียวกัน`, `Check: ${k}% is written in several ways (${[...mm.keys()].map(v => `“${k}${v}%”`).join(', ')}) — use one`, 'A space is optional between “wt%, mol%, vol%” or “wt.%, mol.%, vol.%”, but ensure that the formatting is consistent.'); } });
    }
    // M23: Greek letters italic in some places, upright in others
    {
      const g = new Map();
      bodyPs.forEach(P => {
        const [s0, e0] = trimRange(P); const fi = fracFmt(P, s0, e0, f => f.i); if (fi != null && fi > 0.8) return;
        for (let i = 0; i < P.text.length; i++) { const ch = P.text[i]; if (!/[α-ωϑϕϵΑ-Ω]/.test(ch) || !P.chars[i].r || P.fmt(i).math || P.chars[i].sym) continue; if (/^[µμ]$/.test(ch)) continue; const it = !!P.fmt(i).i; if (!g.has(ch)) g.set(ch, { it: [], up: [] }); g.get(ch)[it ? 'it' : 'up'].push({ P, i }); }
      });
      g.forEach((v, ch) => { if (v.it.length && v.up.length) { const x = v.it.length < v.up.length ? v.it[0] : v.up[0]; add(x.P, x.i, x.i + 1, CK, 'text', '6.1', `ควรตรวจสอบ: “${ch}” เป็นตัวเอียง ${v.it.length} ที่ และตัวตรง ${v.up.length} ที่ — ต้องเหมือนกันทั้งบทความ`, `Check: “${ch}” is italic in ${v.it.length} places and upright in ${v.up.length} — keep it consistent`, 'For the Greek letters in the main text, regardless of whether they are in italics or not, retain the authors’ preference and ensure this is consistent throughout the article.'); } });
    }
    // M25: N- in chemical names is italic
    bodyPs.concat(paras.filter(P => P.role === 'table_cell' && !P.empty)).forEach(P => eachMatch(/(?<![\p{L}\d])(N)(,N['′]?)?-(?=(acetyl|methyl|ethyl|propyl|butyl|benzyl|phenyl|formyl|hydroxy|nitroso|acyl|alkyl|aryl|Boc|boc|tert|glycosyl|glycolyl|lauroyl|palmitoyl|oleoyl|carbamoyl|succinimid|bromo|chloro|iodo|vinyl|isopropyl|cyclohexyl|dimethyl|diethyl|nitro|amino|carboxy|sulfo|trityl|oxide|glycan|glycosylat|linked|methylmorpholine|ethylmaleimide))/gu, P.text, m => { if (!P.fmt(m.index).i || (m[2] && !P.fmt(m.index + 2).i)) add(P, m.index, m.index + m[0].length - 1, CK, 'text', '6.1', `ควรตรวจสอบ: ตัว N ใน “${m[0]}…” (ชื่อสารเคมี) ต้องเป็นตัวเอียง`, `Check: the N in “${m[0]}…” (chemical name) should be italic`, '“N-(some names of drugs)” “N” should be in italics (refer to the ACS Style Guide for some special rules specifically for chemical compounds).'); }));
    // M31: unbalanced brackets
    bodyPs.concat(paras.filter(P => ['heading', 'title', 'back', 'supp'].includes(P.role) && !P.empty)).forEach(P => {
      const t = P.text;
      const st = []; let bad = -1;
      for (let i = 0; i < t.length && bad < 0; i++) { const c = t[i]; if (P.chars[i] && (P.chars[i].math || P.fmt(i).math)) continue; if (c === '(' || c === '[') st.push({ c, i }); else if (c === ')' || c === ']') { const top = st[st.length - 1]; if (top && ((c === ')' && top.c === '(') || (c === ']' && top.c === '['))) st.pop(); else if (top && c === ')' && top.c === '[' && /^\s*0|\d\.\d/.test(t.slice(top.i, i))) st.pop(); else if (c === ')' && !st.some(x => x.c === '(') && /(^|\s)([a-zA-Z]|[ivxIVX]{1,4}|\d{1,2})$/.test(t.slice(Math.max(0, i - 6), i))) continue; else bad = i; } }
      if (bad < 0 && st.length) bad = st[st.length - 1].i;
      if (bad >= 0) add(P, bad, bad + 1, CK, 'text', '6.9', `ควรตรวจสอบ: วงเล็บ “${t[bad]}” ไม่ครบคู่`, `Check: the bracket “${t[bad]}” has no matching pair`, 'List: Numbered brackets should be complete. (Brackets and parentheses must be paired.)');
    });
    // M32: body paragraph does not end with a full stop
    paras.filter(P => !P.empty && ['body', 'appendix_body'].includes(P.role)).forEach(P => {
      const [s0, e0] = trimRange(P); const tt = P.text.slice(s0, e0).replace(/[\s￼]+$/, '');
      if (tt.length < 40 || /[.?!:;…]["”’)\]]*$/.test(tt) || /\.\s*\[[\d,–\s]+\]\.?$/.test(tt)) return;
      const nx = nextNonEmpty(blockIndexOfPara.get(P));
      if (nx && ((nx.kind === 'tbl' && nx.t.kind === 'equation') || (nx.kind === 'p' && ['equation_para', 'list'].includes(nx.p.role)))) return;
      if (P.hasMath && /,$/.test(tt)) return;
      add(P, e0 - 1, e0, CK, 'text', '6.1', 'ควรตรวจสอบ: ย่อหน้านี้ไม่จบด้วยจุด (.)', 'Check: this paragraph does not end with a full stop', 'Paragraphs: each sentence of the main text ends with a full stop.');
    });
    // M38: APC sentence
    { const fp = bodyOf('funding'); fp.forEach(({ P, t }) => eachMatch(/\bAPC\b[^.]*\./g, t, m => { if (!/^APC was funded by\s/.test(m[0]) || !/\bThe\s+$/.test(t.slice(0, m.index))) add(P, m.index, m.index + m[0].length, CK, 'back', '7.3', 'ควรตรวจสอบ: ประโยคค่าตีพิมพ์ต้องเป็น “The APC was funded by [XXX].”', 'Check: the APC sentence should read “The APC was funded by [XXX].”', 'Funding: “This research was funded by [name of funder] grant number [xxx]” and “The APC was funded by [XXX]”.'); })); }
    // M39: abbreviation list in alphabetical order
    {
      const terms = [];
      const abT = model.tables.find(T => T.kind === 'abbrev');
      if (abT) abT.rows.forEach(r => { const p = r[0] && r[0].paras.find(x => !x.empty); if (p) terms.push({ P: p, t: textOf(p) }); });
      else paras.filter(P => P.role === 'abbrev' && !P.empty).forEach(P => { const m = textOf(P).match(/^([^\t:]{1,30})(\t|\s*[:–—-]\s)/); if (m) terms.push({ P, t: m[1].trim() }); });
      const key = s => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      for (let i = 1; i < terms.length; i++) if (key(terms[i].t) && key(terms[i].t).localeCompare(key(terms[i - 1].t), 'en') < 0) { add(terms[i].P, null, null, CK, 'back', '7.10', `ควรตรวจสอบ: รายการตัวย่อต้องเรียงตามตัวอักษร — “${terms[i].t}” อยู่หลัง “${terms[i - 1].t}”`, `Check: the abbreviation list should be alphabetical — “${terms[i].t}” comes after “${terms[i - 1].t}”`, 'Glossary/Abbreviations: Terms in the glossary are arranged alphabetically; each term is on a separate line and is followed by its definition.'); break; }
    }
    // R11 / R16 (references)
    refs.forEach(P => {
      const t = P.text; const head = t.slice(0, 300);
      const em = head.match(/\s\((eds?|Eds?|editors?|Editors?|EDS)(\.?)\)/);
      if (em && !/^\((Eds?)\.\)$/.test(em[0].trim())) { const k = em.index + 1; add(P, k, k + em[0].trim().length, CK, 'ref', '7.12', 'ควรตรวจสอบ: บรรณาธิการแทนผู้แต่งเขียนเป็น “(Eds.)” หรือ “(Ed.)”', 'Check: editors in place of authors are written “(Eds.)” or “(Ed.)”', 'Editor in place of author: Editor, A.; Editor, B. (Eds.) — “Editor” should be abbreviated.'); }
      else if (em) { const before = head.slice(0, em.index); const n = (before.match(/;/g) || []).length + 1; if (n === 1 && em[1] === 'Eds') { const k = em.index + 1; add(P, k, k + 6, CK, 'ref', '7.12', 'ควรตรวจสอบ: บรรณาธิการคนเดียวใช้ “(Ed.)”', 'Check: a single editor takes “(Ed.)”', 'Editor in place of author: Editor, A.; Editor, B. (Eds.)'); } else if (n > 1 && em[1] === 'Ed') { const k = em.index + 1; add(P, k, k + 5, CK, 'ref', '7.12', 'ควรตรวจสอบ: บรรณาธิการหลายคนใช้ “(Eds.)”', 'Check: several editors take “(Eds.)”', 'Editor in place of author: Editor, A.; Editor, B. (Eds.)'); } }
      const RP = 'Preprint: Author 1, F.M.; Author 2, F.M. Title of article. Name of Repository Year, Article Number or DOI Link. e.g., arXiv 2016, arXiv:1603.00278.';
      eachMatch(/\b(arXiv|bioRxiv|medRxiv|ChemRxiv|Preprints|SSRN|Research Square)\s+preprint\b/gi, t, m => add(P, m.index, m.index + m[0].length, CK, 'ref', '7.12', `ควรตรวจสอบ: ตัดคำว่า “preprint” — รูปแบบคือ “${m[1]} ปี, เลขบทความ/DOI”`, `Check: drop “preprint” — the format is “${m[1]} Year, Article Number/DOI”`, RP));
      eachMatch(/\barXiv:\s?\d{4}\.\d{4,5}/g, t, m => { if (!/arXiv (19|20)\d{2}[a-z]?, $/.test(t.slice(0, m.index)) && !/preprint\s*$/i.test(t.slice(0, m.index))) add(P, m.index, m.index + m[0].length, CK, 'ref', '7.12', 'ควรตรวจสอบ: รูปแบบ preprint ต้องเป็น “arXiv 2016, arXiv:1603.00278.”', 'Check: the preprint format is “arXiv 2016, arXiv:1603.00278.”', RP); });
      eachMatch(/\b(bioRxiv|medRxiv|ChemRxiv)\b(?!\s+(19|20)\d{2},)/g, t, m => { if (!/preprint/i.test(t.slice(m.index, m.index + 20))) add(P, m.index, m.index + m[0].length, CK, 'ref', '7.12', `ควรตรวจสอบ: รูปแบบ preprint ต้องเป็น “${m[1]} ปี, DOI”`, `Check: the preprint format is “${m[1]} Year, DOI”`, RP); });
    });
    // X1: equal-contribution note
    paras.filter(P => P.role === 'frontnote' && /contributed equally/i.test(P.text)).forEach(P => {
      const t = textOf(P).replace(/^[†‡§¶‖#*]+\s*/, '');
      if (t !== 'These authors contributed equally to this work.') add(P, null, null, 'error', 'front', '4.2', 'ข้อความต้องเป็น “These authors contributed equally to this work.” (ตรงคำและจบด้วยจุด)', 'The note must read “These authors contributed equally to this work.” exactly, with a full stop', 'Front Notes: For co-authors who contributed equally, the standard note to be used should be “These authors contributed equally to this work.”. A full stop/period is required at the end of each note.');
    });
    // X3: IRB / informed consent wording follows the template
    {
      const strip = t => t.replace(/^\s*(Institutional\s+Review\s+Board(\s+Statement)?|Informed\s+Consent(\s+Statement)?)\s*:\s*/i, '').trim();
      const irb = bodyOf('irb'), con = bodyOf('consent');
      const IRBOK = [/^Not applicable\.$/, /^The study was conducted in accordance with the Declaration of Helsinki, and approved by the (Institutional Review Board|Ethics Committee|Institutional Review Board \(or Ethics Committee\)) of /, /^The animal study protocol was approved by the (Institutional Review Board|Ethics Committee|Institutional Review Board \(or Ethics Committee\)|Institutional Animal Care and Use Committee) of /, /^Ethical review and approval were waived for this study /];
      const CONOK = [/^Not applicable\.$/, /^Informed consent was obtained from all subjects involved in the study\./, /^Patient consent was waived /, /^Written informed consent has been obtained from the patient\(s\) to publish this paper/];
      const chk = (list, ok, sec, name, eg) => { const t = strip(list.map(x => x.t).join(' ')); if (!t) return; if (ok.some(re => re.test(t))) return; const P = list[0].P; const near = /^(N\/A|NA|None|Not Applicable\.?|not applicable\.?|Not applicable)$/.test(t); add(P, null, null, CK, 'back', sec, near ? `ควรตรวจสอบ: ถ้าไม่เกี่ยวข้องให้เขียน “Not applicable.”` : `ควรตรวจสอบ: ข้อความ ${name} ไม่ตรงกับเทมเพลต — ${eg}`, near ? 'Check: write “Not applicable.”' : `Check: the ${name} wording does not follow the template — ${eg}`, `${name}: use the template wording, e.g., ${eg}`); };
      chk(irb, IRBOK, '7.4', 'Institutional Review Board Statement', '“The study was conducted in accordance with the Declaration of Helsinki, and approved by the Institutional Review Board (or Ethics Committee) of NAME OF INSTITUTE (protocol code XXX and date of approval).” / “The animal study protocol was approved by …” / “Not applicable.”');
      chk(con, CONOK, '7.5', 'Informed Consent Statement', '“Informed consent was obtained from all subjects involved in the study.” / “Patient consent was waived due to REASON …” / “Not applicable.”');
    }
    // X6: cited subfigure letters must exist in the figure caption
    {
      const capLetters = new Map();
      figCaps.forEach(c => { const set = new Set(); eachMatch(/\(([a-zA-Z])(?:\d)?\)/g, c.P.text, m => set.add(m[1].toLowerCase())); eachMatch(/\(([a-zA-Z])\s*[–-]\s*([a-zA-Z])\)/g, c.P.text, m => { for (let q = m[1].toLowerCase().charCodeAt(0); q <= m[2].toLowerCase().charCodeAt(0); q++) set.add(String.fromCharCode(q)); }); if (set.size) capLetters.set(c.id, set); });
      if (capLetters.size) citeParas.filter(P => P.role !== 'fig_caption').forEach(P => eachMatch(/\bFigures?\s+((?:A)?\d+)\s?\(?([a-zA-Z](?:\s*[,–-]\s*[a-zA-Z](?![a-zA-Z]))*)\)?(?![\p{L}\d])/gu, P.text, m => {
        const set = capLetters.get(m[1]); if (!set) return;
        const letters = []; m[2].replace(/\s/g, '').split(',').forEach(part => { const r2 = part.split(/[–-]/); if (r2.length === 2) { for (let q = r2[0].toLowerCase().charCodeAt(0); q <= r2[1].toLowerCase().charCodeAt(0) && q - r2[0].toLowerCase().charCodeAt(0) < 26; q++) letters.push(String.fromCharCode(q)); } else letters.push(part.toLowerCase()); });
        const miss = letters.filter(x => !set.has(x));
        if (miss.length) add(P, m.index, m.index + m[0].length, 'error', 'cite', '6.2', `อ้างถึงรูปย่อย ${miss.map(x => `(${x})`).join(', ')} ของ Figure ${m[1]} แต่คำบรรยายรูปมีแค่ ${[...set].sort().map(x => `(${x})`).join(', ')}`, `Subfigure ${miss.map(x => `(${x})`).join(', ')} of Figure ${m[1]} is cited, but the caption only has ${[...set].sort().map(x => `(${x})`).join(', ')}`, 'Both subfigures and special symbols in the images need corresponding explanations; subfigures should be provided with a sub-caption in the Figure caption.');
      }));
    }
  }
  /* ---------- 11. acronyms, manufacturers, software, URLs ---------- */
  const bodyParas = paras.filter(P => ['body', 'list', 'appendix_body', 'table_footnote'].includes(P.role));
  const seenCo = new Set(), seenSw = new Set();
  bodyParas.forEach(P => {
    const t = P.text;
    COMPANIES_BY_LEN.forEach(co => {
      if (seenCo.has(co) || [...seenCo].some(x => x.includes(co))) return;
      const re = new RegExp('(?<![\\p{L}-])' + co.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}-])', 'u');
      const m = t.match(re);
      if (!m) return;
      seenCo.add(co);
      const after = t.slice(m.index + co.length, m.index + co.length + 80);
      if (!/^[^.;]{0,25}(\(|,)\s*[\p{Lu}][\p{L} .'-]+,\s*([A-Z]{2},\s*)?[\p{Lu}][\p{L} ]+\)?/u.test(after)) add(P, m.index, m.index + co.length, 'check', 'text', '6.1', `ผู้ผลิต “${co}” ที่กล่าวถึงครั้งแรกต้องระบุเมืองและประเทศ (สหรัฐฯ/แคนาดาใส่รัฐ) เช่น ${co} (St. Louis, MO, USA)`, `First mention of manufacturer “${co}” needs its city and country (state for USA/Canada), e.g., ${co} (St. Louis, MO, USA)`, 'In the main text, the companies/manufacturers of chemicals and reagents, devices, instruments, commercial cell lines/samples/materials should be indicated together with their City (State abbreviations are required for USA and Canada) and Country in the first instance.');
    });
    // product lines named without their maker's location (ZORBAX column, Hypersil column, ACQUITY UPLC …)
    for (const [brand, maker] of BRAND_MAKERS) {
      if (seenCo.has('brand:' + brand)) continue;
      const k = t.search(new RegExp('(?<![\\p{L}])' + brand + '(?![\\p{L}])', 'u')); if (k < 0) continue;
      seenCo.add('brand:' + brand);
      const after = t.slice(k, k + 120);
      if (/\(\s*[^()]*,\s*[\p{Lu}][\p{L} .'-]+,\s*([A-Z]{2},\s*)?[\p{Lu}][\p{L} ]+\)/u.test(after.slice(0, 110)) && new RegExp(maker.split(' ')[0]).test(after)) continue;
      add(P, k, k + brand.length, 'check', 'text', '6.1', `ระบุผู้ผลิตพร้อมเมืองและประเทศของ “${brand}” (ผู้ผลิต: ${maker}) เช่น (${maker}, City, Country)`, `Give the manufacturer with city and country for “${brand}” (made by ${maker}), e.g., (${maker}, City, Country)`, 'The companies/manufacturers of chemicals and reagents, devices, instruments … should be indicated together with their City (State abbreviations are required for USA and Canada) and Country in the first instance.');
    }
    // any company name ending in Co./Ltd./Inc./Instruments … needs City, Country after it
    eachMatch(/((?:[A-Z][\p{L}&.-]*\s+){1,6}(?:Co\.|Ltd\.|Inc\.|Corp\.|GmbH|LLC|Company|Corporation|Instruments?|Technologies|Biotechnology|Biotech|Chemicals?|Industries|Laboratories|Reagents?)(?:,?\s+(?:Co\.,\s*)?(?:Ltd\.|Inc\.|LLC))?)((?:,\s*[A-Z][\p{L} .'-]*)*)\s*([);.]|$)/gu, t, m => {
      const co = m[1].trim(); if (seenCo.has(co) || [...seenCo].some(x => co.includes(x) && !x.startsWith('brand:'))) return;
      seenCo.add(co);
      const parts = m[2].split(',').map(x => x.trim()).filter(Boolean);
      if (parts.length >= 2) return;
      const k = m.index;
      add(P, k, k + m[1].length + m[2].length, 'check', 'text', '6.1', parts.length ? `ผู้ผลิต “${co}” ยังขาดชื่อเมือง (มีแต่ “${parts[0]}”) — ต้องเป็น City, Country` : `ผู้ผลิต “${co}” ที่กล่าวถึงครั้งแรกต้องระบุเมืองและประเทศ`, parts.length ? `Manufacturer “${co}” is missing the city (only “${parts[0]}”) — use City, Country` : `First mention of manufacturer “${co}” needs its city and country`, 'In the main text, the companies/manufacturers … should be indicated together with their City (State abbreviations are required for USA and Canada) and Country in the first instance.');
    });
    eachMatch(/\b(purchased|obtained|supplied|bought|acquired)\s+from\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,4})/g, t, m => {
      const co = m[2];
      if (seenCo.has(co) || COMPANIES.some(c => co.startsWith(c))) return;
      seenCo.add(co);
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
      if (!/^\s*(Co\.|Inc\.|Ltd\.|GmbH|Corp\.|LLC|AG|S\.A\.)?[,\s]*\(?\s*[\p{Lu}][\p{L} .'-]+,\s*([A-Z]{2},\s*)?[\p{Lu}]/u.test(after)) add(P, m.index + m[0].length - co.length, m.index + m[0].length, 'check', 'text', '6.1', `ระบุเมืองและประเทศของผู้ผลิต “${co}” เมื่อกล่าวถึงครั้งแรก`, `Give the city and country of supplier “${co}” at first mention`, 'In the main text, the companies/manufacturers of chemicals and reagents, devices, instruments … should be indicated together with their City (State abbreviations are required for USA and Canada) and Country in the first instance.');
    });
    SOFTWARE.forEach(sw => {
      if (seenSw.has(sw.split(' ')[0])) return;
      const re = new RegExp('(?<![\\p{L}-])' + sw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}-])', 'u');
      const m = t.match(re);
      if (!m) return;
      seenSw.add(sw.split(' ')[0]);
      const after = t.slice(m.index + sw.length, m.index + sw.length + 40);
      if (!/^[\s,(]*(software\s*)?(\(?\s*)?(v(ersion)?\.?\s*)?\d+(\.\d+)*|^[\s,(]*(software\s*)?(version|ver\.|v\.?)\s*[\dA-Z]|^\s*(20\d{2}|[0-9]{1,2}(\.\d+)+)|^\s*(R20\d\d[ab]?|Pro\s*\d|CC\s*20\d\d)/i.test(after)) add(P, m.index, m.index + sw.length, 'check', 'text', '6.1', `ซอฟต์แวร์ “${sw}” ต้องระบุเลขเวอร์ชันเมื่อกล่าวถึงครั้งแรก`, `Software “${sw}” needs its version number at first mention`, 'The software used for processing experimental data, analyzing statistics, programming modeling, and other operations within the experimental analysis section should be mentioned along with the version number.');
    });
    eachMatch(/\b(https?:\/\/|www\.)[^\s)\]]+/g, t, m => {
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 50);
      const isHome = /^(https?:\/\/)?(www\.)?[^\/]+\/?$/.test(m[0]);
      if (!/^\)?\s*\(accessed on \d{1,2} [A-Z][a-z]+ \d{4}\)/.test(after) && !/^\)?\s*[(\[]\s*(accessed|last accessed|retrieved|date accessed)/i.test(after) && !isHome) add(P, m.index, m.index + m[0].length, 'check', 'text', '6.1', 'ลิงก์เว็บไซต์ในเนื้อหาต้องมีวันที่เข้าถึง เช่น (accessed on 1 January 2021) (ยกเว้นหน้าแรก)', 'Website links in the text need an access date, e.g., (accessed on 1 January 2021) (homepages excepted)', 'The “accessed on” date of websites should be provided by the authors (e.g., https://www.mdpi.com/authors (accessed on 1 January 2021)). For homepages, access dates are not mandatory.');
    });
  });
  // notes / footnotes
  if (model.hasFootnotes) add(firstP, null, null, 'check', 'text', '6.1', 'เอกสารมี Footnote — MDPI อนุญาต Footnote เฉพาะวารสาร Laws (วารสารอื่นให้รวมเข้าเนื้อหา หรือใช้ Notes ถ้าวารสารอนุญาต)', 'The document uses footnotes — only the journal Laws allows footnotes (integrate into the text, or use Notes where allowed)', 'Notes and Footnotes: only one journal, “Laws”, is allowed to use Footnotes. For journals which are not allowed to use Notes and Footnotes, it is suggested to integrate the Notes or Footnotes into the main text.');

  return { findings, model };
}
