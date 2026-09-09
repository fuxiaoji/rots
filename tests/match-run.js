"use strict"

// 增强对局运行器 (match runner): AI vs AI 无头对局, 双方可配置不同 bot,
// 指标 = 夺格数 / 成功作战数(进攻胜/防守守住/海空战胜负) / 损失数(歼灭+减编, 按 cf 加权)
// / PW / 投降链 / 终局资源格 / 原子弹条件, 供"优化 AI vs 基线 AI"对比实验与论文统计。
//
// 用法:
//   EOTS_HEADLESS_MOVES=1 node tests/match-run.js "<scenario>" <count> <baseSeed> [japanBot] [alliesBot] [maxActions] [tag]
// 示例:
//   EOTS_HEADLESS_MOVES=1 node tests/match-run.js "1942-1945 (The Shortened Campaign)" 30 20260903 erasmus-v2 erasmus-v2
//
// 指标口径:
//   attacksInitiated  = 会战申报解析的战斗格数量(%J/%A 标记行, 每格一次交战)
//   groundAttacksWon  = "Attacker won in ground combat" 归属进攻方
//   groundDefensesHeld= "Defender won in ground combat" 归属防守方
//   navalBattlesWon   = "Attacker/Defender won battle (x - y)" 海空战获胜归属
//   eliminations      = 快照差分: 单位 location 变为 ELIMINATED/PERM_ELIMINATED, cfEliminated 累加单位 cf
//   reductions        = 快照差分: reduced 从 falsy 变 truthy 事件, cfReduced 累加 floor(cf/2)
//   capturedHexes     = 日志 "AP captured "/"JP captured " 行(命名格)
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")

const scenario = String(process.argv[2] || "1942-1945 (The Shortened Campaign)")
const gameCount = Number(process.argv[3] || 20)
const baseSeed = Number(process.argv[4] || 20260903)
const japanBotName = String(process.argv[5] || "erasmus-v2")
const alliesBotName = String(process.argv[6] || "erasmus-v2")
// argv[7] 为数字时是 maxActions, 否则是 tag(允许省略 maxActions 直接给 tag)。
const arg7 = String(process.argv[7] || "")
const maxActions = /^\d+$/.test(arg7) ? Number(arg7) : 60000
const outputTag = String((/^\d+$/.test(arg7) ? process.argv[8] : arg7) || "").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "")

const headlessMoves = process.env.EOTS_HEADLESS_MOVES === "1"
const setupOptions = { headless_moves: headlessMoves }
const ELIMINATED_BOX = 1482
const PERM_ELIMINATED = 1485
// 控制位与 js/common/constants.js:108-109 一致(该文件依赖 hex_to_int 无法独立 require)。
const JP_CONTROLLED = 1 << 23

const bots = {
    Japan: rules.bots[japanBotName],
    Allies: rules.bots[alliesBotName],
}
if (!bots.Japan) throw new Error(`unknown japan bot: ${japanBotName}`)
if (!bots.Allies) throw new Error(`unknown allies bot: ${alliesBotName}`)

const METRIC_KEYS = ["decisions", "fire", "advance", "hqActivations", "airStrikeUnits", "airStrikeHexes",
    "attacksInitiated", "groundAttacksWon", "groundDefensesHeld", "navalBattlesWon", "navalBattlesLost",
    "amphibAssaults", "amphibFailures", "eliminations", "reductions", "cfEliminated", "cfReduced",
    "capturedHexes", "lostHexes"]

function emptyRole() {
    const r = {}
    for (const k of METRIC_KEYS) r[k] = 0
    return r
}

function sideOfFaction(f) { return f === 0 ? "Japan" : "Allies" }
function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

function snapshot(state) {
    return {
        location: state.location.slice(),
        reduced: state.reduced.slice(), // 值集合: 被减编的 piece id 列表(set_add/set_delete 语义)
        supply: state.supply_cache.slice(),
    }
}

