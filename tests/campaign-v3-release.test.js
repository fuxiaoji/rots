"use strict"
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module")
const {validateAction,stateDigest,validDecisionTrace}=require("./match-run")
const ids={Allies:["erasmus-campaign-v3","erasmus-campaign-v2-3"],Japan:["erasmus-japan-campaign-v3","erasmus-japan-campaign-v2-2"]}
function load(){const file=path.resolve(__dirname,"../rules.js"),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(fs.readFileSync(file,"utf8"),file);return m.exports}
const clone=x=>JSON.parse(JSON.stringify(x))
function withConfigEnv(env,fn){const keys=()=>Object.keys(process.env).filter(k=>/^EOTS_OPT_(PROFILE|PARAMS)/.test(k)),saved=Object.fromEntries(keys().map(k=>[k,process.env[k]]));for(const k of keys())delete process.env[k];Object.assign(process.env,env);try{return fn()}finally{for(const k of keys())delete process.env[k];Object.assign(process.env,saved)}}
test("3.0 registry and aliases retain exact evaluated profiles, including environment overrides",()=>{
 const r=load(),html=fs.readFileSync(path.resolve(__dirname,"../create.html"),"utf8")
 for(const env of [{},{EOTS_OPT_PROFILE:"all",EOTS_OPT_PARAMS_JAPAN:"emMinPWin=0.41",EOTS_OPT_PARAMS_ALLIES:"emMinPWin=0.67"}])withConfigEnv(env,()=>{
  for(const [role,[release,candidate]]of Object.entries(ids)){
   assert.deepEqual(r.bot_config(release,role),r.bot_config(candidate,role));assert.deepEqual(r.bots[release].roles,[role]);assert(r.bots[release].version.endsWith(".3.0"));assert.equal(r.bots[release].scenarios.length,2);assert(html.includes('"'+release+'"'))
  }
  assert(!("allies_campaign_offensive_refinement"in r.bot_config("erasmus-campaign","Allies")));assert(!("japan_campaign_opening_refinement"in r.bot_config("erasmus-japan-campaign-v2","Japan")))
 })
 assert.equal(r.bots["erasmus-campaign"].version,"erasmus-v2.2-zh.29-campaign.1")
})
for(const [scenario,seed]of [["1942-1945 (The Shortened Campaign)",20264801],["1943-1945 (The Even Shorter Campaign)",20264802]])test("3.0 action envelopes and restored state equal evaluated candidates: "+scenario,{timeout:120000},()=>withConfigEnv({},()=>{
 const r=load(),old=load();let s=r.setup(seed,scenario,{headless_moves:true}),original=clone(s);const seen=new Set(),roles=new Set(),history=[]
 for(let ordinal=1;ordinal<=600 && s.active!=="None";ordinal++){
  const role=Array.isArray(s.active)?s.active.slice().sort()[0]:s.active;roles.add(role);const [release,candidate]=ids[role],prior=clone(s),v=r.view(s,role),ov=old.view(prior,role),context={role,seed,ordinal};seen.add(v.ai?.stage+":"+v.ai?.windowKind)
  const before=stateDigest(s),d=r.bots[release].decide(v,context),e=old.bots[candidate].decide(ov,context)
  assert.equal(stateDigest(s),before);assert.equal(d.action,e.action);assert.deepEqual(d.argument,e.argument);assert.deepEqual(d.privateTrace,e.privateTrace);validateAction(v,d);assert(validDecisionTrace(d.publicTrace))
  s=r.action(s,role,d.action,d.argument);const previous=old.action(prior,role,e.action,e.argument);assert.equal(stateDigest(s),stateDigest(previous));history.push([role,d.action,clone(d.argument)])
  if(ordinal===200||ordinal===400){const restored=load(),saved=clone(s);const rr=Array.isArray(saved.active)?saved.active[0]:saved.active;if(ids[rr]){const c={role:rr,seed,ordinal:ordinal+1},a=r.bots[ids[rr][0]].decide(r.view(s,rr),c),b=restored.bots[ids[rr][0]].decide(restored.view(saved,rr),c);assert.deepEqual(a,b)}}
 }
 assert.equal(roles.size,2);let replay=clone(original);const fresh=load();for(const [role,action,arg]of history)replay=fresh.action(replay,role,action,arg);assert.equal(stateDigest(replay),stateDigest(s));console.log(JSON.stringify({scenario,seed,actions:history.length,windows:[...seen],roles:[...roles],runtimeModelRequests:0}))
}))
