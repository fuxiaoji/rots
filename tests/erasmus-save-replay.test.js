"use strict"
const assert=require("assert"),rules=require("../rules.js"),bot=rules.bots["erasmus-v2"]
const seed=20260903,scenario="1942-1945 (The Shortened Campaign)"
function roleOf(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
function advance(state,start,count,record){let ordinal=start;for(let i=0;i<count&&state.active!=="None";i++){
 const role=roleOf(state),view=rules.view(state,role),d=bot.decide(view,{role,seed,actionOrdinal:++ordinal})
 assert(d.publicTrace.nodePath?.length,"trace path required");assert(d.action in view.actions,"legal action required")
 if(record)record.push([role,d.action,d.argument,d.publicTrace.chart,d.publicTrace.node])
 state=rules.action(state,role,d.action,d.argument)
 }return {state,ordinal}}
let first=advance(rules.setup(seed,scenario,{headless_moves:true}),0,300),saved=JSON.stringify(first.state)
const actions=[],runA=advance(JSON.parse(saved),first.ordinal,250,actions)
let replay=JSON.parse(saved)
for(const [role,action,argument] of actions){const view=rules.view(replay,role);assert(action in view.actions,`replay legal ${action}`);replay=rules.action(replay,role,action,argument)}
assert.equal(JSON.stringify(runA.state),JSON.stringify(replay),"save/restore replay state")
console.log(`Erasmus save/restore action replay passed (${actions.length} actions)`)
