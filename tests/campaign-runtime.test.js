"use strict"
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const path = require("node:path")
const config = fs.readFileSync(path.join(__dirname, "../js/server/bots/erasmus_config.js"), "utf8")
const ctx = { process: { env: { EOTS_OPT_PARAMS: "emMinPWin=0.8" } }, G: {} }
vm.createContext(ctx)
vm.runInContext(config + ";this.api={resolve:em_bot_config,set:em_set_config,reset:em_reset_config,get:em_cfg,flag:em_flag,load:em_load_state_config}", ctx)
const c = ctx.api.resolve("erasmus-campaign", "Allies")
assert.equal(c.emMinPWin, 0.8, "numeric overrides reach effective config")
assert.equal(c.campaign_planner, 1)
assert.equal(c.erasmus_plus, 1)
assert.equal(ctx.api.resolve("erasmus-v2-opt-v5", "Japan").campaign_planner, 0)
ctx.api.set(c)
ctx.api.reset()
assert.equal(ctx.api.flag("campaign_planner"), 0, "no process-wide last profile")
ctx.G.ai_profile = { Allies: c }
ctx.api.load("Allies")
assert.equal(ctx.api.flag("campaign_planner"), 1)
ctx.api.load("Japan")
assert.equal(ctx.api.flag("campaign_planner"), 0, "role isolation")
ctx.G = {}
ctx.api.load("Allies")
assert.equal(ctx.api.flag("campaign_planner"), 0, "game isolation")

// Exercise current sources without rebuilding the shared generated rules.js.
const Module = require("node:module")
function expandSource(file) {
    return fs.readFileSync(path.join(__dirname, "../js", file), "utf8")
        .replace(/^\/\*\* import ([^\r\n]+)\*\/$/gm, (_, imported) => expandSource(imported.trim()))
}
const filename = path.join(__dirname, "../rules.js")
const runtime = new Module(filename, module)
runtime.filename = filename
runtime.paths = Module._nodeModulePaths(path.dirname(filename))
runtime._compile(expandSource("rules.js") + `
exports.__drawPendingForTest = function(state, role) {
    G = state; L = G.L; R = role; _load();
    into_turn_draw(R); resolve_into_turn_draw(R); _save();
};
exports.__withActionFailureForTest = function(phase, action, run) {
    const original = P[phase][action];
    P[phase][action] = function(argument) {
        original.call(this, argument);
        G.seed += 1; G.location[1] = -777; G.log.push("injected-handler-failure");
        throw Error("injected handler failure after real action");
    };
    try { return run(); } finally { P[phase][action] = original; }
};
exports.__aiScopeForTest = function(role) {
    return { profile: em_cfg(), runtime: eop_export_runtime(role) };
};`, filename)
const rules = runtime.exports
const scenario = "1943-1945 (The Even Shorter Campaign)"
let state = rules.setup(20261004, scenario, { headless_moves: true })
const role = Array.isArray(state.active) ? state.active[0] : state.active
const view = rules.view(state, role)
assert(view.ai.victory.homelandKeys.length === 7)
assert(view.ai.units.some(u => u.class === "ground" && u.faction === 1))
const before = JSON.stringify(state)
const ownGround = view.ai.units.find(u => u.faction === (role === "Japan" ? 0 : 1) && u.class === "ground")
if (ownGround) {
    const card = view.ai.ownCards.find(c => c.allowed.includes("ops"))
    if (card) rules.query(state, role, { name: "rules_query", fn: "queryGroupMovementDestinations", args: [[ownGround.id], { faction: ownGround.faction, cardId: card.id }] })
}
assert.equal(JSON.stringify(state), before, "movement query restores complete state and RNG")

