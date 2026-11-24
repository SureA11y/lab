'use strict';

// Builds one HTML file for a person to evaluate the AI's answers to "can't
// tell" cases: the issue, the tool's lean, the evidence and a way to the page,
// the person's own verdict first, then the AI's analysis, and an export.
//
//   node build-review-sheet.js <dir with eval-set.json, ai-answers.json and the .jpg files> [out.html]

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const out = process.argv[3] || path.join(dir, 'review-sheet.html');
const cases = JSON.parse(fs.readFileSync(path.join(dir, 'eval-set.json'), 'utf8'));
const answers = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'ai-answers.json'), 'utf8')).map((a) => [a.caseId, a]));

const data = cases.map((c) => {
    const shot = c.screenshot && fs.existsSync(path.join(dir, c.screenshot))
        ? 'data:image/jpeg;base64,' + fs.readFileSync(path.join(dir, c.screenshot)).toString('base64') : null;
    const ev = c.evidence || {};
    return {
        id: c.caseId, check: c.check, rule: c.rule, criterion: c.criterion, title: c.title,
        issue: c.occurrence.failureSummary || '', hint: c.occurrence.hint || '',
        steps: (c.occurrence.howToCheck && c.occurrence.howToCheck.steps) || [],
        passWhen: c.occurrence.howToCheck && c.occurrence.howToCheck.passWhen,
        failWhen: c.occurrence.howToCheck && c.occurrence.howToCheck.failWhen,
        lean: c.lean || null,
        pages: c.pages, selector: Array.isArray(c.occurrence.target) ? c.occurrence.target[0] : null,
        html: c.occurrence.html || '', shot, visitNote: (c.visit && c.visit.note) || (c.visit && c.visit.error) || null,
        evidence: ev,
        ai: answers.get(c.caseId) || null,
    };
});

