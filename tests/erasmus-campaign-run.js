"use strict"

// AI vs AI 自对弈运行器(剧本参数化): 在指定完整剧本上驱动双方 erasmus-v2 bot,
// 统计每局是否正常终局、胜负、非法动作、fallback、动作上限中止。
// 用法: node erasmus-campaign-run.js <scenarioName> <gameCount> <baseSeed> [maxActions]
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]

const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const gameCount = Number(process.argv[3] || 10)
const baseSeed = Number(process.argv[4] || 424242)
const maxActions = Number(process.argv[5] || 60000)
if (!policy) throw new Error("no erasmus-v2 bot in rules.js")
if (!Number.isInteger(gameCount) || gameCount < 1) throw new Error("game count must be positive")

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

function play(seed) {
    let state
    try {
        state = rules.setup(seed, scenario, {})
    } catch (error) {
        return { seed, status: "setup-error", error: error.message }
    }
    let actions = 0
    let fallback = 0
    let lastTurn = Number(state.turn || 0)
    const roleActions = { Japan: 0, Allies: 0 }
    let context = null
    try {
        while (state.active !== "None" && actions < maxActions) {
            const role = activeRole(state)
            if (role !== "Japan" && role !== "Allies") throw new Error(`unexpected active role: ${JSON.stringify(state.active)}`)
            const view = rules.view(state, role)
            context = { role, turn: view.turn, prompt: view.prompt, actions: view.actions }
            const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
            if (!view.actions || !(decision.action in view.actions))
                throw new Error(`illegal policy action ${decision.action} @ ${view.prompt}`)
            if (decision.publicTrace.fallback) ++fallback
            state = rules.action(state, role, decision.action, decision.argument)
            ++roleActions[role]
            ++actions
            lastTurn = Math.max(lastTurn, Number(state.turn || 0))
        }
    } catch (error) {
        return { seed, status: "error", winner: null, actions, turn: lastTurn, fallback, roleActions, error: error.message, context }
    }
    if (state.active !== "None")
        return { seed, status: "action-limit", winner: null, actions, turn: lastTurn, fallback, roleActions, maxActions }
    const winner = state.result?.won_side || state.result || null
    return {
        seed, status: "complete", winner, actions, turn: lastTurn, fallback, roleActions,
        won_text: state.result?.won_text || null,
    }
}

const games = []
for (let index = 0; index < gameCount; ++index) {
    const seed = baseSeed + index
    const result = play(seed)
    games.push(result)
    process.stderr.write(`\r${index + 1}/${gameCount} ${result.status} seed=${seed} actions=${result.actions ?? "-"} turn=${result.turn ?? "-"} winner=${result.winner ?? "-"} `)
}
process.stderr.write("\n")

const completed = games.filter(g => g.status === "complete")
const summary = {
    policy: policy.version,
    scenario,
    gameCount,
    baseSeed,
    maxActions,
    complete: completed.length,
    japanWins: completed.filter(g => g.winner === "Japan").length,
    alliesWins: completed.filter(g => g.winner === "Allies").length,
    otherWins: completed.filter(g => !["Japan", "Allies"].includes(g.winner)).length,
    setupErrors: games.filter(g => g.status === "setup-error").length,
    errors: games.filter(g => g.status === "error").length,
    actionLimit: games.filter(g => g.status === "action-limit").length,
    fallbackActions: games.reduce((sum, g) => sum + (g.fallback || 0), 0),
    averageActions: completed.reduce((sum, g) => sum + g.actions, 0) / (completed.length || 1),
    averageTurn: completed.reduce((sum, g) => sum + g.turn, 0) / (completed.length || 1),
}

const output = { generatedAt: new Date().toISOString(), summary, games }
const slug = scenario.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")
const outputPath = path.join(__dirname, "results", `erasmus-campaign-${slug}-${gameCount}-${baseSeed}.json`)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n")
console.log(JSON.stringify(summary, null, 2))
console.log(outputPath)
