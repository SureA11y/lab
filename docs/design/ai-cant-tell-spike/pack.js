const fs=require('fs');const dir=process.argv[2];
const cases=JSON.parse(fs.readFileSync(dir+'/cases.json','utf8')).filter(c=>c.check!=='manual-review');
const seen=new Set(),pack=[];
(async()=>{
for(const c of cases){
  const k=c.check+c.page+c.html;if(seen.has(k))continue;seen.add(k);
  const page=await (await fetch(c.page)).text();
  const i=page.indexOf(c.html.slice(0,60));
  const context=i>=0?page.slice(Math.max(0,i-350),i+c.html.length+350):'(not found in source)';
  let image=null;const m=/src="([^"]+\.svg)"/.exec(c.html);
  if(m&&c.check.startsWith('img-alt'))image=await (await fetch(new URL(m[1],c.page))).text();
  pack.push({caseId:'C'+String(pack.length+1).padStart(2,'0'),from:c.id,release:c.release,page:c.page,check:c.check,rule:c.rule,
    element:c.html,toolSays:c.summary,howToCheck:c.howToCheck,details:c.details,context,imageSource:image});
}
fs.writeFileSync(dir+'/pack.json',JSON.stringify(pack,null,1));console.log(pack.length);
// blind version: no release, no tool lean
fs.writeFileSync(dir+'/blind.json',JSON.stringify(pack.map(({from,release,...r})=>r),null,1));
})();
