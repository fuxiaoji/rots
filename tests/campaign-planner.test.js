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
    const view = { active: "Allies", sid: 8, turn: 5, political_will: 4, pow: 1, capture: [],
        asp: [[7, 0], [4, 0]], oos: [], inter_service: [0, 0], resources: [4, 0],
        actions: { card: [9] }, offensive: { active_units: [[], []], active_hq: [], battle_hexes: [] },
        ai: { state: "offensive_segment", units, ownCards: [{ id: 9, ops: 3, allowed: ["ops"] }],
            victory: { homelandKeys: [20], atomic: { jpResources: 4, bombingCampaignStart: 0 } } } }
    const ctx = {
        map: board, hex_to_int: x => x, LAST_BOARD_HEX: 40, TOKYO: 40,
        AMPH_MOVE: 8, GROUND_MOVE: 4, STRAT_MOVE: 1, NAVAL_MOVE: 2, EC: 1, EVEN_SHORT_CAMPAIGN_SCENARIO: 8,
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

test("forward HQ relocation uses a legal card after the PoW quota is met", () => {
    const { ctx, view } = fixture()
    view.ai.units.push({ id: 30, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" },
        { id: 31, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" })
    view.turn = 8
    view.pow = 0
    view.ai.units.find(u => u.id === 1).cr = 1
    ctx.map.find(m => m.id === 20).region = "JMandates"
    ctx.map.push({ id: 30, name: "Homeland port", named: true, port: true, region: "Japan" })
    view.ai.victory.homelandKeys = [30]
    view.ai.ownCards.push({ id: 8, ops: 1, allowed: ["ops", "displace_hq"] })
    view.actions.card.push(8)
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.phase, "HQ_REDEPLOY")
    assert.equal(plan.hqRelocation.hqId, 1)
    assert.equal(plan.hqRelocation.cardId, 8)
    assert.equal(ctx.ec_pick_action(view, { role: "Allies" }, plan).argument, 8)
    const selected = { ...view, prompt: "C8: Select action.", actions: { ops: 1, displace_hq: 1 } }
    assert.equal(ctx.ec_pick_action(selected, { role: "Allies" }, plan).action, "displace_hq")
    const hq = { ...view, prompt: "Choose HQ to displace.", actions: { unit: [1] } }
    assert.equal(ctx.ec_pick_action(hq, { role: "Allies" }, plan).argument, 1)
    view.pow = 1
    assert.notEqual(ctx.ec_plan(view, { role: "Allies" }).phase, "HQ_REDEPLOY")
    view.pow = 0
    view.ai.units.find(u => u.id === 1).cr = 10
    assert.notEqual(ctx.ec_plan(view, { role: "Allies" }).phase, "HQ_REDEPLOY")
})

test("mainland assembly moves a second ground unit to its escort port even without a distance gain", () => {
    const { ctx, view } = fixture({ paths: (ids, c) => c.move_type === 1 && ids[0] === 4 ? [10]
        : c.move_type===2 ? [20] : [] })
    view.ai.units.push({ id: 30, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" },
        { id: 31, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" })
    view.turn = 8
    view.pow = 0
    view.ai.units.find(u => u.id === 4).location = 15
    ctx.map.find(m => m.id === 15).port = false
    ctx.map.find(m => m.id === 20).region = "Japan"
    view.ai.ownCards.push({id:11,ops:3,allowed:["ops"]})
    for (const u of view.ai.units) if (u.faction===1) u.supply=1
    ctx.queryCardPreview=()=>({eligible:true,units:view.ai.units.filter(u=>u.class!=="hq").map(u=>u.id),activationBudget:5})
    const plan = ctx.ec_plan(view, { role: "Allies" })
    assert.equal(plan.tasks[0].objective, "HOMELAND_ASSEMBLE")
    assert.equal(plan.tasks[0].hex, 10)
    assert.equal(plan.tasks[0].followUpTarget, 20)
    assert.deepEqual(plain(plan.tasks[0].movementUnitIds), [4])
    view.inter_service[1] = 1
    assert(!ctx.ec_plan(view, { role: "Allies" }).tasks.some(t => t.objective === "HOMELAND_ASSEMBLE"),
        "army reinforcements cannot form a landing group with navy escorts during service rivalry")
})

test("reinforcement pairing respects active inter-service rivalry", () => {
    const { ctx, view } = fixture()
    view.turn = 8
    view.inter_service[1] = 1
    view.ai.units.find(u => u.id === 4).location = 15
    const plan = { version: 1, role: "Allies", objective: { hex: 20 }, focus: 20, tasks: [], targets: [] }
    const position = ctx.ec_positioning_context(view, plan)
    const navy = ctx.ec_position_score(15, 1, { id: 6, class: "naval", service: "navy" }, 5, position)
    assert.notEqual(navy.reason, "ground-escort-common-front-port")
    view.ai.units.find(u => u.id === 4).service = "navy"
    const compatible = ctx.ec_position_score(15, 1, { id: 6, class: "naval", service: "navy" }, 5,
        ctx.ec_positioning_context(view, plan))
    assert.equal(compatible.reason, "ground-escort-common-front-port")
})

test("late invasion escort stays near Honshu after PoW is met unless survival needs a capture", () => {
    const { ctx, view } = fixture({ paths: (ids,c) => c.move_type === 8 && ids.includes(2) && ids.includes(3) ? [40] : [] })
    view.ai.units.push({ id: 30, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" },
        { id: 31, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" })
    view.turn = 9
    view.pow = 0
    view.ai.victory.jpResources = 6
    ctx.map.push({ id: 40, name: "Distant resource", named: true, port: true, resource: 1, region: "Pacific" })
    ctx.querySpaceControlled = (h,f) => f === 1 ? [0,5,10,15].includes(h) : [20,40].includes(h)
    assert(!ctx.ec_plan(view, { role: "Allies" }).tasks.some(t => t.kind === "CONQUEST" && t.hex === 40))
    view.pow = 1
    assert(ctx.ec_plan(view, { role: "Allies" }).tasks.some(t => t.kind === "CONQUEST" && t.hex === 40),
        "an unmet PoW quota still permits the otherwise distant legal capture")
})

test("1943 resource campaign remains primary until a commandable invasion group assembles", () => {
    const { ctx, view } = fixture()
    view.turn = 7
    view.pow = 0
    assert.equal(ctx.ec_homeland_drive(view), false)
    const resource = ctx.ec_map().find(m => m.hex === 20)
    const ordinary = { ...resource, hex: 22, resource: 0 }
    const env = { view, faction: 1, units: view.ai.units, powGap: 0, victory: { homelandKeys: [20],
        routes: { homeland: { remainingKeys: [20] }, headquarters: { enemyHqCount: 3 } }, jpResources: 8,
        b29Bases: [], atomic: {} }, axisTargets: new Set(), previousObjective: null, campaignObjective: null }
    assert(ctx.ec_score_target(resource, env) > ctx.ec_score_target(ordinary, env))
    view.ai.units.push({ id: 30, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" },
        { id: 31, faction: 1, class: "naval", cf: 8, location: 10, service: "navy" })
    assert.equal(ctx.ec_homeland_drive(view), true)
    view.ai.units.find(u => u.id === 1).cr = 1
    view.ai.units.find(u => u.id === 1).location = 0
    assert.equal(ctx.ec_homeland_drive(view), false, "escort without HQ command is not an invasion force")
})

test("1943 pivots away from unreachable Manchurian resources when the Soviet event is unavailable", () => {
    const { ctx, view, owned } = fixture()
    view.turn = 7
    ctx.map.find(m => m.id === 20).region = "Korea"
    ctx.map.push({ id: 22, name: "South resource", named: true, port: true, resource: 1, region: "Borneo" },
        { id: 30, name: "Mukden", named: true, resource: 1, region: "Manchuria" },
        { id: 32, name: "Harbin", named: true, resource: 1, region: "Manchuria" })
    ctx.querySpaceControlled = (h, f) => f === 1 ? owned.has(h) : [20,22,30,32].includes(h) && !owned.has(h)
    assert.equal(ctx.ec_manchuria_blocked(view, ctx.ec_map()), true)
    assert.equal(ctx.ec_homeland_drive(view), true)
    assert.equal(ctx.ec_homeland_approach(view, ctx.ec_map(), view.ai.units, 1), true)
    assert(![30,32].includes(ctx.ec_campaign_objective(view, ctx.ec_map(), view.ai.units, 1)),
        "a land march must not be planned into the permanently prohibited region")
    view.ai.ownCards.push({ id: 79, name: "Soviet Invasion of Manchuria", allowed: ["event"] })
    assert.equal(ctx.ec_manchuria_blocked(view, ctx.ec_map()), false,
        "a currently playable Soviet event keeps the atomic route open")
})

test("the invasion rally port persists until control is lost", () => {
    const { ctx, view, owned } = fixture()
    view.turn = 8
    ctx.map.find(m => m.id === 20).region = "Japan"
    view.ai.units.find(u => u.id === 4).location = 15
    view.ai.plan = { campaign: { rallyPort: 10 } }
    assert.equal(ctx.ec_homeland_rally(view, ctx.ec_map(), view.ai.units, 1, true), 10)
    owned.delete(10)
    assert.equal(ctx.ec_homeland_rally(view, ctx.ec_map(), view.ai.units, 1, true), 15)
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

test("a high-logistics card can keep six escorts together for a mainland assault", () => {
    const { ctx, view } = fixture({ paths: (ids,c) => c.move_type === 8 && ids.length === 7 ? [20] : [] })
    view.ai.units = view.ai.units.filter(u => u.id !== 4).concat(
        Array.from({ length: 5 }, (_, i) => ({ id: 6+i, faction: 1, class: "naval", cf: 8,
            br: i === 0 ? 2 : 0, location: 10, service: "navy" })))
    view.ai.ownCards[0].ops = 6
    view.pow = 0
    const task = ctx.ec_plan(view, { role: "Allies" }).tasks.find(t => t.kind === "CONQUEST")
    assert(task)
    assert.equal(task.movementUnitIds.length, 7)
    assert.equal(task.escortUnitIds.length, 6)
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
        [env.victory,"jpResources",1], [env.victory,"resourceTargets",[22]],
        [env.victory.atomic,"noStrategicBombingFailure",false], [env.victory.atomic,"b29InRangeOfTokyo",false]]) {
        const prior = object[key]; object[key] = value
        assert.equal(assess().executable, false, `ordinary policy must apply when ${key} changes`)
        object[key] = prior
    }
    env.victory.jpResources = 4
    assert.equal(assess().riskPolicy, "final-resource-deadline",
        "all remaining resource assaults matter on the final atomic turn")
    view.sid = 7
    assert.equal(assess().riskPolicy, "ordinary-capture",
        "1942 keeps the validated last-resource-only desperation rule")
    view.sid = 8
    env.victory.jpResources = 2
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

test("1943 resource clock permits a bounded risky assault only after PoW is safe", () => {
    const { ctx, view } = fixture()
    view.turn = 10
    view.pow = 0
    const group = view.ai.units.filter(u => [2,3].includes(u.id))
    const env = { view, faction: 1, units: view.ai.units.concat(
        { id: 9, faction: 0, class: "ground", cf: 12, lf: 12, location: 20 }), powGap: 0,
        victory: { jpResources: 5, resourceTargets: [20], atomic: {
            noStrategicBombingFailure: true, b29InRangeOfTokyo: true }, blockade: { startedTurn: 0 } } }
    ctx.em_naval_outcome = () => ({ pWin: 1 })
    ctx.em_ground_outcome = () => ({ pWin: .4 })
    const assess = () => ctx.ec_assess(group, [], 20, true, env)
    assert.equal(assess().riskPolicy, "resource-clock")
    assert.equal(assess().executable, true)
    for (const [object, key, value] of [[view,"turn",8], [env,"powGap",1],
        [view,"political_will",2], [env.victory.blockade,"startedTurn",9],
        [env.victory.atomic,"noStrategicBombingFailure",false], [env.victory.atomic,"b29InRangeOfTokyo",false]]) {
        const prior = object[key]; object[key] = value
        assert.equal(assess().executable, false, `ordinary threshold applies when ${key} changes`)
        object[key] = prior
    }
    ctx.em_ground_outcome = () => ({ pWin: .2 })
    assert.equal(assess().executable, false, "the resource clock still requires meaningful capture odds")
})

test("final resource assault can commit a garrison when the deadline makes holding back certain failure", () => {
    const { ctx, view } = fixture()
    ctx.map.find(m=>m.id===10).resource = 1
    view.turn = 12
    view.political_will = 8
    view.ai.victory.jpResources = 2
    view.ai.victory.atomic = { noStrategicBombingFailure: true, b29InRangeOfTokyo: true }
    assert(!ctx.ec_garrison_reserve(view, ctx.ec_map(), view.ai.units, 1).has(2))
    view.ai.units.push({ id: 88, faction: 0, class: "ground", location: 20, cf: 5 })
    assert(!ctx.ec_garrison_reserve(view, ctx.ec_map(), view.ai.units, 1).has(2))
    view.ai.units.pop()
    view.turn = 11
    assert(ctx.ec_garrison_reserve(view, ctx.ec_map(), view.ai.units, 1).has(2))
})

test("1943 resource sprint releases safe garrisons but protects threatened gains and blockade", () => {
    const { ctx, view } = fixture()
    ctx.map.find(m => m.id === 10).resource = 1
    view.turn = 9
    view.ai.victory.jpResources = 4
    view.ai.victory.atomic = { noStrategicBombingFailure: true, b29InRangeOfTokyo: true }
    const reserved = () => ctx.ec_garrison_reserve(view, ctx.ec_map(), view.ai.units, 1).has(2)
    assert.equal(reserved(), false)
    view.ai.units.push({ id: 91, faction: 0, class: "ground", location: 20, cf: 4 })
    assert.equal(reserved(), true)
    view.ai.units.pop()
    view.ai.victory.blockade = { startedTurn: 8 }
    assert.equal(reserved(), true)
    view.ai.victory.blockade = { startedTurn: 0 }
    view.turn = 12
    view.political_will = 5
    view.ai.units.push({ id: 91, faction: 0, class: "ground", location: 20, cf: 4 })
    assert.equal(reserved(), false, "last-turn atomic push may use a threatened resource garrison")
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

test("convergence keeps independently legal ground and naval origins through movement", () => {
    const {ctx,view,calls} = fixture({paths:(ids,c,v)=>ids.every(id=>v.ai.units.find(u=>u.id===id).location
        ===v.ai.units.find(u=>u.id===ids[0]).location) && (c.move_type===4||c.move_type===2) ? [20]:[]})
    view.ai.units.find(u=>u.id===3).location=15
    const env={view,faction:1,units:view.ai.units,available:view.ai.units.filter(u=>u.class!=="hq"),
        byHex:new Map(ctx.map.map(m=>[m.id,{...m,hex:m.id}])),hq:view.ai.units[0],budget:3,cardId:9,cardMode:"ops",
        captureTargets:new Set([20]),axisTargets:new Set([20]),garrisonReserve:new Set(),moves:new Map(),reactions:new Map(),homeAssaults:new Map(),
        victory:{homelandKeys:[20],b29Bases:[],resourceTargets:[],routes:{homeland:{remainingKeys:[20]},headquarters:{enemyHqCount:1}}},powGap:0}
    const tasks=ctx.ec_ground_convergence(env)
    const task=tasks.find(t=>t.movementUnitIds.length===3)
    assert(task && task.assessment.executable)
    assert.deepEqual(plain(task.movementGroups),[
        {originHex:10,mode:"GROUND",unitIds:[2]},
        {originHex:0,mode:"GROUND",unitIds:[4]},
        {originHex:15,mode:"NAVAL",unitIds:[3]},
    ])
    const plan=plain(ctx.ec_plan(view,{role:"Allies"}))
    plan.preCard=false
    plan.tasks=[plain(task)]
    plan.targets=[{hex:20,kind:"CONQUEST",requiredUnits:task.requiredUnits,movementUnitIds:task.movementUnitIds,
        supportUnitIds:[],movementModes:["GROUND"],movementGroups:plain(task.movementGroups),taskId:task.id,campaignTask:true}]
    view.ai.plan=plan;view.ai.state="move_units";view.prompt="Move units.";view.actions={unit:[2,3,4]}
    Object.assign(view.offensive,{attacker:1,offensive_card:9,type:0,active_units:[[],[2,3,4]],active_hq:[null,1]})
    const preserved=ctx.ec_apply_plan(view,{role:"Allies"})
    assert.equal(preserved.tasks.length,1,"different origins are not revalidated as one illegal stack")
    assert(calls.filter(c=>c.type==="move").every(c=>c.ids.every(id=>view.ai.units.find(u=>u.id===id).location
        ===view.ai.units.find(u=>u.id===c.ids[0]).location)))
})

test("card choice assignments survive the HQ window while legal",()=>{
    const {ctx,view}=fixture()
    const prior=plain(ctx.ec_plan(view,{role:"Allies"}))
    prior.tasks[0].score=987;prior.campaign.opportunity="only remaining executable card"
    view.ai.plan=prior;view.ai.state="choose_hq";view.prompt="OC: 3 Ops. Choose HQ.";view.actions={unit:[1]}
    Object.assign(view.offensive,{attacker:1,offensive_card:9,type:0,active_cards:[9]})
    const kept=ctx.ec_apply_plan(view,{role:"Allies"})
    assert.deepEqual(plain(kept.tasks),prior.tasks)
    assert.equal(kept.preCard,false)
    assert.equal(kept.campaign.opportunity,prior.campaign.opportunity)
})

test("an invalid path forces replanning before HQ activation",()=>{
    let closed=false
    const {ctx,view}=fixture({paths:(ids,c)=>!closed&&c.move_type===8&&ids.includes(2)&&ids.includes(3)?[20]:[]})
    const prior=plain(ctx.ec_plan(view,{role:"Allies"}))
    assert(prior.tasks.length)
    view.ai.plan=prior;view.ai.state="choose_hq";view.prompt="OC: 3 Ops. Choose HQ.";view.actions={unit:[1]}
    Object.assign(view.offensive,{attacker:1,offensive_card:9,type:0,active_cards:[9]})
    closed=true
    assert.equal(ctx.ec_apply_plan(view,{role:"Allies"}).tasks.length,0)
})

test("two-port amphibious convergence shares one combat estimate and sums ASP",()=>{
    const {ctx,view}=fixture({paths:(ids,c,v)=>c.move_type===8&&ids.some(id=>v.ai.units.find(u=>u.id===id).class==="naval")
        &&ids.every(id=>v.ai.units.find(u=>u.id===id).location===v.ai.units.find(u=>u.id===ids[0]).location)?[20]:[]})
    Object.assign(view.ai.units.find(u=>u.id===4),{asp:true,aspCost:1,service:"navy"})
    view.ai.units.push({id:6,faction:1,class:"naval",cf:10,location:0,service:"navy"},
        {id:7,faction:0,class:"ground",cf:4,lf:12,location:20})
    view.asp[1]=[2,0]
    const estimates=[];ctx.em_ground_outcome=p=>{estimates.push(p);return {pWin:1}}
    const env={view,faction:1,units:view.ai.units,available:view.ai.units.filter(u=>u.faction===1&&u.class!=="hq"),
        byHex:new Map(ctx.map.map(m=>[m.id,{...m,hex:m.id}])),hq:view.ai.units[0],budget:4,cardId:9,cardMode:"ops",
        captureTargets:new Set([20]),axisTargets:new Set([20]),garrisonReserve:new Set(),moves:new Map(),reactions:new Map(),homeAssaults:new Map(),
        victory:{homelandKeys:[20],b29Bases:[],resourceTargets:[],routes:{homeland:{remainingKeys:[20]},headquarters:{enemyHqCount:1}}},powGap:0}
    const tasks=ctx.ec_amphibious_convergence(env)
    assert(tasks.length)
    assert.equal(tasks[0].aspCost,2)
    assert.equal(tasks[0].movementGroups.length,2)
    assert(tasks[0].movementGroups.every(g=>g.mode==="AA"&&g.unitIds.some(id=>view.ai.units.find(u=>u.id===id).class==="naval")))
    assert(estimates.every(p=>p.defMods===3 && p.attLfs.length===2 && p.attLfs.every(lf=>lf===6)))
    assert.equal(ctx.ec_amphibious_convergence({...env,budget:3}).length,0)
    view.asp[1]=[1,0]
    assert.equal(ctx.ec_amphibious_convergence(env).length,0)
    view.asp[1]=[2,0]
    view.ai.units.push({id:8,faction:1,class:"air",location:20},{id:10,faction:1,class:"air",location:20})
    assert.equal(ctx.ec_amphibious_convergence(env).length,0,"existing friendly air also occupies the landing slots")
})

test("outer homeland rally needs met PoW, a compatible amphibious force, and no nearer staffed port",()=>{
    const {ctx,view,owned}=fixture()
    ctx.get_distance=(a,b)=>a===b?0:a===10&&b===20||a===20&&b===10?7:9
    view.capture=[15];view.pow=1
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,true),10)
    view.ai.plan={campaign:{rallyPort:10}};view.pow=2
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,true),null,"cached outer rally cannot bypass new PoW gap")
    view.pow=1;view.inter_service[1]=1;view.ai.units.find(u=>u.id===2).service="army"
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,true),null)
    view.inter_service[1]=0;view.ai.units.find(u=>u.id===2).asp=false;view.ai.units.find(u=>u.id===2).aspCost=0
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,true),null)
    view.ai.units.find(u=>u.id===2).asp=true;owned.delete(10)
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,true),null)
    owned.add(10);ctx.get_distance=(a,b)=>a===b?0:a===10&&b===20||a===20&&b===10?8:9
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,true),10)
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,false),null)
    view.ai.units.push({id:25,faction:1,class:"naval",location:15})
    ctx.get_distance=(a,b)=>a===b?0:a===15&&b===20||a===20&&b===15?4:a===10&&b===20||a===20&&b===10?8:9
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,true),15,"new inner rally replaces outer one")
    owned.add(20)
    ctx.get_distance=(a,b)=>a===b?0:7
    assert.equal(ctx.ec_homeland_rally(view,ctx.ec_map(),view.ai.units,1,true),null,"no new outer assault rally after all keys held")
})

