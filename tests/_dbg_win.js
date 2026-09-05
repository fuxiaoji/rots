"use strict"
// 多种子结局分布: 每局打印 endT + win + PW 走势粗查 (盟军能否至少赢一局).
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const N = Number(process.argv[2] || 8)
const base = Number(process.argv[3] || 20260903)
const maxActions = 90000
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
let wins = {}
for (let k = 0; k < N; k++) {
  const seed = base + k
  let state
  try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log(seed, "setup-error", e.message); wins.setup = (wins.setup || 0) + 1; continue }
  let actions = 0, err = null
  try {
    while (state.active !== "None" && actions < maxActions) {
      const role = activeRole(state)
      const view = rules.view(state, role)
      const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
      if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
      state = rules.action(state, role, d.action, d.argument)
      actions++
    }
  } catch (e) { err = e.message }
  const key = err ? "ERROR" : state.result
  wins[key] = (wins[key] || 0) + 1
  console.log(`${seed} endT=${state.turn} win=${state.result}${err ? " ERR:" + err : ""} actions=${actions}`)
}
console.log("=== distribution ===", JSON.stringify(wins))
