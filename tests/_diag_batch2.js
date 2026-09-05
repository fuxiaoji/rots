"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
for(let seed=20260903;seed<20260923;seed++){
  let st=rules.setup(seed,scenario,{headless_moves:true})
  let actions=0, tojoEver=0, jp43Event=0, ap79Event=0, ap79HandEver=false, finalRes=0
  while(st.active!=="None"&&actions<60000){
    const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
    const view=rules.view(st,role)
    if(Array.isArray(st.events)&&st.events[26]) tojoEver=st.events[26]
    if(st.hand[1].includes(79)) ap79HandEver=true
    const d=policy.decide(view,{role,seed,actionOrdinal:actions+1})
    // detect event plays of 43/79: card selected + action event
    if(d.action==="card"&&(d.argument===43)&&role==="Japan") jp43Event++
    if(d.action==="card"&&(d.argument===79)&&role==="Allies") ap79Event++
    if(!view.actions||!(d.action in view.actions)){console.log(seed,"ILLEGAL",d.action);break}
    try{st=rules.action(st,role,d.action,d.argument)}catch(e){console.log(seed,"ERR",e.message);break}
    actions++
  }
  try{const a=rules.query(st,"Allies","atomic_bomb_strategy_status"); finalRes=a&&a.jpResources}catch(e){}
  console.log(`seed ${seed} turn=${st.turn} tojoEver=${tojoEver} jp43CardSel=${jp43Event} ap79CardSel=${ap79Event} ap79Hand=${ap79HandEver} finalRes=${finalRes}`)
}
