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
    const observation = { schemaVersion: 1, role, scenario: state.scenario, active: view.active, turn: view.turn,
        window: view.ai?.windowKind || null, state: view.ai?.state || null, prompt: view.prompt,
        politicalWill: view.political_will, pow: view.pow, resources: clone(view.resources || []),
        asp: clone(view.asp || []), passes: clone(view.passes || []),
        handCounts: (view.hand || []).map(h => Array.isArray(h) ? h.length : h),
        ownFutureOffensive: ownFuture > 0 ? ownFuture : null,
        ownCards: ownIds.map(id => pick({ ...(publicData.cards[id] || { id }), ...(cardMeta.get(id) || {}) }, CARD_KEYS)),
        selectedUnits: clone(view.active_stack || []), units: (view.ai?.units || []).map(u => pick(u, UNIT_KEYS)),
        hexes: publicData.hexes,
        battle: { hexes: clone(view.offensive?.battle_hexes || []),
            activatedUnits: clone(view.offensive?.active_units || []),
            attacker: ROLES[view.offensive?.attacker] || null, type: view.offensive?.type ?? null },
        log: (view.log || []).slice(-24).filter(x => typeof x === "string" && !x.startsWith("[ERASMUS]")) }
    return { view, observation }
}
function observe(rules, state, role, revision) {
    const { view, observation } = visible(rules, state, role)
    const observationHash = hash(observation)
    const candidates = []
    if (role !== activeRole(state)) return { observation, observationHash, candidates }
    const units = new Map(observation.units.map(u => [u.id, u]))
    const cards = new Map(observation.ownCards.map(c => [c.id, c]))
    const hexes = new Map(observation.hexes.map(h => [h.hex, h]))
    const add = (action, argument, label, assisted = false) => {
        // Short exact symbols are reliably copied by small/text models. The
        // decision nonce and revision bind these indices to this candidate table.
        candidates.push({ id: `r${revision}-a${candidates.length}`,
            action, ...(argument !== undefined ? { argument: clone(argument) } : {}), label, assisted })
    }
    // Undo/redo create strategic loops. Raw move needs an engine-generated path.
    for (const [action, options] of Object.entries(view.actions || {})) {
        if (["undo", "redo", "move"].includes(action) || !options) continue
        if (Array.isArray(options)) for (const arg of options) {
            const name = /card|event|ops|discard/.test(action) ? cards.get(arg)?.name
                : /unit|eliminate|unselect/.test(action) ? units.get(arg)?.name : hexes.get(arg)?.name
            add(action, arg, `${action} ${arg}${name ? " — " + name : ""}`)
        } else if (options === 1 || options === true) add(action, undefined,
            action === "advance" ? "advance — 程序选择编队和合法落点" : action, action === "advance")
    }
    if (view.actions?.move) {
        for (const m of rules.query(clone(state), role, "llm_legal_moves") || [])
            add("move", m.path, `move → ${hexes.get(m.hex)?.name || m.hex} (${hexes.get(m.hex)?.id || m.hex})`)
    }
    return { observation, observationHash, candidates }
}
module.exports = { observe, visible, activeRole, hash, clone, ROLES }
