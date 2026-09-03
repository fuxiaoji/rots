"use strict"

// 审计运行器: 状态机 N 局自对打(不同种子, 剧本可参数化), 统计胜率 + 战略/战术层面行动使用。
// 战略 = 决策轴+选牌(JP-01/02/03/04, AP-07/08/09/10); 战术 = 任务部队编成+反应(JP-05/06, AP-11/12)。
// 另统计会战申报(declare 窗 unit→action_hex)与真实交战(" fire (" 行), 确认战术层确实“用上行动”。
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]

const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const gameCount = Number(process.argv[3] || 50)
const baseSeed = Number(process.argv[4] || 20260903)
const maxActions = Number(process.argv[5] || 60000)

// 图页编码→层: 决策轴 axis / 选牌 card 属“战略”; 编成 taskforce / 反应 reaction 属“战术”。
function kindOf(chart) {
    const m = String(chart || "").match(/(JP|AP)\D*(\d+)$/i)
    if (!m) return "?"
    const side = m[1].toUpperCase(), n = +m[2]
    if ((side === "JP" && n >= 1 && n <= 3) || (side === "AP" && n >= 7 && n <= 9)) return "axis"
    if ((side === "JP" && n === 4) || (side === "AP" && n === 10)) return "card"
    if ((side === "JP" && n === 5) || (side === "AP" && n === 11)) return "taskforce"
    if ((side === "JP" && n === 6) || (side === "AP" && n === 12)) return "reaction"
    return "?"
}

const emptyRole = () => ({ decisions: 0, byKind: { axis: 0, card: 0, taskforce: 0, reaction: 0, "?": 0 },
    airStrikeUnits: 0, airStrikeHexes: 0, fire: 0 })
const empty = () => ({ Japan: emptyRole(), Allies: emptyRole() })

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

function play(seed) {
    let state
    try {
        state = rules.setup(seed, scenario, {})
    } catch (error) {
        return { seed, status: "setup-error", winner: null, error: error.message }
    }
    const g = { seed, status: "error", winner: null, actions: 0, turn: Number(state.turn || 0), fallback: 0,
        noBattleHex: 0, role: empty(), context: null }
    try {
        while (state.active !== "None" && g.actions < maxActions) {
            const role = activeRole(state)
            if (role !== "Japan" && role !== "Allies") throw new Error(`unexpected active role: ${JSON.stringify(state.active)}`)
            const view = rules.view(state, role)
            g.context = { role, turn: view.turn, prompt: view.prompt, actions: view.actions }
            const decision = policy.decide(view, { role, seed, actionOrdinal: g.actions + 1 })
            if (!view.actions || !(decision.action in view.actions))
                throw new Error(`illegal policy action ${decision.action} @ ${view.prompt}`)
            const chart = String((decision.publicTrace || {}).chart || "")
            const r = g.role[role]
            r.decisions++
            r.byKind[kindOf(chart)]++
            if (decision.publicTrace.fallback) g.fallback++
            if (/Declare battle hexes/.test(String(view.prompt || ""))) {
                if (decision.action === "unit") r.airStrikeUnits++
                else if (decision.action === "action_hex") r.airStrikeHexes++
            }
            state = rules.action(state, role, decision.action, decision.argument)
            g.actions++
            g.turn = Math.max(g.turn, Number(state.turn || 0))
        }
    } catch (error) {
        return { seed, status: "error", winner: null, actions: g.actions, turn: g.turn, fallback: g.fallback,
            role: g.role, error: error.message, context: g.context }
    }
    if (state.active !== "None")
        return { seed, status: "action-limit", winner: null, actions: g.actions, turn: g.turn, fallback: g.fallback,
            role: g.role, maxActions }
    // 终态日志是权威顺序事件流; 一次性扫描交战/空袭相关行。
    // fire 行前缀含阵营(如 &JJP fire / &AAP fire); "No battle hexes declared." 无前缀, 归为标量。
    for (const line of (state.log || [])) {
        if (/ fire \(/.test(line)) {
            const side = /^&A/i.test(line) ? "Allies" : /^&J/i.test(line) ? "Japan" : null
            if (side) g.role[side].fire++
        } else if (/No battle hexes declared/.test(line)) {
            g.noBattleHex++
        }
    }
    const winner = state.result?.won_side || state.result || null
    return { seed, status: "complete", winner, actions: g.actions, turn: g.turn, fallback: g.fallback,
        noBattleHex: g.noBattleHex, role: g.role, won_text: state.result?.won_text || null }
}

const games = []
for (let index = 0; index < gameCount; ++index) {
    const seed = baseSeed + index
    const result = play(seed)
    games.push(result)
    process.stderr.write(`\r${index + 1}/${gameCount} ${result.status} seed=${seed} actions=${result.actions ?? "-"} turn=${result.turn ?? "-"} winner=${result.winner ?? "-"} `)
}
process.stderr.write("\n")

const completed = games.filter(x => x.status === "complete")
const tally = { policy: policy.version, scenario, gameCount, baseSeed, maxActions,
    complete: completed.length,
    japanWins: completed.filter(x => x.winner === "Japan").length,
    alliesWins: completed.filter(x => x.winner === "Allies").length,
    otherWins: completed.filter(x => !["Japan", "Allies"].includes(x.winner)).length,
    errors: games.filter(x => x.status === "error").length,
    setupErrors: games.filter(x => x.status === "setup-error").length,
    actionLimit: games.filter(x => x.status === "action-limit").length,
    fallback: games.reduce((s, x) => s + (x.fallback || 0), 0),
    role: empty(),
    noBattleHex: 0 }
completed.forEach(g => {
    for (const side of ["Japan", "Allies"]) {
        const r = g.role[side], t = tally.role[side]
        t.decisions += r.decisions
        for (const k of Object.keys(t.byKind)) t.byKind[k] += r.byKind[k]
        t.airStrikeUnits += r.airStrikeUnits; t.airStrikeHexes += r.airStrikeHexes
        t.fire += r.fire
    }
    tally.noBattleHex += g.noBattleHex
})

const output = { generatedAt: new Date().toISOString(), tally,
    perGame: completed.map(g => ({ seed: g.seed, winner: g.winner, actions: g.actions, turn: g.turn, fallback: g.fallback,
        noBattleHex: g.noBattleHex, role: g.role })),
    errors: games.filter(x => x.status === "error").map(g => ({ seed: g.seed, error: g.error, actions: g.actions, context: g.context })) }
const slug = scenario.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")
const outputPath = path.join(__dirname, "results", `audit50-${slug}-${gameCount}-${baseSeed}.json`)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n")
console.log(JSON.stringify({ complete: tally.complete, errors: tally.errors, setupErrors: tally.setupErrors,
    actionLimit: tally.actionLimit, japanWins: tally.japanWins, alliesWins: tally.alliesWins, otherWins: tally.otherWins,
    fallback: tally.fallback, role: tally.role }, null, 1))
console.log(outputPath)
