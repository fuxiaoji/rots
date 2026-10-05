"use strict"
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),cp=require("node:child_process"),path=require("node:path")
const {loadBundle,stateDigest,validateAction}=require("./match-run")
const ROOT=path.resolve(__dirname,".."),FILE=path.join(ROOT,"rules.js"),SEED=20261401
const bots={Japan:"erasmus-japan-campaign",Allies:"erasmus-v2-opt-v5"}
const clone=x=>JSON.parse(JSON.stringify(x))
test("Japanese campaign has isolated configuration and legal serializable converging movement",{timeout:120000},()=>{
    const b=loadBundle(FILE,false,{}),r=b.rules
    const jp=r.bot_config(bots.Japan,"Japan"),ap=r.bot_config(bots.Allies,"Allies")
    assert.equal(jp.japan_campaign_planner,1);assert.equal(ap.japan_campaign_planner,0)
    assert.equal(jp.campaign_planner,0)
    let s=r.setup(SEED,"1942-1945 (The Shortened Campaign)",{headless_moves:true}),found=false
    for(let i=1;i<=500&&s.active!=="None";i++)b.call(()=>{
        if(found)return
        const role=s.active,v=r.view(s,role),before=JSON.stringify(s)
        const d=r.bots[bots[role]].decide(v,{role,seed:SEED,actionOrdinal:i})
        assert.equal(JSON.stringify(s),before,"planning must not mutate server state")
        validateAction(v,d)
        const saved=clone(s),phase=s.L.P,other=role==="Japan"?"Allies":"Japan",otherPlan=clone(s.ai_plan?.[other]||null)
        s=r.action(s,role,d.action,d.argument)
        assert.deepEqual(s.ai_plan?.[other]||null,otherPlan,"Japan plan remains private to its faction")
        const moved=role==="Japan" && /move/.test(phase) && r.pieces.some((p,id)=>p.faction===0&&p.class==="ground"
            && saved.location[id]>=0&&s.location[id]>=0&&saved.location[id]!==s.location[id])
        if(!moved || !s.ai_plan?.Japan?.tasks?.some(t=>t.movementGroups?.length>1))return
        assert.equal(s.ai_profile.Japan.japan_campaign_planner,1)
        const input={state:saved,role,action:d.action,argument:d.argument,file:FILE}
        const child=cp.spawnSync(process.execPath,["-e",`const fs=require("fs"),x=JSON.parse(fs.readFileSync(0,"utf8"));
            const r=require(x.file); process.stdout.write(JSON.stringify(r.action(x.state,x.role,x.action,x.argument)));`],
            {cwd:ROOT,input:JSON.stringify(input),encoding:"utf8",timeout:60000,maxBuffer:32*1024*1024})
        assert.equal(child.status,0,child.stderr)
        assert.equal(stateDigest(JSON.parse(child.stdout)),stateDigest(s),"fresh-process action requires only the serialized plan")
        assert(!JSON.stringify(r.view(s,"Allies").ai.plan).includes("JAPAN_CAMPAIGN_PLANNER"))
        found=true
    })
    assert(found,"fixture must execute actual converging Japanese ground movement")
})
