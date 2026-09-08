"use strict"

// 汇总 exp-* 对局结果 → 论文表格(CSV + Markdown)。
// 用法: node tests/make-tables.js [expPrefix=exp]
const fs = require("fs")
const path = require("path")

const prefix = String(process.argv[2] || "exp")
const dir = path.join(__dirname, "results")
const files = fs.readdirSync(dir).filter(f => f.startsWith(`match-`) && f.includes(`-${prefix}-`) && f.endsWith(".json"))

function load(f) {
    const o = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
    const t = o.tally
    const n = Math.max(1, t.complete)
    return { file: f, scenario: t.scenario, n: t.complete, japanWins: t.japanWins, alliesWins: t.alliesWins,
        japanBot: t.japanBot, alliesBot: t.alliesBot,
        perGame: o.perGame, tally: t,
        means: {
            AP_captures: t.role.Allies.capturedHexes / n, JP_captures: t.role.Japan.capturedHexes / n,
            AP_groundWins: t.role.Allies.groundAttacksWon / n, JP_groundWins: t.role.Japan.groundAttacksWon / n,
            AP_navalWins: t.role.Allies.navalBattlesWon / n, JP_navalWins: t.role.Japan.navalBattlesWon / n,
            AP_elim: t.role.Allies.eliminations / n, JP_elim: t.role.Japan.eliminations / n,
            AP_cfElim: t.role.Allies.cfEliminated / n, JP_cfElim: t.role.Japan.cfEliminated / n,
            AP_inflicted: (t.role.Japan.eliminations + t.role.Japan.reductions) / n,
            JP_inflicted: (t.role.Allies.eliminations + t.role.Allies.reductions) / n,
            PW: t.meanPW, jpResources: t.meanJpResources, turn: t.meanTurn,
            atomicWins: t.atomicBombWins, treatyWins: t.treatyWins,
        } }
}

const runs = files.map(load).sort((a, b) => a.scenario.localeCompare(b.scenario) || a.file.localeCompare(b.file))
if (!runs.length) { console.log("no results matched prefix", prefix); process.exit(0) }

// 找 base/jopt/aopt/both 四配对 + 消融
const cols = ["n", "japanWins", "alliesWins", "atomicWins", "AP_captures", "JP_captures",
    "AP_groundWins", "JP_groundWins", "AP_navalWins", "JP_navalWins",
    "AP_elim", "JP_elim", "AP_inflicted", "JP_inflicted", "PW", "jpResources", "turn"]

const mdRows = runs.map(r => {
    const name = r.file.replace(/^match-|\.json$/g, "")
    return `| ${name} | ${cols.map(c => typeof r.means[c] === "number" ? r.means[c].toFixed(2) : r.means[c]).join(" | ")} |`
})
const md = `| run | ${cols.join(" | ")} |\n|${cols.map(() => "---").join("|")}---|\n${mdRows.join("\n")}\n`
fs.writeFileSync(path.join(dir, `${prefix}-summary.md`), md)

// CSV(原始行)
const csvHead = ["file", "scenario", ...cols].join(",")
const csv = [csvHead, ...runs.map(r => [r.file, r.scenario, ...cols.map(c => typeof r.means[c] === "number" ? r.means[c].toFixed(3) : r.means[c])].join(","))].join("\n") + "\n"
fs.writeFileSync(path.join(dir, `${prefix}-summary.csv`), csv)
console.log(md)
console.log(`written: ${prefix}-summary.md / .csv (${runs.length} runs)`)
