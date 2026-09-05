"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
const seed=Number(process.argv[2]||20260903)
let st=rules.setup(seed,scenario,{headless_moves:true})
let actions=0, lastTurn=-1
while(st.active!=="None"&&actions<60000){
  const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
  const view=rules.view(st,role)
  const turn=Number(view.turn||st.turn||0)
  const tojo=st.events&&st.events[26]||0
  if(turn!==lastTurn){lastTurn=turn; console.log(`T${turn} tojo=${tojo} AP79=${st.hand[1].includes(79)?'hand':(st.draw[1].includes(79)?'draw':'else')} JP127=${st.hand[0].includes(127)?'hand':(st.draw[0].includes(127)?'draw':'else')}`)}
  if(role==="Allies"&&st.hand[1].includes(79)){
    const d=policy.decide(view,{role,seed,actionOrdinal:actions+1})
    console.log(`  [AP decide] turn${turn} tojo=${tojo} AP79inhand -> ${d.action} arg=${d.argument} via=${d.privateTrace?.via||d.publicTrace?.node||''}`)
    if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action);break}
    try{st=rules.action(st,role,d.action,d.argument)}catch(e){console.log("ERR",e.message);break}
    actions++; continue
  }
  const d=policy.decide(view,{role,seed,actionOrdinal:actions+1})
  if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,"@",view.prompt);break}
  try{st=rules.action(st,role,d.action,d.argument)}catch(e){console.log("ERR",e.message);break}
  actions++
}
console.log(`END seed=${seed} turn=${lastTurn}`)
