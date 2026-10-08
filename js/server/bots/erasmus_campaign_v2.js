// AI-CAMPAIGN-02: isolated 2.0 planner from afd11a2; legacy globals remain unchanged.
const EOTS_CAMPAIGN_V2 = (() => {
// BEGIN CAMPAIGN V2
function ec_refined() { return !!(typeof em_cfg==="function" && em_cfg()?.allies_campaign_refinement && em_cfg()?.campaign_planner) }
function ec_offensive_refined() { return ec_refined() && !!em_cfg()?.allies_campaign_offensive_refinement }
function ec_route_refined(view) {
    return ec_refined() && !!em_cfg()?.allies_route_commitment
        && typeof EVEN_SHORT_CAMPAIGN_SCENARIO!=="undefined" && view.sid===EVEN_SHORT_CAMPAIGN_SCENARIO
}
function ec_route_allows_atomic(view,board=ec_map()) {
    if (!ec_route_refined(view)) return true
    if (ec_manchuria_blocked(view,board)) return false
    const turn=Number(view.turn || 0), prior=view.ai?.plan
    const afterBombing=ec_card_window(view) || prior?.turn===turn
        && prior?.victory?.routes?.atomic?.status==="deadline-missed"
    return !((turn>9 || turn===9 && afterBombing) && !view.ai?.victory?.atomic?.noStrategicBombingFailure)
}
function ec_blockade_can_finish(view,blockade) {
    const turn=Number(view.turn || 0), next=Number(blockade?.nextJudgementTurn ?? turn), started=Number(blockade?.startedTurn || 0)
    return (started ? Math.max(next,started+2) : next+2)<=12
}
// AI-WIN-01: public-view campaign planning. This module never reads or writes G.
// ec_plan(view, context) -> JSON PlanContext v1. Legality remains in rules_query.
// ec_apply_plan updates only the ephemeral Erasmus strategy cache. The caller
// persists the returned plan in action metadata and projects it as view.ai.plan.
// ec_pick_action returns a legal card/HQ/activation action, or null for Erasmus.
"use strict"

function ec_enabled(role) {
    const c = typeof em_cfg === "function" ? em_cfg() : null
    return !!c && (role === "Allies" && !!c.campaign_planner
        || role === "Japan" && !!c.japan_campaign_planner)
}

// Enhanced strategy goals, separate from Erasmus charts and adjudication.
function ec_national_goals(view,faction) {
    if (typeof nations === "undefined" || typeof hex_to_int !== "function") return []
    return ["PHILIPPINES","MALAYA","DEI","BURMA"].map(name=>{
        const n=nations[name], keys=n.keys.map(hex_to_int)
        const missingKeys=keys.filter(hex=>!ec_control(hex,faction))
        const surrendered=!!view.surrender?.[n.id]
        return {name,id:n.id,keys,missingKeys,politicalWill:n.pw || 0,
            active:faction===0 ? !surrendered : surrendered,
            status:!missingKeys.length ? "await-national-status" : "capture-required"}
    })
}
function ec_national_bonus(hex,goals) {
    const n=goals.find(n=>n.active && n.missingKeys.includes(hex))
    return n ? 65 + (n.keys.length-n.missingKeys.length)*8
        + (n.missingKeys.length===1 ? 160 : n.missingKeys.length===2 ? 50 : 0) : 0
}
function ec_air_projection(env,options={}) {
    if (!env.airProjections || typeof queryCampaignAirProjection!=="function") return null
    const key=JSON.stringify(options)
    if (!env.airProjections.has(key)) {
        if (env.airProjections.size>=37) return null // baseline plus 36 preparation probes per plan
        env.airProjections.set(key,queryCampaignAirProjection({faction:env.faction,...(ec_offensive_refined()?{steadySupply:true}:{}),...options}))
    }
    const p=env.airProjections.get(key)
    return p?.eligible ? p : null
}
function ec_screen_gain(before,after,env) {
    if (!before || !after) return null
    const reopened=after.connectedResources.filter(h=>!before.connectedResources.includes(h))
    if (reopened.length) return null // never improve a local screen by reopening an actual route
    const cut=before.connectedResources.filter(h=>!after.connectedResources.includes(h))
    const routes=new Set(before.reachableSeaHexes), pureBefore=new Set(before.pureSeaHexes),pureAfter=new Set(after.pureSeaHexes)
    const endpoints=env.victory.blockade?.resources?.filter(r=>r.japanControlled).map(r=>r.hex)
        || env.victory.resourceTargets || []
    const relevant=h=>endpoints.some(r=>ec_dist(h,r)<=4)
        || typeof TOKYO!=="undefined" && ec_dist(h,TOKYO)<=8
    const gained=after.pureSeaHexes.filter(h=>!pureBefore.has(h) && routes.has(h) && relevant(h)).length
    const lost=before.pureSeaHexes.filter(h=>!pureAfter.has(h) && relevant(h)).length
    const supplied=before.ownOosIds.filter(id=>!after.ownOosIds.includes(id)).length
    const stranded=after.ownOosIds.filter(id=>!before.ownOosIds.includes(id)).length
    if (stranded>0 || !cut.length && gained<=lost && !supplied) return null
    return {cutResources:cut,newPureSeaHexes:gained,lostPureSeaHexes:lost,relievedOos:supplied,
        allDisconnected:after.connectedResources.length===0,
        score:cut.length*140 + (cut.length && !after.connectedResources.length ? 180 : 0)
            + Math.min(50,(gained-lost)*2) + Math.min(60,supplied*20)}
}
function ec_blockade_tasks(env) {
    const tasks=[]
    if (env.faction!==1 || Number(env.view.turn)<5 || env.victory.blockade?.applicable===false) return tasks
    if (ec_refined() && !ec_blockade_can_finish(env.view,env.victory.blockade)) return tasks
    const before=ec_air_projection(env)
    if (!before) return tasks
    const air=env.available.filter(u=>u.class==="air" && !u.b29 && !env.view.oos?.includes(u.id))
        .sort((a,b)=>a.id-b.id)
    for (const u of air) {
        const reach=ec_query_moves([u.id],STRAT_MOVE,env)
        const bases=(reach.reachableHexes || []).filter(hex=>hex!==u.location
            && env.byHex.get(hex)?.airfield && ec_control(hex,env.faction))
            .sort((a,b)=>Math.min(...before.connectedResources.map(h=>ec_dist(a,h)))
                - Math.min(...before.connectedResources.map(h=>ec_dist(b,h))) || a-b).slice(0,6)
        for (const hex of bases) {
            if (env.airProjections.size>=19) break // reserve probes for enemy neutralizers
            const occupants=env.units.filter(x=>x.id!==u.id && x.faction===env.faction && x.location===hex
                && (x.class==="air" || x.class==="ground"))
            if (occupants.length>=3) continue
            const after=ec_air_projection(env,{moves:[{unit:u.id,hex}]})
            if (!after || after.ownOosIds.includes(u.id)) continue
            const impact=ec_screen_gain(before,after,env)
            if (!impact) continue
            tasks.push(ec_make_task("REDEPLOY",hex,[u],[],"STRATEGIC",env,
                {score:55+impact.score,objective:"BLOCKADE_AIR_SCREEN",followUpTarget:hex,blockadeImpact:impact}))
        }
    }
    // Enemy br<6 aircraft neutralize AZOI. Clear every overlapping aircraft
    // in a target hex as an optimistic preparation witness, not a victory claim.
    const targets=[...new Set(env.units.filter(u=>u.faction!==env.faction && u.class==="air"
        && Number(u.br)>0 && Number(u.br)<6 && !env.view.oos?.includes(u.id)).map(u=>u.location))]
    for (const hex of targets) {
        const ids=env.units.filter(u=>u.faction!==env.faction && u.class==="air" && u.location===hex).map(u=>u.id)
        const impact=ec_screen_gain(before,ec_air_projection(env,{removeAirIds:ids}),env)
        if (!impact) continue
        const support=ec_support([],hex,env)
        if (!support.length) continue
        const assessment=ec_assess([],support,hex,false,env)
        // Clearing a neutralizer needs an actual viable air/sea battle. The
        // optimistic route effect never substitutes for this force estimate.
        if (assessment.pNavalWithReaction<0.6 || assessment.attackingAirSea<assessment.defendingAirSea) continue
        tasks.push(ec_make_task("SUPPRESS",hex,[],support,"RANGED",env,
            {score:65+impact.score,objective:"BLOCKADE_CLEAR_AIR",targetClasses:["air"],movementGroups:[],
                rangedSupport:true,declaresBattle:true,aspCost:0,assessment,blockadeImpact:impact,
                clearanceEvidence:"potential-if-enemy-air-eliminated; battle-required"}))
    }
    return tasks
}

function ec_cf(u) {
    return u.reduced ? (Number(u.rcf) || Math.ceil((Number(u.cf) || 0) / 2)) : (Number(u.cf) || 0)
}

function ec_battle_cf(u,target) {
    if (u.class!=="air") return ec_cf(u)
    if (typeof queryPotentialCombatStrength==="function") return queryPotentialCombatStrength([u.id],target)
    return Number.isFinite(u.br) && ec_dist(u.location,target)>u.br ? Math.ceil(ec_cf(u)/2) : ec_cf(u)
}

function ec_dist(a, b) {
    return typeof get_distance === "function" ? get_distance(a, b) : Math.abs(a - b)
}

function ec_control(hex, faction) {
    return typeof querySpaceControlled === "function" && !!querySpaceControlled(hex, faction)
}

function ec_cbi(region) {
    return /^(India|NIndia|Burma|China|Ceylon)$/.test(String(region || ""))
}

function ec_manchuria_blocked(view, board) {
    if (Number(view.turn || 0) < 7 || (typeof SHORT_CAMPAIGN_SCENARIO !== "undefined" && view.sid !== SHORT_CAMPAIGN_SCENARIO
        && (typeof EVEN_SHORT_CAMPAIGN_SCENARIO === "undefined" || view.sid !== EVEN_SHORT_CAMPAIGN_SCENARIO))) return false
    // ground_move_denied forbids all entry into Manchuria. Its resources can
    // change hands only through an actual legal event, not a Korean land route.
    const north = board.filter(m => m.resource && m.region === "Manchuria" && ec_control(m.hex, 0))
    if (north.length < 2) return false
    const soviet = (view.ai?.ownCards || []).find(c => /soviet/i.test(c.name || ""))
    return !soviet?.allowed?.includes("event")
}

function ec_map() {
    if (typeof map === "undefined" || !Array.isArray(map)) return []
    // Honshu surrender includes the unnamed 3606 hex. Keep every public
    // national key without granting unnamed terrain any PoW credit.
    const homelandKeys = new Set(typeof nations !== "undefined" ? nations.JAPAN?.keys || [] : [])
    return map.filter(m => m && (m.named || m.name || m.port || m.airfield || m.resource
        || homelandKeys.has(m.id)))
        .map(m => ({ ...m, hex: typeof hex_to_int === "function" ? hex_to_int(m.id) : m.id }))
        .filter(m => Number.isInteger(m.hex) && (typeof LAST_BOARD_HEX === "undefined" || m.hex <= LAST_BOARD_HEX))
        .sort((a, b) => a.hex - b.hex)
}

function ec_preserves_home_force(task,env) {
    if (!ec_refined() || Number(env.view.turn)<9 || !env.homelandFoothold) return true
    const remaining=env.victory.homelandKeys.filter(h=>!ec_control(h,env.faction))
    if (!remaining.length || remaining.includes(task.hex)
        || Number(env.view.political_will ?? 6)<=1 && env.powGap>0) return true
    const distance=h=>Math.min(...remaining.map(key=>ec_dist(h,key)))
    return (task.movementUnitIds || []).every(id=>{
        const unit=env.units.find(u=>u.id===id)
        if (!unit || unit.class!=="ground" || unit.faction!==env.faction
            || !ec_control(unit.location,env.faction) || distance(unit.location)>8
            || !env.victory.homelandKeys.includes(unit.location)
                && unit.location!==env.homelandPreparation?.rallyPort
                && !env.homelandPreparation?.groundIds?.includes(id)) return true
        return distance(task.hex)<distance(unit.location)
    })
}

function ec_homeland_drive(view) {
    if (ec_route_refined(view) && !ec_route_allows_atomic(view)) return true
    if (ec_refined() && Number(view.turn)>=9 && ec_card_window(view)
        && !view.ai?.victory?.atomic?.noStrategicBombingFailure && !view.ai?.victory?.blockade?.startedTurn) return true
    if (ec_manchuria_blocked(view, ec_map())) return true
    const keysHeld = view.ai?.victory?.homelandKeys || []
    if ((view.ai?.units || []).some(u => u.faction === 1 && u.class === "ground"
        && keysHeld.includes(u.location) && ec_control(u.location, 1))) return true
    if (typeof EVEN_SHORT_CAMPAIGN_SCENARIO !== "undefined" && view.sid === EVEN_SHORT_CAMPAIGN_SCENARIO) {
        if (Number(view.turn || 0) < 7) return false
        if (ec_manchuria_blocked(view, ec_map())) return true
        // Otherwise do not abandon reachable resources until a real
        // commandable ground/escort force is ready for the home islands.
        const units = view.ai?.units || [], keys = view.ai?.victory?.homelandKeys || []
        return units.some(g => g.faction === 1 && g.class === "ground" && (g.asp || g.aspCost)
            && keys.some(key => ec_dist(g.location, key) <= 10)
            && units.filter(n => n.faction === 1 && n.class === "naval" && n.location === g.location
                && ec_service_compatible([g, n], view, 1)).length >= 3
            && units.some(h => h.faction === 1 && h.class === "hq"
                && ec_dist(h.location, g.location) <= Number(h.cr || 0)))
    }
    const atomic = view.ai?.victory?.atomic
    const blockade = view.ai?.victory?.blockade
    return Number(view.turn || 0) >= 10 && !atomic?.noStrategicBombingFailure && !blockade?.startedTurn
}

function ec_homeland_approach(view, board, units, faction) {
    const keys = view.ai?.victory?.homelandKeys || []
    if (!ec_homeland_drive(view) || Number(view.turn || 0) < 7 || !keys.length) return false
    return board.some(m => m.port && !ec_cbi(m.region) && ec_control(m.hex, faction)
        && units.some(u => u.faction === faction && u.location === m.hex
            && (u.class === "ground" || u.class === "naval"))
        && keys.some(key => !ec_control(key, faction) && ec_dist(m.hex, key) <= 10))
}

function ec_homeland_preparation_enabled(view,board) {
    const turn=Number(view.turn || 0)
    if (turn>=7) return ec_homeland_drive(view)
    if (turn<5 || typeof EVEN_SHORT_CAMPAIGN_SCENARIO==="undefined" || view.sid!==EVEN_SHORT_CAMPAIGN_SCENARIO) return false
    return board.filter(m=>m.resource && m.region==="Manchuria" && ec_control(m.hex,0)).length>=2
        && !(view.ai?.ownCards || []).some(c=>/soviet/i.test(c.name || "") && c.allowed?.includes("event"))
}

function ec_homeland_rally(view, board, units, faction, approach) {
    if (!approach) return null
    const keys = view.ai?.victory?.homelandKeys || []
    const ports = board.filter(m => m.port && ec_control(m.hex, faction)
        && keys.some(key => ec_dist(m.hex,key) <= 5))
    const previous = view.ai?.plan?.campaign?.rallyPort
    if (ports.some(m => m.hex === previous)) return previous
    const staffed = ports.filter(m => units.some(u => u.faction === faction && u.location === m.hex
        && (u.class === "ground" || u.class === "naval")))
    staffed.sort((a,b) => {
        const ad = Math.min(...keys.map(key => ec_dist(a.hex,key)))
        const bd = Math.min(...keys.map(key => ec_dist(b.hex,key)))
        return ad-bd || a.hex-b.hex
    })
    if(staffed.length)return staffed[0].hex
    const held=(view.capture||[]).filter(h=>ec_control(h,faction)).length
    if(held<Number(view.pow||0))return null
    const remaining=keys.filter(h=>!ec_control(h,faction))
    if(!remaining.length)return null
    const fallback=board.filter(m=>m.port&&!ec_cbi(m.region)&&ec_control(m.hex,faction)
        &&remaining.some(key=>ec_dist(m.hex,key)<=8)
        &&units.some(g=>g.faction===faction&&g.class==="ground"&&(g.asp||g.aspCost)&&g.location===m.hex
            &&units.some(n=>n.faction===faction&&n.class==="naval"&&n.location===m.hex
                &&ec_service_compatible([g,n],view,faction))))
    fallback.sort((a,b)=>Math.min(...remaining.map(key=>ec_dist(a.hex,key)))
        -Math.min(...remaining.map(key=>ec_dist(b.hex,key)))||a.hex-b.hex)
    return fallback[0]?.hex ?? null
}

function ec_campaign_objective(view, board, units, faction) {
    const previous = view.ai?.plan?.campaign?.objectiveHex
    const turn = Number(view.turn || 0), atomic = view.ai?.victory?.atomic
    const atomicApproach = turn >= 9 && atomic?.noStrategicBombingFailure && ec_route_allows_atomic(view,board)
    const baseApproach = turn >= 6 && !atomic?.b29InRangeOfTokyo
    const objectiveAge = turn - Number(view.ai?.plan?.campaign?.objectiveSinceTurn ?? view.ai?.plan?.turn ?? turn)
    const byHex = new Map(board.map(m => [m.hex, m]))
    const bases = board.filter(m => m.port && !ec_cbi(m.region) && ec_control(m.hex, faction)
        && units.some(u => u.faction === faction && u.location === m.hex && (u.class === "naval" || u.class === "ground" && (u.asp || u.aspCost))))
    const homelandKeys = view.ai?.victory?.homelandKeys || []
    const homelandDrive = ec_homeland_drive(view)
    const homelandApproach = ec_homeland_approach(view, board, units, faction)
    if (!ec_national_goals(view,faction).some(n=>n.active && n.missingKeys.length===1 && n.missingKeys[0]!==previous)
        && Number.isInteger(previous) && byHex.has(previous) && objectiveAge < 2 && !ec_cbi(byHex.get(previous).region)
        && (!atomicApproach || byHex.get(previous).resource)
        && (!homelandApproach || homelandKeys.some(key => ec_dist(previous, key) <= 8))
        && ec_control(previous, 1 - faction) && bases.some(b => ec_dist(b.hex, previous) <= 12)) return previous
    const national=ec_national_goals(view,faction)
    const targets = board.filter(m => m.named && (m.port || m.airfield || m.resource) && !ec_cbi(m.region)
        && m.region !== "Manchuria"
        && ec_control(m.hex, 1 - faction))
    const scored = targets.map(m => {
        const distance = Math.min(...bases.map(b => ec_dist(b.hex, m.hex)))
        const defenders = units.filter(u => u.faction !== faction && u.location === m.hex)
        const defense = defenders.reduce((sum, u) => sum + ec_cf(u) * (u.class === "ground" ? 1.2 : 0.5), 0)
        const tokyoDistance = typeof TOKYO === "undefined" ? 0 : ec_dist(m.hex, TOKYO)
        const homeDistance = Math.min(...homelandKeys.map(key => ec_dist(m.hex, key)))
        const mainland = homelandKeys.includes(m.hex)
        const approachPort = m.port && m.region === "JMandates" && homeDistance <= 10
        return { hex: m.hex, distance, score: ec_national_bonus(m.hex,national) + (m.port ? 12 : 0) + (m.airfield ? 8 : 0)
            + (!defenders.length ? 24 : 0) + (atomicApproach && m.resource ? 120 : 0)
            + (turn >= 5 && typeof EVEN_SHORT_CAMPAIGN_SCENARIO !== "undefined"
                && view.sid === EVEN_SHORT_CAMPAIGN_SCENARIO && m.resource && ec_route_allows_atomic(view,board) ? 90 : 0)
            + (baseApproach && m.airfield && tokyoDistance <= 8 ? 45 : 0)
            + (homelandApproach && mainland ? 135 : 0)
            + (homelandDrive && turn >= 7 && approachPort ? 65 : 0)
            + (ec_route_refined(view) && !ec_route_allows_atomic(view,board) && turn>=7
                && m.port && homeDistance<=8 ? mainland ? 100 : 140 : 0)
            - (m.hex === previous && objectiveAge >= 2 ? objectiveAge * 20 : 0)
            - distance * 5 - defense - tokyoDistance * 0.2 }
    }).filter(m => m.distance <= 12)
    scored.sort((a, b) => b.score - a.score || a.hex - b.hex)
    return scored[0]?.hex ?? null
}

function ec_card_window(view) {
    return view?.ai?.state === "offensive_segment" && Array.isArray(view.actions?.card)
}

function ec_task_complete(task, view, faction) {
    const units = view.ai?.units || []
    if (task.kind === "CONQUEST") return ec_control(task.hex, faction)
    if (task.kind === "SUPPRESS" && task.softeningGoal) {
        const now=typeof queryDefendingGround==="function"?queryDefendingGround(task.hex,{faction:1-faction}):null
        return !!now && now.cf<task.softeningGoal.beforeCf
    }
    if (task.kind === "SUPPRESS") return !units.some(u=>u.faction!==faction && u.location===task.hex && (task.targetClasses || ["air"]).includes(u.class))
    return task.movementUnitIds.every(id => units.some(u => u.id === id && u.location === task.hex))
}

function ec_redeploy_history(view, prior, faction) {
    const history = (prior?.campaign?.redeployments || []).filter(x => x.turn === Number(view.turn)).map(x => ({ ...x }))
    if (prior?.turn === Number(view.turn)) for (const task of prior.tasks || []) {
        if (task.kind !== "REDEPLOY" || !Number.isInteger(task.originHex) || !ec_task_complete(task, view, faction)) continue
        for (const unit of task.movementUnitIds) {
            const from=task.movementGroups?.find(g=>g.unitIds?.includes(unit))?.originHex ?? task.originHex
            if (!history.some(x => x.unit === unit && x.from === from && x.to === task.hex))
                history.push({ turn: Number(view.turn), unit, from, to: task.hex, target: task.followUpTarget ?? null })
        }
    }
    return history.slice(-64)
}

function ec_offensive_key(view, role) {
    const faction = role === "Japan" ? 0 : 1
    const off = view.offensive || {}
    return Number(off.attacker) === faction ? Number(off.offensive_card || 0) : Number(off.counter_offensive_card || 0)
}

function ec_selected_card(view) {
    // The engine's public card-action prompt identifies the selected own card;
    // offensive_card still identifies the previous offensive in this window.
    const match = String(view.prompt || "").match(/^C(\d+):\s*Select action\./i)
    return match ? Number(match[1]) : null
}

function ec_delegation_reason(view, role) {
    if (typeof EC === "undefined" || view.offensive?.type !== EC
        || Number(view.offensive?.attacker) !== (role === "Japan" ? 0 : 1)) return null
    const cardId = ec_offensive_key(view, role)
    if (cardId <= 0) return null
    const prior = view.ai?.plan?.delegatedOffensive
    if (prior?.cardId === cardId) return prior.reason
    if (typeof queryCardPreview !== "function") return "event-preview-unavailable"
    const preview = queryCardPreview(cardId, { faction: role === "Japan" ? 0 : 1, cardMode: "event" })
    return preview?.reason === "event-hooks-not-previewable" ? preview.reason : null
}

function ec_victory(view, board, faction) {
    const visible = view.ai?.victory || {}
    const enemyResources = board.filter(m => m.resource && ec_control(m.hex, 1 - faction)).map(m => m.hex)
    const atomic = visible.atomic ? JSON.parse(JSON.stringify(visible.atomic)) : null
    const homelandKeys = Array.isArray(visible.homelandKeys) ? visible.homelandKeys.slice() : []
    // Range and an airfield are the rule; the map calls Okinawa/Marianas
    // "JMandates", so a geographic name allowlist loses real bombing bases.
    const airbases = board.filter(m => m.airfield)
        .filter(m => typeof TOKYO === "undefined" || ec_dist(m.hex, TOKYO) <= 8)
        .map(m => m.hex)
    const blockade = typeof queryBlockadeStatus === "function" ? queryBlockadeStatus() : visible.blockade || null
    if (blockade) blockade.neutralizingCarriers=(view.ai?.units || []).filter(u=>u.faction!==faction
        && u.class==="naval" && Number(u.br)>0 && Number(u.br)<6 && !view.oos?.includes(u.id))
        .map(u=>({unit:u.id,hex:u.location,clearance:"not-covered-by-air-only-suppression"}))
    const turn = Number(view.turn || 0), started = Number(blockade?.startedTurn || 0)
    const completedPhases = blockade?.completedPhases ?? (started ? Math.max(0, Math.min(3, turn - started)) : 0)
    const missingHomeland = homelandKeys.filter(h => !ec_control(h, faction))
    const manchuria = board.filter(m => m.resource && m.region === "Manchuria" && ec_control(m.hex, 1 - faction)).map(m => m.hex)
    const soviet = (view.ai?.ownCards || []).find(c => /soviet/i.test(c.name || ""))
    const enemyHqs = (view.ai?.units || []).filter(u => u.faction !== faction && u.class === "hq")
    const atomicClockLost = (turn > 9 || ec_refined() && turn===9 && ec_card_window(view)) && !atomic?.noStrategicBombingFailure
    return { atomic, jpResources: Number(visible.jpResources ?? view.resources?.[0] ?? enemyResources.length),
        resourceTargets: enemyResources, blockade, homelandKeys,
        b29Bases: airbases,
        routes: {
            atomic: { status: atomicClockLost ? "deadline-missed" : atomic?.met ? "conditions-met" : "preparation-required",
                latestBombingStart: 9, judgementTurn: 12, bombingCampaignStart: Number(atomic?.bombingCampaignStart || 0),
                resourceCapturesNeeded: Math.max(0, Number(atomic?.jpResources ?? enemyResources.length) - 1),
                b29DeploymentNeeded: !atomic?.b29InRangeOfTokyo, manchurianResources: manchuria,
                sovietDependency: manchuria.length > 1 ? (soviet?.allowed?.includes("event") ? "own-event-playable" : soviet ? "own-event-not-yet-playable" : "future-event-unavailable") : "not-required-for-resource-limit",
                reason: atomicClockLost ? "T9-T12 continuous successful bombing can no longer be completed" : "Bombing, B29 range and <=1 resource are separate requirements; Soviet event only affects resources" },
            blockade: { status: blockade?.timerWillReset ? "route-reopened" : started ? "clock-running" : turn > 10 ? "deadline-missed" : "cut-required",
                startedTurn: started, latestStartTurn: 10,
                earliestWinTurn: blockade?.connected ? null : blockade?.earliestWinTurn ?? (started ? started + 2 : turn + 2),
                completedSegments: completedPhases, remainingPhases: blockade?.remainingPhases ?? 3 - completedPhases,
                connectedResources: blockade?.connectedResources || [], disconnectedResources: blockade?.disconnectedResources || [],
                reason: "Actual resource traces determine endpoint connectivity; future national-status checks require routes to remain cut" },
            homeland: { status: missingHomeland.length ? "capture-required" : "keys-held", remainingKeys: missingHomeland,
                immediatelyExecutableKeys: [], reason: "Each key needs a legal ground occupation; distance is not reachability" },
            headquarters: { status: enemyHqs.length ? "capture-required" : "no-enemy-hq-on-map", enemyHqCount: enemyHqs.length,
                targets: enemyHqs.map(u => ({ unit: u.id, hex: u.location })), immediatelyExecutableTargets: [],
                reason: "Only public on-map HQs are counted; the engine determines displacement and sudden death" },
        }, assessment: "public prerequisites and deadline feasibility; no assumed future draws or automatic victory" }
}

// Each query result is local to one planning call, so no cached state can leak
// across games, roles, cards, or save/restore boundaries.
function ec_query_moves(ids, mode, env) {
    const key = ids.join(",") + ":" + mode
    if (env.moves.has(key)) return env.moves.get(key)
    let result = { reachableHexes: [], reason: "group-movement-query-unavailable" }
    if (typeof queryGroupMovementDestinations === "function") {
        try {
            result = queryGroupMovementDestinations(ids, { move_type: mode, faction: env.faction,
                cardId: env.cardId, hqId: env.hq.id, cardMode: env.cardMode }) || result
        } catch (e) { result = { reachableHexes: [], reason: "group-movement-query-failed" } }
    }
    if (result.paths && mode) result = { ...result, reachableHexes: (result.reachableHexes || [])
        .filter(h => !result.paths[h] || (Number(result.paths[h][0]) & mode)) }
    // Strategic transports cannot use PBM to repair their final stacking.
    if(typeof STRAT_MOVE!=="undefined" && mode===STRAT_MOVE && em_flag("stack_limit_gate")
        && typeof queryProjectedStack==="function") {
        // Locations remain fixed throughout this plan, including card/HQ
        // previews. Share only final stacking facts within that planning call;
        // movement paths and temporary PBM projections keep their own queries.
        const groupKey=[...new Set(ids)].sort((a,b)=>a-b).join(",")
        const reachableHexes=(result.reachableHexes || []).filter(h=>{
            const stackKey=env.faction+":"+h+":"+groupKey
            if(env.projectedStackFits?.has(stackKey))return env.projectedStackFits.get(stackKey)
            const fits=queryProjectedStack(h,ids,{faction:env.faction}).fitsForIncoming
            env.projectedStackFits?.set(stackKey,fits)
            return fits
        })
        result={...result,reachableHexes,reason:reachableHexes.length?result.reason:"no-stack-safe-destination"}
    }
    env.moves.set(key, result)
    return result
}

function ec_service_compatible(units, view, faction) {
    if (!view.inter_service?.[faction]) return true
    const services = new Set(units.map(u => u.service).filter(s => s === "army" || s === "navy"))
    return services.size <= 1
}

function ec_asp_remaining(view,faction) {
    if (typeof queryAspRemaining==="function") return queryAspRemaining(faction)
    const total=Number(view.asp?.[faction]?.[0] || 0), used=Number(view.asp?.[faction]?.[1] || 0)
    return Math.max(0,(faction===0 && view.inter_service?.[0] ? Math.ceil(total/2) : total)-used)
}

function ec_garrison_reserve(view, board, units, faction) {
    const reserve = new Set()
    const recent = new Set(view.capture || [])
    const awaitingKeys=new Set(ec_national_goals(view,faction).filter(n=>n.active && !n.missingKeys.length).flatMap(n=>n.keys))
    const atomic = view.ai?.victory?.atomic
    const resourceCount = Number(view.ai?.victory?.jpResources)
    const bombingRoute = atomic?.noStrategicBombingFailure && atomic?.b29InRangeOfTokyo
        && !view.ai?.victory?.blockade?.startedTurn && ec_route_allows_atomic(view,board)
    const evenShort = typeof EVEN_SHORT_CAMPAIGN_SCENARIO !== "undefined"
        && view.sid === EVEN_SHORT_CAMPAIGN_SCENARIO
    const finalResourceChance = ec_route_allows_atomic(view,board) && Number(view.turn) === 12 && Number(view.political_will) > 2
        && atomic?.noStrategicBombingFailure && atomic?.b29InRangeOfTokyo
        && (resourceCount === 2 || evenShort && resourceCount > 2 && !view.ai?.victory?.blockade?.startedTurn)
    const earlyResourceSprint = evenShort && Number(view.turn) >= 9
        && bombingRoute && resourceCount >= 4
    for (const m of board) {
        if (!(m.resource || recent.has(m.hex) || awaitingKeys.has(m.hex)) || !ec_control(m.hex, faction)) continue
        const at = units.filter(u => u.faction === faction && u.class === "ground" && u.location === m.hex)
            .sort((a, b) => ec_cf(a) - ec_cf(b) || a.id - b.id)
        const threatened = units.some(u => u.faction !== faction && u.class === "ground" && ec_dist(u.location, m.hex) <= 6)
        // The last resource assault is a must-try on T12: reserving a sole
        // ground unit guarantees failure of the atomic route. Its destination
        // still needs an actual legal path and positive capture probability.
        if (finalResourceChance && !evenShort || m.resource && (finalResourceChance || earlyResourceSprint && !threatened)) continue
        if (at.length && (m.resource || threatened || awaitingKeys.has(m.hex))) reserve.add(at[0].id)
    }
    return reserve
}

function ec_available(view, hq, faction, preCard, cardId, cardMode) {
    const own = (view.ai?.units || []).filter(u => u.faction === faction && u.class !== "hq")
    let ids = null
    if (typeof queryActivationCandidates === "function") {
        try { ids = queryActivationCandidates(hq.id, { faction, cardId, hqId: hq.id, cardMode: preCard ? cardMode || "ops" : undefined }) } catch (e) { ids = [] }
    }
    if (Array.isArray(ids)) return own.filter(u => ids.includes(u.id))
    return [] // Missing authority is a blocker, never a geometric activation grant.
}

function ec_score_target(m, env) {
    if (env.scoreTarget) return env.scoreTarget(m)
    const defenders = env.units.filter(u => u.faction !== env.faction && u.location === m.hex)
    let score = ec_national_bonus(m.hex,env.national || []) + (m.named ? 12 : 0) + (m.port ? 10 : 0) + (m.airfield ? 8 : 0) + (m.resource ? 32 : 0)
    if (env.powGap && m.named && !(env.view.capture || []).includes(m.hex))
        score += 90 + Math.min(4, env.powGap) * 10 + Math.min(2, env.powPressure || 0) * 35
    if (!defenders.length) score += 26
    if (env.axisTargets.has(m.hex)) score += 12
    if (env.previousObjective === m.hex) score += 8
    if (env.campaignObjective === m.hex) score += 18
    if (env.victory.b29Bases.includes(m.hex) && Number(env.view.turn) >= 6) score += 22
    if (env.victory.homelandKeys.includes(m.hex)) {
        score += env.victory.routes.homeland.remainingKeys.length === 1 ? 500 : 40
        if (env.homelandApproach) score += env.homelandFoothold ? 150 : m.port ? 190 : 50
    }
    if (env.homelandApproach && Number(env.view.turn) >= 7 && m.port && m.region === "JMandates"
        && env.victory.homelandKeys.some(key => ec_dist(m.hex, key) <= 10)) score += 65
    if (m.resource && ec_route_allows_atomic(env.view,env.board) && Number(env.view.turn) >= 9 && env.victory.atomic?.noStrategicBombingFailure)
        score += env.victory.jpResources <= 4 ? 150
            : typeof EVEN_SHORT_CAMPAIGN_SCENARIO !== "undefined" && env.view.sid === EVEN_SHORT_CAMPAIGN_SCENARIO ? 105 : 80
    else if (m.resource && ec_route_allows_atomic(env.view,env.board) && Number(env.view.turn) >= 5 && typeof EVEN_SHORT_CAMPAIGN_SCENARIO !== "undefined"
        && env.view.sid === EVEN_SHORT_CAMPAIGN_SCENARIO)
        score += 95
    if (defenders.some(u => u.class === "hq")) score += env.victory.routes.headquarters.enemyHqCount <= 1 ? 120 : 38
    // A reachable resource is useful, but proximity to Tokyo alone never makes
    // a distant or impossible invasion preferable to an executable landing.
    return score+ec_central_pacific_bonus(m,env)
}

function ec_support(group, target, env) {
    const selected = group.slice()
    const remaining = Math.max(0, env.budget - selected.length)
    const support = env.available.filter(u => !selected.some(x => x.id === u.id)
        && (u.class === "air" || (u.class === "naval" && Number(u.br) > 0))
        && ec_dist(u.location, target) <= Math.max(Number(u.br) || 0, u.parenthetical ? 0 : Number(u.ebr) || 0)
        && !u.b29 && ec_service_compatible(selected.concat(u), env.view, env.faction))
        .filter(u => {
            try {
                if (u.class === "air") return typeof queryCombatParticipation === "function"
                    && !!queryCombatParticipation(u.id, target, {}).legal
                return typeof in_range_on_map === "function"
                    && in_range_on_map(u.location, Number(u.br) || 0, [target], env.faction).length > 0
            } catch (e) { return false }
        })
        .sort((a, b) => ec_battle_cf(b,target) - ec_battle_cf(a,target) || a.id - b.id)
    return support.slice(0, remaining)
}

function ec_reaction(target, env) {
    env.reactions ||= new Map()
    if (env.reactions.has(target)) return env.reactions.get(target)
    let result = null
    if (typeof queryReactionCandidates === "function") {
        try {
            const r = queryReactionCandidates({ reactionFaction: 1 - env.faction, targetHex: target,
                targetOnly:true,
                cardContext: { cardId: env.cardId, hqId: env.hq?.id, cardMode: env.cardMode, faction: env.faction } })
            // Only overland ground reactions are supported here. Naval ground
            // reactions need a verified escort/group path and ASP allocation.
            const ids = new Set([...(r.air || []), ...(r.carrier || []), ...(r.naval || []), ...(r.groundOverland || [])])
            const candidates = env.units.filter(u => ids.has(u.id) && u.location !== target)
            if (Array.isArray(r.hqOptions)) {
                let best = { units: [], cf: 0, hq: null, budget: 0 }
                const plans = []
                for (const option of r.hqOptions) {
                    const legal = new Set(option.units || [])
                    const available = candidates.filter(u => legal.has(u.id) && u.faction !== env.faction
                        && ["air","naval","ground"].includes(u.class))
                        .sort((a, b) => ec_cf(b) - ec_cf(a) || a.id - b.id)
                    const services = env.view.inter_service?.[1 - env.faction] ? ["army", "navy"] : [null]
                    for (const service of services) {
                        const compatible = available.filter(u => !service || !["army", "navy"].includes(u.service) || u.service === service)
                        const ground = compatible.filter(u=>u.class==="ground"), sea = compatible.filter(u=>u.class!=="ground")
                            .sort((a,b)=>ec_battle_cf(b,target)-ec_battle_cf(a,target)||a.id-b.id)
                        const seen = new Set(), budget = Math.max(0, Number(option.budget) || 0)
                        // Evaluate legal allocations of this one HQ's budget.
                        // A fleet peak and a ground peak from different HQs
                        // must never become one hypothetical reaction force.
                        for (let count=0;count<=Math.min(ground.length,budget);count++) {
                            const units=ground.slice(0,count).concat(sea.slice(0,budget-count))
                            if (units.filter(u=>(r.aspGround || []).includes(u.id)).length>1) continue
                            const key=units.map(u=>u.id).sort((a,b)=>a-b).join(",")
                            if (!units.length || seen.has(key)) continue
                            seen.add(key)
                            const cf=units.filter(u=>u.class!=="ground").reduce((sum,u)=>sum+ec_battle_cf(u,target),0)
                            const plan={units,cf,hq:option.hq,budget:option.budget}
                            plans.push(plan)
                            if (cf>best.cf) best=plan
                        }
                    }
                }
                result = { ...best, plans, estimate: "single-hq-budget-and-service" }
            } else result = { units: candidates, estimate: "uncapped-public-candidate-estimate" }
        } catch (e) { /* A missing query is an explicitly labelled estimate. */ }
    }
    if (!result) result = { units: env.units.filter(u => u.faction !== env.faction && u.location !== target
        && (u.class === "air" || (u.class === "naval" && Number(u.br) > 0))
        && ec_dist(u.location, target) <= Math.max(Number(u.br) || 0, Number(u.ebr) || 0)), estimate: "public-range-estimate" }
    env.reactions.set(target, result)
    return result
}

function ec_terminal_resource_target(target, env) {
    if (!ec_route_allows_atomic(env.view,env.board)) return false
    // At the final deadline, passing up the last needed resource guarantees
    // losing this victory route. Accept a real (possibly small) capture chance,
    // while leaving immediate political survival and every legality gate intact.
    const atomic = env.victory?.atomic
    return Number(env.view.turn) === 12 && Number(env.view.political_will) > 2
        && !!atomic?.noStrategicBombingFailure && !!atomic?.b29InRangeOfTokyo
        && (env.victory.jpResources === 2 || typeof EVEN_SHORT_CAMPAIGN_SCENARIO !== "undefined"
            && env.view.sid === EVEN_SHORT_CAMPAIGN_SCENARIO && env.victory.jpResources > 2)
        && env.victory.resourceTargets.includes(target)
}

function ec_resource_clock_target(target, env) {
    if (!ec_route_allows_atomic(env.view,env.board)) return false
    const turn = Number(env.view.turn || 0)
    const atomic = env.victory?.atomic
    return typeof EVEN_SHORT_CAMPAIGN_SCENARIO !== "undefined" && env.view.sid === EVEN_SHORT_CAMPAIGN_SCENARIO
        && turn >= 9 && turn < 12 && Number(env.view.political_will) > 2 && env.powGap === 0
        && atomic?.noStrategicBombingFailure && atomic?.b29InRangeOfTokyo
        && !env.victory.blockade?.startedTurn
        && env.victory.jpResources - 1 >= 12 - turn
        && env.victory.resourceTargets.includes(target)
}

function ec_korean_supply(group,target,env) {
    if (!ec_offensive_refined() || env.faction!==1 || ![hex_to_int(3305),hex_to_int(3306)].includes(target)
        || typeof queryCampaignSupplyProjection!=="function") return null
    const ground=group.filter(u=>u.class==="ground")
    if (!ground.length) return null
    env.landingSupply ||= new Map()
    const key=target+":"+ground.map(u=>u.id).sort((a,b)=>a-b).join(",")
    if (!env.landingSupply.has(key)) env.landingSupply.set(key,queryCampaignSupplyProjection({faction:1,
        captureHex:target,moves:ground.map(u=>({unit:u.id,hex:target})),protectedIds:ground.map(u=>u.id)}))
    const result=env.landingSupply.get(key)
    if (result?.eligible && !result.supplied) {
        env.koreanSupplyNeeds ||= new Map()
        if (env.koreanSupplyNeeds.size<6) env.koreanSupplyNeeds.set(key,{target,groundIds:ground.map(u=>u.id)})
    }
    return result
}

function ec_korean_supply_preparation(env) {
    if (!ec_offensive_refined() || !env.koreanSupplyNeeds?.size || env.powGap>0) return []
    const tasks=[],budget=env.koreanPreparationQueries || {count:0}
    const air=env.available.filter(u=>u.class==="air" && !u.b29 && Number(u.br)>0 && Number(u.br)<6).slice(0,3)
    for (const need of env.koreanSupplyNeeds.values()) for (const u of air) {
        const reach=ec_query_moves([u.id],STRAT_MOVE,env)
        const bases=reach.reachableHexes.filter(hex=>hex!==u.location && env.byHex.get(hex)?.airfield && ec_control(hex,1))
            .sort((a,b)=>ec_dist(a,need.target)-ec_dist(b,need.target) || a-b).slice(0,4)
        for (const hex of bases) {
            if (budget.count>=32) return tasks
            budget.count++
            const positioned=ec_air_projection(env,{moves:[{unit:u.id,hex}]})
            if (!positioned || positioned.ownOosIds.includes(u.id)) continue
            const estimate=queryCampaignSupplyProjection({faction:1,captureHex:need.target,protectedIds:need.groundIds,
                moves:need.groundIds.map(unit=>({unit,hex:need.target})).concat({unit:u.id,hex})})
            if (!estimate?.eligible || !estimate.supplied || estimate.ownOosIds.includes(u.id)) continue
            tasks.push(ec_make_task("REDEPLOY",hex,[u],[],"STRATEGIC",env,{score:210,objective:"KOREAN_SUPPLY_PREP",
                preparationOnly:true,followUpTarget:need.target,supplyWitness:estimate,
                attackWitness:{groundIds:need.groundIds,escortIds:[],supportIds:[u.id]},
                preparationReason:"legal own air redeployment restores conditional Korean landing supply; actual assault must be reevaluated"}))
        }
    }
    return tasks
}

function ec_assess(group, support, target, amphibious, env) {
    const defenders = env.units.filter(u => u.faction !== env.faction && u.location === target)
    const attack = group.concat(support)
    const ground = attack.filter(u => u.class === "ground")
    let groundDef = defenders.filter(u => u.class === "ground")
    if (typeof queryDefendingGround === "function") {
        env.groundDefenses ||= new Map()
        if (!env.groundDefenses.has(target))
            env.groundDefenses.set(target, queryDefendingGround(target, { faction: 1 - env.faction }))
        const defense = env.groundDefenses.get(target)
        // The query includes the public city garrisons that prepare_battle
        // creates only at combat time, with already-adjusted CF/LF values.
        if (Array.isArray(defense?.units)) groundDef = defense.units.map(u => ({ ...u,
            steps: u.reduced || u.oneStep ? 1 : 2, reduced: false }))
    }
    const sea = attack.filter(u => u.class !== "ground")
    const seaDef = defenders.filter(u => u.class === "air" || u.class === "naval")
    let reactionPlan = ec_reaction(target, env), reaction = reactionPlan.units.filter(u=>u.class!=="ground")
    let reactionGround = reactionPlan.units.filter(u=>u.class==="ground")
    const attSea = sea.reduce((s, u) => s + ec_battle_cf(u,target), 0)
    const defSea = seaDef.reduce((s, u) => s + ec_cf(u), 0)
    let reactionCf = reaction.reduce((s, u) => s + ec_battle_cf(u,target), 0)
    const config = typeof em_cfg === "function" ? em_cfg() || {} : {}
    let reactionChance=null
    if(env.publicReactionBounds && typeof queryPublicReactionChance==="function") {
        env.reactionChances ||= new Map()
        const key=target+":"+Number(amphibious)
        if(!env.reactionChances.has(key))env.reactionChances.set(key,queryPublicReactionChance(target,
            {faction:env.faction,cardId:env.cardId,cardMode:env.cardMode,hqId:env.hq.id,amphibious}))
        reactionChance=env.reactionChances.get(key)
    }
    const reactionWeight = reactionChance?.eligible ? reactionChance.pTargetReinforcement.high
        : Number.isFinite(config.emReactionWeight) ? config.emReactionWeight : 0.35
    const effectiveDefense = defSea + reactionWeight * reactionCf
    const attHasBr = sea.some(u => u.class === "air" || Number(u.br) > 0)
    const defHasBr = seaDef.concat(reaction).some(u => u.class === "air" || Number(u.br) > 0)
    const naval = typeof em_naval_outcome === "function"
        ? em_naval_outcome({ attCF: attSea, defCF: effectiveDefense, attHasBr, defHasBr })
        : { pWin: effectiveDefense === 0 || attSea > effectiveDefense && (attHasBr || !defHasBr) ? 1 : 0 }
    // Entering an empty enemy-controlled land hex is capture movement, not a
    // declared battle. An off-map hypothetical air reaction must not veto it.
    const emptyLandCapture = !amphibious && defenders.length === 0 && groundDef.length === 0
    // 8.45 does not require a ship on an unopposed landing. Outside enemy
    // AZOI an empty target cannot initiate special reaction (7.27); the group
    // movement query has already checked the complete route, ASP and supply.
    env.specialReactions ||= new Map()
    if (!env.specialReactions.has(target)) env.specialReactions.set(target, typeof querySpecialReaction === "function"
        ? querySpecialReaction({ target, reactingFaction: 1 - env.faction }).eligible
        : typeof queryZoi === "function" ? queryZoi(target, 1 - env.faction) : true)
    const specialReaction = env.specialReactions.get(target)
    if (!defenders.length && (!amphibious || !specialReaction)) {
        reactionPlan={units:[],cf:0,hq:null,budget:0,estimate:"no-reaction-trigger"}
        reaction=[];reactionGround=[];reactionCf=0
    }
    const hasGroundReaction = (reactionPlan.plans || [reactionPlan]).some(p=>p.units.some(u=>u.class==="ground"))
    const unopposedLanding = amphibious && defenders.length === 0 && groundDef.length === 0 && !specialReaction && !hasGroundReaction
    // Losing the air/naval stage turns back amphibious troops only. Troops
    // arriving overland still fight (apply_naval_winner).
    const terrain = typeof get_map_data === "function" ? Number(get_map_data(target)?.terrain) : 0
    const terrainMod = terrain === 2 ? -1 : terrain === 3 ? -2 : terrain === 4 ? -3 : 0
    const tsuji = env.faction === 0 && typeof COL_TSUJI !== "undefined" && env.cardId === COL_TSUJI
        && (env.cardMode ? env.cardMode === "event" : env.view.offensive?.type === EC)
        && (terrain === 2 || terrain === 3 || env.byHex.get(target)?.region === "Malaya")
    function groundChance(defendersSea, reinforcingGround = []) {
        const defendingGround=groundDef.concat(reinforcingGround)
        if (!defendingGround.length) return 1
        if (typeof em_ground_outcome !== "function") return 0
        return em_ground_outcome({ attCF: ground.reduce((s, u) => s + ec_cf(u), 0),
            defCF: defendingGround.reduce((s, u) => s + ec_cf(u), 0),
            attMods: tsuji ? 4 : terrainMod + (sea.some(u => Number(u.br) > 0) && !defendersSea.some(u => Number(u.br) > 0) ? 2 : 0)
                + (group.some(u => u.class === "naval") && !defendersSea.some(u => u.class === "naval") ? 2 : 0),
            defMods: amphibious && defenders.some(u=>u.class==="ground" || u.class==="hq") ? 3 : 0,
            attLfs: ground.map(u => amphibious ? Math.ceil((Number(u.lf) || 1) / 2) : Number(u.lf) || 1),
            defLfs: defendingGround.map(u => Number(u.lf) || 1),
            attSteps: ground.map(u => u.reduced || u.oneStep ? 1 : 2),
            defSteps: defendingGround.map(u => u.steps || (u.reduced || u.oneStep ? 1 : 2)) }).pWin
    }
    const pGround = groundChance(seaDef)
    // Select the most dangerous evaluated *single* HQ allocation for this
    // attacking force; only public eligible units enter these alternatives.
    let reactedCapture = Infinity, uncoveredGroundReaction=null
    for (const plan of reactionPlan.plans || [reactionPlan]) {
        const navalUnits=plan.units.filter(u=>u.class!=="ground"), groundUnits=plan.units.filter(u=>u.class==="ground")
        const cf=navalUnits.reduce((sum,u)=>sum+ec_battle_cf(u,target),0)
        const hasBr=seaDef.concat(navalUnits).some(u=>u.class==="air" || Number(u.br)>0)
        const navalChance=typeof em_naval_outcome==="function"
            ? em_naval_outcome({attCF:attSea,defCF:defSea+cf,attHasBr,defHasBr:hasBr}).pWin
            : attSea>defSea+cf && (attHasBr || !hasBr) ? 1 : cf===0 ? naval.pWin : 0
        const groundProbability=groundChance(seaDef.concat(navalUnits),groundUnits)
        if (groundUnits.length && groundProbability===0 && !uncoveredGroundReaction)
            uncoveredGroundReaction={hq:plan.hq,budget:plan.budget,unitIds:groundUnits.map(u=>u.id)}
        const capture=(amphibious?navalChance:1)*groundProbability
        if (capture<reactedCapture || capture===reactedCapture && cf>reactionCf) {
            reactedCapture=capture;reactionPlan={...reactionPlan,...plan};reaction=navalUnits;reactionGround=groundUnits;reactionCf=cf
        }
    }
    const pGroundWithReaction=groundChance(seaDef.concat(reaction),reactionGround)
    const fullReactionNaval = typeof em_naval_outcome === "function"
        ? em_naval_outcome({ attCF: attSea, defCF: defSea + reactionCf, attHasBr,
            defHasBr:seaDef.concat(reaction).some(u=>u.class==="air" || Number(u.br)>0) }).pWin
        : attSea > defSea + reactionCf && (attHasBr || !defHasBr) ? 1 : reactionCf === 0 ? naval.pWin : 0
    const noReactionNaval = typeof em_naval_outcome === "function"
        ? em_naval_outcome({ attCF: attSea, defCF: defSea, attHasBr,
            defHasBr: seaDef.some(u => u.class === "air" || Number(u.br) > 0) }).pWin
        : defSea === 0 || attSea > defSea && (attHasBr || !seaDef.some(u => Number(u.br) > 0)) ? 1 : 0
    // Keep the existing battle estimator, but make its uncertainty explicit.
    // A group that loses against an actual reaction is not a certain capture
    // merely because it beats 35% of the reaction fleet on paper.
    const pCapture = emptyLandCapture || unopposedLanding ? 1 : reactionCf > 0 || reactionGround.length > 0
        ? (1 - reactionWeight) * (amphibious ? noReactionNaval : 1) * pGround
            + reactionWeight * (amphibious ? fullReactionNaval : 1) * pGroundWithReaction
        : (amphibious ? noReactionNaval : 1) * pGround
    const chosenHasBr=seaDef.concat(reaction).some(u=>u.class==="air" || Number(u.br)>0)
    const weightedNaval=typeof em_naval_outcome==="function"
        ? em_naval_outcome({attCF:attSea,defCF:defSea+reactionWeight*reactionCf,attHasBr,defHasBr:chosenHasBr}).pWin
        : naval.pWin
    const navalSafe=!amphibious || unopposedLanding || weightedNaval>0
    const terminalResource = ec_terminal_resource_target(target, env)
    const resourceClock = ec_resource_clock_target(target, env)
    const minimum = terminalResource ? 0 : resourceClock ? 0.35 : env.powGap && Number(env.view.political_will) <= 2
        ? Number(config.epDesperateMinP ?? 0.45) : Number(config.epMinP ?? 0.6)
    const desiredProbability = Number(config.epDesiredP ?? 0.75)
    const viableNavalRoute = terminalResource || resourceClock ? pCapture > 0 : navalSafe
    const reactionGroundCovered=!env.requireGroundReactionCover || !uncoveredGroundReaction
    const landingSupply=ec_korean_supply(group,target,env)
    const supplySafe=!landingSupply || landingSupply.eligible && landingSupply.supplied
    return { executable: supplySafe && ground.length > 0 && viableNavalRoute && pCapture > 0 && pCapture >= minimum && reactionGroundCovered,
        ...(landingSupply?{landingSupply}:{}),
        pCapture: Number(pCapture.toFixed(2)), requiredProbability: minimum, desiredProbability,
        riskPolicy: terminalResource ? "final-resource-deadline" : resourceClock ? "resource-clock" : "ordinary-capture",
        attackingGround: ground.reduce((s, u) => s + ec_cf(u), 0), defendingGround: groundDef.reduce((s, u) => s + ec_cf(u), 0),
        defendingGarrisons: groundDef.filter(u => u.garrison).map(u => u.id),
        pGround, pGroundWithReaction, pNaval: noReactionNaval, pNavalWithReaction: fullReactionNaval, pNavalWeighted:weightedNaval,
        attackingAirSea: attSea, defendingAirSea: defSea, potentialReaction: reactionCf, reactionWeight, emptyLandCapture, unopposedLanding,
        ...(reactionChance ? {publicReactionChance:reactionChance} : {}),
        reactionEstimate: reactionPlan.estimate, reactionHq: reactionPlan.hq ?? null, reactionBudget: reactionPlan.budget ?? null,
        reactionUnitIds: reaction.map(u => u.id),
        reactionGroundUnitIds: reactionGround.map(u=>u.id),
        potentialGroundReaction:reactionGround.reduce((sum,u)=>sum+ec_cf(u),0),
        uncoveredGroundReaction,
        rejection: !supplySafe ? "korean-landing-without-steady-supply" : !reactionGroundCovered ? "insufficient-ground-reaction-cover" : terminalResource && pCapture <= 0 ? "capture-probability-below-threshold"
            : !viableNavalRoute ? "insufficient-air-sea-cover" : pCapture <= 0 || pCapture < minimum ? "capture-probability-below-threshold" : null }
}

function ec_make_task(kind, hex, group, support, mode, env, extra) {
    const movementUnitIds = group.map(u => u.id)
    const supportUnitIds = support.map(u => u.id)
    return { id: kind + ":" + hex + ":" + movementUnitIds.join("-"), kind, hex,
        originHex: group[0]?.location ?? null,
        movementUnitIds, supportUnitIds, escortUnitIds: group.filter(u => u.class === "naval").map(u => u.id),
        requiredUnits: movementUnitIds.concat(supportUnitIds), movementModes: [mode],
        preferredHq: env.hq.id, legality: "engine-group-query", ...extra }
}

// Several legal stacks may converge on one land battle. Every origin/mode
// is queried separately; this never treats different origins as one stack.
function ec_ground_convergence(env) {
    const tasks = []
    for (const hex of env.captureTargets) {
        const land = env.available.filter(u => u.class === "ground" && (!env.garrisonReserve.has(u.id) || env.allowReservedGround?.(u))
            && ec_query_moves([u.id], GROUND_MOVE, env).reachableHexes?.includes(hex))
            .sort((a,b) => ec_cf(b)-ec_cf(a) || a.id-b.id).slice(0, 6)
        const subsets = []
        function combinations(start, selected) {
            if (selected.length) subsets.push(selected.slice())
            if (selected.length >= 3) return
            for (let i=start;i<land.length;i++) combinations(i+1, selected.concat(land[i]))
        }
        combinations(0, [])
        const naval = env.available.filter(u => u.class === "naval"
            && ec_query_moves([u.id], NAVAL_MOVE, env).reachableHexes?.includes(hex))
            .sort((a,b) => ec_cf(b)-ec_cf(a) || a.id-b.id).slice(0, 6)
        const fleets = [[]]
        for (const origin of [...new Set(naval.map(n=>n.location))]) {
            const local = naval.filter(n=>n.location===origin)
            for (let count=1;count<=Math.min(3,local.length);count++) fleets.push(local.slice(0,count))
        }
        for (const ground of subsets) for (const fleet of fleets) {
            const force = ground.concat(fleet)
            if (force.length > env.budget || !ec_service_compatible(force, env.view, env.faction)) continue
            const arrivals = new Set(force.map(u=>u.id))
            const atTarget = env.units.filter(u=>u.faction===env.faction && u.location===hex && !arrivals.has(u.id))
            if (ground.length + atTarget.filter(u=>u.class==="ground"||u.class==="air").length > 3
                || fleet.length + atTarget.filter(u=>u.class==="naval").length > 6) continue
            const movementGroups = []
            for (const [mode, units] of [["GROUND",ground],["NAVAL",fleet]]) for (const origin of [...new Set(units.map(u=>u.location))]) {
                const unitIds = units.filter(u=>u.location===origin).map(u=>u.id)
                if (!ec_query_moves(unitIds, mode==="GROUND"?GROUND_MOVE:NAVAL_MOVE, env).reachableHexes?.includes(hex)) continue
                movementGroups.push({originHex:origin, mode, unitIds})
            }
            if (movementGroups.flatMap(g=>g.unitIds).length !== force.length) continue
            const support = ec_support(force, hex, env), assessment = ec_assess(force,support,hex,false,env)
            const previous = env.homeAssaults.get(hex)
            if (!previous || assessment.pCapture > previous.pCapture) env.homeAssaults.set(hex,
                { hex, hq:env.hq.id, cardId:env.cardId, ...assessment, movementUnitIds:force.map(u=>u.id),supportUnitIds:support.map(u=>u.id), movementGroups })
            if (!assessment.executable) continue
            const score = ec_score_target(env.byHex.get(hex),env)*assessment.pCapture
                - (force.length+support.length)*2 - Math.max(0,assessment.desiredProbability-assessment.pCapture)*40
            tasks.push(ec_make_task("CONQUEST",hex,force,support,"GROUND",env,{score,assessment,aspCost:0,
                declaresBattle:assessment.defendingGround>0 || env.units.some(u=>u.faction!==env.faction&&u.location===hex),
                objective:env.objectiveForTarget?.(hex) || env.convergenceObjective || "SOUTHERN_CONQUEST", movementGroups,
                ...(env.convergenceObjective==="HOMELAND" ? {victoryObjective:"HOMELAND",
                    retentionRisks:[...new Set(ground.map(u=>u.location))].filter(origin=>(env.view.capture || []).includes(origin)
                        && !env.units.some(u=>u.faction===env.faction && u.class==="ground" && u.location===origin
                            && !ground.some(g=>g.id===u.id))).map(hex=>({hex,reason:"newly-captured-source-loses-its-last-ground-garrison"}))} : {})}))
        }
    }
    return tasks
}

// Two embarkation ports can contribute to one amphibious battle. Each group
// has its own legal route and escort; all ground arrivals are amphibious.
function ec_amphibious_convergence(env) {
    const tasks=[],groups=[],aspBudget=ec_asp_remaining(env.view,env.faction)
    const grounds=env.available.filter(u=>u.class==="ground" && (u.asp||u.aspCost) && !env.garrisonReserve.has(u.id))
        .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,10)
    for(const origin of [...new Set(grounds.map(u=>u.location))]) {
        const land=grounds.filter(u=>u.location===origin).slice(0,3)
        const navy=env.available.filter(u=>u.class==="naval"&&u.location===origin)
            .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,4)
        const carrier=navy.find(u=>Number(u.br)>0),orders=[navy]
        if(carrier&&navy[0]!==carrier)orders.push([carrier,...navy.filter(u=>u.id!==carrier.id)])
        const seen=new Set()
        for(let ng=1;ng<=land.length;ng++)for(const order of orders)for(let ns=1;ns<=Math.min(3,order.length);ns++) {
            const force=land.slice(0,ng).concat(order.slice(0,ns)),key=force.map(u=>u.id).sort((a,b)=>a-b).join(",")
            if(seen.has(key)||force.length>=env.budget||!ec_service_compatible(force,env.view,env.faction))continue
            seen.add(key)
            const reach=ec_query_moves(force.map(u=>u.id),AMPH_MOVE,env)
            if(reach.reachableHexes?.some(h=>env.captureTargets.has(h)))groups.push({origin,force,reach})
        }
    }
    for(const hex of env.captureTargets) {
        const md=env.byHex.get(hex)
        const defense=typeof queryDefendingGround==="function" ? queryDefendingGround(hex,{faction:1-env.faction})?.units : null
        if(!env.units.some(u=>u.faction!==env.faction&&u.class==="ground"&&u.location===hex)&&!defense?.length)continue
        const arrivals=groups.filter(g=>g.reach.reachableHexes.includes(hex)
            && !(env.faction===1&&md?.island&&g.force.some(u=>u.class==="ground"&&u.service==="army")
                &&!g.force.some(u=>u.class==="ground"&&u.service==="navy")))
        for(let a=0;a<arrivals.length;a++)for(let b=a+1;b<arrivals.length;b++) {
            const ga=arrivals[a],gb=arrivals[b]
            if(ga.origin===gb.origin)continue
            const force=ga.force.concat(gb.force),cost=Number(ga.reach.aspCost||0)+Number(gb.reach.aspCost||0)
            const at=env.units.filter(u=>u.faction===env.faction&&u.location===hex)
            if(force.length>env.budget||cost>aspBudget||!ec_service_compatible(force,env.view,env.faction)
                ||force.filter(u=>u.class==="ground").length+at.filter(u=>u.class==="ground"||u.class==="air").length>3
                ||force.filter(u=>u.class==="naval").length+at.filter(u=>u.class==="naval").length>6)continue
            const support=ec_support(force,hex,env),assessment=ec_assess(force,support,hex,true,env)
            if(env.convergenceObjective==="PACIFIC_BREAKTHROUGH" && env.centralAssaultAttempts) {
                const prior=env.centralAssaultAttempts.get(hex)
                if(!prior || assessment.pCapture>prior.assessment.pCapture) env.centralAssaultAttempts.set(hex,
                    {cardId:env.cardId,hqId:env.hq.id,groundIds:force.filter(u=>u.class==="ground").map(u=>u.id),
                        escortIds:force.filter(u=>u.class==="naval").map(u=>u.id),
                        originById:Object.fromEntries(force.map(u=>[u.id,u.location])),aspCost:cost,assessment,
                        evidence:"actual legal two-port AA paths, command, stack and ASP; capture estimate below threshold"})
            }
            if(!assessment.executable||!force.some(u=>u.class==="naval"))continue
            const movementGroups=[ga,gb].map(g=>({originHex:g.origin,mode:"AA",unitIds:g.force.map(u=>u.id)}))
            const previous=env.homeAssaults.get(hex)
            if(!previous||assessment.pCapture>previous.pCapture)env.homeAssaults.set(hex,
                {hex,hq:env.hq.id,cardId:env.cardId,...assessment,movementUnitIds:force.map(u=>u.id),supportUnitIds:support.map(u=>u.id),movementGroups})
            tasks.push(ec_make_task("CONQUEST",hex,force,support,"AA",env,
                {score:ec_score_target(md,env)*assessment.pCapture-(force.length+support.length)*2
                    -Math.max(0,assessment.desiredProbability-assessment.pCapture)*40,
                    assessment,aspCost:cost,declaresBattle:true,
                    objective:env.objectiveForTarget?.(hex)||env.convergenceObjective||"SOUTHERN_CONQUEST",movementGroups,
                    ...(env.convergenceObjective==="HOMELAND"?{victoryObjective:"HOMELAND"}:{} )}))
        }
    }
    return tasks
}

