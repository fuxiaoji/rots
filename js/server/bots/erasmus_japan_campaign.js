// Cover the central Pacific approach while keeping southern conquest distinct.
function ej_island_defense(view,board,units) {
    const ring=typeof hex_to_int==="function" ? [2909,3009,3209,3709,3813,3814].map(hex_to_int) : []
    return board.filter(m=>ring.includes(m.hex) && ec_control(m.hex,0)).map(m=>{
        const ground=units.filter(u=>u.faction===0 && u.class==="ground" && u.location===m.hex)
            .sort((a,b)=>ec_cf(a)-ec_cf(b)||a.id-b.id)
        const assault=units.some(u=>u.faction===1 && u.class==="ground" && ec_dist(u.location,m.hex)<=8
            && (ec_dist(u.location,m.hex)<=2 || units.some(n=>n.faction===1 && n.class==="naval" && n.location===u.location)))
        return {hex:m.hex,name:m.name,groundCount:ground.length,reserveId:ground[0]?.id ?? null,
            priority:100+(Number(view.turn)>=5 ? 170 : 0)+(assault ? 180 : 0),threatened:assault}
    }).sort((a,b)=>b.priority-a.priority||a.hex-b.hex)
}
function ej_defense_tasks(env,defense) {
    const tasks=[]
    for (const gap of defense.filter(d=>d.groundCount===0)) {
        for (const u of env.available.filter(u=>u.class==="ground" && !env.garrisonReserve.has(u.id))) {
            const ground=ec_query_moves([u.id],GROUND_MOVE,env).reachableHexes?.includes(gap.hex)
            const strategic=!ground && u.stratMove && ec_query_moves([u.id],STRAT_MOVE,env).reachableHexes?.includes(gap.hex)
            let group=[u],mode=ground?"GROUND":strategic?"STRATEGIC":null,aspCost=0
            // Friendly empty coastal hexes permit solo ASP transport (8.45).
            // A normal escort can actually block the no-port landing branch.
            // Ask the engine first; never grant strategic airfield transport.
            if (!mode && (u.asp || u.aspCost)) {
                if (!env.units.some(x=>x.faction!==0 && x.location===gap.hex)) {
                    const solo=ec_query_moves([u.id],AMPH_MOVE,env)
                    if (solo.reachableHexes?.includes(gap.hex)) {
                        mode="AA";aspCost=Number(solo.aspCost || 0)
                    }
                }
                const navy=env.available.filter(n=>n.class==="naval" && n.location===u.location)
                    .sort((a,b)=>ec_cf(a)-ec_cf(b)||a.id-b.id)
                for (const escort of mode ? [] : navy) {
                    const force=[u,escort]
                    if (force.length>env.budget || !ec_service_compatible(force,env.view,0)) continue
                    const reach=ec_query_moves(force.map(x=>x.id),AMPH_MOVE,env)
                    if (!reach.reachableHexes?.includes(gap.hex)) continue
                    group=force;mode="AA";aspCost=Number(reach.aspCost || 0);break
                }
            }
            if (!mode || group.length>env.budget || aspCost>ec_asp_remaining(env.view,0)) continue
            const at=env.units.filter(x=>x.faction===0 && x.location===gap.hex && (x.class==="ground" || x.class==="air"))
            if (at.length>=3 || typeof queryProjectedStack==="function"
                && !queryProjectedStack(gap.hex,group.map(x=>x.id),{faction:0}).fitsForIncoming) continue
            tasks.push(ec_make_task("REDEPLOY",gap.hex,group,[],mode,env,
                {score:gap.priority-ec_dist(u.location,gap.hex)*2-ec_cf(u)*.25,
                    aspCost,objective:"PACIFIC_ISLAND_GARRISON",followUpTarget:gap.hex,defenseEvidence:gap}))
        }
    }
    return tasks
}

// AI-WIN-03: Japanese public-view southern campaign. Shared helpers keep
// card/HQ/ISR/ASP/movement/combat legality in the existing rule queries.
"use strict"

function ej_nations(view) {
    return [
        { name: "PHILIPPINES", deadline: 4, priority: 700 },
        { name: "MALAYA", deadline: 4, priority: 650 },
        { name: "DEI", deadline: 6, priority: 380 },
    ].map(spec => {
        const nation = nations[spec.name], keys = nation.keys.map(hex_to_int)
        const missingKeys = keys.filter(h => !ec_control(h, 0))
        return { ...spec, id: nation.id, keys, missingKeys,
            surrenderedTurn: Number(view.surrender?.[nation.id] || 0),
            status: view.surrender?.[nation.id] ? "surrendered" : missingKeys.length ? "capture-required" : "await-national-status" }
    })
}

