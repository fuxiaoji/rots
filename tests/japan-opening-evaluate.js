"use strict"

// Each match and its verification runs in a fresh child process. No holdout
// is opened until the registered development gates pass and all inputs freeze.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process")
const {createRuntime, verifyReplay, gameStem, fileSha, ROOT, RULE_VERSION} = require("./match-run")
const {runQueue, archiveBundles, evaluationLimits} = require("./campaign-evaluate")
const {wilson, pairedBootstrap} = require("./campaign-metrics")
const SCENARIO = "1942-1945 (The Shortened Campaign)"
const BASELINE = "erasmus-v2-opt-v5", CANDIDATE = "erasmus-japan-campaign"
const RANGES = {develop:{first:20261401,count:32},holdout:{first:20261501,count:32}}
const read = file => JSON.parse(fs.readFileSync(file,"utf8"))
const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b)
const natural = g => !!(g.validNatural && g.status==="complete" && g.natural && !g.fallback && !g.traceNodeMissing)
function locks() {
    const baseline = path.resolve(process.env.EOTS_ALLIES_RULES || path.join(ROOT,"tmp/ai-win-01/baseline-rules.js"))
    const candidate = path.resolve(process.env.EOTS_JAPAN_RULES || path.join(ROOT,"rules.js"))
    const r = createRuntime({japanRules:candidate,alliesRules:baseline,japanBot:CANDIDATE,alliesBot:BASELINE,
        freezeJapan:false,freezeAllies:true})
    const spec = (filename,side) => ({path:filename,sha256:fileSha(filename),
        effectiveProfile:r.metadata.bundles[side].effectiveProfile,environment:r.metadata.bundles[side].environment})
    return {ruleVersion:RULE_VERSION,limits:evaluationLimits(),baseline:spec(baseline,"Allies"),candidate:spec(candidate,"Japan"),
        runner:{path:require.resolve("./match-run"),sha256:fileSha(require.resolve("./match-run"))},
        metrics:{path:require.resolve("./campaign-metrics"),sha256:fileSha(require.resolve("./campaign-metrics"))},
        openingMetrics:{path:require.resolve("./japan-opening-metrics"),sha256:fileSha(require.resolve("./japan-opening-metrics"))},
        evaluator:{path:__filename,sha256:fileSha(__filename)},adapterSha256:r.metadata.adapterSha256,gitSha:r.metadata.gitSha}
}
function resultPath(dir,arm,seed) {return path.join(dir,arm,gameStem(SCENARIO,seed,arm==="baseline"?BASELINE:CANDIDATE,BASELINE)+".json")}
function validate(g,l,arm) {
    const jp = arm==="baseline"?l.baseline:l.candidate, b=g.metadata?.bundles
    if (g.scenario!==SCENARIO || b?.Japan?.bot!==(arm==="baseline"?BASELINE:CANDIDATE) || b?.Allies?.bot!==BASELINE
        || b.Japan.sha256!==jp.sha256 || b.Allies.sha256!==l.baseline.sha256
        || !equal(b.Japan.effectiveProfile,jp.effectiveProfile) || !equal(b.Allies.effectiveProfile,l.baseline.effectiveProfile)
        || !equal(b.Japan.environment,jp.environment) || !equal(b.Allies.environment,l.baseline.environment)
        || g.metadata.ruleVersion!==l.ruleVersion || g.metadata.runnerSha256!==l.runner.sha256
        || g.metadata.metricsSha256!==l.metrics.sha256 || g.metadata.openingMetricsSha256!==l.openingMetrics.sha256
        || g.metadata.adapterSha256!==l.adapterSha256 || g.maxActions!==l.limits.maxActions
        || g.repeatStateLimit!==l.limits.repeatStateLimit || !g.headless_moves)
        throw Error(`Japanese evaluation provenance mismatch: ${arm} seed=${g.seed}`)
}
function verifyResult(file,bundleDirectory) {
    const g=read(file), sidecar=file+".verification.json"
    if (!natural(g)) return {verified:false,notRequired:true}
    const binding={resultSha256:fileSha(file),replaySha256:g.replaySha256,
        runnerSha256:fileSha(require.resolve("./match-run")),openingMetricsSha256:fileSha(require.resolve("./japan-opening-metrics"))}
    if (fs.existsSync(sidecar)) {
        const prior=read(sidecar)
        if (!equal(prior.binding,binding)) throw Error("existing verification binding differs")
        return prior
    }
    const proof={schemaVersion:1,binding,verified:false}
    try {
        if (!g.replayFile || fileSha(g.replayFile)!==g.replaySha256
            || binding.runnerSha256!==g.metadata.runnerSha256 || binding.openingMetricsSha256!==g.metadata.openingMetricsSha256)
            throw Error("replay or current verifier differs from recorded result")
        const replay=read(g.replayFile)
        if (!equal(replay.metadata,g.metadata) || replay.setup.seed!==g.seed || replay.replayActions.length!==g.actions)
            throw Error("replay identity differs")
        const v=verifyReplay(replay,{replayPath:g.replayFile,bundleDirectory})
        if (!v.verified || !v.natural || v.winner!==g.winner || v.actions!==g.actions || v.finalStateSha256!==g.finalStateSha256
            || !equal(v.opening,g.opening)) throw Error("replay outcome or opening metrics differ")
        proof.verified=true;proof.verification=v
    } catch(error) {proof.error=error.stack || String(error)}
    fs.writeFileSync(sidecar,JSON.stringify(proof,null,2)+"\n",{flag:"wx"})
    return proof
}
function load(dir,phase,count,l) {
    const groups={baseline:[],campaign:[]}
    for (const arm of Object.keys(groups)) for(let i=0;i<count;i++) {
        const seed=RANGES[phase].first+i,file=resultPath(dir,arm,seed),g=read(file)
        if(g.seed!==seed)throw Error("seed identity differs")
        validate(g,l,arm)
        const vf=file+".verification.json",v=fs.existsSync(vf)?read(vf):null
        const verified=natural(g)&&v?.verified&&equal(v.binding,{resultSha256:fileSha(file),replaySha256:g.replaySha256,
            runnerSha256:l.runner.sha256,openingMetricsSha256:l.openingMetrics.sha256})
            && fileSha(g.replayFile)===g.replaySha256 && equal(v.verification.opening,g.opening)
            && v.verification.finalStateSha256===g.finalStateSha256
        groups[arm].push({...g,resultFile:file,resultSha256:fileSha(file),verified:!!verified})
    }
    return groups
}
function report(groups,phase) {
    const fields=["bothByThirdRound","philippinesByThirdRound","malayaByThirdRound","deiByFifthRound"]
    const result={task:"AI-WIN-03",phase,scenario:SCENARIO,generatedAt:new Date().toISOString(),
        denominatorPolicy:"all scheduled games; invalid, unfinished and unverified remain failures",
        deadlines:{startTurn:2,thirdRound:4,fifthRound:6},runtimeModelRequests:0}
    for (const [arm,games] of Object.entries(groups)) result[arm]={count:games.length,
        invalid:games.filter(g=>!natural(g)).length,unverified:games.filter(g=>natural(g)&&!g.verified).length,
        japanWins:wilson(games.filter(g=>g.verified&&g.winner==="Japan").length,games.length),
        metrics:Object.fromEntries(fields.map(k=>[k,wilson(games.filter(g=>g.verified&&g.opening?.[k]).length,games.length)])),
        games:games.map(g=>({seed:g.seed,verified:g.verified,winner:g.winner,status:g.status,
            firstSurrender:g.opening?.firstSurrender,early:g.opening?.bothByThirdRound,dei:g.opening?.deiByFifthRound,
            earlyMissing:Object.fromEntries(Object.entries(g.opening?.checkpoints?.[4]?.nations||{}).map(([n,v])=>[n,v.missingKeys])),
            deiMissing:g.opening?.checkpoints?.[6]?.nations?.dei?.missingKeys, resultFile:g.resultFile}))}
    result.paired=Object.fromEntries(fields.map(k=>[k,pairedBootstrap(groups.campaign.map((g,i)=>
        [!!(groups.baseline[i]?.verified&&groups.baseline[i].opening?.[k]),!!(g.verified&&g.opening?.[k])]))]))
    return result
}
function spawn(args,env,log) {
    return new Promise((resolve,reject)=>{
        const fd=fs.openSync(log,"a"),child=cp.spawn(process.execPath,args,{cwd:ROOT,env,stdio:["ignore",fd,fd]})
        child.once("error",e=>{fs.closeSync(fd);reject(e)})
        child.once("close",(status,signal)=>{fs.closeSync(fd);resolve({status,signal})})
    })
}
async function runPhase(phase,dir,l,count=32,freezeSha256=null) {
    if (!Number.isInteger(count)||count<1||count>32 || phase==="holdout"&&count!==32)throw Error("phase count must be 1..32; holdout is exactly 32")
    dir=path.resolve(dir);fs.mkdirSync(dir,{recursive:true})
    const jobs=Number(process.env.EOTS_EVAL_JOBS||2),copies=archiveBundles(dir,l)
    const contract={phase,count,firstSeed:RANGES[phase].first,jobs,locked:l,freezeSha256,lifecycle:"one fresh process per game and verification"}
    const marker=path.join(dir,"run-lock.json")
    if(fs.existsSync(marker)){if(!equal(read(marker),contract))throw Error("existing run lock differs; use a new directory")}
    else fs.writeFileSync(marker,JSON.stringify(contract,null,2)+"\n",{flag:"wx"})
    const tasks=[]
    for(const arm of ["baseline","campaign"])for(let i=0;i<count;i++)tasks.push({arm,seed:RANGES[phase].first+i})
    await runQueue(tasks,jobs,async({arm,seed})=>{
        const output=resultPath(dir,arm,seed);fs.mkdirSync(path.dirname(output),{recursive:true})
        const claim=output+".running";fs.writeFileSync(claim,String(process.pid),{flag:"wx"})
        try {
            if(!fs.existsSync(output)) {
                process.stderr.write(`[${phase}] Japan ${arm} seed=${seed}\n`)
                await spawn([path.join(__dirname,"match-run.js"),SCENARIO,"1",String(seed),arm==="baseline"?BASELINE:CANDIDATE,
                    BASELINE,String(l.limits.maxActions),phase],{...process.env,EOTS_HEADLESS_MOVES:"1",EOTS_RECORD_REPLAYS:"all",
                    EOTS_FREEZE_JAPAN:arm==="baseline"?"1":"0",EOTS_FREEZE_ALLIES:"1",EOTS_JAPAN_RULES:copies[arm==="baseline"?"baseline":"candidate"],
                    EOTS_ALLIES_RULES:copies.baseline,EOTS_MATCH_OUTPUT_DIR:path.dirname(output),EOTS_REPEAT_STATE_LIMIT:String(l.limits.repeatStateLimit)},output+".log")
            }
            const g=read(output);validate(g,l,arm)
            if(natural(g)&&!fs.existsSync(output+".verification.json"))
                await spawn([__filename,"verify-result",output,path.join(dir,"bundles")],process.env,output+".log")
        }finally{fs.unlinkSync(claim)}
    })
    const groups=load(dir,phase,count,l),summary=report(groups,phase)
    fs.writeFileSync(path.join(dir,"summary.json"),JSON.stringify(summary,null,2)+"\n")
    console.log(JSON.stringify(summary,null,2))
    if(Object.values(groups).flat().some(g=>!g.verified))process.exitCode=1
    return summary
}
function gate(groups) {
    if(groups.campaign.length!==32 || groups.campaign.some(g=>!g.verified))throw Error("freeze requires all 32 candidate games verified")
    if(groups.campaign.filter(g=>g.opening?.bothByThirdRound).length!==32)throw Error("freeze requires 32/32 Philippines + Malaya by T4")
    if(groups.campaign.filter(g=>g.opening?.deiByFifthRound).length<16)throw Error("freeze requires at least 16/32 DEI by T6")
}
function freeze(dir,file) {
    dir=path.resolve(dir);const marker=read(path.join(dir,"run-lock.json")),l=locks()
    if(marker.phase!=="develop"||marker.count!==32||!equal(marker.locked,l))throw Error("development lock differs")
    const groups=load(dir,"develop",32,l);gate(groups)
    if(groups.baseline.some(g=>!g.verified))throw Error("freeze requires verified baseline pairs")
    const evidence=Object.values(groups).flat().flatMap(g=>[g.resultFile,g.resultFile+".verification.json",g.replayFile])
        .map(p=>({path:p,sha256:fileSha(p)}))
    const manifest={task:"AI-WIN-03-Japan",locked:l,developmentDir:dir,holdout:RANGES.holdout,evidence}
    fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true})
    fs.writeFileSync(file,JSON.stringify(manifest,null,2)+"\n",{flag:"wx"});return manifest
}
function validateFreeze(file) {
    const f=read(file)
    if(f.task!=="AI-WIN-03-Japan"||!equal(f.holdout,RANGES.holdout)||!equal(f.locked,locks()))throw Error("freeze changed; holdout refused")
    for(const e of f.evidence)if(fileSha(e.path)!==e.sha256)throw Error("development evidence changed")
    gate(load(f.developmentDir,"develop",32,f.locked));return f
}
async function main(argv=process.argv.slice(2)) {
    const [cmd,a,b]=argv
    if(cmd==="develop"&&a)return runPhase("develop",a,locks(),b===undefined?32:Number(b))
    if(cmd==="freeze"&&a&&b)return freeze(a,b)
    if(cmd==="holdout"&&a&&b){const f=validateFreeze(a);return runPhase("holdout",b,f.locked,32,fileSha(a))}
    if(cmd==="summarize"&&a){const m=read(path.join(a,"run-lock.json"));const r=report(load(path.resolve(a),m.phase,m.count,m.locked),m.phase);console.log(JSON.stringify(r,null,2));return r}
    if(cmd==="verify-result"&&a){const v=verifyResult(a,b);console.log(JSON.stringify(v,null,2));if(!v.verified&&!v.notRequired)process.exitCode=1;return v}
    throw Error("usage: japan-opening-evaluate.js develop <dir> [count] | freeze <dir> <file> | holdout <file> <dir> | summarize <dir> | verify-result <result> [bundle-dir]")
}
module.exports={locks,validate,verifyResult,load,report,runPhase,gate,freeze,validateFreeze,main,RANGES}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1})
