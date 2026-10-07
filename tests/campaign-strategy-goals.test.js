"use strict"
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm")
const {loadCampaignRules}=require("./campaign-rules.test")
const plain=x=>JSON.parse(JSON.stringify(x))
function fixture() {
 const board=[{id:1001,name:"Rear",port:true,airfield:true,region:"China"},
 ...[2909,3009,3209,3709,3813,3814].map(id=>({id,name:String(id),port:[2909,3209,3813].includes(id),airfield:true,island:true,region:"JMandates"}))]
 const owned=new Set(board.map(m=>m.id)),units=[{id:9,faction:0,class:"hq",location:1001,cm:2},
 {id:1,faction:0,class:"ground",cf:18,lf:18,stratMove:true,asp:1,location:1001,service:"navy"},
 {id:2,faction:0,class:"naval",cf:10,location:1001,service:"navy"},
 {id:3,faction:0,class:"ground",cf:4,lf:4,stratMove:true,location:3814,service:"navy"}]
 const view={active:"Japan",sid:8,turn:5,political_will:6,surrender:[2,2,2,2],oos:[],capture:[],
 asp:[[4,0],[4,0]],inter_service:[0,0],actions:{card:[1]},offensive:{active_units:[[],[]],active_hq:[],battle_hexes:[]},
 ai:{state:"offensive_segment",units,ownCards:[{id:1,ops:3,allowed:["ops"]}],victory:{homelandKeys:[]}}}
 const ctx={map:board,LAST_BOARD_HEX:5000,hex_to_int:x=>x,TOKYO:4000,SHORT_CAMPAIGN_SCENARIO:1,EVEN_SHORT_CAMPAIGN_SCENARIO:8,
 AMPH_MOVE:8,STRAT_MOVE:1,GROUND_MOVE:4,NAVAL_MOVE:2,EC:1,
 nations:{PHILIPPINES:{id:0,keys:[2813,2915],pw:1},MALAYA:{id:1,keys:[2014,2015],pw:1},DEI:{id:2,keys:[2019,1813],pw:1},BURMA:{id:3,keys:[2008,2106],pw:1}},
 em_cfg:()=>({japan_campaign_planner:1,campaign_planner:1}),em_flag:()=>true,get_distance:(a,b)=>Math.ceil(Math.abs(a-b)/100),get_map_data:h=>board.find(m=>m.id===h),
 querySpaceControlled:(h,f)=>f===0?owned.has(h):!owned.has(h),queryAspRemaining:()=>4,queryProjectedStack:()=>({fitsForIncoming:true}),
 queryCardPreview:()=>({eligible:true,activationBudget:3,units:[1,2,3]}),queryReactionCandidates:()=>({air:[],naval:[],carrier:[]}),
 queryGroupMovementDestinations:(ids,c)=>({reachableHexes:c.move_type===1&&ids[0]===1?[3813]:c.move_type===8&&ids.includes(1)&&ids.includes(2)?[3709]:[],aspCost:1}),
 eop_axis:()=>null,eop_set_strategy_chain:()=>{}}
 vm.createContext(ctx);for(const p of ["erasmus_campaign.js","erasmus_japan_campaign.js"])vm.runInContext(fs.readFileSync(__dirname+"/../js/server/bots/"+p,"utf8"),ctx)
 return {ctx,view,owned,units,board}
}
test("1943 campaign plans legal Pacific garrisons, retains sole troops, excludes enemy bases",()=>{
 const {ctx,view,owned}=fixture(),before=JSON.stringify(view),p=ctx.ec_apply_plan(view,{role:"Japan"})
 assert.equal(JSON.stringify(view),before);assert(p);assert(p.tasks.some(t=>t.objective==="PACIFIC_ISLAND_GARRISON"));assert(p.garrisonReserveIds.includes(3))
 assert(p.tasks.every(t=>!t.requiredUnits.includes(3)));assert(!p.tasks.some(t=>t.objective==="SOUTHERN_CONQUEST"))
 const d=ctx.ej_defense_tasks({view,faction:0,board:ctx.ec_map(),byHex:new Map(ctx.ec_map().map(m=>[m.hex,m])),units:view.ai.units,available:view.ai.units,hq:{id:9},budget:3,cardId:1,moves:new Map(),garrisonReserve:new Set([3])},ctx.ej_island_defense(view,ctx.ec_map(),view.ai.units))
 assert(d.some(t=>t.hex===3709&&t.movementModes[0]==="AA"&&t.escortUnitIds.includes(2)),"queried group fallback is preserved when solo authority returns no route")
 owned.delete(3813);const next=ctx.ec_plan(view,{role:"Japan"});assert(!next.tasks.some(t=>t.kind==="REDEPLOY"&&t.hex===3813))
})
test("missing final national key beats ordinary target; full keys await actual status",()=>{
 const {ctx,view,owned}=fixture();owned.add(2915);owned.delete(2813)
 const goals=ctx.ec_national_goals(view,1),ph=goals.find(n=>n.name==="PHILIPPINES")
 assert.deepEqual(plain(ph.missingKeys),[2915]);assert(ctx.ec_national_bonus(2915,goals)>200);assert.equal(ctx.ec_national_bonus(3813,goals),0)
 owned.delete(2915);assert.equal(ctx.ec_national_goals(view,1)[0].status,"await-national-status")
 view.surrender[0]=0;assert.equal(ctx.ec_national_bonus(2915,ctx.ec_national_goals(view,1)),0)
})
test("suppression remains pending with remote-only support and never claims a failed clearance",()=>{
 const {ctx,view}=fixture();view.ai.units.push({id:44,faction:0,class:"air",location:2909})
 const task={kind:"SUPPRESS",hex:2909,movementUnitIds:[],targetClasses:["air"]}
 assert.equal(ctx.ec_task_complete(task,view,1),false)
 view.ai.units=view.ai.units.filter(u=>u.id!==44);assert.equal(ctx.ec_task_complete(task,view,1),true)
})
test("screen ranking rejects reopened resources and unrelated sea coverage",()=>{
 const {ctx}=fixture(),b={connectedResources:[1],pureSeaHexes:[],reachableSeaHexes:[100],ownOosIds:[]},env={victory:{blockade:{resources:[{hex:100,japanControlled:true}]}}}
 assert.equal(ctx.ec_screen_gain(b,{...b,connectedResources:[1,2],pureSeaHexes:[100]},env),null)
 assert.equal(ctx.ec_screen_gain(b,{...b,pureSeaHexes:[3000]},env),null)
 assert(ctx.ec_screen_gain(b,{...b,pureSeaHexes:[100]},env).score>0)
 assert(ctx.ec_screen_gain(b,{...b,connectedResources:[]},env).score>300)
})
test("actual air projection restores all state, uses real sea graph, accounts neutralizing aircraft",()=>{
 const {rules:r,api,constants:C}=loadCampaignRules(),s=r.setup(20261501,C.scenario1943,{})
 const ask=options=>{const before=JSON.stringify(s),p=r.query(s,"Allies",{name:"rules_query",fn:"queryCampaignAirProjection",args:[options]});assert.equal(JSON.stringify(s),before);return plain(p)}
 const b=ask({}),clear=ask({removeAirIds:[49]});assert(b.reachableSeaHexes.length>0);assert(clear.pureSeaHexes.length>b.pureSeaHexes.length);assert.equal(clear.connectedResources.length,b.connectedResources.length,"local purity is not complete blockade")
 const secrets=JSON.stringify(s.hand);s.hand[0]=[];assert.deepEqual(ask({}),b);s.hand=JSON.parse(secrets)
 assert.equal(ask({moves:[{unit:49,hex:api.hex(3023)}]}).eligible,false,"cannot relocate enemy")
 assert.equal(ask({removeAirIds:[100]}).eligible,false,"cannot remove friendly aircraft")
 const air=s.location[100];s.location[100]=api.hex(3627);const deployed=ask({moves:[{unit:100,hex:api.hex(3023)}]});assert(deployed.eligible);assert(!deployed.ownOosIds.includes(100));s.location[100]=air
 const lrb=s.location[101];s.location[101]=s.location[49];const overlap=ask({removeAirIds:[49]});assert(overlap.pureSeaHexes.length>0);s.location[101]=lrb
})