// 差分封装: 以 prev 为基线统计本步损失(歼灭/减编)与夺格(控制位翻转)并归入 role, 返回新快照。
function accumulateDeltas(prev, curr, g) {
    for (let i = 1; i < curr.location.length; ++i) {
        const piece = rules.pieces?.[i]
        if (!piece) continue
        const side = sideOfFaction(piece.faction)
        const wasElim = prev.location[i] === ELIMINATED_BOX || prev.location[i] === PERM_ELIMINATED
        const isElim = curr.location[i] === ELIMINATED_BOX || curr.location[i] === PERM_ELIMINATED
        if (!wasElim && isElim) {
            g.role[side].eliminations++
            g.role[side].cfEliminated += Number(piece.cf || 0)
        } else if (!isElim && !prev.reduced.includes(i) && curr.reduced.includes(i)) {
            g.role[side].reductions++
            g.role[side].cfReduced += Math.floor(Number(piece.cf || 0) / 2)
        }
    }
    const n = Math.min(prev.supply.length, curr.supply_cache.length)
    for (let hex = 1; hex < n; ++hex) {
        const wasJP = (prev.supply[hex] & JP_CONTROLLED) !== 0
        const isJP = (curr.supply_cache[hex] & JP_CONTROLLED) !== 0
        if (wasJP && !isJP) {
            g.role.Allies.capturedHexes++
            g.capByTurn.Allies[g.turn] = (g.capByTurn.Allies[g.turn] || 0) + 1
        } else if (!wasJP && isJP) {
            g.role.Japan.capturedHexes++
            g.capByTurn.Japan[g.turn] = (g.capByTurn.Japan[g.turn] || 0) + 1
        }
    }
    return snapshot(curr)
}

