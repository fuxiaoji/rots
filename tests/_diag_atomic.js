"use strict"
// 诊断: 追踪 原子弹标准 + TOJO/苏联牌(AP79)/东条辞职(JP43) 逐回合状态。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]

const scenario = "1942-1945 (The Shortened Campaign)"
const baseSeed = Number(process.argv[2] || 20260903)
const maxActions = Number(process.argv[3] || 60000)

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}
function locOf(state, card) {
    const c = card
    if (state.hand[1].includes(c) || state.hand[0].includes(c)) return "hand"
    if (state.draw[1].includes(c) || state.draw[0].includes(c)) return "draw"
    if (state.discard[1].includes(c) || state.discard[0].includes(c)) return "discard"
    if (state.removed[1].includes(c) || state.removed[0].includes(c)) return "removed"
    return "?"
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
        let a = null
        try { a = rules.query(state, "Allies", "atomic_bomb_strategy_status") } catch (e) {}
        const tojo = state.events && state.events[26] ? state.events[26] : 0
        console.log(`T${turn} met=${a&&a.met} sovOcc=${a&&a.sovietOccurred} sovHand=${a&&a.sovietInHand} sovPlay=${a&&a.sovietPlayable} jpRes=${a&&a.jpResources} resOk=${a&&a.resourcesSatisfied} noBombFail=${a&&a.noStrategicBombingFailure} TOJO=${tojo} AP79=${locOf(state,79)} JP43=${locOf(state,43)}`)
    }
    const decision = policy.decide(view, { role, seed: baseSeed, actionOrdinal: actions + 1 })
    if (!view.actions || !(decision.action in view.actions)) {
        console.log(`ILLEGAL action ${decision.action} @ ${view.prompt}`)
        break
    }
    try { state = rules.action(state, role, decision.action, decision.argument) } catch (e) {
        console.log(`apply error: ${e.message}`)
        break
    }
    actions++
}
console.log(`END actions=${actions} turn=${lastTurn}`)
