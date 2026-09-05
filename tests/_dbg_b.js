"use strict"
// B 定向侦察: 引擎占格/登岛执行 —— 1942 完整剧本 headless, 归因 AP 夺岛链在哪一环断掉。
// 采样点 = 每方每回合首卡窗(gate 开时 SM 钉选): 记录钉住战略 + 其 phase/kind + 实时焦点
// sm.focus(= eop_focus: 该战略目标链上第一个未被 AP 夺控的格, 引擎同闭包实算) + 链首。
// 同时记录全游戏 AP 夺格(turn+hex) 与终局控制, 复现“夺到 X 后焦点应推进到 Y 却始终未夺 Y”。
// 不修改引擎; 结果打 stdout。用法: node tests/_dbg_b.js [局数] [起始seed] [maxActions]
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const HEADLESS = process.env.EOTS_HEADLESS_MOVES !== "0"
const setupOptions = { headless_moves: HEADLESS }
const gameCount = Number(process.argv[2] || 4)
const baseSeed = Number(process.argv[3] || 20260903)
const maxActions = Number(process.argv[4] || 60000)

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

function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }

function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, setupOptions) } catch (e) { return { seed, status: "setup-error", error: e.message } }
    const g = { seed, status: "error", winner: null, actions: 0 }
    const pins = [] // AP 钉选: {turn, strategy, kind, phase, focus, chainHead, chainLen}
    const apCaptures = [] // {turn, idx}
    let curTurn = Number(state.turn || 0)
    try {
        while (state.active !== "None" && g.actions < maxActions) {
            const role = activeRole(state)
            if (role !== "Japan" && role !== "Allies") throw new Error(`unexpected active ${JSON.stringify(state.active)}`)
            const turn = Number(state.turn || 0)
            const view = rules.view(state, role)
            const d = policy.decide(view, { role, seed, actionOrdinal: g.actions + 1 })
            if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
            const preLen = state.log.length
            state = rules.action(state, role, d.action, d.argument)
            // 夺格日志常在对方 [done]/[next] 边界结算、会战窗内有 &A 前缀, 故不限 role,
            // 匹配 /^(?:&A)?AP captured H(\d+)/ 并去同 action 双日志(non_control+夺控)。
            const seenCap = new Set()
            for (const line of state.log.slice(preLen)) {
                const cm = line.match(/^(?:&A)?AP captured H(\d+)/)
                if (!cm || seenCap.has(cm[1])) continue
                seenCap.add(cm[1])
                apCaptures.push({ turn, idx: +cm[1] })
            }
            const sm = d.publicTrace && d.publicTrace.sm
            if (role === "Allies" && sm && sm.pinnedNow) {
                pins.push({ turn, strategy: sm.strategy, kind: sm.kind, phase: sm.phase,
                    focus: sm.focus, chainHead: sm.chainHead, chainLen: sm.chainLen })
            }
            g.actions++
            curTurn = turn
        }
    } catch (e) { return { seed, status: "error", winner: null, actions: g.actions, error: e.message, pins, apCaptures } }
    if (state.active !== "None") return { seed, status: "action-limit", winner: null, actions: g.actions, pins, apCaptures }
    return { seed, status: "complete", winner: state.result, actions: g.actions, endTurn: curTurn,
        pins, apCaptures: apCaptures.map(c => ({ t: c.turn, h: `${c.idx}:${nameOf(c.idx)}` })) }
}

const games = []
for (let i = 0; i < gameCount; ++i) {
    const r = play(baseSeed + i); games.push(r)
    process.stderr.write(`\r${i + 1}/${gameCount} seed=${r.seed} ${r.status} endT=${r.endTurn} win=${r.winner} actions=${r.actions}`)
}
process.stderr.write("\n")

for (const g of games) {
    console.log("\n=== seed", g.seed, g.status, "endT", g.endTurn, "win", g.winner)
    if (g.error) { console.log("  ERROR", g.error); continue }
    console.log("  AP pins (T turn | strategy | kind/phase | focus → next-to-capture):")
    for (const p of g.pins) {
        console.log(`    T${p.turn} ${p.strategy} [${p.kind}/${p.phase}] chain=${p.chainLen} head=${p.chainHead === null ? "-" : nameOf(p.chainHead)} focus=${p.focus === null ? "-" : nameOf(p.focus)}`)
    }
    console.log("  AP captures:", g.apCaptures.length ? g.apCaptures.map(c => `T${c.t} ${c.h}`).join(" | ") : "(none)")
    // 每个曾经成为 focus 的格, 是否最终被 AP 夺控(推进成功)
    const focusStall = []
    const seen = new Set()
    for (const p of g.pins) {
        if (p.focus === null || seen.has(p.focus)) continue
        seen.add(p.focus)
        const ever = g.apCaptures.some(c => c.idx === p.focus)
        focusStall.push(`${nameOf(p.focus)}${ever ? "*CAPTURED" : "·UNTAKEN"}`)
    }
    console.log("  distinct focus hexes (in order first-seen):", focusStall.join(" → "))
}
