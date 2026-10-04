"use strict"

// Source-level contract tests: mocked authority returns legal paths, while the
// production planner must assemble assignments and preserve them across windows.
// Actual engine-query purity and replay are covered by campaign-runtime.test.js.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const source = name => fs.readFileSync(path.join(__dirname, "../js/server/", name), "utf8")
const plain = value => JSON.parse(JSON.stringify(value))
const completed = []
function test(name, fn) { fn(); completed.push(name) }

function fixture(options = {}) {
    const board = [
        { id: 0, name: "Rear", named: true, port: true, region: "Pacific" },
        { id: 5, name: "Fleet port", named: true, port: true, region: "Pacific" },
        { id: 10, name: "Embarkation", named: true, port: true, region: "Pacific" },
        { id: 15, name: "Forward", named: true, port: true, region: "Pacific" },
        { id: 20, name: "Enemy island", named: true, port: true, resource: 1, region: "Pacific" },
    ]
    const owned = new Set([0, 5, 10, 15]), calls = []
    const units = [
        { id: 1, faction: 1, class: "hq", location: 10, cr: 40, cm: 2 },
        { id: 2, faction: 1, class: "ground", asp: true, aspCost: 1, stratMove: true, cf: 12, lf: 12, location: 10, service: "navy" },
        { id: 3, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" },
        { id: 4, faction: 1, class: "ground", stratMove: true, cf: 10, lf: 12, location: 0, service: "army" },
    ]
    const view = { active: "Allies", turn: 5, political_will: 4, pow: 1, capture: [],
        asp: [[7, 0], [4, 0]], oos: [], inter_service: [0, 0], resources: [4, 0],
        actions: { card: [9] }, offensive: { active_units: [[], []], active_hq: [], battle_hexes: [] },
        ai: { state: "offensive_segment", units, ownCards: [{ id: 9, ops: 3, allowed: ["ops"] }],
            victory: { homelandKeys: [20], atomic: { jpResources: 4, bombingCampaignStart: 0 } } } }
    const ctx = {
        map: board, hex_to_int: x => x, LAST_BOARD_HEX: 40, TOKYO: 40,
        AMPH_MOVE: 8, GROUND_MOVE: 4, STRAT_MOVE: 1, EC: 1,
        em_cfg: () => ({ campaign_planner: options.enabled === false ? 0 : 1 }),
        em_flag: () => options.enabled === false ? 0 : 1,
        get_distance: (a, b) => Math.ceil(Math.abs(a - b) / 2), get_map_data: h => board.find(m => m.id === h),
        querySpaceControlled: (h, f) => f === 1 ? owned.has(h) : h === 20,
        queryActivationCandidates: (hq, context) => {
            calls.push({ type: "activation", hq, context: plain(context) })
            return options.activation ? options.activation(view, context) : view.ai.units.filter(u => u.class !== "hq").map(u => u.id)
        },
        queryGroupMovementDestinations: (ids, context) => {
            calls.push({ type: "move", ids: [...ids], context: plain(context) })
            let hs
            if (options.paths) hs = options.paths(ids, context, view)
            else hs = context.move_type === 8 && ids.includes(2) && ids.includes(3) ? [20]
                : context.move_type === 1 && ids[0] === 4 ? [15] : []
            return { reachableHexes: hs, paths: Object.fromEntries(hs.map(h => [h, [context.move_type, 1, 10, h]])),
                aspCost: context.move_type === 8 ? 1 : 0, reason: hs.length ? null : "no-legal-path" }
        },
        queryReactionCandidates: () => ({ air: [], carrier: [], naval: [] }),
        eop_axis: () => ctx.override || { chain: [20] },
        eop_set_strategy_chain: (role, plan) => { ctx.override = plan },
        eop_focus: () => 20, esm_gate_on: () => true,
        eop_target_meta: (role, hex) => ctx.override?.targetMeta.find(m => m.hex === hex) || null,
    }
    vm.createContext(ctx)
    vm.runInContext(source("bots/erasmus_campaign.js"), ctx)
    return { ctx, view, calls, owned }
}

test("public-view purity and numeric-ID occupation", () => {
    const { ctx, view, calls } = fixture()
    const before = JSON.stringify(view)
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(JSON.stringify(view), before)
    assert.equal(plan.phase, "CAPTURE")
    assert.equal(plan.focus, 20)
    assert.deepEqual(plain(plan.tasks[0].movementUnitIds), [2, 3])
    assert.deepEqual(plain(plan.targets[0].movementModes), ["AA"])
    assert(calls.some(c => c.type === "activation" && c.context.cardId === 9 && c.context.cardMode === "ops"))
    assert(calls.some(c => c.type === "move" && c.ids.includes(2) && c.ids.includes(3)))
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, plan).argument, 9)
})

test("disabled profile has no campaign side effects", () => {
    const { ctx, view, calls } = fixture({ enabled: false })
    assert.equal(ctx.ec_apply_plan(view, { role: "Allies" }), null)
    assert.equal(ctx.override, undefined)
    assert.equal(calls.length, 0)
})

test("enemy hand and future RNG are irrelevant to public planning", () => {
    const { ctx, view } = fixture()
    const a = ctx.ec_plan(view, { role: "Allies" })
    const b = ctx.ec_plan({ ...view, enemyHand: [999], futureRng: [1, 2, 3] }, { role: "Allies" })
    assert.deepEqual(plain(a), plain(b))
})

test("reaction and post-battle windows preserve the offensive plan", () => {
    const { ctx, view } = fixture()
    const plan = ctx.ec_plan(view, { role: "Allies" })
    for (const windowKind of ["reaction", "pbm"]) {
        const other = { ...view, ai: { ...view.ai, windowKind, plan } }
        assert.equal(ctx.ec_pick_action(other, { role: "Allies" }, plan), null)
        assert.equal(ctx.ec_apply_plan(other, { role: "Allies" }).focus, 20)
    }
})

