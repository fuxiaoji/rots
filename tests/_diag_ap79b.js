"use strict"
const rules=require("../rules.js")
const policy=rules.bots["erasmus-v2"]
const scenario="1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
const seed=Number(process.argv[2]||20260903)
let st=rules.setup(seed,scenario,{headless_moves:true})
let a=0,max=60000
let prev={hand:false,draw:false,disc:false,rem:false}
function loc(){
  return {hand:!!(st.hand&&st.hand[1]&&st.hand[1].includes(79)),
          draw:!!(st.draw&&st.draw[1]&&st.draw[1].includes(79)),
          disc:!!(st.discard&&st.discard[1]&&st.discard[1].includes(79)),
          rem:!!(st.removed&&st.removed[1]&&st.removed[1].includes(79))}
}
while(st.active!=="None"&&a<max){
  const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
  const view=rules.view(st,role); const turn=Number(view.turn||0)
  const tojo=!!(st.events&&st.events[26])
  const L=loc()
  if(JSON.stringify(L)!==JSON.stringify(prev)){
    const where=Object.keys(L).filter(k=>L[k]).join("+")
    console.log(`T${turn} act${a} role=${role} AP79 -> ${where||"none"} | tojo=${tojo} | prompt=${String(view.prompt||"").slice(0,40)}`)
    prev=L
  }
  const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
  if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,view.prompt);break}
  st=rules.action(st,role,d.action,d.argument); a++
}
console.log("END turn",st.turn,"pw",st.political_will,"won",st.won_text||st.result)
