/* =====================================================================
   MDPI Layout checker engine
   Reads a .docx (JSZip), checks it against The MDPI Layout Style Guide
   (11th ed.), and writes native Word comments. Document text and
   formatting are never changed: runs are only split at comment
   boundaries (identical formatting copied to both halves).
   ===================================================================== */
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MNS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const WPNS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const MCNS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const ANS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RELNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CTNS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XMLNS_XML = 'http://www.w3.org/XML/1998/namespace';
const TW_CM = 566.929; // twips per cm
const PALATINO = 'Palatino Linotype';

/* ---------------- small XML helpers ---------------- */
function kid(el, name) {
  if (!el) return null;
  for (let c = el.firstChild; c; c = c.nextSibling)
    if (c.nodeType === 1 && c.namespaceURI === W && c.localName === name) return c;
  return null;
}
function kids(el, name) {
  const out = [];
  if (!el) return out;
  for (let c = el.firstChild; c; c = c.nextSibling)
    if (c.nodeType === 1 && c.namespaceURI === W && (!name || c.localName === name)) out.push(c);
  return out;
}
function wa(el, a) { return el && el.hasAttributeNS(W, a) ? el.getAttributeNS(W, a) : null; }
function onOff(el) {
  if (!el) return undefined;
  const v = wa(el, 'val');
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}
function num(v) { return v == null || v === '' ? undefined : Number(v); }
function parseXml(s) { return new DOMParser().parseFromString(s, 'application/xml'); }
function ser(doc) {
  let s = new XMLSerializer().serializeToString(doc);
  if (!/^<\?xml/.test(s)) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + s;
  return s;
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function eachMatch(re, s, fn) {
  re.lastIndex = 0; let m;
  while ((m = re.exec(s)) !== null) { fn(m); if (m[0].length === 0) re.lastIndex++; }
}
const cm = tw => (tw || 0) / TW_CM;
const r2 = x => Math.round(x * 100) / 100;

