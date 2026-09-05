"use strict"

// 审计运行器: 状态机 N 局自对打(不同种子, 剧本可参数化), 统计胜率 + 战略/战术层面行动使用。
// 战略 = 决策轴+选牌(JP-01/02/03/04, AP-07/08/09/10); 战术 = 任务部队编成+反应(JP-05/06, AP-11/12)。
// 另统计会战申报(declare 窗 unit→action_hex)与真实交战(" fire (" 行), 确认战术层确实“用上行动”。
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const chartDocument = JSON.parse(fs.readFileSync(path.join(__dirname,"..","data","erasmus","charts.json"),"utf8"))
const chartNodes = new Map(chartDocument.charts.map(c=>[c.id,new Set(c.nodes.map(n=>n.id))]))

const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const gameCount = Number(process.argv[3] || 50)
const baseSeed = Number(process.argv[4] || 20260903)
const maxActions = Number(process.argv[5] || 60000)
const outputTag = String(process.argv[6] || "").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "")

// EOTS_HEADLESS_MOVES=1 开启服务端无头推进(js/server/offensive.js advance)。
// 默认关闭; 关闭时决策与旧基线逐位一致。
const headlessMoves = process.env.EOTS_HEADLESS_MOVES === "1"
const setupOptions = { headless_moves: headlessMoves }

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
    airStrikeUnits: 0, airStrikeHexes: 0, fire: 0, advance: 0 })
const empty = () => ({ Japan: emptyRole(), Allies: emptyRole() })

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

