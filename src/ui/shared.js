// presentation helpers shared by both tabs (no effect on what is checked)
window.UIX = (function(){
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // one block per line; "→ …" lines are fix suggestions
  const msgHtml = s => String(s==null?'':s).split('\n').map(l => `<span class="ln${/^→ /.test(l)?' fix':''}">${esc(l)}</span>`).join('');
  const tidyTally = el => el.querySelectorAll('.tile').forEach(t => { const b = t.querySelector('b'); const v = b ? b.textContent.trim() : ''; if (v === '0') t.classList.add('zero'); if (/→|%$/.test(v)) t.classList.add('info'); const sp = t.querySelector('span'); if (sp && sp.textContent.length > 34) t.classList.add('wide'); });
  const reveal = el => { try { if (el && matchMedia('(max-width: 860px)').matches) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); } catch (e) {} };
  const refocus = (box, attr, key, list) => { if (list) list.scrollTop = 0; const b = box && [...box.querySelectorAll('[data-'+attr+']')].find(x => x.dataset[attr] === String(key)); if (b) b.focus(); };
  return { msgHtml, tidyTally, reveal, refocus };
})();