test("empty landing includes a legal overland reaction, without a prior-ground defense modifier",()=>{
    const {ctx,view}=fixture()
    const enemy={id:70,faction:0,class:"ground",cf:9,lf:12,location:15,service:"army"}
    view.ai.units.push(enemy);view.ai.units.find(u=>u.id===2).cf=4
    ctx.querySpecialReaction=()=>({eligible:true})
    ctx.queryReactionCandidates=opts=>{assert.equal(opts.targetOnly,true);return {ground:[70],groundOverland:[70],
        hqOptions:[{hq:90,budget:1,units:[70]}]}}
    let defenderModifier
    ctx.em_ground_outcome=x=>{defenderModifier=x.defMods;return {pWin:x.attCF>x.defCF?1:0}}
    const env={units:view.ai.units,view,faction:1,powGap:0,byHex:new Map(ctx.ec_map().map(m=>[m.hex,m]))}
    const group=view.ai.units.filter(u=>[2,3].includes(u.id))
    const result=ctx.ec_assess(group,[],20,true,env)
    assert.equal(result.pCapture,.65);assert.equal(result.pGroundWithReaction,0)
    assert.deepEqual(plain(result.reactionGroundUnitIds),[70]);assert.equal(defenderModifier,0)
    assert.equal(ctx.ec_assess(group,[],20,true,{...env,requireGroundReactionCover:true}).rejection,"insufficient-ground-reaction-cover")
    assert.equal(ctx.ec_assess(group,[],20,true,{...env,requireGroundReactionCover:true}).executable,false)
    const land=ctx.ec_assess([group[0]],[],20,false,{...env,reactions:new Map()})
    assert.equal(land.pCapture,1);assert.deepEqual(plain(land.reactionGroundUnitIds),[])
    ctx.querySpecialReaction=()=>({eligible:false})
    assert.equal(ctx.ec_assess(group,[],20,true,{...env,specialReactions:new Map()}).pCapture,1)
})

