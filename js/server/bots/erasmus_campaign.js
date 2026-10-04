// AI-WIN-01: public-view campaign planning. This module never reads or writes G.
// ec_plan(view, context) -> JSON PlanContext v1. Legality remains in rules_query.
// ec_apply_plan updates only the ephemeral Erasmus strategy cache. The caller
// persists the returned plan in action metadata and projects it as view.ai.plan.
// ec_pick_action returns a legal card/HQ/activation action, or null for Erasmus.
"use strict"

function ec_enabled(role) {
    const c = typeof em_cfg === "function" ? em_cfg() : null
    return role === "Allies" && !!(c && c.campaign_planner)
}

function ec_cf(u) {
    return u.reduced ? (Number(u.rcf) || Math.ceil((Number(u.cf) || 0) / 2)) : (Number(u.cf) || 0)
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

function ec_map() {
    if (typeof map === "undefined" || !Array.isArray(map)) return []
    return map.filter(m => m && (m.named || m.name || m.port || m.airfield || m.resource))
        .map(m => ({ ...m, hex: typeof hex_to_int === "function" ? hex_to_int(m.id) : m.id }))
        .filter(m => Number.isInteger(m.hex) && (typeof LAST_BOARD_HEX === "undefined" || m.hex <= LAST_BOARD_HEX))
        .sort((a, b) => a.hex - b.hex)
}

function ec_campaign_objective(view, board, units, faction) {
    const previous = view.ai?.plan?.campaign?.objectiveHex
    const turn = Number(view.turn || 0), atomic = view.ai?.victory?.atomic
    const atomicApproach = turn >= 9 && atomic?.noStrategicBombingFailure
    const baseApproach = turn >= 6 && !atomic?.b29InRangeOfTokyo
    const objectiveAge = turn - Number(view.ai?.plan?.campaign?.objectiveSinceTurn ?? view.ai?.plan?.turn ?? turn)
    const byHex = new Map(board.map(m => [m.hex, m]))
    const bases = board.filter(m => m.port && !ec_cbi(m.region) && ec_control(m.hex, faction)
        && units.some(u => u.faction === faction && u.location === m.hex && (u.class === "naval" || u.class === "ground" && (u.asp || u.aspCost))))
    if (Number.isInteger(previous) && byHex.has(previous) && objectiveAge < 2 && !ec_cbi(byHex.get(previous).region)
        && (!atomicApproach || byHex.get(previous).resource)
        && ec_control(previous, 1 - faction) && bases.some(b => ec_dist(b.hex, previous) <= 12)) return previous
    const targets = board.filter(m => m.named && (m.port || m.airfield || m.resource) && !ec_cbi(m.region)
        && m.region !== "Manchuria" && ec_control(m.hex, 1 - faction))
    const scored = targets.map(m => {
        const distance = Math.min(...bases.map(b => ec_dist(b.hex, m.hex)))
        const defenders = units.filter(u => u.faction !== faction && u.location === m.hex)
        const defense = defenders.reduce((sum, u) => sum + ec_cf(u) * (u.class === "ground" ? 1.2 : 0.5), 0)
        const tokyoDistance = typeof TOKYO === "undefined" ? 0 : ec_dist(m.hex, TOKYO)
        return { hex: m.hex, distance, score: (m.port ? 12 : 0) + (m.airfield ? 8 : 0)
            + (!defenders.length ? 24 : 0) + (atomicApproach && m.resource ? 120 : 0)
            + (baseApproach && m.airfield && tokyoDistance <= 8 ? 45 : 0)
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
    return task.movementUnitIds.every(id => units.some(u => u.id === id && u.location === task.hex))
}

function ec_redeploy_history(view, prior, faction) {
    const history = (prior?.campaign?.redeployments || []).filter(x => x.turn === Number(view.turn)).map(x => ({ ...x }))
    if (prior?.turn === Number(view.turn)) for (const task of prior.tasks || []) {
        if (task.kind !== "REDEPLOY" || !Number.isInteger(task.originHex) || !ec_task_complete(task, view, faction)) continue
        for (const unit of task.movementUnitIds) {
            if (!history.some(x => x.unit === unit && x.from === task.originHex && x.to === task.hex))
                history.push({ turn: Number(view.turn), unit, from: task.originHex, to: task.hex, target: task.followUpTarget ?? null })
        }
    }
    return history.slice(-64)
}

function ec_offensive_key(view, role) {
    const faction = role === "Japan" ? 0 : 1
    const off = view.offensive || {}
    return Number(off.attacker) === faction ? Number(off.offensive_card || 0) : Number(off.counter_offensive_card || 0)
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
    const turn = Number(view.turn || 0), started = Number(blockade?.startedTurn || 0)
    const completedPhases = blockade?.completedPhases ?? (started ? Math.max(0, Math.min(3, turn - started)) : 0)
    const missingHomeland = homelandKeys.filter(h => !ec_control(h, faction))
    const manchuria = board.filter(m => m.resource && m.region === "Manchuria" && ec_control(m.hex, 1 - faction)).map(m => m.hex)
    const soviet = (view.ai?.ownCards || []).find(c => /soviet/i.test(c.name || ""))
    const enemyHqs = (view.ai?.units || []).filter(u => u.faction !== faction && u.class === "hq")
    const atomicClockLost = turn > 9 && !atomic?.noStrategicBombingFailure
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
    env.moves.set(key, result)
    return result
}

function ec_service_compatible(units, view, faction) {
    if (!view.inter_service?.[faction]) return true
    const services = new Set(units.map(u => u.service).filter(s => s === "army" || s === "navy"))
    return services.size <= 1
}

function ec_garrison_reserve(view, board, units, faction) {
    const reserve = new Set()
    const recent = new Set(view.capture || [])
    for (const m of board) {
        if (!(m.resource || recent.has(m.hex)) || !ec_control(m.hex, faction)) continue
        const at = units.filter(u => u.faction === faction && u.class === "ground" && u.location === m.hex)
            .sort((a, b) => ec_cf(a) - ec_cf(b) || a.id - b.id)
        const threatened = units.some(u => u.faction !== faction && u.class === "ground" && ec_dist(u.location, m.hex) <= 6)
        if (at.length && (m.resource || threatened)) reserve.add(at[0].id)
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
    const defenders = env.units.filter(u => u.faction !== env.faction && u.location === m.hex)
    let score = (m.named ? 12 : 0) + (m.port ? 10 : 0) + (m.airfield ? 8 : 0) + (m.resource ? 32 : 0)
    if (env.powGap && m.named && !(env.view.capture || []).includes(m.hex))
        score += 90 + Math.min(4, env.powGap) * 10 + Math.min(2, env.powPressure || 0) * 35
    if (!defenders.length) score += 26
    if (env.axisTargets.has(m.hex)) score += 12
    if (env.previousObjective === m.hex) score += 8
    if (env.campaignObjective === m.hex) score += 18
    if (env.victory.b29Bases.includes(m.hex) && Number(env.view.turn) >= 6) score += 22
    if (env.victory.homelandKeys.includes(m.hex)) score += 40
    if (m.resource && Number(env.view.turn) >= 9 && env.victory.atomic?.noStrategicBombingFailure)
        score += env.victory.jpResources <= 4 ? 150 : 80
    if (defenders.some(u => u.class === "hq")) score += env.victory.routes.headquarters.enemyHqCount <= 1 ? 120 : 38
    // A reachable resource is useful, but proximity to Tokyo alone never makes
    // a distant or impossible invasion preferable to an executable landing.
    return score
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
        .sort((a, b) => ec_cf(b) - ec_cf(a) || a.id - b.id)
    return support.slice(0, remaining)
}

function ec_reaction(target, env) {
    env.reactions ||= new Map()
    if (env.reactions.has(target)) return env.reactions.get(target)
    let result = null
    if (typeof queryReactionCandidates === "function") {
        try {
            const r = queryReactionCandidates({ reactionFaction: 1 - env.faction, targetHex: target,
                cardContext: { cardId: env.cardId, hqId: env.hq?.id, cardMode: env.cardMode, faction: env.faction } })
            const ids = new Set([...(r.air || []), ...(r.carrier || []), ...(r.naval || [])])
            const candidates = env.units.filter(u => ids.has(u.id) && u.location !== target)
            if (Array.isArray(r.hqOptions)) {
                let best = { units: [], cf: 0, hq: null, budget: 0 }
                for (const option of r.hqOptions) {
                    const legal = new Set(option.units || [])
                    const available = env.units.filter(u => legal.has(u.id) && u.faction !== env.faction && u.location !== target
                        && (u.class === "air" || u.class === "naval"))
                        .sort((a, b) => ec_cf(b) - ec_cf(a) || a.id - b.id)
                    const services = env.view.inter_service?.[1 - env.faction] ? ["army", "navy"] : [null]
                    for (const service of services) {
                        const units = available.filter(u => !service || !["army", "navy"].includes(u.service) || u.service === service)
                            .slice(0, Math.max(0, Number(option.budget) || 0))
                        const cf = units.reduce((sum, u) => sum + ec_cf(u), 0)
                        if (cf > best.cf) best = { units, cf, hq: option.hq, budget: option.budget }
                    }
                }
                result = { ...best, estimate: "single-hq-budget-and-service" }
            } else result = { units: candidates, estimate: "uncapped-public-candidate-estimate" }
        } catch (e) { /* A missing query is an explicitly labelled estimate. */ }
    }
    if (!result) result = { units: env.units.filter(u => u.faction !== env.faction && u.location !== target
        && (u.class === "air" || (u.class === "naval" && Number(u.br) > 0))
        && ec_dist(u.location, target) <= Math.max(Number(u.br) || 0, Number(u.ebr) || 0)), estimate: "public-range-estimate" }
    env.reactions.set(target, result)
    return result
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
    const reactionPlan = ec_reaction(target, env), reaction = reactionPlan.units
    const attSea = sea.reduce((s, u) => s + ec_cf(u), 0)
    const defSea = seaDef.reduce((s, u) => s + ec_cf(u), 0)
    const reactionCf = reaction.reduce((s, u) => s + ec_cf(u), 0)
    const config = typeof em_cfg === "function" ? em_cfg() || {} : {}
    const reactionWeight = Number.isFinite(config.emReactionWeight) ? config.emReactionWeight : 0.35
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
    const unopposedLanding = amphibious && defenders.length === 0 && groundDef.length === 0 && !specialReaction
    const navalSafe = emptyLandCapture || unopposedLanding || naval.pWin > 0
    const terrain = typeof get_map_data === "function" ? Number(get_map_data(target)?.terrain) : 0
    const terrainMod = terrain === 2 ? -1 : terrain === 3 ? -2 : terrain === 4 ? -3 : 0
    function groundChance(defendersSea) {
        if (!groundDef.length) return 1
        if (typeof em_ground_outcome !== "function") return 0
        return em_ground_outcome({ attCF: ground.reduce((s, u) => s + ec_cf(u), 0),
            defCF: groundDef.reduce((s, u) => s + ec_cf(u), 0),
            attMods: terrainMod + (sea.some(u => Number(u.br) > 0) && !defendersSea.some(u => Number(u.br) > 0) ? 2 : 0)
                + (group.some(u => u.class === "naval") && !defendersSea.some(u => u.class === "naval") ? 2 : 0),
            defMods: amphibious ? 3 : 0,
            attLfs: ground.map(u => amphibious ? Math.ceil((Number(u.lf) || 1) / 2) : Number(u.lf) || 1),
            defLfs: groundDef.map(u => Number(u.lf) || 1),
            attSteps: ground.map(u => u.reduced || u.oneStep ? 1 : 2),
            defSteps: groundDef.map(u => u.steps || (u.reduced || u.oneStep ? 1 : 2)) }).pWin
    }
    const pGround = groundChance(seaDef), pGroundWithReaction = groundChance(seaDef.concat(reaction))
    const fullReactionNaval = typeof em_naval_outcome === "function"
        ? em_naval_outcome({ attCF: attSea, defCF: defSea + reactionCf, attHasBr, defHasBr }).pWin
        : attSea > defSea + reactionCf && (attHasBr || !defHasBr) ? 1 : reactionCf === 0 ? naval.pWin : 0
    // Keep the existing battle estimator, but make its uncertainty explicit.
    // A group that loses against an actual reaction is not a certain capture
    // merely because it beats 35% of the reaction fleet on paper.
    const pCapture = emptyLandCapture || unopposedLanding ? 1 : reactionCf > 0
        ? (1 - reactionWeight) * pGround + reactionWeight * fullReactionNaval * pGroundWithReaction : pGround
    const minimum = env.powGap && Number(env.view.political_will) <= 2
        ? Number(config.epDesperateMinP ?? 0.45) : Number(config.epMinP ?? 0.6)
    const desiredProbability = Number(config.epDesiredP ?? 0.75)
    return { executable: ground.length > 0 && navalSafe && pCapture >= minimum,
        pCapture: Number(pCapture.toFixed(2)), requiredProbability: minimum, desiredProbability,
        attackingGround: ground.reduce((s, u) => s + ec_cf(u), 0), defendingGround: groundDef.reduce((s, u) => s + ec_cf(u), 0),
        defendingGarrisons: groundDef.filter(u => u.garrison).map(u => u.id),
        pGround, pGroundWithReaction, pNavalWithReaction: fullReactionNaval,
        attackingAirSea: attSea, defendingAirSea: defSea, potentialReaction: reactionCf, reactionWeight, emptyLandCapture, unopposedLanding,
        reactionEstimate: reactionPlan.estimate, reactionHq: reactionPlan.hq ?? null, reactionBudget: reactionPlan.budget ?? null,
        reactionUnitIds: reaction.map(u => u.id),
        rejection: !navalSafe ? "insufficient-air-sea-cover" : pCapture < minimum ? "capture-probability-below-threshold" : null }
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

function ec_missions(env) {
    const result = []
    const grounds = env.available.filter(u => u.class === "ground" && !env.garrisonReserve.has(u.id))
        .sort((a, b) => ec_cf(b) - ec_cf(a) || a.id - b.id).slice(0, 10)
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
                for (const order of orders) for (let ns = 1; ns <= Math.min(4, order.length); ns++)
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
            // 8.45D also applies to empty one-hex islands. Some old movement
            // paths omit this check in their empty-landing branch; do not use
            // that omission to grant the bot an illegal invasion.
            if (group.mode === "AA" && m.island && group.units.some(u => u.class === "ground" && u.service === "army")
                && !group.units.some(u => u.class === "ground" && u.service === "navy")) continue
            const support = ec_support(group.units, hex, env)
            let force = support.slice(), assessment = ec_assess(group.units, force, hex, group.mode === "AA", env)
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
            const score = ec_score_target(m, env) * assessment.pCapture
                - (group.units.length + force.length) * 2 - ec_dist(group.units[0].location, hex)
                - Math.max(0, assessment.desiredProbability - assessment.pCapture) * 40
            result.push(ec_make_task("CONQUEST", hex, group.units, force, group.mode, env,
                { score, assessment, aspCost: group.mode === "AA" ? Number(reach.aspCost || 0) : 0,
                    declaresBattle: assessment.defendingGround > 0 || env.units.some(u => u.faction !== env.faction && u.location === hex),
                    objective: env.powGap && m.named && !(env.view.capture || []).includes(hex) ? "POW" : m.resource ? "RESOURCES" : "FORWARD_BASE" }))
        }
    }
    return result.sort((a, b) => b.score - a.score || a.requiredUnits.length - b.requiredUnits.length || a.hex - b.hex || a.id.localeCompare(b.id))
}

function ec_transport(env) {
    const tasks = []
    const enemyTargets = env.board.filter(m => ec_control(m.hex, 1 - env.faction))
        .sort((a, b) => ec_score_target(b, env) - ec_score_target(a, env) || a.hex - b.hex)
    if (!enemyTargets.length) return tasks
    const ownGround = env.units.filter(u => u.faction === env.faction && u.class === "ground")
    for (const u of env.available.filter(u => u.class === "ground" && u.stratMove && !env.garrisonReserve.has(u.id)).slice(0, 12)) {
        const cbi = h => ec_cbi(env.byHex.get(h)?.region)
        const campaignGoal = !cbi(u.location) && env.byHex.get(env.campaignObjective)
        const goal = campaignGoal || enemyTargets.filter(m => cbi(m.hex) === cbi(u.location))
            .sort((a, b) => (ec_dist(u.location, a.hex) * 5 - ec_score_target(a, env) * 0.15)
                - (ec_dist(u.location, b.hex) * 5 - ec_score_target(b, env) * 0.15) || a.hex - b.hex)[0]
        if (!goal) continue
        const reach = ec_query_moves([u.id], typeof STRAT_MOVE === "undefined" ? 1 : STRAT_MOVE, env)
        for (const hex of reach.reachableHexes || []) {
            const md = env.byHex.get(hex)
            if (!md?.port || !ec_control(hex, env.faction) || hex === u.location || cbi(hex) !== cbi(goal.hex)) continue
            const localEnemy = goal
            if (!localEnemy) continue
            const before = ec_dist(u.location, localEnemy.hex), after = ec_dist(hex, localEnemy.hex)
            const fleet = env.units.some(n => n.faction === env.faction && n.class === "naval" && n.location === hex)
            const held = (env.view.capture || []).includes(hex) || !!md.resource
            const groundCount = ownGround.filter(g => g.location === hex).length
            // Keep gains occupied, or assemble at a port that gets this unit
            // closer to a real target. No nearest-friendly-port oscillation.
            if (!(before >= after + 2 && after <= 8) && !(held && groundCount === 0 && after <= 6)) continue
            const score = (held && groundCount === 0 ? 48 : 0) + (fleet ? 30 : 0)
                + Math.min(12, before - after) * 3 - after * 2 - groundCount * 12
            tasks.push(ec_make_task("REDEPLOY", hex, [u], [], "STRATEGIC", env,
                { score, objective: held && groundCount === 0 ? "GARRISON" : "ASSEMBLE", followUpTarget: localEnemy.hex }))
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
            if (present.length >= 2 && present.some(u => Number(u.br) > 0) && presentCf >= 30) continue
            if (present.length + group.length > 6 || !ec_service_compatible(at.concat(group), env.view, env.faction)) continue
            const candidateTargets = enemyTargets.filter(m => ec_cbi(m.region) === ec_cbi(destination.region))
            const campaignTarget = env.byHex.get(env.campaignObjective)
            const target = campaignTarget && ec_dist(hex, campaignTarget.hex) <= 8 ? campaignTarget
                : candidateTargets.sort((a, b) => ec_dist(hex, a.hex) - ec_dist(hex, b.hex) || a.hex - b.hex)[0]
            if (!target) continue
            const distance = ec_dist(hex, target.hex)
            if (distance > 8) continue
            if ((env.redeployments || []).some(x => group.some(u => u.id === x.unit)
                && x.from === hex && x.to === origin)) continue
            const sourceGround = ownGround.filter(g => g.location === origin && (g.asp || g.aspCost))
            const sourceReady = sourceGround.some(g => ec_service_compatible([g].concat(local), env.view, env.faction))
                && local.length >= 2 && local.some(u => Number(u.br) > 0) && local.reduce((s,u)=>s+ec_cf(u),0) >= 30
            const remaining = local.filter(u => !group.some(n => n.id === u.id))
            const remainingReady = remaining.length >= 2 && remaining.some(u => Number(u.br) > 0)
                && remaining.reduce((s,u)=>s+ec_cf(u),0) >= 30
            // Keep a complete landing force together unless the new port makes
            // material progress toward its same explicit target.
            if (sourceReady && !remainingReady && ec_dist(origin, target.hex) < distance + 2) continue
            const combined = present.concat(group), cf = combined.reduce((s,u)=>s+ec_cf(u),0)
            const gainsCover = !present.some(u=>Number(u.br)>0) && group.some(u=>Number(u.br)>0)
            const readiness = Math.min(30, cf) - Math.min(30, presentCf) + (gainsCover ? 18 : 0)
            tasks.push(ec_make_task("REDEPLOY", hex, group, [], "STRATEGIC", env,
                { score: 28 + readiness - distance * 2 - group.length * 2 + (target.hex === env.campaignObjective ? 10 : 0),
                    objective: "ASSEMBLE_ESCORT", followUpTarget: target.hex }))
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
            if (env.units.filter(u => u.faction === env.faction && u.location === hex
                && (u.class === "air" || u.class === "ground")).length >= 3) continue
            const score = air.b29 ? (after <= 8 ? 185 : 72) - after : 34 + Math.min(12, before - after) - after
            tasks.push(ec_make_task("REDEPLOY", hex, [air], [], "STRATEGIC", env,
                { score, objective: air.b29 ? "B29_DEPLOYMENT" : "AIR_SUPPORT_BASE", followUpTarget: goal }))
        }
    }
    return tasks.sort((a, b) => b.score - a.score || a.hex - b.hex || a.id.localeCompare(b.id))
}

function ec_plan(view, context) {
    context = context || {}
    const role = context.role || view.active || "Allies", faction = role === "Japan" ? 0 : 1
    const units = (view.ai?.units || []).map(u => ({ ...u }))
    const board = ec_map(), byHex = new Map(board.map(m => [m.hex, m]))
    const capture = (view.capture || []).filter(h => ec_control(h, faction))
    const powGap = Math.max(0, Number(view.pow || 0) - capture.length)
    const victory = ec_victory(view, board, faction)
    const campaignObjective = ec_campaign_objective(view, board, units, faction)
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
    const blockers = [], choices = [], attainable = new Map()
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
            cardMode: preCard ? card.mode : undefined, powGap, powPressure, victory, axisTargets, redeployments,
            previousObjective: view.ai?.plan?.objective?.hex, campaignObjective, moves: new Map(), reactions: new Map(), blockers, garrisonReserve }
        const attack = ec_missions(env)
        const transport = ec_transport(env)
        const aspBudget = Math.max(0, Number(view.asp?.[faction]?.[0] || 0) - Number(view.asp?.[faction]?.[1] || 0))
        for (const task of attack) if (task.objective === "POW" && task.aspCost <= aspBudget) {
            const old = attainable.get(task.hex)
            if (!old || old.pCapture < task.assessment.pCapture) attainable.set(task.hex,
                { hex: task.hex, cardId: card.id, hq: hq.id, pCapture: task.assessment.pCapture,
                    requiredUnits: task.requiredUnits.slice(), aspCost: task.aspCost })
        }
        const ranked = attack.concat(transport).sort((a, b) => b.score - a.score || a.hex - b.hex || a.id.localeCompare(b.id))
        if (!ranked.length) { if (blockers.length < 16) blockers.push({ hq: hq.id, reason: available.some(u => u.class === "ground")
            ? "no-executable-capture-or-transport" : "no-legal-ground-under-hq" }); continue }
        const tasks = [], assigned = new Set(activeIds)
        let spent = 0, aspSpent = 0, battles = (view.offensive?.battle_hexes || []).length
        const multiBattle = card.mode === "event"
        for (const task of ranked) {
            if (tasks.some(t => t.hex === task.hex) || task.requiredUnits.some(id => assigned.has(id))
                || spent + task.requiredUnits.length > budget || aspSpent + Number(task.aspCost || 0) > aspBudget
                || (!multiBattle && task.declaresBattle && battles > 0)) continue
            if (!ec_service_compatible(tasks.flatMap(t => t.requiredUnits).concat(task.requiredUnits)
                .map(id => units.find(u => u.id === id)).filter(Boolean), view, faction)) continue
            tasks.push(task); task.requiredUnits.forEach(id => assigned.add(id)); spent += task.requiredUnits.length
            aspSpent += Number(task.aspCost || 0); if (task.declaresBattle) battles++
            if (tasks.length >= (powPressure >= 1 && powGap >= 3 ? 3 : 2)) break
        }
        if (tasks.length) choices.push({ cardId: card.id, cardMode: card.mode, cardSpec: card, hq: hq.id, budget, tasks,
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
    victory.routes.atomic.immediateResourceTargets = tasks.filter(t => t.kind === "CONQUEST" && victory.resourceTargets.includes(t.hex)).map(t => t.hex)
    victory.routes.headquarters.immediatelyExecutableTargets = tasks.filter(t => t.kind === "CONQUEST"
        && victory.routes.headquarters.targets.some(h => h.hex === t.hex)).map(t => t.hex)
    const targets = tasks.map(t => ({ hex: t.hex, kind: t.kind, requiresOccupation: t.kind === "CONQUEST",
        requiresFriendlyControl: t.kind === "REDEPLOY", requiredUnits: t.requiredUnits.slice(),
        movementUnitIds: t.movementUnitIds.slice(), supportUnitIds: t.supportUnitIds.slice(),
        movementModes: t.movementModes.slice(), campaignTask: true, taskId: t.id,
        objective: t.objective, damageLevel: 1 }))
    const first = tasks[0]
    return { version: 1, role, turn: Number(view.turn || 0), cardId: best?.cardId || ec_offensive_key(view, role),
        cardIntent: best?.cardMode || null, cardSpec: best?.cardSpec || null, preferredHq: best?.hq || null, activationBudget: best?.budget || 0,
        objective: first ? { type: first.objective, hex: first.followUpTarget ?? first.hex } : { type: "BLOCKED", hex: null },
        phase: first ? first.kind === "CONQUEST" ? "CAPTURE" : first.objective === "GARRISON" ? "GARRISON" : "ASSEMBLE" : "BLOCKED",
        focus: first?.hex ?? null, targets, tasks, blockers: blockers.slice(0, 16), garrisonReserveIds: [...garrisonReserve].sort((a,b)=>a-b),
        campaign: { theater: "PACIFIC", objectiveHex: campaignObjective, redeployments,
            objectiveSinceTurn: view.ai?.plan?.campaign?.objectiveHex === campaignObjective
                ? view.ai.plan.campaign.objectiveSinceTurn ?? view.ai.plan.turn : Number(view.turn || 0) },
        pow: { required: Number(view.pow || 0), held: capture.length, gap: powGap, politicalWill: Number(view.political_will || 0),
            remainingCards, remainingOffensives, requiredCapturesPerCard: Number(powPressure.toFixed(2)),
            evaluatedCardIds: cardChoices.map(c=>c.id), unexaminedCardIds: ownCards.filter(c=>!cardChoices.some(x=>x.id===c.id)).map(c=>c.id),
            attainableCaptureTargets: [...attainable.values()].sort((a,b)=>a.hex-b.hex),
            selectedCaptureTargets: selectedCaptures.map(t=>t.hex), expectedSelectedCaptures: Number(selectedCaptures.reduce((s,t)=>s+t.assessment.pCapture,0).toFixed(2)),
            quotaFeasibility, reason: quotaReasons[quotaFeasibility], forecastScope: "current-public-position-and-evaluated-own-cards; no future-draw-or-sequence-guarantee" },
        victory, preCard, strategySource: "CAMPAIGN_PLANNER", rulesSource: "engine legality queries" }
}

function ec_apply_plan(view, context) {
    const role = context.role || view.active
    if (!ec_enabled(role)) return null
    const faction = role === "Japan" ? 0 : 1
    const prior = view.ai?.plan
    const cardWindow = ec_card_window(view), chooseHq = /choose hq/i.test(String(view.prompt || ""))
    const selectAction = /select action/i.test(String(view.prompt || ""))
    const ownOffensive = cardWindow || selectAction || chooseHq || /activate units|move units/i.test(String(view.prompt || ""))
    if (view.ai?.windowKind === "reaction" || view.ai?.windowKind === "pbm" || prior && !ownOffensive) {
        const kept = prior ? JSON.parse(JSON.stringify(prior)) : null
        if (kept) {
            kept.campaign = { ...kept.campaign, redeployments: ec_redeploy_history(view, kept, faction) }
            kept.positioning = ec_positioning_context(view, kept)
        }
        context.campaignPlan = kept
        return kept
    }
    const sameOffensive = prior && prior.version === 1 && prior.role === role && prior.turn === Number(view.turn)
        && (prior.cardId === ec_offensive_key(view, role) || selectAction)
    let plan = sameOffensive && !cardWindow && !chooseHq && !prior.preCard ? JSON.parse(JSON.stringify(prior)) : null
    if (selectAction && prior && prior.turn === Number(view.turn)) plan = JSON.parse(JSON.stringify(prior))
    if (!plan) {
        const axis = typeof eop_axis === "function" ? eop_axis(role) : null
        plan = ec_plan(view, { ...context, strategicTargets: axis?.targetMeta || axis?.chain || [] })
    }
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
            const mode = task.movementModes[0] === "AA" ? AMPH_MOVE : task.movementModes[0] === "GROUND" ? GROUND_MOVE : STRAT_MOVE
            const moving = task.movementUnitIds.filter(id => (view.actions?.unit || []).includes(id))
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
    if (view.ai?.state === "strategic_bombing" && actions.all)
        return { action: "all", argument: undefined, via: "campaign-continuous-strategic-bombing" }
    if (view.ai?.state === "move_units" && actions.stop)
        return { action: "stop", argument: undefined, via: "campaign-ground-stop" }
    if (/move units/i.test(prompt) && plan.focus === null && actions.done)
        return { action: "done", argument: undefined, via: "campaign-no-pending-movement" }
    if (ec_card_window(view) && Array.isArray(actions.card)) {
        // Let the existing historical-event logic handle the Soviet card and
        // service-rivalry remedies; these are public own-hand choices.
        const important = (view.ai?.ownCards || []).some(c => /soviet|inter.?service|joint.*planning/i.test(c.name || "")
            && Array.isArray(c.allowed) && c.allowed.includes("event"))
        if (important) { plan.delegatedCard = true; return null }
        if (plan.tasks.length && actions.card.includes(plan.cardId)) return { action: "card", argument: plan.cardId, via: "campaign-card-hq-task-plan" }
        return null
    }
    if (/select action/i.test(prompt) && !plan.delegatedCard && plan.tasks.length && actions[plan.cardIntent || "ops"])
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
function ec_positioning_context(view, plan) {
    const faction = plan.role === "Japan" ? 0 : 1
    const own = (view.ai?.units || []).filter(u => u.faction === faction)
    const next = plan.tasks?.find(t => Number.isInteger(t.followUpTarget))?.followUpTarget
        ?? plan.objective?.hex ?? plan.focus ?? view.ai?.focus ?? null
    const bases = ec_map().filter(m => (m.port || m.airfield) && ec_control(m.hex, faction))
        .map(m => ({ hex: m.hex, port: !!m.port, airfield: !!m.airfield, region: m.region || "", resource: !!m.resource }))
    return { version: 1, role: plan.role, focus: next,
        pacificFocus: plan.campaign?.objectiveHex ?? ec_campaign_objective(view, ec_map(), view.ai?.units || [], faction),
        bases, units: own.map(u => ({ id: u.id, class: u.class, location: u.location, service: u.service || null,
            asp: !!u.asp, b29: !!u.b29 })), captured: (view.capture || []).slice(),
        assemblyPorts: (plan.tasks || []).filter(t => /ASSEMBLE/.test(t.objective || "")).map(t => t.hex),
        garrisonReserveIds: (plan.garrisonReserveIds || []).slice() }
}

function ec_position_score(hex, faction, piece, source, position) {
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
    const id = Number.isInteger(piece.id) ? piece.id : Number.isInteger(piece.u) ? piece.u : null
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
    const paired = piece.class === "naval" ? ground > 0 : piece.class === "ground" ? naval > 0 : false
    const assembly = (position.assemblyPorts || []).includes(hex)
    const recent = (position.captured || []).includes(hex)
    const front = focus === null || distance <= 8
    if (piece.b29 && typeof TOKYO !== "undefined") {
        const tokyoDistance = ec_dist(hex, TOKYO)
        return { score: [tokyoDistance <= 8 ? 0 : 2, tokyoDistance, occupied, hex],
            reason: tokyoDistance <= 8 ? "b29-base-in-tokyo-range" : "b29-base-approach" }
    }
    const priority = front && (paired || assembly) ? 0 : front ? 1 : 2
    const proximity = distance * 4 - (paired ? 12 : 0) - (recent ? 4 : 0)
    return { score: [theaterPenalty, priority, proximity, occupied, hex],
        reason: paired && front ? "ground-escort-common-front-port" : assembly && front ? "planned-assembly-port"
            : recent && front ? "hold-captured-forward-base" : "approach-campaign-objective" }
}

function ec_pick_placement(view, candidates, unitId, role) {
    if (!ec_enabled(role) || !Array.isArray(candidates) || !candidates.length) return null
    const plan = view.ai?.plan
    if (!plan || plan.role !== role) return null
    // Piece definitions are public static data; no off-map location or enemy
    // private state is read when a reinforcement has no on-map view projection.
    const publicUnit = (view.ai?.units || []).find(u => u.id === unitId)
    const definition = publicUnit || (typeof pieces !== "undefined" ? pieces[unitId] : null)
    if (!definition) return null
    const piece = { ...definition, id: unitId }
    const position = ec_positioning_context(view, plan)
    const faction = role === "Japan" ? 0 : 1
    const ranked = candidates.map(hex => ({ hex, ...ec_position_score(hex, faction, piece, publicUnit?.location, position) }))
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

function ec_pbm_score(hex, faction, piece, source, targetPlan) {
    const position = targetPlan?.campaignPositioning
    if (!position || position.role !== (faction === 0 ? "Japan" : "Allies")) return null
    return ec_position_score(hex, faction, piece, source, position)
}
