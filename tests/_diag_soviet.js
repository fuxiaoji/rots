"use strict"
const rules=require("../rules.js")
const policy=rules.bots["erasmus-v2"]
const scenario="1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
for(let seed=20260903; seed<20260903+20; seed++){
  let st=rules.setup(seed,scenario,{headless_moves:true})
  let a=0,max=60000, sawSovietHand=false, sawSovietPlayed=false, sawTojoActive=false, lastTurn=0, pw=null
  while(st.active!=="None"&&a<max){
    const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
    const view=rules.view(st,role); lastTurn=Number(view.turn||0)
    if(st.removed&&st.removed[1]&&st.removed[1].includes(79)) sawSovietPlayed=true
    if(st.hand&&st.hand[1]&&st.hand[1].includes(79)) sawSovietHand=true
    if(st.events&&st.events[26]) sawTojoActive=true
    const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
    if(!view.actions||!(d.action in view.actions))break
    st=rules.action(st,role,d.action,d.argument); a++
  }
  pw=st.political_will
  console.log(`seed ${seed} turn=${lastTurn} pw=${pw} sovHand=${sawSovietHand} sovPlayed=${sawSovietPlayed} tojo=${sawTojoActive} won=${st.won_text||st.result||""}`)
}
