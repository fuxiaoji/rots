"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 424242)
const maxActions = 60000
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
let state = rules.setup(seed, scenario, { headless_moves: true })
let actions = 0
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    try {
      const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
      if (!view.actions || !(decision.action in view.actions)) throw new Error(`illegal ${decision.action} @ ${view.prompt}`)
      state = rules.action(state, role, decision.action, decision.argument)
      actions++
    } catch (e) {
      console.log("=== ERROR at action", actions, "===")
      console.log("role:", role)
      console.log("prompt:", JSON.stringify(view.prompt))
      console.log("active:", JSON.stringify(state.active))
      console.log("error:", e.message)
      console.log("actions keys:", view.actions ? Object.keys(view.actions) : null)
      console.log("actions:", JSON.stringify(view.actions))
      console.log("offensive:", JSON.stringify(view.offensive).slice(0, 2000))
      console.log("unselect:", JSON.stringify(view.unselect))
      break
    }
  }
} catch(e){ console.log("OUTER ERROR", e.message) }
console.log("done actions=", actions, "turn=", state.turn, "active=", state.active)
