"use strict"
// B 定点爆破: 单局打印 AP 攻势/会战/夺格/两栖相关日志, 看攻势实际发生在哪个战区、
// 是否真有 TF 触达中太平洋岛屿, 或全在陆地/近岸拉锯。
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const setupOptions = { headless_moves: process.env.EOTS_HEADLESS_MOVES !== "0" }
const seed = Number(process.argv[2] || 20260903)
const maxActions = Number(process.argv[3] || 90000)

function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }
const RE = /Battle declared in|Battle hex|No battle hexes|captured H|activated for|offensive|reaction|ASP|Amphibious|amphib|landing|Organic transport|advance|interdict|Air Naval combat|Ground combat|failed|surrendered|Strategic|supply|Out of Supply|eliminated|retreat/i
const TRACE_RE = /Battle declared in|No battle hexes declared|captured H\d+|Amphibious Assault failed|ASP used|Organic transport used|\+3 Amphibious|Battle hex [A-Z]/
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
const named = s => s.replace(/\bH(\d+)\b/g, (_, id) => `${id}:${nameOf(+id)}`)
let state
try { state = rules.setup(seed, scenario, setupOptions) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
const log = []
let turn = 1
let actions = 0
let lastSide = null
try {
    while (state.active !== "None" && actions < maxActions) {
        const role = activeRole(state)
        turn = Number(state.turn || 1)
        const view = rules.view(state, role)
        const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
        if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
        const preLen = state.log.length
        state = rules.action(state, role, d.action, d.argument)
        for (const line of state.log.slice(preLen)) {
            if (/\b(?:Japan|Allies)\b.*(?:activated for|started|played|declared)/i.test(line)) lastSide = /Japan/i.test(line) ? "JP" : "AP"
            if (TRACE_RE.test(line)) log.push(`[T${turn}${lastSide ? "/" + lastSide : ""}] ${named(line)}`)
            if (/^@Turn \d+/.test(line)) { turn = Number((line.match(/^@Turn (\d+)/) || [])[1] || turn); log.push(`[T${turn}] ===== ${line.trim()} =====`) }
        }
        actions++
    }
} catch (e) { console.log("error", e.message, "actions", actions, "turn", turn); process.exit(2) }
console.log("seed", seed, "endT", turn, "win", state.result, "actions", actions, "active", state.active)
console.log("\n===== 夺格/会战/两栖/ASP 日志(按游戏顺序) =====")
for (const l of log) console.log(l)