test("reaction ground and sea peaks from different HQs never form one force",()=>{
    const {ctx,view}=fixture()
    view.ai.units.push({id:70,faction:0,class:"ground",cf:30,lf:12,location:15},
        {id:71,faction:0,class:"naval",cf:20,location:15})
    view.ai.units.find(u=>u.id===3).cf=40
    ctx.querySpecialReaction=()=>({eligible:true})
    ctx.em_ground_outcome=x=>({pWin:x.attCF>x.defCF?1:0})
    ctx.em_naval_outcome=x=>({pWin:x.attCF>x.defCF?1:0})
    ctx.queryReactionCandidates=()=>({ground:[70],groundOverland:[70],naval:[71],
        hqOptions:[{hq:90,budget:1,units:[71]},{hq:91,budget:1,units:[70]}]})
    const r=ctx.ec_assess(view.ai.units.filter(u=>[2,3].includes(u.id)),[],20,true,
        {units:view.ai.units,view,faction:1,powGap:0,byHex:new Map(ctx.ec_map().map(m=>[m.hex,m]))})
    assert.equal(r.reactionHq,91);assert.equal(r.potentialReaction,0);assert.equal(r.potentialGroundReaction,30)
    assert.equal(r.reactionBudget,1);assert.deepEqual(plain(r.reactionGroundUnitIds),[70])
    view.ai.units.find(u=>u.id===3).cf=4
    const tied=ctx.ec_assess(view.ai.units.filter(u=>[2,3].includes(u.id)),[],20,true,
        {units:view.ai.units,view,faction:1,powGap:0,requireGroundReactionCover:true,byHex:new Map(ctx.ec_map().map(m=>[m.hex,m]))})
    assert.equal(tied.reactionHq,90,"sea wins the tie without erasing a different legal ground threat")
    assert.equal(tied.executable,false);assert.equal(tied.uncoveredGroundReaction.hq,91)
})

