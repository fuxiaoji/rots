"use strict"
const test=require("node:test"),assert=require("node:assert/strict")
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module")
const {validateAction}=require("./match-run")
const FILE=path.resolve(__dirname,"../rules.js")
function engine() {
    const m=new Module(FILE,module);m.filename=FILE;m.paths=Module._nodeModulePaths(path.dirname(FILE))
    m._compile(fs.readFileSync(FILE,"utf8")+`
    exports.__reactionTest={constants:{SURPRISE,INTERCEPT,AMBUSH},
        withCard(c,patch,fn){const saved=cards[c];cards[c]={...saved,...patch};try{return fn()}finally{cards[c]=saved}},
        branch(state,ctx,{defended=true,special=false,hq=true,zoi=false}={}){
            G=state;L=G.L;R=JP;G.active=JP;
            const saved=[is_faction_units,querySpecialReaction,queryReactionCandidates,random,trigger_event];
            is_faction_units=()=>defended;
            querySpecialReaction=()=>({eligible:special});
            queryReactionCandidates=()=>({air:hq?[110]:[],hqOptions:hq?[{hq:80,budget:5,units:[110]}]:[]});
            random=trigger_event=()=>{throw Error("probability query executed RNG or event")};
            try {if(zoi){reset_offensive();G.offensive.active_cards=[142];G.offensive.offensive_card=142;
                G.offensive.type=OC;G.offensive.zoi_intelligence_modifier=1;}
                return queryPublicReactionChance(452,ctx);
            }finally{[is_faction_units,querySpecialReaction,queryReactionCandidates,random,trigger_event]=saved;_save();}
        },
        oracle(state,event,zoi){G=state;L=G.L;R=JP;G.active=JP;reset_offensive();
            G.offensive.active_cards=[142];G.offensive.offensive_card=142;G.offensive.type=event?EC:OC;
            G.offensive.zoi_intelligence_modifier=zoi?1:0;
            const saved=[random,trigger_event];trigger_event=()=>0;
            let wins=0;try{for(let die=0;die<10;die++){random=()=>die;if(roll_intelligence_dice())wins++}}
            finally{[random,trigger_event]=saved;_save()}return wins/10;
        }};
    exports.__coverFixture=(s,f)=>{Object.assign(s,object_copy(f.publicState));G=s;L=G.L={P:"offensive_segment",L:{P:"test_return"}};
        R=JP;G.active=JP;G.location.fill(NOT_USED);G.reduced=[];
        for(const [id,loc,reduced] of f.publicUnits){G.location[id]=loc;if(reduced)set_add(G.reduced,id)}
        G.hand=[f.ownJapanHand.slice(),[]];G.undo=[];G.log=[];reset_offensive();check_supply();_save();};
    exports.__coverTasks=(s,mode)=>{const view=exports.view(s,"Japan");G=s;L=G.L;R="Japan";_load();
        em_set_config(em_bot_config("erasmus-japan-campaign","Japan"));
        try{return rules_query_snapshot(()=>{const units=view.ai.units,board=ec_map(),p=queryCardPreview(142,{faction:JP,hqId:7,cardMode:mode});
            const env={view,faction:JP,units,board,byHex:new Map(board.map(m=>[m.hex,m])),
                available:units.filter(u=>p.units.includes(u.id)),hq:units.find(u=>u.id===7),budget:p.activationBudget,
                cardId:142,cardMode:mode,powGap:0,victory:{homelandKeys:[],resourceTargets:[],routes:{homeland:{remainingKeys:[]}}},
                captureTargets:new Set([452]),axisTargets:new Set([452]),garrisonReserve:new Set(),moves:new Map(),reactions:new Map(),
                blockers:[],homeAssaults:new Map(),requireGroundReactionCover:true,publicReactionBounds:true,scoreTarget:()=>500};
            const ordinary=ec_missions(env);return ordinary.concat(ej_amphibious_naval_convergence(env,[]));});}
        finally{_save()}};`,FILE)
    return m.exports
}
const clone=s=>JSON.parse(JSON.stringify(s))
function fixture(r){const s=r.setup(20261401,"1942-1945 (The Shortened Campaign)",{headless_moves:true});
    s.hand[0]=[142];s.hand[1]=[];return s}