function ec_softening_followup(hex,env) {
    if (!ec_offensive_refined()) return null
    const prior=(env.view.ai?.plan?.tasks || []).find(t=>t.objective==="GROUND_SOFTEN" && t.hex===hex && t.softeningGoal)
    if (!prior || ec_control(hex,env.faction)) return null
    const current=env.groundDefenses?.get(hex) || (typeof queryDefendingGround==="function"?queryDefendingGround(hex,{faction:1-env.faction}):null)
    return current && current.cf<prior.softeningGoal.beforeCf ? {target:hex,beforeCf:prior.softeningGoal.beforeCf,currentCf:current.cf,
        evidence:"actual defending ground reduction; current assault still passes original legality and probability"}:null
}
function ec_missions(env) {
    const result = []
    const homelandGround = u => env.faction === 1 && env.powGap === 0
        && env.victory.homelandKeys.includes(u.location) && ec_control(u.location, env.faction)
    const grounds = env.available.filter(u => u.class === "ground"
        && (!env.garrisonReserve.has(u.id) || homelandGround(u) || ec_resource_followup_ground(u,env)))
        .sort(env.groundOrder || ((a, b) => Number(homelandGround(b)) - Number(homelandGround(a))
            || ec_cf(b) - ec_cf(a) || a.id - b.id)).slice(0, 10)
    const groups = []
    for (const origin of [...new Set(grounds.map(g => g.location))]) {
        const localGround = grounds.filter(g => g.location === origin).slice(0, 3)
        const escorts = env.available.filter(n => n.class === "naval" && n.location === origin)
            .sort((a, b) => ec_cf(b) - ec_cf(a) || a.id - b.id)
        for (const lead of localGround) {
            const compatible = [lead].concat(localGround.filter(g => g.id !== lead.id
                && ec_service_compatible([lead, g], env.view, env.faction)))
            for (let ng = 1; ng <= compatible.length; ng++) {
                const groundGroup = compatible.slice(0, ng)
                groups.push({ units: groundGroup, mode: "GROUND", value: typeof GROUND_MOVE === "undefined" ? 4 : GROUND_MOVE })
                if (groundGroup.some(g => !(g.asp || g.aspCost))) continue
                groups.push({ units: groundGroup, mode: "AA", value: typeof AMPH_MOVE === "undefined" ? 8 : AMPH_MOVE })
                const compatibleEscorts = escorts.filter(n => ec_service_compatible(groundGroup.concat(n), env.view, env.faction))
                const carrier = compatibleEscorts.find(n => Number(n.br) > 0)
                const orders = [compatibleEscorts]
                if (carrier && compatibleEscorts[0] !== carrier) orders.push([carrier, ...compatibleEscorts.filter(n => n.id !== carrier.id)])
                for (const order of orders) for (let ns = 1; ns <= Math.min(6, order.length); ns++)
                    if (ng + ns <= env.budget) groups.push({ units: groundGroup.concat(order.slice(0, ns)), mode: "AA",
                        value: typeof AMPH_MOVE === "undefined" ? 8 : AMPH_MOVE })
            }
        }
    }
    const seen = new Set()
    for (const group of groups) {
        if (group.units.length > env.budget || !ec_service_compatible(group.units, env.view, env.faction)) continue
        const key = group.mode + ":" + group.units.map(u => u.id).sort((a, b) => a - b).join(",")
        if (seen.has(key)) continue
        seen.add(key)
        const reach = ec_query_moves(group.units.map(u => u.id), group.value, env)
        for (const hex of reach.reachableHexes || []) {
            const m = env.byHex.get(hex)
            if (!m || !ec_control(hex, 1 - env.faction)) continue
            if (env.captureTargets && !env.captureTargets.has(hex)) continue
            if (group.units.some(u => env.garrisonReserve.has(u.id))
                && !(group.mode === "GROUND" && env.victory.homelandKeys.includes(hex))
                && !group.units.filter(u=>env.garrisonReserve.has(u.id)).every(u=>ec_resource_followup_ground(u,env,hex))) continue
            const nearHomeOrigin = env.byHex.get(group.units[0].location)?.port
                && env.victory.homelandKeys.some(key => ec_dist(group.units[0].location,key) <= 5)
            const nearHomeTarget = env.victory.homelandKeys.some(key => ec_dist(hex,key) <= 5)
            // Once the current PoW quota is safe, do not spend the only
            // assembled invasion escort on a distant late resource raid when
            // too many Japanese resources remain for the atomic deadline.
            if (env.homelandApproach && Number(env.view.turn) >= 9 && env.powGap === 0
                && env.victory.jpResources > 4 && group.mode === "AA"
                && group.units.some(u => u.class === "naval") && nearHomeOrigin && !nearHomeTarget) continue
            // 8.45D also applies to empty one-hex islands. Some old movement
            // paths omit this check in their empty-landing branch; do not use
            // that omission to grant the bot an illegal invasion.
            if (env.faction === 1 && group.mode === "AA" && m.island && group.units.some(u => u.class === "ground" && u.service === "army")
                && !group.units.some(u => u.class === "ground" && u.service === "navy")) continue
            const support = ec_support(group.units, hex, env)
            let force = support.slice(), assessment = ec_assess(group.units, force, hex, group.mode === "AA", env)
            if (env.victory.homelandKeys.includes(hex) || env.captureTargets?.has(hex)) {
                const candidate = { hex, hq: env.hq.id, cardId: env.cardId, pCapture: assessment.pCapture,
                    requiredProbability: assessment.requiredProbability, reason: assessment.rejection,
                    movementUnitIds: group.units.map(u => u.id), supportUnitIds: force.map(u => u.id),
                    mode: group.mode, attackingGround: assessment.attackingGround,
                    defendingGround: assessment.defendingGround, attackingAirSea: assessment.attackingAirSea,
                    defendingAirSea: assessment.defendingAirSea, potentialReaction: assessment.potentialReaction }
                const previous = env.homeAssaults.get(hex)
                if (!previous || candidate.pCapture > previous.pCapture
                    || candidate.pCapture === previous.pCapture && candidate.attackingGround > previous.attackingGround)
                    env.homeAssaults.set(hex, candidate)
            }
            if (group.mode === "AA" && !group.units.some(u => u.class === "naval") && !assessment.unopposedLanding) continue
            if (!assessment.executable) {
                if (env.blockers.length < 12) env.blockers.push({ hex, reason: assessment.rejection,
                    hq: env.hq.id, unitIds: group.units.map(u => u.id) })
                continue
            }
            // Remove dispensable support without changing the ground/escort group.
            while (force.length) {
                const reduced = ec_assess(group.units, force.slice(0, -1), hex, group.mode === "AA", env)
                if (!reduced.executable || reduced.pCapture < Math.min(assessment.desiredProbability, assessment.pCapture)) break
                force.pop(); assessment = reduced
            }
            const softeningFollowup=ec_softening_followup(hex,env)
            const score = ec_score_target(m, env) * assessment.pCapture + (softeningFollowup ? 200 : 0)
                + (assessment.riskPolicy === "final-resource-deadline" ? 1000 + 1000 * assessment.pCapture
                    : assessment.riskPolicy === "resource-clock" ? 60 + 120 * assessment.pCapture : 0)
                - (group.units.length + force.length) * 2 - ec_dist(group.units[0].location, hex)
                - Math.max(0, assessment.desiredProbability - assessment.pCapture) * 40
                - (env.forceOpportunityCost ? env.forceOpportunityCost(group.units, m, assessment) : 0)
            result.push(ec_make_task("CONQUEST", hex, group.units, force, group.mode, env,
                { score, assessment, aspCost: group.mode === "AA" ? Number(reach.aspCost || 0) : 0,
                    ...(softeningFollowup ? {followupOfSoftening:softeningFollowup}:{}),
                    ...(ec_offensive_refined() && group.units.some(u=>env.garrisonReserve.has(u.id)) ? {garrisonRelease:group.units.filter(u=>env.garrisonReserve.has(u.id)).map(u=>({id:u.id,source:u.location,target:hex,remainingSourceGround:env.units.filter(x=>x.faction===env.faction && x.class==="ground" && x.location===u.location && !group.units.some(g=>g.id===x.id)).length,reason:"known offensive assembly or near-complete bombing resource route; real assault reevaluated",risk:"source may be recaptured"}))}:{}),
                    declaresBattle: assessment.defendingGround > 0 || env.units.some(u => u.faction !== env.faction && u.location === hex),
                    objective: env.powGap && m.named && !(env.view.capture || []).includes(hex) ? "POW"
                        : env.victory.homelandKeys.includes(hex) ? "HOMELAND" : ec_national_bonus(hex,env.national || []) ? "NATIONAL_LIBERATION" : m.resource ? "RESOURCES" : "FORWARD_BASE" }))
        }
    }
    return result.sort((a, b) => b.score - a.score || a.requiredUnits.length - b.requiredUnits.length || a.hex - b.hex || a.id.localeCompare(b.id))
}

