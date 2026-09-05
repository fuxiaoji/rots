"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260918)
const maxActions = 2000
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
let state = rules.setup(seed, scenario, { headless_moves: true })
let actions = 0
const hist = []
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(decision.action in view.actions)) throw new Error(`illegal ${decision.action} @ ${view.prompt}`)
    hist.push({ n: actions + 1, role, prompt: String(view.prompt).slice(0, 70), act: decision.action, arg: decision.argument, keys: Object.keys(view.actions || {}).join(",") })
    state = rules.action(state, role, decision.action, decision.argument)
    actions++
  }
} catch (e) {
  console.log("ERROR", e.message, "at", actions)
}
console.log("done actions=", actions, "turn=", state.turn, "active=", state.active)
for (const h of hist.slice(-40)) console.log(`${h.n} ${h.role} [${h.act}] ${h.prompt} keys=${h.keys} arg=${JSON.stringify(h.arg)}`)
