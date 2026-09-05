"use strict"
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const seed = Number(process.argv[2] || 424242)
let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", { headless_moves: true })
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
let actions = 0
try {
  while (state.active !== "None" && actions < 60000) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    state = rules.action(state, role, d.action, d.argument)
    actions++
  }
} catch (e) {
  console.log("err", e.message)
  const role = activeRole(state)
  const view = rules.view(state, role)
  console.log("ROLE", role, "TURN", state.turn, "ORD", actions+1)
  console.log("PROMPT:", JSON.stringify(view.prompt))
  console.log("ACTIONS:", JSON.stringify(view.actions))
  console.log("G.offensive:", JSON.stringify(view.offensive && {active_units: view.offensive.active_units, attacker: view.offensive.attacker, battle_hexes: view.offensive.battle_hexes, landing_hexes: view.offensive.landing_hexes, hexes: view.offensive.hexes, air_hexes: view.offensive.air_hexes, naval_hexes: view.offensive.naval_hexes, segment: view.offensive.segment}))
  process.exit(2)
}
console.log(`== seed ${seed} endT ${state.turn} win ${state.result} actions ${actions} ==`)