test("two executable targets select the last national key over an ordinary empty town",()=>{
 const {ctx,view}=fixture();ctx.map=[{id:2813,name:"Manila",port:true,airfield:true,region:"Philippines"},
 {id:2915,name:"Davao",named:true,port:true,airfield:true,region:"Philippines"},
 {id:2914,name:"Ordinary",named:true,port:true,airfield:true,region:"Philippines"}]
 ctx.querySpaceControlled=(h,f)=>f===1?h===2813:h!==2813
 view.active="Allies";view.pow=0;view.ai.victory={homelandKeys:[]};view.ai.units=[
 {id:9,faction:1,class:"hq",location:2813,cm:2},
 {id:1,faction:1,class:"ground",location:2813,cf:12,lf:12,asp:1,stratMove:true,service:"navy"},
 {id:2,faction:1,class:"naval",location:2813,cf:12,service:"navy"}]
 ctx.queryGroupMovementDestinations=(ids,c)=>({reachableHexes:c.move_type===8&&ids.includes(1)&&ids.includes(2)?[2914,2915]:[],aspCost:1})
 const p=ctx.ec_plan(view,{role:"Allies"});assert.equal(p.tasks[0].hex,2915);assert.equal(p.tasks[0].objective,"NATIONAL_LIBERATION")
})
test("steady-state projection is invariant to temporary strategic-move suppression",()=>{
 const {rules:r,constants:C}=loadCampaignRules(),s=r.setup(20261552,C.scenario1943,{})
 const ask=()=>r.query(s,"Allies",{name:"rules_query",fn:"queryCampaignAirProjection",args:[{}]}),b=plain(ask())
 s.active_stack=[100];s.L.move_type=1;assert.deepEqual(plain(ask()),b);assert.deepEqual(s.active_stack,[100]);assert.equal(s.L.move_type,1)
 assert.equal(r.query(s,"Allies",{name:"rules_query",fn:"queryCampaignAirProjection",args:[{faction:0}]}).eligible,false)
})

test("air placement projection has a local seven-query ceiling and a reused baseline",()=>{
 const {ctx}=fixture(),bases=Array.from({length:20},(_,i)=>({hex:100+i,port:true,airfield:true,region:"Pacific"})),position={version:1,role:"Allies",turn:7,bases,units:[],focus:100,blockade:{resources:[{hex:100,japanControlled:true}]}}
 let calls=0;ctx.queryCampaignAirProjection=o=>{calls++;return {eligible:true,connectedResources:[100],pureSeaHexes:[],reachableSeaHexes:[100],ownOosIds:[]}}
 ctx.querySpaceControlled=()=>true;const piece={id:1,class:"air",faction:1,br:2},scope=ctx.ec_position_projection_scope(position,piece,100,bases.map(b=>b.hex))
 for(const b of bases)ctx.ec_position_score(b.hex,1,piece,100,position,scope)
 assert.equal(calls,7);assert.equal(scope.cache.size,7);assert.equal(scope.allowed.size,6)
})
