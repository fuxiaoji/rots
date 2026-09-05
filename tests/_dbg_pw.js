"use strict"
// 探针: 单局逐回合打印 PW/pow 结算与败因, 归因盟军为何输。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260924)
const maxActions = Number(process.argv[3] || 90000)
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
console.log(`start: sid=${state.sid} turn=${state.turn} pw=${state.political_will} pow=${state.pow} jpRes=${rules.view && ''} active=${state.active}`)
let actions = 0, curTurn = state.turn
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const turn = state.turn
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const preLen = state.log.length
    state = rules.action(state, role, d.action, d.argument)
    const sm = d.publicTrace && d.publicTrace.sm
    for (const line of state.log.slice(preLen)) {
      if (/^@Turn \d+/.test(line) && state.turn !== curTurn) curTurn = state.turn
      if (/Political will changed|Progress of war|Progress of War|victory|Victory|Treaty|surrender|Surrender|Japan.*control|Strategic bombing|B29|National status|Operation Z/i.test(line)) {
        console.log(`[T${turn}/${role}] ${line}`)
      }
    }
    if (sm && sm.pinnedNow && role === "Allies") {
      const nm = typeof sm.focus === "number" ? "h"+sm.focus : sm.focus
      console.log(`[PIN T${turn}/Allies] strategy=${sm.strategy} kind=${sm.kind} phase=${sm.phase} chainHead=${sm.chainHead} focus=${sm.focus}`)
    }
    actions++
  }
} catch (e) { console.log("error", e.message); process.exit(2) }
console.log("done endT", state.turn, "win", state.result, "actions", actions)
