"use strict"

// Load actual current sources without rewriting shared generated bundles.
const assert = require("node:assert/strict")
const { loadCampaignRules } = require("./campaign-rules.test")
const { rules, api, constants: C } = loadCampaignRules()
const clone = state => JSON.parse(JSON.stringify(state))
function ask(state, fn = "queryBlockadeStatus", role = "Allies") {
    const before = JSON.stringify(state)
    const value = rules.query(state, role, { name: "rules_query", fn })
    assert.equal(JSON.stringify(state), before, "resource queries restore the complete state, control, supply caches and RNG")
    return JSON.parse(JSON.stringify(value))
}
function disconnected() {
    const state = rules.setup(20261004, C.scenario1942, {})
    api.clearBoard(state)
    api.initialControl(state, api.resourceCoordinates, C.AP)
    api.initialControl(state, api.honshuCoordinates, C.JP)
    state.turn = 10
    state.active = "Allies"
    state.L = { P: "offensive_segment", I: 0, L: { P: "offensive_phase", I: 7, L: null } }
    return state
}

for (const scenario of [C.scenario1942, C.scenario1943]) {
    const state = rules.setup(20261004, scenario, {})
    const status = ask(state)
    const defaultTrace = ask(state, "queryJapanResourceTrace")
    assert.equal(status.connected, defaultTrace, "collector and unchanged early-return rule agree at campaign opening")
    assert.equal(status.connected, true)
    assert.equal(status.allDisconnected, false)
    assert(status.connectedResources.length > 1, "collector finishes the real graph instead of reporting only its first hit")
    assert.equal(new Set(status.connectedResources).size, status.connectedResources.length)
    assert.deepEqual(status.connectedResources, status.resources.filter(r => r.connected).map(r => r.hex).sort((a, b) => a - b))
    assert(status.resources.every(r => !r.connected || r.japanControlled))
    assert.equal(status.startedTurn, 0)
    assert.equal(status.remainingPhases, 3)
    assert.equal(status.earliestWinTurn, null)
    assert.equal(status.endpointOnly, true)
    assert.equal(Object.hasOwn(status, "paths"), false, "endpoint data makes no unverified path claims")

    const secretChanged = clone(state)
    secretChanged.hand[0] = []
    secretChanged.hand[1] = []
    assert.deepEqual(ask(secretChanged), status, "neither side's private card identities influence resource routes")
    assert.deepEqual(ask(state, "queryBlockadeStatus", "Japan"), status, "both sides see the same public trace")
}

const cut = disconnected()
const initial = ask(cut)
assert.equal(initial.connected, ask(cut, "queryJapanResourceTrace"), "default and collector rule agree when all resource routes are gone")
assert.equal(initial.allDisconnected, true)
assert.deepEqual(initial.connectedResources, [])
assert.equal(initial.resources.filter(r => r.japanControlled).length, 0)
assert.equal(initial.remainingPhases, 3)
assert.equal(initial.earliestWinTurn, 12)

// A resource can remain Japanese-controlled while its actual land/sea access
// is cut. Remove all friendly overseas port transitions and occupy Pusan;
// Harbin remains Japanese-controlled but the real trace cannot reach it.
const isolated = disconnected()
api.initialControl(isolated, [3302], C.JP)
const outsideJapanPorts = []
for (let hex = 1; hex < C.lastBoardHex; hex++) {
    const m = api.map(isolated, api.coordinate(hex))
    if (m.port && m.region !== "Japan") outsideJapanPorts.push(m.coordinate)
}
api.initialControl(isolated, outsideJapanPorts, C.AP)
const bridgeGround = rules.pieces.findIndex(p => p.faction === C.AP && p.class === "ground" && p.asp === 1)
assert(bridgeGround > 0)
isolated.location[bridgeGround] = api.hex(3306)
isolated.active = "Allies"
const isolatedStatus = ask(isolated)
assert.equal(isolatedStatus.connected, ask(isolated, "queryJapanResourceTrace"))
assert.equal(isolatedStatus.connected, false)
assert.deepEqual(isolatedStatus.disconnectedResources, [api.hex(3302)])
assert(isolatedStatus.resources.find(r => r.hex === api.hex(3302)).japanControlled)
cut.events[C.blockade] = 10
assert.equal(ask(cut).remainingPhases, 2, "a timer newly recorded at T10 means the first status check already happened")
cut.turn = 11
assert.equal(ask(cut).completedPhases, 1)
assert.equal(ask(cut).remainingPhases, 2, "T11 offensive still precedes the second national-status check")
cut.L = { P: "attrition", L: { P: "attrition_phase", L: null } }
assert.equal(ask(cut).remainingPhases, 1, "T11 attrition follows the second national-status check")
cut.turn = 12
cut.L = { P: "offensive_segment", L: { P: "offensive_phase", L: null } }
assert.equal(ask(cut).remainingPhases, 1)
assert.equal(ask(cut).earliestWinTurn, 12)

// Restoring a real Japanese resource connection invalidates the pending clock,
// while the pure query leaves its stored event untouched for the rule to reset.
api.initialControl(cut, [3302], C.JP)
cut.active = "Allies"
cut.L = { P: "offensive_segment", L: { P: "offensive_phase", L: null } }
const restored = ask(cut)
assert.equal(restored.connected, true)
assert.deepEqual(restored.connectedResources, [api.hex(3302)])
assert.equal(restored.startedTurn, 10)
assert.equal(restored.timerWillReset, true)
assert.equal(restored.completedPhases, 0)
assert.equal(restored.remainingPhases, 3)
assert.equal(cut.events[C.blockade], 10, "diagnostics do not reset the rule's timer")

// Compare the collector before every actual national-status call. The ordinary
// rule still starts at T10 and wins at T12 without a diagnostic side effect.
const actual = disconnected()
for (const turn of [10, 11, 12]) {
    actual.turn = turn
    actual.active = "Allies"
    actual.L = { P: "offensive_segment", L: { P: "offensive_phase", L: null } }
    const status = ask(actual)
    assert.equal(status.connected, ask(actual, "queryJapanResourceTrace"))
    api.nationalStatus(actual)
    assert.equal(actual.events[C.blockade], 10)
    assert.equal(actual.result, turn === 12 ? "Allies" : undefined)
}
actual.active = "None"
assert.equal(ask(actual).remainingPhases, 0)
console.log("Campaign blockade: actual endpoint trace, legacy boolean parity, phase clock, privacy, purity and third-check victory passed")
