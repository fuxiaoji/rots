"use strict"
// 诊断空攻势: 单局追踪盟军每次 offensive 的 HQ 选择/焦点/激活单位/是否空攻势。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]

const scenario = "1942-1945 (The Shortened Campaign)"
const baseSeed = Number(process.argv[2] || 20260908)
const maxActions = Number(process.argv[3] || 60000)

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

let state
try { state = rules.setup(baseSeed, scenario, { headless_moves: process.env.EOTS_HEADLESS_MOVES === "1" }) }
catch (e) { console.log("setup error", e.message); process.exit(1) }

let actions = 0
let lastTurn = -1
while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    if (role !== "Japan" && role !== "Allies") break
    const view = rules.view(state, role)
    const turn = Number(view.turn || state.turn || 0)
    if (turn !== lastTurn) {
        lastTurn = turn
        console.log(`=== TURN ${turn} ===`)
    }
    const decision = policy.decide(view, { role, seed: baseSeed, actionOrdinal: actions + 1 })
    // 记录盟军的 offensive 相关关键决策
    if (role === "Allies") {
        const p = String(view.prompt || "")
        if (/Choose HQ/i.test(p)) {
            const hqs = (decision.argument !== undefined) ? decision.argument : null
            const focus = view.ai && view.ai.focus
            console.log(`  [HQ] T${turn} prompt="${p.slice(0,50)}" picked=${hqs} focus=${focus}`)
        } else if (/activate units/i.test(p)) {
            console.log(`  [ACT] T${turn} unit=${decision.argument} prompt="${p.slice(0,60)}"`)
        } else if (/Declare battle hexes|Confirm declared battle hexes/i.test(p)) {
            console.log(`  [BATTLE] T${turn} prompt="${p.slice(0,60)}" act=${decision.action} arg=${decision.argument}`)
        }
    }
    if (!view.actions || !(decision.action in view.actions)) {
        console.log(`ILLEGAL action ${decision.action} @ ${view.prompt}`)
        break
    }
    try { state = rules.action(state, role, decision.action, decision.argument) } catch (e) {
        console.log(`apply error: ${e.message}`)
        break
    }
    actions++
    if (actions >= maxActions) break
}
console.log(`END actions=${actions} turn=${lastTurn} active=${state.active}`)