test("pending but unreachable island produces a strategic transport", () => {
    const { ctx, view } = fixture()
    view.ai.units = view.ai.units.filter(u => u.id !== 3)
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.phase, "ASSEMBLE")
    assert.equal(plan.focus, 15)
    assert.equal(plan.tasks[0].followUpTarget, 20)
    assert.deepEqual(plain(plan.targets[0].requiredUnits), [4])
    assert.deepEqual(plain(plan.targets[0].movementModes), ["STRATEGIC"])
})

test("transport target survives activation, save/restore, and advance", () => {
    const { ctx, view } = fixture()
    view.ai.units = view.ai.units.filter(u => u.id !== 3)
    const plan = plain(ctx.ec_plan(view, { role: "Allies" }))
    plan.preCard = false
    view.ai = { ...view.ai, state: "move_units", windowKind: "task-force", plan }
    view.prompt = "Move units (0/1)."
    view.actions = { unit: [4], advance: 1, done: 1 }
    view.offensive = { attacker: 1, offensive_card: 9, active_units: [[], [4]], active_hq: [0, 1], battle_hexes: [] }
    const resumed = ctx.ec_apply_plan(plain(view), { role: "Allies" })
    assert.equal(resumed.focus, 15)
    const botSource = source("bots/erasmus.js")
    vm.runInContext(botSource.slice(botSource.indexOf("function target_argument"), botSource.indexOf("\nfunction activation_battle_gate")), ctx)
    const argument = ctx.target_argument("advance", null, "", "Allies", { ...view, ai: { ...view.ai, plan: resumed } }, "")
    assert.equal(argument.focus, 15, "must not revert to original strategic target 20")
    assert.deepEqual(plain(argument.requiredUnits), [4])
    assert.deepEqual(plain(argument.movementModes), ["STRATEGIC"])
})

test("separate ports assemble an escort before amphibious capture", () => {
    const { ctx, view } = fixture({ paths: (ids, c, v) => {
        const ship = v.ai.units.find(u => u.id === 3)
        if (c.move_type === 1 && ids[0] === 3 && ship.location === 5) return [10]
        if (c.move_type === 8 && ids.includes(2) && ids.includes(3) && ship.location === 10) return [20]
        return []
    } })
    view.ai.units = view.ai.units.filter(u => u.id !== 4)
    view.ai.units.find(u => u.id === 3).location = 5
    const assembly = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(assembly.tasks[0].objective, "ASSEMBLE_ESCORT")
    assert.equal(assembly.focus, 10)
    assert.deepEqual(plain(assembly.tasks[0].requiredUnits), [3])
    view.ai.units.find(u => u.id === 3).location = 10
    const landing = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(landing.phase, "CAPTURE")
    assert.deepEqual(plain(landing.tasks[0].movementUnitIds), [2, 3])
})

test("ASP is reserved across the whole plan", () => {
    const { ctx, view } = fixture()
    view.ai.units = view.ai.units.filter(u => u.id !== 4)
    view.asp[1] = [0, 0]
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.tasks.filter(t => t.movementModes.includes("AA")).length, 0)
    assert.equal(plan.phase, "BLOCKED")
})

test("inter-service rivalry cannot produce a mixed landing task", () => {
    const { ctx, view } = fixture()
    view.ai.units = view.ai.units.filter(u => u.id !== 4)
    view.ai.units.find(u => u.id === 2).service = "army"
    view.inter_service[1] = 1
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.tasks.length, 0)
    assert(plan.blockers.some(b => b.reason === "no-executable-capture-or-transport"))
})

test("supply and HQ authority veto nominally nearby ground units", () => {
    const { ctx, view, calls } = fixture({ activation: () => [] })
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.phase, "BLOCKED")
    assert(plan.blockers.some(b => b.reason === "no-legal-ground-under-hq"))
    assert.equal(calls.filter(c => c.type === "move").length, 0)
})

test("naval superiority alone never claims occupation", () => {
    const { ctx, view } = fixture({ paths: () => [20] })
    view.ai.units = view.ai.units.filter(u => u.class !== "ground")
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.tasks.filter(t => t.kind === "CONQUEST").length, 0)
})

test("destroyed assigned unit invalidates a saved landing", () => {
    const { ctx, view } = fixture()
    const plan = plain(ctx.ec_plan(view, { role: "Allies" }))
    plan.preCard = false
    view.ai = { ...view.ai, state: "move_units", windowKind: "task-force", plan,
        units: view.ai.units.filter(u => u.id !== 2 && u.id !== 4) }
    view.prompt = "Move units (0/2)."
    view.actions = { unit: [3], advance: 1, done: 1 }
    view.offensive = { attacker: 1, offensive_card: 9, active_units: [[], [3]], active_hq: [0, 1], battle_hexes: [] }
    const revised = ctx.ec_apply_plan(view, { role: "Allies" })
    assert.equal(revised.tasks.length, 0)
    assert.equal(revised.focus, null)
    assert(revised.blockers.some(b => b.reason === "assigned-unit-no-longer-on-map"))
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, revised).action, "done")
})

