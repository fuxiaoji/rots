"use strict"
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module")
const {validateAction,validDecisionTrace}=require("./match-run")
const FILE=path.resolve(__dirname,"../rules.js")
function engine(){const m=new Module(FILE,module);m.filename=FILE;m.paths=Module._nodeModulePaths(path.dirname(FILE))
    m._compile(fs.readFileSync(FILE,"utf8")+`
    P.stack_test_end={prompt(){prompt("Fixture complete.");button("done")}};
    exports.__stack={
        constants:{AP,JP,CHINA_BOX,B_29_1,B_29_2,POST_BATTLE_STAGE,ATTACK_STAGE,STRAT_MOVE,NAVAL_MOVE},
        publicFixture(s,f){Object.assign(s,object_copy(f.state));G=s;L=G.L;R=AP;G.active=AP;G.undo=[];_save()},
        simple(s,placements,active=[]){G=s;R=AP;G.active=AP;G.location.fill(NOT_USED);G.reduced=[];
            for(const [u,h] of placements)G.location[u]=h;reset_offensive();G.offensive.active_cards=[45];
            G.offensive.offensive_card=45;G.offensive.attacker=AP;G.offensive.active_units[AP]=active.slice();
            G.offensive.naval_move_distance=15;G.offensive.air_move_distance=3;G.offensive.ground_move_distance=6;
            G.offensive.stage=POST_BATTLE_STAGE;G.active_stack=[];L=G.L={P:"move_offensive_units",L:{P:"stack_test_end"},movable_units:active.slice(),move_type:0,move_data:{}};
            for(const h of [308,368,395,397])G.supply_cache[h]&=~JP_CONTROLLED;
            G.non_control=[];_save()},
        run(s,fn){G=s;L=G.L;R="Allies";_load();em_set_config(em_bot_config("erasmus-campaign","Allies"));
            try{return rules_query_snapshot(()=>fn());}finally{_save()}},
        pbmNeeded(s,u){return this.run(s,()=>({needed:headless_pbm_needed(u),hasCandidates:headless_advance_has_candidates("pbm")}))},
        score(s,u,hex){return this.run(s,()=>headless_target_score(hex,false,AP,"pbm",null,pieces[u],G.location[u],{},[u]))},
        filter(s,actions,ids){return this.run(s,()=>erasmus_stacking_destinations({active_stack:ids,actions,ai:{windowKind:"pbm"},prompt:"Move units"},"Allies"))},
        pick(s,hexes,ids){return this.run(s,()=>{G.active_stack=ids;eop_set_strategy_chain("Allies",{name:"fixture",kind:"REDEPLOY",chain:[278],targetMeta:[{hex:278,kind:"REDEPLOY"}]});
            return eop_pick_action_hex(hexes,"Allies",{ai:{windowKind:"pbm"}})})},
        farAirfield(s,hex){G=s;R=AP;G.active=AP;
            const far=ec_map().find(m=>m.airfield&&get_distance(hex,m.hex)>2&&get_distance(hex,m.hex)<=4)?.hex;
            for(let h=1;h<=LAST_BOARD_HEX;h++)G.supply_cache[h]|=JP_CONTROLLED;
            G.supply_cache[far]&=~JP_CONTROLLED;G.non_control=[];_save();return far},
        recoveryFixture(s,ids,type){G=s;R=AP;G.active=AP;G.offensive.stage=ATTACK_STAGE;G.offensive.battle_hexes=[395];
            for(const id of ids)map_set(G.offensive.paths,id,[type,0,G.location[id]]);_save()}
    };`,FILE);return m.exports}
