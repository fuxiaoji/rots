"use strict"
// Batch A 取证: 开局投降时点/进攻方式/0激活 普查。
// 用法: node tools/audit-opening-census.js <seeds> [scenario=1942]
// 输出: 每seed 菲/马来/DEI 投降回合, 马尼拉会战的陆路/两栖属性, 0激活次数。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const ar = x => Array.isArray(x.active) ? x.active.slice().sort()[0] : x.active
const n = Number(process.argv[2] || 8)
const scenario = String(process.argv[3] || "1942-1945 (The Shortened Campaign)")
const out = []
for (let seed = 20260903; seed < 20260903 + n; ++seed) {
    let state = rules.setup(seed, scenario, { headless_moves: true })
    let a = 0, zeroAct = 0, noReach = 0
    const surrenderTurn = {}
    let lastSurr = 0
    while (state.active !== "None" && a < 80000) {
        const r = ar(state)
        const v = rules.view(state, r)
        const d = policy.decide(v, { role: r, seed, actionOrdinal: a + 1 })
        state = rules.action(state, r, d.action, d.argument)
        a++
        for (let i = lastSurr; i < state.log.length; ++i) {
            const m = state.log[i].match(/^(Philippines|Malaya|Dutch East Indies|India|Burma|China) surrender\./)
            if (m && !surrenderTurn[m[1]]) surrenderTurn[m[1]] = state.turn
            if (/No units activated\./.test(state.log[i])) zeroAct++
            if (/no active unit can reach/.test(state.log[i])) noReach++
        }
        lastSurr = state.log.length
    }
    // 终局菲律宾/马来亚控制与投降链
    const surrenders = Array.isArray(state.surrender) ? {
        phil: state.surrender[0] >= 1 ? "是" : "否", malaya: state.surrender[1] >= 1 ? "是" : "否",
        dei: state.surrender[2] >= 1 ? "是" : "否", burma: state.surrender[3] >= 1 ? "是" : "否",
    } : {}
    out.push({ seed, surrenderTurn, zeroAct, noReach, final: surrenders, turn: state.turn })
    console.log(`seed${seed}: 投降回合=${JSON.stringify(surrenderTurn)} 0激活=${zeroAct} 不可达=${noReach}`)
}
require("fs").writeFileSync("research/erasmus_audit/nightly_20260911/07_opening_census.json",
    JSON.stringify(out, null, 1) + "\n")
console.log("saved 07_opening_census.json")