// This is a public preparation screen, not a hypothetical movement grant.
// The transport still uses its real origin/HQ/path, and an eventual assault
// must query the ground unit again after arrival. A co-located fleet alone
// cannot justify assembly if no single HQ can command the arriving ground.
function ec_assembly_command(ground, port, target, env, requireNaval=true) {
    env.assemblyCommands ||= new Map()
    const key = [env.cardId, ground.id, port, target,requireNaval].join(":")
    if (env.assemblyCommands.has(key)) return env.assemblyCommands.get(key)
    let best = null
    const candidates = (env.view.ai?.ownCards || []).filter(c => c.id !== env.cardId
        && c.allowed?.includes("ops")).sort((a,b)=>Number(b.ops)-Number(a.ops)||a.id-b.id)
    // Ordinary OC preview uses printed OPS; equivalent known cards need one
    // witness per value, not repeated identical searches across the hand.
    const cards=candidates.filter((c,i,cs)=>cs.findIndex(x=>x.ops===c.ops)===i)
    const hqs = env.units.filter(h => h.faction === env.faction && h.class === "hq"
        && !env.view.oos?.includes(h.id) && (Number(ground.supply) & Number(h.supply)))
    for (const card of cards) for (const hq of hqs) {
        const previewKey = [card.id, hq.id].join(":")
        env.assemblyPreviews ||= new Map()
        if (!env.assemblyPreviews.has(previewKey)) env.assemblyPreviews.set(previewKey,
            typeof queryCardPreview === "function" ? queryCardPreview(card.id,
                { faction: env.faction, hqId: hq.id, cardMode: "ops" }) : null)
        const preview = env.assemblyPreviews.get(previewKey)
        if (!preview?.eligible || !(preview.activationBudget > 1)) continue
        env.assemblyArrivals ||= new Map()
        const arrivalKey=[ground.id,port,card.id,hq.id].join(":")
        if (!env.assemblyArrivals.has(arrivalKey)) env.assemblyArrivals.set(arrivalKey,
            typeof queryGroundPreparation!=="function" || queryGroundPreparation(ground.id,port,target,
                {faction:env.faction,cardId:card.id,hqId:hq.id,cardMode:"ops",activationOnly:true}).eligible)
        if (!env.assemblyArrivals.get(arrivalKey)) continue
        const fleet = env.units.filter(n => n.faction === env.faction && n.class === "naval" && n.location === port
            && preview.units?.includes(n.id) && (Number(n.supply) & Number(hq.supply))
            && ec_service_compatible([ground,n],env.view,env.faction))
            .sort((a,b) => ec_cf(b)-ec_cf(a) || a.id-b.id)
        const carrier = fleet.find(n => Number(n.br)>0), orders = [fleet]
        if (carrier && carrier!==fleet[0]) orders.push([carrier,...fleet.filter(n=>n!==carrier)])
        env.assemblyFrames ||= new Map()
        if (!env.assemblyFrames.has(previewKey)) env.assemblyFrames.set(previewKey,
            {...env,hq,cardId:card.id,cardMode:"ops",budget:preview.activationBudget,moves:new Map(),reactions:new Map()})
        const next=env.assemblyFrames.get(previewKey)
        for (const order of orders) for (let count=1;count<=Math.min(6,order.length,preview.activationBudget-1);count++) {
            const escorts=order.slice(0,count), force=[{...ground,location:port},...escorts]
            if (!ec_service_compatible(force,env.view,env.faction)
                || !ec_query_moves(escorts.map(n=>n.id),typeof NAVAL_MOVE==="undefined"?2:NAVAL_MOVE,next)
                    .reachableHexes?.includes(target)) continue
            const assessment=ec_assess(force,[],target,true,next)
            // Assembly can prepare a first army for a later combined landing.
            // Require a commandable fleet that can contest the naval stage;
            // report the ground stage separately instead of calling it ready.
            const navalReadiness=assessment.pNavalWeighted
            if (requireNaval && navalReadiness<assessment.requiredProbability) continue
            const screen={hqId:hq.id,cardId:card.id,activationBudget:preview.activationBudget,
                groundSupplyCompatible:true,rallyFleetIds:escorts.map(n=>n.id),supportIds:[],
                requiredActivations:force.length,pCaptureEstimate:assessment.pCapture,
                navalReadinessEstimate:navalReadiness,assaultReadyEstimate:assessment.executable,
                evidence:"public-command-screen; ground arrival/path/ASP require revalidation"}
            if (!best || screen.pCaptureEstimate>best.pCaptureEstimate
                || screen.pCaptureEstimate===best.pCaptureEstimate && screen.requiredActivations<best.requiredActivations) best=screen
        }
    }
    env.assemblyCommands.set(key,best)
    return best
}

