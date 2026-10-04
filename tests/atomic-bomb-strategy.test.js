"use strict"

const assert = require("assert")
// AI-WIN-01. Rule 16.2 (Chinese V3.2 p41, project ruling 2026-09-11).
// Synthetic rule boundaries are not played games or evidence of AI wins.
const { loadCampaignRules, runCases } = require("./campaign-rules.test.js")
const { rules, api, constants: C } = loadCampaignRules()

function setup({ turn = 12, resources = 1, campaign = 9, base = 3814 } = {}) {
    const state = rules.setup(20261004, C.scenario1942, {})
    api.clearBoard(state)
    state.turn = turn
    state.events[C.bombingCampaign] = campaign
    api.initialControl(state, api.resourceCoordinates, C.AP)
    api.initialControl(state, [3302, 3303].slice(0, resources), C.JP)
    state.location[C.b29[0]] = base === "ChinaBox" ? C.chinaBox : api.hex(base)
    return state
}

const cases = [
    ["T12 + uninterrupted T9 campaign + one resource + B29 at eight hexes wins", () => {
        const state = setup()
        assert.equal(api.distance(3814, 3706), 8, "Guam is the inclusive range boundary")
        const status = api.atomic(state)
        assert.equal(status.ruleVersion, "official-16.2")
        assert.equal(status.resourceLimit, 1)
        assert.equal(status.jpResources, 1)
        assert.equal(status.bombingRequiredFromTurn, 9)
        assert.equal(status.met, true)
        assert.equal(state.result, undefined, "status inspection itself does not finish a game")
    }],
    ["T11 cannot award the T12 atomic victory", () => {
        const status = api.atomic(setup({ turn: 11 }))
        assert.equal(status.resourcesSatisfied, true)
        assert.equal(status.noStrategicBombingFailure, true)
        assert.equal(status.met, false)
    }],
    ["zero resources qualifies; two resources does not", () => {
        assert.equal(api.atomic(setup({ resources: 0 })).met, true)
        const status = api.atomic(setup({ resources: 2 }))
        assert.equal(status.jpResources, 2)
        assert.equal(status.resourcesSatisfied, false)
        assert.equal(status.met, false)
    }],
    ["a missed campaign or a restart at T10 cannot supply four consecutive turns", () => {
        for (const campaign of [0, 10, 11, 12]) {
            const status = api.atomic(setup({ campaign }))
            assert.equal(status.noStrategicBombingFailure, false, `campaign start ${campaign}`)
            assert.equal(status.met, false)
        }
    }],
    ["a B29 beyond eight hexes cannot satisfy the final geographic condition", () => {
        const state = setup({ base: 3416 })
        assert(api.distance(3416, 3706) > 8, "Palau is outside Tokyo bombing range")
        assert.equal(api.atomic(state).b29InRangeOfTokyo, false)
        assert.equal(api.atomic(state).met, false)
        state.location[C.b29[1]] = api.hex(3814)
        assert.equal(api.atomic(state).met, true, "either B29 in range is sufficient")
    }],
    ["China Box bombing does not replace the final on-map B29 condition", () => {
        const status = api.atomic(setup({ base: "ChinaBox" }))
        assert.equal(status.noStrategicBombingFailure, true)
        assert.equal(status.b29InRangeOfTokyo, false)
        assert.equal(status.met, false)
    }],
    ["the final predicate has no separate Soviet/Tojo gate", () => {
        const state = setup()
        state.events[C.tojo] = 0
        assert.equal(api.atomic(state).met, true)
        state.events[C.tojo] = 10
        assert.equal(api.atomic(state).met, true)
        assert.equal(api.atomic(state).resourceLimit, 1, "Tojo never changes the resource limit")
    }],
    ["Manchurian resources retain the indirect Soviet-event dependency", () => {
        const state = setup({ resources: 2 })
        assert.equal(api.groundDenied(state, 3302), true)
        assert.equal(api.groundDenied(state, 3303), true)
        assert.equal(api.atomic(state).met, false)
        state.events[C.tojo] = 0
        assert.equal(api.canSoviet(state), false)
        state.events[C.tojo] = 9
        assert.equal(api.canSoviet(state), true)
        api.soviet(state)
        assert.equal(api.controlled(state, 3302, C.AP), true)
        assert.equal(api.controlled(state, 3303, C.AP), true)
        assert.equal(api.atomic(state).jpResources, 0)
        assert.equal(api.atomic(state).met, true)
    }],
]

if (require.main === module) runCases("Atomic bomb rule 16.2", cases)
module.exports = { cases }