test("outer assembly rewards a single HQ that can command enough fleet, without requiring current ground range",()=>{
    const {ctx,view}=fixture({paths:(ids,c)=>c.move_type===2?[20]:[]})
    view.ai.units.push({id:30,faction:1,class:"naval",cf:8,location:10,supply:3},
        {id:31,faction:1,class:"naval",cf:8,location:10,supply:3},
        {id:8,faction:1,class:"hq",location:10,supply:1,cm:1},
        {id:70,faction:0,class:"air",cf:20,br:2,location:20})
    Object.assign(view.ai.units.find(u=>u.id===1),{supply:2,cm:3})
    Object.assign(view.ai.units.find(u=>u.id===3),{supply:3,br:2})
    const ground=view.ai.units.find(u=>u.id===4);ground.supply=1
    view.ai.ownCards.push({id:11,ops:2,allowed:["ops"]})
    ctx.queryCardPreview=(card,c)=>({eligible:true,units:[3,30,31],activationBudget:c.hqId===1?5:3})
    ctx.em_naval_outcome=x=>({pWin:x.attCF>x.defCF?1:0})
    const env={view,faction:1,units:view.ai.units,cardId:9,byHex:new Map(ctx.ec_map().map(m=>[m.hex,m])),powGap:0}
    assert.equal(ctx.ec_assembly_command(ground,10,20,env),null,"small compatible HQ cannot borrow another HQ's budget")
    ground.supply=2
    const screen=ctx.ec_assembly_command(ground,10,20,{...env,assemblyCommands:new Map()})
    assert.equal(screen.hqId,1);assert.equal(screen.cardId,11);assert.equal(screen.requiredActivations,4)
    assert.equal(screen.navalReadinessEstimate,1);assert(screen.evidence.includes("revalidation"))
    view.ai.ownCards=[view.ai.ownCards[0]]
    assert.equal(ctx.ec_assembly_command(ground,10,20,{...env,assemblyCommands:new Map()}),null,"transport card is not also a next offensive")
})

