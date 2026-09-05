"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
function locOf(s,c){if(s.hand[0].includes(c)||s.hand[1].includes(c))return"hand";if(s.draw[0].includes(c)||s.draw[1].includes(c))return"draw";if(s.discard[0].includes(c)||s.discard[1].includes(c))return"discard";if(s.removed[0].includes(c)||s.removed[1].includes(c))return"removed";return"?"}
const AP79=79, JP43=127
for(let seed=20260903;seed<20260923;seed++){
  let st=rules.setup(seed,scenario,{headless_moves:true})
  let actions=0, tojoEver=0, jp43hand=false, jp43cardSel=0, jp43eventSel=0, ap79cardSel=0, ap79eventSel=0, ap79hand=false, finalRes=0
  while(st.active!=="None"&&actions<60000){
    const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
    const view=rules.view(st,role)
    if(Array.isArray(st.events)&&st.events[26]) tojoEver=st.events[26]
    if(st.hand[0].includes(JP43)) jp43hand=true
    if(st.hand[1].includes(AP79)) ap79hand=true
    const d=policy.decide(view,{role,seed,actionOrdinal:actions+1})
    if(d.action==="card"&&d.argument===JP43) jp43cardSel++
    if(d.action==="card"&&d.argument===AP79) ap79cardSel++
    // event selection: after card selected, "event" action
    if(d.action==="event"&&d.argument===JP43) jp43eventSel++
    if(d.action==="event"&&d.argument===AP79) ap79eventSel++
    if(!view.actions||!(d.action in view.actions)){console.log(seed,"ILLEGAL",d.action,"@",view.prompt);break}
    try{st=rules.action(st,role,d.action,d.argument)}catch(e){console.log(seed,"ERR",e.message);break}
    actions++
  }
  try{const a=rules.query(st,"Allies","atomic_bomb_strategy_status"); finalRes=a&&a.jpResources}catch(e){}
  console.log(`seed ${seed} turn=${st.turn} tojoEver=${tojoEver} jp43hand=${jp43hand} jp43card=${jp43cardSel} ap79hand=${ap79hand} ap79card=${ap79cardSel} finalRes=${finalRes} JP43loc=${locOf(st,JP43)} AP79loc=${locOf(st,AP79)}`)
}