test("victory routes retain deadlines and indirect dependencies", () => {
    const { ctx, view } = fixture()
    view.turn = 11
    let victory = ctx.ec_plan(view, { role: "Allies" }).victory
    assert.equal(victory.routes.atomic.status, "deadline-missed")
    assert.equal(victory.routes.atomic.resourceCapturesNeeded, 3)
    assert.equal(victory.routes.blockade.status, "deadline-missed")
    assert.deepEqual(plain(victory.routes.homeland.remainingKeys), [20])
    view.ai.victory.blockade = { startedTurn: 9 }
    victory = ctx.ec_plan(view, { role: "Allies" }).victory
    assert.equal(victory.routes.blockade.earliestWinTurn, 11)
    assert.equal(victory.routes.blockade.completedSegments, 2)
    ctx.queryBlockadeStatus = () => ({ startedTurn: 9, connected: true, timerWillReset: true,
        completedPhases: 0, remainingPhases: 3, earliestWinTurn: null, connectedResources: [20] })
    victory = ctx.ec_plan(view, { role: "Allies" }).victory
    assert.equal(victory.routes.blockade.status, "route-reopened")
    assert.equal(victory.routes.blockade.earliestWinTurn, null)
    assert.deepEqual(plain(victory.routes.blockade.connectedResources), [20])
})

test("legacy allocation resolves public IDs and stratMove consistently", () => {
    const ctx = { em_cfg: () => ({ erasmus_plus: 1 }), ep_posture: () => ({ posture: "PRESSURE", urgency: 1 }),
        ep_p_thresholds: () => ({ min: .3 }), JP: 0, AP: 1, G: { turn: 5, pow: 0, capture: [] },
        ep_attack_mode: () => "AMPHIBIOUS_ASSAULT", em_target_value: () => 3,
        composeTaskForce: () => ({ unit: 1, groundStrength: 0 }), em_amphib_assessment: () => ({ pWin: .8, abort: false }) }
    vm.createContext(ctx); vm.runInContext(source("bots/erasmus_plan.js"), ctx)
    const units = [{ id: 1, class: "ground", stratMove: true, cf: 10, lf: 12, location: 5, faction: 1 },
        { id: 2, class: "naval", cf: 12, location: 5, faction: 1 }]
    const plan = ctx.ep_allocate_targets("Allies", { actions: { unit: [1, 2] }, ai: { units } }, [17], null)
    assert.deepEqual(plain(plan.queue), [17])
})

test("land-connected ground takes precedence over a nearer amphibious unit", () => {
    const units = [{ id: 1, faction: 1, class: "ground", location: 5, cf: 10 },
        { id: 2, faction: 1, class: "ground", location: 9, cf: 10 }]
    const ctx = { JP: 0, AP: 1, LAST_BOARD_HEX: 40, G: { location: [null, 5, 9] }, pieces: [],
        evaluateTargetFeasibility: () => ({ requiresOccupation: true, requiredGroundMath: 1, coastal: false, meta: {} }),
        eop_unit_matches_target: () => true, eop_meets_battle_support_standard: () => ({ met: false }),
        eop_evaluate_damage_level: () => ({ met: false }), eop_filter_legal_participants: x => x,
        em_cfg: () => ({ erasmus_plus: 1 }), em_flag: () => 0,
        get_map_data: () => ({ region: "Pacific" }), get_distance: (a, b) => Math.abs(a - b),
        queryGroundReachability: () => ({ reachableHexes: [] }), ep_land_connected: from => from === 5 }
    vm.createContext(ctx)
    const ops = source("erasmus_ops.js")
    vm.runInContext(ops.slice(ops.indexOf("function composeTaskForce"), ops.indexOf("\nfunction selectOperationalHq")), ctx)
    const selected = ctx.composeTaskForce(10, null, null, { active: "Allies", ai: { units }, offensive: { active_units: [[], []] } }, [2, 1], "Allies")
    assert.equal(selected.unit, 1)
})

test("naval ties and absent air cover reject an amphibious mission", () => {
    const { ctx, view } = fixture()
    const math = source("bots/erasmus_math.js")
    vm.runInContext(math.slice(math.indexOf("function em_naval_outcome"), math.indexOf("\nfunction em_amphib_assessment")), ctx)
    const ground = view.ai.units.find(u => u.id === 2), escort = view.ai.units.find(u => u.id === 3)
    const defender = { id: 8, faction: 0, class: "naval", cf: 8, br: 3, location: 20 }
    const env = { units: view.ai.units.concat(defender), faction: 1, view, powGap: 1 }
    assert.equal(ctx.ec_assess([ground, escort], [], 20, true, env).executable, false, "8 vs 8 is not naval superiority")
    escort.cf = 16
    assert.equal(ctx.ec_assess([ground, escort], [], 20, true, env).executable, false, "guns alone do not supply air cover")
    const air = { id: 9, faction: 1, class: "air", cf: 6, br: 3, location: 15 }
    assert.equal(ctx.ec_assess([ground, escort], [air], 20, true, env).executable, true)
    ctx.em_cfg = () => ({ campaign_planner: 1, epDesiredP: .9, epDesperateMinP: .4, emReactionWeight: .5 })
    assert.equal(ctx.ec_assess([ground, escort], [air], 20, true, env).requiredProbability, .6)
    assert.equal(ctx.ec_assess([ground, escort], [air], 20, true, env).desiredProbability, .9)
    view.political_will = 1
    assert.equal(ctx.ec_assess([ground, escort], [air], 20, true, env).requiredProbability, .4)
})

test("empty land capture needs no escort and reaction preview uses the selected card", () => {
    const { ctx, view } = fixture()
    let seen
    ctx.queryReactionCandidates = opts => { seen = opts; return { air: [8], carrier: [], naval: [] } }
    const ground = view.ai.units.find(u => u.id === 2)
    const air = { id: 8, faction: 0, class: "air", cf: 30, br: 5, location: 15 }
    const env = { units: view.ai.units.concat(air), faction: 1, view, powGap: 1, cardId: 9,
        cardMode: "ops", hq: { id: 1 } }
    const land = ctx.ec_assess([ground], [], 20, false, env)
    assert.equal(land.executable, true)
    assert.equal(land.emptyLandCapture, true)
    assert.deepEqual(plain(seen.cardContext), { cardId: 9, hqId: 1, cardMode: "ops", faction: 1 })
    const landing = ctx.ec_assess([ground], [], 20, true, env)
    assert.equal(landing.executable, false, "the exception does not grant a naval landing")
})