// An independent public preparation witness keeps invasion transport from
// inheriting an unrelated resource objective. It never authorizes an attack.
// Resource preparation is an explicit two-card witness, never a movement grant.
function ec_central_pacific_targets(env) {
    if (!ec_route_refined(env.view) || Number(env.view.turn)<5 || Number(env.view.turn)>=12) return []
    if (env.centralPacificTargets) return env.centralPacificTargets
    const ring=[3416,3615,3813,3814,4017,4415,4715,3209,3709].map(hex_to_int)
    const targets=env.board.filter(m=>(m.port || m.airfield) && ring.includes(m.hex) && ec_control(m.hex,1-env.faction))
    const bases=env.board.filter(m=>m.port && ec_control(m.hex,env.faction)),routes=[]
    if (ec_offensive_refined()) bases.sort((a,b)=>Math.min(...targets.map(t=>ec_dist(a.hex,t.hex)))-Math.min(...targets.map(t=>ec_dist(b.hex,t.hex))) || a.hex-b.hex)
    let queries=0
    for (const port of bases) {
        const ground=env.available.filter(u=>u.class==="ground" && (u.asp||u.aspCost) && u.location===port.hex
            && !env.garrisonReserve?.has(u.id)).sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,3)
        const ships=env.available.filter(u=>u.class==="naval" && u.location===port.hex).sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id)
        const escorts=[...new Set([ships[0],ships.find(u=>Number(u.br)>0)].filter(Boolean))]
        for (const g of ground) for (const n of escorts) {
            if (queries>=24 || env.budget<2 || !ec_service_compatible([g,n],env.view,env.faction)) continue
            queries++
            const move=ec_query_moves([g.id,n.id],AMPH_MOVE,env)
            if (Number(move.aspCost || 0)>ec_asp_remaining(env.view,env.faction)) continue
            const reachable=targets.filter(t=>move.reachableHexes?.includes(t.hex)).map(t=>t.hex)
            if(reachable.length) routes.push({groundId:g.id,origin:port.hex,reachable})
        }
    }
    const selected=targets.filter(t=>routes.some(r=>r.reachable.includes(t.hex)))
        .sort((a,b)=>Math.min(...routes.filter(r=>r.reachable.includes(a.hex)).map(r=>ec_dist(r.origin,a.hex)))
            -Math.min(...routes.filter(r=>r.reachable.includes(b.hex)).map(r=>ec_dist(r.origin,b.hex)))
            || ec_dist(a.hex,TOKYO)-ec_dist(b.hex,TOKYO) || a.hex-b.hex).slice(0,4).map(m=>m.hex)
    env.centralEmbarkationGroundIds=[...new Set(routes.filter(r=>r.reachable.some(h=>selected.includes(h))).map(r=>r.groundId))]
    env.centralPacificTargets=selected
    return selected
}
function ec_central_pacific_bonus(m,env) {
    if (!ec_central_pacific_targets(env).includes(m.hex) || Number(env.view.turn)>10) return 0
    const ports=env.board.filter(b=>b.port && ec_control(b.hex,env.faction)
        && env.available.some(g=>g.class==="ground" && (g.asp||g.aspCost) && g.location===b.hex)
        && env.available.some(n=>n.class==="naval" && n.location===b.hex))
    return ec_dist(m.hex,TOKYO)+2<=Math.min(...ports.map(b=>ec_dist(b.hex,TOKYO))) ? 80 : 0
}
function ec_ground_softening_tasks(env,executable=[]) {
    const tasks=[],turn=Number(env.view.turn)
    if (!ec_route_refined(env.view) || turn<5 || turn>=12 || env.powGap) return tasks
    const resourceRoute=ec_route_allows_atomic(env.view,env.board) && env.victory.atomic?.noStrategicBombingFailure
        && env.victory.atomic?.b29InRangeOfTokyo && env.victory.jpResources<=3
    const targets=[...new Set((resourceRoute ? env.victory.resourceTargets : env.victory.homelandKeys).concat(ec_central_pacific_targets(env),ec_offensive_refined()?(env.national || []).filter(n=>n.active).flatMap(n=>n.missingKeys):[]))]
    const central=new Set(ec_central_pacific_targets(env))
    for (const hex of targets.filter(h=>!ec_control(h,env.faction))) {
        const centralOnly=central.has(hex) && !(resourceRoute ? env.victory.resourceTargets : env.victory.homelandKeys).includes(hex)
        const witness=env.centralAssaultAttempts?.get(hex)
        if (centralOnly && (executable.some(t=>t.kind==="CONQUEST"&&t.hex===hex)
            || !witness || witness.assessment.pNavalWithReaction<.6
            || (env.view.ai?.ownCards || []).length<(ec_card_window(env.view)?2:1))) continue
        const defending=typeof queryDefendingGround==="function"?queryDefendingGround(hex,{faction:1-env.faction}):null
        const steps=(defending?.units || []).reduce((sum,u)=>sum+(u.reduced||u.oneStep?1:2),0)
        if (steps<=1 || env.units.some(u=>u.faction!==env.faction && u.location===hex && ["air","naval"].includes(u.class))) continue
        const forces=[{units:[],mode:"RANGED"}]
        const ships=env.available.filter(u=>u.class==="naval")
        for(const origin of [...new Set(ships.map(u=>u.location))]){
            const local=ships.filter(u=>u.location===origin).sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id)
            for(let count=1;count<=Math.min(5,local.length,env.budget);count++){
                const group=local.slice(0,count)
                if(ec_service_compatible(group,env.view,env.faction)
                    &&ec_query_moves(group.map(u=>u.id),NAVAL_MOVE,env).reachableHexes?.includes(hex))forces.push({units:group,mode:"NAVAL"})
            }
        }
        for(const group of forces){
            const support=ec_support(group.units,hex,env),force=group.units.concat(support)
            if(!force.length || force.length>env.budget)continue
            const assessment=ec_assess(group.units,support,hex,false,env)
            if(assessment.pNavalWithReaction<.6 || assessment.attackingAirSea<assessment.defendingAirSea
                || assessment.attackingAirSea*.5<Math.min(...defending.units.map(u=>Number(u.lf)||1)))continue
            tasks.push(ec_make_task("SUPPRESS",hex,group.units,support,group.mode,env,
                {score:centralOnly ? Math.min(120,80+steps*10) : 190+Math.min(80,defending.cf)+Math.min(30,(steps-1)*10),objective:"GROUND_SOFTEN",
                preparationOnly:true,targetClasses:["ground"],declaresBattle:true,aspCost:0,
                rangedSupport:!group.units.length,movementGroups:group.units.length?[{originHex:group.units[0].location,mode:"NAVAL",unitIds:group.units.map(u=>u.id)}]:[],assessment,softeningGoal:{beforeCf:defending.cf,beforeSteps:steps,
                    units:defending.units.map(u=>({id:u.id,reduced:u.reduced,cf:u.cf})),
                    ...(centralOnly ? {landingWitness:witness} : {}),
                    outcome:"actual ground reduction only; no occupation or victory credit"},followUpTarget:hex}))
        }
    }
    return tasks
}

