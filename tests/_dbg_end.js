"use strict"
// 终局诊断: PW 走势(逐回合政治结算)、盟军最远推进(距东京最近的本方控格)、B29 位置、
// 日本资源数、资源格清单、是否封锁可达。用于定位"盟军还差什么才能赢"。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260905)
const maxActions = 150000
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
let actions = 0, lastLines = []
const pwEvents = []
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const pre = state.log.length
    state = rules.action(state, role, d.action, d.argument)
    for (const line of state.log.slice(pre)) {
      lastLines.push(line); if (lastLines.length > 60) lastLines.shift()
      const m = line.match(/current progress of war (\d+) < (\d+)/)
      if (m) pwEvents.push(`T${state.turn} PoW bank=${m[1]} < pow=${m[2]}`)
      const t = line.match(/Political will changed to (\d+) \([+-]\d+\) - (progress of war|Tokyo Rose|Tojo|US Casualties|successful strategic bombing|Doolittle)/)
      if (t) pwEvents.push(`T${state.turn} PW->${t[1]} (${t[2]})`)
    }
    actions++
  }
} catch (e) { console.log("err", e.message); process.exit(2) }
console.log(`== seed ${seed} == endT ${state.turn} win ${state.result} actions ${actions}`)
console.log("--- PW/PoW events ---")
for (const l of pwEvents) console.log("  " + l)
console.log("--- terminal ---")
for (const l of lastLines.slice(-15)) console.log("  " + l)