function play(seed) {
    let state
    try {
        state = rules.setup(seed, scenario, setupOptions)
    } catch (error) {
        return { seed, status: "setup-error", error: error.message }
    }
    const g = { seed, status: "error", actions: 0, turn: Number(state.turn || 0), fallback: 0,
        noBattleHex: 0, traceNodeMissing: 0, role: { Japan: emptyRole(), Allies: emptyRole() },
        logIndex: 0, curAttacker: null, pwMin: Number(state.political_will || 0), pwLog: [],
        capByTurn: { Japan: {}, Allies: {} } }
    let prev = snapshot(state)

    const scanNewLogLines = () => {
        for (; g.logIndex < state.log.length; ++g.logIndex) {
            const line = String(state.log[g.logIndex])
            let m
            if ((m = line.match(/^%(J|A)Battle hex/))) {
                g.curAttacker = m[1] === "J" ? "Japan" : "Allies"
                g.role[g.curAttacker].attacksInitiated++
            } else if (/Attacker won in ground combat/.test(line)) {
                if (g.curAttacker) g.role[g.curAttacker].groundAttacksWon++
            } else if (/Defender won in ground combat/.test(line)) {
                if (g.curAttacker) g.role[g.curAttacker === "Japan" ? "Allies" : "Japan"].groundDefensesHeld++
            } else if (/ won battle \(/.test(line)) {
                const attackerWon = /^Attacker/.test(line)
                const w = attackerWon ? g.curAttacker : (g.curAttacker === "Japan" ? "Allies" : "Japan")
                const l = attackerWon ? (g.curAttacker === "Japan" ? "Allies" : "Japan") : g.curAttacker
                if (w && l) { g.role[w].navalBattlesWon++; g.role[l].navalBattlesLost++ }
            } else if (/Amphibious Assault failed/.test(line) || /could not participate ground combat/.test(line)) {
                if (g.curAttacker) g.role[g.curAttacker].amphibFailures++
            } else if (line.trim() === "+3 Amphibious assault.") {
                if (g.curAttacker) g.role[g.curAttacker].amphibAssaults++
            } else if (/ fire \(/.test(line)) {
                const side = /^&A/i.test(line) ? "Allies" : /^&J/i.test(line) ? "Japan" : null
                if (side) g.role[side].fire++
            } else if (/No battle hexes declared/.test(line)) {
                g.noBattleHex++
            } else if ((m = line.match(/#GTotal VP: (\d+)/))) {
                g.vp = Number(m[1])
            } else if ((m = line.match(/Political will changed to (\d+) \((-?\d+)\)/))) {
                g.pwLog.push({ turn: g.turn, pw: Number(m[1]), delta: Number(m[2]) })
            }
        }
    }

    try {
        while (state.active !== "None" && g.actions < maxActions) {
            const role = activeRole(state)
            if (role !== "Japan" && role !== "Allies") throw new Error(`unexpected active role: ${JSON.stringify(state.active)}`)
            const view = rules.view(state, role)
            const decision = bots[role].decide(view, { role, seed, actionOrdinal: g.actions + 1 })
            if (!view.actions || !(decision.action in view.actions))
                throw new Error(`illegal policy action ${decision.action} @ ${view.prompt}`)
            if (decision.publicTrace?.fallback) g.fallback++
            const chart = String((decision.publicTrace || {}).chart || "")
            if (/JP-0[1-6]|AP-1[0-2]/.test(chart) === false && decision.publicTrace?.node) g.traceNodeMissing++
            const r = g.role[role]
            r.decisions++
            if (decision.action === "advance") r.advance++
            if (decision.action === "unit" && /activate units/i.test(String(view.prompt || ""))) {
                const picked = (view.ai?.units || []).find(u => u.id === decision.argument)
                if (picked?.class === "hq") r.hqActivations++
            }
            if (/Declare battle hexes/.test(String(view.prompt || ""))) {
                if (decision.action === "unit") r.airStrikeUnits++
                else if (decision.action === "action_hex") r.airStrikeHexes++
            }
            state = rules.action(state, role, decision.action, decision.argument)
            g.actions++
            g.turn = Math.max(g.turn, Number(state.turn || 0))
            g.pwMin = Math.min(g.pwMin, Number(state.political_will || 0))
            scanNewLogLines()
            prev = accumulateDeltas(prev, state, g)
        }
    } catch (error) {
        return { seed, status: "error", error: `${error.message}\n${error.stack}`, actions: g.actions, turn: g.turn }
    }
    if (state.active !== "None")
        return { seed, status: "action-limit", actions: g.actions, turn: g.turn }

    // 对手损失 = 差分计数按受损方归属; capturedHexes 已按 AP/JP 前缀计数。
    const jpResources = (() => { try { return rules.query(state, "Allies", "atomic_bomb_strategy_status")?.jpResources ?? null } catch (e) { return null } })()
    const finalAtomic = (() => { try { const a = rules.query(state, "Allies", "atomic_bomb_strategy_status"); return a ? { met: !!a.met, jpResources: a.jpResources, sovietReady: !!a.sovietReady, campaign: a.campaign } : null } catch (e) { return null } })()
    const powBank = Array.isArray(state.capture) ? state.capture.length : 0
    // 每回合夺格率(含零回合)与封锁进度(JAPAN_TRACE_RESOURCES id=28, 值=首次断链回合)
    const capRate = {}
    for (const side of ["Japan", "Allies"]) {
        const byTurn = g.capByTurn[side]
        const vals = []
        for (let t = 1; t <= g.turn; ++t) vals.push(byTurn[t] || 0)
        const mean = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0
        capRate[side] = { mean: Number(mean.toFixed(2)), max: Math.max(0, ...vals), turnsWithCapture: vals.filter(x => x > 0).length }
    }
    const blockadeEvent = Array.isArray(state.events) ? Number(state.events[28] || 0) : 0
    const blockade = blockadeEvent > 0 ? { startedTurn: blockadeEvent, progress: Math.max(0, Number(g.turn) - blockadeEvent + 1) } : null
    const surrender = Array.isArray(state.surrender) ? {
        philippines: !!state.surrender[0], malaya: !!state.surrender[1], dei: !!state.surrender[2],
        burma: !!state.surrender[3], japan: !!state.surrender[12],
    } : null
    // 反攻格数(盟军)= 全局 AP 夺格; 日本夺格 = JP 夺格(已入 capturedHexes)。
    const winner = state.result?.won_side || state.result || null
    return { seed, status: "complete", winner, won_text: state.result ? (state.L?.message || null) : null,
        vp: g.vp ?? null, actions: g.actions, turn: g.turn, fallback: g.fallback, noBattleHex: g.noBattleHex,
        traceNodeMissing: g.traceNodeMissing,
        politicalWill: Number(state.political_will || 0), pwMin: g.pwMin, pwLog: g.pwLog,
        powRequired: Number(state.pow || 0), powBank, surrender, jpResources, finalAtomic,
        capRate, blockade,
        role: g.role }
}

// 差分封装(旧版, 已由 accumulateDeltas 取代): 保留占位避免悬挂引用。
function accumulateLosses() { return null }

const games = []
const t0 = Date.now()
for (let index = 0; index < gameCount; ++index) {
    const seed = baseSeed + index
    const result = play(seed)
    games.push(result)
    process.stderr.write(`\r${index + 1}/${gameCount} ${result.status} seed=${seed} actions=${result.actions ?? "-"} turn=${result.turn ?? "-"} winner=${result.winner ?? "-"} `)
}
const elapsed = Date.now() - t0
process.stderr.write(`\nelapsed ${((elapsed / 1000) / Math.max(1, gameCount)).toFixed(2)}s/game\n`)

const completed = games.filter(x => x.status === "complete")
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0)
const mean = (arr, f) => arr.length ? sum(arr, f) / arr.length : 0
const tally = {
    scenario, gameCount, baseSeed, maxActions, headless_moves: headlessMoves,
    japanBot: japanBotName, alliesBot: alliesBotName,
    japanBotVersion: bots.Japan.version, alliesBotVersion: bots.Allies.version,
    elapsedSec: Math.round(elapsed / 1000),
    complete: completed.length,
    japanWins: completed.filter(x => x.winner === "Japan").length,
    alliesWins: completed.filter(x => x.winner === "Allies").length,
    errors: games.filter(x => x.status === "error").length,
    setupErrors: games.filter(x => x.status === "setup-error").length,
    actionLimit: games.filter(x => x.status === "action-limit").length,
    atomicBombWins: completed.filter(x => /atomic bomb/i.test(String(x.won_text || ""))).length,
    blockadeWins: completed.filter(x => /blockade/i.test(String(x.won_text || ""))).length,
    homelandWins: completed.filter(x => /mainland islands captured/i.test(String(x.won_text || ""))).length,
    blockadeStarted: completed.filter(x => x.blockade).length,
    meanCapRate: {
        Japan: Number(mean(completed, x => x.capRate?.Japan?.mean).toFixed(2)),
        Allies: Number(mean(completed, x => x.capRate?.Allies?.mean).toFixed(2)),
        JapanMax: Math.max(0, ...completed.map(x => x.capRate?.Japan?.max || 0)),
        AlliesMax: Math.max(0, ...completed.map(x => x.capRate?.Allies?.max || 0)),
    },
    treatyWins: completed.filter(x => /Treaty/i.test(String(x.won_text || ""))).length,
    meanTurn: Number(mean(completed, x => x.turn).toFixed(2)),
    meanPW: Number(mean(completed, x => x.politicalWill).toFixed(2)),
    meanJpResources: Number(mean(completed, x => x.jpResources).toFixed(2)),
    surrenderCounts: {
        philippines: completed.filter(x => x.surrender?.philippines).length,
        malaya: completed.filter(x => x.surrender?.malaya).length,
        dei: completed.filter(x => x.surrender?.dei).length,
        burma: completed.filter(x => x.surrender?.burma).length,
        japan: completed.filter(x => x.surrender?.japan).length,
    },
    role: {},
}
for (const side of ["Japan", "Allies"]) {
    tally.role[side] = {}
    for (const k of METRIC_KEYS) tally.role[side][k] = sum(completed.map(x => x.role?.[side] || {}), r => r[k])
    for (const k of METRIC_KEYS) tally.role[side][`mean_${k}`] = Number(mean(completed, x => x.role?.[side]?.[k]).toFixed(2))
}
// 对方视角损失(给对方造成损失数 = 对方 eliminations+reductions 与 cf)
tally.inflicted = {
    Japan: { eliminations: tally.role.Allies.eliminations, reductions: tally.role.Allies.reductions,
        cfEliminated: tally.role.Allies.cfEliminated, cfReduced: tally.role.Allies.cfReduced },
    Allies: { eliminations: tally.role.Japan.eliminations, reductions: tally.role.Japan.reductions,
        cfEliminated: tally.role.Japan.cfEliminated, cfReduced: tally.role.Japan.cfReduced },
}

const perGame = completed.map(x => ({ seed: x.seed, winner: x.winner, won_text: x.won_text, vp: x.vp,
    actions: x.actions, turn: x.turn, politicalWill: x.politicalWill, pwMin: x.pwMin,
    powRequired: x.powRequired, powBank: x.powBank, surrender: x.surrender, jpResources: x.jpResources,
    finalAtomic: x.finalAtomic, capRate: x.capRate, blockade: x.blockade, role: x.role }))
const output = { generatedAt: new Date().toISOString(), tally, perGame,
    errors: games.filter(x => x.status === "error").map(x => ({ seed: x.seed, error: x.error, actions: x.actions })) }
const slug = scenario.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")
const outputPath = path.join(__dirname, "results", `match-${slug}-${gameCount}-${baseSeed}-J${japanBotName}-A${alliesBotName}${headlessMoves ? "-headless" : ""}${outputTag ? `-${outputTag}` : ""}.json`)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(output, null, 1) + "\n")
console.log(JSON.stringify({ complete: tally.complete, japanWins: tally.japanWins, alliesWins: tally.alliesWins,
    atomicBombWins: tally.atomicBombWins, treatyWins: tally.treatyWins, errors: tally.errors, actionLimit: tally.actionLimit,
    meanTurn: tally.meanTurn, meanPW: tally.meanPW, meanJpResources: tally.meanJpResources,
    captured: { AP: tally.role.Allies.capturedHexes, JP: tally.role.Japan.capturedHexes },
    battlesWon: { Japan: tally.role.Japan.groundAttacksWon + tally.role.Japan.navalBattlesWon + tally.role.Japan.groundDefensesHeld,
        Allies: tally.role.Allies.groundAttacksWon + tally.role.Allies.navalBattlesWon + tally.role.Allies.groundDefensesHeld },
    lossesInflicted: tally.inflicted, elapsedSec: tally.elapsedSec }, null, 1))
console.log(outputPath)
