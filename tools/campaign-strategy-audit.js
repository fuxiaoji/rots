"use strict"
// Read-only public-board metrics during the existing legal/full-state verifier.
// Usage: node tools/campaign-strategy-audit.js replay.json bundle.js output.json
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),crypto=require("node:crypto")
const ROOT=path.resolve(__dirname,".."),runner=path.join(ROOT,"tests/match-run.js"),sha=x=>crypto.createHash("sha256").update(x).digest("hex")
const [input,bundle,output]=process.argv.slice(2);if(!input||!bundle||!output)throw Error("replay bundle output required")
const source=fs.readFileSync(runner,"utf8"),needle="state = b.rules.action(state, role, action, argument)"
if(source.split(needle).length!==2)throw Error("verifier hook drift")
const instrumented=source.replace(needle,'const publicBefore={locations:state.location.slice(),turn:state.turn,phase:state.L?.P,attacker:state.offensive?.attacker,surrender:state.surrender.slice(),battleHexes:(state.offensive?.battle_hexes || []).slice()}; '+needle+'; options.auditStep?.(state,{publicBefore,role,action,argument,b,ordinal:index+1});')
const m=new Module(runner,module);m.filename=runner;m.paths=Module._nodeModulePaths(path.dirname(runner));m._compile(instrumented,runner)
const replay=JSON.parse(fs.readFileSync(input)),{api,constants:C}=require("../tests/campaign-rules.test").loadCampaignRules()
const ring=[2909,3009,3209,3709,3813,3814].map(api.hex),metrics={garrisonArrivals:[],airScreenMoves:[],suppressionDeclarations:[],liberations:[],turnSamples:[]}
const verification=m.exports.verifyReplay(replay,{bundlePaths:{Japan:bundle,Allies:bundle},auditStep(state,{publicBefore:p,role,argument,b,ordinal}){
 const units=b.rules.pieces,plan=argument?.__ai?.plan || state.ai_plan?.[role]
 for(const task of plan?.tasks || []){
  if(task.objective==="PACIFIC_ISLAND_GARRISON" && p.attacker===C.JP && /move/.test(p.phase || ""))
   for(const id of task.movementUnitIds)if(units[id]?.class==="ground" && p.locations[id]!==task.hex && state.location[id]===task.hex)
    metrics.garrisonArrivals.push({ordinal,turn:state.turn,unit:id,coordinate:api.coordinate(task.hex)})
  if(task.objective==="BLOCKADE_AIR_SCREEN")for(const id of task.movementUnitIds)
   if(p.locations[id]!==task.hex && state.location[id]===task.hex)metrics.airScreenMoves.push({ordinal,turn:state.turn,unit:id,coordinate:api.coordinate(task.hex)})
  if(task.kind==="SUPPRESS" && !p.battleHexes.includes(task.hex) && state.offensive?.battle_hexes?.includes(task.hex))
   metrics.suppressionDeclarations.push({ordinal,turn:state.turn,coordinate:api.coordinate(task.hex)})
 }
 for(let id=0;id<4;id++)if(p.surrender[id] && !state.surrender[id])metrics.liberations.push({ordinal,phaseTurn:p.turn,turn:state.turn,nation:id})
 if(p.turn!==state.turn || state.active==="None"){
  const defense=ring.map(h=>({coordinate:api.coordinate(h),japanControlled:!state.non_control?.includes(h) && (Array.isArray(state.control)?state.control.includes(h):!!(state.supply_cache[h]&C.jpControl)),groundCount:units.reduce((n,u,id)=>n+(u?.faction===C.JP&&u.class==="ground"&&state.location[id]===h?1:0),0)}))
  const blockade=b.rules.query(state,"Allies",{name:"rules_query",fn:"queryBlockadeStatus"})
  metrics.turnSamples.push({turn:state.turn,defense,connectedResources:blockade.connectedResources,blockadeStartedTurn:blockade.startedTurn,remainingPhases:blockade.remainingPhases})
 }
}})
fs.writeFileSync(output,JSON.stringify({task:"AI-CAMPAIGN-01",seed:replay.setup.seed,scenario:replay.setup.scenario,
 replaySha256:sha(fs.readFileSync(input)),bundleSha256:sha(fs.readFileSync(bundle)),verifierSourceSha256:sha(source),auditToolSha256:sha(fs.readFileSync(__filename)),instrumentedVerifierSha256:sha(instrumented),verification,metrics},null,2)+"\n")
console.log(JSON.stringify({seed:replay.setup.seed,verified:verification.verified,garrisonArrivals:metrics.garrisonArrivals.length,airScreenMoves:metrics.airScreenMoves.length,suppressionDeclarations:metrics.suppressionDeclarations.length,liberations:metrics.liberations.length}))