test("concentrated assault can allocate two ground units and three escorts", () => {
    const { ctx, view } = fixture({ paths: (ids, c) => c.move_type === 8 && ids.length === 5 ? [20] : [] })
    view.ai.units = view.ai.units.filter(u => u.id !== 4).concat([
        { id: 6, faction: 1, class: "ground", asp: true, aspCost: 1, stratMove: true, cf: 10, lf: 12, location: 10, service: "navy" },
        { id: 7, faction: 1, class: "naval", cf: 7, location: 10, service: "navy" },
        { id: 8, faction: 1, class: "naval", cf: 6, location: 10, service: "navy" },
    ])
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.phase, "CAPTURE")
    assert.equal(plan.tasks[0].movementUnitIds.length, 5)
    assert.equal(plan.tasks[0].escortUnitIds.length, 3)
    assert(plan.tasks[0].movementUnitIds.includes(2) && plan.tasks[0].movementUnitIds.includes(6))
})

test("public HQ opportunities are reported as a distinct victory route", () => {
    const { ctx, view } = fixture()
    view.ai.units.push({ id: 8, faction: 0, class: "hq", location: 20 })
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.victory.routes.headquarters.enemyHqCount, 1)
    assert.deepEqual(plain(plan.victory.routes.headquarters.immediatelyExecutableTargets), [20])
})

test("reinforcement and PBM keep a fleet paired at the forward ground port", () => {
    const { ctx, view } = fixture()
    view.ai.units.find(u => u.id === 4).location = 15
    const plan = { version: 1, role: "Allies", objective: { hex: 20 }, focus: 20,
        tasks: [{ kind: "REDEPLOY", objective: "ASSEMBLE", hex: 15, followUpTarget: 20 }], targets: [] }
    view.ai.plan = plan
    ctx.pieces = { 6: { class: "naval", service: "navy" } }
    const before = JSON.stringify(view)
    const chosen = ctx.ec_pick_placement(view, [0, 15], 6, "Allies")
    assert.equal(chosen.hex, 15)
    assert.equal(chosen.reason, "ground-escort-common-front-port")
    assert.equal(JSON.stringify(view), before)
    const position = ctx.ec_positioning_context(view, plan)
    const piece = { id: 3, class: "naval", service: "navy" }
    const forward = ctx.ec_pbm_score(15, 1, piece, 15, { campaignPositioning: position })
    const rear = ctx.ec_pbm_score(0, 1, piece, 15, { campaignPositioning: position })
    assert(forward.score[1] < rear.score[1], "front pairing takes precedence over an empty rear port")
    assert.equal(ctx.ec_pbm_score(15, 1, piece, 15, {}), null, "old bots retain their existing scoring")
})

test("positioning rejects a full port and enemy non-neutral air zone", () => {
    const { ctx, view } = fixture()
    const plan = { role: "Allies", objective: { hex: 20 }, tasks: [], garrisonReserveIds: [] }
    view.ai.units.push(...Array.from({ length: 6 }, (_, i) => ({ id: 10 + i, class: "naval", faction: 1, location: 15 })))
    const position = ctx.ec_positioning_context(view, plan)
    const full = ctx.ec_pbm_score(15, 1, { id: 3, class: "naval" }, 10, { campaignPositioning: position })
    assert.equal(full.score, null)
    assert.equal(full.reason, "overstack")
    ctx.queryNonNeutralZoi = hex => hex === 10
    const danger = ctx.ec_pbm_score(10, 1, { id: 3, class: "naval" }, 5, { campaignPositioning: position })
    assert.equal(danger.score, null)
    assert.equal(danger.reason, "enemy-non-neutral-zoi")
})

test("B29 reinforcement prefers a legal base in Tokyo range", () => {
    const { ctx, view, owned } = fixture()
    ctx.map.find(m => m.id === 15).airfield = true
    ctx.map.push({ id: 30, name: "Bomber base", named: true, airfield: true, region: "Pacific" })
    owned.add(30)
    ctx.pieces = { 6: { class: "air", service: "army", b29: 1 } }
    view.ai.plan = { role: "Allies", objective: { hex: 20 }, tasks: [], targets: [] }
    const chosen = ctx.ec_pick_placement(view, [15, 30], 6, "Allies")
    assert.equal(chosen.hex, 30)
    assert.equal(chosen.reason, "b29-base-in-tokyo-range")
})

test("reaction strength uses one HQ, its budget and service while caching targets", () => {
    const { ctx, view } = fixture()
    let queries = 0
    view.inter_service[0] = 1
    const enemy = [
        { id: 10, faction: 0, class: "naval", cf: 20, service: "navy", location: 15 },
        { id: 11, faction: 0, class: "air", cf: 19, service: "army", location: 15 },
        { id: 12, faction: 0, class: "naval", cf: 12, service: "navy", location: 15 },
        { id: 13, faction: 0, class: "naval", cf: 30, service: "navy", location: 0 },
    ]
    ctx.queryReactionCandidates = () => { queries++; return { air: [11], naval: [10, 12, 13], carrier: [],
        hqOptions: [{ hq: 90, budget: 2, units: [10, 11, 12] }, { hq: 91, budget: 1, units: [13] }] } }
    const env = { units: view.ai.units.concat(enemy), faction: 1, view, powGap: 1 }
    const result = ctx.ec_assess(view.ai.units.filter(u => [2, 3].includes(u.id)), [], 20, true, env)
    assert.equal(result.potentialReaction, 32, "cannot add rival services, a third activation or a second HQ")
    assert.deepEqual(plain(result.reactionUnitIds), [10, 12])
    assert.equal(result.reactionHq, 90)
    ctx.ec_assess([view.ai.units[1]], [], 20, false, env)
    assert.equal(queries, 1)
})

