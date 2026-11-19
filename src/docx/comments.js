/* =====================================================================
   Comment writer
   ===================================================================== */
function topNode(c) { return c.r || c.node; }
function splitBefore(run, child, off) {
  // returns the node before which a marker should be inserted
  const content = [];
  for (let c = run.firstChild; c; c = c.nextSibling) if (!(c.nodeType === 1 && c.namespaceURI === W && c.localName === 'rPr')) content.push(c);
  let moving;
  if (off > 0 && child.localName === 't') {
    const s = child.textContent;
    const nt = child.cloneNode(false);
    nt.textContent = s.slice(off);
    child.textContent = s.slice(0, off);
    child.setAttributeNS(XMLNS_XML, 'xml:space', 'preserve');
    nt.setAttributeNS(XMLNS_XML, 'xml:space', 'preserve');
    child.parentNode.insertBefore(nt, child.nextSibling);
    moving = [];
    for (let c = nt; c; c = c.nextSibling) moving.push(c);
  } else {
    const firstContent = content.find(c => c.nodeType === 1);
    if (child === firstContent || content.indexOf(child) <= 0 && content.filter(c => c.nodeType === 1).indexOf(child) === 0) return run;
    moving = [];
    for (let c = child; c; c = c.nextSibling) moving.push(c);
  }
  const nr = run.cloneNode(false);
  const rPr = kid(run, 'rPr');
  if (rPr) nr.appendChild(rPr.cloneNode(true));
  moving.forEach(n => nr.appendChild(n));
  run.parentNode.insertBefore(nr, run.nextSibling);
  return nr;
}
function applyComments(model, findings, opts) {
  const doc = model.doc;
  const byP = new Map();
  findings.forEach((f, k) => { f.id = opts.startId + k; if (!byP.has(f.P)) byP.set(f.P, []); byP.get(f.P).push(f); });
  const mk = (name, id) => { const e = doc.createElementNS(W, 'w:' + name); e.setAttributeNS(W, 'w:id', String(id)); return e; };
  const refRun = id => {
    const r = doc.createElementNS(W, 'w:r');
    if (opts.refStyle) { const rp = doc.createElementNS(W, 'w:rPr'); const rs = doc.createElementNS(W, 'w:rStyle'); rs.setAttributeNS(W, 'w:val', opts.refStyle); rp.appendChild(rs); r.appendChild(rp); }
    r.appendChild(mk('commentReference', id));
    return r;
  };
  byP.forEach((list, P) => {
    const n = P.chars.length;
    if (n === 0) {
      const pPr = kid(P.el, 'pPr');
      let ref = pPr ? pPr.nextSibling : P.el.firstChild;
      list.forEach(f => {
        P.el.insertBefore(mk('commentRangeStart', f.id), ref);
        P.el.insertBefore(mk('commentRangeEnd', f.id), ref);
        P.el.insertBefore(refRun(f.id), ref);
      });
      return;
    }
    list.forEach(f => { f.s = Math.max(0, Math.min(f.s, n)); f.e = Math.max(f.s + 1, Math.min(f.e, n)); if (f.e > n) f.e = n; });
    const bounds = [...new Set(list.flatMap(f => [f.s, f.e]))].sort((a, b) => b - a);
    const anchor = new Map();
    for (const k of bounds) {
      if (k >= n) { anchor.set(k, { after: topNode(P.chars[n - 1]) }); continue; }
      const c = P.chars[k];
      if (!c.r) { anchor.set(k, { before: c.node }); continue; }
      anchor.set(k, { before: splitBefore(c.r, c.node, c.atom ? 0 : c.off) });
    }
    // insert markers
    list.forEach(f => {
      const a = anchor.get(f.s), b = anchor.get(f.e);
      const st = mk('commentRangeStart', f.id);
      if (a.before) a.before.parentNode.insertBefore(st, a.before); else a.after.parentNode.insertBefore(st, a.after.nextSibling);
      const en = mk('commentRangeEnd', f.id); const rr = refRun(f.id);
      if (b.before) { b.before.parentNode.insertBefore(en, b.before); b.before.parentNode.insertBefore(rr, b.before); }
      else { const par = b.after.parentNode; const nx = b.after.nextSibling; par.insertBefore(en, nx); par.insertBefore(rr, nx); }
    });
  });
}
function buildCommentsXml(existing, findings, opts) {
  const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  let d;
  if (existing) d = parseXml(existing);
  else d = parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}"/>`);
  const root = d.documentElement;
  findings.forEach(f => {
    const c = d.createElementNS(W, 'w:comment');
    c.setAttributeNS(W, 'w:id', String(f.id));
    c.setAttributeNS(W, 'w:author', opts.author);
    c.setAttributeNS(W, 'w:date', date);
    c.setAttributeNS(W, 'w:initials', opts.initials);
    const lines = f.lines;
    lines.forEach((ln, li) => {
      const p = d.createElementNS(W, 'w:p');
      if (li === 0) { const r0 = d.createElementNS(W, 'w:r'); r0.appendChild(d.createElementNS(W, 'w:annotationRef')); p.appendChild(r0); }
      const parts = Array.isArray(ln) ? ln : [{ t: ln }];
      parts.forEach(pt => {
        const r = d.createElementNS(W, 'w:r');
        if (pt.b || pt.i || pt.color) { const rp = d.createElementNS(W, 'w:rPr'); if (pt.b) rp.appendChild(d.createElementNS(W, 'w:b')); if (pt.i) rp.appendChild(d.createElementNS(W, 'w:i')); if (pt.color) { const co = d.createElementNS(W, 'w:color'); co.setAttributeNS(W, 'w:val', pt.color); rp.appendChild(co); } r.appendChild(rp); }
        const t = d.createElementNS(W, 'w:t'); t.setAttributeNS(XMLNS_XML, 'xml:space', 'preserve'); t.textContent = pt.t; r.appendChild(t);
        p.appendChild(r);
      });
      c.appendChild(p);
    });
    root.appendChild(c);
  });
  return ser(d);
}


