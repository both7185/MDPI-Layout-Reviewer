/* =====================================================================
   Journal abbreviation check (ISO 4 / LTWA) using the abbrevIso library
   (https://marcinwrochna.github.io/abbrevIso/, MIT License) and its
   LTWA 2024 data, embedded in this page.
   ===================================================================== */
const JOURNAL_FIXED = {
  'International Journal of Hydrogen Energy': 'Int. J. Hydrogen Energy',
  'Proceedings of the National Academy of Sciences of the United States of America': 'Proc. Natl. Acad. Sci. USA',
  'Proceedings of the National Academy of Sciences': 'Proc. Natl. Acad. Sci. USA',
  'Journal of Power Sources': 'J. Power Sources',
  'Journal of Alloys and Compounds': 'J. Alloys Compd.',
  'Transactions of Nonferrous Metals Society of China': 'Trans. Nonferrous Met. Soc. China',
  'Sports Medicine': 'Sports Med.',
  'Global Change Biology': 'Glob. Change Biol.',
  'Journal of Micromechanics and Microengineering': 'J. Micromech. Microeng.',
  'Toxicology in Vitro': 'Toxicol. In Vitro'
};
const JOURNAL_FIXED_ABBR = new Set([...Object.values(JOURNAL_FIXED), 'Des. Oil Crops']);
const ONE_WORD_JOURNALS = ['Materials', 'Energies', 'Sustainability', 'Polymers', 'Nutrients', 'Forests', 'Water', 'Agriculture', 'Agronomy', 'Foods', 'Plants', 'Cells', 'Cancers', 'Sensors', 'Molecules', 'Microorganisms', 'Pharmaceutics', 'Pharmaceuticals', 'Nanomaterials', 'Processes', 'Catalysts', 'Minerals', 'Atmosphere', 'Biology', 'Insects', 'Horticulturae', 'Toxins', 'Viruses', 'Vaccines', 'Antibiotics', 'Antioxidants', 'Electronics', 'Symmetry', 'Mathematics', 'Entropy', 'Machines', 'Coatings', 'Metals', 'Crystals', 'Gels', 'Fermentation', 'Diversity', 'Land', 'Life', 'Drones', 'Batteries', 'Buildings', 'Fire', 'Fluids', 'Geosciences', 'Healthcare', 'Infrastructures', 'Information', 'Lubricants', 'Membranes', 'Photonics', 'Separations', 'Animals', 'Biomolecules', 'Biomedicines', 'Diagnostics', 'Genes', 'Micromachines', 'Marine', 'Pathogens', 'Hydrology', 'Climate', 'Resources', 'Toxics', 'Beverages', 'Chemosensors', 'Bioengineering', 'Biosensors', 'Children', 'Nursing', 'Medicina', 'Pharmacy', 'Religions', 'Humanities', 'Societies', 'Economies', 'Sports', 'Robotics', 'Algorithms', 'Axioms', 'Computers', 'Computation', 'Galaxies', 'Universe', 'Particles', 'Physics', 'Optics', 'Quantum', 'Polysaccharides', 'Molbank', 'Recycling', 'Sci', 'Smart', 'Stats', 'Tomography', 'Vehicles', 'Water', 'Agrochemicals', 'Agriengineering', 'Aerospace', 'Atoms', 'Biomimetics', 'Catalysts', 'Chemistry', 'Clocks', 'Condensed', 'Cosmetics', 'Data', 'Dentistry', 'Dermato', 'Diseases', 'Ecologies', 'Education', 'Encyclopedia', 'Endocrines', 'Epigenomes', 'Forecasting', 'Futures', 'Geographies', 'Geomatics', 'Glasses', 'Gastroenterology', 'Hearts', 'Hemato', 'Histories', 'Hydrogen', 'Immuno', 'Inorganics', 'Inventions', 'Journalism', 'Languages', 'Laws', 'Lipidology', 'Logistics', 'Macromol', 'Magnetochemistry', 'Mathematics', 'Metabolites', 'Methane', 'Microbiology', 'Microplastics', 'Mining', 'Modelling', 'Molecules', 'Mycology', 'Nanoenergy', 'Neuroglia', 'Nitrogen', 'Obesities', 'Oceans', 'Onco', 'Optics', 'Organics', 'Osteology', 'Oxygen', 'Parasitologia', 'Philosophies', 'Photochem', 'Phycology', 'Physiologia', 'Plasma', 'Pollutants', 'Polymers', 'Proteomes', 'Psych', 'Psychiatry', 'Publications', 'Radiation', 'Reactions', 'Recycling', 'Reports', 'Risks', 'Safety', 'Seeds', 'Sinusitis', 'Solids', 'Spectroscopy', 'Surfaces', 'Sustainability', 'Taxonomy', 'Technologies', 'Textiles', 'Thermo', 'Toxins', 'Transplantology', 'Trauma', 'Tropicalmed', 'Uro', 'Viruses', 'Virtual', 'Wind', 'Women', 'Youth', 'Nature', 'Science', 'Cell', 'Lancet', 'Blood', 'Gut', 'Brain', 'Chemosphere', 'Polymer', 'Langmuir', 'Nanoscale', 'Analyst', 'Fuel', 'Energy', 'Geoderma', 'Catena', 'Ecology', 'Evolution', 'Genetics', 'Neuron', 'Immunity', 'Small', 'Talanta', 'Biomaterials', 'Carbon', 'Tetrahedron', 'Organometallics', 'Macromolecules', 'Biochemistry', 'Biomacromolecules', 'Circulation', 'Gastroenterology', 'Hepatology', 'Pediatrics', 'Radiology', 'Oncogene', 'Leukemia', 'Diabetes', 'Hypertension', 'Stroke', 'Cancer', 'Allergy', 'Thorax', 'Heart', 'Development', 'Endocrinology', 'Neurology', 'Pain', 'Sleep', 'Chest', 'Aquaculture', 'Desalination', 'Electrochimica', 'Nanotechnology', 'Automatica', 'Measurement', 'Ultrasonics', 'Wear', 'Icarus', 'Geology', 'Geomorphology', 'Geophysics', 'Hydrobiologia', 'Oecologia', 'Planta', 'Phytochemistry', 'Weed', 'Agronomie', 'Euphytica', 'Mycorrhiza', 'Parasitology', 'Virology', 'Vaccine', 'Toxicon', 'Steroids', 'Lipids', 'Peptides', 'Proteins', 'Biomolecules', 'Biofabrication', 'Biomaterials'];
let _ltwa = null, _ltwaRepl = null, _ltwaRows = null, _oneWordByAbbr = null, _ltwa16 = null, _ltwaRepl16 = null;
const _wordCache = new Map(), _titleCache = new Map();
function ltwa16() {
  if (_ltwa16 !== null) return _ltwa16 || null;
  const el = typeof document !== 'undefined' && document.getElementById('ltwa-data-2016');
  const swEl = typeof document !== 'undefined' && document.getElementById('ltwa-short');
  if (!el || !swEl || typeof AbbrevIso === 'undefined') { _ltwa16 = false; return null; }
  const csv = el.textContent.replace(/^\s+/, '');
  _ltwa16 = new AbbrevIso.AbbrevIso(csv, swEl.textContent.trim());
  _ltwaRepl16 = new Set();
  csv.split('\n').slice(1).forEach(l => { const f = l.split('\t'); if (f[1] && f[1] !== 'n.a.') f[1].split(/[;,]\s*/).forEach(r => r && _ltwaRepl16.add(r.toLowerCase())); });
  return _ltwa16;
}
const _title16 = new Map(), _word16 = new Map();
function abbrevTitle16(t) { if (!ltwa16()) return null; if (!_title16.has(t)) { let r = _ltwa16.makeAbbreviation(t.normalize('NFC')); r = r.split(' ').map(w => /^[a-zà-ÿ]/.test(w) && /^[A-Z]/.test(t) ? capFirstL(w) : w).join(' '); _title16.set(t, r); } return _title16.get(t); }
function abbrevWordInTitle16(w) { if (!ltwa16()) return null; if (!_word16.has(w)) { let r = _ltwa16.makeAbbreviation('Journal of ' + w).replace(/^J\.\s*/, ''); if (/^[A-Z]/.test(w)) r = capFirstL(r); _word16.set(w, r); } return _word16.get(w); }
function ltwa() {
  if (_ltwa) return _ltwa;
  if (typeof AbbrevIso === 'undefined') return null;
  const csvEl = typeof document !== 'undefined' && document.getElementById('ltwa-data');
  const swEl = typeof document !== 'undefined' && document.getElementById('ltwa-short');
  if (!csvEl || !swEl) return null;
  const csv = csvEl.textContent.replace(/^\s+/, ''), sw = swEl.textContent.trim();
  _ltwa = new AbbrevIso.AbbrevIso(csv, sw);
  _ltwaRepl = new Set(); _ltwaRows = [];
  csv.split('\n').slice(1).forEach(l => { const [pat, rep, langs] = l.split('\t'); if (!pat) return; _ltwaRows.push({ pat: pat.toLowerCase(), rep: rep || '', eng: /English|Multiple/i.test(langs || '') }); if (rep) _ltwaRepl.add(rep.toLowerCase()); });
  return _ltwa;
}
// capitalized single-word LTWA entries (places, people, institutions) used to tell proper nouns from Title Case
let _properNouns = null;
function properNouns() {
  if (_properNouns) return _properNouns;
  _properNouns = new Set();
  for (const id of ['ltwa-data', 'ltwa-data-2016']) {
    const el = typeof document !== 'undefined' && document.getElementById(id); if (!el) continue;
    for (const l of el.textContent.split('\n')) { const w = l.split('\t')[0]; if (/^[A-Z][a-z]+$/.test(w)) _properNouns.add(w); }
  }
  return _properNouns;
}
const capFirstL = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
function abbrevTitle(t) {
  if (_titleCache.has(t)) return _titleCache.get(t);
  if (JOURNAL_FIXED[t]) { _titleCache.set(t, JOURNAL_FIXED[t]); return JOURNAL_FIXED[t]; }
  let r = ltwa().makeAbbreviation(t.normalize('NFC'));
  r = r.split(' ').map(w => /^[a-zà-ÿ]/.test(w) && /^[A-Z]/.test(t) ? capFirstL(w) : w).join(' ');
  _titleCache.set(t, r); return r;
}
// abbreviation of one word as it would appear inside a multi-word title
function abbrevWordInTitle(w) {
  if (_wordCache.has(w)) return _wordCache.get(w);
  let r = ltwa().makeAbbreviation('Journal of ' + w).replace(/^J\.\s*/, '');
  if (/^[A-Z]/.test(w)) r = capFirstL(r);
  _wordCache.set(w, r); return r;
}
function oneWordByAbbr() {
  if (_oneWordByAbbr) return _oneWordByAbbr;
  _oneWordByAbbr = new Map();
  for (const w of new Set(ONE_WORD_JOURNALS)) {
    const a = abbrevWordInTitle(w);
    if (a !== w) { const k = a.toLowerCase(); if (!_oneWordByAbbr.has(k)) _oneWordByAbbr.set(k, []); _oneWordByAbbr.get(k).push(w); }
  }
  return _oneWordByAbbr;
}
function ltwaSuggest(stem) {
  const s = stem.toLowerCase();
  const cand = new Set();
  const pre = s.slice(0, Math.min(3, s.length));
  const eng = new Set(), freq = new Map();
  for (const r of _ltwaRows) if (r.rep && !r.pat.startsWith('-') && r.pat.replace(/-/g, '').startsWith(pre)) { cand.add(r.rep.toLowerCase()); freq.set(r.rep.toLowerCase(), (freq.get(r.rep.toLowerCase()) || 0) + 1); if (r.eng) eng.add(r.rep.toLowerCase()); }
  const score = r => { let k = 0; while (k < r.length && k < s.length && r[k] === s[k]) k++; return [-(k) - (eng.has(r) ? 0.5 : 0), -(freq.get(r) || 0)]; };
  return [...cand].sort((x, y) => { const a = score(x), b = score(y); return a[0] - b[0] || a[1] - b[1]; }).slice(0, 3).map(capFirstL);
}
const EPONYM_RE = /^(Parkinson|Alzheimer|Huntington|Crohn|Hodgkin|Down|Lyme)/;
// full words that are also the start of an LTWA abbreviation (“Cell”, not “Cell.”)
const PLAIN_JWORDS = new Set([...ONE_WORD_JOURNALS.map(w => w.toLowerCase()), ...ONE_WORD_JOURNALS.map(w => w.toLowerCase().replace(/s$/, ''))].filter(w => !['sci', 'med', 'chem', 'phys', 'math', 'eng', 'bio'].includes(w)).concat(['cell', 'brain', 'gut', 'bone', 'blood', 'heart', 'skin', 'eye', 'lung', 'liver', 'kidney', 'plant', 'food', 'water', 'health', 'oral', 'pain', 'sleep', 'stroke', 'spine', 'child', 'mind', 'life', 'earth', 'energy', 'nature', 'access', 'open', 'care', 'mass', 'light', 'soil', 'sea', 'air', 'glass', 'gene', 'oil', 'wood', 'milk', 'meat', 'fish', 'rice', 'tea', 'wine', 'drug', 'risk', 'law', 'art', 'pest', 'weed', 'seed', 'fruit', 'crop', 'animal', 'virus', 'protein', 'genome', 'cancer', 'tumor', 'nerve', 'muscle', 'joint', 'hand', 'foot', 'head', 'neck', 'chest', 'breast', 'heat', 'fire', 'wind', 'solar', 'fuel', 'metal', 'steel', 'paper', 'textile', 'polymer', 'chemical', 'physics', 'math', 'stat', 'data', 'signal', 'image', 'sound', 'vision', 'speech', 'voice', 'mental', 'social', 'public', 'global', 'world', 'urban', 'rural', 'coastal', 'marine', 'forest', 'desert', 'island', 'arctic', 'ocean', 'river', 'lake', 'climate', 'weather', 'space', 'planet', 'star', 'galaxy', 'quantum', 'nano', 'micro', 'macro', 'bio', 'eco', 'agro', 'aqua', 'hydro', 'thermo', 'electro', 'magnet', 'optic', 'laser', 'robot', 'machine', 'computer', 'network', 'web', 'cloud', 'cyber', 'digital', 'smart', 'green', 'clean', 'safe', 'safety', 'security', 'peace', 'trade', 'finance', 'bank', 'market', 'business', 'work', 'labor', 'family', 'women', 'men', 'youth', 'aging', 'ageing', 'death', 'birth', 'total', 'general', 'natural', 'normal', 'central', 'national', 'total', 'final', 'animal', 'dental', 'mental', 'rural', 'nuclear', 'solid', 'liquid', 'rapid', 'acid', 'lipid', 'fluid', 'field', 'land', 'wild', 'cold', 'hot', 'dry', 'wet', 'old', 'new', 'young', 'adult', 'infant', 'patient', 'nurse', 'doctor', 'surgeon', 'dent', 'ophthalm']));
const JOURNAL_SHORT = /^(of|and|the|for|in|on|at|to|&|de|la|le|les|des|du|der|die|das|und|y|e|et|di|del|da|do|dos|das|a|an|für|fur)$/i;
/* Returns { expected, issues:[{th,en,sev}] } — empty issues when the name is correct */
// Is an abbreviated word one that abbrevIso can produce? Covers plain LTWA abbreviations,
// hyphenated words (Earth-Sci.) and compounds (Electrochim. from electro + chimi-).
const _validAbbr = new Map();
let _ltwaBySuffix = null, _ltwaReplFold = null, _ltwaWords = null;
const foldAcc = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function validAbbrevToken(t) {
  if (_validAbbr.has(t)) return _validAbbr.get(t);
  const lower = t.toLowerCase();
  if (!_ltwaReplFold) { _ltwaReplFold = new Set(); for (const r of _ltwaRepl) _ltwaReplFold.add(foldAcc(r)); }
  let ok = /^[A-Z]\.$/.test(t) || _ltwaRepl.has(lower) || _ltwaReplFold.has(foldAcc(lower)) || /\..+\./.test(t.slice(0, -1) + '.') && /^([A-Z]\.)+$/.test(t);
  if (!ok && /[-‐]/.test(t)) {
    const parts = t.split(/[-‐]/);
    ok = parts.every(p => !p || /^[\p{Lu}\d]+$/u.test(p) || (/\.$/.test(p) ? validAbbrevToken(p) : abbrevWordInTitle(p) === p));
  }
  if (!ok && /\.$/.test(t) && lower.length >= 5) {
    if (!_ltwaBySuffix) {
      _ltwaBySuffix = new Map();
      for (const r of _ltwaRows) {
        if (!r.rep || r.rep === 'n.a.') continue;
        for (const rep of r.rep.split(/[;,]\s*/)) { const k = rep.replace(/^-/, ''); if (k.length < 4) continue; const key = k.slice(-4); if (!_ltwaBySuffix.has(key)) _ltwaBySuffix.set(key, []); _ltwaBySuffix.get(key).push([k, r.pat.replace(/^-|-$/g, '')]); }
      }
    }
    for (const [rep, stem] of _ltwaBySuffix.get(lower.slice(-4)) || []) {
      if (!lower.endsWith(rep) || lower.length - rep.length < 2) continue;
      const base = lower.slice(0, lower.length - rep.length) + stem;
      for (const suf of ['', 'a', 'e', 'i', 'o', 's', 'y', 'al', 'ia', 'ic', 'ics', 'ion', 'ism', 'ung', 'en']) {
        const cand = capFirstL(base + suf);
        if (abbrevWordInTitle(cand).toLowerCase() === lower) { ok = true; break; }
      }
      if (ok) break;
    }
  }
  _validAbbr.set(t, ok);
  return ok;
}
function checkJournalAbbrev(jnRaw) {
  if (!ltwa()) return null;
  const jn = jnRaw.replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
  const issues = [];
  if (!jn) return { issues };
  if (JOURNAL_FIXED_ABBR.has(jn)) return { issues };
  if (JOURNAL_FIXED[jn]) return { expected: JOURNAL_FIXED[jn], issues: [{ sev: 'error', th: `ชื่อวารสารยังไม่ได้ย่อ: “${jn}” → “${JOURNAL_FIXED[jn]}”`, en: `Journal name is not abbreviated: “${jn}” → “${JOURNAL_FIXED[jn]}”` }] };
  if (/[,:;?]/.test(jn)) issues.push({ sev: 'error', th: 'ชื่อย่อวารสารต้องตัดเครื่องหมาย , : ; ? ออก (เก็บ - – — ไว้)', en: 'Remove commas, colons, semicolons and question marks from the abbreviated journal name (keep hyphens and dashes)' });
  const clean = jn.replace(/[,:;?]/g, '').replace(/\s+/g, ' ').trim();
  const toks = clean.split(' ');
  const hasDot = /\.(\s|$)/.test(clean);
  if (toks.length === 1 && /[-‐]/.test(clean) && /\.$/.test(clean) && validAbbrevToken(clean)) return { issues };
  if (toks.length === 1) {
    if (/\.$/.test(clean) && !/^[A-Z]\.$/.test(clean)) {
      const cands = oneWordByAbbr().get(clean.toLowerCase()) || [];
      issues.push({ sev: cands.length ? 'error' : 'check', th: `ชื่อวารสารที่มีคำเดียวห้ามย่อ: “${jn}”${cands.length ? ` → “${cands.join('” หรือ “')}”` : ' — ให้ใช้ชื่อเต็ม (ถ้าชื่อวารสารจริงมีคำเดียว)'}`, en: `Single-word journal names are not abbreviated: “${jn}”${cands.length ? ` → “${cands.join('” or “')}”` : ' — use the full name (if the journal title is one word)'}`, expected: cands[0] });
    }
    return { expected: issues[0] && issues[0].expected, issues };
  }
  if (!hasDot) {
    // words already abbreviated but written without their period (“Ann Neurol” → “Ann. Neurol.”): add the periods and check the result
    if (!_ltwaWords) { _ltwaWords = new Set(); for (const r of _ltwaRows) if (r.pat && r.eng && /^[a-z]+$/.test(r.pat)) _ltwaWords.add(r.pat); }
    const dotCand = w => w === 'J' || !(/\.$/.test(w) || JOURNAL_SHORT.test(w) || /^[\p{Lu}\d&-]+$/u.test(w) || /.\p{Lu}/u.test(w) || w.length < 2 || /[aeoy]$/i.test(w) || EPONYM_RE.test(w) || PLAIN_JWORDS.has(w.toLowerCase()) || _ltwaWords.has(w.toLowerCase()) || _ltwaRepl.has(w.toLowerCase()) || !validAbbrevToken(w + '.'));
    const dotted = clean.split(' ').map(w => dotCand(w) ? w + '.' : w).join(' ');
    if (dotted !== clean && /\.(\s|$)/.test(dotted)) {
      const r2 = checkJournalAbbrev(dotted); const exp2 = (r2 && r2.expected) || dotted;
      issues.push({ sev: 'error', th: `ชื่อย่อวารสารต้องมีจุดหลังคำย่อ: “${clean}” → “${exp2}”`, en: `Abbreviated journal words need a period: “${clean}” → “${exp2}”` });
      return { expected: exp2, issues };
    }
    const keepEp = x => { if (!x) return x; let r = x; clean.split(' ').filter(w => EPONYM_RE.test(w)).forEach(w => { r = r.split(' ').map(y => /\.$/.test(y) && w.startsWith(y.slice(0, -1)) && y.length < w.length ? w : y).join(' '); }); return r; };
    const exp = keepEp(abbrevTitle(clean));
    const exp16 = keepEp(abbrevTitle16(clean));
    const alt = exp16 && exp16 !== exp ? exp16 : null;
    if (exp.replace(/\s+/g, ' ') !== clean && (!alt || alt !== clean)) issues.push({ sev: 'error', th: `ชื่อวารสารยังไม่ได้ย่อตาม ISO 4: “${clean}” → “${exp}”${alt ? ` (LTWA 2024) หรือ “${alt}” (LTWA 2016)` : ''}`, en: `Journal name is not abbreviated per ISO 4: “${clean}” → “${exp}”${alt ? ` (LTWA 2024) or “${alt}” (LTWA 2016)` : ''}` });
    return { expected: exp, issues };
  }
  // already (partly) abbreviated: check word by word
  const exp = []; const det = [];
  toks.forEach((t, ix) => {
    if (/^[A-Z]$/.test(t) && ix > 0) { exp.push(t); return; } // section letter, e.g., J. Chromatogr. A
    if (JOURNAL_SHORT.test(t) && ix > 0) { det.push({ sev: 'error', th: `ตัดคำ “${t}” ออก`, en: `omit “${t}”` }); return; }
    if (ix === 0 && /^The$/i.test(t)) { det.push({ sev: 'error', th: 'ตัด “The” ออก', en: 'omit “The”' }); return; }
    if (/\.$/.test(t)) {
      const stem = t.slice(0, -1);
      if (/^[A-Z]$/.test(stem) || /\./.test(stem) || validAbbrevToken(t)) { exp.push(t); return; }
      if (ltwa16() && _ltwaRepl16.has(t.toLowerCase())) { det.push({ sev: 'check', th: `“${t}” มีใน LTWA 2016 แต่ไม่มีในฉบับ 2024`, en: `“${t}” is in LTWA 2016 but not in the 2024 edition` }); exp.push(t); return; }
      const sug = ltwaSuggest(stem);
      det.push({ sev: 'check', th: `“${t}” ไม่ใช่ตัวย่อใน LTWA${sug.length ? ` — อาจเป็น ${sug.map(x => `“${x}”`).join(' / ')}` : ''}`, en: `“${t}” is not an LTWA abbreviation${sug.length ? ` — perhaps ${sug.map(x => `“${x}”`).join(' / ')}` : ''}` });
      exp.push(t); return;
    }
    if (/^[\p{Lu}\d]+$/u.test(t) && t.length <= 4) { exp.push(t); return; } // acronyms, section letters, numbers
    if (EPONYM_RE.test(t)) { exp.push(t); return; } // “Parkinsonism” is a name, not LTWA “park-”
    const a = abbrevWordInTitle(t);
    const a16 = abbrevWordInTitle16(t);
    if (a !== t) { const alt = a16 && a16 !== a && a16 !== t ? a16 : null; det.push({ sev: 'error', th: `“${t}” → “${a}”${alt ? ` (หรือ “${alt}” ตาม LTWA 2016)` : ''}`, en: `“${t}” → “${a}”${alt ? ` (or “${alt}” per LTWA 2016)` : ''}` }); }
    exp.push(a);
  });
  const expected = exp.join(' ');
  if (det.length) {
    const sev = det.some(d => d.sev === 'error') ? 'error' : 'check';
    issues.push({ sev, th: `${sev === 'error' ? 'ชื่อย่อวารสารไม่ถูกต้องตาม ISO 4' : 'ชื่อย่อวารสารควรตรวจสอบ'}: “${jn}”${sev === 'error' ? ` → “${expected}”` : ''} (${det.map(d => d.th).join('; ')})`, en: `${sev === 'error' ? 'Journal abbreviation is not correct per ISO 4' : 'Please check the journal abbreviation'}: “${jn}”${sev === 'error' ? ` → “${expected}”` : ''} (${det.map(d => d.en).join('; ')})` });
  }
  return { expected, issues };
}