// A surface fleet can enter the same battle independently of the landing
// stack. Do not spend its activation slot on an unnecessary second army.
function ej_amphibious_naval_convergence(env, attacks) {
    const tasks=[],safe=new Set(attacks.filter(t=>t.assessment?.pCapture>=t.assessment?.desiredProbability).map(t=>t.hex))
    const grounds=env.available.filter(u=>u.class==="ground"&&(u.asp||u.aspCost)&&!env.garrisonReserve.has(u.id))
        .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,10)
    for(const origin of [...new Set(grounds.map(u=>u.location))]) {
        const land=grounds.filter(u=>u.location===origin).slice(0,3)
        const escorts=env.available.filter(u=>u.class==="naval"&&u.location===origin)
            .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,4)
        for(const lead of land)for(let ng=1;ng<=land.length;ng++)for(let ns=1;ns<=Math.min(2,escorts.length);ns++) {
            const ground=[lead,...land.filter(u=>u.id!==lead.id)].slice(0,ng),landing=ground.concat(escorts.slice(0,ns))
            if(landing.length>=env.budget||!ec_service_compatible(landing,env.view,env.faction))continue
            const aa=ec_query_moves(landing.map(u=>u.id),AMPH_MOVE,env)
            if(Number(aa.aspCost||0)>ec_asp_remaining(env.view,env.faction))continue
            for(const hex of (aa.reachableHexes||[]).filter(h=>env.captureTargets.has(h)&&!safe.has(h))) {
                const remote=env.available.filter(u=>u.class==="naval"&&u.location!==origin&&u.location!==hex
                    &&ec_service_compatible(landing.concat(u),env.view,env.faction)
                    &&ec_query_moves([u.id],NAVAL_MOVE,env).reachableHexes?.includes(hex))
                    .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,4)
                const fleets=remote.map(u=>[u])
                for(let a=0;a<remote.length;a++)for(let b=a+1;b<remote.length;b++)fleets.push([remote[a],remote[b]])
                for(const fleet of fleets) {
                    const force=landing.concat(fleet)
                    if(force.length>env.budget||!ec_service_compatible(force,env.view,env.faction))continue
                    const at=env.units.filter(u=>u.faction===env.faction&&u.location===hex)
                    if(ground.length+at.filter(u=>u.class==="ground"||u.class==="air").length>3
                        ||force.filter(u=>u.class==="naval").length+at.filter(u=>u.class==="naval").length>6)continue
                    const movementGroups=[{originHex:origin,mode:"AA",unitIds:landing.map(u=>u.id)}]
                    for(const from of [...new Set(fleet.map(u=>u.location))]) {
                        const unitIds=fleet.filter(u=>u.location===from).map(u=>u.id)
                        if(ec_query_moves(unitIds,NAVAL_MOVE,env).reachableHexes?.includes(hex))
                            movementGroups.push({originHex:from,mode:"NAVAL",unitIds})
                    }
                    if(movementGroups.flatMap(g=>g.unitIds).length!==force.length)continue
                    let support=ec_support(force,hex,env),assessment=ec_assess(force,support,hex,true,env)
                    if(!assessment.executable)continue
                    while(support.length) {
                        const reduced=ec_assess(force,support.slice(0,-1),hex,true,env)
                        if(!reduced.executable||reduced.pCapture<Math.min(assessment.pCapture,assessment.desiredProbability))break
                        support.pop();assessment=reduced
                    }
                    tasks.push(ec_make_task("CONQUEST",hex,force,support,"AA",env,
                        {score:ec_score_target(env.byHex.get(hex),env)*assessment.pCapture-(force.length+support.length)*2
                            -ec_dist(origin,hex)-Math.max(0,assessment.desiredProbability-assessment.pCapture)*40,
                            assessment,aspCost:Number(aa.aspCost||0),movementGroups,
                            declaresBattle:assessment.defendingGround>0||env.units.some(u=>u.faction!==env.faction&&u.location===hex),
                            objective:"SOUTHERN_CONQUEST"}))
                }
            }
        }
    }
    return tasks
}