test("recapturing a loss cannot receive a new PoW conquest bonus", () => {
    const { ctx, view } = fixture()
    const fresh = ctx.ec_plan(view, { role: "Allies" }).tasks[0]
    view.capture = [20]
    const recapture = ctx.ec_plan(view, { role: "Allies" }).tasks[0]
    assert.equal(fresh.objective, "POW")
    assert.notEqual(recapture.objective, "POW")
    assert(fresh.score - recapture.score >= 100)
})

test("reinforcements retain the campaign and Pacific forces avoid CBI focus", () => {
    const { ctx, view, owned } = fixture()
    ctx.map.push({ id: 18, name: "Dacca", named: true, port: true, region: "NIndia" })
    owned.add(18)
    const plan = ctx.ec_plan(view, { role: "Allies" })
    view.ai = { ...view.ai, state: "reinforcements", plan }
    view.prompt = "Place reinforcement."
    view.actions = { action_hex: [10, 18] }
    const kept = ctx.ec_apply_plan(view, { role: "Allies" })
    assert.deepEqual(plain(kept.tasks), plain(plan.tasks))
    assert.equal(kept.campaign.objectiveHex, 20)
    kept.positioning.focus = 18
    ctx.pieces = { 6: { class: "naval", service: "navy" } }
    view.ai.plan = { ...kept, objective: { hex: 18 } }
    assert.equal(ctx.ec_pick_placement(view, [10, 18], 6, "Allies").hex, 10)
})

test("a carrier group can rendezvous with an existing lone battleship", () => {
    const { ctx, view } = fixture({ paths: (ids, c) => c.move_type === 1 && ids.every(id => [6, 7].includes(id)) ? [10] : [] })
    view.ai.units = view.ai.units.filter(u => u.id !== 4)
    view.ai.units.push({ id: 6, faction: 1, class: "naval", cf: 14, location: 5, service: "navy" },
        { id: 7, faction: 1, class: "naval", cf: 8, br: 2, location: 5, service: "navy" })
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.tasks[0].objective, "ASSEMBLE_ESCORT")
    assert.deepEqual(plain(plan.tasks[0].movementUnitIds).sort((a,b)=>a-b), [6, 7])
})

test("campaign ground movement explicitly selects the engine stop action", () => {
    const { ctx, view } = fixture()
    const plan = ctx.ec_plan(view, { role: "Allies" })
    view.ai.state = "move_units"
    view.actions = { stop: 1 }
    const choice = ctx.ec_pick_action(view, { role: "Allies" }, plan)
    assert.equal(choice.action, "stop")
    assert.equal(choice.via, "campaign-ground-stop")
})

test("carrier-first escort alternatives do not require two battleships first", () => {
    const { ctx, view } = fixture({ paths: (ids, c) => c.move_type === 8 && ids.includes(2) && ids.includes(9) ? [20] : [] })
    view.ai.units = view.ai.units.filter(u => u.id !== 4)
    view.ai.units.push({ id: 6, faction: 1, class: "naval", cf: 18, location: 10, service: "navy" },
        { id: 7, faction: 1, class: "naval", cf: 17, location: 10, service: "navy" },
        { id: 8, faction: 1, class: "naval", cf: 16, location: 10, service: "navy" },
        { id: 9, faction: 1, class: "naval", cf: 6, br: 2, location: 10, service: "navy" })
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.deepEqual(plain(plan.tasks[0].movementUnitIds), [2, 9])
})

test("normal acceptable odds survive while stronger odds remain preferred", () => {
    const { ctx, view } = fixture()
    const group = view.ai.units.filter(u => [2, 3].includes(u.id))
    const env = { view, faction: 1, units: view.ai.units.concat({ id: 10, class: "ground", faction: 0, location: 20 }), powGap: 1 }
    ctx.em_ground_outcome = () => ({ pWin: .65 })
    const assessment = ctx.ec_assess(group, [], 20, true, env)
    assert.equal(assessment.executable, true)
    assert.equal(assessment.requiredProbability, .6)
    assert.equal(assessment.desiredProbability, .75)
})

test("PoW budget separates remaining own cards and evaluated legal targets", () => {
    const { ctx, view } = fixture()
    view.ai.ownCards.push({ id: 10, ops: 3, allowed: ["ops"] }, { id: 11, ops: 1, allowed: ["ops"] })
    view.actions.card = [9, 10, 11]
    let plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.pow.remainingCards, 3)
    assert.deepEqual(plain(plan.pow.evaluatedCardIds), [9, 10])
    assert.deepEqual(plain(plan.pow.unexaminedCardIds), [11])
    assert.equal(plan.pow.attainableCaptureTargets.length, 1, "same target under two cards is one capture")
    assert.equal(plan.pow.quotaFeasibility, "current-plan-can-close")
    view.pow = 3
    plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.pow.quotaFeasibility, "insufficient-known-targets")
    assert(plan.pow.forecastScope.includes("no future-draw-or-sequence-guarantee"))
})

test("two targets requiring the same force are not a proven PoW sequence", () => {
    const { ctx, view } = fixture({ paths: (ids, c) => c.move_type === 8 && ids.includes(2) && ids.includes(3) ? [20, 22] : [] })
    view.ai.units = view.ai.units.filter(u => u.id !== 4)
    ctx.map.push({ id: 22, named: true, name: "Second island", port: true, region: "Pacific" })
    ctx.querySpaceControlled = (h, f) => f === 0 ? [20,22].includes(h) : [0,5,10,15].includes(h)
    view.pow = 2
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.pow.attainableCaptureTargets.length, 2)
    assert.equal(plan.pow.selectedCaptureTargets.length, 1)
    assert.equal(plan.pow.quotaFeasibility, "multiple-offensives-or-conflicting-forces")
})