/* Remove every existing comment (markers in the text + comment parts) before new comments are added */
function stripCommentMarkup(xml) {
  if (!xml) return { xml, n: 0 };
  if (!/<w:comment(RangeStart|RangeEnd|Reference)\b/.test(xml)) return { xml, n: 0 };
  const d = parseXml(xml); const kill = []; let n = 0;
  for (const name of ['commentRangeStart', 'commentRangeEnd']) for (const el of Array.from(d.getElementsByTagNameNS(W, name))) kill.push(el);
  for (const el of Array.from(d.getElementsByTagNameNS(W, 'commentReference'))) {
    n++;
    const r = el.parentNode;
    const others = r ? Array.from(r.childNodes).filter(c => c.nodeType === 1 && c !== el && !(c.namespaceURI === W && c.localName === 'rPr')) : [];
    kill.push(r && r.namespaceURI === W && r.localName === 'r' && others.length === 0 ? r : el);
  }
  kill.forEach(k => k.parentNode && k.parentNode.removeChild(k));
  return { xml: ser(d), n };
}
async function stripAllComments(zip, dir, relsDoc, relsPath, files, relsMap) {
  const r = stripCommentMarkup(files.document); files.document = r.xml;
  for (const rel of Array.from(relsDoc.getElementsByTagNameNS(RELNS, 'Relationship'))) {
    const ty = rel.getAttribute('Type') || '';
    const m = ty.match(/\/(footnotes|endnotes|header|footer)$/); if (!m) continue;
    const t = rel.getAttribute('Target'); const path = t.startsWith('/') ? t.slice(1) : dir + t;
    const f = zip.file(path); if (!f) continue;
    const x = stripCommentMarkup(await f.async('string'));
    if (x.n || /<w:comment(RangeStart|RangeEnd)\b/.test(await f.async('string'))) { zip.file(path, x.xml); if (files[m[1]]) files[m[1]] = x.xml; }
  }
  const typeRe = /\/(comments|commentsExtended|commentsIds|commentsExtensible)$/;
  const ctFile = zip.file('[Content_Types].xml');
  const ct = ctFile ? parseXml(await ctFile.async('string')) : null;
  let changed = false;
  for (const rel of Array.from(relsDoc.getElementsByTagNameNS(RELNS, 'Relationship'))) {
    if (!typeRe.test(rel.getAttribute('Type') || '')) continue;
    const t = rel.getAttribute('Target');
    const path = t.startsWith('/') ? t.slice(1) : dir + t;
    zip.remove(path);
    zip.remove(path.replace(/[^/]+$/, '') + '_rels/' + path.split('/').pop() + '.rels');
    if (ct) for (const o of Array.from(ct.getElementsByTagNameNS(CTNS, 'Override'))) if (o.getAttribute('PartName') === '/' + path) o.parentNode.removeChild(o);
    if (relsMap) delete relsMap[rel.getAttribute('Id')];
    rel.parentNode.removeChild(rel);
    changed = true;
  }
  if (changed) { zip.file(relsPath, ser(relsDoc)); if (ct) zip.file('[Content_Types].xml', ser(ct)); }
  return r.n;
}