// Inland key hexes can lie behind an unnamed hex. A legal ground advance
// must shorten the route; moving between rear ports is not campaign progress.
function ej_java_advances(env, keys, priority) {
    const tasks = []
    // Route terrain includes unnamed hexes omitted from the strategic target
    // map. They remain intermediate positions, never extra national keys.
    const region=hex=>env.byHex.get(hex)?.region ?? (typeof get_map_data==="function"?get_map_data(hex)?.region:null)
    const ground=env.available.filter(u=>u.class==="ground" && region(u.location)==="Java"
        && !env.garrisonReserve.has(u.id)).sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id)
    const seen=new Set()
    for (const origin of [...new Set(ground.map(u=>u.location))]) {
        const local=ground.filter(u=>u.location===origin).slice(0,3)
        for (const lead of local) {
        const compatible=[lead,...local.filter(u=>u.id!==lead.id && ec_service_compatible([lead,u],env.view,env.faction))]
        for (let count=1;count<=Math.min(compatible.length,env.budget);count++) {
        const group=compatible.slice(0,count),id=group.map(u=>u.id).sort((a,b)=>a-b).join(":")
        if (seen.has(id) || !ec_service_compatible(group,env.view,env.faction)) continue
        seen.add(id)
        const moves = ec_query_moves(group.map(u=>u.id),GROUND_MOVE,env)
        for (const hex of moves.reachableHexes || []) {
            if (region(hex)!=="Java" || env.captureTargets.has(hex)) continue
            if (env.units.some(x=>x.faction!==env.faction && x.location===hex)) continue
            if (group.length+env.units.filter(x=>x.faction===env.faction && x.location===hex
                && (x.class==="ground"||x.class==="air")).length>3) continue
            if (!ec_control(hex,env.faction) && typeof queryDefendingGround==="function"
                && queryDefendingGround(hex,{faction:1-env.faction})?.units?.length) continue
            const key = keys.filter(h=>ec_dist(hex,h)<ec_dist(origin,h))
                .sort((a,b)=>ec_dist(hex,a)-ec_dist(hex,b)||a-b)[0]
            if (key===undefined || env.redeployments.some(x=>group.some(u=>u.id===x.unit) && x.from===hex && x.to===origin)) continue
            tasks.push(ec_make_task(ec_control(hex,env.faction)?"REDEPLOY":"CONQUEST",hex,group,[],"GROUND",env,
                {score:priority*.6+(ec_dist(origin,key)-ec_dist(hex,key))*12
                    +Math.min(40,group.reduce((sum,u)=>sum+ec_cf(u),0))*.35-group.length,
                    aspCost:0,declaresBattle:false,objective:"SOUTHERN_ADVANCE",followUpTarget:key}))
        }
        }
        }
    }
    return tasks
}

// AA transport can legally reinforce friendly coastal airfields without a
// port. Only known own cards and the current public board support this
// preparation estimate; both later actions still need actual rule queries.
function ej_bridgehead_reinforcements(env, targetNation, priority, attacks=[]) {
    if (typeof queryGroundPreparation!=="function") return []
    const nextCards=(env.view.ai?.ownCards || []).filter(c=>c.id!==env.cardId && c.allowed?.includes("ops"))
    if (!nextCards.length) return []
    const hqs=env.units.filter(h=>h.faction===env.faction && h.class==="hq" && !env.view.oos?.includes(h.id))
    const ground=env.available.filter(u=>u.class==="ground" && (u.asp || u.aspCost) && ec_cf(u)>=8
        && !env.garrisonReserve.has(u.id)).sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,10)
    const aspBudget=ec_asp_remaining(env.view,env.faction)
    const tasks=[]
    const sufficient=new Set(attacks.filter(t=>t.kind==="CONQUEST" && t.assessment.pCapture>=t.assessment.desiredProbability).map(t=>t.hex))
    for (const [key] of targetNation) for (const port of env.board.filter(m=>!sufficient.has(key) && (m.port || m.airfield)
        && ec_control(m.hex,env.faction) && m.hex!==key && m.region===env.byHex.get(key)?.region && ec_dist(m.hex,key)<=6)) {
        const occupants=env.units.filter(u=>u.faction===env.faction && u.location===port.hex && ["ground","air"].includes(u.class))
        const room=3-occupants.length
        if (room<1) continue
        const candidates=ground.filter(u=>u.location!==port.hex && env.byHex.get(u.location)?.region!==port.region
            && ec_query_moves([u.id],AMPH_MOVE,env).reachableHexes?.includes(port.hex))
        const arrivals=candidates.map(u=>[u])
        if (room>=2) for (let i=0;i<candidates.length;i++) for(let j=i+1;j<candidates.length;j++) arrivals.push([candidates[i],candidates[j]])
        let best=null
        for (const arriving of arrivals) {
            if (arriving.length>room || arriving.length>env.budget || !ec_service_compatible(arriving,env.view,env.faction)) continue
            const movementGroups=[], seenOrigins=new Set();let cost=0
            for (const u of arriving) {
                if (seenOrigins.has(u.location)) continue
                seenOrigins.add(u.location)
                const local=arriving.filter(x=>x.location===u.location), reach=ec_query_moves(local.map(x=>x.id),AMPH_MOVE,env)
                if (!reach.reachableHexes?.includes(port.hex)) break
                cost+=Number(reach.aspCost || 0)
                movementGroups.push({originHex:u.location,mode:"AA",unitIds:local.map(x=>x.id)})
            }
            if (cost>aspBudget || movementGroups.flatMap(g=>g.unitIds).length!==arriving.length) continue
            for (const card of nextCards) for (const hq of hqs) {
                const ctx={faction:env.faction,cardId:card.id,hqId:hq.id,cardMode:"ops"}
                env.preparationRoutes ||= new Map()
                const routes=arriving.map(u=>{
                    const cacheKey=[u.id,port.hex,key,card.id,hq.id].join(":")
                    if (!env.preparationRoutes.has(cacheKey)) env.preparationRoutes.set(cacheKey,queryGroundPreparation(u.id,port.hex,key,ctx))
                    return env.preparationRoutes.get(cacheKey)
                })
                if (routes.some(r=>!r.eligible || !r.reachable)) continue
                env.preparationEnvs ||= new Map()
                const nextKey=[card.id,hq.id].join(":")
                if (!env.preparationEnvs.has(nextKey)) {
                    const preview=queryCardPreview(card.id,ctx)
                    env.preparationEnvs.set(nextKey,{...env,hq,cardId:card.id,cardMode:"ops",budget:preview.activationBudget,
                        available:env.units.filter(u=>preview.units?.includes(u.id)),moves:new Map(),reactions:new Map()})
                }
                const next=env.preparationEnvs.get(nextKey)
                const existing=next.available.filter(u=>u.faction===env.faction && u.class==="ground"
                    && !arriving.some(a=>a.id===u.id) && !env.garrisonReserve.has(u.id)
                    && ec_query_moves([u.id],GROUND_MOVE,next).reachableHexes?.includes(key))
                    .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,Math.max(0,3-arriving.length))
                const defenders=env.units.filter(u=>u.faction===env.faction && u.location===key && ["ground","air"].includes(u.class))
                for (let count=0;count<=Math.min(existing.length,next.budget-arriving.length);count++) {
                const force=arriving.map(u=>({...u,location:port.hex})).concat(existing.slice(0,count))
                if (force.length+defenders.length>3 || force.length>next.budget || !ec_service_compatible(force,env.view,env.faction)) continue
                const support=ec_support(force,key,next), assessment=ec_assess(force,support,key,false,next)
                if (!assessment.executable) continue
                const priorForce=existing.slice(0,count), prior=ec_assess(priorForce,ec_support(priorForce,key,next),key,false,next)
                if (prior.executable && prior.pCapture>=assessment.pCapture-.05) continue
                const score=priority(key)*.82+assessment.pCapture*24-cost*4-arriving.length*2
                if (!best || score>best.score) best=ec_make_task("REDEPLOY",port.hex,arriving,[],"AA",env,
                    {score,aspCost:cost,declaresBattle:false,objective:"SOUTHERN_REINFORCE",followUpTarget:key,movementGroups,
                        preparation:{evidence:"friendly-arrival-estimate; recheck after transport",cardId:card.id,hqId:hq.id,
                            activationBudget:next.budget,attackingGround:assessment.attackingGround,pCaptureEstimate:assessment.pCapture,
                            requiredGroundIds:force.map(u=>u.id),supportIds:support.map(u=>u.id)}})
                }
            }
        }
        if (best) tasks.push(best)
    }
    return tasks
}

