(function(){
  const $ = id => document.getElementById(id);
  let file = null, out = null, outName = '', allFindings = [], filter = 'all', part = 'all';
  const PART = { th:{ doc:'Whole document', front:'Front matter', main:'Main text', back:'Back matter', ref:'References' }, en:{ doc:'Whole document', front:'Front matter', main:'Main text', back:'Back matter', ref:'References' } };
  const CAT = { page:'Page/document', format:'Paragraph format', front:'Front matter', case:'Title case', species:'Species names', supsub:'Superscript/subscript', heading:'Headings', text:'Text & symbols', unit:'Units', cite:'In-text citations', figtab:'Figures/tables/equations', back:'Back matter', ref:'Reference list', jabbr:'Journal abbreviation' };
  const CAT_EN = { page:'Page/document', format:'Paragraph format', front:'Front matter', case:'Title case', species:'Species names', supsub:'Superscript/subscript', heading:'Headings', text:'Text & symbols', unit:'Units', cite:'In-text citations', figtab:'Figures/tables/equations', back:'Back matter', ref:'Reference list', jabbr:'Journal abbreviation' };

  function pick(f){
    if(!f) return;
    if(!/\.docx$/i.test(f.name)){ setStatus('Only .docx files are supported. For a .doc file, open it in Word and use Save As .docx first.', true); return; }
    file = f; $('fname').textContent = f.name + ' · ' + Math.round(f.size/1024).toLocaleString('en-US') + ' KB';
    $('run').disabled = false; setStatus('');
  }
  function setStatus(t, err){ const s=$('status'); s.textContent=t; s.className='status'+(err?' err':''); }
  const drop = $('drop');
  drop.addEventListener('click', ()=> $('file').click());
  drop.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('file').click(); }});
  $('file').addEventListener('change', e=> pick(e.target.files[0]));
  drop.addEventListener('dragover', e=>{ e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', ()=> drop.classList.remove('drag'));
  drop.addEventListener('drop', e=>{ e.preventDefault(); drop.classList.remove('drag'); pick(e.dataTransfer.files[0]); });

  $('run').addEventListener('click', async ()=>{
    if(!file) return;
    if(typeof JSZip === 'undefined'){ setStatus('The file-reading library did not load. Try reloading the page.', true); return; }
    $('run').disabled = true; $('run').classList.add('busy'); setStatus('Reading and checking the document…');
    try{
      const lang = 'en';
      const ab = await file.arrayBuffer();
      const parts = [...document.querySelectorAll('input[name=part]:checked')].flatMap(x=> x.value==='main' ? ['main','front','back'] : [x.value]);
      if(!parts.length){ setStatus('Select at least one part to check.', true); return; }
      const res = await processDocx(ab, { lang, parts, compact: false, includeCheck: true, author: 'MDPI Layout Checker' });
      out = res.blob; outName = file.name.replace(/\.docx$/i,'') + '_MDPI-comments.docx';
      allFindings = res.findings;
      render(res, lang); UIX.reveal($('results'));
      setStatus((res.removedComments ? `Removed ${res.removedComments.toLocaleString('en-US')} existing comments and added ` : 'Added ') + `${res.findings.length.toLocaleString('en-US')} new comments to the file.`);
    }catch(e){ console.error(e); setStatus('The check failed: ' + (e && e.message || e) + '. Make sure the file opens normally in Word.', true); }
    finally{ $('run').disabled = false; $('run').classList.remove('busy'); }
  });

  function render(res, lang){
    $('rest').hidden = true; $('results').hidden = false;
    const L = lang==='th' ? CAT : CAT_EN;
    const err = res.findings.filter(f=>f.sev==='error').length, chk = res.findings.length - err;
    $('tally').innerHTML = `<div class="tile err"><b>${err}</b><span>Not per guide</span></div><div class="tile chk"><b>${chk}</b><span>Please check</span></div><div class="tile info"><b>${res.stats.paras}</b><span>Paragraphs read</span></div><div class="tile info"><b>${res.stats.refs}</b><span>References</span></div>`; UIX.tidyTally($('tally'));
    const counts = {}; res.findings.forEach(f=> counts[f.cat]=(counts[f.cat]||0)+1);
    const PL = PART[lang];
    const dp = p => (p==='front' || p==='back') ? 'main' : p;
    const pc = {}; res.findings.forEach(f=> pc[dp(f.part)]=(pc[dp(f.part)]||0)+1);
    $('parts').innerHTML = [['all', 'All parts', res.findings.length], ...Object.keys(PL).filter(k=>pc[k]).map(k=>[k,PL[k],pc[k]])].map(([k,l,n])=>`<button class="chip" data-p="${k}" aria-pressed="${k===part}">${esc(l)}<span class="n">${n}</span></button>`).join('');
    $('parts').querySelectorAll('.chip').forEach(b=> b.onclick = ()=>{ part=b.dataset.p; render(res, lang); UIX.refocus($('parts'),'p',part,$('list')); });
    const inPart = res.findings.filter(f=> part==='all' || dp(f.part)===part);
    Object.keys(counts).forEach(k=>delete counts[k]); inPart.forEach(f=> counts[f.cat]=(counts[f.cat]||0)+1);
    if(filter!=='all' && !counts[filter]) filter='all';
    const chips = [['all','All',inPart.length], ...Object.keys(L).filter(k=>counts[k]).map(k=>[k,L[k],counts[k]])];
    $('filters').innerHTML = chips.map(([k,l,n])=>`<button class="chip" data-k="${k}" aria-pressed="${k===filter}">${esc(l)}<span class="n">${n}</span></button>`).join('');
    $('filters').querySelectorAll('.chip').forEach(b=> b.onclick = ()=>{ filter=b.dataset.k; render(res, lang); UIX.refocus($('filters'),'k',filter,$('list')); });
    const list = inPart.filter(f=> filter==='all' || f.cat===filter);
    $('list').innerHTML = list.length ? list.slice(0,600).map(f=>`<div class="item ${f.sev}"><div class="meta"><span class="sev ${f.sev}">${f.sev==='error'?'Must fix':'Please check'}</span><span>${esc(PL[dp(f.part)]||'')}</span><span>¶${f.para+1}</span><span>${esc(L[f.cat]||f.cat)}</span></div><div class="msg">${UIX.msgHtml(f.msg)}</div>${f.excerpt.trim()&&f.cat!=='page'?`<span class="ex">${esc(f.excerpt)}</span>`:''}<details><summary>Guide rule</summary>${esc(f.rule)}</details></div>`).join('') + (list.length>600?`<p class="note">Showing the first 600 items. All of them are in the Word file.</p>`:'') : '<p class="note">No items in this category.</p>';
  }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  $('dl').addEventListener('click', async ()=>{
    if(!out) return;
    try{
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if(dl){ await dl.save({ filename: outName, data: out }); setStatus('Saved: ' + outName); return; }
    }catch(e){
      if(e && e.code==='declined'){ setStatus('Save cancelled.'); return; }
      if(e && e.code==='rate_limited'){ setStatus('A save dialog is already open. Try again in a moment.'); return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(out); a.download = outName; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
