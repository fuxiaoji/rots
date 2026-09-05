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
  const ap79inHand=!!(st.hand&&st.hand[1]&&st.hand[1].includes(79))
  const tojo=!!(st.events&&st.events[26])
  const isCardWin=/select card to play/i.test(String(view.prompt||""))
  if(role==="Allies"&&ap79inHand&&isCardWin){
    const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
    const via=d.privateTrace?.via||d.publicTrace?.via||""
    const sm=d.privateTrace?.sm||d.publicTrace?.sm
    console.log(`T${view.turn} cardWin AP79 in hand | hand=${JSON.stringify(view.actions.card)} | action=${d.action} arg=${JSON.stringify(d.argument)} | via=${via} | strat=${sm&&sm.name}`)
  }
  const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
  if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,view.prompt);break}
  st=rules.action(st,role,d.action,d.argument); a++
}
console.log("END turn",st.turn,"pw",st.political_will,"won",st.won_text||st.result)