const clone=x=>JSON.parse(JSON.stringify(x))
function ask(r,s,fn,args){const before=JSON.stringify(s),out=r.query(s,"Allies",{name:"rules_query",fn,args});assert.equal(JSON.stringify(s),before);return out}
test("the public T4 PBM loss scene excludes a full land/air hex and keeps real legal alternatives",()=>{
    const r=engine(),f=JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/allied-pbm-stacking-public.json")))
    const s=r.setup(1,"1942-1945 (The Shortened Campaign)",{headless_moves:true});r.__stack.publicFixture(s,f)
    const legal=ask(r,s,"queryPbmDestinations",[98,{}]);assert.deepEqual(legal,[278,305,308,309,368,395,397,484,512,568,570,597,628])
    for(const unit of [98,105])assert.equal(ask(r,s,"queryProjectedStack",[278,[unit],{faction:1}]).fitsForIncoming,false)
    for(const h of [308,309,368,395,397]){assert(legal.includes(h));assert.equal(ask(r,s,"queryProjectedStack",[h,[98],{faction:1}]).fitsForIncoming,true)}
    assert.equal(r.__stack.score(s,98,278),null)
    assert.notEqual(r.__stack.score(s,98,395),null)
    assert.notEqual(r.__stack.pick(s,[278,395],[98]),278,"amphibious filtering cannot restore an excluded full hex")
    const filtered=r.__stack.filter(s,{action_hex:[278,395]},[98])
    assert.deepEqual(filtered.view.actions.action_hex,[395])
    const exit=r.__stack.filter(s,{action_hex:[278],turn_box:1},[98]).decision
    assert.equal(exit.action,"turn_box");assert(validDecisionTrace(exit.publicTrace),"safe exits retain an auditable campaign trace")
    const forced=r.__stack.filter(s,{action_hex:[278]},[98]).decision
    assert.equal(forced.action,"action_hex");assert.equal(forced.argument,278)
    assert(validDecisionTrace(forced.publicTrace),"unavoidable placement is explicit without becoming a missing-node result")
    assert.match(forced.publicTrace.explanation,/无法.*避免/)
})
test("projected whole groups preserve pairs, existing units, separate buckets and headquarters limits",()=>{
    const r=engine(),s=r.setup(1,"1942-1945 (The Shortened Campaign)",{headless_moves:true}),h=r.__stack
    h.simple(s,[[200,395],[201,395],[109,368],[110,368],[79,395],[80,368],[87,368]])
    const pair=ask(r,s,"queryProjectedStack",[395,[109,110,109],{faction:1}])
    assert.equal(pair.counts.engineGroundAirSlots,3);assert.equal(pair.fitsForIncoming,true)
    assert.equal(ask(r,s,"queryProjectedStack",[395,[79],{faction:1}]).fitsForIncoming,true)
    assert.equal(ask(r,s,"queryProjectedStack",[395,[80],{faction:1}]).fitsForIncoming,false)
    s.location[109]=395;assert.equal(ask(r,s,"queryProjectedStack",[395,[110],{faction:1}]).fitsForIncoming,true)
    s.location[202]=395;s.location[98]=395
    assert.equal(ask(r,s,"queryProjectedStack",[395,[87],{faction:1}]).fitsForIncoming,true,"an unrelated land/air overflow cannot reject a safe naval arrival")
    assert.equal(ask(r,s,"queryProjectedStack",[395,[98],{faction:1}]).fitsForIncoming,false,"already being at the destination does not hide overflow")
    h.simple(s,[[h.constants.B_29_1,368],[h.constants.B_29_2,368]])
    assert.equal(ask(r,s,"queryProjectedStack",[h.constants.CHINA_BOX,[h.constants.B_29_1,h.constants.B_29_2],{faction:1}]).fitsForIncoming,true)
    assert.equal(ask(r,s,"queryProjectedStack",[395,[34],{faction:1}]).eligible,false,"enemy projections are rejected")
})
test("seven ships at a friendly port require PBM, and temporary combat needs a real safe recovery",()=>{
    const r=engine(),s=r.setup(1,"1942-1945 (The Shortened Campaign)",{headless_moves:true}),h=r.__stack
    const ships=r.pieces.map((p,id)=>({p,id})).filter(x=>x.p.faction===1&&x.p.class==="naval").slice(0,7).map(x=>x.id)
    h.simple(s,ships.map(u=>[u,395]),ships)
    assert.equal(ask(r,s,"queryProjectedStack",[395,[ships[6]],{faction:1}]).fitsForIncoming,false)
    assert.deepEqual(h.pbmNeeded(s,ships[6]),{needed:true,hasCandidates:true})
    const view=r.view(s,"Allies");assert(view.actions.advance)
    const d=r.bots["erasmus-campaign"].decide(view,{role:"Allies",gameKey:"seven-ships",actionOrdinal:0})
    assert.equal(d.action,"advance");validateAction(view,d)
    const moved=r.action(s,"Allies",d.action,d.argument)
    assert.equal(ships.filter(u=>moved.location[u]===395).length,6,"all seven active ships must split rather than decline as an impossible group")
    const t=r.setup(1,"1942-1945 (The Shortened Campaign)",{headless_moves:true});h.simple(t,ships.map(u=>[u,368]),ships)
    h.recoveryFixture(t,ships,h.constants.NAVAL_MOVE)
    const recover=ask(r,t,"queryPbmStackRecovery",[395,ships,{faction:1,move_type:h.constants.NAVAL_MOVE}])
    assert.equal(recover.recoverable,true);assert(recover.moves.length>0)
    assert.equal(ask(r,t,"queryPbmStackRecovery",[395,ships,{faction:1,move_type:h.constants.STRAT_MOVE}]).recoverable,false)
    t.offensive.active_units[1]=[]
    assert.equal(ask(r,t,"queryPbmStackRecovery",[395,ships,{faction:1,move_type:h.constants.NAVAL_MOVE}]).recoverable,false)
})
test("a participating parenthetical aircraft cannot invent an extended-range PBM escape",()=>{
    const r=engine(),s=r.setup(1,"1942-1945 (The Shortened Campaign)",{headless_moves:true}),h=r.__stack
    h.simple(s,[[200,395],[201,395],[202,395],[98,368]],[98])
    const far=h.farAirfield(s,395);assert(Number.isInteger(far))
    h.recoveryFixture(s,[98],8)
    assert.equal(ask(r,s,"queryPbmStackRecovery",[395,[98],{faction:1,move_type:8}]).recoverable,false)
})
