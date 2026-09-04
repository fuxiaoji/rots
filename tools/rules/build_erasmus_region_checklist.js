"use strict"
const fs=require("fs"),path=require("path")
const root=path.resolve(__dirname,"../.."),dir=path.join(root,"data/erasmus/pages")
const out=path.join(root,"docs/rules/normalized/erasmus-v2-zh-charts/node-regions.csv")
const q=s=>`"${String(s??"").replaceAll('"','""')}"`
const rows=[["page","chart_id","node_id","type","label_zh","x","y","width","height","units","备注"]]
for(let page=1;page<=12;page++){
 const chart=JSON.parse(fs.readFileSync(path.join(dir,`page-${String(page).padStart(2,"0")}.json`),"utf8"))
 for(const n of chart.nodes) rows.push([page,chart.id,n.id,n.type,n.label_zh||n.strategy||n.predicate?.id||"","","","","","page_fraction",""])
}
fs.writeFileSync(out,"\ufeff"+rows.map(r=>r.map(q).join(",")).join("\r\n")+"\r\n")
console.log(`wrote ${out}: ${rows.length-1} nodes`)
