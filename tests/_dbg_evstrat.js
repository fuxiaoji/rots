"use strict"
// C 定向侦察: 事件战略顺序化 —— 1942 完整剧本 headless, 观测
//  1) 事件战略钉住时 goals(清单行数)是否 = 早期清单 8(JP)/6(AL) 且 eventPhase=early;
//  2) 该方选牌窗动作是否带 via 清单指令(如 "事件战略:清单#2「结束日本ISR」")。
// 不修改引擎; 结果打 stdout。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const HEADLESS = process.env.EOTS_HEADLESS_MOVES !== "0"
const setupOptions = { headless_moves: HEADLESS }
const gameCount = Number(process.argv[2] || 4)
const baseSeed = Number(process.argv[3] || 20260903)
const maxActions = Number(process.argv[4] || 130000)

function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }

function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, setupOptions) } catch (e) { return { seed, status: "setup-error", error: e.message } }
    const st = { pins: [], cardPicks: [], errors: [], actions: 0, win: null, endT: null }
    try {
        while (state.active !== "None" && st.actions < maxActions) {
            const role = activeRole(state)
            const view = rules.view(state, role)
            const d = policy.decide(view, { role, seed, actionOrdinal: st.actions + 1 })
            if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
            st.actions++
            st.endT = Number(state.turn || 0)
            const t = d.publicTrace
            const sm = t && t.sm
            if (sm && sm.strategy === "事件战略") {
                const isCard = /select card to play/i.test(String(view.prompt || ""))
                if (isCard && sm.pinnedNow) st.pins.push({ role, phase: sm.phase, goals: (sm.goals || []).length, eventPhase: sm.eventPhase || null })
                if (isCard && d.action === "card") st.cardPicks.push({ role, turn: state.turn, card: d.argument, via: d.publicTrace.via || null })
            }
            state = rules.action(state, role, d.action, d.argument)
        }
    } catch (e) { return { seed, status: "error", actions: st.actions, error: e.message, ...st } }
    return { seed, status: state.active === "None" ? "complete" : "action-limit", win: state.result, endT: st.endT, ...st }
}

const out = []
for (let i = 0; i < gameCount; ++i) {
    const r = play(baseSeed + i)
    out.push(r)
    process.stderr.write(`\r${i + 1}/${gameCount} seed=${r.seed} ${r.status} endT=${r.endT} win=${r.win} pins=${r.pins.length} cards=${r.cardPicks.length}`)
}
process.stderr.write("\n")

// 汇总
let pins = 0, goalCnt = {}, dirHits = 0, dirByLine = {}
const examples = []
for (const g of out) {
    pins += g.pins.length
    for (const p of g.pins) {
        const k = `${p.role}/${p.phase}`
        goalCnt[k] = goalCnt[k] || { n: 0, sum: 0, bad: 0, eventPhase: {} }
        goalCnt[k].n++; goalCnt[k].sum += p.goals
        if (!(p.goals === 8 || p.goals === 6)) goalCnt[k].bad++
        goalCnt[k].eventPhase[p.eventPhase || "none"] = (goalCnt[k].eventPhase[p.eventPhase || "none"] || 0) + 1
    }
    for (const c of g.cardPicks) {
        if (c.via && c.via.includes("清单#")) {
            dirHits++
            const key = c.via.replace(/:清单#\d+/, "")
            const line = (c.via.match(/「(.+)」/) || [])[1] || c.via
            dirByLine[line] = (dirByLine[line] || 0) + 1
            if (examples.length < 12) examples.push({ seed: g.seed, role: c.role, turn: c.turn, card: c.card, via: c.via })
        }
    }
}
console.log("games:", out.length, "event-strategy pins:", pins)
console.log("pins by role/phase (avg goals / count / goal!=8|6):", JSON.stringify(goalCnt, null, 1))
console.log("directive-driven card picks:", dirHits, "/", out.reduce((s, g) => s + g.cardPicks.length, 0), "event-strategy card windows")
console.log("directive lines hit:", JSON.stringify(dirByLine, null, 1))
console.log("examples:")
for (const e of examples) console.log(`  seed=${e.seed} ${e.role} T${e.turn} card=${e.card} via=${e.via}`)
console.log("status:", JSON.stringify(out.map(g => ({ seed: g.seed, status: g.status, endT: g.endT, win: g.win, err: g.error || null, actions: g.actions }))))
