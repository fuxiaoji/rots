"use strict"
const test = require("node:test"), assert = require("node:assert/strict")
const { createOpeningMetrics, NATIONS } = require("./japan-opening-metrics")
const spec = { philippines: { index: 0, keys: [1] }, malaya: { index: 1, keys: [2] }, dei: { index: 2, keys: [3] } }
const jp = 1 << 23
const state = (turn, surrender = [0,0,0], held = []) => ({ turn, surrender, supply_cache: [0, ...[1,2,3].map(h => held.includes(h) ? jp : 0)], active: "Japan" })
test("public nation key conversion follows rules 13.22/13.32/13.42", () => {
    assert.deepEqual(NATIONS.philippines.keys, [535,566]); assert.deepEqual(NATIONS.malaya.keys, [304,305])
    assert.deepEqual(NATIONS.dei.keys, [309,245,277,307,421,480,452,368])
})
test("keys held temporarily are not a surrender", () => {
    const initial = state(2), m = createOpeningMetrics(initial, spec)
    m.observe(state(4, [0,0,0], [1,2,3]), 1)
    const next = state(5); m.observe(next, 2)
    assert.equal(m.result(next).bothByThirdRound, false)
    assert.equal(m.result(next).firstKeysHeld.philippines.turn, 4)
})
test("first event survives liberation and recapture but lost deadline fails", () => {
    const m = createOpeningMetrics(state(2), spec)
    m.observe(state(3, [3,3,0], [1,2]), 1)
    m.observe(state(4, [0,3,0], [2]), 2)
    m.observe(state(5, [0,3,0], [2]), 3)
    m.observe(state(6, [6,3,6], [1,2,3]), 4)
    const next = state(7, [6,3,6], [1,2,3]); m.observe(next, 5)
    const r = m.result(next)
    assert.equal(r.firstSurrender.philippines.turn, 3); assert.equal(r.events.length, 4)
    assert.equal(r.bothByThirdRound, false); assert.equal(r.deiByFifthRound, true)
})
test("T4 and T6 inclusive boundaries and mutable action state", () => {
    const s = state(2), m = createOpeningMetrics(s, spec)
    s.surrender = [4,4,0]; s.turn = 4; s.supply_cache = state(4, [], [1,2]).supply_cache; m.observe(s,1)
    s.turn = 5; m.observe(s,2)
    s.turn = 6; s.surrender[2] = 6; s.supply_cache[3] = jp; m.observe(s,3)
    s.turn = 7; m.observe(s,4)
    assert.equal(m.result(s).bothByThirdRound,true); assert.equal(m.result(s).deiByFifthRound,true)
})
test("initial 1943 surrenders are not new conquests", () => {
    const s = state(5, [3,3,3], [1,2,3]), m = createOpeningMetrics(s,spec)
    s.turn = 10; s.active = "None"; m.observe(s)
    assert.equal(m.result(s).bothByThirdRound,false); assert.deepEqual(m.result(s).firstSurrender,{})
})