function ej_invasion_assembly(env,targetNation,priority) {
    if (typeof queryAmphibiousPreparation!=="function") return []
    const targets=[...targetNation.keys()].filter(h=>env.byHex.get(h)?.region==="Java" && env.byHex.get(h)?.port)
    if (!targets.length || env.board.some(m=>m.region==="Java" && m.port && ec_control(m.hex,env.faction))) return []
    const nextCards=(env.view.ai?.ownCards || []).filter(c=>c.id!==env.cardId).flatMap(c=>[
        ...(c.allowed?.includes("ops")?[{...c,mode:"ops"}]:[]),
        ...(c.previewEvent && c.allowed?.includes("event")?[{...c,mode:"event"}]:[])])
        .sort((a,b)=>Number(b.mode==="event"?b.logistic:b.ops)-Number(a.mode==="event"?a.logistic:a.ops)||a.id-b.id)
        .filter((c,i,cs)=>c.mode==="event" || cs.findIndex(x=>x.mode==="ops" && x.ops===c.ops)===i)
    const hqs=env.units.filter(h=>h.faction===env.faction && h.class==="hq" && !env.view.oos?.includes(h.id))
    const armies=env.units.filter(u=>u.faction===env.faction && u.class==="ground" && (u.asp || u.aspCost)
        && ec_cf(u)>=8 && !env.garrisonReserve.has(u.id)).sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,8)
    const aspBudget=ec_asp_remaining(env.view,env.faction),tasks=[]
    const ports=env.board.filter(m=>m.port && m.region!=="Java" && ec_control(m.hex,env.faction)
        && targets.some(h=>ec_dist(m.hex,h)<=10)
        && env.units.filter(n=>n.faction===env.faction && n.class==="naval" && n.location===m.hex).length>=2)
        .sort((a,b)=>Math.min(...targets.map(h=>ec_dist(a.hex,h)))-Math.min(...targets.map(h=>ec_dist(b.hex,h)))||a.hex-b.hex).slice(0,4)
    for (const port of ports) {
        const occupants=env.units.filter(u=>u.faction===env.faction && u.location===port.hex && ["ground","air"].includes(u.class))
        const candidates=armies.filter(g=>g.location===port.hex || env.available.some(u=>u.id===g.id)
            && ec_query_moves([g.id],STRAT_MOVE,env).reachableHexes?.includes(port.hex))
        const fleet=env.units.filter(n=>n.faction===env.faction && n.class==="naval" && n.location===port.hex)
            .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id)
        const carrier=fleet.find(n=>Number(n.br)>0),orders=[fleet]
        if (carrier && carrier!==fleet[0]) orders.push([carrier,...fleet.filter(n=>n.id!==carrier.id)])
        for (let i=0;i<candidates.length;i++) for (let j=i+1;j<candidates.length;j++) {
            const ground=[candidates[i],candidates[j]],arriving=ground.filter(g=>g.location!==port.hex)
            if (!arriving.length || arriving.length>env.budget || occupants.length+arriving.length>3
                || !ec_service_compatible(ground,env.view,env.faction)) continue
            const groups=[...new Set(arriving.map(g=>g.location))].map(origin=>({originHex:origin,mode:"STRATEGIC",
                unitIds:arriving.filter(g=>g.location===origin).map(g=>g.id)}))
            if (groups.some(g=>!ec_query_moves(g.unitIds,STRAT_MOVE,env).reachableHexes?.includes(port.hex))) continue
            let best=null
            for (const target of targets) for (const card of nextCards) for (const hq of hqs) {
                if (card.mode==="event" && card.hq?.length && !card.hq.includes(hq.id)) continue
                for (const order of orders) for (let count=1;count<=Math.min(4,order.length);count++) {
                    const escorts=order.slice(0,count),force=ground.concat(escorts)
                    if (!ec_service_compatible(force,env.view,env.faction)) continue
                    env.invasionPreparations ||= new Map()
                    const key=[port.hex,target,card.id,card.mode,hq.id,...force.map(u=>u.id)].join(":")
                    if (!env.invasionPreparations.has(key)) env.invasionPreparations.set(key,queryAmphibiousPreparation(force.map(u=>u.id),
                        port.hex,target,{faction:env.faction,cardId:card.id,cardMode:card.mode,hqId:hq.id}))
                    const proof=env.invasionPreparations.get(key)
                    if (!proof.eligible || !proof.reachable || proof.aspCost>aspBudget || force.length>proof.activationBudget) continue
                    const units=env.units.map(u=>ground.some(g=>g.id===u.id)?{...u,location:port.hex}:u)
                    const next={...env,units,hq,cardId:card.id,cardMode:card.mode,budget:proof.activationBudget,
                        available:units.filter(u=>proof.units.includes(u.id)),moves:new Map(),reactions:new Map()}
                    const support=units.filter(u=>proof.supportIds?.includes(u.id) && !u.b29
                        && ec_service_compatible(force.concat(u),env.view,env.faction))
                        .sort((a,b)=>Number(proof.effectiveSupportCF?.[b.id]??ec_battle_cf(b,target))
                            -Number(proof.effectiveSupportCF?.[a.id]??ec_battle_cf(a,target))||a.id-b.id)
                        .slice(0,proof.activationBudget-force.length)
                    const assessment=ec_assess(ground.map(g=>({...g,location:port.hex})).concat(escorts),support,target,true,next)
                    if (!assessment.executable) continue
                    const score=priority(target)*.82+assessment.pCapture*24-arriving.length*2
                    if (!best || score>best.score) best=ec_make_task("REDEPLOY",port.hex,arriving,[],"STRATEGIC",env,
                        {score,aspCost:0,declaresBattle:false,objective:"SOUTHERN_INVASION_ASSEMBLE",followUpTarget:target,movementGroups:groups,
                            preparation:{evidence:"known-card projected AA; recheck after actual transport",cardId:card.id,cardMode:card.mode,hqId:hq.id,
                                requiredGroundIds:ground.map(g=>g.id),escortIds:escorts.map(n=>n.id),supportIds:support.map(u=>u.id),
                                requiredActivations:force.length+support.length,activationBudget:proof.activationBudget,
                                aspCost:proof.aspCost,amphibiousPath:proof.path,pCaptureEstimate:assessment.pCapture}})
                }
            }
            if (best) tasks.push(best)
        }
    }
    return tasks
}

