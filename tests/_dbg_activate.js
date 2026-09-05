"use strict"
// 探针: 统计每个攻势激活的单位数 + 会战格申报数, 验证"强制 done"修复后 bot 是否激活多单位。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260905)
const maxActions = Number(process.argv[3] || 150000)
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
let actions = 0
const actSizes = {}, battleLog = []
let curAct = 0, curMax = 0, curRole = null, curOff = 0
let lastPrompt = ""
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    lastPrompt = `${state.turn} ${role} [${d.action}] ${String(view.prompt || "").slice(0, 80)}`
    const p = String(view.prompt || "")
    const am = p.match(/Activate units: (\d+) of\s+(\d+)/i)
    if (am) { curAct = Number(am[1]); curMax = Number(am[2]); curRole = role }
    const bm = p.match(/New battle hex declared ([A-Z])/)
    if (bm) battleLog.push(`T${state.turn} ${role} battle ${bm[1]}`)
    const noB = /No battle hexes declared/i.test(p)
    if (noB) battleLog.push(`T${state.turn} ${role} NO-BATTLE`)
    const lm = /Activated \^(\d+) units/i.test(state.log[state.log.length - 1] || "")
    state = rules.action(state, role, d.action, d.argument)
    // 检测激活收尾日志
    for (const line of state.log) {
      const mm = line.match(/Activated \^(\d+) units\|/)
      if (mm) { actSizes[mm[1]] = (actSizes[mm[1]] || 0) + 1 }
    }
    actions++
  }
} catch (e) { console.log("err", e.message); console.log("LAST-PROMPT:", lastPrompt); process.exit(2) }
console.log(`== seed ${seed} == endT ${state.turn} win ${state.result} actions ${actions}`)
console.log("activation size distribution:", JSON.stringify(actSizes))
console.log("battle/no-battle:", battleLog.length, "条;", JSON.stringify(battleLog.slice(0, 80)))
