#!/usr/bin/env node
"use strict"
// Bounded real-model development segments; all paid requests are journaled first.
const fs=require("node:fs"),path=require("node:path"),providers=require("../js/server/llm/providers"),api=require("../js/server/llm/session")
const {hash,visible}=require("../js/server/llm/observation")
const {classifyEnd}=require("../tests/campaign-metrics")
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file+".tmp",JSON.stringify(value),{mode:0o600});fs.renameSync(file+".tmp",file)}
const read=f=>JSON.parse(fs.readFileSync(f,"utf8"))
function frozenRules(sha){
 if(!/^[a-f0-9]{64}$/.test(sha))throw Error("RULES_HASH_RANGE")
 const source=fs.readFileSync(path.resolve("llm-private/rules",sha+".js"),"utf8");if(hash(source)!==sha)throw Error("RULES_ARCHIVE_CHANGED")
 const Module=require("node:module"),filename=path.resolve("rules.js"),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(source,filename);return m.exports
}
function migrateController(saved,config,profileId,allowed){
 if(!["deepseek","glm"].includes(profileId))throw Error("PROFILE_UNSUPPORTED")
 const players=saved.replay.setup.players,roles=Object.keys(players).filter(r=>players[r].startsWith("llm:"))
 if(roles.length!==1)throw Error("SINGLE_LLM_REQUIRED")
 const role=roles[0],from=players[role],to="llm:"+profileId
 if(from===to)return
 if(!allowed)throw Error("CONTROLLER_CHANGED")
 config.controllerHistory=[...(config.controllerHistory||[]),{revision:saved.replay.actions.length,requests:saved.replay.stats.requests,role,from,to,seed:saved.replay.setup.seed,rulesSha256:saved.replay.rulesSha256,opponent:players[role==="Japan"?"Allies":"Japan"],stateHash:saved.replay.finalStateHash,inheritedMemoryHash:hash(saved.memories[role]),priorStats:{...saved.replay.stats},at:new Date().toISOString(),reason:"explicit user-authorized model continuation; board, PRNG, memory and costs preserved"}]
 saved.replay.setup={...saved.replay.setup,players:{...players,[role]:to}};config.setup={...saved.replay.setup}
}
function migrateTokenBudget(saved,config,value,allowed){
 if(value===undefined)return
 const cap=Number(value),from=saved.replay.setup.maxTotalTokens,usage=saved.replay.stats.totalTokens
 if(!Number.isSafeInteger(cap)||cap<1||cap>20000000||cap<usage)throw Error("TOKEN_BUDGET_RANGE")
 if(cap===from)return
 if(!allowed)throw Error("TOKEN_BUDGET_CHANGED")
 config.budgetHistory=[...(config.budgetHistory||[]),{revision:saved.replay.actions.length,requests:saved.replay.stats.requests,totalTokens:usage,from,to:cap,at:new Date().toISOString(),reason:"explicit bounded continuation of the same development trial; counters and costs preserved"}]
 saved.replay.setup={...saved.replay.setup,maxTotalTokens:cap};config.setup={...saved.replay.setup}
}
function goal(s){const facts=visible(s.rules,s.state,"Observer").observation.scenario.nations
 const supported=p=>["llm:deepseek","llm:glm"].includes(p)
 const conquest=supported(s.options.players.Japan)&&s.options.players.Allies==="erasmus-campaign"&&s.options.scenario==="1942-1945 (The Shortened Campaign)"&&facts.length===4&&facts.every(n=>n.surrenderedTurn>0&&n.allJapanControlled)
 const allies=supported(s.options.players.Allies)&&["erasmus-japan-campaign","erasmus-japan-campaign-v2"].includes(s.options.players.Japan)&&s.options.scenario==="1943-1945 (The Even Shorter Campaign)"&&s.state.active==="None"&&s.state.result==="Allies"&&classifyEnd(s.state).natural
 return {achieved:conquest||allies,kind:conquest?"four-national-surrenders":allies?"natural-allied-victory":null,nations:facts.map(n=>({key:n.key,surrenderedTurn:n.surrenderedTurn,allJapanControlled:n.allJapanControlled,remainingKeys:n.remainingKeys})),naturalComplete:s.state.active==="None"}
}
async function main(){const o={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith("--")||process.argv[i+1]===undefined)throw Error("ARGS");o[process.argv[i].slice(2)]=process.argv[i+1]}
 if(!o.out||!o["env-file"])throw Error("ARGS")
 const out=path.resolve(o.out),privateRoot=path.resolve("llm-private");if(!out.startsWith(privateRoot+path.sep))throw Error("PRIVATE_OUTPUT_REQUIRED")
 const configFile=path.join(out,"config.json"),saveFile=path.join(out,"save.json"),profileId=o.profile||(fs.existsSync(configFile)?read(configFile).profile.id:"deepseek")
 if(!["deepseek","glm"].includes(profileId))throw Error("PROFILE_UNSUPPORTED")
 providers.loadEnv(path.resolve(o["env-file"]))
 const profile={...providers.getProfile(profileId),...(profileId==="deepseek"?{model:"deepseek-flash"}:{}),vision:false,extraBody:{thinking:{type:"enabled"},reasoning_effort:"high",response_format:{type:"json_object"}},maxTokens:32768,timeoutMs:240000}
 const planningEffort=o["planning-effort"]||(profileId==="glm"?"low":"high")
 if(!["low","high"].includes(planningEffort))throw Error("EFFORT_UNSUPPORTED")
 const planningOverrides=profileId==="deepseek"?{maxTokens:65536,timeoutMs:480000}:{maxTokens:32768,timeoutMs:300000}
 providers.createClient({...profile,...planningOverrides}) // Preflight before session request counters/journal; no transport.
 const {apiKey,...safeProfile}=profile,publicProfile={...safeProfile,planningOverrides,planningEffort}
 const runnerHash=hash(fs.readFileSync(__filename,"utf8")),maxNewRequests=Number(o.requests||64);if(!Number.isSafeInteger(maxNewRequests)||maxNewRequests<1||maxNewRequests>512)throw Error("SEGMENT_LIMIT")
 let s
 if(fs.existsSync(saveFile)){
   const saved=read(saveFile),config=read(configFile)
   if(o["rules-sha256"]&&o["rules-sha256"]!==saved.replay.rulesSha256)throw Error("RULES_CHANGED")
   migrateController(saved,config,profileId,o.migrate==="true")
   migrateTokenBudget(saved,config,o["max-total-tokens"],o.migrate==="true")
   if(hash(config.profile)!==hash(publicProfile)){if(o.migrate!=="true")throw Error("PROFILE_CHANGED");config.profileHistory=[...(config.profileHistory||[]),{revision:saved.replay.actions.length,from:config.profile,to:publicProfile}];config.profile=publicProfile}
   config.currentModelSource=profileId==="deepseek"?"https://api-docs.deepseek.com/updates/":"https://docs.z.ai/guides/llm/glm-5.3"
   if(config.runnerHash&&config.runnerHash!==runnerHash){if(o.migrate!=="true")throw Error("RUNNER_CHANGED");config.runnerHistory=[...(config.runnerHistory||[]),{revision:saved.replay.actions.length,from:config.runnerHash,to:runnerHash}];config.runnerHash=runnerHash}
   const reqdir=path.join(out,"requests")
   if(fs.readdirSync(reqdir).some(f=>{const r=read(path.join(reqdir,f));return r.pending||r.ordinal>saved.replay.stats.requests}))throw Error("ORPHAN_REQUEST_REQUIRES_AUDIT")
   s=api.restoreSession(saved,{allowPolicyMigration:o.migrate==="true",profiles:{[profileId]:profile}})
   write(configFile,config)
 }else{
   const role=o.role||"Japan",scenario=o.scenario||(role==="Japan"?"1942-1945 (The Shortened Campaign)":"1943-1945 (The Even Shorter Campaign)")
   const opponent=o.opponent||(role==="Japan"?"erasmus-campaign":"erasmus-japan-campaign")
   const sha=o["rules-sha256"],engine=sha?{rules:frozenRules(sha),rulesSha256:sha}:{}
   s=api.createSession({seed:Number(o.seed||20262601),scenario,players:{[role]:"llm:"+profileId,[role==="Japan"?"Allies":"Japan"]:opponent},directOnly:true,maxRequests:2000,maxTotalTokens:10000000,maxActions:30000},{...engine,profiles:{[profileId]:profile}})
   write(configFile,{profile:publicProfile,setup:s.options,rulesSha256:s.rulesSha256,moduleHashes:s.moduleHashes,runnerHash,sourceVersion:profileId==="deepseek"?"official deepseek-flash = DeepSeek V4.1 Flash (2026-09-10)":"configured GLM model; actual response model recorded per request",modelSource:profileId==="deepseek"?"https://api-docs.deepseek.com/updates/":"https://docs.z.ai/guides/llm/glm-5.3",created:new Date().toISOString()})
   write(saveFile,api.serializeSession(s));fs.mkdirSync(path.join(out,"requests"),{recursive:true,mode:0o700})
 }
 s.profiles[profileId]=profile
 s.clients[profileId]={complete:async messages=>{const p=JSON.parse(messages[1].content.split("\n上次输出无效：")[0]),planning=/offensive_segment|choose_hq/.test(p.observation.state)||p.observation.state==="activate_units"&&p.observation.activation?.activeCount===0
   const effort=planning?planningEffort:"low",requestProfile={...profile,...(planning?planningOverrides:{}),extraBody:{...profile.extraBody,reasoning_effort:effort}}
   const ordinal=s.stats.requests,file=path.join(out,"requests",String(ordinal).padStart(6,"0")+".json"),record={ordinal,pending:true,profileId,provider:profile.provider,role:s.state.active,revision:s.revision,promptHash:hash(messages),model:profile.model,effort,maxTokens:requestProfile.maxTokens,timeoutMs:requestProfile.timeoutMs,runnerHash,at:new Date().toISOString(),messages}
   write(file,record);const begin=Date.now()
   try{const r=await providers.createClient(requestProfile).complete(messages);write(file,{...record,pending:false,content:r.content,outputHash:hash(r.content),model:r.model,usage:r.usage,latencyMs:r.latencyMs});return r}
   catch(e){write(file,{...record,pending:false,code:e.code||"PROVIDER",httpStatus:e.status||null,providerCode:e.providerCode||null,usage:e.usage||null,latencyMs:Date.now()-begin});throw e}
 }}
 const startRequests=s.stats.requests,startRevision=s.revision;let lastPrint=startRequests,error=null,g=goal(s)
 while(!g.achieved&&s.status!=="complete"&&s.stats.requests-startRequests<maxNewRequests){
   try{await api.step(s,{revision:s.revision})}catch(e){error={code:e.code||"ERROR"}}
   write(saveFile,api.serializeSession(s));g=goal(s)
   if(s.stats.requests>=lastPrint+4||error||g.achieved||s.status==="complete"){
     console.log(JSON.stringify({action:s.revision,turn:s.state.turn,state:s.state.L?.P,requests:s.stats.requests,tokens:s.stats.totalTokens,choice:s.lastDecision?.action,reason:s.lastDecision?.reason,surrender:g.nations.map(n=>n.surrenderedTurn),remaining:g.nations.map(n=>n.remainingKeys.length),error:error?.code||null}));lastPrint=s.stats.requests
   }
   if(error)break
   if(o["stop-at-card-boundary"]==="true"&&s.revision>startRevision&&s.options.players[s.state.active]?.startsWith("llm:")&&visible(s.rules,s.state,s.state.active).observation.state==="offensive_segment")break
   if(fs.existsSync(path.join(out,"stop-after-current")))break
 }
 const replay=api.replay(s);write(path.join(out,"replay.json"),replay);const verified=api.verifyReplay(replay)
 const configuration=read(configFile),transition=configuration.controllerHistory?.at(-1),baseline=transition?.priorStats||{}
 const result={goal:g,status:s.status,error,stats:s.stats,verified,revision:s.revision,turn:s.state.turn,result:s.state.result||null,segmentRequests:s.stats.requests-startRequests,policyMigrations:s.policyMigrations||[],moduleHashes:s.moduleHashes,
   attribution:{profileId,model:profile.model,mixedProviders:!!configuration.controllerHistory?.length,controllerHistory:configuration.controllerHistory||[],profileStageStats:Object.fromEntries(Object.entries(s.stats).map(([k,v])=>[k,typeof v==="number"?v-(baseline[k]||0):v]))}}
 write(path.join(out,"segment-"+s.stats.requests+".json"),result);console.log(JSON.stringify({segment:true,...result,moduleHashes:undefined,policyMigrations:undefined}))
 if(g.achieved)write(path.join(out,"success.json"),result)
 if(error)process.exitCode=1
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message)?e.message:"GOAL_RUN_ERROR");process.exitCode=1})
module.exports={goal,migrateTokenBudget,migrateController,frozenRules}
