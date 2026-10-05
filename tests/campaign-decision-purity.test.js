"use strict"
const test=require("node:test"),assert=require("node:assert/strict")
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module")
const FILE=path.resolve(__dirname,"../rules.js")
function engine() {
    const m=new Module(FILE,module);m.filename=FILE;m.paths=Module._nodeModulePaths(path.dirname(FILE))
    m._compile(fs.readFileSync(FILE,"utf8")+`
    exports.__decisionCacheProbe=(state,name,role,fail)=>{
        const view=exports.view(state,role),original=EOTS_BOTS["erasmus-v2"].decideCore;
        EOTS_BOTS["erasmus-v2"].decideCore=()=>{
            G.supply_cache[0]^=32;L.supply.nested.count++;L.supply.nested.items.push("temporary");
            G.log.push("decision-cache-probe");
            if(fail)throw Error("injected decision failure");
            return {action:"done",argument:null,publicTrace:{node:"probe"}};
        };
        try{return erasmus_profile_decision(name,view,{role});}
        finally{EOTS_BOTS["erasmus-v2"].decideCore=original;}
    };`,FILE)
    return m.exports
}
test("enhanced decisions restore nested supply caches and exception exits while carrying logs in action metadata",()=>{
    const r=engine()
    for(const [name,role,scenario] of [["erasmus-campaign","Allies","1943-1945 (The Even Shorter Campaign)"],
        ["erasmus-japan-campaign","Japan","1942-1945 (The Shortened Campaign)"]]) {
        for(const simultaneous of [false,true]) {
            const s=r.setup(20261424,scenario,{headless_moves:true});s.active=simultaneous?[role]:role
            s.L.supply={nested:{count:3,items:["original"]}}
            const before=JSON.stringify(s),decision=r.__decisionCacheProbe(s,name,role,false)
            assert.equal(JSON.stringify(s),before,"success restores all state including rollback inputs, RNG and log")
            assert.deepEqual(decision.argument.__ai.logs,["decision-cache-probe"],"computed logs are carried once by the actual action")
            assert.equal(decision.argument.__ai.role,role)
            assert.throws(()=>r.__decisionCacheProbe(s,name,role,true),/injected decision failure/)
            assert.equal(JSON.stringify(s),before,"exceptions restore every original field and nested supply value")
        }
    }
})
