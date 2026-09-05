"use strict"
const rules=require("../rules.js")
const policy=rules.bots["erasmus-v2"]
const scenario="1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
const seed=Number(process.argv[2]||20260903)
let st=rules.setup(seed,scenario,{headless_moves:true})
let a=0,max=60000
while(st.active!=="None"&&a<max){
  const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
  const view=rules.view(st,role)
  const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
  if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,view.prompt);break}
  if(role==="Allies"&&/select card to play/i.test(view.prompt)){
    // print the state machine's diag for this pin
    const sm=d.privateTrace&&d.privateTrace.sm
    if(sm&&sm.pinnedNow){
      const diag=sm.diag||{}
      console.log(`T${view.turn} phase=${sm.phase} strat=${sm.strategy} bank=${diag.bank} pow=${diag.pow} jpRes=${diag.jpRes} focus=${sm.focus} chainLen=${sm.chainLen}`)
    }
  }
  st=rules.action(st,role,d.action,d.argument); a++
}
