"use strict"
const rules=require("../rules.js"), path=require("path")
const policy=rules.bots["erasmus-v2"]
const seed=Number(process.argv[2]||20260909)
let state=rules.setup(seed,"1942-1945 (The Shortened Campaign)",{headless_moves:true})
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
const idxOf=id=>(Math.floor(id/100)-10)*29+(id%100)
const nm={}
const MAP_SRC=require("fs").readFileSync(path.join(__dirname,"..","js","common","data_map.js"),"utf8")
for(const m of MAP_SRC.matchAll(/\{\s*id:\s*(\d+)\s*,([\s\S]*?)\n\s*\}/g)){const b=m[2];const n=(b.match(/name:\s*"([^"]+)"/)||[])[1];if(n)nm[idxOf(+m[1])]=n}
let actions=0
const capSnap=()=>`cap(${state.capture.length}) ${state.capture.map(i=>`${i}:${nm[i]||"?"}`).join(" ")}`
try{
 while(state.active!=="None"&&actions<200000){
  const role=activeRole(state); const view=rules.view(state,role)
  const d=policy.decide(view,{role,seed,actionOrdinal:actions+1})
  if(!view.actions||!(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
  const pre=state.log.length
  state=rules.action(state,role,d.action,d.argument)
  for(const line of state.log.slice(pre)){
    if(/AP captured/.test(line)||/Progress of War \d+ >=/.test(line)){
      console.log(`[T${state.turn}/${role}] ${line.trim()}  >>  ${capSnap()}`)
    }
  }
  if(actions%500===0){} // noop
  actions++
 }
}catch(e){console.log("err",e.message);process.exit(2)}
console.log("END turn",state.turn,"win",state.result,capSnap())