function ec_preparation_conflicts(prior,next) {
    const conflict=(prepared,moving)=>["RESOURCE_ASSEMBLE","OFFENSIVE_ASSEMBLE","KOREAN_SUPPLY_PREP"].includes(prepared.objective) && prepared.attackWitness
        && moving.hex!==prepared.hex && (moving.movementUnitIds || []).some(id=>
            [...prepared.attackWitness.groundIds,...prepared.attackWitness.escortIds,...prepared.attackWitness.supportIds].includes(id))
    const landingConflict=(prepared,moving)=>!!prepared.softeningGoal?.landingWitness
        && (moving.movementUnitIds || []).some(id=>{const origin=prepared.softeningGoal.landingWitness.originById?.[id];
            return Number.isInteger(origin) && moving.hex!==origin})
    return conflict(prior,next) || conflict(next,prior) || landingConflict(prior,next) || landingConflict(next,prior)
}
function ec_resource_assembly_tasks(env) {
    const tasks=[],atomic=env.victory.atomic,turn=Number(env.view.turn)
    if (!ec_route_refined(env.view) || !ec_route_allows_atomic(env.view,env.board) || turn<9
        || !atomic?.noStrategicBombingFailure || !atomic?.b29InRangeOfTokyo || env.victory.jpResources>3
        || env.victory.jpResources<=1 || Number(env.view.political_will)<=2
        || env.powGap && turn<12 || (env.view.ai?.ownCards || []).length<2) return tasks
    if (env.board.filter(m=>m.region==="Manchuria" && m.resource && ec_control(m.hex,0)).length>=2) return tasks
    const hand=(env.view.ai?.ownCards || []).filter(c=>c.id!==env.cardId && !/soviet/i.test(c.name || ""))
    const ops=hand.filter(c=>c.allowed?.includes("ops")).sort((a,b)=>Number(b.ops)-Number(a.ops)||a.id-b.id)
        .filter((c,i,cs)=>cs.findIndex(x=>x.ops===c.ops)===i).slice(0,1).map(c=>({...c,mode:"ops"}))
    const events=hand.filter(c=>c.previewEvent && c.allowed?.includes("event"))
        .sort((a,b)=>Number(b.logistic||0)-Number(a.logistic||0)||a.id-b.id).slice(0,1).map(c=>({...c,mode:"event"}))
    const nextCards=events.concat(ops)
    const targets=env.victory.resourceTargets.filter(h=>env.byHex.get(h)?.region!=="Manchuria")
    const ports=env.board.filter(m=>m.port && ec_control(m.hex,env.faction)
        && targets.some(h=>ec_dist(m.hex,h)<=8)
        && env.units.some(g=>g.faction===env.faction && g.class==="ground" && g.location===m.hex && (g.asp||g.aspCost))
        && env.units.some(n=>n.faction===env.faction && n.class==="naval" && n.location===m.hex && Number(n.br)>0))
        .sort((a,b)=>Math.min(...targets.map(h=>ec_dist(a.hex,h)))-Math.min(...targets.map(h=>ec_dist(b.hex,h)))||a.hex-b.hex).slice(0,3)
    const hqs=env.units.filter(h=>h.faction===env.faction && h.class==="hq" && !env.view.oos?.includes(h.id))
    for (const port of ports) {
        const occupants=env.units.filter(u=>u.faction===env.faction && u.location===port.hex && ["ground","air"].includes(u.class))
        const heldCapture=ec_offensive_refined()?(env.view.capture || []).filter(h=>ec_control(h,env.faction)):[]
        const local=occupants.filter(g=>g.class==="ground" && (g.asp||g.aspCost)
            && !(ec_offensive_refined() && env.garrisonReserve.has(g.id) && heldCapture.includes(g.location) && heldCapture.length<=Number(env.view.pow || 0))),slots=3-occupants.length
        if (slots<1) continue
        const arrivals=env.available.filter(g=>g.class==="ground" && (g.asp||g.aspCost) && g.stratMove && g.location!==port.hex
            && !env.garrisonReserve.has(g.id) && ec_service_compatible(local.concat(g),env.view,env.faction)
            && ec_query_moves([g.id],STRAT_MOVE,env).reachableHexes?.includes(port.hex))
            .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,5)
        const groups=arrivals.map(g=>[g]);if(slots>=2)for(let i=0;i<arrivals.length;i++)for(let j=i+1;j<arrivals.length;j++)groups.push([arrivals[i],arrivals[j]])
        for (const incoming of groups.sort((a,b)=>b.length-a.length)) {
            const ground=local.concat(incoming).map(g=>({...g,location:port.hex}))
            if (incoming.length>env.budget || ground.length>3 || !ec_service_compatible(ground,env.view,env.faction)) continue
            for (const target of targets.filter(h=>ec_dist(port.hex,h)<=8))for(const card of nextCards)for(const hq of hqs) {
                const fleet=env.units.filter(n=>n.faction===env.faction && n.class==="naval" && n.location===port.hex
                    && ec_service_compatible(ground.concat(n),env.view,env.faction)).sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id)
                const carrier=fleet.find(n=>Number(n.br)>0),orders=[fleet];if(carrier && carrier!==fleet[0])orders.push([carrier,...fleet.filter(n=>n!==carrier)])
                for (const order of orders)for(let count=1;count<=Math.min(3,order.length,9-ground.length);count++) {
                    if (env.resourceAssemblyQueries.count>=24) return tasks
                    const escorts=order.slice(0,count),force=ground.concat(escorts);env.resourceAssemblyQueries.count++
                    const projection=typeof queryAmphibiousPreparation==="function" ? queryAmphibiousPreparation(force.map(u=>u.id),port.hex,target,
                        {faction:env.faction,cardId:card.id,hqId:hq.id,cardMode:card.mode}) : null
                    if (!projection?.eligible || !projection.reachable || projection.aspCost>ec_asp_remaining(env.view,env.faction)
                        || force.length>projection.activationBudget) continue
                    const support=(projection.supportIds || []).map(id=>env.units.find(u=>u.id===id)).filter(Boolean)
                        .filter(u=>ec_service_compatible(force.concat(u),env.view,env.faction))
                        .sort((a,b)=>Number(projection.effectiveSupportCF?.[b.id]||0)-Number(projection.effectiveSupportCF?.[a.id]||0)||a.id-b.id)
                        .slice(0,projection.activationBudget-force.length)
                    const next={...env,hq,cardId:card.id,cardMode:card.mode,budget:projection.activationBudget,reactions:new Map()}
                    const assessment=ec_assess(force,support,target,true,next)
                    if (!assessment.executable) continue
                    tasks.push(ec_make_task("REDEPLOY",port.hex,incoming,[],"STRATEGIC",env,
                        {score:400+assessment.pCapture*120-incoming.length*5,objective:"RESOURCE_ASSEMBLE",preparationOnly:true,
                        victoryObjective:"ATOMIC_RESOURCE",followUpTarget:target,
                        movementGroups:incoming.map(g=>({originHex:g.location,mode:"STRATEGIC",unitIds:[g.id]})),
                        attackWitness:{cardId:card.id,cardMode:card.mode,hqId:hq.id,groundIds:ground.map(g=>g.id),escortIds:escorts.map(n=>n.id),
                            supportIds:support.map(u=>u.id),requiredActivations:force.length+support.length,aspCost:projection.aspCost,
                            pCaptureEstimate:assessment.pCapture,evidence:"current-own-card legal projected AA; actual attack must revalidate"}}))
                }
            }
        }
    }
    return tasks
}

function ec_strategic_preparation_targets(env) {
    const ring=[3416,3615,3813,3814,4017,4415,4715,3209,3709].map(hex_to_int)
    const ports=env.board.filter(m=>m.port && !ec_cbi(m.region) && ec_control(m.hex,env.faction)
        && env.units.some(n=>n.faction===env.faction && n.class==="naval" && n.location===m.hex))
    const central=env.board.filter(m=>ring.includes(m.hex) && ec_control(m.hex,1-env.faction))
        .sort((a,b)=>Math.min(...ports.map(p=>ec_dist(p.hex,a.hex)))-Math.min(...ports.map(p=>ec_dist(p.hex,b.hex))) || ec_dist(a.hex,TOKYO)-ec_dist(b.hex,TOKYO) || a.hex-b.hex)
        .slice(0,4).map(m=>m.hex)
    const national=(env.national || []).filter(n=>n.active).sort((a,b)=>a.missingKeys.length-b.missingKeys.length || a.id-b.id)
        .flatMap(n=>n.missingKeys).filter(h=>ports.some(p=>ec_dist(p.hex,h)<=8)).slice(0,4)
    return [...new Set(central.concat(national))].filter(h=>!ec_control(h,env.faction))
}
// Release a reserve only into a real resource attack while the bombing route is close to completion.
// Transport, PoW collection and unrelated attacks retain the ordinary reserve.
function ec_resource_followup_ground(u,env,target) {
    const a=env.victory.atomic,turn=Number(env.view.turn)
    if (!ec_offensive_refined()) return false
    const held=(env.view.capture || []).filter(h=>ec_control(h,env.faction))
    if (held.includes(u.location) && held.length<=Number(env.view.pow || 0)) return false
    const prepared=ec_offensive_refined() && env.powGap===0 && (env.view.ai?.plan?.tasks || []).some(t=>t.objective==="OFFENSIVE_ASSEMBLE"
        && t.hex===u.location && t.attackWitness?.groundIds?.includes(u.id)
        && (target===undefined || t.followUpTarget===target) && !ec_control(t.followUpTarget,env.faction)
        && t.attackWitness.groundIds.concat(t.attackWitness.escortIds).every(id=>env.units.some(x=>x.id===id && x.location===t.hex)))
    return prepared || ec_offensive_refined() && env.faction===1 && env.powGap===0 && turn>=9 && turn<12
        && env.victory.jpResources>1 && env.victory.jpResources<=3
        && a?.noStrategicBombingFailure && a?.b29InRangeOfTokyo && !env.victory.blockade?.startedTurn
        && ec_route_allows_atomic(env.view,env.board) && env.byHex.get(u.location)?.resource
        && (target===undefined || env.victory.resourceTargets.includes(target))
}

function ec_offensive_assembly_tasks(env) {
    const tasks=[],atomic=env.victory.atomic,turn=Number(env.view.turn)
    if (!ec_offensive_refined() || turn<5 || turn>=12 || env.powGap || (env.view.ai?.ownCards || []).length<2) return tasks
    const targets=[...new Set(ec_strategic_preparation_targets(env))]
    if (!targets.length) return tasks
    const hand=(env.view.ai?.ownCards || []).filter(c=>c.id!==env.cardId && !/soviet/i.test(c.name || ""))
    const ops=hand.filter(c=>c.allowed?.includes("ops")).sort((a,b)=>Number(b.ops)-Number(a.ops)||a.id-b.id)
        .filter((c,i,cs)=>cs.findIndex(x=>x.ops===c.ops)===i).slice(0,1).map(c=>({...c,mode:"ops"}))
    const events=hand.filter(c=>c.previewEvent && c.allowed?.includes("event"))
        .sort((a,b)=>Number(b.logistic||0)-Number(a.logistic||0)||a.id-b.id).slice(0,1).map(c=>({...c,mode:"event"}))
    const nextCards=events.concat(ops)
    const ports=env.board.filter(m=>m.port && ec_control(m.hex,env.faction)
        && targets.some(h=>ec_dist(m.hex,h)<=8)
        && env.units.some(n=>n.faction===env.faction && n.class==="naval" && n.location===m.hex && Number(n.br)>0))
        .sort((a,b)=>Math.min(...targets.map(h=>ec_dist(a.hex,h)))-Math.min(...targets.map(h=>ec_dist(b.hex,h)))||a.hex-b.hex).slice(0,3)
    const hqs=env.units.filter(h=>h.faction===env.faction && h.class==="hq" && !env.view.oos?.includes(h.id))
    for (const port of ports) {
        const occupants=env.units.filter(u=>u.faction===env.faction && u.location===port.hex && ["ground","air"].includes(u.class))
        const heldCapture=ec_offensive_refined()?(env.view.capture || []).filter(h=>ec_control(h,env.faction)):[]
        const local=occupants.filter(g=>g.class==="ground" && (g.asp||g.aspCost)
            && !(ec_offensive_refined() && env.garrisonReserve.has(g.id) && heldCapture.includes(g.location) && heldCapture.length<=Number(env.view.pow || 0))),slots=3-occupants.length
        if (slots<1) continue
        const arrivals=env.available.filter(g=>g.class==="ground" && (g.asp||g.aspCost) && g.stratMove && g.location!==port.hex
            && !env.garrisonReserve.has(g.id) && ec_service_compatible(local.concat(g),env.view,env.faction)
            && ec_query_moves([g.id],STRAT_MOVE,env).reachableHexes?.includes(port.hex))
            .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,5)
        const groups=arrivals.map(g=>[g]);if(slots>=2)for(let i=0;i<arrivals.length;i++)for(let j=i+1;j<arrivals.length;j++)groups.push([arrivals[i],arrivals[j]])
        for (const incoming of groups.sort((a,b)=>b.length-a.length)) {
            const ground=local.concat(incoming).map(g=>({...g,location:port.hex}))
            if (incoming.length>env.budget || ground.length>3 || !ec_service_compatible(ground,env.view,env.faction)) continue
            for (const target of targets.filter(h=>ec_dist(port.hex,h)<=8))for(const card of nextCards)for(const hq of hqs) {
                const fleet=env.units.filter(n=>n.faction===env.faction && n.class==="naval" && n.location===port.hex
                    && ec_service_compatible(ground.concat(n),env.view,env.faction)).sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id)
                const carrier=fleet.find(n=>Number(n.br)>0),orders=[fleet];if(carrier && carrier!==fleet[0])orders.push([carrier,...fleet.filter(n=>n!==carrier)])
                for (const order of orders)for(let count=1;count<=Math.min(3,order.length,9-ground.length);count++) {
                    if (env.offensiveAssemblyQueries.count>=48) {env.offensiveAssemblyQueries.exhausted=true;return tasks}
                    const escorts=order.slice(0,count),force=ground.concat(escorts);env.offensiveAssemblyQueries.count++;if(!env.offensiveAssemblyQueries.targets.includes(target))env.offensiveAssemblyQueries.targets.push(target)
                    const projection=typeof queryAmphibiousPreparation==="function" ? queryAmphibiousPreparation(force.map(u=>u.id),port.hex,target,
                        {faction:env.faction,cardId:card.id,hqId:hq.id,cardMode:card.mode}) : null
                    if (!projection?.eligible || !projection.reachable || projection.aspCost>ec_asp_remaining(env.view,env.faction)
                        || force.length>projection.activationBudget) continue
                    const support=(projection.supportIds || []).map(id=>env.units.find(u=>u.id===id)).filter(Boolean)
                        .filter(u=>ec_service_compatible(force.concat(u),env.view,env.faction))
                        .sort((a,b)=>Number(projection.effectiveSupportCF?.[b.id]||0)-Number(projection.effectiveSupportCF?.[a.id]||0)||a.id-b.id)
                        .slice(0,projection.activationBudget-force.length)
                    const next={...env,hq,cardId:card.id,cardMode:card.mode,budget:projection.activationBudget,reactions:new Map()}
                    const assessment=ec_assess(force,support,target,true,next)
                    if (!assessment.executable) continue
                    tasks.push(ec_make_task("REDEPLOY",port.hex,incoming,[],"STRATEGIC",env,
                        {score:175+assessment.pCapture*100+ec_national_bonus(target,env.national)*.15-incoming.length*5,objective:"OFFENSIVE_ASSEMBLE",preparationOnly:true,
                        victoryObjective:env.victory.homelandKeys.includes(target)?"HOMELAND":ec_national_bonus(target,env.national)?"NATIONAL_LIBERATION":"PACIFIC_BREAKTHROUGH",followUpTarget:target,
                        movementGroups:incoming.map(g=>({originHex:g.location,mode:"STRATEGIC",unitIds:[g.id]})),
                        attackWitness:{cardId:card.id,cardMode:card.mode,hqId:hq.id,groundIds:ground.map(g=>g.id),escortIds:escorts.map(n=>n.id),
                            supportIds:support.map(u=>u.id),requiredActivations:force.length+support.length,aspCost:projection.aspCost,
                            pCaptureEstimate:assessment.pCapture,evidence:"current-own-card legal projected AA; actual attack must revalidate"}}))
                }
            }
        }
    }
    return tasks
}

function ec_homeland_preparation(env) {
    if (env.faction!==1 || env.powGap || !ec_homeland_preparation_enabled(env.view,env.board)) return null
    const keys=env.victory.homelandKeys.filter(h=>!ec_control(h,env.faction))
    const ports=env.board.filter(m=>m.port && !ec_cbi(m.region) && ec_control(m.hex,env.faction)
        && keys.some(h=>ec_dist(m.hex,h)<=8)
        && env.units.some(n=>n.faction===env.faction && n.class==="naval" && n.location===m.hex))
        .sort((a,b)=>Number(b.hex===env.view.ai?.plan?.campaign?.homelandPreparation?.rallyPort)
            -Number(a.hex===env.view.ai?.plan?.campaign?.homelandPreparation?.rallyPort) || a.hex-b.hex).slice(0,4)
    const ground=env.available.filter(g=>g.class==="ground" && (g.asp || g.aspCost) && g.stratMove
        && !env.garrisonReserve.has(g.id) && !ec_cbi(env.byHex.get(g.location)?.region))
        .sort((a,b)=>ec_cf(b)-ec_cf(a)||a.id-b.id).slice(0,10)
    let best=null
    for (const port of ports) for (const g of ground) {
        const occupants=env.units.filter(u=>u.faction===env.faction && u.location===port.hex && ["ground","air"].includes(u.class))
        if (g.location!==port.hex && (occupants.length>=3
            || !ec_query_moves([g.id],typeof STRAT_MOVE==="undefined"?1:STRAT_MOVE,env).reachableHexes?.includes(port.hex))) continue
        for (const target of keys.filter(h=>ec_dist(port.hex,h)<=8).sort((a,b)=>ec_dist(port.hex,a)-ec_dist(port.hex,b)||a-b)) {
            const screen=ec_assembly_command(g,port.hex,target,env,ec_dist(port.hex,target)>5)
            if (!screen) continue
            const hq=env.units.find(u=>u.id===screen.hqId)
            const preview=env.assemblyPreviews.get([screen.cardId,screen.hqId].join(":"))
            const local=occupants.filter(u=>u.class==="ground" && preview?.units?.includes(u.id)
                && (Number(u.supply)&Number(hq?.supply)) && ec_service_compatible([u,g],env.view,env.faction))
            const score=Math.min(2,local.length)*25+local.reduce((sum,u)=>sum+ec_cf(u),0)*.5
                +screen.navalReadinessEstimate*30-ec_dist(port.hex,target)*2-(g.location===port.hex?0:8)
            if (!best || score>best.score) best={preparationOnly:true,targetHex:target,rallyPort:port.hex,
                groundIds:[...new Set(local.map(u=>u.id).concat(g.id))],hqId:screen.hqId,witnessCardId:screen.cardId,
                fleetIds:screen.rallyFleetIds,readiness:screen.assaultReadyEstimate?"estimated; recheck actual AA":"needs additional force",
                command:screen,score}
        }
    }
    return best
}

function ec_source_assault_ready(ground,target,env) {
    const screen=ec_assembly_command(ground,ground.location,target,env,true)
    if (!screen?.assaultReadyEstimate) return false
    const hq=env.units.find(u=>u.id===screen.hqId)
    const next={...env,hq,cardId:screen.cardId,cardMode:"ops",budget:screen.activationBudget,moves:new Map()}
    const route=ec_query_moves([ground.id,...screen.rallyFleetIds],typeof AMPH_MOVE==="undefined"?8:AMPH_MOVE,next)
    return route.reachableHexes?.includes(target) && Number(route.aspCost || 0)<=ec_asp_remaining(env.view,env.faction)
}

