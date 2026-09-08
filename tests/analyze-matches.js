"use strict"

// 对局结果统计分析: 两组 match-run JSON 的指标对比。
// 方法: 均值差 + bootstrap 95% CI + Mann-Whitney U(双侧, 正态近似) + Cliff's delta 效应量。
// 用法: node tests/analyze-matches.js <control.json> <treatment.json> [metrics=csv]
//
// 指标(角色维度自动展开): capturedHexes, groundAttacksWon, groundDefensesHeld,
// navalBattlesWon, attacksInitiated, eliminations, reductions, cfEliminated, cfReduced,
// amphibFailures, 以及全局: winnerAllies(1/0), politicalWill, jpResources, turn, vp。

const fs = require("fs")
const path = require("path")

const controlPath = process.argv[2]
const treatmentPath = process.argv[3]
const metricArg = String(process.argv[4] || "")

function load(p) {
    const o = JSON.parse(fs.readFileSync(p, "utf8"))
    return { tally: o.tally, games: o.perGame.filter(g => g.status !== "error") }
}

// 每局指标抽取
function metricsOf(g) {
    const m = {
        winnerAllies: g.winner === "Allies" ? 1 : 0,
        winnerJapan: g.winner === "Japan" ? 1 : 0,
        politicalWill: g.politicalWill,
        jpResources: g.jpResources,
        turn: g.turn,
        vp: g.vp ?? null,
    }
    for (const side of ["Japan", "Allies"]) {
        const r = (g.role || {})[side] || {}
        for (const k of ["capturedHexes", "groundAttacksWon", "groundDefensesHeld", "navalBattlesWon",
            "attacksInitiated", "eliminations", "reductions", "cfEliminated", "cfReduced",
            "amphibFailures", "fire", "advance"]) {
            m[`${side}.${k}`] = r[k] || 0
        }
    }
    return m
}

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN }
function quantile(sorted, q) {
    if (!sorted.length) return NaN
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function bootstrapCi(a, b, iterations = 10000, seed = 12345) {
    let rng = seed >>> 0
    const next = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff }
    const diffs = []
    for (let i = 0; i < iterations; i++) {
        const ra = Array.from({ length: a.length }, () => a[Math.floor(next() * a.length)])
        const rb = Array.from({ length: b.length }, () => b[Math.floor(next() * b.length)])
        diffs.push(mean(rb) - mean(ra))
    }
    diffs.sort((x, y) => x - y)
    return [quantile(diffs, 0.025), quantile(diffs, 0.975)]
}

// Mann-Whitney U (正态近似, 含并列校正)
function mannWhitney(a, b) {
    const all = [...a.map(x => ({ v: x, g: 0 })), ...b.map(x => ({ v: x, g: 1 }))]
    all.sort((x, y) => x.v - y.v)
    const ranks = new Array(all.length)
    let i = 0
    while (i < all.length) {
        let j = i
        while (j + 1 < all.length && all[j + 1].v === all[i].v) j++
        const avgRank = (i + j) / 2 + 1
        for (let k = i; k <= j; k++) ranks[k] = avgRank
        i = j + 1
    }
    const rA = all.reduce((s, x, k) => s + (x.g === 0 ? ranks[k] : 0), 0)
    const n1 = a.length, n2 = b.length
    const u1 = rA - n1 * (n1 + 1) / 2
    const u2 = n1 * n2 - u1
    const u = Math.min(u1, u2)
    const muU = n1 * n2 / 2
    // 并列校正
    let t = 0
    i = 0
    while (i < all.length) {
        let j = i
        while (j + 1 < all.length && all[j + 1].v === all[i].v) j++
        const size = j - i + 1
        if (size > 1) t += size ** 3 - size
        i = j + 1
    }
    const n = n1 + n2
    const sdU = Math.sqrt(n1 * n2 / 12 * ((n + 1) - t / (n * (n - 1))))
    if (sdU === 0) return { u, p: 1 }
    const z = (u - muU) / sdU
    const p = 2 * 0.5 * erfc(Math.abs(z) / Math.SQRT2)
    return { u, z, p }
}

function erfc(x) {
    // Abramowitz-Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * x)
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592 * t
    return y * Math.exp(-x * x)
}

// Cliff's delta 效应量
function cliffsDelta(a, b) {
    let gt = 0, lt = 0
    for (const x of a) for (const y of b) { if (x > y) gt++; else if (x < y) lt++ }
    return (gt - lt) / (a.length * b.length)
}

const control = load(controlPath)
const treatment = load(treatmentPath)
const gamesC = control.games.map(metricsOf)
const gamesT = treatment.games.map(metricsOf)

const DEFAULT_METRICS = ["Allies.capturedHexes", "Japan.capturedHexes", "Allies.groundAttacksWon",
    "Japan.groundAttacksWon", "Allies.navalBattlesWon", "Japan.navalBattlesWon",
    "Allies.eliminations", "Japan.eliminations", "Allies.cfEliminated", "Japan.cfEliminated",
    "Allies.reductions", "Japan.reductions", "winnerAllies", "winnerJapan",
    "politicalWill", "jpResources", "turn"]
const metrics = metricArg ? metricArg.split(",") : DEFAULT_METRICS

const rows = []
for (const k of metrics) {
    const a = gamesC.map(g => g[k]).filter(x => x !== null && x !== undefined)
    const b = gamesT.map(g => g[k]).filter(x => x !== null && x !== undefined)
    if (!a.length || !b.length) continue
    const ci = bootstrapCi(a, b)
    const mw = mannWhitney(a, b)
    const d = cliffsDelta(a, b)
    rows.push({ metric: k, meanControl: Number(mean(a).toFixed(3)), meanTreatment: Number(mean(b).toFixed(3)),
        diff: Number((mean(b) - mean(a)).toFixed(3)), ci95: [Number(ci[0].toFixed(3)), Number(ci[1].toFixed(3))],
        p: Number(mw.p.toPrecision(3)), cliffsDelta: Number(d.toFixed(3)),
        significant: mw.p < 0.05 && !(ci[0] <= 0 && ci[1] >= 0) })
}

console.log(JSON.stringify({
    control: { file: path.basename(controlPath), n: gamesC.length, bot: control.tally.japanBot + "/" + control.tally.alliesBot,
        japanWins: control.tally.japanWins, alliesWins: control.tally.alliesWins },
    treatment: { file: path.basename(treatmentPath), n: gamesT.length, bot: treatment.tally.japanBot + "/" + treatment.tally.alliesBot,
        japanWins: treatment.tally.japanWins, alliesWins: treatment.tally.alliesWins },
    comparisons: rows,
}, null, 1))
