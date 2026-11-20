/* ---- the comparison ---- */
async function compareXml(docxBuf, xmlText, opts) {
  const L = opts.lang || 'en'; const tx = (th, en) => L === 'th' ? th : en;
  const O = await loadPackage(docxBuf);
  const removedComments = await stripAllComments(O.zip, O.dir, O.relsDoc, O.relsPath, O.files, O.rels);
  const M = buildModel(O.files);
  X_MS = M.S; xMtPrep(M.paras);
  try { const sx = await (O.zip.file((O.dir || 'word/') + 'settings.xml') || O.zip.file('word/settings.xml'))?.async('string'); const nl = sx && sx.match(/<m:naryLim\b[^>]*m:val="([^"]+)"/), il = sx && sx.match(/<m:intLim\b[^>]*m:val="([^"]+)"/); X_LIM.nary = nl ? nl[1] : 'undOvr'; X_LIM.int = il ? il[1] : 'subSup'; } catch (e) { X_LIM.nary = 'undOvr'; X_LIM.int = 'subSup'; }
  const { doc: X, lineOf } = xParse(typeof xmlText === 'string' ? xmlText : new TextDecoder().decode(xmlText), opts && opts.lang);
  const art = X.documentElement;
  if (!art || art.localName !== 'article') throw new Error(tx('ไฟล์ XML นี้ไม่ใช่ JATS (ไม่พบ <article>)', 'This XML is not JATS (no <article> element)'));
  const front = xFirst(art, 'front'), body = xFirst(art, 'body'), back = xFirst(art, 'back');
  const meta = xFirst(front, 'article-meta');
  const items = [];
  const xlineOf = el => { for (let e = el; e && e.nodeType === 1; e = e.parentNode) { const l = lineOf.get(e); if (l) return l; } return null; };
  const clip = s => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 180 ? s.slice(0, 177) + '…' : s; };
  const NOFMT = { ignB: true, ignI: true };
  const stat = { conv: 0, eq: 0, eqType: 0, tok: 0, same: 0, units: 0, cells: 0 };

  /* --- generic diff of two streams --- */
  // words of one reference that the XML has in another order: report each moved run with where it sits on both sides
  const X_STOP = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'for', 'to', 'with', 'by', 'at', 'from', 'or', 'as', 'its', 'ed', 'eds', 'pp', 'p', 'vol', 'available', 'online', 'accessed', 'https', 'http', 'doi', 'org', 'dx']);
  function refMoves(A, B, ops, mvD, mvI, o) {
    // pair every Word word with its XML word: kept by the diff, or the same word cancelled out elsewhere
    const part = new Map(); ops.forEach(op => { if (op[0] === '=') part.set(op[1], op[2]); });
    const byK = new Map(); A.forEach((t, i) => { if (mvD.has(t)) { if (!byK.has(t.k)) byK.set(t.k, []); byK.get(t.k).push(i); } });
    B.forEach((t, j) => { if (mvI.has(t)) { const q = byK.get(t.k); if (q && q.length) part.set(q.shift(), j); } });
    // <comment>, <std>, access dates and links have no fixed place in an element-citation: leave them out
    const free = t => !t.atom && t.chars.length > 0 && t.chars.every(c => c.ctx && c.ctx.free);
    const seq = []; A.forEach((t, i) => { const j = part.get(i); if (j == null || free(B[j])) return; seq.push({ i, j }); });
    // the longest run in the same order stays; the rest moved
    const tails = [], tailIx = [], prev = []; seq.forEach((q, x) => { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < q.j) lo = m + 1; else hi = m; } tails[lo] = q.j; tailIx[lo] = x; prev[x] = lo ? tailIx[lo - 1] : -1; });
    const keep = new Set(); if (tails.length) for (let x = tailIx[tails.length - 1]; x >= 0; x = prev[x]) keep.add(x);
    const runs = []; let cur = null; seq.forEach((q, x) => { if (keep.has(x)) { cur = null; return; } if (!cur) { cur = []; runs.push(cur); } cur.push(q); });
    let n = 0;
    runs.forEach(R => {
      if (n >= 3 || !R.some(q => !X_STOP.has(A[q.i].k.toLowerCase()) && /[\p{L}\p{N}]/u.test(A[q.i].k))) return;
      const P = tokP(A[R[0].i]); const T = R.map(q => A[q.i]).filter(t => tokP(t) === P); if (!T.length) return; n++;
      const [s, e] = dRange(T); const i0 = R[0].i, j0 = Math.min(...R.map(q => q.j));
      const wPrev = A.slice(Math.max(0, i0 - 2), i0).filter(t => tokP(t) === P);
      const xPrev = B.slice(Math.max(0, j0 - 2), j0);
      push({ kind: 'xrefmove', P, s, e, text: P.text, from: clip(P.text.slice(s, e)), wAfter: wPrev.length ? clip(P.text.slice(...dRange(wPrev))) : '', xAfter: xPrev.length ? clip(tokText(xPrev)) : '', xline: xlineOf(tokXel(B[j0])), where: o.where });
    });
  }
  const tokText = T => { let s = ''; T.forEach((t, k) => { s += (k && t.sp ? ' ' : '') + (t.atom ? tx('[สมการ]', '[equation]') : t.t); }); return s; };
  const dRange = T => { const a = T[0], b = T[T.length - 1]; const s = a.atom ? a.atom.pos : a.chars[0].pos, e = b.atom ? b.atom.pos + 1 : b.chars[b.chars.length - 1].pos + 1; return [s, Math.max(s + 1, e)]; };
  const tokP = t => t.atom ? t.atom.P : t.chars[0].P;
  const tokXel = t => t.atom ? t.atom.el : (t.chars.find(c => c.el) || {}).el;
  const push = it => { if (it.P) items.push(it); };
  const elMap = new Map(); // XML element → first Word position its text was matched to
  const linOfT = T => { const out = []; let buf = []; const fl = () => { if (buf.length) { xCharsToLin(buf).forEach(x => out.push(x)); buf = []; } }; T.forEach(t => { if (t.atom) { fl(); t.atom.lin.forEach(x => out.push(x)); } else buf.push(...t.chars); }); fl(); return out; };
  function diffStreams(Ds, Xs, o = {}) {
    xFoldBr(Ds); xFoldBr(Xs);
    let A = xTokenize(Ds), B = xTokenize(Xs);
    if (o.wordsOnly) { A = A.filter(t => t.cls !== 'P'); B = B.filter(t => t.cls !== 'P'); }
    const anchorP = o.anchorP || (A[0] ? tokP(A[0]) : null);
    const perP = new Map(); A.forEach(t => { const P = tokP(t); perP.set(P, (perP.get(P) || 0) + 1); });
    const ops = xDiffKeys(A.map(t => t.k), B.map(t => t.k));
    let fmtRun = null;
    const flushFmt = () => { if (!fmtRun) return; const r = fmtRun; fmtRun = null; push({ kind: 'xfmt', P: r.P, s: r.s, e: r.e, text: r.P.text, from: r.P.text.slice(r.s, r.e), sig: r.sig, xline: r.xline, where: o.where }); };
    const fmtCompare = (a, b) => {
      if (o.noFmt) return;
      const n = Math.min(a.chars.length, b.chars.length);
      for (let k = 0; k < n; k++) {
        const ca = a.chars[k], cb = b.chars[k]; const ctx = cb.ctx || X_CTX0;
        if (ca.lab || ctx.lab || (cb.syn && !o.synFmt)) continue;
        const ch = ca.ch; const ld = /[\p{L}\p{N}]/u.test(ch);
        const d = [];
        if (ld && !ctx.ignI && !(o.ref && !ctx.refIt && !cb.i)) { let ai = ca.i; if (ctx.title && ca.P && xMostlyItalic(ca.P)) ai = !ai; if (!!ai !== !!cb.i) d.push(ai ? 'i+' : 'i-'); }
        if (ld && !ctx.ignB && !o.ref) { if (!!ca.b !== !!cb.b) d.push(ca.b ? 'b+' : 'b-'); }
        // underline and small caps; a link or address may be underlined by Word's Hyperlink style
        if (ld && !!ca.u !== !!cb.u && !(cb.el && cb.el.closest && cb.el.closest('ext-link, uri, email')) && !xInUrl(ca.P, ca.pos)) d.push(ca.u ? 'u+' : 'u-');
        if (ld && !!ca.sc !== !!cb.sc) d.push(ca.sc ? 'sc+' : 'sc-');
        if (!X_WS.test(ch) && !ctx.ignV) { const av = ca.sup ? 'sup' : ca.sub ? 'sub' : 'base', bv = cb.sup ? 'sup' : cb.sub ? 'sub' : 'base'; if (av !== bv) d.push('v:' + av + '>' + bv); }
        if (!d.length) { if (fmtRun && fmtRun.P === ca.P && ca.pos > fmtRun.e + 1) flushFmt(); continue; }
        const sig = d.join(',');
        if (fmtRun && fmtRun.P === ca.P && fmtRun.sig === sig && ca.pos - fmtRun.e <= 2) { fmtRun.e = ca.pos + 1; continue; }
        flushFmt(); fmtRun = { P: ca.P, s: ca.pos, e: ca.pos + 1, sig, xline: xlineOf(cb.el) };
      }
    };
    const atomCompare = (a, b) => {
      stat.eq++;
      const P = a.atom.P; const at = a.atom.pos; const lbl = (a.atom.label || b.atom.label || '').trim();
      const r = xCmpLin(a.atom.lin, b.atom.lin, { sp: !!a.atom.math && !!b.atom.math });
      const xl = xlineOf(b.atom.el);
      // an equation object on one side and typed text on the other is fine when symbols, sub/superscripts and italics match (Both, 2026-11-06)
      if (!!a.atom.math !== !!b.atom.math && !r) stat.eqType++;
      if (!r) return;
      (r.st || []).forEach(d => push({ kind: 'xstretch', P, s: at, e: at + 1, text: P.text, lbl, st: d, xline: xlineOf(d.el) || xl, where: o.where }));
      if (r.spD && r.spD.length) { r.spD.forEach(d => { d.line = xlineOf(d.el); }); push({ kind: 'xmathsp', P, s: at, e: at + 1, text: P.text, lbl, spD: r.spD, xline: r.spD[0].line || xl, where: o.where }); }
      if (r.text && (r.itW.length || r.itX.length || r.vD.length || r.limD.length)) push({ kind: 'xmathfmt', P, s: at, e: at + 1, text: P.text, lbl, itW: r.itW, itX: r.itX, bW: [], bX: [], vD: r.vD, limD: r.limD, xline: xlineOf(r.el) || xl, where: o.where });
      if (r.text) push({ kind: 'xmath', P, s: at, e: at + 1, text: P.text, lbl, from: r.wMid || '∅', to: r.xMid || '∅', ctxA: r.pre, ctxB: r.post, full: r.wa, fullX: r.xb, xline: xl, where: o.where });
      else if (r.itW.length || r.itX.length || r.bW.length || r.bX.length || r.vD.length || r.limD.length) push({ kind: 'xmathfmt', P, s: at, e: at + 1, text: P.text, lbl, itW: r.itW, itX: r.itX, bW: r.bW, bX: r.bX, vD: r.vD, limD: r.limD, xline: xlineOf(r.el) || xl, where: o.where });
    };
    const eqDone = new Set();
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]; if (op[0] === '=') continue;
      const t0 = op[0] === '-' ? A[op[1]] : B[op[2]]; if (!t0.atom) continue;
      let s0 = i; while (s0 > 0 && ops[s0 - 1][0] !== '=') s0--;
      let j = i; while (j + 1 < ops.length && ops[j + 1][0] !== '=') j++;
      const okEq = (a, b) => !a.blk && !b.blk && !a.atom && !b.atom && (a.cls === 'P' || a.cls === 'N') && a.k === b.k;
      let last = j;
      for (let k = j + 1; k < ops.length && k - j < 60; k++) {
        const q = ops[k];
        if (q[0] === '=') { if (!okEq(A[q[1]], B[q[2]])) break; continue; }
        const t = q[0] === '-' ? A[q[1]] : B[q[2]]; if (t.blk || t.atom) break; last = k;
      }
      // typed text on one side can run over several equations on the other (Word ⟦F(2,76) = 64.58⟧, ⟦p < 0.001⟧ against XML “F(2,76) = 64.58, p &lt; 0.001”, muscles-4637458): the diff may pair the comma inside “(2,76)” with the comma between the equations,
      // so when the hunk does not read the same as it stands, take in the following hunks, equations included, up to the first point where both sides read the same
      const span = e => { const W = [], Xt = []; for (let k = s0; k <= e; k++) { const q = ops[k]; if (q[0] !== '+') W.push(A[q[1]]); if (q[0] !== '-') Xt.push(B[q[2]]); } return [W, Xt]; };
      // how far apart the two sides are up to op e (characters that differ), or null when the span cannot be compared as one
      const spanDiff = e => { const [W, Xt] = span(e); if (!W.length || !Xt.length || W.some(t => t.blk) || Xt.some(t => t.blk)) return null; const P = tokP(W.find(t => t.atom) || W[0]); if (W.some(t => tokP(t) !== P)) return null; const r = xCmpLin(linOfT(W), linOfT(Xt)); return r && r.text ? (r.wMid || '').replace(/∅/g, '').length + (r.xMid || '').replace(/∅/g, '').length : 0; };
      if (spanDiff(last) !== 0) {
        const cands = [];
        for (let k = j + 1; k < ops.length && k - j < 80; k++) {
          const q = ops[k];
          if (q[0] === '=') { if (!okEq(A[q[1]], B[q[2]])) break; continue; }
          const t = q[0] === '-' ? A[q[1]] : B[q[2]]; if (t.blk) break;
          if (k > last && (k + 1 === ops.length || ops[k + 1][0] === '=')) cands.push(k);
        }
        let pick = cands.find(e => spanDiff(e) === 0);
        if (pick == null && cands.length) {
          // no point reads the same (a real difference): take the span that leaves the least unexplained, so the finding shows “64.58 → 64.59”, not two broken halves
          const E = cands[cands.length - 1]; const len = t => t.atom ? t.atom.lin.length : t.chars.length;
          const rest = e => { let n = 0; for (let k = e + 1; k <= E; k++) { const q = ops[k]; if (q[0] === '-') n += len(A[q[1]]); else if (q[0] === '+') n += len(B[q[2]]); } return n; };
          const cost = e => { const d = spanDiff(e); return d == null ? Infinity : d + rest(e); };
          let bc = cost(last); for (const e of cands) { const c = cost(e); if (c < bc - 2) { bc = c; pick = e; } }
        }
        if (pick != null) last = pick;
      }
      if (last === j) { i = j; continue; }
      const W = [], Xt = [];
      for (let k = s0; k <= last; k++) { const q = ops[k]; if (q[0] !== '+') W.push(A[q[1]]); if (q[0] !== '-') Xt.push(B[q[2]]); }
      const PW = W.length ? tokP(W.find(t => t.atom) || W[0]) : null;
      if (!PW || W.some(t => tokP(t) !== PW) || Xt.some(t => t.blk)) { i = j; continue; }
      const r = xCmpLin(linOfT(W), linOfT(Xt));
      for (let k = s0; k <= last; k++) eqDone.add(k);
      if (r && r.text) { const [s, e] = dRange(W.filter(t => tokP(t) === PW)); push({ kind: 'xmath', P: PW, s, e, text: PW.text, from: r.wMid || '∅', to: r.xMid || '∅', ctxA: r.pre, ctxB: r.post, full: r.wa, fullX: r.xb, xline: xlineOf(tokXel(Xt[0])), where: o.where }); }
      else if (!r) stat.eqType++;
      else if (r.itW.length || r.itX.length || r.bW.length || r.bX.length || r.vD.length || r.limD.length) { const [s, e] = dRange(W.filter(t => tokP(t) === PW)); push({ kind: 'xmathfmt', P: PW, s, e, text: PW.text, itW: r.itW, itX: r.itX, bW: r.bW, bX: r.bX, vD: r.vD, limD: r.limD, xline: xlineOf(tokXel(Xt[0])), where: o.where }); }
      i = last;
    }
    let D0 = [], I0 = [], prevA = null, prevB = null, prevOp = null;
    const hunks = [];
    const hunk = (nextA, nextB) => { if (D0.length || I0.length) hunks.push({ D: D0, I: I0, prevA, nextA, nearB: prevB || nextB }); D0 = []; I0 = []; };
    const inXref = t => { const el = t.chars[0] && t.chars[0].el; return !!(el && el.closest && el.closest('xref')); };
    const procHunk = ({ D, I, prevA, nextA, nearB }) => {
      if (!D.length && !I.length) return;
      // punctuation the comparer itself adds for the XML side (“Title: ”, “; ” between names) is never reported on its own
      if (!D.length && I.every(t => t.chars.length && t.chars.every(c => c.syn))) return;
      // a stray private-use / zero-width character is reported once by the structure check
      if (!D.length && I.every(t => t.chars.length && t.chars.every(c => /[\uE000-\uF8FF\uFFFD\u200B\uFEFF]/.test(c.ch)))) return;
      // MDPI XML conventions: citation ranges are expanded ([7–12] → [7,8,…,12]) and grouped cross-references
      // repeat their label (“Sections 3.2 and 3.4” → “Section 3.2 and Section 3.4”)
      if (D.length === 1 && /^[–\-—]$/.test(D[0].k) && prevA && nextA && /^\d+$/.test(prevA.k) && /^\d+$/.test(nextA.k) && I.length && I.filter(t => t.k !== ',').every(inXref)) {
        const a = Number(prevA.k), b = Number(nextA.k); const want = []; for (let n = a + 1; n < b; n++) want.push(',', String(n)); want.push(',');
        if (b > a + 1 && want.join(' ') === I.map(t => t.k).join(' ')) { stat.conv++; return; }
      }
      const LBL = /^(Section|Figure|Table|Equation|Scheme|Appendix|Algorithm|Chart|Box|Video|Eq)$/;
      if (I.length && I.every(t => LBL.test(t.k) && inXref(t)) && (!D.length || (D.length === 1 && I.length === 1 && (D[0].k === I[0].k + 's' || (D[0].k === 'Eqs' && I[0].k === 'Equation') || (D[0].k === 'Appendices' && I[0].k === 'Appendix'))))) { stat.conv++; return; }
      if (o.noise) { const nz = t => o.noise.has(t.k.toLowerCase()); const Df = D.filter(t => !nz(t)), If = I.filter(t => !nz(t)); if (!Df.length && !If.length) return; }
      // an equation object on one side, typed text on the other
      if (D.length && I.length && (D.some(t => t.atom) || I.some(t => t.atom))) {
        const r = xCmpLin(linOfT(D), linOfT(I));
        const a0 = D.find(t => t.atom) || D[0]; const P = tokP(a0); const [s, e] = dRange(D.filter(t => tokP(t) === P));
        if (r && r.text && D.length <= 3 && I.length <= 40) { push({ kind: 'xmath', P, s, e, text: P.text, from: r.wMid || '∅', to: r.xMid || '∅', ctxA: r.pre, ctxB: r.post, full: r.wa, fullX: r.xb, xline: xlineOf(tokXel(I[0])), where: o.where }); return; }
        if (!r || !r.text) { if (!r) stat.eqType++; else if (r.itW.length || r.itX.length || r.bW.length || r.bX.length || r.vD.length || r.limD.length) push({ kind: 'xmathfmt', P, s, e, text: P.text, itW: r.itW, itX: r.itX, bW: r.bW, bX: r.bX, vD: r.vD, limD: r.limD, xline: xlineOf(tokXel(I[0])), where: o.where }); return; }
      }
      const groups = []; D.forEach(t => { const P = tokP(t); const g = groups[groups.length - 1]; if (g && g.P === P) g.T.push(t); else groups.push({ P, T: [t] }); });
      const xl = I.length ? xlineOf(tokXel(I[0])) : nearB ? xlineOf(tokXel(nearB)) : o.xel ? xlineOf(o.xel) : null;
      if (D.length && I.length && groups.length === 1 && D.length <= 14 && I.length <= 14) {
        let [s, e] = dRange(D); const P = groups[0].P;
        const allNum = D.concat(I).every(t => t.cls === 'N' || t.cls === 'P');
        let s2 = s, e2 = e;
        if (allNum) { while (s2 > 0 && /[\d.,]/.test(P.text[s2 - 1])) s2--; while (e2 < P.text.length && /[\d.,]/.test(P.text[e2]) && !/[.,]$/.test(P.text.slice(e2, e2 + 1) + (P.text[e2 + 1] && /\d/.test(P.text[e2 + 1]) ? '' : '.'))) e2++; }
        const pre = P.text.slice(s2, s), post = P.text.slice(e, e2);
        push({ kind: 'xchg', P, s: s2, e: e2, text: P.text, from: clip(P.text.slice(s2, e2)), to: clip(pre + tokText(I) + post), num: allNum, xline: xl, where: o.where });
        return;
      }
      groups.forEach(g => {
        const [s, e] = dRange(g.T);
        const whole = g.T.length >= 4 && perP.get(g.P) === g.T.length && !o.noPara;
        push({ kind: whole ? 'xpara' : 'xmiss', P: g.P, s, e, text: g.P.text, from: clip(g.P.text.slice(s, e)), xline: xl, where: o.where, keyStr: g.T.map(t => t.k).join(' ') });
      });
      if (I.length) {
        const at = prevA || nextA || null; const P = at ? tokP(at) : anchorP;
        if (!P) return;
        const [s, e] = at ? dRange([at]) : [0, Math.max(1, P.text.length)];
        push({ kind: 'xadd', P, s, e, text: P.text, from: P.text.slice(s, e), to: clip(tokText(I)), after: !!prevA, xline: xlineOf(tokXel(I[0])), where: o.where, keyStr: I.map(t => t.k).join(' ') });
      }
    };
    ops.forEach((op, oi) => {
      if (eqDone.has(oi)) { hunk(null, null); prevOp = null; return; }
      if (op[0] === '=') {
        const a = A[op[1]], b = B[op[2]];
        hunk(a, b);
        if (a.atom) { if (b.atom.el && !elMap.has(b.atom.el)) elMap.set(b.atom.el, { P: a.atom.P, pos: a.atom.pos }); }
        else { const n = Math.min(a.chars.length, b.chars.length); for (let k = 0; k < n; k++) { const cb = b.chars[k], ca = a.chars[k]; if (cb.el && ca.P && !elMap.has(cb.el)) elMap.set(cb.el, { P: ca.P, pos: ca.pos }); } }
        if (a.atom) atomCompare(a, b); else fmtCompare(a, b);
        if (!o.noSpace && prevOp && prevOp[0] === '=' && prevOp[1] === op[1] - 1 && prevOp[2] === op[2] - 1 && !a.blk && !b.blk && !a.atom && !b.atom && !A[op[1] - 1].atom && !!a.sp !== !!b.sp && tokP(a) === tokP(A[op[1] - 1]) && !(b.chars[0].syn || (B[op[2] - 1].chars[0] || {}).syn)) {
          const pa = A[op[1] - 1], pb = B[op[2] - 1]; const P = tokP(a); const s = pa.chars[pa.chars.length - 1].pos, e = a.chars[a.chars.length - 1].pos + 1;
          push({ kind: 'xspace', P, s, e, text: P.text, from: pa.t + (a.sp ? ' ' : '') + a.t, to: pb.t + (b.sp ? ' ' : '') + b.t, xline: xlineOf(tokXel(b)), where: o.where });
        }
        prevA = a; prevB = b; prevOp = op;
      } else { if (op[0] === '-') D0.push(A[op[1]]); else I0.push(B[op[2]]); prevOp = op; }
    });
    hunk(null, null); flushFmt();
    if (o.bag && hunks.length) {
      const cntD = new Map(), cntI = new Map();
      hunks.forEach(h => { h.D.forEach(t => cntD.set(t.k, (cntD.get(t.k) || 0) + 1)); h.I.forEach(t => cntI.set(t.k, (cntI.get(t.k) || 0) + 1)); });
      const cD = new Map(), cI = new Map(); cntD.forEach((v, k) => { const w = cntI.get(k) || 0; if (w) { cD.set(k, Math.min(v, w)); cI.set(k, Math.min(v, w)); } });
      const mvD = new Set(), mvI = new Set();
      hunks.forEach(h => { h.D = h.D.filter(t => { const v = cD.get(t.k); if (v) { cD.set(t.k, v - 1); mvD.add(t); return false; } return true; }); h.I = h.I.filter(t => { const v = cI.get(t.k); if (v) { cI.set(t.k, v - 1); mvI.add(t); return false; } return true; }); });
      if (o.moves && mvD.size) refMoves(A, B, ops, mvD, mvI, o);
    }
    hunks.forEach(procHunk);
    stat.tok += A.length; stat.units++; ops.forEach(op => { if (op[0] === '=') stat.same++; });
    return { A, B };
  }

  /* --- zones of the Word file --- */
  const blocks = M.blocks;
  const bText = b => b.kind === 'p' ? b.p.text : '';
  const pNE = P => P.text.replace(/[\s￼]/g, '').length > 0 || P.hasMath;
  let refHead = -1;
  blocks.forEach((b, k) => { if (b.kind === 'p' && /^\s*(\d+\.?\s*)?(References|Reference List|Bibliography|Literature Cited|Works Cited)\s*:?\s*$/i.test(b.p.text)) refHead = k; });
  let refEnd = blocks.length;
  if (refHead >= 0) for (let k = refHead + 1; k < blocks.length; k++) if (blocks[k].kind === 'p' && X_BACK.test(blocks[k].p.text) && /^\s*\S+[^:]{0,60}:|^\s*Appendix\s+[A-Z]\b|^\s*Abbreviations\s*$/i.test(blocks[k].p.text)) { refEnd = k; break; }
  // where the body starts: the Word paragraph that matches the first heading/paragraph of the XML body
  const normWords = s => (s || '').toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [];
  let flowStart = -1;
  const xFirstBody = body ? (xEls(body, /^(sec|p)$/)[0] || null) : null;
  const firstTitle = xFirstBody ? (xFirstBody.localName === 'sec' ? (xFirst(xFirstBody, 'title') || xFirst(xFirstBody, 'p')) : xFirstBody) : null;
  if (firstTitle) {
    const wAll = normWords(firstTitle.textContent).filter(t => !/^\d+$/.test(t)); const w = wAll.slice(0, 6);
    // a heading matches a heading-length paragraph only: a structured abstract that opens with “Introduction: …” is not the “1. Introduction” heading (diagnostics-4666284)
    const isTtl = firstTitle.localName === 'title';
    for (let k = 0; k < blocks.length && flowStart < 0; k++) { const b = blocks[k]; if (b.kind !== 'p') continue; const v = normWords(b.p.display).filter(t => !/^\d+$/.test(t)); if (w.length && v.length >= Math.min(w.length, 1) && (!isTtl || v.length <= wAll.length + 3) && w.slice(0, Math.min(6, w.length)).every((t, i) => v[i] === t)) flowStart = k; }
  }
  if (flowStart < 0) { const kw = blocks.findIndex(b => b.kind === 'p' && /keyword/i.test(b.p.styleName + b.p.styleId + ' ' + b.p.text.slice(0, 9))); flowStart = kw >= 0 ? kw + 1 : 0; }
  let backStart = refHead >= 0 ? refHead : blocks.length;
  // “Abbreviations: …” right under a table (after its other footer lines) is that table's footer, not the back matter (diagnostics-4666284 Table 3)
  const underTable = k => { let j = k - 1; while (j > flowStart && blocks[j].kind === 'p' && (!pNE(blocks[j].p) || /^\s*(Notes?|Abbreviations|Sources?)\s*[:.]|^\s*[*†‡§¶#]/.test(blocks[j].p.text) || (blocks[j].p.text.length && blocks[j].p.fmt(blocks[j].p.text.search(/\S/)).vert === 'superscript'))) j--; return j > flowStart && blocks[j].kind === 'tbl'; };
  for (let k = flowStart + 1; k < backStart; k++) { const b = blocks[k]; if (b.kind !== 'p') continue; const t = b.p.text; if (/^\s*Abbreviations\s*[:.]/i.test(t) && underTable(k)) continue; if (X_BACK.test(t) && (/^\s*[^:]{2,70}:/.test(t) || /^\s*Appendix\s+[A-Z]\b/i.test(t) || t.trim().length <= 40)) { backStart = k; break; } }
  // floats: captions, their tables and footers
  const floatSet = new Set(); const dFloats = [];
  // a paragraph right after a Word table is its footer when the XML keeps the same words in that table's <table-wrap-foot> (a footer without “Note:” or a footer style, e.g. healthcare-4649995 Table 4)
  const xFootW = new Map(); [...X.getElementsByTagName('table-wrap')].forEach(el => { const lab = xFirst(el, 'label'), ft = xFirst(el, 'table-wrap-foot'); if (lab && ft) xFootW.set(xFloatKey(lab.textContent + '.'), new Set(normWords(ft.textContent))); });
  const xFootHas = (key, t) => { const S = xFootW.get(key); const w = normWords(t); if (!S || w.length < 4) return false; let n = 0; w.forEach(x => { if (S.has(x)) n++; }); return n / w.length >= 0.8; };
  const isCaption = P => { const m = X_CAP.exec(P.text); if (!m) return false; if (/caption/i.test(P.styleName + P.styleId)) return true; if ((P.chain || []).some(xTpl)) return false; return allFmt(P, m.index, m.index + m[0].trim().length, f => f.b) && P.text.length > m[0].length + 3; };
  for (let k = 0; k < blocks.length; k++) {
    if (k > refHead && refHead >= 0 && k < refEnd) continue;
    const b = blocks[k]; if (b.kind !== 'p' || k < flowStart) continue;
    const P = b.p; if (!isCaption(P)) continue;
    const key = xFloatKey(P.text); const m = X_CAP.exec(P.text);
    const f = { key, P, k, labelEnd: m.index + m[0].length, label: P.text.slice(m.index, m.index + m[0].length).trim(), T: null, foot: [] };
    floatSet.add(b);
    if (/^table/.test(key)) {
      for (let j = k + 1; j < Math.min(blocks.length, k + 4); j++) { const bj = blocks[j]; if (bj.kind === 'tbl') { f.T = bj.t; floatSet.add(bj); f.tk = j; break; } if (bj.kind === 'p' && pNE(bj.p)) break; }
      if (f.T) for (let j = f.tk + 1; j < blocks.length; j++) {
        const bj = blocks[j]; if (bj.kind !== 'p') break; const Q = bj.p; if (!pNE(Q)) { if (/foot/i.test(Q.styleName + Q.styleId)) { floatSet.add(bj); continue; } break; }
        const st = /foot/i.test(Q.styleName + Q.styleId);
        const pat = !isCaption(Q) && (Q.text.length && (Q.fmt(Q.text.search(/\S/)).vert === 'superscript' || /^\s*(Notes?|Abbreviations|Sources?)\s*[:.]|^\s*[*†‡§¶#]/.test(Q.text))) && (Q.fmt(Math.max(0, Q.text.search(/\S/))).size || 10) <= 9.5;
        if (st || pat || (!isCaption(Q) && xFootHas(key, Q.text))) { f.foot.push(Q); floatSet.add(bj); } else break;
      }
    }
    dFloats.push(f);
  }
  // the add-style template needs a caption on every table: a placeholder (“Table 16. GG.”) on a table that the XML keeps without a label is left out
  {
    const xKeys = new Set(); [...X.getElementsByTagName('fig'), ...X.getElementsByTagName('table-wrap')].forEach(el => { const lab = xFirst(el, 'label'); if (lab) xKeys.add(xFloatKey(lab.textContent + '.')); });
    let nAnon = [...X.getElementsByTagName('table-wrap')].filter(t => !xFirst(t, 'label')).length;
    dFloats.forEach(f => {
      if (!nAnon || !f.T || !f.key || xKeys.has(f.key) || !/^[\s\W]*[\p{L}\d]{0,3}[\s\W]*$/u.test(f.P.text.slice(f.labelEnd))) return;
      nAnon--; f.anon = true; floatSet.delete(blocks[f.tk]);
      for (let j = f.tk + 1; j < blocks.length && blocks[j].kind === 'p' && floatSet.has(blocks[j]) && f.foot.includes(blocks[j].p); j++) floatSet.delete(blocks[j]);
    });
  }
  const isFigPara = P => !P.text.replace(/[\s￼]/g, '') && P.drawings.length > 0 && !xPOle(P);
  // a table that only lays out figure panels: images plus labels such as (a), (b) — in the XML these are part of the image
  const X_PANEL = /^\s*\(?(?:[a-z]{1,2}|[ivx]{1,4}|\d{1,2})\)?[.:]?(?:\s+\S.{0,38})?\s*$/i;
  const isFigTable = T => { const cells = T.rows.flat(); if (!cells.some(c => c.paras.some(p => p.drawings && p.drawings.length)) || cells.some(c => c.paras.some(xPOle))) return false; return cells.every(c => c.paras.every(p => !pNE(p) || isFigPara(p) || (!p.hasMath && X_PANEL.test(p.text.replace(/￼/g, ''))))); };
  let figTables = 0;

  /* --- 1. body text --- */
  const dFlow = []; let dParas = 0, dEq = 0;
  const X_BOXT = /^\s*(Academic Editors?|Received|Revised|Accepted|Published|Copyright|Citation|Publisher[’']s Note)\s*:/i;
  const isBoxP = P => X_BOXT.test(P.text) || /academic_?editor|history|copyright/i.test((P.styleName || '') + (P.styleId || ''));
  const boxSet = new Set();
  for (let k = Math.max(0, flowStart); k < Math.min(backStart, flowStart + 60); k++) { const b = blocks[k]; if (floatSet.has(b)) continue; const ps = (b.kind === 'p' ? [b.p] : b.t.paras).filter(pNE); if (ps.length && ps.every(isBoxP)) boxSet.add(b); }
  for (let k = flowStart; k < backStart; k++) {
    const b = blocks[k]; if (floatSet.has(b) || boxSet.has(b)) continue;
    if (b.kind === 'p') { if (!pNE(b.p) || isFigPara(b.p)) continue; dParas++; xDocStream(b.p, dFlow); }
    else if (isFigTable(b.t)) figTables++;
    else if (xIsEqTable(b.t)) { dEq++; xEqTableStream(b.t, dFlow); }
    else xFlatTableStream(b.t, dFlow);
  }
  const xFlow = [];
  if (body) for (let c = body.firstChild; c; c = c.nextSibling) xStream(c, xFlow, xSt0());
  diffStreams(dFlow, xFlow, { where: 'body' });

  /* --- 2. figures and tables --- */
  const xFloats = new Map(); const xFloatList = [];
  for (const el of [...X.getElementsByTagName('fig'), ...X.getElementsByTagName('table-wrap'), ...X.getElementsByTagName('fig-group')]) {
    const lab = xFirst(el, 'label'); const key = lab ? xFloatKey(lab.textContent + '.') : null;
    const f = { el, key, label: lab ? lab.textContent.trim() : '' }; xFloatList.push(f);
    if (key && !xFloats.has(key)) xFloats.set(key, f);
  }
  const usedX = new Set();
  const capStream = (el) => { const out = []; const cap = xFirst(el, 'caption'); if (cap) xStream(cap, out, xSt0()); return out; };
  const cellStream = (paras) => { const out = []; paras.forEach(p => xDocStream(p, out, { label: false })); return out; };
  const xCellStream = (o) => { const out = []; for (let c = o.el.firstChild; c; c = c.nextSibling) xStream(c, out, xSt0(o.th ? { ignB: true } : X_CTX0)); return out; };
  let tablesCompared = 0;
  for (const f of dFloats) {
    if (f.anon) continue;
    const x = f.key ? xFloats.get(f.key) : null;
    const nm = f.label.replace(/[.:]\s*$/, '');
    if (!x) { push({ kind: 'xfloat', P: f.P, s: 0, e: Math.max(1, f.labelEnd), text: f.P.text, from: nm, miss: true }); continue; }
    usedX.add(x);
    const dl = f.label.replace(/[.:]\s*$/, '').replace(/\s+/g, ' '), xl = x.label.replace(/[.:]\s*$/, '').replace(/\s+/g, ' ');
    if (dl !== xl) push({ kind: 'xchg', P: f.P, s: 0, e: Math.max(1, f.labelEnd), text: f.P.text, from: dl, to: xl, xline: xlineOf(xFirst(x.el, 'label')), where: 'caption' });
    const Ds = []; xDocStream(f.P, Ds, { from: f.labelEnd, label: false });
    diffStreams(Ds, capStream(x.el), { where: 'caption', anchorP: f.P, xel: x.el });
    if (f.T) {
      const tbl = x.el.getElementsByTagName('table')[0];
      if (!tbl) { push({ kind: 'xtable', P: f.P, s: 0, e: Math.max(1, f.labelEnd), text: f.P.text, sub: 'notable', from: nm, xline: xlineOf(x.el) }); }
      else { tablesCompared++; compareGrid(f, x, tbl); }
      const foot = xFirst(x.el, 'table-wrap-foot');
      const Df = []; f.foot.forEach(p => xDocStream(p, Df, { label: false }));
      const Xf = [];
      const footWalk = n => { for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 1 && c.localName === 'fn') { Xf.push({ blk: true }); for (let d = c.firstChild; d; d = d.nextSibling) xStream(d, Xf, xSt0()); } else if (c.nodeType === 1 && c.localName === 'fn-group') footWalk(c); else xStream(c, Xf, xSt0()); } };
      if (foot) { Xf.length = 0; footWalk(foot); }
      if (Df.length || Xf.length) diffStreams(Df, Xf, { where: 'tfoot', anchorP: f.foot[0] || f.P, xel: foot || x.el });
    }
  }
  xFloatList.forEach(x => { if (usedX.has(x) || !x.key || x.el.parentNode.localName === 'fig-group') return; const near = dFloats.length ? dFloats[dFloats.length - 1].P : null; const P0 = near || (blocks[flowStart] && blocks[flowStart].p); if (P0) push({ kind: 'xfloat', P: P0, s: 0, e: Math.max(1, Math.min(P0.text.length, 12)), text: P0.text, from: x.label, miss: false, xline: xlineOf(x.el) }); });

  function compareGrid(f, x, tbl) {
    const T = f.T; const P0 = T.paras.find(p => p.text.trim()) || T.paras[0] || f.P;
    // Word grid: gridSpan = colspan, vMerge = rowspan
    const dO = [], cover = [];
    T.rows.forEach((row, r) => {
      cover[r] = cover[r] || [];
      const tr = row.length ? row[0].el.parentNode : null; const trPr = tr ? kid(tr, 'trPr') : null;
      let c = Number(wa(kid(trPr, 'gridBefore'), 'val') || 0);
      row.forEach(cell => {
        const tcPr = kid(cell.el, 'tcPr');
        const cs = Math.max(1, Number(wa(kid(tcPr, 'gridSpan'), 'val') || 1));
        const vm = kid(tcPr, 'vMerge'); const vmv = vm ? (wa(vm, 'val') || 'continue') : null;
        if (vmv === 'continue' && r > 0 && cover[r - 1] && cover[r - 1][c] && cover[r - 1][c].c === c) { const o = cover[r - 1][c]; o.rs = r - o.r + 1; for (let k = 0; k < cs; k++) cover[r][c + k] = o; o.cont.push(...cell.paras); c += cs; return; }
        const o = { r, c, cs, rs: 1, paras: cell.paras, cont: [] };
        dO.push(o); for (let k = 0; k < cs; k++) cover[r][c + k] = o; c += cs;
      });
    });
    const dRows = T.rows.length, dCols = Math.max(0, ...cover.map(r => r.length));
    // XML grid: colspan/rowspan
    const trs = []; const order = { thead: 0, tbody: 1, tfoot: 2 };
    const secs = [...tbl.children].filter(c => /^(thead|tbody|tfoot|tr)$/.test(c.localName)).sort((a, b) => (order[a.localName] ?? 1) - (order[b.localName] ?? 1));
    secs.forEach(s => { if (s.localName === 'tr') trs.push(s); else xEls(s, 'tr').forEach(tr => trs.push(tr)); });
    const xO = [], occ = [];
    trs.forEach((tr, r) => {
      occ[r] = occ[r] || []; let c = 0;
      xEls(tr, /^(th|td)$/).forEach(cell => {
        while (occ[r][c]) c++;
        const cs = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1), rs = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);
        const o = { r, c, cs, rs, el: cell, th: cell.localName === 'th' };
        xO.push(o); for (let y = r; y < r + rs; y++) { occ[y] = occ[y] || []; for (let k = c; k < c + cs; k++) occ[y][k] = o; }
        c += cs;
      });
    });
    const xRows = trs.length, xCols = Math.max(0, ...occ.slice(0, xRows).map(r => r ? r.length : 0));
    const tl = xlineOf(tbl); const nm = f.label.replace(/[.:]\s*$/, '');
    if (dRows !== xRows) push({ kind: 'xtable', P: f.P, s: 0, e: Math.max(1, f.labelEnd), text: f.P.text, sub: 'rows', from: dRows, to: xRows, name: nm, xline: tl });
    if (dCols !== xCols) push({ kind: 'xtable', P: f.P, s: 0, e: Math.max(1, f.labelEnd), text: f.P.text, sub: 'cols', from: dCols, to: xCols, name: nm, xline: tl });
    // pair rows: same count → by position; otherwise by content
    const rowKey = (O, r) => O.filter(o => o.r === r).map(o => normWords(o.paras ? o.paras.map(p => p.text).join(' ') : o.el.textContent).join(' ')).join('|');
    const rowMap = new Map();
    if (dRows === xRows) for (let r = 0; r < dRows; r++) rowMap.set(r, r);
    else {
      const ka = [], kb = []; for (let r = 0; r < dRows; r++) ka.push(rowKey(dO, r)); for (let r = 0; r < xRows; r++) kb.push(rowKey(xO, r));
      const ops = xDiffKeys(ka, kb); let D = [], I = [];
      const fl = () => { for (let k = 0; k < Math.min(D.length, I.length); k++) rowMap.set(D[k], I[k]); D.slice(I.length).forEach(r => { const o = dO.find(o => o.r === r && o.paras.some(p => p.text.trim())) || dO.find(o => o.r === r); const p = o && (o.paras.find(p => p.text.trim()) || o.paras[0]); if (p) push({ kind: 'xrow', P: p, s: 0, e: Math.max(1, p.text.length), text: p.text, miss: true, from: clip(ka[r].replace(/\|/g, ' | ')), name: nm, xline: tl }); }); I.slice(D.length).forEach(r => push({ kind: 'xrow', P: P0, s: 0, e: Math.max(1, Math.min(P0.text.length, 20)), text: P0.text, miss: false, to: clip(kb[r].replace(/\|/g, ' | ')), name: nm, xline: xlineOf(trs[r]) })); D = []; I = []; };
      ops.forEach(op => { if (op[0] === '=') { fl(); rowMap.set(op[1], op[2]); } else if (op[0] === '-') D.push(op[1]); else I.push(op[2]); }); fl();
    }
    const matched = new Set();
    // a row whose cells all sit one or two columns off (a wrong rowspan/colspan above or to the left)
    const ck = o => normWords(o.paras ? o.paras.map(p => p.text).join(' ') : o.el.textContent).join(' ');
    const shiftOf = new Map();
    for (let r = 0; r < dRows; r++) {
      if (!rowMap.has(r)) continue; const xr = rowMap.get(r); const row = dO.filter(o => o.r === r);
      const hits = d => row.filter(o => { const xo = occ[xr] && occ[xr][o.c + d]; return xo && xo.r === xr && ck(xo) === ck(o); }).length;
      let bd = 0, bh = hits(0); for (const d of [1, -1, 2, -2]) { const h = hits(d); if (h >= bh + 2) { bd = d; bh = h; } }
      if (bd) { shiftOf.set(r, bd); const o = row.find(o => o.paras.some(p => p.text.trim())) || row[0]; const p = o && (o.paras.find(p => p.text.trim()) || o.paras[0]); if (p) push({ kind: 'xspan', P: p, s: 0, e: Math.max(1, p.text.length), text: p.text, sub: 'shift', d: bd, r: r + 1, c: o.c + 1, name: nm, xline: xlineOf(trs[xr]) }); }
    }
    dO.forEach(o => {
      if (!rowMap.has(o.r)) return;
      const sh = shiftOf.get(o.r) || 0;
      const xr = rowMap.get(o.r); const xo = occ[xr] && occ[xr][o.c + sh];
      const p = o.paras.find(p => p.text.trim()) || o.paras[0]; if (!p) return;
      const cellTxt = clip(o.paras.map(q => q.text).join(' '));
      if (!xo) { push({ kind: 'xspan', P: p, s: 0, e: Math.max(1, p.text.length), text: p.text, sub: 'nocell', from: cellTxt, r: o.r + 1, c: o.c + 1, name: nm, xline: xlineOf(trs[xr]) }); return; }
      if (xo.r !== xr || xo.c !== o.c + sh) { if (!matched.has(xo) && !sh) push({ kind: 'xspan', P: p, s: 0, e: Math.max(1, p.text.length), text: p.text, sub: 'merged', from: cellTxt, r: o.r + 1, c: o.c + 1, xr: xo.r + 1, xc: xo.c + 1, xcs: xo.cs, xrs: xo.rs, cs: o.cs, rs: o.rs, name: nm, xline: xlineOf(xo.el) }); return; }
      matched.add(xo);
      if (xo.cs !== o.cs) push({ kind: 'xspan', P: p, s: 0, e: Math.max(1, p.text.length), text: p.text, sub: 'colspan', from: o.cs, to: xo.cs, r: o.r + 1, c: o.c + 1, name: nm, xline: xlineOf(xo.el) });
      if (xo.rs !== o.rs) push({ kind: 'xspan', P: p, s: 0, e: Math.max(1, p.text.length), text: p.text, sub: 'rowspan', from: o.rs, to: xo.rs, r: o.r + 1, c: o.c + 1, name: nm, xline: xlineOf(xo.el) });
      stat.cells++;
      diffStreams(cellStream(o.paras.concat(o.cont)), xCellStream(xo), { where: 'cell', anchorP: p, xel: xo.el, noPara: true });
    });
    xO.forEach(xo => {
      if (matched.has(xo)) return;
      const dr = [...rowMap.entries()].find(([, v]) => v === xo.r); if (!dr) return;
      const o = cover[dr[0]] && (cover[dr[0]][xo.c] || cover[dr[0]][cover[dr[0]].length - 1]);
      if (o && o.r === dr[0] && o.c === xo.c) return; // already reported as merged/span
      if (shiftOf.has(dr[0])) return;
      const t = clip(xo.el.textContent); if (!t) return;
      const p = o ? (o.paras.find(q => q.text.trim()) || o.paras[0]) : P0; if (!p) return;
      push({ kind: 'xspan', P: p, s: 0, e: Math.max(1, p.text.length), text: p.text, sub: 'extracell', to: t, r: xo.r + 1, c: xo.c + 1, name: nm, xline: xlineOf(xo.el) });
    });
  }

  /* --- 3. front matter --- */
  const dFront = [];
  for (let k = 0; k < Math.min(flowStart, blocks.length); k++) { const b = blocks[k]; if (b.kind === 'p') { if (pNE(b.p)) dFront.push(b.p); } else b.t.paras.forEach(p => { if (pNE(p)) dFront.push(p); }); }
  boxSet.forEach(b => (b.kind === 'p' ? [b.p] : b.t.paras).forEach(p => { if (pNE(p)) dFront.push(p); }));
  const used = new Set();
  const fUnits = [];
  const subj = meta ? xDesc(xFirst(meta, 'article-categories'), 'subject')[0] : null;
  if (subj) fUnits.push({ type: 'atype', el: subj, build: out => xStream(subj, out, xSt0(NOFMT)), hint: /article_?type/i });
  const tg = meta ? xFirst(meta, 'title-group') : null; const at = tg ? xFirst(tg, 'article-title') : null;
  if (at) fUnits.push({ type: 'title', el: at, build: out => xStream(at, out, xSt0({ ignB: true })), hint: /title/i });
  const auths = meta ? xDesc(meta, 'contrib').filter(c => c.getAttribute('contrib-type') === 'author') : [];
  if (auths.length) fUnits.push({ type: 'authors', el: auths[0], hint: /author/i, build: out => {
    const C = { ignB: true };
    auths.forEach((a, k) => {
      if (k) xSynth(k === auths.length - 1 ? ' and ' : ', ', out, C, a);
      const nm = xFirst(a, 'name') || xFirst(a, 'string-name'); const col = xFirst(a, 'collab');
      if (nm) { const g = xFirst(nm, 'given-names'), s = xFirst(nm, 'surname'); if (g) xStream(g, out, xSt0(C)); if (g && s) xSynth(' ', out, C, nm); if (s) xStream(s, out, xSt0(C)); const sf = xFirst(nm, 'suffix'); if (sf) { xSynth(' ', out, C, nm); xStream(sf, out, xSt0(C)); } }
      else if (col) xStream(col, out, xSt0(C));
      const xr = xEls(a, 'xref');
      const CL = { ...C, lab: true };
      xr.forEach((r, j) => { if (j) xSynth(',', out, CL, r, { sup: true }); for (const ch of r.textContent.trim()) out.push({ ch, i: false, b: false, sup: true, sub: false, ctx: CL, el: r, syn: true }); });
    });
  } });
  const affs = meta ? xDesc(meta, 'aff') : [];
  affs.forEach(a => fUnits.push({ type: 'aff', el: a, hint: /affil/i, build: out => xStream(a, out, xSt0()) }));
  const an = meta ? xFirst(meta, 'author-notes') : null;
  if (an) [...an.children].forEach(c => { if (/^(corresp|fn)$/.test(c.localName)) fUnits.push({ type: c.localName, el: c, hint: /affil|corresp|note/i, build: out => { for (let d = c.firstChild; d; d = d.nextSibling) xStream(d, out, xSt0()); } }); });
  const abs = meta ? xEls(meta, 'abstract').filter(a => !a.getAttribute('abstract-type') || /^abstract$/i.test(a.getAttribute('abstract-type'))) : [];
  abs.forEach(a => fUnits.push({ type: 'abstract', el: a, hint: /abstract/i, multi: true, build: out => {
    for (let c = a.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.localName === 'title') continue;
      if (c.nodeType === 1 && c.localName === 'sec') {
        const t = xFirst(c, 'title'); const tt = t ? t.textContent.trim().replace(/\s*:$/, '') : '';
        // the “Abstract” heading or label in Word is not compared; a title that stands alone in Word (“Highlights”) is its own paragraph; other titles run into their text (“Background: …”)
        if (t && /^abstract$/i.test(tt)) { /* skipped */ }
        else if (t && absParas.some(P => P.text.trim().replace(/\s*:$/, '').toLowerCase() === tt.toLowerCase())) xStream(t, out, xSt0({ ignB: true, title: true }), {});
        else if (t) { out.push({ blk: true }); xStream(t, out, xSt0({ ignB: true, title: true }), {}); out.pop(); xSynth(': ', out, { ignB: true }, t); }
        for (let d = c.firstChild; d; d = d.nextSibling) if (!(d.nodeType === 1 && d.localName === 'title')) xStream(d, out, xSt0()); continue; }
      xStream(c, out, xSt0());
    }
  } }));
  const kg = meta ? xEls(meta, 'kwd-group').find(g => !g.getAttribute('kwd-group-type') || /author|keyword/i.test(g.getAttribute('kwd-group-type'))) : null;
  if (kg) fUnits.push({ type: 'kwd', el: kg, hint: /keyword/i, build: out => { xEls(kg, 'kwd').forEach((k, j) => { if (j) xSynth('; ', out, X_CTX0, k); xStream(k, out, xSt0()); }); } });
  // editor and dates (the box beside the abstract)
  const dstr = d => { if (!d) return null; const day = xFirst(d, 'day'), mo = xFirst(d, 'month'), yr = xFirst(d, 'year'); if (!yr) return null; return [day ? String(Number(day.textContent)) : '', mo ? (X_MONTHS[Number(mo.textContent) - 1] || mo.textContent) : '', yr.textContent.trim()].filter(Boolean).join(' '); };
  const metaLines = [];
  const eds = meta ? xDesc(meta, 'contrib').filter(c => c.getAttribute('contrib-type') === 'editor') : [];
  if (eds.length) { const role = (xFirst(eds[0], 'role') || {}).textContent || 'Academic Editor'; metaLines.push({ label: role.trim().replace(/s$/, '') + (eds.length > 1 ? 's' : ''), el: eds[0], val: eds.map(e => { const n = xFirst(e, 'name'); return n ? [((xFirst(n, 'given-names') || {}).textContent || '').trim(), ((xFirst(n, 'surname') || {}).textContent || '').trim()].filter(Boolean).join(' ') : e.textContent.trim(); }).join(eds.length > 2 ? ', ' : ' and ') }); }
  const hist = meta ? xFirst(meta, 'history') : null;
  if (hist) {
    const ds = t => xEls(hist, 'date').filter(d => d.getAttribute('date-type') === t);
    [['received', 'Received'], ['rev-recd', 'Revised'], ['accepted', 'Accepted']].forEach(([t, lb]) => { const D = ds(t); if (D.length) metaLines.push({ label: lb, el: D[0], val: D.map(dstr).filter(Boolean).join('; ') }); });
  }
  const pub = meta ? (xEls(meta, 'pub-date').find(d => /epub|electronic/.test((d.getAttribute('pub-type') || '') + (d.getAttribute('date-type') || '') + (d.getAttribute('publication-format') || ''))) || null) : null;
  if (pub && xFirst(pub, 'day')) metaLines.push({ label: 'Published', el: pub, val: dstr(pub) });
  metaLines.forEach(ml => fUnits.push({ type: 'meta', el: ml.el, label: ml.label, hint: null, build: out => { xSynth(ml.label + ': ', out, NOFMT, ml.el); xSynth(ml.val, out, NOFMT, ml.el); }, metaLine: ml }));
  const fset = w => new Set(normWords(w));
  const jac = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; a.forEach(x => { if (b.has(x)) n++; }); return n / (a.size + b.size - n); };
  const dFrontWords = dFront.map(P => fset(P.text));
  let absParas = dFront.filter(P => /abstract/i.test(P.styleName + P.styleId) && !/^\s*abstract\s*:?\s*$/i.test(P.text));
  // the abstract runs from its first heading or abstract-styled paragraph up to “Keywords:”: highlights (questions and bullets) and abstract text typed in another style belong to it, the editor/dates box beside it does not
  {
    const a0 = dFront.findIndex(P => /abstract/i.test(P.styleName + P.styleId) || /^\s*(Highlights|Abstract)\s*(:|$)/i.test(P.text));
    const a1 = a0 < 0 ? -1 : dFront.findIndex((P, k) => k > a0 && /^\s*Key\s*words?\s*:/i.test(P.text));
    if (a1 > a0) absParas = dFront.slice(a0, a1).filter(P => !/^(Citation|Copyright|Publisher’s Note|Received|Revised|Accepted|Published|Academic Editors?)\s*:/i.test(P.text.trim()) && !/^\s*abstract\s*:?\s*$/i.test(P.text) && !/^[\s\-–—_]*$/.test(P.text));
  }
  fUnits.forEach(u => {
    const out = []; u.build(out);
    if (u.type === 'abstract' && absParas.length) {
      const Ds = []; absParas.forEach(P => { used.add(P); const m = /^\s*Abstract\s*:\s*/i.exec(P.text); xDocStream(P, Ds, { from: m ? m[0].length : 0, label: false }); });
      diffStreams(Ds, out, { where: 'abstract', xel: u.el }); return;
    }
    if (u.type === 'meta') {
      const re = new RegExp('(^|;\\s*|\\t)\\s*' + u.label.replace(/s$/, '') + 's?\\s*:', 'i');
      let P = null, m = null; for (const Q of dFront) { if (used.has(Q) && !Q._metaSeg) continue; const mm = re.exec(Q.text); if (mm) { P = Q; m = mm; break; } }
      if (!P) return; used.add(P);
      const s = m.index + m[1].length; const n2 = P.text.slice(s + 1).search(/;\s*(Received|Revised|Accepted|Published|Academic Editors?)\s*:/i); const e = n2 >= 0 ? s + 1 + n2 : P.text.length;
      if (s > 0 || e < P.text.length) P._metaSeg = true;
      if (u.label === 'Published' && !/\d/.test(P.text.slice(s, e))) return;
      const Ds = []; xDocStream(P, Ds, { label: false, from: s, to: e });
      diffStreams(Ds, out, { where: 'meta', xel: u.el, noFmt: true, noSpace: true, noPara: true }); return;
    }
    const xs = fset(out.filter(c => !c.blk && !c.atom).map(c => c.ch).join(''));
    let best = null, bs = 0;
    dFront.forEach((P, k) => { if (used.has(P)) return; let s = jac(xs, dFrontWords[k]); if (u.hint && u.hint.test(P.styleName + P.styleId)) s += 0.15; if (s > bs) { bs = s; best = P; } });
    if (!best || bs < 0.2) { const P0 = dFront[0] || (blocks[0] && blocks[0].p); if (P0) push({ kind: 'xadd', P: P0, s: 0, e: Math.max(1, Math.min(10, P0.text.length)), text: P0.text, from: '', to: clip(out.filter(c => !c.blk && !c.atom).map(c => c.ch).join('')), xline: xlineOf(u.el), where: 'front' }); return; }
    used.add(best);
    let from = 0; if (u.type === 'kwd') { const m = /^\s*Keywords?\s*:\s*/i.exec(best.text); if (m) from = m[0].length; }
    const Ds = [];
    if (u.type === 'authors' && /author_?name/i.test(best.styleName + best.styleId)) { const grp = dFront.filter(Q => Q === best || (!used.has(Q) && Q.styleName === best.styleName)).sort((a, b) => a.idx - b.idx); grp.forEach(Q => { used.add(Q); xDocStream(Q, Ds, { label: false }); }); }
    else xDocStream(best, Ds, { from, label: false });
    diffStreams(Ds, out, { where: 'front', xel: u.el, noPara: true, noSpace: u.type === 'authors' });
  });
  dFront.forEach(P => { if (used.has(P)) return; const t = P.text.trim(); if (/^(abstract|article|communication|review)\s*:?$/i.test(t) && !subj) return; if (/^\s*abstract\s*:?\s*$/i.test(t) || /^(Citation|Copyright|Publisher’s Note|Received|Revised|Accepted|Published|Academic Editors?)\s*:/i.test(t) || /^[\s\-–—_]*$/.test(t)) return; push({ kind: 'xpara', P, s: 0, e: Math.max(1, P.text.length), text: P.text, from: clip(P.text), where: 'front' }); });

  /* --- 4. back matter --- */
  const xBack = [];
  const fst = meta ? xDesc(xFirst(meta, 'funding-group'), 'funding-statement')[0] : null;
  if (fst) xBack.push({ key: 'funding', el: fst, build: out => { xSynth('Funding: ', out, { ignB: true, title: true }, fst); xStream(fst, out, xSt0()); } });
  const unitOf = (el, title) => ({ key: xBackKey(title) || title.toLowerCase(), el, build: out => {
    const t = xFirst(el, 'title');
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c === t) { out.push({ blk: true }); xStream(t, out, xSt0(), {}); out.pop(); if (!/^appendix/i.test(title)) xSynth(': ', out, { ignB: true, title: true }, t); continue; }
      xStream(c, out, xSt0());
    }
  } });
  if (back) for (const c of back.children) {
    const ln = c.localName;
    if (ln === 'app-group') xEls(c, 'app').forEach(a => { const t = (xFirst(a, 'title') || {}).textContent || ''; xBack.push(unitOf(a, t.trim())); });
    else if (ln === 'app') { const t = (xFirst(c, 'title') || {}).textContent || ''; xBack.push(unitOf(c, t.trim())); }
    else if (/^(notes|ack|glossary)$/.test(ln)) { const t = (xFirst(c, 'title') || {}).textContent || (ln === 'ack' ? 'Acknowledgments' : ln === 'glossary' ? 'Abbreviations' : ''); xBack.push(unitOf(c, t.trim())); }
    else if (ln === 'fn-group') xEls(c, 'fn').forEach(fn => { const key = xBackKey(fn.textContent.trim()) || 'fn'; xBack.push({ key, el: fn, build: out => { for (let d = fn.firstChild; d; d = d.nextSibling) xStream(d, out, xSt0()); } }); });
    else if (ln === 'sec' && c.getAttribute('sec-type') !== 'display-objects') { const t = (xFirst(c, 'title') || {}).textContent || ''; xBack.push(unitOf(c, t.trim())); }
  }
  const dBackUnits = []; let cur = null;
  const backBlocks = []; for (let k = backStart; k < blocks.length; k++) { if (refHead >= 0 && k >= refHead && k < refEnd) continue; backBlocks.push(blocks[k]); }
  backBlocks.forEach(b => {
    if (floatSet.has(b)) return;
    if (b.kind === 'p') { const P = b.p; if (!pNE(P) || isFigPara(P)) return; const key = X_BACK.test(P.text) && (/^\s*[^:]{2,70}:/.test(P.text) || /^\s*Appendix\s+[A-Z]\b/i.test(P.text) || P.text.trim().length <= 60) ? xBackKey(P.text) : null; if (key) { cur = { key, items: [] }; dBackUnits.push(cur); } if (!cur) { cur = { key: '?', items: [] }; dBackUnits.push(cur); } cur.items.push(b); }
    else { if (!cur) { cur = { key: '?', items: [] }; dBackUnits.push(cur); } cur.items.push(b); }
  });
  const usedB = new Set();
  dBackUnits.forEach(u => {
    const x = xBack.find(x => !usedB.has(x) && x.key === u.key) || xBack.find(x => !usedB.has(x) && (x.key.startsWith(u.key) || u.key.startsWith(x.key)));
    const firstP = (u.items.find(b => b.kind === 'p') || {}).p || (u.items[0].t && u.items[0].t.paras[0]);
    if (!x) { if (firstP) push({ kind: 'xsec', P: firstP, s: 0, e: Math.max(1, Math.min(firstP.text.length, (firstP.text.indexOf(':') + 1) || 40)), text: firstP.text, from: clip(firstP.text.split(':')[0]), miss: true }); return; }
    usedB.add(x);
    const Ds = []; u.items.forEach(b => { if (b.kind === 'p') xDocStream(b.p, Ds); else if (xIsEqTable(b.t)) xEqTableStream(b.t, Ds); else xFlatTableStream(b.t, Ds); });
    const Xs = []; x.build(Xs);
    diffStreams(Ds, Xs, { where: 'back', anchorP: firstP, xel: x.el });
  });
  xBack.forEach(x => { if (usedB.has(x)) return; const P0 = (dBackUnits[0] && ((dBackUnits[0].items.find(b => b.kind === 'p') || {}).p)) || (blocks[refHead] && blocks[refHead].p) || (blocks[blocks.length - 1].p); if (P0) { const out = []; x.build(out); push({ kind: 'xsec', P: P0, s: 0, e: Math.max(1, Math.min(P0.text.length, 20)), text: P0.text, miss: false, to: clip(out.filter(c => !c.blk && !c.atom).map(c => c.ch).join('')), xline: xlineOf(x.el) }); } });

  /* --- 5. references --- */
  const dRefs = []; if (refHead >= 0) for (let k = refHead + 1; k < refEnd; k++) { const b = blocks[k]; if (b.kind === 'p' && pNE(b.p)) dRefs.push(b.p); }
  const xRefList = back ? xDesc(back, 'ref') : [];
  const refNum = P => { const m = (P.label || '').match(/\d+/) || P.text.match(/^\s*\[?(\d+)[\].)]?\s/); return m ? Number(m[1] || m[0]) : null; };
  const xRefNum = r => { const l = xFirst(r, 'label'); const m = l && l.textContent.match(/\d+/); return m ? Number(m[0]) : null; };
  const REF_NOISE = new Set(['ed', 'eds', 'in', 'pp', 'p', 'vol', 'available', 'online', 'accessed', 'on', 'https', 'http', 'doi', 'org', 'dx']);
  const REF_IT = /^(article-title|chapter-title|part-title|trans-title|data-title|italic)$/;
  const refStream = (r, out) => {
    const cit = xEls(r, /^(mixed-citation|element-citation|citation-alternatives|nlm-citation)$/)[0];
    if (!cit) return false;
    const c0 = cit.localName === 'citation-alternatives' ? (xEls(cit, /citation$/)[0] || cit) : cit;
    const mixed = c0.localName === 'mixed-citation';
    const walk = (n, st) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { if (mixed) xStream(c, out, st); continue; }
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 'person-group') { xEls(c, /^(name|string-name|collab|etal)$/).forEach((nm, j) => { if (j) xSynth('; ', out, st.ctx, nm); if (nm.localName === 'etal') { xSynth('et al.', out, st.ctx, nm); return; } if (nm.localName === 'collab') { xStream(nm, out, st); return; } const s = xFirst(nm, 'surname'), g = xFirst(nm, 'given-names'), sf = xFirst(nm, 'suffix'); if (s) xStream(s, out, st); if (g) { xSynth(', ', out, st.ctx, nm); xStream(g, out, st); } if (sf) { xSynth(', ', out, st.ctx, nm); xStream(sf, out, st); } }); if (!mixed) xSynth(' ', out, st.ctx, c); continue; }
        if (ln === 'label' || ln === 'object-id' || (ln === 'pub-id' && /^doi$/i.test(c.getAttribute('pub-id-type') || ''))) continue;
        const ctx = { ...st.ctx, refIt: REF_IT.test(ln) || st.ctx.refIt, free: st.ctx.free || (!mixed && /^(comment|std|date-in-citation|uri|ext-link|isbn|issn|annotation|series|access-date)$/.test(ln)) };
        // MDPI shows <pub-id pub-id-type="arxiv">2303.11366</pub-id> as “arXiv:2303.11366”
        if (!mixed && ln === 'pub-id' && /^arxiv$/i.test(c.getAttribute('pub-id-type') || '') && !/^\s*arxiv/i.test(c.textContent)) xSynth('arXiv:', out, ctx, c);
        // …and <isbn>978-3-030-10686-7</isbn> as “ISBN 978-3-030-10686-7” (likewise ISSN)
        if (!mixed && (ln === 'isbn' || ln === 'issn') && !/^\s*is[bs]n/i.test(c.textContent)) xSynth(ln.toUpperCase() + ' ', out, ctx, c);
        // …and <volume>1</volume> in a book (<element-citation publication-type="book">) as “Volume 1”
        if (!mixed && ln === 'volume' && /^book$/i.test(c0.getAttribute('publication-type') || '') && !/^\s*vol/i.test(c.textContent)) xSynth('Volume ', out, ctx, c);
        xStream(c, out, { ...st, ctx });
        if (!mixed) xSynth(' ', out, ctx, c);
      }
    };
    walk(c0, xSt0({ ref: true }));
    return !mixed;
  };
  const doiOf = s => { const m = (s || '').match(/10\.\d{4,9}\/(?:[^\s<>"]|<\d[^\s<>"]*>)+/); return m ? m[0].replace(/[.,;)\]]+$/, '') : null; };
  // pair references by their number, otherwise by position
  const xByNum = new Map(); xRefList.forEach(r => { const n = xRefNum(r); if (n != null && !xByNum.has(n)) xByNum.set(n, r); });
  const usedR = new Set();
  const pairR = []; dRefs.forEach((P, k) => { const n = refNum(P); let r = n != null ? xByNum.get(n) : null; if (!r || usedR.has(r)) r = xRefList[k] && !usedR.has(xRefList[k]) ? xRefList[k] : null; if (r) usedR.add(r); pairR[k] = r; });
  { // a reference whose words belong to another XML reference: the list order differs (two references swapped, one moved)
    const rw = s => new Set(normWords(s).filter(w => !REF_NOISE.has(w)));
    const dW = dRefs.map(P => rw(P.text.replace(/^\s*\[?\d+[\].)]?\s+/, ''))); const xW = new Map(xRefList.map(r => [r, rw([...r.childNodes].filter(c => !(c.nodeType === 1 && c.localName === 'label')).map(c => c.textContent).join(' '))]));
    const sim = dRefs.map((P, k) => pairR[k] ? jac(dW[k], xW.get(pairR[k])) : 0);
    const owner = new Map(); pairR.forEach((r, k) => { if (r) owner.set(r, k); });
    dRefs.forEach((P, k) => {
      if (sim[k] >= 0.5) return;
      let best = null, bs = 0; xRefList.forEach(r => { const k2 = owner.get(r); if (k2 != null && k2 !== k && sim[k2] >= 0.5) return; const s = jac(dW[k], xW.get(r)); if (s > bs) { bs = s; best = r; } });
      if (!best || best === pairR[k] || bs < 0.7 || bs < sim[k] + 0.3) return;
      const k2 = owner.get(best); const old = pairR[k];
      pairR[k] = best; owner.set(best, k); sim[k] = bs;
      if (k2 != null) { pairR[k2] = old; if (old) { owner.set(old, k2); sim[k2] = jac(dW[k2], xW.get(old)); if (sim[k2] >= 0.5) dRefs[k2]._xswap = true; } }
      else if (old) { owner.delete(old); usedR.delete(old); }
      usedR.add(best); dRefs[k]._xswap = true;
    });
    // the <ref> elements themselves in another order (labels kept): the longest run in Word order stays, the rest are out of place
    const seq = []; dRefs.forEach((P, k) => { if (pairR[k] && !P._xswap) seq.push({ k, j: xRefList.indexOf(pairR[k]) }); });
    const tails = [], tailIx = [], prev = []; seq.forEach((q, x) => { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < q.j) lo = m + 1; else hi = m; } tails[lo] = q.j; tailIx[lo] = x; prev[x] = lo ? tailIx[lo - 1] : -1; });
    const keep = new Set(); if (tails.length) for (let x = tailIx[tails.length - 1]; x >= 0; x = prev[x]) keep.add(x);
    seq.forEach((q, x) => { if (!keep.has(x)) dRefs[q.k]._xpos = q.j + 1; });
  }
  dRefs.forEach((P, k) => {
    const n = refNum(P);
    const r = pairR[k];
    if (!r) { push({ kind: 'xrefmiss', P, s: 0, e: Math.max(1, P.text.length), text: P.text, from: n != null ? String(n) : String(k + 1) }); return; }
    const xn = xRefNum(r);
    if (P._xswap) push({ kind: 'xrefswap', P, s: 0, e: Math.max(1, Math.min(P.text.length, 40)), text: P.text, from: n != null ? n : k + 1, to: xn != null ? xn : '?', xline: xlineOf(r) });
    else if (P._xpos) push({ kind: 'xrefswap', sub: 'pos', P, s: 0, e: Math.max(1, Math.min(P.text.length, 40)), text: P.text, from: n != null ? n : k + 1, to: P._xpos, xline: xlineOf(r) });
    else if (n != null && xn != null && xn !== n) push({ kind: 'xrefnum', P, s: 0, e: Math.max(1, Math.min(P.text.length, 12)), text: P.text, from: n, to: xn, xline: xlineOf(r) });
    const lm = P.text.match(/^\s*\[?\d+[\].)]?\s+/); const from = !P.label && lm ? lm[0].length : 0;
    const skip = []; const re = /(?:https?:\/\/)?(?:dx\.)?doi\.org\/|\bdoi:\s*/gi; let m; while ((m = re.exec(P.text)) !== null) skip.push([m.index, m.index + m[0].length]);
    const xPub = xDesc(r, 'pub-id').find(p => /^doi$/i.test(p.getAttribute('pub-id-type') || ''));
    const dd0 = doiOf(P.text); if (xPub && dd0) { const s0 = P.text.indexOf(dd0); if (s0 >= 0) skip.push([s0, s0 + dd0.length]); }
    const Ds = []; xDocStream(P, Ds, { from, label: false, skip });
    const Xs = []; const elem = refStream(r, Xs);
    diffStreams(Ds, Xs, { where: 'ref', ref: true, bag: true, moves: true, wordsOnly: elem, noise: elem ? REF_NOISE : null, noSpace: elem, noPara: false, xel: r, anchorP: P });
    const dd = dd0, xd = ((xPub || {}).textContent || doiOf(r.textContent) || '').trim();
    if (dd && xd && dd.toLowerCase() !== xd.trim().toLowerCase()) { const s = P.text.indexOf(dd); push({ kind: 'xchg', P, s: Math.max(0, s), e: Math.max(1, s + dd.length), text: P.text, from: dd, to: xd.trim(), xline: xlineOf(r), where: 'ref', doi: true }); }
    else if (dd && !xd) { const s = P.text.indexOf(dd); push({ kind: 'xmiss', P, s: Math.max(0, s), e: Math.max(1, s + dd.length), text: P.text, from: dd, xline: xlineOf(r), where: 'ref', doi: true }); }
    else if (!dd && xd && xPub) { const e = Math.max(1, P.text.replace(/\s+$/, '').length); push({ kind: 'xadd', P, s: Math.max(0, e - 1), e, text: P.text, from: '', to: xd, xline: xlineOf(xPub), where: 'ref', doi: true }); }
  });
  xRefList.forEach(r => { if (usedR.has(r)) return; const P0 = dRefs[dRefs.length - 1] || (blocks[refHead] && blocks[refHead].p); if (P0) push({ kind: 'xrefadd', P: P0, s: 0, e: Math.max(1, Math.min(P0.text.length, 12)), text: P0.text, from: String(xRefNum(r) ?? ''), to: clip(r.textContent), xline: xlineOf(r) }); });

  /* --- 6. XML structure: links, labels, display, lists and article data, which the Word text cannot show --- */
  const P00 = dFront[0] || (blocks.find(b => b.kind === 'p' && pNE(b.p)) || {}).p || M.paras[0];
  const anchorOf = el => {
    for (let e = el, up = 0; e && e.nodeType === 1 && up < 8; e = e.parentNode, up++) {
      if (elMap.has(e)) return elMap.get(e);
      const w = X.createTreeWalker(e, 1); let n, c = 0; while ((n = w.nextNode()) && c++ < 5000) if (elMap.has(n)) return elMap.get(n);
    }
    return null;
  };
  const sPush = (el, it, len, find) => {
    const a = anchorOf(el); const P = a ? a.P : P00; if (!P) return;
    let s = a ? a.pos : 0;
    if (find) { const k = P.text.indexOf(find, Math.max(0, s - 400)); const k2 = k >= 0 ? k : P.text.indexOf(find); if (k2 >= 0) { s = k2; len = find.length; } }
    s = Math.max(0, Math.min(s, P.text.length - 1));
    push({ ...it, P, s, e: Math.max(s + 1, Math.min(P.text.length, s + Math.max(1, len || 1))), text: P.text, xline: it.xline || xlineOf(el) });
  };
  const XLNS = 'http://www.w3.org/1999/xlink';
  const hrefOf = e => (e.getAttributeNS(XLNS, 'href') || e.getAttribute('xlink:href') || '').trim();
  const allEls = [...X.getElementsByTagName('*')];
  const byId = new Map(), idCnt = new Map();
  allEls.forEach(e => { const id = e.getAttribute('id'); if (!id) return; idCnt.set(id, (idCnt.get(id) || 0) + 1); if (!byId.has(id)) byId.set(id, e); });
  idCnt.forEach((n, id) => { if (n > 1) sPush(byId.get(id), { kind: 'xlink', sub: 'dupid', from: id, to: String(n) }); });
  // every <xref> must reach an element of its own type, and its number must be that element's label
  const X_RT = { bibr: 'ref', fig: 'fig', table: 'table-wrap', 'disp-formula': 'disp-formula', aff: 'aff', fn: 'fn', 'table-fn': 'fn', app: 'app', sec: 'sec', corresp: 'corresp', 'supplementary-material': 'supplementary-material', scheme: 'fig', 'boxed-text': 'boxed-text' };
  const xKey = t => { t = String(t || '').trim(); const m = t.match(/(?:^|[\s(\[])((?:[A-Z]{1,2})?\d+(?:\.\d+)*)/); if (m) return m[1]; const m2 = t.match(/\b(?:Appendix|Section|Box)\s+([A-Z])\b/); return m2 ? m2[1] : null; };
  const labelOf = t => { const l = xFirst(t, 'label'); if (l && l.textContent.trim()) return l.textContent.trim(); const ti = xFirst(t, 'title'); return ti ? ti.textContent.trim() : ''; };
  allEls.filter(e => e.localName === 'xref').forEach(x => {
    const rt = x.getAttribute('ref-type') || ''; const rids = (x.getAttribute('rid') || '').trim().split(/\s+/).filter(Boolean);
    const txt = x.textContent.replace(/\s+/g, ' ').trim();
    if (!rids.length) { sPush(x, { kind: 'xlink', sub: 'norid', from: txt, to: '' }, txt.length); return; }
    rids.forEach(r => {
      const t = byId.get(r);
      if (!t) { sPush(x, { kind: 'xlink', sub: 'norid', from: txt, to: r }, txt.length); return; }
      const want = X_RT[rt]; if (want && t.localName !== want) sPush(x, { kind: 'xlink', sub: 'type', from: txt, to: r, rt, tag: t.localName }, txt.length);
    });
    if (rids.length !== 1 || /[–—\-,;]/.test(txt)) return;
    const t = byId.get(rids[0]); if (!t || !/^(ref|fig|table-wrap|disp-formula|app|sec|aff|fn|supplementary-material|boxed-text)$/.test(t.localName) || (X_RT[rt] && t.localName !== X_RT[rt])) return;
    const lab = labelOf(t); const a = xKey(txt), b = xKey(lab);
    if (a && b && a !== b) sPush(x, { kind: 'xlink', sub: 'label', from: txt, to: rids[0], lab: lab.replace(/\s+/g, ' ').slice(0, 60) }, txt.length);
  });
  // “Figure 2”, “Table 3”, “Section 2.1”, “Appendix A” typed as plain text instead of an <xref>
  const ULX = /\b(Figures?|Tables?|Sections?|Schemes?|Charts?|Boxes|Box|Appendix|Appendices)\s+((?:[A-Z]?\d+)(?:\.\d+)*|[A-Z](?![\w-]))/g; // a letter alone only after Appendix
  const skipUL = e => { for (let a = e; a && a.nodeType === 1; a = a.parentNode) { if (a.namespaceURI === MMLNS || /^(xref|label|title|ext-link|uri|ref-list|ref|object-id|supplementary-material|front|tex-math|alt-text|graphic)$/.test(a.localName)) return true; } return false; };
  let nUL = 0;
  [body, back].forEach(root => {
    if (!root) return; const w = X.createTreeWalker(root, 4); let n;
    while ((n = w.nextNode()) && nUL < 40) {
      const sv = n.nodeValue; if (!/(Figure|Table|Section|Scheme|Chart|Box|Appendi)/.test(sv) || skipUL(n.parentNode)) continue;
      let m; ULX.lastIndex = 0;
      while ((m = ULX.exec(sv)) !== null) { if (/^S\d/.test(m[2]) || (/^[A-Z]$/.test(m[2]) && !/^Append/.test(m[1])) || /^\s*(of|in)\s/.test(sv.slice(m.index + m[0].length))) continue; nUL++; sPush(n.parentNode, { kind: 'xlink', sub: 'unlinked', from: m[0], check: true }, m[0].length, m[0]); }
    }
  });
  // equations: display style and ids
  const dfs = [...X.getElementsByTagName('disp-formula')];
  const anyFid = dfs.some(d => d.getAttribute('id'));
  dfs.forEach(d => {
    const lbl = ((xFirst(d, 'label') || {}).textContent || '').trim();
    [...d.getElementsByTagNameNS(MMLNS, 'math')].forEach(m => { if ((m.getAttribute('display') || '') !== 'block' && !(m.parentNode && m.parentNode.closest && m.parentNode.closest('inline-formula'))) sPush(d, { kind: 'xstruct', sub: 'dispblock', lbl, xline: xlineOf(m) }); });
    if (anyFid && !d.getAttribute('id')) sPush(d, { kind: 'xstruct', sub: 'noid', lbl, check: true });
  });
  [...X.getElementsByTagName('inline-formula')].forEach(f => [...f.getElementsByTagNameNS(MMLNS, 'math')].forEach(m => { if (m.getAttribute('display') === 'block') sPush(f, { kind: 'xstruct', sub: 'inlineblock', xline: xlineOf(m) }); }));
  // lists: Word numbering format ↔ list-type
  const X_LT = { bullet: 'bullet', decimal: 'order', lowerLetter: 'alpha-lower', upperLetter: 'alpha-upper', lowerRoman: 'roman-lower', upperRoman: 'roman-upper' };
  const X_STDB = /^[\u2022\uF0B7\u00B7\u2219\u25CF\uF06C]?$/;
  allEls.filter(e => e.localName === 'list').forEach(l => {
    const lis = xEls(l, 'list-item'); const lt = l.getAttribute('list-type'); if (!lis.length || !lt) return;
    const lab = lis.some(li => xFirst(li, 'label'));
    const p0 = xFirst(lis[0], 'p') || lis[0]; const a = anchorOf(p0); if (!a || !a.P.num) return;
    const fmt = a.P.num.fmt; const gl = fmt === 'bullet' ? (a.P.num.text || '') : '';
    const sym = fmt === 'bullet' && !X_STDB.test(gl);
    if (sym) {
      const g = X_GLYPH[gl] || gl;
      if (lt === 'bullet') { sPush(p0, { kind: 'xstruct', sub: 'listsym', from: g, to: lt, xline: xlineOf(l), check: true }, 1); return; }
      if (lt === 'simple' && !lab && !lis.every(li => X_LSYM.test(((xFirst(li, 'p') || li).textContent || '').trim().charAt(0)))) sPush(p0, { kind: 'xstruct', sub: 'listnosym', from: g, xline: xlineOf(l), check: true }, 1);
      return;
    }
    if (lab) return;
    const want = X_LT[fmt]; if (!want || lt === want || (want === 'order' && lt === 'arabic')) return;
    sPush(p0, { kind: 'xstruct', sub: 'list', from: fmt, to: lt, want, xline: xlineOf(l) }, 1);
  });
  // article DOI ↔ volume / issue / article number
  const tv = n => (meta && xFirst(meta, n) ? xFirst(meta, n).textContent.trim() : '');
  const aid = meta ? xEls(meta, 'article-id').find(a => a.getAttribute('pub-id-type') === 'doi') : null;
  const vol = tv('volume'), iss = tv('issue'), eloc = tv('elocation-id') || tv('fpage');
  if (aid && /^\d+$/.test(vol) && /^\d+$/.test(iss) && /^\d+$/.test(eloc)) {
    const m = aid.textContent.trim().match(/^10\.3390\/([a-z]+)(\d+)$/i); const exp = vol + iss.padStart(2, '0') + eloc.padStart(4, '0');
    if (m && m[2] !== exp) sPush(aid, { kind: 'xstruct', sub: 'doi', from: aid.textContent.trim(), to: m[1] + exp, vol, iss, eloc, xline: xlineOf(aid) }, 1);
  }
  // history dates in order: received ≤ revised ≤ accepted ≤ published
  const dv = d => { const y = xFirst(d, 'year'), mo = xFirst(d, 'month'), dy = xFirst(d, 'day'); return y ? Number(y.textContent) * 10000 + (mo ? Number(mo.textContent) : 0) * 100 + (dy ? Number(dy.textContent) : 0) : 0; };
  const dseq = [];
  if (hist) [['received', 'Received'], ['rev-recd', 'Revised'], ['accepted', 'Accepted']].forEach(([t, lb]) => xEls(hist, 'date').filter(d => d.getAttribute('date-type') === t).forEach(d => dseq.push({ lb, d, v: dv(d) })));
  if (pub && dv(pub)) dseq.push({ lb: 'Published', d: pub, v: dv(pub) });
  for (let k = 1; k < dseq.length; k++) if (dseq[k].v && dseq[k - 1].v && dseq[k].v < dseq[k - 1].v) sPush(dseq[k].d, { kind: 'xstruct', sub: 'date', from: dseq[k - 1].lb + ' ' + dstr(dseq[k - 1].d), to: dseq[k].lb + ' ' + dstr(dseq[k].d), xline: xlineOf(dseq[k].d) }, 1);
  dseq.forEach(({ lb, d }) => { const mo = Number((xFirst(d, 'month') || {}).textContent || 1), dy = Number((xFirst(d, 'day') || {}).textContent || 1); if (!(mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31)) sPush(d, { kind: 'xstruct', sub: 'baddate', from: lb, to: [(xFirst(d, 'day') || {}).textContent, (xFirst(d, 'month') || {}).textContent, (xFirst(d, 'year') || {}).textContent].filter(Boolean).join('/'), xline: xlineOf(d) }, 1); });
  // copyright year: Word “Copyright: © 2026”, <copyright-year>, <copyright-statement> and the publication year agree
  const cy = meta ? xDesc(meta, 'copyright-year')[0] : null;
  if (cy) {
    const y = cy.textContent.trim();
    const wc = M.paras.slice(0, 200).find(P => /^\s*Copyright\s*:/i.test(P.text));
    const cPush = (it, el) => { if (wc) { const k = Math.max(0, wc.text.search(/\d{4}/)); push({ ...it, P: wc, s: k, e: Math.min(wc.text.length, k + 4) || k + 1, text: wc.text, xline: xlineOf(el) }); } else sPush(el, it, 1); };
    const wm = wc && wc.text.match(/©\s*(\d{4})/);
    if (wm && wm[1] !== y) cPush({ kind: 'xstruct', sub: 'cyear', from: wm[1], to: y }, cy);
    const cs = xDesc(meta, 'copyright-statement')[0]; const cm = cs && cs.textContent.match(/©\s*(\d{4})/);
    if (cm && cm[1] !== y) cPush({ kind: 'xstruct', sub: 'cstmt', from: cm[1], to: y }, cs);
    const py = pub && xFirst(pub, 'year') ? xFirst(pub, 'year').textContent.trim() : '';
    if (py && py !== y && !(wm && wm[1] !== y)) cPush({ kind: 'xstruct', sub: 'cpub', from: py, to: y }, cy);
  }
  // figure images: Figure n must use the article's own …-g00n file
  const pid = meta ? ((xEls(meta, 'article-id').find(a => a.getAttribute('pub-id-type') === 'publisher-id') || {}).textContent || '').trim() : '';
  allEls.filter(e => e.localName === 'fig').forEach(f => {
    const lab = ((xFirst(f, 'label') || {}).textContent || '').trim(); const g = f.getElementsByTagName('graphic')[0]; if (!g) return;
    const href = hrefOf(g); const cap = xFirst(f, 'caption') || f; const m = lab.match(/^Figure\s+(\d+)\.?$/i); const gm = href.match(/-g(\d+)\.[A-Za-z0-9]+$/);
    if (m && gm && Number(gm[1]) !== Number(m[1])) sPush(cap, { kind: 'xstruct', sub: 'graphic', from: lab, to: href, want: '-g' + m[1].padStart(3, '0'), xline: xlineOf(g) }, lab.length, lab);
    else if (pid && href && /-g\d+\.[A-Za-z0-9]+$/.test(href) && !href.startsWith(pid + '-')) sPush(cap, { kind: 'xstruct', sub: 'graphicid', from: lab, to: href, want: pid, xline: xlineOf(g) }, lab.length, lab);
  });
  // links: the address shown must be the address linked
  allEls.filter(e => /^(ext-link|uri)$/.test(e.localName)).forEach(l => {
    const href = hrefOf(l); const t = l.textContent.replace(/\s+/g, '');
    if (!href || !/^(https?:\/\/|www\.|(dx\.)?doi\.org\/|10\.\d{4,}\/)/i.test(t)) return;
    const dec = s => { try { return decodeURI(s); } catch (e) { return s; } };
    const norm = s => dec(s).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/^dx\.doi\.org\//i, 'doi.org/').replace(/\/+$/, '').toLowerCase();
    let hn = norm(href), tn = norm(t); if (/^10\./.test(tn)) tn = 'doi.org/' + tn; if (/^10\./.test(hn)) hn = 'doi.org/' + hn;
    if (hn !== tn) sPush(l, { kind: 'xstruct', sub: 'extlink', from: t, to: href, xline: xlineOf(l) }, t.length, t);
  });
  allEls.filter(e => e.localName === 'email').forEach(m => { const t = m.textContent.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) sPush(m, { kind: 'xstruct', sub: 'email', from: t, xline: xlineOf(m) }, t.length, t); });
  // a group or organisation written as a person (<name><surname>STROBE Initiative</surname></name>, no <given-names>) belongs in <collab>
  const X_ORG = /\b(Initiative|Group|Organi[sz]ation|Association|Society|Committee|Council|Agency|Institute|Institution|Department|Ministry|Office|Foundation|Consortium|Network|Cent(?:er|re)|Collaborat(?:ion|ive|ors)|Board|Commission|Panel|Team|Task Force|Working Party|Union|University|Bureau|Service|Company|Corporation|Federation|Alliance|Program(?:me)?|Project|Authority|Administration|Registry|Trust|Investigators|Inc|Ltd|LLC|GmbH|Co)\b\.?/;
  allEls.filter(e => e.localName === 'name' && e.closest && e.closest('ref')).forEach(nm => {
    const sn = xFirst(nm, 'surname'), gn = xFirst(nm, 'given-names');
    if (!sn || (gn && gn.textContent.trim())) return;
    const t = sn.textContent.replace(/\s+/g, ' ').trim();
    if (!t) return;
    // an organisation word, or an acronym of two letters or more (WHO, STROBE): a group, so <collab>; any other surname-only name is shown to check (Both, 2026-11-20), as a person known by one name may stay
    if (X_ORG.test(t) || /(?:^|\s)[A-Z][A-Z0-9&-]+(?=\s|$)/.test(t)) sPush(nm, { kind: 'xstruct', sub: 'collab', from: t, xline: xlineOf(nm) }, t.length, t);
    else sPush(nm, { kind: 'xstruct', sub: 'surnameonly', from: t, xline: xlineOf(nm), check: true }, t.length, t);
  });
  // funding: award numbers and funders listed in <award-group> appear in the Funding text
  const fgp = meta ? xFirst(meta, 'funding-group') : null;
  if (fgp) {
    const nrm = s => s.replace(/\s+/g, ' ').trim().toLowerCase(); const stTxt = nrm(xDesc(fgp, 'funding-statement').map(e => e.textContent).join(' '));
    if (stTxt) xDesc(fgp, 'award-group').forEach(ag => {
      xDesc(ag, 'award-id').forEach(a => { const t = a.textContent.trim(); if (t && !stTxt.includes(nrm(t))) sPush(a, { kind: 'xstruct', sub: 'award', from: t, xline: xlineOf(a) }, 1); });
      xDesc(ag, 'institution').forEach(a => { const t = a.textContent.trim(); if (t && !stTxt.includes(nrm(t))) sPush(a, { kind: 'xstruct', sub: 'funder', from: t, xline: xlineOf(a), check: true }, 1); });
    });
  }
  // characters that render as boxes or nothing: private-use (Symbol font leftovers), U+FFFD, control and zero-width characters
  const X_ODD = /[\uE000-\uF8FF\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B\uFEFF]/g;
  { const w = X.createTreeWalker(art, 4); let n, k = 0; while ((n = w.nextNode()) && k < 20) { const sv = n.nodeValue; const odd = sv.match(X_ODD); if (!odd) continue; k++; const i0 = sv.search(X_ODD); sPush(n.parentNode, { kind: 'xstruct', sub: 'char', from: [...new Set(odd)].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(', '), to: sv.slice(Math.max(0, i0 - 20), i0 + 20).replace(X_ODD, '□').replace(/\s+/g, ' ').trim(), xline: xlineOf(n.parentNode) }, 1); } }

  /* --- text moved to another place: a missing run that appears as an addition elsewhere --- */
  const core = k => k.replace(/^(?:[^\p{L}\p{N}\s]+ )+|(?: [^\p{L}\p{N}\s]+)+$/u, '');
  const adds = items.filter(it => it.kind === 'xadd' && it.keyStr && it.keyStr.split(' ').length >= 6);
  items.filter(it => (it.kind === 'xmiss' || it.kind === 'xpara') && it.keyStr && it.keyStr.split(' ').length >= 6).forEach(it => {
    const ka = core(it.keyStr);
    const a = adds.find(x => { if (x.moved) return false; const kb = core(x.keyStr); return kb === ka || (Math.min(ka.length, kb.length) > 40 && (kb.includes(ka) || ka.includes(kb))); });
    if (!a) return; a.moved = true; it.kind = 'xmove'; it.to = a.xline;
  });
  for (let k = items.length - 1; k >= 0; k--) if (items[k].moved) items.splice(k, 1);

  /* --- messages --- */
  const VN = v => ({ sup: tx('ตัวยก', 'superscript'), sub: tx('ตัวห้อย', 'subscript'), base: tx('ตัวปกติ (ไม่ยก/ไม่ห้อย)', 'baseline') })[v] || v;
  const WHERE = w => ({ body: '', caption: tx('คำบรรยาย: ', 'Caption: '), cell: tx('เซลล์ตาราง: ', 'Table cell: '), tfoot: tx('ใต้ตาราง: ', 'Table footer: '), front: '', abstract: tx('Abstract: ', 'Abstract: '), meta: '', back: '', ref: tx('อ้างอิง: ', 'Reference: ') })[w] || '';
  const eqName = it => it.lbl ? tx(`สมการ ${it.lbl}`, `Equation ${it.lbl}`) : tx('สมการ', 'Equation');
  // what to type in the XML: the Unicode code of each symbol that differs (Both, 2026-11-17: “Word Φ → &#x03A6;”), since look-alikes such as Φ/ϕ, μ/µ, −/- or Δ/∆ cannot be told apart by eye
  const uC = ch => `${ch} (&#x${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')};)`;
  const symHint = (from, to) => {
    const sp = v => (!v || v === '∅') ? [] : [...new Set([...String(v).replace(/frac|sqrt/g, '')].filter(ch => !/[A-Za-z0-9\s{}^_.,]/.test(ch)))];
    const a = sp(from), b = sp(to); const wS = a.filter(c => !b.includes(c)), xS = b.filter(c => !a.includes(c));
    if ((!wS.length && !xS.length) || wS.length + xS.length > 4) return '';
    if (wS.length && xS.length) return tx(`\n→ ใน XML ให้ใช้ ${wS.map(uC).join(', ')} แทน ${xS.map(uC).join(', ')}`, `\n→ in the XML use ${wS.map(uC).join(', ')} instead of ${xS.map(uC).join(', ')}`);
    if (wS.length) return tx(`\n→ ใน XML ยังไม่มี ${wS.map(uC).join(', ')}`, `\n→ not yet in the XML: ${wS.map(uC).join(', ')}`);
    return tx(`\n→ ใน XML มี ${xS.map(uC).join(', ')} ที่ Word ไม่มี`, `\n→ in the XML but not in Word: ${xS.map(uC).join(', ')}`);
  };
  const msg = it => {
    const W0 = WHERE(it.where);
    switch (it.kind) {
      case 'xmiss': return W0 + (it.doi ? tx(`DOI นี้ไม่มีใน XML: “${it.from}”`, `This DOI is missing from the XML: “${it.from}”`) : tx(`ข้อความนี้ไม่มีในไฟล์ XML: “${it.from}”`, `This text is missing from the XML: “${it.from}”`));
      case 'xpara': return W0 + tx('ย่อหน้านี้ไม่มีในไฟล์ XML', 'This paragraph is missing from the XML');
      case 'xadd': return W0 + (it.doi ? tx(`ไฟล์ XML มี DOI ที่ไม่มีใน Word: “${it.to}”`, `The XML has a DOI that is not in Word: “${it.to}”`) : it.from ? tx(`ไฟล์ XML มีข้อความเกิน${it.after ? 'หลัง' : 'ก่อน'}คำนี้: “${it.to}”`, `The XML has extra text ${it.after ? 'after' : 'before'} this word: “${it.to}”`) : tx(`ไฟล์ XML มีข้อความที่ไม่มีใน Word: “${it.to}”`, `The XML has text that is not in Word: “${it.to}”`));
      case 'xchg': return W0 + (it.doi ? tx(`DOI ไม่ตรง: Word “${it.from}” → XML “${it.to}”`, `DOI differs: Word “${it.from}” → XML “${it.to}”`) : tx(`ข้อความไม่ตรง: Word “${it.from}” → XML “${it.to}”`, `Text differs: Word “${it.from}” → XML “${it.to}”`) + (String(it.from).length <= 12 && String(it.to).length <= 12 ? symHint(it.from, it.to) : ''));
      case 'xmove': return W0 + tx(`ข้อความนี้อยู่คนละตำแหน่งในไฟล์ XML (บรรทัด ${it.to})`, `This text sits in a different place in the XML (line ${it.to})`);
      case 'xspace': return W0 + tx(`ช่องว่างไม่ตรง: Word “${it.from}” → XML “${it.to}”`, `Spacing differs: Word “${it.from}” → XML “${it.to}”`);
      case 'xfmt': {
        const parts = it.sig.split(',').map(d => {
          if (d === 'i+') return tx('Word เป็นตัวเอียง แต่ XML ไม่เอียง', 'italic in Word, not italic in the XML');
          if (d === 'i-') return tx('XML เป็นตัวเอียง แต่ Word ไม่เอียง', 'italic in the XML, not italic in Word');
          if (d === 'b+') return tx('Word เป็นตัวหนา แต่ XML ไม่หนา', 'bold in Word, not bold in the XML');
          if (d === 'b-') return tx('XML เป็นตัวหนา แต่ Word ไม่หนา', 'bold in the XML, not bold in Word');
          if (d === 'u+') return tx('Word ขีดเส้นใต้ แต่ XML ไม่มี <underline>', 'underlined in Word, no <underline> in the XML');
          if (d === 'u-') return tx('XML มี <underline> แต่ Word ไม่ขีดเส้นใต้', '<underline> in the XML, not underlined in Word');
          if (d === 'sc+') return tx('Word เป็นตัวพิมพ์ใหญ่เล็ก (small caps) แต่ XML ไม่มี <sc>', 'small caps in Word, no <sc> in the XML');
          if (d === 'sc-') return tx('XML มี <sc> แต่ Word ไม่ใช่ small caps', '<sc> in the XML, not small caps in Word');
          const [a, b] = d.slice(2).split('>'); return tx(`Word เป็น${VN(a)} แต่ XML เป็น${VN(b)}`, `${VN(a)} in Word, ${VN(b)} in the XML`);
        });
        return W0 + tx(`รูปแบบไม่ตรง “${it.from}”: `, `Formatting differs “${it.from}”: `) + parts.join('; ');
      }
      case 'xmath': return tx(`${eqName(it)} ไม่ตรง: Word “${it.ctxA || ''}${it.from}${it.ctxB || ''}” → XML “${it.ctxA || ''}${it.to}${it.ctxB || ''}”\nWord: ${clip(it.full)}\nXML: ${clip(it.fullX)}`, `${eqName(it)} differs: Word “${it.ctxA || ''}${it.from}${it.ctxB || ''}” → XML “${it.ctxA || ''}${it.to}${it.ctxB || ''}”\nWord: ${clip(it.full)}\nXML: ${clip(it.fullX)}`) + symHint(it.from, it.to);
      case 'xmathfmt': {
        const p = [];
        if (it.itW && it.itW.length) p.push(tx(`Word เอียงแต่ XML ตัวตรง: ${it.itW.map(s => `“${s}”`).join(', ')}`, `italic in Word, upright in the XML: ${it.itW.map(s => `“${s}”`).join(', ')}`));
        if (it.itX && it.itX.length) p.push(tx(`XML เอียงแต่ Word ตัวตรง: ${it.itX.map(s => `“${s}”`).join(', ')}`, `italic in the XML, upright in Word: ${it.itX.map(s => `“${s}”`).join(', ')}`));
        if (it.bW && it.bW.length) p.push(tx(`Word หนาแต่ XML ไม่หนา: ${it.bW.map(s => `“${s}”`).join(', ')}`, `bold in Word only: ${it.bW.map(s => `“${s}”`).join(', ')}`));
        if (it.bX && it.bX.length) p.push(tx(`XML หนาแต่ Word ไม่หนา: ${it.bX.map(s => `“${s}”`).join(', ')}`, `bold in the XML only: ${it.bX.map(s => `“${s}”`).join(', ')}`));
        const VN2 = v => ({ normal: tx('ตัวปกติ', 'normal'), 'sans-serif': 'sans-serif', script: tx('ตัวเขียน (script)', 'script'), fraktur: 'fraktur', 'double-struck': tx('ตัวเส้นคู่ (double-struck)', 'double-struck'), monospace: 'monospace' })[v] || v;
        (it.vD || []).forEach(d => p.push(tx(`แบบตัวอักษรไม่ตรง ${[...new Set(d.s)].map(s => `“${s}”`).join(', ')}: Word เป็น${VN2(d.w)} แต่ XML เป็น ${VN2(d.x)} (mathvariant)`, `letter style differs ${[...new Set(d.s)].map(s => `“${s}”`).join(', ')}: ${VN2(d.w)} in Word, ${VN2(d.x)} in the XML (mathvariant)`)));
        (it.limD || []).forEach(d => p.push(d.w === 'undOvr' ? tx(`ขอบเขตของ “${d.c}” ใน Word อยู่ใต้/บนเครื่องหมาย แต่ใน XML อยู่ข้างเครื่องหมาย (msub/msup/msubsup) → ใช้ munder/mover/munderover`, `the limits of “${d.c}” sit under/over it in Word but beside it in the XML (msub/msup/msubsup) → use munder/mover/munderover`) : tx(`ขอบเขตของ “${d.c}” ใน Word อยู่ข้างเครื่องหมาย แต่ใน XML อยู่ใต้/บน (munder/mover) → ใช้ msub/msup/msubsup`, `the limits of “${d.c}” sit beside it in Word but under/over it in the XML (munder/mover) → use msub/msup/msubsup`)));
        const fix = [];
        if (it.itW && it.itW.length) fix.push(tx('ตัวที่ต้องเอียง: ใช้ <mi> ตัวอักษรเดียวโดยไม่ใส่ mathvariant (เอียงเอง) หรือใส่ mathvariant="italic"; ถ้าเป็นข้อความธรรมดาใช้ <italic>', 'to make it italic: a one-letter <mi> without mathvariant (italic by default) or mathvariant="italic"; in plain text use <italic>'));
        if (it.itX && it.itX.length) fix.push(tx('ตัวที่ต้องตรง: ใส่ mathvariant="normal" ที่ <mi> (หรือใช้ <mo>/<mtext>); ถ้าเป็นข้อความธรรมดาเอา <italic> ออก', 'to make it upright: mathvariant="normal" on the <mi> (or use <mo>/<mtext>); in plain text remove <italic>'));
        if (it.bW && it.bW.length) fix.push(tx('ตัวที่ต้องหนา: ใส่ mathvariant="bold" (หรือ "bold-italic" ถ้าเอียงด้วย)', 'to make it bold: mathvariant="bold" (or "bold-italic" when also italic)'));
        if (it.bX && it.bX.length) fix.push(tx('ตัวที่ต้องไม่หนา: เอา mathvariant="bold…" ออก', 'to make it not bold: remove mathvariant="bold…"'));
        (it.vD || []).forEach(d => { const ss = [...new Set(d.s)].map(s => `“${s}”`).join(', ');
          if (d.w !== 'normal') fix.push(tx(`${ss}: ใส่ mathvariant="${d.w}" ที่ <mi>`, `${ss}: set mathvariant="${d.w}" on the <mi>`));
          else if (d.wi === 'u') fix.push(tx(`${ss}: เปลี่ยนเป็น mathvariant="normal" (ใน Word เป็นตัวตรง)`, `${ss}: change to mathvariant="normal" (upright in Word)`));
          else if (d.wi === 'i') fix.push(tx(`${ss}: เอา mathvariant="${d.x}…" ออก (<mi> ตัวอักษรเดียวจะเอียงเอง ถ้า <mi> มีหลายตัวให้ใส่ mathvariant="italic")`, `${ss}: remove mathvariant="${d.x}…" (a one-letter <mi> is italic by default; for several letters use mathvariant="italic")`));
          else fix.push(tx(`${ss}: เอา mathvariant="${d.x}…" ออก ถ้าใน Word เอียง หรือใส่ mathvariant="normal" ถ้าใน Word ตรง`, `${ss}: remove mathvariant="${d.x}…" if italic in Word, or use mathvariant="normal" if upright`));
        });
        const onlyV = !(it.itW || []).length && !(it.itX || []).length && !(it.bW || []).length && !(it.bX || []).length;
        return (onlyV ? tx(`${eqName(it)}: `, `${eqName(it)}: `) : tx(`${eqName(it)}: ตัวเอียง/ตัวหนาของสัญลักษณ์ไม่ตรง — `, `${eqName(it)}: symbol italic/bold differs — `)) + p.join('; ') + (fix.length ? '\n→ ' + fix.join('\n→ ') : '');
      }
      case 'xmathsp': {
        const miss = it.spD.filter(d => d.w), extra = it.spD.filter(d => !d.w);
        const many = it.spD.length > 1;
        const L = a => a.map(d => `Word “${d.from}” → XML “${d.to}”` + (many && d.line ? tx(` (บรรทัด ${d.line})`, ` (line ${d.line})`) : '')).join('; ');
        const p = [];
        if (miss.length) p.push(tx(`Word มีช่องว่างแต่ XML ไม่มี: ${L(miss)} → ใส่ <mtext>&#xA0;</mtext> หรือ <mspace> ตรงนั้น`, `space in Word but not in the XML: ${L(miss)} → add <mtext>&#xA0;</mtext> or <mspace> there`));
        if (extra.length) p.push(tx(`XML มีช่องว่างแต่ Word ไม่มี: ${L(extra)}`, `space in the XML but not in Word: ${L(extra)}`));
        if (miss.some(d => d.trim)) p.push(tx('ช่องว่างที่พิมพ์ไว้ต้นหรือท้ายคำใน <mi>/<mtext> เช่น <mi>for </mi> จะไม่แสดงใน MathML', 'a space typed at the start or end of <mi>/<mtext>, as in <mi>for </mi>, is not shown in MathML'));
        return tx(`${eqName(it)}: ช่องว่างไม่ตรง — `, `${eqName(it)}: spacing differs — `) + p.join('; ');
      }
      case 'xstretch': {
        const d = it.st; const E0 = eqName(it);
        const sym = d.sty === 'acc' || d.sty === 'grp' ? tx(`“${X_SPACING[d.acc] || d.acc}” บน “${d.base}”`, `“${X_SPACING[d.acc] || d.acc}” over “${d.base}”`) : `“${d.sym}”`;
        const has = d.attr === true ? 'stretchy="true"' : d.attr === false ? 'stretchy="false"' : '';
        if (d.sty === 'acc' && d.w === false) return tx(`${E0}: ${sym} ใน Word เป็นขนาดปกติ ไม่ยืด แต่ใน XML ${has ? 'ใส่ ' + has : 'ไม่ได้ใส่ stretchy="false"'} จึงยืดตามฐาน → ใส่ stretchy="false" ที่ <mo> ของเครื่องหมายนี้`, `${E0}: ${sym} keeps its own size in Word, but in the XML ${has ? 'it has ' + has : 'stretchy="false" is missing'}, so it stretches over its base → add stretchy="false" to this <mo>`);
        if (d.sty === 'acc' || d.sty === 'grp') return tx(`${E0}: ${sym} ใน Word ยาวคลุมทั้งฐาน แต่ใน XML ใส่ stretchy="false" จึงไม่คลุม → เอา stretchy="false" ออก`, `${E0}: ${sym} spans its whole base in Word, but the XML has stretchy="false", so it does not → remove stretchy="false"`);
        if (d.sty === 'delim') return d.w ? tx(`${E0}: วงเล็บ ${sym} ใน Word ขยายตามความสูงของเนื้อหา แต่ใน XML ใส่ stretchy="false" จึงไม่ขยาย → เอา stretchy="false" ออก`, `${E0}: the brackets ${sym} grow with their content in Word, but the XML has stretchy="false" → remove stretchy="false"`) : tx(`${E0}: วงเล็บ ${sym} ใน Word ไม่ขยายตามเนื้อหา (ปิด Grow) แต่ใน XML ${has ? 'ใส่ ' + has + ' ' : ''}จะยืดตามเนื้อหา → ใส่ stretchy="false"`, `${E0}: the brackets ${sym} do not grow in Word (Grow is off), but in the XML ${has ? 'with ' + has + ' ' : ''}they stretch with their content → add stretchy="false"`);
        return d.w ? tx(`${E0}: ${sym} ใน Word ขยายตามเนื้อหา (Grow) แต่ใน XML ไม่ได้ใส่ stretchy="true"`, `${E0}: ${sym} grows with its content in Word (Grow), but the XML has no stretchy="true"`) : tx(`${E0}: ${sym} ใน Word ไม่ขยายตามเนื้อหา แต่ใน XML ใส่ stretchy="true" → เอา stretchy="true" ออก`, `${E0}: ${sym} does not grow in Word, but the XML has stretchy="true" → remove it`);
      }
      case 'xmathtype': return it.wordMath ? tx(`${eqName(it)} ใน Word เป็นสมการ (Equation) แต่ใน XML เป็นข้อความธรรมดา ไม่ใช่ MathML`, `${eqName(it)} is an equation object in Word but plain text in the XML (not MathML)`) : tx(`${eqName(it)} ใน Word เป็นข้อความธรรมดา แต่ใน XML เป็น MathML`, `${eqName(it)} is plain text in Word but MathML in the XML`);
      case 'xtable': if (it.sub === 'notable') return tx(`${it.from} ใน XML ไม่มีตาราง (<table>)`, `${it.from} has no <table> in the XML`); return it.sub === 'rows' ? tx(`${it.name}: จำนวนแถวไม่ตรง — Word ${it.from} แถว, XML ${it.to} แถว`, `${it.name}: row count differs — Word ${it.from}, XML ${it.to}`) : tx(`${it.name}: จำนวนคอลัมน์ไม่ตรง — Word ${it.from} คอลัมน์, XML ${it.to} คอลัมน์`, `${it.name}: column count differs — Word ${it.from}, XML ${it.to}`);
      case 'xrow': return it.miss ? tx(`${it.name}: แถวนี้ไม่มีใน XML: “${it.from}”`, `${it.name}: this row is missing from the XML: “${it.from}”`) : tx(`${it.name}: XML มีแถวที่ไม่มีใน Word: “${it.to}”`, `${it.name}: the XML has a row that is not in Word: “${it.to}”`);
      case 'xspan': {
        const at = tx(`${it.name} แถว ${it.r} คอลัมน์ ${it.c}`, `${it.name} row ${it.r}, column ${it.c}`);
        if (it.sub === 'colspan') return tx(`${at}: การผสานคอลัมน์ไม่ตรง — Word กว้าง ${it.from} คอลัมน์ (gridSpan) แต่ XML colspan=${it.to}`, `${at}: column merge differs — Word spans ${it.from} column(s), XML colspan=${it.to}`);
        if (it.sub === 'rowspan') return tx(`${at}: การผสานแถวไม่ตรง — Word สูง ${it.from} แถว (vMerge) แต่ XML rowspan=${it.to}`, `${at}: row merge differs — Word spans ${it.from} row(s), XML rowspan=${it.to}`);
        if (it.sub === 'merged') return tx(`${at}: ใน XML เซลล์นี้ถูกรวมเข้ากับเซลล์แถว ${it.xr} คอลัมน์ ${it.xc} (colspan=${it.xcs}, rowspan=${it.xrs}) แต่ใน Word เป็นเซลล์แยก: “${it.from}”`, `${at}: in the XML this cell is merged into the cell at row ${it.xr}, column ${it.xc} (colspan=${it.xcs}, rowspan=${it.xrs}); in Word it is separate: “${it.from}”`);
        if (it.sub === 'shift') return tx(`${it.name} แถว ${it.r}: เซลล์ในแถวนี้ของ XML เลื่อนไป${it.d > 0 ? 'ทางขวา' : 'ทางซ้าย'} ${Math.abs(it.d)} คอลัมน์ — มักเกิดจาก rowspan/colspan ของเซลล์ด้านบนหรือด้านซ้ายไม่ตรงกับ Word`, `${it.name} row ${it.r}: the XML cells in this row are shifted ${Math.abs(it.d)} column(s) to the ${it.d > 0 ? 'right' : 'left'} — usually a rowspan/colspan above or to the left that differs from Word`);
        if (it.sub === 'nocell') return tx(`${at}: ไม่มีเซลล์นี้ใน XML: “${it.from}”`, `${at}: this cell is missing from the XML: “${it.from}”`);
        return tx(`${at}: XML มีเซลล์เกิน: “${it.to}”`, `${at}: the XML has an extra cell: “${it.to}”`);
      }
      case 'xfloat': return it.miss ? tx(`ไม่พบ ${it.from} ในไฟล์ XML`, `${it.from} was not found in the XML`) : tx(`ไฟล์ XML มี ${it.from} ที่ไม่มีใน Word`, `The XML has ${it.from}, which is not in Word`);
      case 'xsec': return it.miss ? tx(`ส่วน “${it.from}” ไม่มีในไฟล์ XML`, `The section “${it.from}” is missing from the XML`) : tx(`ไฟล์ XML มีส่วนที่ไม่มีใน Word: “${it.to}”`, `The XML has a section that is not in Word: “${it.to}”`);
      case 'xlink': {
        const q = `“${it.from}”`;
        if (it.sub === 'dupid') return tx(`id="${it.from}" ซ้ำกัน ${it.to} ที่ในไฟล์ XML ลิงก์ที่ชี้ไป id นี้จะไปผิดที่ได้`, `id="${it.from}" occurs ${it.to} times in the XML; links to it may go to the wrong place`);
        if (it.sub === 'norid') return it.to ? tx(`ลิงก์ ${q} ชี้ไปที่ rid="${it.to}" ซึ่งไม่มีในไฟล์ XML`, `The link ${q} points to rid="${it.to}", which does not exist in the XML`) : tx(`ลิงก์ ${q} ไม่มี rid`, `The link ${q} has no rid`);
        if (it.sub === 'type') return tx(`ลิงก์ ${q} เป็น ref-type="${it.rt}" แต่ชี้ไปที่ <${it.tag}> (rid="${it.to}")`, `The link ${q} has ref-type="${it.rt}" but points to a <${it.tag}> (rid="${it.to}")`);
        if (it.sub === 'label') return tx(`ลิงก์ ${q} ชี้ไปที่ “${it.lab}” (rid="${it.to}") เลขไม่ตรงกัน`, `The link ${q} points to “${it.lab}” (rid="${it.to}"); the numbers differ`);
        if (it.sub === 'unlinked') return tx(`${q} ใน XML เป็นข้อความธรรมดา ไม่ได้ลิงก์ด้วย <xref>`, `${q} is plain text in the XML, not linked with <xref>`);
        return it.sub;
      }
      case 'xstruct': {
        const E0 = eqName(it);
        switch (it.sub) {
          case 'dispblock': return tx(`${E0}: <mml:math> ใน <disp-formula> ไม่มี display="block" จึงแสดงแบบสมการในบรรทัด (เศษส่วนเล็ก ขอบเขตของ ∑ อยู่ข้าง) → ใส่ display="block"`, `${E0}: the <mml:math> in this <disp-formula> has no display="block", so it renders as inline math (small fractions, ∑ limits at the side) → add display="block"`);
          case 'inlineblock': return tx('สมการในบรรทัด: <mml:math> ใน <inline-formula> มี display="block" จึงแสดงเป็นสมการแยกบรรทัด → เอา display="block" ออก', 'Inline equation: the <mml:math> in this <inline-formula> has display="block", so it renders as a display equation → remove display="block"');
          case 'noid': return tx(`${E0}: <disp-formula> นี้ไม่มี id ทั้งที่สมการอื่นมี จึงลิงก์มาที่สมการนี้ไม่ได้`, `${E0}: this <disp-formula> has no id, although the other equations do, so it cannot be linked to`);
          case 'list': { const F = { bullet: tx('สัญลักษณ์หัวข้อย่อย (bullet)', 'bullets'), decimal: tx('ตัวเลข 1. 2. 3.', 'numbers 1. 2. 3.'), lowerLetter: 'a. b. c.', upperLetter: 'A. B. C.', lowerRoman: 'i. ii. iii.', upperRoman: 'I. II. III.' }; return tx(`รายการ: Word ใช้${F[it.from] || it.from} แต่ XML ใส่ list-type="${it.to}" → ควรเป็น list-type="${it.want}"`, `List: Word uses ${F[it.from] || it.from} but the XML has list-type="${it.to}" → should be list-type="${it.want}"`); }
          case 'listsym': return tx(`รายการ: Word ใช้สัญลักษณ์ “${it.from}” แต่ XML ใส่ list-type="bullet" ซึ่งจะแสดงเป็น • → ควรเป็น list-type="simple" และใส่สัญลักษณ์ใน <label> หรือพิมพ์ไว้หน้าข้อความ`, `List: Word uses the symbol “${it.from}” but the XML has list-type="bullet", which shows • → use list-type="simple" with the symbol in <label> or typed before the text`);
          case 'listnosym': return tx(`รายการ: Word ใช้สัญลักษณ์ “${it.from}” แต่รายการ list-type="simple" ใน XML ไม่มีสัญลักษณ์ (ไม่มี <label> และไม่ได้พิมพ์ไว้หน้าข้อความ)`, `List: Word uses the symbol “${it.from}” but this list-type="simple" list in the XML shows no symbol (no <label>, nothing typed before the text)`);
          case 'doi': return tx(`DOI ของบทความ “${it.from}” ไม่ตรงกับ volume ${it.vol}, issue ${it.iss}, elocation-id ${it.eloc} ใน XML (ควรเป็น 10.3390/${it.to})`, `The article DOI “${it.from}” does not match volume ${it.vol}, issue ${it.iss}, elocation-id ${it.eloc} in the XML (expected 10.3390/${it.to})`);
          case 'date': return tx(`วันที่ใน XML เรียงผิด: ${it.to} มาก่อน ${it.from}`, `Dates in the XML are out of order: ${it.to} is before ${it.from}`);
          case 'baddate': return tx(`วันที่ ${it.from} ใน XML ไม่ถูกต้อง (${it.to})`, `The ${it.from} date in the XML is not a valid date (${it.to})`);
          case 'cyear': return tx(`ปีลิขสิทธิ์ไม่ตรง: Word © ${it.from} แต่ XML <copyright-year> ${it.to}`, `Copyright year differs: Word © ${it.from}, XML <copyright-year> ${it.to}`);
          case 'cstmt': return tx(`ปีใน <copyright-statement> (© ${it.from}) ไม่ตรงกับ <copyright-year> ${it.to}`, `The year in <copyright-statement> (© ${it.from}) differs from <copyright-year> ${it.to}`);
          case 'cpub': return tx(`<copyright-year> ${it.to} ไม่ตรงกับปีที่ตีพิมพ์ใน XML (${it.from})`, `<copyright-year> ${it.to} differs from the publication year in the XML (${it.from})`);
          case 'graphic': return tx(`${it.from}: ไฟล์รูปที่ลิงก์ไว้คือ “${it.to}” ซึ่งเป็นเลขรูปอื่น (ควรลงท้าย ${it.want})`, `${it.from}: the linked image is “${it.to}”, which is another figure's number (expected …${it.want})`);
          case 'graphicid': return tx(`${it.from}: ไฟล์รูป “${it.to}” ไม่ได้ขึ้นต้นด้วยรหัสบทความนี้ (${it.want})`, `${it.from}: the image file “${it.to}” does not start with this article's id (${it.want})`);
          case 'extlink': return tx(`ลิงก์ใน XML แสดง “${it.from}” แต่ชี้ไปที่ “${it.to}”`, `A link in the XML shows “${it.from}” but points to “${it.to}”`);
          case 'email': return tx(`อีเมล “${it.from}” ใน XML รูปแบบไม่ถูกต้อง`, `The email “${it.from}” in the XML is not a valid address`);
          case 'collab': return tx(`อ้างอิง: “${it.from}” อยู่ใน <name><surname> โดยไม่มี <given-names> จึงถูกอ่านเป็นชื่อคน ชื่อองค์กรหรือกลุ่มให้ใช้ <collab> → <collab>${it.from}</collab>`, `Reference: “${it.from}” is in <name><surname> with no <given-names>, so it reads as a person. A group or organisation name goes in <collab> → <collab>${it.from}</collab>`);
          case 'surnameonly': return tx(`อ้างอิง: “${it.from}” มีแค่ <surname> ไม่มี <given-names> ถ้าเป็นชื่อองค์กร บริษัท หรือกลุ่ม ให้เปลี่ยนเป็น <collab>${it.from}</collab> ถ้าเป็นคนที่มีชื่อเดียวใช้แบบเดิมได้`, `Reference: “${it.from}” has only a <surname>, no <given-names>. If it is a company, group or organisation, use <collab>${it.from}</collab>; a person known by one name can stay as it is`);
          case 'award': return tx(`Funding: เลขทุน “${it.from}” ใน <award-id> ไม่มีในข้อความ Funding`, `Funding: the award number “${it.from}” in <award-id> is not in the Funding text`);
          case 'funder': return tx(`Funding: ผู้ให้ทุน “${it.from}” ใน <funding-source> ไม่มีในข้อความ Funding`, `Funding: the funder “${it.from}” in <funding-source> is not in the Funding text`);
          case 'char': return tx(`XML มีอักขระที่แสดงเป็นกล่องหรือมองไม่เห็น (${it.from}) ใน “${it.to}”`, `The XML has characters that show as boxes or nothing (${it.from}) in “${it.to}”`);
        }
        return it.sub;
      }
      case 'xrefmiss': return tx(`รายการอ้างอิงที่ ${it.from} ไม่มีในไฟล์ XML`, `Reference ${it.from} is missing from the XML`);
      case 'xrefadd': return tx(`ไฟล์ XML มีรายการอ้างอิงเกิน (ลำดับที่ ${it.from}): “${it.to}”`, `The XML has an extra reference (no. ${it.from}): “${it.to}”`);
      case 'xrefmove': return tx(`อ้างอิง: ลำดับไม่ตรง — “${it.from}” ใน Word อยู่${it.wAfter ? `หลัง “${it.wAfter}”` : 'ต้นรายการ'} แต่ใน XML อยู่${it.xAfter ? `หลัง “${it.xAfter}”` : 'ต้นรายการ'}`, `Reference: order differs — “${it.from}” comes ${it.wAfter ? `after “${it.wAfter}”` : 'first'} in Word but ${it.xAfter ? `after “${it.xAfter}”` : 'first'} in the XML`);
      case 'xrefswap': if (it.sub === 'pos') return tx(`ลำดับรายการอ้างอิงไม่ตรง: อ้างอิง ${it.from} อยู่เป็นรายการที่ ${it.to} ในไฟล์ XML (<ref> อยู่ผิดตำแหน่ง)`, `Reference list order differs: reference ${it.from} is entry ${it.to} in the XML (the <ref> is out of place)`);
        return tx(`ลำดับรายการอ้างอิงไม่ตรง: อ้างอิงลำดับที่ ${it.from} ใน Word อยู่ลำดับที่ ${it.to} ใน XML`, `Reference list order differs: reference ${it.from} in Word is number ${it.to} in the XML`);
      case 'xrefnum': return tx(`เลขลำดับอ้างอิงไม่ตรง: Word ${it.from} → XML ${it.to}`, `Reference number differs: Word ${it.from} → XML ${it.to}`);
    }
    return it.kind;
  };
  const XCHECK = ['xspace', 'xmathtype', 'xmove'];
  const lineTag = it => it.xline ? tx(` [XML บรรทัด ${it.xline}]`, ` [XML line ${it.xline}]`) : '';
  const findings = items.map(it => ({ P: it.P, s: it.s, e: it.e, sev: XCHECK.includes(it.kind) || it.check ? 'check' : 'error', cat: it.kind, sec: '', msg: msg(it) + lineTag(it), rule: '', _it: it }));
  findings.sort((a, b) => a.P.idx - b.P.idx || a.s - b.s);
  let blob = null;
  if (findings.length) {
    findings.forEach(f => { f.lines = [f.msg]; });
    let startId = 0;
    const existingPath = Object.values(O.rels).find(r => /\/comments$/.test(r.type));
    const cPath = existingPath ? (existingPath.target.startsWith('/') ? existingPath.target.slice(1) : O.dir + existingPath.target) : O.dir + 'comments.xml';
    const existing = existingPath ? await O.zip.file(cPath)?.async('string') : null;
    if (existing) { const ids = [...existing.matchAll(/w:id="(-?\d+)"/g)].map(m => Number(m[1])); startId = ids.length ? Math.max(...ids) + 1 : 0; }
    const docIds = [...O.files.document.matchAll(/<w:comment(?:RangeStart|RangeEnd|Reference)\b[^>]*w:id="(\d+)"/g)].map(m => Number(m[1]));
    if (docIds.length) startId = Math.max(startId, Math.max(...docIds) + 1);
    applyComments(M, findings, { startId, refStyle: M.S.hasCommentRef || null });
    O.zip.file(O.docPath, ser(M.doc));
    O.zip.file(cPath, buildCommentsXml(existing, findings, { author: 'MDPI XML Compare', initials: 'XML' }));
    if (!existingPath) {
      const rel = O.relsDoc.createElementNS(RELNS, 'Relationship');
      let k = 1; while (O.rels['rIdMdpiX' + k]) k++;
      rel.setAttribute('Id', 'rIdMdpiX' + k);
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
  const xParasN = body ? xDesc(body, 'p').filter(p => !p.closest || !p.closest('fig, table-wrap')).length : 0;
  const xmlStats = {
    wParas: dParas, xParas: xParasN,
    wFloats: dFloats.filter(f => !f.anon).length, xFloats: xFloatList.filter(x => x.key).length,
    wTables: dFloats.filter(f => f.T && !f.anon).length, xTables: xFloatList.filter(x => x.key && x.el.localName === 'table-wrap').length,
    wEq: M.doc.getElementsByTagNameNS(MNS, 'oMath').length + [...M.doc.getElementsByTagNameNS(W, 'object')].filter(xIsOleEq).length, xEq: X.getElementsByTagNameNS(MMLNS, 'math').length, xDisp: X.getElementsByTagName('disp-formula').length,
    wRefs: dRefs.length, xRefs: xRefList.length, ...stat
  };
  return {
    blob, removedComments, mode: 'xml', xmlStats,
    items: findings.map(f => { const it = f._it; return { kind: f.cat, sev: f.sev, para: f.P.idx, label: null, text: f.P.text.replace(/￼/g, '▣'), s: f.s, e: f.e, from: it.from, to: it.to, xline: it.xline || null, where: it.where || null, msg: f.msg, img: null }; }),
    stats: { totalTok: 0, missTok: 0 }
  };
}