// Real weather/card rollback snapshots contain full server state. Neither a
// player nor a spectator may receive them through the public offensive object.
{
    let privateState = rules.setup(20261004, scenario, { headless_moves: true })
    privateState.ai_plan = {
        Allies: { version: 1, role: "Allies", marker: "private-allied-campaign-plan", targets: [], tasks: [] },
        Japan: { version: 1, role: "Japan", marker: "private-japanese-campaign-plan", targets: [], tasks: [] },
    }
    privateState.ai_runtime = {
        Allies: { version: 1, role: "Allies", sid: privateState.sid, marker: "private-allied-runtime" },
        Japan: { version: 1, role: "Japan", sid: privateState.sid, marker: "private-japanese-runtime" },
    }
    assert(privateState.offensive.weather_rollback.hand, "real opening creates a full weather rollback")
    function assertPrivateView(source, viewer) {
        const unchanged = JSON.stringify(source)
        const visible = rules.view(source, viewer)
        assert.equal(JSON.stringify(source), unchanged, "filtering a public view does not alter server rollback or private state")
        const forbidden = new Set(["card_rollback", "weather_rollback", "hand", "draw", "seed",
            "future_offensive", "ai_plan", "ai_runtime", "ai_profile", "undo", "redo"])
        function inspect(value) {
            if (!value || typeof value !== "object") return
            for (const [key, child] of Object.entries(value)) {
                assert(!forbidden.has(key), "public offensive must not contain server-private key " + key)
                inspect(child)
            }
        }
        inspect(visible.offensive)
        assert.deepEqual(visible.offensive.active_cards, source.offensive.active_cards,
            "actually played cards remain public")
        const serialized = JSON.stringify(visible)
        assert(!serialized.includes("private-allied-runtime") && !serialized.includes("private-japanese-runtime"))
        if (viewer !== "Allies") assert(!serialized.includes("private-allied-campaign-plan"))
        if (viewer !== "Japan") assert(!serialized.includes("private-japanese-campaign-plan"))
        for (const [side, owner] of [[0, "Japan"], [1, "Allies"]]) {
            const pending = (source.offensive.draw[side] || []).filter(card => card >= 0)
            if (viewer === owner) assert.deepEqual(visible.hand[side], source.hand[side].concat(pending))
            else assert.equal(visible.hand[side], source.hand[side].length + pending.length,
                "opponents and spectators receive a hand count, never card identities")
            if (viewer !== owner) assert.equal(visible.future_offensive[side], -1)
        }
        return visible
    }
    for (const viewer of ["Allies", "Japan", "Observer"]) assertPrivateView(privateState, viewer)
    const card = rules.view(privateState, "Allies").ai.ownCards.find(c => c.allowed.includes("ops")).id
    privateState = rules.action(privateState, "Allies", "card", card)
    privateState = rules.action(privateState, "Allies", "ops")
    assert(privateState.offensive.card_rollback.hand, "actual OC action creates a full card rollback")
    assert(privateState.offensive.card_rollback.ai_plan.Allies)
    assert(privateState.offensive.card_rollback.ai_runtime.Japan)
    for (const viewer of ["Allies", "Japan", "Observer"]) assertPrivateView(privateState, viewer)

    // Resolve actual in-turn draws for both factions. The cards temporarily
    // live in offensive.draw but are still private under rules 5.0 and 5.35.
    rules.__drawPendingForTest(privateState, "Allies")
    rules.__drawPendingForTest(privateState, "Japan")
    assert(privateState.offensive.draw.every(list => list.length > 0))
    for (const viewer of ["Allies", "Japan", "Observer"]) assertPrivateView(privateState, viewer)
}

if (role === "Allies") {
    const trace = rules.bots["erasmus-campaign"].decide(rules.view(state, role), { role, seed: 20261004, actionOrdinal: 1 }).publicTrace.campaign
    assert(trace)
    assert(!("evaluatedCardIds" in trace.pow) && !("unexaminedCardIds" in trace.pow), "public diagnostics do not reveal private hand IDs")
    assert(!("sovietDependency" in trace.victory.routes.atomic), "public diagnostics do not reveal whether a conditional event is in hand")
    assert.equal(JSON.stringify(state), before, "campaign decision leaves persistent state unchanged")
}

// Allied #38's can_play predicate performs activation scans. Looking at one's
// hand while the opponent is active must not overwrite that opponent's L/cache.
{
    const inactive = rules.setup(20261004, scenario, { headless_moves: true })
    inactive.active = "Japan"
    inactive.hand[1] = [38]
    const unchanged = JSON.stringify(inactive)
    const own = rules.view(inactive, "Allies")
    assert(own.ai.ownCards.some(card => card.id === 38 && Array.isArray(card.allowed)))
    assert.equal(JSON.stringify(inactive), unchanged, "own card legality projection is read-only even for activation-scanning events")
    rules.view(inactive, "Allies")
    assert.equal(JSON.stringify(inactive), unchanged, "repeated inactive views are also read-only")
}

