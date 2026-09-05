"use strict"
// 探针: 追踪每次地面会战的攻/守战力、命中、胜负与夺格, 定位"盟军攻不下的格/战力不足"根因。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const seed = Number(process.argv[2] || 20260903)
let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", { headless_moves: true })
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
const idxOf = id => (Math.floor(id / 100) - 10) * 29 + (id % 100)
let actions = 0
const stats = { apAtk: 0, apWin: 0, jpAtk: 0, jpWin: 0 }
try {
  while (state.active !== "None" && actions < 150000) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const pre = state.log.length
    state = rules.action(state, role, d.action, d.argument)
    const newLog = state.log.slice(pre)
    // 采集 "Ground combat" 结算 + "won in ground combat" + "capture" 行
    for (const line of newLog) {
      if (/fire \((\d+)\)/.test(line) && /Ground combat/.test(line)) {
        // 攻守双方各一条 "fire (N)"，配对打印
      }
      if (/won in ground combat/.test(line)) {
        const atk = line.includes("Attacker won") ? 1 : 0
        const side = state.offensive && state.offensive.attacker === 0 ? "AP" : "JP"
        if (side === "AP") { stats.apAtk++; if (atk) stats.apWin++ }
        else { stats.jpAtk++; if (atk) stats.jpWin++ }
        console.log(`[T${state.turn}] ${side} ${line.replace(/^@/,"").slice(0,80)}`)
      }
    }
    actions++
  }
} catch (e) { console.log("err", e.message); process.exit(2) }
console.log(`== seed ${seed} endT ${state.turn} win ${state.result} ==`)
console.log(`AP ground battles: ${stats.apAtk} (win ${stats.apWin}, ${(100*stats.apWin/Math.max(1,stats.apAtk)).toFixed(0)}%)`)
console.log(`JP ground battles: ${stats.jpAtk} (win ${stats.jpWin}, ${(100*stats.jpWin/Math.max(1,stats.jpAtk)).toFixed(0)}%)`)
