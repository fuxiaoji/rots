"use strict"
// A constructed public board tests the actual engine's two-port movement and
// save boundary. It is not a match result or a performance seed.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),cp=require("node:child_process")
const {validateAction,stateDigest}=require("./match-run")
const ROOT=path.resolve(__dirname,".."),FILE=path.join(ROOT,"rules.js")
function load() {
    const m=new Module(FILE,module);m.filename=FILE;m.paths=Module._nodeModulePaths(ROOT)
    m._compile(fs.readFileSync(FILE,"utf8")+`
    exports.__convergenceFixture = state => {
        G=state; R=JP; G.active=JP; const hq=G.location[HQ_JP_SOUTH];
        G.location.fill(NOT_USED); G.oos=[]; G.reduced=[66]; G.inter_service=[0,0]; G.asp[JP]=[6,0];
        G.hand[JP]=[129]; G.hand[AP]=[]; G.undo=[]; reset_offensive();
        G.L=L={P:"offensive_segment",L:{P:"convergence_test_return"}};
        G.location[HQ_JP_SOUTH]=hq; G.location[32]=421; G.location[75]=421;
        G.location[66]=452; G.location[11]=452; G.location[183]=309; G.location[103]=309;
        G.supply_cache[421]|=JP_CONTROLLED; G.supply_cache[452]|=JP_CONTROLLED;
        G.supply_cache[309]&=~JP_CONTROLLED; check_supply(); _save();
    };
    exports.__convergencePlan = state => {
        const view=exports.view(state,"Japan");
        G=state;L=G.L;R="Japan";_load();em_set_config(em_bot_config("erasmus-japan-campaign","Japan"));
        try { const units=view.ai.units,board=ec_map();
            return ec_amphibious_convergence({view,faction:JP,units,available:units.filter(u=>u.class!=="hq"&&u.faction===JP),
                byHex:new Map(board.map(m=>[m.hex,m])),hq:units.find(u=>u.id===HQ_JP_SOUTH),budget:4,cardId:129,cardMode:"ops",
                captureTargets:new Set([309]),garrisonReserve:new Set(),moves:new Map(),reactions:new Map(),homeAssaults:new Map(),
                victory:{homelandKeys:[],resourceTargets:[]},powGap:0,scoreTarget:()=>500});
        } finally { _save(); }
    };
    `,FILE)
    return m.exports
}
test("two amphibious groups enter the same declared battle, spend cumulative ASP and restore from JSON",{timeout:120000},()=>{
    const r=load();let s=r.setup(20261401,"1942-1945 (The Shortened Campaign)",{headless_moves:true})
    r.__convergenceFixture(s)
    const before=JSON.stringify(s),tasks=r.__convergencePlan(s)
    assert(JSON.stringify(s)===before,"planning is read-only")
    const task=tasks.find(t=>t.requiredUnits.includes(32)&&t.requiredUnits.includes(66))
    assert(task,"two separately legal departure ports must form a feasible attack")
    assert.equal(task.aspCost,5)
    const target={...task,campaignTask:true,focus:309,targetMeta:[{...task,campaignTask:true},
        {hex:245,kind:"CONQUEST",requiresOccupation:true}],chain:[309,245]}
    const act=(a,arg)=>{
        const v=r.view(s,"Japan");validateAction(v,{action:a,argument:arg});s=r.action(s,"Japan",a,arg)
    }
    act("card",129);act("ops")
    if(r.view(s,"Japan").actions.unit?.includes(7)&&/choose hq/i.test(r.view(s,"Japan").prompt))act("unit",7)
    for(const id of task.requiredUnits)act("unit",id)
    act("done")
    let savedBoundary=null
    for(let i=0;i<20&&!task.movementUnitIds.every(id=>s.location[id]===309);i++) {
        const v=r.view(s,"Japan")
        if(v.actions.advance) {
            const saved=JSON.parse(JSON.stringify(s))
            act("advance",target)
            if(s.offensive.battle_hexes.includes(309)&&!task.movementUnitIds.every(id=>s.location[id]===309))
                savedBoundary={saved,expected:JSON.parse(JSON.stringify(s)),target}
        } else if(v.actions.stop)act("stop")
        else assert.fail("unexpected convergence movement window: "+v.prompt)
    }
    assert(task.movementUnitIds.every(id=>s.location[id]===309),"the second group must not switch to the next target")
    assert.equal(s.asp[0][1],5)
    assert(s.offensive.battle_hexes.includes(309))
    assert(savedBoundary,"test must cross the first-group-declared / second-group-pending boundary")
    const child=cp.spawnSync(process.execPath,["-e",`const fs=require("fs"),x=JSON.parse(fs.readFileSync(0,"utf8")),r=require(x.file);
        process.stdout.write(JSON.stringify(r.action(x.saved,"Japan","advance",x.target)));`],
        {cwd:ROOT,input:JSON.stringify({...savedBoundary,file:FILE}),encoding:"utf8",timeout:60000,maxBuffer:32*1024*1024})
    assert.equal(child.status,0,child.stderr)
    assert.equal(stateDigest(JSON.parse(child.stdout)),stateDigest(savedBoundary.expected))
})
