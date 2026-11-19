async function compareDocx(origBuf, doneBuf, opts) {
  const L = opts.lang || 'en'; const tx = (th, en) => L === 'th' ? th : en;
  const O = await loadPackage(origBuf);
  const D = await loadPackage(doneBuf);
  const removedComments = await stripAllComments(O.zip, O.dir, O.relsDoc, O.relsPath, O.files, O.rels);
  const model = buildModel(O.files);
  // Compare mode: 'main' = everything except the reference list; 'ref' = the reference list only
  const mode = opts.mode === 'ref' ? 'ref' : 'main';
  const refRange = texts => {
    let i = -1; texts.forEach((t, k) => { if (/^\s*(\d+\.?\s*)?(References|Reference List|Bibliography|Literature Cited|Works Cited)\s*:?\s*$/i.test(t)) i = k; });
    if (i < 0) return mode === 'ref' ? [0, texts.length] : [texts.length, texts.length];
    let e = texts.length; for (let k = i + 1; k < texts.length; k++) if (/^\s*(Disclaimer\/Publisher|Disclaimer|Publisher’s Note|Appendix\s+[A-Z]\b|Supplementary Materials|Abbreviations\b|Author Contributions)/i.test(texts[k])) { e = k; break; }
    return [i + 1, e];
  };
  const oParasNE = model.paras.filter(P => !P.empty);
  const [oR0, oR1] = refRange(oParasNE.map(P => P.text));
  const oRefSet = new Set(oParasNE.slice(oR0, oR1));
  const dRawAll = rawParagraphTexts(D.files.document);
  const [dR0, dR1] = refRange(dRawAll);
  let refStats = null;

  // ---- done token stream (all text, any order) ----
  const doneTexts = [...(mode === 'ref' ? dRawAll.slice(dR0, dR1) : dRawAll.slice(0, dR0).concat(dRawAll.slice(dR1))), ...(mode === 'ref' ? [] : [...rawParagraphTexts(D.files.footnotes), ...rawParagraphTexts(D.files.endnotes)])];
  const dTok = [], dRaw = []; doneTexts.forEach(s => cmpTokens(s).forEach(t => { dTok.push(t.t); dRaw.push(t.raw); }));
  const uni = new Map(), bi = new Set(), tri = new Set(), pos = new Map();
  dTok.forEach((t, i) => {
    uni.set(t, (uni.get(t) || 0) + 1);
    if (!pos.has(t)) pos.set(t, []); pos.get(t).push(i);
    if (i > 0) bi.add(dTok[i - 1] + '\u0001' + t);
    if (i > 1) tri.add(dTok[i - 2] + '\u0001' + dTok[i - 1] + '\u0001' + t);
  });
  const doneMath = new Set(mathStrings(D.files.document));
  const doneJoined = dTok.join(' ');

  const items = []; // {kind, P, s, e, text, detail}
  let totalTok = 0, missTok = 0;
  const greekText = P => { let out = ''; for (let i = 0; i < P.text.length; i++) { const ch = P.text[i], c = P.chars[i]; const symF = c && (c.sym ? isSymbolFont(c.sym) : (c.r && isSymbolFont(P.fmt(i).font))); out += symF && SYMBOL_GREEK[ch] ? SYMBOL_GREEK[ch] : ch; } return out; };
  const units = mode === 'ref' ? [] : model.paras.filter(P => !P.empty && !oRefSet.has(P)).map(P => ({ P, text: greekText(P) }));
  // original footnotes as extra (report only)
  if (mode !== 'ref') rawParagraphTexts(O.files.footnotes).forEach(s => units.push({ P: null, text: s, label: 'Footnote' }));
  // ---- v17: aligned word-level diff ----
  // Each original paragraph is matched to its Done paragraph (by shared word triples) and the two are
  // diffed word by word, so a word lost in one place is found even if the same words occur elsewhere.
  // Tables are matched cell by cell. Text that moved to another place is still accepted (counts compared).
  const DM = buildModel(D.files);
  const dParasNE = DM.paras.filter(P => !P.empty);
  const [dM0, dM1] = refRange(dParasNE.map(P => P.text));
  const dRefSet = new Set(dParasNE.slice(dM0, dM1));
  const tokP = P => { const src = greekText(P); return cmpTokens(src).map(t => ({ ...t, P, src, nx: src[t.e] || '' })); };
  const dUnits = DM.paras.filter(P => !P.empty && (mode === 'ref' || !dRefSet.has(P))).map((P, k) => ({ P, T: tokP(P).map(t => ({ ...t, k })) }));
  const SEP = '\u0001';
  const g3 = (T, i) => T[i].t + SEP + T[i + 1].t + SEP + T[i + 2].t;
  const triIdx = new Map();
  dUnits.forEach((du, k) => { const seen = new Set(); for (let i = 0; i + 2 < du.T.length; i++) { const g = g3(du.T, i); if (seen.has(g)) continue; seen.add(g); let a = triIdx.get(g); if (!a) triIdx.set(g, a = []); a.push(k); } });
  const oAll = []; units.forEach(u => cmpTokens(u.text).forEach(t => oAll.push(t.t)));
  const oStr = SEP + oAll.join(SEP) + SEP, dStr = SEP + dTok.join(SEP) + SEP;
  const cnt = (str, toks) => { if (!toks.length) return 0; const n = SEP + toks.join(SEP) + SEP; let c = 0, i = str.indexOf(n); while (i >= 0) { c++; i = str.indexOf(n, i + 1); } return c; };
  const ALN_NOISE = new Set([...[...CMP_NOISE].filter(w => !['no', 'type', 'paper', 'article', 'review', 'communication'].includes(w)), 'fig', 'tab', 'eq', 'ref']);
  const NEG = /^(in|de|un|non|dis|im|ir|il|anti)/;
  const simLocal = (a, b) => {
    if (a.t === b.t) return true;
    if (isNumTok(a.t) || isNumTok(b.t) || /^[<>≤≥=≈−±%×]$/.test(a.t) || /^[<>≤≥=≈−±%×]$/.test(b.t)) return false;
    if (GREEK_RE.test(a.t) || GREEK_RE.test(b.t)) { const g = x => (x.match(/[Ͱ-Ͽἀ-῿]/g) || []).join(''); if (g(a.t) !== g(b.t)) return false; }
    const pa = a.t.match(NEG), pb = b.t.match(NEG);
    if ((pa || pb) && a.t.slice(pa ? pa[0].length : 0) === b.t.slice(pb ? pb[0].length : 0)) return false; // increase/decrease, significant/insignificant
    const [s, l] = a.t.length <= b.t.length ? [a, b] : [b, a];
    if (s.t.length >= 2 && l.t.startsWith(s.t) && s.nx === '.') return true; // abbreviation “Biol.” = “biology”
    const L = l.t.length; if (L <= 4 || a.t[0] !== b.t[0]) return false;
    return lev(a.t, b.t) <= (L >= 8 ? 2 : 1);
  };
  const lcsOps = (A, B) => {
    const n = A.length, m = B.length; if (n * m > 4e6) return null;
    const W1 = m + 1, LT = new Uint16Array((n + 1) * W1);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) LT[i * W1 + j] = A[i].t === B[j].t ? LT[(i + 1) * W1 + j + 1] + 1 : Math.max(LT[(i + 1) * W1 + j], LT[i * W1 + j + 1]);
    const ops = []; let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i].t === B[j].t) { ops.push({ o: '=', a: A[i], b: B[j] }); i++; j++; }
      else if (j >= m || (i < n && LT[(i + 1) * W1 + j] >= LT[i * W1 + j + 1])) { ops.push({ o: '-', a: A[i] }); i++; }
      else { ops.push({ o: '+', b: B[j] }); j++; }
    }
    return ops;
  };
  const LOOK = { 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X' };
  const clip = s => s.length > 160 ? s.slice(0, 157) + '…' : s;
  const sliceOf = arr => { const same = arr.filter(x => x.P === arr[0].P); return clip(same[0].src.slice(same[0].s, same[same.length - 1].e)); };
  const procHunk = (D0, I0, prevA, nextA, strict, prevB, nextB) => {
    let Dl = D0.slice(), Il = I0.slice();
    // a Latin letter in place of a Greek one (“A” is dropped as a stop word, so look at the raw gap)
    if (D0.some(d => GREEK_RE.test(d.t)) && prevB && nextB && prevB.P === nextB.P) { const gap = prevB.src.slice(prevB.e, nextB.s); (gap.match(/(?<![\p{L}])[A-Za-z](?![\p{L}])/gu) || []).forEach(ch => { if (!Il.some(x => x.raw === ch)) Il.push({ t: ch.toLowerCase(), raw: ch, P: prevB.P, src: prevB.src, s: prevB.e + gap.indexOf(ch), e: prevB.e + gap.indexOf(ch) + 1, nx: '' }); }); }
    for (const d of D0) if (GREEK_RE.test(d.t)) {
      const k = Il.findIndex(x => x.t !== d.t && x.t.toLowerCase() === d.t.toLowerCase() || (x.t.length === 1 && d.t.length === 1 && !GREEK_RE.test(x.t)));
      if (k < 0) continue;
      const toRaw = Il[k].raw, look = LOOK[toRaw];
      missTok++; items.push({ kind: 'changed', P: d.P, s: d.s, e: d.e, text: d.src, from: d.src.slice(d.s, d.e), to: look ? tx(`${toRaw} (อักษรกรีกตัวใหญ่ ดูเหมือน “${look}”)`, `${toRaw} (Greek capital letter that looks like “${look}”)`) : toRaw });
      Dl = Dl.filter(x => x !== d); Il.splice(k, 1);
    }
    const usedI = new Set();
    Dl = Dl.filter(d => { const k = Il.findIndex((x, ix) => !usedI.has(ix) && simLocal(d, x)); if (k >= 0) { usedI.add(k); return false; } return true; });
    Il = Il.filter((_, ix) => !usedI.has(ix));
    Dl = Dl.filter(d => !ALN_NOISE.has(d.t)); Il = Il.filter(x => !ALN_NOISE.has(x.t));
    if (!Dl.length && !Il.length) return;
    const dSeq = Dl.map(x => x.t), iSeq = Il.map(x => x.t);
    const dGone = Dl.length && (strict || cnt(dStr, dSeq) < cnt(oStr, dSeq));
    const iNew = Il.length && (strict || cnt(oStr, iSeq) < cnt(dStr, iSeq));
    if (!dGone && !iNew) return;
    if (dGone) {
      const same = Dl.filter(x => x.P === Dl[0].P); const s = same[0].s, e = same[same.length - 1].e, src = Dl[0].src;
      missTok += Dl.length;
      if (iNew) {
        const all = Dl.concat(Il);
        const kind = (/\[[^\]]*$/.test(src.slice(0, s)) && /^[^\[]*\]/.test(src.slice(e))) ? 'cite' : all.some(x => /^[<>≤≥=≈−±]$/.test(x.t)) ? 'symbol' : all.some(x => isNumTok(x.t)) ? 'number' : 'changed';
        items.push({ kind, P: Dl[0].P, s, e, text: src, from: clip(src.slice(s, e)), to: sliceOf(Il) });
      } else {
        const cite = /\[[^\]]*$/.test(src.slice(0, s)) && /^[^\[]*\]/.test(src.slice(e)) && Dl.every(x => isNumTok(x.t));
        items.push({ kind: cite ? 'cite' : Dl.length === 1 && /^[<>≤≥=≈−±]$/.test(Dl[0].t) ? 'symbol' : 'missing', P: Dl[0].P, s, e, text: src, from: clip(src.slice(s, e)), to: cite ? tx('(หายไป)', '(removed)') : undefined });
      }
    } else {
      const at = prevA || nextA; if (!at) return;
      items.push({ kind: 'inserted', P: at.P, s: at.s, e: at.e, text: at.src, from: at.src.slice(at.s, at.e), to: sliceOf(Il), after: !!prevA });
    }
  };
  const VNAME = v => v === 'superscript' ? tx('ตัวยก', 'superscript') : v === 'subscript' ? tx('ตัวห้อย', 'subscript') : tx('ตัวปกติ', 'normal');
  const vOf = tk => { const f = tk.P.fmt(tk.s); const v = f && f.vert; return v === 'superscript' || v === 'subscript' ? v : ''; };
  let fmtRun = null;
  const flushFmt = () => { if (fmtRun) { items.push({ kind: 'format', P: fmtRun.P, s: fmtRun.s, e: fmtRun.e, text: fmtRun.src, from: fmtRun.src.slice(fmtRun.s, fmtRun.e), to: VNAME(fmtRun.dv), fromV: VNAME(fmtRun.ov) }); missTok++; fmtRun = null; } };
  const fmtCheck = op => {
    const ov = vOf(op.a); if (!ov) { flushFmt(); return; }
    const dv = vOf(op.b); if (dv === ov) { flushFmt(); return; }
    if (fmtRun && fmtRun.P === op.a.P && fmtRun.ov === ov && fmtRun.dv === dv && op.a.s - fmtRun.e <= 2) { fmtRun.e = op.a.e; return; }
    flushFmt(); fmtRun = { P: op.a.P, s: op.a.s, e: op.a.e, src: op.a.src, ov, dv };
  };
  const walkOps = (ops, insOk, strict) => {
    let D0 = [], I0 = [], prevA = null, prevB = null;
    const flush = (nextA, nextB) => { if (D0.length || I0.length) procHunk(D0, I0, prevA, nextA, strict, prevB, nextB); D0 = []; I0 = []; };
    ops.forEach((op, ix) => {
      if (op.o === '=') { flush(op.a, op.b); prevA = op.a; prevB = op.b; fmtCheck(op); }
      else if (op.o === '-') D0.push(op.a);
      else if (insOk(op, ix)) I0.push(op.b);
    });
    flush(null); flushFmt();
  };
  // tables: pair each original table with the most similar Done table, then compare cell by cell
  const cellDone = new Set();
  {
    const oT = mode === 'ref' ? [] : model.tables.filter(t => t.depth === 0 && !t.hasMath), dT = DM.tables.filter(t => t.depth === 0 && !t.hasMath);
    const tset = T => new Set(T.paras.flatMap(p => cmpTokens(p.text).map(x => x.t)));
    const dSets = dT.map(tset); const usedT = new Set();
    oT.forEach(ot => {
      const os = tset(ot); if (os.size < 3) return;
      let bj = -1, bsim = 0;
      dSets.forEach((ds, j) => { if (usedT.has(j)) return; let inter = 0; os.forEach(x => { if (ds.has(x)) inter++; }); const sim = inter / Math.max(os.size, ds.size); if (sim > bsim) { bsim = sim; bj = j; } });
      if (bj < 0 || bsim < 0.5) return;
      usedT.add(bj); const dt = dT[bj];
      const cEmpty = c => !c.paras.some(p => p.text.trim());
      const compact = T => T.rows.map(r => r.filter(c => !cEmpty(c))).filter(r => r.length);
      const oc = compact(ot), dc = compact(dt);
      ot.paras.forEach(p => cellDone.add(p));
      const shape = R => R.map(r => r.length).join(',');
      const ckey = c => c.paras.flatMap(tokP).map(x => x.t).join(' ');
      const P0 = ot.paras.find(p => !p.empty);
      let cellwise = shape(oc) === shape(dc);
      if (cellwise) { let diff = 0, tot = 0; oc.forEach((r, i) => r.forEach((c, j) => { tot++; if (ckey(c) !== ckey(dc[i][j])) diff++; })); if (diff > Math.max(3, 0.2 * tot)) cellwise = false; }
      if (cellwise) {
        oc.forEach((r, i) => r.forEach((c, j) => {
          const A = c.paras.flatMap(tokP), B = dc[i][j].paras.flatMap(tokP);
          if (!A.length) return;
          const ops = lcsOps(A, B); if (!ops) return;
          walkOps(ops, () => true, true);
        }));
        return;
      }
      // rearranged table (rows/columns moved, merged or transposed): compare the cell values as a bag
      const ncol = R => Math.max(0, ...R.map(r => r.length));
      const bag = new Map(); dc.forEach(r => r.forEach(c => { const k = ckey(c); if (k) bag.set(k, (bag.get(k) || 0) + 1); }));
      const lost = [];
      oc.forEach(r => r.forEach(c => { const k = ckey(c); if (!k) return; if (bag.get(k)) bag.set(k, bag.get(k) - 1); else lost.push(c); }));
      const added = []; dc.forEach(r => r.forEach(c => { const k = ckey(c); if (k && bag.get(k) > 0) { bag.set(k, bag.get(k) - 1); added.push(c.paras.map(p => p.text).join(' ').trim()); } }));
      if (P0 && (lost.length || added.length)) items.push({ kind: 'table', P: P0, s: 0, e: Math.max(1, P0.text.length), text: P0.text, from: `${oc.length}×${ncol(oc)}`, to: `${dc.length}×${ncol(dc)}`, bag: true, same: shape(oc) === shape(dc) });
      lost.forEach(c => { const p = c.paras.find(x => x.text.trim()); if (p) { const t = p.text.trim(); const s0 = p.text.indexOf(t); items.push({ kind: 'cellmiss', P: p, s: s0, e: s0 + t.length, text: p.text, from: c.paras.map(x => x.text).join(' ').trim() }); missTok++; } });
      if (added.length && P0) items.push({ kind: 'celladd', P: P0, s: 0, e: Math.max(1, P0.text.length), text: P0.text, to: added.slice(0, 12).join(' | ') + (added.length > 12 ? ` | … (+${added.length - 12})` : ''), n: added.length });
    });
  }
  let lastK = -1;
  const alignUnit = (u, T) => {
    if (T.length < 3) return false;
    const sc = new Map();
    for (let i = 0; i + 2 < T.length; i++) { const a = triIdx.get(g3(T, i)); if (!a || a.length > 30) continue; for (const k of a) sc.set(k, (sc.get(k) || 0) + 1); }
    let bk = -1, bs = 0;
    sc.forEach((s, k) => { if (s > bs || (s === bs && Math.abs(k - lastK - 1) < Math.abs(bk - lastK - 1))) { bk = k; bs = s; } });
    if (bk < 0 || bs < Math.max(1, 0.3 * (T.length - 2))) return false;
    const A = T.map(t => ({ ...t, P: u.P, src: u.text, nx: u.text[t.e] || '' }));
    const B = []; for (let k = Math.max(0, bk - 1); k <= Math.min(dUnits.length - 1, bk + 1); k++) B.push(...dUnits[k].T);
    const ops = lcsOps(A, B); if (!ops) return false;
    lastK = bk;
    walkOps(ops, op => op.b.k === bk, false);
    return true;
  };

  for (const u of units) {
    const T = cmpTokens(u.text);
    // typed list labels (“20. ”, “2.1. ”) are often replaced by Word auto-numbering in the Done file
    if (T.length > 1 && T[0].s === u.text.search(/\S/) && /^\s*\d{1,3}(\.\d{1,3})*[.)]?[\s\t]/.test(u.text) && isNumTok(T[0].t)) T.shift();
    if (!T.length) continue;
    totalTok += T.length;
    if (u.P && (cellDone.has(u.P) || alignUnit(u, T))) continue;
    const cov = new Array(T.length).fill(false);
    const key = (...a) => a.join('\u0001');
    if (T.length === 1) cov[0] = uni.has(T[0].t);
    else if (T.length === 2) { cov[0] = cov[1] = bi.has(key(T[0].t, T[1].t)) || (uni.has(T[0].t) && uni.has(T[1].t)); }
    else {
      for (let i = 0; i + 2 < T.length; i++) if (tri.has(key(T[i].t, T[i + 1].t, T[i + 2].t))) cov[i] = cov[i + 1] = cov[i + 2] = true;
      for (let i = 0; i < T.length; i++) if (!cov[i]) {
        const lb = i > 0 && bi.has(key(T[i - 1].t, T[i].t)), rb = i + 1 < T.length && bi.has(key(T[i].t, T[i + 1].t));
        if (lb && rb) cov[i] = true;
        else if ((i === 0 && rb) || (i === T.length - 1 && lb)) cov[i] = true;
      }
    }
    const nCov = cov.filter(Boolean).length;
    const whole = T.length >= 4 && nCov / T.length < 0.25;
    if (whole) {
      const rest = T.filter(t => !CMP_NOISE.has(t.t));
      if (!rest.length) continue;
      missTok += T.length;
      items.push({ kind: 'para', P: u.P, s: T[0].s, e: T[T.length - 1].e, text: u.text, label: u.label, tokens: T.length });
      continue;
    }
    // runs of uncovered tokens
    for (let i = 0; i < T.length;) {
      if (cov[i]) { i++; continue; }
      let j = i; while (j + 1 < T.length && !cov[j + 1]) j++;
      let run = T.slice(i, j + 1);
      i = j + 1;
      if (run.every(t => CMP_NOISE.has(t.t))) continue;
      const a = T[T.indexOf(run[0]) - 1], b = T[T.indexOf(run[run.length - 1]) + 1];
      // find the same context in done to tell substitution from deletion
      let best = null, bestRaw = null;
      const tryCtx = () => {
        if (!a && !b) return;
        const starts = a ? (pos.get(a.t) || []).slice(0, 400) : [];
        for (const p0 of starts) {
          for (let k = p0 + 1; k <= Math.min(dTok.length - 1, p0 + run.length + 4); k++) {
            if (b && dTok[k] === b.t) { const R = dTok.slice(p0 + 1, k); if (!best || Math.abs(R.length - run.length) < Math.abs(best.length - run.length)) { best = R; bestRaw = dRaw.slice(p0 + 1, k); } break; }
            if (!b && k === p0 + run.length) { const R = dTok.slice(p0 + 1, k + 1); if (!best) { best = R; bestRaw = dRaw.slice(p0 + 1, k + 1); } }
          }
        }
        if (!a && b) for (const p1 of (pos.get(b.t) || []).slice(0, 400)) { const R = dTok.slice(Math.max(0, p1 - run.length), p1); if (!best) { best = R; bestRaw = dRaw.slice(Math.max(0, p1 - run.length), p1); } }
      };
      const anchored = !!(a && b);
      tryCtx();
      // a Greek letter whose case changed (α → Α, which reads as “A”) is reported on its own, apart from the rest of the run
      if (best && best.length) for (const g of run.filter(t => GREEK_RE.test(t.t))) {
        const k = best.findIndex(x => x !== g.t && x.toLowerCase() === g.t.toLowerCase());
        if (k < 0) continue;
        missTok++;
        const toRaw = (bestRaw || best)[k];
        const look = { 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X' }[toRaw];
        items.push({ kind: 'changed', P: u.P, s: g.s, e: g.e, text: u.text, label: u.label, from: u.text.slice(g.s, g.e), to: look ? tx(`${toRaw} (อักษรกรีกตัวใหญ่ ดูเหมือน “${look}”)`, `${toRaw} (Greek capital letter that looks like “${look}”)`) : toRaw });
        run = run.filter(t => t !== g); best = best.filter((_, ix) => ix !== k); if (bestRaw) bestRaw = bestRaw.filter((_, ix) => ix !== k);
      }
      if (!run.length || run.every(t => CMP_NOISE.has(t.t))) continue;
      const runT = run.map(t => t.t);
      // same-length context where only Greek letters changed (α → A): report each letter as changed
      if (best && best.length === run.length && run.some(t => GREEK_RE.test(t.t))) {
        const diff = run.map((t, ix) => similarTok(t.t, best[ix]) ? null : ix).filter(ix => ix !== null);
        if (diff.length && diff.every(ix => GREEK_RE.test(run[ix].t))) {
          for (const ix of diff) { missTok++; items.push({ kind: 'changed', P: u.P, s: run[ix].s, e: run[ix].e, text: u.text, label: u.label, from: u.text.slice(run[ix].s, run[ix].e), to: (bestRaw || best)[ix] }); }
          continue;
        }
      }
      if (best && best.length) {
        const used = new Set();
        const allSim = runT.every(t => { const k = best.findIndex((x, ix) => !used.has(ix) && similarTok(t, x)); if (k >= 0) { used.add(k); return true; } return CMP_NOISE.has(t); });
        if (allSim) continue;
        // done kept part of the run: report only the tokens that disappeared
        const used2 = new Set(); const keep = run.map(t => { const k = best.findIndex((x, ix) => !used2.has(ix) && similarTok(t.t, x)); if (k >= 0) { used2.add(k); return true; } return false; });
        if (used2.size === best.length && keep.some(Boolean)) {
          const lost = run.filter((t, ix) => !keep[ix] && !CMP_NOISE.has(t.t));
          if (!lost.length) continue;
          missTok += lost.length;
          items.push({ kind: 'missing', P: u.P, s: lost[0].s, e: lost[lost.length - 1].e, text: u.text, label: u.label, from: u.text.slice(lost[0].s, lost[lost.length - 1].e) });
          continue;
        }
      }
      if (best && best.length && anchored && best.length >= run.length / 2 && run.length <= 8) {
        const numChanged = runT.some(isNumTok) || best.some(isNumTok);
        missTok += run.length;
        items.push({ kind: numChanged ? 'number' : 'changed', P: u.P, s: run[0].s, e: run[run.length - 1].e, text: u.text, label: u.label, from: u.text.slice(run[0].s, run[run.length - 1].e), to: (bestRaw || best).join(' ') });
        continue;
      }
      // single word that still exists somewhere nearby with a near spelling → ignore
      if (run.length === 1 && !isNumTok(runT[0]) && [...uni.keys()].some(k => k.length > 3 && similarTok(runT[0], k) && runT[0][0] === k[0] && Math.abs(k.length - runT[0].length) <= 2)) continue;
      missTok += run.length;
      items.push({ kind: 'missing', P: u.P, s: run[0].s, e: run[run.length - 1].e, text: u.text, label: u.label, from: u.text.slice(run[0].s, run[run.length - 1].e) });
    }
  }
  // equations
  for (const P of model.paras) P.chars.forEach((c, i) => {
    if (!c.math || mode === 'ref') return;
    const s = (c.mathText || '').replace(/\s+/g, '').normalize('NFKC');
    if (!s || s.length < 2) return;
    if (doneMath.has(s)) return;
    const toks = cmpTokens(c.mathText).map(t => t.t).join(' ');
    if (toks && doneJoined.includes(toks)) return;
    items.push({ kind: 'math', P, s: i, e: i + 1, text: P.text, from: c.mathText });
  });
  // images
  const doneHashes = new Map(); Object.values(D.images).forEach(im => doneHashes.set(im.hash, (doneHashes.get(im.hash) || 0) + 1));
  const origImgs = [];
  model.paras.forEach(P => P.drawings.forEach((dr, di) => dr.rids.forEach(id => { const im = O.images[id]; if (im) origImgs.push({ P, im, di }); })));
  const doneImgCount = (D.files.document.match(/<(a:blip|v:imagedata)\b/g) || []).length;
  const origImgCount = (O.files.document.match(/<(a:blip|v:imagedata)\b/g) || []).length;
  const imgMissing = [];
  origImgs.forEach(x => {
    const n = doneHashes.get(x.im.hash) || 0;
    if (n > 0) { doneHashes.set(x.im.hash, n - 1); return; }
    imgMissing.push(x);
  });
  if (mode !== 'ref') imgMissing.forEach(x => {
    const ci = x.P.chars.findIndex(c => c.drawing);
    items.push({ kind: 'image', P: x.P, s: Math.max(0, ci), e: Math.max(1, ci + 1), text: x.P.text, img: x.im });
  });
  // tables
  const origTables = model.tables.filter(t => t.depth === 0).length;
  const doneTables = (D.files.document.match(/<w:tbl>/g) || []).length;

  // ---- v19: Reference mode — compare the reference lists entry by entry; formatting is ignored ----
  if (mode === 'ref') {
    const oRefs = model.paras.filter(P => oRefSet.has(P) && !P.empty);
    const dRefs = DM.paras.filter(P => dRefSet.has(P) && !P.empty);
    const URLISH = /https?:\/\/\S+|\bdoi:\s*\S+|\b10\.\d{4,9}\/\S+|\bPMID:?\s*\d+|\bPMCID:?\s*PMC\d+/gi;
    const normDoi = s => (s.match(/10\.\d{4,9}\/[^\s,;]+/) || [''])[0].replace(/[.)\]]+$/, '').toLowerCase();
    const refTok = P => {
      const src = greekText(P); const out = [];
      const skip = []; let m; URLISH.lastIndex = 0; while ((m = URLISH.exec(src)) !== null) skip.push([m.index, m.index + m[0].length]);
      const inSkip = i => skip.some(([a, b]) => i >= a && i < b);
      const re = /[\p{L}\p{M}]+|\p{N}+/gu;
      while ((m = re.exec(src)) !== null) {
        const s = m.index, e = s + m[0].length, raw = m[0];
        if (inSkip(s)) continue;
        // typed list number at the start (“1.”, “[1]”)
        if (!out.length && /^\p{N}+$/u.test(raw) && /^\s*\[?$/.test(src.slice(0, s)) && /^[\].)]?\s/.test(src.slice(e))) continue;
        // issue number “43(38):” is removed by the MDPI style
        if (/^\p{N}+$/u.test(raw) && /\p{N}\s*\($/u.test(src.slice(Math.max(0, s - 3), s)) && /^\)\s*([:,.;]|$)/.test(src.slice(e))) continue;
        // month in a date (“Mar. 2024”, “June 2020”) — the MDPI style drops it
        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*$/.test(raw) && /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/.test(raw) && /^\.?\s*[–\-]?\s*\p{N}/u.test(src.slice(e))) continue;
        // issue / article numbers written “no. 3”, “Art. no. 14” (MDPI drops the issue number)
        if (/^\p{N}+$/u.test(raw) && /\b(no|No|nr|Nr)\.?\s*$/.test(src.slice(Math.max(0, s - 6), s))) continue;
        if (/^(Art|art|Proceedings|proceedings|Proc|proc)$/.test(raw)) continue;
        if (/^[Aa]$/.test(raw) && /([:.?!—]|^|[“"‘'«])\s*$/.test(src.slice(Math.max(0, s - 3), s)) && /[“"‘'«]\s*$|[:.?!—]\s*$/.test(src.slice(0, s)) && /^\s+[\p{L}\p{N}]/u.test(src.slice(e))) continue; // the article “A systematic review”
        if (/^[Aa]$/.test(raw) && /[:.?!—]\s*$/.test(src.slice(0, s)) && /^\s+[\p{L}\p{N}]/u.test(src.slice(e))) continue; // the article “A systematic review”
        if (/^[A-Z]{1,3}$/.test(raw)) {
          // author initials “MM” = “M.M.” (a lone capital is kept, even “A”)
          for (let k = 0; k < raw.length; k++) out.push({ t: raw[k].toLowerCase(), raw: raw[k], s: s + k, e: s + k + 1, P, src });
          continue;
        }
        let t = cmpNorm(raw);
        // abbreviated page range “3618-731” = “3618–3731”
        const prev = out[out.length - 1];
        let s1 = s;
        if (/^\d+$/.test(t) && prev && /^\d+$/.test(prev.t) && /^\s*[-–—‐]+\s*$/.test(src.slice(prev.e, s)) && t.length < prev.t.length) { t = prev.t.slice(0, prev.t.length - t.length) + t; s1 = prev.s; }
        if (CMP_STOP.has(t) || CMP_NOISE.has(t)) continue;
        out.push({ t, raw, s: s1, e, P, src });
      }
      return out;
    };
    const oT = oRefs.map(refTok), dTk = dRefs.map(refTok);
    const sameWord = (a, b) => {
      if (a.t === b.t) return true;
      if (isNumTok(a.t) || isNumTok(b.t)) return false;
      const [s, l] = a.t.length <= b.t.length ? [a.t, b.t] : [b.t, a.t];
      if (s.length >= 2 && l.startsWith(s)) return true; // abbreviation “Physiol” = “Physiology”
      if (s.length >= 3 && s[0] === l[0]) { let k = 0; for (const ch of l) if (ch === s[k]) k++; if (k === s.length) return true; } // “Natl” = “National”
      return false;
    };
    // pair each original entry with its Done entry (order may change)
    const sets = dTk.map(T => new Set(T.map(x => x.t)));
    const pairs = [];
    oT.forEach((T, i) => { const os = new Set(T.map(x => x.t)); sets.forEach((ds, j) => { let inter = 0; os.forEach(x => { if (ds.has(x)) inter++; }); const sc = inter / Math.max(1, Math.min(os.size, ds.size)); if (sc >= 0.5) pairs.push({ i, j, sc }); }); });
    pairs.sort((a, b) => b.sc - a.sc || Math.abs(a.i - a.j) - Math.abs(b.i - b.j));
    const oTo = new Map(), dTo = new Map();
    for (const p of pairs) if (!oTo.has(p.i) && !dTo.has(p.j)) { oTo.set(p.i, p.j); dTo.set(p.j, p.i); }
    const whole = P => { const T = refTok(P); const src = greekText(P); const a = T.length ? T[0].s : 0, b = T.length ? T[T.length - 1].e : src.length; return { s: a, e: Math.max(a + 1, b), src }; };
    oRefs.forEach((P, i) => {
      if (oTo.has(i)) return;
      const w = whole(P); missTok += oT[i].length;
      items.push({ kind: 'refmiss', P, s: w.s, e: w.e, text: w.src, from: clip(w.src.slice(w.s, w.e)) });
    });
    dRefs.forEach((P, j) => {
      if (dTo.has(j)) return;
      let k = j - 1; while (k >= 0 && !dTo.has(k)) k--;
      const at = k >= 0 ? oRefs[dTo.get(k)] : oRefs[0]; if (!at) return;
      const w = whole(at); const ds = greekText(P);
      items.push({ kind: 'refnew', P: at, s: w.s, e: Math.min(w.e, w.s + 12), text: w.src, to: clip(ds.trim()), after: k >= 0, pos: j + 1 });
    });
    // order: entries outside the longest increasing run moved
    {
      const seq = [...oTo.entries()].sort((a, b) => a[0] - b[0]);
      const n = seq.length, len = new Array(n).fill(1), prv = new Array(n).fill(-1);
      for (let x = 0; x < n; x++) for (let y = 0; y < x; y++) if (seq[y][1] < seq[x][1] && len[y] + 1 > len[x]) { len[x] = len[y] + 1; prv[x] = y; }
      let best = -1; for (let x = 0; x < n; x++) if (best < 0 || len[x] > len[best]) best = x;
      const keep = new Set(); for (let x = best; x >= 0; x = prv[x]) keep.add(x);
      seq.forEach(([i, j], x) => { if (keep.has(x)) return; const w = whole(oRefs[i]); items.push({ kind: 'reorder', P: oRefs[i], s: w.s, e: Math.min(w.e, w.s + 12), text: w.src, from: String(i + 1), to: String(j + 1) }); });
    }
    // within each pair: words/numbers lost or added
    oTo.forEach((j, i) => {
      const A = oT[i], B = dTk[j]; totalTok += A.length;
      const od = normDoi(greekText(oRefs[i])), dd = normDoi(greekText(dRefs[j]));
      if (od && od !== dd) { const src = greekText(oRefs[i]); const k = src.toLowerCase().indexOf(od); items.push({ kind: dd ? 'number' : 'missing', P: oRefs[i], s: Math.max(0, k), e: k >= 0 ? k + od.length : src.length, text: src, from: od, to: dd || undefined, doi: true }); }
      const ops = lcsOps(A, B); if (!ops) return;
      // words that only moved inside the entry (“C. Praharaj” → “Praharaj, C.”, year moved) are not lost or added
      const cnt = T => { const m = new Map(); T.forEach(x => m.set(x.t, (m.get(x.t) || 0) + 1)); return m; };
      const cA = cnt(A), cB = cnt(B);
      const movedD = d => (cB.get(d.t) || 0) >= (cA.get(d.t) || 0) || (!isNumTok(d.t) && d.t.length >= 2 && B.some(x => !cA.has(x.t) && sameWord(d, x)));
      const movedI = x => (cA.get(x.t) || 0) >= (cB.get(x.t) || 0) || (!isNumTok(x.t) && x.t.length >= 2 && A.some(d => !cB.has(d.t) && sameWord(d, x)));
      let D0 = [], I0 = [], prevA = null;
      const flush = nextA => {
        if (!D0.length && !I0.length) return;
        D0 = D0.filter(d => !movedD(d)); I0 = I0.filter(x => !movedI(x));
        // initials alone (“A” lost here, “A” added there) are name-format noise; a lost author also loses the surname
        const ini = x => /^\p{L}$/u.test(x.t) && !GREEK_RE.test(x.t) && !GREEK_RE.test(x.raw || ''); if (D0.every(ini)) D0 = []; if (I0.every(ini)) I0 = [];
        if (!D0.length && !I0.length) return;
        const used = new Set();
        let Dl = D0.filter(d => { const k = I0.findIndex((x, ix) => !used.has(ix) && sameWord(d, x)); if (k >= 0) { used.add(k); return false; } return true; });
        let Il = I0.filter((_, ix) => !used.has(ix));
        D0 = []; I0 = [];
        // a Greek letter whose case changed (α → Α, which reads as “A”) is its own item
        Dl = Dl.filter(d => { if (!GREEK_RE.test(d.t)) return true; const k = Il.findIndex(x => x.t !== d.t && x.t.toLowerCase() === d.t.toLowerCase()); if (k < 0) return true; const toRaw = Il[k].raw, look = LOOK[toRaw]; items.push({ kind: 'changed', P: d.P, s: d.s, e: d.e, text: d.src, from: d.src.slice(d.s, d.e), to: look ? tx(`${toRaw} (อักษรกรีกตัวใหญ่ ดูเหมือน “${look}”)`, `${toRaw} (Greek capital letter that looks like “${look}”)`) : toRaw }); Il.splice(k, 1); return false; });
        if (!Dl.length && !Il.length) return;
        const span = arr => { const same = arr.filter(x => x.P === arr[0].P); return [same[0].s, same[same.length - 1].e, same[0].src]; };
        if (Dl.length) {
          const [s, e, src] = span(Dl); missTok += Dl.length;
          if (Il.length) { const [s2, e2, src2] = span(Il); items.push({ kind: Dl.concat(Il).some(x => isNumTok(x.t)) ? 'number' : 'changed', P: Dl[0].P, s, e, text: src, from: clip(src.slice(s, e)), to: clip(src2.slice(s2, e2)) }); }
          else items.push({ kind: 'missing', P: Dl[0].P, s, e, text: src, from: clip(src.slice(s, e)) });
        } else {
          const at = prevA || nextA; if (!at) return;
          const [s2, e2, src2] = span(Il);
          items.push({ kind: 'inserted', P: at.P, s: at.s, e: at.e, text: at.src, from: at.src.slice(at.s, at.e), to: clip(src2.slice(s2, e2)), after: !!prevA });
        }
      };
      ops.forEach(op => { if (op.o === '=') { flush(op.a); prevA = op.a; } else if (op.o === '-') D0.push(op.a); else I0.push(op.b); });
      flush(null);
    });
    refStats = { origRefs: oRefs.length, doneRefs: dRefs.length, matched: oTo.size };
  }

  // ---- findings for comments in the original ----
  const msg = it => {
    switch (it.kind) {
      case 'refmiss': return tx('ไม่พบรายการอ้างอิงนี้ในไฟล์ Done (หายไปทั้งรายการ)', 'This reference was not found in the Done file (removed)');
      case 'refnew': return tx(`ไฟล์ Done มีรายการอ้างอิงใหม่ (ลำดับที่ ${it.pos}) ${it.after ? 'ต่อจากรายการนี้' : 'ก่อนรายการนี้'}: “${it.to}”`, `The Done file has a new reference (no. ${it.pos}) ${it.after ? 'after' : 'before'} this one: “${it.to}”`);
      case 'reorder': return tx(`รายการนี้ย้ายลำดับ: ต้นฉบับลำดับที่ ${it.from} → Done ลำดับที่ ${it.to}`, `This reference moved: Original no. ${it.from} → Done no. ${it.to}`);
      case 'para': return tx(`ไม่พบย่อหน้านี้ในไฟล์ Done (หายไปหรือถูกเขียนใหม่ทั้งย่อหน้า)`, 'This paragraph was not found in the Done file (removed or completely rewritten)');
      case 'missing': if (it.doi) return tx(`DOI หายไปในไฟล์ Done: “${it.from}”`, `DOI is missing from the Done file: “${it.from}”`); return tx(`ข้อความนี้หายไปในไฟล์ Done: “${it.from}”`, `This text is missing from the Done file: “${it.from}”`);
      case 'number': if (it.doi) return tx(`DOI เปลี่ยน: ต้นฉบับ “${it.from}” → Done “${it.to}”`, `DOI changed: Original “${it.from}” → Done “${it.to}”`); return tx(`ตัวเลขเปลี่ยน: ต้นฉบับ “${it.from}” → Done “${it.to}”`, `Number changed: Original “${it.from}” → Done “${it.to}”`);
      case 'changed': return tx(`ข้อความถูกเปลี่ยน: ต้นฉบับ “${it.from}” → Done “${it.to}”`, `Wording changed: Original “${it.from}” → Done “${it.to}”`);
      case 'math': return tx('ไม่พบสมการนี้ในไฟล์ Done', 'This equation was not found in the Done file');
      case 'cite': return it.to && it.to !== tx('(หายไป)', '(removed)') ? tx(`เลขอ้างอิงเปลี่ยน: ต้นฉบับ “${it.from}” → Done “${it.to}”`, `Citation changed: Original “${it.from}” → Done “${it.to}”`) : tx(`เลขอ้างอิง “${it.from}” หายไปในไฟล์ Done`, `Citation “${it.from}” is missing from the Done file`);
      case 'symbol': return it.to ? tx(`สัญลักษณ์เปลี่ยน: ต้นฉบับ “${it.from}” → Done “${it.to}”`, `Symbol changed: Original “${it.from}” → Done “${it.to}”`) : tx(`สัญลักษณ์ “${it.from}” หายไปในไฟล์ Done (เช่น เครื่องหมายลบ/มากกว่า/น้อยกว่า)`, `The symbol “${it.from}” is missing from the Done file (e.g., minus, greater/less than)`);
      case 'format': return tx(`ตัวยก/ตัวห้อยเปลี่ยน: “${it.from}” ต้นฉบับเป็น${it.fromV} → Done เป็น${it.to}`, `Superscript/subscript changed: “${it.from}” is ${it.fromV} in the Original → ${it.to} in Done`);
      case 'inserted': return tx(`ไฟล์ Done มีข้อความเพิ่ม${it.after ? 'หลัง' : 'ก่อน'}คำนี้: “${it.to}”`, `The Done file has added text ${it.after ? 'after' : 'before'} this word: “${it.to}”`);
      case 'cellmiss': return tx(`ค่าในเซลล์นี้ไม่พบในตารางของไฟล์ Done: “${it.from}”`, `This cell value is not in the Done table: “${it.from}”`);
      case 'celladd': return tx(`ตารางในไฟล์ Done มีค่าที่ไม่มีในต้นฉบับ ${it.n} เซลล์: “${it.to}”`, `The Done table has ${it.n} cell value(s) not in the Original: “${it.to}”`);
      case 'table': if (it.bag) return tx(`ตารางถูกจัดใหม่ (${it.same ? 'ย้ายแถว/คอลัมน์' : `ต้นฉบับ ${it.from} → Done ${it.to} ไม่นับเซลล์ว่าง`}) จึงเทียบเฉพาะค่าที่หายหรือเพิ่ม ไม่สนตำแหน่ง`, `Table rearranged (${it.same ? 'rows/columns moved' : `Original ${it.from} → Done ${it.to}, empty cells ignored`}); only values lost or added are compared, not positions`); return tx(
`จำนวนแถว×คอลัมน์ของตารางเปลี่ยน: ต้นฉบับ ${it.from} → Done ${it.to} (ตารางนี้จึงเทียบทีละเซลล์ไม่ได้)`, `Table rows×columns changed: Original ${it.from} → Done ${it.to} (cells could not be compared one by one)`);
      case 'image': return tx(`ไม่พบรูปนี้ (${it.img.path.split('/').pop()}) ในไฟล์ Done — อาจถูกลบ หรือถูกแทนด้วยไฟล์รูปใหม่`, `This image (${it.img.path.split('/').pop()}) is not in the Done file — removed, or replaced with a new image file`);
    }
  };
  const findings = items.filter(it => it.P).map(it => ({ P: it.P, s: it.s, e: it.e, sev: ['changed', 'image', 'inserted', 'table', 'refnew', 'reorder', 'celladd'].includes(it.kind) ? 'check' : 'error', cat: it.kind, sec: '', msg: msg(it), rule: '' }));
  findings.sort((a, b) => a.P.idx - b.P.idx || a.s - b.s);
  let blob = null;
  if (findings.length) {
    const SEV = { error: tx('เนื้อหาหาย/เปลี่ยน', 'Content lost/changed'), check: tx('ควรตรวจสอบ', 'Please check') };
    findings.forEach(f => { f.lines = [f.msg]; });
    let startId = 0;
    const existingPath = Object.values(O.rels).find(r => /\/comments$/.test(r.type));
    const cPath = existingPath ? (existingPath.target.startsWith('/') ? existingPath.target.slice(1) : O.dir + existingPath.target) : O.dir + 'comments.xml';
    const existing = existingPath ? await O.zip.file(cPath)?.async('string') : null;
    if (existing) { const ids = [...existing.matchAll(/w:id="(-?\d+)"/g)].map(m => Number(m[1])); startId = ids.length ? Math.max(...ids) + 1 : 0; }
    const docIds = [...O.files.document.matchAll(/<w:comment(?:RangeStart|RangeEnd|Reference)\b[^>]*w:id="(\d+)"/g)].map(m => Number(m[1]));
    if (docIds.length) startId = Math.max(startId, Math.max(...docIds) + 1);
    applyComments(model, findings, { startId, refStyle: model.S.hasCommentRef || null });
    O.zip.file(O.docPath, ser(model.doc));
    O.zip.file(cPath, buildCommentsXml(existing, findings, { author: 'MDPI Content Compare', initials: 'CMP' }));
    if (!existingPath) {
      const rel = O.relsDoc.createElementNS(RELNS, 'Relationship');
      let k = 1; while (O.rels['rIdMdpiC' + k]) k++;
      rel.setAttribute('Id', 'rIdMdpiC' + k);
      rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments');
      rel.setAttribute('Target', 'comments.xml');
      O.relsDoc.documentElement.appendChild(rel);
      O.zip.file(O.relsPath, ser(O.relsDoc));
      const ct = parseXml(await O.zip.file('[Content_Types].xml').async('string'));
      if (!Array.from(ct.getElementsByTagNameNS(CTNS, 'Override')).some(o => o.getAttribute('PartName') === '/' + cPath)) {
        const o = ct.createElementNS(CTNS, 'Override');
        o.setAttribute('PartName', '/' + cPath);
        o.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml');
        ct.documentElement.appendChild(o);
        O.zip.file('[Content_Types].xml', ser(ct));
      }
    }
    blob = await O.zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }
  return {
    blob, removedComments,
    items: items.map(it => ({ kind: it.kind, para: it.P ? it.P.idx : null, label: it.label || (it.P ? null : ''), text: it.text.replace(/￼/g, '▣'), s: it.s, e: it.e, from: it.from, to: it.to, msg: msg(it), img: it.img ? { name: it.img.path.split('/').pop(), ext: it.img.ext, bytes: it.img.bytes } : null })),
    mode, refStats,
    stats: { origParas: units.length, totalTok, missTok, origImgs: origImgCount, doneImgs: doneImgCount, origTables, doneTables, origMath: model.paras.reduce((a, P) => a + P.chars.filter(c => c.math).length, 0), doneMath: doneMath.size }
  };
}

