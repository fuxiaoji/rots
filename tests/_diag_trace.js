"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
function play(seed){
  let st=rules.setup(seed,scenario,{headless_moves:true})
  let a=0,max=60000
  while(st.active!=="None"&&a<max){
    const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
    const view=rules.view(st,role)
    const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
    if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,JSON.stringify(view.prompt));break}
    st=rules.action(st,role,d.action,d.argument); a++
  }
  return st
}
const seed=Number(process.argv[2]||20260903)
const st=play(seed)
// Print log lines with turn markers around offensives + captures + no battle hex
const log=st.log||[]
for(let i=0;i<log.length;i++){
  const l=log[i]
  if(/@Turn|offensive|Offensive|OC:|EC:|captured|No battle hexes|fire \(|declared in|Battle [A-Z]/.test(l)){
    console.log(l.replace(/&A|&J/g,''))
  }
}
