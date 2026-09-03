"use strict"

// A 层保真对拍: JS parse_goals 移植(js/server/erasmus_state.js) 对 py 参考引擎
// 的输出金标(tests/results/py-goals-golden.json, 由 tests/_py_goal_golden.py 生成)。
// 逐策略比较: 行数 / 每行 kind / 每行 hex 列表(内部 idx) —— 逐项相等才算通过。
// 地图注册表 = data/erasmus/map_names.json(py 与 engine 同源导出)。
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
    regFrom: esm_reg_from_entries, parseEntry: esm_parse_entry,
};`, sandbox)
const T = sandbox.result

// ---- 注册表(与 py HEXES/LAND 同构) ---------------------------------------
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

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "results", "py-goals-golden.json"), "utf8"))
const ID_OF = idx => (Math.floor(idx / 29) * 100 + 1000 + idx % 29)

let total = 0, checked = 0
const problems = []
for (const R of ["JP", "AL"]) {
    for (const phase of ["early", "mid", "late"]) {
        const lib = T[R === "JP" ? "jp" : "al"][phase]
        for (const key of Object.keys(golden[R][phase])) {
            const g = golden[R][phase][key]
            const entry = lib[key]
            if (!entry) { problems.push(`${R} ${phase} ${key}: JS 库缺该键`); continue }
            total++
            const gotGoals = T.parseEntry(entry, R === "JP" ? "Japan" : "Allies", phase, REG)
            const gotKinds = gotGoals.map(x => x.kind)
            const expKinds = g.goals.map(x => x.kind)
            const kindOk = gotKinds.length === expKinds.length && gotKinds.every((k, i) => k === expKinds[i])
            // hex 逐位相等
            let hexOk = true
            const hexDiff = []
            if (kindOk) {
                for (let i = 0; i < gotGoals.length; i++) {
                    const a = gotGoals[i].hexes, b = g.goals[i].hexes
                    if (a.length !== b.length) { hexOk = false; hexDiff.push(`  line${i + 1} len ${a.length} != ${b.length}`); continue }
                    for (let j = 0; j < a.length; j++) {
                        if (a[j] !== b[j]) {
                            hexOk = false
                            hexDiff.push(`  line${i + 1} hex#${j}: JS ${a[j]}(${ID_OF(a[j])}) != py ${b[j]}(${ID_OF(b[j])})`)
                        }
                    }
                }
            } else {
                hexDiff.push(`  kinds JS[${gotKinds.join(",")}] != py[${expKinds.join(",")}]`)
            }
            if (kindOk && hexOk) { checked++; continue }
            problems.push(`${R} ${phase} ${key}:\n` + hexDiff.join("\n") + `\n  targets:\n    ` + entry.targets.join("\n    "))
        }
    }
}
console.log(`goal-fidelity: ${checked}/${total} strategies byte-equal to py parse (kinds + ordered hex idx)`)
if (problems.length) {
    console.log("PROBLEMS(" + problems.length + "):\n" + problems.slice(0, 30).join("\n---\n"))
    process.exit(1)
}
