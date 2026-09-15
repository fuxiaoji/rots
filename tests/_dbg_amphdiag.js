// 两栖失败诊断: 单局跑完, 线性扫描日志归类两栖战斗结果。
// 用法: EOTS_OPT_PROFILE=... node tests/_dbg_amphdiag.js <seed> [roleFilter]
"use strict"
const rules = require("../rules.js")

const seed = Number(process.argv[2] || 20260903)
const roleFilter = process.argv[3] || "Allies"
const scenario = "1942-1945 (The Shortened Campaign)"
const bots = { Japan: rules.bots["erasmus-v2-opt"], Allies: rules.bots["erasmus-v2-opt"] }

let state = rules.setup(seed, scenario, { headless_moves: true })
let actions = 0
while (state.active !== "None" && actions < 60000) {
    const role = Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
    if (role !== "Japan" && role !== "Allies") break
    const view = rules.view(state, role)
    const decision = bots[role].decide(view, { role, seed, actionOrdinal: actions + 1 })
    state = rules.action(state, role, decision.action, decision.argument)
    actions++
}
const int_to_hex = h => { try { return state.I ? state.I.int_to_hex(h) : h } catch (e) { return h } }

// 线性扫描: %J/%A Battle hex 标记开启会战; &J/&A 前缀标明会战进攻方。
const battles = []
let cur = null
for (const raw of state.log) {
    const line = String(raw)
    let m = line.match(/^%(J|A)Battle hex ([A-L]) \(([^)]*)\)/)
    if (m) {
        cur = { side: m[1] === "J" ? "Japan" : "Allies", letter: m[2], hex: m[3], outcome: null, fail: null, naval: null, lines: [] }
        battles.push(cur)
        continue
    }
    const fm = line.match(/^&([JA])/)
    const bside = fm ? (fm[1] === "J" ? "Japan" : "Allies") : (cur ? cur.side : null)
    const b = (fm && bside !== (cur && cur.side)) ? null : cur
    if (!b) continue
    const stripped = line.replace(/^&[JA]/, "")
    if (/Attacker won in ground combat/.test(stripped)) { b.groundWon = true; b.outcome = b.outcome || "groundWin" }
    else if (/Defender won in ground combat/.test(stripped)) { b.outcome = b.outcome || "groundLoss" }
    else if (/ won battle \(/.test(stripped)) {
        b.naval = /^Attacker/.test(stripped) ? "navalWin" : "navalLoss"
        b.navalLine = stripped
    }
    else if (/lack of naval escort/.test(stripped)) b.fail = "broken_aa"
    else if (/could not participate ground combat/.test(stripped)) b.fail = b.fail || "no_participate"
    else if (/\+3 Amphibious assault/.test(stripped)) b.amphBonus = true
    else if (/landed/.test(stripped)) b.landed = true
    b.lines.push(stripped)
}
const stats = {}
for (const side of ["Japan", "Allies"]) stats[side] = { succ: 0, groundLoss: 0, broken_aa: 0, no_participate: 0, navalOnly: 0, declaredNoBattle: 0 }
for (const b of battles) {
    const s = stats[b.side]
    if (b.fail === "broken_aa") s.broken_aa++
    else if (b.fail === "no_participate") s.no_participate++
    else if (b.groundWon) s.succ++
    else if (b.outcome === "groundLoss") s.groundLoss++
    else if (b.naval) s.navalOnly++
    else s.declaredNoBattle++
}
console.log(`seed=${seed} actions=${actions} battles=${battles.length}`)
console.log(JSON.stringify(stats))
console.log(`---- ${roleFilter} battles ----`)
for (const b of battles.filter(b => b.side === roleFilter)) {
    const tag = b.fail || (b.groundWon ? "SUCCESS" : b.outcome) || "none"
    console.log(`[${b.hex}] ${tag}${b.amphBonus ? " +3amph" : ""} ${b.navalLine ? "| " + b.navalLine.trim() : ""}`)
    if (b.fail || (b.amphBonus && !b.groundWon)) {
        for (const l of b.lines.filter(l => /landed|turned back|retreat|captured|Amphibious|won|units/.test(l)).slice(0, 6)) console.log("    > " + l.trim())
    }
}
