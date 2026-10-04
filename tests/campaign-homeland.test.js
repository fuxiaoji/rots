"use strict"

// Exercise the source planner and real action/query engine together. Compile
// imports in memory so this boundary does not depend on a generated bundle.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

function expand(relative) {
    return fs.readFileSync(path.join(__dirname, "../js", relative), "utf8")
        .replace(/^\/\*\* import ([^\r\n]+)\*\/$/gm, (_, imported) => expand(imported.trim()))
}

const context = vm.createContext({ exports: {}, console })
vm.runInContext(expand("rules.js") + `
    exports.homelandTest = {
        prepare(state) {
            G = state; R = AP; G.active = AP;
            G.location.fill(NOT_USED); G.oos = []; G.reduced = [];
            // ASP have already been spent this turn; the final adjacent ground
            // move needs none, while the turn's existing PoW requirement stays.
            G.inter_service = [0, 0]; G.asp[AP] = [4, 4];
            G.hand[AP] = [32]; G.hand[JP] = []; G.capture = []; G.pow = 4;
            G.turn = 12; G.political_will = 6; G.undo = [];
            reset_offensive();
            G.L = L = { P: "offensive_segment", L: { P: "homeland_test_return" } };
            G.location[79] = hex_to_int(3506);
            G.location[193] = hex_to_int(3506);
            check_supply();
            for (const key of nations.JAPAN.keys) G.supply_cache[hex_to_int(key)] &= ~JP_CONTROLLED;
            G.supply_cache[WEST_HONSHU] |= JP_CONTROLLED;
            _save();
        },
        plan(state, view) {
            G = state; L = G.L; R = "Allies"; _load();
            em_set_config(em_bot_config("erasmus-campaign", "Allies"));
            try { return ec_plan(view, { role: "Allies" }); }
            finally { _save(); }
        },
        nationalStatus(state) {
            G = state; R = AP; G.active = AP;
            G.L = L = { P: "homeland_test", pw: 0, L: { P: "homeland_test_return" } };
            P.national_status_segment(); _save();
        },
    };
`, context, { filename: "campaign-homeland-source.js" })
const rules = context.exports
const target = 760 // 3606, West Honshu: controllable but unnamed, with no PoW value.

for (const scenario of ["1942-1945 (The Shortened Campaign)", "1943-1945 (The Even Shorter Campaign)"]) {
    let state = rules.setup(20261004, scenario, { headless_moves: true })
    rules.homelandTest.prepare(state)
    const view = rules.view(state, "Allies")
    assert.equal(view.ai.victory.homelandKeys.length, 7)
    const query = rules.query(state, "Allies", { name: "rules_query", fn: "queryGroupMovementDestinations",
        args: [[193], { faction: 1, cardId: 32, cardMode: "ops", hqId: 79, move_type: 4 }] })
    assert(query.reachableHexes.includes(target), "the actual engine permits the final adjacent ground move")
    const before = JSON.stringify(state)
    const plan = rules.homelandTest.plan(state, view)
    assert.equal(JSON.stringify(state), before, "planning does not change the scenario")
    assert.deepEqual(Array.from(plan.victory.routes.homeland.remainingKeys), [target])
    const task = plan.tasks.find(task => task.kind === "CONQUEST" && task.hex === target)
    assert(task, "the planner assigns the seventh Honshu hex despite its unnamed map record")
    assert.equal(task.objective, "HOMELAND")
    assert.deepEqual(Array.from(task.movementUnitIds), [193])
    assert.deepEqual(Array.from(task.movementModes), ["GROUND"])
    assert(!plan.pow.selectedCaptureTargets.includes(target), "unnamed Honshu is not forecast as a PoW gain")

    const withAsp = JSON.parse(JSON.stringify(state))
    withAsp.asp[1][1] = 0
    const alternatives = rules.query(withAsp, "Allies", { name: "rules_query", fn: "queryGroupMovementDestinations",
        args: [[193], { faction: 1, cardId: 32, cardMode: "ops", hqId: 79, move_type: 8 }] })
    assert(alternatives.reachableHexes.includes(672), "Seoul is a real competing resource/PoW landing when ASP remain")
    const competingPlan = rules.homelandTest.plan(withAsp, rules.view(withAsp, "Allies"))
    assert.equal(competingPlan.focus, target, "the final Honshu victory outranks another PoW/resource gain")

    function act(action, argument) {
        const current = rules.view(state, "Allies")
        assert(current.actions[action], "action must be offered: " + action + " / " + current.prompt)
        if (Array.isArray(current.actions[action])) assert(current.actions[action].includes(argument),
            "argument must be offered: " + action + " " + argument + " / " + current.prompt + " / " + JSON.stringify(current.actions[action]))
        state = rules.action(state, "Allies", action, argument)
    }
    act("card", plan.cardId)
    act("ops")
    // The engine automatically selects the only available HQ.
    if (/choose hq/i.test(rules.view(state, "Allies").prompt)) act("unit", plan.preferredHq)
    act("unit", 193)
    act("done")
    const targetPlan = { ...plan.targets.find(item => item.hex === target), focus: target,
        chain: [target], targetMeta: plan.targets }
    for (let step = 0; step < 8 && state.location[193] !== target; step++) {
        const current = rules.view(state, "Allies")
        if (current.actions.advance) act("advance", targetPlan)
        else if (current.actions.stop) act("stop")
        else assert.fail("unexpected movement window: " + current.prompt)
    }
    assert.equal(state.location[193], target, "the assigned unit really enters the seventh hex")
    if (rules.view(state, "Allies").actions.stop) act("stop")
    const controlled = rules.query(state, "Allies", { name: "rules_query", fn: "querySpaceControlled", args: [target, 1] })
    assert.equal(controlled, true, "the ground movement captures the previously Japanese final key")
    assert.equal(state.capture.includes(target), false, "execution also gives no PoW credit for the unnamed hex")
    rules.homelandTest.nationalStatus(state)
    assert.equal(state.result, "Allies", "actual national status awards the seven-hex surrender")
}

console.log("Campaign homeland: both campaigns plan and execute the seventh Honshu key without PoW credit")
