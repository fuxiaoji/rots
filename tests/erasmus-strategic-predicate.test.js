"use strict"

// 战略层残余启发式精确化 golden 正反例 (PR5)。
// 纯求值器 eop_count_large_force_steps(大部队步数, 清单 #24) 与
// eop_is_target_complete(目标完成判定统一口径, 清单 #19/#25) 经 vm 载入 erasmus_ops.js
// 源码，在注入的 pieces/G/is_space_controlled/has_zoi 沙箱里逐条验证。

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const srcPath = path.join(__dirname, "..", "js", "server", "erasmus_ops.js")
const source = fs.readFileSync(srcPath, "utf8")

// 可注入的引擎桩：测试通过闭包变量切换控制/ZOI 结果，验证判定口径。
const state = {
    controlled: new Set(),   // 己方(AP/JP)控制的 hex
    enemyZoi: new Set(),     // 敌方有 AZOI 的 hex
}
const sandbox = {
    result: null,
    JP: 0, AP: 1,
    LAST_BOARD_HEX: 999,
    pieces: [],              // 由测试逐例填充
    G: { location: [], reduced: null },
    is_space_controlled: (hex, faction) => state.controlled.has(hex),
    has_zoi: (hex, faction) => state.enemyZoi.has(hex),
    get_map_data: () => ({ nh: [], port: false, island: false }),
}
vm.createContext(sandbox)
vm.runInContext(source + "\n;this.result = { steps: eop_count_large_force_steps, complete: eop_is_target_complete, pending: eop_target_pending };", sandbox)
const T = sandbox.result

const unit = (id, faction, cls, lf, reduced, loc) => ({ id, faction, class: cls, lf, cf: lf, rcf: Math.ceil(lf / 2), reduced, location: loc })

// ============================================================================
// 1. 大部队地面步数：lf≥12 计入；full=2 / reduced=1；lf<12 或非地面不计入。
// ============================================================================
{
    const steps = T.steps
    // 构造 pieces：id=1 满编 lf=14 地面(Burma)、id=2 减损 lf=12 地面(Burma)、
    // id=3 lf=8 地面(Burma，不足门槛)、id=4 满编 lf=14 地面(其他区)、id=5 海军 lf=14。
    sandbox.pieces = [
        null,
        unit(1, 0, "ground", 14, false, 10),
        unit(2, 0, "ground", 12, true, 11),
        unit(3, 0, "ground", 8, false, 12),
        unit(4, 0, "ground", 14, false, 20),
        unit(5, 0, "naval", 14, false, 13),
    ]
    sandbox.G.location = [null, 10, 11, 12, 20, 13]
    const regionOf = h => (h >= 10 && h <= 12) ? "Burma" : "Other"
    // 全图：满编 lf14(2) + 减损 lf12(1) + 满编 lf14(2) = 5；lf8 与海军不计。
    assert.equal(steps(0, null, regionOf), 5, "全图大部队步数 = 2+1+2")
    // Burma 区(hex 10/11/12 → Burma，20 → Other)：满编 lf14(2) + 减损 lf12(1) = 3。
    assert.equal(steps(0, r => r === "Burma", regionOf), 3, "Burma 大部队步数 = 2+1")
    // 单步口径：reduced lf12 → 1 step（不是 1 枚），满编 lf14 → 2 step。
    assert.equal(steps(0, null, regionOf) > 0, true)
}

// ============================================================================
// 2. is_target_complete：按目标类型统一口径（不再一律「占格」）。
// ============================================================================
{
    const complete = T.complete
    const reset = () => { state.controlled.clear(); state.enemyZoi.clear() }

    // CONTROL/CONQUEST(meta=null)：己方控制即完成。
    reset(); state.controlled.add(100)
    assert.equal(complete("Allies", 100, null), true, "CONTROL 己控即完成")
    reset()
    assert.equal(complete("Allies", 100, null), false, "CONTROL 未控未完成")

    // SUPPRESS(requiresOccupation=true)：需「夺控且敌方无 AZOI」才完成。
    reset(); state.controlled.add(100)
    assert.equal(complete("Allies", 100, { kind: "SUPPRESS", requiresOccupation: true }), true, "SUPPRESS 夺控且无 AZOI")
    reset(); state.controlled.add(100); state.enemyZoi.add(100)
    assert.equal(complete("Allies", 100, { kind: "SUPPRESS", requiresOccupation: true }), false, "SUPPRESS 敌方仍有 AZOI 未完成")
    reset()
    assert.equal(complete("Allies", 100, { kind: "SUPPRESS", requiresOccupation: true }), false, "SUPPRESS 未夺控未完成")

    // SUPPRESS(requiresOccupation=false)：AZOI 被压制(敌无 AZOI)即完成。
    reset()
    assert.equal(complete("Allies", 100, { kind: "SUPPRESS" }), true, "SUPPRESS 仅压 AZOI，敌无 AZOI 即完成")
    reset(); state.enemyZoi.add(100)
    assert.equal(complete("Allies", 100, { kind: "SUPPRESS" }), false, "SUPPRESS 仅压 AZOI，敌有 AZOI 未完成")

    // GARRISON：驻军步数达标才完成（满编地面=2 step，减损=1 step）。
    sandbox.pieces = [null, unit(1, 1, "ground", 12, false, 50), unit(2, 1, "ground", 12, true, 50)]
    sandbox.G.location = [null, 50, 50]
    reset(); state.controlled.add(50)
    const garrison = { kind: "GARRISON", garrisonRequirement: { groundSteps: 2 } }
    assert.equal(complete("Allies", 50, garrison), true, "GARRISON 满编地面=2 step 达标")
    assert.equal(complete("Allies", 50, { kind: "GARRISON", garrisonRequirement: { groundSteps: 3 } }), true, "GARRISON 满编2+减损1=3 达标")
    assert.equal(complete("Allies", 50, { kind: "GARRISON", garrisonRequirement: { groundSteps: 4 } }), false, "GARRISON 3<4 未达标")
}

console.log("erasmus-strategic-predicate tests passed")
