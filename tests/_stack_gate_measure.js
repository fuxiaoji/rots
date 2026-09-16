"use strict"

// 临时测量脚本(诊断): 跑固定 seed 的无头对局, 统计
//   - state.log.join("\n") 的 sha256 (flag 关等价性证据)
//   - #G... Check stacking 清罚窗次数
//   - 清罚窗内/全局 displace_to_turn 与 eliminated 行数(超堆叠损失规模)
//   - 动作数 / 回合 / 终局 / 夺格数
// 用法: EOTS_HEADLESS_MOVES=1 node tests/_stack_gate_measure.js
//   SEEDS=20260903,20260910 JP_BOT=erasmus-v2-opt AP_BOT=erasmus-v2-opt MAX_ACTIONS=80000
const crypto = require("crypto")
const rules = require("../rules.js")

const scenario = process.env.SCENARIO || "1942-1945 (The Shortened Campaign)"
const seeds = String(process.env.SEEDS || "20260903,20260910,20260911,20260912,20260913").split(",").map(s => Number(s.trim()))
const japanBotName = process.env.JP_BOT || "erasmus-v2-opt"
const alliesBotName = process.env.AP_BOT || "erasmus-v2-opt"
const maxActions = Number(process.env.MAX_ACTIONS || 80000)
const ELIMINATED_BOX = 1482, PERM_ELIMINATED = 1485, JP_CONTROLLED = 1 << 23

const bots = { Japan: rules.bots[japanBotName], Allies: rules.bots[alliesBotName] }
if (!bots.Japan) throw new Error(`unknown japan bot: ${japanBotName}`)
if (!bots.Allies) throw new Error(`unknown allies bot: ${alliesBotName}`)

const RE_STACK_WINDOW = /Check stacking/
// 清罚位移消息 (game.js displace_to_turn)
const RE_DISPLACED = / displaced to turn box \d+\.$/
const RE_NOTREPL = / not replaceable, could not be displaced to turn box\.$/
const RE_PERMELIM = / but permanently eliminated instead\.$/
const RE_ELIM = /\beliminated\.$/

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { return { seed, status: "setup-error", error: e.message } }
    let actions = 0, turn = Number(state.turn || 0)
    let cap = { Japan: 0, Allies: 0 }
    const adv = { Japan: 0, Allies: 0 }, dec = { Japan: 0, Allies: 0 }
    let prevSupply = state.supply_cache.slice()
    try {
        while (state.active !== "None" && actions < maxActions) {
            const role = activeRole(state)
            const view = rules.view(state, role)
            const decision = bots[role].decide(view, { role, seed, actionOrdinal: actions + 1 })
            if (!view.actions || !(decision.action in view.actions))
                throw new Error(`illegal policy action ${decision.action} @ ${view.prompt}`)
            dec[role]++
            if (decision.action === "advance") adv[role]++
            state = rules.action(state, role, decision.action, decision.argument)
            actions++
            turn = Math.max(turn, Number(state.turn || 0))
            const n = Math.min(prevSupply.length, state.supply_cache.length)
            for (let hex = 1; hex < n; ++hex) {
                const wasJP = (prevSupply[hex] & JP_CONTROLLED) !== 0, isJP = (state.supply_cache[hex] & JP_CONTROLLED) !== 0
                if (wasJP && !isJP) cap.Allies++
                else if (!wasJP && isJP) cap.Japan++
            }
            prevSupply = state.supply_cache.slice()
        }
    } catch (error) {
        return { seed, status: "error", error: `${error.message}`, actions, turn, adv, dec }
    }
    const status = state.active !== "None" ? "action-limit" : "complete"
    // 日志清罚统计: armed = 紧随 "#G.. Check stacking" 之后(下一行非清罚消息即解除戒备)
    let windows = 0, displaced = 0, notRepl = 0, permElim = 0, elim = 0
    let scopedDisplaced = 0, scopedNotRepl = 0, scopedPermElim = 0, scopedElim = 0
    let armed = false
    const log = (state.log || []).map(x => String(x))
    for (const line of log) {
        if (RE_STACK_WINDOW.test(line)) { windows++; armed = true; continue }
        const isPenalty = RE_DISPLACED.test(line) || RE_NOTREPL.test(line) || RE_PERMELIM.test(line) || RE_ELIM.test(line)
        if (RE_DISPLACED.test(line)) displaced++
        if (RE_NOTREPL.test(line)) notRepl++
        if (RE_PERMELIM.test(line)) permElim++
        if (RE_ELIM.test(line)) elim++
        if (armed) {
            if (RE_DISPLACED.test(line)) scopedDisplaced++
            else if (RE_NOTREPL.test(line)) scopedNotRepl++
            else if (RE_PERMELIM.test(line)) scopedPermElim++
            else if (RE_ELIM.test(line)) scopedElim++
            else armed = false
        }
        if (isPenalty) continue
    }
    const hash = crypto.createHash("sha256").update(log.join("\n")).digest("hex")
    const winner = state.result?.won_side || state.result || null
    return {
        seed, status, actions, turn, winner, hash, windows, displaced, notRepl, permElim, elim, adv, dec,
        scopedDisplaced, scopedNotRepl, scopedPermElim, scopedElim,
        cap, logLines: log.length,
        politicalWill: Number(state.political_will || 0),
    }
}

const out = []
const t0 = Date.now()
for (const seed of seeds) {
    const r = play(seed)
    out.push(r)
    process.stderr.write(`seed=${r.seed} ${r.status} actions=${r.actions} turn=${r.turn} winner=${r.winner} windows=${r.windows} displaced=${r.displaced} cap=${r.cap?.Allies}/${r.cap?.Japan} hash=${(r.hash || "").slice(0, 12)}\n`)
}
const sum = (f) => out.reduce((s, x) => s + (f(x) || 0), 0)
const summary = {
    profile: process.env.EOTS_OPT_PROFILE || "(default)",
    japanBot: japanBotName, alliesBot: alliesBotName, scenario, seeds,
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    statuses: out.map(x => x.status),
    actions: out.map(x => x.actions), winners: out.map(x => x.winner),
    hashes: out.map(x => x.hash),
    adv: { Japan: sum(x => x.adv?.Japan), Allies: sum(x => x.adv?.Allies) },
    dec: { Japan: sum(x => x.dec?.Japan), Allies: sum(x => x.dec?.Allies) },
    perGameAdv: out.map(x => x.adv), perGameDec: out.map(x => x.dec),
    windows: sum(x => x.windows), displaced: sum(x => x.displaced), notRepl: sum(x => x.notRepl),
    permElim: sum(x => x.permElim), elim: sum(x => x.elim),
    scoped: { displaced: sum(x => x.scopedDisplaced), notRepl: sum(x => x.scopedNotRepl), permElim: sum(x => x.scopedPermElim), elim: sum(x => x.scopedElim) },
    cap: { Allies: sum(x => x.cap?.Allies), Japan: sum(x => x.cap?.Japan) },
    perGame: out,
}
console.log(JSON.stringify(summary, null, 1))
