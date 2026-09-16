"use strict"

// 两栖 ASP 闸门 A/B 取证: 同一批 seed, 统计空攻势"No battle hexes declared"次数、
// 夺格数、PW、终局。用法:
//   EOTS_HEADLESS_MOVES=1 node tests/_diag_asp_gate.js <count> <baseSeed> [scenario]

const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2-opt"]
const count = Number(process.argv[2] || 8)
const baseSeed = Number(process.argv[3] || 20260910)
const scenario = String(process.argv[4] || "1942-1945 (The Shortened Campaign)")
const ar = x => Array.isArray(x.active) ? x.active.slice().sort()[0] : x.active

function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { return { seed, status: "setup-error", error: e.message } }
    let actions = 0, empty = 0, amphibLanding = 0, aspBlocked = 0
    const seen = new Set()
    try {
        while (state.active !== "None" && actions < 80000) {
            const role = ar(state)
            const view = rules.view(state, role)
            const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
            const plan = d.publicTrace && d.publicTrace.activationPlan
            if (plan && plan.formation === "amphib-asp-insufficient") ++aspBlocked
            state = rules.action(state, role, d.action, d.argument)
            ++actions
            // 只统计新增日志行(日志会累积)
            for (let i = state.log.length - 1; i >= 0; --i) {
                const line = String(state.log[i])
                if (seen.has(i)) break
                seen.add(i)
                if (/No battle hexes declared/.test(line)) ++empty
                if (/Could not participate|Amphibious Assault failed|amphibious/i.test(line)) ++amphibLanding
            }
        }
    } catch (e) { return { seed, status: "error", error: e.message, actions } }
    const winner = state.result?.won_side || state.result
    const res = { seed, status: state.active === "None" ? "complete" : "action-limit", winner, actions,
        turn: Number(state.turn || 0), emptyOffensives: empty, aspBlockedDecisions: aspBlocked,
        politicalWill: Number(state.political_will || 0) }
    try { res.jpResources = rules.query(state, "Allies", "atomic_bomb_strategy_status")?.jpResources ?? null } catch (e) {}
    return res
}

const rows = []
for (let i = 0; i < count; ++i) {
    const r = play(baseSeed + i)
    rows.push(r)
    process.stderr.write(`\r${i + 1}/${count} seed=${r.seed} ${r.status} winner=${r.winner ?? "-"} empty=${r.emptyOffensives ?? "-"} aspBlocked=${r.aspBlockedDecisions ?? "-"}      `)
}
process.stderr.write("\n")
const ok = rows.filter(r => r.status === "complete")
const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
console.log(JSON.stringify({
    profile: process.env.EOTS_OPT_PROFILE || "(default)", scenario, count, baseSeed,
    complete: ok.length, japanWins: ok.filter(r => r.winner === "Japan").length,
    alliesWins: ok.filter(r => r.winner === "Allies").length,
    totalEmptyOffensives: sum("emptyOffensives"),
    avgEmptyOffensives: Number((sum("emptyOffensives") / (rows.length || 1)).toFixed(2)),
    totalAspBlockedDecisions: sum("aspBlockedDecisions"),
    rows,
}, null, 1))
