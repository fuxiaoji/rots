"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const seed = Number(process.argv[2]||20260903)
let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", {headless_moves:true})
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
const nm={}
const MAP_SRC=require("fs").readFileSync(require("path").join(__dirname,"..","js","common","data_map.js"),"utf8")
const idxOf=id=>(Math.floor(id/100)-10)*29+(id%100)
for(const m of MAP_SRC.matchAll(/\{\s*id:\s*(\d+)\s*,([\s\S]*?)\n\s*\}/g)){const b=m[2];const n=(b.match(/name:\s*"([^"]+)"/)||[])[1];if(n)nm[idxOf(+m[1])]=n}
let actions=0
try{
 while(state.active!=="None"&&actions<200000){
  const role=activeRole(state); const view=rules.view(state,role)
  const d=policy.decide(view,{role,seed,actionOrdinal:actions+1})
  if(!view.actions||!(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
  const sm=d.publicTrace&&d.publicTrace.sm
  if(sm&&sm.pinnedNow&&role==="Allies"&&sm.kind==="CONQUEST"){
    // dump chain head + focus + control states
    const chain = d.publicTrace && d.publicTrace.sm && d.publicTrace.sm.chain ? null : null
    const focus = sm.focus
    const chainHead = sm.chainHead
    console.log(`[PIN T${state.turn}] ${sm.strategy} chainHead=${chainHead}(${nm[chainHead]||"?"}) focus=${focus}(${nm[focus]||"?"})`)
    // print a few chain hexes control state — need access to supply_cache via rules internals; use view? 
  }
  state=rules.action(state,role,d.action,d.argument)
  actions++
 }
}catch(e){console.log("err",e.message);process.exit(2)}
console.log("END",state.turn,state.result)
