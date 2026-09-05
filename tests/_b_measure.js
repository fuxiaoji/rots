"use strict"
// B 度量(当前代码态, 一次跑齐 A/B 两臂同一种子): headless 1942, 记录每局状态/终局/
// AP 总夺格数 + 其中的“跨海登岛夺控”(被夺格是图中远离马来亚-中南半岛主陆连线的
// 海外名岛/群岛格)。两臂靠环境开关: 基线 B_CRUISE=0 B_BIAS=0; 修复臂默认全开。
//
// 计数口径: 逐 action 扫 state.log 增量, 匹配逐格夺控行 `/^(?:&A)?AP captured H(\d+)/`
// (capture_hex 单行; 会战窗内 log() 加 &A 前缀; 夺格常在对方 [done]/[next] 边界结算,
// 故不限 role)。同 action 内同格去重(防 non_control+夺控双日志)。
// 用法: node tests/_b_measure.js [局数] [起始seed] [maxActions]
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const HEADLESS = process.env.EOTS_HEADLESS_MOVES !== "0"
const setupOptions = { headless_moves: HEADLESS }
const gameCount = Number(process.argv[2] || 40)
const baseSeed = Number(process.argv[3] || 20260903)
const maxActions = Number(process.argv[4] || 90000)

const idxOf = id => (Math.floor(id / 100) - 10) * 29 + (id % 100)
const MAP_SRC = require("fs").readFileSync(path.join(__dirname, "..", "js", "common", "data_map.js"), "utf8")
function parseMap() {
    const byIdx = {}
    const re = /\{\s*id:\s*(\d+)\s*,/g
    let m
    while ((m = re.exec(MAP_SRC))) {
        const id = +m[1]
        const start = MAP_SRC.indexOf("{", m.index)
        let depth = 0, j = start
        for (; j < MAP_SRC.length; j++) { const c = MAP_SRC[j]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break } }
        const blk = MAP_SRC.slice(start, j + 1)
        const region = (blk.match(/region:\s*"([^"]+)"/) || [])[1]
        const name = (blk.match(/name:\s*"([^"]+)"/) || [])[1]
        if (!region && !name) continue
        const e = byIdx[idxOf(id)] || (byIdx[idxOf(id)] = { id })
        if (region) e.region = region
        if (name) e.name = name
    }
    return byIdx
}
const MAP = parseMap()
const nameOf = i => { const e = MAP[i]; return e && e.name ? e.name : (e && e.region ? `${e.region}#${i}` : `H${i}`) }

// 跨海登岛目标集: 中太平洋跳岛链 + 西南太平洋/DEI 名岛 + 菲律宾群岛 + 日本本土近海。
// (排除马来亚/暹罗/中南半岛陆路连片夺格 —— 那是地面推进, 非登岛。)
const ISL = new Set(["wake", "tarawa", "kwajalein", "eniwetok", "palau", "ulithi",
    "saipan", "guam", "ponape", "truk", "kusaie", "iwo jima", "okinawa", "tarakan",
    "balikpapan", "koepang", "timor", "morotai", "halmahera", "biak", "hollandia",
    "gili gili", "espiritu santo", "noumea", "guadalcanal", "rendova", "munda",
    "yap", "marcus", "lae"])
const isIsland = (i) => {
    const e = MAP[i]
    if (!e) return false
    if (e.name && ISL.has(e.name.toLowerCase())) return true
    if (e.region && /^Philippines$/.test(e.region)) return true
    return false
}

function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }

const CAP_RE = /^(?:&A)?AP captured H(\d+)\b/

function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, setupOptions) } catch (e) { return { seed, status: "setup-error" } }
    const g = { seed, status: "error", winner: null, actions: 0, captures: 0, isl: [] }
    let curTurn = 1
    try {
        while (state.active !== "None" && g.actions < maxActions) {
            const role = activeRole(state)
            const turn = Number(state.turn || 0)
            const view = rules.view(state, role)
            const d = policy.decide(view, { role, seed, actionOrdinal: g.actions + 1 })
            if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
            const preLen = state.log.length
            state = rules.action(state, role, d.action, d.argument)
            const seen = new Set()
            for (const line of state.log.slice(preLen)) {
                const m = CAP_RE.exec(line)
                if (!m) continue
                const hx = +m[1]
                if (hx > 5000 || seen.has(hx)) continue   // 同 action 双日志去重
                seen.add(hx)
                g.captures++
                if (isIsland(hx)) g.isl.push(`T${turn}:${hx}:${nameOf(hx)}`)
            }
            g.actions++
            curTurn = turn
        }
    } catch (e) { return { seed, status: "error", error: e.message, actions: g.actions, captures: g.captures, isl: g.isl } }
    if (state.active !== "None") return { seed, status: "action-limit", winner: null, actions: g.actions, captures: g.captures, isl: g.isl }
    return { seed, status: "complete", winner: state.result, actions: g.actions, endTurn: curTurn, captures: g.captures, isl: g.isl }
}

const games = []
for (let i = 0; i < gameCount; ++i) {
    const r = play(baseSeed + i); games.push(r)
    process.stderr.write(`\r${i + 1}/${gameCount} seed=${r.seed} ${r.status} isl=${r.isl.length} cap=${r.captures}`)
}
process.stderr.write("\n")
const done = games.filter(g => g.status === "complete")
const islSeeds = games.filter(g => g.isl.length)
const totalCaptures = games.reduce((a, g) => a + g.captures, 0)
const totalIsl = games.reduce((a, g) => a + g.isl.length, 0)
const iso = process.env.B_CRUISE === "0" && process.env.B_BIAS === "0" ? "BASELINE(B off)" : "FIX(B on)"
console.log(`\n[${iso}] seeds ${baseSeed}..${baseSeed + gameCount - 1}  n=${gameCount}`)
console.log(`  status: complete ${done.length}  error ${games.filter(g => g.status === "error").length}  action-limit ${games.filter(g => g.status === "action-limit").length}`)
console.log(`  AP per-hex captures: ${totalCaptures} (avg ${(totalCaptures / gameCount).toFixed(1)}/game)`)
console.log(`  island-capture seeds: ${islSeeds.length}/${gameCount}  island/port captures total: ${totalIsl}`)
for (const g of islSeeds) console.log(`    seed ${g.seed} endT=${g.endTurn} win=${g.winner} captures=${g.captures} isl=[${g.isl.join(", ")}]`)
