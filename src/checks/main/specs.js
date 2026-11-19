/* =====================================================================
   Messages: Thai / English. Every finding carries the guide section and
   the rule text quoted from the guide.
   ===================================================================== */
const SPECS = {
  article_type: { label: 'Article Type', sec: '4.2', size: 10, italic: true, jc: 'left', before: 12, after: 0, line: 'single',
    rule: 'Article Type: Font size: 10 pt, Italics. Alignment: Left. Spacing: Before: 12 pt; After: 0 pt; Line spacing: Single.' },
  title: { label: 'Article Title', sec: '4.2', size: 18, bold: true, jc: 'left', before: 0, after: 12, line: ['atLeast', 12],
    rule: 'Article Title: Font size: 18 pt, Bold. Alignment: Left. Spacing: Before: 0 pt; After: 12 pt; Line spacing: At least 12 pt.' },
  authors: { label: 'Author Names', sec: '4.2', size: 10, bold: true, jc: 'left', before: 0, after: 18, line: ['atLeast', 13],
    rule: 'Author Names: Font size: 10 pt, Bold. Alignment: Left. Spacing: Before: 0 pt; After: 18 pt; Line spacing: At least 13 pt.' },
  affiliation: { label: 'Author Affiliations', sec: '4.2', size: 8, jc: 'left', left: 4.6, hanging: 0.35, before: 0, after: 0, line: ['atLeast', 10],
    rule: 'Author Affiliations: Font size: 8 pt. Alignment: Left. Indentation: Left: 4.6 cm; Hanging: 0.35 cm. Spacing: Before/After: 0 pt; Line spacing: At least 10 pt.' },
  corr: { label: 'Correspondence', sec: '4.2', size: 8, jc: 'left', left: 4.6, hanging: 0.35, before: 0, after: 0, line: ['atLeast', 10],
    rule: 'Corresponding Author Contact Information follows the Author Affiliations style: Font size: 8 pt. Alignment: Left. Indentation: Left: 4.6 cm; Hanging: 0.35 cm. Spacing: Before/After: 0 pt; Line spacing: At least 10 pt.' },
  frontnote: { label: 'Front Notes', sec: '4.2', size: 8, jc: 'left', left: 4.6, hanging: 0.35, before: 0, after: 0, line: ['atLeast', 10],
    rule: 'Front Notes: "The style for the notes should be the same as that for the author affiliations" (8 pt; Left; Indentation Left 4.6 cm, Hanging 0.35 cm; Before/After 0 pt; At least 10 pt).' },
  abstract_title: { label: 'Abstract title', sec: '4.2', size: 10, bold: true, jc: 'both', left: 4.6, before: 12, after: 6, line: ['atLeast', 14],
    rule: 'Abstract title: "Abstract" stands alone on a separate line, positioned above the abstract body. Font size: 10 pt; Bold. Alignment: Justify; Indentation: Left: 4.6 cm. Spacing: Before: 12 pt; After: 6 pt; Line spacing: At least 14 pt.' },
  abstract_body: { label: 'Abstract body', sec: '2, 4.2', size: 10, jc: 'both', left: 4.6,
    rule: 'Abstract body: one paragraph; Font: Palatino Linotype, size 10 pt for most text (§2); left indentation 4.6 cm as for all front-matter text (§4, Figure 1); justified.' },
  keywords: { label: 'Keywords', sec: '4.2', size: 10, jc: 'both', left: 4.6, before: 12, after: 0, line: ['atLeast', 14],
    rule: 'Keywords: Font size: 10 pt, Bold "Keywords:". Alignment: Justify; Indentation: Left: 4.6 cm. Spacing: Before: 12 pt; After: 0 pt; Line spacing: At least 14 pt.' },
  h1: { label: 'Level 1 Heading', sec: '6.1', size: 12, bold: true, jc: 'left', left: 4.6, before: [12, 0], after: 3, line: ['atLeast', 14],
    rule: 'Headings: Font size: Level 1 Headings: 12 pt. Alignment: left. Indentation: Left: 4.6 cm. Spacing: Before: 12 pt; After: 3 pt; Line spacing: At least 14 pt. Level 1 Headings: Bold.' },
  h2: { label: 'Level 2 Heading', sec: '6.1', size: 10, bold: false, italic: true, jc: 'left', left: 4.6, before: [12, 0], after: 3, line: ['atLeast', 14],
    rule: 'Headings: other level headings: 10 pt. Alignment: left. Indentation: Left: 4.6 cm. Spacing: Before: 12 pt; After: 3 pt; Line spacing: At least 14 pt. Level 2 Headings: Italics.' },
  h3: { label: 'Level 3 Heading', sec: '6.1', size: 10, bold: false, italic: false, jc: 'left', left: 4.6, before: [12, 0], after: 3, line: ['atLeast', 14],
    rule: 'Headings: other level headings: 10 pt. Alignment: left. Indentation: Left: 4.6 cm. Spacing: Before: 12 pt; After: 3 pt; Line spacing: At least 14 pt. Level 3 Headings: Normal.' },
  h4: { label: 'Level 4 Heading', sec: '6.1', size: 10, bold: false, italic: false, jc: 'left', left: 4.6, before: [12, 0], after: 3, line: ['atLeast', 14],
    rule: 'Headings: other level headings: 10 pt. Alignment: left. Indentation: Left: 4.6 cm. Spacing: Before: 12 pt; After: 3 pt; Line spacing: At least 14 pt. Level 4 Headings: Normal (unnumbered).' },
  body: { label: 'Paragraph', sec: '6.1', size: 10, jc: 'both', left: 4.6, firstLine: 0.75, line: ['atLeast', 14],
    rule: 'Paragraphs: Font size: 10 pt. Alignment: Justified. Indentation: Left: 4.6 cm; First line: 0.75 cm. Line spacing: At least 14 pt.' },
  body_noindent: { label: 'Paragraph after equation', sec: '6.1, 6.4', size: 10, jc: 'both', left: 4.6, firstLine: 0, line: ['atLeast', 14],
    rule: 'Paragraphs: 10 pt; Justified; Left 4.6 cm; Line spacing At least 14 pt. Equations: "if it starts with a lowercase letter, there should be no indent".' },
  list: { label: 'List', sec: '6.9', size: 10, jc: 'both', left: 4.6, hanging: 0.75, line: ['atLeast', 14],
    rule: 'List: Font size = 10 pt. Alignment = Justified. Line spacing = At least 14 pt. First level list: Left Indentation = 4.6 cm; Hanging = 0.75 cm.' },
  fig_caption: { label: 'Figure caption', sec: '6.2', size: 9, jc: 'both', left: 4.6, right: 0, before: 6, after: 12, line: ['atLeast', 14],
    rule: 'Figure caption: Font size = 9 pt. Indentation: Left: 4.6 cm, Right: 0 cm. Alignment = justified. Spacing: Before = 6 pt, After = 12 pt; Line spacing: At least 14 pt.' },
  tab_caption: { label: 'Table caption', sec: '6.3', size: 9, jc: 'both', left: 4.6, right: 0, before: 12, after: 6, line: ['atLeast', 14],
    rule: 'Table caption: Font size = 9 pt. Indentation: Left: 4.6 cm, Right: 0 cm. Alignment = justified. Spacing: Before = 12 pt, After = 6 pt; Line spacing: At least 14 pt.' },
  figure_small: { label: 'Figure (≤ 13.86 cm)', sec: '6.2', jc: 'left', left: 4.6, before: 12, after: 6, line: 'single',
    rule: 'Figure content for figures smaller than 13.86 cm: Indentation: Left: 4.6 cm. Alignment = left. Spacing: Before = 12 pt, After = 6 pt; Line spacing: Single.' },
  figure_large: { label: 'Figure (> 13.86 cm)', sec: '6.2', jc: 'center', before: 12, after: 6, line: 'single',
    rule: 'Figure content for figures larger than 13.86 cm: Alignment = center. Spacing: Before = 12 pt, After = 6 pt; Line spacing: Single.' },
  back: { label: 'Back matter', sec: '7.2–7.9', size: 9, jc: 'both', left: 4.6, before: 0, after: 6, line: ['atLeast', 14],
    rule: 'Back matter sections (Author Contributions, Funding, IRB, Informed Consent, Data Availability, DURC, Acknowledgments, Conflicts of Interest): Font size: 9 pt. Alignment: Justified. Indentation: Left Indentation = 4.6 cm. Spacing: Before: 0 pt; After: 6 pt; Line spacing: At least 14 pt.' },
  supp: { label: 'Supplementary Materials', sec: '7.1', size: 9, jc: 'both', left: 4.6, before: 12, after: 6, line: ['atLeast', 14],
    rule: 'Supplementary Materials: Font size: 9 pt. Alignment: Justified. Indentation: Left Indentation = 4.6 cm. Spacing: Before: 12 pt; After: 6 pt; Line spacing: At least 14 pt.' },
  abbrev: { label: 'Abbreviations', sec: '7.10', size: 9, jc: 'both', left: 4.6, firstLine: 0.75, line: ['atLeast', 14],
    rule: 'Glossary/Nomenclature/Abbreviations formatted as a paragraph: Font size: 9 pt; Alignment: justified; Left Indentation = 4.6 cm; Line spacing: At least 14 pt; First line: Indent 0.75 cm.' },
  appendix: { label: 'Appendix text', sec: '7.11', size: 10, jc: 'both', left: 4.6, firstLine: 0.75, line: ['atLeast', 14],
    rule: 'Appendix: Font size: 10 pt. Alignment: Justified. Line spacing: At least 14 pt. First line: Indent 0.75 cm. Left Indentation = 4.6 cm.' },
  ref: { label: 'Reference list', sec: '7.12', size: 9, jc: 'both', hanging: 0.75, line: ['atLeast', 14],
    rule: 'Reference List: Alignment = justified; hanging = 0.75 cm; font size = 9 pt; line spacing: at least 14 pt.' },
  disclaimer: { label: 'Disclaimer/Publisher’s Note', sec: '7.16', size: 9, jc: 'both', before: 12, after: 0, line: ['atLeast', 14],
    rule: 'Disclaimer/Publisher’s Note: Font size: 9 pt. Alignment: Justified. Spacing: Before 12pt; After 0 pt; Line spacing: At least 14 pt.' },
  table_cell: { label: 'Table content', sec: '6.3', sizeRange: [8, 10],
    rule: 'Table content: Font size: 8 pt ≤ font size ≤ 10 pt.' },
  equation: { label: 'Equation', sec: '6.4', size: 10,
    rule: 'Equations: Font size = 10 pt.' },
  table_footnote: { label: 'Table footnote', sec: '6.3', size: 9, jc: 'both', left: 4.6, right: 0, after: 12, line: ['atLeast', 14],
    rule: 'Table footnote: Font size = 9 pt. Indentation: Left: 4.6 cm, Right: 0 cm. Alignment = justified. Spacing: After = 12 pt; Line spacing: At least 14 pt.' },
  quote: { label: 'Long quotation', sec: '6.1', left: 5.35, right: 0.75, before: 3, after: 3,
    rule: 'Long Quotations: narrower column width (right indentation = 0.75 cm), 3 pt spacing before and after.' }
};