test("effective Japanese ASP and movement history preserve each origin",()=>{
    const {ctx,view}=fixture();view.asp[0]=[6,1];view.inter_service[0]=1
    assert.equal(ctx.ec_asp_remaining(view,0),2);assert.equal(ctx.ec_asp_remaining(view,1),4)
    view.ai.units.find(u=>u.id===2).location=15;view.ai.units.find(u=>u.id===4).location=15
    const prior={turn:view.turn,tasks:[{kind:"REDEPLOY",originHex:10,hex:15,movementUnitIds:[2,4],
        movementGroups:[{originHex:10,unitIds:[2]},{originHex:0,unitIds:[4]}]}]}
    const history=plain(ctx.ec_redeploy_history(view,prior,1))
    assert.deepEqual(history.map(x=>[x.unit,x.from,x.to]),[[2,10,15],[4,0,15]])
})

test("explicit next-card OC mode cannot inherit the current Tsuji event modifier",()=>{
    const {ctx,view}=fixture();ctx.COL_TSUJI=87
    ctx.map.find(m=>m.id===20).terrain=2
    view.offensive.type=1
    view.ai.units.push({id:70,faction:1,class:"ground",cf:4,lf:12,location:20})
    const mods=[];ctx.em_ground_outcome=x=>{mods.push(x.attMods);return {pWin:1}}
    const env={units:view.ai.units,view,faction:0,powGap:0,cardId:87,cardMode:"ops",byHex:new Map(ctx.ec_map().map(m=>[m.hex,m]))}
    const ground={id:71,faction:0,class:"ground",cf:18,lf:12,location:15}
    ctx.ec_assess([ground],[],20,false,env)
    assert(mods.length>0 && mods.every(x=>x===-1),"OC uses terrain, never +4 from the previous EC")
    mods.length=0;ctx.ec_assess([ground],[],20,false,{...env,cardMode:"event"})
    assert(mods.length>0 && mods.every(x=>x===4))
})

