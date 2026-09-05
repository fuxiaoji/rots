const rules = require("../rules.js")
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = 20260906
const maxActions = 6000
const setupOptions = { headless_moves: true }
function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}
let state = rules.setup(seed, scenario, setupOptions)
let actions = 0, last = []
while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const decision = rules.bots["erasmus-v2"].decide(view, { role, seed, actionOrdinal: actions + 1 })
    last.push({a:actions, role, action:decision.action, arg:decision.argument, stage:view.ai&&view.ai.stage, prompt:String(view.prompt||"").slice(0,50)})
    if (last.length > 40) last.shift()
    state = rules.action(state, role, decision.action, decision.argument)
    actions++
}
console.log("END actions",actions,"active",JSON.stringify(state.active),"turn",state.turn)
for (const e of last) console.log(e.a, e.role, e.action, JSON.stringify(e.arg), "|", e.stage, "|", e.prompt)
