"use strict"
// 探针: 每回合 AP 打了多少 OC 攻势 / EC / PASS, 攻下多少名城 —— 定位"capture<4"吞吐根因。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const seed = Number(process.argv[2] || 20260903)
let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", { headless_moves: true })
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
let actions = 0
let curTurn = state.turn
const perTurn = {}  // turn -> {oc,ec,pass,captures}
function T(t) { if (!perTurn[t]) perTurn[t] = { oc: 0, ec: 0, pass: 0, cards: 0, captures: [] } ; return perTurn[t] }
try {
  while (state.active !== "None" && actions < 150000) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const p = String(view.prompt || "")
    if (role === "Allies") {
      if (/Select action/.test(p) && d.action === "ops") T(state.turn).oc++
      if (/Select action/.test(p) && d.action === "event") T(state.turn).ec++
      if (/Select action/.test(p) && d.action === "discard") T(state.turn).pass++
      if (/Select card to play/.test(p)) T(state.turn).cards++
    }
    const preCap = (state.capture || []).length
    state = rules.action(state, role, d.action, d.argument)
    // 捕获检测: 新加入 G.capture 的 hex
    const postCap = (state.capture || []).length
    if (role === "Allies" && postCap > preCap) {
      const added = (state.capture || []).slice(preCap)
      T(state.turn).captures.push(...added)
    }
    if (state.turn !== curTurn) { curTurn = state.turn }
    actions++
  }
} catch (e) { console.log("err", e.message); process.exit(2) }
console.log(`== seed ${seed} endT ${state.turn} win ${state.result} ==`)
for (const t of Object.keys(perTurn).sort((a,b)=>a-b)) {
  const e = perTurn[t]
  console.log(`T${t}: cards=${e.cards} OC=${e.oc} EC=${e.ec} PASS=${e.pass} captures=${e.captures.length} [${e.captures.join(",")}]`)
}
