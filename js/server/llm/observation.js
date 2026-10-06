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
        ...(u.faction === side ? { supplied: supplies.get(u.id) ?? null } : {}) }))
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
    return { view, observation }
}
function observe(rules, state, role, revision) {
    const { view, observation } = visible(rules, state, role)
    observation.currentDecision.revision = revision
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
        if (["undo", "redo", "move"].includes(action) || !options) continue
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
                { kind, ...(action === "unit" ? { unitId: arg, unit: def ? pick(def, UNIT_KEYS) : null } : {}) })
        } else if (options === 1 || options === true) {
            const label = action === "advance" ? "advance — 程序选择编队和合法落点（协助，不代表模型计划会执行）"
                : action === "done" && observation.state === "activate_units" ? "done — 结束激活，保留当前单位；接下来才移动"
                : action === "done" && observation.state === "move_offensive_units" ? "done — 结束移动；未移动单位留在原地，不是结束激活"
                : action
            add(action, undefined, label, action === "advance", { kind: action === "done" ? "finishCurrentWindow" : action,
                state: observation.state, selectedUnitIds: observation.selectedMovementUnits, activeUnitIds: observation.activeUnits })
        }
    }
    if (view.actions?.move) {
        for (const m of rules.query(clone(state), role, "llm_legal_moves") || [])
            add("move", m.path, `move → ${hexes.get(m.hex)?.name || m.hex} (${hexes.get(m.hex)?.id || m.hex})`, false, { kind: "move", targetHex: m.hex, unitIds: observation.selectedMovementUnits })
    }
    // A selected movement mode may have no reachable destination. The native
    // client can undo that selection; retain this sole legal escape, not general undo.
    if (!candidates.length && observation.state === "move_offensive_units"
        && view.active_stack?.length && view.move_type && view.actions?.move && view.actions?.undo)
        add("undo", undefined, "撤销当前移动选择：所选方式无合法落点")
    return { observation, observationHash, candidates }
}
module.exports = { observe, visible, activeRole, hash, clone, ROLES }
