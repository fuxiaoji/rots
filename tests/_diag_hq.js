"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
const seed=Number(process.argv[2]||20260903)
let st=rules.setup(seed,scenario,{headless_moves:true})
let a=0,max=60000, lastCapture=0
// track Allied HQ selections and captures
let hqCount={}, capByTurn={}
while(st.active!=="None"&&a<max){
  const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
  const view=rules.view(st,role)
  const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
  if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,view.prompt);break}
  if(role==="Allies"&&/Choose HQ/i.test(view.prompt)&&d.action==="unit"){
    const u=(view.ai&&view.ai.units||[]).find(x=>x.id===d.argument)
    hqCount[u&&u.name]=(hqCount[u&&u.name]||0)+1
  }
  st=rules.action(st,role,d.action,d.argument); a++
}
// count captures by scanning log with faction
let apCap=0,jpCap=0,curTurn=0
for(const line of st.log||[]){
  const tm=line.match(/@Turn (\d+)/); if(tm)curTurn=Number(tm[1])
  if(/^AP captured/.test(line)){apCap++;capByTurn[curTurn]=(capByTurn[curTurn]||0)+1}
  if(/^JP captured/.test(line)){jpCap++}
}
console.log("HQ choices:",JSON.stringify(hqCount))
console.log("AP captures by turn:",JSON.stringify(capByTurn),"total AP",apCap,"JP",jpCap)
console.log("final turn",st.turn,"PW",st.political_will,"pow",st.pow,"won",st.result&&st.result.won_side)
