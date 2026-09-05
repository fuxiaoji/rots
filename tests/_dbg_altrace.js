"use strict"
// 探针: 追踪盟军每个攻势(卡牌)的激活/移动/会战/夺格, 定位"每回合夺格<4"的吞吐瓶颈。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260903)
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
const idxOf = id => (Math.floor(id / 100) - 10) * 29 + (id % 100)
const MAP_SRC = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "common", "data_map.js"), "utf8")
const nm = {}
for (const m of MAP_SRC.matchAll(/\{\s*id:\s*(\d+)\s*,([\s\S]*?)\n\s*\}/g)) {
  const n = (m[2].match(/name:\s*"([^"]+)"/) || [])[1]
  if (n) nm[idxOf(+m[1])] = n
}
let actions = 0, turn = state.turn
let apCapTurn = {}   // turn -> names captured this turn (log-scanned)
let apCardPlays = {} // turn -> count of AP card plays
try {
  while (state.active !== "None" && actions < 150000) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const pre = state.log.length
    state = rules.action(state, role, d.action, d.argument)
    const turnNow = state.turn
    for (const line of state.log.slice(pre)) {
      const cm = line.match(/AP captured (\d+)/)
      if (cm) {
        const idx = idxOf(+cm[1])
        const name = nm[idx] || cm[1]
        const key = turnNow
        apCapTurn[key] = apCapTurn[key] || []
        apCapTurn[key].push(name)
      }
      if (/^AP .*plays|Played/.test(line) && /card|Card/.test(line)) {
        apCardPlays[turnNow] = (apCardPlays[turnNow] || 0) + 1
      }
    }
    // 记录盟军每回合的进攻卡(离线阶段选牌窗口): 用 view.prompt 判定
    actions++
  }
} catch (e) { console.log("err", e.message); process.exit(2) }
console.log(`== seed ${seed} == endT ${state.turn} win ${state.result}`)
console.log("AP captures by turn (named hexes):")
for (const t of Object.keys(apCapTurn).sort((a,b)=>a-b)) {
  console.log(`  T${t}: [${apCapTurn[t].join(", ")}]`)
}