function ej_plan(view, context) {
    const role = "Japan", faction = 0, turn = Number(view.turn || 0)
    const units = (view.ai?.units || []).map(u => ({ ...u }))
    const board = ec_map(), byHex = new Map(board.map(m => [m.hex, m])), national = ej_nations(view)
    const opening=typeof SHORT_CAMPAIGN_SCENARIO==="undefined" || view.sid===SHORT_CAMPAIGN_SCENARIO
    const defense=ej_island_defense(view,board,units)
    const targetNation = new Map(opening ? national.flatMap(n => n.missingKeys.map(hex => [hex, n])) : [])
    const dei = national.find(n=>n.name === "DEI")
    const javaPending = opening && dei.missingKeys.some(hex=>byHex.get(hex)?.region === "Java")
    const javaPorts = board.filter(m=>m.region === "Java" && m.port && ec_control(m.hex, faction))
    // A national key list omits the landing gateway. Evaluate a port on the
    // same island before repeatedly assaulting inland keys from overseas.
    if (javaPending && !javaPorts.length) for (const m of board.filter(m=>m.region === "Java" && m.port
        && !ec_control(m.hex,faction) && !targetNation.has(m.hex)))
        targetNation.set(m.hex,{...dei, priority:dei.priority+80, gateway:true})
    const captureTargets = new Set(targetNation.keys()), prior = view.ai?.plan
    const continuation=(prior?.tasks || []).find(t=>["SOUTHERN_REINFORCE","SOUTHERN_INVASION_ASSEMBLE"].includes(t.objective)
        && targetNation.has(t.followUpTarget) && ec_task_complete(t,view,faction))
    const previous = prior?.campaign?.objectiveHex
    const targetPriority = hex => {
        const n = targetNation.get(hex)
        return n ? n.priority + (turn >= n.deadline - 1 ? 100 : 0) + (n.missingKeys.length === 1 ? 35 : 0) : 0
    }
    const objective = [...captureTargets].sort((a,b) => targetPriority(b)-targetPriority(a)
        || Number(b===previous)-Number(a===previous) || a-b)[0] ?? null
    const preCard = ec_card_window(view), choosingHq = /choose hq/i.test(String(view.prompt || ""))
    const currentCard = ec_offensive_key(view, role), ownCards = view.ai?.ownCards || []
    const legalCards = new Set(view.actions?.card || [])
    const cardChoices = preCard ? ownCards.filter(c => legalCards.has(c.id)).flatMap(c => [
        ...(c.allowed?.includes("ops") ? [{ ...c, mode: "ops" }] : []),
        ...(c.previewEvent && c.allowed?.includes("event") ? [{ ...c, mode: "event" }] : []),
    ]) : [{ ...(prior?.cardId === currentCard ? prior.cardSpec : {}), id: currentCard,
        mode: typeof EC !== "undefined" && view.offensive?.type === EC ? "event" : "ops" }]
    const hqIds = choosingHq && Array.isArray(view.actions?.unit) ? new Set(view.actions.unit) : null
    let hqs = units.filter(u => u.faction === faction && u.class === "hq"
        && !view.oos?.includes(u.id) && (!hqIds || hqIds.has(u.id)))
    const activeHq = view.offensive?.active_hq?.[faction]
    if (!preCard && !choosingHq && activeHq) hqs = hqs.filter(h => h.id === activeHq)
    const activeIds = new Set((view.offensive?.active_units?.[faction] || []).flat())
    const blockers = [], choices = [], pools = [], preparationRoutes=new Map(), preparationEnvs=new Map(),invasionPreparations=new Map(), redeployments = ec_redeploy_history(view, prior, faction)
    const projectedStackFits=new Map()
    const garrisonReserve = new Set(defense.filter(d=>d.reserveId!==null).map(d=>d.reserveId))
    // Hold completed national keys through their deadline. The opponent may
    // stage an amphibious attack from beyond nearby ground-unit range.
    for (const n of national.filter(n => opening && turn <= n.deadline && !n.missingKeys.length)) for (const hex of n.keys) {
        const ground = units.filter(u => u.faction === 0 && u.class === "ground" && u.location === hex)
        if (ground.length === 1) garrisonReserve.add(ground[0].id)
    }
    const victory = { national, jpResources: Number(view.ai?.victory?.jpResources || 0),
        homelandKeys: [], b29Bases: [], resourceTargets: [], atomic: null, blockade: null,
        routes: { homeland: { remainingKeys: [] }, headquarters: { enemyHqCount: 0, targets: [] } } }
    const promptBudget = String(view.prompt || "").match(/\d+\s+of\s+(\d+)/i)
    for (const card of cardChoices) for (const hq of hqs) {
        if (card.mode === "event" && card.hq?.length && !card.hq.includes(hq.id)) continue
        const preview = typeof queryCardPreview === "function" ? queryCardPreview(card.id,
            { faction, hqId: hq.id, cardMode: card.mode }) : null
        if (!preview?.eligible) { if (blockers.length < 16) blockers.push({ cardId: card.id, hq: hq.id,
            reason: preview?.reason || "card-preview-unavailable" }); continue }
        const available = units.filter(u => u.faction === faction && u.class !== "hq" && preview.units?.includes(u.id))
        const budget = promptBudget ? Number(promptBudget[1]) : Number(preview.activationBudget || 0)
        const env = { view, faction, units, board: board.filter(m => ec_control(m.hex, faction) || captureTargets.has(m.hex)),
            byHex, available, hq, budget, cardId: card.id, cardMode: preCard ? card.mode : undefined,
            powGap: 0, powPressure: 0, victory, axisTargets: captureTargets, captureTargets,
            redeployments, previousObjective: prior?.objective?.hex, campaignObjective: objective,
            homelandApproach: false, homelandRallyPort: null, homelandFoothold: false,
            moves: new Map(), reactions: new Map(), projectedStackFits, preparationRoutes, preparationEnvs,invasionPreparations, blockers, garrisonReserve, homeAssaults: new Map(),
            requireGroundReactionCover:true,publicReactionBounds:true,
            groundOrder: (a,b) => Math.min(...[...captureTargets].map(h => ec_dist(a.location,h)))
                - Math.min(...[...captureTargets].map(h => ec_dist(b.location,h))) || ec_cf(b)-ec_cf(a) || a.id-b.id,
            scoreTarget: m => targetPriority(m.hex) + (m.hex === objective ? 15 : 0)
                + (!units.some(u => u.faction !== faction && u.location === m.hex) ? 30 : 0),
            forceOpportunityCost: (group,m,assessment) => javaPending && m.region !== "Java"
                && targetNation.get(m.hex)?.name === "DEI" && assessment.defendingGround <= 4
                && group.some(u=>u.class==="ground" && ec_cf(u)>=12) ? 130 : 0 }
        const attack = ec_missions(env).concat(ec_ground_convergence(env),ec_amphibious_convergence(env))
        attack.push(...ej_amphibious_naval_convergence(env,attack))
        const transport = ec_transport(env).filter(t => captureTargets.has(t.followUpTarget))
            .map(t => ({ ...t, score: t.score + targetPriority(t.followUpTarget) * .12
                + (javaPending && t.objective==="AIR_SUPPORT_BASE" && dei.missingKeys.some(h=>byHex.get(h)?.region==="Java"
                    && ec_dist(t.hex,h)<=Math.max(...t.movementUnitIds.map(id=>Number(units.find(u=>u.id===id)?.br)||0))) ? 150 : 0),
                objective: "SOUTHERN_ASSEMBLE" }))
        transport.push(...ej_bridgehead_reinforcements(env,targetNation,targetPriority,attack))
        transport.push(...ej_invasion_assembly(env,targetNation,targetPriority))
        transport.push(...ej_defense_tasks(env,defense))
        if (javaPending) transport.push(...ej_java_advances(env,
            dei.missingKeys.filter(h=>byHex.get(h)?.region==="Java"),targetPriority(dei.missingKeys.find(h=>byHex.get(h)?.region==="Java"))))
        for (const n of national.filter(n=>opening && turn<=n.deadline && !n.missingKeys.length)) for (const hex of n.keys) {
            if (units.some(u=>u.faction===faction && u.class==="ground" && u.location===hex)) continue
            for (const u of available.filter(u=>u.class==="ground" && !garrisonReserve.has(u.id))) {
                const groundMove=ec_query_moves([u.id],GROUND_MOVE,env).reachableHexes?.includes(hex)
                const strategicMove=!groundMove && u.stratMove && ec_query_moves([u.id],STRAT_MOVE,env).reachableHexes?.includes(hex)
                if (!groundMove && !strategicMove) continue
                const at=units.filter(x=>x.faction===faction && x.location===hex && (x.class==="ground"||x.class==="air"))
                if(at.length>=3)continue
                transport.push(ec_make_task("REDEPLOY",hex,[u],[],groundMove?"GROUND":"STRATEGIC",env,
                    {score:n.priority*.9+Math.min(24,ec_cf(u))-ec_dist(u.location,hex)*2,
                        objective:"SOUTHERN_GARRISON",followUpTarget:hex}))
            }
        }
        if (javaPending) for (const port of javaPorts) {
            const at = units.filter(u=>u.faction===faction && u.location===port.hex && (u.class==="ground"||u.class==="air"))
            const ground = at.filter(u=>u.class==="ground")
            if (ground.length >= 2 && ground.reduce((s,u)=>s+ec_cf(u),0)>=24 || at.length>=3) continue
            for (const u of available.filter(u=>u.class==="ground" && u.stratMove && ec_cf(u)>=8
                && byHex.get(u.location)?.region!=="Java" && !garrisonReserve.has(u.id))) {
                if (!ec_query_moves([u.id],STRAT_MOVE,env).reachableHexes?.includes(port.hex)) continue
                const javaTarget = dei.missingKeys.filter(h=>byHex.get(h)?.region==="Java")
                    .sort((a,b)=>ec_dist(port.hex,a)-ec_dist(port.hex,b)||a-b)[0]
                if (javaTarget === undefined) continue
                transport.push(ec_make_task("REDEPLOY",port.hex,[u],[],"STRATEGIC",env,
                    {score:230+Math.min(30,ec_cf(u))-ec_dist(port.hex,javaTarget)*3,
                        objective:"SOUTHERN_ASSEMBLE",followUpTarget:javaTarget}))
            }
        }
        const ranked = attack.concat(transport).sort((a,b) => b.score-a.score
            || a.requiredUnits.length-b.requiredUnits.length || a.hex-b.hex || a.id.localeCompare(b.id))
        if (ranked.length) pools.push({card, hq, budget, ranked})
        else if (blockers.length < 16) blockers.push({ cardId: card.id, hq: hq.id, reason: "no-executable-southern-task" })
    }
    // Preserve a capture window that only one remaining card can execute.
    // Spending that card on a flexible task can make next-card convergence
    // impossible even though both tasks were legal when the hand was scored.
    const captureCards = new Map()
    for (const pool of pools) for (const t of pool.ranked.filter(t=>t.kind==="CONQUEST" && captureTargets.has(t.hex))) {
        if (!captureCards.has(t.hex)) captureCards.set(t.hex,new Set())
        captureCards.get(t.hex).add(pool.card.id)
    }
    for (const {card,hq,budget,ranked:raw} of pools) {
        const ranked = raw.map(t=>({...t, score:t.score+(preCard && ownCards.length>1 && t.kind==="CONQUEST"
            && captureCards.get(t.hex)?.size===1 && turn<=targetNation.get(t.hex)?.deadline
            ? targetPriority(t.hex)*.15 : 0)
            +(t.kind==="CONQUEST" && t.hex===continuation?.followUpTarget
                ? targetPriority(t.hex)*.2+(card.id===continuation.preparation?.cardId && hq.id===continuation.preparation?.hqId ? 25 : 0) : 0)})).sort((a,b)=>b.score-a.score
                || a.requiredUnits.length-b.requiredUnits.length || a.hex-b.hex || a.id.localeCompare(b.id))
        const assigned = new Set(activeIds), tasks = []
        const aspBudget = ec_asp_remaining(view,faction)
        let spent = 0, aspSpent = 0, battles = (view.offensive?.battle_hexes || []).length
        for (const task of ranked) {
            if (tasks.some(t => t.hex === task.hex) || task.requiredUnits.some(id => assigned.has(id))
                || spent + task.requiredUnits.length > budget || aspSpent + Number(task.aspCost || 0) > aspBudget
                || card.mode !== "event" && task.declaresBattle && battles > 0) continue
            const futureAsp=Math.max(0,...tasks.concat(task).map(t=>Number(t.preparation?.aspCost || 0)))
            if (aspSpent+Number(task.aspCost || 0)+futureAsp>aspBudget) continue
            if (!ec_service_compatible(tasks.flatMap(t => t.requiredUnits).concat(task.requiredUnits)
                .map(id => units.find(u => u.id === id)).filter(Boolean), view, faction)) continue
            tasks.push(task); task.requiredUnits.forEach(id => assigned.add(id))
            spent += task.requiredUnits.length; aspSpent += Number(task.aspCost || 0)
            if (task.declaresBattle) battles++
            if (tasks.length >= (card.mode === "event" ? 3 : 2)) break
        }
        if (tasks.length) choices.push({ cardId: card.id, cardMode: card.mode, cardSpec: card, hq: hq.id, budget, tasks,
            score: tasks[0].score + tasks.slice(1).reduce((sum,t) => sum+t.score*.4,0) })
    }
    choices.sort((a,b) => b.score-a.score || a.cardId-b.cardId || a.hq-b.hq)
    const best = choices[0], tasks = best?.tasks || [], first = tasks[0]
    const targets = tasks.map(t => ({ hex: t.hex, kind: t.kind, requiresOccupation: t.kind === "CONQUEST",
        requiresFriendlyControl: t.kind === "REDEPLOY", requiredUnits: t.requiredUnits.slice(),
        movementUnitIds: t.movementUnitIds.slice(), supportUnitIds: t.supportUnitIds.slice(),
        movementModes: t.movementModes.slice(), ...(t.movementGroups ? {movementGroups:t.movementGroups} : {}), campaignTask: true, taskId: t.id, objective: t.objective, damageLevel: 1 }))
    return { version: 1, role, turn, cardId: best?.cardId || currentCard, cardIntent: best?.cardMode || null, cardSpec: best?.cardSpec || null,
        preferredHq: best?.hq || null, activationBudget: best?.budget || 0,
        objective: { type: first ? first.objective==="PACIFIC_ISLAND_GARRISON" ? "PACIFIC_ISLAND_GARRISON" : "SOUTHERN_CONQUEST" : captureTargets.size ? "BLOCKED" : "AWAIT_NATIONAL_STATUS", hex: first?.followUpTarget ?? first?.hex ?? objective },
        phase: first ? first.kind === "CONQUEST" ? "CAPTURE" : "ASSEMBLE" : "BLOCKED",
        focus: first?.hex ?? null, targets, tasks, blockers, garrisonReserveIds: [...garrisonReserve].sort((a,b)=>a-b),
        campaign: { theater: first?.objective==="PACIFIC_ISLAND_GARRISON" ? "PACIFIC_DEFENSE" : "SOUTHERN", islandDefense:defense, objectiveHex: objective, rallyPort: null, redeployments,
            objectiveSinceTurn: previous === objective ? prior?.campaign?.objectiveSinceTurn ?? turn : turn },
        pow: { required: 0, held: 0, gap: 0, politicalWill: Number(view.political_will || 0), remainingCards: ownCards.length,
            remainingOffensives: ownCards.length, requiredCapturesPerCard: 0, quotaFeasibility: "not-applicable-to-japan" },
        victory, preCard, strategySource: "JAPAN_CAMPAIGN_PLANNER", rulesSource: "engine legality queries" }
}
