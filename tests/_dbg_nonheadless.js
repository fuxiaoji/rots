"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const seed = Number(process.argv[2] || 424242)
// NON-headless: this is what PvE does (no headless_moves option)
let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", {})
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
let actions = 0
try {
  while (state.active !== "None" && actions < 20000) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) {
      console.log(`ILLEGAL ${d.action} @ turn ${state.turn} prompt="${view.prompt}"`)
      console.log("  legal:", Object.keys(view.actions).join(","))
      break
    }
    state = rules.action(state, role, d.action, d.argument)
    actions++
    if (actions % 500 === 0) console.log("...", actions, "turn", state.turn, "active", activeRole(state))
  }
} catch (e) {
  console.log("SERVER ERROR:", e.message)
  console.log(e.stack && e.stack.split("\n").slice(0,8).join("\n"))
}
console.log(`== seed ${seed} endT ${state.turn} win ${state.result} actions ${actions} ==`)
