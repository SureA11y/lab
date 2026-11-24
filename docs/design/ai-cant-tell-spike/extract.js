const fs=require('fs');const dir=process.argv[2];
const cases=[];
for(const rel of ['release-1','release-2']){
  const p=JSON.parse(fs.readFileSync(`${dir}/${rel}/payload.json`,'utf8'));
  p.scans.forEach((scan,si)=>{
    for(const f of (scan.canonical?.findings||[])){
      if(f.outcome!=='cantTell')continue;
      for(const o of f.occurrences||[]){
        if((o.occurrenceOutcome||o.outcome)!=='cantTell')continue;
        cases.push({id:`${rel}/s${si}/${o.occurrenceId}`,release:rel,scan:si,page:o.pageUrl,rule:f.ruleId,check:o.atomicCheckId,title:f.title,
          target:o.target,html:o.html,summary:o.failureSummary,hint:o.hint,lean:o.lean,uncertainty:o.uncertainty,howToCheck:o.howToCheck,details:o.details,
          shot:o.elementScreenshot&&(o.elementScreenshot.url||Object.keys(o.elementScreenshot))});
      }
    }
  });
}
fs.writeFileSync(`${dir}/cases.json`,JSON.stringify(cases,null,1));
const g={};for(const c of cases){const k=c.check||c.rule;(g[k]=g[k]||{n:0,hasShot:0,needsLook:0});g[k].n++;if(c.shot)g[k].hasShot++}
console.table(g);console.log(cases.length);
console.log(JSON.stringify(cases[0].shot),Object.keys(cases[0]));
