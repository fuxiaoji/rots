"use strict"
// Constructed public positions validate real strategy/action/replay, not wins.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module")
const {validateAction,stateDigest}=require("./match-run")
const FILE=path.resolve(__dirname,"../rules.js")
function load(){const m=new Module(FILE,module);m.filename=FILE;m.paths=Module._nodeModulePaths(path.dirname(FILE));
m._compile(fs.readFileSync(FILE,'utf8').replace('// END CAMPAIGN V2','exports.__v2Plan=ec_plan;\n// END CAMPAIGN V2')+`
exports.__goalFixture=state=>{
 G=state;R=AP;G.active=AP;G.location.fill(NOT_USED);G.control=null;G.oos=[];G.reduced=[];G.inter_service=[0,0];G.asp[AP]=[0,0];G.hand[AP]=[1];G.hand[JP]=[];G.undo=[];G.turn=7;G.pow=0;G.political_will=10;reset_offensive();
 G.L=L={P:"offensive_segment",L:{P:"goal_fixture_return"}};
 const port=hex_to_int(2719),enemy=hex_to_int(2620),rear=hex_to_int(3023);
 G.supply_cache[port]&=~JP_CONTROLLED;G.supply_cache[rear]&=~JP_CONTROLLED;G.supply_cache[enemy]|=JP_CONTROLLED;
 G.location[80]=port;G.location[HQ_JP_SOUTH]=enemy;
 const air=pieces.map((p,id)=>({...p,id})).filter(p=>p.faction===AP&&p.class==="air"&&!p.b29).sort((a,b)=>b.cf-a.cf).slice(0,2);
 const carrier=pieces.findIndex(p=>p.faction===AP&&p.class==="naval"&&p.br>0&&p.cf>=12);
 const ground=pieces.findIndex(p=>p.faction===AP&&p.class==="ground"&&p.type==="marine");
 for(const u of air)G.location[u.id]=port;G.location[carrier]=port;G.location[ground]=rear;G.location[52]=enemy;
 check_supply();_save();return {air:air.map(p=>p.id),carrier,ground,port,enemy,rear,lastBoard:LAST_BOARD_HEX};
};
exports.__islandFixture=state=>{
 G=state;R=JP;G.active=JP;const hq=G.location[5];G.location.fill(NOT_USED);G.control=null;G.oos=[];G.reduced=[];
 G.inter_service=[0,0];G.asp[JP]=[7,0];G.hand[JP]=[88];G.hand[AP]=[];G.undo=[];G.turn=5;G.pow=0;reset_offensive();
 G.L=L={P:"offensive_segment",L:{P:"goal_fixture_return"}};G.location[5]=hq;G.location[33]=TOKYO;
 G.supply_cache[hex_to_int(3709)]|=JP_CONTROLLED;check_supply();_save();return {ground:33,target:hex_to_int(3709),lastBoard:LAST_BOARD_HEX};
};
exports.__islandPlan=state=>{const view=exports.view(state,"Japan");G=state;L=G.L;R="Japan";_load();em_set_config(em_bot_config("erasmus-japan-campaign-v2","Japan"));try{return exports.__v2Plan(view,{role:"Japan"})}finally{em_reset_config();_save()}};
exports.__guardCheck=state=>{
 G=state;L=G.L;R="Japan";_load();
 try{return rules_query_snapshot(()=>{
  const hex=hex_to_int(3813),target=hex_to_int(2813),ids=pieces.map((p,id)=>({...p,id})).filter(p=>p.faction===JP&&p.class==="ground").sort((a,b)=>a.cf-b.cf||a.id-b.id).slice(0,2).map(p=>p.id);
  is_space_controlled(hex,JP);G.supply_cache[hex]|=JP_CONTROLLED;G.reduced=[];G.location.fill(NOT_USED);G.location[ids[0]]=hex;G.offensive.attacker=JP;
  em_set_config(em_bot_config("erasmus-japan-campaign-v2","Japan"));const single=eop_unit_matches_target(ids[0],"Japan",null,target);
  G.location[ids[1]]=hex;const surplus=eop_unit_matches_target(ids[1],"Japan",null,target);const reserve=eop_unit_matches_target(ids[0],"Japan",null,target);G.location[ids[1]]=NOT_USED;
  G.offensive.attacker=AP;const reacting=eop_unit_matches_target(ids[0],"Japan",null,target);
  em_set_config(em_bot_config("erasmus-v2-opt-v5","Japan"));const strict=eop_unit_matches_target(ids[0],"Japan",null,target);
  return {single,surplus,reserve,reacting,strict};
 },JP)}finally{em_reset_config();_save()}
};
exports.__goalPlan=state=>{const view=exports.view(state,"Allies");G=state;L=G.L;R="Allies";_load();em_set_config(em_bot_config("erasmus-campaign-v2","Allies"));try{return exports.__v2Plan(view,{role:"Allies"})}finally{em_reset_config();_save()}};
`,FILE);return m.exports}
const clone=x=>JSON.parse(JSON.stringify(x))
test("actual blockade air suppression, mixed ground move, battle and PBM complete and replay",{timeout:60000},()=>{
 const r=load();let s=r.setup(20261551,"1943-1945 (The Even Shorter Campaign)",{headless_moves:true});const f=r.__goalFixture(s),p=r.__goalPlan(s)
 assert.equal(p.tasks[0].objective,"BLOCKADE_CLEAR_AIR");assert.equal(p.tasks[0].movementUnitIds.length,0)
 assert(p.tasks.some(t=>t.kind==="REDEPLOY"&&t.movementUnitIds.includes(f.ground)))
 const initial=clone(s),actions=[];let declared=false,groundMoved=false,airEnteredEnemy=false,pbm=false
 for(let n=1;n<=180&&s.L?.P!=="goal_fixture_return";n++){
  const role=Array.isArray(s.active)?s.active[0]:s.active,v=r.view(s,role),before=JSON.stringify(s)
  const d=r.bots[role==="Allies"?"erasmus-campaign-v2":"erasmus-v2-opt-v5"].decide(v,{role,seed:20261551,actionOrdinal:n})
  assert.equal(JSON.stringify(s),before,"planning is read-only");validateAction(v,d);actions.push([role,d.action,clone(d.argument??null)])
  s=r.action(s,role,d.action,d.argument);declared ||= s.offensive?.battle_hexes?.includes(f.enemy)
  groundMoved ||= s.location[f.ground]===f.port;airEnteredEnemy ||= s.location[f.air[0]]===f.enemy
  pbm ||= /post_battle|pbm/.test(s.L?.P||"")
 }
 assert.equal(s.L.P,"goal_fixture_return");assert(declared);assert(groundMoved,"pure support first task must not cancel later transport")
 assert.equal(airEnteredEnemy,false,"remote support stays outside target");assert(s.location[52]>f.lastBoard,"actual battle eliminates enemy; projection alone never does")
 assert(s.log.some(l=>/Post battle movement/.test(l)) || pbm)
 let replay=initial;for(const [role,action,arg]of actions)replay=r.action(replay,role,action,arg??undefined)
 assert.equal(stateDigest(replay),stateDigest(s));assert(actions.length>15)
})

