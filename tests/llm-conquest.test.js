"use strict"
const test=require("node:test"),assert=require("node:assert/strict"),rules=require("../rules"),{observe,visible,hash}=require("../js/server/llm/observation"),{messagesFor}=require("../js/server/llm/prompt")
const scenario="1942-1945 (The Shortened Campaign)"
test("national goal facts match public surrender and exact map keys without reading enemy secrets or changing state",()=>{
 const s=rules.setup(20262601,scenario,{headless_moves:true}),before=hash(s),o=visible(rules,s,"Japan").observation
 assert.equal(hash(s),before)
 assert.deepEqual(o.scenario.nations.map(n=>n.keys.map(h=>h.mapId)),[[2813,2915],[2014,2015],[2019,1813,1916,2017,2415,2616,2517,2220],[2008,2106,2206,2305]])
 for(const n of o.scenario.nations){assert.equal(n.surrenderedTurn,s.surrender[n.id]);assert.equal(n.allJapanControlled,n.keys.every(h=>h.control==="Japan"));assert.equal(n.engineReady,n.remainingKeys.length===0)}
 const altered=JSON.parse(JSON.stringify(s));altered.hand[1]=[1,2,3];altered.seed=987
 assert.deepEqual(visible(rules,altered,"Japan").observation.scenario.nations,o.scenario.nations)
})
test("campaign input labels compact source references and keeps every country key and unit location",()=>{
 const s=rules.setup(20262602,scenario,{headless_moves:true}),p=observe(rules,s,"Japan",0),m=messagesFor(p,null,"x"),o=JSON.parse(m.messages[1].content)
 assert(o.campaignContract.goal.includes("BURMA"));assert(o.rules.some(s=>s.file.includes("campaign-guide")&&s.excerpt))
 assert(o.rules.filter(s=>s.file.includes("normalized/")).every(s=>!s.excerpt&&s.coverage.includes("reference-only")))
 const sent=new Set(o.observation.hexes.map(h=>h[0]));for(const n of p.observation.scenario.nations)for(const h of n.keys)assert(sent.has(h.hex))
 for(const u of p.observation.units)if(p.observation.hexes.some(h=>h.hex===u.location))assert(sent.has(u.location))
 const reduced=p.observation.units.find(u=>u.id===36);assert(reduced.reduced);assert.equal(reduced.cf,18);assert.equal(reduced.currentCF,9);assert.equal(reduced.aspCost,2);assert.equal(reduced.currentBaseASP,1)
 assert(o.observation.unitColumns.includes("currentCF"));assert(o.observation.unitColumns.includes("currentBaseASP"));assert.deepEqual(o.outputGuide.unchangedMemory,{})
})
test("direct-only candidate table cannot delegate movement to the headless program",()=>{
 const fake={view:()=>({actions:{advance:1,done:1},ai:{state:"move_offensive_units"}}),query:()=>({cards:[],hexes:[]})}
 const ordinary=observe(fake,{active:"Japan"},"Japan",1),direct=observe(fake,{active:"Japan"},"Japan",1,{directOnly:true})
 assert(ordinary.candidates.some(c=>c.action==="advance"));assert(!direct.candidates.some(c=>c.action==="advance"));assert.deepEqual(direct.candidates.map(c=>c.action),["done"])
})
test("editable model memory omits program-owned fields while exact execution history remains readonly",async()=>{
 const api=require("../js/server/llm/session"),session=api.createSession({seed:20262602,scenario,players:{Japan:"llm:deepseek",Allies:"erasmus-campaign"}},{clients:{deepseek:{}}})
 for(let i=0;session.state.active==="Allies"&&i<32;i++)await api.step(session,{revision:session.revision})
 assert.equal(session.state.active,"Japan");assert.equal(session.stats.requests,0)
 const p=observe(session.rules,session.state,"Japan",session.revision),memory={schemaVersion:2,objective:"征服",notes:[],turnPlan:{turn:2,objectives:["目标"],constraints:[]},offensive:{scope:{instance:"old"},objective:"任务",tasks:[]},recent:[{revision:1,action:"unit",effect:{kind:"activate",unitId:34,unit:{id:34,cf:12}},after:{activationRemaining:5}}]}
 const data=JSON.parse(messagesFor(p,memory,"x").messages[1].content)
 assert(!Object.hasOwn(data.memory,"schemaVersion"));assert(!Object.hasOwn(data.memory,"recent"));assert(!Object.hasOwn(data.memory.turnPlan,"turn"));assert(!Object.hasOwn(data.memory.offensive,"scope"))
 assert(data.programMemory.readonly);assert.equal(data.programMemory.recent[0].after.activationRemaining,5);assert.equal(data.programMemory.recent[0].effect.unitId,34)
 const columns=data.observation.cardPreviewColumns
 assert(p.observation.cardPreviews.length>0);assert(data.observation.cardPreviewUnitSets.length<p.observation.cardPreviews.length)
 for(let i=0;i<p.observation.cardPreviews.length;i++){
   const restored=Object.fromEntries(columns.map((k,j)=>[k,data.observation.cardPreviews[i][j]])),original=p.observation.cardPreviews[i]
   assert.deepEqual(data.observation.cardPreviewUnitSets[restored.unitSetIndex],original.units)
   for(const [k,v]of Object.entries(original))if(k!=="units")assert.deepEqual(restored[k],v)
 }
})
test("conquest acceptance needs four formal surrenders and the specified campaign opponent",()=>{
 const {goal}=require("../tools/llm-goal-run"),nations=[0,1,2,3].map(id=>({id,key:String(id),surrenderedTurn:4,allJapanControlled:true,remainingKeys:[]}))
 const s={options:{scenario,players:{Japan:"llm:deepseek",Allies:"erasmus-campaign"}},state:{active:"Japan"},rules:{view:()=>({ai:{units:[]}}),query:()=>({cards:[],hexes:[],scenario:{nations}})}}
 assert(goal(s).achieved)
 s.options.players.Allies="erasmus-v2-opt-v5";assert(!goal(s).achieved)
 s.options.players.Allies="erasmus-campaign";nations[3].surrenderedTurn=0;assert(!goal(s).achieved)
 nations[3].surrenderedTurn=4;nations[3].allJapanControlled=false;assert(!goal(s).achieved)
})