test("land continuation uses a reserved homeland army to gain fresh PoW and exposes retention risk",()=>{
    const {ctx,view}=fixture({paths:(ids,c)=>c.move_type===4 && ids.includes(2)?[20]:[]})
    view.turn=8;view.capture=[10];view.pow=2;view.ai.victory.homelandKeys=[10,20]
    ctx.map.find(m=>m.id===10).region="Japan";ctx.map.find(m=>m.id===20).region="Japan"
    view.ai.units.push({id:70,faction:0,class:"ground",cf:6,lf:12,location:20})
    ctx.em_ground_outcome=()=>({pWin:1})
    const plan=ctx.ec_plan(view,{role:"Allies"})
    const task=plan.tasks.find(t=>t.hex===20)
    assert(task);assert(plan.garrisonReserveIds.includes(2));assert.equal(task.objective,"POW")
    assert.equal(task.victoryObjective,"HOMELAND");assert.equal(plan.targets[0].victoryObjective,"HOMELAND")
    assert(plan.pow.attainableCaptureTargets.some(t=>t.hex===20))
    assert.deepEqual(plain(task.retentionRisks).map(r=>r.hex),[10]);assert.equal(plan.pow.retentionRisks.length,1)
    ctx.map.find(m=>m.id===20).named=false
    const unnamed=ctx.ec_plan(view,{role:"Allies"})
    assert.equal(unnamed.tasks.find(t=>t.hex===20).objective,"HOMELAND")
    assert(!unnamed.pow.attainableCaptureTargets.some(t=>t.hex===20))
    ctx.map.find(m=>m.id===20).named=true;view.capture=[10,20]
    assert.equal(ctx.ec_plan(view,{role:"Allies"}).tasks.find(t=>t.hex===20).objective,"HOMELAND","a recaptured ledger entry is not fresh credit")
})

test("a two-port homeland landing can itself fill a fresh PoW gap",()=>{
    const {ctx,view}=fixture({paths:(ids,c)=>c.move_type===8
        && (ids.includes(2)&&ids.includes(3)||ids.includes(4)&&ids.includes(5))?[20]:[]})
    view.turn=11;view.pow=4;view.capture=[]
    Object.assign(view.ai.units.find(u=>u.id===4),{asp:true,aspCost:1})
    view.ai.units.push({id:5,faction:1,class:"naval",location:0,cf:12,service:"army"},
        {id:70,faction:0,class:"ground",location:20,cf:20,lf:12})
    ctx.em_ground_outcome=x=>({pWin:x.attCF>=20?1:0})
    const plan=ctx.ec_plan(view,{role:"Allies"})
    const task=plan.tasks.find(t=>t.hex===20 && t.movementGroups?.length===2)
    assert(task);assert(plan.pow.gap>0);assert.equal(task.objective,"POW")
    assert.equal(task.victoryObjective,"HOMELAND");assert.equal(task.aspCost,2)
    assert(plan.pow.attainableCaptureTargets.some(t=>t.hex===20))
    ctx.map.find(m=>m.id===20).named=false
    const unnamed=ctx.ec_plan(view,{role:"Allies"})
    assert.equal(unnamed.tasks.find(t=>t.movementGroups?.length===2).objective,"HOMELAND")
    assert(!unnamed.pow.attainableCaptureTargets.some(t=>t.hex===20))
    ctx.map.find(m=>m.id===20).named=true;view.capture=[20]
    const retaken=ctx.ec_plan(view,{role:"Allies"})
    assert.equal(retaken.tasks.find(t=>t.movementGroups?.length===2).objective,"HOMELAND")
    assert(!retaken.pow.attainableCaptureTargets.some(t=>t.hex===20))
    view.capture=[];view.inter_service[1]=1
    assert(!ctx.ec_plan(view,{role:"Allies"}).tasks.some(t=>t.movementGroups?.length===2),"ISR cannot combine army and navy groups")
})

test("homeland reserve exception cannot release a foreign resource garrison",()=>{
    const {ctx,view}=fixture({paths:(ids,c)=>c.move_type===4 && ids.includes(4)?[20]:[]})
    view.turn=8;view.capture=[0];view.pow=2;ctx.map.find(m=>m.id===0).resource=1
    view.ai.units=view.ai.units.filter(u=>u.id!==2)
    const plan=ctx.ec_plan(view,{role:"Allies"})
    assert(plan.garrisonReserveIds.includes(4))
    assert(!plan.tasks.some(t=>t.kind==="CONQUEST" && t.requiredUnits.includes(4)))
})

test("an unmet PoW quota still evaluates fully legal amphibious homeland captures",()=>{
    const {ctx,view}=fixture()
    view.turn=8;view.pow=1;view.capture=[]
    let calls=0
    ctx.ec_amphibious_convergence=()=>{calls++;return []}
    ctx.ec_plan(view,{role:"Allies"})
    assert(calls>0,"a fresh named homeland landing may itself satisfy PoW")
    view.pow=0
    ctx.ec_plan(view,{role:"Allies"})
    assert(calls>1,"the existing amphibious branch remains available after meeting PoW")
})

test("Japanese aircraft leave a ground assembly slot when another legal base exists",()=>{
    const {ctx,view}=fixture()
    const position={version:1,role:"Japan",focus:20,pacificFocus:20,groundAssemblyPorts:[10],
        bases:[{hex:10,airfield:true,port:true},{hex:15,airfield:true,port:true}],
        units:[{id:2,class:"ground",location:10},{id:3,class:"air",location:10}]}
    const crowded=ctx.ec_position_score(10,0,{id:4,class:"air",service:"army"},null,position)
    const alternate=ctx.ec_position_score(15,0,{id:4,class:"air",service:"army"},null,position)
    assert.equal(crowded.reason,"preserve-ground-assembly-slots")
    assert.equal(crowded.score[1],1);assert.equal(alternate.score[1],0)
    position.units.push({id:5,class:"ground",location:10});position.units=position.units.filter(u=>u.id!==3)
    assert.equal(ctx.ec_position_score(10,0,{id:4,class:"air"},null,position).score[1],0,"two armies can share their remaining slot with air support")
})

