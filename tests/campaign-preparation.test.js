"use strict"
const test=require("node:test"),assert=require("node:assert/strict")
const rules=require("../rules")
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module")
const {validateAction}=require("./match-run")
const clone=x=>JSON.parse(JSON.stringify(x))
function fixture() {
    const state=rules.setup(20261429,"1942-1945 (The Shortened Campaign)",{headless_moves:true})
    state.hand[0]=[111,145,139]
    return state
}
function ask(state,fn,args,role="Japan") {
    const before=JSON.stringify(state)
    const answer=rules.query(state,role,{name:"rules_query",fn,args})
    assert.equal(JSON.stringify(state),before,"pure query preserves the whole position, RNG, cards and log")
    return answer
}

test("friendly-airfield ground preparation uses real terrain costs and never grants actual relocation",()=>{
    const state=fixture(),ctx={faction:0,cardId:139,hqId:5,cardMode:"ops"}
    assert.equal(state.location[33],789)
    assert.equal(ask(state,"querySpaceControlled",[562,0]),true)
    const ready=ask(state,"queryGroundPreparation",[33,562,535,ctx])
    assert.equal(ready.projection,"friendly-ground-arrival");assert.equal(ready.eligible,true);assert.equal(ready.reachable,true)
    assert.deepEqual(ready.path,[4,6,562,534,535])
    for (const cardId of [111,145]) assert.equal(ask(state,"queryGroundPreparation",[33,562,535,{...ctx,cardId}]).reachable,false)
    assert.deepEqual(ask(state,"queryGroundPreparation",[33,562,535,ctx]),ready)
    const arrived=clone(state);arrived.location[33]=562
    const actual=ask(arrived,"queryGroupMovementDestinations",[[33],{...ctx,move_type:4}])
    assert.deepEqual(actual.paths[535],ready.path,"projection agrees with the ordinary query in the arrived fixture")
    assert.equal(state.location[33],789)
    const activation=ask(state,"queryGroundPreparation",[33,562,535,{...ctx,activationOnly:true}])
    assert.equal(activation.eligible,true);assert.equal(activation.activationOnly,true)
    assert.equal(activation.reachable,null);assert.equal(activation.path,null,"startup-only evidence grants no route")
})

test("special reaction refreshes stale pre-card ZOI exactly as the actual defending phase",()=>{
    const state=rules.setup(20261406,"1942-1945 (The Shortened Campaign)",{headless_moves:true})
    const before=JSON.stringify(state)
    const result=ask(state,"querySpecialReaction",[{target:308,reactingFaction:1}])
    assert.equal(result.eligible,true);assert.equal(result.respondingHq,80)
    assert.equal(JSON.stringify(state),before)
    assert.equal(ask(state,"querySpecialReaction",[{target:308,reactingFaction:7}]).reason,"invalid-faction")
    const filename=path.resolve(__dirname,"../rules.js"),m=new Module(filename,module)
    m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename))
    m._compile(fs.readFileSync(filename,"utf8")+`
        exports.__reactionHexes=state=>{
            G=state;R=JP;_load();G.offensive.attacker=JP;G.offensive.landing_hexes=[308];
            L.P="test_return";P.special_reaction._begin();return (L.possible_hexes || []).slice();
        };`,filename)
    assert(m.exports.__reactionHexes(clone(state)).includes(308),"query agrees with actual special reaction begin")
})

test("preparation rejects enemy units, enemy origins and enemy card contexts",()=>{
    const state=fixture(),ctx={faction:0,cardId:139,hqId:5,cardMode:"ops"}
    assert.equal(ask(state,"queryGroundPreparation",[160,562,535,ctx]).reason,"unauthorized-unit")
    assert.equal(ask(state,"queryGroundPreparation",[33,535,562,ctx]).reason,"invalid-friendly-origin")
    assert.equal(ask(state,"queryGroundPreparation",[33,562,535,{...ctx,faction:1}]).eligible,false)
    assert.equal(ask(state,"queryGroundPreparation",[33,562,535,{...ctx,cardId:1}]).eligible,false)
})

test("effective Japanese ASP query includes rivalry and already spent points",()=>{
    const state=fixture();state.asp[0]=[6,1];state.inter_service[0]=1
    assert.equal(ask(state,"queryAspRemaining",[0]),2)
    state.inter_service[0]=0;assert.equal(ask(state,"queryAspRemaining",[0]),5)
    assert.equal(ask(state,"queryAspRemaining",[-1]),0)
})

test("air support at extended range uses the engine's reduced and halved CF",()=>{
    const state=fixture()
    const normal=ask(state,"queryCombatParticipation",[23,560,{}])
    const extended=ask(state,"queryCombatParticipation",[23,415,{}])
    assert.equal(normal.effectiveAttack,16);assert.equal(extended.usesExtendedRange,true)
    assert.equal(extended.effectiveAttack,8)
    assert.equal(extended.effectiveAttack,ask(state,"queryPotentialCombatStrength",[[23],415]))
    state.reduced=[23]
    assert.equal(ask(state,"queryCombatParticipation",[23,560,{}]).effectiveAttack,8)
    assert.equal(ask(state,"queryCombatParticipation",[23,415,{}]).effectiveAttack,4)
    assert.equal(ask(state,"queryCombatParticipation",[23,0,{}]).effectiveAttack,0)
})

