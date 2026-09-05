"use strict"
// 探针: 打完整局, 逐回合记录增援/补员落位 (单位/落点/合法格全集), 终局胜负。
// 目的: 验证 AI 是否有 CDSS「增援或补员阶段」落位逻辑(当前应为随机/无优先级)。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260924)
const maxActions = Number(process.argv[3] || 150000)
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
function nameOf(u) {
  try { const p = rules.pieces ? rules.pieces[u] : null; return p ? (p.name || u) : u } catch (e) { return u }
}
let actions = 0
const placements = []
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const p = String(view.prompt || "")
    const isReinf = /reinforcement/i.test(p) || /增援/.test(p)
    const isRepl = /reinforce\b|replacement|替换|补员/.test(p) && /Choose|选择/.test(p)
    if ((isReinf || isRepl) && (d.action === "action_hex" || d.action === "unit" || d.action === "delay" || d.action === "done" || d.action === "skip")) {
      const unit = (state.active_stack && state.active_stack[0]) || "?"
      placements.push({ t: state.turn, role, action: d.action, unit: nameOf(unit), arg: d.argument, prompt: p.slice(0, 70) })
    }
    state = rules.action(state, role, d.action, d.argument)
    actions++
  }
} catch (e) { console.log("err", e.message); process.exit(2) }
console.log(`== seed ${seed} == endT ${state.turn} win ${state.result} actions ${actions}`)
console.log(`增援/补员决策共 ${placements.length} 条:`)
for (const x of placements) console.log(`  T${x.t} ${x.role} ${x.action} ${x.unit} -> ${x.arg}  | ${x.prompt}`)