function preparationFixture() {
    const {ctx,view,owned}=fixture({paths:(ids,c)=>c.move_type===1 && ids.includes(4)?[10,15]
        : c.move_type===1 && ids.includes(90)?[15] : c.move_type===2?[20,30] : c.move_type===8?[20]:[]})
    ctx.map.push({id:30,name:"Resource goal",named:true,resource:1,port:true,region:"Pacific"})
    ctx.map.find(m=>m.id===15).airfield=true
    ctx.querySpaceControlled=(hex,f)=>f===1?owned.has(hex):[20,30].includes(hex)
    ctx.ec_homeland_drive=()=>true
    view.turn=8;view.pow=0;view.ai.ownCards.push({id:11,ops:3,allowed:["ops"]})
    for (const u of view.ai.units) if(u.faction===1)u.supply=1
    Object.assign(view.ai.units.find(u=>u.id===4),{asp:true,aspCost:1,cf:18})
    ctx.queryCardPreview=()=>({eligible:true,units:view.ai.units.filter(u=>u.class!=="hq").map(u=>u.id),activationBudget:5})
    ctx.queryGroundPreparation=(id,port,target,c)=>({eligible:!!(view.ai.units.find(u=>u.id===id).supply
        &view.ai.units.find(u=>u.id===c.hqId).supply),activationOnly:true})
    const env={view,faction:1,units:view.ai.units,available:view.ai.units.filter(u=>u.faction===1&&u.class!=="hq"),board:ctx.ec_map(),
        byHex:new Map(ctx.ec_map().map(m=>[m.hex,m])),hq:view.ai.units[0],budget:5,cardId:9,cardMode:"ops",powGap:0,powPressure:0,
        garrisonReserve:new Set(),moves:new Map(),reactions:new Map(),redeployments:[],campaignObjective:30,homelandApproach:false,
        homelandRallyPort:null,axisTargets:new Set(),homeAssaults:new Map(),blockers:[],
        victory:{homelandKeys:[20],b29Bases:[],resourceTargets:[30],routes:{homeland:{remainingKeys:[20]},headquarters:{enemyHqCount:1}}}}
    return {ctx,view,env}
}

test("1943 early preparation is separate from the existing homeland attack drive",()=>{
    const {ctx,view}=fixture();view.turn=5
    const north=[{hex:21,resource:1,region:"Manchuria"},{hex:22,resource:1,region:"Manchuria"}]
    ctx.querySpaceControlled=(h,f)=>f===0 && [21,22].includes(h)
    assert.equal(ctx.ec_homeland_preparation_enabled(view,north),true)
    assert.equal(ctx.ec_homeland_drive(view),false)
    view.turn=4;assert.equal(ctx.ec_homeland_preparation_enabled(view,north),false)
    view.turn=5;view.ai.ownCards.push({id:79,name:"Soviet invasion",allowed:["event"]})
    assert.equal(ctx.ec_homeland_preparation_enabled(view,north),false)
    view.ai.ownCards.pop();view.sid=7
    assert.equal(ctx.ec_homeland_preparation_enabled(view,north),false)
})

test("independent homeland preparation preserves resource transport and checks the actual witness HQ",()=>{
    const {ctx,env}=preparationFixture()
    env.homelandPreparation=ctx.ec_homeland_preparation(env)
    assert(env.homelandPreparation?.preparationOnly)
    assert.equal(env.homelandPreparation.rallyPort,10);assert.equal(env.homelandPreparation.targetHex,20)
    const tasks=ctx.ec_transport(env)
    assert(tasks.some(t=>t.hex===10 && t.followUpTarget===20 && t.objective==="HOMELAND_ASSEMBLE"))
    assert(tasks.some(t=>t.hex===15 && t.followUpTarget===30),"resource candidates survive the independent goal")
    env.units.find(u=>u.id===2).supply=2
    const checked=ctx.ec_homeland_preparation({...env,assemblyCommands:new Map(),assemblyPreviews:new Map(),assemblyArrivals:new Map(),assemblyFrames:new Map()})
    assert(checked);assert(!checked.groundIds.includes(2),"an uncommandable local army is not a second ground witness")
    assert(checked.groundIds.includes(4))
    assert.equal(ctx.ec_homeland_preparation({...env,powGap:1}),null,"preparation alone cannot spend a needed PoW card")
    env.units.push({id:70,faction:1,class:"air",location:10},{id:71,faction:1,class:"air",location:10})
    assert.equal(ctx.ec_homeland_preparation({...env,available:[env.units.find(u=>u.id===4)]}),null,"the receiving port needs a real slot")
})

test("an assault estimate cannot protect a source force without real AA reachability and effective ASP",()=>{
    const {ctx,env}=preparationFixture(),ground=env.units.find(u=>u.id===2)
    assert.equal(ctx.ec_source_assault_ready(ground,20,env),true)
    ctx.queryAspRemaining=()=>0
    assert.equal(ctx.ec_source_assault_ready(ground,20,env),false)
    ctx.queryAspRemaining=()=>4
    const move=ctx.queryGroupMovementDestinations
    ctx.queryGroupMovementDestinations=(ids,c)=>c.move_type===8?{reachableHexes:[],aspCost:1}:move(ids,c)
    assert.equal(ctx.ec_source_assault_ready(ground,20,env),false,"a legal naval route is not a ground AA route")
})

test("B29 priority also covers homeland preparation labelled as a garrison",()=>{
    const {ctx,env}=preparationFixture()
    env.units=env.units.filter(u=>u.id!==2);env.available=env.available.filter(u=>u.id!==2)
    env.view.ai.units=env.units;env.view.capture=[10]
    env.units.find(u=>u.id===4).cf=40
    env.units.push({id:90,faction:1,class:"air",b29:true,location:0,supply:1})
    env.available.push(env.units.at(-1));ctx.get_distance=(a,b)=>a===15&&b===40?7:Math.ceil(Math.abs(a-b)/2)
    env.homelandPreparation=ctx.ec_homeland_preparation(env)
    const tasks=ctx.ec_transport(env),b29=tasks.find(t=>t.objective==="B29_DEPLOYMENT")
    const garrison=tasks.find(t=>t.hex===10 && t.preparationOnly)
    assert(b29 && garrison);assert.equal(garrison.objective,"GARRISON")
    assert(garrison.score<b29.score,"home preparation bonus cannot bypass B29 protection through its displayed label")
})