function play(seed) {
    let state
    try {
        state = rules.setup(seed, scenario, setupOptions)
    } catch (error) {
        return { seed, status: "setup-error", winner: null, error: error.message }
    }
    const g = { seed, status: "error", winner: null, actions: 0, turn: Number(state.turn || 0), fallback: 0,
        noBattleHex: 0, unexplainedNoBattle:0, traceNodeMissing:0, role: empty(), context: null, strategyLog: [], strategyCounts:{},
        closestAdvance: { alliedUnit: null, alliedControlledHex: null, b29: null }, atomicBest: null }
    g.groundMove = 0
    g.capturedAP = 0
    g.capturedJP = 0
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
            const pathNodes = decision.publicTrace?.nodePath || (decision.publicTrace?.node ? [decision.publicTrace.node] : [])
            const known = chartNodes.get(chart)
            if (!known || pathNodes.some(n=>!known.has(n))) g.traceNodeMissing++
            const r = g.role[role]
            r.decisions++
            r.byKind[kindOf(chart)]++
            if (decision.action === "advance") r.advance++
            if (decision.publicTrace.fallback) g.fallback++
            const sm = decision.privateTrace?.sm || decision.publicTrace?.sm
            if (sm?.pinnedNow) {
                const sk=`${role}/${sm.phase}/${sm.strategy}`; g.strategyCounts[sk]=(g.strategyCounts[sk]||0)+1
                g.strategyLog.push({ turn: Number(view.turn || 0), role, phase: sm.phase, strategy: sm.strategy,
                    action: decision.action, focus: sm.focus,
                    priorityTargets: (sm.priorityTargets || []).filter(x => !x.achieved).slice(0, 5)
                        .map(x => ({ priority: x.priority, hex: x.hex, id: x.id, name: x.name, distanceToTokyo: x.distanceToTokyo })) })
                const advance = sm.diag?.advance || {}
                const keepClosest = (key, item) => {
                    if (!item || !Number.isFinite(item.distance)) return
                    if (!g.closestAdvance[key] || item.distance < g.closestAdvance[key].distance)
                        g.closestAdvance[key] = { ...item, turn: Number(view.turn || 0) }
                }
                keepClosest("alliedUnit", advance.closestAlliedUnit)
                keepClosest("alliedControlledHex", advance.closestAlliedControlledHex)
                keepClosest("b29", advance.closestB29)
                if (sm.diag?.atomic) {
                    const a = sm.diag.atomic
                    if (!g.atomicBest || Number(a.jpResources) < Number(g.atomicBest.jpResources))
                        g.atomicBest = { ...a, turn: Number(view.turn || 0) }
                }
            }
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
    // "moved to ... (Ground move)." = 攻击阶段真实地面接敌移动; "AP/JP captured" = 夺格。
    for (const line of (state.log || [])) {
        if (/ fire \(/.test(line)) {
            const side = /^&A/i.test(line) ? "Allies" : /^&J/i.test(line) ? "Japan" : null
            if (side) g.role[side].fire++
        } else if (/No battle hexes declared/.test(line)) {
            g.noBattleHex++
            if (!/: (?:no active unit can reach|chart candidate units and targets were exhausted)/.test(line)) g.unexplainedNoBattle++
        } else if (/moved to .*\(Ground move\)\./.test(line)) {
            g.groundMove++
        } else if (/^AP captured /.test(line)) {
            g.capturedAP++
        } else if (/^JP captured /.test(line)) {
            g.capturedJP++
        }
    }
    const winner = state.result?.won_side || state.result || null
    let finalAtomic = null
    try { finalAtomic = rules.query(state, "Allies", "atomic_bomb_strategy_status") } catch (e) { /* diagnostic only */ }
    const powBank = Array.isArray(state.capture) ? state.capture.length : 0
    const surrender = Array.isArray(state.surrender) ? {
        philippines: !!state.surrender[0], malaya: !!state.surrender[1], dei: !!state.surrender[2],
        burma: !!state.surrender[3], japan: !!state.surrender[12],
    } : null
    return { seed, status: "complete", winner, actions: g.actions, turn: g.turn, fallback: g.fallback,
        noBattleHex: g.noBattleHex, unexplainedNoBattle:g.unexplainedNoBattle, traceNodeMissing:g.traceNodeMissing, strategyCounts:g.strategyCounts,
        groundMove: g.groundMove, capturedAP: g.capturedAP, capturedJP: g.capturedJP,
        politicalWill: Number(state.political_will || 0), powRequired: Number(state.pow || 0), powBank, surrender,
        role: g.role, won_text: state.result?.won_text || state.L?.message || null, closestAdvance: g.closestAdvance,
        atomicBest: g.atomicBest, finalAtomic, strategyLog: g.strategyLog }
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
const tally = { policy: policy.version, scenario, gameCount, baseSeed, maxActions, headless_moves: headlessMoves,
    complete: completed.length,
    japanWins: completed.filter(x => x.winner === "Japan").length,
    alliesWins: completed.filter(x => x.winner === "Allies").length,
    otherWins: completed.filter(x => !["Japan", "Allies"].includes(x.winner)).length,
    errors: games.filter(x => x.status === "error").length,
    setupErrors: games.filter(x => x.status === "setup-error").length,
    actionLimit: games.filter(x => x.status === "action-limit").length,
    fallback: games.reduce((s, x) => s + (x.fallback || 0), 0),
    groundMove: 0, capturedAP: 0, capturedJP: 0, atomicBombWins: 0,
    role: empty(),
    noBattleHex: 0, unexplainedNoBattle:0, traceNodeMissing:0, strategyCounts:{} }
completed.forEach(g => {
    for (const side of ["Japan", "Allies"]) {
        const r = g.role[side], t = tally.role[side]
        t.decisions += r.decisions
        for (const k of Object.keys(t.byKind)) t.byKind[k] += r.byKind[k]
        t.airStrikeUnits += r.airStrikeUnits; t.airStrikeHexes += r.airStrikeHexes
        t.fire += r.fire; t.advance += r.advance
    }
    tally.noBattleHex += g.noBattleHex
    tally.unexplainedNoBattle += g.unexplainedNoBattle
    tally.traceNodeMissing += g.traceNodeMissing
    for(const [k,v] of Object.entries(g.strategyCounts||{})) tally.strategyCounts[k]=(tally.strategyCounts[k]||0)+v
    tally.groundMove += g.groundMove
    tally.capturedAP += g.capturedAP
    tally.capturedJP += g.capturedJP
    if (/atomic bomb strategy/i.test(String(g.won_text || ""))) tally.atomicBombWins++
})

const output = { generatedAt: new Date().toISOString(), tally,
    perGame: completed.map(g => ({ seed: g.seed, winner: g.winner, actions: g.actions, turn: g.turn, fallback: g.fallback,
        noBattleHex: g.noBattleHex, unexplainedNoBattle:g.unexplainedNoBattle, traceNodeMissing:g.traceNodeMissing, strategyCounts:g.strategyCounts,
        groundMove: g.groundMove, capturedAP: g.capturedAP, capturedJP: g.capturedJP,
        politicalWill:g.politicalWill,powRequired:g.powRequired,powBank:g.powBank,surrender:g.surrender,
        role: g.role, won_text: g.won_text, closestAdvance: g.closestAdvance, atomicBest: g.atomicBest,
        finalAtomic: g.finalAtomic, strategyLog: g.strategyLog })),
    errors: games.filter(x => x.status === "error").map(g => ({ seed: g.seed, error: g.error, actions: g.actions, context: g.context })) }
const slug = scenario.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")
const outputPath = path.join(__dirname, "results", `audit50-${slug}-${gameCount}-${baseSeed}${headlessMoves ? "-headless" : ""}${outputTag ? `-${outputTag}` : ""}.json`)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n")
console.log(JSON.stringify({ complete: tally.complete, errors: tally.errors, setupErrors: tally.setupErrors,
    actionLimit: tally.actionLimit, japanWins: tally.japanWins, alliesWins: tally.alliesWins, otherWins: tally.otherWins,
    fallback: tally.fallback, unexplainedNoBattle:tally.unexplainedNoBattle, traceNodeMissing:tally.traceNodeMissing,
    headless_moves: tally.headless_moves, groundMove: tally.groundMove,
    capturedAP: tally.capturedAP, capturedJP: tally.capturedJP, atomicBombWins: tally.atomicBombWins,
    role: tally.role }, null, 1))
console.log(outputPath)
