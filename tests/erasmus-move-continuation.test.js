"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const source = fs.readFileSync(path.join(__dirname, "../js/server/bots/erasmus.js"), "utf8")
const charts = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/erasmus/charts.json"), "utf8")).charts
const sandbox = {
    EOP_EXACT_REACTION_PREDICATES: [], EOP_EXACT_TASKFORCE_PREDICATES: [], EOP_EXACT_STRATEGIC_PREDICATES: [],
    eop_trace: () => ({}), esm_gate_on: () => false,
}
vm.createContext(sandbox)
vm.runInContext(source + ";this.api={evaluate:evaluateChart,action:action_for_strategy,legal:legal_actions};", sandbox)

// smoke-v4 / seed 20261004: all nine 1942 Allied fallback actions were stop
// at ordinals 290,613,653,847,897,1315,1335,1781,2077. The engine had already
// produced a ground path and exposed only stop, path-taking move, and undo.
for (const [role, chartId, prefix] of [["Allies", "ERASMUS-AP-11", "AP11"], ["Japan", "ERASMUS-JP-05", "JP05"]]) {
    for (const targetReady of [false, true]) test(`${role} commits a ground path through its actual ${targetReady ? "move" : "weakest-stack"} chart node`, () => {
        const view = { turn: 3, prompt: "OC: 2 Ops. Move units (1/2).", actions: { stop: 1, move: 1, undo: 1 },
            ai: { state: "move_offensive_units", predicates: { FORCE_MEETS_BATTLE_SUPPORT_STANDARD: targetReady, TARGET_DAMAGE_LEVEL_MET: true } } }
        const decision = sandbox.api.evaluate(charts.find(c => c.id === chartId), view, { role, seed: 20261004, actionOrdinal: 290 })
        assert.equal(decision.action, "stop")
        assert.equal(decision.argument, undefined)
        assert.equal(decision.publicTrace.fallback, false)
        assert.equal(decision.publicTrace.node, `${prefix}-${targetReady ? "S-MOVE" : "S-WEAKEST"}`)
        assert.equal(decision.publicTrace.nodePath[0], `${prefix}-I`)
        assert.equal(decision.publicTrace.strategy, `${role === "Allies" ? "AP" : "JP"}_${targetReady ? "MOVE_TO_TARGET" : "ATTACK_WEAKEST_STACK"}`)
    })
}

test("stop mapping does not invent an action or hide an unrelated strategy failure", () => {
    const view = { prompt: "OC: 2 Ops. Move units (1/2).", ai: { state: "move_offensive_units" } }
    assert.equal(sandbox.api.action("AP_MOVE_TO_TARGET", ["move"], view), null)
    assert.equal(sandbox.api.action("AP_EVENT", ["stop", "move"], view), null)
    assert.equal(sandbox.api.action("AP_MOVE_TO_TARGET", ["stop", "move"], { ...view, ai: { state: "retreat" } }), null)
    assert.equal(sandbox.api.action("AP_MOVE_TO_TARGET", ["stop", "move", "action_hex"], view), "action_hex")
    const chart = { id: "fixture", kind: "task-force", nodes: [
        { id: "start", type: "start", edges: [{ when: "always", to: "event" }] },
        { id: "event", type: "action", strategy: "AP_EVENT" },
        { id: "failure", type: "fallback", allowed_actions: ["stop"] },
    ] }
    const decision = sandbox.api.evaluate(chart, { ...view, actions: { stop: 1, move: 1 } }, { role: "Allies", seed: 1, actionOrdinal: 1 })
    assert.equal(decision.publicTrace.fallback, true)
    assert.equal(decision.publicTrace.node, "failure")
})
