"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260916)
const maxActions = 60000
function activeRole(s){return Array.isArray(s.active)?s.active.slice().sort()[0]:s.active}
let state = rules.setup(seed, scenario, { headless_moves: true })
let actions = 0
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(decision.action in view.actions)) throw new Error(`illegal ${decision.action} @ ${view.prompt}`)
    state = rules.action(state, role, decision.action, decision.argument)
    actions++
  }
} catch (e) {
  console.log("ERROR", e.message, "at", actions)
}
// dump reaction units info at stuck point
const off = state.offensive
if (off) {
  console.log("battle_hexes=", JSON.stringify(off.battle_hexes), "committed=", JSON.stringify(off.committed), "stage=", off.stage)
  const all = (off.active_units||[]).flat()
  for (const u of all) {
    const p = rules.__test_pieces ? rules.__test_pieces[u] : null
    console.log("unit", u, "loc=", state.location[u], "path=", JSON.stringify(off.paths && off.paths[u]))
  }
}
console.log("done actions=", actions, "turn=", state.turn, "active=", state.active)
