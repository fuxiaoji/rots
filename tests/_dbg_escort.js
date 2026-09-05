"use strict"
// 诊断: 指定种子 headless 跑完, 统计两栖护航相关日志行。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const seed = Number(process.argv[3] || 424242)
const maxActions = Number(process.argv[4] || 60000)

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

let state = rules.setup(seed, scenario, { headless_moves: true })
let actions = 0
try {
    while (state.active !== "None" && actions < maxActions) {
        const role = activeRole(state)
        const view = rules.view(state, role)
        const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
        if (!view.actions || !(decision.action in view.actions)) {
            throw new Error(`illegal action ${decision.action} @ ${view.prompt}`)
        }
        state = rules.action(state, role, decision.action, decision.argument)
        actions++
    }
} catch (e) {
    console.log("ERROR", e.message, "actions", actions)
}

const log = state.log || []
const failed = []
const ok = []
for (let i = 0; i < log.length; i++) {
    const line = log[i]
    if (/Amphibious Assault failed/.test(line)) failed.push({ i, line })
    if (/Amphibious assault/.test(line) && !/failed/.test(line)) ok.push({ i, line })
}
console.log(`seed=${seed} status=${state.active === "None" ? "complete" : "active=" + state.active} actions=${actions} turn=${state.turn}`)
console.log(`winner=${state.result ? (state.result.won_side || JSON.stringify(state.result)) : "-"}`)
console.log(`=== AMPHIBIOUS FAILED (${failed.length}) ===`)
for (const f of failed) console.log(`[${f.i}] ${f.line}`)
console.log(`=== AMPHIBIOUS OK (${ok.length}) ===`)
for (const f of ok) console.log(`[${f.i}] ${f.line}`)
