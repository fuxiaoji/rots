"use strict"
// 探针: 完整一局, 打印每次 political will 变化的原因, 定位盟军 PW 归零根因。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260903)
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
let actions = 0
try {
  while (state.active !== "None" && actions < 150000) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const pre = state.log.length
    state = rules.action(state, role, d.action, d.argument)
    for (const line of state.log.slice(pre)) {
      if (/olitical will|Political will|progress of war|no US|no AP|National status|Treaty/i.test(line)) {
        console.log(`[T${state.turn}/${role}] ${line}`)
      }
    }
    actions++
  }
} catch (e) { console.log("err", e.message); process.exit(2) }
console.log(`== endT ${state.turn} win ${state.result} ==`)
