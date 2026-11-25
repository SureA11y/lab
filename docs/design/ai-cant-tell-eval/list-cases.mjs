// Lists a run's AI questions as cases (one per question, as the review and
// ai:agreement count them), with what label-rules.js needs to label them.
//
//   node docs/design/ai-cant-tell-eval/list-cases.mjs <payload.json> <cases.json>
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const { collectAiCases } = await import(pathToFileURL(path.join(here, '../../../src/js/ai-answer-view.js')).href);
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const c of collectAiCases(p)) {
  const ev = c.ai.evidence || {}; const f = ev.facts || {};
  const page = c.urls[0].replace(/.*\/tests\//, '').replace(/.*\/au\//, 'au/').replace('.html', '');
  let info = '';
  if (/^img/.test(c.check)) info = `alt=${JSON.stringify(f.alt)} src=${(f.src||'').split('/').pop()} look=${ev.image&&ev.image.look?(ev.image.look.blank?'blank':ev.image.look.colours+'c'):'-'} name=${JSON.stringify(f.accessibleName&&f.accessibleName.name)} ctrl=${f.control?JSON.stringify(f.control.text||f.control.ariaLabel||''):''}`;
  else if (c.check === 'page-title-patterns') info = 'title=' + JSON.stringify(ev.pageTitle && ev.pageTitle.title) + ' h=' + JSON.stringify((ev.pageTitle && ev.pageTitle.headings || []).slice(0, 2));
  else if (c.check === 'link-name-quality') info = 'text=' + JSON.stringify(f.text) + ' href=' + (f.href || '');
  else if (/label/.test(c.check)) info = `title=${JSON.stringify(f.title)} ph=${JSON.stringify(f.placeholder)} name=${JSON.stringify(f.accessibleName&&f.accessibleName.name)}`;
  else if (c.check === 'p-as-heading') info = 'text=' + JSON.stringify(f.text);
  else if (ev.focusWalk) { const w = ev.focusWalk; info = `stops=${w.stops.length} ended=${w.ended}${w.endedAt?'@'+w.endedAt:''} nochange=${w.stops.filter(s=>Array.isArray(s.changesOnFocus)&&!s.changesOnFocus.length).length} lost=${w.stops.filter(s=>s.lostFocus).length} unreachable=${w.unreachable?w.unreachable.total:'-'} order=${w.stops.slice(0,6).map(s=>(s.name||s.tag).slice(0,12)).join('>')}`; }
  out.push({ key: c.key, check: c.check, page, sel: (c.selector || '').slice(-40), info });
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
for (const o of out) console.log(o.page.slice(0, 44).padEnd(45), o.check.slice(0, 22).padEnd(23), o.info.slice(0, 150));
