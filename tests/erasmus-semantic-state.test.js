"use strict"
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path')
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/erasmus/map_names.json'),'utf8'))
const entries=Object.entries(data.hexes).map(([h,m])=>[+h,m])
const md=new Map(entries), names=new Map(entries.filter(([,m])=>m.name).map(([h,m])=>[m.name.toLowerCase(),h]))
const idx=n=>names.get(n.toLowerCase())??null
const pieces=[null], owners=new Map(),location=[0]
const add=(id,cl,service,loc,faction=1,extra={})=>{let u=pieces.length;pieces.push({id,class:cl,service,faction,...extra});location[u]=loc;return u}
const P=add('army_ap_p','ground','army',5),R=add('army_ap_r','ground','army',5),SL=add('army_ap_sl','ground','army',5),FEAF=add('air_ap_feaf','air','army',5),LRB=add('air_ap_19_lrb','air','army',5)
const hq=add('hq','hq','army',1,1,{cr:12}),abda=add('abda','hq','br',idx('Kendari'),1,{cr:12})
const s={JP:0,AP:1,LAST_BOARD_HEX:1500,HQ_SOUTH_WEST:hq,HQ_ABDA:abda,pieces,
 G:{sid:1,location,reduced:[],oos:[],supply_cache:Array(1501).fill(0),inter_service:[0,0]},
 find_piece:id=>pieces.findIndex(p=>p&&p.id===id),eop_resolve_token:idx,get_map_data:h=>md.get(h),
 is_space_controlled:(h,f)=>owners.get(h)===f,set_has:(a,u)=>a.includes(u),get_distance:(a,b)=>Math.abs(a-b),
 HEX_TEMP_FLAG3:8,mark_activation_zone:()=>{s.G.supply_cache.fill(0);s.G.supply_cache[idx('Davao')]=8},
 erasmus_hash:()=>5}
vm.createContext(s);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/server/erasmus_state.js'),'utf8')+`;this.api={parse:esm_parse_entry,entry:esm_strategy_entry,targets:esm_semantic_targets,meta:esm_goal_target_meta,redeploy:esm_redeploy_targets,orange:esm_orange_targets,china:esm_china_ready,mid:esm_al_eval_mid,card:esm_semantic_card_pick};`,s)
const a=s.api,plain=v=>JSON.parse(JSON.stringify(v))
let t=a.redeploy('撤离菲律宾')
assert.equal(t.length,4);assert.deepEqual(plain(t.find(x=>x.hex===idx('Manila')).requiredUnits),[SL,FEAF]);assert.deepEqual(plain(t.find(x=>x.hex===idx('Biak')).requiredUnits),[P])
location[P]=9999;t=a.redeploy('撤离菲律宾');assert(!t.some(x=>x.requiredUnits.includes(P)),'offboard specified counter never replaced by unrelated ground unit');location[P]=5
let goals=a.parse(a.entry('Japan','mid','印度战略'),'Japan','mid')
let forts=goals.find(g=>/加强港口/.test(g.text));assert.equal(forts.kind,'GARRISON');assert.equal(forts.hexes.length,16);assert.deepEqual(plain(forts.meta.garrisonRequirement),{groundSteps:1,airSteps:1,operator:'OR'});assert.equal(forts.meta.preferredClass,'air')
let counter=a.parse(a.entry('Allies','mid','反攻战略'),'Allies','mid')
for(const n of ['Dacca','Port Moresby','Gili-Gili']) assert.deepEqual(plain(counter.find(g=>g.text.includes(n)).meta.movementModes),['GROUND'])
assert.deepEqual(plain(counter.find(g=>g.text.includes('New Hebrides')).meta.movementModes),['AA'])
assert.deepEqual(plain(counter.find(g=>g.text.includes('Noumea')).meta.movementModes),['AA','GROUND'])
assert.equal(counter.at(-1).kind,'STRATEGY_ROLL')
const returnGoals=a.parse(a.entry('Allies','late','重返菲律宾'),'Allies','late');assert.equal(returnGoals[0].kind,'DYNAMIC_BASE');assert.equal(returnGoals[0].hexes.length,0)
const originalDistance=s.get_distance;s.get_distance=(x,y)=>x===idx('Davao')&&y===idx('Leyte')?4:20
let bases=a.targets('Allies','late','重返菲律宾',a.meta(returnGoals));assert.equal(bases[0].hex,idx('Davao'));assert.equal(bases[0].dynamicBase,true);assert.equal(s.G.supply_cache.some(Boolean),false,'command path query restores mutable cache')
s.get_distance=originalDistance
let hop=a.targets('Allies','late','跳岛作战',[{hex:1},{hex:2}]);assert(hop.every(t=>t.strictSequential));assert.deepEqual(plain(hop.map(t=>t.targetGroup)),[1,2])
owners.set(idx('Kendari'),1);assert.equal(a.targets('Allies','early','DEI防御',[])[0].hex,idx('Kendari'));location[abda]=idx('Manila');owners.set(idx('Manila'),1);assert.equal(a.targets('Allies','early','DEI防御',[])[0].hex,idx('Manila'))
const corps=add('test_corps','ground','army',10,1,{size:3}),carrier=add('test_cv','naval','navy',10,1,{br:3});s.get_distance=()=>12
owners.set(idx('Leyte'),1);assert(a.orange()[0].escortPairs.some(p=>p.ground===corps&&p.carrier===carrier));location[carrier]=11;assert.equal(a.orange().length,0);location[carrier]=10
owners.set(idx('Leyte'),0);assert.equal(a.orange()[0].hex,idx('Manila'));s.get_distance=()=>16;assert.equal(a.orange().length,0)
let chinaStrategy={role:'Japan',goals:[{hexes:[10]},{hexes:[20],meta:{followupActions:['china_offensive','china_event']}}]};owners.set(20,0);assert.equal(a.china(chinaStrategy),false);owners.set(10,0);assert.equal(a.china(chinaStrategy),true)
s.classifyCards=()=>[{id:1,ops:2,opsPlayable:true},{id:2,ops:3,eventPlayable:true}];s.cards=[null,{}, {china:true}];s.get_allowed_actions=id=>id===1?['china_offensive']:['event'];assert.equal(a.card(chinaStrategy,[1,2]).argument,1);assert.equal(chinaStrategy.cardIntent,'china_offensive');s.get_allowed_actions=()=>['event'];assert.equal(a.card(chinaStrategy,[1,2]).argument,2)
let ctx={can_pass:false,cards_in_hand:2,al_M_B_needs_war_progress:true,al_M_D_jp_controls_counterattack_target:false};assert.equal(a.mid(ctx,8),'DEI战略');assert(ctx._nodePath.includes('AP08-CARD-GROUP'))
ctx={...ctx,al_M_B_needs_war_progress:false};assert.equal(a.mid(ctx,8),'事件战略')
console.log('erasmus-semantic-state: typed deployment, actual HQ path, OR garrisons, movement modes, serial order, escorted SR, China actions and AP08 branches passed')
