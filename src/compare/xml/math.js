/* =====================================================================
   v25: XML (JATS) ↔ Word compare. The XML must carry exactly what the Word file has:
   text, italic/bold/superscript/subscript, tables (rows, columns, colspan/rowspan, cells),
   equations (OMML ↔ MathML: symbols, structure, italics), captions, front/back matter and
   references. Findings become comments in the Word file, each naming the XML line.
   ===================================================================== */
const MMLNS = 'http://www.w3.org/1998/Math/MathML';
const X_INV = /[⁡-⁤​-‍﻿­]/g;
const X_WS = /[\s  -   　]/;
const X_ACC = (() => { const m = {}; const set = (cs, v) => [...cs].forEach(c => { m[c] = v; });
  set('¯‾ˉ̄̅', '̄'); set('^ˆ̂', '̂'); set('~˜̃∼', '̃'); set('˙̇', '̇'); set('¨̈', '̈');
  set('→⃗', '⃗'); set('ˇ̌', '̌'); set('´́', '́'); set('`̀', '̀'); set('˘̆', '̆'); set('̲_', '̲'); return m; })();
// stretchy: Word draws hat-type accents at their own size; bars, group characters and growing delimiters span their base
const X_ST_FIX = new Set(['̂', '̃', '̌', '̆', '̇', '̈', '́', '̀']);
const X_ST_SPAN = new Set(['̄', '̲']);
const X_ST_DEF = new Set([...'^ˆ̂~˜̃ˇ̌¯‾ˉ_̲→←↔⃗⏞⏟︷︸⏜⏝⎴⎵']); // MathML accents that stretch when stretchy is not given
const X_SPACING = { '̂': 'ˆ', '̃': '˜', '̌': 'ˇ', '̆': '˘', '̇': '˙', '̈': '¨', '́': '´', '̀': '`', '̄': '¯', '̲': '_' };
const X_FENCE = /^[()\[\]{}|‖⟨⟩⌈⌉⌊⌋〈〉]$/;
const X_CLOSE = { '(': ')', '[': ']', '{': '}', '|': '|', '‖': '‖', '⟨': '⟩', '〈': '〉', '⌈': '⌉', '⌊': '⌋' };
const X_GRPCH = /^[⏞⏟︷︸⏜⏝⎴⎵]$/;
const xGraphs = L => L.filter(x => !x.mk).reduce((n, x) => n + (x.c.replace(/\s/g, '').match(/\P{M}\p{M}*/gu) || []).length, 0);
const xTall = L => L.some(x => (x.mk && /^(frac|stk|mat)\{$/.test(x.c)) || (!x.mk && /[∑∏∐∫∬∭∮√]/.test(x.c)));
const xStAttr = el => { const v = el && el.getAttribute ? (el.getAttribute('stretchy') || '').trim() : ''; return v === 'true' ? true : v === 'false' ? false : null; };
const xAccMo = n => { let e = n; while (e && e.localName === 'mrow' && e.children.length === 1) e = e.children[0]; return e || n; };
const SYMBOL_EXTRA = { 0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2D: '−', 0x40: '≅', 0x5E: '⊥', 0x7E: '∼', 0xA2: '′', 0xA3: '≤', 0xA5: '∞', 0xAB: '↔', 0xAC: '←', 0xAD: '↑', 0xAE: '→', 0xAF: '↓', 0xB0: '°', 0xB1: '±', 0xB2: '″', 0xB3: '≥', 0xB4: '×', 0xB5: '∝', 0xB6: '∂', 0xB7: '•', 0xB8: '÷', 0xB9: '≠', 0xBA: '≡', 0xBB: '≈', 0xBC: '…', 0xC6: '∅', 0xCE: '∈', 0xD0: '∠', 0xD1: '∇', 0xD6: '√', 0xD7: '⋅', 0xD8: '¬', 0xD9: '∧', 0xDA: '∨', 0xDB: '⇔', 0xDE: '⇒', 0xE5: '∑', 0xF2: '∫' };
const X_SPOP = /^[=≠<>≤≥≪≫≈≅≡≢∼≃∝≜≔+−±∓×·⋅∙÷∗∘\/∈∉∋⊂⊃⊆⊇→←↔⇒⇐⇔↦∧∨∩∪∖⊕⊗≺≻⪯⪰∣∥⊥∀∃¬∑∏∐∫∬∭∮]$/;
const X_LARGEOP = /^([∑∏∐∫∬∭∮∯∰⋃⋂⋁⋀⨀⨁⨂⨄⨆]|lim|max|min|sup|inf|lim\s?sup|lim\s?inf)$/;
const X_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---- equations → linear items {c, it, b} and structure markers {c, mk:true} ---- */
function xPushC(out, it) {
  if (!it.mk && /^\p{M}+$/u.test(it.c) && out.length && !out[out.length - 1].mk) { const p = out[out.length - 1]; out[out.length - 1] = { ...p, c: p.c + it.c }; return; }
  out.push(it);
}
function xAccent(out, base, chr, st, el) {
  const a = X_ACC[chr] || null;
  const ex = st === undefined ? {} : { st, el: el || null, sty: 'acc', acc: a || chr, base: xLinStr(base.filter(x => !x.mk)) };
  if (a && base.length === 1 && !base[0].mk) { out.push({ ...base[0], c: base[0].c + a, ...ex }); return; }
  out.push({ c: 'acc' + (a || chr) + '{', mk: true, ...ex }); base.forEach(x => out.push(x)); out.push({ c: '}', mk: true });
}
const xMval = el => el ? (el.getAttributeNS(MNS, 'val') ?? el.getAttribute('m:val')) : null;
function xMk(el, name) { if (!el) return null; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.namespaceURI === MNS && c.localName === name) return c; return null; }
function xMks(el, name) { const o = []; if (!el) return o; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.namespaceURI === MNS && (!name || c.localName === name)) o.push(c); return o; }
// Word math: Latin letters and lowercase Greek are italic unless the run says otherwise
const xVar = v => !v ? 'normal' : /sans-serif/.test(v) ? 'sans-serif' : /double-struck/.test(v) ? 'double-struck' : /fraktur/.test(v) ? 'fraktur' : /script/.test(v) ? 'script' : /monospace/.test(v) ? 'monospace' : 'normal';
const xDefIt = ch => /^[A-Za-zıȷα-ωϑϕϖϰϱϵℓ]/.test(ch);
const xOn = el => { const v = xMval(el); return !!el && !(v === '0' || v === 'off' || v === 'false'); };
const X_FUNCS = /^(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|coth|log|ln|lg|exp|lim|max|min|sup|inf|det|dim|ker|deg|arg|gcd|Pr|mod|var|cov|sgn|sign|tr|rank|erf)$/;
const X_LIM = { nary: 'undOvr', int: 'subSup', disp: false };
function linOmml(el) { const out = []; const d0 = X_LIM.disp; X_LIM.disp = !!(el && (el.localName === 'oMathPara' || (el.parentNode && el.parentNode.localName === 'oMathPara'))); xOm(el, out, 0); X_LIM.disp = d0; return out; }
function xOm(el, out, ea, fnm) {
  if (!el || el.nodeType !== 1) return;
  if (el.namespaceURI === W) {
    if (el.localName === 'r') { const wr = kid(el, 'rPr'); const it = !!(wr && kid(wr, 'i') && onOff(kid(wr, 'i'))), b = !!(wr && kid(wr, 'b') && onOff(kid(wr, 'b'))); for (const t of kids(el, 't')) for (const ch of t.textContent) xPushC(out, { c: ch, it: /\p{L}/u.test(ch) ? it : null, b }); }
    return;
  }
  if (el.namespaceURI !== MNS) return;
  const ln = el.localName;
  if (/Pr$/.test(ln) || ln === 'ctrlPr') return;
  const mk = c => out.push({ c, mk: true });
  const sub = name => xOm(xMk(el, name), out, ea, fnm);
  const grp = name => { const t = []; xOm(xMk(el, name), t, ea, fnm); return t; };
  switch (ln) {
    case 'r': {
      const rPr = xMk(el, 'rPr'); const sty = xMval(xMk(rPr, 'sty')); const nor = xMk(rPr, 'nor'); const scr = xMval(xMk(rPr, 'scr'));
      const wr = kid(el, 'rPr');
      let it = null, b = false;
      if (nor && xOn(nor)) { it = !!(wr && kid(wr, 'i') && onOff(kid(wr, 'i'))); b = !!(wr && kid(wr, 'b') && onOff(kid(wr, 'b'))); }
      else if (sty) { it = /i/.test(sty); b = /b/.test(sty); }
      const rf = wr && kid(wr, 'rFonts'); const sym = rf && (isSymbolFont(wa(rf, 'ascii')) || isSymbolFont(wa(rf, 'hAnsi')));
      // the run's characters in order: typed text, or a character inserted with Insert > Symbol (<w:sym w:font="Symbol" w:char="F046"/> is Φ), as when a symbol MathType could not convert is added back by hand (metals-4645510)
      const chs = [];
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.localName === 't' && (c.namespaceURI === MNS || c.namespaceURI === W)) { for (const ch of c.textContent) chs.push(sym ? SYMBOL_GREEK[ch] || SYMBOL_EXTRA[ch.codePointAt(0)] || ch : ch); }
        else if (c.localName === 'sym' && c.namespaceURI === W) { const code = parseInt(wa(c, 'char') || '0', 16); const k = code >= 0xF000 ? code - 0xF000 : code; const ch = String.fromCharCode(k); chs.push(isSymbolFont(wa(c, 'font') || 'Symbol') ? SYMBOL_GREEK[ch] || SYMBOL_EXTRA[k] || ch : ch); }
      }
      const unk = it === null && fnm; // a function name without a style: Word may show it upright, so its italic is not compared
      for (const g of chs) {
        if (ea && g === '&') continue; // alignment mark in an equation array
        xPushC(out, { c: g, it: /\p{L}/u.test(g) ? (unk ? undefined : it === null ? xDefIt(g) : it) : null, b, v: nor && xOn(nor) ? undefined : xVar(scr && scr !== 'roman' ? scr : '') });
      }
      return;
    }
    case 'acc': { // Word keeps hat-type accents at their own size; a bar accent spans a base of two or more characters
      const chr = xMval(xMk(xMk(el, 'accPr'), 'chr')) || '̂'; const a = X_ACC[chr]; const g = grp('e');
      xAccent(out, g, chr, X_ST_FIX.has(a) ? false : X_ST_SPAN.has(a) && xGraphs(g) > 1 ? true : undefined); return;
    }
    case 'bar': { const pos = xMval(xMk(xMk(el, 'barPr'), 'pos')) || 'bot'; const g = grp('e'); xAccent(out, g, pos === 'top' ? '¯' : '̲', xGraphs(g) > 1 ? true : undefined); return; }
    case 'groupChr': { const chr = xMval(xMk(xMk(el, 'groupChrPr'), 'chr')) || '⏟'; const g = grp('e'); out.push({ c: 'grp' + chr + '{', mk: true, st: true, sty: 'grp', acc: chr, base: xLinStr(g.filter(x => !x.mk)) }); g.forEach(x => out.push(x)); mk('}'); return; }
    case 'd': {
      const pr = xMk(el, 'dPr'); const bc = xMk(pr, 'begChr'), ec = xMk(pr, 'endChr'), sc = xMk(pr, 'sepChr'), gr = xMk(pr, 'grow');
      const beg = bc ? (xMval(bc) ?? '') : '(', end = ec ? (xMval(ec) ?? '') : ')', sep = sc ? (xMval(sc) ?? '') : '|';
      const inner = []; xMks(el, 'e').forEach((e, k) => { if (k && sep) inner.push({ c: sep, it: null }); xOm(e, inner, ea); });
      // a delimiter object grows with its content unless Grow is off; only tall content makes the difference visible
      const st = xTall(inner) ? (gr ? xOn(gr) : true) : undefined; const dp = {};
      const dl = c => st === undefined ? { c, it: null } : { c, it: null, st, sty: 'delim', dp, pair: (beg || '') + '…' + (end || '') };
      if (beg) out.push(dl(beg));
      inner.forEach(x => out.push(x));
      if (end) out.push(dl(end));
      return;
    }
    case 'eqArr': mk('mat{'); xMks(el, 'e').forEach((e, k) => { if (k) mk(';'); xOm(e, out, ea + 1); }); mk('}'); return;
    case 'f': {
      const type = xMval(xMk(xMk(el, 'fPr'), 'type')) || 'bar';
      if (type === 'lin') { sub('num'); out.push({ c: '/', it: null }); sub('den'); return; }
      mk(type === 'noBar' ? 'stk{' : 'frac{'); sub('num'); mk('}{'); sub('den'); mk('}'); return;
    }
    case 'func': xOm(xMk(el, 'fName'), out, ea, true); sub('e'); return;
    case 'limLow': sub('e'); mk('_{'); sub('lim'); mk('}'); return;
    case 'limUpp': sub('e'); mk('^{'); sub('lim'); mk('}'); return;
    case 'm': mk('mat{'); xMks(el, 'mr').forEach((r, k) => { if (k) mk(';'); xMks(r, 'e').forEach(e => xOm(e, out, ea)); }); mk('}'); return;
    case 'nary': {
      const pr = xMk(el, 'naryPr'); const chr = xMval(xMk(pr, 'chr')) || '∫'; const gr = xMk(pr, 'grow');
      const hid = n => { const x = xMk(pr, n); return !!x && xOn(x); };
      const s = grp('sub'), p = grp('sup');
      const shown = (!hid('subHide') && s.length) || (!hid('supHide') && p.length);
      const lim = shown && X_LIM.disp ? (xMval(xMk(pr, 'limLoc')) || (/^[∫∬∭∮∯∰∱∲∳]$/.test(chr) ? X_LIM.int : X_LIM.nary)) : undefined;
      out.push({ c: chr, it: null, st: !!gr && xOn(gr), sty: 'nary', lim });
      if (!hid('subHide') && s.length) { mk('_{'); s.forEach(x => out.push(x)); mk('}'); }
      if (!hid('supHide') && p.length) { mk('^{'); p.forEach(x => out.push(x)); mk('}'); }
      sub('e'); return;
    }
    case 'rad': {
      const pr = xMk(el, 'radPr'); const dh = xMk(pr, 'degHide'); const hide = !!dh && xOn(dh); const d = grp('deg');
      out.push({ c: '√', it: null }); if (!hide && d.length) { mk('['); d.forEach(x => out.push(x)); mk(']'); }
      mk('{'); sub('e'); mk('}'); return;
    }
    case 'sPre': mk('_{'); sub('sub'); mk('}'); mk('^{'); sub('sup'); mk('}'); sub('e'); return;
    case 'sSub': sub('e'); mk('_{'); sub('sub'); mk('}'); return;
    case 'sSup': sub('e'); mk('^{'); sub('sup'); mk('}'); return;
    case 'sSubSup': sub('e'); mk('_{'); sub('sub'); mk('}'); mk('^{'); sub('sup'); mk('}'); return;
    case 'phant': return;
    case 'oMathPara': xMks(el, 'oMath').forEach((m, k) => { if (k) mk(';;'); xOm(m, out, ea); }); return;
    default: for (let c = el.firstChild; c; c = c.nextSibling) xOm(c, out, ea, fnm);
  }
}
function linMml(el) { const out = []; const d0 = X_LIM.disp; X_LIM.disp = !!(el && el.getAttribute && (el.getAttribute('display') === 'block' || (el.closest && el.closest('disp-formula')))); xMm(el, out, null); X_LIM.disp = d0; return out; }
const xMarkLim = (out, n0, lim) => { if (X_LIM.disp && out.length === n0 + 1 && !out[n0].mk && X_LARGEOP.test(out[n0].c) && /^[∑∏∐∫∬∭∮∯∰⋃⋂⋁⋀⨀⨁⨂⨄⨆]$/.test(out[n0].c)) out[n0] = { ...out[n0], lim }; };
const xMmText = n => (n ? n.textContent || '' : '').replace(X_INV, '').trim();
const xIsAccEl = n => { if (!n) return false; let e = n; while (e && e.localName === 'mrow' && e.children.length === 1) e = e.children[0]; if (!e || !/^(mo|mi|mtext)$/.test(e.localName)) return false; const t = xMmText(e); return t.length >= 1 && [...t].length === 1 && (!!X_ACC[t] || /^\p{M}$/u.test(t) || /^[⏞⏟︷︸‾]$/.test(t)); };
function xMm(el, out, mv) {
  if (!el || el.nodeType !== 1) return;
  const E = [...el.children];
  if (el.namespaceURI !== MMLNS) { E.forEach(c => xMm(c, out, mv)); return; }
  const ln = el.localName, mk = c => out.push({ c, mk: true });
  const v = el.getAttribute('mathvariant') || mv;
  const lin = n => xMm(n, out, mv);
  const grp = n => { const t = []; xMm(n, t, mv); return t; };
  switch (ln) {
    case 'mi': case 'mn': case 'mo': case 'mtext': case 'ms': {
      const raw = (el.textContent || '').replace(X_INV, '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
      const s = raw.replace(new RegExp(X_WS.source, 'g'), '');
      if (!s) { if (raw) out.push({ c: ' ', it: null }); return; }
      const graph = [...s.normalize('NFC')].filter(c => !/\p{M}/u.test(c)).length;
      const it = v ? /italic/.test(v) : (ln === 'mi' && graph === 1);
      const b = v ? /bold/.test(v) : false;
      let ex = null; // fences stretch unless stretchy="false"; large operators only with stretchy="true"
      if (ln === 'mo' && [...s].length === 1) { const sa = xStAttr(el); if (X_FENCE.test(s)) ex = { st: sa === null ? true : sa, el, sty: 'delim' }; else if (X_LARGEOP.test(s)) ex = { st: sa === true, el, sty: 'nary' }; }
      const vv = ln === 'mtext' || ln === 'ms' ? undefined : xVar(v);
      for (const ch of raw) { if (X_WS.test(ch)) { out.push({ c: ' ', it: null }); continue; } xPushC(out, ex ? { c: ch, it: /\p{L}/u.test(ch) ? it : null, b, v: vv, ...ex } : { c: ch, it: /\p{L}/u.test(ch) ? it : null, b, v: vv, el }); }
      return;
    }
    case 'mspace': { const w = (el.getAttribute('width') || '').trim(); if (/^(very){0,2}(thin|medium|thick)mathspace$/.test(w) || parseFloat(w) > 0) out.push({ c: ' ', it: null, el }); return; }
    case 'maligngroup': case 'malignmark': case 'none': case 'mprescripts': case 'annotation': case 'annotation-xml': case 'mphantom': return;
    case 'semantics': if (E[0]) xMm(E[0], out, mv); return;
    case 'msub': { const n0 = out.length; lin(E[0]); xMarkLim(out, n0, 'subSup'); mk('_{'); lin(E[1]); mk('}'); return; }
    case 'msup': { const n0 = out.length; lin(E[0]); xMarkLim(out, n0, 'subSup'); mk('^{'); lin(E[1]); mk('}'); return; }
    case 'msubsup': { const n0 = out.length; lin(E[0]); xMarkLim(out, n0, 'subSup'); mk('_{'); lin(E[1]); mk('}'); mk('^{'); lin(E[2]); mk('}'); return; }
    case 'munder': case 'mover': {
      const under = ln === 'munder';
      const acc = (el.getAttribute(under ? 'accentunder' : 'accent') === 'true' || xIsAccEl(E[1])) && !X_LARGEOP.test(xMmText(E[0]));
      if (!acc) { const n0 = out.length; lin(E[0]); xMarkLim(out, n0, 'undOvr'); mk(under ? '_{' : '^{'); lin(E[1]); mk('}'); return; }
      const t = xMmText(E[1]); const mo = xAccMo(E[1]); const sa = xStAttr(mo);
      if (X_GRPCH.test(t)) { const g = grp(E[0]); out.push({ c: 'grp' + t + '{', mk: true, st: sa !== false, el: mo, sty: 'grp', acc: t, base: xLinStr(g.filter(x => !x.mk)) }); g.forEach(x => out.push(x)); mk('}'); return; }
      const chr = under && /^[¯‾_̲]$/.test(t) ? '̲' : t; const a = X_ACC[chr];
      xAccent(out, grp(E[0]), chr, sa !== null ? sa : X_ST_SPAN.has(a) ? true : X_ST_DEF.has(t), mo); return;
    }
    case 'munderover': { const n0 = out.length; lin(E[0]); xMarkLim(out, n0, 'undOvr'); mk('_{'); lin(E[1]); mk('}'); mk('^{'); lin(E[2]); mk('}'); return; }
    case 'mfrac':
      if (el.getAttribute('bevelled') === 'true') { lin(E[0]); out.push({ c: '/', it: null }); lin(E[1]); return; }
      mk(/^0(\D|$)/.test(el.getAttribute('linethickness') || '') ? 'stk{' : 'frac{'); lin(E[0]); mk('}{'); lin(E[1]); mk('}'); return;
    case 'msqrt': out.push({ c: '√', it: null }); mk('{'); E.forEach(lin); mk('}'); return;
    case 'mroot': out.push({ c: '√', it: null }); mk('['); lin(E[1]); mk(']'); mk('{'); lin(E[0]); mk('}'); return;
    case 'mfenced': {
      const open = el.getAttribute('open') ?? '(', close = el.getAttribute('close') ?? ')', seps = (el.getAttribute('separators') ?? ',').replace(/\s/g, '');
      if (open) out.push({ c: open, it: null, st: true, el, sty: 'delim' });
      E.forEach((c, k) => { if (k && seps) out.push({ c: seps[Math.min(k - 1, seps.length - 1)], it: null }); lin(c); });
      if (close) out.push({ c: close, it: null, st: true, el, sty: 'delim' });
      return;
    }
    case 'mtable': mk('mat{'); E.filter(r => /^(mtr|mlabeledtr)$/.test(r.localName)).forEach((r, k) => { if (k) mk(';'); [...r.children].slice(r.localName === 'mlabeledtr' ? 1 : 0).forEach(lin); }); mk('}'); return;
    case 'mmultiscripts': {
      const post = [], pre = []; let cur = post;
      E.slice(1).forEach(c => { if (c.localName === 'mprescripts') cur = pre; else cur.push(c); });
      const scr = (a, b) => { if (a && a.localName !== 'none') { mk('_{'); lin(a); mk('}'); } if (b && b.localName !== 'none') { mk('^{'); lin(b); mk('}'); } };
      for (let k = 0; k + 1 < pre.length; k += 2) scr(pre[k], pre[k + 1]);
      lin(E[0]);
      for (let k = 0; k + 1 < post.length; k += 2) scr(post[k], post[k + 1]);
      return;
    }
    default: E.forEach(c => xMm(c, out, ln === 'mstyle' ? v : mv));
  }
}
// text characters (with sub/sup) → linear items, so a typed formula compares with an equation object
function xCharsToLin(E) {
  const out = []; let cur = '';
  const open = s => { if (cur === s) return; if (cur) out.push({ c: '}', mk: true }); if (s) out.push({ c: s === 'sub' ? '_{' : '^{', mk: true }); cur = s; };
  for (const e of E) {
    if (!e || e.blk) continue;
    if (e.atom) { open(''); e.lin.forEach(x => out.push(x)); continue; }
    if (X_WS.test(e.ch)) { out.push({ c: ' ', it: null, tsp: true }); continue; }
    open(e.sup ? 'sup' : e.sub ? 'sub' : '');
    xPushC(out, { c: e.ch, it: /\p{L}/u.test(e.ch) ? !!e.i : null, b: !!e.b, el: e.el, nb: !!(e.ctx && e.ctx.ignB) || undefined });
  }
  open(''); return out;
}
function xLinNorm(L) {
  let A = []; let pend = false;
  for (const x of L) {
    if (x.mk) { A.push({ ...x, sp: pend }); pend = false; continue; }
    const raw = x.c.replace(X_INV, '');
    let c = raw.replace(new RegExp(X_WS.source, 'g'), '');
    if (!c) { if (raw) pend = x.tsp ? null : pend === null ? null : true; continue; }
    const sp = pend; pend = false; let first = true;
    c = c.normalize('NFC').replace(/̄̄/g, '̿').replace(/[-‐‑]/g, '−').replace(/['’]/g, '′');
    for (const g of c.match(/\P{M}\p{M}*|\p{M}+/gu) || [c]) {
      if (/^\p{M}+$/u.test(g) && A.length && !A[A.length - 1].mk) { A[A.length - 1] = { ...A[A.length - 1], c: (A[A.length - 1].c + g).normalize('NFC').replace(/̄̄/g, '̿') }; continue; }
      A.push(x.st === undefined ? { c: g, it: x.it, b: x.b, v: x.v, el: x.el, nb: x.nb, sp: first ? sp : false } : { c: g, it: x.it, b: x.b, v: x.v, nb: x.nb, st: x.st, el: x.el, sty: x.sty, dp: x.dp, pair: x.pair, acc: x.acc, base: x.base, lim: x.lim, sp: first ? sp : false });
      first = false;
    }
  }
  let changed = true;
  while (changed) {
    changed = false; const B = [];
    for (let k = 0; k < A.length; k++) {
      const x = A[k], y = A[k + 1], z = A[k + 2];
      if (x.mk && /^(_\{|\^\{|\{)$/.test(x.c) && y && y.mk && y.c === '}') { k++; changed = true; continue; }
      if (x.mk && x.c === '^{' && y && !y.mk && /^[′″‴]$/.test(y.c) && z && z.mk && z.c === '}') { B.push(y); k += 2; changed = true; continue; }
      B.push(x);
    }
    A = B;
  }
  return A;
}
const xLinStr = L => L.map(x => x.c).join('');
function xRuns(A, idx) { // indices → contiguous runs of characters
  const runs = []; let cur = null, last = -2;
  idx.forEach(k => { if (k === last + 1 && cur) cur.push(A[k].c); else { cur = [A[k].c]; runs.push(cur); } last = k; });
  return runs.map(r => r.join(''));
}
// a few symbols either side of position k (a run of letters counts as one), spaces shown as typed
const xSpShow = z => z.mk ? (z.c === '}{' ? '/' : z.c === '_{' ? '_' : z.c === '^{' ? '^' : '') : z.c;
function xSpCtx(L, k) {
  const show = xSpShow;
  const stop = z => z.mk && /^(;|;;|mat\{)$/.test(z.c);
  const sp = z => z.sp ? ' ' : '';
  let l = '', n = 0;
  for (let i = k - 1; i >= 0 && n < 2; i--) { const z = L[i]; if (stop(z)) break; const t = show(z); if (!t) continue; const nx = L[i + 1]; l = t + (i + 1 < k && nx ? sp(nx) : '') + l; if (!(/\p{L}/u.test(t) && i > 0 && L[i - 1] && !L[i - 1].mk && /\p{L}/u.test(L[i - 1].c) && !z.sp)) n++; }
  let r = '', m = 0;
  for (let i = k; i < L.length && m < 4; i++) { const z = L[i]; if (stop(z)) break; const t = show(z); r += (i > k ? sp(z) : '') + t; if (!t) continue; const nx = L[i + 1]; if (!(/\p{L}/u.test(t) && nx && !nx.mk && /\p{L}/u.test(nx.c) && !nx.sp)) m++; }
  return { l, r };
}
function xCmpLin(A0, B0, opt) {
  if (A0.some(x => x.opq) || B0.some(x => x.opq)) return null;
  const A = xLinNorm(A0), B = xLinNorm(B0);
  // spaces: Word keeps the spaces typed in an equation; MathML shows only no-break spaces, inner spaces and <mspace>
  const spD = []; const spOn = !!(opt && opt.sp);
  const spOpen = z => z && z.mk && /(\{|;|\[)$/.test(z.c), spClose = z => z && z.mk && /^(;|;;|\}|\}\{|\])$/.test(z.c);
  const spOp = z => z && !z.mk && X_SPOP.test(z.c); // MathML and Word space these operators themselves
  const spChk = (k1, k2) => {
    if (!spOn) return; const x = A[k1], y = B[k2]; if (!x || !y || x.sp == null || y.sp == null || !!x.sp === !!y.sp) return;
    if (k1 === 0 || k2 === 0 || spClose(x) || spClose(y) || spOpen(A[k1 - 1]) || spOpen(B[k2 - 1])) return;
    if (spOp(x) || spOp(y) || spOp(A[k1 - 1]) || spOp(B[k2 - 1])) return;
    let el = null; for (let d = 0; d < 6 && !el; d++) el = (B[k2 + d] && B[k2 + d].el) || (B[k2 - d] && B[k2 - d].el) || null;
    // a space typed at the start or end of <mi>/<mtext> looks present in the XML but MathML drops it
    const trim = !!x.sp && ((B[k2 - 1] && B[k2 - 1].el && /[ \t\r\n]$/.test(B[k2 - 1].el.textContent || '')) || (y.el && /^[ \t\r\n]/.test(y.el.textContent || '')));
    spD.push({ w: !!x.sp, k1, k2, el, trim });
  };
  const spOut = () => { // nearby spots in the same row are shown together
    const G = [];
    spD.slice().sort((a, b) => a.k1 - b.k1).forEach(d => { const g = G[G.length - 1]; const p = g && g[g.length - 1]; if (p && p.w === d.w && d.k1 - p.k1 <= 6 && !A.slice(p.k1, d.k1).some(z => z.mk && /^(;|;;)$/.test(z.c))) g.push(d); else G.push([d]); });
    const seg = (L, a, b) => { const c1 = xSpCtx(L, a), c2 = xSpCtx(L, b); let mid = ''; for (let i = a; i < b; i++) mid += (i > a && L[i].sp ? ' ' : '') + xSpShow(L[i]); return c1.l + (L[a].sp ? ' ' : '') + mid + (b > a && L[b].sp ? ' ' : '') + c2.r; };
    return G.map(g => ({ w: g[0].w, from: seg(A, g[0].k1, g[g.length - 1].k1).trim(), to: seg(B, g[0].k2, g[g.length - 1].k2).trim(), el: g[0].el, trim: g.some(d => d.trim) }));
  };
  const ka = xLinStr(A), kb = xLinStr(B);
  // stretchy: compare where both sides say whether the symbol stretches
  const stD = [], seenDp = new Set();
  const vIt = new Map(); // "w>x" → Word italic states of those letters
  const vIdx = new Map(); // "w>x" → indices where the letter style differs (normal / script / sans-serif …)
  const vChk = (k1, k2) => { const x = A[k1], y = B[k2]; if (!x || !y || x.mk || !/[\p{L}\p{N}]/u.test(x.c) || x.v === undefined || y.v === undefined || x.v === y.v) return; const key = x.v + '>' + y.v; if (!vIdx.has(key)) vIdx.set(key, []); vIdx.get(key).push(k1); if (!vIt.has(key)) vIt.set(key, new Set()); vIt.get(key).add(x.it == null ? '?' : x.it ? 'i' : 'u'); mark(k2); };
  const limD = []; const limChk = (k1, k2) => { const x = A[k1], y = B[k2]; if (!x || !y || x.mk || !x.lim || !y.lim || x.lim === y.lim || x.c !== y.c) return; limD.push({ c: x.c, w: x.lim, x: y.lim }); mark(k2); };
  let elX = null; const mark = k2 => { if (!elX && B[k2] && B[k2].el) elX = B[k2].el; };
  const vOut = () => [...vIdx].map(([key, ix]) => { const [w, x] = key.split('>'); const it = vIt.get(key) || new Set(); return { w, x, wi: it.size === 1 ? [...it][0] : '?', s: xRuns(A, ix.sort((a, b) => a - b)) }; });
  const stChk = (k1, k2) => {
    const x = A[k1], y = B[k2]; if (x.st === undefined || y.st === undefined || x.st === null || y.st === null || x.st === y.st) return;
    if (x.dp) { if (seenDp.has(x.dp)) return; seenDp.add(x.dp); }
    stD.push({ sty: x.sty || y.sty, w: x.st, x: y.st, el: y.el || null, attr: y.el ? xStAttr(y.el) : null, acc: x.acc || y.acc || '', base: x.base || y.base || '', sym: x.pair || (x.sty === 'delim' ? x.c + '…' + (X_CLOSE[x.c] || x.c) : x.c) });
  };
  if (ka !== kb) {
    let p = 0; while (p < A.length && p < B.length && A[p].c === B[p].c) p++;
    let q = 0; while (q < A.length - p && q < B.length - p && A[A.length - 1 - q].c === B[B.length - 1 - q].c) q++;
    const cut = (L, a, b) => xLinStr(L.slice(a, b));
    const itW = [], itX = [];
    const chk = (k1, k2) => { const x = A[k1], y = B[k2]; if (x.mk || !/\p{L}/u.test(x.c) || x.it == null || y.it == null || !!x.it === !!y.it) return; (x.it ? itW : itX).push(k1); mark(k2); };
    for (let k = 0; k < p; k++) { chk(k, k); stChk(k, k); vChk(k, k); limChk(k, k); spChk(k, k); }
    for (let k = 0; k < q; k++) { const a = A.length - 1 - k, b = B.length - 1 - k; chk(a, b); stChk(a, b); vChk(a, b); limChk(a, b); if (k < q - 1) spChk(a, b); }
    itW.sort((a, b) => a - b); itX.sort((a, b) => a - b);
    return { text: true, st: stD, vD: vOut(), limD, spD: spOut(), el: elX, itW: xRuns(A, itW), itX: xRuns(A, itX), bW: [], bX: [], wa: ka, xb: kb, wMid: cut(A, p, A.length - q), xMid: cut(B, p, B.length - q), pre: cut(A, Math.max(0, p - 8), p), post: cut(A, A.length - q, Math.min(A.length, A.length - q + 8)) };
  }
  const itW = [], itX = [], bW = [], bX = [];
  A.forEach((x, k) => {
    stChk(k, k); vChk(k, k); limChk(k, k); spChk(k, k);
    const y = B[k]; if (x.mk || !/\p{L}/u.test(x.c)) return;
    if (x.it != null && y.it != null && !!x.it !== !!y.it) { (x.it ? itW : itX).push(k); mark(k); }
    if (!x.nb && !y.nb && !!x.b !== !!y.b) { (x.b ? bW : bX).push(k); mark(k); }
  });
  const vD = vOut();
  if (!itW.length && !itX.length && !bW.length && !bX.length && !stD.length && !vD.length && !limD.length && !spD.length) return null;
  return { text: false, st: stD, vD, limD, spD: spOut(), el: elX, wa: ka, itW: xRuns(A, itW), itX: xRuns(A, itX), bW: xRuns(A, bW), bX: xRuns(A, bX) };
}
const xLinHasMath = L => L.some(x => x.math);

/* ---- character streams → tokens ---- */
function xTokenize(S) {
  const toks = []; let sp = true, blk = true, cur = null;
  const flush = () => { if (cur) { toks.push(cur); cur = null; } };
  for (const c of S) {
    if (c.blk) { flush(); blk = true; sp = true; continue; }
    if (c.atom) { flush(); toks.push({ t: '⟦EQ⟧', k: '⟦EQ⟧', atom: c, chars: [], sp, blk, cls: 'A' }); sp = blk = false; continue; }
    const ch = c.ch;
    if (X_WS.test(ch)) { flush(); sp = true; continue; }
    if (/[⁡-⁤​-‍﻿­]/.test(ch)) continue;
    const cls = /\p{L}/u.test(ch) ? 'L' : /\p{M}/u.test(ch) ? 'M' : /\p{N}/u.test(ch) ? 'N' : 'P';
    if (cls === 'M') {
      if (cur) { cur.t += ch; cur.chars.push(c); continue; }
      const last = toks[toks.length - 1];
      if (last && !sp && !last.atom) { last.t += ch; last.chars.push(c); continue; }
    }
    if (cur && cur.cls === cls && cls !== 'P') { cur.t += ch; cur.chars.push(c); continue; }
    flush();
    cur = { t: ch, cls: cls === 'M' ? 'P' : cls, chars: [c], sp, blk };
    sp = blk = false;
    if (cur.cls === 'P') flush();
  }
  flush();
  toks.forEach(t => { if (!t.atom) { t.t = t.t.normalize('NFC'); t.k = t.t.replace(/[‐‑]/g, '-'); } });
  return toks;
}
// diff of two key arrays: common prefix/suffix, unique-token anchors (patience), LCS for small gaps
function xDiffKeys(A, B) {
  const ops = [];
  const dp = (a0, a1, b0, b1) => {
    const n = a1 - a0, m = b1 - b0, W1 = m + 1;
    const L = new Uint16Array((n + 1) * W1);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W1 + j] = A[a0 + i] === B[b0 + j] ? L[(i + 1) * W1 + j + 1] + 1 : Math.max(L[(i + 1) * W1 + j], L[i * W1 + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[a0 + i] === B[b0 + j]) { ops.push(['=', a0 + i, b0 + j]); i++; j++; }
      else if (j >= m || (i < n && L[(i + 1) * W1 + j] >= L[i * W1 + j + 1])) { ops.push(['-', a0 + i, -1]); i++; }
      else { ops.push(['+', -1, b0 + j]); j++; }
    }
  };
  const rec = (a0, a1, b0, b1, depth) => {
    while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) ops.push(['=', a0++, b0++]);
    const suf = [];
    while (a1 > a0 && b1 > b0 && A[a1 - 1] === B[b1 - 1]) suf.push(['=', --a1, --b1]);
    if (a0 === a1) for (let j = b0; j < b1; j++) ops.push(['+', -1, j]);
    else if (b0 === b1) for (let i = a0; i < a1; i++) ops.push(['-', i, -1]);
    else if ((a1 - a0) * (b1 - b0) <= 3e6) dp(a0, a1, b0, b1);
    else {
      const ca = new Map(), cb = new Map();
      for (let i = a0; i < a1; i++) ca.set(A[i], ca.has(A[i]) ? -1 : i);
      for (let j = b0; j < b1; j++) cb.set(B[j], cb.has(B[j]) ? -1 : j);
      const pairs = [];
      ca.forEach((i, k) => { if (i < 0) return; const j = cb.get(k); if (j !== undefined && j >= 0) pairs.push([i, j]); });
      pairs.sort((x, y) => x[0] - y[0]);
      // longest increasing subsequence of j
      const tails = [], prev = new Array(pairs.length).fill(-1), tIdx = [];
      pairs.forEach((p, k) => {
        let lo = 0, hi = tails.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < p[1]) lo = mid + 1; else hi = mid; }
        tails[lo] = p[1]; tIdx[lo] = k; prev[k] = lo ? tIdx[lo - 1] : -1;
      });
      const lis = []; for (let k = tails.length ? tIdx[tails.length - 1] : -1; k >= 0; k = prev[k]) lis.push(pairs[k]);
      lis.reverse();
      if (!lis.length || depth > 60) { for (let i = a0; i < a1; i++) ops.push(['-', i, -1]); for (let j = b0; j < b1; j++) ops.push(['+', -1, j]); }
      else { let pa = a0, pb = b0; for (const [i, j] of lis) { rec(pa, i, pb, j, depth + 1); ops.push(['=', i, j]); pa = i + 1; pb = j + 1; } rec(pa, a1, pb, b1, depth + 1); }
    }
    for (let k = suf.length - 1; k >= 0; k--) ops.push(suf[k]);
  };
  rec(0, A.length, 0, B.length, 0);
  return ops;
}

