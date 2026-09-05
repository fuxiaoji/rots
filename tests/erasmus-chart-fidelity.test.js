"use strict"
const assert=require("assert"),fs=require("fs"),path=require("path"),crypto=require("crypto")
const root=path.resolve(__dirname,".."), doc=JSON.parse(fs.readFileSync(path.join(root,"data/erasmus/charts.json"),"utf8"))
assert.equal(doc.schema_version,3);assert.equal(doc.policy_version,"erasmus-v2.0-zh.16");assert.equal(doc.charts.length,12)
const pdf="D:/downloads/伊拉斯谟v2.0_图表汉化 (1).pdf"
const hash=crypto.createHash("sha256").update(fs.readFileSync(pdf)).digest("hex")
for(const c of doc.charts){
 assert.equal(c.source.sha256,hash,`${c.id}: source hash`);assert.equal(c.qa.visual_review_required,false);assert.deepEqual(c.qa.inferred_nodes,[])
 const ids=new Set(c.nodes.map(n=>n.id));assert.equal(ids.size,c.nodes.length)
 const start=c.nodes.find(n=>n.type==="start");assert(start)
 const seen=new Set(),todo=[start.id];while(todo.length){const id=todo.pop();if(seen.has(id))continue;seen.add(id);const n=c.nodes.find(x=>x.id===id);assert(n,`${c.id}: dangling ${id}`);for(const e of n.edges||[])todo.push(e.to)}
 for(const n of c.nodes){if(n.type!=="fallback")assert(seen.has(n.id),`${c.id}: unreachable ${n.id}`);if(n.type==="condition")assert.deepEqual(new Set(n.edges.map(e=>e.when)),new Set([true,false]));if(n.type==="dice"){const values=[];for(const r of n.ranges)for(let i=r.min;i<=r.max;i++)values.push(i);assert.deepEqual(values.sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8,9],`${n.id}: D10 coverage`)}}
}
const byPage=n=>doc.charts.find(c=>c.source_page===n)
assert.deepEqual(byPage(8).nodes.find(n=>n.id==="AP08-D10").ranges.map(r=>[r.min,r.max]),[[0,4],[5,7],[8,8],[9,9]])
assert.deepEqual(byPage(12).nodes.find(n=>n.id==="AP12-RF-D10").ranges.map(r=>[r.min,r.max]),[[0,4],[5,9]])
assert.deepEqual(byPage(5).nodes.find(n=>n.id==="JP05-D10").ranges.map(r=>[r.min,r.max]),[[0,3],[4,9]])
for(const id of ["JP01-A","JP01-B","JP01-CD","JP01-CEHI","JP01-CJEBIK","JP01-D10","AP09-G"])
 assert(doc.charts.some(c=>c.nodes.some(n=>n.id===id)),`missing visual node ${id}`)
console.log("Erasmus 12-page visual graph fidelity passed")