const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(new RegExp('[\\u2028\\u2029]', 'g'), '');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI answers review</title>
<style>
:root{--bg:#fafaf7;--panel:#fff;--text:#1d1d1b;--muted:#5a5a55;--line:#d9d8d0;--accent:#1f5fbf;--ok:#17613a;--okbg:#e3f4ea;--bad:#9b1c1c;--badbg:#fbe7e7;--warn:#7a4b00;--warnbg:#fff1d6;--code:#f1f0ea}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--panel:#1f1f1c;--text:#eeede6;--muted:#a9a89f;--line:#3a3935;--accent:#7fb0ff;--ok:#7fd9a3;--okbg:#17301f;--bad:#ff9a9a;--badbg:#3a1c1c;--warn:#ffc86b;--warnbg:#38290c;--code:#292823}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header.top{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:12px 16px}
h1{font-size:1.15rem;margin:0 0 6px}
main{max-width:980px;margin:0 auto;padding:16px}
.bar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
.bar label{font-size:.9rem}
button,select{font:inherit;padding:6px 12px;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:6px;cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.stats{font-size:.9rem;color:var(--muted);margin-top:6px}
article.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
article.card h2{font-size:1.05rem;margin:0 0 4px}
.meta{color:var(--muted);font-size:.88rem}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;border:1px solid var(--line);font-size:.8rem;margin-right:6px}
.tag.ct{background:var(--warnbg);color:var(--warn);border-color:transparent}
.tag.pass{background:var(--okbg);color:var(--ok);border-color:transparent}
.tag.fail{background:var(--badbg);color:var(--bad);border-color:transparent}
.tag.unsure{background:var(--code)}
.grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:10px}
@media(min-width:760px){.grid{grid-template-columns:1fr 1fr}}
.box{border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.box h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 6px}
pre,code{background:var(--code);border-radius:4px}
pre{padding:8px;overflow:auto;max-height:200px;font-size:.82rem;white-space:pre-wrap;word-break:break-word;margin:6px 0 0}
code{padding:1px 4px;font-size:.85rem;word-break:break-all}
img.shot{max-width:100%;border:1px solid var(--line);border-radius:6px;background:#fff}
fieldset{border:1px solid var(--line);border-radius:8px;margin:12px 0 0;padding:8px 12px}
legend{font-weight:600;padding:0 6px}
fieldset label{margin-right:16px;white-space:nowrap}
textarea{width:100%;min-height:52px;font:inherit;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);margin-top:6px}
.ai{border-left:4px solid var(--accent)}
.result{margin-top:8px;font-weight:600}
details{margin-top:8px}
summary{cursor:pointer}
.sr{position:absolute;left:-9999px}
.facts{margin-top:10px;background:var(--code)}
.facts dl{margin:0}
.facts .kv{display:grid;grid-template-columns:minmax(120px,200px) 1fr;gap:2px 12px;padding:4px 0;border-top:1px solid var(--line)}
.facts .kv:first-child{border-top:0}
.facts dt{font-size:.82rem;color:var(--muted);margin:0}
.facts dd{margin:0;font-size:1.02rem;word-break:break-word}
.facts q{font-weight:600}
.facts .none{font-style:italic;color:var(--warn)}
.facts .hint{font-size:.85rem;color:var(--muted)}
@media(max-width:560px){.facts .kv{grid-template-columns:1fr}}
a{color:var(--accent)}
</style>
</head>
<body>
<header class="top">
<h1>AI answers on "can't tell" results: review sheet</h1>
<div class="bar">
<label>Check <select id="fCheck"></select></label>
<label>Show <select id="fState"><option value="all">all cases</option><option value="todo">not yet reviewed</option><option value="done">reviewed</option><option value="diff">where I disagree with the AI</option></select></label>
<label><input type="checkbox" id="aiFirst"> Show the AI's answer before I decide</label>
<button id="exportJson" class="primary" type="button">Export my answers (JSON)</button>
<button id="exportCsv" type="button">Export CSV</button>
<button id="clearAll" type="button">Clear my answers</button>
</div>
<p class="stats" id="stats" role="status" aria-live="polite"></p>
</header>
<main id="cards"></main>
<script id="data" type="application/json">${json}</script>
<script>
(function(){
var DATA=JSON.parse(document.getElementById('data').textContent);
var KEY='ai-review-'+DATA.length+'-'+DATA[0].id+DATA[DATA.length-1].id;
var store={};try{store=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(store))}catch(e){}}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function tag(v){return '<span class="tag '+(v==='pass'||v==='fail'||v==='unsure'?v:'')+'">'+esc(v)+'</span>'}
function agree(r,a){if(!r||!a||!r.verdict)return null;if(r.verdict==='unsure'||a.verdict==='unsure')return r.verdict===a.verdict?'same':'unsure involved';return r.verdict===a.verdict?'same':'different'}
var checks=Array.from(new Set(DATA.map(function(d){return d.check})));
var fCheck=document.getElementById('fCheck');fCheck.innerHTML='<option value="all">all checks</option>'+checks.map(function(c){return '<option>'+esc(c)+'</option>'}).join('');
var fState=document.getElementById('fState'),aiFirst=document.getElementById('aiFirst');
function q(v,none){if(v===undefined||v===null)return '<span class="none">'+esc(none||'(none)')+'</span>';if(v==='')return '<span class="none">(empty)</span>';return '<q>'+esc(v)+'</q>'}
function row(label,html){return '<div class="kv"><dt>'+label+'</dt><dd>'+html+'</dd></div>'}
function fileOf(u){if(!u)return q(undefined);try{var p=new URL(u).pathname.split('/');return q(p[p.length-1]||u)}catch(e){return q(u)}}
function nameOf(f){if(!f.accessibleName)return q(undefined,'(not available)');var n=f.accessibleName.name;return (n===''||n==null)?'<span class="none">(none: nothing gives it a name)</span>':q(n)+' <span class="hint">as '+esc(f.accessibleName.role||'element')+'</span>'}
function controlOf(f){var c=f.control;if(!c)return null;return esc(c.tag)+(c.href?' to <code>'+esc(c.href)+'</code>':'')+(c.ariaLabel?', aria-label '+q(c.ariaLabel):'')+(c.text?', text '+q(c.text):', no text of its own')}
function keyFacts(d){
 var ev=d.evidence||{};var f=ev.facts;var rows=[];
 if(d.check==='page-title-patterns'&&ev.pageTitle){
  rows.push(row('Page title',q(ev.pageTitle.title)));
  rows.push(row('Main headings',(ev.pageTitle.headings||[]).length?ev.pageTitle.headings.map(function(h){return q(h)}).join(' '):q(undefined,'(none found)')));
 }else if(f){
  if(d.check==='img-alt-quality'||d.check==='img-alt-decorative'){
   rows.push(row('Alt text',f.alt===undefined?(f.tag==='img'?'<span class="none">(no alt attribute)</span>':q(undefined,'(not an img: no alt)')):(f.alt===''?'<span class="none">(empty alt: marked decorative)</span>':q(f.alt))));
   rows.push(row('Accessible name',nameOf(f)));
   if(f.control)rows.push(row('Inside a control',controlOf(f)));
   if(f['aria-label']!==undefined)rows.push(row('aria-label',q(f['aria-label'])));
   if(f.title!==undefined)rows.push(row('title',q(f.title)));
   if(f.src)rows.push(row('Image file',fileOf(f.src)));
   if(f.text)rows.push(row('Text inside',q(f.text)));
   if(f.nearestHeadingBefore)rows.push(row('Heading before it',q(f.nearestHeadingBefore)));
  }else if(d.check==='link-name-quality'){
   rows.push(row('Link text',q(f.text||(f.control&&f.control.text),'(no text)')));
   rows.push(row('Accessible name',nameOf(f)));
   var href=f.href||(f.control&&f.control.href);if(href)rows.push(row('Goes to','<code>'+esc(href)+'</code>'));
   if(f['aria-label']!==undefined)rows.push(row('aria-label',q(f['aria-label'])));
   if(f.sameTextLinks)rows.push(row('Links with the same text',f.sameTextLinks.others===0?'none':f.sameTextLinks.others+' other'+(f.sameTextLinks.others===1?'':'s')+(f.sameTextLinks.distinctTargets.length?', going to: '+f.sameTextLinks.distinctTargets.map(function(t){return '<code>'+esc(t)+'</code>'}).join(' '):'')));
   if(f.nearestHeadingBefore)rows.push(row('Heading before it',q(f.nearestHeadingBefore)));
  }else if(d.check==='form-control-programmatic-label-quality'){
   rows.push(row('Label',f.labelText!==undefined?q(f.labelText):'<span class="none">(no label element)</span>'));
   rows.push(row('Placeholder',q(f.placeholder,'(none)')));
   if(f['aria-label']!==undefined)rows.push(row('aria-label',q(f['aria-label'])));
   if(f.labelledByText!==undefined)rows.push(row('aria-labelledby text',q(f.labelledByText)));
   rows.push(row('Accessible name',nameOf(f)));
   rows.push(row('Field',esc(f.tag)+(f.type?' type '+esc(f.type):'')+(f.name?', name '+esc(f.name):'')));
   if(f.nearestHeadingBefore)rows.push(row('Heading before it',q(f.nearestHeadingBefore)));
  }else{
   rows.push(row('Text',q(f.text,'(no text)')));
   rows.push(row('Accessible name',nameOf(f)));
   if(f.nearestHeadingBefore)rows.push(row('Heading before it',q(f.nearestHeadingBefore)));
  }
  rows.push(row('Shown on the page',f.shown?'yes, '+f.size[0]+' x '+f.size[1]+' px':'<span class="none">not visible when the page loads (hidden, in a menu or collapsed)</span>'));
 }else{
  rows.push(row('Not readable','The element could not be found on the live page now. Use the HTML and the page.'));
 }
 return '<div class="box facts"><h3>What to check (read from the page)</h3><dl>'+rows.join('')+'</dl></div>';
}
function cardHtml(d){
 var r=store[d.id]||{};var revealed=r.revealed||aiFirst.checked;var a=d.ai;
 var lean=d.lean?('<p><strong>Tool leans toward '+esc(d.lean.toward)+'.</strong> '+esc(d.lean.why||'')+(d.lean.caution?'<br><span class="meta">Caution: '+esc(d.lean.caution)+'</span>':'')+'</p>'):'<p>The tool gave no lean.</p>';
 var pages=d.pages.map(function(u){return '<li><a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u)+'</a></li>'}).join('');
 var proof=(d.shot?'<img class="shot" alt="Picture of the flagged element as found when this sheet was made" src="'+d.shot+'">':'<p class="meta">No picture: '+esc(d.visitNote||'not captured')+'. Use the page and selector.</p>');
 var ev=d.evidence||{};
 var aiBox='';
 if(a){
  var ag=agree(r,a);
  aiBox='<div class="box ai"><h3>AI analysis and conclusion</h3><p>'+tag(a.verdict)+' <span class="meta">confidence '+esc(a.confidence)+'</span></p><p>'+esc(a.rationale)+'</p>'+(ag?'<p class="result">Compared with your answer: '+esc(ag)+'</p>':'')+
  '<details><summary>What the AI was given (its evidence)</summary><pre>'+esc(JSON.stringify(ev,null,1))+'</pre></details></div>';
 }
 var gate=revealed?aiBox:'<div class="box"><h3>AI analysis and conclusion</h3><p class="meta">Hidden until you have answered, so it does not steer you.</p><button type="button" data-reveal="'+d.id+'"'+(r.verdict?'':' disabled')+'>Show the AI\\'s answer</button>'+(r.verdict?'':'<p class="meta">Choose your answer first.</p>')+'</div>';
 var radios=['pass','fail','unsure'].map(function(v){return '<label><input type="radio" name="v-'+d.id+'" value="'+v+'" data-v="'+d.id+'"'+(r.verdict===v?' checked':'')+'> '+v+'</label>'}).join('');
 return '<article class="card" id="c-'+d.id+'" aria-labelledby="h-'+d.id+'">'+
 '<h2 id="h-'+d.id+'">'+esc(d.id)+' · '+esc(d.check)+'</h2><p class="meta"><span class="tag ct">can\\'t tell</span>'+esc(d.title||'')+(d.criterion?' · WCAG '+esc((d.criterion||[]).join(', ')):'')+' · found on '+d.pages.length+' page'+(d.pages.length===1?'':'s')+'</p>'+
 '<p><strong>The issue:</strong> '+esc(d.issue)+'</p>'+lean+keyFacts(d)+
 '<div class="grid"><div class="box"><h3>Proof and where to look</h3>'+proof+
 '<p class="meta">Page'+(d.pages.length>1?'s (first of '+d.pages.length+')':'')+':</p><ul>'+pages.split('</li>').slice(0,3).join('</li>')+(d.pages.length>3?'</li>':'')+'</ul>'+
 (d.selector?'<p class="meta">Selector: <code>'+esc(d.selector)+'</code> <button type="button" data-copy="'+esc(d.selector).replace(/"/g,'&quot;')+'">Copy</button></p>':'')+
 '<details><summary>Element HTML</summary><pre>'+esc(d.html)+'</pre></details>'+
 '<details><summary>How to check (the tool\\'s steps)</summary><ol>'+d.steps.map(function(s){return '<li>'+esc(s)+'</li>'}).join('')+'</ol>'+(d.passWhen?'<p><strong>Pass when:</strong> '+esc(d.passWhen)+'</p>':'')+(d.failWhen?'<p><strong>Fail when:</strong> '+esc(d.failWhen)+'</p>':'')+'</details></div>'+
 '<div><fieldset><legend>Your answer</legend>'+radios+'<label class="sr" for="n-'+d.id+'">Note</label><textarea id="n-'+d.id+'" data-n="'+d.id+'" placeholder="Note (optional): why, or what you saw on the page">'+esc(r.note||'')+'</textarea></fieldset>'+gate+'</div></div></article>';
}
function visible(d){
 if(fCheck.value!=='all'&&d.check!==fCheck.value)return false;
 var r=store[d.id]||{};
 if(fState.value==='todo')return !r.verdict;
 if(fState.value==='done')return !!r.verdict;
 if(fState.value==='diff')return agree(r,d.ai)==='different';
 return true;
}
function stats(){
 var done=DATA.filter(function(d){return (store[d.id]||{}).verdict});var same=0,diff=0,wrongPass=0,wrongFail=0,uns=0;
 done.forEach(function(d){var r=store[d.id];var a=d.ai;if(!a)return;var g=agree(r,a);if(g==='same')same++;else if(g==='different'){diff++;if(a.verdict==='pass')wrongPass++;else wrongFail++}else uns++});
 document.getElementById('stats').textContent=done.length+' of '+DATA.length+' reviewed. Same as the AI: '+same+'. Different: '+diff+' (the AI said pass where you said fail: '+wrongPass+'; fail where you said pass: '+wrongFail+'). One of you unsure: '+uns+'.';
}
function render(keepFocus){
 var active=document.activeElement&&document.activeElement.id;
 document.getElementById('cards').innerHTML=DATA.filter(visible).map(cardHtml).join('')||'<p>No cases match.</p>';
 stats();
 if(keepFocus&&active){var el=document.getElementById(active);if(el)el.focus()}
}
document.addEventListener('change',function(e){var t=e.target;
 if(t.dataset&&t.dataset.v){(store[t.dataset.v]=store[t.dataset.v]||{}).verdict=t.value;save();render(false);var r=document.querySelector('input[name="v-'+t.dataset.v+'"]:checked');if(r)r.focus()}
 else if(t===fCheck||t===fState||t===aiFirst)render(false)});
document.addEventListener('input',function(e){var t=e.target;if(t.dataset&&t.dataset.n){(store[t.dataset.n]=store[t.dataset.n]||{}).note=t.value;save()}});
document.addEventListener('click',function(e){var t=e.target;
 if(t.dataset&&t.dataset.reveal){(store[t.dataset.reveal]=store[t.dataset.reveal]||{}).revealed=true;save();render(false);var b=document.getElementById('h-'+t.dataset.reveal);if(b){b.setAttribute('tabindex','-1');b.focus()}}
 else if(t.dataset&&t.dataset.copy){try{navigator.clipboard.writeText(t.dataset.copy);t.textContent='Copied'}catch(x){}}});
function rows(){return DATA.map(function(d){var r=store[d.id]||{};var a=d.ai||{};return{caseId:d.id,check:d.check,page:d.pages[0],selector:d.selector,toolLean:d.lean?d.lean.toward:null,humanVerdict:r.verdict||null,humanNote:r.note||null,aiVerdict:a.verdict||null,aiConfidence:a.confidence==null?null:a.confidence,aiRationale:a.rationale||null,agreement:agree(r,a),aiSeenBeforeAnswering:null}})}
function download(name,type,text){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:type}));a.download=name;a.click()}
document.getElementById('exportJson').onclick=function(){download('ai-review-answers.json','application/json',JSON.stringify(rows(),null,1))};
document.getElementById('exportCsv').onclick=function(){var rs=rows();var k=Object.keys(rs[0]);var q=function(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'};download('ai-review-answers.csv','text/csv',[k.join(',')].concat(rs.map(function(r){return k.map(function(c){return q(r[c])}).join(',')})).join('\\n'))};
document.getElementById('clearAll').onclick=function(){if(confirm('Clear all your answers on this sheet?')){store={};save();render(false)}};
render(false);
})();
</script>
</body>
</html>
`;
fs.writeFileSync(out, html);
console.log('written', out, Math.round(html.length / 1024) + ' KB,', data.length, 'cases,', data.filter((d) => d.shot).length, 'with pictures,', data.filter((d) => d.ai).length, 'with AI answers');