test("joint friendly arrival proves an actual AA group and exact next-card support without mutating state",()=>{
    const state=fixture(),ctx={faction:0,cardId:139,hqId:5,cardMode:"ops"}
    const group=[32,33,15]
    assert.equal(ask(state,"queryAmphibiousPreparation",[group,789,535,ctx]).reason,"arrival-overstack")
    state.location[38]=672 // A coherent fixture: two armies in Seoul, room at Tokyo.
    const proof=ask(state,"queryAmphibiousPreparation",[group,789,535,ctx])
    assert.equal(proof.eligible,true);assert.equal(proof.reachable,true)
    assert.equal(proof.aspCost,6);assert.equal(proof.activationBudget,6)
    const arrived=clone(state);arrived.location[32]=789
    const actual=ask(arrived,"queryGroupMovementDestinations",[group,{...ctx,move_type:8}])
    assert.deepEqual(proof.path,actual.paths[535]);assert.equal(proof.aspCost,actual.aspCost)
    const preview=ask(arrived,"queryCardPreview",[139,ctx])
    assert.deepEqual(proof.units,preview.units)
    for(const id of proof.supportIds) {
        assert(proof.units.includes(id));assert(!group.includes(id))
        const unit=rules.view(arrived,"Japan").ai.units.find(u=>u.id===id)
        if (unit.class==="air") assert.equal(ask(arrived,"queryCombatParticipation",[id,535,{}]).legal,true)
        else assert(unit.class==="naval" && unit.br>0,"carrier support stays at its real base; it is not a naval relocation")
        assert.equal(proof.effectiveSupportCF[id],ask(arrived,"queryPotentialCombatStrength",[[id],535]))
    }
    assert.equal(ask(state,"queryAmphibiousPreparation",[[32,33,17],789,535,ctx]).reason,"escort-not-at-origin")
    assert.equal(ask(state,"queryAmphibiousPreparation",[[32,187,15],789,535,ctx]).reason,"unauthorized-unit")
    state.hand[0].push(87)
    assert.equal(ask(state,"queryAmphibiousPreparation",[group,789,535,{...ctx,cardId:87,cardMode:"event"}]).eligible,false,
        "Tsuji's ground-only event cannot provide an escort witness")
    const rival=clone(state);rival.inter_service[0]=1
    assert.equal(ask(rival,"queryAmphibiousPreparation",[group,789,535,ctx]).reachable,false)
})

function reinforcementEngine() {
    const filename=path.resolve(__dirname,"../rules.js"),m=new Module(filename,module)
    m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename))
    m._compile(fs.readFileSync(filename,"utf8")+`
    exports.__prepareReinforcement = state => {
        G=state;R=JP;G.active=JP;const hq=G.location[5];G.location.fill(NOT_USED);
        G.location[5]=hq;G.location[32]=653;G.location[33]=789;G.location[34]=534;
        G.location[160]=535;G.location[187]=535;G.reduced=[160];G.oos=[];
        G.hand[JP]=[145,139];G.hand[AP]=[];G.asp[JP]=[7,0];G.inter_service=[0,0];G.undo=[];
        G.supply_cache[562]|=JP_CONTROLLED;G.supply_cache[534]|=JP_CONTROLLED;
        G.supply_cache[535]&=~JP_CONTROLLED;reset_offensive();
        G.L=L={P:"offensive_segment",L:{P:"test_return"}};check_supply();_save();
    };
    exports.__reinforcementTasks=state=>{
        const view=exports.view(state,"Japan");G=state;L=G.L;R="Japan";_load();
        em_set_config(em_bot_config("erasmus-japan-campaign","Japan"));
        try {const units=view.ai.units,board=ec_map(),preview=queryCardPreview(145,{faction:JP,hqId:5,cardMode:"ops"});
        return ej_bridgehead_reinforcements({view,faction:JP,units,board,byHex:new Map(board.map(m=>[m.hex,m])),
            available:units.filter(u=>preview.units.includes(u.id)),hq:units.find(u=>u.id===5),budget:preview.activationBudget,
            cardId:145,cardMode:"ops",garrisonReserve:new Set(),moves:new Map(),reactions:new Map(),powGap:0,
            victory:{homelandKeys:[],resourceTargets:[]},requireGroundReactionCover:true},new Map([[535,{}]]),()=>735);
        } finally {_save();}
    };`,filename)
    return m.exports
}

test("two AA groups reinforce a friendly airport, respect effective ASP and execute their bound destination",()=>{
    const r=reinforcementEngine();let s=fixture();r.__prepareReinforcement(s)
    const before=JSON.stringify(s),tasks=r.__reinforcementTasks(s)
    assert.equal(JSON.stringify(s),before)
    const task=tasks.find(t=>t.hex===562 && t.requiredUnits.includes(32) && t.requiredUnits.includes(33))
    assert(task,"the understrength attack receives two independently legal full armies")
    assert.equal(task.aspCost,6);assert.equal(task.preparation.cardId,139);assert.equal(task.preparation.attackingGround,54)
    assert.equal(task.movementGroups.length,2)
    const rival=clone(s);rival.inter_service[0]=1
    assert.equal(r.__reinforcementTasks(rival).length,0,"two individually feasible groups cannot spend more than the reduced total ASP")
    const act=(action,argument)=>{validateAction(r.view(s,"Japan"),{action,argument});s=r.action(s,"Japan",action,argument)}
    act("card",145);act("ops")
    if(/choose hq/i.test(r.view(s,"Japan").prompt))act("unit",5)
    for(const id of task.requiredUnits)act("unit",id)
    act("done")
    for(let i=0;i<20 && !task.movementUnitIds.every(id=>s.location[id]===562);i++) {
        const v=r.view(s,"Japan")
        if(v.actions.advance)act("advance",{...task,campaignTask:true,focus:562,targetMeta:[{...task,campaignTask:true}],chain:[562]})
        else if(v.actions.done)act("done")
        else throw Error("unexpected reinforcement window: "+v.prompt)
    }
    assert(task.movementUnitIds.every(id=>s.location[id]===562))
    assert.equal(s.asp[0][1],6);assert.equal(s.location[34],534)
})
