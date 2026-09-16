"use strict"
// 快速指标 (可指定 rules.js 路径, 便于 A/B): 双方 会战申报/胜/夺格
// 用法: node tests/_metrics.js <rulesPath> <count> <baseSeed> [japanBot] [alliesBot]
const rulesPath = String(process.argv[2] || "../rules.js")
const rules = require(rulesPath)
const gameCount = Number(process.argv[3] || 3)
const baseSeed = Number(process.argv[4] || 20260910)
const jb = String(process.argv[5] || "erasmus-v2-opt"), ab = String(process.argv[6] || "erasmus-v2-opt")
const bots = { Japan: rules.bots[jb], Allies: rules.bots[ab] }
const JP_CONTROLLED = 1 << 23
const R = { Japan: { att: 0, gW: 0, nW: 0, cap: 0, attU: [], fireDiff: [] }, Allies: { att: 0, gW: 0, nW: 0, cap: 0, attU: [], fireDiff: [] } }
let errors = 0, actionLimit = 0, noBattle = 0, turns = [], wins = {}
const t0 = Date.now()
for (let gi = 0; gi < gameCount; ++gi) {
    const seed = baseSeed + gi
    let state
    try { state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", { headless_moves: true }) } catch (e) { errors++; continue }
    let actions = 0
    let prevCtrl = state.supply_cache.slice()
    try {
        while (state.active !== "None" && actions < 60000) {
            const r = Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
            const view = rules.view(state, r)
            const d = bots[r].decide(view, { role: r, seed, actionOrdinal: actions + 1 })
            if (!view.actions || !(d.action in view.actions)) throw new Error("illegal " + d.action + " @ " + view.prompt)
            state = rules.action(state, r, d.action, d.argument)
            actions++
            const n = Math.min(prevCtrl.length, state.supply_cache.length)
            for (let h = 1; h < n; ++h) {
                const w = (prevCtrl[h] & JP_CONTROLLED) !== 0, v = (state.supply_cache[h] & JP_CONTROLLED) !== 0
                if (w && !v) R.Allies.cap++
                else if (!w && v) R.Japan.cap++
            }
            prevCtrl = state.supply_cache.slice()
        }
    } catch (e) { errors++; console.error("ERR " + seed + " " + e.message); continue }
    if (state.active !== "None") actionLimit++
    turns.push(Number(state.turn || 0))
    let cur = null, curAtt = 0, curDef = 0
    let logIndex = 0, prevAttU = null
    for (let i = 0; i < state.log.length; ++i) {
        const line = String(state.log[i]); let m
        if ((m = line.match(/^%(J|A)Battle hex/))) { cur = m[1] === "J" ? "Japan" : "Allies"; R[cur].att++; continue }
        if (/Attacker won in ground combat/.test(line)) { if (cur) R[cur].gW++; continue }
        if (/ won battle \(/.test(line)) {
            const aw = /^&?[AJ]?Attacker/.test(line)
            const w = aw ? cur : (cur === "Japan" ? "Allies" : "Japan")
            if (w) R[w].nW++
            continue
        }
        if ((m = line.match(/^&[AJ]Attacker: \^(\d+) units\|/))) { if (cur) R[cur].attU.push(Number(m[1])); continue }
        if (/No battle hexes declared/.test(line)) noBattle++
    }
    // 控制位差分统计夺格 (需要快照; 简化: 用日志 "AP captured"/"JP captured" 行不可靠 → 逐回合差分略)
}
const stat = a => { if (!a.length) return { n: 0 }; const s = a.slice().sort((x, y) => x - y); return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2, max: s[s.length - 1] } }
console.log(JSON.stringify({ rulesPath, gameCount, baseSeed, errors, actionLimit, noBattle, meanTurn: turns.length ? +(turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(2) : 0,
    secs: Math.round((Date.now() - t0) / 1000),
    role: { Japan: { attacksInitiated: R.Japan.att, groundWon: R.Japan.gW, navalWon: R.Japan.nW, capturedHexes: R.Japan.cap, winRate: R.Japan.att ? +((R.Japan.gW + R.Japan.nW) / R.Japan.att).toFixed(3) : null, attUnits: stat(R.Japan.attU) },
            Allies: { attacksInitiated: R.Allies.att, groundWon: R.Allies.gW, navalWon: R.Allies.nW, capturedHexes: R.Allies.cap, winRate: R.Allies.att ? +((R.Allies.gW + R.Allies.nW) / R.Allies.att).toFixed(3) : null, attUnits: stat(R.Allies.attU) } } }, null, 1))