test("urgent card budget can assign three independent legal captures", () => {
    const { ctx, view } = fixture({ paths: (ids, c) => c.move_type === 4 && [2,4,6].includes(ids[0]) ? [{2:20,4:21,6:22}[ids[0]]] : [] })
    view.ai.units = view.ai.units.filter(u => u.id !== 3)
    view.ai.units.push({ id: 6, faction: 1, class: "ground", cf: 8, location: 5, service: "army" })
    ctx.map.push({ id: 21, named: true, name: "Second land", region: "Pacific" }, { id: 22, named: true, name: "Third land", region: "Pacific" })
    ctx.querySpaceControlled = (h, f) => f === 0 ? [20,21,22].includes(h) : [0,5,10,15].includes(h)
    view.pow = 3
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.pow.remainingCards, 1)
    assert.equal(plan.pow.requiredCapturesPerCard, 3)
    assert.equal(plan.pow.selectedCaptureTargets.length, 3)
    assert.equal(plan.pow.quotaFeasibility, "current-plan-can-close")
})

test("completed rendezvous cannot reverse the same route within a turn", () => {
    const { ctx, view } = fixture({ paths: (ids, c) => c.move_type === 1 && ids[0] === 3 ? [5] : [] })
    view.ai.units.find(u=>u.id===4).location = 5
    view.ai.units.find(u=>u.id===4).aspCost = 1
    const before = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(before.tasks[0].hex, 5)
    view.ai.plan = { version: 1, role: "Allies", turn: 5, campaign: { objectiveHex: 20 },
        tasks: [{ kind: "REDEPLOY", hex: 10, originHex: 5, followUpTarget: 20, movementUnitIds: [3] }] }
    const after = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(after.tasks.length, 0)
    assert.deepEqual(plain(after.campaign.redeployments), [{ turn: 5, unit: 3, from: 5, to: 10, target: 20 }])
    view.ai.plan.tasks[0].followUpTarget = 22
    assert.equal(ctx.ec_plan(view, { role: "Allies" }).tasks.length, 0, "renaming the follow-up target cannot authorize the same fleet reversal")
})

test("a complete landing fleet is not dismantled for a farther port", () => {
    const { ctx, view } = fixture({ paths: (ids, c) => c.move_type === 1 && ids.every(id=>[3,7,8].includes(id)) ? [5] : [] })
    view.ai.units.find(u=>u.id===3).cf = 16
    view.ai.units.find(u=>u.id===4).location = 5
    view.ai.units.find(u=>u.id===4).aspCost = 1
    view.ai.units.push({ id: 7, faction: 1, class: "naval", cf: 16, location: 10, service: "navy" },
        { id: 8, faction: 1, class: "naval", cf: 8, br: 2, location: 10, service: "navy" })
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.tasks.length, 0)
})

test("intrinsic city garrison participates in capture odds before combat creates it", () => {
    const { ctx, view } = fixture()
    const env = { view, faction: 1, units: view.ai.units, powGap: 1 }
    ctx.queryDefendingGround = () => ({ units: [{ id: 99, cf: 12, lf: 12, reduced: true, garrison: true }] })
    let measured
    ctx.em_ground_outcome = args => { measured = args; return { pWin: .3 } }
    const assessment = ctx.ec_assess(view.ai.units.filter(u => [2,3].includes(u.id)), [], 20, true, env)
    assert.equal(measured.defCF, 12, "already-reduced query values must not be halved twice")
    assert.deepEqual(plain(measured.attLfs), [6], "8.45 amphibious ground troops take hits at half LF")
    assert.equal(assessment.defendingGround, 12)
    assert.deepEqual(plain(assessment.defendingGarrisons), [99])
    assert.equal(assessment.executable, false)
    assert.equal(assessment.pCapture, .3)
})

test("bombing bases use real range instead of region names", () => {
    const { ctx, view } = fixture()
    ctx.map.push({ id: 26, name: "Mandate airbase", named: true, airfield: true, region: "JMandates" },
        { id: 5, name: "Far Japanese airbase", named: true, airfield: true, region: "Japan" })
    const victory = ctx.ec_victory(view, ctx.ec_map(), 1)
    assert(victory.b29Bases.includes(26))
    assert(!victory.b29Bases.includes(5))
})

test("B29 prefers an in-range base, then legal China Box, then an out-of-range base", () => {
    const { ctx, view } = fixture()
    ctx.CHINA_BOX = 99
    const piece = { class: "air", b29: 1 }, position = { version: 1, role: "Allies", units: [], bases: [
        { hex: 26, airfield: true, region: "JMandates" }, { hex: 10, airfield: true, region: "Pacific" }] }
    assert.equal(ctx.ec_position_score(26, 1, piece, null, position).score[0], 0)
    assert.equal(ctx.ec_position_score(99, 1, piece, null, position).score[0], 1)
    assert.equal(ctx.ec_position_score(10, 1, piece, null, position).score[0], 2)
    view.ai.state = "strategic_bombing"; view.actions = { all: 1, skip: 1 }
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, {}).action, "all")
})

test("a legal unopposed Marine landing does not require a naval escort", () => {
    const { ctx, view } = fixture({ paths: (ids,c) => c.move_type === 8 && ids[0] === 2 ? [20] : [] })
    view.ai.units = view.ai.units.filter(u=>u.id!==3)
    ctx.queryZoi = () => false
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.tasks[0].kind, "CONQUEST")
    assert.deepEqual(plain(plan.tasks[0].movementUnitIds), [2])
    assert.equal(plan.tasks[0].assessment.unopposedLanding, true)
    ctx.queryZoi = () => true
    assert(!ctx.ec_plan(view, { role: "Allies" }).tasks.some(t=>t.kind==="CONQUEST"), "unescorted landing under possible special reaction is not safe")
})

