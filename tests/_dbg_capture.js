"use strict"
// 探针: 打完整局, 终局打印 G.capture 成员(名字/控制/补给) 与引擎口径 pow_count。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260909)
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
let actions = 0, curT = state.turn
// 采集每次 Progress of War 结算行 + 每回合首卡 AP 钉选
try {
  while (state.active !== "None" && actions < 150000) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    state = rules.action(state, role, d.action, d.argument)
    actions++
  }
} catch (e) { console.log("err", e.message); process.exit(2) }
// 地图 idx/name
const idxOf = id => (Math.floor(id / 100) - 10) * 29 + (id % 100)
const MAP_SRC = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "common", "data_map.js"), "utf8")
const byIdx = {}
const re = /\{\s*id:\s*(\d+)\s*,/g
let m
while ((m = re.exec(MAP_SRC))) {
  const id = +m[1]; const start = MAP_SRC.indexOf("{", m.index)
  let depth = 0, j = start
  for (; j < MAP_SRC.length; j++) { const c = MAP_SRC[j]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break } }
  const blk = MAP_SRC.slice(start, j + 1)
  const region = (blk.match(/region:\s*"([^"]+)"/) || [])[1]
  const name = (blk.match(/name:\s*"([^"]+)"/) || [])[1]
  const named = /(?:^|,)\s*named\s*:/ .test(blk) ? (blk.match(/named:\s*(true|false|1|0)/) || [])[1] : null
  if (!region && !name && named === null) continue
  const e = byIdx[idxOf(id)] || (byIdx[idxOf(id)] = { id })
  if (region) e.region = region
  if (name) e.name = name
  if (named !== null) e.named = named === "true" || named === "1"
}
const cap = state.capture || []
console.log(`end turn=${state.turn} win=${state.result} pow=${state.pow}`)
console.log(`G.capture size=${cap.length}; AP 控(引擎口径 pow_count 候选):`)
for (const idx of cap.slice().sort((a, b) => a - b)) {
  const e = byIdx[idx]
  console.log(`  idx${idx} ${e ? e.name || "" : ""} ${e ? e.region || "" : ""} named=${e ? e.named : "?"}`)
}
console.log("byIdx total named:", Object.values(byIdx).filter(e => e.named).length)
