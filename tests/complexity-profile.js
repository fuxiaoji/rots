"use strict"

// E1: EOTS 有效复杂度画像 (Research Plan §22)。
// 跑 N 局, 逐 AI 决策记录: 分支宽度(|actions|键数与展开参数数)、决策类型、双方单位数,
// 汇总 median/p95/max 合法动作数、每局决策深度、单位复杂度。输出 JSON 到 tests/results/。
// 用法: EOTS_HEADLESS_MOVES=1 node tests/complexity-profile.js "<scenario>" <count> <baseSeed>
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")

const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const gameCount = Number(process.argv[3] || 8)
const baseSeed = Number(process.argv[4] || 20260903)
const maxActions = 60000
const headlessMoves = process.env.EOTS_HEADLESS_MOVES === "1"
const policy = rules.bots["erasmus-v2"]

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

function branching(view) {
    // 分支宽度 = 各动作键的取值数之和(展开参数); 键数 = 决策类型数
    const actions = view.actions || {}
    let expanded = 0
    for (const k of Object.keys(actions)) {
        const v = actions[k]
        expanded += Array.isArray(v) ? Math.max(1, v.length) : 1
    }
    return { keys: Object.keys(actions).length, expanded }
}

const games = []
for (let index = 0; index < gameCount; ++index) {
    const seed = baseSeed + index
    let state = rules.setup(seed, scenario, { headless_moves: headlessMoves })
    const rec = { seed, decisions: 0, keys: [], expanded: [], byPrompt: {}, units: { Japan: [], Allies: [] }, winner: null, turn: 0 }
    let a = 0
    while (state.active !== "None" && a < maxActions) {
        const role = activeRole(state)
        if (role !== "Japan" && role !== "Allies") break
        const view = rules.view(state, role)
        const b = branching(view)
        rec.keys.push(b.keys); rec.expanded.push(b.expanded)
        const promptKind = String(view.prompt || "").replace(/[0-9]+/g, "#").slice(0, 40)
        rec.byPrompt[promptKind] = (rec.byPrompt[promptKind] || 0) + 1
        const decision = policy.decide(view, { role, seed, actionOrdinal: a + 1 })
        if (!(decision.action in (view.actions || {}))) break
        state = rules.action(state, role, decision.action, decision.argument)
        a++; rec.decisions++
        rec.turn = Math.max(rec.turn, Number(state.turn || 0))
        if (a % 200 === 0 && view.ai?.units) {
            for (const side of ["Japan", "Allies"]) {
                const onBoard = view.ai.units.filter(u => u.faction === (side === "Japan" ? 0 : 1) && u.location >= 0 && u.location <= 1480)
                rec.units[side].push(onBoard.length)
            }
        }
    }
    rec.winner = state.result?.won_side || null
    games.push(rec)
    process.stderr.write(`\r${index + 1}/${gameCount} seed=${seed} decisions=${rec.decisions} turn=${rec.turn}`)
}
process.stderr.write("\n")

function stats(arr) {
    if (!arr.length) return null
    const s = arr.slice().sort((x, y) => x - y)
    const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]
    return { n: s.length, mean: Number((s.reduce((x, y) => x + y, 0) / s.length).toFixed(2)),
        median: q(0.5), p95: q(0.95), max: s[s.length - 1] }
}
const allKeys = games.flatMap(g => g.keys)
const allExpanded = games.flatMap(g => g.expanded)
const out = { generatedAt: new Date().toISOString(), scenario, gameCount, baseSeed,
    decisionDepth: { perGame: stats(games.map(g => g.decisions)), perTurn: stats(games.map(g => g.decisions / Math.max(1, g.turn))) },
    branchingKeys: stats(allKeys), branchingExpanded: stats(allExpanded),
    topDecisionKinds: Object.entries(games.reduce((m, g) => { for (const [k, v] of Object.entries(g.byPrompt)) m[k] = (m[k] || 0) + v; return m }, {}))
        .sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => ({ kind: k, count: v })),
    unitsOnBoard: { Japan: stats(games.flatMap(g => g.units.Japan)), Allies: stats(games.flatMap(g => g.units.Allies)) },
    playableHexCount: 1477,
    perGame: games.map(g => ({ seed: g.seed, decisions: g.decisions, turn: g.turn, winner: g.winner })) }
const slug = scenario.replace(/[^\w]+/g, "-")
const outputPath = path.join(__dirname, "results", `complexity-${slug}-${gameCount}-${baseSeed}.json`)
fs.writeFileSync(outputPath, JSON.stringify(out, null, 1) + "\n")
console.log(JSON.stringify({ decisionDepth: out.decisionDepth, branchingKeys: out.branchingKeys,
    branchingExpanded: out.branchingExpanded, unitsOnBoard: out.unitsOnBoard }, null, 1))
console.log(outputPath)