function ec_transport(env) {
    const tasks = []
    const groundAssemblyPorts = new Set(ec_ground_assembly_ports(env.view,env.faction,
        env.board.filter(m=>(m.port || m.airfield) && ec_control(m.hex,env.faction)),
        env.units.filter(u=>u.faction===env.faction)))
    const enemyTargets = env.board.filter(m => ec_control(m.hex, 1 - env.faction))
        .sort((a, b) => ec_score_target(b, env) - ec_score_target(a, env) || a.hex - b.hex)
    if (!enemyTargets.length) return tasks
    const ownGround = env.units.filter(u => u.faction === env.faction && u.class === "ground")
    const transportCandidates = env.available.filter(u => u.class === "ground" && u.stratMove && !env.garrisonReserve.has(u.id))
    const transports = env.homelandApproach ? transportCandidates.sort((a,b) => ec_dist(a.location, env.campaignObjective ?? a.location)
        - ec_dist(b.location, env.campaignObjective ?? b.location) || ec_cf(b)-ec_cf(a) || a.id-b.id).slice(0, 18)
        : transportCandidates.slice(0, 12)
    for (const u of transports) {
        const cbi = h => ec_cbi(env.byHex.get(h)?.region)
        const campaignGoal = !cbi(u.location) && env.byHex.get(env.campaignObjective)
        const normalGoal = campaignGoal || enemyTargets.filter(m => cbi(m.hex) === cbi(u.location))
            .sort((a, b) => (ec_dist(u.location, a.hex) * 5 - ec_score_target(a, env) * 0.15)
                - (ec_dist(u.location, b.hex) * 5 - ec_score_target(b, env) * 0.15) || a.hex - b.hex)[0]
        const homeGoal=!cbi(u.location) && env.byHex.get(env.homelandPreparation?.targetHex)
        const goals=[normalGoal,homeGoal].filter((g,i,gs)=>g && gs.findIndex(x=>x?.hex===g.hex)===i)
        const reach = ec_query_moves([u.id], typeof STRAT_MOVE === "undefined" ? 1 : STRAT_MOVE, env)
        for (const goal of goals) {
        for (const hex of reach.reachableHexes || []) {
            const md = env.byHex.get(hex)
            if (!md?.port || !ec_control(hex, env.faction) || hex === u.location || cbi(hex) !== cbi(goal.hex)) continue
            const localEnemy = goal
            if (!localEnemy) continue
            const before = ec_dist(u.location, localEnemy.hex), after = ec_dist(hex, localEnemy.hex)
            const escorts = env.units.filter(n => n.faction === env.faction && n.class === "naval" && n.location === hex)
            const fleet = escorts.length > 0
            const compatibleFleet = escorts.some(n => ec_service_compatible([u, n], env.view, env.faction))
            const held = (env.view.capture || []).includes(hex) || !!md.resource
            const groundCount = ownGround.filter(g => g.location === hex).length
            const preparationGoal=goal.hex===env.homelandPreparation?.targetHex
            const sourceReady = preparationGoal ? ec_source_assault_ready(u,goal.hex,env)
                : env.byHex.get(u.location)?.port && ec_control(u.location, env.faction)
                && env.units.some(n => n.faction === env.faction && n.class === "naval" && n.location === u.location
                    && ec_service_compatible([u,n], env.view, env.faction))
                && before <= 8
            const rallyPort=preparationGoal?env.homelandPreparation.rallyPort:env.homelandRallyPort
            const assemblyCandidate = !sourceReady && (env.homelandApproach || preparationGoal) && hex === rallyPort
                && env.victory.homelandKeys.includes(localEnemy.hex)
                && compatibleFleet && groundCount < 2 && ec_dist(hex, localEnemy.hex) <= 8
            const outerRally = env.victory.homelandKeys.every(key => ec_dist(hex,key)>5)
            const assemblyCommand = assemblyCandidate ? ec_assembly_command(u,hex,localEnemy.hex,env,outerRally) : null
            const homelandAssembly = assemblyCandidate && !!assemblyCommand
            // Keep gains occupied, or assemble at a port that gets this unit
            // closer to a real target. A mainland landing also needs a port
            // shared by ground and escort, even when it is no closer by hexes.
            if (!(before >= after + 2 && after <= 8) && !(held && groundCount === 0 && after <= 6)
                && !homelandAssembly) continue
            const score = (held && groundCount === 0 ? 48 : 0)
                + ((env.homelandApproach ? compatibleFleet : fleet) ? 30 : 0)
                + Math.min(12, before - after) * 3 - after * 2 - groundCount * 12
                + (homelandAssembly ? 120 + Math.min(30, ec_cf(u)) : 0)
            tasks.push(ec_make_task("REDEPLOY", hex, [u], [], "STRATEGIC", env,
                { score, objective: held && groundCount === 0 ? "GARRISON"
                    : homelandAssembly ? "HOMELAND_ASSEMBLE" : "ASSEMBLE", followUpTarget: localEnemy.hex,
                    ...(homelandAssembly ? {preparationOnly:true,victoryObjective:"HOMELAND"} : {}),
                    ...(assemblyCommand ? {assemblyCommand} : {}) }))
        }
        }
    }
    // Rendezvous whole legal groups, including a carrier alternative when raw
    // CF order puts battleships first. One existing ship is not a complete fleet.
    const naval = env.available.filter(u => u.class === "naval")
    for (const origin of [...new Set(naval.map(u => u.location))]) {
        const local = naval.filter(u => u.location === origin).sort((a, b) => ec_cf(b) - ec_cf(a) || a.id - b.id)
        const carrier = local.find(u => Number(u.br) > 0)
        const orders = [local]
        if (carrier && local[0] !== carrier) orders.push([carrier, ...local.filter(u => u.id !== carrier.id)])
        const seen = new Set()
        for (const order of orders) for (let count = 1; count <= Math.min(3, order.length, env.budget); count++) {
            const group = order.slice(0, count), key = group.map(u => u.id).sort((a,b)=>a-b).join(",")
            if (seen.has(key)) continue
            seen.add(key)
            const destinations = ec_query_moves(group.map(u => u.id), typeof STRAT_MOVE === "undefined" ? 1 : STRAT_MOVE, env)
            for (const hex of destinations.reachableHexes || []) {
            const at = ownGround.filter(g => g.location === hex && (g.asp || g.aspCost))
            const destination = env.byHex.get(hex)
            if (!at.length || !ec_control(hex, env.faction) || origin === hex || !destination?.port) continue
            if (!ec_cbi(env.byHex.get(origin)?.region) && ec_cbi(destination.region)) continue
            const present = env.units.filter(u => u.faction === env.faction && u.class === "naval" && u.location === hex)
            const presentCf = present.reduce((s,u)=>s+ec_cf(u),0)
            const sourceHomeDistance = Math.min(...env.victory.homelandKeys.map(key => ec_dist(origin,key)))
            const destinationHomeDistance = Math.min(...env.victory.homelandKeys.map(key => ec_dist(hex,key)))
            if (env.homelandApproach && env.byHex.get(origin)?.port && sourceHomeDistance <= 5
                && destinationHomeDistance > sourceHomeDistance) continue
            if (present.length + group.length > 6 || !ec_service_compatible(at.concat(group), env.view, env.faction)) continue
            const candidateTargets = enemyTargets.filter(m => ec_cbi(m.region) === ec_cbi(destination.region))
            const campaignTarget = env.byHex.get(env.campaignObjective)
            const preparationTarget=hex===env.homelandPreparation?.rallyPort ? env.byHex.get(env.homelandPreparation.targetHex) : null
            const normalTarget = campaignTarget && ec_dist(hex, campaignTarget.hex) <= 8 ? campaignTarget
                : candidateTargets.sort((a, b) => ec_dist(hex, a.hex) - ec_dist(hex, b.hex) || a.hex - b.hex)[0]
            const targets=[normalTarget,preparationTarget].filter((t,i,ts)=>t && ts.findIndex(x=>x?.hex===t.hex)===i)
            for (const target of targets) {
            const preparationGoal=target.hex===preparationTarget?.hex
            const distance = ec_dist(hex, target.hex)
            if (distance > 8) continue
            const rallyPort=preparationGoal?env.homelandPreparation.rallyPort:env.homelandRallyPort
            if ((env.homelandApproach || preparationGoal) && rallyPort
                && env.victory.homelandKeys.includes(target.hex)
                && (origin === rallyPort || hex !== rallyPort
                    && ec_dist(hex, rallyPort) >= ec_dist(origin, rallyPort))) continue
            const homelandEscort = (env.homelandApproach || preparationGoal) && env.victory.homelandKeys.includes(target.hex)
                && hex === rallyPort
            const reactionCf = homelandEscort ? ec_reaction(target.hex, env).units.reduce((s,u)=>s+ec_cf(u),0) : 0
            const neededCf = homelandEscort ? Math.min(95, Math.max(60, Math.ceil(reactionCf * .9))) : 30
            if (present.length >= 2 && present.some(u => Number(u.br) > 0) && presentCf >= neededCf) continue
            if ((env.redeployments || []).some(x => group.some(u => u.id === x.unit)
                && x.from === hex && x.to === origin)) continue
            const sourceGround = ownGround.filter(g => g.location === origin && (g.asp || g.aspCost))
            const sourceReady = sourceGround.some(g => ec_service_compatible([g].concat(local), env.view, env.faction)
                && (!preparationGoal || ec_source_assault_ready(g,target.hex,env)))
                && local.length >= 2 && local.some(u => Number(u.br) > 0) && local.reduce((s,u)=>s+ec_cf(u),0) >= neededCf
            const remaining = local.filter(u => !group.some(n => n.id === u.id))
            const remainingReady = remaining.length >= 2 && remaining.some(u => Number(u.br) > 0)
                && remaining.reduce((s,u)=>s+ec_cf(u),0) >= neededCf
            // Keep a complete landing force together unless the new port makes
            // material progress toward its same explicit target.
            if (sourceReady && !remainingReady && ec_dist(origin, target.hex) < distance + 2) continue
            const combined = present.concat(group), cf = combined.reduce((s,u)=>s+ec_cf(u),0)
            const gainsCover = !present.some(u=>Number(u.br)>0) && group.some(u=>Number(u.br)>0)
            const readiness = Math.min(neededCf, cf) - Math.min(neededCf, presentCf) + (gainsCover ? 18 : 0)
            tasks.push(ec_make_task("REDEPLOY", hex, group, [], "STRATEGIC", env,
                { score: 28 + readiness - distance * 2 - group.length * 2
                    + (target.hex === env.campaignObjective ? 10 : 0) + (homelandEscort ? 75 : 0),
                    objective: "ASSEMBLE_ESCORT", followUpTarget: target.hex,
                    ...(homelandEscort ? {preparationOnly:true,victoryObjective:"HOMELAND"} : {}) }))
            }
            }
        }
    }
    for (const air of env.available.filter(u => u.class === "air")) {
        const tokyo = typeof TOKYO === "undefined" ? null : TOKYO
        if (air.b29 && (tokyo === null || ec_dist(air.location, tokyo) <= 8)) continue
        const campaignGoal = !ec_cbi(env.byHex.get(air.location)?.region) ? env.campaignObjective : null
        const goal = air.b29 ? tokyo : campaignGoal ?? enemyTargets.slice().sort((a, b) => ec_dist(air.location, a.hex)
            - ec_dist(air.location, b.hex) || a.hex - b.hex)[0]?.hex
        if (!Number.isInteger(goal)) continue
        const reach = ec_query_moves([air.id], typeof STRAT_MOVE === "undefined" ? 1 : STRAT_MOVE, env)
        for (const hex of reach.reachableHexes || []) {
            if (!env.byHex.get(hex)?.airfield || !ec_control(hex, env.faction)) continue
            if (!ec_cbi(env.byHex.get(air.location)?.region) && ec_cbi(env.byHex.get(hex)?.region)) continue
            const inChinaBox = air.b29 && typeof CHINA_BOX !== "undefined" && air.location === CHINA_BOX
            const before = inChinaBox ? Infinity : ec_dist(air.location, goal), after = ec_dist(hex, goal)
            if (inChinaBox && after > 8) continue // Moving loses that turn's bombing; only leave for a final legal base.
            if (after >= before || (!air.b29 && after > Math.max(Number(air.br) || 0, Number(air.ebr) || 0))) continue
            const occupants=env.units.filter(u=>u.faction===env.faction && u.location===hex
                && (u.class==="air" || u.class==="ground") && u.id!==air.id)
            if (occupants.length>=3) continue
            if (groundAssemblyPorts.has(hex) && 3-occupants.length-1
                <Math.max(0,2-occupants.filter(u=>u.class==="ground").length)) continue
            const score = air.b29 ? (after <= 8 ? 185 : 72) - after : 34 + Math.min(12, before - after) - after
            tasks.push(ec_make_task("REDEPLOY", hex, [air], [], "STRATEGIC", env,
                { score, objective: air.b29 ? "B29_DEPLOYMENT" : "AIR_SUPPORT_BASE", followUpTarget: goal }))
        }
    }
    const b29=tasks.filter(t=>t.objective==="B29_DEPLOYMENT").reduce((m,t)=>Math.max(m,t.score),-Infinity)
    if (Number.isFinite(b29)) for (const t of tasks) if (t.preparationOnly || t.objective==="HOMELAND_ASSEMBLE"
        || t.objective==="ASSEMBLE_ESCORT" && env.victory.homelandKeys.includes(t.followUpTarget)) t.score=Math.min(t.score,b29-1)
    return tasks.sort((a, b) => b.score - a.score || a.hex - b.hex || a.id.localeCompare(b.id))
        .filter((t,i,all)=>all.findIndex(other=>other.id===t.id && other.followUpTarget===t.followUpTarget)===i)
}

function ec_hq_relocation(view, board, units, faction, powGap, ownCards, victory) {
    const turn = Number(view.turn || 0)
    if (!ec_homeland_drive(view) || turn < 7 || turn > 9 || powGap > 0 || ownCards.length < 2) return null
    const prior = view.ai?.plan?.campaign?.hqRelocation
    if (prior && turn <= Number(prior.turn) + 1) return null
    const forward = board.filter(m => m.port && m.region === "JMandates"
        && victory.homelandKeys.some(key => ec_dist(m.hex, key) <= 5))
        .sort((a,b) => Math.min(...victory.homelandKeys.map(key => ec_dist(a.hex,key)))
            - Math.min(...victory.homelandKeys.map(key => ec_dist(b.hex,key))) || a.hex-b.hex)[0]
    if (!forward || units.some(u => u.faction === faction && u.class === "hq" && !view.oos?.includes(u.id)
        && ec_dist(u.location, forward.hex) <= Number(u.cr || 0))) return null
    const staging = board.filter(m => m.port && !ec_cbi(m.region) && ec_control(m.hex, faction)
        && ec_dist(m.hex, forward.hex) <= 14
        && units.some(u => u.faction === faction && u.class === "ground" && u.location === m.hex)
        && units.some(u => u.faction === faction && u.class === "naval" && u.location === m.hex))
        .sort((a,b) => ec_dist(a.hex, forward.hex)-ec_dist(b.hex, forward.hex) || a.hex-b.hex)[0]
    if (!staging) return null
    const hq = units.filter(u => u.faction === faction && u.class === "hq" && Number(u.cr) > 0)
        .sort((a,b) => Number(b.cr)-Number(a.cr) || a.id-b.id)[0]
    const card = ownCards.filter(c => (view.actions?.card || []).includes(c.id)
        && c.allowed?.includes("displace_hq") && !/soviet/i.test(c.name || ""))
        .sort((a,b) => Number(!!a.previewEvent)-Number(!!b.previewEvent)
            || Number(a.ops || 0)-Number(b.ops || 0) || a.id-b.id)[0]
    if (!hq || !card) return null
    return { turn, hqId: hq.id, cardId: card.id, stagingHex: staging.hex, forwardHex: forward.hex,
        reason: "forward landing port lies outside every on-map HQ command radius; redeploy next reinforcement phase" }
}

function ec_plan(view, context) {
    context = context || {}
    const role = context.role || view.active || "Allies", faction = role === "Japan" ? 0 : 1
    if (role === "Japan") return ej_plan(view, context)
    const units = (view.ai?.units || []).map(u => ({ ...u }))
    const board = ec_map(), byHex = new Map(board.map(m => [m.hex, m]))
    const capture = (view.capture || []).filter(h => ec_control(h, faction))
    const powGap = Math.max(0, Number(view.pow || 0) - capture.length)
    const victory = ec_victory(view, board, faction)
    const national=ec_national_goals(view,faction), airProjections=new Map(),resourceAssemblyQueries={count:0},offensiveAssemblyQueries={count:0,targets:[],exhausted:false}
    victory.national=national
    const campaignObjective = ec_campaign_objective(view, board, units, faction)
    const homelandApproach = ec_homeland_approach(view, board, units, faction)
    const homelandRallyPort = ec_homeland_rally(view, board, units, faction, homelandApproach)
    const homelandFoothold = victory.homelandKeys.some(key => ec_control(key, faction))
    const garrisonReserve = ec_garrison_reserve(view, board, units, faction)
    const preCard = ec_card_window(view), choosingHq = /choose hq/i.test(String(view.prompt || ""))
    const activeIds = (view.offensive?.active_units?.[faction] || []).flat()
    const hqIds = choosingHq && Array.isArray(view.actions?.unit) ? view.actions.unit : null
    const hqs = units.filter(u => u.faction === faction && u.class === "hq" && !view.oos?.includes(u.id)
        && (!hqIds || hqIds.includes(u.id)))
    const currentHq = view.offensive?.active_hq?.[faction]
    let eligibleHqs = !preCard && !choosingHq && currentHq ? hqs.filter(h => h.id === currentHq) : hqs
    if (!eligibleHqs.length) eligibleHqs = hqs
    const ownCards = view.ai?.ownCards || []
    const remainingCards = ownCards.length
    const remainingOffensives = remainingCards + (!preCard && ec_offensive_key(view, role) > 0 ? 1 : 0)
    const powPressure = powGap / Math.max(1, remainingOffensives)
    const redeployments = ec_redeploy_history(view, view.ai?.plan, faction)
    const ocChoices = ownCards.filter(c => (view.actions?.card || []).includes(c.id)
        && (!Array.isArray(c.allowed) || c.allowed.includes("ops")) && !/soviet/i.test(c.name || ""))
        .sort((a, b) => Number(b.ops) - Number(a.ops) || a.id - b.id).slice(0, 2).map(c => ({ ...c, mode: "ops" }))
    const ecChoices = ownCards.filter(c => (view.actions?.card || []).includes(c.id)
        && c.previewEvent && c.allowed?.includes("event"))
        .sort((a,b) => Math.max(Number(b.logistic)||0, Number(b.logistic_alt?.[1])||0)
            - Math.max(Number(a.logistic)||0, Number(a.logistic_alt?.[1])||0) || a.id-b.id)
        .slice(0,2).map(c=>({ ...c, mode: "event" }))
    const currentCard = ec_offensive_key(view, role)
    const cardChoices = preCard ? ocChoices.concat(ecChoices)
        : [{ ...(view.ai?.plan?.cardId === currentCard ? view.ai.plan.cardSpec : {}), id: currentCard,
            mode: typeof EC !== "undefined" && view.offensive?.type === EC ? "event" : "ops" }]
    const blockers = [], choices = [], attainable = new Map(), homeAssaults = new Map(),assemblyCommands=new Map(),assemblyPreviews=new Map(),assemblyArrivals=new Map(),assemblyFrames=new Map()
    const projectedStackFits=new Map(),koreanPreparationQueries={count:0}
    const axisTargets = new Set((context.strategicTargets || []).map(t => typeof t === "number" ? t : t.hex))
    for (const card of cardChoices) for (const hq of eligibleHqs) {
        if (card.mode === "event" && card.hq?.length && !card.hq.includes(hq.id)) continue
        const preview = typeof queryCardPreview === "function" ? queryCardPreview(card.id,
            { faction, hqId: hq.id, cardMode: card.mode }) : null
        if (preview && !preview.eligible) {
            if (blockers.length < 16) blockers.push({ cardId: card.id, hq: hq.id, reason: preview.reason })
            continue
        }
        const available = Array.isArray(preview?.units)
            ? units.filter(u=>u.faction===faction && u.class!=="hq" && preview.units.includes(u.id))
            : ec_available(view, hq, faction, preCard, card.id, card.mode)
        const promptBudget = String(view.prompt || "").match(/\d+\s+of\s+(\d+)/i)
        const logistics = card.mode === "event" && card.logistic_alt?.[0]?.includes(hq.id) ? card.logistic_alt[1]
            : preCard ? card.mode === "event" ? card.logistic : card.ops : view.offensive?.logistic
        const budget = promptBudget ? Number(promptBudget[1]) : preview?.activationBudget ?? Math.max(1, Number(logistics || 0) + Number(hq.cm || 0))
        const env = { view, faction, units, board, byHex, available, hq, budget, cardId: card.id,
            cardMode: preCard ? card.mode : undefined, powGap, powPressure, victory, national, airProjections, resourceAssemblyQueries, offensiveAssemblyQueries, axisTargets, redeployments,
            previousObjective: view.ai?.plan?.objective?.hex, campaignObjective, homelandApproach, homelandRallyPort, homelandFoothold,
            moves: new Map(), reactions: new Map(), projectedStackFits, koreanPreparationQueries, blockers, garrisonReserve, homeAssaults,assemblyCommands,assemblyPreviews,assemblyArrivals,assemblyFrames }
        env.homelandPreparation=ec_homeland_preparation(env)
        const attack = ec_missions(env)
        if (ec_route_refined(view) && ec_route_allows_atomic(view,board) && Number(view.turn)>=5) {
            const resources=new Set(victory.resourceTargets.filter(h=>byHex.get(h)?.region!=="Manchuria"))
            const resourceEnv={...env,captureTargets:resources,convergenceObjective:"RESOURCES",
                objectiveForTarget:hex=>powGap && byHex.get(hex)?.named && !(view.capture || []).includes(hex) ? "POW" : "RESOURCES"}
            attack.push(...ec_ground_convergence(resourceEnv),...ec_amphibious_convergence(resourceEnv))
        }
        if (ec_route_refined(view)) {
            env.centralAssaultAttempts=new Map()
            const central=new Set(ec_central_pacific_targets(env))
            if (central.size) {
                const centralEnv={...env,available:env.available.filter(u=>u.class!=="ground"
                        || env.centralEmbarkationGroundIds.includes(u.id)),captureTargets:central,convergenceObjective:"PACIFIC_BREAKTHROUGH",
                    objectiveForTarget:hex=>powGap && !(view.capture || []).includes(hex) ? "POW" : "PACIFIC_BREAKTHROUGH"}
                attack.push(...ec_amphibious_convergence(centralEnv))
            }
        }
        const homeTargets = new Set(victory.homelandKeys.filter(hex=>!ec_control(hex,faction)))
        if (homeTargets.size) {
            const homeEnv={...env,captureTargets:homeTargets,convergenceObjective:"HOMELAND",
                objectiveForTarget:hex=>powGap && byHex.get(hex)?.named && !(view.capture || []).includes(hex) ? "POW" : "HOMELAND",
                allowReservedGround:u=>victory.homelandKeys.includes(u.location)&&ec_control(u.location,faction)}
            attack.push(...ec_ground_convergence(homeEnv))
            attack.push(...ec_amphibious_convergence(homeEnv))
        }
        attack.push(...ec_ground_softening_tasks(env,attack))
        const transport = ec_transport(env).concat(ec_resource_assembly_tasks(env),ec_offensive_assembly_tasks(env),ec_korean_supply_preparation(env))
        attack.push(...ec_blockade_tasks(env))
        const aspBudget = ec_asp_remaining(view,faction)
        for (const task of attack) if (task.objective === "POW" && task.aspCost <= aspBudget) {
            const old = attainable.get(task.hex)
            if (!old || old.pCapture < task.assessment.pCapture) attainable.set(task.hex,
                { hex: task.hex, cardId: card.id, hq: hq.id, pCapture: task.assessment.pCapture,
                    requiredUnits: task.requiredUnits.slice(), aspCost: task.aspCost })
        }
        const lastFinalCard=ec_refined() && Number(view.turn)===12 && remainingOffensives<=1
        const ranked = attack.concat(transport).filter(t=>ec_preserves_home_force(t,env)).filter(t=>!lastFinalCard || !t.preparationOnly && !["ASSEMBLE","ASSEMBLE_ESCORT","HOMELAND_ASSEMBLE","AIR_SUPPORT_BASE"].includes(t.objective)).sort((a, b) => b.score - a.score || a.hex - b.hex || a.id.localeCompare(b.id))
        if (!ranked.length) { if (blockers.length < 16) blockers.push({ hq: hq.id, reason: available.some(u => u.class === "ground")
            ? "no-executable-capture-or-transport" : "no-legal-ground-under-hq" }); continue }
        const tasks = [], assigned = new Set(activeIds)
        let spent = 0, aspSpent = 0, battles = (view.offensive?.battle_hexes || []).length
        const multiBattle = card.mode === "event"
        for (const task of ranked) {
            if (tasks.some(t => t.hex === task.hex || (ec_route_refined(view) || ec_offensive_refined()) && ec_preparation_conflicts(t,task)) || task.requiredUnits.some(id => assigned.has(id))
                || spent + task.requiredUnits.length > budget || aspSpent + Number(task.aspCost || 0) > aspBudget
                || (!multiBattle && task.declaresBattle && battles > 0)) continue
            if (!ec_service_compatible(tasks.flatMap(t => t.requiredUnits).concat(task.requiredUnits)
                .map(id => units.find(u => u.id === id)).filter(Boolean), view, faction)) continue
            tasks.push(task); task.requiredUnits.forEach(id => assigned.add(id)); spent += task.requiredUnits.length
            aspSpent += Number(task.aspCost || 0); if (task.declaresBattle) battles++
            if (tasks.length >= (powPressure >= 1 && powGap >= 3 ? 3 : 2)) break
        }
        if (tasks.length) choices.push({ cardId: card.id, cardMode: card.mode, cardSpec: card, hq: hq.id, budget, tasks,homelandPreparation:env.homelandPreparation,
            score: tasks[0].score + tasks.slice(1).reduce((s,t)=>s+t.score*.35,0)
                + tasks.filter(t=>t.objective === "POW").length * Math.min(2, powPressure) * 30 })
    }
    choices.sort((a, b) => b.score - a.score || a.cardId - b.cardId || a.hq - b.hq)
    const best = choices[0], tasks = best ? best.tasks : []
    const selectedCaptures = tasks.filter(t => t.objective === "POW")
    const quotaFeasibility = !powGap ? "already-met" : selectedCaptures.length >= powGap ? "current-plan-can-close"
        : !remainingOffensives ? "no-remaining-card-opportunity" : attainable.size < powGap ? "insufficient-known-targets"
            : "multiple-offensives-or-conflicting-forces"
    const quotaReasons = {
        "already-met": "Current controlled capture ledger meets this turn's quota; gains must still be held",
        "current-plan-can-close": "Current legal assignments cover the gap if their estimated battles succeed and gains are retained",
        "no-remaining-card-opportunity": "No own card opportunity remains in the current public hand",
        "insufficient-known-targets": "Current legal card/HQ previews expose fewer fresh targets than the gap; transport, other own cards or changed positions are required",
        "multiple-offensives-or-conflicting-forces": "Known targets are alternatives and can share units, ASP or card slots; their union is not a guaranteed sequence",
    }
    victory.routes.homeland.immediatelyExecutableKeys = tasks.filter(t => t.kind === "CONQUEST" && victory.homelandKeys.includes(t.hex)).map(t => t.hex)
    victory.routes.homeland.bestKnownAssaults = [...homeAssaults.values()].sort((a,b)=>a.hex-b.hex)
    victory.routes.atomic.immediateResourceTargets = tasks.filter(t => t.kind === "CONQUEST" && victory.resourceTargets.includes(t.hex)).map(t => t.hex)
    victory.routes.headquarters.immediatelyExecutableTargets = tasks.filter(t => t.kind === "CONQUEST"
        && victory.routes.headquarters.targets.some(h => h.hex === t.hex)).map(t => t.hex)
    const targets = tasks.map(t => ({ hex: t.hex, kind: t.kind, requiresOccupation: t.kind === "CONQUEST",
        requiresFriendlyControl: t.kind === "REDEPLOY", requiredUnits: t.requiredUnits.slice(),
        movementUnitIds: t.movementUnitIds.slice(), supportUnitIds: t.supportUnitIds.slice(),
        movementModes: t.movementModes.slice(), ...(t.movementGroups ? {movementGroups:t.movementGroups} : {}), campaignTask: true, taskId: t.id,
        objective: t.objective, ...(t.softeningGoal ? {softeningGoal:t.softeningGoal} : {}), ...(t.targetClasses ? {targetClasses:t.targetClasses,rangedSupport:!!t.rangedSupport} : {}), ...(t.victoryObjective ? {victoryObjective:t.victoryObjective} : {}),
        ...(t.retentionRisks?.length ? {retentionRisks:t.retentionRisks} : {}), damageLevel: 1 }))
    const first = tasks[0]
    const plan = { version: 1, role, turn: Number(view.turn || 0), cardId: best?.cardId || ec_offensive_key(view, role),
        cardIntent: best?.cardMode || null, cardSpec: best?.cardSpec || null, preferredHq: best?.hq || null, activationBudget: best?.budget || 0,
        objective: first ? { type: first.objective, hex: first.followUpTarget ?? first.hex } : { type: "BLOCKED", hex: null },
        phase: first ? first.kind === "CONQUEST" ? "CAPTURE" : first.objective === "GARRISON" ? "GARRISON" : "ASSEMBLE" : "BLOCKED",
        focus: first?.hex ?? null, targets, tasks, blockers: blockers.slice(0, 16), garrisonReserveIds: [...garrisonReserve].sort((a,b)=>a-b),
        campaign: { theater: "PACIFIC", ...(ec_offensive_refined()?{preparationSearch:{limit:48,...offensiveAssemblyQueries}}:{}), ...(ec_route_refined(view)?{route:ec_route_allows_atomic(view,board)?"ATOMIC_OPEN":"HOME"}:{}), objectiveHex: campaignObjective, rallyPort: best?.homelandPreparation?.rallyPort ?? homelandRallyPort, redeployments,
            homelandPreparation:best?.homelandPreparation || null,
            hqRelocation: view.ai?.plan?.campaign?.hqRelocation || null,
            objectiveSinceTurn: view.ai?.plan?.campaign?.objectiveHex === campaignObjective
                ? view.ai.plan.campaign.objectiveSinceTurn ?? view.ai.plan.turn : Number(view.turn || 0) },
        pow: { required: Number(view.pow || 0), held: capture.length, gap: powGap, politicalWill: Number(view.political_will || 0),
            remainingCards, remainingOffensives, requiredCapturesPerCard: Number(powPressure.toFixed(2)),
            evaluatedCardIds: cardChoices.map(c=>c.id), unexaminedCardIds: ownCards.filter(c=>!cardChoices.some(x=>x.id===c.id)).map(c=>c.id),
            attainableCaptureTargets: [...attainable.values()].sort((a,b)=>a.hex-b.hex),
            selectedCaptureTargets: selectedCaptures.map(t=>t.hex), expectedSelectedCaptures: Number(selectedCaptures.reduce((s,t)=>s+t.assessment.pCapture,0).toFixed(2)),
            retentionRisks:selectedCaptures.flatMap(t=>t.retentionRisks || []),
            quotaFeasibility, reason: quotaReasons[quotaFeasibility], forecastScope: "current-public-position-and-evaluated-own-cards; no future-draw-or-sequence-guarantee" },
        victory, preCard, strategySource: "CAMPAIGN_PLANNER", rulesSource: "engine legality queries" }
    if(homelandRallyPort!==null) {
        const remaining=victory.homelandKeys.filter(h=>!ec_control(h,faction))
        const distance=remaining.length?Math.min(...remaining.map(h=>ec_dist(homelandRallyPort,h))):null
        plan.campaign.rallyReason=distance>5?"outer-existing-force":"inner-forward-port"
        plan.campaign.rallyDistance=distance
        plan.campaign.rallyReadiness="preparation-location; attack still requires card/HQ/ASP/path/combat checks"
    }
    if (preCard) {
        const relocation = ec_refined() && Number(view.turn)===12 && remainingOffensives<=1 ? null : ec_hq_relocation(view, board, units, faction, powGap, ownCards, victory)
        if (relocation) {
            plan.hqRelocation = relocation
            plan.campaign.hqRelocation = relocation
            plan.cardId = relocation.cardId
            plan.cardIntent = "displace_hq"
            plan.cardSpec = ownCards.find(c => c.id === relocation.cardId) || null
            plan.preferredHq = null
            plan.activationBudget = 0
            plan.tasks = []
            plan.targets = []
            plan.focus = relocation.stagingHex
            plan.phase = "HQ_REDEPLOY"
            plan.objective = { type: "HQ_REDEPLOY", hex: relocation.forwardHex }
        }
    }
    return plan
}