test("US Army cannot exploit an old empty-island AA path without Marines", () => {
    const { ctx, view } = fixture({ paths: (ids,c) => c.move_type === 8 && ids[0] === 2 ? [20] : [] })
    view.ai.units.find(u=>u.id===2).service = "army"
    ctx.map.find(m=>m.id===20).island = true
    ctx.queryZoi = () => false
    assert(!ctx.ec_plan(view, { role: "Allies" }).tasks.some(t=>t.kind==="CONQUEST"))
})

test("safe military event keeps its HQ logistics and card intent through selection", () => {
    const { ctx, view } = fixture({ activation: (v,c) => c.cardMode === "event" ? [2,3] : [] })
    Object.assign(view.ai.ownCards[0], { military: true, previewEvent: true, allowed: ["ops","event"],
        logistic: 4, logistic_alt: [[1],8], hq: [1] })
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.cardIntent, "event")
    assert.equal(plan.activationBudget, 10)
    assert.equal(plan.preferredHq, 1)
    const selected = { ...view, prompt: "Select action.", actions: { ops: 1, event: 1 } }
    assert.equal(ctx.ec_pick_action(selected, { role: "Allies" }, plan).action, "event")
})

test("a viable late atomic route replaces a stalled non-resource campaign objective", () => {
    const { ctx, view } = fixture()
    ctx.map.find(m=>m.id===20).resource = 0
    ctx.map.push({ id: 22, name: "Remaining resource", named: true, port: true, resource: 1, region: "Pacific" })
    ctx.querySpaceControlled = (h,f)=>f===0?[20,22].includes(h):[0,5,10,15].includes(h)
    view.turn = 10
    view.ai.plan = { turn: 9, campaign: { objectiveHex: 20, objectiveSinceTurn: 8 } }
    view.ai.victory.atomic = { noStrategicBombingFailure: true, b29InRangeOfTokyo: true }
    assert.equal(ctx.ec_campaign_objective(view, ctx.ec_map(), view.ai.units, 1), 22)
})

test("landing odds include the actual defender fleet even without reinforcements", () => {
    const { ctx, view } = fixture()
    const group = view.ai.units.filter(u => [2,3].includes(u.id))
    const env = { view, faction: 1, units: view.ai.units.concat(
        { id: 8, faction: 0, class: "naval", cf: 20, location: 20 },
        { id: 9, faction: 0, class: "ground", cf: 5, lf: 5, location: 20 }), powGap: 1 }
    ctx.em_naval_outcome = () => ({ pWin: .2 })
    ctx.em_ground_outcome = () => ({ pWin: .9 })
    const landing = ctx.ec_assess(group, [], 20, true, env)
    assert.equal(landing.pCapture, .18)
    assert.equal(landing.executable, false)
    ctx.em_naval_outcome = () => ({ pWin: 0 })
    const overland = ctx.ec_assess(group.filter(u => u.class === "ground"), [], 20, false, env)
    assert.equal(overland.pCapture, .9)
    assert.equal(overland.executable, true, "naval defeat cannot turn back overland ground troops")
})

test("final resource risk is confined to a live T12 victory route and cannot admit zero odds", () => {
    const { ctx, view } = fixture()
    view.turn = 12
    const group = view.ai.units.filter(u => [2,3].includes(u.id))
    const env = { view, faction: 1, units: view.ai.units.concat(
        { id: 9, faction: 0, class: "ground", cf: 12, lf: 12, location: 20 }), powGap: 1,
        victory: { jpResources: 2, resourceTargets: [20], atomic: {
            noStrategicBombingFailure: true, b29InRangeOfTokyo: true } } }
    ctx.em_naval_outcome = () => ({ pWin: 1 })
    ctx.em_ground_outcome = () => ({ pWin: .2 })
    const assess = () => ctx.ec_assess(group, [], 20, true, env)
    assert.equal(assess().executable, true)
    assert.equal(assess().riskPolicy, "final-resource-deadline")
    for (const [object, key, value] of [[view,"turn",11], [view,"political_will",2],
        [env.victory,"jpResources",3], [env.victory,"resourceTargets",[22]],
        [env.victory.atomic,"noStrategicBombingFailure",false], [env.victory.atomic,"b29InRangeOfTokyo",false]]) {
        const prior = object[key]; object[key] = value
        assert.equal(assess().executable, false, `ordinary policy must apply when ${key} changes`)
        object[key] = prior
    }
    ctx.em_ground_outcome = () => ({ pWin: 0 })
    assert.equal(assess().executable, false)
    assert.equal(assess().rejection, "capture-probability-below-threshold")
    ctx.em_ground_outcome = () => ({ pWin: .9 })
    ctx.em_naval_outcome = ({ defCF }) => ({ pWin: defCF >= 10 ? 0 : 1 })
    env.units.push({ id: 30, faction: 0, class: "naval", cf: 32, br: 2, location: 15 })
    ctx.queryReactionCandidates = () => ({ air: [], carrier: [30], naval: [] })
    env.reactions = new Map()
    assert(assess().pCapture > 0, "no-reaction branch remains a genuine opportunity")
    assert.equal(assess().executable, true, "mean-reaction naval gate must not erase the final resource chance")
    view.turn = 11
    assert.equal(assess().executable, false, "ordinary turns retain the naval gate")
})

