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

const rules = require("../rules.js")
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
console.log("Campaign config, role isolation, query purity and action envelope passed")