function partOf(f) {
  if (f.cat === 'page') return 'doc';
  if (f.cat === 'back') return 'back';
  const r = f.P.role || '';
  if (/^(article_type|title|authors|affiliation|corr|frontnote|abstract|keywords|pacs|norms|running|front)/.test(r)) return 'front';
  if (r === 'ref' || r === 'refs_heading') return 'ref';
  if (/^(back|supp|abbrev|disclaimer|sba|appendix)/.test(r)) return 'back';
  return 'main';
}
async function processDocx(arrayBuffer, opts) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const read = async p => { const f = zip.file(p); return f ? f.async('string') : null; };
  // find main document part via rels
  const rootRels = await read('_rels/.rels');
  let docPath = 'word/document.xml';
  if (rootRels) { const m = rootRels.match(/Target="\/?([^"]*document[^"]*\.xml)"[^>]*Type="[^"]*officeDocument"|Type="[^"]*\/officeDocument"[^>]*Target="\/?([^"]+)"/); if (m) docPath = m[1] || m[2]; }
  const dir = docPath.replace(/[^/]+$/, '');
  const relsPath = dir + '_rels/' + docPath.split('/').pop() + '.rels';
  const relsXml = await read(relsPath);
  const relsDoc = relsXml ? parseXml(relsXml) : parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELNS}"/>`);
  const relTarget = typeRe => { for (const r of relsDoc.getElementsByTagNameNS(RELNS, 'Relationship')) if (typeRe.test(r.getAttribute('Type'))) { const t = r.getAttribute('Target'); return t.startsWith('/') ? t.slice(1) : dir + t; } return null; };
  const files = {
    document: await read(docPath),
    styles: await read(relTarget(/\/styles$/) || dir + 'styles.xml'),
    numbering: await read(relTarget(/\/numbering$/) || dir + 'numbering.xml'),
    theme: await read(relTarget(/\/theme$/) || dir + 'theme/theme1.xml'),
    settings: await read(relTarget(/\/settings$/) || dir + 'settings.xml')
  };
  if (!files.document) throw new Error(opts.lang === 'th' ? 'ไม่พบ word/document.xml — ไฟล์นี้ไม่ใช่ .docx ที่ถูกต้อง' : 'word/document.xml not found — not a valid .docx');
  const removedComments = await stripAllComments(zip, dir, relsDoc, relsPath, files, null);
  const model = buildModel(files);
  model.hasFootnotes = /<w:footnoteReference\b/.test(files.document);
  // headers/footers font sizes
  const hf = [];
  for (const r of relsDoc.getElementsByTagNameNS(RELNS, 'Relationship')) {
    if (!/\/(header|footer)$/.test(r.getAttribute('Type'))) continue;
    const x = await read(dir + r.getAttribute('Target').replace(/^\//, ''));
    if (!x) continue;
    const hd = parseXml(x); const sizes = new Set();
    for (const rr of hd.getElementsByTagNameNS(W, 'r')) { const ts = rr.getElementsByTagNameNS(W, 't'); if (!ts.length || !Array.from(ts).some(t => t.textContent.trim())) continue; let e = Object.assign({}, model.S.docR); const pp = rr.parentNode && rr.parentNode.localName === 'p' ? readPPr(kid(rr.parentNode, 'pPr')) : {}; const sid = pp.pStyle || (/header/.test(r.getAttribute('Type')) ? model.S.nameToId['header'] : model.S.nameToId['footer']); styleChain(model.S, sid).forEach(st => Object.assign(e, st.rPr)); Object.assign(e, readRPr(kid(rr, 'rPr'), model.theme)); sizes.add(e.size || 10); }
    if (sizes.size) hf.push({ type: r.getAttribute('Type'), sizes: [...sizes] });
  }
  opts.headerFooter = hf;
  let { findings } = runCheck(model, opts);
  if (opts.includeCheck === false) findings = findings.filter(f => f.sev !== 'check');
  if (Array.isArray(opts.parts)) findings = findings.filter(f => opts.parts.includes(partOf(f)));
  // comment content
  const SEV = { error: opts.lang === 'th' ? 'ไม่ตรงตามคู่มือ' : 'Not per guide', check: opts.lang === 'th' ? 'ควรตรวจสอบ' : 'Please check' };
  findings.forEach(f => {
    const ruleLab = opts.lang === 'th' ? 'กฎ MDPI Layout Style Guide' : 'MDPI Layout Style Guide';
    f.lines = f.msg.split('\n');
  });
  // sort findings by doc order for stable ids
  findings.sort((a, b) => a.P.idx - b.P.idx || a.s - b.s);
  // existing comments
  const commentsPathRel = relTarget(/\/comments$/);
  const existing = commentsPathRel ? await read(commentsPathRel) : null;
  let startId = 0;
  if (existing) { const ids = [...existing.matchAll(/w:id="(-?\d+)"/g)].map(m => Number(m[1])); startId = ids.length ? Math.max(...ids) + 1 : 0; }
  const docIds = [...files.document.matchAll(/<w:comment(?:RangeStart|RangeEnd|Reference)\b[^>]*w:id="(\d+)"/g)].map(m => Number(m[1]));
  if (docIds.length) startId = Math.max(startId, Math.max(...docIds) + 1);
  applyComments(model, findings, { startId, refStyle: model.S.hasCommentRef || null });
  const commentsXml = buildCommentsXml(existing, findings, { author: opts.author || 'MDPI Layout Checker', initials: 'MDPI' });
  const commentsPath = commentsPathRel || dir + 'comments.xml';
  zip.file(docPath, ser(model.doc));
  zip.file(commentsPath, commentsXml);
  if (!commentsPathRel) {
    const rel = relsDoc.createElementNS(RELNS, 'Relationship');
    const ids = Array.from(relsDoc.getElementsByTagNameNS(RELNS, 'Relationship')).map(r => r.getAttribute('Id'));
    let k = 1; while (ids.includes('rIdMdpiC' + k)) k++;
    rel.setAttribute('Id', 'rIdMdpiC' + k);
    rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments');
    rel.setAttribute('Target', 'comments.xml');
    relsDoc.documentElement.appendChild(rel);
    zip.file(relsPath, ser(relsDoc));
    const ct = parseXml(await read('[Content_Types].xml'));
    const has = Array.from(ct.getElementsByTagNameNS(CTNS, 'Override')).some(o => o.getAttribute('PartName') === '/' + commentsPath);
    if (!has) {
      const o = ct.createElementNS(CTNS, 'Override');
      o.setAttribute('PartName', '/' + commentsPath);
      o.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml');
      ct.documentElement.appendChild(o);
      zip.file('[Content_Types].xml', ser(ct));
    }
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  return {
    blob,
    findings: findings.map(f => ({ part: partOf(f), sev: f.sev, cat: f.cat, sec: f.sec, msg: f.msg, rule: f.rule, role: f.P.role, para: f.P.idx, excerpt: f.P.text.slice(f.s, f.e).replace(/￼/g, '▣').slice(0, 90), ctx: f.P.text.replace(/￼/g, '▣').slice(0, 70) })),
    removedComments,
    stats: { paras: model.paras.length, tables: model.tables.length, refs: model.paras.filter(p => p.role === 'ref').length, roles: model.paras.reduce((a, p) => { if (p.role) a[p.role] = (a[p.role] || 0) + 1; return a; }, {}) }
  };
}

