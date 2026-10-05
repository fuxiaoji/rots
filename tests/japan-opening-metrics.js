"use strict"

// Observer only: no policy access and no game-state mutation. National keys
// come from rules 13.22, 13.32, 13.42; hex numbers use the engine's public map.
const toInternalHex = h => (Math.floor(h / 100) - 10) * 29 + h % 100
const NATIONS = Object.fromEntries(Object.entries({
    philippines: { index: 0, keys: [2813, 2915] },
    malaya: { index: 1, keys: [2014, 2015] },
    dei: { index: 2, keys: [2019, 1813, 1916, 2017, 2415, 2616, 2517, 2220] },
}).map(([name, n]) => [name, { ...n, keys: n.keys.map(toInternalHex) }]))
const JP_CONTROLLED = 1 << 23
function createOpeningMetrics(initial, spec = NATIONS) {
    initial = { turn: initial.turn, surrender: [...(initial.surrender || [])], supply_cache: [...(initial.supply_cache || [])] }
    const startTurn = Number(initial.turn), deadlineTurns = { early: startTurn + 2, dei: startTurn + 4 }
    const firstSurrender = {}, firstKeysHeld = {}, events = [], checkpoints = {}
    let previous = initial, actionIndex = 0
    const held = (state, nation) => nation.keys.every(h => !!((state.supply_cache || [])[h] & JP_CONTROLLED))
    const capture = state => Object.fromEntries(Object.entries(spec).map(([name, n]) => [name,
        { surrendered: !!state.surrender?.[n.index], keysHeld: held(state, n), missingKeys: n.keys.filter(h => !((state.supply_cache || [])[h] & JP_CONTROLLED)) }]))
    const initialSurrender = Object.fromEntries(Object.entries(spec).map(([name, n]) => [name, !!initial.surrender?.[n.index]]))
    function observe(state, ordinal = ++actionIndex) {
        for (const [name, n] of Object.entries(spec)) {
            if (!firstKeysHeld[name] && held(state, n) && !held(initial, n)) firstKeysHeld[name] = { turn: Number(state.turn), action: ordinal }
            if (!previous.surrender?.[n.index] && state.surrender?.[n.index]) {
                const event = { nation: name, turn: Number(state.surrender[n.index]), action: ordinal }
                events.push(event); firstSurrender[name] ??= event
            }
        }
        // Advancing the turn executes the national-status checks before any
        // new offensive. Take the resulting controls, including that segment.
        if (Number(state.turn) > Number(previous.turn)) checkpoints[Number(previous.turn)] = { action: ordinal, nations: capture(state) }
        if (state.active === "None") checkpoints[Number(state.turn)] = { action: ordinal, nations: capture(state), terminal: true }
        previous = { turn: state.turn, surrender: [...(state.surrender || [])] }
    }
    function result(state) {
        const at = deadline => checkpoints[deadline] || (state.active === "None" && Number(state.turn) < deadline
            ? { nations: capture(state), terminal: true } : null)
        const met = (name, deadline) => !initialSurrender[name] && !!firstSurrender[name]
            && firstSurrender[name].turn <= deadline && !!at(deadline)?.nations[name]?.surrendered
            && !!at(deadline)?.nations[name]?.keysHeld
        return { schemaVersion: 1, startTurn, deadlineTurns, initialSurrender, firstSurrender, firstKeysHeld, events, checkpoints,
            philippinesByThirdRound: met("philippines", deadlineTurns.early), malayaByThirdRound: met("malaya", deadlineTurns.early),
            bothByThirdRound: met("philippines", deadlineTurns.early) && met("malaya", deadlineTurns.early), deiByFifthRound: met("dei", deadlineTurns.dei) }
    }
    return { observe, result }
}
module.exports = { NATIONS, createOpeningMetrics }