test("task facts bind public defenders, conditional routes and separate HQ reaction budgets without secrets or mutation",async()=>{
 const api=require("../js/server/llm/session"),session=api.createSession({seed:20262602,scenario,players:{Japan:"llm:deepseek",Allies:"erasmus-campaign"}},{clients:{deepseek:{}}})
 while(session.state.active==="Allies")await api.step(session,{revision:session.revision})
 for(const [action,argument]of [["card",100],["ops",null],["unit",7]])session.state=session.rules.action(session.state,"Japan",action,argument)
 const memory={offensive:{tasks:[{targetHex:304,ground:[43],escort:[],support:[48]},{targetHex:298,ground:[35],escort:[],support:[]},{targetHex:452,ground:[36],escort:[18],support:[]}]}}
 const before=hash(session.state),o=observe(session.rules,session.state,"Japan",15,{memory}).observation
 assert.equal(hash(session.state),before)
 assert.deepEqual(o.taskFacts.binding,{revision:15,cardId:100,mode:"ops",hqId:7})
 const kuantan=o.taskFacts.planned[0]
 assert.deepEqual(kuantan.groups[0].groundRoute.pathToTarget,[4,4,274,304]);assert(!Object.hasOwn(kuantan.groups[0].groundRoute,"aspCost"))
 assert.equal(o.taskFacts.defenders.find(d=>d.hex===304).ground.cf,9)
 assert(kuantan.publicReaction.hqOptions.some(h=>h.hq===83&&h.unitIds.includes(167)&&h.budget===4))
 assert(kuantan.publicReactionBaseline.nonAmphibious.unknownReasons.includes("enemy-intelligence-and-counter-cards-unobserved"));assert(kuantan.publicReactionBaseline.amphibious.eligible)
 assert(o.taskFacts.landCaptureCoverage.units.some(u=>u.id===43&&u.reachableKeys.includes(304)))
 const samePort=o.taskFacts.planned[2].groups[0];assert.deepEqual(samePort.colocatedEscorts,[]);assert.deepEqual(samePort.otherOriginEscortIds,[18]);assert.deepEqual(o.taskFacts.planned[2].unassignedEscortIds,[18])
 assert(!Object.hasOwn(kuantan.airRange[0].range,"legal"));assert.equal(typeof kuantan.airRange[0].range.withinRange,"boolean")
 assert.deepEqual(kuantan.groundArithmetic.hitsByMultiplier,[[0.5,9],[1,18],[1.5,27],[2,36]]);assert.deepEqual(kuantan.groundArithmetic.defenderLFs,[9])
 const colocated={offensive:{tasks:[{targetHex:452,ground:[36],escort:[20],support:[]}]}}
 assert.deepEqual(observe(session.rules,session.state,"Japan",15,{memory:colocated}).observation.taskFacts.planned[0].groups[0].colocatedEscorts,[20])
 const hidden=JSON.parse(JSON.stringify(session.state));hidden.hand[1]=[1,2,3];hidden.future_offensive[1]=19;hidden.seed=54321;hidden.draw[1]=[4,5,6]
 assert.deepEqual(observe(session.rules,hidden,"Japan",15,{memory}).observation.taskFacts,o.taskFacts)
 const unknown=JSON.parse(JSON.stringify(o));unknown.currentDecision.currentCard.selectedMode="event";unknown.currentDecision.currentCard.id=141;unknown.cardPreviews=[]
 const {taskFacts}=require("../js/server/llm/observation"),unavailable=taskFacts(session.rules,session.state,unknown,memory)
 assert.equal(unavailable.landCaptureCoverage.checked,false)
})

