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
  const view=rules.view(st,role); const turn=Number(view.turn||0)
  const tojoActive=!!(st.events&&st.events[26])
  const ap79inHand=!!(st.hand&&st.hand[1]&&st.hand[1].includes(79))
  if(role==="Allies"&&ap79inHand&&tojoActive){
    const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
    console.log(`T${turn} AP79 in hand + TOJO active | view.card=${JSON.stringify(view.actions.card)} | decide action=${d.action} arg=${JSON.stringify(d.argument)} | via=${d.via||d.privateTrace?.via||""}`)
  }
  const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
  if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,view.prompt);break}
  st=rules.action(st,role,d.action,d.argument); a++
}
console.log("END turn",st.turn,"pw",st.political_will,"won",st.won_text||st.result)
