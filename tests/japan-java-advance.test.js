"use strict"
// A constructed board isolates the public unnamed Java route. It is not an
// opening result or a replay of the historical development seed.
const test=require("node:test"),assert=require("node:assert/strict")
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module")
const {validateAction}=require("./match-run")
const FILE=path.resolve(__dirname,"../rules.js")
function engine() {
    const m=new Module(FILE,module);m.filename=FILE;m.paths=Module._nodeModulePaths(path.dirname(FILE))
    m._compile(fs.readFileSync(FILE,"utf8")+`
    exports.__javaFixture=state=>{
        G=state;R=JP;G.active=JP;const south=G.location[7],combined=G.location[5];
        G.location.fill(NOT_USED);G.location[7]=south;G.location[5]=combined;
        G.location[32]=368;G.location[34]=368;G.location[183]=309;
        G.hand[JP]=[90,137,127];G.hand[AP]=[];G.turn=5;G.oos=[];G.reduced=[];
        G.inter_service=[0,0];G.asp[JP]=[6,0];G.undo=[];
        G.supply_cache[368]|=JP_CONTROLLED;G.supply_cache[309]&=~JP_CONTROLLED;reset_offensive();
        G.L=L={P:"offensive_segment",L:{P:"test_return"}};check_supply();_save();
    };
    exports.__javaAdvance=(state,cardId,hqId)=>{
        const view=exports.view(state,"Japan");G=state;L=G.L;R="Japan";_load();
        em_set_config(em_bot_config("erasmus-japan-campaign","Japan"));
        try {const board=ec_map(),units=view.ai.units,preview=queryCardPreview(cardId,{faction:JP,hqId,cardMode:"ops"});
        return {strategicMapHasIntermediate:board.some(m=>m.hex===338),tasks:ej_java_advances({view,faction:JP,units,
            available:units.filter(u=>u.faction===JP && preview.units.includes(u.id)),
            byHex:new Map(board.map(m=>[m.hex,m])),hq:units.find(u=>u.id===hqId),budget:preview.activationBudget,
            cardId,cardMode:"ops",captureTargets:new Set([309]),garrisonReserve:new Set(),redeployments:[],moves:new Map()},[309],500)};
        } finally {_save();}
    };`,FILE)
    return m.exports
}
test("Java armies advance together through unnamed terrain without inventing a national target",()=>{
    const r=engine();let s=r.setup(20261416,"1942-1945 (The Shortened Campaign)",{headless_moves:true})
    r.__javaFixture(s)
    const check=(card,hq)=>{const before=JSON.stringify(s),result=r.__javaAdvance(s,card,hq)
        assert.equal(JSON.stringify(s),before,"planning preserves the complete position and RNG");return result}
    const result=check(90,7)
    assert.equal(result.strategicMapHasIntermediate,false,"ordinary unnamed terrain stays out of the strategic target map")
    const task=result.tasks.find(t=>t.hex===338 && t.requiredUnits.length===2)
    assert(task);assert.deepEqual(task.requiredUnits,[32,34]);assert.equal(task.followUpTarget,309)
    assert.equal(task.objective,"SOUTHERN_ADVANCE");assert.equal(task.aspCost,0);assert.equal(task.declaresBattle,false)
    const move=r.query(s,"Japan",{name:"rules_query",fn:"queryGroupMovementDestinations",
        args:[[32,34],{faction:0,cardId:90,hqId:7,cardMode:"ops",move_type:4}]})
    assert.deepEqual(move.paths[338],[4,4,368,338])
    assert(!check(90,5).tasks.some(t=>t.hex===338))
    assert(!check(127,7).tasks.some(t=>t.hex===338),"a shorter card cannot be upgraded by the planner")
    assert(check(137,7).tasks.some(t=>t.hex===338 && t.requiredUnits.length===2))
    const act=(action,argument)=>{validateAction(r.view(s,"Japan"),{action,argument});s=r.action(s,"Japan",action,argument)}
    act("card",90);act("ops")
    if (/choose hq/i.test(r.view(s,"Japan").prompt))act("unit",7)
    act("unit",32);act("unit",34);act("done")
    const asp=JSON.stringify(s.asp[0])
    act("advance",{...task,campaignTask:true,focus:338,targetMeta:[{...task,campaignTask:true}],chain:[338]})
    assert.equal(s.location[32],338);assert.equal(s.location[34],338);assert.equal(JSON.stringify(s.asp[0]),asp)
    const before=JSON.stringify(s),next=r.query(s,"Japan",{name:"rules_query",fn:"queryGroupMovementDestinations",
        args:[[32,34],{faction:0,cardId:137,hqId:7,cardMode:"ops",move_type:4}]})
    assert.equal(JSON.stringify(s),before);assert.deepEqual(next.paths[309],[4,4,338,309])
})