test("naval preparation keeps a resource escort alternative at the same port",()=>{
    const {ctx,env}=preparationFixture()
    Object.assign(env.units.find(u=>u.id===3),{location:5,cf:30,br:2})
    env.units.push({id:31,faction:1,class:"naval",location:10,cf:8,supply:1})
    env.available=[env.units.find(u=>u.id===3)]
    const move=ctx.queryGroupMovementDestinations
    ctx.queryGroupMovementDestinations=(ids,c)=>c.move_type===1&&ids.includes(3)?{reachableHexes:[10],aspCost:0}:move(ids,c)
    ctx.get_distance=(a,b)=>a===10&&b===30?2:Math.ceil(Math.abs(a-b)/2)
    env.homelandPreparation={targetHex:20,rallyPort:10,preparationOnly:true}
    const tasks=ctx.ec_transport(env).filter(t=>t.movementUnitIds.includes(3)&&t.hex===10)
    assert(tasks.some(t=>t.followUpTarget===20));assert(tasks.some(t=>t.followUpTarget===30))
})

test("Japanese air transport and placement reserve the same two-ground bridgehead capacity",()=>{
    const {ctx,env}=preparationFixture()
    env.faction=0;env.homelandPreparation=null;env.campaignObjective=20
    env.board.find(m=>m.hex===10).airfield=true;env.byHex.get(10).airfield=true
    for (const m of ctx.map) if([10,20].includes(m.id))m.region="Java"
    env.board=ctx.ec_map();env.byHex=new Map(env.board.map(m=>[m.hex,m]))
    env.units=[{id:2,faction:0,class:"ground",location:10,cf:4},{id:3,faction:0,class:"air",location:10,cf:8},
        {id:90,faction:0,class:"air",location:0,cf:10,br:10}];env.available=[env.units[2]];env.view.ai.units=env.units
    ctx.ej_nations=()=>[{missingKeys:[20]}];ctx.querySpaceControlled=(h,f)=>f===0?[10,15].includes(h):h===20
    ctx.queryDefendingGround=()=>({units:[{id:71,cf:12}]})
    const move=ctx.queryGroupMovementDestinations
    ctx.queryGroupMovementDestinations=(ids,c)=>c.move_type===1&&ids.includes(90)?{reachableHexes:[10,15],aspCost:0}:move(ids,c)
    const tasks=ctx.ec_transport(env)
    assert(!tasks.some(t=>t.hex===10 && t.movementUnitIds.includes(90)))
    assert(tasks.some(t=>t.hex===15 && t.movementUnitIds.includes(90)))
})

test("Japanese launch ports preserve ground slots even when they are outside Java",()=>{
    const {ctx,env}=preparationFixture()
    ctx.ej_nations=()=>[{missingKeys:[20]}];ctx.queryDefendingGround=()=>({units:[{id:71,cf:12}]})
    for (const m of ctx.map) if(m.id===20)m.region="Java"
    const bases=[{hex:10,port:true,airfield:true,region:"Malaya"}]
    const own=[{id:2,class:"ground",location:10,cf:9},{id:3,class:"naval",location:10,cf:8},
        {id:4,class:"naval",location:10,cf:12}]
    assert.deepEqual(plain(ctx.ec_ground_assembly_ports(env.view,0,bases,own)),[10])
    assert.deepEqual(plain(ctx.ec_ground_assembly_ports(env.view,1,bases,own)),[])
    assert.deepEqual(plain(ctx.ec_ground_assembly_ports(env.view,0,bases,own.slice(0,2))),[])
})

test("battle estimation counts ebr air at effective CF without zeroing arriving naval CF",()=>{
    const {ctx,view}=fixture()
    const air={id:80,class:"air",faction:1,location:0,br:2,ebr:4,cf:20}
    ctx.queryPotentialCombatStrength=ids=>ids.includes(80)?10:0
    assert.equal(ctx.ec_battle_cf(air,20),10)
    assert.equal(ctx.ec_battle_cf({id:3,class:"naval",location:10,cf:8},20),8)
    const env={view,faction:1,units:[],budget:3,powGap:0,reactions:new Map(),groundDefenses:new Map(),
        specialReactions:new Map(),byHex:new Map(),victory:{resourceTargets:[]}}
    const estimate=ctx.ec_assess([{id:2,class:"ground",cf:12,lf:12},{id:3,class:"naval",cf:8,location:10}],[air],20,true,env)
    assert.equal(estimate.attackingAirSea,18)
})

test("strategic stacking facts share one planning scope without caching card/HQ paths or later positions",()=>{
    const {ctx}=fixture({paths:(ids,context)=>context.cardId===9?[10,15]:[15,20]})
    const seen=[],shared=new Map()
    let blocked=15
    ctx.queryProjectedStack=(hex,ids,options)=>{
        seen.push({hex,ids:[...ids],faction:options.faction})
        return {fitsForIncoming:hex!==blocked}
    }
    const env=(cardId,faction=1,cache=shared)=>({faction,cardId,hq:{id:cardId},cardMode:"ops",
        moves:new Map(),projectedStackFits:cache})
    assert.deepEqual(plain(ctx.ec_query_moves([2,3],1,env(9)).reachableHexes),[10])
    assert.deepEqual(plain(ctx.ec_query_moves([3,2,2],1,env(37)).reachableHexes),[20])
    assert.equal(seen.length,3,"shared full and blocked hex facts are queried once; distinct card paths still matter")
    assert.deepEqual(plain(ctx.ec_query_moves([2,3],1,env(37,0)).reachableHexes),[20])
    assert.equal(seen.length,5,"factions cannot share stacking facts")
    blocked=20
    assert.deepEqual(plain(ctx.ec_query_moves([2,3],1,env(37,1,new Map())).reachableHexes),[15])
    assert.equal(seen.length,7,"a later decision observes changed positions rather than the old cached rejection")
})

console.log(`Campaign planner: ${completed.length} source-level contracts passed`)