test("task facts survive exact save restoration with the model's own complete task memory",async()=>{
 const api=require("../js/server/llm/session"),actions=[["card",100],["ops",undefined],["unit",7]]
 const client={complete:async messages=>{
   const p=JSON.parse(messages[1].content),[action,argument]=actions.shift(),c=p.candidates.find(c=>c.action===action&&c.argument===argument)
   assert(c)
   return {content:JSON.stringify({candidateId:c.id,reason:"测试候选",memory:{offensive:{objective:"检查关丹任务",cardId:100,mode:"ops",hqId:7,tasks:[{targetHex:304,intent:"capture",ground:[43],escort:[],support:[48],stage:"planned",nextStep:"合法陆进"}],stopOrReplan:[]}}}),model:"mock",usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}
 }}
 const s=api.createSession({seed:20262602,scenario,directOnly:true,players:{Japan:"llm:deepseek",Allies:"erasmus-campaign"}},{clients:{deepseek:client}})
 while(s.state.active==="Allies")await api.step(s,{revision:s.revision})
 for(let i=0;i<3;i++)await api.step(s,{revision:s.revision})
 const before=api.packet(s,"Japan"),restored=api.restoreSession(api.serializeSession(s),{clients:{deepseek:{}}}),after=api.packet(restored,"Japan")
 assert.deepEqual(after.observation.taskFacts,before.observation.taskFacts);assert.deepEqual(restored.memories.Japan,s.memories.Japan)
 assert(api.verifyReplay(api.replay(restored)).verified);assert.equal(restored.stats.requests,3)
})

test("advanced movement exposes an otherwise missing amphibious target; origin-only records are not movement",async()=>{
 const api=require("../js/server/llm/session"),s=api.createSession({seed:20262602,scenario,players:{Japan:"llm:deepseek",Allies:"erasmus-campaign"}},{clients:{deepseek:{}}})
 while(s.state.active==="Allies")await api.step(s,{revision:s.revision})
 // Synthetic public formation reproduces the actual revision-200 menu issue.
 s.state.location[28]=479;s.state.location[43]=421
 const apply=(a,b)=>{const view=s.rules.view(s.state,"Japan");assert(view.actions[a]);if(Array.isArray(view.actions[a]))assert(view.actions[a].includes(b));s.state=s.rules.action(s.state,"Japan",a,b)}
 for(const[a,b]of[["card",102],["ops",null],["unit",7],["unit",28],["unit",43],["done",null],["unit",28]])apply(a,b)
 const packet=()=>observe(s.rules,s.state,"Japan",30,{directOnly:true}),before=packet(),location=s.state.location[28]
 assert(before.candidates.some(c=>c.action==="advanced_move"));assert(!before.candidates.some(c=>c.effect?.targetHex===480));assert.equal(before.observation.currentDecision.moveMode,0)
 assert(before.observation.currentDecision.ownMovementRecordUnitIds.includes(28));assert(!before.observation.currentDecision.movedUnitIds.includes(28))
 apply("advanced_move",null);assert.equal(s.state.location[28],location);assert(packet().candidates.some(c=>c.action==="amphibious"))
 apply("amphibious",null);assert.equal(s.state.location[28],location)
 const p=packet(),move=p.candidates.find(c=>c.action==="move"&&c.effect.targetHex===480);assert(move);assert.equal(p.observation.currentDecision.moveMode,8)
 s.state=s.rules.action(s.state,"Japan","move",move.argument);assert.equal(s.state.location[28],480);assert(packet().observation.currentDecision.movedUnitIds.includes(28))
 apply("unit",43);apply("no_move",null);assert(!packet().observation.currentDecision.movedUnitIds.includes(43))
 const publicView=s.rules.view(s.state,"Japan"),fake={view:()=>({...publicView,ai:{...publicView.ai,state:"post_battle_movement",windowKind:"pbm"},actions:{unit:[28]},offensive:{...publicView.offensive,paths:[28,[8,2,479,508,480],167,[4,1,305,304]]}}),query:(...args)=>s.rules.query(...args)},pbm=observe(fake,s.state,"Japan",31,{directOnly:true})
 assert.deepEqual(pbm.observation.currentDecision.movedUnitIds,[28]);assert(pbm.candidates.some(c=>c.action==="unit"&&c.argument===28))
 assert(messagesFor(pbm,null,"pbm").messages[0].content.includes("禁止PBM"))
})