function stripLeftIndent(r) {
  return String(r)
    .replace(/Indentation: Left: 4\.6 cm; /g, 'Indentation: ')
    .replace(/Indentation: Left: 4\.6 cm, /g, 'Indentation: ')
    .replace(/;\s*Indentation: Left: 4\.6 cm\./g, '.')
    .replace(/\s*Indentation: Left: 4\.6 cm\.?/g, '')
    .replace(/\s*Indentation: Left Indentation = 4\.6 cm\.?/g, '')
    .replace(/\s*Left Indentation = 4\.6 cm[.;]?/g, '')
    .replace(/Indentation Left 4\.6 cm, /g, '')
    .replace(/Left 4\.6 cm; /g, '')
    .replace(/left indentation 4\.6 cm as for all front-matter text \(§4, Figure 1\); /g, '')
    .replace(/First level list: Hanging/g, 'First level list: Hanging')
    .replace(/\s+/g, ' ').trim();
}
for (const k in SPECS) { SPECS[k].rule = stripLeftIndent(SPECS[k].rule); delete SPECS[k].left; delete SPECS[k].jc; delete SPECS[k].before; delete SPECS[k].after; delete SPECS[k].line; }
const JC_NAME = { both: 'Justified', left: 'Left', center: 'Center', right: 'Right' };
function normJc(j) {
  if (!j || j === 'start' || j === 'left') return 'left';
  if (j === 'both' || j === 'distribute' || j === 'lowKashida' || j === 'mediumKashida' || j === 'highKashida' || j === 'thaiDistribute') return 'both';
  if (j === 'end' || j === 'right') return 'right';
  return j;
}
function lineDesc(pp) {
  const rule = pp.lineRule || 'auto'; const ln = pp.line ?? 240;
  if (rule === 'auto') return Math.abs(ln - 240) < 3 ? 'Single' : `Multiple ${r2(ln / 240)}`;
  if (rule === 'exact') return `Exactly ${r2(ln / 20)} pt`;
  return `At least ${r2(ln / 20)} pt`;
}

