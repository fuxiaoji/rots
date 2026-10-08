"use strict"
// AI-CAMPAIGN-02: reference decisions + full action replay; metadata flag normalization only.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {validateAction,stateDigest}=require('../tests/match-run')
const [oldBundle,candidateBundle,replayPath,output]=process.argv.slice(2)
if(!output)throw Error('usage: old-reference candidate-reference replay output')
const ROOT=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x)),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
function load(file){const filename=path.join(ROOT,'rules.js'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(ROOT);m._compile(fs.readFileSync(file,'utf8'),filename);return m.exports}
function normalized(x){if(Array.isArray(x))return x.map(normalized);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([k])=>k!=='campaign_v2').map(([k,v])=>[k,normalized(v)]));return x}
const legacy=load(oldBundle),candidate=load(candidateBundle),release=load(path.join(ROOT,'rules.js')),replay=JSON.parse(fs.readFileSync(replayPath)),checks=[],seen=new Set()
let original=candidate.setup(replay.setup.seed,replay.setup.scenario,replay.setup.options),migrated=release.setup(replay.setup.seed,replay.setup.scenario,replay.setup.options)
for(const [index,[role,action,argument]] of replay.replayActions.entries()){
 const category=original.L?.P||'none',window=candidate.view(clone(original),role).ai?.windowKind||'none',key=role+':'+category+':'+window;
 if(!seen.has(key)&&checks.filter(x=>x.role===role).length<30){
  seen.add(key);const oldId=role==='Japan'?'erasmus-japan-campaign':'erasmus-campaign',newId=oldId+'-v2',ctx={role,seed:replay.setup.seed,actionOrdinal:index+1};
  const oldState=clone(original),before=JSON.stringify(oldState),oldDecision=legacy.bots[oldId].decide(legacy.view(oldState,role),ctx);assert.equal(JSON.stringify(oldState),before);
  const newOldState=clone(original),newOldDecision=release.bots[oldId].decide(release.view(newOldState,role),ctx);assert.equal(JSON.stringify(newOldState),before);assert.deepEqual(clone(newOldDecision.argument),clone(oldDecision.argument),'legacy argument '+key);assert.equal(newOldDecision.action,oldDecision.action,'legacy action '+key);assert.deepEqual(clone(newOldDecision.publicTrace),clone(oldDecision.publicTrace),'legacy public trace '+key);
  const candidateState=clone(original),reference=candidate.bots[oldId].decide(candidate.view(candidateState,role),ctx),newState=clone(original);
  for(const p of Object.values(newState.ai_profile||{}))p.campaign_v2=1;const beforeV2=JSON.stringify(newState),selected=release.bots[newId].decide(release.view(newState,role),ctx);assert.equal(JSON.stringify(newState),beforeV2);
  assert.equal(selected.action,reference.action,'v2 action '+key);assert.deepEqual(normalized(selected.argument),normalized(reference.argument),'v2 argument '+key);validateAction(release.view(newState,role),selected);
  // Interleaved old/new role calls cannot alter a saved decision.
  const again=clone(original),repeat=release.bots[oldId].decide(release.view(again,role),ctx);assert.equal(repeat.action,oldDecision.action);assert.deepEqual(clone(repeat.argument),clone(oldDecision.argument));
  checks.push({ordinal:index+1,role,phase:category,window,legacySame:true,v2Same:true,readOnly:true,interleavingSame:true});
 }
 validateAction(candidate.view(original,role),{action,argument});original=candidate.action(original,role,action,clone(argument));
 const arg=clone(argument);if(arg?.__ai?.profile&&(arg.__ai.profile.campaign_planner||arg.__ai.profile.japan_campaign_planner))arg.__ai.profile.campaign_v2=1;
 validateAction(release.view(migrated,role),{action,argument:arg});migrated=release.action(migrated,role,action,arg);
 assert.deepEqual(normalized(migrated),normalized(original),'full state drift at '+(index+1));
}
assert.equal(stateDigest(original),replay.result.finalStateSha256);
const result={task:'AI-CAMPAIGN-02',seed:replay.setup.seed,scenario:replay.setup.scenario,hashes:{legacy:sha(oldBundle),candidate:sha(candidateBundle),release:sha(path.join(ROOT,'rules.js')),replay:sha(replayPath),verifier:sha(__filename)},actions:replay.replayActions.length,normalizedFinalStateSha256:stateDigest(normalized(migrated)),originalFinalStateSha256:stateDigest(original),winner:migrated.result,checks,fullStateReplaySame:true,normalization:'remove campaign_v2 only; no gameplay/log/plan changes',runtimeModelRequests:0}
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({seed:result.seed,actions:result.actions,savePoints:checks.length,fullStateReplaySame:true,winner:result.winner}))
