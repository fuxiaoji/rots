"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const seed = Number(process.argv[2] || 20260909)
let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", { headless_moves: true })
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
let actions=0, lastTurn=0
const idxOf=id=>(Math.floor(id/100)-10)*29+(id%100)
const MAP_SRC=require("fs").readFileSync(require("path").join(__dirname,"..","js","common","data_map.js"),"utf8")
// name lookup
const nm={}
for(const m of MAP_SRC.matchAll(/\{\s*id:\s*(\d+)\s*,([\s\S]*?)\n\s*\}/g)){
  const b=m[2]; const n=(b.match(/name:\s*"([^"]+)"/)||[])[1]
  if(n) nm[idxOf(+m[1])]=n
}
try{
 while(state.active!=="None"&&actions<150000){
  const role=activeRole(state); const view=rules.view(state,role)
  const d=policy.decide(view,{role,seed,actionOrdinal:actions+1})
  if(!view.actions||!(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
  const pre=state.log.length
  state=rules.action(state,role,d.action,d.argument)
  for(const line of state.log.slice(pre)){
    if(/@Turn |Progress of War|progress of war \d/.test(line)){
      const cap=(state.capture||[]).map(i=>`${i}:${nm[i]||"?"}`)
      console.log(`[T${state.turn}/${role}] ${line.replace(/^@/,"")} | cap(${cap.length})=${cap.slice(0,12).join(",")}`)
    }
  }
  actions++
 }
}catch(e){console.log("err",e.message);process.exit(2)}
console.log("end turn",state.turn,"win",state.result,"final cap len",(state.capture||[]).length)
