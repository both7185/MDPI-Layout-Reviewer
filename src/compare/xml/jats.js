/* ---- XML (JATS) side ---- */
const X_ENT = { nbsp: 160, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, hellip: 8230, deg: 176, plusmn: 177, times: 215, micro: 181, minus: 8722, le: 8804, ge: 8805, middot: 183, prime: 8242, Prime: 8243, alpha: 945, beta: 946, gamma: 947, delta: 948, epsilon: 949, mu: 956, pi: 960, sigma: 963, tau: 964, lambda: 955, theta: 952, omega: 969, Delta: 916, Omega: 937, Sigma: 931, copy: 169, reg: 174, trade: 8482, eacute: 233, aacute: 225, iacute: 237, oacute: 243, uacute: 250, ntilde: 241, uuml: 252, ouml: 246, auml: 228, ccedil: 231, thinsp: 8201, ensp: 8194, emsp: 8195, sup2: 178, sup3: 179, frac12: 189, larr: 8592, rarr: 8594, harr: 8596, infin: 8734, asymp: 8776, ne: 8800, equiv: 8801, sum: 8721, radic: 8730, part: 8706, nabla: 8711 };
function xParse(text, lang) {
  let doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    const t2 = text.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (m, n) => /^(amp|lt|gt|quot|apos)$/.test(n) ? m : X_ENT[n] ? `&#${X_ENT[n]};` : '');
    doc = new DOMParser().parseFromString(t2, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      const raw = doc.getElementsByTagName('parsererror')[0].textContent;
      const m = raw.match(/line (\d+) at column (\d+):\s*([^\n]*?)(?:Below is|$)/);
      const why = m ? (lang === 'en' ? `line ${m[1]}, column ${m[2]}: ${m[3].trim()}` : `บรรทัด ${m[1]} คอลัมน์ ${m[2]}: ${m[3].trim()}`) : raw.slice(0, 160);
      throw new Error(lang === 'en' ? 'Cannot read the XML file (not well-formed) — ' + why : 'อ่านไฟล์ XML ไม่ได้ (XML ไม่ถูกต้อง) — ' + why);
    }
  }
  // element → line number, by matching start tags in document order
  const lines = []; const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^\[>]|\[[\s\S]*?\])*>|<\/[^>]*>|<([A-Za-z_][\w:.\-]*)/g;
  let m, line = 1, last = 0;
  while ((m = re.exec(text)) !== null) { if (!m[1]) continue; for (let k = last; k < m.index; k++) if (text.charCodeAt(k) === 10) line++; last = m.index; lines.push(line); }
  const lineOf = new Map(); const all = doc.getElementsByTagName('*'); for (let k = 0; k < all.length; k++) lineOf.set(all[k], lines[k]);
  return { doc, lineOf };
}
const xEls = (el, name) => el ? [...el.children].filter(c => !name || (name instanceof RegExp ? name.test(c.localName) : c.localName === name)) : [];
const xFirst = (el, name) => xEls(el, name)[0] || null;
const xDesc = (el, name) => el ? [...el.getElementsByTagName(name)] : [];
const X_SKIP = new Set(['fig', 'fig-group', 'table-wrap', 'table-wrap-group', 'fn', 'graphic', 'inline-graphic', 'media', 'object-id', 'alt-text', 'long-desc', 'tex-math', 'supplementary-material', 'permissions', 'counts', 'custom-meta-group', 'institution-id']);
function xStream(node, out, st, opt = {}) {
  if (!node) return;
  // a line break plus indentation between tags is how the XML is laid out, not a space in the text (e.g. <italic>L</italic>⏎ <sub>1</sub> shows L₁)
  if (node.nodeType === 3 && /^[ \t]*[\r\n][\s]*$/.test(node.nodeValue)) return;
  if (node.nodeType === 3 || node.nodeType === 4) { const s = node.nodeValue; const el = node.parentNode; for (const ch of s) out.push({ ch, i: st.i, b: st.b, sup: st.sup, sub: st.sub, u: !!st.u, sc: !!st.sc, ctx: st.ctx, el }); return; }
  if (node.nodeType !== 1) return;
  if (node.namespaceURI === MMLNS) { if (node.localName === 'math') { const nb = !!(st.ctx && st.ctx.ignB); out.push({ atom: true, lin: linMml(node).map(x => nb ? { ...x, math: true, nb } : { ...x, math: true }), math: true, el: node, inline: true }); } return; }
  const ln = node.localName;
  const kids = () => { for (let c = node.firstChild; c; c = c.nextSibling) xStream(c, out, st, opt); };
  const withSt = (o) => { const s2 = { ...st, ...o }; for (let c = node.firstChild; c; c = c.nextSibling) xStream(c, out, s2, opt); };
  if ((ln === 'table-wrap' || ln === 'fig') && !xFirst(node, 'label') && !(node.parentNode && /-group$/.test(node.parentNode.localName))) return xAnonFloat(node, out, st, opt);
  if (X_SKIP.has(ln) && !(opt.keepFloats && /^(fig|table-wrap)$/.test(ln))) return;
  switch (ln) {
    case 'italic': return withSt({ i: true });
    case 'bold': return withSt({ b: true });
    case 'sup': return withSt({ sup: true, sub: false });
    case 'sub': return withSt({ sub: true, sup: false });
    case 'roman': return withSt({ i: false });
    case 'underline': return withSt({ u: true });
    case 'sc': return withSt({ sc: true });
    case 'break': out.push({ ch: ' ', ctx: st.ctx, el: node }); return;
    case 'inline-formula': out.push({ atom: true, lin: xFormulaLin(node, st), math: !!xDesc(node, 'mml:math').length || !!node.getElementsByTagNameNS(MMLNS, 'math').length, el: node, inline: true }); return;
    case 'disp-formula': {
      out.push({ blk: true });
      out.push({ atom: true, lin: xFormulaLin(node, st), math: !!node.getElementsByTagNameNS(MMLNS, 'math').length, el: node, disp: true, label: (xFirst(node, 'label') || {}).textContent || '' });
      const lab = xFirst(node, 'label'); if (lab) { out.push({ ch: ' ', ctx: st.ctx, el: lab }); xStream(lab, out, { ...st, ctx: { ...st.ctx, lab: true } }, opt); }
      out.push({ blk: true }); return;
    }
    case 'alternatives': { const mm = [...node.children].find(c => c.namespaceURI === MMLNS); if (mm) xStream(mm, out, st, opt); else if (node.children[0]) xStream(node.children[0], out, st, opt); return; }
    case 'title': out.push({ blk: true }); withSt({ ctx: { ...st.ctx, title: true, ignB: true } }); out.push({ blk: true }); return;
    case 'label': if (node.parentNode && node.parentNode.localName === 'list-item') return; withSt({ ctx: { ...st.ctx, lab: true } }); out.push({ ch: ' ', ctx: st.ctx, el: node, syn: true }); return;
    case 'p': case 'term': case 'def': case 'list-item': case 'disp-quote': case 'statement': case 'verse-line': case 'attrib': out.push({ blk: true }); kids(); out.push({ blk: true }); return;
    case 'list': {
      // list-type="simple" without <label>: the symbol (✓ ➢ ▪ …) is typed before the text, while Word draws it from the list numbering
      const simple = node.getAttribute('list-type') === 'simple';
      out.push({ blk: true });
      for (const li of xEls(node, 'list-item')) { out.push({ blk: true }); if (simple && !xFirst(li, 'label')) { const tmp = []; xStream(li, tmp, st, opt); xDropSym(tmp); for (const t of tmp) out.push(t); } else xStream(li, out, st, opt); }
      out.push({ blk: true }); return;
    }
    case 'tr': out.push({ blk: true }); kids(); out.push({ blk: true }); return;
    case 'th': out.push({ blk: true }); withSt({ ctx: { ...st.ctx, ignB: true } }); out.push({ blk: true }); return;
    case 'td': out.push({ blk: true }); kids(); out.push({ blk: true }); return;
    default: kids();
  }
}
// a table or figure without a label (position="anchor", e.g. a questionnaire in an appendix) belongs to the running text, as the Word table does
function xAnonFloat(node, out, st, opt) {
  out.push({ blk: true });
  const cap = xFirst(node, 'caption'); if (cap) xStream(cap, out, st, opt);
  if (node.localName === 'table-wrap') {
    const t = xDesc(node, 'table')[0]; if (t) xStream(t, out, st, opt);
    const fw = n => { for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 1 && /^(fn|fn-group)$/.test(c.localName)) { out.push({ blk: true }); fw(c); } else xStream(c, out, st, opt); } };
    const ft = xFirst(node, 'table-wrap-foot'); if (ft) fw(ft);
  }
  out.push({ blk: true });
}
// Wingdings / Symbol bullet glyphs as Unicode, for messages
const X_GLYPH = { '\uF0FC': '✓', '\uF0FB': '✗', '\uF0D8': '➢', '\uF0A7': '▪', '\uF076': '❖', '\uF0E0': '→', '\uF0E8': '➔', '\uF0F0': '⇨', '\uF06E': '■', '\uF071': '❑', '\uF0A8': '◻', '\uF0B7': '•', '\uF0D9': '◆', '\uF0C4': '►', o: 'o' };
const X_LSYM = /^(?:[\p{So}•▪◦‣⁃·○●■□◆◇►▸▹▻→⇒⇨➔➜➝➞➟➠➡➤✓✔✗✘–—*\-]|o)$/u;
const X_BR = { '(': ')', '[': ']', '{': '}' };
function xFoldBr(S) {
  for (let k = 1; k < S.length - 1; k++) {
    const a = S[k], p = S[k - 1], n = S[k + 1]; if (!a.atom || a.disp) continue;
    if (!p || !n || p.blk || n.blk || p.atom || n.atom || !X_BR[p.ch] || X_BR[p.ch] !== n.ch) continue;
    S[k] = { ...a, lin: [{ c: p.ch, it: null }, ...a.lin, { c: n.ch, it: null }] };
    S.splice(k + 1, 1); S.splice(k - 1, 1); k--;
  }
}
function xDropSym(S) {
  let k = 0; while (k < S.length && (S[k].blk || (!S[k].atom && X_WS.test(S[k].ch)))) k++;
  if (k >= S.length || S[k].atom || !X_LSYM.test(S[k].ch || '')) return;
  let j = k + 1; while (j < S.length && !S[j].blk && !S[j].atom && X_WS.test(S[j].ch)) j++;
  if (j === k + 1 && S[k].ch === 'o') return;
  S.splice(k, j - k);
}
function xFormulaLin(node, st) {
  const tmp = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.localName === 'label' && c.namespaceURI !== MMLNS) continue;
    if (c.nodeType === 1 && /^(graphic|inline-graphic)$/.test(c.localName)) { tmp.push({ atom: true, lin: [{ c: '[image]', it: null }] }); continue; }
    xStream(c, tmp, st, {});
  }
  return xCharsToLin(tmp);
}
const X_CTX0 = {};
const xInUrl = (P, pos) => { if (!P) return false; if (!P._urls) { P._urls = []; const re = /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+|\b10\.\d{4,9}\/\S+/g; let m; while ((m = re.exec(P.text)) !== null) P._urls.push([m.index, m.index + m[0].length]); } return P._urls.some(([a, b]) => pos >= a && pos < b); };
const xSt0 = (ctx = X_CTX0) => ({ i: false, b: false, sup: false, sub: false, ctx });
const xSynth = (s, out, ctx, el, o = {}) => { for (const ch of s) out.push({ ch, i: !!o.i, b: !!o.b, sup: !!o.sup, sub: false, ctx, el, syn: true }); };

