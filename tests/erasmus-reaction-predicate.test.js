"use strict"

// Page 6 / Page 12 反应与 PBM 精确求值器的 golden 正反例 (PR4)。
// 纯求值器 (eop_evaluate_reaction_force_standard / eop_weather_reaction_standard /
// eop_pick_submarine_target) 不依赖引擎全局，经 vm 载入 erasmus_ops.js 源码逐条验证
// “反应兵力标准(含 D10 地面 2x) / 天气标准 / 潜艇目标优先级”。

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const srcPath = path.join(__dirname, "..", "js", "server", "erasmus_ops.js")
const source = fs.readFileSync(srcPath, "utf8")

const sandbox = { result: null, get_map_data: () => ({ nh: [], port: false, island: false }), is_space_controlled: () => false }
vm.createContext(sandbox)
vm.runInContext(source + "\n;this.result = { reactionForce: eop_evaluate_reaction_force_standard, weather: eop_weather_reaction_standard, subPick: eop_pick_submarine_target };", sandbox)
const T = sandbox.result

const unit = (cls, cf, extra) => Object.assign({ class: cls, cf, reduced: false, rcf: 0 }, extra || {})

// ============================================================================
// 1. REACTION_FORCE_STANDARD_MET：空海 1x + 空军数量 + D10 地面 2x
// ============================================================================
{
    const rf = T.reactionForce
    // 空海 1x + 空军数量：己方空海 9 ≥ 敌 8(5+3)、己方空军 1 ≥ 敌 1；D10=5(无地面要求) → complete
    let r = rf({ selectedReactionUnits: [unit("air", 9)], attackingUnits: [unit("naval", 5), unit("air", 3)], d10: 5 })
    assert.equal(r.airSeaOneXMet, true, "空海 9≥8")
    assert.equal(r.airCountMet, true, "空军 1≥1")
    assert.equal(r.groundTwoXRequired, false, "D10 5-9 无地面要求")
    assert.equal(r.complete, true)

    // 空海不足
    r = rf({ selectedReactionUnits: [unit("naval", 4)], attackingUnits: [unit("naval", 5)], d10: 5 })
    assert.equal(r.airSeaOneXMet, false)
    assert.equal(r.complete, false)

    // D10=0 → 地面 2x 必须；己方空海 9≥8、地面 4 ≥ 2×敌 2 → 满足
    r = rf({
        selectedReactionUnits: [unit("air", 9), unit("ground", 4)],
        attackingUnits: [unit("naval", 5), unit("air", 3), unit("ground", 2)],
        d10: 0,
    })
    assert.equal(r.groundTwoXRequired, true, "D10 0-4 地面须 2x")
    assert.equal(r.groundTwoXMet, true, "地面 4 ≥ 2×2")
    assert.equal(r.complete, true)

    // 地面不足 2x → 整体不达标
    r = rf({
        selectedReactionUnits: [unit("air", 9), unit("ground", 3)],
        attackingUnits: [unit("naval", 5), unit("air", 3), unit("ground", 2)],
        d10: 2,
    })
    assert.equal(r.groundTwoXRequired, true)
    assert.equal(r.groundTwoXMet, false, "地面 3 < 2×2")
    assert.equal(r.complete, false)
}

// ============================================================================
// 2. WEATHER_STANDARD_MET：d10 < 2×真实激活单位数 (CDSS 例：4 单位→需掷 < 8)
// ============================================================================
{
    const weather = T.weather
    assert.equal(weather({ activatedCount: 4, die: 7, surprise: false }), true, "7 < 8")
    assert.equal(weather({ activatedCount: 4, die: 8, surprise: false }), false, "8 不小于 8")
    assert.equal(weather({ activatedCount: 4, die: 9, surprise: false }), false)
    // 奇袭修正 -2：die 9 - 2 = 7 < 8 → true
    assert.equal(weather({ activatedCount: 4, die: 9, surprise: true }), true, "奇袭 -2 后 7<8")
    // 无激活单位 → 永不打天气
    assert.equal(weather({ activatedCount: 0, die: 0, surprise: false }), false)
}

// ============================================================================
// 3. 潜艇目标优先级：CV→BB→CA→DD；同类按防御值(lf)降序；稳定 id 破平
// ============================================================================
{
    const pick = T.subPick
    assert.equal(pick([]), undefined)
    const targets = [
        { id: 2, type: "dd", lf: 8 },
        { id: 1, type: "bb", lf: 10 },
        { id: 3, type: "cv", lf: 12 },
        { id: 4, type: "ca", lf: 6 },
    ]
    assert.equal(pick(targets).id, 3, "CV 优先")
    // 同类 CV 按 lf 降序
    assert.equal(pick([{ id: 1, type: "cv", lf: 9 }, { id: 2, type: "cv", lf: 14 }]).id, 2, "同类 CV 选 lf 高者")
    // 同类 lf 相同按 id 破平
    assert.equal(pick([{ id: 7, type: "bb", lf: 10 }, { id: 3, type: "bb", lf: 10 }]).id, 3, "lf 相同按 id 破平")
    // 无 CV/BB 时 CA 优先于 DD
    assert.equal(pick([{ id: 1, type: "dd", lf: 9 }, { id: 2, type: "ca", lf: 5 }]).id, 2, "CA 优先于 DD")
}

console.log("erasmus-reaction-predicate tests passed")
