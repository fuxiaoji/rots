"use strict"
// 盟军败因分类: 每局统计 PW 归零条约败 vs 回合末日本胜, 及 PoW/事件扣分计数。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const gameCount = Number(process.argv[2] || 10)
const baseSeed = Number(process.argv[3] || 20260903)
const maxActions = Number(process.argv[4] || 90000)
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { return { seed, err: e.message } }
    const st = { pwStart: state.political_will, powStart: state.pow, turnStart: state.turn, actions: 0 }
    const stat = { treaty: 0, powShortfall: 0, natStatus: 0, jpEv: 0, apEv: 0, bombingNotPoss: 0 }
    let lastLines = []
    try {
        while (state.active !== "None" && st.actions < maxActions) {
            const role = activeRole(state)
            const view = rules.view(state, role)
            const d = policy.decide(view, { role, seed, actionOrdinal: st.actions + 1 })
            if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
            const preLen = state.log.length
            state = rules.action(state, role, d.action, d.argument)
            for (const line of state.log.slice(preLen)) {
                lastLines.push(line); if (lastLines.length > 60) lastLines.shift()
                if (/current progress of war/.test(line)) stat.powShortfall++
                else if (/National status/.test(line)) stat.natStatus++
                else if (/Tokyo Rose|Tojo Resigns/.test(line)) stat.jpEv++
                else if (/Doolittle/.test(line)) stat.apEv++
                else if (/Strategic bombing not possible/.test(line)) stat.bombingNotPoss++
            }
            st.actions++
        }
    } catch (e) { return { seed, err: e.message, ...st, stat } }
    if (state.active !== "None") return { seed, status: "action-limit", ...st, stat }
    const treaty = lastLines.some(l => /Treaty Negotiations/.test(l))
    const noSurr = lastLines.some(l => /did not surrender/.test(l))
    const surr = lastLines.some(l => /surrenders/.test(l))
    return { seed, status: "complete", endT: state.turn, win: state.result, pwEnd: state.political_will,
        treaty, noSurr, surr, actions: st.actions, stat, pinLast: lastLines.filter(l=>/Victory|surrender/i.test(l)).slice(-2) }
}
for (let i = 0; i < gameCount; ++i) {
    const r = play(baseSeed + i)
    if (r.err) { console.log(`seed ${r.seed} ERROR ${r.err}`); continue }
    console.log(`seed ${r.seed} endT=${r.endT} win=${r.win} pwEnd=${r.pwEnd} ${r.treaty ? "PW-TREATY" : r.surr ? "JP-SURRENDER" : r.noSurr ? "LAST-TURN-JP" : "?"} | powShortfall=${r.stat.powShortfall} natStatus=${r.stat.natStatus} jpEv=${r.stat.jpEv} apEv=${r.stat.apEv} bombingNp=${r.stat.bombingNotPoss} | ${(r.pinLast||[]).join(" ; ")}`)
}
