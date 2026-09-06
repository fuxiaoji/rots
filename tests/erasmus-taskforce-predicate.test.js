"use strict"

// Page 5 / Page 11 任务部队 predicate 精确化的 golden 正反例 (PR2)。
// 纯求值器 (eop_can_ground_enter_exit / eop_meets_battle_support_standard /
// eop_evaluate_damage_level) 不依赖引擎全局, 经 vm 载入 erasmus_ops.js 源码,
// 用受控 mock 逐条验证“进入退出 / 支援标准 / 伤害等级(含地面 2x 生存)”。

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const srcPath = path.join(__dirname, "..", "js", "server", "erasmus_ops.js")
const source = fs.readFileSync(srcPath, "utf8")

// 受控引擎 mock: 地图格 {port,island,nh} 与 控制权 control[hex]=faction。
let MAP = {}
let CONTROL = {}
const sandbox = {
    result: null,
    get_map_data: h => MAP[h] || { nh: [], port: false, island: false },
    is_space_controlled: (h, f) => CONTROL[h] === f,
}
vm.createContext(sandbox)
vm.runInContext(source + "\n;this.result = { enterExit: eop_can_ground_enter_exit, support: eop_meets_battle_support_standard, damage: eop_evaluate_damage_level };", sandbox)
const T = sandbox.result

// ---- 单位/地图构造辅助 ----------------------------------------------------
const unit = (cls, cf, extra) => Object.assign({ class: cls, cf, reduced: false, rcf: 0 }, extra || {})
const byId = list => new Map(list.map(u => [u.id, u]))

// ============================================================================
// 1. GROUND_CAN_ENTER_EXIT 正反例
// ============================================================================
{
    const enterExit = T.enterExit
    // 进入 + 至少一个相邻合法出口
    MAP = { 100: { nh: [101, 102], port: false, island: false } }
    let r = enterExit(5, 100, { costByHex: { 100: 2, 101: 3 }, reachableHexes: [100, 101] })
    assert.equal(r.canEnter, true, "进得去")
    assert.equal(r.canExit, true, "有相邻出口")
    assert.deepEqual(r.exitHexes, [101])
    assert.equal(r.entryCost, 2)

    // 进入但无相邻出口 (死巷)
    r = enterExit(5, 100, { costByHex: { 100: 2 }, reachableHexes: [100] })
    assert.equal(r.canEnter, true)
    assert.equal(r.canExit, false, "无出口应 canExit=false")
    assert.deepEqual(r.exitHexes, [])

    // 进不去
    r = enterExit(5, 100, { costByHex: {}, reachableHexes: [] })
    assert.equal(r.canEnter, false, "进不去")
    assert.equal(r.canExit, false)
}

// ============================================================================
// 2. FORCE_MEETS_BATTLE_SUPPORT_STANDARD 正反例 (只判兵种构成)
// ============================================================================
{
    const support = T.support
    const FACTION = 0 // 攻击方 Japan
    // 占领目标: 需地面; 非沿海不加海军要求
    MAP = { 200: { nh: [], port: false, island: false } }
    CONTROL = {}
    let m = { kind: "CONQUEST", requiresOccupation: true }
    assert.equal(support(m, [unit("ground", 4)], 200, FACTION).met, true, "占领需地面, 有地面→met")
    assert.deepEqual(support(m, [unit("air", 4)], 200, FACTION).missing, ["ground"], "占领缺地面")
    assert.equal(support(m, [unit("air", 4)], 200, FACTION).met, false)

    // 沿海敌控港口的两栖登陆: 需地面 + 海军护航
    MAP = { 201: { nh: [], port: true, island: false } }
    CONTROL = { 201: 1 } // 敌方控制
    const landing = support(m, [unit("ground", 4)], 201, FACTION)
    assert.deepEqual(landing.missing, ["naval"], "两栖登陆缺海军护航")
    assert.equal(landing.met, false)
    assert.equal(support(m, [unit("ground", 4), unit("naval", 2, { br: 1 })], 201, FACTION).met, true, "地面+海军→met")

    // 压制目标: 需航空/航母(远程支援), 地面不算
    let s = { kind: "SUPPRESS" }
    assert.equal(support(s, [unit("air", 4)], 200, FACTION).met, true)
    assert.deepEqual(support(s, [unit("ground", 4)], 200, FACTION).missing, ["air-sea"], "压制缺空海支援")
    assert.equal(support(s, [unit("ground", 4)], 200, FACTION).met, false)
    assert.equal(support(s, [unit("naval", 2, { br: 2 })], 200, FACTION).met, true, "有射程海军=远程支援")
}

// ============================================================================
// 3. TARGET_DAMAGE_LEVEL_MET 正反例 (伤害等级 + 地面 2x 生存)
// ============================================================================
{
    const damage = T.damage
    // 空海打击: 攻击 CF 需达到 (守军+反应)/damageLevel
    let meta = { requiresOccupation: false, kind: "CONQUEST", damageLevel: 1 }
    // 守军 4, 无反应 → 需 >= 4
    assert.equal(damage(meta, [unit("air", 4)], [unit("air", 4)], [], new Map(), 300).met, true)
    assert.equal(damage(meta, [unit("air", 3)], [unit("air", 4)], [], new Map(), 300).met, false, "攻击不足")

    // 反应兵力计入防御: 守军 2 + 反应 2 = 4
    const reaction = byId([Object.assign(unit("air", 2), { id: 99 })])
    assert.equal(damage(meta, [unit("air", 5)], [unit("air", 2)], [99], reaction, 300).met, true)
    assert.equal(damage(meta, [unit("air", 3)], [unit("air", 2)], [99], reaction, 300).met, false, "反应兵力须计入")

    // 占领目标: 地面 2x 生存。守军地面 2 → 攻击地面需 >= 4
    meta = { requiresOccupation: true, kind: "CONQUEST", damageLevel: 1 }
    const d = (groundCf) => damage(meta, [unit("air", 10), unit("ground", groundCf)], [unit("ground", 2)], [], new Map(), 300)
    assert.equal(d(4).groundSurvivalMet, true)
    assert.equal(d(4).met, true)
    assert.equal(d(3).groundSurvivalMet, false, "地面 3 < 2x 守军 2")
    assert.equal(d(3).met, false, "地面生存不足→整体不达标")

    // 无地面守军: 只要 ≥1 地面即可占领
    const noDef = damage(meta, [unit("ground", 1)], [], [], new Map(), 300)
    assert.equal(noDef.groundSurvivalMet, true)
    assert.equal(noDef.met, true)
}

console.log("erasmus-taskforce-predicate tests passed")
