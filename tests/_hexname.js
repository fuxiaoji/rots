"use strict"
const path=require("path")
const idxOf=id=>(Math.floor(id/100)-10)*29+(id%100)
const nm={}
const MAP_SRC=require("fs").readFileSync(path.join(__dirname,"..","js","common","data_map.js"),"utf8")
for(const m of MAP_SRC.matchAll(/\{\s*id:\s*(\d+)\s*,([\s\S]*?)\n\s*\}/g)){
  const b=m[2]; const n=(b.match(/name:\s*"([^"]+)"/)||[])[1];
  if(n) nm[idxOf(+m[1])]=n
}
const idxs = [1009, 1056, 825, 891, 1088, 452, 594, 566, 508, 421, 480, 535, 274, 273, 331, 887, 769, 712, 1089, 302, 327]
for (const i of idxs) console.log(i, "->", nm[i]||"?")
