"use strict"

// C 保真扩展用例: 事件战略内容绑定(erasmus-v2.0-zh.7)。
// py 三处口径 —— JP 中/晚期表目标 = "同早期阶段事件战略"(指针);
// AL mid/late 决策树 return AL_EARLY_STRATEGIES["事件战略"](共用早期条目,
// JS AL mid/late 库无此键, 原实现静默落空 EVENT)。
// 断言: 无论哪方哪阶段选中事件战略, esm_bind_strategy_entry 都绑定到【早期】条目,
// 且早期条目解析出的事件清单行数 = 8(JP)/6(AL), 无 hex 链(纯事件清单)。
// 纯函数 vm 加载, 不进引擎(与 goal-fidelity 同法)。
const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const srcPath = path.join(__dirname, "..", "js", "server", "erasmus_state.js")
const source = fs.readFileSync(srcPath, "utf8")
const sandbox = { result: null }
vm.createContext(sandbox)
vm.runInContext(source + `
;this.result = {
    jp: ESM_JP_LIB, al: ESM_AL_LIB,
    regFrom: esm_reg_from_entries, parseEntry: esm_parse_entry, bind: esm_bind_strategy_entry,
};`, sandbox)
const T = sandbox.result

const mapNames = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "erasmus", "map_names.json"), "utf8"))
function buildReg() {
    const land = new Map(), named = new Map()
    for (const [k, v] of Object.entries(mapNames.landHexes)) { if (v && v.region) land.set(+k, { region: v.region }) }
    for (const [k, v] of Object.entries(mapNames.hexes)) {
        if (!v || !v.name) continue
        named.set(+k, { name: v.name, region: v.region, resource: !!v.resource })
    }
    return T.regFrom(land, named)
}
const REG = buildReg()

const ROLE = r => (r === "JP" ? "Japan" : "Allies")
const EXPECT_LINES = { JP: 8, AL: 6 }

let checked = 0
for (const R of ["JP", "AL"]) {
    const role = ROLE(R)
    for (const phase of ["early", "mid", "late"]) {
        const entry = T.bind(role, phase, "事件战略")
        assert(entry, `${R} ${phase} 事件战略 必须绑定到条目(原 AL mid/late 落空 bug)`)
        assert.equal(entry.name, "事件战略", `${R} ${phase} name`)
        assert.equal(entry.targets.length, EXPECT_LINES[R], `${R} ${phase} 事件战略 应含早期清单 ${EXPECT_LINES[R]} 行, 实得 ${entry.targets.length}`)
        const goals = T.parseEntry(entry, role, "early", REG)
        assert.equal(goals.length, EXPECT_LINES[R], `${R} ${phase} 清单逐行解析为 ${EXPECT_LINES[R]} Goal`)
        for (const g of goals) assert.equal(g.hexes.length, 0, `${R} ${phase} 事件清单无 hex 链`)
        checked++
    }
}
// 非事件战略的正常绑定: 本阶段条目不被早期条目顶替
{
    const m = T.bind("Japan", "mid", "外围防御战略")
    assert(m && m.targets.length > 0, "Japan/mid 外围防御战略 正常绑定")
    const p = T.bind("Allies", "mid", "南太平洋战略")
    assert(p && p.targets.length >= 10, "Allies/mid 南太平洋战略 正常绑定")
    checked += 2
}
console.log(`event-strategy binding fidelity: ${checked} cases passed (JP/AL × early/mid/late → early 事件清单 8/6 行)`)
