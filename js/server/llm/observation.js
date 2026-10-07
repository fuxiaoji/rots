"use strict"
const crypto = require("node:crypto")
const clone = value => JSON.parse(JSON.stringify(value))
const hash = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")
const ROLES = ["Japan", "Allies"]
const pick = (object, keys) => Object.fromEntries(keys.filter(k => object && object[k] !== undefined).map(k => [k, clone(object[k])]))
const CARD_KEYS = ["id", "name", "type", "faction", "ops", "logistic", "hq", "reaction", "military", "intelligence", "logistic_alt", "previewEvent", "allowed", "metadata"]
const UNIT_KEYS = ["id", "definitionId", "name", "faction", "class", "type", "service", "cf", "rcf", "lf", "oneStep", "br", "ebr", "cr", "cm", "asp", "aspCost", "aspr", "b29", "parenthetical", "stratMove", "reduced", "location"]
function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }
function visible(rules, state, role) {
    if (![...ROLES, "Observer"].includes(role)) throw new Error("invalid observation role")
    const view = rules.view(clone(state), role)
    const publicData = rules.query(clone(state), role, "llm_public_data")
    const side = ROLES.indexOf(role)
    const ownIds = side >= 0 && Array.isArray(view.hand?.[side]) ? view.hand[side].slice() : []
    const ownFuture = side >= 0 ? view.future_offensive?.[side] : -1
    if (ownFuture > 0 && !ownIds.includes(ownFuture)) ownIds.push(ownFuture)
    const cardMeta = new Map((view.ai?.ownCards || []).map(c => [c.id, c]))
    const observation = { schemaVersion: 2, role, scenario: publicData.scenario || state.scenario, active: view.active, turn: view.turn,
        window: view.ai?.windowKind || null, state: view.ai?.state || null, prompt: view.prompt,
        politicalWill: view.political_will, pow: view.pow, resources: clone(view.resources || []),
        asp: clone(view.asp || []), passes: clone(view.passes || []),
        handCounts: (view.hand || []).map(h => Array.isArray(h) ? h.length : h),
        ownFutureOffensive: ownFuture > 0 ? ownFuture : null,
        ownCards: ownIds.map(id => pick({ ...(publicData.cards[id] || { id }), ...(cardMeta.get(id) || {}) }, CARD_KEYS)),
        selectedUnits: clone(view.active_stack || []), selectedMovementUnits: view.ai?.state === "move_offensive_units" ? clone(view.active_stack || []) : [],
        activeUnits: side >= 0 ? clone(view.offensive?.active_units?.[side] || []) : [],
        activation: publicData.activation,
        unselectableUnits: clone(view.unselect || []), units: (view.ai?.units || []).map(u => pick(u, UNIT_KEYS)),
        hexes: publicData.hexes,
        battle: { hexes: clone(view.offensive?.battle_hexes || []),
            activatedUnits: clone(view.offensive?.active_units || []),
            attacker: ROLES[view.offensive?.attacker] || null, type: view.offensive?.type ?? null },
        log: (view.log || []).slice(-24).filter(x => typeof x === "string" && !x.startsWith("[ERASMUS]")) }
    const p = publicData.planning || {}, hexes = new Map(observation.hexes.map(h => [h.hex, h])), supplies = new Map((p.ownSupply || []).map(s => [s.id, s.supplied]))
    observation.units = observation.units.map(u => ({ ...u, locationMapId: hexes.get(u.location)?.id || null, locationName: hexes.get(u.location)?.name || null,
        currentCF: u.reduced ? u.rcf : u.cf,
        currentBaseASP: u.class === "ground" && u.asp ? u.reduced ? u.aspr : u.aspCost : null,
        ...(u.faction === side ? {
            outOfSupplyMarker: Array.isArray(view.oos) ? view.oos.includes(u.id) : null,
            supplied: view.oos?.includes(u.id) ? false : supplies.get(u.id) === true ? true : null,
            supplyBasis: view.oos?.includes(u.id) ? "public-oos-marker" : supplies.get(u.id) === true
                ? u.class === "hq" ? "engine-hq-exemption" : observation.activeUnits.includes(u.id) ? "engine-active-exemption" : "positive-engine-probe"
                : "fast-cache-negative-is-unknown"
        } : {}) }))
    observation.ownUnitDefinitions = clone(p.ownUnitDefinitions || [])
    observation.ownASP = side >= 0 ? clone(view.asp?.[side] ?? null) : null
    observation.ownASPRemaining = p.ownASPRemaining ?? null
    observation.ownPasses = side >= 0 ? view.passes?.[side] ?? null : null
    observation.progressOfWar = clone(p.pow || null)
    observation.cardPreviews = clone(p.cardPreviews || [])
    observation.cardPreviewsLimited = !!p.previewsLimited
    observation.ownHQDistances = clone(p.ownHQDistances || [])
    const cardId = observation.state === "offensive_segment" ? null : p.currentCardId
    const card = cardId ? pick({ ...publicData.cards[cardId], ...(cardMeta.get(cardId) || {}) }, CARD_KEYS) : null
    const plays = (view.log || []).filter(x => /^C\d+ played as (operation card|event)\./.test(x)).length
    observation.currentDecision = { role, turn: observation.turn, state: observation.state, window: observation.window,
        currentCard: card ? { ...card, selectedMode: p.currentCardMode, eventLogistic: card.logistic ?? null,
            intelligenceThresholds: { ops: card.metadata?.oc ?? null, event: card.metadata?.ec ?? null } } : null,
        currentCardBasis: p.currentCardBasis,
        ...pick(p.offensive, ["attacker", "cardId", "ownReactionCardId", "stage", "ownHQ", "logistic", "intelligence", "navalMoveDistance", "groundMoveDistance", "airMoveDistance", "movedUnitIds", "battleHexes"]),
        offensiveScope: { turn: observation.turn, basis: "public-play-epoch; conservative revalidation, not stable engine offensive ID",
            instance: `${observation.turn}:${p.offensive?.attacker || "none"}:${cardId || "between"}:${p.currentCardMode || "unselected"}:${plays}:${observation.state === "offensive_segment_card_action" ? "pending" : "played"}` } }
    // Selecting a unit registers an origin-only path. That is not movement.
    const ownMovementRecords = []
    for (let i = 0; i < (view.offensive?.paths || []).length; i += 2) {
        const id = view.offensive.paths[i], path = view.offensive.paths[i + 1]
        if (observation.units.some(u => u.id === id && u.faction === side) && Array.isArray(path)) ownMovementRecords.push({ id, moved: path.length > 3 })
    }
    observation.currentDecision.ownMovementRecordUnitIds = ownMovementRecords.map(r => r.id)
    observation.currentDecision.movedUnitIds = ownMovementRecords.filter(r => r.moved).map(r => r.id)
    observation.currentDecision.moveMode = /move|movement/.test(observation.state || "") && Number.isSafeInteger(view.move_type) ? view.move_type : null
    return { view, observation }
}
// Facts for the model's own plans; never select a target, formation or action.
// Queries run on copies and use only the current own card plus public units.
function taskFacts(rules, state, o, memory) {
    const side = ROLES.indexOf(o.role), own = new Map(o.units.filter(u => u.faction === side).map(u => [u.id, u]))
    const ask = (fn, args) => rules.query(clone(state), o.role, { name: "rules_query", fn, args })
    const tasks = (memory?.offensive?.tasks || []).slice(0, 4)
    const targets = [...new Set([...(o.scenario?.nations || []).flatMap(n => n.remainingKeys || []), ...tasks.map(t => t.targetHex)])].filter(h => o.hexes.some(x => x.hex === h)).slice(0, 20)
    const defenders = targets.map(hex => {
        const g = ask("queryDefendingGround", [hex, { faction: 1 - side }])
        return { hex, ground: g ? { ...pick(g, ["hex", "faction", "cf", "lfs"]), units: (g.units || []).map(u => pick(u, ["id", "definitionId", "name", "class", "faction", "service", "location", "reduced", "garrison", "oneStep", "cf", "fullCf", "rcf", "lf"])) } : null }
    })
    const d = o.currentDecision, card = d.currentCard
    const usable = card?.faction === side && ["ops", "event"].includes(card.selectedMode) && d.ownHQ && d.attacker === o.role && !["reaction", "pbm"].includes(o.window)
    const ctx = usable ? { faction: side, cardId: card.id, cardMode: card.selectedMode, hqId: d.ownHQ } : null
    const route = (ids, hex, mode) => {
        if (!ctx) return { checked: false, reason: "no-current-own-card-hq-context" }
        if (ids.some(id => own.get(id)?.location === hex)) return { checked: false, reason: "group-has-unit-already-at-target" }
        const r = ask("queryGroupMovementDestinations", [ids, { ...ctx, move_type: mode }])
        return r ? { checked: r.reason !== "no-playable-card", pathToTarget: r.paths?.[hex] || null, ...(mode === 8 ? { aspCost: r.aspCost ?? null } : {}), reason: r.paths?.[hex] ? null : r.reason || "no-target-path-under-current-conditions" } : { checked: false, reason: "query-unavailable" }
    }
    const planned = tasks.map(t => {
        const ids = [...new Set([...(t.ground || []), ...(t.escort || []), ...(t.support || [])])]
        const invalidIds = ids.filter(id => !own.has(id)), ground = (t.ground || []).filter(id => own.get(id)?.class === "ground")
        const origins = [...new Set(ground.map(id => own.get(id).location))]
        const groups = origins.map(origin => {
            const g = ground.filter(id => own.get(id).location === origin), escorts = (t.escort || []).filter(id => own.get(id)?.class === "naval" && own.get(id).location === origin)
            return { origin, ground: g, colocatedEscorts: escorts, otherOriginEscortIds: (t.escort || []).filter(id => own.has(id) && own.get(id).location !== origin), groundRoute: route(g, t.targetHex, 4), amphibiousRoute: route([...g, ...escorts], t.targetHex, 8) }
        })
        const air = (t.support || []).filter(id => own.get(id)?.class === "air").map(id => {
            const r = ctx ? ask("queryCombatParticipation", [id, t.targetHex, {}]) : null
            return { id, range: r ? { withinRange: !!r.legal, ...pick(r, ["moveMode", "usesExtendedRange", "effectiveAttack"]), eligibilityNotChecked: "activation, commitment and parenthetical extended-range restrictions" } : null }
        })
        const reaction = ctx ? ask("queryReactionCandidates", [{ reactionFaction: 1 - side, targetHex: t.targetHex, targetOnly: true, cardContext: ctx }]) : null
        const reacting = new Set([...(reaction?.ground || []), ...(reaction?.air || []), ...(reaction?.naval || []), ...(reaction?.carrier || [])])
        const groundCF = ground.reduce((n, id) => n + (own.get(id).reduced ? own.get(id).rcf : own.get(id).cf), 0)
        return { targetHex: t.targetHex, invalidIds, groups, airRange: air,
            unassignedEscortIds: (t.escort || []).filter(id => own.has(id) && !origins.includes(own.get(id).location)),
            groundArithmetic: { assumption: "all listed own ground can legally fight; no reaction or support included; not feasibility or capture probability", plannedCF: groundCF, hitsByMultiplier: [0.5, 1, 1.5, 2].map(m => [m, Math.ceil(groundCF * m)]), defenderLFs: defenders.find(d => d.hex === t.targetHex)?.ground?.lfs || [] },
            currentCounterCF: ids.filter(id => own.has(id)).map(id => ({ id, class: own.get(id).class, cf: own.get(id).currentCF, baseASP: own.get(id).currentBaseASP, parenthetical: own.get(id).parenthetical, atTarget: own.get(id).location === t.targetHex, activated: o.activeUnits.includes(id), moved: d.movedUnitIds.includes(id) })),
            unqueriedNavalSupportIds: (t.support || []).filter(id => own.get(id)?.class === "naval"),
            publicReaction: reaction ? { groundOverland: reaction.groundOverland || [], hqOptions: (reaction.hqOptions || []).map(h => ({ hq: h.hq, budget: h.budget, unitIds: h.units.filter(id => reacting.has(id)) })) } : null,
            publicReactionBaseline: ctx ? { nonAmphibious: ask("queryPublicReactionChance", [t.targetHex, { ...ctx, amphibious: false }]), amphibious: ask("queryPublicReactionChance", [t.targetHex, { ...ctx, amphibious: true }]), basis: "two conditional movement assumptions; actual movement is not inferred from the plan" } : null }
    })
    let landCaptureCoverage = null
    if (ctx && /activate_units|choose_hq/.test(o.state)) {
        const preview = o.cardPreviews.find(p => p.cardId === ctx.cardId && p.cardMode === ctx.cardMode && p.hqId === ctx.hqId && p.eligible)
        landCaptureCoverage = { checked: !!preview, reason: preview ? null : "exact-activation-preview-unavailable", units: [] }
        for (const id of preview?.units || []) if (own.get(id)?.class === "ground") {
            const r = ask("queryGroupMovementDestinations", [[id], { ...ctx, move_type: 4 }])
            const reachableKeys = targets.filter(hex => r?.paths?.[hex])
            if (reachableKeys.length) landCaptureCoverage.units.push({ id, reachableKeys })
        }
    }
    let conditionalLandReachability = null
    if (state.active === o.role && ["offensive_segment", "offensive_segment_card_action", "choose_hq"].includes(o.state) && !["reaction", "pbm"].includes(o.window)) {
        const enemyHexes = [...new Set(o.units.filter(u => u.faction === 1 - side && o.hexes.some(h => h.hex === u.location)).map(u => u.location))]
        const rows = [], maxQueries = 128
        let queries = 0, partial = o.cardPreviewsLimited || o.cardPreviews.length > 96
        for (const p of o.cardPreviews.slice(0, 96)) {
            const row = { cardId: p.cardId, mode: p.cardMode, hqId: p.hqId, checked: false, coverage: "unknown", reason: null, units: [] }
            const ownCard = o.ownCards.some(c => c.id === p.cardId && c.faction === side) || card?.id === p.cardId && card.faction === side
            if (!p.eligible || !["ops", "event"].includes(p.cardMode) || !ownCard || own.get(p.hqId)?.class !== "hq") row.reason = "exact-own-activation-preview-unavailable"
            else {
                row.checked = true; row.coverage = "complete"
                for (const id of p.units || []) if (own.get(id)?.class === "ground" && o.hexes.some(h => h.hex === own.get(id).location)) {
                    if (queries >= maxQueries) { row.coverage = "partial"; row.reason = "query-limit"; partial = true; break }
                    ++queries
                    const r = ask("queryGroupMovementDestinations", [[id], { faction: side, cardId: p.cardId, cardMode: p.cardMode, hqId: p.hqId, move_type: 4 }])
                    if (!r || r.reason === "no-playable-card") { row.coverage = "partial"; row.reason = "query-unavailable"; partial = true; continue }
                    const reachableTargetHexes = targets.filter(hex => r.paths?.[hex])
                    const reachableEnemyOccupiedHexes = enemyHexes.filter(hex => r.paths?.[hex])
                    if (reachableTargetHexes.length || reachableEnemyOccupiedHexes.length) row.units.push({ id, reachableTargetHexes, reachableEnemyOccupiedHexes })
                }
            }
            rows.push(row)
        }
        conditionalLandReachability = { rows, checkedTargetHexes: targets, checkedEnemyOccupiedHexes: enemyHexes, queries, maxQueries, coverage: partial ? "partial" : "complete",
            basis: "single own eligible ground unit, exact own card/mode/HQ, land mode 4; endpoints only, no ranking; empty complete row excludes immediate land endpoints only, not staging or amphibious value" }
    }
    const plan = memory?.offensive
    const planTargets = tasks.map(t => ({ targetHex: t.targetHex,
        hasDefendingGround: !!defenders.find(x => x.hex === t.targetHex)?.ground?.lfs?.length,
        hasEnemyHQ: o.units.some(u => u.location === t.targetHex && u.faction === 1 - side && u.class === "hq") }))
    const defendedTargets = [...new Set(planTargets.filter(t => t.hasDefendingGround || t.hasEnemyHQ).map(t => t.targetHex))]
    const planConsistency = !plan ? null : { contextStatus: card && (plan.cardId != null && plan.cardId !== card.id || plan.mode != null && card.selectedMode != null && plan.mode !== card.selectedMode) ? "stale"
        : ctx && plan.cardId === ctx.cardId && plan.mode === ctx.cardMode && plan.hqId === ctx.hqId ? "active" : "proposed",
        cardId: plan.cardId ?? null, mode: plan.mode ?? null, hqId: plan.hqId ?? null,
        playerDeclarationLimit: plan.mode === "ops" ? 1 : null, targets: planTargets,
        ifAllAttemptedThisOffensive: { multipleDefendedTargets: plan.mode === "ops" && defendedTargets.length > 1, defendedTargets },
        basis: "PDF17 section7.24: OC player may actively declare one battle hex; special reactions may add battles. Conditional conflict only if all these offensive tasks attack this offensive; alternatives/future tasks are not inferred from prose. Event limits unknown." }
    return { binding: { revision: d.revision, cardId: card?.id || null, mode: card?.selectedMode || null, hqId: d.ownHQ || null }, defenders, planned, landCaptureCoverage, conditionalLandReachability, planConsistency,
        limits: "Public facts, not a strategy or victory prediction. Routes are current-card projections, not execution authorization; activation, already moved, shared ASP and whole-plan budget still require current candidates. Air range is not a commitment; original-position naval support is unqueried. Reaction alternatives share one HQ budget; baseline excludes unknown enemy-card intervention. Single-unit land coverage does not check amphibious groups." }
}
function movementLabels(mode) {
    // Decode the public path bitmask defined in js/common/constants.js.
    return [[1,"战略移动"],[2,"海上移动"],[4,"陆路移动"],[8,"两栖突击"],[16,"航空战略移动"],[32,"航空移动"],[64,"驳船"],[128,"战后移动"],[256,"反应移动"],[512,"延长航程"],[2048,"避开ZOI"],[4096,"仅建制运输"],[8192,"脱离"],[16384,"手动移动"],[32768,"进入ZOI"]].filter(([bit]) => mode & bit).map(([,label]) => label)
}
function observe(rules, state, role, revision, { directOnly = false, memory = null } = {}) {
    const { view, observation } = visible(rules, state, role)
    observation.currentDecision.revision = revision
    if (ROLES.includes(role) && observation.scenario?.victoryMode === "campaign") observation.taskFacts = taskFacts(rules, state, observation, memory)
    const observationHash = hash(observation)
    const candidates = []
    if (role !== activeRole(state)) return { observation, observationHash, candidates }
    const units = new Map(observation.units.map(u => [u.id, u]))
    const cards = new Map(observation.ownCards.map(c => [c.id, c]))
    const hexes = new Map(observation.hexes.map(h => [h.hex, h]))
    const unselect = new Set(view.unselect || [])
    const add = (action, argument, label, assisted = false, effect = null) => {
        // Short exact symbols are reliably copied by small/text models. The
        // decision nonce and revision bind these indices to this candidate table.
        candidates.push({ id: `r${revision}-a${candidates.length}`,
            action, ...(argument !== undefined ? { argument: clone(argument) } : {}), label, assisted, effect })
    }
    // General undo/redo can loop; a stranded movement escape is handled below.
    // Raw move needs an engine-generated path.
    for (const [action, options] of Object.entries(view.actions || {})) {
        if (["undo", "redo", "move"].includes(action) || directOnly && action === "advance" || !options) continue
        if (Array.isArray(options)) for (const arg of options) {
            const name = /card|event|ops|discard/.test(action) ? cards.get(arg)?.name
                : /unit|eliminate|unselect/.test(action) ? units.get(arg)?.name : hexes.get(arg)?.name
            const verb = action === "unit" && unselect.has(arg)
                ? observation.state === "activate_units" ? "取消激活" : "取消选择"
                : action === "unit" && observation.state === "activate_units" ? "激活单位" : action
            const def = units.get(arg) || observation.ownUnitDefinitions.find(u => u.id === arg)
            const kind = action === "unit" ? observation.state === "choose_hq" ? "selectHQ"
                : unselect.has(arg) ? observation.state === "activate_units" ? "deactivate" : "deselect"
                : observation.state === "activate_units" ? "activate" : "selectUnit" : action
            add(action, arg, `${verb} ${arg}${name || def?.name ? " — " + (name || def.name) : ""}`, false,
                { kind, ...(action === "unit" ? { unitId: arg, unit: def ? pick(def, UNIT_KEYS) : null } : {}),
                    ...(action === "action_hex" ? { targetHex: arg, mapId: hexes.get(arg)?.id || null, state: observation.state } : {}) })
        } else if (options === 1 || options === true) {
            const label = action === "advance" ? "advance — 程序选择编队和合法落点（协助，不代表模型计划会执行）"
                : action === "advanced_move" ? "advanced_move — 展开全部移动方式；默认落点缺目标时，先展开再查两栖/陆进等方式"
                : action === "amphibious" ? "amphibious — 选择两栖方式并重新显示合法落点"
                : action === "ground_move" ? "ground_move — 选择陆进方式并重新显示合法落点"
                : action === "done" && observation.state === "activate_units" ? "done — 结束激活，保留当前单位；接下来才移动"
                : action === "done" && observation.state === "move_offensive_units" ? "done — 结束移动；未移动单位留在原地，不是结束激活"
                : action
            add(action, undefined, label, action === "advance", { kind: action === "done" ? "finishCurrentWindow" : action,
                state: observation.state, selectedUnitIds: observation.selectedMovementUnits, activeUnitIds: observation.activeUnits })
        }
    }
    if (view.actions?.move) {
        for (const m of rules.query(clone(state), role, "llm_legal_moves") || []) {
            const modeLabels = movementLabels(m.path[0])
            add("move", m.path, `move [${modeLabels.join("/")}] → ${hexes.get(m.hex)?.name || m.hex} (${hexes.get(m.hex)?.id || m.hex})`, false, { kind: "move", targetHex: m.hex, unitIds: observation.selectedMovementUnits, modeLabels, pathMovementValue: m.path[1] })
        }
    }
    // A selected movement mode may have no reachable destination. The native
    // client can undo that selection; retain this sole legal escape, not general undo.
    if (!candidates.length && observation.state === "move_offensive_units"
        && view.active_stack?.length && view.move_type && view.actions?.move && view.actions?.undo)
        add("undo", undefined, "撤销当前移动选择：所选方式无合法落点")
    return { observation, observationHash, candidates }
}
module.exports = { observe, visible, activeRole, hash, clone, ROLES, taskFacts }
