"use strict"

// zh.7 回合级状态机审计: 完整全图剧本(headless) N 局回放, 记录
//   - SM 每方每回合首卡钉选(阶段轴)与整局分布、EVENT/驻军等分支命中
//   - 盟军触达马尼拉/莱特/冲绳/硫磺岛/日本本土(按 capture 日志 token 计数)
//   - 0 error / action-limit / fallback
// 供 havedone/plan 记录 1942 全剧本 zh.7 指标。gate 关的 SP/OFF 由 erasmus.test.js +
// erasmus-selfplay.js 回归(行为不变)。
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]

const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const gameCount = Number(process.argv[3] || 50)
const baseSeed = Number(process.argv[4] || 20260903)
const maxActions = Number(process.argv[5] || 60000)
const headlessMoves = process.env.EOTS_HEADLESS_MOVES === "1"

// 盟军战略触达目标(以 capture 日志 格(ROMAJI) token 匹配)。
const AL_TOUCH = ["Manila", "Leyte", "Davao", "Iwo", "Okinawa", "Saipan",
    "Sasebo", "Kynshu", "Tokyo", "Nagoya", "Osaka", "Kyoto", "Kure", "Ominato", "Hakodate"]

function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }

function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, { headless_moves: headlessMoves }) }
    catch (error) { return { seed, status: "setup-error", winner: null, error: error.message } }
    const g = { seed, status: "error", winner: null, actions: 0, turn: Number(state.turn || 0), fallback: 0, context: null }
    g.sm = { pins: 0, firstPins: 0, byKind: {}, byPhase: { Japan: {}, Allies: {} }, roll: { Japan: {}, Allies: {} } }
    const touch = {}
    try {
        while (state.active !== "None" && g.actions < maxActions) {
            const role = activeRole(state)
            if (role !== "Japan" && role !== "Allies") throw new Error(`unexpected active role: ${JSON.stringify(state.active)}`)
            const view = rules.view(state, role)
            g.context = { role, turn: view.turn, prompt: view.prompt }
            const decision = policy.decide(view, { role, seed, actionOrdinal: g.actions + 1 })
            if (!view.actions || !(decision.action in view.actions)) throw new Error(`illegal action ${decision.action} @ ${view.prompt}`)
            const tr = decision.publicTrace || {}
            const sm = tr.sm
            if (sm) {
                g.sm.pins++
                g.sm.byKind[sm.kind] = (g.sm.byKind[sm.kind] || 0) + 1
                const bp = g.sm.byPhase[role]
                bp[sm.phase] = (bp[sm.phase] || 0) + 1
                const rr = g.sm.roll[role]
                rr[sm.strategy] = (rr[sm.strategy] || 0) + 1
                // 钉选事件(每方每回合首卡)由 erasmus_sm_decision 注入 pinnedNow=true;
                // 同回合沿用窗 pinnedNow=false, 故累加即真实钉选次数。
                if (sm.pinnedNow) g.sm.firstPins++
            }
            if (decision.publicTrace.fallback) g.fallback++
            state = rules.action(state, role, decision.action, decision.argument)
            g.actions++
            g.turn = Math.max(g.turn, Number(state.turn || 0))
        }
    } catch (error) {
        return { seed, status: "error", winner: null, actions: g.actions, turn: g.turn, fallback: g.fallback, sm: g.sm, error: error.message, context: g.context }
    }
    if (state.active !== "None")
        return { seed, status: "action-limit", winner: null, actions: g.actions, turn: g.turn, fallback: g.fallback, sm: g.sm }
    for (const line of (state.log || [])) {
        const m = line.match(/^(AP|JP) captured\s+\S+\(([^)]+)\)格\((\d{4})\)\./)
        if (m && m[1] === "AP") {
            const name = m[2]
            for (const t of AL_TOUCH) if (name.toLowerCase().includes(t.toLowerCase())) touch[t] = (touch[t] || 0) + 1
        }
    }
    const winner = state.result?.won_side || state.result || null
    return { seed, status: "complete", winner, actions: g.actions, turn: g.turn, fallback: g.fallback, sm: g.sm,
        touch, won_text: state.result?.won_text || null }
}

const games = []
for (let i = 0; i < gameCount; ++i) {
    const r = play(baseSeed + i)
    games.push(r)
    process.stderr.write(`\r${i + 1}/${gameCount} ${r.status} seed=${r.seed} actions=${r.actions ?? "-"} turn=${r.turn ?? "-"} winner=${r.winner ?? "-"}`)
}
process.stderr.write("\n")

const ok = games.filter(x => x.status === "complete")
const sum = {
    policy: policy.version, scenario, gameCount, baseSeed, headless_moves: headlessMoves,
    complete: ok.length,
    japanWins: ok.filter(x => x.winner === "Japan").length,
    alliesWins: ok.filter(x => x.winner === "Allies").length,
    errors: games.filter(x => x.status === "error").length,
    setupErrors: games.filter(x => x.status === "setup-error").length,
    actionLimit: games.filter(x => x.status === "action-limit").length,
    fallback: 0,
    firstPins: 0, pins: 0, byKind: {}, byPhase: { Japan: {}, Allies: {} },
    roll: { Japan: {}, Allies: {} }, touch: {},
}
ok.forEach(g => {
    sum.fallback += g.fallback; sum.pins += g.sm.pins; sum.firstPins += g.sm.firstPins
    for (const k of Object.keys(g.sm.byKind)) sum.byKind[k] = (sum.byKind[k] || 0) + g.sm.byKind[k]
    for (const s of ["Japan", "Allies"]) for (const k of Object.keys(g.sm.byPhase[s])) sum.byPhase[s][k] = (sum.byPhase[s][k] || 0) + g.sm.byPhase[s][k]
    for (const s of ["Japan", "Allies"]) for (const k of Object.keys(g.sm.roll[s])) sum.roll[s][k] = (sum.roll[s][k] || 0) + g.sm.roll[s][k]
    for (const k of Object.keys(g.touch || {})) sum.touch[k] = (sum.touch[k] || 0) + g.touch[k]
})
const slug = scenario.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")
const outPath = path.join(__dirname, "results", `sm-${slug}-${gameCount}-${baseSeed}${headlessMoves ? "-headless" : ""}.json`)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sum,
    perGame: ok.map(g => ({ seed: g.seed, winner: g.winner, actions: g.actions, turn: g.turn, fallback: g.fallback,
        firstPins: g.sm.firstPins, roll: g.sm.roll, touch: g.touch, won_text: g.won_text })),
    errors: games.filter(x => x.status === "error").map(x => ({ seed: x.seed, error: x.error, actions: x.actions, context: x.context })) }, null, 2) + "\n")
console.log(JSON.stringify({ complete: sum.complete, japanWins: sum.japanWins, alliesWins: sum.alliesWins,
    errors: sum.errors, setupErrors: sum.setupErrors, actionLimit: sum.actionLimit, fallback: sum.fallback,
    pins: sum.pins, firstPins: sum.firstPins, byKind: sum.byKind, byPhase: sum.byPhase,
    alTouch: Object.keys(sum.touch).length ? sum.touch : null }, null, 1))
console.log(outPath)