test("public reaction bounds match the real d10 rule and distinguish one roll from empty-AA two rolls",()=>{
    const r=engine(),s=fixture(r),h=r.__reactionTest
    for(const mode of ["ops","event"]){
        const ctx={cardId:142,hqId:7,cardMode:mode,amphibious:true}
        const low=h.oracle(clone(s),mode==="event",false),high=h.oracle(clone(s),mode==="event",true)
        const defended=h.branch(clone(s),ctx)
        assert.deepEqual(defended.qRoll,{low,high});assert.deepEqual(defended.pTargetReinforcement,{low,high})
        const empty=h.branch(clone(s),ctx,{defended:false,special:true})
        assert.deepEqual(empty.pTargetReinforcement,{low:low*low,high:high*high})
        assert.deepEqual(h.branch(clone(s),ctx,{defended:false}).pTargetReinforcement,{low:0,high:0})
        assert.deepEqual(h.branch(clone(s),ctx,{hq:false}).pTargetReinforcement,{low:0,high:0})
        for(const intelligence of [h.constants.INTERCEPT,h.constants.AMBUSH,h.constants.SURPRISE])h.withCard(142,{intelligence},()=>{
            const q=h.branch(clone(s),ctx,{defended:false,special:true})
            if(mode==="ops")assert.deepEqual(q.pTargetReinforcement,empty.pTargetReinforcement)
            else assert.deepEqual(q.pTargetReinforcement,intelligence===h.constants.SURPRISE?{low:0,high:0}:{low,high})
        })
    }
    const crossed=h.branch(clone(s),{cardId:142,hqId:7,cardMode:"ops",amphibious:true},{zoi:true})
    assert.deepEqual(crossed.qRoll,{low:.8,high:.8})
})
test("specified optional EC previews are pure, retain real OPS reaction budgets and cannot inspect enemy hands",()=>{
    const r=engine(),s=fixture(r)
    const ask=(state,fn,args,role="Japan")=>{const before=JSON.stringify(state),out=r.query(state,role,{name:"rules_query",fn,args});
        assert.equal(JSON.stringify(state),before);return out}
    const ctx={cardId:142,hqId:7,cardMode:"event",amphibious:true}
    const ec=ask(s,"queryCardPreview",[142,ctx])
    assert.equal(ec.eligible,true);assert.equal(ec.activationBudget,6);assert.equal(ec.skippedOptionalPhase,"paratroopers")
    const changed=clone(s);changed.hand[1]=[1,2,3,4,5]
    assert.deepEqual(ask(s,"queryPublicReactionChance",[452,ctx]),ask(changed,"queryPublicReactionChance",[452,ctx]))
    assert.equal(ask(s,"queryPublicReactionChance",[452,ctx],"Allies").eligible,false)
    const oc=ask(s,"queryReactionCandidates",[{reactionFaction:1,targetHex:452,targetOnly:true,cardContext:{...ctx,cardMode:"ops"}}])
    const reaction=ask(s,"queryReactionCandidates",[{reactionFaction:1,targetHex:452,targetOnly:true,cardContext:ctx}])
    assert.deepEqual(reaction.hqOptions,oc.hqOptions,"defender logistics are OPS in both modes")
    r.__reactionTest.withCard(142,{after_movement:()=>{}},()=>assert.equal(ask(s,"queryCardPreview",[142,ctx]).eligible,false))
})
test("Balikpapan invasion preserves strong cover under its real EC budget and executes the optional skip",()=>{
    const r=engine(),f=JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/japan-balikpapan-public.json")))
    let s=r.setup(1,f.baseSetup.scenario,f.baseSetup.options);r.__coverFixture(s,f)
    s.hand[0]=[142]
    const before=JSON.stringify(s),tasks=r.__coverTasks(s,"event")
    assert.equal(JSON.stringify(s),before)
    const ordinary=tasks.find(t=>t.movementUnitIds.includes(34)&&t.movementUnitIds.includes(14)
        &&t.assessment.pCapture>=.75)
    assert(ordinary,"a strong army with air/carrier cover is not replaced by two unnecessary weak armies")
    assert(ordinary.assessment.reactionWeight>0,"real public HQ reactions cannot silently become zero")
    assert.equal(ordinary.assessment.reactionBudget,5)
    assert(ordinary.assessment.pNavalWithReaction>0)
    const converging=tasks.find(t=>t.movementGroups?.some(g=>g.mode==="NAVAL")&&t.assessment.pCapture>=.75)
    assert(converging,"an independent surface fleet can join the amphibious battle")
    assert(ordinary.requiredUnits.length<=6)
    const act=(action,argument)=>{validateAction(r.view(s,"Japan"),{action,argument});s=r.action(s,"Japan",action,argument)}
    act("card",142);act("event");act("unit",7)
    for(const id of ordinary.requiredUnits)act("unit",id)
    act("done");assert.equal(s.L.P,"paratroopers")
    const decision=r.bots["erasmus-japan-campaign"].decide(r.view(s,"Japan"),{role:"Japan",gameKey:"cover",actionOrdinal:0})
    assert.equal(decision.action,"skip");act("skip")
    assert.equal(s.L.P,"move_offensive_units")
    act("advance",{...ordinary,campaignTask:true,focus:452,targetMeta:[{...ordinary,campaignTask:true}],chain:[452]})
    assert.equal(s.location[34],452);assert.equal(s.location[14],452)
    assert.equal(s.asp[0][1],ordinary.aspCost,"the landing spends only its actual ground ASP")
})
