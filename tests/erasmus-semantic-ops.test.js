"use strict"
const assert=require("assert")
const fs=require("fs")
const vm=require("vm")
const path=require("path")
const pieces=[{},
    {faction:1,class:"ground",service:"army",cf:12},
    {faction:1,class:"ground",service:"du",cf:12},
    {faction:1,class:"air",service:"army",cf:8},
    {faction:1,class:"naval",service:"navy",type:"cv",cf:12},
    {faction:1,class:"naval",service:"navy",type:"cv",cf:12}]
const owners=new Map([[10,1],[11,1],[20,0],[21,0],[22,0]])
const ctx={JP:0,AP:1,LAST_BOARD_HEX:100,pieces,
    G:{location:[-1,10,10,11,10,11],reduced:[1],supply_cache:{}},
    get_distance:(a,b)=>Math.abs(a-b),get_map_data:()=>({port:true}),
    is_space_controlled:(h,f)=>owners.get(h)===f,has_zoi:()=>false}
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.join(__dirname,"../js/server/erasmus_ops.js"),"utf8")+
    ";this.api={set:eop_set_strategy_chain,pending:eop_target_pending,match:eop_unit_matches_target,activation:eop_activation_focus_faction,next:eop_next_focus_faction,compose:composeTaskForce,focus:eop_focus};",ctx)
const api=ctx.api
const req={kind:"GARRISON",garrisonRequirement:{groundSteps:3,airSteps:1,operator:"OR"}}
assert.equal(api.pending("Allies",10,req),false,"one reduced plus one full ground unit supply three steps")
ctx.G.location[2]=11
assert.equal(api.pending("Allies",10,req),true,"one reduced unit does not satisfy three steps")
ctx.G.location[3]=10
assert.equal(api.pending("Allies",10,req),false,"air branch independently satisfies OR")
assert.equal(api.pending("Allies",20,req),false,"hostile garrison target is ignored")
assert.equal(api.match(2,"Allies",{unitFilter:"COMMONWEALTH_OR_US_ARMY"},10),false)
assert.equal(api.match(1,"Allies",{unitFilter:"COMMONWEALTH_OR_US_ARMY"},10),true)
const redeploy={hex:11,kind:"REDEPLOY",requiredUnits:[1],requiresFriendlyControl:true}
api.set("Allies",{chain:[11],targetMeta:[redeploy]})
assert.equal(api.focus("Allies"),11,"friendly relocation target remains pending for designated unit")
let view={active:"Allies",ai:{units:pieces.map((p,id)=>({...p,id,location:ctx.G.location[id]}))},offensive:{active_units:[]}}
assert.equal(api.compose(11,null,null,view,[2,3],"Allies").unit,undefined,"wrong unit cannot replace designated evacuee")
assert.equal(api.compose(11,null,null,view,[1,2,3],"Allies").unit,1)
api.set("Allies",{chain:[11,10],targetMeta:[redeploy,{hex:10,kind:"REDEPLOY",requiredUnits:[2]}]})
view.offensive.active_units=[[1]]
assert.equal(api.activation(1,1,view,[1,2,3]),10,"selected evacuee releases next designated relocation")
view.offensive.active_units=[]
assert.equal(api.activation(1,0,view,[2,3]),10,"unavailable evacuee does not strand other legal relocations")
view.offensive.active_units=[[1,2]]
assert.equal(api.activation(1,2,view,[3]),null,"completed relocation scheduling closes rather than selecting unrelated units")
view.offensive.active_units=[]
api.set("Allies",{chain:[20,21,22],targetMeta:[20,21,22].map(hex=>({hex,strictSequential:true}))})
assert.equal(api.activation(1,8),20,"extra activations cannot skip unresolved island")
assert.equal(api.next(1,[20]),null,"declared battle is not capture")
api.set("Allies",{chain:[20,21,22],targetMeta:[{hex:20,targetGroup:1},{hex:21,targetGroup:1},{hex:22,targetGroup:2}]})
assert.equal(api.next(1,[20]).hex,21,"same group permits another target")
assert.equal(api.next(1,[20,21]),null,"unresolved first group blocks next group")
owners.set(20,1);owners.set(21,1)
assert.equal(api.activation(1,8),22,"completed group releases next group")
const orange={hex:11,kind:"REDEPLOY",escortPairs:[{ground:1,carrier:4,origin:10}],maxDistance:15,requiresFriendlyControl:true}
api.set("Allies",{chain:[11],targetMeta:[orange]})
assert.equal(api.compose(11,null,null,view,[1],"Allies").unit,undefined,"convoy requires both units available")
assert.equal(api.compose(11,null,null,view,[1,4],"Allies").unit,1)
view.offensive.active_units=[[1]]
assert.equal(api.compose(11,null,null,view,[4],"Allies").unit,4,"second activation must be escort")
ctx.G.location[4]=12
assert.equal(api.match(1,"Allies",orange,11),false,"split convoy is illegal")
console.log("Erasmus semantic operational consumer tests passed")