test("last island ground defender is preserved through chart fallback; strict bot and reaction remain unchanged",()=>{
 const r=load(),s=r.setup(20261553,"1943-1945 (The Even Shorter Campaign)",{headless_moves:true}),before=JSON.stringify(s)
 assert.deepEqual(r.__guardCheck(s),{single:false,surplus:true,reserve:false,reacting:true,strict:true});assert.equal(JSON.stringify(s),before)
})

test("friendly no-port Iwo garrison uses solo ASP, stays through full offensive and replays",{timeout:60000},()=>{
 const r=load();let s=r.setup(20261561,"1943-1945 (The Even Shorter Campaign)",{headless_moves:true});const f=r.__islandFixture(s),p=r.__islandPlan(s)
 assert.equal(p.tasks[0].hex,f.target);assert.deepEqual(p.tasks[0].movementUnitIds,[f.ground]);assert.equal(p.tasks[0].movementModes[0],"AA");assert.equal(p.tasks[0].aspCost,2)
 const initial=clone(s),actions=[];for(let n=1;n<=100&&s.L?.P!=="goal_fixture_return";n++){
  const role=s.active,v=r.view(s,role),before=JSON.stringify(s),d=r.bots[role==="Japan"?"erasmus-japan-campaign-v2":"erasmus-campaign-v2"].decide(v,{role,seed:20261561,actionOrdinal:n})
  assert.equal(JSON.stringify(s),before);validateAction(v,d);actions.push([role,d.action,clone(d.argument??null)]);s=r.action(s,role,d.action,d.argument)
 }
 assert.equal(s.L.P,"goal_fixture_return");assert.equal(s.location[f.ground],f.target);assert.equal(s.asp[0][1],2);assert(!s.oos.includes(f.ground))
 let replay=initial;for(const [role,action,arg]of actions)replay=r.action(replay,role,action,arg??undefined);assert.equal(stateDigest(replay),stateDigest(s))
})
