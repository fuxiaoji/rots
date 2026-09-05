"use strict"

// AI vs AI 自对弈决策轨迹审计: 确定性重放指定剧本的若干局,
// 逐动作收集 erasmus-v2 的 publicTrace, 统计各阵营/各图窗口的决策量与
// 正常(candidate_found)与 fallback 出口分布, 并把全部 fallback 决策连同
// 当时提示落盘, 供核对状态机是否“有决策、决策是否正常”。
// 用法: node erasmus-campaign-trace.js <scenarioName> <gameCount> <baseSeed> [maxActions]
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]

const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const gameCount = Number(process.argv[3] || 10)
const baseSeed = Number(process.argv[4] || 424242)
const maxActions = Number(process.argv[5] || 60000)
if (!policy) throw new Error("no erasmus-v2 bot in rules.js")

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

const perGame = []
const fallbacks = []
const byRole = {}
const byChart = {}

function tally(map, key, fallback) {
    const entry = map[key] || (map[key] = { decisions: 0, fallback: 0 })
    entry.decisions++
    if (fallback) entry.fallback++
}

function play(seed) {
    let state
    try {
        state = rules.setup(seed, scenario, {})
    } catch (error) {
        return { seed, status: "setup-error", error: error.message }
    }
    let actions = 0
    let fallbackCount = 0
    let lastTurn = Number(state.turn || 0)
    const roleActions = { Japan: 0, Allies: 0 }
    const game = { seed, status: "error", decisions: 0, fallback: 0, roleActions, charts: {} }
    try {
        while (state.active !== "None" && actions < maxActions) {
            const role = activeRole(state)
            if (role !== "Japan" && role !== "Allies") throw new Error(`unexpected active role: ${JSON.stringify(state.active)}`)
            const view = rules.view(state, role)
            const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
            const pub = decision.publicTrace || {}
            const turn = Number(view.turn || 0)
            tally(byRole, role, !!pub.fallback)
            tally(byChart, `${pub.chart || "?"}|${role}`, !!pub.fallback)
            game.charts[`${pub.chart || "?"}|${role}`] = (game.charts[`${pub.chart || "?"}|${role}`] || 0) + 1
            if (pub.fallback) {
                ++fallbackCount
                fallbacks.push({
                    seed, ord: actions + 1, role, turn, chart: pub.chart, node: pub.node,
                    action: pub.action, strategy: pub.strategy || null,
                    prompt: String(view.prompt || "").slice(0, 160),
                })
            }
            if (!view.actions || !(decision.action in view.actions))
                throw new Error(`illegal policy action ${decision.action} @ ${view.prompt}`)
            state = rules.action(state, role, decision.action, decision.argument)
            ++roleActions[role]
            ++actions
            game.decisions = actions
            game.fallback = fallbackCount
            lastTurn = Math.max(lastTurn, Number(state.turn || 0))
        }
    } catch (error) {
        game.status = "error"
        game.error = error.message
        game.turn = lastTurn
        return game
    }
    game.status = state.active === "None" ? "complete" : "action-limit"
    game.turn = lastTurn
    game.actions = actions
    game.winner = state.result || null
    return game
}

for (let index = 0; index < gameCount; ++index) {
    const seed = baseSeed + index
    const game = play(seed)
    perGame.push(game)
    process.stderr.write(`\r${index + 1}/${gameCount} ${game.status} seed=${seed} actions=${game.actions ?? "-"} fallback=${game.fallback} `)
}
process.stderr.write("\n")

const complete = perGame.filter(g => g.status === "complete")
const output = {
    policy: policy.version,
    scenario,
    gameCount,
    baseSeed,
    maxActions,
    generatedAt: new Date().toISOString(),
    summary: {
        complete: complete.length,
        errors: perGame.filter(g => g.status === "error").length,
        actionLimit: perGame.filter(g => g.status === "action-limit").length,
        setupErrors: perGame.filter(g => g.status === "setup-error").length,
        totalDecisions: complete.reduce((s, g) => s + g.decisions, 0),
        totalFallback: complete.reduce((s, g) => s + g.fallback, 0),
        byRole,
        byChart,
    },
    games: perGame,
    fallbacks,
}
const slug = scenario.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")
const outputPath = path.join(__dirname, "results", `erasmus-campaign-${slug}-trace-${gameCount}-${baseSeed}.json`)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n")
console.log(JSON.stringify(output.summary, null, 2))
console.log(`fallback decisions: ${fallbacks.length}`)
console.log(outputPath)
