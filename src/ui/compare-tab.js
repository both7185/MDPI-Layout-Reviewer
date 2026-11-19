(function(){
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // tabs
  const tabs = [['tab-btn-check','tab-check'],['tab-btn-cmp','tab-cmp']];
  tabs.forEach(([b,p])=> $(b).addEventListener('click', ()=>{ tabs.forEach(([b2,p2])=>{ $(b2).setAttribute('aria-selected', String(b2===b)); $(p2).hidden = p2!==p; }); try{ localStorage.setItem('mdpi-tab', b); }catch(e){} }));
  const tabBtns = tabs.map(([b])=>$(b));
  const syncTabIdx = () => tabBtns.forEach(t=> t.tabIndex = t.getAttribute('aria-selected')==='true' ? 0 : -1);
  tabBtns.forEach((t,i)=>{ t.addEventListener('click', syncTabIdx); t.addEventListener('keydown', e=>{ const n = tabBtns.length; const j = e.key==='ArrowRight' ? (i+1)%n : e.key==='ArrowLeft' ? (i-1+n)%n : e.key==='Home' ? 0 : e.key==='End' ? n-1 : -1; if(j<0) return; e.preventDefault(); tabBtns[j].click(); tabBtns[j].focus(); }); });
  syncTabIdx();
  try{ const t = localStorage.getItem('mdpi-tab'); if(t && $(t)) $(t).click(); }catch(e){}
  if(location.hash === '#compare') $('tab-btn-cmp').click();

  const files = { o:null, d:null };
  const curMode = () => (document.querySelector('input[name=cmode]:checked')||{}).value || 'main';
  function wire(k){
    const drop = $('drop-'+k), inp = $('file-'+k);
    const pick = f => { if(!f) return; let slot = k;
      // an .xml file always means XML ↔ Word mode, and always goes in the bottom slot
      if(/\.xml$/i.test(f.name)){ if(curMode()!=='xml'){ $('cmode-xml').checked = true; setModeUI(); } slot = 'd'; }
      else if(!/\.docx$/i.test(f.name)){ status(curMode()==='xml' ? 'Only a .docx file (top slot) and an .xml file (bottom slot) are supported.' : 'Only .docx files are supported.', true); return; }
      else if(k==='d' && curMode()==='xml'){ if(files.o){ status('The bottom slot takes only an .xml (JATS) file. Put the Word file in the top slot.', true); return; } slot = 'o'; }
      files[slot]=f; $('fname-'+slot).textContent = f.name + ' · ' + Math.round(f.size/1024).toLocaleString('en-US') + ' KB'; $('cmp-run').disabled = !(files.o && files.d); status(''); };
    drop.addEventListener('click', ()=> inp.click());
    drop.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); inp.click(); }});
    inp.addEventListener('change', e=>{ pick(e.target.files[0]); inp.value = ''; });
    drop.addEventListener('dragover', e=>{ e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', ()=> drop.classList.remove('drag'));
    drop.addEventListener('drop', e=>{ e.preventDefault(); drop.classList.remove('drag'); pick(e.dataTransfer.files[0]); });
  }
  wire('o'); wire('d');
  function status(t, err){ const s=$('cmp-status'); s.textContent=t; s.className='status'+(err?' err':''); }
  // XML mode: the top slot takes the Word file, the bottom slot the XML
  function setModeUI(){
    const x = curMode()==='xml';
    $('lbl-o').textContent = x ? 'Word (.docx): the correct file' : 'Original (manuscript before layout)';
    $('drop-o-t').textContent = x ? 'Drop the Word file here' : 'Drop the Original file here';
    $('lbl-d').textContent = x ? 'XML (.xml): must match the Word file' : 'Done (file after layout)';
    $('drop-d-t').textContent = x ? 'Drop the XML file here' : 'Drop the Done file here';
    $('drop-d-s').textContent = x ? 'or click to choose an .xml file' : 'or click to choose a .docx file';
    $('file-d').setAttribute('accept', x ? '.xml,application/xml,text/xml' : '.docx');
    $('cmp-run').textContent = x ? 'Compare XML with Word' : 'Compare content';
    if(files.d && (x ? !/\.xml$/i.test(files.d.name) : !/\.docx$/i.test(files.d.name))){ files.d = null; $('fname-d').textContent = ''; }
    $('cmp-run').disabled = !(files.o && files.d);
  }
  document.querySelectorAll('input[name=cmode]').forEach(r=> r.addEventListener('change', setModeUI));
  setModeUI();

  let res = null, outName = '', filter = 'all', urls = [];
  const XKIND = { th:{ xmiss:'Missing in XML', xpara:'Paragraph missing in XML', xadd:'Extra text in XML', xchg:'Text differs', xmove:'Moved', xfmt:'Italic/bold/sup/sub differs', xspace:'Spacing differs', xmath:'Equation differs', xmathfmt:'Equation italic differs', xmathtype:'Equation as text', xstretch:'Stretchy differs', xmathsp:'Equation spacing differs', xlink:'xref link', xstruct:'XML structure', xtable:'Rows/columns differ', xrow:'Row missing/extra', xspan:'colspan/rowspan/cell', xfloat:'Figure/table missing/extra', xsec:'Section missing/extra', xrefmiss:'Reference missing', xrefadd:'Extra reference', xrefnum:'Reference number differs', xrefmove:'Order within a reference differs', xrefswap:'Reference list order differs' }, en:{ xmiss:'Missing in XML', xpara:'Paragraph missing in XML', xadd:'Extra text in XML', xchg:'Text differs', xmove:'Moved', xfmt:'Italic/bold/sup/sub differs', xspace:'Spacing differs', xmath:'Equation differs', xmathfmt:'Equation italic differs', xmathtype:'Equation as text', xstretch:'Stretchy differs', xmathsp:'Equation spacing differs', xlink:'xref link', xstruct:'XML structure', xtable:'Rows/columns differ', xrow:'Row missing/extra', xspan:'colspan/rowspan/cell', xfloat:'Figure/table missing/extra', xsec:'Section missing/extra', xrefmiss:'Reference missing', xrefadd:'Extra reference', xrefnum:'Reference number differs', xrefmove:'Order within a reference differs', xrefswap:'Reference list order differs' } };
  const KIND = { th:{ cellmiss:'Table value missing', celladd:'Table value added', para:'Paragraph missing', missing:'Text missing', number:'Number changed', cite:'Citation changed/missing', symbol:'Symbol changed/missing', format:'Superscript/subscript changed', changed:'Wording changed', inserted:'Text added in Done', table:'Table structure changed', refmiss:'Reference missing', refnew:'New reference', reorder:'Moved', math:'Equation missing', image:'Image not found' }, en:{ cellmiss:'Table value missing', celladd:'Table value added', para:'Paragraph missing', missing:'Text missing', number:'Number changed', cite:'Citation changed/missing', symbol:'Symbol changed/missing', format:'Superscript/subscript changed', changed:'Wording changed', inserted:'Text added in Done', table:'Table structure changed', refmiss:'Reference missing', refnew:'New reference', reorder:'Moved', math:'Equation missing', image:'Image not found' } };
  $('cmp-run').addEventListener('click', async ()=>{
    if(!(files.o && files.d)) return;
    if(typeof JSZip==='undefined'){ status('The file-reading library did not load. Try reloading the page.', true); return; }
    $('cmp-run').disabled = true; $('cmp-run').classList.add('busy'); status('Comparing…');
    try{
      const lang = 'en';
      const cmode = document.querySelector('input[name=cmode]:checked').value;
      res = cmode === 'xml' ? await compareXml(await files.o.arrayBuffer(), await files.d.text(), { lang }) : await compareDocx(await files.o.arrayBuffer(), await files.d.arrayBuffer(), { lang, mode: cmode });
      res.lang = lang;
      outName = files.o.name.replace(/\.docx$/i,'') + (cmode === 'xml' ? '_xml-compare.docx' : cmode === 'ref' ? '_ref-compare.docx' : '_missing-in-done.docx');
      filter = 'all'; render(); UIX.reveal($('cmp-results'));
      const xs = res.xmlStats, same = xs && xs.tok ? xs.same / xs.tok : 1;
      if (cmode === 'xml' && same < 0.5) { status(`The Word and XML files look like different articles: only ${Math.round(same * 100)}% of the content matches (${res.items.length} differences). Check that you chose the right pair of files.`, true); } else
      status(cmode === 'xml' ? (res.items.length ? `Found ${res.items.length} places where the XML differs from Word.` : 'The XML matches Word everywhere it was checked.') : res.items.length ? `Found ${res.items.length} items to check.` : 'No lost content found.');
    }catch(e){ console.error(e); status('The comparison failed: ' + (e && e.message || e), true); }
    finally{ $('cmp-run').disabled = false; $('cmp-run').classList.remove('busy'); }
  });
  function ctx(it){
    const t = it.text, a = Math.max(0, it.s - 90), b = Math.min(t.length, it.e + 90);
    if(it.kind==='para' || it.kind==='xpara') return esc(t.length>400 ? t.slice(0,400)+'…' : t);
    return (a>0?'…':'') + esc(t.slice(a, it.s)) + (/^(inserted|format|table|xadd|xfmt|xspace|xspan|xtable|xrow|xfloat|xsec|xmath|xmathfmt|xmathtype|xstretch|xmathsp|xlink|xstruct|xrefadd|xrefnum)$/.test(it.kind) ? '<mark class="keep">' : '<mark>') + esc(t.slice(it.s, it.e)) + '</mark>' + esc(t.slice(it.e, b)) + (b<t.length?'…':'');
  }
  function render(){
    $('cmp-rest').hidden = true; $('cmp-results').hidden = false;
    const K = res.mode === 'xml' ? XKIND[res.lang] : KIND[res.lang]; const st = res.stats;
    urls.forEach(u=>URL.revokeObjectURL(u)); urls = [];
    const cnt = {}; res.items.forEach(i=> cnt[i.kind]=(cnt[i.kind]||0)+1);
    const lost = (cnt.para||0)+(cnt.missing||0)+(cnt.cellmiss||0);
    const pct = st.totalTok ? Math.max(0, 100 - st.missTok/st.totalTok*100) : 100;
    if (res.mode === 'xml') { const xs = res.xmlStats; const n = (...k) => k.reduce((a, x) => a + (cnt[x]||0), 0); const refN = res.items.filter(i => i.where === 'ref' || /^xref/.test(i.kind)).length; $('cmp-tally').innerHTML =
      `<div class="tile ${n('xmiss','xpara','xadd','xchg','xmove','xsec','xfloat')?'err':''}"><b>${n('xmiss','xpara','xadd','xchg','xmove','xsec','xfloat')}</b><span>Text missing, extra or different</span></div>`+
      `<div class="tile ${n('xfmt')?'err':''}"><b>${n('xfmt')}</b><span>Italic/bold/sup/sub differs</span></div>`+
      `<div class="tile ${n('xtable','xrow','xspan')?'err':''}"><b>${n('xtable','xrow','xspan')}</b><span>Tables (rows/columns/merges)</span></div>`+
      `<div class="tile ${n('xmath','xmathfmt','xmathtype','xstretch','xmathsp')?'err':''}"><b>${n('xmath','xmathfmt','xmathtype','xstretch','xmathsp')}</b><span>Equations</span></div>`+
      `<div class="tile ${refN?'err':''}"><b>${refN}</b><span>In the reference list</span></div>`+
      `<div class="tile ${n('xlink','xstruct')?'err':''}"><b>${n('xlink','xstruct')}</b><span>Links/XML structure</span></div>`+
      `<div class="tile chk"><b>${n('xspace')}</b><span>Spacing differs</span></div>`+
      `<div class="tile"><b>${xs.wTables} → ${xs.xTables}</b><span>Tables (Word → XML)</span></div>`+
      `<div class="tile"><b>${xs.wEq} → ${xs.xEq}</b><span>Equations, Equation → MathML${xs.eqType ? ` (plus ${xs.eqType} typed as text in the XML that match)` : ''}</span></div>`+
      `<div class="tile"><b>${xs.wRefs} → ${xs.xRefs}</b><span>References</span></div>`; } else
    if (res.mode === 'ref' && res.refStats) { const rs = res.refStats; $('cmp-tally').innerHTML =
      `<div class="tile ${(cnt.refmiss||0)+(cnt.missing||0)?'err':''}"><b>${(cnt.refmiss||0)+(cnt.missing||0)}</b><span>Entries/text missing</span></div>`+
      `<div class="tile"><b>${(cnt.number||0)+(cnt.changed||0)}</b><span>Numbers/words changed</span></div>`+
      `<div class="tile chk"><b>${(cnt.inserted||0)+(cnt.refnew||0)}</b><span>Added in Done</span></div>`+
      `<div class="tile chk"><b>${cnt.reorder||0}</b><span>Moved</span></div>`+
      `<div class="tile"><b>${rs.origRefs} → ${rs.doneRefs}</b><span>Entries (Original → Done)</span></div>`; } else
    $('cmp-tally').innerHTML =
      `<div class="tile ${lost?'err':''}"><b>${lost}</b><span>Text/paragraphs missing</span></div>`+
      `<div class="tile"><b>${(cnt.number||0)+(cnt.cite||0)+(cnt.symbol||0)+(cnt.format||0)}</b><span>Numbers/citations/symbols/superscripts</span></div>`+
      `<div class="tile chk"><b>${(cnt.changed||0)+(cnt.inserted||0)+(cnt.celladd||0)}</b><span>Text changed/added</span></div>`+
      `<div class="tile ${cnt.image?'chk':''}"><b>${st.origImgs} → ${st.doneImgs}</b><span>Images (Original → Done)</span></div>`+
      `<div class="tile ${st.doneTables<st.origTables?'err':''}"><b>${st.origTables} → ${st.doneTables}</b><span>Tables</span></div>`+
      `<div class="tile"><b>${pct.toFixed(1)}%</b><span>Words found in Done</span></div>`;
    UIX.tidyTally($('cmp-tally'));
    const chips = [['all', 'All', res.items.length], ...Object.keys(K).filter(k=>cnt[k]).map(k=>[k,K[k],cnt[k]])];
    $('cmp-filters').innerHTML = chips.map(([k,l,n])=>`<button class="chip" data-k="${k}" aria-pressed="${k===filter}">${esc(l)}<span class="n">${n}</span></button>`).join('');
    $('cmp-filters').querySelectorAll('.chip').forEach(b=> b.onclick = ()=>{ filter=b.dataset.k; render(); UIX.refocus($('cmp-filters'),'k',filter,$('cmp-list')); });
    const list = res.items.filter(i=> filter==='all' || i.kind===filter);
    $('cmp-list').innerHTML = list.length ? list.slice(0,800).map(it=>{
      let img = '';
      if(it.img && /^(png|jpe?g|gif|webp|bmp|svg)$/.test(it.img.ext)){ const u = URL.createObjectURL(new Blob([it.img.bytes], {type: it.img.ext==='svg'?'image/svg+xml':'image/'+(it.img.ext==='jpg'?'jpeg':it.img.ext)})); urls.push(u); img = `<img src="${u}" alt="${esc(it.img.name)}">`; }
      const sevCls = res.mode === 'xml' ? (it.kind==='xfmt' || it.kind==='xmathfmt' || it.kind==='xstretch' || it.kind==='xmathsp' ? 'number' : it.sev==='check' ? 'check' : 'error') : ['number','cite','symbol','format'].includes(it.kind) ? 'number' : (['changed','image','inserted','table','refnew','reorder','celladd'].includes(it.kind) ? 'check' : 'error');
      return `<div class="item ${sevCls}"><div class="meta"><span class="sev ${sevCls}">${esc(K[it.kind]||it.kind)}</span>${it.para!=null?`<span>¶${it.para+1}</span>`:`<span>${esc(it.label||'')}</span>`}${it.xline?`<span>XML line ${it.xline}</span>`:''}</div><div class="msg">${UIX.msgHtml(it.msg)}</div>${it.kind!=='image'&&it.kind!=='math'?`<div class="ctx">${ctx(it)}</div>`:''}${img}</div>`;
    }).join('') + (list.length>800 ? `<p class="note">Showing the first 800 of ${list.length} items. Pick a category above to see the rest.</p>` : '') : `<p class="note">${filter==='all' ? (res.mode==='xml' ? 'No places where the XML differs from Word.' : 'No content from the Original is missing from the Done file.') : 'No items in this category.'}</p>`;
    $('cmp-dl').hidden = !res.blob;
    $('cmp-dl').textContent = res.mode==='xml' ? 'Download Word with comments' : 'Download Original with comments';
    $('cmp-title').textContent = res.mode==='xml' ? 'XML ↔ Word results' : 'Comparison results';
  }
  $('cmp-dl').addEventListener('click', async ()=>{
    if(!res || !res.blob) return;
    try{
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if(dl){ await dl.save({ filename: outName, data: res.blob }); status('Saved: ' + outName); return; }
    }catch(e){ if(e && e.code==='declined'){ status('Save cancelled.'); return; } if(e && e.code==='rate_limited'){ status('A save dialog is already open.'); return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(res.blob); a.download = outName; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
