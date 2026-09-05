"use strict"

// AI vs AI 单局战报数据源: 确定性重放指定剧本的一局, 收集全部引擎日志行与
// 每个决策窗的 publicTrace(图页/节点/策略/动作), 并把日志中的 C#/P#/H# 记号
// 解译为真实卡牌/单位/地图格名称(中英对照), 供人工撰写“详细战报+解说”。
// 用法: node erasmus-campaign-transcript.js <scenarioName> <seed> [maxActions]
const fs = require("fs")
const path = require("path")
const vm = require("vm")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]

const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const seed = Number(process.argv[3] || 424242)
const maxActions = Number(process.argv[4] || 60000)
if (!policy) throw new Error("no erasmus-v2 bot in rules.js")

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}
function roleLabel(role) {
    return role === 0 || role === "Japan" ? "Japan" : role === 1 || role === "Allies" ? "Allies" : String(role)
}

/* ---- 从 rules.js 束里取内部数据表(cards/pieces/map), 从 locale_zh.js 取中译 ---- */
const module_ = { exports: {} }
const ctx = vm.createContext({ module: module_, exports: module_.exports, console, process })
ctx.globalThis = ctx
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "rules.js"), "utf8"), ctx, { filename: "rules.js" })
const probe = src => vm.runInContext(src, ctx)
const cards = probe("cards")
const pieces = probe("pieces")

let zh = { units: {}, cards: {}, places: {} }
try {
    const zhCtx = vm.createContext({})
    zhCtx.globalThis = zhCtx
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "common", "locale_zh.js"), "utf8"), zhCtx, { filename: "locale_zh.js" })
    zh = zhCtx.EOTS_ZH_NAMES || zh
} catch (error) {
    console.error("warning: locale_zh.js not loaded:", error.message)
}

function hexInfo(i) {
    // 完整剧本(1942-1945)使用全图: get_map_data ≡ MAP_DATA, 直接取数据避免依赖 G。
    try {
        const md = probe(`MAP_DATA[${i}]`)
        const coord = probe(`int_to_hex(${i})`)
        if (!md) return { coord }
        return { coord, name: md.name, region: md.region, port: md.port, airfield: md.airfield, city: md.city }
    } catch (error) {
        return { coord: String(i) }
    }
}
const hexCache = new Map()
function hexLabel(i) {
    if (hexCache.has(i)) return hexCache.get(i)
    const info = hexInfo(i)
    const zhName = info.name ? (zh.places[info.name] ? `${zh.places[info.name]}(${info.name})` : info.name) : null
    const region = info.region && info.region !== "Ocean" ? (zh.places[info.region] || info.region) : null
    let label = `格${info.coord}`
    if (zhName) label = `${zhName}格(${info.coord})`
    else if (region) label = `${region}格(${info.coord})`
    hexCache.set(i, label)
    return label
}
function cardLabel(i) {
    const c = cards[i]
    if (!c) return `C${i}?`
    const zhName = zh.cards[c.name]
    return `C${i}${zhName}(${c.name})`
}
function pieceLabel(i) {
    const p = pieces[i]
    if (!p || !p.name) return `P${i}?`
    const zhName = zh.units[p.name]
    return `${zhName || p.name}[${i}]`
}

function annotate(line) {
    return line
        .replace(/(?<![A-Za-z])C(\d+)(?![A-Za-z0-9])/g, (_, i) => cardLabel(+i))
        .replace(/(?<![A-Za-z])P(\d+)(?![A-Za-z0-9])/g, (_, i) => pieceLabel(+i))
        .replace(/(?<![A-Za-z])H(\d+)(?![A-Za-z0-9])/g, (_, i) => hexLabel(+i))
}

/* ---- 重放对局, 累积日志与决策轨迹 ---- */
function play() {
    let state
    try {
        state = rules.setup(seed, scenario, {})
    } catch (error) {
        return { status: "setup-error", error: error.message }
    }
    const transcript = []
    const decisions = []
    const preamble = (state.log || []).slice()
    for (const line of preamble) transcript.push({ kind: "log", line })
    let prev = state.log ? state.log.length : 0
    let actions = 0
    let lastTurn = Number(state.turn || 0)
    try {
        while (state.active !== "None" && actions < maxActions) {
            const role = roleLabel(activeRole(state))
            const view = rules.view(state, role)
            const turn = Number(view.turn || 0)
            const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
            const pub = decision.publicTrace || {}
            decisions.push({
                ord: actions + 1, role, turn,
                chart: pub.chart, node: pub.node, strategy: pub.strategy,
                action: decision.action, fallback: !!pub.fallback,
                explanation: pub.explanation,
            })
            state = rules.action(state, role, decision.action, decision.argument)
            ++actions
            if (state.log && state.log.length > prev) {
                for (const line of state.log.slice(prev)) transcript.push({ kind: "log", line })
                prev = state.log.length
            }
            lastTurn = Math.max(lastTurn, Number(state.turn || 0))
        }
    } catch (error) {
        return { status: "error", error: error.message, turn: lastTurn, transcript, decisions }
    }
    const end = state.active === "None" ? "complete" : "action-limit"
    // 终局补充段(若引擎在最后一跳外写了日志, prev 已覆盖全部)
    return { status: end, turn: lastTurn, actions, winner: state.result || null, transcript, decisions }
}

const result = play()
const slug = scenario.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")
const base = `erasmus-campaign-${slug}`
const txtPath = path.join(__dirname, "results", `${base}-transcript-${seed}.txt`)
const decPath = path.join(__dirname, "results", `${base}-decisions-${seed}.json`)
fs.mkdirSync(path.dirname(txtPath), { recursive: true })

// 只把日志行再按回合分段写出; 决策行合并到 JSON
const sep = "=========="
const out = []
out.push(`# ${scenario}  seed=${seed}  status=${result.status}  winner=${result.winner}`)
out.push(`# policy=${policy.version}  actions=${result.actions}  logLines=${result.transcript.filter(t => t.kind === "log").length}`)
if (result.error) out.push(`# ERROR: ${result.error}`)
let cur = -1
let idx = 0
for (const t of result.transcript) {
    const m = String(t.line).match(/^@Turn (\d+)/)
    if (m) cur = +m[1]
    out.push(`${m ? "\n" : ""}${m ? "" : ""}${String(idx).padStart(4)} [T${cur < 0 ? "?" : cur}] ${annotate(t.line)}`)
    ++idx
}
fs.writeFileSync(txtPath, out.join("\n") + "\n")
fs.writeFileSync(decPath, JSON.stringify({ policy: policy.version, scenario, seed, status: result.status, winner: result.winner, decisions: result.decisions }, null, 2) + "\n")

console.log(JSON.stringify({ status: result.status, winner: result.winner, actions: result.actions, logLines: idx }, null, 2))
console.log(txtPath)
console.log(decPath)
