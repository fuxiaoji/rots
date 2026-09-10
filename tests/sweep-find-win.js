"use strict"
// 扫描 seed 区间找盟军胜局并录制完整动作序列(RTT game_replay 兼容格式)。
// 用法: EOTS_HEADLESS_MOVES=1 EOTS_OPT_PROFILE=<profile> node tests/sweep-find-win.js <from> <to> [scenario]
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2-opt"]
const ar = x => Array.isArray(x.active) ? x.active.slice().sort()[0] : x.active
const from = Number(process.argv[2] || 20260935), to = Number(process.argv[3] || 20260990)
const scenario = String(process.argv[4] || "1942-1945 (The Shortened Campaign)")
for (let seed = from; seed <= to; ++seed) {
    let state
    try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { continue }
    let a = 0
    while (state.active !== "None" && a < 80000) {
        const r = ar(state)
        const v = rules.view(state, r)
        const d = policy.decide(v, { role: r, seed, actionOrdinal: a + 1 })
        state = rules.action(state, r, d.action, d.argument)
        a++
    }
    const winner = state.result
    process.stderr.write(`seed${seed}:${winner}@T${state.turn} `)
    if (winner === "Allies") {
        // 二次重放录制动作序列(确定性保证与首跑一致)
        let s2 = rules.setup(seed, scenario, { headless_moves: true })
        let i = 0
        const acts = []
        while (s2.active !== "None" && i < 80000) {
            const r = ar(s2)
            const v = rules.view(s2, r)
            const d = policy.decide(v, { role: r, seed, actionOrdinal: i + 1 })
            acts.push({ seq: i + 1, role: r, action: d.action, arguments: d.argument === undefined ? null : d.argument })
            s2 = rules.action(s2, r, d.action, d.argument)
            i++
        }
        const out = { scenario, seed, bots: { Japan: "erasmus-v2-opt", Allies: "erasmus-v2-opt" },
            profile: process.env.EOTS_OPT_PROFILE || "(default)", headless_moves: true,
            recordedAt: new Date().toISOString(), codeNote: "录制于当前工作区代码; RTT 导入时须以同版模块执行",
            winner: s2.result, won_text: (s2.L && s2.L.message) || null, turn: s2.turn,
            politicalWill: s2.political_will, jpResources: (() => { try { return rules.query(s2, "Allies", "atomic_bomb_strategy_status").jpResources } catch (e) { return null } })(),
            actions: acts }
        const f = path.join(__dirname, "results", `replay-win-${seed}.json`)
        fs.writeFileSync(f, JSON.stringify(out, null, 1) + "\n")
        console.log(`\n*** ALLIES WIN seed ${seed} (${s2.L && s2.L.message}) T${s2.turn} → ${f} (${acts.length} actions) ***`)
    }
}
console.log("\nsweep done")
