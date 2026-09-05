"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
function locOf(s,c){if(s.hand[0].includes(c)||s.hand[1].includes(c))return"hand";if(s.draw[0].includes(c)||s.draw[1].includes(c))return"draw";if(s.discard[0].includes(c)||s.discard[1].includes(c))return"discard";if(s.removed[0].includes(c)||s.removed[1].includes(c))return"removed";return"?"}
for(let seed=20260903;seed<20260923;seed++){
  let st=rules.setup(seed,scenario,{headless_moves:true})
  let actions=0, saw79Hand=false, saw79Event=false, tojoActiveAtAny=false, maxRes=0, finalRes=0
  while(st.active!=="None"&&actions<60000){
    const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
    const view=rules.view(st,role)
    // track AP79 in hand at any decision
    if(st.hand[1].includes(79)) saw79Hand=true
    if(st.events&&st.events[26]) tojoActiveAtAny=true
    if(st.removed[1].includes(79)) saw79Event=true
    const a=(()=>{try{return rules.query(st,"Allies","atomic_bomb_strategy_status")}catch(e){return null}})()
    if(a){ if(a.jpResources>maxRes)maxRes=a.jpResources; finalRes=a.jpResources }
    const d=policy.decide(view,{role,seed,actionOrdinal:actions+1})
    if(!view.actions||!(d.action in view.actions)){console.log(seed,"ILLEGAL",d.action);break}
    try{st=rules.action(st,role,d.action,d.argument)}catch(e){console.log(seed,"ERR",e.message);break}
    actions++
  }
  const a=st.active==="None"?(()=>{try{return rules.query(st,"Allies","atomic_bomb_strategy_status")}catch(e){return null}})():null
  console.log(`seed ${seed} winner=${st.winner||"?"} turn=${st.turn} AP79hand=${saw79Hand} AP79event=${saw79Event} TOJO=${tojoActiveAtAny} jpResFinal=${finalRes} maxRes=${maxRes} finalMet=${a&&a.met} AP79loc=${locOf(st,79)} JP43loc=${locOf(st,43)}`)
}