// A query may use public enemy units, but cannot impersonate their role to test
// whether a guessed card is in the enemy hand. Keep hand size fixed in the pair.
{
    const present = rules.setup(20261004, scenario, { headless_moves: true })
    const publicUnits = rules.view(present, "Allies").ai.units
    const enemyGround = publicUnits.find(unit => unit.faction === 0 && unit.class === "ground")
    const enemyHq = publicUnits.find(unit => unit.faction === 0 && unit.class === "hq")
    assert(enemyGround && enemyHq)
    const probeCard = present.hand[0][0]
    const absent = JSON.parse(JSON.stringify(present))
    absent.hand[0][0] = absent.draw[0].find(id => id !== probeCard && !absent.hand[0].includes(id))
    assert(Number.isInteger(absent.hand[0][0]))
    function ask(source, fn, args) {
        const unchanged = JSON.stringify(source)
        const result = rules.query(source, "Allies", { name: "rules_query", fn, args })
        assert.equal(JSON.stringify(source), unchanged, "denied private-card probes do not mutate state")
        return result
    }
    for (const preview of [{ faction: 0, cardId: probeCard }, { cardId: probeCard }]) {
        const a = ask(present, "queryGroupMovementDestinations", [[enemyGround.id], preview])
        const b = ask(absent, "queryGroupMovementDestinations", [[enemyGround.id], preview])
        assert.equal(a.reachableHexes.length, 0)
        assert.deepEqual(a, b, "private enemy hand membership cannot affect a movement response")
        assert.deepEqual(ask(present, "queryActivationCandidates", [enemyHq.id, preview]), [])
        assert.deepEqual(ask(absent, "queryActivationCandidates", [enemyHq.id, preview]), [])
    }
    assert.equal(ask(present, "queryFactionUnits", [enemyGround.location, 0]), true,
        "public enemy-unit queries retain their existing semantics")
}

const plan = { version: 1, role, turn: state.turn, phase: "ASSEMBLE", focus: 647, targets: [], tasks: [] }
const d = rules.bots["erasmus-v2-opt-v5"].decide(rules.view(state, role), { role, seed: 20261004, actionOrdinal: 1 })
d.argument.__ai.plan = plan
const replayState = JSON.parse(JSON.stringify(state))
state = rules.action(state, role, d.action, d.argument)
const replay = rules.action(replayState, role, d.action, JSON.parse(JSON.stringify(d.argument)))
assert.equal(JSON.stringify(state), JSON.stringify(replay), "metadata action is replayable without decide")
assert.deepEqual(state.ai_plan[role], plan)
assert.equal(rules.view(state, role === "Japan" ? "Allies" : "Japan").ai.plan, null, "opponent cannot see plan")
const invalidBefore = JSON.stringify(state)
assert.throws(() => rules.action(state, role, "not_a_real_action", {
    __ai: { version: 1, role, plan, profile: c, logs: ["[ERASMUS] rejected"] }, action: null,
}), /Invalid action/)
assert.equal(JSON.stringify(state), invalidBefore, "rejected metadata action leaves no plan, configuration or trace changes")
assert.throws(() => rules.action(state, role, "not_a_real_action", {
    __ai: { version: 1, role, plan, logs: ["untrusted trace"] }, action: null,
}), /Invalid AI trace/)
assert.equal(JSON.stringify(state), invalidBefore, "malformed metadata is rejected before loading mutable state")