/* Format deviations for a paragraph against a spec */
function formatDeviations(P, spec, opt = {}) {
  const d = [];
  const pp = P.pp;
  const [s, e] = trimRange(P);
  // fonts & sizes over visible chars
  const sizes = new Map(), fonts = new Map();
  let symFont = false;
  for (let i = s; i < e; i++) {
    const ch = P.text[i];
    if (ch === '￼' || /\s/.test(ch)) continue;
    const c = P.chars[i];
    if (c.sym) { if (/symbol|wingdings/i.test(c.sym)) symFont = true; continue; }
    const f = P.fmt(i); if (f.math) continue;
    sizes.set(f.size, (sizes.get(f.size) || 0) + 1);
    fonts.set(f.font, (fonts.get(f.font) || 0) + 1);
  }
  if (spec.size != null || spec.sizeRange) {
    const bad = [...sizes.keys()].filter(z => spec.sizeRange ? (z < spec.sizeRange[0] || z > spec.sizeRange[1]) : Math.abs(z - spec.size) > 0.01);
    if (bad.length) d.push(`Font size: ${bad.map(z => z + ' pt').join(', ')} → ${spec.sizeRange ? spec.sizeRange.join('–') : spec.size} pt`);
  }
  if (!opt.skipFont) {
    const badF = [...fonts.keys()].filter(f => f !== PALATINO);
    if (badF.length) d.push(`Font: ${badF.join(', ')} → ${PALATINO}`);
  }
  if (spec.bold === true) {
    const fr = fracFmt(P, s, e, f => f.b, ch => ch !== '\t');
    if (fr != null && fr < 0.999) d.push(fr === 0 ? 'Bold: not bold → Bold' : 'Bold: partly bold → whole text Bold');
  } else if (spec.bold === false) {
    const fr = fracFmt(P, s, e, f => f.b);
    if (fr != null && fr > 0.5) d.push('Bold: Bold → not bold');
  }
  if (spec.italic === true) {
    const fr = fracFmt(P, s, e, f => f.i);
    if (fr != null && fr < 0.9) d.push(fr === 0 ? 'Italic: not italic → Italics' : 'Italic: partly italic → Italics');
  } else if (spec.italic === false) {
    const fr = fracFmt(P, s, e, f => f.i);
    if (fr != null && fr > 0.95) d.push('Italic: Italics → Normal');
  }
  const tol = 0.04;
  if (spec.right != null) {
    const a = cm(pp.right);
    if (Math.abs(a - spec.right) > tol) d.push(`Indentation Right: ${r2(a)} cm → ${spec.right} cm`);
  }
  if (spec.firstLine != null) {
    const fl = cm(pp.firstLine), hg = cm(pp.hanging);
    if (hg > tol) d.push(`Indentation: Hanging ${r2(hg)} cm → First line ${spec.firstLine} cm`);
    else if (Math.abs(fl - spec.firstLine) > tol) d.push(`Indentation First line: ${r2(fl)} cm → ${spec.firstLine} cm`);
  }
  if (spec.hanging != null) {
    const hg = cm(pp.hanging), fl = cm(pp.firstLine);
    if (fl > tol) d.push(`Indentation: First line ${r2(fl)} cm → Hanging ${spec.hanging} cm`);
    else if (Math.abs(hg - spec.hanging) > tol) d.push(`Indentation Hanging: ${r2(hg)} cm → ${spec.hanging} cm`);
  }
  return { list: d, symFont };
}

