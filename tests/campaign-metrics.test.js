"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const { createMetrics, analyzeLog, retainedProgress, classifyEnd, captureRate, battleRate, wilson, pairedBootstrap,
    JP_CONTROLLED: JP, HEX_CONTROLLABLE: LAND, AMPH_MOVE } = require("./campaign-metrics")
const pieces = [{}, { faction: 1, class: "ground", cf: 22, rcf: 11, size: 3 }, { faction: 1, class: "naval", cf: 16 }, { faction: 0, class: "ground", cf: 18 }]
function state() { return { turn: 5, active: "Allies", political_will: 6, pow: 4, capture: [], reduced: [],
    location: [0, 1, 1, 2], supply_cache: [0, LAND, LAND | JP], log: ["@Turn 5. Offensives phase"] } }
test("ground and naval outcomes count symmetric wins/losses; markup is not faction attribution", () => {
    const m = analyzeLog(["@Turn 5. Offensives phase", "%ABattle hex A (H2)", "&AAttacker won in ground combat H2.",
        "%ABattle hex B (H3)", "&ADefender won in ground combat H3.", "&AAttacker won battle (12 - 4).", "&AJP fire (18)."], 5)
    assert.equal(m.role.Allies.groundAttacksWon, 1)
    assert.equal(m.role.Allies.groundAttacksLost, 1)
    assert.equal(m.role.Japan.groundDefensesFaced, 2)
    assert.equal(m.role.Japan.groundDefensesHeld, 1)
    assert.equal(m.role.Japan.groundDefensesLost, 1)
    assert.equal(m.role.Allies.navalBattlesWon, 1)
    assert.equal(m.role.Japan.navalBattlesLost, 1)
    assert.equal(m.role.Japan.fire, 1)
    assert.deepEqual(battleRate(m.role.Japan), { won: 1, lost: 2, denominator: 3, rate: 1 / 3 })
    assert.equal(m.role.Allies.amphibAssaults, 0, "a ground victory alone never proves an amphibious attempt")
})
test("actual amphibious path to enemy control + occupation counts one attempt, including unopposed landing", () => {
    const s = state(), m = createMetrics(pieces, s)
    s.offensive = { attacker: 1, paths: [1, [AMPH_MOVE, 0, 1, 2]], battle: {} }
    s.location[1] = 2
    s.log.push("P80 activated for offensive.")
    m.observe(s, 1)
    s.log.push("#GResolve battles", "AP captured H2.", "#GPost battle movement")
    s.supply_cache[2] = LAND; s.capture = [2]
    m.observe(s, 2); m.observe(s, 3)
    const r = m.result(s)
    assert.equal(r.role.Allies.amphibAssaults, 1)
    assert.equal(r.role.Allies.amphibSuccess, 1)
    assert.equal(r.role.Allies.capturedHexes, 1)
    assert.equal(r.role.Japan.lostHexes, 1)
    assert.equal(r.capRate.Allies.denominator, 1)
})
test("failed escort and failed ground participation in one battle count one failed landing", () => {
    const s = state(), m = createMetrics(pieces, s)
    s.offensive = { attacker: 1, paths: [1, [AMPH_MOVE, 0, 1, 2]], battle: { battle_hex: 2, amph_ground: [1] } }
    s.location[1] = 2
    s.log.push("P80 activated for offensive.", "#GResolve battles", "%ABattle hex A (H2)")
    m.observe(s, 1)
    s.log.push("&AAmphibious Assault failed due to lack of naval escort.", "&A^1 units|P1^ could not participate ground combat.", "#GPost battle movement")
    s.location[1] = 1
    m.observe(s, 2)
    const r = m.result(s)
    assert.equal(r.role.Allies.amphibAssaults, 1)
    assert.equal(r.role.Allies.amphibFailures, 1)
    assert.equal(r.role.Allies.amphibSuccess, 0)
})
test("cancelled offense and friendly amphibious transport do not count assaults", () => {
    const s = state(), m = createMetrics(pieces, s)
    s.offensive = { attacker: 1, paths: [1, [AMPH_MOVE, 0, 1, 2]] }
    s.log.push("P80 activated for offensive.", "#GCancel offensive")
    m.observe(s)
    assert.equal(m.result(s).role.Allies.amphibAssaults, 0)
})
test("first executed landing is shared by bots and requires arrived ground and same-origin naval paths", () => {
    const s = state(), m = createMetrics(pieces, s)
    s.offensive = { attacker: 1, paths: [1, [AMPH_MOVE, 1, 1, 2]], battle: {} }
    s.location[1] = 2; s.log.push("P80 activated for offensive.")
    m.observe(s, 1)
    assert.equal(m.result(s).firstExecutedLandingFormation, null)
    s.offensive.paths.push(2, [2, 1, 1, 2])
    m.observe(s, 2)
    assert.equal(m.result(s).firstExecutedLandingFormation, null, "a path without actual naval arrival is not an executed formation")
    s.location[2] = 2
    m.observe(s, 3)
    assert.deepEqual(m.result(s).firstExecutedLandingFormation, { turn: 5, action: 3, target: 2, ground: [1], escort: [2], source: "executed-paths", origin: 1 })
    assert.equal(m.result(s).firstLandingFormation, null, "no policy trace is required for the common metric")
    m.observe(s, 4)
    assert.equal(m.result(s).firstExecutedLandingFormation.action, 3)
})
test("landing evidence rejects unrelated routes and remote support; battle participants can prove actual escort", () => {
    const s = state(), m = createMetrics(pieces, s)
    s.offensive = { attacker: 1, paths: [1, [AMPH_MOVE, 1, 1, 2], 2, [2, 1, 3, 2]], battle: {} }
    s.location[1] = s.location[2] = 2; s.log.push("P80 activated for offensive.")
    m.observe(s, 1)
    assert.equal(m.result(s).firstExecutedLandingFormation, null, "path evidence must establish a shared origin and destination")
    s.offensive.paths = []
    s.offensive.battle = { battle_hex: 2, amph_ground: [1], air_naval: [[], [2]] }
    s.location[2] = 1
    m.observe(s, 2)
    assert.equal(m.result(s).firstExecutedLandingFormation, null, "remote naval battle commitment is not physical escort")
    s.location[2] = 2
    m.observe(s, 3)
    assert.deepEqual(m.result(s).firstExecutedLandingFormation, { turn: 5, action: 3, target: 2, ground: [1], escort: [2], source: "battle-participants" })
})
test("PoW uses official per-turn requirement, retained control and political-phase outcome", () => {
    const s = state(), m = createMetrics(pieces, s)
    s.capture = [1, 2]
    assert.equal(retainedProgress(s), 1)
    s.log.push("Progress of war target - 4.", "@Turn 5. Political phase", "Political will changed to 5 (-1) - current progress of war 1 < 4.",
        "@Turn 6. Offensives phase", "Progress of war target - 2.", "@Turn 6. Political phase", "Progress of War 2 >= 2.")
    s.turn = 6; s.pow = 2
    m.observe(s)
    const p = m.result(s).pow
    assert.equal(p.eligibleTurns, 2); assert.equal(p.metTurns, 1); assert.equal(p.rate, 0.5)
    assert.deepEqual(captureRate({ 5: 2, 7: 1 }, 5, 7), { mean: 1, max: 2, turnsWithCapture: 2, startTurn: 5, endTurn: 7, denominator: 3 })
})
test("state deltas ignore ocean bits, include recapture losses and count steps not formation size", () => {
    const s = state(), m = createMetrics(pieces, s)
    s.supply_cache[2] = LAND; s.supply_cache[0] = JP
    s.location[1] = 1482
    m.observe(s)
    assert.equal(m.result(s).role.Allies.elimSteps, 2)
    s.supply_cache[2] = LAND | JP
    m.observe(s)
    assert.equal(m.result(s).netCaptures.Allies, 0)
})
test("natural ending classification rejects resignation and unfinished result labels", () => {
    const s = state(); s.turn = 7; s.result = "Japan"; s.active = "None"
    s.log.push("Japanese Victory by Treaty Negotiations.")
    assert.equal(classifyEnd(s).earlyTreatyDefeat, true)
    s.log.push("Allies resigned.")
    assert.equal(classifyEnd(s).natural, false)
    s.active = "Allies"
    assert.equal(classifyEnd(s).termination, "unfinished")
})
test("Wilson denominator retains invalid games; paired bootstrap is deterministic and paired", () => {
    const ci = wilson(0, 32)
    assert.equal(ci.estimate, 0); assert.ok(ci.high > 0.10 && ci.high < 0.11)
    assert.deepEqual(pairedBootstrap([[0, 1], [1, 1]], 1000), pairedBootstrap([[0, 1], [1, 1]], 1000))
    const difference = pairedBootstrap([[0, 1], [1, 1]], 1000)
    assert.equal(difference.estimate, 0.5); assert.equal(difference.low, 0); assert.equal(difference.high, 1)
})
test("evaluation keeps failed games in both paired and marginal denominators", () => {
    const { reportGroups } = require("./campaign-evaluate")
    const good = seed => ({ seed, status: "complete", natural: true, validNatural: true, winner: "Allies", fallback: 0,
        traceNodeMissing: 0, verification: { status: "verified" } })
    const failed = { seed: 2, status: "error", validNatural: false, winner: "Allies", error: "test failure" }
    const report = reportGroups([{ scenario: "fixture", baseline: [good(1), failed], campaign: [good(1), failed] }], "develop")
    assert.equal(report.scenarios[0].campaign.winRate.n, 2)
    assert.equal(report.scenarios[0].campaign.winRate.successes, 1)
    assert.equal(report.scenarios[0].campaign.invalid, 1)
    assert.equal(report.scenarios[0].pairedWinRateDifference.n, 2)
    assert.equal(report.scenarios[0].pairedWinRateDifference.estimate, 0)
})
test("new profile envelope is retained for rules but decoded for legality and decision metrics", () => {
    const { validateAction } = require("./match-run")
    const view = { prompt: "Declare battle hexes", actions: { unit: [1] } }
    const decision = { action: "unit", argument: { __ai: { version: 1, role: "Allies" }, action: 1 } }
    validateAction(view, decision)
    assert.throws(() => validateAction(view, { action: "unit", argument: { __ai: {}, action: 2 } }), /illegal/)
    const m = createMetrics(pieces, state()); m.recordDecision("Allies", decision, view, 1)
    assert.equal(m.metrics.role.Allies.airStrikeUnits, 1)
})
test("HQ activation counts authoritative offensive and reaction logs exactly once, including automatic choices", () => {
    const hqs = pieces.slice()
    hqs[80] = { faction: 1, class: "hq" }; hqs[4] = { faction: 0, class: "hq" }
    const s = state(), m = createMetrics(hqs, s)
    m.recordDecision("Allies", { action: "unit", argument: 80 }, { prompt: "Choose HQ.", actions: { unit: [80] } }, 1)
    assert.equal(m.metrics.role.Allies.hqActivations, 0, "a choice is counted only when the engine confirms activation")
    s.log.push("P80 activated for offensive.", "P4 activated for reaction.", "P1 activated for offensive.")
    m.observe(s, 1); m.observe(s, 2)
    assert.equal(m.metrics.role.Allies.hqActivations, 1)
    assert.equal(m.metrics.role.Japan.hqActivations, 1)
})
test("fallback diagnostics retain first 32 pre-action snapshots without changing counts or natural-win validity", () => {
    const { play } = require("./match-run")
    const initial = state(); initial.L = { P: "choose_hq" }
    const legalActions = { done: 1, unit: [80] }
    let ordinal = 0
    const rules = {
        pieces: [], setup: () => initial,
        view: () => ({ prompt: `Choose HQ ${ordinal + 1}.`, actions: legalActions }),
        bots: { fake: { decide: () => ({ action: "done", publicTrace: { fallback: true, node: "fixture", chart: "AP-07" } }) } },
        action: s => {
            ordinal++; legalActions.unit.push(80 + ordinal)
            if (ordinal === 35) { s.active = "None"; s.result = "Japan"; s.log.push("Japanese Victory by Treaty Negotiations.") }
            return s
        },
        query: () => null,
    }
    const bundle = { rules, call: fn => fn() }
    const { result } = play(123, { maxActions: 35, repeatStateLimit: 100 },
        { bundles: { Allies: bundle, Japan: bundle }, names: { Allies: "fake", Japan: "fake" }, metadata: {} })
    assert.equal(result.fallback, 35)
    assert.equal(result.fallbackDetails.length, 32)
    assert.deepEqual(result.fallbackDetails[0], { role: "Allies", ordinal: 1, turn: 5, state: "choose_hq",
        prompt: "Choose HQ 1.", action: "done", node: "fixture", legalActions: { done: 1, unit: [80] } })
    assert.equal(result.fallbackDetails[31].ordinal, 32)
    assert.equal(result.natural, true)
    assert.equal(result.validNatural, false)
})
test("evaluation queue bounds parallel work, preserves task identity and drains running tasks before rejecting", async () => {
    const { runQueue } = require("./campaign-evaluate")
    let active = 0, maximum = 0
    const started = [], completed = []
    const result = await runQueue([0, 1, 2, 3, 4], 2, async value => {
        started.push(value); maximum = Math.max(maximum, ++active)
        await new Promise(resolve => setImmediate(resolve))
        completed.push(value); active--; return value * 10
    })
    assert.equal(maximum, 2)
    assert.deepEqual(started, [0, 1, 2, 3, 4])
    assert.equal(new Set(completed).size, 5)
    assert.deepEqual(result, [0, 10, 20, 30, 40])
    let drained = false
    const failures = []
    await assert.rejects(runQueue([0, 1, 2], 2, async value => {
        failures.push(value)
        if (value === 0) throw new Error("fixture failure")
        await new Promise(resolve => setImmediate(resolve)); drained = true
    }), /fixture failure/)
    assert.deepEqual(failures, [0, 1])
    assert.equal(drained, true)
    await assert.rejects(runQueue([], 5, async () => {}), /integer 1\.\.4/)
})
test("progress guard ignores growing logs and AI metadata but preserves actual rule state", () => {
    const { gameplayFingerprint, progressGuard } = require("./match-run")
    const s = state(), before = gameplayFingerprint(s), guard = progressGuard(3)
    guard(s, 1)
    s.log.push("[ERASMUS] same plan"); s.ai_plan = { Allies: { revision: 2 } }; s.ai_profile = { Allies: { anyFlag: 1 } }
    s.undo = [{ log: ["ignored history"] }]
    assert.equal(gameplayFingerprint(s), before)
    guard(s, 2)
    assert.throws(() => guard(s, 3), /repeated gameplay state 3 times/)
    s.location[1] = 2
    assert.notEqual(gameplayFingerprint(s), before)
})