test("at the final resource deadline a legal risky capture outranks an irrelevant empty island", () => {
    const { ctx, view } = fixture({ paths: (ids,c) => c.move_type === 8 && ids.includes(2) && ids.includes(3) ? [20,22] : [] })
    ctx.map.push({ id: 22, name: "Empty island", named: true, port: true, region: "Pacific" })
    ctx.querySpaceControlled = (h,f) => f === 0 ? [20,22].includes(h) : [0,5,10,15].includes(h)
    view.ai.units.push({ id: 9, faction: 0, class: "ground", cf: 12, lf: 12, location: 20 })
    view.turn = 12
    view.ai.victory.jpResources = 2
    view.ai.victory.homelandKeys = []
    view.ai.victory.atomic = { noStrategicBombingFailure: true, b29InRangeOfTokyo: true }
    ctx.em_naval_outcome = () => ({ pWin: 1 })
    ctx.em_ground_outcome = () => ({ pWin: .2 })
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.tasks[0].hex, 20)
    assert.equal(plan.tasks[0].assessment.riskPolicy, "final-resource-deadline")
    assert(plan.tasks[0].requiredUnits.includes(2))
})

test("unsupported EC delegates the complete offensive without clearing the chart axis", () => {
    const { ctx, view } = fixture()
    const prior = plain(ctx.ec_plan(view, { role: "Allies" }))
    const originalAxis = { id: "original-event-chart", chain: [20], targetMeta: [{ hex: 20, kind: "CONQUEST" }] }
    ctx.override = originalAxis
    ctx.queryCardPreview = () => ({ eligible: false, reason: "event-hooks-not-previewable" })
    Object.assign(view.offensive, { type: ctx.EC, attacker: 1, offensive_card: 30, active_cards: [30] })
    view.ai.plan = prior
    for (const [state, prompt, actions, windowKind] of [
        ["choose_hq", "EC: 3 Ops. Choose HQ.", { unit: [1] }, "task-force"],
        ["activate_units", "EC: 3 Ops. Activate units: 0 of 7.", { unit: [2,3], done: 1 }, "task-force"],
        ["move_units", "Move units.", { unit: [2], advance: 1, done: 1, stop: 1 }, "task-force"],
        ["commit_offensive_confirm", "Confirm offensive.", { cancel: 1 }, "task-force"],
        ["move_units", "Post battle move units.", { unit: [3], advance: 1, done: 1 }, "pbm"],
    ]) {
        Object.assign(view.ai, { state, windowKind })
        Object.assign(view, { prompt, actions })
        const before = JSON.stringify(view)
        const plan = ctx.ec_apply_plan(view, { role: "Allies" })
        assert.equal(JSON.stringify(view), before, "delegation remains a pure plan transformation")
        assert.deepEqual(plain(plan.delegatedOffensive), { cardId: 30, reason: "event-hooks-not-previewable" })
        assert.equal(plan.phase, "DELEGATED")
        assert.equal(plan.preferredHq, null)
        assert.equal(plan.positioning, undefined)
        assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, plan), null, state + " stays with original Erasmus")
        assert.equal(ctx.override, originalAxis, "must not replace the original chart with an empty campaign chain")
        view.ai.plan = plain(plan) // Save/restore boundary between each window.
    }
    assert.equal(ctx.ec_pick_placement(view, [10,15], 3, "Allies"), null)
    const botSource = source("bots/erasmus.js")
    vm.runInContext(botSource.slice(botSource.indexOf("function target_argument"), botSource.indexOf("\nfunction activation_battle_gate")), ctx)
    const advance = ctx.target_argument("advance", null, "", "Allies", view, "")
    assert.equal(advance.focus, 20, "delegation restores the original chart focus")
    assert.equal(advance.campaignPositioning, undefined, "PBM must not receive campaign positioning")
    view.turn++
    Object.assign(view.ai, { state: "reinforcement_segment", windowKind: "decision-axis" })
    view.prompt = "Choose hex to place a reinforcement."
    view.actions = { action_hex: [10,15] }
    const afterTurn = ctx.ec_apply_plan(view, { role: "Allies" })
    assert.equal(afterTurn.delegatedOffensive, undefined, "event delegation must not disable next turn's positioning")
    assert(afterTurn.positioning)
})

test("the next supported card resumes campaign planning after a delegated EC", () => {
    const { ctx, view } = fixture()
    const prior = plain(ctx.ec_plan(view, { role: "Allies" }))
    prior.delegatedOffensive = { cardId: 30, reason: "event-hooks-not-previewable" }
    prior.cardId = 30
    prior.phase = "DELEGATED"
    view.ai.plan = prior
    Object.assign(view.offensive, { type: ctx.EC, attacker: 1, offensive_card: 30 })
    const plan = ctx.ec_apply_plan(view, { role: "Allies" })
    assert.equal(plan.delegatedOffensive, undefined)
    assert.equal(plan.cardId, 9)
    assert(plan.tasks.length > 0)
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, plan).action, "card")
    Object.assign(view.ai, { state: "choose_hq", plan: prior })
    Object.assign(view, { prompt: "OC: 3 Ops. Choose HQ.", actions: { unit: [1] } })
    Object.assign(view.offensive, { type: 0, offensive_card: 9, active_cards: [9] })
    const resumed = ctx.ec_apply_plan(view, { role: "Allies" })
    assert.equal(resumed.delegatedOffensive, undefined)
    assert.equal(resumed.cardId, 9)
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, resumed).action, "unit")
})

test("a restored plan never applies another card's selected intent", () => {
    const { ctx, view } = fixture()
    const plan = plain(ctx.ec_plan(view, { role: "Allies" }))
    plan.cardIntent = "event"
    view.ai.state = "offensive_segment_card_action"
    view.prompt = "C30: Select action."
    view.actions = { event: 1, ops: 1, discard: 1 }
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, plan), null)
    view.prompt = "C9: Select action."
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, plan).action, "event")
    view.actions = { discard: 1 }
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, plan), null, "a denied intent is never retried")
})

console.log(`Campaign planner: ${completed.length} source-level contracts passed`)