function ec_apply_plan(view, context) {
    const role = context.role || view.active
    if (!ec_enabled(role)) return null
    if (role === "Japan" && typeof SHORT_CAMPAIGN_SCENARIO !== "undefined" && view.sid !== SHORT_CAMPAIGN_SCENARIO
        && (typeof EVEN_SHORT_CAMPAIGN_SCENARIO === "undefined" || view.sid !== EVEN_SHORT_CAMPAIGN_SCENARIO)) return null
    const faction = role === "Japan" ? 0 : 1
    const prior = view.ai?.plan
    const cardWindow = ec_card_window(view), chooseHq = /choose hq/i.test(String(view.prompt || ""))
    const selectAction = /select action/i.test(String(view.prompt || ""))
    const ownOffensive = cardWindow || selectAction || chooseHq || /activate units|move units/i.test(String(view.prompt || ""))
        || ec_refined() && view.ai?.state === "declare_battle_hexes"
    // A hook-bearing EC is an entire original-Erasmus offensive, not merely a
    // delegated card choice. Its activation constraints cannot be represented by
    // the safe preview, so an empty campaign plan must not terminate its units.
    const eventWindow = ownOffensive || view.ai?.windowKind === "task-force" || view.ai?.windowKind === "pbm"
        || /battle|commit_offensive|disengagement/.test(String(view.ai?.state || ""))
    const delegatedReason = !cardWindow && !selectAction && eventWindow ? ec_delegation_reason(view, role) : null
    if (delegatedReason) {
        const kept = prior ? JSON.parse(JSON.stringify(prior)) : ec_plan(view, context)
        kept.turn = Number(view.turn)
        kept.cardId = ec_offensive_key(view, role)
        kept.cardIntent = "event"
        kept.cardSpec = null
        kept.activationBudget = 0
        kept.preCard = false
        kept.phase = "DELEGATED"
        kept.delegatedOffensive = { cardId: kept.cardId, reason: delegatedReason }
        kept.objective = { type: "ORIGINAL_ERASMUS_EVENT", hex: null }
        kept.focus = null
        kept.tasks = []
        kept.targets = []
        kept.preferredHq = null
        delete kept.positioning
        context.campaignPlan = kept
        return kept // Preserve the original chart's strategy chain and focus.
    }
    if (view.ai?.windowKind === "reaction" || view.ai?.windowKind === "pbm" || prior && !ownOffensive) {
        const kept = prior ? JSON.parse(JSON.stringify(prior)) : null
        if (kept?.delegatedOffensive && kept.turn !== Number(view.turn)) {
            delete kept.delegatedOffensive
            kept.phase = "POSITIONING"
            kept.objective = { type: "POSITIONING", hex: kept.campaign?.objectiveHex ?? null }
        }
        if (kept && !kept.delegatedOffensive) {
            kept.campaign = { ...kept.campaign, redeployments: ec_redeploy_history(view, kept, faction) }
            kept.positioning = ec_positioning_context(view, kept)
        }
        context.campaignPlan = kept
        return kept
    }
    const selectedCard = selectAction ? ec_selected_card(view) : null
    const sameSelection = selectAction && (selectedCard === null || prior?.cardId === selectedCard)
    const sameOffensive = prior && !prior.delegatedOffensive && prior.version === 1 && prior.role === role && prior.turn === Number(view.turn)
        && (prior.cardId === ec_offensive_key(view, role) || sameSelection)
    let plan = sameOffensive && !cardWindow && !chooseHq && !prior.preCard ? JSON.parse(JSON.stringify(prior)) : null
    if (sameSelection && prior && !prior.delegatedOffensive && prior.turn === Number(view.turn)) plan = JSON.parse(JSON.stringify(prior))
    const automaticHq=(ec_offensive_refined() || ej_opening_refined()) && view.ai?.state==="activate_units"
        && view.offensive?.active_hq?.[faction]===prior?.preferredHq
    if (sameOffensive && prior.tasks.length && (chooseHq && (view.actions?.unit || []).includes(prior.preferredHq) || automaticHq)) {
        const cardMode = view.offensive?.type === EC ? "event" : "ops"
        const preview = typeof queryCardPreview === "function" ? queryCardPreview(prior.cardId,
            {faction,hqId:prior.preferredHq,cardMode}) : null
        const assigned = prior.tasks.flatMap(t=>t.requiredUnits)
        const pathsValid = prior.tasks.every(task=>ec_task_complete(task,view,faction)
            || (task.movementGroups || [{unitIds:task.movementUnitIds,mode:task.movementModes[0]}]).every(group=>{
                if (typeof queryGroupMovementDestinations!=="function") return true
                const move_type = group.mode==="AA"?AMPH_MOVE:group.mode==="GROUND"?GROUND_MOVE:group.mode==="NAVAL"?NAVAL_MOVE:STRAT_MOVE
                return queryGroupMovementDestinations(group.unitIds,{faction,cardId:prior.cardId,cardMode,
                    hqId:prior.preferredHq,move_type}).reachableHexes?.includes(task.hex)
            }))
        if ((!preview || preview.eligible && assigned.length<=preview.activationBudget
                && assigned.every(id=>preview.units.includes(id)))
            && pathsValid && prior.tasks.reduce((n,t)=>n+Number(t.aspCost||0),0)
                <= ec_asp_remaining(view,faction)
            && ec_service_compatible(assigned.map(id=>(view.ai?.units||[]).find(u=>u.id===id)).filter(Boolean),view,faction)) {
            // Card choice commits its scarce opportunity and assigned force.
            // A later HQ window validates it rather than rescoring another
            // target under a different (already spent) hand context.
            plan = JSON.parse(JSON.stringify(prior))
            plan.preCard = false
            if (preview) plan.activationBudget = preview.activationBudget
        }
    }
    if (!plan) {
        const axis = typeof eop_axis === "function" ? eop_axis(role) : null
        plan = ec_plan(view, { ...context, strategicTargets: axis?.targetMeta || axis?.chain || [] })
    }
    // A blocked Japanese opening plan must not take activation away from an
    // original-chart offensive selected through the fallback card path.
    if (role === "Japan" && !plan.tasks.length) return null
    const publicIds = new Set((view.ai?.units || []).filter(u => u.faction === faction).map(u => u.id))
    const lost = plan.tasks.filter(t => !ec_task_complete(t, view, faction) && t.requiredUnits.some(id => !publicIds.has(id)))
    if (lost.length) {
        const invalid = new Set(lost.map(t => t.id))
        plan.blockers = plan.blockers.concat(lost.map(t => ({ taskId: t.id, reason: "assigned-unit-no-longer-on-map" }))).slice(-16)
        plan.tasks = plan.tasks.filter(t => !invalid.has(t.id))
        plan.targets = plan.targets.filter(t => !invalid.has(t.taskId))
        if (/activate units/i.test(String(view.prompt || "")) && !(view.offensive?.active_units?.[faction] || []).length) {
            const rebuilt = ec_plan(view, context)
            rebuilt.blockers = plan.blockers.concat(rebuilt.blockers).slice(-16)
            plan = rebuilt
        }
    }
    if (/activate units/i.test(String(view.prompt || "")) && !(view.offensive?.active_units?.[faction] || []).length) {
        const legal = new Set(view.actions?.unit || [])
        const unavailable = plan.tasks.flatMap(t => t.requiredUnits).filter(id => !legal.has(id))
        if (unavailable.length) {
            const rebuilt = ec_plan(view, context)
            rebuilt.blockers = [{ reason: "assignment-no-longer-activatable", unitIds: unavailable }]
                .concat(rebuilt.blockers).slice(0, 16)
            plan = rebuilt
        }
    }
    if (/move units/i.test(String(view.prompt || "")) && !(view.active_stack || []).length
        && typeof queryGroupMovementDestinations === "function") {
        const invalid = new Set()
        for (const task of plan.tasks) {
            if (ec_task_complete(task, view, faction)) continue
            for (const group of task.movementGroups || [{ unitIds: task.movementUnitIds, mode: task.movementModes[0] }]) {
                const mode = group.mode === "AA" ? AMPH_MOVE : group.mode === "GROUND" ? GROUND_MOVE : group.mode === "NAVAL" ? NAVAL_MOVE : STRAT_MOVE
                const moving = group.unitIds.filter(id => (view.actions?.unit || []).includes(id))
                const missing = group.unitIds.filter(id=>!moving.includes(id)
                    && !(view.ai?.units||[]).some(u=>u.id===id&&u.location===task.hex))
                if (missing.length && moving.length) {
                    invalid.add(task.id)
                    plan.blockers = plan.blockers.concat({taskId:task.id,reason:"planned-movement-group-incomplete",unitIds:missing}).slice(-16)
                    continue
                }
                if (!moving.length) continue // Already committed to a battle; await its result.
                try {
                    const r = queryGroupMovementDestinations(moving, { faction, move_type: mode,
                        cardId: plan.cardId, hqId: plan.preferredHq })
                    if (!r.reachableHexes?.includes(task.hex)) {
                        invalid.add(task.id)
                        plan.blockers = plan.blockers.concat({ taskId: task.id, reason: "planned-path-no-longer-legal" }).slice(-16)
                    }
                } catch (e) {
                    invalid.add(task.id)
                    plan.blockers = plan.blockers.concat({ taskId: task.id, reason: "planned-path-query-failed" }).slice(-16)
                }
            }
        }
        plan.tasks = plan.tasks.filter(t => !invalid.has(t.id))
        plan.targets = plan.targets.filter(t => !invalid.has(t.taskId))
    }
    // Preserve assignments through activation and movement. Completion changes
    // focus, never recreates the group around a different strategic target.
    const pending = plan.tasks.filter(t => !ec_task_complete(t, view, faction))
    plan.focus = pending[0]?.hex ?? null
    plan.campaign = { ...plan.campaign, redeployments: ec_redeploy_history(view, plan, faction) }
    plan.positioning = ec_positioning_context(view, plan)
    eop_set_strategy_chain(role, { name: "战役计划:" + plan.phase, kind: plan.targets[0]?.kind || "EVENT",
        note: "公开态势规划；合法路径由规则引擎验证", chain: plan.targets.map(t => t.hex),
        targetMeta: plan.targets, campaignPlan: plan })
    context.campaignPlan = plan
    return plan
}

function ec_pick_action(view, context, plan) {
    if (!plan || !ec_enabled(context.role)) return null
    if (view.ai?.windowKind === "reaction" || view.ai?.windowKind === "pbm") return null
    const actions = view.actions || {}, prompt = String(view.prompt || "")
    const legalUnit = Array.isArray(actions.unit) ? actions.unit : []
    if(context.role==="Japan" && view.ai?.state==="paratroopers" && actions.skip
        && typeof rules_query_optional_paratroopers==="function"
        && rules_query_optional_paratroopers(cards[ec_offensive_key(view,context.role)]))
        return {action:"skip",argument:undefined,via:"campaign-previewed-paratroopers-skip"}
    if (view.ai?.state === "strategic_bombing" && actions.all)
        return { action: "all", argument: undefined, via: "campaign-continuous-strategic-bombing" }
    if (plan.delegatedOffensive) return null
    // Actual engine candidates are the authority. Keep pure remote support on
    // its assigned campaign target instead of a generic easier battle hex.
    if (ec_refined() && ["choose_attack_hex","declare_battle_hexes"].includes(view.ai?.state)
        && Array.isArray(actions.action_hex)) {
        const selected=view.active_stack || []
        const target=plan.tasks.find(t=>t.declaresBattle && selected.some(id=>t.requiredUnits?.includes(id))
            && actions.action_hex.includes(t.hex) && !ec_task_complete(t,view,1))
        if (target) return {action:"action_hex",argument:target.hex,via:"campaign-assigned-legal-battle"}
    }
    if ((ec_offensive_refined() || ej_opening_refined()) && view.ai?.state==="move_offensive_units" && actions.stop) {
        const selected=view.active_stack || [], paths=view.offensive?.paths || []
        const arrived=selected.length>0 && selected.every(id=>{
            const unit=view.ai?.units?.find(u=>u.id===id && u.faction=== (context.role==="Japan"?0:1) && u.class==="ground")
            const i=paths.indexOf(id),path=i>=0?paths[i+1]:null
            return unit && Array.isArray(path) && (path[0]&GROUND_MOVE) && path.length>=4 && path[path.length-1]===unit.location
                && (plan.tasks.some(t=>t.kind==="REDEPLOY" && t.hex===unit.location && t.movementModes.includes("GROUND") && t.movementUnitIds.includes(id))
                    || (plan.campaign?.redeployments || []).some(x=>x.turn===Number(view.turn) && x.unit===id && x.from===path[2] && x.to===unit.location))
        })
        if (arrived) return {action:"stop",argument:undefined,via:"campaign-arrived-ground-redeployment-stop"}
    }
    if (view.ai?.state === "move_units" && actions.stop)
        return { action: "stop", argument: undefined, via: "campaign-ground-stop" }
    if (/move units/i.test(prompt) && plan.focus === null && actions.done)
        return { action: "done", argument: undefined, via: "campaign-no-pending-movement" }
    if (ec_card_window(view) && Array.isArray(actions.card)) {
        if (plan.hqRelocation && actions.card.includes(plan.hqRelocation.cardId))
            return { action: "card", argument: plan.hqRelocation.cardId, via: "campaign-forward-hq-relocation-card" }
        // Let the existing historical-event logic handle the Soviet card and
        // service-rivalry remedies; these are public own-hand choices.
        const important = (view.ai?.ownCards || []).some(c => /soviet|inter.?service|joint.*planning/i.test(c.name || "")
            && Array.isArray(c.allowed) && c.allowed.includes("event"))
        if (important) { plan.delegatedCard = true; return null }
        if (plan.tasks.length && actions.card.includes(plan.cardId)) return { action: "card", argument: plan.cardId, via: "campaign-card-hq-task-plan" }
        return null
    }
    const selectedCard = ec_selected_card(view)
    if (/select action/i.test(prompt) && plan.hqRelocation && actions.displace_hq
        && (selectedCard === null || selectedCard === plan.hqRelocation.cardId))
        return { action: "displace_hq", argument: undefined, via: "campaign-forward-hq-relocation" }
    if (/choose hq to displace/i.test(prompt) && plan.hqRelocation
        && legalUnit.includes(plan.hqRelocation.hqId))
        return { action: "unit", argument: plan.hqRelocation.hqId, via: "campaign-forward-hq-selection" }
    if (/select action/i.test(prompt) && !plan.delegatedCard && (selectedCard === null || selectedCard === plan.cardId)
        && plan.tasks.length && actions[plan.cardIntent || "ops"])
        return { action: plan.cardIntent || "ops", argument: undefined, via: "campaign-card-intent" }
    if (/choose hq/i.test(prompt) && legalUnit.includes(plan.preferredHq))
        return { action: "unit", argument: plan.preferredHq, via: "campaign-executable-hq" }
    if (/activate units/i.test(prompt) && view.ai?.windowKind !== "reaction") {
        const faction = context.role === "Japan" ? 0 : 1
        const selected = new Set((view.offensive?.active_units?.[faction] || []).flat())
        const progress = prompt.match(/(\d+)\s+of\s+(\d+)/i)
        if (/too many/i.test(prompt)) {
            const rollback = (view.unselect || []).slice().sort((a, b) => b - a).find(id => legalUnit.includes(id))
            return rollback === undefined ? null : { action: "unit", argument: rollback, via: "campaign-budget-rollback" }
        }
        if (!progress || Number(progress[1]) < Number(progress[2])) {
            for (const task of plan.tasks) for (const id of task.requiredUnits)
                if (!selected.has(id) && legalUnit.includes(id)) return { action: "unit", argument: id, via: "campaign-assigned-unit" }
        }
        if (actions.done) return { action: "done", argument: undefined, via: "campaign-assignment-complete-or-blocked" }
    }
    return null
}

