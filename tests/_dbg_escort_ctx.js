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
    const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(decision.action in view.actions)) throw new Error(`illegal ${decision.action} @ ${view.prompt}`)
    state = rules.action(state, role, decision.action, decision.argument)
    actions++
  }
} catch(e){ console.log("ERROR", e.message, "actions", actions) }
const log = state.log || []
const hits = []
for (let i=0;i<log.length;i++) if (/Amphibious Assault failed/.test(log[i])) hits.push(i)
console.log("fails at", hits.join(","))
for (const idx of hits) {
  console.log(`\n\n########## FAIL @ log[${idx}] ##########`)
  for (let i=Math.max(0,idx-30); i<=idx+2; i++) console.log(`[${i}] ${log[i]}`)
}
