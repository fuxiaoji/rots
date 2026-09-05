"use strict"
const rules=require("../rules.js")
const policy=rules.bots["erasmus-v2"]
const scenario="1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
const seed=Number(process.argv[2]||20260903)
let st=rules.setup(seed,scenario,{headless_moves:true})
let a=0,max=60000,lastTurn=-1
while(st.active!=="None"&&a<max){
  const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
  const view=rules.view(st,role); const turn=Number(view.turn||0)
  if(role==="Allies"&&turn!==lastTurn&&/select card to play/i.test(String(view.prompt||""))){
    lastTurn=turn
    const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
    const sm=d.privateTrace?.sm||d.publicTrace?.sm
    if(sm&&sm.ctx){
      const c=sm.ctx
      console.log(`T${turn} powNeeds=${c.al_M_B_needs_war_progress} jpControlsCounter=${c.al_M_D_jp_controls_counterattack_target} hand=${c.cards_in_hand} strat=${sm.name} phase=${sm.phase}`)
    }
  }
  const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
  if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action);break}
  st=rules.action(st,role,d.action,d.argument); a++
}
