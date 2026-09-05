"use strict"
// D5 测量探针: 打完整局, 输出每回合首卡钉选时引擎权威账本(diag: pow/bank/jpRes/marker)
// + 每回合 Political-will 结算行 + 终局败因。判定"离 victory_1945 (res<=1 + 轰炸1-9) 多远"。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260924)
const maxActions = Number(process.argv[3] || 90000)
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
const byTurn = {}
const checks = []
let actions = 0
let lastLines = []
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const preLen = state.log.length
    state = rules.action(state, role, d.action, d.argument)
    for (const line of state.log.slice(preLen)) {
      lastLines.push(line); if (lastLines.length > 80) lastLines.shift()
      const m = line.match(/current progress of war (\d+) < (\d+)/)
      if (m) checks.push([state.turn, +m[1], +m[2]])
      const t = line.match(/Political will changed to (\d+) \([+-]\d+\) - (.+)$/)
      if (t && /progress of war|Tokyo Rose|Tojo|US Casualties|successful strategic bombing|Doolittle/.test(line)) checks.push([state.turn, t[1], t[2].slice(0, 34)])
    }
    const sm = d.publicTrace && d.publicTrace.sm
    if (sm && sm.diag && sm.pinnedNow) {
      const t = sm.diag.turn
      const key = role + "@" + t
      if (!byTurn[key]) byTurn[key] = { role, diag: sm.diag, pin: sm.strategy, kind: sm.kind, phase: sm.phase, focus: sm.focus }
    }
    actions++
  }
} catch (e) { console.log("err", e.message); process.exit(2) }
const turns = [...new Set(Object.values(byTurn).map(r => r.diag.turn))].sort((a, b) => a - b)
console.log(`== seed ${seed} == endT ${state.turn} win ${state.result} actions ${actions}`)
console.log(`turn | JP pin(strategy/pow/bank/jpRes) | AL pin(strategy/pow/bank/jpRes) | JP-resHexes`)
for (const t of turns) {
  const j = byTurn["Japan@" + t], a = byTurn["Allies@" + t]
  const f = r => r ? `${r.pin}/${r.kind} pow=${r.diag.pow} bank=${r.diag.bank} res=${r.diag.jpRes} mk=${r.diag.marker}` : "-"
  const rh = (a ? a.diag.resHexes : (j ? j.diag.resHexes : null))
  const r = rh && rh.length ? rh.join(",") : "∅"
  console.log(`T${t} | ${f(j)} | ${f(a)} | ${r}`)
}
console.log("progress-of-war / PW events (turn,val,txt):")
for (const c of checks) console.log(`  T${c[0]} ${typeof c[1] === "number" ? `bank=${c[1]} < pow=${c[2]}` : `PW=${c[1]} ${c[2]}`}`)
console.log("terminal lines:")
for (const l of lastLines.slice(-12)) console.log("  " + l)