// A real handler name is insufficient: its original argument must belong to
// this acting role's current legal view, before metadata or supply is written.
{
    function hqWindow() {
        let s = rules.setup(20261004, scenario, { headless_moves: true })
        s.hand[1] = [45]
        s = rules.action(s, "Allies", "card", 45)
        return rules.action(s, "Allies", "ops")
    }
    const rejected = hqWindow()
    assert.equal(rejected.L.P, "choose_hq")
    const attempted = { version: 1, role: "Allies", profile: { campaign_planner: 1 },
        plan: { version: 1, role: "Allies", marker: "rejected-plan" },
        runtime: { version: 1, role: "Allies", sid: rejected.sid, override: { name: "rejected-runtime", chain: [1001] } },
        logs: ["[ERASMUS] rejected-action"] }
    const unchanged = JSON.stringify(rejected)
    for (const raw of [9999, { action: 9999, oos: [], br: 999 }]) {
        assert.throws(() => rules.action(rejected, "Allies", "unit", { __ai: attempted, action: raw }), /Invalid action/)
        assert.equal(JSON.stringify(rejected), unchanged, "invalid unit ID cannot persist metadata, logs, supply or a numeric active role")
    }
    assert.throws(() => rules.action(rejected, "Japan", "unit", {
        __ai: { version: 1, role: "Japan", profile: { campaign_planner: 1 } }, action: 79,
    }), /Invalid AI action role/)
    assert.equal(JSON.stringify(rejected), unchanged, "a non-active role cannot impersonate a valid metadata writer")
    assert.throws(() => rules.action(rejected, "Allies", "unit", {
        __ai: { version: 1, role: "Japan" }, action: 79,
    }), /role\/version mismatch/)
    assert.equal(JSON.stringify(rejected), unchanged)

    rejected.ai_plan = { Allies: { version: 1, role: "Allies", marker: "original-plan" } }
    rejected.ai_profile = { Allies: { campaign_planner: 0 } }
    rejected.ai_runtime = { Allies: { version: 1, role: "Allies", sid: rejected.sid,
        override: { name: "original-runtime", chain: [1001] } } }
    const hq = rules.view(rejected, "Allies").actions.unit[0]
    const originalState = JSON.stringify(rejected)
    rules.__withActionFailureForTest("choose_hq", "unit", () => {
        assert.throws(() => rules.action(rejected, "Allies", "unit", { __ai: attempted, action: hq }), /injected handler failure/)
    })
    assert.equal(JSON.stringify(rejected), originalState,
        "a legal handler failure restores complete board, RNG, undo, active, profile, plan, runtime and logs in the caller's original object")
    const scope = rules.__aiScopeForTest("Allies")
    assert.equal(scope.profile, null, "failed actions cannot leave an optional configuration loaded")
    assert.deepEqual(scope.runtime.override, rejected.ai_runtime.Allies.override,
        "failed actions restore the original persisted policy runtime")
    const expectedRetry = JSON.parse(originalState)
    const actualRetry = rules.action(rejected, "Allies", "unit", { __ai: { version: 1, role: "Allies" }, action: hq })
    assert.equal(JSON.stringify(actualRetry), JSON.stringify(rules.action(expectedRetry, "Allies", "unit", hq)),
        "retrying the unchanged object has the same gameplay result as the original legacy scalar action")

    const supplyWrapped = hqWindow(), supplyLegacy = JSON.parse(JSON.stringify(supplyWrapped))
    const supplyArgument = { action: 79, oos: supplyWrapped.oos.slice(), br: supplyWrapped.burma_road }
    assert(rules.view(supplyWrapped, "Allies").actions.unit.includes(79))
    assert.equal(JSON.stringify(rules.action(supplyWrapped, "Allies", "unit", {
        __ai: { version: 1, role: "Allies" }, action: supplyArgument,
    })), JSON.stringify(rules.action(supplyLegacy, "Allies", "unit", supplyArgument)),
    "the nested client supply envelope keeps its original valid scalar argument")

    let moving = hqWindow()
    moving = rules.action(moving, "Allies", "unit", 79)
    const movingView = rules.view(moving, "Allies")
    const navy = movingView.actions.unit.find(id => rules.pieces[id].class === "naval")
    assert(navy)
    moving = rules.action(moving, "Allies", "unit", navy)
    moving = rules.action(moving, "Allies", "done")
    assert.equal(rules.view(moving, "Allies").actions.advance, 1)
    const movingLegacy = JSON.parse(JSON.stringify(moving))
    const targetPlan = { focus: 1001, kind: "CONQUEST", requiresOccupation: true, chain: [1001], targetMeta: [] }
    assert.equal(JSON.stringify(rules.action(moving, "Allies", "advance", {
        __ai: { version: 1, role: "Allies" }, action: targetPlan,
    })), JSON.stringify(rules.action(movingLegacy, "Allies", "advance", targetPlan)),
    "headless advance still accepts its replayable target-plan object when the button is legal")
}
console.log("Campaign config, role isolation, query purity and action envelope passed")
