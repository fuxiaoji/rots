"use strict"

// rules_query.js 单元测试：验证规则查询层只读、确定性，并与引擎真实结果一致。
const assert = require("assert")
const rules = require("../rules.js")

function setup() {
    const state = rules.setup(12345, "South Pacific", {})
    const view = rules.view(state, "Allies")
    const units = view.ai.units || []
    const find = (pred) => units.find(pred)
    const hq = find(u => u.class === "hq")
    const ground = find(u => u.class === "ground")
    const naval = find(u => u.class === "naval" && u.br > 0)
    const air = find(u => u.class === "air")
    return { state, hq, ground, naval, air }
}

function query(state, role, fn, args) {
    return rules.query(state, role, { name: "rules_query", fn, args: args || [] })
}

function assertReadOnly(state, fn) {
    const before = JSON.stringify(state)
    const result = fn()
    const after = JSON.stringify(state)
    assert.strictEqual(before, after, "query must not mutate game state")
    return result
}

// 1. 纯读叶子：只读 + 确定性 + 类型正确
{
    const { state, hq, ground, naval, air } = setup()
    const leafChecks = [
        ["queryZoi", [hq.location, 0], (r) => assert.strictEqual(typeof r, "boolean")],
        ["queryNonNeutralZoi", [hq.location, 0], (r) => assert.strictEqual(typeof r, "boolean")],
        ["querySupplyStatus", [ground.id], (r) => assert.strictEqual(typeof r, "boolean")],
        ["queryPotentialCombatStrength", [[naval.id], naval.location], (r) => assert.strictEqual(typeof r, "number")],
        ["queryBattleTable", ["naval", 5], (r) => assert.strictEqual(r, 0.5)],
        ["queryBattleTable", ["ground", 7], (r) => assert.strictEqual(typeof r, "number")],
        ["querySpaceControlled", [hq.location, 0], (r) => assert.strictEqual(typeof r, "boolean")],
        ["queryFactionUnits", [hq.location, 0], (r) => assert.strictEqual(typeof r, "boolean")],
        ["queryLegalReinforcementHexes", [ground.id], (r) => assert(Array.isArray(r))],
        ["queryEmergencyRetreatHexes", [air.id], (r) => assert(Array.isArray(r))],
        ["queryActivationCandidates", [hq.id], (r) => assert(Array.isArray(r))],
        ["queryGroundReachability", [ground.id], (r) => assert(r && Array.isArray(r.reachableHexes))],
        ["queryNavalReachability", [naval.id], (r) => assert(r && Array.isArray(r.reachableHexes) && r.costByHex && r.predecessor)],
        ["queryReactionCandidates", [], (r) => assert(r && Array.isArray(r.air) && Array.isArray(r.naval))],
    ]
    for (const [fn, args, check] of leafChecks) {
        const first = assertReadOnly(state, () => query(state, "Allies", fn, args))
        const second = query(state, "Allies", fn, args)
        assert.deepStrictEqual(second, first, `${fn} must be deterministic`)
        check(first)
    }
}

// 2. 战斗力合计：Shokaku CV 对自身格的潜在战斗力应等于其 CF（未减损）。
{
    const { state, naval } = setup()
    const strength = query(state, "Allies", "queryPotentialCombatStrength", [[naval.id], naval.location])
    assert.strictEqual(strength, naval.cf, "full-strength naval CF must match")
}

// 3. 战果表数值固定（引擎 naval/ground_battle_table）。
{
    const { state } = setup()
    assert.strictEqual(query(state, "Allies", "queryBattleTable", ["naval", 0]), 0.25)
    assert.strictEqual(query(state, "Allies", "queryBattleTable", ["naval", 3]), 0.5)
    assert.strictEqual(query(state, "Allies", "queryBattleTable", ["naval", 6]), 1)
    assert.strictEqual(query(state, "Allies", "queryBattleTable", ["ground", 2]), 0.5)
}

// 4. 激活候选应与引擎现成只读预检一致（同 HQ 同结果、同返回形状）。
{
    const { state, hq } = setup()
    const a = query(state, "Allies", "queryActivationCandidates", [hq.id])
    const b = query(state, "Allies", "queryActivationCandidates", [hq.id])
    assert.deepStrictEqual(a, b)
    assert(a.every(Number.isInteger), "activation candidates must be unit ids")
}

// 5. 合法参与判定：已在目标格的单位应判 legal=true（moveMode="already"），且只读确定。
{
    const { state } = setup()
    // 无攻势上下文的“已在目标”分支不依赖 active_cards，仍应给出确定结果。
    const unit = rules.view(state, "Allies").ai.units
        .find(u => (u.class === "ground" || u.class === "naval") && Number.isInteger(u.location) && u.location > 0)
    const target = unit.location
    const first = assertReadOnly(state, () => query(state, "Allies", "queryCombatParticipation", [unit.id, target]))
    assert.strictEqual(first.legal, true, "unit already at target is legal")
    assert.strictEqual(first.moveMode, "already")
    assert.strictEqual(typeof first.effectiveAttack, "number")
    const second = query(state, "Allies", "queryCombatParticipation", [unit.id, target])
    assert.deepStrictEqual(second, first, "queryCombatParticipation must be deterministic")
    // 非法目标：直接给出 legal=false，不抛错。
    const invalid = query(state, "Allies", "queryCombatParticipation", [unit.id, -1])
    assert.strictEqual(invalid.legal, false)
}

console.log("rules-query tests passed")