// Compact, public positioning facts are carried with advance/PBM action metadata.
// Refreshing them per decision makes replay independent of a live strategy cache.
function ec_ground_assembly_ports(view,faction,bases,own) {
    if (faction!==0 || typeof ej_nations!=="function") return []
    const board=ec_map(),byHex=new Map(board.map(m=>[m.hex,m])),pendingKeys=ej_nations(view).flatMap(n=>n.missingKeys)
    return bases.filter(base=>{
        const launchPort=base.port && own.filter(u=>u.class==="naval" && u.location===base.hex).length>=2
        const pending=pendingKeys.filter(h=>byHex.get(h)?.region===base.region && ec_dist(base.hex,h)<=6
            || launchPort && byHex.get(h)?.region==="Java" && ec_dist(base.hex,h)<=10)
        if (!pending.length) return false
        const at=own.filter(u=>u.class==="ground" && u.location===base.hex)
        const defense=Math.max(0,...pending.map(h=>typeof queryDefendingGround==="function"
            ? (queryDefendingGround(h,{faction:1})?.units || []).reduce((sum,u)=>sum+ec_cf(u),0)
            : (view.ai?.units || []).filter(u=>u.faction===1 && u.class==="ground" && u.location===h).reduce((sum,u)=>sum+ec_cf(u),0)))
        return at.length<2 && at.reduce((sum,u)=>sum+ec_cf(u),0)<defense*2
    }).map(base=>base.hex)
}

function ec_positioning_context(view, plan) {
    const faction = plan.role === "Japan" ? 0 : 1
    const own = (view.ai?.units || []).filter(u => u.faction === faction)
    const next = plan.tasks?.find(t => Number.isInteger(t.followUpTarget))?.followUpTarget
        ?? plan.objective?.hex ?? plan.focus ?? view.ai?.focus ?? null
    const bases = ec_map().filter(m => (m.port || m.airfield) && ec_control(m.hex, faction))
        .map(m => ({ hex: m.hex, port: !!m.port, airfield: !!m.airfield, region: m.region || "", resource: !!m.resource }))
    const groundAssemblyPorts=ec_ground_assembly_ports(view,faction,bases,own)
    const islandDefense=faction===0 && typeof ej_island_defense==="function" ? ej_island_defense(view,ec_map(),view.ai?.units || []) : []
    return { version: 1, role: plan.role, scenario: view.sid, turn:Number(view.turn), focus: next, groundAssemblyPorts,islandDefense,
        blockade:plan.victory?.blockade || view.ai?.victory?.blockade || null,
        pacificFocus: plan.campaign?.objectiveHex ?? ec_campaign_objective(view, ec_map(), view.ai?.units || [], faction),
        homelandKeys: faction === 1 ? (view.ai?.victory?.homelandKeys || []).slice() : [], interService: !!view.inter_service?.[faction],
        homelandApproach: faction === 1 && ec_homeland_approach(view, ec_map(), view.ai?.units || [], faction),
        homelandRallyPort: plan.campaign?.rallyPort ?? null,
        hqRelocation: plan.campaign?.hqRelocation || null,
        ...(ec_offensive_refined()?{supplyProtectedGroundIds:own.filter(u=>u.class==="ground" && [hex_to_int(3305),hex_to_int(3306)].includes(u.location)).map(u=>u.id)}:{}),
        bases, units: own.map(u => ({ id: u.id, class: u.class, location: u.location, service: u.service || null,
            asp: !!u.asp, b29: !!u.b29 })), captured: (view.capture || []).slice(),
        assemblyPorts: (plan.tasks || []).filter(t => /ASSEMBLE/.test(t.objective || "")).map(t => t.hex),
        garrisonReserveIds: (plan.garrisonReserveIds || []).slice() }
}

// Ephemeral per-selection projection budget; never saved or shared across games.
function ec_position_projection_scope(position,piece,source,candidates) {
    const koreaSupply=ec_offensive_refined() && position?.role==="Allies" && position.supplyProtectedGroundIds?.length
        && (piece?.class==="hq" || ["air","naval"].includes(piece?.class) && Number(piece.br)>0) && !piece.b29
    if (position?.role!=="Allies" || position.turn<5 || !koreaSupply && (piece?.class!=="air" || piece.b29)) return null
    const definitionIndex=typeof pieces!=="undefined" && Array.isArray(pieces) ? pieces.indexOf(piece) : -1
    const id=piece.id ?? (definitionIndex>0 ? definitionIndex : null)
    const endpoints=(position.blockade?.resources || []).filter(r=>r.japanControlled).map(r=>r.hex)
    const bases=candidates.filter(hex=>position.bases.some(b=>b.hex===hex && b.airfield)
        && position.units.filter(u=>u.location===hex && u.id!==id && (u.class==="air" || u.class==="ground")).length<3)
        .sort((a,b)=>Number(b===source)-Number(a===source)
            || Math.min(...endpoints.map(h=>ec_dist(a,h)))-Math.min(...endpoints.map(h=>ec_dist(b,h))) || a-b)
    const supplyBases=koreaSupply?candidates.slice().sort((a,b)=>Number(b===source)-Number(a===source)
        || ec_dist(a,source)-ec_dist(b,source) || a-b).slice(0,32):[]
    return {allowed:new Set(bases.slice(0,6)),cache:new Map(),supplyAllowed:new Set(supplyBases),supplyCache:new Map(),koreaSupply}
}
function ec_position_projection(scope,options) {
    const key=JSON.stringify(options)
    if (!scope.cache.has(key)) {
        if (scope.cache.size>=7) return null
        scope.cache.set(key,queryCampaignAirProjection({...options,...(ec_offensive_refined()?{steadySupply:true}:{})}))
    }
    return scope.cache.get(key)
}

function ec_position_score_core(hex, faction, piece, source, position, projectionScope) {
    if (!position || position.version !== 1 || !piece) return null
    // China Box is a legal interim bombing station, though it never satisfies
    // the final on-map B29 requirement. Candidate legality stays in the engine.
    if (piece.b29 && typeof CHINA_BOX !== "undefined" && hex === CHINA_BOX)
        return { score: [1, 0, 0, hex], reason: "b29-china-box-continuous-bombing" }
    const md = (position.bases || []).find(b => b.hex === hex)
    if (!md) return { score: null, reason: "not-a-friendly-base" }
    if (piece.class === "air" && !md.airfield || piece.class !== "air" && !md.port)
        return { score: null, reason: "wrong-base-type" }
    if (typeof queryNonNeutralZoi === "function" && queryNonNeutralZoi(hex, 1 - faction))
        return { score: null, reason: "enemy-non-neutral-zoi" }
    const definitionIndex=typeof pieces!=="undefined" && Array.isArray(pieces) ? pieces.indexOf(piece) : -1
    const id = Number.isInteger(piece.id) ? piece.id : Number.isInteger(piece.u) ? piece.u : definitionIndex>0 ? definitionIndex : null
    let at = (position.units || []).filter(u => u.location === hex && u.id !== id)
    // Raw engine pieces may lack a numeric id. At the source, remove exactly one
    // matching-class occupant before considering the moving unit's own slot.
    if (id === null && source === hex) {
        const index = at.findIndex(u => u.class === piece.class)
        if (index >= 0) at = at.filter((u, i) => i !== index)
    }
    const bucket = piece.class === "naval" ? "naval" : piece.class === "hq" ? "hq" : "land-air"
    const occupied = at.filter(u => bucket === "land-air" ? u.class === "ground" || u.class === "air" : u.class === bucket).length
    const limit = bucket === "naval" ? 6 : bucket === "hq" ? 1 : 3
    if (occupied >= limit) return { score: null, reason: "overstack" }
    const sourceMd = Number.isInteger(source) && typeof get_map_data === "function" ? get_map_data(source) : null
    const pacificUnit = (piece.service === "army" || piece.service === "navy") && !ec_cbi(sourceMd?.region)
    const preferredFocus = pacificUnit ? position.pacificFocus ?? position.focus : position.focus
    const focus = Number.isInteger(preferredFocus) ? preferredFocus : null
    const distance = focus === null ? 0 : ec_dist(hex, focus)
    const theaterPenalty = pacificUnit && ec_cbi(md.region) ? 1 : 0
    const ground = at.filter(u => u.class === "ground").length
    const naval = at.filter(u => u.class === "naval").length
    const compatibleWith = other => !position.interService
        || !position.homelandApproach && (typeof EVEN_SHORT_CAMPAIGN_SCENARIO === "undefined"
            || position.scenario !== EVEN_SHORT_CAMPAIGN_SCENARIO)
        || !["army", "navy"].includes(piece.service) || !["army", "navy"].includes(other.service)
        || piece.service === other.service
    const paired = piece.class === "naval" ? at.some(u => u.class === "ground" && compatibleWith(u))
        : piece.class === "ground" ? at.some(u => u.class === "naval" && compatibleWith(u)) : false
    const assembly = (position.assemblyPorts || []).includes(hex)
    const recent = (position.captured || []).includes(hex)
    const front = focus === null || distance <= 8
    const invasionPort = position.homelandApproach && hex === position.homelandRallyPort
    if (piece.class === "hq" && (position.homelandApproach || position.hqRelocation)
        && (position.homelandKeys || []).length && typeof piece.cr === "number") {
        const home = Math.min(...position.homelandKeys.map(key => ec_dist(hex, key)))
        const land = at.some(u => u.class === "ground"), escort = at.some(u => u.class === "naval")
        const coversHome = home <= piece.cr
        return { score: [theaterPenalty, coversHome && home <= 10 ? 0 : coversHome ? 1 : 2,
                home * 3 - (land && escort ? 20 : 0) - (recent ? 4 : 0), occupied, hex],
            reason: coversHome && home <= 10 ? "forward-hq-supports-homeland-landing" : "hq-covers-campaign-front" }
    }
    if (piece.b29 && typeof TOKYO !== "undefined") {
        const tokyoDistance = ec_dist(hex, TOKYO)
        return { score: [tokyoDistance <= 8 ? 0 : 2, tokyoDistance, occupied, hex],
            reason: tokyoDistance <= 8 ? "b29-base-in-tokyo-range" : "b29-base-approach" }
    }
    if (faction===0 && piece.class==="ground") {
        const gap=(position.islandDefense || []).find(d=>d.hex===hex && d.groundCount===0)
        const keep=source===hex && ((position.garrisonReserveIds || []).includes(id)
            || (position.islandDefense || []).some(d=>d.hex===hex && d.reserveId===id))
        if (ej_refined() && keep) return {score:[0,-1,-200,occupied,hex],reason:"retain-critical-base-garrison"}
        if (gap || keep) return {score:[0,0,-200-(gap?.priority || 0),occupied,hex],
            reason:keep?"retain-critical-island-garrison":"fill-critical-island-garrison"}
    }
    if (faction===1 && piece.class==="air" && !piece.b29 && id!==null && Number(position.turn)>=5
        && projectionScope && typeof queryCampaignAirProjection==="function") {
        if (!projectionScope.allowed.has(hex) && !projectionScope.koreaSupply) return {score:null,reason:"outside-air-screen-projection-budget"}
        const before=ec_position_projection(projectionScope,{faction})
        const after=projectionScope.allowed.has(hex)?ec_position_projection(projectionScope,{faction,moves:[{unit:id,hex}]}):null
        if (before?.eligible && after?.eligible) {
            if (after.ownOosIds.includes(id) || after.connectedResources.some(h=>!before.connectedResources.includes(h)))
                return {score:null,reason:"air-screen-breaks-resource-cut-or-supply"}
            const impact=ec_screen_gain(before,after,{victory:{blockade:position.blockade}})
            if (impact) return {score:[theaterPenalty,0,-100-impact.score,occupied,hex],reason:"sustain-resource-trace-air-screen"}
            if (source===hex && before.connectedResources.length===0 && position.blockade?.startedTurn)
                return {score:[theaterPenalty,0,-100,occupied,hex],reason:"retain-blockade-air-screen"}
        }
    }
    const priority = piece.class === "naval" && invasionPort ? 0
        : front && (paired || assembly) ? 0 : front ? 1 : 2
    const proximity = distance * 4 - (paired ? 12 : 0) - (recent ? 4 : 0)
    if (faction===0 && piece.class==="air") {
        const closesGroundSlot=(position.groundAssemblyPorts || []).includes(hex)
            && limit-occupied-1<Math.max(0,2-ground)
        return {score:[theaterPenalty,closesGroundSlot?1:0,priority,proximity,occupied,hex],
            reason:closesGroundSlot?"preserve-ground-assembly-slots":"air-support-with-ground-slots"}
    }
    return { score: [theaterPenalty, priority, proximity, occupied, hex],
        reason: paired && front ? "ground-escort-common-front-port" : assembly && front ? "planned-assembly-port"
            : recent && front ? "hold-captured-forward-base" : "approach-campaign-objective" }
}

function ec_position_score(hex,faction,piece,source,position,scope) {
    const result=ec_position_score_core(hex,faction,piece,source,position,scope)
    if (!Array.isArray(result?.score) || !scope?.koreaSupply || typeof queryCampaignSupplyProjection!=="function") return result
    const id=piece.id ?? (typeof pieces!=="undefined"?pieces.indexOf(piece):null)
    if (!Number.isInteger(id) || id<1) return result
    const ask=moves=>{
        const key=JSON.stringify(moves)
        if (!scope.supplyCache.has(key)) scope.supplyCache.set(key,queryCampaignSupplyProjection({faction,moves,protectedIds:position.supplyProtectedGroundIds}))
        return scope.supplyCache.get(key)
    }
    const before=ask([])
    const after=scope.supplyAllowed.has(hex)?ask([{unit:id,hex}]):null
    const risk=after?.eligible?after.protectedOosIds.length:position.supplyProtectedGroundIds.length+1
    const newOos=before?.eligible && after?.eligible?after.protectedOosIds.filter(i=>!before.protectedOosIds.includes(i)).length:risk
    return {...result,score:[risk,newOos,...result.score],reason:newOos?"korean-supply-risk-after-support-departure"
        : risk?"recover-korean-bridgehead-supply":"retain-korean-bridgehead-supply"}
}

function ec_pick_placement(view, candidates, unitId, role) {
    if (!ec_enabled(role) || !Array.isArray(candidates) || !candidates.length) return null
    const prior = view.ai?.plan
    if (role==="Allies" && (!prior || prior.delegatedOffensive || prior.role!==role)) return null
    const plan = prior && !prior.delegatedOffensive && prior.role===role ? prior
        : {version:1,role,tasks:[],campaign:{},garrisonReserveIds:[],victory:view.ai?.victory || {}}
    // Piece definitions are public static data; no off-map location or enemy
    // private state is read when a reinforcement has no on-map view projection.
    const publicUnit = (view.ai?.units || []).find(u => u.id === unitId)
    const definition = publicUnit || (typeof pieces !== "undefined" ? pieces[unitId] : null)
    if (!definition) return null
    const piece = { ...definition, id: unitId }
    const position = ec_positioning_context(view, plan)
    const faction = role === "Japan" ? 0 : 1
    const projectionScope=ec_position_projection_scope(position,piece,publicUnit?.location,candidates)
    const ranked = candidates.map(hex => ({ hex, ...ec_position_score(hex, faction, piece, publicUnit?.location, position,projectionScope) }))
        .filter(p => Array.isArray(p.score))
    ranked.sort((a, b) => {
        for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
            const d = (a.score[i] || 0) - (b.score[i] || 0)
            if (d) return d
        }
        return a.hex - b.hex
    })
    return ranked[0] || null
}

function ec_pbm_score(hex, faction, piece, source, targetPlan, projectionScope) {
    const position = targetPlan?.campaignPositioning
    if (!position || position.role !== (faction === 0 ? "Japan" : "Allies")) return null
    return ec_position_score(hex, faction, piece, source, position,projectionScope)
}

// Cover the central Pacific approach while keeping southern conquest distinct.
function ej_opening_refined() { return !!em_cfg()?.japan_campaign_opening_refinement }
function ej_refined() { return !!(typeof em_cfg==="function" && em_cfg()?.japan_campaign_refinement) }
function ej_defense_hexes() {
    const coordinates=[2909,3009,3209,3709,3813,3814]
    if (ej_refined()) coordinates.push(3416,4017,4415,4715,3305,3306,2813,2915)
    return typeof hex_to_int==="function" ? coordinates.map(hex_to_int) : []
}
function ej_guard_required(view,hex) {
    if (!ej_refined()) return true
    const ph=[2813,2915].map(hex_to_int)
    // Opening conquest may advance the sole Philippine army to the other key;
    // completed keys and the post-deadline defence keep their garrison.
    return !(view.sid===SHORT_CAMPAIGN_SCENARIO && Number(view.turn)<=4 && ph.includes(hex)
        && ph.some(h=>!ec_control(h,0)))
}
function ej_island_defense(view,board,units) {
    const ring=ej_defense_hexes()
    return board.filter(m=>ring.includes(m.hex) && ec_control(m.hex,0)).map(m=>{
        const ground=units.filter(u=>u.faction===0 && u.class==="ground" && u.location===m.hex)
            .sort((a,b)=>ec_cf(a)-ec_cf(b)||a.id-b.id)
        const threatRange=ej_opening_refined() && Number(view.turn)<=4 && m.hex===hex_to_int(3416)?14:8 // public watch radius, not a movement grant
        const assault=units.some(u=>u.faction===1 && u.class==="ground" && ec_dist(u.location,m.hex)<=threatRange
            && (ec_dist(u.location,m.hex)<=2 || units.some(n=>n.faction===1 && n.class==="naval" && n.location===u.location)))
        const turn=Number(view.turn),raw=typeof hex_to_int==="function" ? h=>hex_to_int(h) : h=>h
        const priorities=new Map([[2813,320],[3305,320],[3416,300],[4017,300],[2915,280],[4415,260],[4715,260],[3306,240]].map(([h,p])=>[raw(h),p]))
        const expanded=ej_refined() && priorities.has(m.hex)
        const early= [raw(2813),raw(2915)].includes(m.hex) ? 220 : [raw(3416),raw(4017)].includes(m.hex) ? 120 : 80
        const base=expanded ? turn>=5 ? priorities.get(m.hex) : early : 100+(turn>=5 ? 170 : 0)
        return {hex:m.hex,name:m.name,groundCount:ground.length,reserveId:ej_guard_required(view,m.hex) ? ground[0]?.id ?? null : null,
            priority:base+(assault ? 180 : 0),threatened:assault,
            ...(ej_refined() ? {groundCf:ground.reduce((n,u)=>n+ec_cf(u),0),minimumGround:1,
                reinforcementNeeded:assault && ground.length===1 && ec_cf(ground[0])<8} : {})}
    }).sort((a,b)=>b.priority-a.priority||a.hex-b.hex)
}
function ej_defense_tasks(env,defense) {
    const tasks=[]
    for (const gap of defense.filter(d=>d.groundCount===0 || ej_refined() && d.reinforcementNeeded)) {
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
            const earlyPalau=ej_opening_refined() && env.view.sid===SHORT_CAMPAIGN_SCENARIO && Number(env.view.turn)<=4
                && gap.hex===hex_to_int(3416) && gap.threatened && gap.groundCount===0
                && (["GROUND","STRATEGIC"].includes(mode) || mode==="AA" && group.length===1 && aspCost<=1)
                && ec_cf(u)<=12 && env.units.filter(x=>x.faction===0&&x.class==="ground"&&x.location===u.location).length>=2
            tasks.push(ec_make_task("REDEPLOY",gap.hex,group,[],mode,env,
                {score:gap.priority-ec_dist(u.location,gap.hex)*2-ec_cf(u)*.25-(gap.groundCount>0 ? 100 : 0)+(earlyPalau?140:0),
                    ...(earlyPalau?{openingDefenseReason:"public potential landing force; spare low-CF army; bounded transport cost"}:{}),
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

// END CAMPAIGN V2
return {applyPlan:ec_apply_plan,pickAction:ec_pick_action,pickPlacement:ec_pick_placement,taskComplete:ec_task_complete,pbmScore:ec_pbm_score,positionProjectionScope:ec_position_projection_scope,defenseHexes:ej_defense_hexes,guardRequired:ej_guard_required,positioningContext:ec_positioning_context}
})()
