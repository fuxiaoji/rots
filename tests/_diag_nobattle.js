"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
function play(seed){
  let st=rules.setup(seed,scenario,{headless_moves:process.env.EOTS_HEADLESS_MOVES==="1"})
  let a=0,max=60000
  while(st.active!=="None"&&a<max){
    const role=activeRole(st); if(role!=="Japan"&&role!=="Allies")break
    const view=rules.view(st,role)
    const d=policy.decide(view,{role,seed,actionOrdinal:a+1})
    if(!view.actions||!(d.action in view.actions)){console.log("ILLEGAL",d.action,view.prompt);break}
    st=rules.action(st,role,d.action,d.argument); a++
  }
  let reach=0,exhausted=0
  for(const line of st.log||[]){
    if(/No battle hexes declared/.test(line)){
      if(/no active unit can reach/.test(line))reach++
      else if(/exhausted/.test(line))exhausted++
    }
  }
  return {reach,exhausted,turn:st.turn,won:st.result&&st.result.won_side,pw:st.political_will,pow:st.pow}
}
for(let i=0;i<4;i++){const seed=20260903+i;console.log(JSON.stringify({seed,...play(seed)}))}
