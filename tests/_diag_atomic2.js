"use strict"
const rules=require("../rules.js")
const policy=rules.bots["erasmus-v2"]
const scenario="1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
const seed=Number(process.argv[2]||20260907)
let st=rules.setup(seed,scenario,{headless_moves:true})
let a=0,max=60000,lastTurn=-1
while(st.active!=="None"&&a<max){
  const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
  const view=rules.view(st,role)
  const turn=Number(view.turn||0)
  if(turn!==lastTurn){lastTurn=turn
    let at=null; try{at=rules.query(st,"Allies","atomic_bomb_strategy_status")}catch(e){}
    if(at)console.log(`T${turn} met=${at.met} sovOcc=${at.sovietOccurred} sovHand=${at.sovietInHand} sovPlay=${at.sovietPlayable} jpRes=${at.jpResources} resOk=${at.resourcesSatisfied} noBombFail=${at.noStrategicBombingFailure}`)
  }
  const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
  if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,view.prompt);break}
  st=rules.action(st,role,d.action,d.argument); a++
}
console.log("END turn=",lastTurn," pw=",st.political_will, " won=", st.won_text||st.result)
