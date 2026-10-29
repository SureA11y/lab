// Builds a page with many accessibility failures of varied kinds.
const fs = require('fs');
let h = '<!doctype html><html><head><title>Perf fixture</title><style>.lc{color:#aaa;background:#fff}</style></head><body>';
for (let s = 0; s < 12; s++) {
  h += `<section id="sec${s}"><div class="h">Section ${s}</div>`;
  for (let i = 0; i < 40; i++) h += `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="20" height="20">`;
  for (let i = 0; i < 25; i++) h += `<p class="lc">Low contrast text ${s}-${i}</p>`;
  for (let i = 0; i < 15; i++) h += `<input type="text" name="f${s}_${i}">`;
  for (let i = 0; i < 15; i++) h += `<a href="#x"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>`;
  for (let i = 0; i < 10; i++) h += `<button></button><div role="button">x</div>`;
  for (let i = 0; i < 5; i++) h += `<div id="dup${i}">dup</div>`;
  h += `<ul><div>bad list</div><li>ok</li></ul></section>`;
}
h += '</body></html>';
fs.writeFileSync(process.argv[2], h);
